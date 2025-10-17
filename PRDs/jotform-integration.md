---
title: Jotform Integration
owner: Project Maintainers
last-updated: 2025-10-17
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

## Complete API Call Process Documentation

This section provides step-by-step documentation of how the upload and create submission process works across all system components.

### System Architecture Overview

The 4Set system has three primary paths for uploading data to JotForm:

1. **Web Upload Interface** (`upload.html`) - Direct file upload via browser
2. **Processor Agent** (`processor_agent.ps1`) - Automated PDF processing pipeline
3. **Python Upload Tool** (`upload.py`) - Command-line/programmatic upload

All three paths converge on the same JotForm API endpoints and follow the same upsert workflow.

### End-to-End Upload Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 1: Data Collection                       │
├─────────────────────────────────────────────────────────────────┤
│ Web Upload:     User drops PDF → File System Access API writes  │
│                 to OneDrive-synced folder with .meta.json        │
│                                                                   │
│ Processor Agent: Watches incoming/ folder for new PDFs          │
│                  Triggered by file system events                 │
│                                                                   │
│ Python Tool:    Direct invocation with data file path           │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 2: PDF Parsing                           │
├─────────────────────────────────────────────────────────────────┤
│ • Call: python parser/parse_pdf_cli.py <pdf_path>               │
│ • Extract: All form fields using pypdf/PyPDF2 library           │
│ • Normalize: Field names via HEADER_MAPPING                     │
│   - "Student ID" → "student-id"                                  │
│   - "School ID" → "school-id"                                   │
│ • Output: JSON with structure:                                  │
│   {                                                              │
│     "student-id": "C13268",                                      │
│     "school-id": "S023",                                        │
│     "ERV_Q1": "2",                                              │
│     "ERV_Q1_Sc": "1",  // Score helper                          │
│     ...                                                          │
│   }                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                    STEP 3: Validation                            │
├─────────────────────────────────────────────────────────────────┤
│ Phase 1 - Filename Validation:                                  │
│   • Pattern: xxxxx_YYYYMMDD_HH_MM.pdf                           │
│   • Extract: student ID, date, time components                  │
│   • Reject if: Invalid format → filed/Unsorted/                 │
│                                                                   │
│ Phase 2 - Cross-Field Validation:                               │
│   • Decrypt: assets/coreid.enc for student lookup               │
│   • Verify: Core ID exists in mapping                           │
│   • Compare: PDF school ID vs expected school ID                │
│   • Reject if: Mismatch detected → filed/Unsorted/              │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                  STEP 4: Data Enrichment                         │
├─────────────────────────────────────────────────────────────────┤
│ Computed Fields:                                                 │
│   • sessionkey: "<studentid>_<yyyymmdd>_<hh>_<mm>"             │
│   • computerno: Extract from hostname (e.g., KS095 → "095")    │
│   • jotformsubmissionid: "" (placeholder)                       │
│                                                                   │
│ Lookup Fields (from coreid.enc):                                │
│   • child-name: Student's full name                             │
│   • class-id: Class identifier (25/26 year only)                │
│   • Gender: Fallback if missing in PDF                          │
│                                                                   │
│ Lookup Fields (from classid.enc):                               │
│   • class-name: Human-readable class name                       │
│                                                                   │
│ Termination Calculations:                                       │
│   • Calculate: term_ERV_Ter1, term_CM_Ter1, etc.               │
│   • Use: _Sc helper fields for logic                            │
│   • Remove: All _Sc fields after calculation                    │
│   • Values: "0" = continued, "1" = terminated                   │
│                                                                   │
│ Write enriched JSON to disk (before upload attempt)             │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              STEP 5: Field Mapping & Payload Build               │
├─────────────────────────────────────────────────────────────────┤
│ Load Mapping:                                                    │
│   • File: assets/jotformquestions.json                          │
│   • Structure: { "field-name": "qid", ... }                     │
│   • Example: { "sessionkey": "3", "student-id": "20" }         │
│   • Fallback: GET /form/{formId}/questions if missing          │
│                                                                   │
│ Transform Data:                                                  │
│   • Input:  { "student-id": "C13268", "school-id": "S023" }    │
│   • Output: { "20": "C13268", "21": "S023" }                   │
│   • Format: submission[<qid>] = <value>                         │
│                                                                   │
│ Filter Fields:                                                   │
│   • Include: Only fields with QID mappings                      │
│   • Exclude: jotformsubmissionid (metadata only)                │
│   • Strip: Empty/None values for updates                        │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│         STEP 6: Search for Existing Submission (UPSERT)          │
├─────────────────────────────────────────────────────────────────┤
│ METHOD 1: Filter API (Fast Path)                                │
│   • Endpoint: GET /form/{formId}/submissions                    │
│   • Filter: {"<session_qid>:eq":"<sessionkey>"}                │
│   • Example: {"3:eq":"13268_20250904_14_07"}                   │
│   • URL Encode: %7B%223%3Aeq%22%3A%2213268_20250904_14_07%22%7D │
│   • Parameters:                                                  │
│     - apiKey: <api_key>                                         │
│     - filter: <encoded_filter>                                  │
│     - limit: 1000                                               │
│     - orderby: created_at                                       │
│     - direction: ASC                                            │
│   • Timeout: 20-30 seconds                                      │
│                                                                   │
│   Validation:                                                    │
│     • Parse response.content array                              │
│     • Extract: answers[session_qid].answer (or .text)          │
│     • Normalize: Trim whitespace, collapse double spaces        │
│     • Compare: Extracted value === sessionkey                   │
│     • Return: submissionId if exact match                       │
│                                                                   │
│ METHOD 2: Pagination Fallback (Safety Net)                      │
│   • Triggered when: Filter fails/times out/returns zero         │
│   • Endpoint: GET /form/{formId}/submissions                    │
│   • Parameters:                                                  │
│     - apiKey: <api_key>                                         │
│     - limit: 1000 (configurable: paginationLimit)              │
│     - offset: 0, 1000, 2000, ... (incremented per page)        │
│     - orderby: created_at                                       │
│   • Loop: Up to maxPagesToScan (default: 5 pages)              │
│   • Rate Limit: Wait rateLimitMs between pages                 │
│   • Same validation logic as METHOD 1                           │
│                                                                   │
│ Result:                                                          │
│   • Found: submissionId → Proceed to UPDATE                     │
│   • Not Found: null → Proceed to CREATE                         │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
                    ┌────────┴────────┐
                    │                 │
              FOUND: UPDATE      NOT FOUND: CREATE
                    │                 │
                    ↓                 ↓
