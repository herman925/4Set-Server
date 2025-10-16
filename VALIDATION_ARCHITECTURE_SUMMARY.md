# Validation Architecture - Quick Reference

## Visual Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    TaskValidator.js                             │
│              SINGLE SOURCE OF TRUTH                             │
│                                                                 │
│  📋 Centralized Termination Rules                               │
│  ✅ Question-level Validation                                   │
│  🚫 Post-termination Detection                                  │
│  ⏱️  Timeout Detection (SYM/NONSYM)                             │
│  🧮 Accurate Total Calculation                                  │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         │ Used by all validation
                         │
        ┌────────────────┴────────────────┐
        │                                 │
        ▼                                 ▼
┌──────────────────┐            ┌──────────────────┐
│  Student Page    │            │ JotFormCache     │
│  (Level 4)       │            │ Validation       │
│                  │            │ Builder          │
│  Direct call:    │            │                  │
│  validateAllTasks│            │ Calls per student│
│                  │            │ Caches in IndexDB│
│  ✅ Real-time    │            └────────┬─────────┘
│  ✅ Most accurate│                     │
└──────────────────┘                     │
                                         │
                                         │ Used by aggregation pages
                                         │
                        ┌────────────────┴────────────────┐
                        │                                 │
                        ▼                                 ▼
                ┌──────────────┐                 ┌──────────────┐
                │ Class Page   │                 │ School Page  │
                │ (Level 3)    │                 │ (Level 2)    │
                │              │                 │              │
                │ Aggregates   │                 │ Aggregates   │
                │ by class     │                 │ by school    │
                │              │                 │              │
                │ ✅ Consistent│                 │ ✅ Consistent│
                └──────────────┘                 └──────────────┘

        ┌──────────────────────────────────────────┐
        │  District/Group Pages (Level 1)         │
        │  Navigation Only - No Validation         │
        │  ✅ Correctly omits TaskValidator        │
        └──────────────────────────────────────────┘
```

## Validation Consistency Matrix

| Page | Uses TaskValidator? | Method | Status |
|------|---------------------|--------|--------|
| **Student** (L4) | ✅ Yes | Direct call | ✅ Accurate |
| **Class** (L3) | ✅ Yes | Via JotFormCache | ✅ Consistent |
| **School** (L2) | ✅ Yes | Via JotFormCache | ✅ Consistent |
| **District** (L1a) | ❌ No | N/A - Navigation only | ✅ Correct |
| **Group** (L1b) | ❌ No | N/A - Navigation only | ✅ Correct |

## Termination Rules Comparison

All pages using validation apply the **same rules**:

| Task | Rule Type | Implementation | Applied By |
|------|-----------|----------------|------------|
| ERV | Stage-based | 3 stages, threshold 5 | TaskValidator |
| CM | Stage-based | 4 stages, threshold 4 | TaskValidator |
| CWR | Consecutive incorrect | 10 consecutive | TaskValidator |
| Fine Motor | Threshold-based | All square-cutting = 0 | TaskValidator |
| SYM/NONSYM | Timeout | 2-minute timer each | TaskValidator |

## Key Code Locations

### TaskValidator (SSOT)
```javascript
// File: assets/js/task-validator.js
// Lines: 281-310 - TERMINATION_RULES configuration
// Lines: 328-532 - Termination handlers
// Lines: 559-687 - SYM/NONSYM timeout detection
```

### Student Page
```javascript
// File: assets/js/checking-system-student-page.js
// Lines: 645-670 - Direct TaskValidator call
const taskValidation = await window.TaskValidator.validateAllTasks(data.mergedAnswers);
```

### Class Page
```javascript
// File: assets/js/checking-system-class-page.js
// Lines: 124-149 - JotFormCache validation
const validationCache = await window.JotFormCache.buildStudentValidationCache(
  students,
  surveyStructure
);
```

### School Page
```javascript
// File: assets/js/checking-system-school-page.js
// Lines: 110-150 - JotFormCache validation
const validationCache = await window.JotFormCache.buildStudentValidationCache(
  students,
  surveyStructure
);
```

### JotFormCache Bridge
```javascript
// File: assets/js/jotform-cache.js
// Lines: 374-471 - buildStudentValidationCache()
// Lines: 577-811 - validateStudent()
// Line 611 - Calls TaskValidator internally
const taskValidation = await window.TaskValidator.validateAllTasks(mergedAnswers);
```

## Critical Calculation Rule

**PRD Mandate:** Questions after termination/timeout are **COMPLETELY EXCLUDED** from total count.

### Examples

```
Before Termination Adjustment:
❌ CWR terminated at Q24: 24/55 = 43% (WRONG)
❌ SYM timed out at Q53: 53/68 = 78% (WRONG)

