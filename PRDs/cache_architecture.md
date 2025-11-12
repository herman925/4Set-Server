# Cache Architecture PRD

**Project:** KeySteps@JC (Phase Two) - 4Set System 2025/26  
**Document Type:** Technical Specification  
**Last Updated:** November 12, 2025  
**Status:** Active

---

## Executive Summary

This document defines the cache architecture for the 4Set Checking System, which stores and retrieves validation data from IndexedDB for performance optimization and offline support. The cache eliminates the need to re-validate student data on every page load, reducing API calls and improving UI responsiveness.

---

## Table of Contents

1. [Cache Storage Overview](#cache-storage-overview)
2. [Validation Cache Structure](#validation-cache-structure)
3. [Data Flow Architecture](#data-flow-architecture)
4. [Cache Access Patterns](#cache-access-patterns)
5. [Known Issues and Fixes](#known-issues-and-fixes)
6. [Best Practices](#best-practices)

---

## Cache Storage Overview

### Storage Technology

**IndexedDB via LocalForage**
- Library: `localforage.js`
- Database: `JotFormCacheDB`
- Store Names:
  - `jotform_cache` - Raw JotForm submissions
  - `validation_cache` - Processed validation results
  - `qualtrics_cache` - Qualtrics survey data (future)

### Cache Instances

```javascript
// Validation cache instance
const validationStorage = localforage.createInstance({
  name: 'JotFormCacheDB',
  storeName: 'validation_cache'
});
```

---

## Validation Cache Structure

### Top-Level Cache Format

The validation cache is stored as a **Map** (converted to/from object for IndexedDB):

```javascript
{
  validations: {
    "C10720": { /* Student validation data */ },
    "C10721": { /* Student validation data */ },
    // ... more students
  },
  timestamp: 1699776000000,  // Cache creation time
  count: 427,                 // Number of students
  version: "1.0"             // Cache schema version
}
```

### Per-Student Cache Entry

Each student in the cache contains:

```javascript
{
  // Student Identity
  coreId: "C10720",
  studentId: "10720",
  studentName: "王小明",
  classId: "C001",
  schoolId: "S001",
  group: "1",
  district: "Central",
  gender: "M",
  
  // Raw Data
  submissions: [
    {
      id: "240511000000001",
      created_at: "2024-05-11 10:30:00",
      answers: { /* JotForm answer objects */ },
      grade: "K1"
    }
    // ... more submissions
  ],
  
  // Merged Data (earliest wins)
  mergedAnswers: {
    "ERV_Q1": {
      name: "ERV_Q1",
      answer: "2",
      text: "2",
      qid: "123",
      type: "control_radio"
    },
    "CM_Q1": { /* ... */ }
    // ... all answers merged by field name
  },
  
  // Task Validation Results
  taskValidation: {
    "erv": {
      taskId: "erv",
      answeredQuestions: 36,
      totalQuestions: 36,
      terminated: false,
      timedOut: false,
      hasPostTerminationAnswers: false,
      hasTerminationMismatch: false,
      questions: [ /* Question-level details */ ]
    },
    "cm": {
      taskId: "cm",
      answeredQuestions: 7,
      totalQuestions: 7,
      terminated: true,  // Stage-based termination
      timedOut: false,
      hasPostTerminationAnswers: false,
      hasTerminationMismatch: false,
      questions: [ /* Question-level details */ ]
    }
    // ... all tasks
  },
  
  // Set Completion Status
  setStatus: {
    "set1": {
      status: "complete",      // complete | incomplete | notstarted
      tasksComplete: 4,
      tasksStarted: 4,
      tasksTotal: 4,
      tasks: [
        {
          taskId: "erv",
          complete: true,
          answered: 36,
          total: 36,
          hasPostTerminationAnswers: false,
          hasTerminationMismatch: false,
          ignoredForIncompleteChecks: false
        }
        // ... all tasks in set1
      ]
    },
    "set2": { /* ... */ },
    "set3": {
      status: "complete",
      tasksComplete: 3,
      tasksStarted: 3,
      tasksTotal: 3,
      tasks: [
        {
          taskId: "headtoekneeshoulder",
          complete: true,
          answered: 16,
          total: 16,
          hasPostTerminationAnswers: false,
          hasTerminationMismatch: false,
          ignoredForIncompleteChecks: false
        },
        {
          taskId: "epn",
          complete: true,
          answered: 8,
          total: 8,
          hasPostTerminationAnswers: false,
          hasTerminationMismatch: false,
          ignoredForIncompleteChecks: false
        },
        {
          taskId: "cm",           // ⚠️ NOTE: Stored as "cm", NOT "chinesemorphology"
          complete: true,
          answered: 7,
          total: 7,
          hasPostTerminationAnswers: false,
          hasTerminationMismatch: false,
          ignoredForIncompleteChecks: false
        }
      ]
    },
    "set4": { /* ... */ }
  },
  
  // Summary Statistics
  overallStatus: "incomplete",
  completionPercentage: 75,
  totalTasks: 12,
  completeTasks: 9,
  incompleteTasks: 3,
  
  // Termination Tracking
  hasTerminations: true,
  terminationCount: 1,
  terminationTasks: ["cm"],
  hasPostTerminationData: false,
  
  // Metadata
  lastValidated: 1699776000000,
  validationVersion: "1.0"
}
```

---

## Data Flow Architecture

### Cache Building Process

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. FETCH SUBMISSIONS FROM JOTFORM                                │
│    - getAllSubmissions(credentials)                              │
│    - Filter by grade if single-grade class                       │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. GROUP BY STUDENT (Core ID)                                    │
│    - Match submissions to students in class                      │
│    - Handle multi-grade classes                                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. MERGE ANSWERS (Per Student)                                   │
│    - Sort by created_at (earliest first)                         │
│    - Convert from QID-keyed to name-keyed                        │
│    - First non-empty value wins                                  │
│    - Apply HTKS value mapping (choice→score)                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. VALIDATE TASKS (TaskValidator)                                │
│    - validateAllTasks(mergedAnswers)                             │
│    - Apply termination rules (ERV, CM, CWR, FM)                  │
│    - Calculate completion status                                 │
│    - Detect post-termination answers                             │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 5. BUILD SET STATUS                                              │
│    - Group tasks by set (1-4)                                    │
│    - Calculate set completion                                    │
│    - Handle gender-conditional tasks (TEC)                       │
│    - Exclude MF from Set 4 completion                            │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. SAVE TO INDEXEDDB                                             │
│    - Convert Map to object                                       │
│    - Store with timestamp and version                            │
└─────────────────────────────────────────────────────────────────┘
```

### Cache Loading Process

```
┌─────────────────────────────────────────────────────────────────┐
│ loadValidationCache()                                            │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. Load from IndexedDB (validation_cache store)                  │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Validate Cache Integrity                                      │
│    - Check timestamp (not stale)                                 │
│    - Verify schema (has taskValidation, setStatus)               │
│    - Detect bad data (all sets notstarted despite submissions)   │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Convert Object to Map                                         │
│    - Map<coreId, studentData>                                    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. Return to Consumer                                            │
│    - Class Page: Filter to class students                        │
│    - Student Page: Get single student                            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Cache Access Patterns

### Class Page (checking-system-class-page.js)

**Cache Usage:**
1. Loads validation cache on page init
2. Filters cache to students in current class
3. Uses `setStatus` for task-level status display
4. Uses exact matching to find tasks in setStatus.tasks array

**Critical Code Path:**
```javascript
// Load cache
const validationCache = await window.JotFormCache.buildStudentValidationCache(
  students, surveyStructure, credentials
);

// Access student data
for (const [coreId, cache] of validationCache.entries()) {
  const setStatus = cache.setStatus;
  
  // Display task status
  const taskStatus = getTaskStatus(setStatus, task, student);
}
```

**Task Matching Logic:**
```javascript
// Extract task name from survey structure file
// E.g., "CM.json" → "CM" → "cm"
const taskName = section.file.replace('.json', '').toLowerCase();

// Search in setStatus.tasks (EXACT MATCH ONLY)
const foundTask = set.tasks.find(t => t.taskId === taskName);
```

### Student Page (checking-system-student-page.js)

**Cache Usage:**
1. Loads cache for single student
2. Uses `mergedAnswers` to recalculate with TaskValidator
3. Uses live calculation results for status display
4. Does NOT rely on cached setStatus

**Critical Code Path:**
```javascript
// Load cache
const cache = await window.JotFormCache.loadValidationCache();
const studentData = cache.get(coreId);

// Recalculate validation (fresh)
const taskValidation = await window.TaskValidator.validateAllTasks(
  studentData.mergedAnswers
);

// Display status from LIVE calculation
populateTaskTables(taskValidation, studentData.mergedAnswers);
```

---

## Known Issues and Fixes

### Issue #1: Task Name Mismatch (FIXED)

**Problem:**
- Class Page searches for `"chinesemorphology"` (wrong)
- Cache stores tasks as `"cm"` (correct)
- Result: CM task shows grey instead of green

**Root Cause:**
- Survey structure file is `CM.json`, not `ChineseMorphology.json`
- Class Page should extract `"CM"` → `"cm"`, not assume long names

**Fix:**
- Survey structure already uses `CM.json` (correct)
- Cache correctly stores as `"cm"` (correct)
- Class Page correctly extracts file name (already working)

### Issue #2: Fuzzy Matching False Positives (FIXED - Nov 12, 2025)

**Problem:**
- Class Page search for `"cm"` matches `"ccm"` (Chinese Character Meaning)
- Fuzzy matching uses `.includes()` which causes substring false positives
- Result: CM shows grey (from CCM's incomplete status) instead of green

**Root Cause:**
```javascript
// OLD CODE (BUGGY)
const foundTask = set.tasks.find(t => 
  t.taskId === searchId || 
  t.taskId.includes(searchId) ||  // ❌ "ccm".includes("cm") = true
  searchId.includes(t.taskId)
);
```

**Fix Applied:**
```javascript
// NEW CODE (FIXED)
const foundTask = set.tasks.find(t => {
  // Exact match only (case-insensitive)
  if (t.taskId === searchId) return true;
  if (t.taskId.toLowerCase() === searchId.toLowerCase()) return true;
  
  // No fuzzy matching - prevents "cm" from matching "ccm"
  return false;
});
```

**Impact:**
- All task names in survey-structure.json match cache IDs exactly
- Fuzzy matching was never needed
- Fix eliminates false positives like:
  - `"cm"` → `"ccm"` ❌
  - `"fm"` → `"mf"` ❌
  - `"mf"` → `"fm"` ❌

**Files Changed:**
- `assets/js/checking-system-class-page.js` (lines 883-897)

### Issue #3: Gender-Conditional Task Handling

**Scenario:**
- TEC has two versions: `TEC_Male.json` and `TEC_Female.json`
- Cache stores as `tec_male` or `tec_female`
- Class Page displays as single `"TEC"` column

**Solution (Already Implemented):**
```javascript
// Class Page merges gender variants into single column
if (section.showIf && section.showIf.gender) {
  const baseTaskName = taskName.replace(/_Male|_Female/i, '');
  // Display as "TEC", search for appropriate variant based on student gender
}
```

---

## Best Practices

### Cache Invalidation

**When to Rebuild Cache:**
1. Submissions cache timestamp is newer than validation cache
2. Schema version mismatch (e.g., `validation_cache.version !== "1.0"`)
3. Validation shows all sets as `notstarted` despite having submissions
4. User clicks "Force Rebuild" button

**Invalidation Logic:**
```javascript
// Check if cache is stale
const submissionsCache = await this.loadFromCache();
if (cacheEntry.timestamp < submissionsCache.timestamp) {
  console.log('[JotFormCache] Validation cache is stale, will rebuild');
  return null;  // Trigger rebuild
}
```

### Task ID Consistency

**Rule:** Always use exact task IDs from `survey-structure.json` metadata

| Survey File | Metadata ID | Cache ID | Display Name |
|-------------|-------------|----------|--------------|
| CM.json | cm | cm | Chinese Morphology |
| CCM.json | ccm | ccm | Chinese Character Meaning |
| FM.json (FineMotor.json) | finemotor | finemotor | Fine Motor |
| MF.json | mf | mf | Math Fluency |

**DO NOT:**
- ❌ Use long-form names (`"ChineseMorphology"`) when file is `CM.json`
- ❌ Use fuzzy matching with `.includes()` (causes false positives)
- ❌ Assume task names based on display labels

**DO:**
- ✅ Extract task name from `section.file.replace('.json', '')`
- ✅ Use exact matching (`taskId === searchId`)
- ✅ Reference `taskMetadata` for canonical IDs and aliases

### Performance Optimization

**Cache Size:**
- ~427 students × ~50KB per student = ~21MB total
- IndexedDB handles this efficiently
- Consider pagination for 1000+ students

**Cache Age:**
- Display age in UI: `Math.round((Date.now() - timestamp) / 1000 / 60)` minutes
- Recommend rebuild after 30 minutes
- Auto-rebuild if > 24 hours old

**Lazy Loading:**
- Class Page: Load only students in class (filtered cache)
- Student Page: Load single student by coreId
- Don't load full cache unless needed (District/Group pages)

---

## Appendix: Cache API Reference

### JotFormCache.buildStudentValidationCache()

**Purpose:** Build validation cache for a list of students

**Signature:**
```javascript
async buildStudentValidationCache(
  students,        // Array of student objects
  surveyStructure, // Survey structure config
  credentials,     // JotForm API credentials
  forceRebuild = false  // Skip cache check
): Promise<Map<string, Object>>
```

**Returns:** Map of coreId → validation data

**Behavior:**
1. Checks for existing valid cache (unless `forceRebuild`)
2. Fetches submissions from JotForm
3. Merges answers per student
4. Validates with TaskValidator
5. Calculates set completion status
6. Saves to IndexedDB
7. Returns filtered Map for provided students

### JotFormCache.loadValidationCache()

**Purpose:** Load validation cache from IndexedDB

**Signature:**
```javascript
async loadValidationCache(): Promise<Map<string, Object> | null>
```

**Returns:** 
- `Map<coreId, studentData>` if valid cache exists
- `null` if no cache, stale, or invalid schema

**Validation Checks:**
1. Cache entry exists
2. Has `validations` object
3. Not stale (newer than submissions cache)
4. Has required fields (`taskValidation`, `setStatus`)
5. Not all sets showing `notstarted` despite submissions

### JotFormCache.saveValidationCache()

**Purpose:** Save validation cache to IndexedDB

**Signature:**
```javascript
async saveValidationCache(validationCache: Map<string, Object>): Promise<void>
```

**Storage Format:**
```javascript
{
  validations: { ...convertMapToObject(validationCache) },
  timestamp: Date.now(),
  count: validationCache.size,
  version: "1.0"
}
```

---

## Changelog

### November 12, 2025
- **Added:** Initial cache architecture documentation
- **Fixed:** Task name fuzzy matching false positives (Issue #2)
- **Documented:** Cache structure, data flow, and access patterns
- **Clarified:** Task ID consistency rules and best practices

---

## References

- **Related PRDs:**
  - `calculation_bible.md` - Task validation and termination rules
  - `checking_system_prd.md` - UI requirements and user flows
  
- **Source Files:**
  - `assets/js/jotform-cache.js` - Cache implementation
  - `assets/js/checking-system-class-page.js` - Class Page consumer
  - `assets/js/checking-system-student-page.js` - Student Page consumer
  - `assets/tasks/survey-structure.json` - Task metadata and structure

---

**Document Maintainer:** 4Set System Development Team  
**Review Cycle:** After major cache schema changes or bug fixes
