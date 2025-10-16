# Task Completion Calculation Logic - PRD

**Version:** 1.2  
**Created:** October 16, 2025  
**Last Updated:** October 16, 2025 (Added validation architecture)  
**Author:** System Architecture Team  
**Status:** ✅ Implemented

---

## Document Purpose

This PRD defines the mathematical logic for calculating task and set completion status in the 4Set Checking System. It is extracted from the main Checking System PRD to serve as a focused reference for calculation rules.

**Audience:** Developers, QA Engineers, Curriculum Team  
**Scope:** Task validation, set status determination, completion percentage calculation

---

## Core Principles

### 1. **Termination Exclusion Rule** (CRITICAL)

**When termination or timeout occurs, questions AFTER that point are COMPLETELY EXCLUDED from ALL calculations.**

This is the **single most important rule** in the system. It ensures students who properly terminate are marked as complete.

**Mathematical Formula:**
```
adjusted_total = terminationIndex + 1
adjusted_answered = count(answered_questions[0..terminationIndex])
completion_percentage = (adjusted_answered / adjusted_total) × 100
is_complete = (adjusted_answered === adjusted_total) AND (adjusted_total > 0)
```

**Why This Matters:**

| Scenario | Without Exclusion | With Exclusion |
|----------|-------------------|----------------|
| CWR terminated at Q24 | 24/60 = 40% incomplete ❌ | 24/24 = 100% complete ✅ |
| CM terminated at Q7 | 9/29 = 31% incomplete ❌ | 9/9 = 100% complete ✅ |
| SYM timed out at Q53 | 53/68 = 78% incomplete ❌ | 53/53 = 100% complete ✅ |

---

## Task-Level Calculations

### Task Completion Status

A task is considered **COMPLETE** if and only if:

```javascript
isComplete = (answeredQuestions === totalQuestions) && (totalQuestions > 0)
```

**Where:**
- `answeredQuestions` = Count of questions with non-null student answers (up to termination)
- `totalQuestions` = Total questions the student was expected to answer (up to termination)

**Important:** Practice items (P1, P2, etc.) ARE counted in both totals.

---

### Task Statistics Calculation

For each task, the following metrics are calculated:

```javascript
{
  totalQuestions: adjustedTotal,              // Questions up to termination/timeout
  answeredQuestions: adjustedAnswered,        // Non-null answers up to termination
  correctAnswers: countCorrect,               // Correct answers (all answered questions)
  completionPercentage: Math.round((adjustedAnswered / adjustedTotal) × 100),
  accuracyPercentage: Math.round((countCorrect / adjustedAnswered) × 100)
}
```

