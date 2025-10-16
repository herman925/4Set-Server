# 4set Web Successor — Checking System Pipeline PRD

## Purpose
Define how the Checking System ingests Jotform data, transforms it into actionable completion metrics, and publishes the results for the drilldown interfaces across district → group → school → class → student scopes.

## Context & Discovery Summary
- **Legacy insight**: Desktop tooling previously consumed locally cached CSV exports. The web successor must pivot to direct Jotform API usage while preserving completion/termination semantics.
- **Jotform API behaviour**:
  - `GET /form/{formId}/submissions` returns a paginated array with 100 results by default (maximum 1000). `limit`, `offset`, and `orderby` (`created_at`, `updated_at`) exposed for paging.
  - Filtering supports JSON payload via `filter` query parameter, e.g. `{"created_at:gt":"2024-01-01 00:00:00"}`. Filters compose with AND semantics; OR requires multiple calls.
  - Responses include `answers` with QID keys. Nested matrix answers arrive as `answer[{row}][{col}]` dictionaries; empty strings represent unanswered cells.
  - Rate limiting: documented soft cap ~1000 requests/day per key, throttled at 10 requests/second. Exceeding bursts yields HTTP 429 with `X-RateLimit-Remaining` header guidance.
  - Webhooks are available but limited to form-level events; batching still required for reconciliation.
- **Mapping assets**: Completion logic relies on `assets/id_mapping/*.enc` (district/group/school/class roster) and `assets/id_mapping/jotformquestions.json` for resolver tables.

## CRITICAL DISCOVERY: JotForm API Filter Breakthrough (October 2025)

### Problem: Server-Side Filters Were Broken
After extensive testing (documented in `test-jotform-filter.html` and `test-jotform-filters.ps1`), we discovered that JotForm's documented filter operators **DO NOT WORK** for student ID lookups:

**❌ BROKEN FILTERS (All return 545 submissions but only 2-3 actual matches):**
- `{"20:eq":"10261"}` - QID-based equality filter
- `{"student-id:eq":"10261"}` - Field name-based filter  
- `{"20:contains":"10261"}` - Contains operator on student-id field

**Root Cause:** JotForm API returns the full dataset regardless of filter parameters on the student-id field (QID 20). The API downloads all 545+ submissions before attempting to filter, and the filter logic fails to properly match student IDs.

### Solution: `:matches` Operator on SessionKey Field

**✅ WORKING FILTER:** `{"q3:matches":"10261"}` 

**Why This Works:**
- Uses the `:matches` operator (pattern matching) instead of `:eq` (exact equality)
- Filters on **sessionkey field (QID 3)** instead of student-id field (QID 20)
- SessionKey format: `{studentId}_{yyyymmdd}_{hh}_{mm}` (e.g., `10261_20251014_10_25`)
- Pattern matching finds all sessionkeys containing the student ID
- **Server-side filtering actually works** - returns only matching submissions!

**Test Results (October 16, 2025):**
```powershell
TEST 5: Matches Operator (q3:matches)
Filter: {"q3:matches":"10261"}
✅ Response: 2 submissions returned
✅ Validation: 2/2 submissions contain pattern "10261"
✅ Student IDs: 2/2 exact matches
Result: 100% accuracy, 0% false positives
```

**Performance Impact:**
- **Old Method**: Download 545 submissions (~30 MB) → Filter client-side → Get 2 matches
- **New Method**: Download 2 submissions (~110 KB) → Already filtered → Get 2 matches
- **Improvement**: 99.6% reduction in data transfer, instant results

### Implementation Requirements

**All JotForm API calls for student lookups MUST use this filter:**

```javascript
// CORRECT - Use :matches on sessionkey (QID 3)
const filter = {
  "q3:matches": studentId  // Numeric ID without "C" prefix
};

const url = `https://api.jotform.com/form/${formId}/submissions?` +
            `apiKey=${apiKey}` +
            `&filter=${encodeURIComponent(JSON.stringify(filter))}` +
            `&limit=1000` +
            `&orderby=created_at` +
            `&direction=ASC`;
