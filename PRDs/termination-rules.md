# Task Termination Rules

**Version:** 2.2  
**Last Updated:** October 16, 2025 (Validation architecture consistency)  
**Maintainer:** Curriculum Team

---

## Overview

This document defines all task termination rules used across the 4Set assessment system. Termination rules determine when a task should end early based on student performance, preventing unnecessary testing burden while ensuring valid assessment data.

**Key Principle:** When termination occurs, all questions **after** the termination point are **completely excluded** from completion calculations. See [task_completion_calculation_logic_prd.md](task_completion_calculation_logic_prd.md) for detailed calculation rules.

---

## Implementation Status

### Web Checking System (`task-validator.js`) ✅ **Implemented**
- **Location:** `assets/js/task-validator.js`
- **Architecture:** Centralized `TERMINATION_RULES` configuration object
- **Approach:** ID-based termination (robust against practice items)
- **Calculation:** Excludes post-termination questions from totals
- **Types Supported:**
  - Stage-based (ERV, CM)
  - Consecutive incorrect (CWR)
  - Threshold-based (Fine Motor)
  - Timeout-based (SYM/NONSYM)
- **Used By All Pages:**
  - Student: Direct call to `TaskValidator.validateAllTasks()`
  - Class/School/District/Group: Via `JotFormCache.buildStudentValidationCache()`

### Server Pipeline (TestWatchFolder) ✅ **Implemented**
- **Location:** `processor_agent.ps1`
- **Function:** `Add-TerminationOutcomes`
- **Output Fields:** `term_ERV_Ter1`, `term_CM_Ter1`, etc.
- **Output Values:**
  - `"1"` = Terminated (threshold not met)
  - `"0"` = Continued (threshold met)
  - Empty = Uncertain (mathematically still possible to pass)
- **Input Scoring:** `"1"` = correct, `"0"` = incorrect
- **Logic:** Absolute Certainty Principle (see below)

### Desktop GUI
- Refer to web GUI logic for current implementation

---

## Absolute Certainty Principle (Server Pipeline)

The server pipeline uses conservative calculation to avoid false positives:

**Termination values are set ONLY when mathematically certain:**

1. ✅ Set `"0"` (Passed) if: `correct ≥ threshold`
2. ✅ Set `"1"` (Failed) if: `correct + unanswered < threshold` (impossible to reach threshold)
3. ⚪ **Don't set** (Uncertain) if: Still mathematically possible to pass

**Example (ERV_Ter1: need ≥5 correct out of 12):**
- 6 correct, 6 unanswered → `"0"` (already passed)
- 3 correct, 1 unanswered → `"1"` (max=4 < 5, impossible)
- 3 correct, 3 unanswered → Empty (max=6 ≥ 5, still possible)
- 0 correct, 12 unanswered → Empty (not started, could still pass)

**Important:** If PDF contains termination value (filled during survey), it is preserved.

---

## Task-Specific Termination Rules

### 1. ERV (English Reading Vocabulary) - Stage-Based

**Type:** Stage-based termination  
**Practice Items:** ERV_P1, ERV_P2, ERV_P3 (excluded from termination checks)

| Stage | Termination ID | Question Range | Threshold | Triggered When |
|-------|----------------|----------------|-----------|----------------|
| 1 | `ERV_Ter1` | `ERV_Q1`–`ERV_Q12` | ≥5 correct | < 5 correct in Q1–Q12 |
| 2 | `ERV_Ter2` | `ERV_Q13`–`ERV_Q24` | ≥5 correct | < 5 correct in Q13–Q24 |
| 3 | `ERV_Ter3` | `ERV_Q25`–`ERV_Q36` | ≥5 correct | < 5 correct in Q25–Q36 |

**Termination Logic:**
- Student must achieve ≥5 correct answers in each stage to proceed to the next stage
- If threshold not met, task terminates at the end of that stage
- Questions after termination point are excluded from total count

**Example:**
- Student answers Q1-Q12, gets 3 correct → Terminates at Q12
- Total questions = 15 (P1, P2, P3, Q1-Q12)
- Completion = 15/15 = 100% 