**Example (C10198's CM):**
```javascript
// Student answered: P1, P2, Q1-Q7 (9 questions total)
// Correct answers: P1, P2, Q2, Q3, Q5 (5 correct)
// Terminated at: Q7 (stage 1 failure: 3/7 correct, needed ≥4)

totalQuestions: 9           // P1, P2, Q1-Q7 (up to termination)
answeredQuestions: 9        // All 9 answered
correctAnswers: 5           // P1, P2, Q2, Q3, Q5
completionPercentage: 100%  // 9/9
accuracyPercentage: 56%     // 5/9
isComplete: true ✅         // Answered all questions up to termination
```

---

## Set-Level Calculations

### Set Status Determination

Each set (Set 1-4) has a status based on task completion within that set:

```javascript
setStatus = {
  tasksComplete: countCompleteTasks,
  tasksTotal: countApplicableTasks,  // Accounts for gender-conditional tasks
  status: calculateStatus()
}

function calculateStatus() {
  const rate = tasksComplete / tasksTotal;
  if (rate === 1) return 'complete';
  if (rate > 0) return 'incomplete';
  return 'notstarted';
}
```

**Status Values:**
- **`complete`**: All applicable tasks in the set are complete
- **`incomplete`**: Some but not all tasks are complete
- **notstarted`**: No tasks have been completed

---

### Gender-Conditional Task Handling

**Critical:** Set 2 contains gender-specific tasks (TEC_Male vs TEC_Female).

**Gender Code Normalization:**
Student data may use single-letter codes (`"M"`, `"F"`) OR full words (`"Male"`, `"Female"`), while survey-structure.json uses full words (`"male"`, `"female"`). Must normalize before comparison.

**Counting Logic:**
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

**Example (Female Student - Set 2):**
```
✅ TEC_Female  (showIf: gender=female) → INCLUDED
❌ TEC_Male    (showIf: gender=male) → EXCLUDED
✅ MathPattern (no condition) → INCLUDED
✅ CCM         (no condition) → INCLUDED

tasksTotal = 3 (not 4)
```

**Impact:**
- **Before fix:** 1/4 complete → incomplete (even if all applicable tasks done)
- **After fix:** 1/3 complete → incomplete (correct count)

---

## Termination-Specific Calculation Rules

### Stage-Based Termination (ERV, CM)

```javascript
// For each stage:
stageQuestions = questions.slice(startIdx, endIdx + 1);
correctCount = stageQuestions.filter(q => q.isCorrect).length;
answeredCount = stageQuestions.filter(q => q.studentAnswer !== null).length;
unansweredCount = stageQuestions.length - answeredCount;
maxPossible = correctCount + unansweredCount;

// Terminate if impossible to reach threshold
if (maxPossible < threshold) {
  terminationIndex = endIdx;
  // Recalculate totals
  adjustedTotal = terminationIndex + 1;
}
```

**Example (CM Stage 1: Q1-Q7, need ≥4 correct):**
- 3 correct, 4 unanswered → max = 7 ≥ 4 → Continue (still possible)
- 3 correct, 0 unanswered → max = 3 < 4 → Terminate ✅

---

### Consecutive Incorrect Termination (CWR)

```javascript
consecutiveIncorrect = 0;

for (question of questions) {
  if (question.studentAnswer === null) {
    consecutiveIncorrect = 0;  // Reset on skip
  } else if (question.isCorrect) {
    consecutiveIncorrect = 0;  // Reset on correct
  } else {
    consecutiveIncorrect++;
    
    if (consecutiveIncorrect >= 10) {
      terminationIndex = currentIndex;
      adjustedTotal = terminationIndex + 1;
      break;
    }
  }
}
```

**Key Point:** Streak breaks on correct answer OR unanswered question.

---

### Threshold-Based Termination (Fine Motor)

```javascript
targetQuestions = questions.filter(q => ['FM_squ_1', 'FM_squ_2', 'FM_squ_3'].includes(q.id));
correctCount = targetQuestions.filter(q => q.isCorrect).length;

if (correctCount < 1) {  // All scored 0
  lastQuestion = targetQuestions[targetQuestions.length - 1];
  terminationIndex = questions.findIndex(q => q.id === lastQuestion.id);
  adjustedTotal = terminationIndex + 1;
}
```

---

### Timeout-Based Termination (SYM/NONSYM)

**KEY PRINCIPLE:** Timeout occurs when there is a **consecutive sequence of unanswered questions extending to the last question**, regardless of gaps in the middle.

**Timeout Detection Algorithm:**
```javascript
// Step 1: Find last answered question
lastAnsweredIndex = findLastIndex(questions, q => q.studentAnswer !== null);

if (lastAnsweredIndex === -1) {
  return { timedOut: false, hasMissingData: false, complete: false };  // Not started
}

if (lastAnsweredIndex === questions.length - 1) {
  return { timedOut: false, hasMissingData: false, complete: true };  // Complete
}

// Step 2: Check if ALL questions after lastAnswered are blank (consecutive gap to end)
hasConsecutiveGapToEnd = false;
for (i = lastAnsweredIndex + 1; i < questions.length; i++) {
  if (questions[i].studentAnswer !== null) {
    hasConsecutiveGapToEnd = false;  // Found answer after gap → not timeout
    break;
  }
  hasConsecutiveGapToEnd = true;
}

// Step 3: If consecutive gap to end → TIMED OUT
if (hasConsecutiveGapToEnd) {
  // Check for gaps in the middle (before lastAnswered)
  hasGapsInMiddle = false;
  for (i = 0; i < lastAnsweredIndex; i++) {
    if (questions[i].studentAnswer === null) {
      hasGapsInMiddle = true;
      break;
    }
  }
  
  return {
    timedOut: true,
    hasMissingData: hasGapsInMiddle,  // Flag if gaps exist in middle
    complete: false,
    lastAnsweredIndex
  };
}

// Step 4: No consecutive gap to end → just missing data
for (i = 0; i < lastAnsweredIndex; i++) {
  if (questions[i].studentAnswer === null) {
    return { timedOut: false, hasMissingData: true, complete: false };
  }
}
```

**Calculation for Timeout:**
```javascript
// Timeout treated identically to termination
if (timedOut) {
  adjustedTotal = lastAnsweredIndex + 1;
  adjustedAnswered = questions.slice(0, adjustedTotal).filter(q => q.studentAnswer !== null).length;
  completionPercentage = Math.round((adjustedAnswered / adjustedTotal) × 100);
}
```

**Example 1 (SYM timed out at Q41 - Clean):**
```
Questions 1-41: All answered
Questions 42-56: All empty (consecutive to end)

Result:
- timedOut = true
- hasMissingData = false
- adjustedTotal = 41
- adjustedAnswered = 41
- Completion = 41/41 = 100% ✅
```

**Example 2 (NONSYM timed out at Q35 with middle gap - C10207):**
```
Questions 1-18: Answered
Question 19: Blank (gap in middle)
Questions 20-34: Answered
Questions 35-56: All blank (consecutive to end)

Algorithm execution:
1. lastAnsweredIndex = 34 (Q34)
2. Q35-Q56 all blank? YES → hasConsecutiveGapToEnd = true
3. Check before Q34: Q19 is blank → hasGapsInMiddle = true

Result:
- timedOut = true ✅
- hasMissingData = true ⚠️ (Q19 gap)
- adjustedTotal = 34
- adjustedAnswered = 33 (Q19 blank)
- Completion = 33/34 = 97% ✅
- Task Status = Complete (timed out properly)
- Display: "Timed Out" + "Non-continuous data gaps detected"
```

**Why Q19 doesn't prevent timeout:**
The 2-minute timer ran out between Q34 and Q35. Q19 being blank is just a data gap where the student skipped or the answer didn't load—it doesn't mean the timer expired. The timeout is determined by Q35-Q56 being **consecutively blank to the end**.

---

## Post-Termination Data Detection

**Purpose:** Identify data quality issues where answers exist after termination point.

```javascript
hasPostTerminationAnswers = false;

if (terminationIndex >= 0) {
  for (i = terminationIndex + 1; i < questions.length; i++) {
    if (questions[i].studentAnswer !== null) {
      hasPostTerminationAnswers = true;
      break;
    }
  }
}
```

**Status Impact:**
- If `hasPostTerminationAnswers === true` → ⚠️ Yellow status (data quality warning)
- These answers do NOT affect completion calculation (still excluded from total)

---

## Overall Completion Status

Student's overall status is determined by set completion:

```javascript
completeSets = countSets(status === 'complete');

if (completeSets === 4) {
  overallStatus = 'complete';
} else if (completeSets > 0 || completeTasks > 0) {
  overallStatus = 'incomplete';
} else {
  overallStatus = 'notstarted';
}
```

---

## Special Cases

### Merged Tasks (SYM/NONSYM)

SYM and NONSYM are validated separately but displayed as one task:

```javascript
mergedTask = {
  totalQuestions: adjustedSymTotal + adjustedNonsymTotal,
  answeredQuestions: adjustedSymAnswered + adjustedNonsymAnswered,
  correctAnswers: symCorrect + nonsymCorrect,
  timedOut: symTimedOut || nonsymTimedOut
}
```

**Important:** Each has independent 2-minute timer and independent timeout detection.

---

### Unanswered Questions Display

Questions that were **not answered** but were **within the allowed range**:

```javascript
if (questionIndex <= terminationIndex || !terminated) {
  if (studentAnswer === null) {
    result = '⚪ Unanswered';
  }
} else {
  result = '🔵 Ignored (Terminated)';
}
```

**Visual Markers:**
- `⚪ Unanswered` - Question should have been answered but wasn't
- `🔵 Ignored (Terminated)` - Question after termination (strikethrough ID)
- `🔵 Ignored (Timed Out)` - Question after timeout (strikethrough ID)

---

## Implementation Reference

**Primary Implementation:** `assets/js/task-validator.js`
- `TERMINATION_RULES` configuration (lines 265-310)
- `applyTerminationRules()` function (lines 468-526)
- `validateAllTasks()` function (lines 532-688)

**Set Calculation:** `assets/js/jotform-cache.js`
- Gender-conditional filtering (lines 638-655)
- Set status determination (lines 683-696)

**Export:** `assets/js/checking-system-student-page.js`
- Markdown report generation (lines 2357-2507)

---

## Validation Architecture

### Implementation by Page

| Page | File | Method |
|------|------|--------|
| Student | `checking-system-student-page.js` | `TaskValidator.validateAllTasks()` |
| Class | `checking-system-class-page.js` | `JotFormCache.buildStudentValidationCache()` |
| School | `checking-system-school-page.js` | `JotFormCache.buildStudentValidationCache()` |
| District | `checking_system_1_district.html` | `JotFormCache.buildStudentValidationCache()` |
| Group | `checking_system_1_group.html` | `JotFormCache.buildStudentValidationCache()` |

**Note:** `JotFormCache.buildStudentValidationCache()` internally calls `TaskValidator.validateAllTasks()` for each student.

### Required Scripts

Pages using validation cache need:
- `localforage` (IndexedDB)
- `task-validator.js`
- `jotform-cache.js`
- `assets/tasks/survey-structure.json`

---

## Calculation Examples

### Example 1: Complete with Termination

**Student:** C10198  
**Task:** CM (Chinese Morphology)  
**Answers:** P1 ✅, P2 ✅, Q1 ❌, Q2 ✅, Q3 ✅, Q4 ❌, Q5 ✅, Q6 ❌, Q7 ❌  
**Stage 1 Result:** 3/7 correct (needed ≥4) → Terminated at Q7

**Calculation:**
```
totalQuestions = 9 (P1, P2, Q1-Q7)
answeredQuestions = 9 (all answered)
correctAnswers = 5 (P1, P2, Q2, Q3, Q5)
completionPercentage = 9/9 = 100%
accuracyPercentage = 5/9 = 56%
isComplete = true ✅
```

---

### Example 2: Timeout (Proper)

**Student:** C10198  
**Task:** SYM (Symbolic)  
**Answers:** Q1-Q41 all answered, Q42-Q56 all empty  
**Result:** Timed out after continuous progress

**Calculation:**
```
lastAnsweredIndex = 40 (Q41 is at index 40)
adjustedTotal = 41
adjustedAnswered = 41
completionPercentage = 41/41 = 100%
timedOut = true
isComplete = true ✅
```

---

### Example 3: Consecutive Incorrect

**Student:** C10198  
**Task:** CWR (Chinese Word Reading)  
**Answers:** Q1-Q14 mixed, Q15-Q24 all incorrect (10 consecutive)  
**Result:** Terminated at Q24

**Calculation:**
```
totalQuestions = 24
answeredQuestions = 24
correctAnswers = 4
completionPercentage = 24/24 = 100%
accuracyPercentage = 4/24 = 17%
isComplete = true ✅
```

---

## Related Documentation

- [Termination Rules](termination-rules.md) - Detailed termination rules for each task
- [Checking System PRD](checking_system_prd.md) - Overall system specification
- **Implementation:** See `assets/js/task-validator.js` for source code

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-10-16 | Initial extraction from checking_system_prd.md | System Team |
| 1.1 | 2025-10-16 | **Critical Update:** Timeout detection logic - consecutive-gap-to-end principle. Added C10207 example showing timeout with middle gaps. | System Team |
| 1.2 | 2025-10-16 | Added validation architecture section documenting page implementations. | System Team |
