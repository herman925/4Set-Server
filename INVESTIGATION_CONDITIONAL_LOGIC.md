# Investigation Report: Conditional Logic, Gender Branching, and Radio_Text Questions

**Date:** October 22, 2025  
**Issue:** Three additional validation concerns identified in PR comments  
**Status:** 🔍 INVESTIGATION COMPLETE

---

## Executive Summary

This report investigates three validation concerns raised after the initial status inconsistency fix:

1. **Conditional Logic (Question Branching)**: How `showIf` conditions affect question inclusion and scoring
2. **Gender Branching**: Whether gender-conditional tasks (TEC_Male/TEC_Female) are properly handled across all aggregate views
3. **Radio_Text Questions**: How questions with associated text fields (e.g., ToM_Q3a + ToM_Q3a_TEXT) are scored

---

## Issue 1: Conditional Logic Systems (Question Branching)

### Current Implementation

**Location:** `assets/js/task-validator.js` Lines 127-173

#### How It Works

The current implementation **does NOT evaluate `showIf` conditions**. All questions are extracted and validated regardless of conditional branching logic.

```javascript
function extractQuestions(taskDef) {
  const questions = [];
  
  for (const item of taskDef.questions) {
    if ((item.type === 'multi-question' || item.type === 'multi-step') && item.questions) {
      questions.push(...extractQuestionsFromArray(item.questions));
    } else if (item.type !== 'instruction' && item.type !== 'completion' && item.id && !isExcludedField(item.id)) {
      // Include ALL questions - no showIf filtering
      questions.push(item);
    }
  }
  
  return questions;
}
```

#### Example: Theory of Mind (ToM) Task

**From `assets/tasks/TheoryofMind.json`:**

```json
{
  "id": "ToM_Q1b",
  "type": "image-choice",
  "showIf": { "ToM_Q1a": "紅蘿蔔" },
  "scoring": { "correctAnswer": "曲奇餅" }
},
{
  "id": "ToM_Q1b",
  "type": "image-choice",
  "showIf": { "ToM_Q1a": "曲奇餅" },
  "scoring": { "correctAnswer": "紅蘿蔔" }
}
```

**Problem:**
- Both versions of `ToM_Q1b` are extracted (same ID, different conditions)
- System validates BOTH versions regardless of student's answer to `ToM_Q1a`
- This could lead to:
  1. Duplicate question IDs in validation results
  2. Incorrect total question counts
  3. Wrong completion percentages

### Impact Assessment

| Aspect | Current Behavior | Expected Behavior | Impact |
|--------|------------------|-------------------|--------|
| **Question Extraction** | Extracts ALL questions | Should filter by showIf | 🔴 High |
| **Duplicate IDs** | Allows duplicates (ToM_Q1b appears twice) | Should resolve to single applicable version | 🔴 High |
| **Total Count** | Overcounts questions | Should count only applicable questions | 🔴 High |
| **Completion %** | May show lower than actual | Should reflect actual applicable questions | 🟡 Medium |

### Required Fix

**Status:** 🔴 **CRITICAL BUG** - Conditional branching not implemented

The system needs to:
1. Evaluate `showIf` conditions based on student's actual answers
2. Filter questions to include only applicable branches
3. Handle duplicate IDs by selecting the correct conditional version
4. Recalculate totals based on applicable questions only

**Complexity:** High - requires answer-aware question extraction

---

## Issue 2: Gender Branching for Aggregate Views

### Current Implementation

**Location:** `assets/js/jotform-cache.js` Lines 656-718

#### How It Works

Gender-conditional task filtering IS properly implemented for validation cache building:

```javascript
function isTaskApplicableToStudent(taskId, student, surveyStructure) {
  for (const set of surveyStructure.sets) {
    const section = set.sections.find(s => {
      const fileName = s.file.replace('.json', '');
      const metadata = surveyStructure.taskMetadata[fileName];
      return metadata && metadata.id === taskId;
    });
    
    if (section) {
      if (!section.showIf) return true;
      
      if (section.showIf.gender) {
        // Normalize gender: M/F → male/female
        let studentGender = (student.gender || '').toLowerCase();
        if (studentGender === 'm' || studentGender === 'male') studentGender = 'male';
        if (studentGender === 'f' || studentGender === 'female') studentGender = 'female';
        
        const requiredGender = section.showIf.gender.toLowerCase();
        return studentGender === requiredGender;
      }
      
      return true;
    }
  }
  
  return true;
}
```

