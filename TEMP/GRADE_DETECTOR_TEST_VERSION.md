# Grade Detector Test Version - Implementation Summary

## Overview

This document describes the implementation of `grade-detector-test.js`, a test-specific version of the grade detection utility that supports both Node.js and browser environments.

## Changes from Production Version

The test version (`TEMP/grade-detector-test.js`) differs from the production version (`assets/js/grade-detector.js`) in the following ways:

### 1. Universal Module Definition (UMD) Pattern

**Production version (`assets/js/grade-detector.js`):**
```javascript
window.GradeDetector = (() => {
  // ... implementation ...
})();
```

**Test version (`TEMP/grade-detector-test.js`):**
```javascript
(function(global) {
  'use strict';
  
  const GradeDetector = (() => {
    // ... implementation ...
  })();

  // Export for both Node.js and browser environments
  if (typeof module !== 'undefined' && module.exports) {
    // Node.js
    module.exports = GradeDetector;
  } else if (typeof global !== 'undefined') {
    // Browser (attach to window or global)
    global.GradeDetector = GradeDetector;
  }
})(typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : this);
```

### 2. Additional Helper Function

The test version includes an additional helper function `getSchoolYear()` for utility purposes:

```javascript
/**
 * Helper function to get school year from a date
 * @param {Date|string} dateInput - Date object or ISO 8601 string
 * @returns {number|null} School year (e.g., 2024 for 2024/25 school year) or null if invalid
 */
function getSchoolYear(dateInput) {
  // ... implementation ...
}
```

## Why This Pattern?

Following the same pattern established in issue #90, test files in the TEMP folder use the UMD pattern to enable:

1. **Browser Testing**: Test HTML files can load the script and access it via `window.GradeDetector`
2. **Node.js Testing**: Test scripts can `require()` the module and use it in automated tests
3. **Consistency**: Matches the pattern used in other test files (`task-validator-test.js`, `jotform-cache-test.js`, `qualtrics-transformer-test.js`)

## Usage

### In Browser (HTML)

```html
<script src="grade-detector-test.js"></script>
<script>
  const grade = window.GradeDetector.determineGrade({
    recordedDate: "2024-10-07T05:10:05.400Z"
  });
  console.log(grade); // "K2"
</script>
```

### In Node.js

```javascript
const GradeDetector = require('./grade-detector-test.js');

const grade = GradeDetector.determineGrade({
  sessionkey: "10261_20251014_10_59"
});
console.log(grade); // "K3"
```

## Test Files

### Browser Test
- **File**: `TEMP/test-grade-detector-compatibility.html`
- **Purpose**: Visual browser-based test with 10 test cases
- **Run**: Open in browser

### Node.js Test
- **File**: `TEMP/test-grade-detector-node.js`
- **Purpose**: Automated command-line test with 12 test cases
- **Run**: `node test-grade-detector-node.js`

## Integration with Test Pipeline

The test version is used in:
- `TEMP/test-pipeline-core-id.html` - Replaces `../assets/js/grade-detector.js` with `grade-detector-test.js`

## Public API

Both versions expose the same public API:

1. **`determineGrade(data)`** - Hybrid approach using recordedDate or sessionkey
2. **`determineGradeFromRecordedDate(recordedDate)`** - Determine from Qualtrics date
3. **`determineGradeFromSessionKey(sessionkey)`** - Determine from JotForm sessionkey
4. **`getSchoolYear(dateInput)`** - Get school year number (test version only)

## Related Issues

- Issue #90: Established the UMD pattern for test files
- Issue #94: Mentioned grade-detector needs test version like other test files
- This issue: Implements the test version

## File Locations

```
4Set-Server/
├── assets/js/
│   └── grade-detector.js          # Production version (browser only)
└── TEMP/
    ├── grade-detector-test.js      # Test version (UMD - browser + Node.js)
    ├── test-grade-detector-compatibility.html  # Browser test
    └── test-grade-detector-node.js # Node.js test
```
