# Production Implementation Plan: Qualtrics Integration & Grade Detection

## Overview
This document outlines the complete implementation plan for deploying features tested in TEMP folder to production.

## Implementation Phases

### Phase 1: Grade Detection System
**File**: `assets/js/data-merger.js`

**Changes Required**:
1. Add `determineGrade()` function with August-July school year logic
2. Extract grade from both JotForm `sessionkey` and Qualtrics `recordedDate`
3. Add grade field to merged data output
4. Update merge function to include grade calculation

**Code to Add**:
```javascript
function determineGrade(sessionkey, recordedDate) {
  // Try recordedDate first (from Qualtrics)
  if (recordedDate) {
    const date = new Date(recordedDate);
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12
    
    // School year: Aug-Jul (Aug-Dec uses current year, Jan-Jul uses previous year)
    const schoolYear = month >= 8 ? year : year - 1;
    
    if (schoolYear === 2023) return 'K1';
    if (schoolYear === 2024) return 'K2';
    if (schoolYear === 2025) return 'K3';
  }
  
  // Fallback to sessionkey (from JotForm)
  if (sessionkey) {
    const parts = sessionkey.split('_');
    if (parts.length >= 2) {
      const datePart = parts[1]; // "YYYYMMDD"
      const year = parseInt(datePart.substring(0, 4));
      const month = parseInt(datePart.substring(4, 6));
      
      const schoolYear = month >= 8 ? year : year - 1;
      
      if (schoolYear === 2023) return 'K1';
      if (schoolYear === 2024) return 'K2';
      if (schoolYear === 2025) return 'K3';
    }
  }
  
  return 'Unknown';
}
```

### Phase 2: Complete Qualtrics Data Extraction
**File**: `assets/js/data-merger.js`

**Changes Required**:
1. Modify merge function to accept ALL Qualtrics fields (not just TGMD_*)
2. Implement proper precedence (Qualtrics overwrites JotForm)
3. Handle metadata fields properly

**Current Code** (line ~200):
```javascript
if (key.startsWith('TGMD_') && value) {
    merged[key] = { answer: value, text: value };
}
```

**New Code**:
```javascript
// Merge ALL Qualtrics fields with proper handling
if (value !== null && value !== undefined && value !== '') {
    // Skip internal Qualtrics metadata
    if (!key.startsWith('_') && key !== 'responseId') {
        merged[key] = { answer: value, text: value };
    }
}
```

### Phase 3: TGMD Matrix-Radio Scoring
**File**: `assets/js/task-validator.js`

**Changes Required**:
1. Detect TGMD task type in `validateTask()`
2. Implement trial-based scoring (t1 + t2 per row)
3. Change labels from "Correct/Incorrect" to "Success/Fail" for TGMD
4. Group by task field from TGMD.json

**New Function** (add after line ~100):
```javascript
function validateTGMDTask(taskId, questions, studentData) {
  const results = {
    taskId: taskId,
    title: getTaskTitle(taskId),
    questions: [],
    totalAnswered: 0,
    totalCorrect: 0,
    totalQuestions: questions.length,
    status: 'not_started',
    accuracy: 0
  };
  
  // TGMD uses matrix-radio with trials (t1, t2)
  questions.forEach(q => {
    // Each question has rows, each row has t1 and t2 trials
    q.rows.forEach(row => {
      const t1Key = `${row.id}_t1`;
      const t2Key = `${row.id}_t2`;
      
      const t1Value = parseInt(studentData[t1Key]?.answer || 0);
      const t2Value = parseInt(studentData[t2Key]?.answer || 0);
      
      const rowScore = t1Value + t2Value; // Max 2 per row
      const hasData = studentData[t1Key] || studentData[t2Key];
      
      if (hasData) {
        results.totalAnswered++;
        results.totalCorrect += rowScore;
        
        // Add trial results
        results.questions.push({
          id: t1Key,
          studentAnswer: t1Value,
          isCorrect: t1Value === 1,
          label: row.description + ' (Trial 1)',
          taskGroup: q.task
        });
        
        results.questions.push({
          id: t2Key,
          studentAnswer: t2Value,
          isCorrect: t2Value === 1,
          label: row.description + ' (Trial 2)',
          taskGroup: q.task
        });
      }
    });
  });
  
  results.accuracy = results.totalAnswered > 0 
    ? (results.totalCorrect / (results.totalAnswered * 2)) * 100 
    : 0;
    
  results.status = results.totalAnswered === results.totalQuestions 
    ? 'complete' 
    : results.totalAnswered > 0 ? 'incomplete' : 'not_started';
  
  return results;
}
```

### Phase 4: Unique Core ID Filtering
**File**: `assets/js/checking-system-filters.js`

**Changes Required**:
1. Deduplicate Core IDs when populating student dropdown
2. Use Set to ensure uniqueness

**Location**: Function `populateFilters()` around line ~150

**Current Code**:
```javascript
students.forEach(student => {
    // Add to dropdown
});
```

**New Code**:
```javascript
// Deduplicate Core IDs
const uniqueCoreIds = new Set();
const uniqueStudents = students.filter(student => {
    const coreId = student.coreId || student['student-id'];
    if (uniqueCoreIds.has(coreId)) {
        return false;
    }
    uniqueCoreIds.add(coreId);
    return true;
});

uniqueStudents.forEach(student => {
    // Add to dropdown
});
```

### Phase 5: Documentation Updates

**Files to Update**:
1. `USER_GUIDE_CHECKING_SYSTEM.md` - Add grade detection explanation
2. `USER_GUIDE_QUALTRICS_TGMD.md` - Update with complete Qualtrics integration
3. `README.md` - Add new features overview

**Sections to Add**:
- Grade Detection: How school years are calculated (Aug-Jul)
- Qualtrics Integration: All tasks now extracted, not just TGMD
- TGMD Scoring: Matrix-radio trial-based scoring explanation
- Filter Improvements: Unique Core ID deduplication

## Testing Checklist

- [ ] Grade detection works for all three school years (K1/K2/K3)
- [ ] Qualtrics extracts ALL task data (verify ERV, SYM, TOM, etc.)
- [ ] TGMD shows Success/Fail labels instead of Correct/Incorrect
- [ ] TGMD scores calculate correctly (t1 + t2 per row)
- [ ] Student filter dropdown shows unique Core IDs only
- [ ] No duplicate students in filter lists
- [ ] Grade field appears in merged data
- [ ] Backwards compatibility maintained (existing data still works)

## Rollback Plan

If issues occur:
1. Revert commits in reverse order
2. Restore from git history: `git checkout <commit_hash> -- <file>`
3. Test each rollback step
4. Document any data migration needs

## Notes

- This implementation builds on successfully tested features in TEMP folder
- All changes are backwards compatible
- Grade detection gracefully handles missing data
- TGMD scoring maintains same UI colors, just changes labels
- Filter deduplication improves UX without breaking functionality

## Implementation Order

1. **First**: Grade detection (foundational, needed by other features)
2. **Second**: Complete Qualtrics extraction (enables all tasks)
3. **Third**: TGMD scoring (uses extracted data)
4. **Fourth**: Unique filtering (UI improvement)
5. **Fifth**: Documentation (captures all changes)

Each phase should be:
- Implemented
- Tested
- Committed
- Documented
- Validated before proceeding to next phase