┌─────────────────────────────────────────────────────────────────┐
│              STEP 7A: UPDATE Existing Submission                 │
├─────────────────────────────────────────────────────────────────┤
│ Endpoint: POST /submission/{submissionId}                       │
│                                                                   │
│ Request Format:                                                  │
│   URL: https://api.jotform.com/submission/{submissionId}       │
│   Method: POST                                                   │
│   Content-Type: application/x-www-form-urlencoded               │
│   Parameters:                                                    │
│     - apiKey=<api_key>                                          │
│   Body (form-encoded):                                          │
│     submission[20]=C13268                                        │
│     submission[21]=S023                                          │
│     submission[100]=2                                            │
│     ...                                                          │
│                                                                   │
│ Important Notes:                                                 │
│   • EXCLUDE sessionkey QID from update payload                  │
│   • Strip empty/None values to avoid clearing fields            │
│   • Chunk large payloads (≈80 fields per request)              │
│   • Multiple POSTs treated as partial updates by JotForm       │
│                                                                   │
│ Chunking Logic:                                                  │
│   • Split payload into chunks of maxFieldsPerChunk (80)        │
│   • Send sequential POSTs to same submissionId                  │
│   • Example: 200 fields → 3 requests (80 + 80 + 40)           │
│   • Log: "POST {url} (fields 1-80 of 200)"                     │
│                                                                   │
│ Response Handling:                                               │
│   • Success: 200 OK                                             │
│   • Keep existing submissionId                                  │
│   • Optional: Re-fetch to verify update                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │  ┌─────────────────────────────────┐
                             │  │   STEP 7B: CREATE New Submission │
                             │  ├─────────────────────────────────┤
                             │  │ Endpoint: POST /form/{formId}/  │
                             │  │          submissions             │
                             │  │                                  │
                             │  │ Request Format:                  │
                             │  │   URL: https://api.jotform.com/ │
                             │  │        form/{formId}/submissions│
                             │  │   Method: POST                   │
                             │  │   Content-Type: application/     │
                             │  │                x-www-form-       │
                             │  │                urlencoded        │
                             │  │   Parameters:                    │
                             │  │     - apiKey=<api_key>          │
                             │  │   Body (form-encoded):           │
                             │  │     submission[3]=13268_2025... │
                             │  │     submission[20]=C13268        │
                             │  │     submission[21]=S023          │
                             │  │     ...                          │
                             │  │                                  │
                             │  │ Important Notes:                 │
                             │  │   • INCLUDE sessionkey in create │
                             │  │   • Strip empty/None values      │
                             │  │   • No chunking needed (single  │
                             │  │     request)                     │
                             │  │                                  │
                             │  │ Response Handling:               │
                             │  │   • Parse: response.content.    │
                             │  │           submissionID          │
                             │  │   • Fallback: response.content. │
                             │  │              id                  │
                             │  │   • Store new submissionId       │
                             │  │                                  │
                             │  │ Error Recovery:                  │
                             │  │   • On 409 conflict: Re-try     │
                             │  │     search (rare race condition) │
                             │  │   • On uniqueness error: Fall   │
                             │  │     back to search + update      │
                             │  └────────────┬────────────────────┘
                             │              │
                             └──────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│              STEP 8: Retry Logic & Error Handling                │
