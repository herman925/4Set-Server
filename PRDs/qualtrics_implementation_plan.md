---
title: Qualtrics Data Integration - Implementation Plan
owner: Project Maintainers
last-updated: 2025-10-17
status: Planning
---

# Qualtrics Data Integration - Implementation Plan

> **Document Purpose:** This plan outlines how to utilize the API design in `PRDs/jotform_qualtrics_integration_prd.md` to enable Qualtrics data import, dual-source merging, IndexedDB caching, and drilldown page integration through the existing validator and calculation rules.

**Reference Documents:**
- `PRDs/jotform_qualtrics_integration_prd.md` - Complete API specification
- `PRDs/checking_system_prd.md` - Validation architecture (esp. Student Page - 100% accurate)
- `PRDs/data-pipeline.md` - Data processing conventions
- `PRDs/task_completion_calculation_logic_prd.md` - Calculation rules

---

## Executive Summary

### Problem Statement
The 4Set system currently processes assessment data exclusively from JotForm (PDF upload pipeline). However, TGMD (Test of Gross Motor Development) assessments are administered via **Qualtrics** web surveys, creating a dual-source data scenario that requires intelligent merging.

### Solution Overview
1. **Fetch** Qualtrics TGMD data using existing Qualtrics API (documented in integration PRD)
2. **Transform** Qualtrics responses to standardized field format compatible with JotForm
3. **Merge** JotForm and Qualtrics datasets with conflict resolution
4. **Cache** merged dataset in IndexedDB for offline access and performance
5. **Validate** using existing TaskValidator.js (single source of truth)
6. **Display** in checking system drilldown pages with proper attribution

### Key Design Decisions

#### 1. TaskValidator as Single Source of Truth
**Decision:** All validation logic remains in `assets/js/task-validator.js`
- **Rationale:** Proven 100% accurate on Student page, centralizes business logic
- **Impact:** Qualtrics integration must NOT duplicate validation rules
- **Pattern:** Fetch → Transform → Merge → Cache → TaskValidator.validateAllTasks()

#### 2. Dual-Source Merge Strategy
**Decision:** Qualtrics data takes precedence for TGMD fields, JotForm for all others
- **Rationale:** Qualtrics is native TGMD platform (web survey), JotForm is manual fallback
- **Conflict Detection:** Flag mismatches, store both values in metadata
- **Transparency:** UI shows data source (`_tgmdSource: "qualtrics"` or `"jotform"`)

#### 3. IndexedDB Hierarchical Cache (Existing Pattern)
**Decision:** Use existing cache architecture from `jotform-cache.js`
- **Rationale:** Already handles 30 MB JotForm cache in IndexedDB
- **Extension:** Add Qualtrics responses to same database (separate store)
- **Merge Layer:** Pre-compute merged dataset in `cache` store for instant retrieval

---

## System Architecture

### Current State (JotForm Only)
```
┌─────────────────────────────────────────────────────────────┐
│                    JotForm API (PDF Pipeline)                │
│               544 submissions, ~30 MB raw data               │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              JotForm Cache (IndexedDB - cache store)         │
│          Cache Key: jotform_global_cache                     │
│          TTL: 1 hour                                         │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              Checking System Drilldown Pages                 │
│  • Student Detail (Level 4)                                  │
│  • Class Summary (Level 3)                                   │
│  • School Overview (Level 2)                                 │
│  • Group/District (Level 1)                                  │
└─────────────────────────────────────────────────────────────┘
                         │
                         ↓
┌─────────────────────────────────────────────────────────────┐
│              TaskValidator.js (Validation Engine)            │
│  • 100% accurate validation                                  │
│  • Question-level correctness checking                       │
│  • Termination rule application                              │
│  • Completion status calculation                             │
└─────────────────────────────────────────────────────────────┘
```

### Target State (JotForm + Qualtrics)
```
┌──────────────────────┐  ┌──────────────────────────────────┐
│   JotForm API        │  │      Qualtrics API               │
│   (PDF Pipeline)     │  │      (TGMD Surveys)              │
│   544 submissions    │  │      ~200 TGMD responses         │
└──────────┬───────────┘  └───────────────┬──────────────────┘
           │                               │
           ↓                               ↓
┌──────────────────────────────────────────────────────────────┐
│        IndexedDB: JotFormCacheDB                             │
├──────────────────────────────────────────────────────────────┤
│  Store: cache (merged data)                                  │
│    Key: jotform_global_cache                                 │
│    Value: { submissions: [...merged...], timestamp, count }  │
│                                                               │
│  Store: qualtrics_cache (raw Qualtrics responses)            │
│    Key: qualtrics_responses                                  │
│    Value: { responses: [...], timestamp, surveyId }          │
│                                                               │
│  Store: student_validation (pre-computed validation)         │
│    Key: {coreId}                                             │
│    Value: { taskValidation: {...}, setStatus: {...} }        │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ↓
┌──────────────────────────────────────────────────────────────┐
│                 Data Merger Module                           │
│  • Fetch both sources                                        │
│  • Transform Qualtrics to standard format                    │
│  • Merge by sessionkey with conflict resolution              │
│  • Mark data source and conflicts                            │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ↓
┌──────────────────────────────────────────────────────────────┐
│              TaskValidator.js (Unchanged)                    │
│  • Validates merged dataset                                  │
│  • Unaware of data source                                    │
│  • Single source of truth for business logic                 │
└──────────────────────┬───────────────────────────────────────┘
                       │
                       ↓
┌──────────────────────────────────────────────────────────────┐
│              Drilldown Pages (Enhanced)                      │
│  • Student: Show TGMD data source badge                      │
│  • Class: Aggregate TGMD completion                          │
│  • School/Group/District: Summary metrics                    │
│  • Conflict indicators where applicable                      │
└──────────────────────────────────────────────────────────────┘
```

---

## Data Flow & API Integration

### Phase 1: Qualtrics Data Extraction

#### Step 1.1: Credential Retrieval
**Location:** `checking_system_home.html` (password prompt on load)

