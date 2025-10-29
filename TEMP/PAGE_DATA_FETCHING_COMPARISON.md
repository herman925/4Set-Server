# Data Fetching Comparison Across Checking System Pages

## Overview
This document compares how different pages in the checking system fetch and process student submission data, particularly regarding grade-aware filtering.

## Student Page (Updated in This PR)

### Method
`JotFormCache.getStudentSubmissions(coreId, grade)`

### Implementation
```javascript
// checking-system-student-page.js (line 456)
submissions = await window.JotFormCache.getStudentSubmissions(coreId, selectedGrade);
```

### Grade Filtering
- ✅ **Grade parameter passed**: `selectedGrade` (K1/K2/K3)
- ✅ **Submissions filtered**: Only returns submissions matching the specified grade
- ✅ **Cache key**: `student_jotform_${coreId}_${grade}` (grade-specific)

### Data Flow
```
getStudentSubmissions(coreId, 'K3')
├─ loadFromCache() → Get ALL cached submissions
├─ Filter by sessionkey (coreId match)
├─ Filter by grade (NEW): submissions.filter(s => s.grade === 'K3')
└─ Returns: Only K3 submissions for this student
```

## Class/School/District/Group Pages

### Method
`JotFormCache.buildStudentValidationCache(students, surveyStructure, credentials)`

### Implementation
```javascript
// checking-system-class-page.js (line 175)
const validationCache = await window.JotFormCache.buildStudentValidationCache(
  students,  // Pre-filtered by class grade
  surveyStructure,
  { formId, apiKey }
);
```

### Grade Filtering
- ✅ **Students pre-filtered**: Line 64: `students.filter(s => s.year === classGradeLabel)`
- ⚠️ **Submissions NOT filtered by grade**: Matches by coreId only
- ❌ **Potential issue**: Student with K1+K2+K3 data gets ALL submissions merged

### Data Flow
```
buildStudentValidationCache(K3Students, ...)
├─ getAllSubmissions() → Fetches ALL submissions (all grades)
├─ For each submission:
│   ├─ Extract studentId from answers
│   ├─ Find in students array (by coreId)
│   └─ If found: Add submission to student's list
│       ⚠️ NO GRADE CHECK - adds submission even if it's K1 or K2
└─ validateStudent(student, ALL_submissions)
    └─ Merges K1+K2+K3 submissions together
```

## The Problem

### Scenario
```
Student C10001:
  - K1 data: JotForm submission from 2023
  - K2 data: Qualtrics response from 2024
  - K3 data: JotForm submission from 2025

Class Page (K3 class):
  1. Filters students: Only K3 students
  2. buildStudentValidationCache([C10001], ...)
  3. getAllSubmissions() → Returns all 3 submissions
  4. Matches C10001 → Adds K1+K2+K3 submissions
  5. validateStudent() → Merges all 3 together ❌

Result: K3 class page shows merged K1+K2+K3 data
```

## Code References

### Student Page
**File**: `assets/js/checking-system-student-page.js`
- Line 407: Cache key includes grade
- Line 456: Passes `selectedGrade` to `getStudentSubmissions()`

### Class Page
**File**: `assets/js/checking-system-class-page.js`
- Line 64: Pre-filters students by grade
- Line 175: Calls `buildStudentValidationCache()` without grade parameter

### JotFormCache
**File**: `assets/js/jotform-cache.js`
- Line 630: `buildStudentValidationCache(students, surveyStructure, credentials, forceRebuild)`
- Line 659: `getAllSubmissions()` - no grade filter
- Line 674-687: Matches submissions by coreId only
- Line 1621: `getStudentSubmissions(coreId, grade)` - HAS grade filter (NEW)

## Recommendations

### Option 1: Add Grade Parameter to buildStudentValidationCache
```javascript
async buildStudentValidationCache(students, surveyStructure, credentials, forceRebuild = false, grade = null) {
  const submissions = await this.getAllSubmissions(credentials);
  
  // NEW: Filter by grade if specified
  const filteredSubmissions = grade 
    ? submissions.filter(s => s.grade === grade)
    : submissions;
  
  // Continue with filtered submissions
  for (const submission of filteredSubmissions) {
    // ... existing logic
  }
}
```

### Option 2: Infer Grade from Students Array
```javascript
// In buildStudentValidationCache
const studentGrades = new Set(students.map(s => s.year));
if (studentGrades.size === 1) {
  // All students are same grade - filter submissions
  const grade = Array.from(studentGrades)[0];
  submissions = submissions.filter(s => s.grade === grade);
}
```

### Option 3: Match by (coreId, grade) Pair
```javascript
// In buildStudentValidationCache
for (const submission of submissions) {
  const student = students.find(s => {
    const numericCoreId = s.coreId.startsWith('C') ? s.coreId.substring(1) : s.coreId;
    const submissionGrade = submission.grade;
    return numericCoreId === studentId && s.year === submissionGrade;
  });
  // ... rest of logic
}
```

## Testing Required

If implementing grade-aware filtering in `buildStudentValidationCache`:

1. **Class Page**: Verify K3 class only shows K3 data
2. **School Page**: Verify multi-grade school correctly separates K1/K2/K3
3. **Student Page**: Verify grade switching works (already tested)
4. **Data Consistency**: All pages should show same metrics for same student/grade

## Current Status

- ✅ Student page: Grade-aware (this PR)
- ⚠️ Class/school/district/group pages: Potentially mixing grades
- 📋 Recommendation: Update `buildStudentValidationCache` for consistency