#### Gender Filtering Applied At

1. **Task Count Calculation** (Line 694-718):
   - Filters sections based on `showIf.gender` condition
   - Adjusts `tasksTotal` for each set based on student gender
   - Logs: `"Set set1, File TEC_Male.json: student.gender="M"→"male", required="male", match=true"`

2. **Task Completion Analysis** (Line 732-737):
   - Skips tasks not applicable to student gender
   - Logs: `"Skipping tec_male - not applicable for F student"`

### Verification Status

✅ **Gender branching IS properly implemented** for:
- Class page (via `JotFormCache.buildStudentValidationCache()`)
- School page (via `JotFormCache.buildStudentValidationCache()`)
- District page (via `JotFormCache.buildStudentValidationCache()`)
- Group page (via `JotFormCache.buildStudentValidationCache()`)

All aggregate views use the same validation cache builder, which correctly filters tasks by gender.

### Impact Assessment

| Aspect | Status | Evidence |
|--------|--------|----------|
| **Cache Builder** | ✅ Implemented | Lines 656-718 in jotform-cache.js |
| **Class Page** | ✅ Working | Uses validation cache with gender filtering |
| **School Page** | ✅ Working | Uses validation cache with gender filtering |
| **District Page** | ✅ Working | Uses validation cache with gender filtering |
| **Group Page** | ✅ Working | Uses validation cache with gender filtering |
| **Student Page** | ✅ Working | Uses same TaskValidator (gender-agnostic at task level) |

**Example Log Output:**
```
[JotFormCache] Set set4, File TEC_Male.json: student.gender="M"→"male", required="male", match=true
[JotFormCache] C12345 (M): Set set4 tasksTotal = 5
[JotFormCache] Set set4, File TEC_Female.json: student.gender="F"→"female", required="female", match=true
[JotFormCache] C67890 (F): Set set4 tasksTotal = 5
```

### Conclusion

✅ **NO FIX REQUIRED** - Gender branching is correctly implemented across all pages.

---

## Issue 3: Radio_Text Questions and Associated _TEXT Fields

### Current Implementation

**Location:** `assets/js/task-validator.js` Lines 181, 212-220

#### How It Works

1. **_TEXT Fields Are Excluded from Question Count** (Line 181):
   ```javascript
   function isExcludedField(id) {
     return id.endsWith('_Date') || 
            id.endsWith('_TEXT') ||  // ← Excludes ToM_Q3a_TEXT
            id.includes('_Memo_') ||
            id.includes('_Ter') || 
            id.endsWith('_timeout');
   }
   ```

2. **Radio_Text Questions Are Mapped to Option Values** (Line 212-220):
   ```javascript
   if (studentAnswer && (question.type === 'radio_text') && question.options) {
     const optionIndex = parseInt(studentAnswer);
     if (!isNaN(optionIndex) && optionIndex >= 1 && optionIndex <= question.options.length) {
       const mappedValue = question.options[optionIndex - 1].value;
       studentAnswer = mappedValue;
     }
   }
   ```

3. **Scoring Logic** (Line 224-226):
   ```javascript
   if (correctAnswer !== undefined) {
     isCorrect = studentAnswer !== null && 
                 String(studentAnswer).trim() === String(correctAnswer).trim();
   }
   ```

### Example: ToM_Q3a

**Task Definition:**
```json
{
  "id": "ToM_Q3a",
  "type": "radio_text",
  "options": [
    { "value": "狗仔", "label": "狗仔" },
    { "value": "其他", "label": "其他（記錄答案）", "textId": "ToM_Q3a_TEXT" }
  ],
  "scoring": { "correctAnswer": "狗仔" }
}
```

**User Request:**
> "if correct answer is picked, it will assume correct of course. Then either the other label or the text is filled, assume wrong. The first condition will precede the other 2. So if the correct answer is picked, and there is a text, it will assume the text is a mistyped input and will be ignored"

### Current Behavior Analysis

