---
title: JotForm & Qualtrics Integration
owner: Project Maintainers
last-updated: 2025-10-25
---

# JotForm & Qualtrics Integration

> **Documentation Note:** This document consolidates JotForm and Qualtrics integration specifications into a single comprehensive source for the 4Set data caching pipeline.

Single source for JotForm upload/upsert, Qualtrics data extraction, sessionkey handling, field mapping, retries/backoff, data merging, and verification across the web app and desktop tools.

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

---

# Qualtrics Integration

## Overview

The 4Set system integrates with **Qualtrics** to retrieve assessment data for **all tasks** (ERV, SYM, TOM, CM, CWR, HTKS, TEC, TGMD, etc.), which supplements the primary JotForm data pipeline. All tasks can originate from either Qualtrics OR JotForm, requiring a dual-source data merging strategy.

**Key Characteristics:**
- **Primary Use Case**: All task assessment data collection (632 fields extracted from Qualtrics)
- **Data Source Priority**: "Earliest non-empty wins" - timestamp-based merge strategy (JotForm vs Qualtrics)
- **Grade Detection**: Automatic K1/K2/K3 classification based on assessment date (Aug-Jul school year)
- **Integration Point**: Checking System (IndexedDB cache layer)
- **Authentication**: API token-based (stored in encrypted `credentials.enc`)
- **Survey Configuration**: Centralized survey ID and datacenter region in credentials

**Credentials Structure (in `credentials.enc`):**
```json
{
  "qualtricsApiKey": "<API_KEY>",
  "qualtricsDatacenter": "syd1",
  "qualtricsSurveyId": "SV_23Qbs14soOkGo9E"
}
```
**Note:** The datacenter value has been updated from deprecated `au1` to `syd1` (Sydney datacenter).
**Note:** The field name is `qualtricsApiKey` (not `qualtricsApiToken`). The JavaScript code supports both for backwards compatibility.

---

## Qualtrics API Architecture

### API Fundamentals

**Base URL Structure:**
```
https://{datacenter}.qualtrics.com/API/v3/
```
- Example: `https://syd1.qualtrics.com/API/v3/` (Sydney datacenter, replaces deprecated au1)
- Datacenter value stored in `qualtricsDatacenter` credential field

**Authentication:**
- Method: HTTP Header `X-API-TOKEN`
- Token stored in encrypted credentials: `qualtricsApiKey` (or `qualtricsApiToken` for backwards compatibility)
- All requests require token authentication

**Common Headers:**
```http
X-API-TOKEN: {api_token}
Content-Type: application/json
Accept: application/json
```

### Core API Endpoints

#### 1. List Surveys
**Purpose**: Retrieve list of surveys accessible to the API token

**Endpoint:**
```
GET /API/v3/surveys
```

**Response Structure:**
```json
{
  "result": {
    "elements": [
      {
        "id": "SV_23Qbs14soOkGo9E",
        "name": "TGMD Assessment Survey",
        "ownerId": "UR_...",
        "lastModified": "2025-09-15T10:30:00Z",
        "isActive": true
      }
    ],
    "nextPage": null
  },
  "meta": {
    "requestId": "...",
    "httpStatus": "200 - OK"
  }
}
```

**Key Fields:**
- `id`: Survey identifier (used in subsequent API calls)
- `name`: Human-readable survey name
- `isActive`: Survey availability status

#### 2. Get Survey Definition
**Purpose**: Retrieve survey structure, questions, and metadata

**Endpoint:**
```
GET /API/v3/surveys/{surveyId}
```

**Response Structure:**
```json
{
  "result": {
    "SurveyID": "SV_23Qbs14soOkGo9E",
    "SurveyName": "TGMD Assessment",
    "questions": {
      "QID126166418": {
        "questionText": "Preferred Hand",
        "questionType": "MC",
        "questionName": "TGMD_Hand"
      },
      "QID126166420": {
        "questionText": "Hopping Performance",
        "questionType": "Matrix",
        "subQuestions": {
          "1": "Trial 1",
          "2": "Trial 2"
        },
        "choices": {
          "1": "Criterion 1",
          "2": "Criterion 2",
          "3": "Criterion 3",
          "4": "Criterion 4"
        }
      }
    },
    "flow": [
      {
        "type": "EmbeddedData",
        "field": "student-id"
      },
      {
        "type": "EmbeddedData",
        "field": "sessionkey"
      }
    ]
  }
}
```

**Key Components:**
- `questions`: Map of QID → question metadata
- `flow`: Survey flow including embedded data fields
- `questionType`: Question format (MC, Matrix, TE, etc.)
- `subQuestions` & `choices`: For matrix questions (TGMD uses extensively)

#### 3. Start Response Export
**Purpose**: Initiate asynchronous export of survey responses

**Endpoint:**
```
POST /API/v3/surveys/{surveyId}/export-responses
```

**Request Payload:**
```json
{
  "format": "json",
  "compress": false,
  "useLabels": false,
  "questionIds": [
    "QID126166418",
    "QID126166419",
    "QID126166420"
  ],
  "embeddedDataIds": [
    "student-id",
    "sessionkey",
    "school-id"
  ],
  "surveyMetadataIds": [
    "startDate",
    "endDate",
    "recordedDate"
  ]
}
```

**Request Parameters:**
- `format`: Export format (`json`, `csv`, `spss`, `xml`)
- `compress`: Whether to ZIP the export (recommend `false` for JSON)
- `useLabels`: Use choice labels vs numeric values (recommend `false` for raw data)
- `questionIds`: Array of specific QIDs to include (or omit for all)
- `embeddedDataIds`: Custom embedded data fields to include
- `surveyMetadataIds`: Standard metadata fields to include

**Response:**
```json
{
  "result": {
    "progressId": "ES_abcd1234xyz",
    "percentComplete": 0.0,
    "status": "inProgress"
  },
  "meta": {
    "requestId": "...",
    "httpStatus": "200 - OK"
  }
}
```

**Key Fields:**
- `progressId`: Unique identifier for polling progress (save this!)
- `percentComplete`: Initial value (0.0)
- `status`: Export status (`inProgress`, `complete`, `failed`)

#### 4. Check Export Progress
**Purpose**: Poll export job status until completion

**Endpoint:**
```
GET /API/v3/surveys/{surveyId}/export-responses/{progressId}
```

**Response (In Progress):**
```json
{
  "result": {
    "progressId": "ES_abcd1234xyz",
    "percentComplete": 45.0,
    "status": "inProgress"
  }
}
```

