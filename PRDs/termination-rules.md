# Task Termination Rules

**Version:** 2.3  
**Last Updated:** November 6, 2025 (Fixed unreached stage mismatch bug)  
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

## Critical Bug Fix: Unreached Stage Mismatch (November 6, 2025)

**Problem:** Stage-based tasks (CM, ERV) were incorrectly flagging termination mismatches for stages that were never reached.

**Example (Student C10253):**
- Stage 1: 5/7 correct → Passed (CM_Ter1=0) ✅
- Stage 2: 3/5 correct → Terminated (CM_Ter2=1) ✅
- **Stage 3**: Not reached (0 answers) → CM_Ter3 not recorded
- **Stage 4**: Not reached (0 answers) → CM_Ter4 not recorded

**Bug:** System checked ALL 4 stages, including unreached Stage 3 and 4:
- Stage 3: 0 correct < 4 threshold → System says "Should Terminate" 🔴
- CM_Ter3: Not recorded → Defaults to '0' (Passed) ✅
- **Result:** False mismatch → Yellow warning! 🚨

**Fix (lines 960-1005):**
1. Count `answeredInStage` for each stage
2. Skip stages with 0 answered questions
3. Stop checking after a terminated stage is found

```javascript
// CRITICAL FIX: Skip stages that were never reached
if (answeredInStage === 0) {
  console.log(`Stage ${stage.stageNum} not reached (0 answers) - skipping mismatch check`);
  break; // Stop checking further stages
}

// If this stage terminated, stop checking further stages
if (recordedTriggered) {
  console.log(`Stage ${stage.stageNum} terminated - stopping mismatch checks`);
  break;
}
```

**Impact:**
- **Tasks Affected:** CM (4 stages), ERV (3 stages)
- **Before Fix:** Any student terminating at early stages showed false yellow warnings
- **After Fix:** Only genuine mismatches trigger yellow warnings
- **Clear cache required:** Run `await window.JotFormCache.clearCache()` and reload page

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

### 4. Fine Motor (FM) - Threshold-Based with Multi-Tier Validation

**Type:** Threshold-based termination  
**Termination ID:** `FM_Ter`  
**Target Questions:** FM_slide_1, FM_slide_2, FM_slide_3, FM_squ_1, FM_squ_2, FM_squ_3 (all cutting items)  
**Threshold:** At least 1 must score > 0  
**Metadata Field:** FM_Hand (慣用手 - dominant hand) - displayed but not scored

#### Termination Logic
- Check if ALL six cutting items (slide_1-3 + squ_1-3) are scored 0 (all unsuccessful)
- If all score 0, terminates and skips tree-cutting items (FM_tree_*)
- If at least one scores > 0, student proceeds to tree-cutting items

---

#### Question-Level Pills (7 Types)

Fine Motor uses a sophisticated 7-pill validation system with confidence tiers:

##### **Red Pills (High-Confidence Issues):**

1. **❌ "Missing Data"** (red with alert-triangle icon)
   - **When:** High/Very high confidence cross-section violation
   - **Scenarios:**
     - `squ_3=1` but ALL sides null → Flag side_1, side_2, side_3
     - `squ_2=1` but ALL sides null → Flag side_1, side_2
   - **Why red:** We're VERY confident this data should exist (90%+ square requires excellent first edge)

2. **❌ "Not Successful"** (red with X icon)
   - **When:** Value = 0, no violations
   - **Standard unsuccessful result**

##### **Yellow Pills (Medium-Confidence Issues):**

3. **🟡 "Possible Missing Data"** (yellow with alert-triangle icon)
   - **When:** Medium confidence cross-section violation
   - **Scenarios:**
     - `squ_1=1` but ALL sides null → Flag side_1 only
     - `squ_2=1`, side_1 answered, but side_2 null → Flag side_2
   - **Why yellow:** Reasonably suspicious but not certain