```

**DO NOT use these broken filters:**
```javascript
// ❌ WRONG - These are broken and will return hundreds of wrong submissions
{"20:eq": studentId}           // Broken
{"student-id:eq": studentId}   // Broken
{"20:contains": studentId}     // Broken
```

### Files That Must Use This Filter
1. **`assets/js/jotform-cache.js`** - `filterByCoreId()` method
2. **`assets/js/checking-system-student-page.js`** - `fetchAndPopulateJotformData()` function
3. **`processor_agent.ps1`** - Student submission lookup (if migrated to web)
4. Any future student data retrieval logic

### Validation Logic Still Required
Even with working filters, implement client-side validation to ensure data integrity:

```javascript
// After fetching with :matches filter, validate each submission
for (const submission of submissions) {
  const sessionKey = submission.answers?.['3']?.answer;
  const studentId = submission.answers?.['20']?.answer;
  
  // Verify sessionkey contains the pattern
  if (!sessionKey?.includes(targetStudentId)) {
    console.warn('False positive from filter');
    continue;
  }
  
  // Verify student ID matches exactly (recommended)
  if (studentId?.trim() !== targetStudentId) {
    console.warn('SessionKey match but student ID mismatch');
    // Decide whether to include or exclude
  }
}
```

### Test Coverage
Comprehensive test suite in place:
- **HTML Interactive Tests**: `test-jotform-filter.html` (7 test scenarios)
- **PowerShell Tests**: `test-jotform-filters.ps1` (5 test scenarios with validation)
- **Test Data**: Student ID 10261 (2 submissions), SessionKey validation
- **Verification**: All 7 filter types tested, only `:matches` works correctly

### Future Considerations
- **Monitor JotForm API changes**: If they fix the `:eq` operator on QID 20, we can simplify
- **Cache strategy remains critical**: Even with working filters, global cache eliminates redundant API calls
- **Document in onboarding**: All developers must know about this filter limitation
- **Alert on filter failures**: Log warnings if returned submission count > expected

## High-Level Pipeline Flow
1. **Scheduler trigger** (cron or dashboard action) initiates the data refresh.
2. **Fetch coordinator** orchestrates batched API pulls per configured form ID, respecting rate limits and capturing pagination cursors.
3. **Snapshot cache** stores raw submissions (encrypted at rest) and indexes by `submission_id`, `sessionkey`, and `updated_at` for delta comparison.
4. **Normalization stage** converts Jotform `answers` into typed records using field map metadata (set name, task name, bilingual labels, termination flags).
5. **Completion engine** computes per-task answered/total counts, applies termination rules, and emits status lights (green/yellow/red).
6. **Aggregation layer** rolls metrics up to school/group/district scopes and assembles class + student rosters for drilldown consumption.
7. **Export service** persists computed views to the Checking System API (`/api/checking/status`, `/api/checking/detail`, `/api/checking/export`) powering the front-end.

## Detailed Components
### Fetch Coordinator
- **Configuration**: `config/checking_system_pipeline.json` enumerates form IDs, polling windows, and throttle settings per deployment.
- **Request batching**:
  - Loop `offset` in increments of the configured `limit`; stop when returned count < `limit`.
  - Capture `lastUpdatedAt = max(created_at, updated_at)` per submission for incremental syncing.
  - Apply exponential backoff (base 500ms, max 30s) on 429/5xx responses; persist retry statistics.
- **Deduplication**: Identify duplicates via combination of `submission_id` + `sessionkey`; keep latest `updated_at` and flag conflicts for remediation queue.

### Snapshot Cache
- **Storage**: Lightweight SQLite or encrypted JSON (aligned with `PRDs/checking_system_prd.md`). Schema proposal:
  - `submissions(submission_id TEXT PRIMARY KEY, form_id TEXT, sessionkey TEXT, school_id TEXT, class_id TEXT, created_at DATETIME, updated_at DATETIME, payload BLOB)`.
  - Secondary indices on `(form_id, updated_at)`, `(sessionkey)`, `(school_id, class_id)`.
- **Retention**: Default 30-day rolling window with configurable archival export to S3/Azure Blob for historical comparison.

### Normalization & Mapping
- Resolve roster metadata by joining:
  - `assets/id_mapping/schoolid.enc` (district/group metadata).
  - `assets/id_mapping/classid.enc` + `assets/id_mapping/coreid.enc` for class rosters.
  - `assets/id_mapping/jotformquestions.json` for QID → field semantics.
- Derive set membership (`Set 1`–`Set 4`) per question via `assets/id_mapping/survey-structure.json`.
- Emit normalized records:
  ```json
  {
    "sessionkey": "S-2039",
    "studentName": "Chloe Wong",
    "school": { "id": "S0001", "en": "Starlight Primary", "zh": "星光小學" },
    "class": { "id": "C100", "en": "P2A", "zh": "星耀班" },
    "sets": {
      "set1": { "answered": 48, "total": 48 },
      "set2": { "answered": 36, "total": 36 },
      "set3": { "answered": 40, "total": 42 },
      "set4": { "answered": 30, "total": 40 }
    },
    "terminationFlags": ["Rule 4.2"]
  }
  ```

### TaskValidator: Single Source of Truth
**File**: `assets/js/task-validator.js`

TaskValidator is the **centralized validation engine** for all task completion logic across the entire Checking System. It acts as an auditor that all pages must use - no custom validation logic should exist elsewhere.

**Core Responsibilities**:
- Load task definitions from `assets/tasks/*.json` and `assets/tasks/survey-structure.json`
- Validate student answers against correct answers for all 18 tasks
- Detect completion status (all questions answered vs. partial)
- Apply termination rules (e.g., CWR terminates after 10 consecutive incorrect)
- Detect timeout conditions (e.g., SYM/NONSYM 2-minute timed tests)
- Merge SYM and NONSYM into single combined task (112 questions)
- Calculate per-task statistics: `{total, answered, correct, terminated, timedOut}`
- Return standardized validation objects consumed by all UI layers

**API Surface**:
```javascript
// Validate all tasks for a student
const taskValidation = await window.TaskValidator.validateAllTasks(mergedAnswers);

// Returns:
{
  "erv": {
    taskId: "erv",
    title: "English Vocab",
    questions: [...],  // Array of {id, studentAnswer, correctAnswer, isCorrect}
    totals: { total: 51, answered: 51, correct: 48, incorrect: 3 },
    terminated: false,
    error: null
  },
  "sym": {
    taskId: "sym",
    title: "Symbolic / Non-Symbolic",
    questions: [...],  // Combined 112 questions (56 SYM + 56 NONSYM)
    totals: { total: 112, answered: 91, correct: 88 },
    terminated: false,
    timedOut: true,
    symAnalysis: { timedOut: true, lastAnsweredIndex: 45 },
    nonsymAnalysis: { timedOut: true, lastAnsweredIndex: 45 }
  },
  // ... other tasks
}
```

**Multi-Level Integration**:
- **Student Page** (`checking_system_4_student.html`): Calls `validateAllTasks()` once per student, displays detailed question tables
- **Class Page** (`checking_system_3_class.html`): Calls `validateAllTasks()` for each student, aggregates to set-level status
- **School Page** (future): Aggregates class-level validations
- **Group/District Pages** (future): Aggregates school-level validations

**Validation Flow**:
```
JotForm Submissions → Merge Answers → TaskValidator.validateAllTasks() →
{
  Task-level validation (correct/incorrect per question)
  ↓
  Set-level aggregation (4 tasks per set)
  ↓
  Status light calculation (green/yellow/red)
  ↓
  UI rendering (tables, pills, export CSVs)
}
```

**Critical Rules**:
1. **No page should implement custom validation** - all must use TaskValidator
2. **SYM and NONSYM are merged** - counted as 1 task, not 2
3. **Completion = all questions answered** - not based on percentage or `_Com` flags
4. **Termination detection** - CWR terminates after 10 consecutive incorrect (Rule 4.2)
5. **Timeout detection** - SYM/NONSYM analyze continuous answer patterns

### Completion & Termination Engine
Built on top of TaskValidator's output:
- Apply aggregation logic to roll up task validations into set-level metrics
- **Completion**: All tasks in set have `totals.answered == totals.total` (100% answered)
- **In progress**: Some tasks incomplete, calculate outstanding count
- **Not started**: No tasks have any answered questions
- Generate status lights (`status-green`, `status-yellow`, `status-red`) based on set completion rate:
  - Green: ≥90% complete
  - Yellow: 1-89% complete  
  - Grey: 0% complete
- Capture per-set notes (e.g., unanswered question IDs, termination flags, last submission timestamp) for tooltips
- Store termination reasons from TaskValidator (e.g., "CWR terminated at Q45 - Rule 4.2")

### Aggregation Layer
- Compute metrics for every hierarchy level:
  - **Student**: set-level statuses, outstanding count, termination reasons.
  - **Class**: aggregate outstanding count per set, flagged students, latest activity timestamp.
  - **School**: outstanding classes per set, termination alert counts.
  - **Group/District**: total outstanding students per set and termination distribution.
- Pre-compute CSV exports aligning with front-end actions (`Export` buttons) for each scope.

### API Surface
- `/api/checking/status`: summary metrics for dashboards.
- `/api/checking/detail`: drilldown payload providing sorted tables for current scope plus pagination tokens.
- `/api/checking/export`: triggers CSV/JSON generation using cached aggregation output.
- `/api/checking/metadata`: returns filter options (districts, groups, schools, classes, latest snapshot timestamp).
- `/api/checking/decrypt`: handles client-side decryption of `.enc` files for home page filter population.

#### Home Page Data Loading API

##### `/api/checking/decrypt` Endpoint
**Purpose**: Decrypt and return parsed data from encrypted mapping files for client-side filter population.

**Method**: POST

**Request Body**:
```json
{
  "systemPassword": "user-provided-password",
  "files": ["schoolid", "classid", "coreid"]
}
```

**Response** (Success):
```json
{
  "success": true,
  "data": {
    "schools": [
      {
        "schoolId": "S001",
        "schoolNameChinese": "天后中英文幼稚園",
        "schoolName": "Regina Coeli Anglo-Chinese Kindergarten",
        "group": 2,
        "districtCleaned": "Tuen Mun",
        "contact": "24683262",
        "email": "info@rck.edu.hk"
      }
    ],
    "classes": [
      {
        "classId": "C-001-01",
        "schoolId": "S001",
        "schoolName": "天后中英文幼稚園",
        "actualClassName": "K1B (AM)",
        "teacherNames": "陸潔儀"
      }
    ],
    "students": [
      {
        "coreId": "C10001",
        "studentId": "St11121",
        "studentName": "張梓煋",
        "schoolId": "S085",
        "classId": "C-085-02",
        "group": 3,
        "gender": "M"
      }
    ]
  },
  "metadata": {
    "recordCounts": {
      "schools": 122,
      "classes": 845,
      "students": 3333
    },
    "lastSnapshotTime": "2025-10-15T10:30:00Z",
    "dataFreshness": "healthy"
  }
}
```

**Response** (Error):
```json
{
  "success": false,
  "error": "DECRYPTION_FAILED",
  "message": "Invalid system password or corrupted encryption files"
}
```

**Implementation Requirements**:
- Use the same decryption logic as desktop tools (AES-256 with DPAPI-derived keys on Windows, or equivalent cross-platform method).
- Parse CSV data after decryption (first row is header, comma-delimited).
- Validate data structure before returning (check for required columns).
- Return only the current year's class assignments (`Class ID 25/26` from `coreid.enc`).
- Apply district normalization: map all district values to curated list (Tuen Mun, Sham Shui Po, Kowloon City, Yuen Long, Others).
- Cache decrypted data server-side for 5 minutes per session to reduce repeated decryption overhead.
- Log failed decryption attempts for security monitoring.

**Security Considerations**:
- Never log or store the `systemPassword` in plain text.
- Use HTTPS for all API calls.
- Implement rate limiting (max 10 requests per minute per IP) to prevent brute-force attacks.
- Return generic error messages (don't indicate whether password is incorrect vs. file corruption).

##### Alternative: Client-Side Decryption
If server-side decryption is not feasible, provide JavaScript decryption utilities:

**File**: `assets/js/encryption.js`
```javascript
async function decryptEncFile(encFileUrl, systemPassword) {
  // Fetch encrypted file
  const response = await fetch(encFileUrl);
  const encryptedData = await response.arrayBuffer();
  
  // Derive key from password (match desktop tool's method)
  const key = await deriveKeyFromPassword(systemPassword);
  
  // Decrypt using AES-256-GCM
  const decryptedData = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: extractIV(encryptedData) },
    key,
    extractCiphertext(encryptedData)
  );
  
  // Parse CSV
  const csvText = new TextDecoder().decode(decryptedData);
  return parseCSV(csvText);
}
```

**Usage in Home Page**:
1. Prompt user for `systemPassword` on page load.
2. Decrypt `schoolid.enc`, `classid.enc`, `coreid.enc` in parallel.
3. Build in-memory lookup tables for filtering.
4. Store decrypted data in `sessionStorage` (cleared on browser close).
5. Show loading indicator during decryption (~1-2 seconds).

**Pros**: No server-side password handling, works offline.
**Cons**: Exposes decryption logic in client code, slower initial load.

#### Home Page Routing & Filter Logic

##### Filter Resolution Algorithm
When the user clicks "Start Checking" on `checking_system_home.html`, the client-side routing logic must:

1. **Collect Active Filters**: Read all selected filter values from the UI.
2. **Determine Hierarchy Level**: Apply the following priority (lowest level wins):
   - Student filter present → Level 1 (Student Drilldown)
   - Class filter present (no Student) → Level 2 (Class Drilldown)
   - School/School ID filter present (no Class/Student) → Level 3 (School Drilldown)
   - Group filter present (no School/Class/Student) → Level 4 (Group Drilldown)
   - District filter only → Level 5 (District Drilldown)
3. **Validate Filter Combination**: Ensure Class is not selected without School; if invalid, show error and prevent navigation.
4. **Build URL**: Construct drilldown URL with primary identifier + context parameters.
5. **Store in Recent Checks**: Save the selection to `localStorage` for quick access.
6. **Navigate**: Redirect to the determined drilldown page.

##### URL Construction Examples
```javascript
// Example 1: Student selected
// Filters: School="S001", Class="C-001-02", Student="C10001"
const url = `checking_system_drilldown_desktop_1.html?studentId=C10001&classId=C-001-02&schoolId=S001&group=2&district=Tuen%20Mun`;

// Example 2: Class selected (no student)
// Filters: School="S001", Class="C-001-02"
const url = `checking_system_drilldown_desktop_2.html?classId=C-001-02&schoolId=S001&group=2&district=Tuen%20Mun`;

// Example 3: School only
// Filters: School="S001"
const url = `checking_system_drilldown_desktop_3.html?schoolId=S001&group=2&district=Tuen%20Mun`;

// Example 4: District and Group
// Filters: District="Tuen Mun", Group="2"
const url = `checking_system_drilldown_desktop_4.html?group=2&district=Tuen%20Mun`;

// Example 5: District only
// Filters: District="Tuen Mun"
const url = `checking_system_drilldown_desktop_5.html?district=Tuen%20Mun`;
```

##### JavaScript Implementation Reference
```javascript
function determineRouteAndNavigate(filters) {
  // Extract filter values
  const { district, group, school, schoolId, classId, student } = filters;
  
  // Resolve school ID (prefer explicit schoolId, fall back to school's ID)
  const resolvedSchoolId = schoolId || (school ? school.id : null);
  
  // Determine level based on hierarchy
  let level, url;
  
  if (student) {
    // Level 1: Student Drilldown
    level = 1;
    const params = new URLSearchParams({
      studentId: student.coreId,
      ...(classId && { classId }),
      ...(resolvedSchoolId && { schoolId: resolvedSchoolId }),
      ...(group && { group }),
      ...(district && { district })
    });
    url = `checking_system_drilldown_desktop_1.html?${params}`;
  } else if (classId) {
    // Level 2: Class Drilldown
    if (!resolvedSchoolId) {
      showError("Class selection requires a school. Please select a school first.");
      return;
    }
    level = 2;
    const params = new URLSearchParams({
      classId,
      schoolId: resolvedSchoolId,
      ...(group && { group }),
      ...(district && { district })
    });
    url = `checking_system_drilldown_desktop_2.html?${params}`;
  } else if (resolvedSchoolId) {
    // Level 3: School Drilldown
    level = 3;
    const params = new URLSearchParams({
      schoolId: resolvedSchoolId,
      ...(group && { group }),
      ...(district && { district })
    });
    url = `checking_system_drilldown_desktop_3.html?${params}`;
  } else if (group) {
    // Level 4: Group Drilldown
    level = 4;
    const params = new URLSearchParams({
      group,
      ...(district && { district })
    });
    url = `checking_system_drilldown_desktop_4.html?${params}`;
  } else if (district) {
    // Level 5: District Drilldown
    level = 5;
    const params = new URLSearchParams({ district });
    url = `checking_system_drilldown_desktop_5.html?${params}`;
  } else {
    showError("Please select at least one filter.");
    return;
  }
  
  // Store in recent checks
  saveToRecentChecks({
    timestamp: new Date().toISOString(),
    level,
    displayLabel: generateDisplayLabel(filters),
    url
  });
  
  // Navigate
  window.location.href = url;
}
```

##### Recent Checks Storage Format
```javascript
// Structure stored in localStorage under key 'checking_recent_checks'
const recentChecks = [
  {
    timestamp: "2025-10-15T10:30:00Z",
    level: 2, // 1=Student, 2=Class, 3=School, 4=Group, 5=District
    displayLabel: "K1A 愛班 · 天后中英文幼稚園",
    url: "checking_system_drilldown_desktop_2.html?classId=C-001-02&schoolId=S001",
    filters: {
      schoolId: "S001",
      classId: "C-001-02"
    }
  },
  // ... up to 10 most recent
];

### Student Drilldown Client Integration (Implemented)

The student detail page (`checking_system_4_student.html`) implements a complete data loading and display pipeline:

#### **URL Parameter Structure (Clean Single-ID Design)**
```
checking_system_4_student.html?studentId={coreId}
```

**Only the Core ID is passed.** All parent context (class, school, district, group) is derived from the student record by looking up related data in cached Maps.

#### **Initialization Flow** (`checking-system-student-page.js`)

1. **Parse URL Parameters**
   ```javascript
   const coreId = urlParams.get('coreId'); // Core ID only (e.g., C10001)
   // No other URL params needed - derive all context from data
   ```

2. **Load Student Identity Data**
   - Check `sessionStorage` for cached data (version 1.2)
   - Cache includes:
     - Identity data: `schools`, `classes`, `students` arrays
     - Lookup maps: Built from cached arrays
     - **Credentials**: `apiKey`, `formId` (already decrypted on home page)
   - If not cached, redirect to home page
   - Retrieve student record, school record, class record
   - Populate profile HTML elements (Core ID, Student ID, Name, Gender, School, District, Class, Group)

3. **Fetch Jotform Submission Data**
   - Load API credentials from cached data (no decryption needed - already done on home page)
   - Build filter using Core ID without "C" prefix: `{"20:eq":"10001"}`
   - **Endpoint**: `GET https://api.jotform.com/form/{formId}/submissions`
   - **Query Parameters**:
     - `filter`: `{"<student-id-qid>:eq":"<numeric-core-id>"}` (URL-encoded)
     - `limit`: 1000 (get all historical submissions)
     - `orderby`: `created_at`
     - `direction`: `ASC`
     - `orderby`: `created_at` (chronological order)

4. **Merge Multiple Submissions**
   - Parse `sessionkey` (QID 3) format: `coreid_yyyymmdd_hh_mm`
   - Extract timestamp from each submission
   - Union all answer sets across submissions
   - **Conflict resolution**: Prefer *earlier* session when same question answered multiple times
   - Maximum 511 questions per student
   - Output single merged record with maximum field coverage

5. **Calculate Completion Metrics**
   - Load `assets/jotformquestions.json` for question metadata
   - Map question IDs to readable names (English/Chinese)
   - Group questions by Set (Set 1, Set 2, Set 3, Set 4)
   - Calculate per-set metrics:
     - Total questions in set
     - Questions answered
     - Questions unanswered
     - Completion percentage
   - Load termination rules from `TEMP/tasks/termination-rules.md`
   - Check for termination conditions (e.g., multiple wrong answers in critical section)
   - Assign traffic light status:
     - **Green**: All required questions answered, no terminations
     - **Yellow**: Partial completion or approaching termination threshold
     - **Red**: Termination condition triggered or critical questions missing

6. **Cache Merged Data**
   - Store in `localStorage` with key: `student_jotform_{coreId}`
   - Include timestamp and 1-hour TTL
   - Structure:
     ```javascript
     {
       coreId: "C10001",
       mergedAnswers: {...}, // Full answer set
       submissions: [...],    // Raw submissions
       metrics: {...},        // Calculated metrics
       timestamp: "2025-10-15T11:00:00Z",
       expiresAt: "2025-10-15T12:00:00Z"
     }
     ```

7. **UI Rendering**
   - **Task Status Cards**: Display completion % per set with colored status circles
   - **Question Tables**: Expandable details sections showing:
     - Question ID, English text, Chinese text
     - Student's answer with correct/incorrect badge
     - Termination flag icon if triggered
   - **Export Button**: Generate CSV with all Q&A pairs
   - **Refresh Button**: Bypass cache and fetch fresh Jotform data
   - **Breadcrumb Navigation**: Clickable path back through hierarchy

#### **Jotform API Implementation Requirements**

**Authentication** (Cached from Home Page):
```javascript
// Credentials already decrypted on home page and cached in sessionStorage
const cachedData = window.CheckingSystemData.getCachedData();
const credentials = cachedData.credentials; // { apiKey, formId, ... }
const apiKey = credentials.apiKey;
const formId = credentials.formId;

// No password prompt, no decryption on drilldown pages!
```

**Fetch Submissions**:
```javascript
async function fetchStudentSubmissions(coreId, apiKey, formId, studentIdQid) {
  // Correct filter format: {"<qid>:eq":"<value>"}
  const filter = JSON.stringify({
    [`${studentIdQid}:eq`]: coreId
  });
  
  const url = `https://api.jotform.com/form/${formId}/submissions?` +
              `filter=${encodeURIComponent(filter)}` +
              `&limit=1000` +
              `&orderby=created_at` +
              `&direction=ASC` +
              `&apiKey=${apiKey}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    if (response.status === 429) throw new Error('RATE_LIMIT');
    throw new Error(`API Error: ${response.status}`);
  }
  
  return response.json();
}

// Example usage:
// If studentId QID is 7, Core ID is "C10001":
// filter becomes: {"7:eq":"C10001"}
// URL-encoded: %7B%227%3Aeq%22%3A%22C10001%22%7D
```

**Merge Algorithm**:
```javascript
function mergeSubmissions(submissions) {
  const answersByTimestamp = submissions
    .map(sub => ({
      timestamp: parseSessionKey(sub.answers['3'].answer), // QID 3 = sessionkey
      answers: sub.answers
    }))
    .sort((a, b) => a.timestamp - b.timestamp); // Earlier first
  
  const merged = {};
  
  for (const { answers } of answersByTimestamp) {
    for (const [qid, answer] of Object.entries(answers)) {
      // Only add if not already present (prefer earlier)
      if (!merged[qid]) {
        merged[qid] = answer;
      }
    }
  }
  
  return merged;
}
```

**Error Handling**:
- **Rate Limit (429)**: Show warning toast, use cached data if available
- **Network Error**: Display "Offline" badge, use cached data with staleness indicator
- **No Submissions**: Show "No data submitted yet" message with helpful CTA
- **Invalid Core ID**: Display error, offer "Back to Home" button
- **Decryption Failure**: Clear cache, re-prompt for password

**Cache Policy**:
- TTL: 1 hour
- Manual refresh: Clears cache for specific student, fetches fresh data
- Global cache clear: On password re-entry or logout
- Automatic expiry check on page load from `termination-rules.md`.

## Testing & Validation Strategy
- **Manual probes**:
  - Use curl or PowerShell `Invoke-RestMethod` to call `https://api.jotform.com/form/{formId}/submissions` with sandbox keys; validate pagination, filter accuracy, and response latency.
  - Capture representative payloads for unit-test fixtures, masking PII before storing under `/TEMP/checking-system/sample_responses/`.
- **Automated integration tests**:
  - Mock Jotform using WireMock or MSW with recorded payloads; ensure the pipeline handles pagination, duplicates, and throttling.
  - Regression suite verifying completion/termination calculations against curated golden datasets (import from legacy desktop exports).
- **Performance soak**:
  - Simulate 10k submissions; assert processing completes <5 minutes (baseline DS923+) and memory usage stays within 512MB for the pipeline service.
- **Monitoring hooks**:
  - Emit timing metrics (`fetch_duration_ms`, `normalization_duration_ms`), API success/error counts, and cache growth to the telemetry bus.

## Deployment & Operations
- Package pipeline as a service alongside the processor agent or as a dedicated worker container (Synology docker compose).
- Support feature flags for incremental adoption (e.g., enable class drilldown after verifying data coverage).
- Document recovery steps: clear cache, re-seed from last known full snapshot, rotate API keys.

## Dependencies
- Jotform REST API credentials with read access to relevant forms.
- Mapping assets maintained by curriculum/data teams (`assets/id_mapping/` updates propagated alongside pipeline releases).
- Secure storage (DPAPI/Credential Manager on Windows, DSM Docker Secrets on Synology) for API tokens.

## Risks & Mitigations
- **Rate limiting**: Mitigate via batching and queued retries; add alert when remaining quota <10%.
- **Schema drift**: Monitor `answers` structure; trigger alerts when unseen QIDs appear; require quick patch process.
- **Data freshness**: Provide dashboard banner when snapshot age exceeds SLA (default 30 min) or last run failed.

## Home Page Integration Summary

The `checking_system_home.html` page serves as the intelligent entry point to the Checking System, implementing the following key features:

### Core Capabilities
1. **Authentication & Data Loading**
   - Prompts for `systemPassword` on page load
   - Decrypts and parses `schoolid.enc`, `classid.enc`, `coreid.enc` via `/api/checking/decrypt` endpoint or client-side utilities
   - Caches decrypted data for session duration
   - Provides ~3500 student records, 845 classes, 122 schools for filtering

2. **Dynamic Filter Interface**
   - Six filter types: District, Group, School, Class, School ID, Student
   - Dependent filter logic (Class requires School, Group narrows by District)
   - Bilingual search support (English + Chinese)
   - Multi-select capabilities with removable chips
   - Real-time validation and error messages

3. **Intelligent Routing**
   - Evaluates filter combination to determine lowest touched hierarchy level
   - Routes to appropriate drilldown (Level 5→District down to Level 1→Student)
   - Constructs URLs with full context parameters for breadcrumb reconstruction
   - Validates impossible combinations (e.g., Class without School)

4. **User Experience Enhancements**
   - Recent Checks storage (last 10 selections in localStorage)
   - Quick-access pill buttons for frequently used filters
   - System health badge showing data freshness
   - Mobile-responsive design with collapsible filters
   - Loading indicators during decryption/data loading

### Implementation Notes
- Estimated page load time: 1-2 seconds (including decryption)
- Works offline if `.enc` files are cached
- Supports both server-side and client-side decryption approaches
- All routing logic is client-side JavaScript for instant navigation
- No backend dependencies beyond encrypted file serving

### Data Flow
```
User → Home Page → System Password → Decrypt .enc files → 
Populate Filters → User Selects → Validate → Determine Level → 
Build URL → Navigate to Drilldown
```

### Integration Points
- **Incoming**: Links from main dashboard, direct URL access
- **Outgoing**: Routes to 5 drilldown pages with URL parameters
- **Data Sources**: `assets/schoolid.enc`, `assets/classid.enc`, `assets/coreid.enc`
- **APIs**: `/api/checking/decrypt` (optional, if server-side decryption used)
- **Storage**: `sessionStorage` for decrypted data, `localStorage` for recent checks

## Open Questions
- Preferred cadence for full re-syncs vs incremental pulls (daily full sync to catch late edits?).
- Should we adopt Jotform webhooks to reduce latency while retaining batch reconciliation?
- Storage choice for long-term historical snapshots (SQLite vs. Postgres vs. cloud object storage).
- Do we expose raw submission payloads to operators via secure download, or keep only aggregated summaries?
- Should decryption be server-side (secure but requires backend) or client-side (faster but exposes logic)?
- How frequently should the home page refresh encrypted file data (manual only, or periodic auto-refresh)?
