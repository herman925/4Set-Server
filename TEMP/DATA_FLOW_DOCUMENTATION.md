# Data Flow Documentation: JotForm Extraction & Merge Mechanisms

## Purpose
This document clarifies the unified data flow mechanism in the 4Set system per issue #121 investigation.

## Unified Data Schema: Answer Objects

**Key Principle:** Both JotForm and Qualtrics data are transformed to use the **same answer object schema** that TaskValidator expects.

```javascript
// Answer Object Schema (used by both sources)
{
  fieldName: {
    answer: "value",
    text: "value", 
    name: "fieldName"
  }
}
```

This ensures TaskValidator (the source of truth) can process both data sources without modification.

## Production & Test Pipeline Flow (Now Aligned)

```
┌─────────────┐     ┌──────────────┐
│ JotForm API │     │ Qualtrics API│
└──────┬──────┘     └──────┬───────┘
       │                   │
       ▼                   ▼
  Transform to         Transform to
  answer objects       answer objects
  { answer, text }     { answer, text }
       │                   │
       └───────┬───────────┘
               ▼
      ┌────────────────┐
      │  DataMerger    │
      │ - Grade-aware  │
      │ - Earliest wins│
      │ - Answer objs  │
      └────────┬───────┘
               │
               ▼
      ┌────────────────┐
      │ TaskValidator  │
      │ - Expects      │
      │   answer objs  │
      └────────────────┘
```

## Data Transformation

### JotForm Transformation
**Location:** `TEMP/test-pipeline-core-id.html` (test) / `assets/js/jotform-cache.js` (production)

```javascript
// Store FULL answer objects from JotForm API
for (const [qid, answerObj] of Object.entries(submission.answers)) {
  if (!answerObj.name || !answerObj.answer) continue;
  
  // answerObj already has the correct schema from JotForm API
  record[answerObj.name] = answerObj; // { answer, text, name, type, ... }
}
```

### Qualtrics Transformation  
**Location:** `TEMP/qualtrics-transformer-test.js`

```javascript
// Create answer objects to match JotForm schema
const value = this.extractValue(response.values, qidSpec);
if (value !== '') {
  result[fieldName] = {
    answer: value,
    text: value,
    name: fieldName
  };
}
```

## DataMerger: Answer Object Aware

**Location:** `assets/js/data-merger.js`

The DataMerger now:
1. **Extracts values** from answer objects for comparison
2. **Stores answer objects** (not raw values) in merged results
3. **Compares actual values** while preserving object structure

```javascript
// Extract value helper
extractAnswerValue(answerObj) {
  if (typeof answerObj === 'object' && answerObj !== null) {
    return answerObj.answer || answerObj.text || null;
  }
  return answerObj; // fallback for primitives
}

// Merge logic
const jotformValue = this.extractAnswerValue(jotformAnswerObj);
const qualtricsValue = this.extractAnswerValue(qualtricsAnswerObj);

// Compare values, but store answer objects
if (qualtricsTimestamp < jotformTimestamp) {
  merged[key] = qualtricsAnswerObj; // Store object, not value
}
```

## Merge Strategy: "Earliest Non-Empty Wins"

Both production and test use the same principle:

1. **Sort by timestamp** (earliest first)
2. **Extract values** from answer objects for comparison
3. **Keep earliest answer object** when conflicts occur
4. **Preserve object structure** for TaskValidator

## Grade-Based Grouping

Data is grouped by (CoreID, Grade) to prevent cross-grade merging:
- K1 data merges with K1 data only
- K2 data merges with K2 data only  
- K3 data merges with K3 data only

## TaskValidator Compatibility

TaskValidator expects answer objects and extracts values like:
```javascript
let studentAnswer = mergedAnswers[questionId]?.answer || 
                    mergedAnswers[questionId]?.text || 
                    null;
```

Since both JotForm and Qualtrics now produce answer objects, TaskValidator works correctly with both sources **without modification**.

## Changes Made (Revised Approach)

### 1. Test Pipeline JotForm Transformation
**File:** `TEMP/test-pipeline-core-id.html`

**Changed:** Store full answer objects instead of raw values
```javascript
// Before: record[answerObj.name] = value;
// After:  record[answerObj.name] = answerObj;
```

### 2. Qualtrics Transformer
**File:** `TEMP/qualtrics-transformer-test.js`

**Changed:** Create answer objects to match JotForm schema
```javascript
// Before: result[fieldName] = value;
// After:  result[fieldName] = { answer: value, text: value, name: fieldName };
```

