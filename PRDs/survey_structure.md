# Survey Structure Documentation

**Document Version:** 1.0  
**Last Updated:** October 22, 2025  
**Purpose:** Comprehensive documentation of all tasks, sets, questions, and practice items in the 4Set assessment system

---

## Table of Contents

1. [Overview](#overview)
2. [Set Organization](#set-organization)
3. [Task Details by Set](#task-details-by-set)
4. [Practice Questions Reference](#practice-questions-reference)
5. [Special Field Types](#special-field-types)
6. [Question Counting Rules](#question-counting-rules)

---

## Overview

The 4Set assessment system consists of **2 main sets** containing **15 unique tasks** with a total of **491 scorable questions** (excluding practice questions and text display fields).

### Assessment Statistics

| Metric | Count |
|--------|-------|
| Total Sets | 2 |
| Total Tasks | 15 |
| Scorable Questions | 491 |
| Practice Questions | 30 |
| Text Display Fields (_TEXT) | 21 |
| Instruction Steps | 91 |

---

## Set Organization

### Set 1 (第一組)

**Tasks:** 5  
**Total Questions:** 259 (excluding practice)

1. English Receptive Vocabulary (ERV) - 英語詞彙
2. Symbolic Reasoning (SYM) - 符號關係
3. Non-Symbolic Reasoning (NONSYM) - 非符號關係
4. Theory of Mind (ToM) - 心理理論
5. Chinese Word Reading (CWR) - 中文詞語閱讀

### Set 2 (第二組)

**Tasks:** 10  
**Total Questions:** 232 (excluding practice)

1. Test of Emotional Comprehension - Male (TEC_Male) - 情緒劇場（男）
2. Test of Emotional Comprehension - Female (TEC_Female) - 情緒劇場（女）
3. Math Pattern Recognition (MPT) - 數學模式
4. Chinese Character Modification (CM) - 改錯字遊戲
5. Matching Familiar Figures (MF) - 配對熟悉圖形
6. Expressive Phonology Naming (EPN) - 表達音韻命名
7. Chinese Character Composition (CCM) - 中文字組合
8. Fine Motor Skills (FM) - 精細動作技能
9. Gross Motor Development (TGMD) - 大肌肉動作發展
10. Head-Toes-Knees-Shoulders (HTKS) - 頭-腳趾-膝蓋-肩膀

---

## Task Details by Set

### SET 1: FIRST GROUP (第一組)

#### 1. English Receptive Vocabulary (ERV)
**File:** `ERV.json`  
**Task ID:** `erv`  
**Scorable Questions:** 53 (Q1–Q53)  
**Practice Questions:** 3 (P1, P2, P3)

**Practice Questions:**
- `ERV_P1` - Practice item 1
- `ERV_P2` - Practice item 2
- `ERV_P3` - Practice item 3

**Question Range:** ERV_Q1 through ERV_Q53

**Termination Rules:**
- **Stage 1:** ERV_Q1–ERV_Q12 (threshold: ≥5 correct to continue)
- **Stage 2:** ERV_Q13–ERV_Q24 (threshold: ≥5 correct to continue)
- **Stage 3:** ERV_Q25–ERV_Q36 (threshold: ≥5 correct to continue)
- **Stage 4:** ERV_Q37–ERV_Q53 (no termination, always complete all questions)

---

#### 2. Symbolic Reasoning (SYM)
**File:** `SYM.json`  
**Task ID:** `sym`  
**Scorable Questions:** 62 (Q1–Q62)  
**Practice Questions:** 9 (P1–P9)

**Practice Questions:**
- `SYM_P1` through `SYM_P9` - Practice items 1–9

**Question Range:** SYM_Q1 through SYM_Q62

**Timeout Rule:**
- 2-minute timer for symbolic section
- Questions after timeout are excluded from total count
- Proper timeout = continuous progress until time runs out
- Missing data = gaps in middle of assessment

---

#### 3. Non-Symbolic Reasoning (NONSYM)
**File:** `NONSYM.json`  
**Task ID:** `nonsym`  
**Scorable Questions:** 62 (Q1–Q62)  
**Practice Questions:** 9 (P1–P9)

**Practice Questions:**
- `NONSYM_P1` through `NONSYM_P9` - Practice items 1–9

**Question Range:** NONSYM_Q1 through NONSYM_Q62

**Timeout Rule:**
- 2-minute timer for non-symbolic section (separate from SYM)
- Questions after timeout are excluded from total count
- Proper timeout = continuous progress until time runs out
- Missing data = gaps in middle of assessment

---

#### 4. Theory of Mind (ToM)
**File:** `TheoryofMind.json`  
**Task ID:** `theoryofmind`  
**Scorable Questions:** 21  
**Practice Questions:** 3 (P1, P2, P3)  
**Text Display Fields:** 2 (_TEXT fields)

**Practice Questions:**
- `ToM_P1` - Practice item 1
- `ToM_P2` - Practice item 2
- `ToM_P3` - Practice item 3

**Scorable Questions:**
- `ToM_Q1a` - Initial preference question (branching trigger)
- `ToM_Q1b` - Follow-up based on Q1a response
- `ToM_Q2a` - Location preference (branching trigger)
- `ToM_Q2b` - Follow-up based on Q2a response
- `ToM_Q3a` - Animal preference (branching trigger)
- `ToM_Q3b` - Follow-up
- `ToM_Q4a` - Container preference (branching trigger)
- `ToM_Q4b` - Follow-up
- `ToM_Q5a` - Snack preference (branching trigger)
- `ToM_Q5b` - Follow-up
- `ToM_Q6a` - Cookie preference (branching trigger)
- `ToM_Q6b` - Follow-up
- `ToM_Q7a` - Control question 1
- `ToM_Q7b` - Control question 2
- Plus additional questions through Q21

**Text Display Fields:**
- `ToM_Q3a_TEXT` - Text field for "other" option in Q3a
- Additional _TEXT fields for capturing free-text responses

**Branching Logic:**
- Questions use `showIf` conditions based on previous answers
- Example: `ToM_Q1a_ins1` shown if `ToM_Q1a` = "紅蘿蔔"
- Example: `ToM_Q1a_ins2` shown if `ToM_Q1a` = "曲奇餅"
- Correct answer changes based on branch taken

**Display Format for _TEXT Fields:**
- Correct Answer column: Shows "—" (dash)
- Result column: Shows branch taken (e.g., "Answered (紅蘿蔔 Branch)")

---

#### 5. Chinese Word Reading (CWR)
**File:** `ChineseWordReading.json`  
**Task ID:** `chinesewordreading`  
**Scorable Questions:** 55 (Q1–Q55)  
**Practice Questions:** 0

**Question Range:** CWR_Q1 through CWR_Q55

**Termination Rule:**
- **Consecutive Incorrect:** 10 consecutive incorrect answers triggers termination
- Questions after termination are excluded from total count
- Calculation: Track consecutive incorrect streak
- Reset: Any correct answer resets the streak to 0

---

### SET 2: SECOND GROUP (第二組)

#### 6. Test of Emotional Comprehension - Male (TEC_Male)
**File:** `TEC_Male.json`  
**Task ID:** `tec_male`  
**Scorable Questions:** 20  
**Practice Questions:** 0

**Question Range:** TEC_Male_Q1 through TEC_Male_Q20

**Gender Conditional:** Only shown to male students (gender = "M" or "male")

**NOTE:** Gender branching (Male/Female) is NOT displayed in the Result column. This is a task selection condition, not an answer branch.

---

#### 7. Test of Emotional Comprehension - Female (TEC_Female)
**File:** `TEC_Female.json`  
**Task ID:** `tec_female`  
**Scorable Questions:** 20  
**Practice Questions:** 0

**Question Range:** TEC_Female_Q1 through TEC_Female_Q20

**Gender Conditional:** Only shown to female students (gender = "F" or "female")

**NOTE:** Gender branching (Male/Female) is NOT displayed in the Result column. This is a task selection condition, not an answer branch.

---

#### 8. Math Pattern Recognition (MPT)
**File:** `MathPattern.json`  
**Task ID:** `mathpattern`  
**Scorable Questions:** 24  
**Practice Questions:** 1 (P1)

**Practice Questions:**
- `MPT_3_m_P1` - Practice item 1

**Question Range:** Multiple patterns across different difficulty levels

---

#### 9. Chinese Character Modification (CM)
**File:** `CM.json`  
**Task ID:** `cm`  
**Scorable Questions:** 30  
**Practice Questions:** 2 (P1, P2)  
**Text Display Fields:** 18 (_TEXT fields)

**Practice Questions:**
- `CM_P1` - Practice item 1
- `CM_P2` - Practice item 2

**Scorable Questions:** CM_Q1 through CM_Q27 (plus associated fields)

**Termination Rules:**
- **Stage 1:** CM_Q1–CM_Q7 (threshold: ≥4 correct to continue)
- **Stage 2:** CM_Q8–CM_Q12 (threshold: ≥4 correct to continue)
- **Stage 3:** CM_Q13–CM_Q17 (threshold: ≥4 correct to continue)
- **Stage 4:** CM_Q18–CM_Q22 (threshold: ≥4 correct to continue)
- **Stage 5:** CM_Q23–CM_Q27 (no termination, always complete all questions)

---

#### 10. Matching Familiar Figures (MF)
**File:** `MF.json`  
**Task ID:** `mf`  
**Scorable Questions:** 48  
**Practice Questions:** 0

**Question Range:** MF questions across multiple items

---

#### 11. Expressive Phonology Naming (EPN)
**File:** `EPN.json`  
**Task ID:** `epn`  
**Scorable Questions:** 8  
**Practice Questions:** 0

**Question Range:** EPN_Q1 through EPN_Q8

---

#### 12. Chinese Character Composition (CCM)
**File:** `CCM.json`  
**Task ID:** `ccm`  
**Scorable Questions:** 8  
**Practice Questions:** 0

**Question Range:** CCM_Q1 through CCM_Q8

---

#### 13. Fine Motor Skills (FM)
**File:** `FineMotor.json`  
**Task ID:** `finemotor`  
**Scorable Questions:** 13  
**Practice Questions:** 0

**Question Range:** Multiple subtasks including square cutting, bead threading, etc.

**Termination Rule:**
- **Square Cutting:** If all 3 square-cutting items (FM_squ_1, FM_squ_2, FM_squ_3) have score = 0, terminate
- Questions after termination are excluded from total count

---

#### 14. Gross Motor Development (TGMD)
**File:** `TGMD.json`  
**Task ID:** `tgmd`  
**Scorable Questions:** 51  
**Practice Questions:** 0

**Question Range:** Matrix-based Y/N questions across multiple trials

**Question Type:** Y/N responses (no correct answer stored)
- Y = Correct execution
- N = Incorrect execution

---

#### 15. Head-Toes-Knees-Shoulders (HTKS)
**File:** `HeadToeKneeShoulder.json`  
**Task ID:** `headtoekneeshoulder` (alias: `htks`)  
**Scorable Questions:** 16  
**Practice Questions:** 3 (P1, P2, P3)  
**Text Display Fields:** 1 (_TEXT field)

**Practice Questions:**
- `HTKS_P1_Questions` - Practice trial 1
- `HTKS_P2_Questions` - Practice trial 2
- `HTKS_P3_Questions` - Practice trial 3

**Question Range:** HTKS_Q1 through HTKS_Q16

---

## Practice Questions Reference

### Complete List of Practice Questions

Practice questions are identified by the pattern `_P\d+` (underscore + P + digit) and are **EXCLUDED** from all calculations including:
- Completion percentage
- Answered question count
- Total question count
- Termination rule calculations

| Task | Practice Question IDs | Count |
|------|----------------------|-------|
| ERV | ERV_P1, ERV_P2, ERV_P3 | 3 |
| SYM | SYM_P1, SYM_P2, SYM_P3, SYM_P4, SYM_P5, SYM_P6, SYM_P7, SYM_P8, SYM_P9 | 9 |
| NONSYM | NONSYM_P1, NONSYM_P2, NONSYM_P3, NONSYM_P4, NONSYM_P5, NONSYM_P6, NONSYM_P7, NONSYM_P8, NONSYM_P9 | 9 |
| ToM | ToM_P1, ToM_P2, ToM_P3 | 3 |
| CM | CM_P1, CM_P2 | 2 |
| MPT | MPT_3_m_P1 | 1 |
| HTKS | HTKS_P1_Questions, HTKS_P2_Questions, HTKS_P3_Questions | 3 |
| **Total** | | **30** |

### Practice Question Detection

**Pattern:** `/_P\d+/` (regex)  
**Implementation:** `assets/js/task-validator.js` - `isExcludedField()` function

```javascript
function isExcludedField(id) {
  return id.endsWith('_Date') || 
         id.includes('_Memo_') ||
         id.includes('_Ter') ||
         id.endsWith('_timeout') ||
         /_P\d+/.test(id); // Practice questions excluded
}
```

---

## Special Field Types

### 1. Text Display Fields (_TEXT)

**Pattern:** `*_TEXT` (ends with _TEXT)  
**Purpose:** Capture free-text responses for "other" options in radio-text questions  
**Count:** 21 total across all tasks

**Tasks with _TEXT Fields:**
- **Theory of Mind:** 2 fields
  - `ToM_Q3a_TEXT` - Other option text for Q3a
  - Additional _TEXT fields for capturing responses
- **Chinese Character Modification:** 18 fields
  - `CM_Q*_TEXT` - Text fields for character modifications
- **Head-Toes-Knees-Shoulders:** 1 field
  - `HTKS_*_TEXT` - Text field for observations

**Display Rules:**
- **Correct Answer Column:** Shows "—" (dash), not "N/A"
- **Result Column:** Shows status based on associated radio question
  - "N/A" (muted gray) - When correct radio answer selected
  - "Answered (xxx Branch)" - When text filled (shows branch for ToM)
  - "Not answered" - When radio incorrect and text empty
- **Calculation:** EXCLUDED from completion percentage
- **Branching (ToM only):** Shows which answer branch was taken
  - Example: "Answered (紅蘿蔔 Branch)"
  - Example: "Answered (曲奇餅 Branch)"

---

### 2. Termination Fields (_Ter)

**Pattern:** `*_Ter*` (contains _Ter)  
**Purpose:** Record whether termination rules were triggered  
**Values:** 0 = Not triggered, 1 = Triggered

**Examples:**
- `ERV_Ter1` - Stage 1 termination (Q1-Q12)
- `ERV_Ter2` - Stage 2 termination (Q13-Q24)
- `ERV_Ter3` - Stage 3 termination (Q25-Q36)
- `CM_Ter1` through `CM_Ter4` - CM stage terminations
- `CWR_10Incorrect` - 10 consecutive incorrect termination
- `FM_Ter` - Fine motor square cutting termination

**Calculation:** EXCLUDED from question counts (metadata only)

---

### 3. Timeout Fields

**Pattern:** `*_timeout` (ends with _timeout)  
**Purpose:** Record 2-minute timer expiration  
**Tasks:** SYM, NONSYM

**Examples:**
- `SYM_timeout` - Symbolic reasoning timer expired
- `NONSYM_timeout` - Non-symbolic reasoning timer expired

**Calculation:** EXCLUDED from question counts (metadata only)

---

### 4. Date/Memo Fields

**Patterns:** 
- `*_Date` (ends with _Date)
- `*_Memo_*` (contains _Memo_)

**Purpose:** Metadata and administrative notes  
**Calculation:** EXCLUDED from all counts

---

## Question Counting Rules

### Inclusion Criteria

A question is **INCLUDED** in calculations if:
1. ✅ Has a valid question ID
2. ✅ Is not an instruction or completion marker
3. ✅ Is not a practice question (`_P\d+`)
4. ✅ Is not a termination record (`_Ter`)
5. ✅ Is not a timeout field (`_timeout`)
6. ✅ Is not a date/memo field
7. ✅ Is not after a termination/timeout point (if terminated)

### Special Cases

#### 1. Practice Questions (_P)
- **Display:** Shown in task tables
- **Total Count:** EXCLUDED
- **Answered Count:** EXCLUDED
- **Completion %:** EXCLUDED
- **Termination Rules:** EXCLUDED from threshold calculations

#### 2. Text Display Fields (_TEXT)
- **Display:** Shown in task tables
- **Total Count:** EXCLUDED
- **Answered Count:** EXCLUDED
- **Completion %:** EXCLUDED
- **Correct Answer Column:** Shows "—" (dash)
- **Result Column:** Shows status with branch info (ToM only)

#### 3. Post-Termination Questions
- **Display:** Shown with "Ignored (Terminated)" status
- **Total Count:** EXCLUDED (terminated questions don't count)
- **Answered Count:** EXCLUDED
- **Completion %:** EXCLUDED
- **Effect:** If terminated at Q24, total = 24 (not 55)

#### 4. Matrix Questions (TGMD)
- **Structure:** Row × Column format (e.g., `TGMD_111_Hop_t1`)
- **Type:** Y/N responses
- **Correct Answer:** Not defined (Y = correct, N = incorrect)
- **Total Count:** INCLUDED (each cell counted separately)

---

## Hierarchical Aggregation

### Student Level
- Calculate per-task completion using `TaskValidator.validateAllTasks()`
- Exclude practice questions and _TEXT fields
- Apply termination rules to adjust total counts

### Class Level
- Aggregate student-level results
- Calculate average completion across students
- Account for gender-conditional tasks (TEC_Male/TEC_Female)

### School Level
- Aggregate class-level results
- Show school-wide statistics
- Separate male/female TEC statistics if needed

### Group/District Level
- Further aggregation of school data
- Regional comparisons
- Overall completion metrics

---

## Implementation Notes

### Task Validator (`assets/js/task-validator.js`)

**Purpose:** Single source of truth for all validation logic

**Key Functions:**
- `isExcludedField(id)` - Determines if field should be excluded
- `validateTask(taskId, mergedAnswers)` - Validates single task
- `validateAllTasks(mergedAnswers)` - Validates all tasks for a student

**Practice Question Exclusion:**
```javascript
/_P\d+/.test(id) // Returns true for ERV_P1, ToM_P2, etc.
```

### Display Pages

**Files:**
- `checking_system_1_district.html` - District view
- `checking_system_1_group.html` - Group view
- `checking_system_2_school.html` - School view
- `checking_system_3_class.html` - Class view
- `checking_system_4_student.html` - Student view

**All pages use:** `window.TaskValidator` for consistent calculations

---

## Validation Checklist

When implementing or modifying task validation:

- [ ] Practice questions (_P\d+) excluded from counts
- [ ] Text display fields (_TEXT) excluded from completion %
- [ ] Termination fields (_Ter) excluded from questions
- [ ] Timeout fields (_timeout) excluded from questions
- [ ] Date/memo fields excluded from questions
- [ ] Post-termination questions excluded from totals
- [ ] Matrix questions expanded properly (row × column)
- [ ] Gender-conditional tasks handled (TEC_Male/TEC_Female)
- [ ] Branching logic working (ToM answer branches)
- [ ] Threshold rules applied correctly (ERV, CM, FM)
- [ ] Consecutive incorrect detection working (CWR)
- [ ] Timeout detection working (SYM, NONSYM)

---

## Document History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2025-10-22 | Initial comprehensive documentation | GitHub Copilot |

---

## References

- `assets/tasks/survey-structure.json` - Task metadata and set organization
- `assets/tasks/*.json` - Individual task definitions
- `assets/jotformquestions.json` - Question ID to JotForm QID mapping
- `assets/js/task-validator.js` - Validation logic implementation
- `PRDs/termination-rules.md` - Termination rule specifications
- `calculation_bible.md` - Calculation methodology reference

---

**END OF DOCUMENT**
