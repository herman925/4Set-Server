# TGMD Matrix-Radio Scoring Implementation Plan

## Overview
This document outlines the remaining work for implementing proper TGMD (Test of Gross Motor Development) matrix-radio scoring with trial summation.

**Status**: ✅ IMPLEMENTED (2025-10-24)  
**Reason for Deferral**: Requires significant changes to task-validator.js and UI rendering logic with risk of breaking existing TGMD display  
**Recommendation**: Implement as a separate focused PR after validating current changes

---

## Implementation Summary (2025-10-24)

The TGMD matrix-radio scoring has been successfully implemented with the following changes:

### Changes Made

#### 1. Task Validator (`assets/js/task-validator.js`)
- **Added `processTGMDScoring` function** that:
  - Groups trial cells (TGMD_111_Hop_t1, TGMD_111_Hop_t2) by row ID (TGMD_111_Hop)
  - Calculates row score = t1 + t2 (max 2 per criterion)
  - Extracts task information from TGMD.json task definition
  - Groups criteria by task field (hop, long_jump, slide, dribble, catch, underhand_throw)
  - Calculates task totals (sum of row scores for each motor task)
  - Calculates overall TGMD score and percentage
- **Modified `validateTask` function** to call `processTGMDScoring` for TGMD tasks
- Returns enhanced validation result with `tgmdScoring` structure containing:
  - `byTask`: Object with task-specific scoring grouped by motor task
  - `totalScore`: Overall score across all TGMD tasks
  - `maxScore`: Maximum possible score (2 × number of criteria)
  - `percentage`: Overall completion percentage

#### 2. Student Page Rendering (`assets/js/checking-system-student-page.js`)
- **Added `renderTGMDResults` function** that:
  - Displays results grouped by motor task with task headers
  - Shows task score for each motor task
  - Displays each performance criterion with:
    - Criterion ID and description
    - Trial 1 and Trial 2 results with Success/Fail pills
    - Row score (e.g., "1/2")
    - Row Score status indicator
  - Adds overall summary row with total score and percentage
- **Modified `populateTaskTables` function** to:
  - Detect TGMD tasks with `tgmdScoring` structure
  - Call `renderTGMDResults` for special TGMD rendering
  - Skip standard question-by-question rendering for TGMD
  - Update task summary with TGMD-specific statistics

#### 3. CSS Styling (`assets/css/checking-system-home.css`)
- **Added `.trial-pill` styling** for Success/Fail indicators
- **Added `.trial-success`** (green) for successful trials:
  - Background: #f0fdf4 (light green)
  - Text: #166534 (dark green)
  - Border: #bbf7d0 (medium green)
- **Added `.trial-fail`** (red) for failed trials:
  - Background: #fef2f2 (light red)
  - Text: #991b1b (dark red)
  - Border: #fecaca (medium red)

### Key Implementation Details

1. **Trial Value Handling**:
   - Values are converted to integers (0 or 1)
   - Null values default to 0
   - Row score is calculated as sum of both trials

2. **Task Grouping**:
   - Uses `task` field from TGMD.json matrix-radio questions
   - Tasks include: hop, long_jump, slide, dribble, catch, underhand_throw
   - Each task shows its total score and criteria breakdown

3. **Display Format**:
   - Changed from "Correct/Incorrect" to "Success/Fail" terminology
   - Trial results shown side-by-side for each criterion
   - Row scores displayed as "score/2" format
   - Task headers separate different motor tasks
   - Overall summary shows total TGMD performance

4. **Backward Compatibility**:
   - Other tasks continue to use standard rendering
   - TGMD-specific rendering only applies when `tgmdScoring` structure exists
   - No changes to validation logic for non-TGMD tasks

---

## Current Behavior

TGMD questions use a `matrix-radio` type where:
- Each row represents a performance criterion (e.g., "離地腳有自然彎曲並向前擺動以提供動力")
- Each column represents a trial (`t1` = Trial 1, `t2` = Trial 2)
- Values are 0 (not performed) or 1 (performed correctly)

**Current Implementation**:
- Each cell (`TGMD_111_Hop_t1`, `TGMD_111_Hop_t2`) is treated as a separate question
- Displayed individually with "Correct/Incorrect" labels
- No aggregation of trial scores per criterion

