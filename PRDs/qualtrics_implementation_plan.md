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
**Conclusion:** Well within limits for desktop, but see "Cache Strategy Considerations" below for mobile/low-power devices

### Cache Strategy Considerations

#### Device Performance Analysis

**Desktop/High-Performance Laptops:**
- ✅ **93 MB cache**: No issues
- ✅ **IndexedDB**: Fast read/write performance
- ✅ **Validation cache**: Pre-computation worthwhile (instant page loads)
- **Recommendation**: Use full caching strategy as designed

**Low-Power Laptops/Older Devices:**
- ⚠️ **93 MB cache**: Acceptable but noticeable initial load
- ⚠️ **IndexedDB**: Slower write performance (5-10s for full cache)
- ⚠️ **Validation cache**: Pre-computation still beneficial
- **Recommendation**: Provide user choice between full cache and fetch-on-request

**Mobile Devices (Tablets/Phones):**
- ❌ **93 MB cache**: Significant storage pressure
- ❌ **IndexedDB**: Limited quota (often 50 MB, may prompt user)
- ❌ **Validation cache**: Battery impact from pre-computation
- ❌ **Network**: Slower API calls, higher latency
- **Recommendation**: Default to fetch-on-request mode with optional caching

#### Cache vs Fetch-on-Request Comparison

| Aspect | Full Cache (Current) | Fetch-on-Request (Alternative) |
|--------|---------------------|-------------------------------|
| **Initial Load** | 90s (fetch all data) | <5s (fetch metadata only) |
| **Memory Usage** | 93 MB (persistent) | 1-5 MB (current page only) |
| **Student Page** | <100ms (instant) | 2-4s (fetch + validate) |
| **Class Page (30 students)** | <100ms (pre-computed) | 60-120s (fetch all, validate) |
| **School Page (200 students)** | <100ms (aggregate cache) | 8-15 minutes (impractical) |
| **Network Dependency** | Once per hour | Every navigation |
| **Offline Support** | ✅ Full offline browsing | ❌ No offline capability |
| **Battery Impact** | Low (rare refreshes) | High (constant API calls) |

### Performance Targets

| Operation | Target | Measurement |
|-----------|--------|-------------|
| Qualtrics Export | <60s | Start → download complete |
| Data Transformation | <5s | 200 responses → standard format |
| Data Merging | <10s | 544 JotForm + 200 Qualtrics |
| Cache Write | <5s | Write 32 MB to IndexedDB |
| Student Page Load | <100ms | Read from validation cache |
| Cache Refresh (Full) | <90s | JotForm + Qualtrics + merge |

---

## Hybrid Cache Strategy: Integrated Toggle on Filter Home Page

### Overview

To accommodate different device capabilities and user preferences, implement a **cache toggle** directly on the filter home page. This provides immediate control over caching behavior without requiring a separate configuration screen.

### Design Rationale

**Why integrate into filter home page:**
1. **Contextual Control**: Users configure filters and caching in one place
2. **Immediate Feedback**: See cache status alongside filter options
3. **Simplified Workflow**: No separate mode selection screen to navigate
4. **Visual Clarity**: Cache toggle sits near system status pills for coherent UX
5. **Mobile-Friendly**: Compact toggle instead of large radio cards

**Key Principle**: The cache toggle determines behavior for the entire checking session. Once set, it applies to all subsequent drilldown navigations until the user changes it or closes the browser.

### Home Page: Cache Toggle Integration

**Location**: Place toggle immediately below system status pills (decryption, JotForm sync status)

**UI Implementation:**
```html
<!-- In checking_system_home.html -->
<!-- Insert after System Status Pills section -->

<div class="entry-card mb-6 p-4">
  <!-- Cache Strategy Toggle Header -->
  <div class="flex items-center justify-between mb-3">
    <div class="flex items-center gap-2">
      <i data-lucide="database" class="w-4 h-4 text-[color:var(--muted-foreground)]"></i>
      <h3 class="text-sm font-semibold text-[color:var(--foreground)]">Cache Strategy</h3>
    </div>
    
    <!-- Toggle Switch -->
    <label class="toggle-switch">
      <input type="checkbox" id="cache-strategy-toggle" checked>
      <span class="toggle-slider"></span>
    </label>
  </div>
  
  <!-- Current Mode Display -->
  <div id="cache-mode-display" class="flex items-start gap-3 p-3 rounded-lg bg-[color:var(--muted)]/30">
    <div class="flex-shrink-0 mt-0.5">
      <i data-lucide="zap" class="w-5 h-5 text-[color:var(--primary)]"></i>
    </div>
    <div class="flex-1 min-w-0">
      <div class="flex items-center gap-2 mb-1">
        <span id="cache-mode-label" class="text-sm font-medium text-[color:var(--foreground)]">Full Cache Mode</span>
        <span id="cache-mode-badge" class="badge-success text-[10px] px-2 py-0.5 rounded-full">Recommended</span>
      </div>
      <p id="cache-mode-description" class="text-xs text-[color:var(--muted-foreground)] leading-relaxed">
        Pre-loads all data (~93 MB) for instant navigation. Best for desktop and frequent use. Initial sync takes ~90 seconds.
      </p>
      
      <!-- Quick Stats -->
      <div class="flex items-center gap-4 mt-2 text-[11px] text-[color:var(--muted-foreground)]">
        <span class="flex items-center gap-1">
          <i data-lucide="gauge" class="w-3 h-3"></i>
          Load: <span id="cache-load-time" class="font-mono">90s initial</span>
        </span>
        <span class="flex items-center gap-1">
          <i data-lucide="hard-drive" class="w-3 h-3"></i>
          Storage: <span id="cache-storage-size" class="font-mono">~93 MB</span>
        </span>
        <span class="flex items-center gap-1">
          <i data-lucide="activity" class="w-3 h-3"></i>
          Pages: <span id="cache-page-speed" class="font-mono">&lt;100ms</span>
        </span>
      </div>
    </div>
  </div>
  
  <!-- Auto-Detection Banner (conditional) -->
  <div id="cache-recommendation-banner" class="hidden mt-3 p-3 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-900/10">
    <div class="flex items-start gap-2">
      <i data-lucide="alert-circle" class="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5"></i>
      <div class="flex-1 text-xs">
        <p class="text-amber-800 dark:text-amber-200" id="cache-recommendation-text">
          Mobile device detected. Consider using Fetch-on-Request mode to save storage and battery.
        </p>
        <button id="apply-recommendation-btn" class="mt-2 text-amber-700 dark:text-amber-300 underline hover:no-underline font-medium">
          Switch to Fetch-on-Request
        </button>
      </div>
    </div>
  </div>
</div>
```