| Scenario | Student Answer | ToM_Q3a_TEXT | Current Result | User Request Result | Match? |
|----------|----------------|--------------|----------------|---------------------|--------|
| **1. Correct option selected** | "狗仔" (option 1) | "" (empty) | ✅ Correct | ✅ Correct | ✅ |
| **2. Correct option + text** | "狗仔" (option 1) | "貓" (typo) | ✅ Correct | ✅ Correct (text ignored) | ✅ |
| **3. Other option + no text** | "其他" (option 2) | "" (empty) | ❌ Incorrect | ❌ Incorrect | ✅ |
| **4. Other option + text** | "其他" (option 2) | "貓" (filled) | ❌ Incorrect | ❌ Incorrect | ✅ |

### Verification Status

✅ **CURRENT IMPLEMENTATION ALREADY MATCHES USER REQUEST**

The system:
1. ✅ Checks if `studentAnswer === correctAnswer` FIRST (line 226)
2. ✅ Ignores _TEXT fields completely (excluded from validation)
3. ✅ Maps radio_text options to their values (line 212-220)
4. ✅ If correct option selected → marked correct (regardless of text)
5. ✅ If other option selected → marked incorrect (regardless of text)

### Impact Assessment

| Aspect | Status | Evidence |
|--------|--------|----------|
| **Priority Logic** | ✅ Implemented | Correct answer check happens first |
| **Text Field Ignored** | ✅ Implemented | _TEXT excluded via `isExcludedField()` |
| **Correct + Text = Correct** | ✅ Working | Text has no effect on scoring |
| **Other + Text = Incorrect** | ✅ Working | Both map to "incorrect" |

### Conclusion

✅ **NO FIX REQUIRED** - Radio_text scoring already works as requested.

---

## Summary of Findings

| Issue | Status | Action Required |
|-------|--------|-----------------|
| **1. Conditional Logic (showIf)** | 🔴 **CRITICAL BUG** | ✅ Fix Required |
| **2. Gender Branching** | ✅ **WORKING CORRECTLY** | ❌ No Fix Needed |
| **3. Radio_Text Scoring** | ✅ **WORKING CORRECTLY** | ❌ No Fix Needed |

---

## Issue 1: Detailed Fix Plan for Conditional Logic

### Problem

The `extractQuestions()` function does not evaluate `showIf` conditions, leading to:
- Duplicate question IDs (e.g., two versions of `ToM_Q1b`)
- Incorrect total question counts
- Wrong completion percentages
- Potential scoring conflicts

### Solution Design

#### Approach 1: Answer-Aware Question Extraction ⭐ **RECOMMENDED**

Modify `validateTask()` to:
1. Extract ALL questions first (including conditionals)
2. Filter questions based on student's actual answers
3. Resolve duplicate IDs by selecting the applicable version

**Implementation:**

```javascript
async function validateTask(taskId, mergedAnswers) {
  const taskDef = await loadTaskDefinition(taskId);
  if (!taskDef) return { taskId, error: 'Task definition not found', questions: [] };

  const allQuestions = extractQuestions(taskDef);
  
  // Filter questions by evaluating showIf conditions
  const applicableQuestions = filterQuestionsByConditions(allQuestions, mergedAnswers);
  
  const validatedQuestions = [];
  for (const question of applicableQuestions) {
    // ... existing validation logic
  }
  
  return { taskId, questions: validatedQuestions, /* ... */ };
}

function filterQuestionsByConditions(questions, answers) {
  const applicable = [];
  const seenIds = new Set();
  
  for (const question of questions) {
    // Check if this question's showIf condition is satisfied
    if (question.showIf) {
      const conditionMet = evaluateShowIfCondition(question.showIf, answers);
      if (!conditionMet) continue; // Skip this question
    }
    
    // Handle duplicate IDs: keep first matching condition
    if (seenIds.has(question.id)) continue;
    
    applicable.push(question);
    seenIds.add(question.id);
  }
  
  return applicable;
}

function evaluateShowIfCondition(showIf, answers) {
  // Handle gender conditions (static, not answer-based)
  if (showIf.gender) {
    // This should be evaluated at task level, not question level
    return true; // Assume gender filtering already done at task selection
  }
  
  // Handle answer-based conditions (e.g., { "ToM_Q1a": "紅蘿蔔" })
  for (const [questionId, expectedValue] of Object.entries(showIf)) {
    if (questionId === 'gender') continue; // Skip gender (handled above)
    
    const studentAnswer = answers[questionId]?.answer || 
                          answers[questionId]?.text || 
                          null;
    
    // Map option index to value if needed
    // ... (similar to existing option mapping logic)
    
    if (studentAnswer !== expectedValue) {
      return false; // Condition not met
    }
  }
  
  return true; // All conditions met
}
```