---

### 2. CM (Chinese Morphology) - Stage-Based

**Type:** Stage-based termination  
**Practice Items:** CM_P1, CM_P2 (excluded from termination checks)

| Stage | Termination ID | Question Range | Threshold | Triggered When |
|-------|----------------|----------------|-----------|----------------|
| 1 | `CM_Ter1` | `CM_Q1`–`CM_Q7` | ≥4 correct | < 4 correct in Q1–Q7 |
| 2 | `CM_Ter2` | `CM_Q8`–`CM_Q12` | ≥4 correct | < 4 correct in Q8–Q12 |
| 3 | `CM_Ter3` | `CM_Q13`–`CM_Q17` | ≥4 correct | < 4 correct in Q13–Q17 |
| 4 | `CM_Ter4` | `CM_Q18`–`CM_Q22` | ≥4 correct | < 4 correct in Q18–Q22 |
| 5 | `CM_S5` | `CM_Q23`–`CM_Q27` | N/A | **No termination** (scoring only) |

**Termination Logic:**
- Student must achieve ≥4 correct answers in stages 1-4 to proceed
- Stage 5 (Q23-Q27) has no termination rule - students completing stage 4 should answer all stage 5 questions
- If terminated, questions after termination point are excluded

**Example:**
- Student answers P1, P2, Q1-Q7, gets 3 correct in Q1-Q7 → Terminates at Q7
- Total questions = 9 (P1, P2, Q1-Q7)
- Completion = 9/9 = 100% 

**Important:** Practice items (CM_P1, CM_P2) are at indices 0-1 in the questions array, but Q1 starts at index 2.

---

### 3. CWR (Chinese Word Reading) - Consecutive Incorrect

**Type:** Consecutive incorrect termination  
**Termination ID:** `CWR_10Incorrect`  
**Question Range:** CWR_Q1 onwards (currently up to CWR_Q60)  
**Threshold:** 10 consecutive incorrect responses

**Termination Logic:**
- Counter increments for each consecutive incorrect answer
- Counter resets to 0 when student answers correctly or skips a question
- Terminates immediately upon reaching 10 consecutive incorrect

**Example:**
- Student answers Q1-Q24, with Q15-Q24 all incorrect (10 consecutive) → Terminates at Q24
- Total questions = 24
- Completion = 24/24 = 100% 

---

### 4. Fine Motor (FM) - Threshold-Based

**Type:** Threshold-based termination  
**Termination ID:** `FM_Ter`  
**Target Questions:** FM_squ_1, FM_squ_2, FM_squ_3 (square-cutting items)  
**Threshold:** At least 1 must score > 0

**Termination Logic:**
- Check if all three square-cutting items are scored 0 (all incorrect)
- If all score 0, terminates and skips tree-cutting items (FM_tree_*)
- If at least one scores > 0, student proceeds to tree-cutting items

**Example:**
- Student scores 0, 0, 0 on square-cutting → Terminates
- Total questions = 7 (FM_Hand + 3 FM_side + 3 FM_squ)
- Tree-cutting items excluded from total

---

### 5. SYM/NONSYM (Symbolic Relations) - Timeout-Based

**Type:** Timeout-based termination  
**Timer:** 120 seconds (2 minutes) per task  
**Tasks:** SYM.json (Symbolic) and NONSYM.json (Non-symbolic) - independent timers

**Timeout Detection Logic:**

The system distinguishes between **proper timeout** and **missing data** using the **Consecutive Gap to End** principle:

**KEY RULE:** A timeout occurs when there is a **consecutive sequence of unanswered questions extending to the last question**, regardless of gaps in the middle.

