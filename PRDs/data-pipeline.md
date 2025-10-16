---
title: Data Pipeline
owner: Project Maintainers
last-updated: 2025-10-14
---

# Data Pipeline

> **Documentation Note:** This document consolidates specifications from several legacy PRD files that have been merged into this single source. The original separate documents are no longer maintained.

Single source for parse → merge → upload across CSV, Qualtrics, Supabase, and Jotform.

**Originally consolidated from** (now deprecated):
- `csv-export-and-qualtrics-upload-prd.md`
- `data_tool-uploader-spec.md`
- `merge-dialog-csv-merge-prd.md`
- `data_tool-file-timestamps.md`

## Conventions
- Primary key: `sessionkey` (lowercase). Keep naming consistent across JS, Python, SQL to avoid PostgreSQL casing pitfalls.
- Canonical source: autosave JSON filename stem; fallback to PDF filename stem. Persist `data.sessionkey` inside autosaves.
- Filenames: outputs use UTF-8 with BOM for CSV; default merged name `<Sxxx>_<computerno>_<YYYYMMDD_HH_MM>.csv` when School ID is known.
- Timestamps: show Created and Modified; cross-platform helpers normalize `mtime`/`ctime` usage in the Data Tool.

## Operational Flow (User-Friendly Overview)

```mermaid
flowchart TD
    A[Drop PDF into watch/incoming/] --> B{File stable within debounce window?}
    B -- No --> B1[Warn & skip for now]<br/>`Write-Log WARN`
    B -- Yes --> C[Move PDF to processing/ & add to manifest]
    C --> D{Filename matches pattern `xxxxx_YYYYMMDD_HH_MM.pdf`?}
    D -- No --> D1[Mark Rejected]<br/>`Set-ManifestStatus: Rejected`
    D1 --> D2[Move to filed/Unsorted/]<br/>`REJECT: filename format`
    D -- Yes --> E[Run Python parser → JSON]
    E --> F{Parser succeeded?}
    F -- No --> F1[Move to filed/Unsorted/]<br/>`ERROR: parser`
    F -- Yes --> G[Phase 2 validation:<br/>sessionkey + core ID + school ID]
    G --> G1{Validation passed?}
    G1 -- No --> G2[Delete JSON + Move PDF to filed/Unsorted/]<br/>`REJECT: mismatch`
    G1 -- Yes --> H[Enrich JSON: metadata, termination flags]
    H --> I{Existing Jotform submission?}
    I -- Yes --> J[Update submission (chunked fields)]
    I -- No --> K[Create submission]
    J --> L{Upload succeeded within retries?}
    K --> L
    L -- No --> L1[Log ERROR & move PDF/JSON to filed/Unsorted/]<br/>`Upload failed`
    L -- Yes --> M[Write submission ID to JSON]
    M --> N[File PDF + JSON to filed/{School}/]
    N --> O[Remove manifest entry & log FILED]
```

## Parse (PDF → Autosave JSON)
- Parsing writes autosave JSON snapshots beside each PDF: `<sessionkey>.json`.
- Structure: `{ timestamp, data: { field_id: value, ... }, answered: [], unanswered: [], terminationFlags: {} }`.
- Desktop throttling: GUI renders first, then workers start via Tk `after_idle`; small pool `min(4, max(1, cpu_count//2))`.
- Always ensure `data.sessionkey` exists and matches the filename; write back if missing.

### Field Mapping & Enrichment (Server Pipeline)
- **Field Mapping**: PDF form fields use **display labels** (e.g., `"Student ID"`, `"School ID"`) and **friendly names** (e.g., `"MPT_Com"`), NOT QID identifiers. The Python parser (`parser/parse_pdf_cli.py`) uses `HEADER_MAPPING` (hardcoded in `pdf_tools.py`) to normalize field names:
  - `"Student ID"` → `"student-id"`
  - `"School ID"` → `"school-id"` 
  - `"Gender"` → `"gender"`
  - Fields already in friendly format (e.g., `"MPT_Com"`) pass through unchanged