### 3. DataMerger Enhancement
**File:** `assets/js/data-merger.js`

**Added:** `extractAnswerValue()` helper method  
**Updated:** Merge logic to handle answer objects instead of raw values

### 4. TaskValidator
**File:** `assets/js/task-validator.js`

**Status:** **NO CHANGES** - Works as designed with answer objects

## Why This Approach is Better

✅ **TaskValidator unchanged** - It's the source of truth for validation  
✅ **Data adapts to validator** - Not the other way around  
✅ **Unified schema** - Both sources use answer objects  
✅ **Production-aligned** - Test pipeline replicates production schema  
✅ **Maintainable** - Single validation logic, no dual-format handling  

## Verification Checklist

- [x] JotForm transformation produces answer objects
- [x] Qualtrics transformation produces answer objects
- [x] DataMerger handles answer objects correctly
- [x] TaskValidator unchanged (uses answer objects as designed)
- [x] Merge strategy is "earliest non-empty wins"
- [x] Grade-based grouping prevents cross-grade merging

## Conclusion

The alignment issue has been **RESOLVED** by adapting the data to fit TaskValidator's schema, rather than modifying TaskValidator to handle multiple formats.

**Key Insight:** TaskValidator is the source of truth. The data transformation layer should produce what TaskValidator expects (answer objects), not the other way around.

---

**Document Version:** 2.0  
**Last Updated:** 2025-10-27  
**Related Issue:** #121, #122

---

# Production vs Test Pipeline: Complete Comparison

## Executive Summary

This section provides a **1-to-1 comparison** between the production checking system (JotForm + Qualtrics pipeline) and the test environment (test pipeline in TEMP folder). This analysis was conducted without modifying any files, as requested.

### High-Level Finding
The production and test systems use **the same core logic** for calculation, validation, and data merging, but differ in:
1. **Error handling** (test has enhanced 502 error handling)
2. **Path resolution** (test supports TEMP folder location)
3. **File organization** (test uses isolated copies to avoid modifying production)
4. **Testing features** (test has comparison modes and performance metrics)

## System Architecture Comparison

### Production System (Checking System)
**Location:** `assets/js/` + `checking_system_*.html`

**Components:**
```
checking-system-student-page.js  → Student detail UI controller
checking-system-data-loader.js   → Data loading orchestrator
jotform-cache.js                 → Global cache (IndexedDB)
qualtrics-transformer.js         → Qualtrics → JotForm format
data-merger.js                   → Grade-aware merge (SHARED)
task-validator.js                → Validation engine (SHARED)
grade-detector.js                → K1/K2/K3 detection (SHARED)
```

**Purpose:** Production monitoring dashboard with 5-level drilldown
- District → Group → School → Class → Student

### Test System (Pipeline Test Tool)
**Location:** `TEMP/test-pipeline-core-id.html` + `TEMP/*.js`

**Components:**
```
test-pipeline-core-id.html       → Single-student test interface
jotform-cache-test.js            → Enhanced error handling (502)
qualtrics-transformer-test.js    → Multi-path resolution
data-merger.js                   → Grade-aware merge (SHARED)
task-validator-test.js           → Validation engine (SHARED via copy)
grade-detector-test.js           → K1/K2/K3 detection (SHARED via copy)
```

**Purpose:** Development/QA testing tool for validating pipeline correctness
- Single Core ID testing
- Performance comparison
- Direct vs cached fetch methods

## Detailed Component Comparison

### 1. JotForm Cache Module

#### Production: `assets/js/jotform-cache.js`
**Features:**
- Global IndexedDB cache (1-hour TTL)
- Batch fetching with adaptive sizing
- Handles **504 Gateway Timeout** errors
- Config loaded from `/config/jotform_config.json`
- Production error handling

**Error Handling:**
```javascript
if (response.status === 504) {
  // Reduce batch size by 50%
  currentBatchSize = Math.max(10, Math.floor(currentBatchSize * 0.5));
  console.warn(`[JotFormCache] 504 timeout, reducing batch to ${currentBatchSize}`);
}
```

#### Test: `TEMP/jotform-cache-test.js`
**Features:**
- Same global IndexedDB cache (1-hour TTL)
- Same batch fetching with adaptive sizing
- Handles **502 Bad Gateway AND 504 Gateway Timeout**
- Embedded config (no external file)
- Enhanced error handling for testing