**Response (Complete):**
```json
{
  "result": {
    "progressId": "ES_abcd1234xyz",
    "percentComplete": 100.0,
    "status": "complete",
    "fileId": "abcd1234-5678-90ef-ghij-klmnopqrstuv"
  }
}
```

**Key Fields:**
- `percentComplete`: Progress percentage (0.0 - 100.0)
- `status`: Current status
- `fileId`: Only present when `status === "complete"` (use for download)

**Polling Strategy:**
- Initial delay: 2-3 seconds
- Poll interval: 2-5 seconds
- Timeout: 120 seconds (exports typically complete in 10-30 seconds)
- Exponential backoff on repeated failures

#### 5. Download Export File
**Purpose**: Retrieve completed export file

**Endpoint:**
```
GET /API/v3/surveys/{surveyId}/export-responses/{fileId}/file
```

**Response:**
- **Content-Type**: `application/json` (if format=json), `application/zip` (if compressed)
- **Body**: Raw file content (JSON array or ZIP archive)

**JSON Response Structure:**
```json
{
  "responses": [
    {
      "responseId": "R_abc123",
      "values": {
        "QID126166418": "1",
        "QID126166419": "2",
        "QID126166420": {
          "1_1": "1",
          "1_2": "0",
          "1_3": "1",
          "1_4": "1",
          "2_1": "1",
          "2_2": "1",
          "2_3": "0",
          "2_4": "1"
        },
        "student-id": "10261",
        "sessionkey": "10261_20251005_10_30",
        "startDate": "2025-10-05T10:30:15Z",
        "endDate": "2025-10-05T10:45:22Z"
      },
      "labels": {},
      "displayedFields": [],
      "displayedValues": {}
    }
  ]
}
```

**Key Response Fields:**
- `responseId`: Unique Qualtrics response identifier
- `values`: Map of QID/fieldName → answer
- `labels`: Choice labels (if `useLabels: true`)
- Matrix questions: Nested object with `{rowId}_{columnId}` keys

**ZIP Handling:**
If `compress: true` in export request:
1. Download ZIP archive
2. Extract first file from archive (usually named `{surveyId}.json`)
3. Parse extracted JSON content

---

## Data Structure & Field Mapping

### Qualtrics Response Format

**Standard Fields (Always Present):**
```json
{
  "responseId": "R_abc123def456",
  "startDate": "2025-10-05T10:30:15Z",
  "endDate": "2025-10-05T10:45:22Z",
  "recordedDate": "2025-10-05T10:45:30Z",
  "status": "IP_Complete",
  "ipAddress": "203.123.45.67",
  "progress": 100,
  "duration": 907,
  "finished": true,
  "distributionChannel": "anonymous"
}
```

**Embedded Data Fields (Custom):**
```json
{
  "student-id": "10261",
  "sessionkey": "10261_20251005_10_30",
  "school-id": "S003",
  "class-id": "C-003-05"
}
```

**Question Responses (TGMD Example):**
```json
{
  "QID126166418": "1",
  "QID126166419": "2",
  "QID126166420": {
    "1_1": "1",
    "1_2": "0",
    "1_3": "1",
    "1_4": "1"
  }
}
```

### Field Mapping Strategy

**Mapping File**: `assets/qualtrics-mapping.json`

**Purpose**: Translate Qualtrics QIDs to standardized field names compatible with JotForm

**Structure:**
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

**Mapping Patterns:**

1. **Simple Fields**: Direct QID mapping
   ```json
   "TGMD_Hand": "QID126166418"
   ```
   Maps to: `response.values.QID126166418`

2. **Text Entry Sub-fields**: QID with `_TEXT` suffix
   ```json
   "student-id": "QID125287935_TEXT"
   ```
   Maps to: `response.values.QID125287935.text` or `response.values.QID125287935_TEXT`

3. **Matrix Sub-questions**: QID with `#{rowId}_{columnId}` syntax
   ```json
   "TGMD_111_Hop_t1": "QID126166420#1_1"
   ```
   Maps to: `response.values.QID126166420['1_1']`

4. **Embedded Data**: Direct field name (no QID)
   ```json
   "sessionkey": "sessionkey"
   ```
   Maps to: `response.values.sessionkey`

5. **Metadata Fields**: Special notation with timezone
   ```json
   "Start Date": "startDate;timeZone;Z"
   ```
   Maps to: `response.startDate` with ISO8601/UTC conversion

### TGMD Field Coverage

**All TGMD Fields in Qualtrics** (lines 534-580 in `qualtrics-mapping.json`):
- **Hand/Leg Preference**: `TGMD_Hand`, `TGMD_Leg`
- **Hopping (111-114)**: 4 criteria × 2 trials = 8 fields
- **Jumping (211-214)**: 4 criteria × 2 trials = 8 fields
- **Sliding (311-314)**: 4 criteria × 2 trials = 8 fields
- **Dribbling (411-413)**: 3 criteria × 2 trials = 6 fields
- **Catching (511-513)**: 3 criteria × 2 trials = 6 fields
- **Throwing (611-614)**: 4 criteria × 2 trials = 8 fields
- **Comment Field**: `TGMD_Com`
- **Total**: 45 TGMD-specific fields

**Field Name Pattern**: `TGMD_{test}{criterion}{trial}`
- Test: 1=Hop, 2=Jump, 3=Slide, 4=Dribble, 5=Catch, 6=Throw
- Criterion: 11-14 (varies by test)
- Trial: t1 or t2

---

## Data Extraction Workflow

### Complete Export Process