- **Note**: `assets/pdfmapping.json` exists but is **not used** in practice (zero matches) because PDF fields don't use QID names. It's kept for compatibility only.
- **PDF ID Mismatch Validation** ⚠️: **CRITICAL DATA INTEGRITY CHECK**
  - After parsing, `Invoke-Phase2Validation` performs **THREE-WAY validation** using canonicalized identifiers:
  
  **VALIDATION 1: Canonical Sessionkey Match (Primary)**
  - Filename sessionkey is rebuilt from parsed components: `{coreId}_{yyyyMMdd}_{HH}_{mm}`
  - PDF sessionkey is reconstructed by combining `student-id` digits with the PDF timestamp (e.g., `2025/09/04 14:07` → `13268_20250904_14_07`)
  - **If mismatch**: REJECT → reason code `sessionkey_filename_mismatch`
  - Logs emit `REJECT` entries describing which components differ, e.g., `Sessionkey mismatch: Date (filename: '20250905' vs PDF: '20250904')`
  
  **VALIDATION 2: Core ID Consistency (Fallback)**
  - Runs when the PDF timestamp cannot be parsed
  - Compares filename core ID digits vs `student-id` (normalized to `C{digits}`)
  - **If mismatch**: REJECT → reason code `coreid_filename_mismatch`
  - Logs: `Core ID mismatch: Filename='13268' vs PDF='11100'`
  
  **VALIDATION 3: School ID Consistency**
  - PDF school ID (`school-id`) normalized to `S{digits}`
  - Expected school ID sourced from `coreid.enc`
  - **If mismatch**: REJECT → reason code `coreid_schoolid_mismatch`
  - Logs: `School ID mismatch: PDF='S067' vs Mapping='S123'`
  
  **On ANY Validation Failure:**
  1. PDF moved to `filed/Unsorted/` for manual review
  2. JSON **DELETED** (prevents corrupt uploads)
  3. Manifest entry removed
  4. Processing halts before Jotform upload
  
  **JSON Cleanup Mechanism:**
  - `Clean-UnsortedJsonFiles` runs at startup, deleting lingering `.json` files under `filed/Unsorted/`
  - Rationale: rejected PDFs require human intervention; JSON payloads are unusable
  - Logs use the `CLEANUP` level: `Removed 5 orphaned JSON file(s) from unsorted/`
  
  - **Purpose**: Prevents data corruption caused by mismatched student data or timestamps
  - User must correct filenames and/or PDF contents, then requeue via `watch/`
  - Mirrors desktop application's red-alert guardrails prior to CSV merge
- **Enrichment**: After parsing and validation, add computed fields:
  - `sessionkey` from filename stem
  - `computerno` from computer name (e.g., `KS095` → `"95"`)
  - `jotformsubmissionid` (initially empty, populated after upload)
  - `child-name`, `class-id`, `class-name` from encrypted mappings (`coreid.enc`, `classid.enc`)
  - `Gender` fallback from `coreid.enc` if missing
- **Termination Rules**: Calculate `term_ERV_Ter1`, `term_CM_Ter1`, etc. based on question scores. Uses helper fields (e.g., `ERV_Q1_Sc`) extracted from PDF for calculation. Output values: `"1"` = terminated (threshold not met), `"0"` = continued (threshold met). Only calculated if termination field exists but is empty; preserves values already filled in PDF during survey. See `PRDs/termination-rules.md` for full logic.
- **Cleanup**: After termination calculation, all `_Sc` helper fields are removed from the JSON. Only raw answer values (e.g., `ERV_Q1`, `CM_Q1_TEXT`) are preserved for Jotform upload.

## Merge (Build CSV)
- Discovery: list sessions by stem; prefer newest file when showing Both types.
- Filter: operator chooses PDF/JSON/Both (Data Tool Merge dialog). Selected items remember the chosen type.
- Headers: start from `assets/qualtrics-mapping.json` keys; force `sessionkey` first; append enrichment columns as needed.
- Enrichment: join with encrypted CSVs via secure loaders to fill `child-name`, `school-id`, `district`, `class-id`, `class-name`; do not overwrite non-empty values.
- Output: write CSV with preserved order; include `computerno` and optional school context.

## Uploads

Qualtrics
- Response Import API: `POST /API/v3/surveys/{surveyId}/import-responses` with JSON array of responses keyed by Qualtrics IDs.
- Poll job: check status until `complete`; capture `responseId` and map back to `sessionkey` for idempotency.
- Deduplication: rely on `sessionkey` tracking; treat it as immutable and exclude from update-only field changes.

Qualtrics Response Import details
- Endpoint: `POST https://{datacenter}.qualtrics.com/API/v3/surveys/{surveyId}/import-responses`
- Headers: `Content-Type: application/json`, `X-API-TOKEN: <token>`
- Payload: `{ "fileFormat": "json", "data": [ { "QID1": "value", ... } ] }` or equivalent supported shape
- Polling: `GET /API/v3/surveys/{surveyId}/import-responses/{importId}` until status is `complete`
- Mapping: use `assets/qualtrics-mapping.json` to build `{internal_field -> QID}` and translate before upload
- Idempotency: track `sessionkey` to correlate Qualtrics `responseId` back to the source row

Supabase
- Upsert by `sessionkey` with immutable `sessionkey` on updates (exclude from SET list).
- RPC helpers (security definer): `execute_sql(text)`, `select_sql(text)` for metadata checks and table sync.
- Logging: optional upload metadata records (Qualtrics/Jotform IDs) keyed by `sessionkey`.