**Process:**
```javascript
// Already implemented in home page
const credentials = await window.decryptCredentials(systemPassword);

// Expected structure (see PRD lines 1164-1170):
{
  qualtricsApiToken: "raV8YenlxaFux...",  // API token
  qualtricsDatacenter: "au1",              // Datacenter region
  qualtricsSurveyId: "SV_23Qbs14soOkGo9E" // TGMD survey ID
}
```

**Storage:** `sessionStorage` (cleared on tab close, same as JotForm credentials)

#### Step 1.2: Field Mapping Configuration
**File:** `assets/qualtrics-mapping.json` (already exists)

**Purpose:** Map Qualtrics Question IDs (QIDs) to standardized field names

**Structure Example (lines 1496-1510):**
```json
{
  "sessionkey": "sessionkey",
  "student-id": "QID125287935_TEXT",
  "school-id": "QID125287936_TEXT",
  "TGMD_Hand": "QID126166418",
  "TGMD_Leg": "QID126166419",
  "TGMD_111_Hop_t1": "QID126166420#1_1",
  "TGMD_112_Hop_t1": "QID126166420#1_2"
}
```

**Patterns:**
- Simple fields: Direct QID mapping
- Matrix sub-questions: `QID#{rowId}_{columnId}` syntax
- Text entry: `QID_TEXT` suffix
- Embedded data: Field name (no QID)

#### Step 1.3: Start Export Request
**API:** `POST /API/v3/surveys/{surveyId}/export-responses`

