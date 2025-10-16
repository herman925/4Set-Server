---
title: Jotform Integration
owner: Project Maintainers
last-updated: 2025-09-02
---

# Jotform Integration

> **Documentation Note:** This document consolidates Jotform-related specifications from several legacy PRD files into a single comprehensive source.

Single source for Jotform upload/upsert, sessionkey handling, field mapping, retries/backoff, and verification across the web app and desktop tools.

**Originally consolidated from** (now deprecated):
- `sessionkey-jotform-pipeline-plan.md`
- `jotform-api.md`

## Overview
- Primary key: `sessionkey` (lowercase). Must be stable and immutable.
- Dedupe: Jotform form defines `sessionkey` as a Unique Question. Upserts search by the `sessionkey` QID, update if found, otherwise create.
- Field naming: API calls use Jotform’s original field identifiers (numeric `qid`, `submissionId`). For debugging we label them `jotformqid` and `jotformsubmissionid` in data records.
- Mapping: Numeric `qid` values are loaded from `assets/jotformquestions.json` or fetched live via `GET /form/{formId}/questions` when missing.

## Sessionkey Rules
- Canonical source: autosave JSON filename stem; fallback to PDF filename stem when needed.
- Persist `data.sessionkey` inside autosave JSON for resilience. The uploader ensures it exists and matches the filename when possible.
- Never change a `sessionkey` after creation. Exclude `sessionkey` from update payloads; use it only for lookup.
- Typical format: `<studentid>_<yyyymmdd>_<hh>_<mm>`; validator allows any safe, non-generic value.
- Lookup format for Jotform filters (URL-encode when used as a query parameter): `{"<session_qid>:eq":"<sessionkey>"}`. Alternative operators (`:contains`, `:startswith`) are available for diagnostics but are not used in production upserts.

## API Endpoints
- Auth: API key via `apiKey` query param or `APIKEY` header.
- Get questions: GET /form/{formId}/questions
- List submissions: GET /form/{formId}/submissions?limit=...&offset=...&filter=...
- Create submission: POST /form/{formId}/submissions
- Bulk create: PUT /form/{formId}/submissions (array of {qid: {text: value}})
- Update submission: POST /submission/{submissionId}
- Delete submission: DELETE /submission/{submissionId}

Key identifiers
- Form ID: numeric segment in the Jotform URL
- Question ID: numeric `qid` per field
- Submission ID: unique per response returned by APIs

Use original API field names in HTTP calls; keep IDs as strings to preserve leading zeros.

## Upsert Workflow
1) Ensure `sessionkey` on the record via autosave/PDF stem; write back to autosave if missing.
2) Build `{name: qid}` mapping from `assets/jotformquestions.json` or fetch live questions when absent.
3) Search for an existing submission by issuing a filter request (`{"<session_qid>:eq":"<sessionkey>"}`) against `/form/{formId}/submissions`. Treat a positive match as authoritative and verify the returned `answers[session_qid].answer` before accepting.
4) If the filter returns zero results or errors, fall back to paginated scanning (`limit`, `offset`) with the same verification to ensure backward compatibility.
5) If found, update: POST /submission/{submissionId} with only changed fields (exclude `sessionkey`).
6) If not found, create: POST /form/{formId}/submissions including `sessionkey` in the payload.
7) Return per-record status with `jotformsubmissionid`, and write back IDs to source files (see Write-backs).

Write-backs (desktop uploader)
- JSON autosaves: retain structure; may already include `sessionkey` and `jotformsubmissionid`.
- CSV two-column: unchanged format; record result per row consistently with existing behavior.
- CSV multi-row: locate rows by `sessionkey` and update only `jotformsubmissionid`.

## Retries, Backoff, and Chunking
- Implement exponential backoff with mild rate limiting on 429/5xx/timeouts.
- For large updates, split fields across multiple POST /submission calls (≈80 fields per chunk typical in Data Tool).
- Desktop UI streams logs in a read-only console; work runs in a background thread to keep UI responsive.