**Error Handling:**
```javascript
if (response.status === 502 || response.status === 504) {
  // Reduce batch size by 50%
  currentBatchSize = Math.max(10, Math.floor(currentBatchSize * 0.5));
  console.warn(`[JotFormCache] 502/504 error, reducing batch to ${currentBatchSize}`);
}
```

**Key Difference:**
- ✅ Test version treats **502 Bad Gateway** same as 504 (batch size reduction)
- ✅ Production only handles 504 timeout
- 📝 This is a defensive enhancement for testing, not required in production

**Header Comment:**
```javascript
/**
 * TEST-SPECIFIC VERSION - JotForm Cache System
 * 
 * Changes from original:
 * - Handles 502 Bad Gateway errors with adaptive batch sizing
 * - Treats 502 like 504 as a signal to reduce batch size
 */
```

### 2. Qualtrics Transformer Module

#### Production: `assets/js/qualtrics-transformer.js`
**Path Resolution:**
```javascript
const response = await fetch('assets/qualtrics-mapping.json');
```
- Single path: `assets/qualtrics-mapping.json` (relative from root)
- Works for GitHub Pages deployment
- Assumes files run from root directory

#### Test: `TEMP/qualtrics-transformer-test.js`
**Path Resolution:**
```javascript
const pathsToTry = [
  '/assets/qualtrics-mapping.json',  // Absolute from root
  'assets/qualtrics-mapping.json',   // Relative from root
  '../assets/qualtrics-mapping.json' // Relative from TEMP folder
];

for (const path of pathsToTry) {
  try {
    response = await fetch(path);
    if (response.ok) break;
  } catch (err) { lastError = err; }
}
```

**Key Difference:**
- ✅ Test version tries **3 path variations** to support TEMP folder location
- ✅ Production assumes root-relative paths only
- 📝 This allows test to run from TEMP/ without modifying production paths

**Header Comment:**
```javascript
/**
 * TEST-SPECIFIC VERSION - Qualtrics Transformer Module
 * 
 * Changes from original:
 * - Multi-path resolution for qualtrics-mapping.json to support TEMP folder location
 * - Tries absolute, relative from root, and relative from TEMP paths
 */
```

### 3. Data Merger Module

#### Both Systems: `assets/js/data-merger.js`
**Status:** ✅ **IDENTICAL** - Both use the same file

**Key Features:**
- Grade-based grouping (CRITICAL: never merge different grades)
- "Earliest non-empty wins" merge strategy
- Answer object preservation
- Cross-source conflict detection
- Timestamp-based resolution

**Shared Logic:**
```javascript
// Step 1: Determine grade for ALL records BEFORE merging
// Step 2: Group by (coreId, grade) pair
// Step 3: Merge WITHIN each grade separately
// Step 4: Never mix K1, K2, K3 data
```

**No Differences:** This is the core merge logic used by both systems.

### 4. Task Validator Module

#### Production: `assets/js/task-validator.js`
**Scope:**
```javascript
window.TaskValidator = (() => {
  // Global scope for all pages
```

#### Test: `TEMP/task-validator-test.js`
**Scope:**
```javascript
(function(global) {
  'use strict';
  const TaskValidator = (() => {
    // Local scope for test isolation
```

**Key Difference:**
- ✅ Test version uses local scope to avoid polluting global namespace
- ✅ Production uses `window.TaskValidator` for global access
- 📝 Logic is **IDENTICAL** - test is a copy for isolation

**Comment in Test:**
```javascript
/**
 * TEST VERSION: Uses TEMP/assets/tasks/ directory for test isolation
 */
async function loadTaskMetadata() {
  const response = await fetch('assets/tasks/survey-structure.json');
  // Path works from both root and TEMP folder
}
```

### 5. Grade Detector Module

#### Both Systems: `assets/js/grade-detector.js`
**Status:** ✅ **IDENTICAL** - Test uses shared copy

**Key Features:**
- August-July school year boundaries
- K1 (2023/24), K2 (2024/25), K3 (2025/26)
- Supports `recordedDate` (Qualtrics ISO 8601)
- Supports `sessionkey` (JotForm YYYYMMDD format)

**No Differences:** Both systems share this module.

## Calculation & Validation Logic Comparison

### Termination Rules
**Status:** ✅ **IDENTICAL** across both systems

Both use centralized rules in `TaskValidator`:
- **ERV**: 3-stage termination (Q1-12, Q13-24, Q25-36)
- **CM**: 4-stage termination + 1 non-terminating stage
- **CWR**: 10 consecutive incorrect threshold
- **Fine Motor**: All square-cutting scores = 0
- **SYM/NONSYM**: 2-minute timeout detection