**Implementation:**
```javascript
async function startQualtricsExport(credentials, mapping) {
  const { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId } = credentials;
  const baseUrl = `https://${qualtricsDatacenter}.qualtrics.com/API/v3`;
  
  // Extract TGMD QIDs from mapping (see PRD lines 1722-1726)
  const tgmdQids = Object.entries(mapping)
    .filter(([key]) => key.startsWith('TGMD_'))
    .map(([_, qid]) => qid.split('#')[0]) // Extract base QID
    .filter((v, i, a) => a.indexOf(v) === i); // Unique
  
  const exportPayload = {
    format: 'json',
    compress: false,
    useLabels: false,
    questionIds: tgmdQids,
    embeddedDataIds: ['student-id', 'sessionkey', 'school-id', 'class-id'],
    surveyMetadataIds: ['startDate', 'endDate', 'recordedDate']
  };
  
  const response = await fetch(
    `${baseUrl}/surveys/${qualtricsSurveyId}/export-responses`,
    {
      method: 'POST',
      headers: {
        'X-API-TOKEN': qualtricsApiToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(exportPayload)
    }
  );
  
  const { result: { progressId } } = await response.json();
  console.log('[Qualtrics] Export started:', progressId);
  return progressId;
}
```

#### Step 1.4: Poll Export Progress
**API:** `GET /API/v3/surveys/{surveyId}/export-responses/{progressId}`

**Implementation (see PRD lines 1752-1775):**
```javascript
async function pollExportProgress(credentials, progressId) {
  const { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId } = credentials;
  const baseUrl = `https://${qualtricsDatacenter}.qualtrics.com/API/v3`;
  
  let fileId = null;
  let attempts = 0;
  const maxAttempts = 60; // 2 minutes (2 seconds per attempt)
  
  while (!fileId && attempts < maxAttempts) {
    await sleep(attempts === 0 ? 3000 : 2000); // 3s first, then 2s
    
    const response = await fetch(
      `${baseUrl}/surveys/${qualtricsSurveyId}/export-responses/${progressId}`,
      { headers: { 'X-API-TOKEN': qualtricsApiToken } }
    );
    
    const { result } = await response.json();
    console.log(`[Qualtrics] Progress: ${result.percentComplete}%`);
    
    if (result.status === 'complete') {
      fileId = result.fileId;
    } else if (result.status === 'failed') {
      throw new Error('Qualtrics export failed');
    }
    
    attempts++;
  }
  
  if (!fileId) {
    throw new Error('Qualtrics export timeout after 2 minutes');
  }
  
  return fileId;
}
```

#### Step 1.5: Download Export File
**API:** `GET /API/v3/surveys/{surveyId}/export-responses/{fileId}/file`

**Implementation (see PRD lines 1782-1796):**
```javascript
async function downloadQualtricsExport(credentials, fileId) {
  const { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId } = credentials;
  const baseUrl = `https://${qualtricsDatacenter}.qualtrics.com/API/v3`;
  
  const response = await fetch(
    `${baseUrl}/surveys/${qualtricsSurveyId}/export-responses/${fileId}/file`,
    { headers: { 'X-API-TOKEN': qualtricsApiToken } }
  );
  
  const exportData = await response.json();
  console.log('[Qualtrics] Downloaded', exportData.responses.length, 'responses');
  
  return exportData.responses;
}
```

---

### Phase 2: Data Transformation

#### Step 2.1: Transform Qualtrics Responses to Standard Format

**Purpose:** Convert Qualtrics QID-based responses to field names matching JotForm structure

**Implementation (see PRD lines 1798-1831):**
```javascript
function transformQualtricsResponse(response, mapping) {
  const result = {
    sessionkey: response.values.sessionkey || '',
    'student-id': response.values['student-id'] || '',
    'school-id': response.values['school-id'] || '',
    _meta: {
      source: 'qualtrics',
      qualtricsResponseId: response.responseId,
      retrievedAt: new Date().toISOString()
    }
  };
  
  // Transform each mapped TGMD field
  for (const [fieldName, qidSpec] of Object.entries(mapping)) {
    if (!fieldName.startsWith('TGMD_')) continue;
    
    if (qidSpec.includes('#')) {
      // Matrix sub-question: "QID126166420#1_1"
      const [qid, subKey] = qidSpec.split('#');
      const matrixData = response.values[qid];
      result[fieldName] = matrixData?.[subKey] || '';
    } else if (qidSpec.endsWith('_TEXT')) {
      // Text entry sub-field
      const qid = qidSpec.replace('_TEXT', '');
      const textData = response.values[qid];
      result[fieldName] = textData?.text || textData || '';
    } else {
      // Simple field
      result[fieldName] = response.values[qidSpec] || '';
    }
  }
  
  return result;
}
```

**Example Transformation:**

**Input (Qualtrics Response):**
```json
{
  "responseId": "R_abc123",
  "values": {
    "sessionkey": "10261_20251005_10_30",
    "student-id": "10261",
    "QID126166418": "1",
    "QID126166420": {
      "1_1": "1",
      "1_2": "0",
      "1_3": "1",
      "1_4": "1"
    }
  }
}
```

**Output (Standard Format):**
```json
{
  "sessionkey": "10261_20251005_10_30",
  "student-id": "10261",
  "TGMD_Hand": "1",
  "TGMD_111_Hop_t1": "1",
  "TGMD_112_Hop_t1": "0",
  "TGMD_113_Hop_t1": "1",
  "TGMD_114_Hop_t1": "1",
  "_meta": {
    "source": "qualtrics",
    "qualtricsResponseId": "R_abc123",
    "retrievedAt": "2025-10-17T09:30:00Z"
  }
}
```

---

### Phase 3: Data Merging

#### Step 3.1: Merge Strategy (Sessionkey Alignment)

**Key Principle:** Sessionkey is the immutable primary key across both sources

**Merge Algorithm (see PRD lines 1856-1888):**
```javascript
function mergeDataSources(jotformData, qualtricsData) {
  const merged = new Map(); // sessionkey → merged record
  
  // Step 1: Add all JotForm records as base
  for (const record of jotformData) {
    const key = record.sessionkey;
    merged.set(key, {
      ...record,
      _sources: ['jotform']
    });
  }
  
  // Step 2: Merge Qualtrics records
  for (const record of qualtricsData) {
    const key = record.sessionkey;
    
    if (merged.has(key)) {
      // Existing record - merge TGMD fields
      const existing = merged.get(key);
      const mergedRecord = mergeTGMDFields(existing, record);
      merged.set(key, mergedRecord);
    } else {
      // New record from Qualtrics
      merged.set(key, {
        ...record,
        _sources: ['qualtrics']
      });
    }
  }
  
  return Array.from(merged.values());
}
```

#### Step 3.2: Field-Level Merging with Conflict Detection

**Rules (see PRD lines 1892-1949):**
1. **Priority:** Qualtrics data takes precedence for TGMD fields
2. **Selective Merge:** Only TGMD_* fields are merged
3. **Conflict Detection:** Flag when values differ between sources

**Implementation:**
```javascript
function mergeTGMDFields(jotformRecord, qualtricsRecord) {
  const merged = { ...jotformRecord };
  const conflicts = [];
  
  // Extract TGMD fields from Qualtrics
  for (const [key, value] of Object.entries(qualtricsRecord)) {
    if (!key.startsWith('TGMD_')) continue;
    
    const jotformValue = jotformRecord[key];
    const qualtricsValue = value;
    
    // Detect conflicts
    if (jotformValue && qualtricsValue && jotformValue !== qualtricsValue) {
      conflicts.push({
        field: key,
        jotform: jotformValue,
        qualtrics: qualtricsValue,
        resolution: 'qualtrics' // Using Qualtrics value
      });
    }
    
    // Always use Qualtrics value for TGMD fields
    merged[key] = qualtricsValue;
  }
  
  // Update metadata
  merged._sources = ['jotform', 'qualtrics'];
  merged._tgmdSource = 'qualtrics';
  if (conflicts.length > 0) {
    merged._tgmdConflicts = conflicts;
  }
  
  // Preserve Qualtrics metadata
  merged._meta = {
    ...merged._meta,
    qualtricsResponseId: qualtricsRecord._meta.qualtricsResponseId,
    qualtricsRetrievedAt: qualtricsRecord._meta.retrievedAt
  };
  
  return merged;
}
```

#### Step 3.3: Merge Validation & Statistics

**Implementation (see PRD lines 1956-1988):**
```javascript
function validateMergedData(mergedRecords) {
  const validation = {
    total: mergedRecords.length,
    withTGMD: 0,
    tgmdFromQualtrics: 0,
    tgmdFromJotform: 0,
    tgmdConflicts: 0,
    missingTGMD: []
  };
  
  for (const record of mergedRecords) {
    const hasTGMD = record['TGMD_Hand'] || record['TGMD_Leg'];
    
    if (hasTGMD) {
      validation.withTGMD++;
      
      if (record._tgmdSource === 'qualtrics') {
        validation.tgmdFromQualtrics++;
      } else if (record._sources.includes('jotform')) {
        validation.tgmdFromJotform++;
      }
      
      if (record._tgmdConflicts) {
        validation.tgmdConflicts++;
      }
    } else {
      validation.missingTGMD.push(record.sessionkey);
    }
  }
  
  console.log('[Data Merge] Validation:', validation);
  return validation;
}
```

**Example Output:**
```javascript
{
  total: 544,
  withTGMD: 198,
  tgmdFromQualtrics: 156,
  tgmdFromJotform: 42,
  tgmdConflicts: 3,
  missingTGMD: ["10001_20251001_10_30", "10042_20251002_14_15", ...]
}
```

---

### Phase 4: IndexedDB Caching

#### Step 4.1: Cache Architecture

**Database:** `JotFormCacheDB` (already exists)

**Stores:**
```javascript
// Store 1: Merged cache (primary data source for UI)
{
  name: 'cache',
  keyPath: 'key',
  entry: {
    key: 'jotform_global_cache',
    submissions: [...merged records...],
    timestamp: 1234567890,
    count: 544,
    qualtricsLastSync: "2025-10-17T09:30:00Z",
    version: 2
  }
}