**CSS Styles:**
```css
/* Toggle Switch Styling */
.toggle-switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 24px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--muted);
  transition: 0.3s;
  border-radius: 24px;
}

.toggle-slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

.toggle-switch input:checked + .toggle-slider {
  background-color: var(--primary);
}

.toggle-switch input:checked + .toggle-slider:before {
  transform: translateX(24px);
}
```

**JavaScript Implementation:**
```javascript
// In cache-manager-ui.js

class CacheStrategyManager {
  constructor() {
    this.toggle = document.getElementById('cache-strategy-toggle');
    this.modeDisplay = document.getElementById('cache-mode-display');
    this.modeLabel = document.getElementById('cache-mode-label');
    this.modeBadge = document.getElementById('cache-mode-badge');
    this.modeDescription = document.getElementById('cache-mode-description');
    this.loadTime = document.getElementById('cache-load-time');
    this.storageSize = document.getElementById('cache-storage-size');
    this.pageSpeed = document.getElementById('cache-page-speed');
    this.recommendationBanner = document.getElementById('cache-recommendation-banner');
    
    this.init();
  }
  
  init() {
    // Load saved preference or detect default
    const savedStrategy = this.loadStrategy();
    const isFullCache = savedStrategy === 'full';
    this.toggle.checked = isFullCache;
    this.updateDisplay(isFullCache);
    
    // Auto-detect and show recommendation
    this.detectDevice();
    
    // Event listener
    this.toggle.addEventListener('change', (e) => {
      const isFullCache = e.target.checked;
      this.saveStrategy(isFullCache ? 'full' : 'on-demand');
      this.updateDisplay(isFullCache);
      this.showStrategyChangeConfirmation(isFullCache);
    });
    
    // Apply recommendation button
    document.getElementById('apply-recommendation-btn')?.addEventListener('click', () => {
      this.toggle.checked = false;
      this.toggle.dispatchEvent(new Event('change'));
      this.recommendationBanner.classList.add('hidden');
    });
  }
  
  detectDevice() {
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    const isLowPower = navigator.hardwareConcurrency && navigator.hardwareConcurrency < 4;
    const hasLimitedMemory = navigator.deviceMemory && navigator.deviceMemory < 4; // GB
    
    const recommendOnDemand = isMobile || isLowPower || hasLimitedMemory;
    
    if (recommendOnDemand && this.toggle.checked) {
      // Show recommendation only if currently on full cache
      this.recommendationBanner.classList.remove('hidden');
      
      let reason = 'Limited device detected';
      if (isMobile) reason = 'Mobile device detected';
      else if (isLowPower) reason = 'Low-power device detected';
      else if (hasLimitedMemory) reason = 'Limited memory detected';
      
      document.getElementById('cache-recommendation-text').textContent = 
        `${reason}. Consider using Fetch-on-Request mode to save storage (~90 MB) and battery.`;
    }
  }
  
  updateDisplay(isFullCache) {
    const icon = this.modeDisplay.querySelector('i[data-lucide]');
    
    if (isFullCache) {
      // Full Cache Mode
      this.modeLabel.textContent = 'Full Cache Mode';
      this.modeBadge.className = 'badge-success text-[10px] px-2 py-0.5 rounded-full';
      this.modeBadge.textContent = 'Recommended';
      this.modeDescription.textContent = 
        'Pre-loads all data (~93 MB) for instant navigation. Best for desktop and frequent use. Initial sync takes ~90 seconds.';
      this.loadTime.textContent = '90s initial';
      this.storageSize.textContent = '~93 MB';
      this.pageSpeed.textContent = '<100ms';
      icon.setAttribute('data-lucide', 'zap');
      this.modeDisplay.className = 'flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/10';
    } else {
      // Fetch-on-Request Mode
      this.modeLabel.textContent = 'Fetch-on-Request Mode';
      this.modeBadge.className = 'badge-warning text-[10px] px-2 py-0.5 rounded-full';
      this.modeBadge.textContent = 'Mobile-Friendly';
      this.modeDescription.textContent = 
        'Loads data as needed with minimal storage (~1-5 MB). Best for mobile devices and single lookups. School/District views not supported.';
      this.loadTime.textContent = '<5s start';
      this.storageSize.textContent = '~1-5 MB';
      this.pageSpeed.textContent = '2-4s/page';
      icon.setAttribute('data-lucide', 'wifi');
      this.modeDisplay.className = 'flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/10';
    }
    
    // Re-initialize Lucide icons
    lucide.createIcons();
  }
  
  saveStrategy(strategy) {
    localStorage.setItem('cacheStrategy', strategy);
    console.log('[CacheStrategy] User selected:', strategy);
  }
  
  loadStrategy() {
    const saved = localStorage.getItem('cacheStrategy');
    if (saved) return saved;
    
    // Default to full cache for desktop, on-demand for mobile
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    return isMobile ? 'on-demand' : 'full';
  }
  
  showStrategyChangeConfirmation(isFullCache) {
    const mode = isFullCache ? 'Full Cache' : 'Fetch-on-Request';
    const message = isFullCache 
      ? 'Full Cache enabled. Click "Refresh with Qualtrics" to load all data.'
      : 'Fetch-on-Request enabled. Data will load as you navigate. School/District views disabled.';
    
    // Show toast notification
    this.showToast(message, isFullCache ? 'success' : 'info');
  }
  
  showToast(message, type = 'info') {
    // Simple toast implementation
    const toast = document.createElement('div');
    toast.className = `fixed bottom-4 right-4 p-4 rounded-lg shadow-lg z-50 animate-slide-in ${
      type === 'success' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'
    }`;
    toast.innerHTML = `
      <div class="flex items-center gap-2">
        <i data-lucide="${type === 'success' ? 'check-circle' : 'info'}" class="w-4 h-4"></i>
        <span class="text-sm font-medium">${message}</span>
      </div>
    `;
    document.body.appendChild(toast);
    lucide.createIcons();
    
    setTimeout(() => {
      toast.classList.add('animate-slide-out');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  const cacheManager = new CacheStrategyManager();
  window.cacheStrategyManager = cacheManager;
});
```