```
┌─────────────────────────────────────────────────────────────────┐
│                   STEP 1: Retrieve Credentials                   │
├─────────────────────────────────────────────────────────────────┤
│ • Decrypt credentials.enc using system password                 │
│ • Extract:                                                       │
│   - qualtricsApiKey (stored as qualtricsApiKey in credentials)  │
│   - qualtricsDatacenter                                          │
│   - qualtricsSurveyId                                            │
│ • Validate token format and datacenter value                    │
│ • Cache credentials in sessionStorage for reuse                 │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│               STEP 2: Load Field Mapping Configuration           │
├─────────────────────────────────────────────────────────────────┤
│ • Load: assets/qualtrics-mapping.json                           │
│ • Parse field name → QID mappings                               │
│ • Build reverse map: QID → field name (for transformation)      │
│ • Identify TGMD-specific fields (TGMD_* prefix)                 │
│ • Extract embedded data field names (student-id, sessionkey)    │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                  STEP 3: Start Export Request                    │
├─────────────────────────────────────────────────────────────────┤
│ POST /API/v3/surveys/{surveyId}/export-responses               │
│                                                                  │
│ Payload Configuration:                                           │
│   {                                                              │
│     "format": "json",                                            │
│     "compress": false,                                           │
│     "useLabels": false,                                          │
│     "questionIds": [                                             │
│       "QID126166418",  // TGMD_Hand                             │
│       "QID126166419",  // TGMD_Leg                              │
│       "QID126166420",  // Hopping matrix                        │
│       ... all TGMD QIDs ...                                      │
│     ],                                                           │
│     "embeddedDataIds": [                                         │
│       "student-id",                                              │
│       "sessionkey",                                              │
│       "school-id",                                               │
│       "class-id"                                                 │
│     ],                                                           │
│     "surveyMetadataIds": [                                       │
│       "startDate",                                               │
│       "endDate",                                                 │
│       "recordedDate"                                             │
│     ]                                                            │
│   }                                                              │
│                                                                  │
│ Response: { progressId: "ES_...", status: "inProgress" }       │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                   STEP 4: Poll Export Progress                   │
├─────────────────────────────────────────────────────────────────┤
│ Loop:                                                            │
│   1. Wait 2-3 seconds (initial), then 2 seconds per poll        │
│   2. GET /API/v3/surveys/{surveyId}/export-responses/           │
│       {progressId}                                               │
│   3. Check response.result.status:                              │
│      • "inProgress": Continue polling                           │
│      • "complete": Extract fileId, proceed to download          │
│      • "failed": Log error, retry or abort                      │
│   4. Update UI progress indicator (optional)                    │
│   5. Timeout after 120 seconds if not complete                  │
│                                                                  │
│ Progress Updates (Logged):                                       │
│   - "Export started (progressId: ES_...)"                       │
│   - "Export progress: 25%..."                                   │
│   - "Export progress: 50%..."                                   │
│   - "Export complete! (fileId: ...)"                            │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                  STEP 5: Download Export File                    │
├─────────────────────────────────────────────────────────────────┤
│ GET /API/v3/surveys/{surveyId}/export-responses/{fileId}/file  │
│                                                                  │
│ Response Handling:                                               │
│   • Check Content-Type header                                   │
│   • If application/json: Parse directly                         │
│   • If application/zip:                                         │
│     - Extract ZIP to memory (BytesIO)                           │
│     - Read first file from archive                              │
│     - Parse JSON content                                        │
│   • Validate JSON structure (responses array)                   │
│   • Log: "Downloaded {N} responses"                             │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│              STEP 6: Transform Qualtrics to Standard Format      │
├─────────────────────────────────────────────────────────────────┤
│ For each response in export:                                    │
│                                                                  │
│ 1. Extract Core Identifiers:                                    │
│    • sessionkey = response.values.sessionkey                    │
│    • student-id = response.values["student-id"]                 │
│    • school-id = response.values["school-id"]                   │
│                                                                  │
│ 2. Transform QIDs to Field Names:                               │
│    • Simple fields: Use mapping directly                        │
│      QID126166418 → "TGMD_Hand"                                 │
│    • Matrix fields: Parse nested object                         │
│      response.values.QID126166420["1_1"] → "TGMD_111_Hop_t1"   │
│    • Text fields: Extract .text property                        │
│      response.values.QID125287935.text → "student-id"          │
│                                                                  │
│ 3. Format Standardization:                                       │
│    • Dates: Convert ISO8601 to YYYYMMDD or keep ISO            │
│    • Numeric values: Ensure string type for consistency        │
│    • Empty values: Convert null/undefined to ""                 │
│                                                                  │
│ 4. Add Metadata:                                                 │
│    • source: "qualtrics"                                         │
│    • qualtricsResponseId: response.responseId                   │
│    • retrievedAt: new Date().toISOString()                      │
│                                                                  │
│ Output Structure (per response):                                 │
│   {                                                              │
│     "sessionkey": "10261_20251005_10_30",                       │
│     "student-id": "10261",                                       │
│     "school-id": "S003",                                         │
│     "TGMD_Hand": "1",                                            │
│     "TGMD_111_Hop_t1": "1",                                      │
│     ... all TGMD fields ...,                                     │
│     "_meta": {                                                   │
│       "source": "qualtrics",                                     │
│       "qualtricsResponseId": "R_abc123",                         │
│       "retrievedAt": "2025-10-17T09:30:00Z"                     │
│     }                                                            │
│   }                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             ↓
┌─────────────────────────────────────────────────────────────────┐
│                 STEP 7: Merge with JotForm Data                  │
├─────────────────────────────────────────────────────────────────┤
│ (See "Data Merging Strategy" section below)                     │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Pseudo-Code

```javascript
async function fetchQualtricsData() {
  // Step 1: Get credentials
  const credentials = await decryptCredentials();
  const { qualtricsApiToken, qualtricsDatacenter, qualtricsSurveyId } = credentials;
  const baseUrl = `https://${qualtricsDatacenter}.qualtrics.com/API/v3`;
  
  // Step 2: Load field mapping
  const mapping = await fetch('assets/qualtrics-mapping.json').then(r => r.json());
  const tgmdQids = Object.entries(mapping)
    .filter(([key]) => key.startsWith('TGMD_'))
    .map(([_, qid]) => qid.split('#')[0]) // Extract base QID
    .filter((v, i, a) => a.indexOf(v) === i); // Unique
  
  // Step 3: Start export
  const exportPayload = {
    format: 'json',
    compress: false,
    useLabels: false,
    questionIds: tgmdQids,
    embeddedDataIds: ['student-id', 'sessionkey', 'school-id', 'class-id'],
    surveyMetadataIds: ['startDate', 'endDate', 'recordedDate']
  };
  
  const startResponse = await fetch(
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
  
  const { result: { progressId } } = await startResponse.json();
  console.log('[Qualtrics] Export started:', progressId);
  
  // Step 4: Poll progress
  let fileId = null;
  let attempts = 0;
  const maxAttempts = 60; // 2 minutes
  
  while (!fileId && attempts < maxAttempts) {
    await sleep(attempts === 0 ? 3000 : 2000);
    
    const progressResponse = await fetch(
      `${baseUrl}/surveys/${qualtricsSurveyId}/export-responses/${progressId}`,
      { headers: { 'X-API-TOKEN': qualtricsApiToken } }
    );
    
    const { result } = await progressResponse.json();
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
  
  // Step 5: Download file
  const fileResponse = await fetch(
    `${baseUrl}/surveys/${qualtricsSurveyId}/export-responses/${fileId}/file`,
    { headers: { 'X-API-TOKEN': qualtricsApiToken } }
  );
  
  const exportData = await fileResponse.json();
  console.log('[Qualtrics] Downloaded', exportData.responses.length, 'responses');
  
  // Step 6: Transform responses
  const transformedData = exportData.responses.map(response => 
    transformQualtricsResponse(response, mapping)
  );
  
  return transformedData;
}

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
  
  // Transform each mapped field
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

---

## Data Merging Strategy

### Problem Context

**Dual-Source Challenge**: Assessment data for all tasks (ERV, SYM, TOM, CM, CWR, HTKS, TEC, TGMD, etc.) can exist in:
1. **Qualtrics** (primary source - administered via web survey, 632 fields extracted)
2. **JotForm** (secondary source - PDF form upload pipeline)

**Scenarios:**
- **Scenario A**: Student has data in Qualtrics only → Use Qualtrics data
- **Scenario B**: Student has data in JotForm only → Use JotForm data
- **Scenario C**: Student has data in BOTH → Merge with "earliest non-empty wins" timestamp-based resolution
- **Scenario D**: Student has no data → Mark as missing

### Core Principle: "Earliest Non-Empty Wins"

**Implemented in:** `assets/js/data-merger.js` (PR #92, #96, #97)

**Merge Strategy:**
- **Level 1 (Within-Source)**: When multiple submissions exist from the same source
  - JotForm: Sort by `created_at` (earliest first), first non-empty value wins
  - Qualtrics: Sort by `recordedDate` (earliest first), first non-empty value wins
  
- **Level 2 (Cross-Source)**: When merging Qualtrics with JotForm
  - Compare timestamps: JotForm `created_at` vs Qualtrics `recordedDate`
  - Earliest non-empty value wins regardless of source
  - Example: If JotForm recorded Oct 1 and Qualtrics Oct 3, JotForm value is kept

**Grade Detection**: Automatic K1/K2/K3 classification based on assessment date
- School year boundaries: August to July
  - K1: Aug 2023 - Jul 2024
  - K2: Aug 2024 - Jul 2025
  - K3: Aug 2025 - Jul 2026
- Primary source: `recordedDate` (Qualtrics ISO 8601)
- Fallback: `sessionkey` (JotForm format: `{coreId}_{YYYYMMDD}_{HH}_{MM}`)

### Merging Algorithm

#### Phase 1: Sessionkey/CoreID Alignment

**Objective**: Match Qualtrics and JotForm records by `coreId` (both sources use same student identifier)

```javascript
function mergeDataSources(jotformData, qualtricsData) {
  // Step 1: Sort Qualtrics by date (earliest first)
  const sortedQualtricsData = qualtricsData.sort((a, b) => {
    const dateA = a._meta?.startDate ? new Date(a._meta.startDate) : new Date(0);
    const dateB = b._meta?.startDate ? new Date(b._meta.startDate) : new Date(0);
    return dateA - dateB;
  });
  
  // Step 2: Group Qualtrics records by coreId and merge multiple responses
  const qualtricsByCoreId = new Map(); // coreId → merged Qualtrics data
  for (const record of sortedQualtricsData) {
    const coreId = record.coreId;
    if (qualtricsByCoreId.has(coreId)) {
      // Multiple Qualtrics responses - merge using earliest non-empty wins
      const existing = qualtricsByCoreId.get(coreId);
      const merged = mergeMultipleQualtricsRecords(existing, record);
      qualtricsByCoreId.set(coreId, merged);
    } else {
      qualtricsByCoreId.set(coreId, record);
    }
  }
  
  // Step 3: Process JotForm records and merge with Qualtrics
  const mergedRecords = [];
  for (const jotformRecord of jotformData) {
    const coreId = jotformRecord.coreId;
    
    if (qualtricsByCoreId.has(coreId)) {
      // Merge ALL task fields (not just TGMD) using timestamp comparison
      const qualtricsData = qualtricsByCoreId.get(coreId);
      const merged = mergeAllFields(jotformRecord, qualtricsData);
      mergedRecords.push(merged);
    } else {
      // JotForm-only record - add grade detection
      const record = { ...jotformRecord, _sources: ['jotform'] };
      if (window.GradeDetector) {
        record.grade = window.GradeDetector.determineGrade({ sessionkey: jotformRecord.sessionkey });
      }
      mergedRecords.push(record);
    }
  }
  
  // Step 4: Add Qualtrics-only records (students not in JotForm)
  const jotformCoreIds = new Set(jotformData.map(r => r.coreId).filter(Boolean));
  for (const [coreId, qualtricsRecord] of qualtricsByCoreId.entries()) {
    if (!jotformCoreIds.has(coreId)) {
      const record = { ...qualtricsRecord, _sources: ['qualtrics'], _orphaned: true };
      if (window.GradeDetector) {
        record.grade = window.GradeDetector.determineGrade({
          recordedDate: qualtricsRecord._meta?.startDate || qualtricsRecord.recordedDate
        });
      }
      mergedRecords.push(record);
    }
  }
  
  return mergedRecords;
}
```

#### Phase 2: Field-Level Merging

**All Task Field Merge Rules** (when both sources have data):

1. **Timestamp-Based Priority**: Earliest non-empty value wins
   - Compare JotForm `created_at` timestamp vs Qualtrics `recordedDate` timestamp
   - The source with the earlier timestamp provides the value for conflicting fields
   
2. **Complete Extraction**: All 632 Qualtrics fields are merged
   - Tasks included: ERV, SYM, TOM, CM, CWR, HTKS, TEC, TGMD, and all others
   - Not limited to TGMD fields anymore (implemented in PR #92)

3. **Conflict Detection**: If values differ and timestamps are available:
   - Log the conflict with both timestamps
   - Mark conflict in metadata: `_qualtricsConflicts: [{ field, jotform, qualtrics, resolution }]`
   - Resolution field indicates which source was used based on timestamp

4. **Grade Integration**: Every merged record gets a `grade` field (K1/K2/K3)

```javascript
function mergeAllFields(jotformRecord, qualtricsRecord) {
  const merged = { ...jotformRecord };
  const conflicts = [];
  
  // Get timestamps for comparison
  const jotformTimestamp = jotformRecord.created_at ? new Date(jotformRecord.created_at) : new Date();
  const qualtricsTimestamp = qualtricsRecord._meta?.startDate 
    ? new Date(qualtricsRecord._meta.startDate) 
    : (qualtricsRecord.recordedDate ? new Date(qualtricsRecord.recordedDate) : new Date());
  
  // Extract ALL task fields from Qualtrics (not just TGMD)
  for (const [key, value] of Object.entries(qualtricsRecord)) {
    // Skip metadata fields
    if (key.startsWith('_') || key === 'responseId') continue;
    
    const jotformValue = jotformRecord[key];
    const qualtricsValue = value;
    
    // Skip if Qualtrics value is empty
    if (qualtricsValue === null || qualtricsValue === undefined || qualtricsValue === '') {
      continue;
    }
    
    // If JotForm doesn't have this field, use Qualtrics value
    if (!jotformValue || jotformValue === '') {
      merged[key] = qualtricsValue;
      continue;
    }
    
    // Both have values - use earliest non-empty value
    if (jotformValue !== qualtricsValue) {
      conflicts.push({
        field: key,
        jotform: jotformValue,
        jotformTimestamp: jotformTimestamp.toISOString(),
        qualtrics: qualtricsValue,
        qualtricsTimestamp: qualtricsTimestamp.toISOString(),
        resolution: jotformTimestamp <= qualtricsTimestamp ? 'jotform' : 'qualtrics'
      });
      
      // Keep earliest value based on timestamp
      if (qualtricsTimestamp < jotformTimestamp) {
        merged[key] = qualtricsValue;
      }
      // else: keep JotForm value (already in merged via spread)
    }
  }
  
  // Update metadata
  merged._sources = ['jotform', 'qualtrics'];
  if (conflicts.length > 0) {
    merged._qualtricsConflicts = conflicts;
  }
  
  // Add grade detection (K1/K2/K3)
  if (window.GradeDetector) {
    merged.grade = window.GradeDetector.determineGrade({
      recordedDate: qualtricsRecord._meta?.startDate || qualtricsRecord.recordedDate,
      sessionkey: jotformRecord.sessionkey
    });
  }
  
  return merged;
}
```

### TGMD-Specific Processing

**Matrix-Radio Scoring** (implemented in PR #94):

TGMD uses observational assessment with trial-based scoring that requires special handling:

1. **Trial Aggregation**: Each criterion has two trials (t1, t2)
   - Row score = t1 + t2 (max 2 per criterion)
   - Example: `TGMD_111_Hop_t1: 1, TGMD_111_Hop_t2: 0` → Row score: 1/2

2. **Task Grouping**: Criteria grouped by motor task
   - 1.單腳跳 (Hop): TGMD_111-114
   - 2.立定跳遠 (Long Jump): TGMD_211-214
   - 3.側併步 (Slide): TGMD_311-314
   - 4.運球 (Dribble): TGMD_411-413
   - 5.接球 (Catch): TGMD_511-513
   - 6.低手投擲 (Underhand Throw): TGMD_611-614

3. **Display Labels**: "Success/Fail" instead of "Correct/Incorrect"
   - Reflects observational nature of TGMD assessment
   - UI shows trial breakdown with row scores

**Implementation**: `assets/js/task-validator.js` (`processTGMDScoring` function)
    
    if (jotformValue && qualtricsValue && jotformValue !== qualtricsValue) {
      // Conflict detected
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

#### Phase 3: Completeness Validation

**Post-Merge Checks**:

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

---

## IndexedDB Integration

### Cache Architecture

**Objective**: Store merged JotForm + Qualtrics dataset in browser IndexedDB for offline access and performance

**Storage Structure**:
```
Database: JotFormCacheDB
├─ Store: cache (JotForm + merged Qualtrics data)
│  └─ Key: CACHE_KEY = 'jotform_global_cache'
│  └─ Value: {
│       timestamp: number,
│       submissions: Array<MergedSubmission>,
│       qualtricsLastSync: string (ISO8601),
│       version: number
│     }
└─ Store: qualtrics_cache (Qualtrics-only data for refresh)
   └─ Key: 'qualtrics_responses'
   └─ Value: {
        timestamp: number,
        responses: Array<QualtricsResponse>,
        surveyId: string
      }
```

### Cache Refresh Workflow

```javascript
class MergedDataCache {
  constructor() {
    this.jotformCache = window.JotFormCache; // Existing cache
    this.qualtricsStorage = localforage.createInstance({
      name: 'JotFormCacheDB',
      storeName: 'qualtrics_cache'
    });
  }
  
  async refreshCache() {
    console.log('[MergedCache] Starting full refresh...');
    
    // Step 1: Fetch JotForm data (use existing cache system)
    const jotformData = await this.jotformCache.getOrFetchSubmissions();
    console.log('[MergedCache] JotForm:', jotformData.length, 'submissions');
    
    // Step 2: Fetch Qualtrics data
    const qualtricsData = await fetchQualtricsData();
    console.log('[MergedCache] Qualtrics:', qualtricsData.length, 'responses');
    
    // Step 3: Merge datasets
    const mergedData = mergeDataSources(jotformData, qualtricsData);
    console.log('[MergedCache] Merged:', mergedData.length, 'records');
    
    // Step 4: Validate merge
    const validation = validateMergedData(mergedData);
    console.log('[MergedCache] Validation:', validation);
    
    // Step 5: Cache Qualtrics data separately (for incremental refresh)
    await this.qualtricsStorage.setItem('qualtrics_responses', {
      timestamp: Date.now(),
      responses: qualtricsData,
      surveyId: credentials.qualtricsSurveyId
    });
    
    // Step 6: Update main cache with merged data
    await this.jotformCache.saveToCache(mergedData);
    console.log('[MergedCache] ✅ Cache refresh complete');
    
    return {
      success: true,
      stats: validation
    };
  }
  
  async incrementalRefresh() {
    // Option: Fetch only new Qualtrics responses since last sync
    // Implementation: Use recordedDate filter in export request
    // Trade-off: More complex, but reduces API bandwidth
    
    const lastSync = await this.getLastQualtricsSync();
    if (!lastSync) {
      return this.refreshCache(); // Full refresh if no history
    }
    
    console.log('[MergedCache] Incremental refresh since', lastSync);
    
    // Modify export request to filter by date
    const exportPayload = {
      ...standardExportPayload,
      startDate: lastSync,
      endDate: new Date().toISOString()
    };
    
    // ... fetch and merge incrementally ...
  }
  
  async getLastQualtricsSync() {
    const cache = await this.qualtricsStorage.getItem('qualtrics_responses');
    return cache ? new Date(cache.timestamp).toISOString() : null;
  }
}
```

### Cache Invalidation Strategy

**Triggers for Cache Refresh**:
1. **Manual**: User clicks "Refresh Data" button in UI
2. **Scheduled**: Auto-refresh every 6-12 hours (configurable)
3. **On-Demand**: When filtering by student with missing TGMD data
4. **After Upload**: When new JotForm submissions are uploaded

**Cache Expiry**:
- **JotForm Cache**: 1 hour (existing behavior)
- **Qualtrics Cache**: 1 hour (align with JotForm)
- **Merged Cache**: Inherited from JotForm cache expiry

**Version Control**:
```javascript
const CACHE_VERSION = 2; // Increment when schema changes

async function loadCache() {
  const cache = await storage.getItem(CACHE_KEY);
  
  if (!cache || cache.version !== CACHE_VERSION) {
    console.log('[Cache] Version mismatch or missing, clearing...');
    await storage.removeItem(CACHE_KEY);
    return null;
  }
  
  return cache;
}
```

---

## Error Handling & Rate Limiting

### Common Qualtrics API Errors

#### 1. Authentication Errors

**Error Response:**
```json
{
  "meta": {
    "httpStatus": "401 - Unauthorized",
    "error": {
      "errorCode": "AUTH_1",
      "errorMessage": "Invalid API Token"
    }
  }
}
```

**Handling:**
- Verify `qualtricsApiKey` in credentials (field name is `qualtricsApiKey`, not `qualtricsApiToken`)
- Check token has not expired
- Prompt user to re-enter credentials
- Do NOT retry automatically (credential issue)

#### 2. Survey Not Found

**Error Response:**
```json
{
  "meta": {
    "httpStatus": "404 - Not Found",
    "error": {
      "errorCode": "RESOURCE_1",
      "errorMessage": "Survey not found"
    }
  }
}
```

**Handling:**
- Verify `qualtricsSurveyId` in credentials
- Check survey still exists and is active
- Fallback to JotForm-only mode
- Alert admin to update configuration

#### 3. Rate Limiting

**Error Response:**
```json
{
  "meta": {
    "httpStatus": "429 - Too Many Requests",
    "error": {
      "errorCode": "RATE_1",
      "errorMessage": "Rate limit exceeded. Try again in 60 seconds."
    }
  }
}
```

**Qualtrics Rate Limits**:
- **API Calls**: 20-60 requests per minute (varies by plan)
- **Concurrent Exports**: 2-5 simultaneous exports
- **Export File Size**: Limited by survey response count

**Handling:**
```javascript
async function fetchWithRetry(url, options, maxRetries = 3) {
  let attempt = 0;
  const retryDelays = [10000, 30000, 60000]; // 10s, 30s, 60s
  
  while (attempt < maxRetries) {
    try {
      const response = await fetch(url, options);
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('Retry-After') || retryDelays[attempt];
        console.warn(`[Qualtrics] Rate limited. Retrying in ${retryAfter}ms...`);
        await sleep(retryAfter);
        attempt++;
        continue;
      }
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.meta.error.errorMessage);
      }
      
      return response;
    } catch (error) {
      if (attempt === maxRetries - 1) throw error;
      
      console.warn(`[Qualtrics] Request failed (attempt ${attempt + 1}/${maxRetries}):`, error.message);
      await sleep(retryDelays[attempt]);
      attempt++;
    }
  }
}
```

#### 4. Export Timeout/Failure

**Error Response:**
```json
{
  "result": {
    "progressId": "ES_...",
    "status": "failed",
    "percentComplete": 45.0
  }
}
```

**Handling:**
- Log failure with progressId
- Retry export from beginning (start new export)
- If repeated failures (3+), fallback to JotForm-only mode
- Alert admin to check survey configuration

### Logging Strategy

**Console Logging Levels**:
```javascript
// INFO: Standard workflow messages
console.log('[Qualtrics] Export started:', progressId);
console.log('[Qualtrics] Downloaded', responses.length, 'responses');

// WARN: Recoverable errors
console.warn('[Qualtrics] Rate limited. Retrying in 30s...');
console.warn('[Qualtrics] No TGMD data for student:', sessionkey);

// ERROR: Unrecoverable errors
console.error('[Qualtrics] Export failed after 3 retries');
console.error('[Qualtrics] Authentication error:', error.message);
```

**Structured Logging Object**:
```javascript
const log = {
  timestamp: new Date().toISOString(),
  module: 'qualtrics',
  action: 'export',
  status: 'success',
  details: {
    progressId: 'ES_...',
    responseCount: 156,
    duration: 12500
  }
};
console.log(JSON.stringify(log));
```

---

## Implementation Roadmap

### Phase 1: Foundation (1-2 weeks)

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
  - Add `qualtricsApiKey` (field name is `qualtricsApiKey`, already has datacenter/surveyId)
  - Validate on checking system home page

- [ ] Add Qualtrics cache store to IndexedDB
  - Create `qualtrics_cache` store in localforage
  - Store raw responses separately from merged data

**Testing:**
- Fetch survey definition from Qualtrics
- Start export and poll until complete
- Download and parse JSON responses
- Transform sample responses using mapping

### Phase 2: Data Merging (1 week)

**Deliverables:**
- [ ] Create `assets/js/data-merger.js` module
  - Implement mergeDataSources() function
  - Implement mergeTGMDFields() with conflict resolution
  - Implement validateMergedData() validation

- [ ] Extend `assets/js/jotform-cache.js`
  - Add fetchQualtricsData() method
  - Add refreshWithQualtrics() method
  - Integrate merge logic into cache refresh

- [ ] Update cache structure
  - Add _sources, _tgmdSource metadata fields
  - Add _tgmdConflicts for conflict tracking
  - Store qualtricsLastSync timestamp

**Testing:**
- Merge test datasets with TGMD conflicts
- Validate conflict resolution logic
- Test cache persistence after merge
- Verify Qualtrics data precedence

### Phase 3: UI Integration (1 week)

**Deliverables:**
- [ ] Update `checking_system_home.html`
  - Add "Refresh Qualtrics Data" button
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

### Phase 4: Production Deployment (1 week)

**Deliverables:**
- [ ] Documentation updates
  - This PRD (complete)
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

### Phase 5: Monitoring & Maintenance (Ongoing)

**Deliverables:**
- [ ] Implement logging dashboard
  - Track Qualtrics API usage
  - Monitor merge conflict rates
  - Alert on repeated failures

- [ ] Create runbook procedures
  - "Qualtrics Export Fails" troubleshooting
  - "High Conflict Rate" investigation steps
  - "API Token Rotation" process

- [ ] Scheduled maintenance tasks
  - Weekly: Review merge conflict reports
  - Monthly: Validate qualtrics-mapping.json accuracy
  - Quarterly: API token rotation

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

## Troubleshooting Guide

### Issue: "Qualtrics Export Timeout"

**Symptoms:**
- Export progress stuck at same percentage
- Polling exceeds 120 seconds

**Diagnosis:**
1. Check export progressId in logs
2. Verify survey response count (large surveys take longer)
3. Test direct API call to progress endpoint

**Solutions:**
- Increase polling timeout to 300 seconds
- Reduce `questionIds` array (fetch only TGMD fields)
- Contact Qualtrics support if survey has >10,000 responses

### Issue: "TGMD Fields Missing After Merge"

**Symptoms:**
- Student has Qualtrics data but TGMD fields empty in UI
- Merge validation shows 0 TGMD records

**Diagnosis:**
1. Check qualtrics-mapping.json loaded correctly
2. Verify QID format matches Qualtrics export
3. Inspect raw Qualtrics response structure

**Solutions:**
- Refresh qualtrics-mapping.json from survey definition
- Update QID mapping if survey structure changed
- Run `transformQualtricsResponse()` with sample data

### Issue: "High Conflict Rate in Merge"

**Symptoms:**
- >10% of records show TGMD conflicts
- Operators report data discrepancies

**Diagnosis:**
1. Export conflict report from cache-manager-ui
2. Compare Qualtrics vs JotForm values
3. Check data entry timing (which was entered first)

**Solutions:**
- If Qualtrics is newer: Keep current merge priority
- If JotForm overrides are intentional: Add manual override flag
- If data entry errors: Correct at source and re-merge

### Issue: "Authentication Failed (401)"

**Symptoms:**
- All Qualtrics API calls return 401
- Token was working previously

**Diagnosis:**
1. Verify token in credentials.enc is correct
2. Check token expiration in Qualtrics admin
3. Test token with direct API call (curl)

**Solutions:**
- Generate new API token in Qualtrics
- Update credentials.enc with new token
- Re-encrypt and deploy updated credentials file

---

## API Reference Quick Guide

### Key Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/API/v3/surveys` | GET | List accessible surveys |
| `/API/v3/surveys/{surveyId}` | GET | Get survey definition |
| `/API/v3/surveys/{surveyId}/export-responses` | POST | Start response export |
| `/API/v3/surveys/{surveyId}/export-responses/{progressId}` | GET | Check export progress |
| `/API/v3/surveys/{surveyId}/export-responses/{fileId}/file` | GET | Download export file |

### Configuration Values

| Field | Location | Example Value |
|-------|----------|---------------|
| API Key | `credentials.enc` → `qualtricsApiKey` | `raV8YenlxaFux...` |
| Datacenter | `credentials.enc` → `qualtricsDatacenter` | `syd1` (Sydney, replaces deprecated au1) |
| Survey ID | `credentials.enc` → `qualtricsSurveyId` | `SV_23Qbs14soOkGo9E` |
| Field Mapping | `assets/qualtrics-mapping.json` | QID → field name map |

**Note:** The field name in credentials.enc is `qualtricsApiKey`. Code examples may use `qualtricsApiToken` as a variable name after normalization.

### Export Timing

| Stage | Duration | Notes |
|-------|----------|-------|
| Start Export | <2 seconds | Returns progressId |
| Export Processing | 5-30 seconds | Varies by response count |
| Polling Interval | 2 seconds | Check every 2s |
| Download File | 1-5 seconds | Depends on file size |
| **Total** | **10-40 seconds** | For typical surveys (<500 responses) |

---

## Appendix: TGMD Field Reference

### Complete TGMD Field List

**Preference Fields (2):**
- `TGMD_Hand`: Preferred hand (1=Right, 2=Left)
- `TGMD_Leg`: Preferred leg (1=Right, 2=Left)

**Hopping (8 fields):**
- `TGMD_111_Hop_t1`, `TGMD_112_Hop_t1`, `TGMD_113_Hop_t1`, `TGMD_114_Hop_t1`
- `TGMD_111_Hop_t2`, `TGMD_112_Hop_t2`, `TGMD_113_Hop_t2`, `TGMD_114_Hop_t2`

**Jumping (8 fields):**
- `TGMD_211_Jum_t1`, `TGMD_212_Jum_t1`, `TGMD_213_Jum_t1`, `TGMD_214_Jum_t1`
- `TGMD_211_Jum_t2`, `TGMD_212_Jum_t2`, `TGMD_213_Jum_t2`, `TGMD_214_Jum_t2`

**Sliding (8 fields):**
- `TGMD_311_Sli_t1`, `TGMD_312_Sli_t1`, `TGMD_313_Sli_t1`, `TGMD_314_Sli_t1`
- `TGMD_311_Sli_t2`, `TGMD_312_Sli_t2`, `TGMD_313_Sli_t2`, `TGMD_314_Sli_t2`

**Dribbling (6 fields):**
- `TGMD_411_Dri_t1`, `TGMD_412_Dri_t1`, `TGMD_413_Dri_t1`
- `TGMD_411_Dri_t2`, `TGMD_412_Dri_t2`, `TGMD_413_Dri_t2`

**Catching (6 fields):**
- `TGMD_511_Cat_t1`, `TGMD_512_Cat_t1`, `TGMD_513_Cat_t1`
- `TGMD_511_Cat_t2`, `TGMD_512_Cat_t2`, `TGMD_513_Cat_t2`

**Throwing (8 fields):**
- `TGMD_611_Thr_t1`, `TGMD_612_Thr_t1`, `TGMD_613_Thr_t1`, `TGMD_614_Thr_t1`
- `TGMD_611_Thr_t2`, `TGMD_612_Thr_t2`, `TGMD_613_Thr_t2`, `TGMD_614_Thr_t2`

**Metadata (1):**
- `TGMD_Com`: Administrator comments

**Total**: 47 fields

### Matrix Question Mapping

Qualtrics uses matrix questions for TGMD tests. Each test has:
- **Rows**: Trials (1=First, 2=Second)
- **Columns**: Criteria (1-4, varies by test)

**Example - Hopping (QID126166420):**
```
Matrix Structure:
        Criterion 1  Criterion 2  Criterion 3  Criterion 4
Trial 1    [1_1]       [1_2]       [1_3]       [1_4]
Trial 2    [2_1]       [2_2]       [2_3]       [2_4]
```

**Mapping to Standard Fields:**
- `QID126166420#1_1` → `TGMD_111_Hop_t1`
- `QID126166420#1_2` → `TGMD_112_Hop_t1`
- `QID126166420#2_1` → `TGMD_111_Hop_t2`
- ... etc

**Value Encoding:**
- `1` = Criterion met
- `0` = Criterion not met
- `""` (empty) = Not assessed

---

## Cache System Implementation

### Overview

The 4Set Checking System uses a comprehensive client-side caching system built on IndexedDB to provide fast, offline-capable data access while minimizing API calls.

### Cache Architecture

The system uses **localForage** (wrapper around IndexedDB) with three separate stores:

```
JotFormCacheDB (IndexedDB database)
├── cache (store: jotform_global_cache)
│   ├── Key: 'jotform_global_cache'
│   ├── Value: { submissions[], timestamp, count }
│   ├── Size: ~20-40 MB (500-2000 submissions)
│   └── Expires: 1 hour
│
├── student_validation (store: student_validation) 
│   ├── Key: 'validation_cache'
│   ├── Value: { validations{}, timestamp, count, version }
│   └── Pre-computed task status for all students
│
└── qualtrics_cache (store: qualtrics_responses)
    ├── Key: 'qualtrics_responses'
    ├── Value: { responses[], timestamp, surveyId, count }
    └── Manual refresh only (no auto-expiration)
```

### Cache Operations

#### Building the Cache

**Initial Sync** (First time or after deletion):
1. Fetch JotForm submissions (0-50% progress)
2. Fetch Qualtrics TGMD data (50-70% progress, if credentials available)
3. Build validation cache (70-100% progress)
4. Save all three stores to IndexedDB
5. Duration: 60-90 seconds typical

**Status Indicators:**
- 🔴 **System Not Ready**: No cache exists - click to build
- 🟠 **Syncing X%**: Cache building in progress
- 🟢 **System Ready**: Cache valid and loaded

#### Cache Deletion

**Comprehensive Deletion** - Clicking "Delete Cache" removes ALL data:
- ✅ All JotForm submissions (cache store)
- ✅ All student validation results (student_validation store)
- ✅ All Qualtrics TGMD responses (qualtrics_cache store)

This is a complete purge requiring full re-sync before system can be used again.

#### Qualtrics Refresh

**Partial Update** - Clicking "Refresh with Qualtrics":
- Fetches fresh TGMD data from Qualtrics API
- Merges with existing JotForm cache
- Updates qualtrics_cache store only
- Faster than full deletion (~30 seconds vs 90 seconds)
- Preserves JotForm data to avoid unnecessary API calls

### Data Merging Strategy

The cache system implements a two-level merge strategy:

#### Level 1: Within-Source Merging (Earliest Non-Empty Wins)

When multiple submissions/responses exist for the same student:
- **JotForm**: Submissions sorted by `created_at` (earliest first)
- **Qualtrics**: Responses sorted by `recordedDate` (earliest first)
- **Strategy**: First non-empty value wins for each field
- **Implementation**: See `buildStudentValidationCache()` method in `jotform-cache.js`

```javascript
// Strategy documented in code:
// "Merge strategy: Sort by created_at (earliest first), 
//  only process non-empty values, first wins"
```

#### Level 2: Cross-Source Merging (Qualtrics Priority)

When merging Qualtrics TGMD data INTO JotForm cache:
- **Qualtrics takes precedence** for all TGMD_* fields
- Rationale: Qualtrics is the primary platform for TGMD assessments
- Conflicts are detected and logged in `_tgmdConflicts` array
- Conflict count displayed in UI, exportable to CSV

### Cache Expiration

**JotForm Cache**: 1 hour expiration
- Automatically invalidates after 1 hour
- System prompts for re-sync when expired
- Configurable in `jotform-cache.js` (CACHE_EXPIRATION_MS constant)

**Qualtrics Cache**: No automatic expiration
- Only updated via manual "Refresh with Qualtrics" button
- Allows controlling when TGMD data is re-fetched

**Validation Cache**: Rebuilds when submissions change
- Automatically regenerated after JotForm sync
- Invalidated when cache is deleted

### Performance Considerations

#### Cache Benefits
- ✅ Instant data access after initial load (<500ms vs 5-15s API call)
- ✅ Offline capability (works without internet after cache built)
- ✅ Reduced API rate limiting risk
- ✅ 100x+ speedup for multi-student drilldowns

#### Cache Size Management
- JotForm cache: ~30 MB typical (544 submissions in production)
- Qualtrics cache: ~5 MB typical (200 responses)
- Total: ~67 MB well within browser limits (hundreds of MB available)

#### Performance Metrics
- First sync: 60-90 seconds
- Subsequent page loads: <1 second (cache hit)
- Cache deletion: Instant
- Qualtrics refresh: 30 seconds

### Known Limitations

1. **No Real-Time Sync**: Manual button click required to refresh
2. **Full Export Only**: No incremental/delta updates from APIs
3. **Client-Side Only**: No server-side API proxy for caching
4. **Single Mode**: Only full cache mode available (on-demand fetch planned but not implemented)
5. **Browser-Specific**: Cache is per-browser, not synchronized across devices

### Cache Troubleshooting

**Common Issues and Solutions:**

| Problem | Solution |
|---------|----------|
| Data looks outdated | Click "Delete Cache" → Re-sync |
| TGMD data missing/wrong | Click "Refresh with Qualtrics" |
| System very slow | Clear browser cache (Ctrl+Shift+R), then delete IndexedDB cache |
| Sync stuck at X% | Close modal, refresh page, try again |
| Green pill but no data | Delete cache → Re-sync |

**Cache Inspection** (for developers):
- Open DevTools (F12) → Application tab → IndexedDB → JotFormCacheDB
- Verify all three stores exist and contain data
- Check timestamp fields to confirm cache age

### Future Enhancements

Planned but not yet implemented:
- [ ] Cache strategy toggle (Full Cache vs Fetch-on-Request modes)
- [ ] Device auto-detection (mobile → recommend on-demand)
- [ ] Incremental sync (fetch only new/changed records)
- [ ] Automatic background refresh on schedule
- [ ] Server-side cache proxy for improved security
- [ ] Real-time WebSocket updates
- [ ] Service worker for offline support

### Related Files

**Implementation:**
- `assets/js/jotform-cache.js` - Core cache management
- `assets/js/cache-manager-ui.js` - UI for cache operations
- `assets/js/qualtrics-api.js` - Qualtrics data fetching
- `assets/js/data-merger.js` - Cross-source merging logic

**Configuration:**
- `config/jotform_config.json` - Cache and fetch parameters

**User Documentation:**
- `USER_GUIDE_CHECKING_SYSTEM.md` - Cache usage guide
- `USER_GUIDE_QUALTRICS_TGMD.md` - Qualtrics integration guide

---

**Document Version**: 1.0  
**Last Updated**: 2025-10-25
**Next Review**: 2025-11-25
