# Cache Architecture PRD

**Project:** KeySteps@JC - 4Set System 2025/26  
**Last Updated:** November 12, 2025  
**Status:** Active

---

## Executive Summary

The 4Set Checking System uses a multi-layer caching architecture that merges JotForm assessments and Qualtrics surveys, validates task completion, and stores results in IndexedDB. This document defines the complete data flow, storage formats, and access patterns.

**Critical Design Principles:**
1. **Grade Isolation**: Never merge K1/K2/K3 data across grades
2. **Earliest Wins**: First non-empty value wins for duplicate answers
3. **Map in Memory, Object in Storage**: JavaScript Map for fast lookups, Object for IndexedDB
4. **Two-Layer Architecture**: Raw submissions (Layer 1) + Validated results (Layer 2)

---

## Storage Architecture

### IndexedDB Stores

```
JotFormCacheDB
├── jotform_cache (Layer 1: Raw + Merged Submissions)
│   └── Stores: Array of submission objects with JotForm + Qualtrics data
├── validation_cache (Layer 2: Validated Task Results) 
│   └── Stores: Map<coreId, studentData> with taskValidation + setStatus
└── qualtrics_cache (Separate Qualtrics Tracking)
    └── Stores: Raw Qualtrics responses for debugging
```

### Layer 1: Submissions Cache

**Storage Format:** Plain JavaScript Object
```javascript
{
  timestamp: 1699776000000,
  submissions: [  // Array of merged records
    {
      coreId: "C10720",
      grade: "K1",
      answers: { "ERV_Q1": {...}, "CM_Q1": {...} },
      _sources: ["jotform", "qualtrics"],  // Data provenance
      _meta: { jotformSubmissionId: "...", qualtricsResponseId: "..." }
    }
  ]
}
```

**Access:** `loadFromCache()` → returns Array

### Layer 2: Validation Cache

**Storage Format:** Plain JavaScript Object (converted to/from Map)
```javascript
{
  timestamp: 1699776000000,
  count: 427,
  version: "1.0",
  validations: {  // Object (serialized Map)
    "C10720": {
      coreId: "C10720",
      mergedAnswers: {...},
      taskValidation: {...},
      setStatus: {
        "set3": {
          tasks: [
            { taskId: "cm", complete: true, answered: 7, total: 7 }
          ]
        }
      }
    }
  }
}
```

**Access:** `loadValidationCache()` → returns Map<coreId, studentData>

---

## Data Flow: JotForm + Qualtrics → Validation → UI

```
┌──────────────┐         ┌──────────────┐
│ JOTFORM API  │         │ QUALTRICS API│
│ 517 submiss. │         │ 200 responses│
└──────┬───────┘         └──────┬───────┘
       │ Parallel Fetch         │
       └────────┬────────────────┘
                ▼
┌────────────────────────────────────┐
│ DATA MERGER (data-merger.js)      │
│ 1. Grade detection per record      │
│ 2. Group by (coreId, grade)        │
│ 3. Merge answers (earliest wins)   │
│ 4. Tag sources & conflicts         │
└────────────────┬───────────────────┘
                 ▼
┌────────────────────────────────────┐
│ Layer 1: SUBMISSIONS CACHE         │
│ Format: Object { submissions: [] } │
│ Size: ~20MB (500 students)         │
└────────────────┬───────────────────┘
                 │ (on demand, per class)
                 ▼
┌────────────────────────────────────┐
│ VALIDATION BUILDER                 │
│ 1. Merge submissions per student   │
│ 2. TaskValidator.validateAllTasks()│
│ 3. Build setStatus per set         │
└────────────────┬───────────────────┘
                 ▼
┌────────────────────────────────────┐
│ Layer 2: VALIDATION CACHE          │
│ Format: Map<coreId, studentData>   │
│ Size: ~10MB (500 students)         │
└────────────────┬───────────────────┘
                 │
     ┌───────────┴───────────┐
     ▼                       ▼
┌─────────────┐      ┌──────────────┐
│ CLASS/      │      │ STUDENT PAGE │
│ SCHOOL PAGE │      │ Recalculates │
│ Uses Layer 2│      │ from Layer 1 │
│ setStatus   │      │ (live)       │
└─────────────┘      └──────────────┘
```

---

## Map vs Object: Technical Details

### Why This Matters

**JavaScript Map:**
- Fast lookups: `cache.get("C10720")` is O(1)
- Cannot be serialized to IndexedDB directly

**Plain Object:**
- Slow lookups: `cache["C10720"]` is still fast enough
- Can be serialized to IndexedDB

**Solution:** Map in memory, Object in storage

### Conversion Code