### Visual Layout

**Filter Home Page Structure:**
```
┌─────────────────────────────────────────────────────────┐
│ Checking System                                    Back │
├─────────────────────────────────────────────────────────┤
│ ● Not Decrypted  ● System Not Ready  Last Synced: —    │ <- Status Pills
├─────────────────────────────────────────────────────────┤
│ Cache Strategy                            [●─────────○] │ <- NEW: Cache Toggle
│ ⚡ Full Cache Mode                      Recommended     │
│ Pre-loads all data (~93 MB) for instant navigation...  │
│ ⏱ 90s initial  💾 ~93 MB  ⚡ <100ms                    │
├─────────────────────────────────────────────────────────┤
│ No filters applied                      0 filters       │ <- Filter Chips
├─────────────────────────────────────────────────────────┤
│ Configure Filters                                       │
│ [District ▼] [School Search...] [+ Add filter]         │ <- Filter Config
└─────────────────────────────────────────────────────────┘
```

### Toggle Behavior & State Management

**Toggle States:**
- **ON (Checked)**: Full Cache Mode enabled
- **OFF (Unchecked)**: Fetch-on-Request Mode enabled

**State Persistence:**
- Saved to `localStorage.cacheStrategy`
- Persists across browser sessions
- Can be changed anytime on home page
- Applies to all subsequent navigation

**Impact on Navigation:**
```javascript
// In all drilldown pages (student, class, school, etc.)
async function loadPageData(identifier) {
  const strategy = localStorage.getItem('cacheStrategy') || 'full';
  
  if (strategy === 'full') {
    // Use pre-computed cache
    return await loadFromCache(identifier);
  } else {
    // Fetch on demand
    return await fetchOnDemand(identifier);
  }
}
```

**Blocking for Unsupported Views:**
```javascript
// In school/group/district pages
function checkCacheRequirement() {
  const strategy = localStorage.getItem('cacheStrategy');
  
  if (strategy === 'on-demand') {
    // Block page load
    showModal({
      title: 'Full Cache Required',
      message: 'School, Group, and District views require Full Cache mode due to data volume (200-1000+ students).',
      actions: [
        { 
          label: 'Enable Full Cache', 
          onClick: () => {
            localStorage.setItem('cacheStrategy', 'full');
            window.location.href = 'checking_system_home.html?autoSync=true';
          }
        },
        { 
          label: 'Search Student/Class', 
          onClick: () => showSearchModal() 
        }
      ]
    });
    return false;
  }
  
  return true;
}
```

---

## Complete User Workflow: Cache Toggle Integration

### Overview

This section documents the **complete user journey** with the integrated cache toggle, covering initial setup, cache building, mode switching, and navigation patterns. Understanding these workflows is critical for implementation.

---

### Workflow 1: First-Time User (Desktop)

**Scenario**: User visits checking system for the first time on a desktop computer

**Step-by-Step Flow:**

```
1. User navigates to checking_system_home.html
   ↓
2. Page loads, auto-detects device
   - Detects: Desktop (high CPU, >4GB RAM)
   - Default: Toggle ON (Full Cache Mode)
   - Status Pills: 🔴 Not Decrypted, 🔴 System Not Ready
   ↓
3. System prompts for password
   - Modal: "Enter system password to decrypt data"
   - User enters password
   - System decrypts: credentials.enc, coreid.enc, schoolid.enc, classid.enc
   - Decryption Status: 🔴 → 🟢 "Data Decrypted"
   ↓
4. Cache Status Check
   - System checks IndexedDB for existing cache
   - Result: No cache found
   - JotForm Status: 🔴 "System Not Ready"
   - UI shows: "Cache not built. Click status pill to sync."
   ↓
5. User clicks "System Not Ready" pill
   - Sync modal appears: "System Not Ready"
   - Message: "The system needs to sync with Jotform to enable fast searching."
   - Shows: "This takes about 30-60 seconds"
   - Button: [Sync with Jotform]
   ↓
6. User clicks "Sync with Jotform"
   - Modal updates to show progress
   - Progress bar: "Fetching page 1 of submissions... 5%"
   - Progress bar: "Fetching page 2 of submissions... 25%"
   - Progress bar: "Downloaded 544 submissions... 85%"
   - Progress bar: "Saving to IndexedDB cache... 95%"
   - Toast: "✅ Cache built successfully (544 submissions)"
   - JotForm Status: 🔴 → 🟢 "System Ready"
   - Last Synced: Updates to current time
   ↓
7. Cache Building Complete (Full Cache Mode)
   - IndexedDB stores:
     * jotform_global_cache: 30 MB (544 JotForm submissions)
     * qualtrics_cache: 5 MB (200 Qualtrics responses - if Qualtrics enabled)
     * Merged cache: 32 MB
     * student_validation: 24 MB (3000 pre-computed validations)
   - Total storage: ~93 MB
   - Cache Status: "System Ready"
   - User can now navigate instantly
   ↓
8. User configures filters and clicks "Start Checking"
   - Applies filters (e.g., District → Group → School → Student)
   - Router determines drilldown level
   - Navigates to appropriate page (e.g., student detail)
   ↓
9. Student Page Loads (Full Cache Mode)
   - Reads from student_validation cache (IndexedDB)
   - Load time: <100ms (instant)
   - Displays: All task data, TGMD from Qualtrics, validation results
   - No API calls needed
   ↓
10. User navigates to other pages
    - Class page: <100ms (reads from class_summary cache)
    - School page: <100ms (reads from school_summary cache)
    - All instant - no loading indicators needed
```

**Time Breakdown:**
- Password entry: ~5 seconds
- Initial cache build: ~90 seconds (one-time)
- Subsequent page loads: <100ms each

---

### Workflow 2: First-Time User (Mobile)

**Scenario**: User visits checking system for the first time on mobile device

**Step-by-Step Flow:**