## Field Mapping
- Mapping asset: `assets/jotformquestions.json`
  - Accepts either native `content` JSON or simplified `{ name: qid }`.
  - If missing/invalid, fetch via `GET /form/{formId}/questions` and proceed with the live map.
- During upload, transform `{field_name: value}` to `submission[qid] = value` as required by Jotform.

## Web App Integration
- Module: `js/modules/jotform.js`
- Uses search-by-sessionkey filter, then update-or-create.
- Exposes `testJotformConnection()` in Debug Mode.
- Uses Jotform’s original field names for API calls. For debugging, fields named `jotformsubmissionid` and `jotformqid` are used.

## Desktop Integration
- Module: `data_tool/upload.py`
- Guarantees `sessionkey` presence (derives from autosave/PDF), strict field filtering, upsert, retries/backoff, per-record results, and write-backs.
- Optional external logging to Jotform audit endpoints is gated by credentials feature flags.

## Configuration Reference
- Primary config file: `config/jotform_config.json`
  - `powershell.maxConcurrentPdfs`: maximum parallel worker processes (`worker.ps1`).
  - `powershell.maxFieldsPerChunk`: upper bound for update payload size; enforced during chunked updates.
  - `powershell.maxConcurrentChunks`: keep at `1` to avoid conflicting updates on the same submission.
  - `powershell.maxRetries`: number of upload retries before marking a failure.
  - `powershell.searchTimeoutSec`, `updateTimeoutSec`, `createTimeoutSec`: timeout windows for the PowerShell pipeline.
  - `powershell.rateLimitMs`: delay inserted between pagination pages and retries.
  - `powershell.maxPagesToScan`, `paginationLimit`: bounds for fallback pagination.
  - `python.maxConcurrent`: reserved for future concurrency controls; current uploader is sequential.
  - `python.perMinuteQuota`, `burstCooldownSeconds`: throttle repeat uploads to stay below Jotform rate limits.
- Update config values in coordination with operations; ensure worker scripts are restarted to pick up changes.

## Credentials and Secrets
- API key storage: `assets/credentials.enc` (AES-encrypted). Decrypt with `data_tool.encryption.decrypt_data()` using the system password requested at runtime.
- Fallback plaintext (`assets/credentials.json`) exists only for local debugging; avoid committing or distributing it.
- Credential rotation:
  - Replace the API key inside `credentials.json`.
  - Re-encrypt via the project’s credential tool (see internal runbook) and distribute the updated `.enc` file.
  - Verify new credentials by running `tools/test_jotform_filter.ps1` or a dry-run upload.
- Ensure access to encrypted credentials is limited to trusted operators.

## Pipeline Context
- Upstream sources:
  - PDF parsing (`parser/parse_pdf_cli.py`) extracts structured data into autosave JSON files.
  - Validation scripts confirm filename structure (`sessionkey` alignment) before enqueueing.
  - Enrichment merges additional identifiers (student data, device metadata) prior to upload.
- Jotform upload consumes enriched autosaves/CSVs from the processing queue.
- Downstream tasks:
  - Processed files are archived under `filed/`.
  - Monitoring scripts track upload outcomes and expose alerts for repeated failures.

## Testing and Monitoring
- Manual diagnostics:
  - `tools/test_jotform_filter.ps1`: exercises filter API vs pagination fallback; useful for verifying new credentials or mappings.
  - `tools/test_chunked_update.ps1`: stress-tests chunk size settings and update timeouts.
- Logging:
  - PowerShell emits structured logs (`UPLOAD`, `WARN`, `ERROR`) indicating search path chosen, retries, and chunk operations.
  - Python uploader uses `netlog` for HTTP tracing and `log` for functional events.
- Monitoring routines should inspect logs for repeated fallbacks to pagination or unusual 429/5xx patterns.