**Example Current Output**:
```
TGMD_111_Hop_t1: 1 (Correct)
TGMD_111_Hop_t2: 0 (Incorrect)
TGMD_112_Hop_t1: 1 (Correct)
TGMD_112_Hop_t2: 1 (Correct)
```

---

## Required Behavior

TGMD scoring should:
1. **Aggregate trials per row**: Score = t1 + t2 (max 2 per criterion)
2. **Group by task**: Organize results by task field (hop, long_jump, slide, dribble, etc.)
3. **Change labels**: Display "Success/Fail" instead of "Correct/Incorrect"
4. **Show trial breakdown**: Display individual trial results with aggregated row score

**Example Required Output**:
```
Task: Hop (單腳跳)
  Criterion 1: 離地腳有自然彎曲並向前擺動以提供動力
    Trial 1: Success (1)
    Trial 2: Fail (0)
    Row Score: 1/2
  
  Criterion 2: 離地腳的鞋沒有越過慣用腳
    Trial 1: Success (1)
    Trial 2: Success (1)
    Row Score: 2/2

Total Hop Score: 3/8 (37.5%)
```

---

## Implementation Requirements

### 1. Task Validator Changes (`assets/js/task-validator.js`)

#### Option A: Add Post-Processing for TGMD
After `validateTask` completes, add TGMD-specific processing:

```javascript
async function validateTask(taskId, mergedAnswers) {
  // ... existing validation logic ...
  
  const result = {
    taskId,
    title: taskDef.title,
    questions: validatedQuestions,
    // ... other fields ...
  };
  
  // Post-process TGMD tasks
  if (taskId === 'tgmd') {
    return processTGMDScoring(result, taskDef);
  }
  
  return result;
}

function processTGMDScoring(validationResult, taskDef) {
  // Group questions by row (TGMD_111_Hop_t1 and TGMD_111_Hop_t2 → TGMD_111_Hop)
  const rowMap = new Map();
  
  for (const q of validationResult.questions) {
    if (q.id.includes('_t1') || q.id.includes('_t2')) {
      const rowId = q.id.replace(/_t[12]$/, '');
      if (!rowMap.has(rowId)) {
        rowMap.set(rowId, { t1: null, t2: null, task: null });
      }
      
      const row = rowMap.get(rowId);
      if (q.id.endsWith('_t1')) {
        row.t1 = parseInt(q.studentAnswer, 10) || 0;
      } else {
        row.t2 = parseInt(q.studentAnswer, 10) || 0;
      }
      
      // Get task from definition
      const matrixQuestion = taskDef.questions.find(mq => 
        mq.rows?.some(r => r.id === rowId)
      );
      if (matrixQuestion) {
        row.task = matrixQuestion.task;
      }
    }
  }
  
  // Create aggregated results
  const tgmdQuestions = [];
  for (const [rowId, row] of rowMap) {
    const rowScore = row.t1 + row.t2;
    tgmdQuestions.push({
      id: rowId,
      rowScore: rowScore,
      maxScore: 2,
      trials: { t1: row.t1, t2: row.t2 },
      task: row.task,
      label: getRowDescription(rowId, taskDef)
    });
  }
  
  // Group by task
  const taskGroups = {};
  for (const q of tgmdQuestions) {
    if (!taskGroups[q.task]) {
      taskGroups[q.task] = [];
    }
    taskGroups[q.task].push(q);
  }
  
  return {
    ...validationResult,
    tgmdScoring: {
      byTask: taskGroups,
      totalScore: tgmdQuestions.reduce((sum, q) => sum + q.rowScore, 0),
      maxScore: tgmdQuestions.length * 2
    }
  };
}
```

#### Option B: Create Separate validateTGMDTask Function
Implement a dedicated TGMD validator (as suggested in PRODUCTION_IMPLEMENTATION_PLAN.md):