// Store 2: Qualtrics raw responses (for refresh)
{
  name: 'qualtrics_cache',
  keyPath: 'key',
  entry: {
    key: 'qualtrics_responses',
    responses: [...raw Qualtrics responses...],
    timestamp: 1234567890,
    surveyId: "SV_23Qbs14soOkGo9E"
  }
}

// Store 3: Student validation (pre-computed TaskValidator results)
{
  name: 'student_validation',
  keyPath: 'coreId',
  entry: {
    coreId: "C10001",
    taskValidation: { /* TaskValidator output */ },
    setStatus: { /* Set completion status */ },
    lastValidated: 1234567890
  }
}
```

#### Step 4.2: Cache Manager Extension

**File:** `assets/js/jotform-cache.js` (extend existing class)

**New Methods:**
```javascript
class JotFormCache {
  // ... existing methods ...
  
  /**
   * Fetch Qualtrics data and merge with JotForm
   * @returns {Promise<Object>} Merge statistics
   */
  async refreshWithQualtrics() {
    console.log('[JotFormCache] Starting Qualtrics refresh...');
    
    // Step 1: Fetch JotForm data (use existing cache system)
    const jotformData = await this.getAllSubmissions(credentials);
    console.log('[JotFormCache] JotForm:', jotformData.length, 'submissions');
    
    // Step 2: Fetch Qualtrics data
    const qualtricsData = await this.fetchQualtricsData();
    console.log('[JotFormCache] Qualtrics:', qualtricsData.length, 'responses');
    
    // Step 3: Merge datasets
    const mergedData = mergeDataSources(jotformData, qualtricsData);
    console.log('[JotFormCache] Merged:', mergedData.length, 'records');
    
    // Step 4: Validate merge
    const validation = validateMergedData(mergedData);
    console.log('[JotFormCache] Validation:', validation);
    
    // Step 5: Cache Qualtrics data separately (for incremental refresh)
    const qualtricsStorage = localforage.createInstance({
      name: 'JotFormCacheDB',
      storeName: 'qualtrics_cache'
    });
    await qualtricsStorage.setItem('qualtrics_responses', {
      timestamp: Date.now(),
      responses: qualtricsData,
      surveyId: credentials.qualtricsSurveyId
    });
    
    // Step 6: Update main cache with merged data
    await this.saveToCache(mergedData);
    console.log('[JotFormCache] ✅ Cache refresh complete');
    
    return {
      success: true,
      stats: validation
    };
  }
  
  /**
   * Fetch all Qualtrics responses
   * @returns {Promise<Array>} Transformed responses
   */
  async fetchQualtricsData() {
    const credentials = await this.getCredentials();
    const mapping = await this.loadQualtricsMapping();
    
    // Step 1: Start export
    const progressId = await startQualtricsExport(credentials, mapping);
    
    // Step 2: Poll progress
    const fileId = await pollExportProgress(credentials, progressId);
    
    // Step 3: Download file
    const responses = await downloadQualtricsExport(credentials, fileId);
    
    // Step 4: Transform responses
    const transformedData = responses.map(response => 
      transformQualtricsResponse(response, mapping)
    );
    
    return transformedData;
  }
  
  /**
   * Load Qualtrics field mapping
   * @returns {Promise<Object>} Mapping object
   */
  async loadQualtricsMapping() {
    const response = await fetch('assets/qualtrics-mapping.json');
    return await response.json();
  }
}
```

#### Step 4.3: Cache Refresh UI Integration

**Location:** `checking_system_home.html` (Cache Manager UI)

**New Button:** "Refresh with Qualtrics Data"

**Implementation:**
```javascript
// In cache-manager-ui.js
async function refreshWithQualtrics() {
  // Show modal with progress
  showSyncModal('Syncing with Qualtrics...');
  
  try {
    // Fetch and merge
    const result = await window.JotFormCache.refreshWithQualtrics();
    
    // Show results
    showSyncComplete(`
      ✅ Sync complete!
      
      Total records: ${result.stats.total}
      TGMD from Qualtrics: ${result.stats.tgmdFromQualtrics}
      TGMD from JotForm: ${result.stats.tgmdFromJotform}
      Conflicts detected: ${result.stats.tgmdConflicts}
    `);
    
    // Update status pill
    updateStatusPill('green', 'System Ready');
    
  } catch (error) {
    console.error('[Qualtrics] Refresh failed:', error);
    showSyncError(error.message);
  }
}
```

---

### Phase 5: Validation Integration

#### Step 5.1: TaskValidator Pattern (Unchanged)

**File:** `assets/js/task-validator.js` (NO CHANGES REQUIRED)

**Key Point:** TaskValidator is data-source agnostic. It receives merged answers and validates them according to business rules.

**Usage:**
```javascript
// In student detail page
const mergedAnswers = await JotFormCache.getStudentSubmissions(coreId);
const taskValidation = await window.TaskValidator.validateAllTasks(mergedAnswers);