**Implementation:** `task-validator.js` Lines 83-250 (same in both)

### Completion Metrics
**Status:** ✅ **IDENTICAL** across both systems

**Exclusion Principle:**
> When termination or timeout occurs, questions AFTER that point are COMPLETELY EXCLUDED from total count.

**Examples:**
- CWR terminated at Q24: `total=24, answered=24 → 100% complete ✅`
- SYM timed out at Q53: `total=53, answered=53 → 100% complete ✅`
- CM terminated at Q7: `total=9 (P1,P2,Q1-Q7), answered=9 → 100% complete ✅`

**Implementation:** `task-validator.js` Lines 16-21 (same in both)

### Status Color Mapping
**Status:** ✅ **IDENTICAL** across both systems

| Icon | Meaning | Condition |
|------|---------|-----------|
| 🟢 Green | Complete | 100% up to termination |
| 🟡 Yellow | Post-term | Terminated/timed out |
| 🔴 Red | Incomplete | <100% before termination |
| ⚪ Grey | Not started | 0% answered |

**Implementation:** `task-validator.js` + `student-ui-renderer.js` (same logic)

## API Integration Comparison

### JotForm API Filter
**Status:** ✅ **IDENTICAL** - Both use `:matches` operator

**Working Filter (discovered October 2025):**
```javascript
const filter = { "q3:matches": coreId };  // Filter on sessionkey field (QID 3)
```

**Why This Works:**
- SessionKey format: `{studentId}_{YYYYMMDD}_{HH}_{MM}`
- Pattern matching on sessionkey contains student ID
- Server-side filtering actually works (returns only matches)

**Performance:**
- Old method: 545 submissions (~30 MB)
- New method: 2 submissions (~110 KB)
- Improvement: 99.6% reduction in data transfer

**Broken Filters (DO NOT USE):**
```javascript
{"20:eq":"10261"}           // ❌ Returns all 545 submissions
{"student-id:eq":"10261"}   // ❌ Returns all 545 submissions
{"20:contains":"10261"}     // ❌ Returns all 545 submissions
```

**Implementation:** Both systems use `jotform-cache.js` with same filter logic

### Qualtrics API Export Flow
**Status:** ✅ **IDENTICAL** across both systems

**Flow:**
1. **POST** `/surveys/{surveyId}/export-responses` - Start export
2. **GET** `/surveys/{surveyId}/export-responses/{progressId}` - Poll until complete
3. **GET** `/surveys/{surveyId}/export-responses/{fileId}/file` - Download JSON

**Implementation:** `qualtrics-api.js` (shared by both systems)

## Testing & Validation Features

### Test-Only Features (Not in Production)

#### 1. Performance Comparison Mode
**File:** `TEMP/test-pipeline-core-id.html`

**Features:**
- Direct API method (slower, ~5-15 seconds)
- Global cache method (faster, ~2-5 seconds after first run)
- Comparison mode (runs both, shows speedup factor)

**Example Output:**
```
Direct API:  12.45s  (Baseline)
Global Cache: 2.38s  (5.2x faster)
```

#### 2. Debug Inspector
**File:** `TEMP/test-pipeline-core-id.html`

**Features:**
- View raw JotForm data
- View raw Qualtrics data
- View merged data
- View validation results
- Expandable JSON viewers

#### 3. Embedded Credentials
**File:** `TEMP/test-pipeline-core-id.html`

**Features:**
- Credentials embedded in HTML (no external file)
- Qualtrics mapping embedded (no external file)
- Self-contained test page

### Production-Only Features (Not in Test)

#### 1. Multi-Level Drilldown
**Files:** `checking_system_1_district.html` through `checking_system_4_student.html`

**Features:**
- District-level aggregation
- Group-level aggregation
- School-level completion
- Class-level heatmaps
- Student detail validation

#### 2. Export Functionality
**File:** `assets/js/export-utils.js`

**Features:**
- CSV/Excel export with status lights
- Batch export for multiple students
- Validation of exported data

#### 3. Cache Management UI
**File:** `assets/js/cache-manager-ui.js`

**Features:**
- Clear cache button
- Cache refresh status
- Cache expiration warnings

## Error Handling Comparison

### Common Error Handling (Both Systems)

