# CM Status Light Investigation Summary

## Issue Description
After rebuilding cache, CM's status light for class and student page is not aligned in the by-task view. Specifically:
- **Student:** C10880
- **Class:** C-046-12
- **Task:** CM (Chinese Morphology)
- **Expected:** Green (Complete) - terminated at Q7, 7/7 answered
- **Actual:** White/Grey (Not Started)

## Investigation Summary

### 1. Logic Verification ✅
Created test script (TEMP/test_status_light_logic.js) with CM data:
- answeredQuestions: 7
- totalQuestions: 7
- terminated: true
- hasPostTerminationAnswers: false

**Results:**
- Export status light calculation: 🟢 Complete ✅
- Cache `complete` field: `true` ✅
- Display status: `status-green` ✅

**Conclusion:** The logic is mathematically correct!

### 2. Code Flow Analysis

#### Cache Building (jotform-cache.js)
```javascript
// Line 889-891: Calculate isComplete
const isComplete = (answered === total && total > 0) || 
                   (validation.terminated && !validation.hasPostTerminationAnswers && answered > 0) ||
                   (validation.timedOut && !validation.hasPostTerminationAnswers && answered > 0);

// Line 906-912: Store in cache
setStatus[setId].tasks.push({
  taskId,
  complete: isComplete,  // Should be TRUE for CM
  answered,              // Should be 7
  total,                 // Should be 7
  hasPostTerminationAnswers: validation.hasPostTerminationAnswers || false  // Should be FALSE
});
```

For CM: `isComplete = (7 === 7 && 7 > 0) || (true && !false && 7 > 0)` = `true`

#### Class Page Display (checking-system-class-page.js)
```javascript
// Line 829-833: Find task in cache
const foundTask = set.tasks.find(t => 
  t.taskId === searchId ||     // 'cm' === 'cm'
  t.taskId.includes(searchId) || 
  searchId.includes(t.taskId)
);

// Line 849-858: Determine status
if (foundTask.hasPostTerminationAnswers) return 'status-yellow';  // FALSE, skip
if (foundTask.complete) return 'status-green';                     // TRUE, SHOULD RETURN GREEN
if (foundTask.answered > 0) return 'status-red';                   // Shouldn't reach here
return 'status-grey';                                              // Shouldn't reach here
```

**Expected:** Should return `'status-green'` at line 852
**Actual:** Showing grey, suggesting either:
1. `foundTask` is `undefined` (not found in cache)
2. `foundTask.complete` is `false` (cache has wrong data)

### 3. Debug Logging Added

#### Cache Building (jotform-cache.js, line 914-926)
Logs when CM is cached for C10880:
- taskId, setId, isComplete, answered, total
- terminated, hasPostTerminationAnswers
- Condition evaluation results

#### Class Page Display (checking-system-class-page.js, line 836-870)
Logs when CM is looked up for C10880:
- If found: Shows taskId, complete, answered, total, hasPostTerminationAnswers, setId
- If NOT found: Warns with searchTaskIds, taskName, availableSets

### 4. Export Enhancement ✅

Added `calculateTaskStatusLight()` function that:
- Uses same logic as cache building
- Returns emoji + text: 🟢 Complete, 🔴 Incomplete, 🟡 Post-Term, ⚪ Not Started

Updated exports to include "Status Light" column:
- **Class export table:** `| Task | Status Light | ANS | COR | TOT | Completion | Accuracy | Terminated |`
- **Student detail:** `**Status Light:** 🟢 Complete`

## Possible Root Causes

### Hypothesis 1: Task Not Found in Cache ⚠️
- Cause: Task matching fails in `getTaskStatus()`
- Evidence needed: Check console for "CM NOT FOUND" warning
- Fix: Improve task matching logic or fix cache key case sensitivity

### Hypothesis 2: Cache Has Wrong Data ⚠️
- Cause: `complete` field is `false` when it should be `true`
- Evidence needed: Check console for debug log showing `complete: false`
- Fix: Investigate why cache building logic fails for CM specifically

### Hypothesis 3: Stale Cache ⚠️
- Cause: Old cache being used instead of rebuilt one
- Evidence needed: Check cache timestamp vs rebuild timestamp
- Fix: Force cache invalidation or rebuild

### Hypothesis 4: Set ID Mismatch ⚠️
- Cause: CM is in a different set than expected
- Evidence needed: Check which setId CM is stored under
- Fix: Verify survey-structure.json has CM in correct set

## Next Steps

1. **Load class page** with C10880 data and check browser console
2. **Look for debug logs** showing:
   - Cache build: Did CM get stored with `complete: true`?
   - Display: Was CM found? What was its `complete` value?
3. **Export class report** and verify Status Light column shows 🟢 Complete for CM
4. **Compare** console logs with export to identify discrepancy
5. **Fix identified issue** based on evidence
6. **Remove debug logging** after fix is verified

## Files Modified

1. **assets/js/export-utils.js**
   - Added `calculateTaskStatusLight()` function
   - Updated `generateTaskSummaryTable()` to include Status Light column
   - Updated student detail export to show Status Light

2. **assets/js/checking-system-class-page.js**
   - Added debug logging for CM task lookup (C10880)
   - Added warning for CM not found case

3. **assets/js/jotform-cache.js**
   - Added debug logging for CM cache building (C10880)

4. **TEMP/test_status_light_logic.js**
   - Created test script to verify logic correctness
   - All tests pass ✅

## Test Results

```
=== Overall Test ===
✅ ALL TESTS PASSED

Export Status Light: 🟢 Complete ✅
Cache complete field: true ✅
Display Status: status-green ✅
```

## Conclusion

The logic is correct! The issue must be in:
- How the cache is being populated (wrong data stored)
- How the task is being looked up (not found)
- Or a stale cache issue

Debug logging will reveal the root cause when the class page is loaded with actual C10880 data.