// TaskValidator output structure (PRD lines 776-825):
{
  "erv": {
    taskId: "erv",
    title: "English Vocab",
    questions: [...],
    totals: { total: 51, answered: 51, correct: 48 },
    terminated: false
  },
  "sym": {
    taskId: "sym",
    title: "Symbolic / Non-Symbolic",
    questions: [...],  // Combined 112 questions
    totals: { total: 112, answered: 91, correct: 88 },
    timedOut: true
  }
  // ... all 14 tasks
}
```

#### Step 5.2: Student Validation Cache (Pre-computation)

**Purpose:** Store TaskValidator results to avoid re-validation on every page load

**Structure (see PRD lines 828-917):**
```javascript
{
  // Identity
  coreId: "C10001",
  studentId: "St11121",
  studentName: "張梓煋",
  
  // Raw submissions
  submissions: [...],
  mergedAnswers: {...},
  
  // TaskValidator output (pre-computed once)
  taskValidation: {
    erv: { totals: {...}, questions: [...] },
    sym: { totals: {...}, questions: [...] },
    // ... all 14 tasks
  },
  
  // Set-level summary
  setStatus: {
    set1: { 
      status: 'incomplete',
      tasksComplete: 3,
      tasksTotal: 4,
      tasks: [...]
    },
    // ... all 4 sets
  },
  
  // Student-level aggregate
  overallStatus: 'incomplete',
  completionPercentage: 85.7,
  totalTasks: 14,
  completeTasks: 12,
  
  // Alert flags
  hasTerminations: true,
  terminationCount: 1,
  terminationTasks: ['chinesewordreading'],
  
  // Metadata
  lastValidated: 1234567890,
  validationVersion: "1.0"
}
```

**Cache Building:**
```javascript
async function buildStudentValidationCache(studentGroups) {
  const validationStorage = localforage.createInstance({
    name: 'JotFormCacheDB',
    storeName: 'student_validation'
  });
  
  for (const [coreId, submissions] of Object.entries(studentGroups)) {
    // Merge submissions
    const mergedAnswers = mergeStudentSubmissions(submissions);
    
    // Validate with TaskValidator
    const taskValidation = await window.TaskValidator.validateAllTasks(mergedAnswers);
    
    // Calculate set status
    const setStatus = calculateSetStatus(taskValidation);
    
    // Calculate overall status
    const overallStatus = calculateOverallStatus(setStatus);
    
    // Store in cache
    await validationStorage.setItem(coreId, {
      coreId,
      submissions,
      mergedAnswers,
      taskValidation,
      setStatus,
      overallStatus,
      lastValidated: Date.now(),
      validationVersion: "1.0"
    });
  }
}
```

---

### Phase 6: UI Display Integration

#### Step 6.1: Student Detail Page Enhancements

**File:** `checking_system_4_student.html` and `checking-system-student-page.js`

**New Elements:**

**1. TGMD Data Source Badge:**
```html
<!-- In task row header -->
<div class="task-header">
  <h3>TGMD (Test of Gross Motor Development)</h3>
  <span class="badge badge-qualtrics">
    <i data-lucide="database"></i>
    Source: Qualtrics
  </span>
</div>
```

**CSS:**
```css
.badge-qualtrics {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}

.badge-jotform {
  background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
  color: white;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
}
```

**2. Conflict Warning (if applicable):**
```html
<!-- When conflicts detected -->
<div class="alert alert-warning">
  <i data-lucide="alert-triangle"></i>
  <strong>Data Conflict Detected</strong>
  <p>TGMD values differ between Qualtrics and JotForm. Displaying Qualtrics data (preferred source).</p>
  <button onclick="showConflictDetails()">View Details</button>
</div>
```

**3. Conflict Details Modal:**
```javascript
function showConflictDetails() {
  const conflicts = studentData._tgmdConflicts || [];
  
  const html = `
    <div class="modal">
      <h2>TGMD Data Conflicts</h2>
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>JotForm Value</th>
            <th>Qualtrics Value</th>
            <th>Resolution</th>
          </tr>
        </thead>
        <tbody>
          ${conflicts.map(c => `
            <tr>
              <td>${c.field}</td>
              <td>${c.jotform}</td>
              <td><strong>${c.qualtrics}</strong></td>
              <td>Using Qualtrics</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
  
  showModal(html);
}
```

#### Step 6.2: Class/School/Group/District Page Aggregations

**No Changes Required** - These pages aggregate from student-level validation cache

**Why:** The hierarchical cache pattern (PRD lines 749-1387) already supports aggregating pre-computed student validations upward through the hierarchy.

**Example:**
```javascript
// Class page reads from student_validation cache
async function loadClassData(classId) {
  const students = await getStudentsInClass(classId);
  
  const classStats = {
    totalStudents: students.length,
    withTGMD: 0,
    tgmdFromQualtrics: 0,
    tgmdFromJotform: 0
  };
  
  for (const student of students) {
    const validation = await validationStorage.getItem(student.coreId);
    
    // Check if TGMD data exists
    if (validation.taskValidation.tgmd) {
      classStats.withTGMD++;
      
      // Check data source
      if (validation.submissions[0]._tgmdSource === 'qualtrics') {
        classStats.tgmdFromQualtrics++;
      } else {
        classStats.tgmdFromJotform++;
      }
    }
  }
  
  return classStats;
}
```

---

## Implementation Roadmap

### Week 1: Foundation (API Integration)

**Deliverables:**
- [ ] Create `assets/js/qualtrics-api.js` module
  - Wrap Qualtrics API endpoints
  - Export/poll/download functions
  - Error handling and retries
  - Based on `Qualtrics Test/qualtrics_api.py` logic

- [ ] Create `assets/js/qualtrics-transformer.js` module
  - Load qualtrics-mapping.json
  - Transform QID responses to standard fields
  - Handle matrix sub-questions

- [ ] Update credentials structure in `credentials.enc`
  - Add `qualtricsApiToken` (if not already present)
  - Validate on checking system home page

**Testing:**
- Fetch survey definition from Qualtrics
- Start export and poll until complete
- Download and parse JSON responses
- Transform sample responses using mapping

---

### Week 2: Data Merging

**Deliverables:**
- [ ] Create `assets/js/data-merger.js` module
  - Implement mergeDataSources() function
  - Implement mergeTGMDFields() with conflict resolution
  - Implement validateMergedData() validation

- [ ] Extend `assets/js/jotform-cache.js`
  - Add fetchQualtricsData() method
  - Add refreshWithQualtrics() method
  - Integrate merge logic into cache refresh

- [ ] Add Qualtrics cache store to IndexedDB
  - Create `qualtrics_cache` store in localforage
  - Store raw responses separately from merged data

**Testing:**
- Merge test datasets with TGMD conflicts
- Validate conflict resolution logic
- Test cache persistence after merge
- Verify Qualtrics data precedence

---

### Week 3: UI Integration

**Deliverables:**
- [ ] Update `checking_system_home.html`
  - Add "Refresh with Qualtrics" button
  - Show Qualtrics sync status/timestamp
  - Display merge statistics (conflicts, sources)

- [ ] Update `assets/js/cache-manager-ui.js`
  - Add Qualtrics refresh progress indicator
  - Show "X records from Qualtrics" in stats
  - Display conflict count and details

- [ ] Update student detail pages
  - Add TGMD data source indicator
  - Show Qualtrics response ID if applicable
  - Highlight conflicted fields (if any)

- [ ] Add debug/diagnostic tools
  - "View Qualtrics Raw Data" for admin
  - "Force Re-merge" button to re-run merge logic
  - Export merge conflicts to CSV for review

**Testing:**
- UI responsiveness during long exports
- Error message display for failures
- Cache status indicators update correctly
- Conflict visualization in student view

---

### Week 4: Production Validation

**Deliverables:**
- [ ] Documentation updates
  - This implementation plan (complete)
  - User guide: "Refreshing TGMD Data from Qualtrics"
  - Admin guide: "Resolving TGMD Data Conflicts"

- [ ] Security audit
  - Validate API token encryption
  - Ensure no token logging in console
  - Test credential rotation procedure

- [ ] Performance optimization
  - Benchmark large exports (1000+ responses)
  - Optimize IndexedDB writes for merge
  - Add export cancellation support

- [ ] Error recovery testing
  - Test rate limiting scenarios
  - Test network failures mid-export
  - Test corrupted response handling

**Testing:**
- Full end-to-end workflow with production data
- Load testing with maximum expected responses
- Security penetration testing
- User acceptance testing with operators

---

## API Module Reference

### QualtricsDelegator API (New Module)

**File:** `assets/js/qualtrics-api.js`

**Purpose:** Centralized Qualtrics API wrapper following same pattern as `jotform-api.js`

**Core Functions:**

#### 1. startExport()
```javascript
/**
 * Start Qualtrics response export
 * @param {Object} credentials - { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId }
 * @param {Array} questionIds - Array of QIDs to include
 * @returns {Promise<string>} progressId
 */