After Termination Adjustment:
✅ CWR terminated at Q24: 24/24 = 100% (CORRECT)
✅ SYM timed out at Q53: 53/53 = 100% (CORRECT)
```

### Implementation
```javascript
// TaskValidator (lines 509-519)
if (terminationIndex >= 0) {
  // Only count questions up to and including termination point
  adjustedTotal = terminationIndex + 1;
  adjustedAnswered = taskResult.questions.slice(0, terminationIndex + 1)
                    .filter(q => q.studentAnswer !== null).length;
}
```

## Gender-Conditional Tasks

### Normalization
All pages normalize gender consistently:

```javascript
// Input: "M", "F", "Male", "Female", "m", "f"
// Output: "male" or "female"

let studentGender = (student.gender || '').toLowerCase();
if (studentGender === 'm' || studentGender === 'male') studentGender = 'male';
if (studentGender === 'f' || studentGender === 'female') studentGender = 'female';
```

### Task Assignment
- **Male students**: TEC_Male (not TEC_Female)
- **Female students**: TEC_Female (not TEC_Male)

Applied at:
- Student page: Task rendering
- Class page: Set total calculation
- School page: Set total calculation

## Validation Flow

### Student Page (Real-time)
```
1. Fetch submissions from JotFormCache
2. Merge submissions (earliest wins)
3. Call TaskValidator.validateAllTasks()
4. Render task tables with validation results
5. Show termination checklists
```

### Class/School Pages (Cached)
```
1. Get all students in class/school
2. Call JotFormCache.buildStudentValidationCache()
   ├─ For each student:
   │  ├─ Merge submissions
   │  ├─ Call TaskValidator.validateAllTasks()
   │  └─ Calculate set status
   └─ Cache results in IndexedDB
3. Aggregate cached results
4. Display class/school metrics
```

## Testing Checklist

### Verify Consistency
- [ ] ERV termination: Same total on student and class page?
- [ ] Gender tasks: TEC only shows correct variant?
- [ ] SYM timeout: Same completion % across pages?
- [ ] Post-termination: Data quality flags appear?

### Verify Rules
- [ ] ERV: <5 correct in stage triggers termination?
- [ ] CM: <4 correct in stage triggers termination?
- [ ] CWR: 10 consecutive incorrect triggers termination?
- [ ] FM: All square-cutting = 0 triggers termination?
- [ ] SYM/NONSYM: 2-minute timeout detected?

### Verify Totals
- [ ] Questions after termination excluded from total?
- [ ] Completion % = 100% when terminated properly?
- [ ] Post-termination answers flagged?

## System Status

### ✅ **All Validation Pages Are Consistent**

| Aspect | Status | Details |
|--------|--------|---------|
| Architecture | ✅ Correct | TaskValidator is SSOT |
| Student Page | ✅ Accurate | Direct TaskValidator call |
| Class Page | ✅ Consistent | Via JotFormCache |
| School Page | ✅ Consistent | Via JotFormCache |
| District/Group | ✅ Correct | Navigation only |
| Termination Rules | ✅ Unified | Centralized in TaskValidator |
| Question Counting | ✅ Uniform | Same exclusion logic |
| Gender Handling | ✅ Normalized | M/F → male/female |

### ⚠️ **Legacy Code (Not in Use)**

**File:** `assets/js/student-data-processor.js`
- Status: Deprecated (not used by any page)
- Action: Added deprecation warning
- Impact: None (no pages use this file)

---

## Quick Reference

### When to Use What

| Scenario | Use This | Why |
|----------|----------|-----|
| Individual student validation | `TaskValidator.validateAllTasks()` | Most accurate, real-time |
| Class aggregation | `JotFormCache.buildStudentValidationCache()` | Cached, consistent |
| School aggregation | `JotFormCache.buildStudentValidationCache()` | Cached, consistent |
| District/Group display | No validation needed | Navigation only |

### Key Principle

> **"One Source of Truth"**
> 
> All validation must go through TaskValidator to ensure consistency.
> Class and school pages use JotFormCache as a caching layer, but
> JotFormCache always calls TaskValidator internally.

---

**Document Date:** 2025-10-16  
**System Version:** 4Set Checking System v1.0  
**Architecture Status:** ✅ Validated and Documented
