# TGMD Matrix-Radio Scoring - Testing Guide

## Overview

This document provides guidance for testing the newly implemented TGMD matrix-radio scoring feature with trial aggregation and grouped display.

**Implementation Date**: 2025-10-24  
**PR**: herman925/4Set-Server#[PR_NUMBER]  
**Related Issue**: #92 (finish remaining work from #90)

---

## What Was Implemented

### Summary

The TGMD (Test of Gross Motor Development) scoring has been enhanced to:
- Aggregate trial results (t1 + t2) for each performance criterion
- Group results by motor task (hop, jump, slide, etc.)
- Display with Success/Fail labels instead of Correct/Incorrect
- Show task-level and overall scoring summaries

### Before vs. After

**BEFORE** (Individual Trial Display):
```
Question ID          | Student Answer | Status
---------------------|----------------|----------
TGMD_111_Hop_t1      | 1              | Correct
TGMD_111_Hop_t2      | 0              | Incorrect
TGMD_112_Hop_t1      | 1              | Correct
TGMD_112_Hop_t2      | 1              | Correct
```

**AFTER** (Grouped Task Display):
```
┌─ Task: 1.單腳跳 (Hop)                    Task Score: 3/8 ─┐
│                                                              │
│ TGMD_111_Hop                                                │
│ 離地腳有自然彎曲並向前擺動以提供動力                         │
│   Trial 1: ✓ Success    Trial 2: ✗ Fail    Row Score: 1/2  │
│                                                              │
│ TGMD_112_Hop                                                │
│ 離地腳的鞋沒有越過慣用腳                                     │
│   Trial 1: ✓ Success    Trial 2: ✓ Success  Row Score: 2/2  │
│                                                              │
└──────────────────────────────────────────────────────────────┘

Overall TGMD Score: 16/42 (38%)
```

---

## Testing Checklist

### 1. Prerequisites

Before testing, ensure:
- [ ] You have access to the checking system
- [ ] You have credentials to decrypt data
- [ ] You have at least one student with TGMD data
- [ ] Browser DevTools is open (F12) for debugging

### 2. Basic Functionality Tests

#### Test 2.1: TGMD Display Format
**Objective**: Verify TGMD results display with new grouped format

**Steps**:
1. Navigate to checking_system_home.html
2. Enter system password and build cache
3. Navigate to a student with TGMD data
4. Scroll to TGMD task section

**Expected Results**:
- [ ] TGMD section shows task headers (e.g., "1.單腳跳", "2.立定跳遠")
- [ ] Each criterion shows two trial results
- [ ] Trial labels say "Success" (green) or "Fail" (red), not "Correct/Incorrect"
- [ ] Row scores display as "X/2" format
- [ ] Task scores show in header (e.g., "Task Score: 5/8")
- [ ] Overall TGMD score shown at bottom with percentage

#### Test 2.2: Trial Aggregation Accuracy
**Objective**: Verify row scores are calculated correctly

**Test Data**: Student with known TGMD responses

**Steps**:
1. Open browser DevTools Console
2. Navigate to student page with TGMD data
3. Look for log: `[TaskValidator] TGMD scoring complete: X/Y`
4. Manually verify row scores by comparing with raw data

**Expected Results**:
- [ ] Row score = Trial 1 value + Trial 2 value
- [ ] Maximum row score = 2
- [ ] Task score = sum of all row scores for that task
- [ ] Overall score = sum of all task scores

**Example Calculation**:
```
Hop Task:
  TGMD_111_Hop: t1=1, t2=0 → row score = 1/2
  TGMD_112_Hop: t1=1, t2=1 → row score = 2/2
  TGMD_113_Hop: t1=0, t2=1 → row score = 1/2
  TGMD_114_Hop: t1=1, t2=1 → row score = 2/2
  
  Hop Task Score: 1+2+1+2 = 6/8
```

#### Test 2.3: Task Grouping
**Objective**: Verify criteria are grouped by motor task

**Steps**:
1. Navigate to student with complete TGMD data
2. Count the number of task headers
3. Verify each task has the correct number of criteria

**Expected Results**:
- [ ] 6 task headers displayed: Hop, Jump, Slide, Dribble, Catch, Underhand Throw
- [ ] Hop: 4 criteria
- [ ] Jump: 4 criteria
- [ ] Slide: 4 criteria
- [ ] Dribble: 3 criteria
- [ ] Catch: 3 criteria
- [ ] Underhand Throw: 4 criteria
- [ ] Total: 22 criteria (44 trial cells)

### 3. Edge Case Tests

#### Test 3.1: Partial TGMD Data
**Objective**: Verify handling of incomplete TGMD assessments

**Test Scenarios**:
1. Student with only Trial 1 completed (Trial 2 missing)
2. Student with only some motor tasks completed
3. Student with no TGMD data