async function startExport(credentials, questionIds);
```

#### 2. pollProgress()
```javascript
/**
 * Poll export progress until complete
 * @param {Object} credentials
 * @param {string} progressId
 * @returns {Promise<string>} fileId
 */
async function pollProgress(credentials, progressId);
```

#### 3. downloadFile()
```javascript
/**
 * Download completed export file
 * @param {Object} credentials
 * @param {string} fileId
 * @returns {Promise<Array>} Raw Qualtrics responses
 */
async function downloadFile(credentials, fileId);
```

#### 4. fetchAllResponses()
```javascript
/**
 * Complete export workflow (start → poll → download)
 * @param {Object} credentials
 * @returns {Promise<Array>} Raw Qualtrics responses
 */
async function fetchAllResponses(credentials);
```

---

### DataMerger API (New Module)

**File:** `assets/js/data-merger.js`

**Purpose:** Merge JotForm and Qualtrics datasets with conflict resolution

**Core Functions:**

#### 1. mergeDataSources()
```javascript
/**
 * Merge JotForm and Qualtrics datasets by sessionkey
 * @param {Array} jotformData - JotForm submissions
 * @param {Array} qualtricsData - Transformed Qualtrics responses
 * @returns {Array} Merged records
 */
function mergeDataSources(jotformData, qualtricsData);
```

#### 2. mergeTGMDFields()
```javascript
/**
 * Merge TGMD fields with conflict detection
 * @param {Object} jotformRecord
 * @param {Object} qualtricsRecord
 * @returns {Object} Merged record with conflict metadata
 */
function mergeTGMDFields(jotformRecord, qualtricsRecord);
```

#### 3. validateMergedData()
```javascript
/**
 * Validate merged dataset and generate statistics
 * @param {Array} mergedRecords
 * @returns {Object} Validation statistics
 */
function validateMergedData(mergedRecords);
```

---

### QualtricsTransformer API (New Module)

**File:** `assets/js/qualtrics-transformer.js`

**Purpose:** Transform Qualtrics QID-based responses to standard field format

**Core Functions:**

#### 1. loadMapping()
```javascript
/**
 * Load Qualtrics field mapping configuration
 * @returns {Promise<Object>} Mapping object
 */
async function loadMapping();
```

#### 2. transformResponse()
```javascript
/**
 * Transform single Qualtrics response to standard format
 * @param {Object} response - Raw Qualtrics response
 * @param {Object} mapping - Field mapping configuration
 * @returns {Object} Transformed record
 */
function transformResponse(response, mapping);
```

#### 3. transformBatch()
```javascript
/**
 * Transform array of Qualtrics responses
 * @param {Array} responses
 * @param {Object} mapping
 * @returns {Array} Transformed records
 */