## Frontend Behaviour
- Web module `js/modules/jotform.js` surfaces upload actions in admin UI:
  - When an administrator triggers a resync, the module sends filtered lookup requests before deciding to create or update.
  - Debug mode exposes `testJotformConnection()` to validate API key reachability and sessionkey mapping.
  - UI renders detailed error messages (filter failures, timeouts) sourced from the backend response payloads.

### Shared API Module (`assets/js/jotform-api.js`)
For the checking system, a shared JavaScript module provides reusable Jotform API functions across all drilldown pages (District, Group, School, Class, Student).

**Benefits:**
- ✅ No duplicate code across pages
- ✅ Centralized error handling and logging
- ✅ Automatic credential retrieval from sessionStorage cache
- ✅ Consistent filter formatting and verbose logging

**Setup:**
```html
<!-- Include in HTML before page-specific scripts -->
<script src="assets/js/jotform-api.js"></script>
```

**Core Functions:**
- `window.JotformAPI.fetchStudentSubmissions(coreId, studentIdQid, verbose)` - Fetch by Core ID (auto-strips "C" prefix)
- `window.JotformAPI.fetchSchoolSubmissions(schoolId, schoolIdQid, verbose)` - Fetch by School ID
- `window.JotformAPI.fetchClassSubmissions(classId, classIdQid, verbose)` - Fetch by Class ID
- `window.JotformAPI.fetchSubmissionsWithFilters(filters, verbose)` - Custom multi-field filters (AND logic)
- `window.JotformAPI.fetchSubmissions({filter, limit, orderby, direction, verbose})` - Low-level generic fetch

**Example Usage:**
```javascript
// Student page - fetch submissions for one student
const submissions = await window.JotformAPI.fetchStudentSubmissions('C10261');

// School page - fetch all submissions for a school
const submissions = await window.JotformAPI.fetchSchoolSubmissions('S001');

// District page - fetch for multiple schools in parallel
const schools = getSchoolsInDistrict('Shatin');
const allData = await Promise.all(
  schools.map(s => window.JotformAPI.fetchSchoolSubmissions(s.schoolId, '22', false))
);
const allSubmissions = allData.flat();

// Custom filters - AND logic (use field names, not QIDs)
const submissions = await window.JotformAPI.fetchSubmissionsWithFilters({
  "school-id:eq": "S001",
  "class-id:eq": "C-001-01"
});
```

**Filter Format:**
- **IMPORTANT**: Use field NAME instead of QID for filters (Jotform recommendation)
  - ✅ Correct: `{"student-id:eq": "10261"}` (field name)
  - ❌ Incorrect: `{"20:eq": "10261"}` (QID - may not work reliably)
- Core ID auto-strips "C" prefix: `C10261` → `10261` for Jotform query
- Supports operators: `:eq`, `:gt`, `:lt`, `:contains`, `:startswith`
- Always URL-encoded automatically by the module
- **Known Issue**: QID-based filters may return all submissions instead of filtered results
  - Client-side filtering is applied as a fallback in `checking-system-student-page.js`

**Logging (when verbose=true, default):**
```
[JotformAPI] ========== API CALL ==========
[JotformAPI] Form ID: 123456789
[JotformAPI] Using field name filter instead of QID
[JotformAPI] Filter: { "student-id:eq": "10261" }
[JotformAPI] Filter (encoded): %7B%22student-id%3Aeq%22%3A%2210261%22%7D
[JotformAPI] Full URL: https://api.jotform.com/form/.../submissions?...&apiKey=API_KEY_HIDDEN
[JotformAPI] Response: 200 OK
[JotformAPI] Response structure: { responseCode: 200, submissionCount: 2 }
[JotformAPI] First submission: { id: "...", created_at: "...", studentIdField: "10261" }
[JotformAPI] =========================================

// If filter returns unexpected results:
[JotformAPI] ⚠️ WARNING: Got 517 submissions - filter may not be working!
[JotformAPI] Sample student IDs from first 5 submissions:
  [0] ID: 10261
  [1] ID: 10254  // Different students indicate filter failure
  [2] ID: 10253
[StudentPage] After client-side filtering: 2 submissions for Core ID C10261
```