**Expected Results**:
- [ ] Missing trials show value 0 in calculation
- [ ] Partial tasks display correctly with available data
- [ ] Empty TGMD shows "Not started" status
- [ ] No JavaScript errors in console

#### Test 3.2: Zero Scores
**Objective**: Verify display of failed trials

**Test Data**: Student with all trials = 0

**Expected Results**:
- [ ] All trials show "Fail" status (red)
- [ ] All row scores show "0/2"
- [ ] Task scores show "0/X"
- [ ] Overall score shows "0/44" (0%)
- [ ] No visual rendering issues

#### Test 3.3: Perfect Scores
**Objective**: Verify display of all successful trials

**Test Data**: Student with all trials = 1

**Expected Results**:
- [ ] All trials show "Success" status (green)
- [ ] All row scores show "2/2"
- [ ] Task scores show "X/X" (max for each task)
- [ ] Overall score shows "44/44" (100%)
- [ ] Summary displays correctly

### 4. Regression Tests

#### Test 4.1: Other Tasks Unchanged
**Objective**: Verify no breaking changes to non-TGMD tasks

**Steps**:
1. Navigate to same student page
2. Check ERV, CM, CWR, SYM, and other tasks

**Expected Results**:
- [ ] All other tasks display in standard format
- [ ] Question-by-question list still shown
- [ ] "Correct/Incorrect" labels still used (not "Success/Fail")
- [ ] Completion percentages calculated correctly
- [ ] No visual or functional regressions

#### Test 4.2: Task Statistics
**Objective**: Verify task summary statistics are correct

**Steps**:
1. Check TGMD task summary at top of section
2. Verify answered/total counts
3. Check completion percentage

**Expected Results**:
- [ ] Answered count matches number of non-null trial cells
- [ ] Total count is 44 (22 criteria × 2 trials)
- [ ] Completion percentage = (answered / total) × 100
- [ ] Status light color matches completion:
  - Green: 100%
  - Yellow: 100% with termination (N/A for TGMD)
  - Red: < 100%
  - Grey: 0%

### 5. UI/UX Tests

#### Test 5.1: Visual Styling
**Objective**: Verify CSS styling is applied correctly

**Steps**:
1. Inspect TGMD section visually
2. Check trial pills for proper styling
3. Verify color consistency

**Expected Results**:
- [ ] Success pills: light green background, dark green text
- [ ] Fail pills: light red background, dark red text
- [ ] Pills have rounded corners and borders
- [ ] Icons display correctly (check, x, hash, activity, target)
- [ ] Task headers have muted background
- [ ] Summary row has accent background
- [ ] Hover effects work on rows

#### Test 5.2: Responsive Design
**Objective**: Verify display on different screen sizes

**Test Devices**:
- [ ] Desktop (1920×1080)
- [ ] Laptop (1366×768)
- [ ] Tablet (768×1024)
- [ ] Mobile (375×667)

**Expected Results**:
- [ ] Task headers don't wrap awkwardly
- [ ] Trial pills remain readable
- [ ] Table doesn't overflow horizontally
- [ ] Row scores align properly
- [ ] Overall summary fits in viewport

### 6. Performance Tests

#### Test 6.1: Rendering Speed
**Objective**: Verify TGMD rendering doesn't slow down page load

**Steps**:
1. Open DevTools Performance tab
2. Start recording
3. Navigate to student page with TGMD data
4. Stop recording when page fully loaded

**Expected Results**:
- [ ] TGMD rendering completes in < 100ms
- [ ] No long-running JavaScript tasks
- [ ] No layout thrashing
- [ ] Console log shows: `[StudentPage] ✅ Populated TGMD with grouped scoring`

#### Test 6.2: Multiple Students
**Objective**: Verify performance with batch testing

**Steps**:
1. Navigate through 5-10 students with TGMD data
2. Check for memory leaks
3. Monitor browser responsiveness

**Expected Results**:
- [ ] No memory accumulation
- [ ] Page remains responsive
- [ ] Icons render correctly each time
- [ ] No duplicate TGMD sections

---

## Debugging Guide

### Common Issues & Solutions

#### Issue 1: TGMD Still Shows Old Format

**Symptoms**: Individual trial cells instead of grouped display

**Diagnosis**:
1. Open DevTools Console
2. Look for: `[TaskValidator] Processing TGMD matrix-radio scoring`
3. If missing, check if `tgmdScoring` structure exists in validation result

**Solutions**:
- Clear browser cache (Ctrl+Shift+Delete)
- Hard refresh (Ctrl+F5)
- Check task ID is exactly 'tgmd' (lowercase)
- Verify TGMD.json has `type: "matrix-radio"` questions

#### Issue 2: Trial Scores Incorrect

**Symptoms**: Row scores don't match trial values