```
1. User navigates to checking_system_home.html (mobile)
   ↓
2. Page loads, auto-detects device
   - Detects: Mobile (iOS/Android user agent)
   - Default: Toggle OFF (Fetch-on-Request Mode)
   - Shows recommendation banner:
     "📱 Mobile device detected. Fetch-on-Request mode recommended to save storage (~90 MB)"
   - Cache Toggle Display:
     * 📡 Fetch-on-Request Mode [Mobile-Friendly badge]
     * "Loads data as needed with minimal storage (~1-5 MB)"
     * ⏱ <5s start  💾 ~1-5 MB  ⚡ 2-4s/page
   ↓
3. System prompts for password
   - User enters password
   - System decrypts metadata files
   - Decryption Status: 🟢 "Data Decrypted"
   ↓
4. Cache Status Check (Fetch-on-Request Mode)
   - System skips full cache build
   - Only loads minimal metadata (~1 MB)
   - JotForm Status: 🟡 "Fetch-on-Request Mode"
   - Message: "Data will load as you navigate"
   - Last Synced: "Not applicable (on-demand mode)"
   ↓
5. User configures filters
   - Adds filter: Student search "張梓煋"
   - Clicks "Start Checking"
   - Router: Detects student filter → student detail page
   ↓
6. Student Page Loads (Fetch-on-Request Mode)
   - Shows loading indicator: "Loading student data..."
   - API call: Fetch submissions for this student only
     * Filter: { "q3:matches": "10261" } (sessionkey filter)
     * Returns: 2-4 submissions (~100 KB)
   - Merge submissions
   - Run TaskValidator on merged data
   - Display results
   - Load time: 2-4 seconds
   ↓
7. Optional: Cache this student only
   - Store in lightweight in-memory cache (10 MB limit)
   - Next visit to same student: <100ms (from memory)
   - Cache expires after 30 minutes or browser close
   ↓
8. User tries to navigate to School page
   - System detects: School level + Fetch-on-Request mode
   - ❌ BLOCKS navigation
   - Shows modal:
     * Title: "Full Cache Required"
     * Message: "School views require Full Cache mode (200+ students = 8-10 min load)"
     * Actions:
       - [Enable Full Cache] → Switches toggle, redirects to home
       - [Search Student/Class] → Opens search modal for supported views
   ↓
9. User can only access Student/Class pages
   - Student pages: 2-4s load each
   - Class pages: 60-120s load (30 students × 2-4s)
   - School/District: Blocked with modal
```

**Storage Comparison:**
- Full Cache: 93 MB permanent storage
- Fetch-on-Request: 1-5 MB (metadata + current page only)

---

### Workflow 3: Switching from Fetch-on-Request to Full Cache

**Scenario**: Mobile user needs to access School-level reports, must enable Full Cache

**Step-by-Step Flow:**

```
1. User is in Fetch-on-Request mode (mobile)
   - Currently viewing student detail page
   - Toggle: OFF (Fetch-on-Request)
   ↓
2. User tries to access School page via breadcrumb
   - Clicks breadcrumb: "Home → District → School"
   - School page starts loading
   - checkCacheRequirement() runs
   - Detects: strategy === 'on-demand' AND page === 'school'
   - BLOCKS navigation
   ↓
3. Blocking Modal Appears
   - Title: "🔒 Full Cache Required"
   - Message: "School, Group, and District views require Full Cache mode due to data volume."
   - Details: "This view would take 8-10 minutes to load in Fetch-on-Request mode (200+ students)"
   - Actions:
     * [Enable Full Cache] (primary button)
     * [Search Student/Class] (secondary button)
     * [Cancel] (close modal)
   ↓
4. User clicks "Enable Full Cache"
   - JavaScript executes:
     ```javascript
     localStorage.setItem('cacheStrategy', 'full');
     window.location.href = 'checking_system_home.html?autoSync=true';
     ```
   - Browser redirects to home page with autoSync flag
   ↓
5. Home Page Loads with autoSync=true
   - Page detects URL parameter: ?autoSync=true
   - Automatically triggers cache sync
   - Toggle: Now ON (Full Cache Mode)
   - Shows sync modal immediately (no manual click needed)
   ↓
6. Cache Building Process
   - Progress modal: "Syncing with Jotform and Qualtrics..."
   - Step 1: Fetch JotForm (30 seconds)
   - Step 2: Fetch Qualtrics (20 seconds)
   - Step 3: Merge datasets (10 seconds)
   - Step 4: Build validation cache (30 seconds)
   - Total: ~90 seconds
   - Progress bar shows: "Building cache... 45%"
   ↓
7. Cache Build Complete
   - Toast: "✅ Full Cache enabled. System is now ready."
   - JotForm Status: 🟢 "System Ready"
   - Storage used: 93 MB (user may see browser prompt on mobile)
   - Toggle: ON (Full Cache Mode)
   ↓
8. User can now access all pages
   - Re-configures filters (or uses Recent Checks)
   - Navigates to School page
   - Load time: <100ms (from cache)
   - All drilldown levels now accessible
```

**Key Points:**
- Mode switch is permanent (persists in localStorage)
- Cache build happens automatically with autoSync flag
- User doesn't need to manually trigger sync
- Mobile browsers may prompt for storage permission (93 MB)

---

### Workflow 4: Switching from Full Cache to Fetch-on-Request

**Scenario**: Desktop user wants to save storage or battery (laptop on battery)

**Step-by-Step Flow:**

```
1. User is in Full Cache mode
   - Toggle: ON (Full Cache Mode)
   - Cache Status: 🟢 "System Ready"
   - Storage: 93 MB in IndexedDB
   ↓
2. User clicks Cache Toggle (OFF position)
   - Toggle switches: ON → OFF
   - UI updates immediately:
     * Icon changes: ⚡ → 📡
     * Label: "Full Cache Mode" → "Fetch-on-Request Mode"
     * Badge: "Recommended" → "Mobile-Friendly"
     * Stats: "90s initial, ~93 MB, <100ms" → "<5s start, ~1-5 MB, 2-4s/page"
     * Background color: Blue → Amber
   ↓
3. JavaScript saves preference
   - localStorage.setItem('cacheStrategy', 'on-demand')
   - Toast notification: "ℹ️ Fetch-on-Request enabled. Data will load as you navigate. School/District views disabled."
   ↓
4. Cache remains in IndexedDB
   - ⚠️ Important: Existing cache is NOT deleted
   - Reason: User might switch back, avoid re-downloading
   - Cache just isn't used for navigation
   - Takes up 93 MB until manually cleared or expires (1 hour TTL)
   ↓
5. User continues working
   - Current page (if already loaded): Still displays cached data
   - New navigation: Uses fetch-on-request
   - Student pages: 2-4s load each
   - Class pages: 60-120s load (with progress bar)
   ↓
6. User tries to access School page
   - BLOCKED with modal (same as Workflow 3)
   - Must switch back to Full Cache or use Student/Class search
   ↓
7. Optional: User switches back to Full Cache
   - Toggle: OFF → ON
   - System checks cache validity
   - If cache still valid (<1 hour old): Instant reactivation, no rebuild
   - If cache expired: Triggers rebuild (~90s)
   - Toast: "✅ Full Cache re-enabled. Using existing cache."
```