**Saving (Map → Object):**
```javascript
async saveValidationCache(validationCache) {
  // IN-MEMORY: JavaScript Map
  const cacheObject = {};
  for (const [coreId, data] of validationCache.entries()) {
    cacheObject[coreId] = data;  // Map → Object
  }
  
  await validationStorage.setItem(KEY, {
    validations: cacheObject,  // Stored as Object
    timestamp: Date.now()
  });
}
```

**Loading (Object → Map):**
```javascript
async loadValidationCache() {
  const cacheEntry = await validationStorage.getItem(KEY);
  
  // cacheEntry.validations is an Object
  const validationCache = new Map();
  for (const [coreId, data] of Object.entries(cacheEntry.validations)) {
    validationCache.set(coreId, data);  // Object → Map
  }
  
  return validationCache;  // Returns Map
}
```

### Console Access Patterns

**WRONG:**
```javascript
const cache = await window.JotFormCache.loadValidationCache();
cache["C10720"]  // ❌ undefined (Map doesn't support bracket notation)
cache.C10720     // ❌ undefined
```

**CORRECT:**
```javascript
const cache = await window.JotFormCache.loadValidationCache();
cache.get("C10720")                // ✅ Returns student data
Array.from(cache.keys())           // ✅ All IDs
cache.size                         // ✅ Student count
for (const [id, data] of cache.entries()) { ... }  // ✅ Iterate
```

---

## Cache Access Patterns by Page

### Class/School Pages

**Uses:** Layer 2 setStatus (cached task completion)

```javascript
// Load validation cache (returns Map)
const validationCache = await window.JotFormCache.buildStudentValidationCache(
  students, surveyStructure, credentials
);

// Access student
const studentData = validationCache.get("C10720");
const setStatus = studentData.setStatus;

// Find task in setStatus.tasks array
const set3 = setStatus.set3;
const cmTask = set3.tasks.find(t => t.taskId === 'cm');  // Exact match only!
```

### Student Page

**Uses:** Layer 1 mergedAnswers (recalculates live)

```javascript
// Load submissions (returns Array)
const submissions = await window.JotFormCache.getStudentSubmissions(
  "C10720", 
  "K1"  // Grade filter
);

// Merge and recalculate (LIVE, not cached)
const mergedAnswers = mergeSubmissions(submissions);
const taskValidation = await window.TaskValidator.validateAllTasks(mergedAnswers);

// Display live results
populateTaskTables(taskValidation, mergedAnswers);
```

---

## Known Issues and Fixes

### Issue: Fuzzy Matching False Positives (FIXED Nov 12, 2025)

**Problem:** `"cm"` matches `"ccm"` due to `.includes()` substring matching

**Root Cause:**
```javascript
// OLD (BUGGY)
const foundTask = set.tasks.find(t => 
  t.taskId.includes(searchId) ||  // "ccm".includes("cm") = true ❌
  searchId.includes(t.taskId)
);
```

**Fix:**
```javascript
// NEW (CORRECT)
const foundTask = set.tasks.find(t => {
  if (t.taskId === searchId) return true;
  if (t.taskId.toLowerCase() === searchId.toLowerCase()) return true;
  return false;  // No fuzzy matching
});
```

**Files Fixed:**
- `checking-system-class-page.js` (lines 883-897)
- `checking-system-school-page.js` (lines 860-874)

**Pages Not Affected:**
- District/Group: No task-level views
- Student: Uses TaskValidator directly

---

## Task ID Reference

| File Name | Task ID in Cache | Notes |
|-----------|------------------|-------|
| CM.json | cm | NOT "chinesemorphology" |
| CCM.json | ccm | Different from CM! |
| FineMotor.json | finemotor | All lowercase |
| MF.json | mf | NOT "fm" |

**Rule:** Task ID = `section.file.replace('.json', '').toLowerCase()`

---

## Console Debugging Commands

```javascript
// 1. Inspect cache type
const cache = await window.JotFormCache.loadValidationCache();
console.log(cache instanceof Map);  // Should be true

// 2. List all students
console.log(Array.from(cache.keys()));

// 3. Get specific student
const student = cache.get("C10720");
console.log(student.studentName, student.gender);

// 4. Check CM task
const cm = student.setStatus.set3.tasks.find(t => t.taskId === 'cm');
console.log('CM:', cm.complete, cm.answered + '/' + cm.total);

// 5. List all tasks
for (const setId of ['set1','set2','set3','set4']) {
  console.log(setId + ':', student.setStatus[setId].tasks.map(t => t.taskId));
}
```

---

## References

- `assets/js/jotform-cache.js` - Cache implementation
- `assets/js/data-merger.js` - JotForm + Qualtrics merging
- `assets/js/task-validator.js` - Task validation logic
- `assets/tasks/survey-structure.json` - Task metadata

**Maintainer:** 4Set System Development Team