**Credentials:**
- Module automatically retrieves credentials from `sessionStorage` (cached on home page)
- No manual password prompt - credentials decrypted once on `checking_system_home.html`
- Cached structure from `credentials.enc`:
  - `jotformApiKey`: Jotform API key
  - `jotformFormId`: Form ID for main survey form
  - `jotformUploadLogFormId`: Form ID for upload logs (optional)
- Module supports fallback to legacy field names (`apiKey`, `formId`) for backward compatibility

**Error Handling:**
```javascript
try {
  const submissions = await window.JotformAPI.fetchStudentSubmissions('C10261');
  if (submissions.length === 0) {
    showMessage('No submissions found');
  }
} catch (error) {
  if (error.message.includes('Credentials not available')) {
    window.location.href = 'checking_system_home.html'; // Redirect to re-enter password
  } else if (error.message.includes('Rate limited')) {
    showError('Too many requests. Please try again later.');
  } else {
    showError('Failed to load data: ' + error.message);
  }
}
```

**Field Reference (Common Fields):**
| Field Name | QID | Example Value | Filter Syntax |
|------------|-----|---------------|---------------|
| sessionkey | 3 | "10261_20251005_10_30" | `{"sessionkey:eq":"10261_20251005_10_30"}` |
| student-id | 20 | "10261" | `{"student-id:eq":"10261"}` ✅ Recommended |
| child-name | 21 | "潘姿螢" | `{"child-name:eq":"潘姿螢"}` |
| school-id | 22 | "S003" | `{"school-id:eq":"S003"}` |
| class-id | 24 | "C-003-05" | `{"class-id:eq":"C-003-05"}` |

**Note**: Always use field names in filters, not QIDs. QID-based filters (`{"20:eq":"10261"}`) may not work reliably with Jotform API.

**Performance Notes:**
- Default `limit=1000` submissions per API call
- Use `Promise.all()` for parallel fetching across multiple schools/classes
- Cache Jotform responses in `sessionStorage` with expiry to reduce API calls
- Respect Jotform's 60 req/min rate limit when fetching for many entities

## Maintenance Checklist
- Refresh `assets/jotformquestions.json` whenever the form structure changes:
  - Retrieve latest questions via `GET /form/{formId}/questions`.
  - Update the local asset and re-run filter diagnostics.
- Confirm Jotform form keeps `sessionkey` configured as a Unique Question to enforce deduplication.
- Review `config/jotform_config.json` quarterly to ensure concurrency and timeout settings remain aligned with workload.
- Validate that archive workflows (`filed/`) continue writing results and that autosave JSON files retain embedded `sessionkey` values.
- Maintain a record of filter examples and API responses for troubleshooting.

## Security Considerations
- API key scope: provision dedicated keys with least privileges necessary for submission management.
- Rate limiting: adhere to configured throttles to avoid bans; investigate spikes in 429 responses immediately.
- Audit logging: retain upload logs in accordance with organisational policy to trace sessionkey updates.
- Error handling: ensure sensitive information is not leaked in error messages returned to end users.
- Network hygiene: restrict outbound requests to trusted Jotform domains; verify TLS certificates where possible.

## Verification Checklist
- Confirm mapping contains the `sessionkey` field and QID.
- Run an upsert twice for the same `sessionkey` and ensure the second run updates in-place (no duplicates).
- Verify `jotformsubmissionid` is written back (JSON/CSV) after upload.
- Use the maintenance/debug action to refresh questions when fields change in Jotform.

## Examples
Create example (form-encoded):
- submission[<sessionkey_qid>] = <sessionkey>
- submission[<some_qid>] = 1

Update-in-place example (form-encoded):
- submission[<some_qid>] = 99999  (exclude `sessionkey`)