**Cache Cleanup Options:**

Users can manually clear cache in several ways:

1. **Via Cache Manager UI** (recommended):
   - Click green "System Ready" pill
   - Modal shows: "JotForm Data is Ready"
   - Button: [Delete Cache] (red button)
   - Confirmation: "This will clear 93 MB of storage"
   - Cache cleared, requires rebuild

2. **Browser Developer Tools**:
   - Open DevTools → Application → IndexedDB
   - Delete JotFormCacheDB database
   - Reload page

3. **Automatic Expiration**:
   - Cache TTL: 1 hour
   - After expiration, cache marked invalid
   - Next access triggers rebuild

---

### Workflow 5: Returning User (Cache Already Built)

**Scenario**: User returns to checking system after cache was built previously

**Step-by-Step Flow:**

```
1. User navigates to checking_system_home.html
   ↓
2. Page loads and checks cache
   - Reads: localStorage.cacheStrategy (e.g., 'full')
   - Toggle: Sets to saved state (ON for full cache)
   - Checks IndexedDB: jotform_global_cache exists
   - Validates cache:
     * Has valid structure? ✅
     * Age < 1 hour? ✅ (age: 15 minutes)
     * Size reasonable? ✅ (93 MB)
   ↓
3. Cache Status determined
   - Cache valid: 🟢 "System Ready"
   - Last Synced: "15 min ago"
   - No password prompt if already decrypted in session
   - Or: Password prompt → Decrypt → Continue
   ↓
4. User can navigate immediately
   - No cache rebuild needed
   - Configure filters
   - Click "Start Checking"
   - All pages load instantly (<100ms)
   ↓
5. Cache expires after 1 hour
   - Cache marked invalid
   - Status: 🟢 "System Ready" → 🔴 "Cache Expired"
   - Message: "Cache is outdated. Click to refresh."
   - User clicks status pill → Rebuild cache (~90s)
```

**Cache Validity Check:**
```javascript
function isCacheValid(cached) {
  // Structure validation
  if (!cached.submissions || !Array.isArray(cached.submissions)) {
    return false;
  }
  if (!cached.timestamp || typeof cached.timestamp !== 'number') {
    return false;
  }
  if (cached.count !== cached.submissions.length) {
    return false;
  }
  
  // Time validity (1 hour TTL)
  const age = Date.now() - cached.timestamp;
  const ttl = 60 * 60 * 1000; // 1 hour
  if (age > ttl) {
    return false;
  }
  
  return true;
}
```

---

### Workflow 6: Qualtrics Integration - Initial Sync

**Scenario**: System has JotForm cache but needs to add Qualtrics TGMD data

**Step-by-Step Flow:**

```
1. User in Full Cache mode with existing JotForm cache
   - JotForm Status: 🟢 "System Ready" (544 submissions)
   - Qualtrics Status: Not synced yet
   ↓
2. User clicks new "Refresh with Qualtrics" button
   - Button location: Next to "System Ready" pill
   - Label: "Refresh with Qualtrics Data"
   - Icon: Database with plus sign
   ↓
3. Qualtrics Sync Modal Appears
   - Title: "Sync with Qualtrics"
   - Message: "Fetch TGMD assessment data from Qualtrics and merge with JotForm data?"
   - Details: "This will take 30-60 seconds and add ~5 MB to cache"
   - Buttons: [Cancel] [Sync Qualtrics Data]
   ↓
4. User clicks "Sync Qualtrics Data"
   - Progress modal updates:
   ↓
5. Phase 1: Qualtrics Export (30 seconds)
   - "Starting Qualtrics export... 5%"
   - "Export request accepted, progress ID: abc123"
   - "Polling export progress... 15%"
   - "Export 25% complete..."
   - "Export 50% complete..."
   - "Export 100% complete, downloading... 25%"
   ↓
6. Phase 2: Data Transformation (5 seconds)
   - "Transforming 200 Qualtrics responses... 30%"
   - "Converting QIDs to field names..."
   - "Processing matrix questions..."
   - "Transformation complete... 35%"
   ↓
7. Phase 3: Data Merging (10 seconds)
   - "Merging JotForm and Qualtrics data... 40%"
   - "Aligning by sessionkey..."
   - "Detecting conflicts..."
   - "Merge statistics:"
     * "544 total records"
     * "198 with TGMD data"
     * "156 from Qualtrics"
     * "42 from JotForm only"
     * "3 conflicts detected"
   - "Merge complete... 60%"
   ↓
8. Phase 4: Cache Update (20 seconds)
   - "Updating JotForm cache with merged data... 65%"
   - "Saving Qualtrics responses to cache... 75%"
   - "Rebuilding validation cache... 85%"
   - "Re-validating 3000 students with TGMD data... 95%"
   - "Cache update complete... 100%"
   ↓
9. Sync Complete
   - Modal shows results:
     * Title: "✅ Qualtrics Sync Complete"
     * "Merged 200 Qualtrics responses with 544 JotForm submissions"
     * "198 students now have TGMD data"
     * "3 conflicts detected (Qualtrics data prioritized)"
     * "Cache updated: +5 MB (now 98 MB total)"
   - Button: [View Conflicts] [Close]
   - Toast: "✅ Qualtrics data synced successfully"
   ↓
10. User navigates to student with TGMD data
    - Student page shows:
      * TGMD task section now populated
      * Badge: "Source: Qualtrics" on TGMD task
      * If conflicts: Warning icon "Data conflict detected - using Qualtrics values"
    - Load time: Still <100ms (from updated cache)
   ↓
11. Cache now includes merged data
    - IndexedDB stores:
      * jotform_global_cache: 32 MB (merged: JotForm + Qualtrics)
      * qualtrics_cache: 5 MB (raw Qualtrics responses)
      * student_validation: 26 MB (includes TGMD validation)
    - Total: 98 MB
    - Future loads: All TGMD data available instantly
```

