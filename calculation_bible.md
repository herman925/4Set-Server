# 4Set System Calculation Bible

**Version:** 1.0  
**Created:** January 2025  
**Purpose:** Complete technical reference for all calculation, validation, and termination rules in the 4Set assessment system  
**Scope:** Based on actual implemented code, not design documents

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Question-Level Calculations](#question-level-calculations)
3. [Task-Level Calculations](#task-level-calculations)
4. [Termination Rules](#termination-rules)
5. [Timeout Detection](#timeout-detection)
6. [Set-Level Calculations](#set-level-calculations)
7. [Status Color Mapping](#status-color-mapping)
8. [Server-Side Processing](#server-side-processing)
9. [Page-Specific Implementation](#page-specific-implementation)
10. [Debugging Guide](#debugging-guide)

---

## Architecture Overview

### Single Source of Truth

**Location:** `assets/js/task-validator.js` (Lines 1-708)

The 4Set system uses a centralized validation architecture:

```
TaskValidator.js (Single Source of Truth)
    ↓
    ├─→ Student Page (Direct validation)
    ├─→ Class Page (Via JotFormCache)
    ├─→ School Page (Via JotFormCache)
    ├─→ District Page (Via JotFormCache)
    └─→ Group Page (Via JotFormCache)
```

**Critical Principle:**
> When termination or timeout occurs, questions AFTER that point are **COMPLETELY EXCLUDED** from ALL calculations.

**Location:** `task-validator.js` Lines 16-21:
```javascript
// When termination or timeout occurs, questions AFTER that point are COMPLETELY 
// EXCLUDED from total count. This ensures:
// - CWR terminated at Q24: total=24, answered=24 → 100% complete ✅
// - SYM timed out at Q53: total=53, answered=53 → 100% complete ✅
// - CM terminated at Q7: total=9 (P1,P2,Q1-Q7), answered=9 → 100% complete ✅
```

### Key Components

1. **TaskValidator** - Core validation engine
2. **JotFormCache** - Caching layer for bulk operations
3. **Student UI Renderer** - Presentation layer
4. **Processor Agent** - Server-side pipeline (PowerShell)

---

## Question-Level Calculations

### Question Extraction

**Location:** `task-validator.js` Lines 127-173

Questions are extracted from task definitions with special handling:

```javascript
function extractQuestions(taskDef) {
  // Handles:
  // 1. Nested multi-question blocks
  // 2. Nested multi-step blocks
  // 3. Matrix-radio expansion (row×column)
  // 4. Exclusion of instruction/completion screens
}
```

**Excluded Fields:**
- `*_Date` - Date fields
- `*_TEXT` - Text memo fields
- `*_Memo_*` - Memo fields
- `*_Ter` - Termination records (ERV_Ter1, CM_Ter2, etc.)
- `*_timeout` - Timeout fields (SYM_timeout, NONSYM_timeout)

**Location:** `task-validator.js` Lines 178-185

### Answer Validation

**Location:** `task-validator.js` Lines 189-263

#### Standard Questions with Scoring

```javascript
// Location: Lines 224-226
if (correctAnswer !== undefined) {
  isCorrect = studentAnswer !== null && 
              String(studentAnswer).trim() === String(correctAnswer).trim();
}
```

**Example:**
- Question: ERV_Q1
- Student Answer: "2"
- Correct Answer: "2"
- Result: `isCorrect = true`

#### Matrix Questions (TGMD)

**Location:** `task-validator.js` Lines 227-230

```javascript
else if (question.type === 'matrix-cell') {
  // Matrix cell: 1 = performed correctly, 0 = not performed
  isCorrect = studentAnswer === '1' || studentAnswer === 1;
}
```

**Example:**
- Question: TGMD_111_Hop_t1
- Student Answer: "1"
- Result: `isCorrect = true`

#### Y/N Questions (No Scoring)

**Location:** `task-validator.js` Lines 231-233

```javascript
else {
  // Y/N question: Y = correct, N = incorrect
  isCorrect = studentAnswer === 'Y' || studentAnswer === 'y';
}
```

**Example:**
- Question: MF_Q1
- Student Answer: "Y"
- Result: `isCorrect = true`

#### Option Mapping (Image-Choice, Radio)

**Location:** `task-validator.js` Lines 213-220

JotForm stores option indices (1, 2, 3) but task definitions use values (A, B, C).

```javascript
if (studentAnswer && (question.type === 'image-choice' || 
                      question.type === 'radio' || 
                      question.type === 'radio_text') && 
    question.options) {
  const optionIndex = parseInt(studentAnswer);
  if (!isNaN(optionIndex) && optionIndex >= 1 && optionIndex <= question.options.length) {
    const mappedValue = question.options[optionIndex - 1].value;
    studentAnswer = mappedValue;
  }
}
```

**Example:**
- JotForm Answer: "2" (second option)
- Options: [{value: "A"}, {value: "B"}, {value: "C"}]
- Mapped Value: "B"

### Question Status States

**Location:** `checking-system-student-page.js` Lines 808-810

Each question has a `data-state` attribute:

```javascript
const dataState = isIgnoredDueToTimeout ? 'ignored' :
  (question.isUnscored ? 'unscored' : 
  (question.isCorrect ? 'correct' : 'incorrect'));
```

**State Meanings:**

| State | Condition | Display |
|-------|-----------|---------|
| `correct` | Answer matches correct answer | ✅ Green "Correct" pill |
| `incorrect` | Answer exists but doesn't match | ❌ Red "Incorrect" pill |
| `unscored` | Preference question (no scoring) | 🔵 Blue "Answered" pill |
| `ignored` | After termination/timeout | 🔵 Blue "Ignored (Terminated)" pill |
| N/A (null) | No answer provided | ⚪ Grey "Not answered" pill |

**Location:** `checking-system-student-page.js` Lines 816-828

---

## Task-Level Calculations

### Base Statistics Calculation

**Location:** `task-validator.js` Lines 249-261

```javascript
const answeredCount = validatedQuestions.filter(q => q.studentAnswer !== null).length;
const correctCount = validatedQuestions.filter(q => q.isCorrect).length;
const totalQuestions = validatedQuestions.length;

return {
  taskId,
  title: taskDef.title,
  questions: validatedQuestions,
  totalQuestions,
  answeredQuestions: answeredCount,
  correctAnswers: correctCount,
  completionPercentage: totalQuestions > 0 ? Math.round((answeredCount / totalQuestions) * 100) : 0,
  accuracyPercentage: answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0
};
```

### Task Completion Logic

**Location:** `checking-system-student-page.js` Lines 1815-1847

A task is considered **complete** when:

```javascript
// Completion percentage = 100% (all expected questions answered)
stats.answeredPercent === 100
```

**Important:** "Expected questions" changes based on termination:
- **Before termination:** Total includes all questions
- **After termination:** Total only includes questions up to termination point

### Task Statistics Display

**Location:** `checking-system-student-page.js` Lines 1700-1810

Statistics shown for each task:

```javascript
{
  total: adjustedTotal,              // Questions up to termination
  answered: adjustedAnswered,         // Non-null answers
  correct: correctCount,              // Correct answers
  scoredTotal: scoredTotal,          // Questions with scoring (excludes unscored)
  answeredPercent: Math.round((adjustedAnswered / adjustedTotal) * 100),
  correctPercent: Math.round((correctCount / scoredTotal) * 100)
}
```

**Color Gradients Applied:**

| Metric | Range | Color |
|--------|-------|-------|
| Answered % | 0-50% | Red → Orange |
| Answered % | 50-100% | Orange → Green |
| Correct % | 0-50% | Red → Orange |
| Correct % | 50-100% | Orange → Green |

**Location:** `checking-system-student-page.js` Lines 1744-1783

---

## Termination Rules

### Centralized Configuration

**Location:** `task-validator.js` Lines 281-310

All termination rules are defined in the `TERMINATION_RULES` configuration object:

```javascript
const TERMINATION_RULES = {
  'erv': {
    type: 'stage_based',
    stages: [...]
  },
  'cm': {
    type: 'stage_based',
    stages: [...]
  },
  'chinesewordreading': {
    type: 'consecutive_incorrect',
    consecutiveThreshold: 10
  },
  'finemotor': {
    type: 'threshold_based',
    questionIds: ['FM_squ_1', 'FM_squ_2', 'FM_squ_3'],
    threshold: 1
  }
};
```

### Type 1: Stage-Based Termination (ERV, CM)

**Location:** `task-validator.js` Lines 328-380

#### ERV (English Reading Vocabulary)

**Configuration:** Lines 281-289

```javascript
'erv': {
  type: 'stage_based',
  stages: [
    { startId: 'ERV_Q1', endId: 'ERV_Q12', threshold: 5, stageNum: 1 },
    { startId: 'ERV_Q13', endId: 'ERV_Q24', threshold: 5, stageNum: 2 },
    { startId: 'ERV_Q25', endId: 'ERV_Q36', threshold: 5, stageNum: 3 }
  ]
}
```

**Logic:**

```javascript
// 1. Find stage questions by ID (robust against practice items)
const stageQuestions = taskResult.questions.slice(startIdx, endIdx + 1);

// 2. Count correct and unanswered
const correctCount = stageQuestions.filter(q => q.isCorrect).length;
const answeredCount = stageQuestions.filter(q => q.studentAnswer !== null).length;
const unansweredCount = stageQuestions.length - answeredCount;
const maxPossible = correctCount + unansweredCount;

// 3. Check if termination is certain
if (maxPossible < stage.threshold) {
  terminationIndex = endIdx;
  terminationStage = stage.stageNum;
  break;
}
```

**Example 1 - ERV Stage 1 Termination:**
- Questions: ERV_Q1 - ERV_Q12 (12 questions)
- Threshold: 5 correct
- Student: 3 correct, 9 answered, 0 unanswered
- maxPossible = 3 + 0 = 3
- Result: 3 < 5 → **TERMINATED at Q12**
- Total adjusted: 15 questions (P1, P2, P3, Q1-Q12)

**Example 2 - ERV Stage 1 Continue:**
- Questions: ERV_Q1 - ERV_Q12
- Student: 3 correct, 4 answered, 8 unanswered
- maxPossible = 3 + 8 = 11
- Result: 11 ≥ 5 → **CONTINUE** (still possible to pass)

#### CM (Chinese Morphology)

**Configuration:** Lines 290-299

```javascript
'cm': {
  type: 'stage_based',
  stages: [
    { startId: 'CM_Q1', endId: 'CM_Q7', threshold: 4, stageNum: 1 },
    { startId: 'CM_Q8', endId: 'CM_Q12', threshold: 4, stageNum: 2 },
    { startId: 'CM_Q13', endId: 'CM_Q17', threshold: 4, stageNum: 3 },
    { startId: 'CM_Q18', endId: 'CM_Q22', threshold: 4, stageNum: 4 }
    // Stage 5 (CM_Q23-CM_Q27) has NO termination
  ]
}
```

**Special Note:** Stage 5 (Q23-Q27) has **no termination rule**. Students who reach Stage 5 should complete all remaining questions.

**Example - CM Stage 1 Termination:**
- Questions: CM_Q1 - CM_Q7 (7 questions)
- Threshold: 4 correct
- Student: P1 ✅, P2 ✅, Q1 ❌, Q2 ✅, Q3 ✅, Q4 ❌, Q5 ✅, Q6 ❌, Q7 ❌
- Stage Q1-Q7: 3 correct out of 7
- Result: 3 < 4 → **TERMINATED at Q7**
- Total adjusted: 9 questions (P1, P2, Q1-Q7)
- Completion: 9/9 = 100% ✅

### Type 2: Consecutive Incorrect Termination (CWR)

**Location:** `task-validator.js` Lines 398-421

**Configuration:** Lines 300-303

```javascript
'chinesewordreading': {
  type: 'consecutive_incorrect',
  consecutiveThreshold: 10
}
```

**Logic:**

```javascript
let consecutiveIncorrect = 0;

for (let i = 0; i < taskResult.questions.length; i++) {
  const q = taskResult.questions[i];
  
  if (q.studentAnswer === null) {
    consecutiveIncorrect = 0;  // Reset on skip
  } else if (q.isCorrect) {
    consecutiveIncorrect = 0;  // Reset on correct
  } else {
    consecutiveIncorrect++;
    
    if (consecutiveIncorrect >= config.consecutiveThreshold) {
      terminationIndex = i;
      break;
    }
  }
}
```

**Example 1 - CWR Termination:**
- Q1-Q14: Mixed results (resets occur)
- Q15-Q24: All incorrect (10 consecutive)
- Result: **TERMINATED at Q24**
- Total adjusted: 24 questions
- Completion: 24/24 = 100% ✅

**Example 2 - CWR No Termination:**
- Q1-Q20: Mixed results
- Q21: Correct ✅ (resets counter)
- Q22-Q30: More attempts
- Result: **NOT TERMINATED** (streak broken)

**Example 3 - CWR Skip Resets:**
- Q15-Q20: Incorrect (6 consecutive)
- Q21: Not answered (skipped)
- Q22-Q25: Incorrect (4 consecutive)
- Result: Counter reset at Q21, only 4 consecutive → **NOT TERMINATED**

### Type 3: Threshold-Based Termination (Fine Motor)

**Location:** `task-validator.js` Lines 439-466

**Configuration:** Lines 304-309

```javascript
'finemotor': {
  type: 'threshold_based',
  questionIds: ['FM_squ_1', 'FM_squ_2', 'FM_squ_3'],
  threshold: 1,  // At least 1 must be correct (score > 0)
  description: 'All square-cutting items must score 0 to terminate'
}
```

**Logic:**

```javascript
// 1. Find target questions by ID
const targetQuestions = taskResult.questions.filter(q => 
  config.questionIds.includes(q.id)
);

// 2. Check if all are answered
const allAnswered = targetQuestions.every(q => q.studentAnswer !== null);
if (!allAnswered) return { terminationIndex: -1 };

// 3. Count correct (score > 0)
const correctCount = targetQuestions.filter(q => q.isCorrect).length;

// 4. Terminate if below threshold
if (correctCount < config.threshold) {
  const lastQuestion = targetQuestions[targetQuestions.length - 1];
  const terminationIndex = taskResult.questions.findIndex(q => 
    q.id === lastQuestion.id
  );
  return { terminationIndex };
}
```

**Example 1 - FM Termination:**
- FM_squ_1: 0 (incorrect)
- FM_squ_2: 0 (incorrect)
- FM_squ_3: 0 (incorrect)
- Result: 0 correct < 1 threshold → **TERMINATED**
- Tree-cutting items (FM_tree_*) are skipped

**Example 2 - FM Continue:**
- FM_squ_1: 0 (incorrect)
- FM_squ_2: 1 (correct) ✅
- FM_squ_3: 0 (incorrect)
- Result: 1 correct ≥ 1 threshold → **CONTINUE**
- Student proceeds to tree-cutting items

### Termination Application

**Location:** `task-validator.js` Lines 489-532

After determining termination index, totals are recalculated:

```javascript
if (terminationIndex >= 0) {
  // Only count questions up to and including termination point
  adjustedTotal = terminationIndex + 1;
  adjustedAnswered = taskResult.questions.slice(0, terminationIndex + 1)
    .filter(q => q.studentAnswer !== null).length;
  
  // Check for post-termination answers (data quality issue)
  for (let i = terminationIndex + 1; i < taskResult.questions.length; i++) {
    if (taskResult.questions[i].studentAnswer !== null) {
      hasPostTerminationAnswers = true;
      break;
    }
  }
}

return {
  ...taskResult,
  totalQuestions: adjustedTotal,
  answeredQuestions: adjustedAnswered,
  completionPercentage: adjustedTotal > 0 ? 
    Math.round((adjustedAnswered / adjustedTotal) * 100) : 0,
  terminated: terminationIndex >= 0,
  terminationIndex,
  terminationStage,
  terminationType: config.type,
  hasPostTerminationAnswers
};
```

---

## Timeout Detection

### SYM/NONSYM Special Handling

**Location:** `task-validator.js` Lines 556-686

SYM and NONSYM are unique tasks with:
- Independent 2-minute timers
- Merged display (SYM / NONSYM shown together)
- Complex timeout detection logic

### Timeout Detection Algorithm

**Location:** `task-validator.js` Lines 570-631

**Key Principle:** Timeout occurs when there is a **consecutive sequence of unanswered questions extending to the last question**.

```javascript
function analyzeCompletionPattern(questions) {
  // Find index of last answered question
  let lastAnsweredIndex = -1;
  for (let i = questions.length - 1; i >= 0; i--) {
    if (questions[i].studentAnswer !== null) {
      lastAnsweredIndex = i;
      break;
    }
  }
  
  // Case 1: No answers at all
  if (lastAnsweredIndex === -1) {
    return { timedOut: false, hasMissingData: false, complete: false };
  }
  
  // Case 2: Last question is answered (complete)
  if (lastAnsweredIndex === questions.length - 1) {
    return { timedOut: false, hasMissingData: false, complete: true };
  }
  
  // Case 3: Check if ALL questions after lastAnswered are empty
  let hasConsecutiveGapToEnd = false;
  for (let i = lastAnsweredIndex + 1; i < questions.length; i++) {
    if (questions[i].studentAnswer !== null) {
      // Found answer after gap → NOT timeout
      hasConsecutiveGapToEnd = false;
      break;
    }
    hasConsecutiveGapToEnd = true;
  }
  
  // Case 4: Consecutive gap to end → TIMED OUT
  if (hasConsecutiveGapToEnd) {
    // Check for gaps in the middle
    let hasGapsInMiddle = false;
    for (let i = 0; i < lastAnsweredIndex; i++) {
      if (questions[i].studentAnswer === null) {
        hasGapsInMiddle = true;
        break;
      }
    }
    
    return { 
      timedOut: true, 
      hasMissingData: hasGapsInMiddle, 
      complete: false, 
      lastAnsweredIndex 
    };
  }
  
  // Case 5: No consecutive gap to end
  for (let i = 0; i < lastAnsweredIndex; i++) {
    if (questions[i].studentAnswer === null) {
      return { timedOut: false, hasMissingData: true, complete: false };
    }
  }
  
  return { timedOut: false, hasMissingData: false, complete: true };
}
```

### Timeout Scenarios

#### Scenario 1: Clean Timeout

**Pattern:** Q1-Q41 all answered, Q42-Q56 ALL blank

```
Q1  Q2  Q3  ... Q40 Q41 │ Q42 Q43 ... Q55 Q56
[✓] [✓] [✓] ... [✓] [✓] │ [ ] [ ] ... [ ] [ ]
                        ↑ Timed out here
```

**Result:**
- `timedOut = true`
- `hasMissingData = false`
- `lastAnsweredIndex = 40`
- Total adjusted: 41
- Completion: 41/41 = 100% ✅

#### Scenario 2: Timeout with Middle Gap

**Pattern:** Q1-Q18 answered, Q19 blank, Q20-Q34 answered, Q35-Q56 ALL blank

```
Q1  ... Q18 Q19 Q20 ... Q34 │ Q35 ... Q56
[✓] ... [✓] [ ] [✓] ... [✓] │ [ ] ... [ ]
            ↑ Gap            ↑ Timed out here
```

**Real Example:** Student C10207 - NONSYM

**Result:**
- `timedOut = true` ✅ (consecutive gap Q35-Q56)
- `hasMissingData = true` ⚠️ (Q19 gap)
- `lastAnsweredIndex = 33` (Q34 at index 33)
- Total adjusted: 34
- Answered: 33 (Q19 missing)
- Completion: 33/34 = 97% ✅
- Display: "Timed Out · Non-continuous data gaps detected"

**Why Q19 doesn't prevent timeout:**
The 2-minute timer expired between Q34 and Q35. Q19 being blank is a data gap (student skipped or answer didn't load), but doesn't affect timeout determination. Timeout is based on Q35-Q56 being **consecutively blank to the end**.

#### Scenario 3: Missing Data (NOT Timeout)

**Pattern:** Q1-Q10 answered, Q11-Q20 blank, Q21 answered

```
Q1  ... Q10 Q11 ... Q20 Q21 ... Q56
[✓] ... [✓] [ ] ... [ ] [✓] ... [?]
                        ↑ Answer exists after gap
```

**Result:**
- `timedOut = false` ❌
- `hasMissingData = true`
- Q21 having an answer means timer didn't expire
- Status: Red "Missing Data" (not green timeout)

### Timeout Recalculation

**Location:** `task-validator.js` Lines 643-662

```javascript
if (symAnalysis.timedOut && symAnalysis.lastAnsweredIndex !== undefined) {
  adjustedSymTotal = symAnalysis.lastAnsweredIndex + 1;
  adjustedSymAnswered = symResult.questions.slice(0, symAnalysis.lastAnsweredIndex + 1)
    .filter(q => q.studentAnswer !== null).length;
}

if (nonsymAnalysis.timedOut && nonsymAnalysis.lastAnsweredIndex !== undefined) {
  adjustedNonsymTotal = nonsymAnalysis.lastAnsweredIndex + 1;
  adjustedNonsymAnswered = nonsymResult.questions.slice(0, nonsymAnalysis.lastAnsweredIndex + 1)
    .filter(q => q.studentAnswer !== null).length;
}

const totalAdjusted = adjustedSymTotal + adjustedNonsymTotal;
const answeredAdjusted = adjustedSymAnswered + adjustedNonsymAnswered;
```

**Merged Display:**

```javascript
results['sym'] = {
  taskId: 'sym',
  title: `${symResult.title} / ${nonsymResult.title}`, // "SYM / NONSYM"
  questions: [...symResult.questions, ...nonsymResult.questions],
  totalQuestions: totalAdjusted,
  answeredQuestions: answeredAdjusted,
  timedOut: symAnalysis.timedOut || nonsymAnalysis.timedOut,
  hasMissingData: symAnalysis.hasMissingData || nonsymAnalysis.hasMissingData,
  symResult,
  nonsymResult,
  symAnalysis,
  nonsymAnalysis
};
```

---

## Set-Level Calculations

### Set Structure

**Location:** `assets/tasks/survey-structure.json`

The 4Set assessment has 4 sets:

```json
{
  "sets": [
    {
      "id": "set1",
      "name": "第一組",
      "sections": [
        { "file": "ERV.json", "order": 1 },
        { "file": "SYM.json", "order": 2 },
        { "file": "TheoryofMind.json", "order": 3 },
        { "file": "ChineseWordReading.json", "order": 4 }
      ]
    },
    {
      "id": "set2",
      "name": "第二組",
      "sections": [
        { "file": "TEC_Male.json", "order": 1, "showIf": { "gender": "male" } },
        { "file": "TEC_Female.json", "order": 2, "showIf": { "gender": "female" } },
        { "file": "MathPattern.json", "order": 3 },
        { "file": "CCM.json", "order": 4 }
      ]
    },
    // ... set3, set4
  ]
}
```

### Gender-Conditional Tasks

**Critical:** Set 2 contains gender-specific tasks (TEC_Male vs TEC_Female).

**Problem:** Student data may use single-letter codes (`"M"`, `"F"`) OR full words (`"Male"`, `"Female"`), while survey-structure.json uses lowercase full words (`"male"`, `"female"`).

**Solution - Gender Normalization:**

**Location:** `jotform-cache.js` Lines 638-655 (approximate)

```javascript
applicableSections = set.sections.filter(section => {
  if (!section.showIf) return true;
  
  if (section.showIf.gender) {
    // CRITICAL: Normalize single-letter codes to full words
    let studentGender = (student.gender || '').toLowerCase();
    if (studentGender === 'm' || studentGender === 'male') studentGender = 'male';
    if (studentGender === 'f' || studentGender === 'female') studentGender = 'female';
    
    const requiredGender = section.showIf.gender.toLowerCase();
    return studentGender === requiredGender;
  }
  
  return true;
});

tasksTotal = applicableSections.length;
```

**Example - Female Student, Set 2:**

| Task | Condition | Applicable? |
|------|-----------|-------------|
| TEC_Male | gender=male | ❌ Excluded |
| TEC_Female | gender=female | ✅ Included |
| MathPattern | none | ✅ Included |
| CCM | none | ✅ Included |

**Result:** tasksTotal = 3 (not 4)

### Set Status Determination

**Location:** `jotform-cache.js` Lines 683-696 (approximate)

```javascript
function calculateSetStatus(tasksComplete, tasksTotal) {
  const rate = tasksComplete / tasksTotal;
  if (rate === 1) return 'complete';
  if (rate > 0) return 'incomplete';
  return 'notstarted';
}
```

**Status Values:**

| Rate | Status | Color | Meaning |
|------|--------|-------|---------|
| 1.0 (100%) | `complete` | Green | All applicable tasks complete |
| 0 < rate < 1 | `incomplete` | Yellow/Orange | Some tasks complete |
| 0 (0%) | `notstarted` | Grey | No tasks started |

### Overall Student Status

Student's overall status is determined by set completion:

```javascript
completeSets = countSets(status === 'complete');

if (completeSets === 4) {
  overallStatus = 'complete';  // All 4 sets complete
} else if (completeSets > 0 || completeTasks > 0) {
  overallStatus = 'incomplete';  // Some progress
} else {
  overallStatus = 'notstarted';  // No progress
}
```

---

## Status Color Mapping

### Task Status Circle

**Location:** `checking-system-student-page.js` Lines 1815-1847

Each task has a colored circle indicator (`.status-circle`):

```javascript
function updateTaskLightingStatus(taskElement, stats) {
  const statusCircle = taskElement.querySelector('.status-circle');
  
  if (stats.total === 0) {
    // Grey: No data yet
    statusCircle.classList.add('status-grey');
    statusCircle.title = 'Not started';
    
  } else if (stats.hasPostTerminationAnswers) {
    // Yellow: Post-termination data detected
    statusCircle.classList.add('status-yellow');
    statusCircle.title = 'Post-termination data detected';
    
  } else if ((stats.hasTerminated || stats.timedOut) && stats.answered > 0) {
    // Green: Properly terminated/timed out
    statusCircle.classList.add('status-green');
    statusCircle.title = stats.timedOut ? 'Timed out correctly' : 'Terminated correctly';
    
  } else if (stats.answeredPercent === 100 && !stats.hasTerminated && !stats.timedOut) {
    // Green: Complete - all questions answered
    statusCircle.classList.add('status-green');
    statusCircle.title = 'Complete';
    
  } else if (stats.answered > 0) {
    // Red: Incomplete - has some answers but not complete
    statusCircle.classList.add('status-red');
    statusCircle.title = 'Incomplete';
    
  } else {
    // Grey: Not started
    statusCircle.classList.add('status-grey');
    statusCircle.title = 'Not started';
  }
}
```

### Status Color Reference Table

| Color | CSS Class | Condition | Meaning | Priority |
|-------|-----------|-----------|---------|----------|
| 🟢 Green | `status-green` | `answeredPercent === 100` | Task complete (all questions answered) | Highest |
| 🟢 Green | `status-green` | `hasTerminated && answered > 0` | Properly terminated (no post-term answers) | Highest |
| 🟢 Green | `status-green` | `timedOut && answered > 0` | Properly timed out (no gaps after timeout) | Highest |
| 🟡 Yellow | `status-yellow` | `hasPostTerminationAnswers` | Post-termination data issue | Medium-High |
| 🔴 Red | `status-red` | `answered > 0 && answeredPercent < 100` | Incomplete (some progress) | Medium |
| ⚪ Grey | `status-grey` | `total === 0 || answered === 0` | Not started | Lowest |

**Priority Logic:**
1. Yellow trumps all (data quality issue)
2. Green applies when properly complete/terminated
3. Red indicates incomplete work
4. Grey indicates no work started

### Question Row States

**Location:** `checking-system-student-page.js` Lines 808-828

Each question row has `data-state` and visual styling:

```javascript
row.setAttribute('data-state', dataState);
row.setAttribute('data-missing', question.studentAnswer === null ? 'true' : 'false');
row.setAttribute('data-ignored', isIgnoredDueToTimeout ? 'true' : 'false');
```

**Visual Pills:**

| Condition | Pill Style | Icon | Text |
|-----------|------------|------|------|
| Ignored (terminated) | Blue `#dbeafe` | `ban` | "Ignored (Terminated)" |
| Not answered | Grey/Red | `minus` | "Not answered" |
| Unscored (answered) | Light blue `#f0f9ff` | `circle-check` | "Answered" |
| Correct | Green | `check` | "Correct" |
| Incorrect | Red | `x` | "Incorrect" |

**Location:** Lines 816-828

### Termination Card Styling

**Location:** `checking-system-student-page.js` Lines 1218-1232

For SYM/NONSYM timeout cards:

```javascript
const getCardStyle = (analysis) => {
  if (analysis.timedOut) {
    return { 
      border: 'border-green-400', 
      bg: 'bg-green-50', 
      color: 'text-green-600', 
      icon: 'clock-alert', 
      status: 'Timed Out' 
    };
  } else if (analysis.complete) {
    return { 
      border: 'border-green-400', 
      bg: 'bg-green-50', 
      color: 'text-green-600', 
      icon: 'check-circle', 
      status: 'Complete' 
    };
  } else if (analysis.hasMissingData) {
    return { 
      border: 'border-red-400', 
      bg: 'bg-red-50', 
      color: 'text-red-600', 
      icon: 'alert-triangle', 
      status: 'Missing Data' 
    };
  } else {
    return { 
      border: 'border-gray-400', 
      bg: 'bg-gray-50', 
      color: 'text-gray-600', 
      icon: 'info', 
      status: 'In Progress' 
    };
  }
};
```

### Status Overview Counts

**Location:** `checking-system-student-page.js` Lines 1853-1883

Task status overview displays counts:

```javascript
function updateTaskStatusOverview() {
  const allTasks = document.querySelectorAll('.task-expand .status-circle');
  
  let completeCount = 0;      // Green circles
  let posttermCount = 0;      // Yellow circles
  let incompleteCount = 0;    // Red circles
  let notstartedCount = 0;    // Grey circles
  
  allTasks.forEach(circle => {
    if (circle.classList.contains('status-green')) {
      completeCount++;
    } else if (circle.classList.contains('status-yellow')) {
      posttermCount++;
    } else if (circle.classList.contains('status-red')) {
      incompleteCount++;
    } else if (circle.classList.contains('status-grey')) {
      notstartedCount++;
    }
  });
  
  // Update display elements
  document.getElementById('overview-complete-count').textContent = completeCount;
  document.getElementById('overview-postterm-count').textContent = posttermCount;
  document.getElementById('overview-incomplete-count').textContent = incompleteCount;
  document.getElementById('overview-notstarted-count').textContent = notstartedCount;
}
```

---

## Server-Side Processing

### Processor Agent Overview

**Location:** `processor_agent.ps1`

The processor agent is a PowerShell script that:
1. Watches for PDF uploads
2. Parses PDF forms
3. Validates data
4. Calculates termination outcomes
5. Uploads to JotForm

### Termination Calculation Function

**Location:** `processor_agent.ps1` Lines 840-1065

```powershell
function Add-TerminationOutcomes {
    param(
        [PSCustomObject]$Data,
        [string]$FileName
    )
    
    # ERV Terminations
    # CM Terminations
    # ... (see below for details)
}
```

### ERV Termination (Server-Side)

**Location:** Lines 853-937

```powershell
# ERV_Ter1: Q1-Q12, need ≥5 correct to continue
if ($Data.PSObject.Properties['ERV_Ter1'] -and 
    [string]::IsNullOrWhiteSpace($Data.ERV_Ter1)) {
    
    $totalQuestions = 12
    $threshold = 5
    $answered = 0
    $correct = 0
    
    for ($i = 1; $i -le $totalQuestions; $i++) {
        $fieldName = "ERV_Q${i}"
        if ($Data.PSObject.Properties[$fieldName] -and 
            -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
            $answered++
            $scoreField = "ERV_Q${i}_Sc"
            if ($Data.$scoreField -eq '1') { $correct++ }
        }
    }
    
    $unanswered = $totalQuestions - $answered
    $maxPossible = $correct + $unanswered
    
    # Only set termination if we're absolutely certain
    if ($correct -ge $threshold) {
        # Already passed threshold
        $Data.ERV_Ter1 = "0"
        $Data | Add-Member -NotePropertyName 'term_ERV_Ter1' -NotePropertyValue "0" -Force
    } elseif ($maxPossible -lt $threshold) {
        # Impossible to reach threshold
        $Data.ERV_Ter1 = "1"
        $Data | Add-Member -NotePropertyName 'term_ERV_Ter1' -NotePropertyValue "1" -Force
    }
    # Else: still possible to pass, don't set termination
}
```

**Output Fields:**
- `ERV_Ter1`, `ERV_Ter2`, `ERV_Ter3` (PDF fields, preserved if filled)
- `term_ERV_Ter1`, `term_ERV_Ter2`, `term_ERV_Ter3` (calculated fields)

**Output Values:**
- `"0"` = Passed (threshold met, continue)
- `"1"` = Failed (threshold not met, terminated)
- Empty = Uncertain (mathematically still possible to pass)

### CM Termination (Server-Side)

**Location:** Lines 942-1064

```powershell
# CM_Ter1: Q1-Q7, need ≥4 correct to continue
if ($Data.PSObject.Properties['CM_Ter1'] -and 
    [string]::IsNullOrWhiteSpace($Data.CM_Ter1)) {
    
    $totalQuestions = 7
    $threshold = 4
    $answered = 0
    $correct = 0
    
    for ($i = 1; $i -le $totalQuestions; $i++) {
        $fieldName = "CM_Q${i}_TEXT"
        if ($Data.PSObject.Properties[$fieldName] -and 
            -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
            $answered++
            if ($Data.$fieldName -eq '1') { $correct++ }
        }
    }
    
    $unanswered = $totalQuestions - $answered
    $maxPossible = $correct + $unanswered
    
    if ($correct -ge $threshold) {
        $Data.CM_Ter1 = "0"
        $Data | Add-Member -NotePropertyName 'term_CM_Ter1' -NotePropertyValue "0" -Force
    } elseif ($maxPossible -lt $threshold) {
        $Data.CM_Ter1 = "1"
        $Data | Add-Member -NotePropertyName 'term_CM_Ter1' -NotePropertyValue "1" -Force
    }
}

# CM_Ter2: Q8-Q12 (same logic)
# CM_Ter3: Q13-Q17 (same logic)
# CM_Ter4: Q18-Q22 (same logic)
```

**Output Fields:**
- `CM_Ter1`, `CM_Ter2`, `CM_Ter3`, `CM_Ter4`
- `term_CM_Ter1`, `term_CM_Ter2`, `term_CM_Ter3`, `term_CM_Ter4`

### Absolute Certainty Principle

**Critical Server-Side Rule:**

Termination values are set **ONLY when mathematically certain**:

```
✅ Set "0" (Passed) if: correct ≥ threshold (already passed)
✅ Set "1" (Failed) if: correct + unanswered < threshold (impossible to reach)
⚪ Don't set (Uncertain) if: Still mathematically possible to pass
```

**Example Cases (ERV_Ter1: need ≥5 correct out of 12):**

| Correct | Unanswered | maxPossible | Result |
|---------|------------|-------------|--------|
| 6 | 6 | 12 | `"0"` - Already passed |
| 3 | 1 | 4 | `"1"` - Max 4 < 5, impossible |
| 3 | 3 | 6 | Empty - Max 6 ≥ 5, still possible |
| 0 | 12 | 12 | Empty - Not started, could still pass |

**Important:** If PDF contains termination value (filled during survey), it is **preserved** and not recalculated.

---

## Page-Specific Implementation

### Student Page

**File:** `checking-system-student-page.js`

**Validation Method:** Direct call to `TaskValidator.validateAllTasks()`

**Location:** Lines 440-460 (approximate)

```javascript
async function fetchAndPopulateJotformData(coreId) {
  // ... fetch data from JotForm ...
  
  // Validate using TaskValidator
  const validation = await window.TaskValidator.validateAllTasks(mergedAnswers);
  
  // Render tasks
  await renderTasksWithValidation(validation, mergedAnswers);
}
```

**Features:**
- Per-question validation display
- Termination checklist cards
- Post-termination answer detection
- Timeout analysis for SYM/NONSYM
- Detailed statistics per task

### Class Page

**File:** `checking-system-class-page.js`

**Validation Method:** Via `JotFormCache.buildStudentValidationCache()`

```javascript
const validationCache = await window.JotFormCache.buildStudentValidationCache(
  students, 
  surveyStructure
);
```

**Features:**
- Aggregated task completion per student
- Set-level status overview
- Gender-conditional task handling
- Cached validation for performance

### School/District/Group Pages

**Files:** 
- `checking-system-school-page.js`
- `checking_system_1_district.html` (inline JS)
- `checking_system_1_group.html` (inline JS)

**Validation Method:** Same as Class page (via `JotFormCache`)

**Features:**
- Aggregated statistics across students/classes/schools
- Drill-down navigation
- Gender-conditional task counts
- Cached validation for performance

---

## Debugging Guide

### Common Issues and Solutions

#### Issue 1: Task Shows Incomplete Despite Full Answers

**Symptoms:**
- Task has all questions answered
- Completion shows < 100%
- Status circle is red

**Likely Cause:** Termination not being detected

**Debug Steps:**

1. Check console logs for termination detection:
```javascript
console.log(`[TaskValidator] ${taskId} terminated at Stage ${stageNum}`);
```

2. Verify termination index:
```javascript
console.log('Termination index:', validation.terminationIndex);
console.log('Adjusted total:', validation.totalQuestions);
```

3. Check question counts:
```javascript
console.log('Questions:', validation.questions.length);
console.log('Total (adjusted):', validation.totalQuestions);
```

**Location:** `task-validator.js` Lines 354, 414, 461

#### Issue 2: Post-Termination Answers Not Flagged

**Symptoms:**
- Task terminated properly
- Answers exist after termination
- No yellow warning shown

**Debug Steps:**

1. Check `hasPostTerminationAnswers` flag:
```javascript
console.log('Post-termination answers:', validation.hasPostTerminationAnswers);
```

2. Verify question states:
```javascript
validation.questions.forEach((q, i) => {
  if (i > validation.terminationIndex) {
    console.log(`Q${i}: ${q.id} = ${q.studentAnswer} (after termination)`);
  }
});
```

**Location:** `task-validator.js` Lines 512-519

#### Issue 3: SYM/NONSYM Timeout Not Detected

**Symptoms:**
- Task shows incomplete despite timeout
- Red status instead of green
- Missing "Timed Out" indicator

**Debug Steps:**

1. Check timeout analysis:
```javascript
console.log('[TaskValidator] SYM analysis:', symAnalysis);
console.log('[TaskValidator] NONSYM analysis:', nonsymAnalysis);
```

2. Verify consecutive gap detection:
```javascript
console.log('Last answered index:', analysis.lastAnsweredIndex);
console.log('Timed out:', analysis.timedOut);
console.log('Has missing data:', analysis.hasMissingData);
```

3. Check for answers after gap:
```javascript
for (let i = lastAnsweredIndex + 1; i < questions.length; i++) {
  if (questions[i].studentAnswer !== null) {
    console.log(`Answer found at Q${i} after gap: ${questions[i].studentAnswer}`);
  }
}
```

**Location:** `task-validator.js` Lines 570-631, 686

#### Issue 4: Gender-Conditional Tasks Miscounted

**Symptoms:**
- Set 2 shows wrong task count
- Female student has TEC_Male counted (or vice versa)
- Set completion percentage incorrect

**Debug Steps:**

1. Check gender normalization:
```javascript
console.log('Student gender:', student.gender);
console.log('Normalized:', studentGender); // Should be 'male' or 'female'
```

2. Verify applicable sections:
```javascript
console.log('Applicable sections:', applicableSections.length);
applicableSections.forEach(s => {
  console.log(`- ${s.file} (${s.showIf ? JSON.stringify(s.showIf) : 'no condition'})`);
});
```

**Location:** `jotform-cache.js` Lines 638-655 (approximate)

#### Issue 5: Status Circle Wrong Color

**Symptoms:**
- Task complete but shows red
- Terminated task shows yellow instead of green
- Grey shown for tasks with progress

**Debug Steps:**

1. Check task statistics:
```javascript
console.log('Task stats:', taskStats);
console.log('Answered %:', taskStats.answeredPercent);
console.log('Has terminated:', taskStats.hasTerminated);
console.log('Has post-term answers:', taskStats.hasPostTerminationAnswers);
```

2. Verify status logic execution:
```javascript
if (stats.hasPostTerminationAnswers) {
  console.log('→ YELLOW: Post-termination data detected');
} else if ((stats.hasTerminated || stats.timedOut) && stats.answered > 0) {
  console.log('→ GREEN: Properly terminated/timed out');
}
// ... etc
```

**Location:** `checking-system-student-page.js` Lines 1815-1847

### Console Log Markers

Key log markers to search for:

| Marker | Location | Purpose |
|--------|----------|---------|
| `[TaskValidator]` | `task-validator.js` | Core validation logic |
| `[StudentPage]` | `checking-system-student-page.js` | Student page operations |
| `[JotFormCache]` | `jotform-cache.js` | Caching layer operations |
| `[StudentData]` | `student-data-processor.js` (deprecated) | Legacy processor |

### Validation Flow Trace

To trace validation flow for a specific student:

1. **Open browser console** (F12)

2. **Filter logs:** Enter `TaskValidator` in console filter

3. **Look for key events:**
```
[TaskValidator] Task metadata loaded: 15 tasks
[TaskValidator] Loaded task definition: erv
[TaskValidator] ERV terminated at Stage 1 (ERV_Q12): 3 correct, need ≥5
[TaskValidator] SYM: timeout=true, missingData=false
```

4. **Check final validation object:**
```javascript
// In console:
console.log('Validation:', validation);
console.log('ERV:', validation.erv);
```

### Data Inspection

To inspect task validation data:

```javascript
// Get validation cache from IndexedDB
const db = await localforage.getItem('studentValidationCache');
console.log('Cached students:', db.validationsByStudent.size);

// Get specific student
const studentValidation = db.validationsByStudent.get('C10001');
console.log('Student tasks:', studentValidation);

// Get specific task
const ervValidation = studentValidation.erv;
console.log('ERV:', ervValidation);
console.log('Questions:', ervValidation.questions);
console.log('Termination:', ervValidation.terminated, ervValidation.terminationIndex);
```

---

## Quick Reference Tables

### Termination Rules Summary

| Task | Type | Threshold | Stages/Conditions |
|------|------|-----------|-------------------|
| ERV | Stage-based | ≥5 correct | 3 stages (Q1-Q12, Q13-Q24, Q25-Q36) |
| CM | Stage-based | ≥4 correct | 4 stages (Q1-Q7, Q8-Q12, Q13-Q17, Q18-Q22) |
| CWR | Consecutive incorrect | 10 consecutive | Resets on correct/skip |
| FM | Threshold-based | ≥1 correct | 3 questions (FM_squ_1/2/3) |
| SYM | Timeout | 2 minutes | Consecutive gap to end |
| NONSYM | Timeout | 2 minutes | Consecutive gap to end |

### Status Color Priority

1. 🟡 **Yellow** - Post-termination data (highest priority)
2. 🟢 **Green** - Complete/Properly terminated
3. 🔴 **Red** - Incomplete (has progress)
4. ⚪ **Grey** - Not started (lowest priority)

### Question State Colors

| State | Color | Icon | Condition |
|-------|-------|------|-----------|
| Correct | Green | ✓ | `isCorrect === true` |
| Incorrect | Red | ✗ | `isCorrect === false` |
| Unanswered | Grey | − | `studentAnswer === null` |
| Unscored | Light Blue | ○ | `isUnscored === true` |
| Ignored | Blue | ⊘ | `isIgnoredDueToTimeout === true` |

### File Locations Quick Reference

| Component | File | Lines |
|-----------|------|-------|
| Core Validator | `task-validator.js` | 1-708 |
| Termination Rules | `task-validator.js` | 281-310 |
| Timeout Detection | `task-validator.js` | 570-631 |
| Student Page | `checking-system-student-page.js` | Full file |
| Status Colors | `checking-system-student-page.js` | 1815-1847 |
| Question Rendering | `checking-system-student-page.js` | 750-850 |
| Server Processing | `processor_agent.ps1` | 840-1065 |
| Cache Manager | `jotform-cache.js` | Full file |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-17 | Initial creation - comprehensive documentation of all calculation rules |

---

**End of Calculation Bible**

For questions or clarifications, refer to the actual source code files listed in this document.