JSON filter (URL-encode when used as a query param):
- `{"<session_qid>:eq":"<sessionkey>"}`
- Directional overrides (`direction=ASC`) and explicit `limit` are used to stabilise result ordering when multiple records partially match.

## Filter-Based Sessionkey Search
- **Fast path**: Every uploader (Python `upload.py`, PowerShell `processor_agent.ps1`, and the web client) issues a filtered request: `GET /form/{formId}/submissions?apiKey=...&filter=%7B%22<session_qid>%3Aeq%22%3A%22<sessionkey>%22%7D&limit=1000&orderby=created_at&direction=ASC`.
  - `limit=1000` ensures the API returns all historical matches for auditing without excessive payloads.
  - `orderby=created_at&direction=ASC` makes the earliest record appear first, so retries deterministically select the original submission.
  - Responses are post-validated by comparing `answers[session_qid].answer` (falling back to `.text`) against the canonical `sessionkey`.
- **Fallback path**: When the filter request times out, returns HTTP errors, or produces zero matches while a collision is still suspected, the caller switches to paginated scanning (`limit`/`offset` windows up to `maxPagesToScan`). Scanning reuses the same normalization logic to compare answers and acts as a safety net for API regressions.
- **Error handling**: Non-2xx filter responses trigger retry/backoff routines governed by `retryScheduleSeconds` (Python) and `maxRetries` + exponential delay (PowerShell). All failures are logged with explicit context (`sessionkey`, HTTP status, filter payload) to aid debugging.
- **Parallel processing**: PowerShell’s `worker.ps1` spawns independent processes (up to `maxConcurrentPdfs` per `config/jotform_config.json`). Each worker issues its own filter request, so concurrent lookups remain isolated and do not interfere with each other. Sequential chunk updates are preserved via `maxConcurrentChunks=1`, ensuring the unique `sessionkey` is never mutated mid-update.
- **Rate limiting**: Clients respect per-worker throttling (`rateLimitMs`, `burstCooldownSeconds`) and Jotform’s documented 60 req/min guidance. Filter requests are idempotent and quick, reducing total API load compared to scanning.
- **Verification**: After an update or create, the system optionally re-fetches the submission to confirm that the stored `sessionkey` matches the expected value, guarding against rare API-side overwrites.

### Reproducing the Filter Request (Step-by-Step)
1. **Determine the session QID**
   - Read `assets/jotformquestions.json` or call `GET /form/{formId}/questions?apiKey=...`.
   - Locate the entry whose `name` equals "sessionkey"; persist its `qid` (example: `3`).
   - Support guidance: the raw questions response resembles `"3": { "qid": "3", "name": "sessionkey", "type": "control_textbox" }`.
2. **Assemble the raw filter JSON**
   - Template: `{"<session_qid>:eq":"<sessionkey>"}`.
   - Example (`sessionkey = "10036_20250915_10_41"`): `{"3:eq":"10036_20250915_10_41"}`.
   - This exact string is stored in logs before encoding for diagnostics.
3. **URL encode the filter**
   - PowerShell: `[System.Web.HttpUtility]::UrlEncode($filter)`.
   - Python: `urllib.parse.quote(filter_json, safe="{}:")` or pass `filter` via `params` and let `requests` encode it.
   - Encoded example: `%7B%223%3Aeq%22%3A%2210036_20250915_10_41%22%7D`.
4. **Construct the HTTPS request**
   - Base: `https://api.jotform.com/form/{formId}/submissions` (use your regional domain, if any).
   - Query parameters: `apiKey`, `filter`, `limit=1000`, `orderby=created_at`, `direction=ASC`.
   - Timeout: 20–30 seconds (`searchTimeoutSec` in PowerShell, 30 seconds in Python).
5. **Send the request**
   - PowerShell: `Invoke-RestMethod -Uri $filterUri -Method Get -TimeoutSec $searchTimeoutSec`.
   - Python: `requests.get(url, params=params, timeout=30)` with network logging via `netlog`.