**Merge Conflict Handling:**

If user clicks "View Conflicts":
```
┌─────────────────────────────────────────────────────┐
│ TGMD Data Conflicts (3)                             │
├─────────────────────────────────────────────────────┤
│ Student: 張梓煋 (10261)                             │
│ Field: TGMD_111_Hop_t1                              │
│ JotForm: "0" (Failed)                               │
│ Qualtrics: "1" (Passed) ✅ Using this               │
│                                                      │
│ Student: 潘姿螢 (10042)                             │
│ Field: TGMD_Hand                                    │
│ JotForm: "2" (Left)                                 │
│ Qualtrics: "1" (Right) ✅ Using this                │
│                                                      │
│ Student: 黃子晴 (10087)                             │
│ Field: TGMD_Leg                                     │
│ JotForm: "1" (Right)                                │
│ Qualtrics: "2" (Left) ✅ Using this                 │
├─────────────────────────────────────────────────────┤
│ [Export Conflict Report CSV] [Close]                │
└─────────────────────────────────────────────────────┘
```

---

### Workflow 7: Error Recovery - Cache Build Failure

**Scenario**: Cache build fails mid-process (network error, API rate limit)

**Step-by-Step Flow:**

```
1. User triggers cache build
   - Toggle: ON (Full Cache Mode)
   - Clicks "System Not Ready" pill → "Sync with Jotform"
   ↓
2. Build starts normally
   - "Fetching page 1 of submissions... 5%"
   - "Fetching page 2 of submissions... 25%"
   ↓
3. ERROR: Network timeout at 45%
   - "Fetching page 5 of submissions... 45%"
   - Network error: Request timeout after 30 seconds
   ↓
4. System Handles Error
   - Progress modal updates:
     * Title: "❌ Sync Failed"
     * Message: "Network error during data fetch. Please try again."
     * Details: "Fetched 200/544 submissions before error"
   - Partial data is NOT saved (atomic operation)
   - Cache remains in previous state (valid old cache or empty)
   - Status: Reverts to previous (🟢 if old cache valid, 🔴 if no cache)
   ↓
5. User Options
   - [Retry Now] (immediate retry)
   - [Try Fetch-on-Request Instead] (switch modes)
   - [Close] (dismiss, user can retry later)
   ↓
6. If User Clicks "Retry Now"
   - System attempts build again
   - Uses exponential backoff (5s, 10s, 20s delays between retries)
   - Max 3 retries before suggesting Fetch-on-Request
   ↓
7. If User Clicks "Try Fetch-on-Request Instead"
   - Toggle switches: ON → OFF
   - localStorage.setItem('cacheStrategy', 'on-demand')
   - Modal closes
   - User can now navigate with fetch-on-request (2-4s per page)
   ↓
8. Alternative: Rate Limit Error
   - Error: "429 Too Many Requests"
   - Message: "JotForm API rate limit exceeded. Please wait 60 seconds."
   - Shows countdown timer: "Retry available in 58s..."
   - Auto-retry when timer reaches 0
```

**Error Logging:**
```javascript
// Log errors for debugging
console.error('[CacheBuild] Failed at 45%', {
  error: 'Network timeout',
  fetchedSubmissions: 200,
  totalSubmissions: 544,
  lastSuccessfulPage: 4,
  retryAttempt: 1,
  timestamp: Date.now()
});
```

---

### Key Integration Points

**1. Home Page Initialization:**
```javascript
// On page load
async function initCheckingSystem() {
  // Step 1: Load saved strategy
  const strategy = localStorage.getItem('cacheStrategy');
  const toggle = document.getElementById('cache-strategy-toggle');
  toggle.checked = strategy === 'full';
  
  // Step 2: Auto-detect device if no preference
  if (!strategy) {
    const isMobile = detectMobileDevice();
    toggle.checked = !isMobile; // Desktop: ON, Mobile: OFF
    localStorage.setItem('cacheStrategy', isMobile ? 'on-demand' : 'full');
  }
  
  // Step 3: Check cache validity (only if Full Cache mode)
  if (toggle.checked) {
    const cacheValid = await checkCacheValidity();
    if (!cacheValid) {
      showCacheInvalidWarning();
    }
  }
  
  // Step 4: Handle autoSync parameter
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('autoSync')) {
    await triggerCacheSync();
  }
}
```

**2. Drilldown Page Entry:**
```javascript
// On every drilldown page load
async function loadDrilldownPage(level, identifier) {
  // Step 1: Check cache requirement
  if (!checkCacheRequirement(level)) {
    return; // Blocked with modal
  }
  
  // Step 2: Load data based on strategy
  const strategy = localStorage.getItem('cacheStrategy');
  let data;
  
  if (strategy === 'full') {
    data = await loadFromCache(level, identifier);
  } else {
    showLoadingIndicator();
    data = await fetchOnDemand(level, identifier);
    hideLoadingIndicator();
  }
  
  // Step 3: Render page
  renderPage(data);
}
```

**3. Cache Refresh Button:**
```javascript
// Refresh button behavior
document.getElementById('refresh-cache-btn').addEventListener('click', async () => {
  const strategy = localStorage.getItem('cacheStrategy');
  
  if (strategy === 'full') {
    // Full cache: Rebuild entire cache
    await buildFullCache();
  } else {
    // Fetch-on-request: Clear lightweight cache only
    clearLightweightCache();
    showToast('Cache cleared. Data will refresh on next page load.');
  }
});
```

---

### Summary: Cache Toggle Impact on User Workflow

| Workflow Stage | Full Cache Mode (Toggle ON) | Fetch-on-Request Mode (Toggle OFF) |
|---------------|----------------------------|-----------------------------------|
| **Initial Setup** | Password + 90s cache build | Password + instant ready |
| **Storage Used** | 93-98 MB (persistent) | 1-5 MB (temporary) |
| **Page Loads** | <100ms all pages | 2-4s student, 60-120s class, blocked school+ |
| **Offline Support** | ✅ Full offline browsing | ❌ Requires active internet |
| **Mode Switch** | Can switch to fetch-on-request (instant, cache remains) | Can switch to full cache (requires 90s rebuild) |
| **Cache Refresh** | Manual or 1-hour auto-expire | No cache to refresh (always fresh) |
| **Qualtrics Sync** | Integrated into cache build | Fetched per-student as needed |
| **Error Recovery** | Retry full build or switch modes | Retry single API call |