4. **🟡 "Illogical Score"** (yellow with alert-triangle icon)
   - **When:** Hierarchical consistency violation
   - **Scenarios:**
     - `side_2=1` but `side_1=0` (can't achieve 50% without 10%)
     - `side_3=1` but `side_1=0` or `side_2=0`
     - Same logic for squ_1-3
   - **Why yellow:** Scores don't make mathematical sense

5. **🟡 "Possible Wrong Input"** (yellow with alert-triangle icon)
   - **When:** Incomplete data detection
   - **Scenario:** ANY side_1-3 = 1 BUT ALL squ_1-3 = 0
   - **Why yellow:** Side succeeded but square failed (lower confidence - first edge is only ~25% of perimeter)

##### **Gray Pills (Normal Missing):**

6. **⚪ "Not answered"** (gray with minus icon)
   - **When:** Value = null, NO violations detected
   - **Standard missing answer, no data quality issue**

##### **Green Pills (Success):**

7. **✅ "Successful"** (green with check icon)
   - **When:** Value = 1, no violations
   - **Standard successful result**

---

#### Validation Priority Order (Question Level)

```
1️⃣ Cross-Section Violation (High Confidence)?
   → ❌ "Missing Data" (RED)

2️⃣ Cross-Section Violation (Medium Confidence)?
   → 🟡 "Possible Missing Data" (YELLOW)

3️⃣ Is studentAnswer null?
   → ⚪ "Not answered" (GRAY)

4️⃣ Hierarchical Violation?
   → 🟡 "Illogical Score" (YELLOW)

5️⃣ Is studentAnswer = 1?
   → ✅ "Successful" (GREEN)

6️⃣ Incomplete Data?
   → 🟡 "Possible Wrong Input" (YELLOW)

7️⃣ Default: studentAnswer = 0
   → ❌ "Not Successful" (RED)
```

---

#### Graduated Cross-Section Validation Logic

**Principle:** Higher `squ` thresholds = Higher confidence about which `side` thresholds should exist

**Case 1: squ_1 = 1 (10-49% square accuracy)**
- **Means:** ~1 side worth of perimeter cutting
- **Expected:** side_1 should exist (high confidence)
- **If ALL sides null:** Flag side_1 only → 🟡 "Possible Missing Data"

**Case 2: squ_2 = 1 (50-89% square accuracy)**
- **Means:** ~2 sides worth of cutting
- **Expected:** side_1 AND side_2 should exist (very high confidence)
- **If ALL sides null:** Flag side_1, side_2 → ❌ "Missing Data" (RED)
- **If side_1 answered but side_2 null:** Flag side_2 → 🟡 "Possible Missing Data"

**Case 3: squ_3 = 1 (90-100% square accuracy)**
- **Means:** Almost entire perimeter cut accurately
- **Expected:** side_1, side_2, likely side_3 should exist (absolute confidence)
- **If ALL sides null:** Flag side_1, side_2, side_3 → ❌ "Missing Data" (RED)

**Key Insight:** First edge is PART of entire square (~25% of perimeter). Cannot achieve high square accuracy without cutting first edge.

---

#### Hierarchical Consistency Validation

**Principle:** Progressive/cumulative thresholds - higher requires lower

- FM_side_1-3: 10-49%, 50-89%, 90-100% for SAME first edge
- FM_squ_1-3: 10-49%, 50-89%, 90-100% for SAME entire square

**Valid patterns:** [0,0,0], [1,0,0], [1,1,0], [1,1,1]
**Invalid patterns:** [0,1,0], [0,0,1], [1,0,1]

**Detection:**
- If side_2=1 but side_1=0 → Violation
- If side_3=1 but side_1=0 or side_2=0 → Violation
- Same logic for squ_1-3

**Display:** 🟡 "Illogical Score" on ALL questions in violated section

---

#### Incomplete Data Detection

**Principle:** Side success should correlate with some square success

**Detection:** ANY side_1-3 = 1 BUT ALL squ_1-3 = 0

**Reason:** First edge is part of square, so square should have SOME accuracy

**Display:** 🟡 "Possible Wrong Input" on squ_1-3 questions

**Note:** Lower confidence (yellow not red) because first edge is only ~25% of perimeter - student could succeed on edge but fail badly on corners/remaining edges.

---

#### Task-Level Status Mapping

**Maps question-level pills → task-level circle:**

**Priority 1: 🟡 YELLOW Task (Data Quality Issues)**
- If ANY of these pills exist:
  - ❌ "Missing Data" (RED pill)
  - 🟡 "Possible Missing Data" (YELLOW pill)
  - 🟡 "Illogical Score" (YELLOW pill)
  - 🟡 "Possible Wrong Input" (YELLOW pill)
- **Then:** Task circle = 🟡 YELLOW
- **Reason:** Data quality issues detected, needs review
- **Flag:** `hasTerminationMismatch = true`

**Priority 2: 🟢 GREEN Task (Complete, No Issues)**
- All questions answered (or properly terminated)
- NO data quality pills
- **Then:** Task circle = 🟢 GREEN

**Priority 3: 🔴 RED Task (Incomplete)**
- Some questions answered, some not
- NOT terminated
- NO data quality pills
- **Then:** Task circle = 🔴 RED
- **Reason:** Incomplete assessment (normal partial data)

**Priority 4: ⚪ GRAY Task (Not Started)**
- No questions answered
- **Then:** Task circle = ⚪ GRAY

**Key Design Decision:** RED "Missing Data" pill → YELLOW task (not red task)
- RED pill = High confidence data quality issue
- Task is not "incomplete" in traditional sense
- It's a **data quality warning** needing review
- Distinguishes from "partially answered incomplete" (red task level)

---

#### Display Logic
- **FM_Hand:** Displayed as metadata row (like TGMD_Leg) showing 左手/右手/未形成
- **FM_side_1-3:** Graduated validation pills based on squ values
- **FM_squ_1-3:** Shows "Possible Wrong Input" if incomplete data, "Illogical Score" if hierarchical violation
- **No "Correct Answer" column** for Fine Motor (performance assessment, not right/wrong)

#### Examples

**Example 1: Proper Termination**
- FM_slide_1-3: 0, 0, 0 (all unsuccessful)
- FM_squ_1-3: 0, 0, 0 (all unsuccessful)
- **Question Pills:** ❌ "Not Successful" on all cutting items
- **Task Status:** 🟢 GREEN (properly terminated)
- **Result:** ✅ Terminates correctly, tree-cutting excluded

**Example 2: Passes to Tree-Cutting**
- FM_slide_1-3: 1, 0, 0 (one successful)
- FM_squ_1-3: 0, 0, 0 (all unsuccessful)
- **Question Pills:** ✅ "Successful" on slide_1, ❌ "Not Successful" on others
- **Task Status:** 🟢 GREEN (complete, no issues)
- **Result:** ✅ Passes threshold (at least 1 successful), proceeds to tree-cutting

**Example 3: Incomplete Data Detection**
- FM_side_1: 1 (successful)
- FM_side_2: 0
- FM_side_3: 0
- FM_squ_1-3: 0, 0, 0 (ALL unsuccessful)
- **Question Pills:** 🟡 "Possible Wrong Input" on squ_1-3, ✅ "Successful" on side_1
- **Task Status:** 🟡 YELLOW (data quality issue)
- **Reason:** Student succeeded on first edge but failed all square edges
- **Explanation:** Lower confidence issue - first edge is only ~25% of perimeter

**Example 4: Hierarchical Consistency Violation**
- FM_side_1: 0 (not marked)
- FM_side_2: 1 (marked) ← Violates hierarchy!
- FM_side_3: 0
- FM_squ_1: 1 (marked)
- FM_squ_2: 0 (not marked)
- FM_squ_3: 1 (marked) ← Violates hierarchy!
- **Question Pills:** 🟡 "Illogical Score" on ALL side_1-3 and ALL squ_1-3
- **Task Status:** 🟡 YELLOW (data quality issue)
- **Reason:** Higher thresholds marked without lower ones (mathematically impossible)
- **Explanation:** 
  - side_2 requires side_1 to be marked first
  - squ_3 requires squ_1 AND squ_2 to be marked first
  - Valid patterns: [1,0,0], [1,1,0], [1,1,1], [0,0,0]
  - Invalid patterns: [0,1,0], [0,0,1], [1,0,1]

**Example 5: Valid Cumulative Pattern (All Thresholds)**
- FM_side_1-3: [1, 1, 1] (all thresholds achieved)
- FM_squ_1-3: [1, 1, 1] (all thresholds achieved)
- **Question Pills:** ✅ "Successful" on all cutting items
- **Task Status:** 🟢 GREEN (complete, no issues)
- **Result:** ✅ All thresholds achieved - proceeds to tree-cutting
- **Explanation:** This is VALID - student achieved all progressive thresholds

**Example 6: High-Confidence Missing Data (RED Pills)**
- FM_side_1-3: [null, null, null] (ALL unanswered)
- FM_squ_1-3: [0, 1, 0] (squ_2 marked = 50-89% square)
- **Question Pills:** ❌ "Missing Data" (RED) on side_1 and side_2
- **Task Status:** 🟡 YELLOW (data quality issue)
- **Reason:** Cannot achieve 50-89% square accuracy without cutting first edge to at least 50%
- **Explanation:** 
  - squ_2=1 means ~2 sides worth of cutting completed
  - First edge MUST have been cut and likely achieved side_2 threshold
  - HIGH CONFIDENCE violation → RED pills
  - But task status is YELLOW (data quality, not incomplete)

**Example 7: Medium-Confidence Missing Data (YELLOW Pills)**
- FM_side_1-3: [null, null, null] (ALL unanswered)
- FM_squ_1-3: [1, 0, 0] (squ_1 marked = 10-49% square)
- **Question Pills:** 🟡 "Possible Missing Data" (YELLOW) on side_1 only
- **Task Status:** 🟡 YELLOW (data quality issue)
- **Reason:** 10-49% square suggests first edge was cut at some accuracy
- **Explanation:** Medium confidence - could be ~1 side worth, but less certain than higher thresholds

**Example 8: Partial Answer with Missing Data**
- FM_side_1: 1 (answered)
- FM_side_2: null (unanswered)
- FM_side_3: null
- FM_squ_1: 1
- FM_squ_2: 1 (50-89% square!)
- FM_squ_3: 0
- **Question Pills:** 🟡 "Possible Missing Data" on side_2 (other questions normal)
- **Task Status:** 🟡 YELLOW (data quality issue)
- **Reason:** squ_2=1 suggests first edge likely achieved 50%+, so side_2 should be marked
- **Explanation:** side_1 satisfied cross-section dependency, but side_2 missing given squ_2 success

**Example 9: Very High Confidence Missing Data**
- FM_side_1-3: [null, null, null] (ALL unanswered)
- FM_squ_1-3: [1, 1, 1] (90-100% square!)
- **Question Pills:** ❌ "Missing Data" (RED) on side_1, side_2, side_3
- **Task Status:** 🟡 YELLOW (data quality issue)
- **Reason:** 90-100% square = almost perfect perimeter cutting
- **Explanation:** 
  - Absolute confidence first edge was cut excellently
  - All three side thresholds likely achieved
  - VERY HIGH CONFIDENCE → RED pills on all side questions

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
| FM | Threshold-based | All slide + square items = 0 | None | Variable (7-10 items, FM_Hand is metadata) |
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