├─────────────────────────────────────────────────────────────────┤
│ Retry Schedule:                                                  │
│   • Attempts: 3-5 (configurable: maxRetries)                    │
│   • Delays: Exponential backoff [10s, 30s, 90s]                │
│   • Jitter: ±20% randomization to avoid thundering herd        │
│                                                                   │
│ Retryable Errors:                                                │
│   • 429 Rate Limit - Wait burstCooldownSeconds (60s)           │
│   • 5xx Server Errors - Transient failures                      │
│   • Timeouts - Network instability                             │
│   • Connection Errors - Temporary connectivity issues           │
│                                                                   │
│ Non-Retryable Errors:                                            │
│   • 4xx Client Errors (except 429) - Bad request                │
│   • 401 Unauthorized - Invalid API key                          │
│   • 403 Forbidden - Insufficient permissions                    │
│   • 400 Bad Request - Malformed payload                         │
│                                                                   │
│ Rate Limiting:                                                   │
│   • Per-request delay: rateLimitMs (250ms)                      │
│   • Per-minute quota: perMinuteQuota (120 req/min)             │
│   • Burst cooldown: After 429, wait 60s before retry           │
│   • Parallel workers: maxConcurrent (2) with isolation          │
│                                                                   │
│ Logging:                                                         │
│   • Level INFO: "Jotform upload attempt N of M"                 │
│   • Level WARN: "Upload failed (429), retrying after 10s"      │
│   • Level ERROR: "PERMANENTLY FAILED after N attempts"          │
│   • Include: sessionkey, submissionId, HTTP status, error msg   │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
                    ┌────────┴────────┐
                    │                 │
              SUCCESS           PERMANENT FAILURE
                    │                 │
                    ↓                 ↓