| Pattern | Classification | Example | Explanation |
|---------|---------------|---------|-------------|
| **Consecutive gap to end** | ✅ **Timed Out** | Q1-Q34 answered, Q35-Q56 ALL blank | Consecutive blanks Q35-Q56 → Timed out at Q35 |
| **Consecutive gap + middle gaps** | ✅ **Timed Out + Missing Data** | Q1-Q18 answered, Q19 blank, Q20-Q34 answered, Q35-Q56 ALL blank | Still timed out at Q35; Q19 gap flagged separately |
| **Answers after gap** | ❌ Missing Data (not timeout) | Q1-Q10 answered, Q11-Q20 blank, Q21 answered | Q21 has answer → not timed out, just incomplete |
| **All questions answered** | ✅ Complete | Q1-Q56 all answered | No timeout |
| **Not started** | ⚪ Not Started | All blank | No timeout |

**Detailed Algorithm:**

```
1. Find lastAnsweredIndex (last question with an answer)
2. Check if lastAnsweredIndex == last question:
   → YES: Complete (no timeout)
   → NO: Continue to step 3
3. Check if ALL questions after lastAnsweredIndex are blank:
   → YES: TIMED OUT at (lastAnsweredIndex + 1)
        - Also check for gaps BEFORE lastAnsweredIndex
        - If gaps exist: Set hasMissingData = true
   → NO: Missing Data (not timed out)
```

**Real-World Example (Student C10207 - NONSYM):**

| Question Range | Status | Result |
|----------------|--------|--------|
| Q1-Q18 | ✅ Answered | Continue... |
| **Q19** | ❌ **Blank (gap in middle)** | Flag for missing data |
| Q20-Q34 | ✅ Answered | lastAnsweredIndex = 34 |
| **Q35-Q56** | ❌ **ALL BLANK (consecutive to end)** | **TIMED OUT at Q35** |

**Outcome:**
- Status: ✅ **"Terminated: Timed Out"** (green checkmark)
- Warning: ⚠️ **"Non-continuous data gaps detected"** (Q19)
- Total questions: 34 (up to last answered)
- Completion: 34/34 = 100% ✅
- Questions Q35-Q56: Marked as 🔵 **"Ignored (Timed Out)"**

**Why Q19 doesn't prevent timeout:**
- The 2-minute timer ran out at Q35 (after Q34 was answered)
- Q19 being blank is just a gap where the student skipped or didn't load
- The timeout is determined by Q35-Q56 being **consecutively blank to the end**

**Calculation:**
- Proper timeout: Questions up to `lastAnsweredIndex` are counted in total
- Example: Last answered = Q34 → Total = 34, Answered = 33 (Q19 blank) → 97%
- Questions after timeout (Q35-Q56) are **completely excluded** from calculations
- Task completion status: ✅ **Complete** (treated same as termination)

**Status Indicators:**
- Green checkmark: Properly timed out OR missing data detected (requires investigation)
- Task counts as **complete** for set completion purposes

**Note:** Timeout is treated identically to termination for completion calculation purposes. Both properly exclude post-termination/timeout questions from totals.

---

## Summary Table

| Task | Type | Termination Condition | Practice Items | Max Questions |
|------|------|----------------------|----------------|---------------|
| ERV | Stage-based | < 5 correct per stage | P1, P2, P3 | 51 (3 practice + 48 questions) |
| CM | Stage-based | < 4 correct per stage (stages 1-4) | P1, P2 | 29 (2 practice + 27 questions) |
| CWR | Consecutive incorrect | 10 consecutive wrong | None | 60 questions |
| FM | Threshold-based | All square items = 0 | None | Variable (7-10 items) |
| SYM | Timeout | 2-minute timer | S1-S3, P1-P9 | 68 (12 practice + 56 questions) |
| NONSYM | Timeout | 2-minute timer | S1-S3, P1-P9 | 68 (12 practice + 56 questions) |

---

## Export Fields

Termination outcomes are exported as:
- **Server Pipeline:** `term_<TerminationID>` fields (values: "0", "1", or empty)
- **Web System:** Embedded in validation cache with metadata (terminationIndex, terminationStage, terminationType)

---

## Related Documentation

- [Task Completion Calculation Logic](task_completion_calculation_logic_prd.md) - Detailed calculation rules
- [Checking System PRD](checking_system_prd.md) - Overall system specification
- **Implementation:** `assets/js/task-validator.js` (TERMINATION_RULES configuration)