function transformBatch(responses, mapping);
```

---

## Data Structures

### Merged Submission Structure

```javascript
{
  // Standard JotForm fields
  sessionkey: "10261_20251005_10_30",
  "student-id": "10261",
  "school-id": "S003",
  "class-id": "C-003-05",
  "child-name": "潘姿螢",
  
  // Assessment data (from JotForm)
  "ERV_Q1": "2",
  "CM_Q1_TEXT": "走",
  // ... other tasks
  
  // TGMD data (from Qualtrics)
  "TGMD_Hand": "1",
  "TGMD_Leg": "2",
  "TGMD_111_Hop_t1": "1",
  "TGMD_112_Hop_t1": "0",
  // ... all 45 TGMD fields
  
  // Data source metadata
  _sources: ["jotform", "qualtrics"],
  _tgmdSource: "qualtrics",
  
  // Conflict metadata (if applicable)
  _tgmdConflicts: [
    {
      field: "TGMD_111_Hop_t1",
      jotform: "0",
      qualtrics: "1",
      resolution: "qualtrics"
    }
  ],
  
  // Qualtrics metadata
  _meta: {
    qualtricsResponseId: "R_abc123",
    qualtricsRetrievedAt: "2025-10-17T09:30:00Z"
  }
}
```

### Qualtrics Cache Structure

```javascript
{
  key: 'qualtrics_responses',
  timestamp: 1234567890,
  surveyId: "SV_23Qbs14soOkGo9E",
  responses: [
    {
      sessionkey: "10261_20251005_10_30",
      "student-id": "10261",
      "TGMD_Hand": "1",
      // ... all TGMD fields
      _meta: {
        source: 'qualtrics',
        qualtricsResponseId: 'R_abc123',
        retrievedAt: '2025-10-17T09:30:00Z'
      }
    }
    // ... more responses
  ]
}
```

---

## Error Handling & Edge Cases

### 1. Qualtrics API Errors

**401 Unauthorized:**
```javascript
if (error.status === 401) {
  showError('Invalid Qualtrics API token. Please check credentials.');
  // Prompt for re-entry or redirect to home page
}
```

**404 Survey Not Found:**
```javascript
if (error.status === 404) {
  showError('TGMD survey not found. Please verify survey ID in credentials.');
  // Fall back to JotForm-only mode
}
```

**429 Rate Limited:**
```javascript
if (error.status === 429) {
  const retryAfter = response.headers.get('Retry-After') || 60;
  showWarning(`Rate limited. Retrying in ${retryAfter} seconds...`);
  await sleep(retryAfter * 1000);
  return retry();
}
```

### 2. Export Timeout/Failure

**Timeout (>2 minutes):**
```javascript
if (timeout) {
  showError('Qualtrics export timed out. Please try again later.');
  // Fall back to cached Qualtrics data (if available)
}
```

**Export Failed:**
```javascript
if (result.status === 'failed') {
  showError('Qualtrics export failed. Using JotForm-only data.');
  // Continue with JotForm data, mark TGMD as unavailable
}
```

### 3. Data Quality Issues

**Missing Sessionkey:**
```javascript
if (!response.sessionkey) {
  console.warn('[Qualtrics] Response missing sessionkey, skipping:', response);
  // Skip this response, log for admin review
}
```

**Invalid TGMD Values:**
```javascript
if (value !== '0' && value !== '1') {
  console.warn('[TGMD] Invalid value for', field, ':', value);
  // Use empty string, flag for validation
}
```

**Orphaned Qualtrics Data:**
```javascript
// Qualtrics response with no matching JotForm record
if (!merged.has(sessionkey)) {
  console.log('[Merge] Orphaned Qualtrics response:', sessionkey);
  // Include as Qualtrics-only record
  merged.set(sessionkey, {
    ...qualtricsRecord,
    _sources: ['qualtrics'],
    _orphaned: true
  });
}
```

### 4. Conflict Resolution Edge Cases

**All TGMD Fields Conflict:**
```javascript
if (conflicts.length === 45) { // All 45 TGMD fields
  showWarning('Complete TGMD data mismatch. Using Qualtrics data.');
  // Flag for administrator review
  merged._requiresReview = true;
}
```

**Partial TGMD Data:**
```javascript
const tgmdFields = Object.keys(qualtricsRecord).filter(k => k.startsWith('TGMD_'));
if (tgmdFields.length > 0 && tgmdFields.length < 45) {
  console.log('[TGMD] Partial data:', tgmdFields.length, 'of 45 fields');
  // Still merge, mark as partial
  merged._tgmdPartial = true;
}
```

---

## Performance Considerations

### Cache Size Estimates

**Current (JotForm Only):**
- JotForm cache: ~30 MB (544 submissions)
- Student validation: ~24 MB (3000 students × 8 KB)
- **Total: ~54 MB**

**After Qualtrics Integration:**
- JotForm cache: ~30 MB
- Qualtrics cache: ~5 MB (200 responses, TGMD fields only)
- Merged cache: ~32 MB (544 submissions + TGMD fields)
- Student validation: ~26 MB (includes TGMD validation)
- **Total: ~93 MB**

**Storage Limit:** IndexedDB supports 50+ MB to several GB (browser-dependent)
**Conclusion:** Well within limits

### Performance Targets

| Operation | Target | Measurement |
|-----------|--------|-------------|
| Qualtrics Export | <60s | Start → download complete |
| Data Transformation | <5s | 200 responses → standard format |
| Data Merging | <10s | 544 JotForm + 200 Qualtrics |
| Cache Write | <5s | Write 32 MB to IndexedDB |
| Student Page Load | <100ms | Read from validation cache |
| Cache Refresh (Full) | <90s | JotForm + Qualtrics + merge |

### Optimization Strategies

**1. Incremental Qualtrics Sync:**
```javascript
// Fetch only new responses since last sync
const lastSync = await getLastQualtricsSync();
const exportPayload = {
  ...standardPayload,
  startDate: lastSync,
  endDate: new Date().toISOString()
};
```

**2. Web Worker for Validation:**
```javascript
// Run TaskValidator in background thread
const worker = new Worker('assets/js/validation-worker.js');
worker.postMessage({ students: studentGroups });
worker.onmessage = (e) => {
  const { validations } = e.data;
  saveToValidationCache(validations);
};
```

**3. Batch IndexedDB Writes:**
```javascript
// Write multiple students in single transaction
const tx = db.transaction('student_validation', 'readwrite');
for (const student of students) {
  tx.objectStore('student_validation').put(student);
}
await tx.complete;
```

---

## Testing Strategy

### Unit Tests

**1. Qualtrics Transformer:**
```javascript
describe('transformResponse', () => {
  it('should transform simple fields', () => {
    const response = { values: { "QID126166418": "1" } };
    const mapping = { "TGMD_Hand": "QID126166418" };
    const result = transformResponse(response, mapping);
    expect(result['TGMD_Hand']).toBe('1');
  });
  
  it('should transform matrix sub-questions', () => {
    const response = { values: { "QID126166420": { "1_1": "1" } } };
    const mapping = { "TGMD_111_Hop_t1": "QID126166420#1_1" };
    const result = transformResponse(response, mapping);
    expect(result['TGMD_111_Hop_t1']).toBe('1');
  });
});
```

**2. Data Merger:**
```javascript
describe('mergeTGMDFields', () => {
  it('should use Qualtrics data for TGMD fields', () => {
    const jotform = { "TGMD_Hand": "2" };
    const qualtrics = { "TGMD_Hand": "1" };
    const result = mergeTGMDFields(jotform, qualtrics);
    expect(result['TGMD_Hand']).toBe('1');
  });
  
  it('should detect conflicts', () => {
    const jotform = { "TGMD_Hand": "2" };
    const qualtrics = { "TGMD_Hand": "1" };
    const result = mergeTGMDFields(jotform, qualtrics);
    expect(result._tgmdConflicts).toHaveLength(1);
  });
});
```

### Integration Tests

**1. Full Workflow:**
```javascript
describe('Qualtrics Integration', () => {
  it('should fetch, transform, merge, and cache', async () => {
    const result = await JotFormCache.refreshWithQualtrics();
    expect(result.success).toBe(true);
    expect(result.stats.total).toBeGreaterThan(0);
  });
});
```

**2. Cache Persistence:**
```javascript
describe('Cache Persistence', () => {
  it('should persist merged data to IndexedDB', async () => {
    await JotFormCache.refreshWithQualtrics();
    const cached = await JotFormCache.loadFromCache();
    expect(cached.submissions.length).toBeGreaterThan(0);
  });
});
```

### Manual Testing Scenarios

**1. Happy Path:**
- Login to home page → Enter password
- Click "Refresh with Qualtrics"
- Verify progress indicator shows export status
- Check merge statistics show expected counts
- Navigate to student with TGMD data
- Verify "Source: Qualtrics" badge appears
- Verify TGMD fields populated correctly

**2. Conflict Detection:**
- Identify student with TGMD data in both sources
- Manually edit JotForm data to create conflict
- Refresh with Qualtrics
- Verify conflict warning appears
- Click "View Details" → Verify conflict table shows both values
- Verify Qualtrics value is used in task table

**3. Error Recovery:**
- Disconnect network
- Click "Refresh with Qualtrics"
- Verify error message displays
- Verify system falls back to cached data
- Reconnect network
- Retry → Verify success

---

## Security Considerations

### API Token Protection

**Storage:**
- Store in `credentials.enc` with AES-256-GCM encryption
- Never log token in console or network logs
- Mask token in error messages: `...9gpl5XK***`

**Transmission:**
- Always use HTTPS for API requests
- Include token in `X-API-TOKEN` header (not query params)
- Validate TLS certificates

**Access Control:**
- Decrypt credentials only on checking system home page
- Cache in `sessionStorage` (cleared on tab close)
- Require system password for decryption

### Data Privacy

**Student Data Protection:**
- All responses contain PII (student IDs, names)
- Encrypt IndexedDB cache using Web Crypto API (future enhancement)
- Clear cache on browser close (configurable)

**Audit Logging:**
- Log all Qualtrics API calls with timestamps
- Record merge conflicts for review
- Track credential decryption events

---

## Monitoring & Maintenance

### Operational Metrics

**Dashboard Additions:**
- Qualtrics sync status (last sync time, success/failure)
- Merge statistics (conflicts, data sources)
- Cache size and health
- API call counts and rate limiting

**Alerts:**
- Export failures (3+ consecutive)
- High conflict rate (>10%)
- Cache corruption detected
- API token expiration approaching

### Maintenance Tasks

**Weekly:**
- Review merge conflict reports
- Validate qualtrics-mapping.json accuracy
- Check API token expiration date

**Monthly:**
- API token rotation
- Cache cleanup (remove old validation data)
- Performance benchmarking

**Quarterly:**
- Full system audit
- Update Qualtrics field mapping
- Review and adjust conflict resolution rules

---

## Appendix

### A. Qualtrics Field Reference

**TGMD Field Coverage (45 fields):**
- Hand/Leg Preference: 2 fields
- Hopping: 8 fields (4 criteria × 2 trials)
- Jumping: 8 fields
- Sliding: 8 fields
- Dribbling: 6 fields (3 criteria × 2 trials)
- Catching: 6 fields
- Throwing: 8 fields
- Comments: 1 field

**Field Name Pattern:** `TGMD_{test}{criterion}{trial}`
- Test: 1=Hop, 2=Jump, 3=Slide, 4=Dribble, 5=Catch, 6=Throw
- Criterion: 11-14 (varies by test)
- Trial: t1 or t2

**Example:** `TGMD_111_Hop_t1` = Hopping, Criterion 1, Trial 1

### B. Qualtrics Matrix Question Structure

**Example: Hopping (QID126166420)**
```
Matrix Structure:
        Criterion 1  Criterion 2  Criterion 3  Criterion 4