┌─────────────────────────────────────────────────────────────────┐
│              STEP 9A: Write Back Submission ID                   │
├─────────────────────────────────────────────────────────────────┤
│ Update Source Files:                                             │
│                                                                   │
│ JSON Files:                                                      │
│   • Read: Original enriched JSON                                │
│   • Update: data.jotformsubmissionid = "<submission_id>"       │
│   • Write: Back to same file path                              │
│   • Preserve: All other fields and structure                    │
│                                                                   │
│ CSV Files (Multi-row):                                           │
│   • Locate: Row by sessionkey match                             │
│   • Update: jotformsubmissionid column                          │
│   • Preserve: All other rows and columns                        │
│   • Use: Temporary file + atomic replace                        │
│                                                                   │
│ CSV Files (Two-column key/value):                               │
│   • Append: jotformsubmissionid,<submission_id>                │
│   • Or update: Existing jotformsubmissionid row                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             │  ┌─────────────────────────────────┐
                             │  │   STEP 9B: Handle Failure        │
                             │  ├─────────────────────────────────┤
                             │  │ After Exhausting Retries:        │
                             │  │   • Log: ERROR with full details │
                             │  │   • Include: sessionkey, HTTP    │
                             │  │             status, error message│
                             │  │   • Move: PDF + JSON to filed/   │
                             │  │          Unsorted/               │
                             │  │   • Keep: jotformsubmissionid    │
                             │  │          empty in JSON           │
                             │  │   • Flag: For manual review      │
                             │  │                                  │
                             │  │ Detection:                        │
                             │  │   • Empty jotformsubmissionid in │
                             │  │     filed/Unsorted/*.json        │
                             │  │   • Search logs for "PERMANENTLY │
                             │  │     FAILED" by sessionkey        │
                             │  │                                  │
                             │  │ Recovery:                         │
                             │  │   • Fix: Root cause (network,    │
                             │  │          rate limit, data error) │
                             │  │   • Move: Files back to incoming/│
                             │  │   • Re-process: Automatic retry  │
                             │  └────────────┬────────────────────┘
                             │              │
                             └──────────────┘
                                    ↓
┌─────────────────────────────────────────────────────────────────┐
│                  STEP 10: Filing & Cleanup                       │
├─────────────────────────────────────────────────────────────────┤
│ Success Path:                                                    │
│   • Destination: filed/{school-id}/                             │
│   • Files: Both PDF and JSON moved together                     │
│   • JSON contains: Valid jotformsubmissionid                    │
│   • Purpose: Audit trail and backup                             │
│                                                                   │
│ Failure Path:                                                    │
│   • Destination: filed/Unsorted/                                │
│   • Files: Both PDF and JSON (if exists)                        │
│   • JSON contains: Empty jotformsubmissionid                    │
│   • Purpose: Manual review queue                                │
│                                                                   │
│ Queue Cleanup:                                                   │
│   • Remove: Entry from queue_manifest.json                      │
│   • Update: Telemetry counters                                  │
│   • Log: FILED status with final destination                    │
│                                                                   │
│ Collision Handling:                                              │
│   • If file exists: Append timestamp suffix                     │
│   • Example: file.pdf → file_20250904_140723.pdf               │
└─────────────────────────────────────────────────────────────────┘
```

### Component-Specific Implementation Details

#### Web Upload Interface (upload.html)

**Technology:**
- File System Access API (Chrome/Edge 86+)
- Client-side JavaScript (no backend required)
- Writes directly to OneDrive-synced folders

**Upload Process:**
1. User drops PDF in browser
2. Check: PC number and destination folder configured
3. Request: Folder write permission (one-time setup)
4. Write: PDF file to monitored folder
5. Create: Metadata file `{filename}.meta.json` with:
   ```json
   {
     "uploadedFrom": "095"  // PC number
   }
   ```
6. OneDrive: Auto-syncs files to server (seconds)
7. Processor agent: Picks up and processes

**Key Files:**
- `upload.html` - Upload interface
- `assets/js/upload-config.js` - Configuration
- `assets/js/upload-detection.js` - PC number detection

#### Processor Agent (processor_agent.ps1)

**Architecture:**
- PowerShell 7+ service
- Watches `incoming/` folder
- Parallel workers via `worker.ps1` subprocesses
- Configurable concurrency (default: 2 workers)

**Function Call Chain:**
1. `Watch-IncomingFolder` - File system monitoring
2. `Move-FileToProcessing` - Stage file
3. `Invoke-PdfParser` - Extract fields
4. `Extract-PdfMetadata` - Parse JSON
5. `Invoke-Phase2Validation` - Cross-validate
6. `Enrich-JsonFields` - Add computed fields
7. `Calculate-TerminationFlags` - Apply rules
8. `Build-JotformPayload` - Map to QIDs
9. `Invoke-JotformUpsert` - Upload to JotForm
10. `File-ProcessedDocument` - Archive

**Configuration:**
- `config/agent.json` - Watch paths, polling
- `config/jotform_config.json` - Rate limits, retries
- `assets/jotformquestions.json` - Field mappings

**Key Features:**
- Queue persistence in `queue_manifest.json`
- Restart recovery (resume from manifest)
- Detailed CSV logging in `logs/YYYYMMDD_processing_agent.csv`

#### Python Upload Tool (upload.py)

**Purpose:**
- Command-line/programmatic uploads
- Bulk data processing
- Testing and debugging

**Usage:**
```bash
python upload.py <data_path> --password <system_password> --jotform
```

**Function Call Chain:**
1. `_load_credentials()` - Decrypt credentials.enc
2. `_load_records()` - Parse CSV/JSON input
3. `ensure_sessionkey()` - Derive/validate sessionkey
4. `_load_jotform_mapping()` - Load field mappings
5. `_search_submission_by_sessionkey()` - Filter or paginate
6. `_build_jotform_submission_payload()` - Transform data
7. `_request_with_retry()` - HTTP with backoff
8. `_post_update_in_chunks()` - Chunked updates
9. `_verify_submission()` - Optional verification

**Key Functions:**
- `upload_to_jotform()` - Main entry point
- `refresh_jotform_questions()` - Update mappings
- `log_upload_record()` - Optional audit logging

### API Request/Response Examples

#### Example 1: Search by Filter (Fast Path)

**Request:**
```http
GET /form/241234567890/submissions?apiKey=abc123&filter=%7B%223%3Aeq%22%3A%2213268_20250904_14_07%22%7D&limit=1000&orderby=created_at&direction=ASC
Host: api.jotform.com
```

**Decoded Filter:**
```json
{"3:eq":"13268_20250904_14_07"}
```

**Response (Found):**
```json
{
  "responseCode": 200,
  "message": "success",
  "content": [
    {
      "id": "5584719287206845678",
      "form_id": "241234567890",
      "created_at": "2025-09-04 14:07:23",
      "status": "ACTIVE",
      "answers": {
        "3": {
          "name": "sessionkey",
          "text": "13268_20250904_14_07",
          "answer": "13268_20250904_14_07",
          "type": "control_textbox"
        },
        "20": {
          "name": "student-id",
          "text": "C13268",
          "answer": "C13268"
        }
      }
    }
  ],
  "limit-left": 999
}
```

**Response (Not Found):**
```json
{
  "responseCode": 200,
  "message": "success",
  "content": [],
  "limit-left": 1000
}
```

#### Example 2: Create New Submission

**Request:**
```http
POST /form/241234567890/submissions?apiKey=abc123
Host: api.jotform.com
Content-Type: application/x-www-form-urlencoded

submission[3]=13268_20250904_14_07&submission[20]=C13268&submission[21]=S023&submission[22]=Shatin&submission[100]=2&submission[101]=1
```

**Response:**
```json
{
  "responseCode": 200,
  "message": "success",
  "content": {
    "submissionID": "5584719287206845678",
    "id": "5584719287206845678"
  }
}
```

#### Example 3: Update Existing Submission (Chunked)

**Request Chunk 1:**
```http
POST /submission/5584719287206845678?apiKey=abc123
Host: api.jotform.com
Content-Type: application/x-www-form-urlencoded

submission[100]=3&submission[101]=2&submission[102]=1&...&submission[179]=0
```

**Request Chunk 2:**
```http
POST /submission/5584719287206845678?apiKey=abc123
Host: api.jotform.com
Content-Type: application/x-www-form-urlencoded

submission[180]=1&submission[181]=0&...&submission[250]=2
```

**Response (Each Chunk):**
```json
{
  "responseCode": 200,
  "message": "success",
  "content": "success"
}
```

#### Example 4: Error Response (Rate Limited)

**Response:**
```json
{
  "responseCode": 429,
  "message": "Too Many Requests - Rate limit exceeded. Please try again later."
}
```

**Handler Action:**
- Log: "Jotform upload failed (429 Rate Limit), retrying after 60s"
- Wait: burstCooldownSeconds (60 seconds)
- Retry: With same payload

#### Example 5: Pagination Fallback

**Request Page 1:**
```http
GET /form/241234567890/submissions?apiKey=abc123&limit=1000&offset=0&orderby=created_at
Host: api.jotform.com
```

**Request Page 2:**
```http
GET /form/241234567890/submissions?apiKey=abc123&limit=1000&offset=1000&orderby=created_at
Host: api.jotform.com
```

**Loop Logic:**
```powershell
for ($page = 0; $page -lt $maxPagesToScan; $page++) {
    $offset = $page * $paginationLimit
    $url = "$baseUrl/submissions?apiKey=$apiKey&limit=$paginationLimit&offset=$offset&orderby=created_at"
    $response = Invoke-RestMethod -Uri $url
    
    foreach ($submission in $response.content) {
        $answer = $submission.answers[$sessionQid].answer
        if ($answer -eq $sessionkey) {
            return $submission.id  # Found!
        }
    }
    
    if ($response.content.Count -lt $paginationLimit) {
        break  # Last page reached
    }
    
    Start-Sleep -Milliseconds $rateLimitMs
}
return $null  # Not found after scanning
```

### Troubleshooting Guide

#### Issue: Uploads Failing with 429 Rate Limit

**Symptoms:**
- Multiple 429 responses in logs
- Uploads taking longer than usual
- Files accumulating in processing/

**Diagnosis:**
```powershell
# Check for rate limit errors
Select-String -Path logs/*.csv -Pattern "429.*Rate Limit"

# Count uploads in last minute
$recentLogs = Get-Content logs/*_processing_agent.csv | 
    Where-Object { $_ -match "Jotform upload" -and $_ -match (Get-Date).ToString("yyyy-MM-dd HH:mm") }
$recentLogs.Count
```

**Solutions:**
1. Reduce concurrent workers:
   ```json
   { "maxConcurrent": 1 }
   ```
2. Lower per-minute quota:
   ```json
   { "perMinuteQuota": 80 }
   ```
3. Increase cooldown period:
   ```json
   { "burstCooldownSeconds": 120 }
   ```

#### Issue: Submissions Not Found by Filter

**Symptoms:**
- Filter returns empty array
- Pagination finds the submission
- Logs show "Filter returned no exact match"

**Diagnosis:**
```powershell
# Test filter directly
$filter = '{"3:eq":"13268_20250904_14_07"}'
$encoded = [System.Web.HttpUtility]::UrlEncode($filter)
$url = "https://api.jotform.com/form/$formId/submissions?apiKey=$apiKey&filter=$encoded"
Invoke-RestMethod -Uri $url
```

**Potential Causes:**
1. **Whitespace mismatch**: JotForm stores with extra spaces
2. **QID mismatch**: Using wrong QID for sessionkey
3. **API bug**: Filter endpoint not working correctly

**Solutions:**
1. Normalize whitespace in comparison:
   ```python
   candidate = str(candidate).strip().replace("  ", " ")
   ```
2. Verify QID mapping:
   ```bash
   python upload.py --password <pwd> --refresh-jotform-questions
   ```
3. Rely on pagination fallback (automatic)

#### Issue: Chunked Updates Failing

**Symptoms:**
- First chunk succeeds, subsequent chunks fail
- Partial data uploaded
- Timeout errors after 80 fields

**Diagnosis:**
```powershell
# Check chunk sizes in logs
Select-String -Path logs/*.csv -Pattern "fields \d+-\d+ of \d+"

# Review timeout settings
Get-Content config/jotform_config.json | ConvertFrom-Json | 
    Select-Object updateTimeoutSec, maxFieldsPerChunk
```

**Solutions:**
1. Reduce chunk size:
   ```json
   { "maxFieldsPerChunk": 50 }
   ```
2. Increase timeout:
   ```json
   { "updateTimeoutSec": 120 }
   ```
3. Add delay between chunks:
   ```powershell
   Start-Sleep -Milliseconds 500  # After each chunk
   ```

#### Issue: Submission ID Not Written Back

**Symptoms:**
- Upload succeeds in logs
- JSON still has empty jotformsubmissionid
- Files correctly filed by school

**Diagnosis:**
```powershell
# Check if write-back occurred
$json = Get-Content filed/S023/13268_20250904_14_07.json | ConvertFrom-Json
$json.data.jotformsubmissionid

# Check for write errors
Select-String -Path logs/*.csv -Pattern "write.*back" -Context 2
```

**Potential Causes:**
1. File permissions (read-only)
2. JSON parsing error
3. Write-back code not executed

**Solutions:**
1. Check file permissions:
   ```powershell
   Get-Acl filed/S023/13268_20250904_14_07.json
   ```
2. Manually add submission ID:
   ```powershell
   $json = Get-Content <file> | ConvertFrom-Json
   $json.data.jotformsubmissionid = "5584719287206845678"
   $json | ConvertTo-Json -Depth 10 | Set-Content <file>
   ```
3. Re-process file (will update existing submission)

### Best Practices

#### 1. Sessionkey Management
- **Always** derive from filename stem
- **Never** change after creation
- **Persist** in JSON data.sessionkey field
- **Exclude** from update payloads
- **Validate** format before upload

#### 2. Error Handling
- **Implement** exponential backoff
- **Distinguish** retryable vs non-retryable errors
- **Log** every attempt with context
- **Preserve** data before upload (write JSON first)
- **Monitor** filed/Unsorted/ regularly

#### 3. Rate Limiting
- **Respect** JotForm's 60 req/min guidance
- **Use** per-request delays (250ms+)
- **Implement** burst cooldown after 429
- **Limit** concurrent workers (2-3 max)
- **Monitor** rate limit patterns

#### 4. Data Integrity
- **Validate** before upload (Phase 1 + 2)
- **Verify** after upload (optional re-fetch)
- **Write back** submission IDs immediately
- **Archive** processed files with IDs
- **Log** every decision point

#### 5. Performance Optimization
- **Use** filter API (fast path) first
- **Cache** field mappings in memory
- **Chunk** large updates (80 fields)
- **Parallelize** independent uploads
- **Profile** bottlenecks regularly

### Security Considerations

#### API Key Protection
- **Store** in credentials.enc (AES-256-GCM)
- **Never** log API keys
- **Rotate** quarterly or on compromise
- **Use** environment variables for CI/CD
- **Restrict** to least privilege scope

#### Data Protection
- **Encrypt** student data at rest
- **Use** HTTPS for all API calls
- **Validate** TLS certificates
- **Sanitize** error messages (no PII)
- **Audit** access logs monthly

#### Access Control
- **Limit** API key distribution
- **Use** service accounts for automation
- **Implement** role-based access
- **Monitor** unauthorized access attempts
- **Revoke** compromised credentials immediately

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