**Rate Limiting (429):**
```javascript
if (response.status === 429) {
  const retryAfter = response.headers.get('X-RateLimit-Remaining');
  await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
  // Retry request
}
```

**Authentication (401):**
```javascript
if (response.status === 401) {
  console.error('Invalid API key');
  throw new Error('Authentication failed');
}
```

**Network Errors:**
```javascript
try {
  const response = await fetch(url);
} catch (error) {
  console.error('Network error:', error);
  // Retry with exponential backoff
}
```

### Test-Only Error Handling

**502 Bad Gateway:**
```javascript
// Test handles 502 like 504 (batch size reduction)
if (response.status === 502 || response.status === 504) {
  currentBatchSize = Math.max(10, Math.floor(currentBatchSize * 0.5));
}
```

**Production Limitation:**
```javascript
// Production only handles 504
if (response.status === 504) {
  currentBatchSize = Math.max(10, Math.floor(currentBatchSize * 0.5));
}
```

## Configuration Comparison

### Production Configuration
**Files:** `config/*.json`

**Files:**
- `config/jotform_config.json` - JotForm rate limits
- `config/checking_system_config.json` - UI settings
- `config/agent.json` - Processor agent settings

**Example:**
```json
{
  "webFetch": {
    "initialBatchSize": 50,
    "minBatchSize": 10,
    "maxBatchSize": 100
  }
}
```

### Test Configuration
**Embedded in:** `TEMP/test-pipeline-core-id.html`

**Configuration:**
```javascript
// Embedded in HTML (no external files)
const credentials = {
  jotformApiKey: "...",
  jotformFormId: "...",
  qualtricsApiKey: "...",
  qualtricsSurveyId: "..."
};

const EMBEDDED_QUALTRICS_MAPPING = {
  // Full mapping embedded in HTML
};
```

**Reason:** Self-contained test page for portability

## File Organization Summary

### Production Files (17,625 lines total)
```
assets/js/
├── checking-system-*.js       # UI controllers
├── jotform-cache.js           # Cache (handles 504 only)
├── qualtrics-transformer.js   # Transformer (single path)
├── data-merger.js             # SHARED
├── task-validator.js          # SHARED
├── grade-detector.js          # SHARED
└── student-ui-renderer.js     # UI rendering

checking_system_*.html         # 5-level drilldown pages
PRDs/*.md                      # Documentation
```

### Test Files (3,050 lines total)
```
TEMP/
├── test-pipeline-core-id.html      # Test interface
├── jotform-cache-test.js           # Enhanced (handles 502+504)
├── qualtrics-transformer-test.js   # Multi-path resolution
├── task-validator-test.js          # Copy for isolation
├── grade-detector-test.js          # Copy for isolation
└── README_PIPELINE_TEST.md         # Documentation
```

### Shared Files (Used by Both)
```
assets/js/
├── data-merger.js          # Grade-aware merge
├── qualtrics-api.js        # Qualtrics export flow
├── jotform-api.js          # JotForm API wrapper
└── encryption.js           # Credential decryption
```

## Key Findings

### ✅ Same Core Logic
- Calculation rules: **IDENTICAL**
- Validation logic: **IDENTICAL**
- Merge strategy: **IDENTICAL**
- Grade detection: **IDENTICAL**
- Termination rules: **IDENTICAL**

### 📝 Defensive Enhancements (Test Only)
- 502 error handling (adaptive batch sizing)
- Multi-path resolution (TEMP folder support)
- Performance comparison metrics
- Debug inspectors

### 🎯 Different Purposes
- Production: Monitoring dashboard (5-level drilldown)
- Test: Development/QA tool (single-student testing)

### 🔗 Design Principle
- Test replicates production logic
- Test uses isolated copies to avoid modifying production
- Shared modules (data-merger, grade-detector) ensure consistency

## Conclusion

The production and test systems are **functionally identical** in terms of:
- Data merging (grade-aware, earliest wins)
- Calculation logic (termination, completion, correctness)
- Validation rules (TaskValidator as single source of truth)
- API integration (JotForm `:matches` filter, Qualtrics export flow)

The differences are **environmental adaptations**:
- Error handling enhancements for testing robustness
- Path resolution for TEMP folder isolation
- Testing features (performance comparison, debug inspectors)
- File organization (isolated copies vs shared production files)

**No discrepancies found** in calculation, validation, or merge logic between the two systems.

---

**Comparison Version:** 1.0  
**Analysis Date:** 2025-10-27  
**Related Issue:** As requested - full 1-to-1 comparison