```javascript
async function validateTGMDTask(taskId, mergedAnswers) {
  const taskDef = await loadTaskDefinition(taskId);
  if (!taskDef) return { error: 'Task definition not found' };
  
  const results = {
    taskId: taskId,
    title: taskDef.title,
    byTask: {},
    totalScore: 0,
    maxScore: 0
  };
  
  // Extract matrix-radio questions
  const matrixQuestions = taskDef.questions.filter(q => q.type === 'matrix-radio');
  
  for (const matrix of matrixQuestions) {
    const task = matrix.task;
    if (!results.byTask[task]) {
      results.byTask[task] = {
        taskName: matrix.label?.zh || task,
        criteria: []
      };
    }
    
    for (const row of matrix.rows) {
      const t1Key = `${row.id}_t1`;
      const t2Key = `${row.id}_t2`;
      
      const t1Value = parseInt(mergedAnswers[t1Key]?.answer || 0, 10);
      const t2Value = parseInt(mergedAnswers[t2Key]?.answer || 0, 10);
      
      const rowScore = t1Value + t2Value;
      results.totalScore += rowScore;
      results.maxScore += 2;
      
      results.byTask[task].criteria.push({
        description: row.description,
        trials: { t1: t1Value, t2: t2Value },
        score: rowScore,
        maxScore: 2
      });
    }
  }
  
  return results;
}
```

### 2. UI Rendering Changes

Update student page rendering to handle TGMD scoring format:

```javascript
function renderTGMDResults(tgmdResult) {
  let html = '<div class="tgmd-results">';
  
  for (const [taskName, taskData] of Object.entries(tgmdResult.byTask)) {
    html += `<h3>${taskData.taskName}</h3>`;
    
    for (const criterion of taskData.criteria) {
      const t1Label = criterion.trials.t1 === 1 ? 'Success' : 'Fail';
      const t2Label = criterion.trials.t2 === 1 ? 'Success' : 'Fail';
      
      html += `
        <div class="criterion">
          <div class="description">${criterion.description}</div>
          <div class="trials">
            <span class="trial ${t1Label.toLowerCase()}">Trial 1: ${t1Label}</span>
            <span class="trial ${t2Label.toLowerCase()}">Trial 2: ${t2Label}</span>
            <span class="score">Score: ${criterion.score}/${criterion.maxScore}</span>
          </div>
        </div>
      `;
    }
  }
  
  html += `<div class="total">Total: ${tgmdResult.totalScore}/${tgmdResult.maxScore}</div>`;
  html += '</div>';
  
  return html;
}
```

### 3. CSS Styling

Add styles for Success/Fail labels:

```css
.tgmd-results .trial.success {
  color: #10b981;  /* Green */
}

.tgmd-results .trial.fail {
  color: #ef4444;  /* Red */
}

.tgmd-results .criterion {
  margin-bottom: 1rem;
  padding: 0.5rem;
  border-left: 3px solid #e5e7eb;
}

.tgmd-results .score {
  font-weight: 600;
  margin-left: 1rem;
}
```

---

## Testing Requirements

Before implementation:
1. Identify all pages that display TGMD results
2. Create test data with sample TGMD responses
3. Verify current display behavior
4. Document expected vs actual output

After implementation:
1. Test with real TGMD data from Qualtrics
2. Verify trial aggregation is correct
3. Verify task grouping works
4. Verify Success/Fail labels display correctly
5. Test edge cases (missing trials, partial data)

---

## Risks & Considerations

### Breaking Changes
- UI rendering logic will change significantly
- Existing code that expects individual trial results will break
- May affect other components that consume validation results

### Data Compatibility
- Need to ensure backward compatibility with existing JotForm TGMD data
- Test with both Qualtrics and JotForm TGMD sources

### Performance
- Aggregation adds processing overhead
- May need to cache aggregated results

---

## Recommendation

Implement TGMD scoring as a **separate PR** after the current changes (grade detection, complete Qualtrics extraction, documentation) are validated and merged. This allows:

1. Testing current changes without TGMD complexity
2. Focused testing of TGMD scoring logic
3. Easier rollback if issues arise
4. Better code review focus

---

## Related Files

- `assets/js/task-validator.js` - Main validation logic
- `assets/js/checking-system-student-page.js` - Student page rendering
- `assets/tasks/TGMD.json` - TGMD task definition
- `assets/qualtrics-mapping.json` - TGMD field mappings
- `TEMP/PRODUCTION_IMPLEMENTATION_PLAN.md` - Original implementation plan

---

**Document Created**: 2025-10-24  
**Status**: Planning Phase  
**Priority**: Medium (deferred after current PR)