6. **Validate the response**
   - Ensure HTTP status 200; otherwise, trigger retry/backoff.
   - Iterate `content` array; extract `answers[session_qid].answer` (fallback to `.text`).
   - Normalize whitespace (`Trim()` and collapse double spaces) and compare to canonical `sessionkey`.
   - The first exact match determines `submissionid`; log `sessionkey`, `submissionid`, filter JSON, encoded filter, and result count.
7. **Return outcome**
   - On success: return the matching `submissionid` to the upsert caller.
   - On zero matches: return `None`/`$null` so the caller attempts creation or triggers the fallback scan.

**Support checklist recap**
- Endpoint format: `https://api.jotform.com/form/{formId}/submissions?apiKey={apiKey}` (swap domain if hosted regionally).
- Verify QID via `GET /form/{formId}/questions?apiKey={apiKey}` before issuing filters.
- Raw filter JSON: `{"3:eq":"10036_20250915_10_41"}`.
- URL-encoded filter query: `%7B%223%3Aeq%22%3A%2210036_20250915_10_41%22%7D`.
- Field-name alternative (diagnostics): `{"sessionkey:eq":"10036_20250915_10_41"}`.
- Recommended pagination modifiers: `&limit=1000&orderby=created_at&direction=ASC`.
- Diagnostic operators (not used in production upserts): `{"3:contains":"10036_20250915"}`, `{"3:startswith":"10036_"}`.

### Fallback Pagination Mechanics
1. **Trigger conditions**
   - Filter request raised an exception (timeout, 5xx, connectivity).
   - Filter response returned zero matches but a collision remains suspected (e.g., create returned conflict).
2. **Request parameters**
   - Base URL identical to the filter request but without `filter`.
   - Query params: `apiKey`, `limit=$paginationLimit` (default 1000), `offset` increments per page, `orderby=created_at`.
3. **Loop control**
   - Maximum pages: `maxPagesToScan` from `config/jotform_config.json` (default 5 → 5,000 submissions).
   - Pause between pages: `Start-Sleep -Milliseconds $rateLimitMs` (PowerShell) or `time.sleep(burstCooldownSeconds)` (Python).
4. **Page scanning**
   - For each `content` entry, read `answers[session_qid].answer` or `.text`, normalize, and compare.
   - Stop immediately upon exact match and return `submissionid`.
5. **Termination**
   - Exit loop when `pageCount < limit`, `pageNum > maxPagesToScan`, or after a match is found.
   - If no match after final page, return `None`/`$null` and allow the caller to proceed with a create request.
6. **Logging and telemetry**
   - Record pages scanned, elapsed time, and rate compliance per `UPLOAD` log level.
   - Emit warnings if pagination was required (`WARN` channel) to flag potential filter regressions.

### Parallel and Safety Considerations
- PowerShell workers (`worker.ps1`) run as independent processes: each maintains its own retry state and does not share HTTP clients. Parallel filters therefore do not clash.
- Configuration knobs (`maxConcurrentPdfs`, `maxConcurrentChunks`, `rateLimitMs`) bound concurrency so that Jotform rate limits are respected even when two filters execute simultaneously.
- Python’s uploader processes records sequentially but respects `perMinuteQuota` and `burstCooldownSeconds`; fast filter matches keep overall throughput high.
- All clients exclude `sessionkey` from update payloads to avoid accidental identifier rewrites during concurrent updates.

Minimal response handling (pseudo):
- Create: parse returned JSON for `content.id` or `content.submissionID` → `jotformsubmissionid`.
- Update: success indicated by status; re-fetch optional to verify field changes.

## Notes
- QIDs are form-specific; always refresh or verify after form edits.
- Always URL-encode JSON `filter` values in requests.
- Keep `sessionkey` lowercase across systems (JS, Python, SQL) to avoid case mismatches.