#### Approach 2: Two-Pass Validation (Alternative)

1. **Pass 1:** Extract and validate all questions
2. **Pass 2:** Filter out questions whose conditions aren't met
3. Recalculate totals and percentages

**Pros/Cons:**

| Approach | Pros | Cons |
|----------|------|------|
| **Answer-Aware** | ✅ More accurate<br>✅ Handles dependencies<br>✅ Single pass | ⚠️ More complex<br>⚠️ Requires answer mapping |
| **Two-Pass** | ✅ Simpler logic<br>✅ Clear separation | ❌ Less efficient<br>❌ May miss dependencies |

### Testing Requirements

1. **Test Case 1: ToM Task with Branching**
   - Student answers "紅蘿蔔" to ToM_Q1a
   - System should:
     - Show `ToM_Q1b` with `correctAnswer: "曲奇餅"`
     - NOT show alternative `ToM_Q1b` with `correctAnswer: "紅蘿蔔"`
     - Total questions should reflect only applicable branch

2. **Test Case 2: ToM Task with Opposite Branch**
   - Student answers "曲奇餅" to ToM_Q1a
   - System should:
     - Show `ToM_Q1b` with `correctAnswer: "紅蘿蔔"`
     - NOT show alternative `ToM_Q1b` with `correctAnswer: "曲奇餅"`

3. **Test Case 3: Multiple Conditional Instructions**
   - Student answers trigger different instruction branches
   - System should:
     - Filter out non-applicable instructions
     - NOT count instructions in totals (already excluded)

### Impact of Fix

| Metric | Before Fix | After Fix |
|--------|------------|-----------|
| **Question Count** | Includes all branches | Only applicable branch |
| **Duplicate IDs** | Multiple versions possible | Single applicable version |
| **Completion %** | May be artificially low | Accurate to applicable questions |
| **Data Integrity** | ⚠️ Questionable | ✅ Reliable |

### Implementation Priority

🔴 **HIGH PRIORITY** - This affects:
- Question totals on all pages
- Completion percentages
- Task status calculations
- Data accuracy and trust

---

## Recommendations

### Immediate Actions

1. ✅ **Issue 2 (Gender Branching):** No action needed - verified working correctly
2. ✅ **Issue 3 (Radio_Text):** No action needed - verified working correctly
3. 🔴 **Issue 1 (Conditional Logic):** Implement fix for question branching

### Implementation Order

1. **Phase 1:** Implement `evaluateShowIfCondition()` helper function
2. **Phase 2:** Add `filterQuestionsByConditions()` to question extraction
3. **Phase 3:** Update `validateTask()` to use filtered questions
4. **Phase 4:** Test with Theory of Mind task
5. **Phase 5:** Verify all tasks with `showIf` conditions work correctly

### Testing Strategy

1. Create test data for ToM task with both branches
2. Verify correct question counts for each branch
3. Check completion percentages are accurate
4. Test on student page, then class/school/district/group pages
5. Clear validation cache and rebuild to see new logic

---

## Appendix: Tasks with Conditional Logic

### Tasks Using `showIf` Conditions

From survey analysis, the following tasks likely use conditional branching:

1. **Theory of Mind (TheoryofMind.json)** ✅ Confirmed
   - Multiple questions with answer-dependent branching
   - Example: `ToM_Q1b` has two versions based on `ToM_Q1a`

2. **TEC_Male / TEC_Female** ✅ Already handled
   - Gender-based task selection (not question-level branching)
   - Correctly filtered in validation cache

### Survey-Structure.json Reference

**Location:** `assets/tasks/survey-structure.json`

```json
{
  "sets": [
    {
      "id": "set4",
      "sections": [
        {
          "file": "TEC_Male",
          "showIf": { "gender": "male" }
        },
        {
          "file": "TEC_Female",
          "showIf": { "gender": "female" }
        }
      ]
    }
  ]
}
```

---

**End of Investigation Report**

*This investigation confirms that 2 out of 3 concerns are already properly handled. The remaining issue (conditional logic) requires implementation of answer-aware question filtering to ensure accurate question counts and completion percentages.*