Trial 1    [1_1]       [1_2]       [1_3]       [1_4]
Trial 2    [2_1]       [2_2]       [2_3]       [2_4]
```

**Mapping:**
- `QID126166420#1_1` → `TGMD_111_Hop_t1`
- `QID126166420#1_2` → `TGMD_112_Hop_t1`
- `QID126166420#2_1` → `TGMD_111_Hop_t2`

**Value Encoding:**
- `1` = Criterion met
- `0` = Criterion not met
- `""` (empty) = Not assessed

### C. Error Code Reference

| Code | Description | Recovery Action |
|------|-------------|----------------|
| `QUALTRICS_AUTH_FAILED` | Invalid API token | Re-enter credentials |
| `QUALTRICS_EXPORT_TIMEOUT` | Export >2 minutes | Retry or check survey size |
| `QUALTRICS_RATE_LIMITED` | Too many requests | Wait and retry |
| `MERGE_SESSIONKEY_MISSING` | Response missing sessionkey | Skip response, log for review |
| `MERGE_HIGH_CONFLICT_RATE` | >10% conflicts | Review data quality |
| `CACHE_WRITE_FAILED` | IndexedDB error | Check storage quota |

---

**Document Version**: 1.0  
**Last Updated**: 2025-10-17  
**Next Review**: After Week 1 implementation