### Fetch-on-Request Implementation

#### Level 4: Student Detail Page

**Current (Full Cache):**
```javascript
// Instant load from validation cache
const validation = await validationStorage.getItem(coreId);
displayStudentData(validation); // <100ms
```

**Fetch-on-Request:**
```javascript
async function loadStudentDataOnDemand(coreId) {
  const strategy = loadCacheStrategy();
  
  if (strategy === 'full') {
    // Use existing cache system
    const validation = await validationStorage.getItem(coreId);
    return validation;
  }
  
  // Fetch-on-request mode
  console.log('[OnDemand] Fetching data for student:', coreId);
  showLoadingIndicator('Loading student data...');
  
  try {
    // Step 1: Fetch student's submissions only (filtered API call)
    const submissions = await fetchStudentSubmissions(coreId);
    
    // Step 2: Merge submissions
    const mergedAnswers = mergeStudentSubmissions(submissions);
    
    // Step 3: Validate with TaskValidator
    const taskValidation = await window.TaskValidator.validateAllTasks(mergedAnswers);
    
    // Step 4: Calculate status
    const setStatus = calculateSetStatus(taskValidation);
    const overallStatus = calculateOverallStatus(setStatus);
    
    // Optional: Cache this student only (lightweight cache)
    await cacheStudentOnly(coreId, {
      taskValidation,
      setStatus,
      overallStatus,
      timestamp: Date.now()
    });
    
    hideLoadingIndicator();
    
    return {
      coreId,
      taskValidation,
      setStatus,
      overallStatus
    };
    
  } catch (error) {
    hideLoadingIndicator();
    showError('Failed to load student data: ' + error.message);
    throw error;
  }
}
```

**Performance:**
- API call: ~1-2s (filter by student ID)
- Validation: ~500ms (TaskValidator on 14 tasks)
- Display: ~100ms
- **Total: 2-4 seconds per student**

**Benefits:**
- ✅ No upfront cache building
- ✅ Minimal storage (only current student)
- ✅ Always fresh data

**Drawbacks:**
- ❌ 2-4s wait per student navigation
- ❌ Requires active internet
- ❌ Multiple API calls (rate limiting risk)

#### Level 3: Class Detail Page (30 Students)

**Current (Full Cache):**
```javascript
// Read from pre-computed aggregates
const classData = await classStorage.getItem(classId);
displayClassSummary(classData); // <100ms
```

**Fetch-on-Request:**
```javascript
async function loadClassDataOnDemand(classId) {
  const strategy = loadCacheStrategy();
  
  if (strategy === 'full') {
    return await classStorage.getItem(classId);
  }
  
  // Fetch-on-request mode
  console.log('[OnDemand] Fetching data for class:', classId);
  showLoadingIndicator('Loading class data for 30 students...');
  
  try {
    // Step 1: Get student list from encrypted mapping
    const students = await getStudentsInClass(classId);
    
    // Step 2: Fetch submissions for ALL students in class
    // Option A: Parallel fetch (fast but high API load)
    const studentDataPromises = students.map(s => loadStudentDataOnDemand(s.coreId));
    const studentData = await Promise.all(studentDataPromises);
    
    // Option B: Sequential fetch (slower but API-friendly)
    // const studentData = [];
    // for (const student of students) {
    //   studentData.push(await loadStudentDataOnDemand(student.coreId));
    //   await sleep(200); // Rate limiting delay
    // }
    
    // Step 3: Aggregate student data into class summary
    const classStats = aggregateClassData(studentData);
    
    hideLoadingIndicator();
    
    return classStats;
    
  } catch (error) {
    hideLoadingIndicator();
    showError('Failed to load class data: ' + error.message);
    throw error;
  }
}
```

**Performance:**
- **Parallel Fetch:**
  - 30 API calls × ~2s = ~60-90s (with some parallelization)
  - Risk: Rate limiting (429 errors)
  - **Total: 60-120 seconds**

- **Sequential Fetch:**
  - 30 students × 2.5s (with 200ms delay) = ~75s
  - Safe: Respects rate limits
  - **Total: 75-90 seconds**

**Benefits:**
- ✅ No upfront cache building
- ✅ Always fresh data

**Drawbacks:**
- ❌ 1-2 minute wait for class page
- ❌ 30 API calls per page load
- ❌ High rate limiting risk
- ❌ Not practical for frequent use

**Mitigation:**
- Cache class data after first load (30-minute TTL)
- Show progress indicator: "Loading student 15/30..."
- Allow cancellation if user navigates away

#### Level 2: School Detail Page (8 Classes, 200 Students)

**Current (Full Cache):**
```javascript
// Read from pre-computed school aggregate
const schoolData = await schoolStorage.getItem(schoolId);
displaySchoolSummary(schoolData); // <100ms
```

**Fetch-on-Request:**
```javascript
async function loadSchoolDataOnDemand(schoolId) {
  const strategy = loadCacheStrategy();
  
  if (strategy === 'full') {
    return await schoolStorage.getItem(schoolId);
  }
  
  // Fetch-on-request mode
  console.log('[OnDemand] Fetching data for school:', schoolId);
  showLoadingIndicator('Loading school data for 8 classes (200 students)...');
  
  try {
    // Step 1: Get class list
    const classes = await getClassesInSchool(schoolId);
    
    // Step 2: Fetch data for all classes
    const classDataPromises = classes.map(c => loadClassDataOnDemand(c.classId));
    const classData = await Promise.all(classDataPromises);
    
    // Step 3: Aggregate into school summary
    const schoolStats = aggregateSchoolData(classData);
    
    hideLoadingIndicator();
    
    return schoolStats;
    
  } catch (error) {
    hideLoadingIndicator();
    showError('Failed to load school data: ' + error.message);
    throw error;
  }
}
```

**Performance:**
- 8 classes × 75s (sequential class load) = ~600s = **10 minutes**
- OR 200 students × 2.5s = ~500s = **8 minutes** (if fetching students directly)

