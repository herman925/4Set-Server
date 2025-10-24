# Critical Bug Found: refreshWithQualtrics Data Transformation Issue

**Date:** October 2025  
**Severity:** HIGH - Data Loss Bug  
**Status:** ⚠️ Identified but NOT fixed in this PR

---

## Summary

The `refreshWithQualtrics()` method in `jotform-cache.js` has a critical data transformation bug that causes **complete data loss** (cache goes from 773 submissions to 0) when users refresh with Qualtrics integration.

## Root Cause

**Location:** `assets/js/jotform-cache.js` line 1099

```javascript
// Line 1068: Gets raw JotForm submissions
const jotformData = await this.getAllSubmissions(credentials);

// Line 1099: Passes them to data merger
const mergedData = merger.mergeDataSources(jotformData, transformedData);

// Line 1121: Saves empty result, OVERWRITING original data
await this.saveToCache(mergedData);  // mergedData is empty!
```

### The Problem

1. **What `getAllSubmissions()` returns:**
   ```javascript
   [
     {
       id: "123",
       answers: {
         "20": { answer: "10261", text: "10261" },  // Student ID is here
         "21": { answer: "李明", text: "李明" }
       },
       created_at: "2025-10-20"
     }
   ]
   ```

2. **What `data-merger.js` expects:**
   ```javascript
   [
     {
       coreId: "10261",  // Expects coreId at root level!
       childName: "李明",
       // ... other fields
     }
   ]
   ```

3. **What happens:**
   - Data merger looks for `jotformRecord.coreId` (line 74)
   - Doesn't find it (because it's in `answers['20']`)
   - Logs warning: "JotForm record missing coreId, skipping"
   - Skips ALL 773 records
   - Returns empty array
   - Empty array gets saved, **overwriting the original 773 submissions**

## Evidence from User's Logs

```
[JotFormCache] Total submissions: 773          ✅ Data fetched
[JotFormCache] Cached 773 submissions         ✅ Data saved
[DataMerger] JotForm records: 773              ✅ Passed to merger
773 [DataMerger] JotForm record missing coreId ❌ ALL skipped!
[DataMerger] Merge complete: 0 total records  ❌ Nothing left
[JotFormCache] saveToCache called with 0      ❌ Overwrites cache!
```

## Why This Wasn't Caught Earlier

The original code had `console.warn()` statements that were alerting to this issue, but they were being interpreted as "normal empty cache warnings" instead of "critical data transformation errors".

My PR initially **made this worse** by changing those warnings to info logs, which hid the real problem. I've since reverted those changes.

## The Correct Fix (NOT in this PR)

The fix requires transforming JotForm submissions before passing to data merger:

```javascript
// BEFORE (current buggy code)
const jotformData = await this.getAllSubmissions(credentials);
const mergedData = merger.mergeDataSources(jotformData, transformedData);

// AFTER (correct approach)
const jotformSubmissions = await this.getAllSubmissions(credentials);
const jotformData = this.transformSubmissionsToRecords(jotformSubmissions);
const mergedData = merger.mergeDataSources(jotformData, transformedData);
```

Where `transformSubmissionsToRecords()` would:
1. Extract `coreId` from `answers['20']`
2. Extract `childName` from `answers['21']` or `answers['child-name']`
3. Flatten the answers structure to match what data-merger expects
4. Preserve metadata like `created_at`, `id`, etc.

## Similar Pattern in Working Code

The `buildStudentValidationCache()` method (line 588) correctly handles this transformation:

```javascript
// Line 598: Gets student ID from answers
const studentIdAnswer = submission.answers?.['20'];
const studentId = studentIdAnswer?.answer || studentIdAnswer?.text;

// Line 595: Finds student by Core ID
const student = students.find(s => {
  const numericCoreId = s.coreId.startsWith('C') ? s.coreId.substring(1) : s.coreId;
  return numericCoreId === studentId;
});
```

This same logic needs to be applied before calling `data-merger.js`.

## Impact

**Current State:**
- ❌ Users who click "Refresh with Qualtrics" lose ALL their cached data
- ❌ Cache goes from 773 submissions to 0
- ❌ System becomes unusable until they re-sync from scratch

**Why Not Fixed in This PR:**
- This PR was scoped to fix "console warnings and CORS issues"
- The data transformation bug is a separate, larger issue
- Fixing it properly requires understanding the full data flow
- Should be addressed in a dedicated bug fix PR

## Recommendations

1. **Immediate:** Document this bug and warn users not to use "Refresh with Qualtrics" until fixed
2. **Short-term:** Add a safety check before `saveToCache()` to prevent overwriting with empty data
3. **Long-term:** Implement proper data transformation in `refreshWithQualtrics()`

## Related Files

- `assets/js/jotform-cache.js` (lines 1066-1121) - Bug location
- `assets/js/data-merger.js` (line 74) - Where filtering happens
- `assets/js/jotform-cache.js` (lines 588-600) - Example of correct pattern

---

**Discovered By:** User feedback (herman925)  
**Documented By:** GitHub Copilot  
**Date:** October 2025  
**Status:** Bug identified, NOT fixed in this PR