**Diagnosis**:
1. Open DevTools Console
2. Run: `console.log(window.TaskValidator.validateTask('tgmd', mergedAnswers))`
3. Inspect `tgmdScoring` structure

**Debugging**:
```javascript
// In Console, inspect TGMD scoring
const validation = await window.TaskValidator.validateTask('tgmd', mergedAnswers);
console.log('TGMD Scoring:', validation.tgmdScoring);

// Check individual row
console.log('Hop Task:', validation.tgmdScoring.byTask.hop);
```

#### Issue 3: CSS Styling Not Applied

**Symptoms**: Pills have no color or wrong colors

**Diagnosis**:
1. Inspect element with DevTools
2. Check if `.trial-pill`, `.trial-success`, `.trial-fail` classes are applied
3. Verify CSS file is loaded

**Solutions**:
- Check `checking-system-home.css` is linked in HTML
- Verify CSS classes are exactly: `trial-pill trial-success` or `trial-pill trial-fail`
- Clear browser cache and hard refresh
- Check for CSS conflicts with other styles

#### Issue 4: Icons Not Displaying

**Symptoms**: Missing icons (activity, target, check, x, hash)

**Diagnosis**:
1. Check if Lucide icons library is loaded
2. Look for: `lucide.createIcons()` call in console

**Solutions**:
- Verify Lucide library script is loaded in HTML
- Check console for errors loading Lucide
- Ensure `lucide.createIcons()` is called after rendering
- Icons must have `data-lucide` attribute, not `class="lucide-*"`

---

## Test Data Requirements

### Minimum Test Data

To thoroughly test TGMD scoring, you need students with:

1. **Complete TGMD data**: All 6 tasks, all trials filled
2. **Partial TGMD data**: Only some tasks completed
3. **Only Trial 1 completed**: Trial 2 missing/null
4. **Only Trial 2 completed**: Trial 1 missing/null
5. **Mixed results**: Some successes, some failures
6. **All failures**: All trials = 0
7. **All successes**: All trials = 1
8. **No TGMD data**: Student hasn't completed TGMD

### Sample Test Student IDs

If available in your dataset:
- C10261: Complete TGMD data (example from test files)
- [Add more student IDs from your system]

---

## Validation Criteria

### Acceptance Criteria

✅ **Feature is considered working when**:
- [ ] All basic functionality tests pass
- [ ] All edge case tests pass
- [ ] No regressions in other tasks
- [ ] UI/UX matches design requirements
- [ ] Performance is acceptable (< 100ms render)
- [ ] No JavaScript errors in console
- [ ] No CSS styling issues
- [ ] Success/Fail terminology used instead of Correct/Incorrect
- [ ] Trial aggregation calculations are accurate
- [ ] Task grouping displays correctly
- [ ] Overall TGMD score matches expected calculation

### Known Limitations

⚠️ **Current Limitations**:
- TGMD display requires `tgmdScoring` structure in validation result
- Only applies to 'tgmd' task ID (exact lowercase match)
- Assumes TGMD.json structure with `type: "matrix-radio"` questions
- No support for more than 2 trials per criterion

---

## Reporting Issues

### Bug Report Template

When reporting issues, include:

```markdown
## TGMD Scoring Issue

**Environment**:
- Browser: [Chrome/Firefox/Safari] [Version]
- OS: [Windows/Mac/Linux]
- Screen Size: [Width × Height]

**Student ID**: [Core ID]

**Steps to Reproduce**:
1. [Step 1]
2. [Step 2]
3. [Step 3]

**Expected Result**:
[What should happen]

**Actual Result**:
[What actually happens]

**Screenshots**:
[Attach screenshots if applicable]

**Console Logs**:
```
[Paste relevant console logs]
```

**Additional Context**:
[Any other relevant information]
```

### Where to Report

- GitHub Issues: herman925/4Set-Server
- Tag with: `bug`, `tgmd`, `ui`
- Reference PR: #[PR_NUMBER]

---

## Success Metrics

### Quantitative Metrics

- [ ] ✅ 0 JavaScript errors during TGMD rendering
- [ ] ✅ 100% of test cases pass
- [ ] ✅ < 100ms TGMD rendering time
- [ ] ✅ 0 regressions in other tasks
- [ ] ✅ 100% accuracy in score calculations

### Qualitative Metrics

- [ ] ✅ UI is intuitive and easy to understand
- [ ] ✅ Success/Fail labels are clearer than Correct/Incorrect
- [ ] ✅ Grouped display makes TGMD results easier to interpret
- [ ] ✅ Visual styling is consistent with rest of checking system
- [ ] ✅ Performance is acceptable (no lag or delay)

---

**Document Version**: 1.0  
**Created**: 2025-10-24  
**Author**: GitHub Copilot  
**Status**: Ready for Testing