**Benefits:**
- ✅ Always fresh data

**Drawbacks:**
- ❌ 8-10 minute wait time
- ❌ 200 API calls
- ❌ **Impractical for real use**
- ❌ Very high rate limiting risk

**Recommendation:**
- **Do NOT support fetch-on-request for School level and above**
- Display message: "School-level view requires Full Cache Mode. Please refresh with Full Cache enabled."
- Redirect to student/class search instead

#### Level 1: Group/District Pages (Multiple Schools)

**Current (Full Cache):**
```javascript
// Read from district/group aggregate
const districtData = await districtStorage.getItem(district);
displayDistrictSummary(districtData); // <100ms
```

**Fetch-on-Request:**
```javascript
// NOT SUPPORTED
function loadDistrictDataOnDemand(district) {
  throw new Error('District/Group views require Full Cache Mode. Please enable caching.');
}
```

**Reasoning:**
- 1000+ students per district
- 20-30 minute load time
- Hundreds of API calls
- **Completely impractical**

**User Experience:**
```html
<!-- Show blocking modal -->
<div class="modal modal-error">
  <h2>Full Cache Required</h2>
  <p>District and Group-level views require the Full Cache loading strategy.</p>
  <p>Current mode: <strong>Fetch-on-Request</strong></p>
  <p>Please return to the home page and switch to Full Cache mode, or use Student/Class search instead.</p>
  <div class="actions">
    <button onclick="window.location.href='checking_system_home.html'">Go to Home</button>
    <button onclick="showSearchModal()">Search Student/Class</button>
  </div>
</div>
```

### Hybrid Cache: Best of Both Worlds

**Implementation Strategy:**
```javascript
class HybridCacheManager {
  constructor() {
    this.strategy = loadCacheStrategy();
    this.lightweightCache = new Map(); // In-memory cache for recent pages
    this.cacheSize = 0;
    this.maxCacheSize = 10 * 1024 * 1024; // 10 MB limit for on-demand mode
  }
  
  async loadData(level, identifier) {
    // Full cache mode: Use existing system
    if (this.strategy === 'full') {
      return this.loadFromFullCache(level, identifier);
    }
    
    // Fetch-on-request mode with lightweight caching
    
    // Check in-memory cache first
    const cacheKey = `${level}:${identifier}`;
    if (this.lightweightCache.has(cacheKey)) {
      const cached = this.lightweightCache.get(cacheKey);
      if (Date.now() - cached.timestamp < 30 * 60 * 1000) { // 30 min TTL
        console.log('[Hybrid] Using lightweight cache:', cacheKey);
        return cached.data;
      }
    }
    
    // Fetch fresh data
    let data;
    switch (level) {
      case 'student':
        data = await this.fetchStudentOnDemand(identifier);
        break;
      case 'class':
        data = await this.fetchClassOnDemand(identifier);
        break;
      case 'school':
      case 'group':
      case 'district':
        throw new Error('This view requires Full Cache mode. Please switch loading strategy.');
      default:
        throw new Error('Unknown level: ' + level);
    }
    
    // Cache in memory (with size limit)
    this.addToLightweightCache(cacheKey, data);
    
    return data;
  }
  
  addToLightweightCache(key, data) {
    const size = JSON.stringify(data).length;
    
    // Evict oldest entries if cache too large
    while (this.cacheSize + size > this.maxCacheSize && this.lightweightCache.size > 0) {
      const oldestKey = this.lightweightCache.keys().next().value;
      const oldestEntry = this.lightweightCache.get(oldestKey);
      this.cacheSize -= JSON.stringify(oldestEntry.data).length;
      this.lightweightCache.delete(oldestKey);
      console.log('[Hybrid] Evicted from cache:', oldestKey);
    }
    
    // Add new entry
    this.lightweightCache.set(key, {
      data,
      timestamp: Date.now()
    });
    this.cacheSize += size;
    
    console.log('[Hybrid] Cached:', key, 'Total size:', this.cacheSize / 1024, 'KB');
  }
}
```

### Summary: Integrated Toggle Approach

**Key Benefits of Filter Page Integration:**
1. **Single Control Point**: Users configure caching once, applies everywhere
2. **Visual Feedback**: Toggle shows current mode and stats in real-time
3. **Contextual**: Cache strategy sits alongside filters and status pills
4. **No Extra Screens**: Eliminates need for separate mode selection page
5. **Mobile-Optimized**: Compact toggle works well on small screens

**Fetch-on-Request by Page Level:**

| Page Level | Full Cache | Fetch-on-Request | Support Status |
|-----------|-----------|-----------------|----------------|
| **Student (Level 4)** | <100ms instant | 2-4s per load | ✅ **Supported** - Acceptable UX |
| **Class (Level 3)** | <100ms instant | 60-120s per load | ⚠️ **Supported with warning** - Show progress bar |
| **School (Level 2)** | <100ms instant | 8-10 min per load | ❌ **Blocked** - Require full cache mode |
| **Group (Level 1)** | <100ms instant | 15-20 min per load | ❌ **Blocked** - Require full cache mode |
| **District (Level 1)** | <100ms instant | 20-30 min per load | ❌ **Blocked** - Require full cache mode |

**Default Settings by Device:**

| Device Type | Default Mode | Rationale |
|------------|-------------|-----------|
| **Desktop / High-Performance Laptops** | Full Cache ON | 93 MB negligible, instant navigation critical |
| **Low-Power Laptops / Older Devices** | Full Cache ON | Balance performance vs storage, show recommendation banner |
| **Mobile / Tablets** | Fetch-on-Request OFF | Limited storage/battery, typically single-student lookup |

**User Experience Flow:**
1. User visits `checking_system_home.html`
2. Page auto-detects device type
3. Toggle defaults to appropriate mode
4. Recommendation banner shows if mismatch detected
5. User can override with single toggle click
6. Strategy persists in localStorage
7. All navigation respects selected strategy
8. Blocking modal appears if accessing School/District in fetch-on-request mode

**Production Recommendation:**
- ✅ Implement toggle on filter home page
- ✅ Auto-detect device and show recommendation banner (non-intrusive)
- ✅ Allow manual override via toggle
- ✅ Show clear blocking modals for unsupported views
- ✅ Provide "Enable Full Cache" quick action button
- ✅ Persist preference across sessions

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