Jotform (Server Pipeline - Processor Agent)
- **Architecture**: `processor_agent.ps1` runs as a continuous service monitoring the watch folder, processing PDFs through parse → validate → enrich → upload stages
- **Parallel Processing**: Configurable workers (default: 2) process PDFs concurrently via `worker.ps1` subprocess isolation
- **Upsert Workflow**: Search by `sessionkey` → Update if found, Create if not → Write back `jotformsubmissionid`
- **Implementation**: `processor_agent.ps1` functions:
  - `Invoke-PdfParser`: Calls Python CLI (`parser/parse_pdf_cli.py`) to extract PDF fields using `assets/pdfmapping.json`
  - `Extract-PdfMetadata`: Reads parsed JSON and extracts Core ID, School ID from standardized field names
  - `Invoke-Phase2Validation`: Cross-validates against encrypted mapping files (`coreid.enc`, `schoolid.enc`)
  - `Enrich-JsonFields`: Adds `sessionkey`, `computerno`, `child-name`, `class-id`, `class-name`, calculates terminations
  - `Build-JotformPayload`: Converts enriched data to Jotform submission format using `assets/jotformquestions.json`
  - `Invoke-JotformUpsert`: Executes paginated search, chunked update (max 87 fields/chunk), writes back submission ID
- **Safety**: Enriched JSON is written BEFORE upload attempt - ensures data preservation even if upload fails
- **Mapping Chain**: 
  1. PDF extraction: `assets/pdfmapping.json` (reversed: QID → field name)
  2. Jotform upload: `assets/jotformquestions.json` (field name → QID)
  3. **Critical**: Both files must use consistent field names (e.g., `student-id`, `school-id` lowercase with hyphens)
- **Authentication**: API key and Form ID from encrypted `assets/credentials.enc`, unlocked via Windows Credential Manager
- **Idempotency**: Re-running same PDF updates existing submission (no duplicates)
- **Retry & Failure Handling**: Exponential backoff with configurable retry schedule (config: `config/jotform_config.json`); marks permanent failures in JSON with `uploadStatus` field after exhausting retries
- **Monitoring**: CSV logs in `logs/YYYYMMDD_processing_agent.csv` track each stage (queue, parse, validate, enrich, upload, file)
- See PRDs/jotform-integration.md for detailed API specs, filter syntax, and error handling
- See PRDs/upload_monitoring_prd.md for failure detection, retry logic, and dashboard telemetry

Example (desktop uploader)
- Ensures `sessionkey`, builds `{name: qid}`, searches by filter on `answers[<QID>]`, then update-or-create.
- Write back `jotformsubmissionid` to JSON/CSV as appropriate.

## Reliability: Retries, Backoff, Rate Limits
- Exponential backoff with jitter; mild per-request delay to avoid 429s.
- Chunk large updates (e.g., ~80 fields per call for Jotform updates).
- Background-threaded uploads with a read-only console in the desktop UI; UI updates posted to the main thread.

Uploader write-backs (desktop)
- JSON autosaves: preserved as-is; may include `sessionkey` and IDs (e.g., `jotformsubmissionid`).
- CSV two-column: record results adjacent to each item (unchanged legacy behavior).
- CSV multi-row: locate by `sessionkey` and update identifier columns only; preserve header/row order.

## Verification
- Parse: confirm autosave JSON contains `data.sessionkey` and termination flags when applicable.
- Merge: verify CSV headers start with `sessionkey` and include enrichment columns; spot-check 1–2 rows.
- Uploads: ensure upsert behavior (second run updates in-place); confirm returned IDs are written back.
- Supabase: verify unique index on `sessionkey` and metadata entries via `select_sql`.

## Troubleshooting
- **Missing mapping**: refresh Qualtrics or Jotform mapping files; for Jotform, fetch questions live if needed.
- **Field name mismatches**: If PDFs extract with incorrect field names (e.g., `"Student ID"` instead of `"student-id"`):
  - Check `HEADER_MAPPING` in `parser/pdf_tools.py` for missing field name normalizations
  - PDF form fields use display labels like `"Student ID"` which must be normalized to `"student-id"`
  - Add new mappings to `HEADER_MAPPING` if encountering new field label variations
  - Example: `'student id': 'student-id'` (lowercase, space-normalized → hyphenated)
  - **Note**: `pdfmapping.json` is NOT used for field normalization (see code comments)
  - Re-process PDFs after updating `HEADER_MAPPING` to regenerate JSONs with correct field names
- **PDF ID Mismatch (files in unsorted/)**:
  - Check logs for `"MISMATCH ALERT"` messages showing filename vs PDF Core ID discrepancy
  - Common causes: PDF contains wrong student's data, filename was manually renamed incorrectly
  - **Do NOT bypass this check** - it prevents data corruption in research database
  - Fix: Either rename the PDF to match the Core ID inside, or replace with correct PDF file
  - After correction, move file back to `watch/` folder for reprocessing
- **Case mismatches**: ensure all code and SQL use lowercase `sessionkey`.
- **Duplicates**: check Unique Question in Jotform and unique index in Supabase; re-run uploads after fixing.
- **Upload failures**: Check `logs/YYYYMMDD_processing_agent.csv` for detailed error messages at each pipeline stage.

Appendix: Supabase RPCs
- Ensure the following exist (security definer):
  - `public.execute_sql(sql text) returns void`
  - `public.select_sql(sql_query text) returns setof json`
These enable table sync and metadata checks used by desktop tools.
