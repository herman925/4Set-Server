# 4Set-Server: Processor Agent

> **Note:** This repository has evolved from a desktop-based proof of concept to a production-ready PowerShell service. See `DEPRECATIONS.md` for information about outdated references.

This repository contains the processor agent system described in `PRDs/processor_agent_prd.md` and `PRDs/processor_agent_runbook_prd.md`. The agent monitors folders for PDF uploads, validates and processes them, then uploads data to Jotform.

## Contents

- `config/agent.json` – Local paths, logging and polling settings.
- `config/jotform_config.json` – Upload throttling and retry configuration.
- `queue_manifest.json` – Tracks queued files for restart recovery.
- `processor_agent.ps1` – PowerShell service that stages, parses, validates, and files PDFs with JSON.
- `worker.ps1` – Worker process for parallel PDF processing.
- `assets/credentials.enc` – Encrypted bundle (API keys, systemPassword) unlocked via Windows Credential Manager.
- `assets/coreid.enc` – Encrypted student mappings (Core ID → School, Class, Name).
- `assets/schoolid.enc` – Encrypted school metadata.
- `assets/id_mapping/` – Mapping files (pdfmapping.json, jotformquestions.json, etc.).
- `parser/` – PDF parsing tools (parse_pdf_cli.py, pdf_tools.py).
- `incoming/`, `processing/`, `filed/`, `unsorted/` – Working directories used by the processor.
- `logs/` – Rolling CSV log files (`YYYYMMDD_processing_agent.csv`).

## Running the Processor Agent

1. Open a PowerShell window.
2. Navigate to the repository root.
3. Run the agent:

   ```powershell
   pwsh -File .\processor_agent.ps1
   ```

   - Use `-SingleRun` to process current files once and exit.
   - Use `-ConfigPath` to point at an alternate config JSON if required.

4. Drop a sample PDF (or any file) into the configured incoming folder (default: `incoming/`).
   - The script moves it to `processing/`, parses to JSON, validates, then files both PDF + JSON under `filed/{schoolId}/`.
   - Validation failures move both files into `unsorted/`.

5. Review logs in `logs/YYYYMMDD_processing_agent.csv` and queue state in `queue_manifest.json`.

Stop the agent with `Ctrl+C` in the PowerShell session.

## Pipeline Flow

```
incoming/
  ↓ (detected by watcher)
processing/ (staging)
  ↓ Phase 1: Filename validation (xxxxx_YYYYMMDD_HH_MM.pdf)
  ↓ Parsing: PDF → JSON extraction (via parse_pdf_cli.py)
  ↓   • Extracts raw answers (ERV_Q1, CM_Q1_TEXT, etc.)
  ↓   • Extracts score helpers (ERV_Q1_Sc, CM_Q1_TEXT_Sc, etc.)
  ↓ Phase 2: Cross-validation (JSON data vs encrypted mappings)
  ↓ Field Enrichment: Add sessionkey, computerno, child-name, class-id, etc.
  ↓ Termination Calculation: Use _Sc fields to calculate term_ERV_Ter1, etc.
  ↓ Cleanup: Remove all _Sc helper fields (not for upload)
  ↓ Write JSON: Save enriched data (jotformsubmissionid = "")
  ↓
  ↓ Jotform Upload: Upsert by sessionkey
  ↓   • Search existing submission by sessionkey
  ↓   • Update if found, Create if not found
  ↓   • Write back jotformsubmissionid to JSON
  ↓
filed/{schoolId}/  OR  unsorted/
  ├── 13268_20250904_14_07.pdf
  └── 13268_20250904_14_07.json (enriched + uploaded)
```

## Phase 2 Validation

The agent performs cross-field validation using encrypted mapping bundles:

1. **Parse PDF** → Generate JSON with `student-id`, `school-id`, etc.
2. **Extract IDs** from JSON → Core ID (`C13268`), School ID (`S682`)
3. **Lookup** Core ID in `coreid.enc` to get expected School ID
4. **Compare** extracted School ID with mapping School ID
5. **Reject** if mismatch or Core ID not found

**Rejection Codes:**
- `pdf_extraction_failed` - JSON parsing error
- `coreid_missing_in_mapping` - Student not in database
- `coreid_schoolid_mismatch` - School IDs don't match

## Requirements

- **PowerShell 7+** (required for AES-GCM decryption)
- **Python 3.7+** with `pypdf` or `PyPDF2` library for PDF parsing
  ```bash
  pip install pypdf
  # or
  pip install PyPDF2
  ```
- **Windows Credential Manager** entry with master key for `credentials.enc`
- Encrypted bundles in `assets/` (credentials, coreid, schoolid, classid)

## Field Enrichment

After validation, the agent enriches the JSON with computed fields.

**Note**: The PDF contains score helper fields (e.g., `ERV_Q1_Sc`, `CM_Q1_TEXT_Sc`) used internally for termination calculation. These fields are **removed after enrichment** and will not be uploaded to Jotform. Only raw answer values are preserved.

| Field | Source | Description |
|-------|--------|-------------|
| `sessionkey` | PDF filename stem | Unique identifier (e.g., `13268_20250904_14_07`) |
| `computerno` | `$env:COMPUTERNAME` | Extracted number from computer name (e.g., `KS095` → `"95"`) |
| `jotformsubmissionid` | Initially empty | Populated after Jotform upload for write-back |
| `child-name` | `coreid.enc` → "Student Name" | Student's full name |
| `class-id` | `coreid.enc` → "Class ID 25/26" | Class identifier for current year (25/26 only, no fallback) |
| `class-name` | `classid.enc` → "Actual Class Name" | Human-readable class name |
| `Gender` | Fallback from `coreid.enc` | Gender if missing in PDF |

### Termination Rules

The enrichment process also calculates termination outcomes based on survey logic:

| Rule | Question Range | Threshold | Output Field |
|------|---------------|-----------|--------------|
| **ERV_Ter1** | ERV_Q1–Q12 | <5 correct | `term_ERV_Ter1` = "1" (terminated) / "0" (continued) |
| **ERV_Ter2** | ERV_Q13–Q24 | <5 correct | `term_ERV_Ter2` = "1" / "0" |
| **ERV_Ter3** | ERV_Q25–Q36 | <5 correct | `term_ERV_Ter3` = "1" / "0" |
| **CM_Ter1** | CM_Q1–Q7 | <4 correct | `term_CM_Ter1` = "1" / "0" |
| **CM_Ter2** | CM_Q8–Q12 | <4 correct | `term_CM_Ter2` = "1" / "0" |
| **CM_Ter3** | CM_Q13–Q17 | <4 correct | `term_CM_Ter3` = "1" / "0" |
| **CM_Ter4** | CM_Q18–Q22 | <4 correct | `term_CM_Ter4` = "1" / "0" |
| **CWR_10Incorrect** | CWR_Q1–Q60 | 10 consecutive incorrect | `term_CWR_10Incorrect` = "1" / "0" |
| **FM_Ter** | FM_squ_1–FM_squ_3 | All scores = 0 | `term_FM_Ter` = "1" / "0" |

**Scoring Format**:
- Question scores: `"1"` = correct, `"0"` or empty = incorrect
- Termination outcomes: `"1"` = terminated (threshold not met), `"0"` = continued (threshold met)
- **Calculation Logic - Absolute Certainty Principle**: 
  - Termination values are calculated **only when mathematically certain**:
    1. Set `"0"` (continued) if: `correct ≥ threshold` (already passed)
    2. Set `"1"` (terminated) if: `correct + unanswered < threshold` (impossible to pass)
    3. Otherwise: **Don't set** - still possible to pass with remaining questions
  - Empty/unanswered questions are treated as missing data, not failures
  - Example (ERV_Ter1): 3 correct, 1 unanswered out of 12 total, need ≥5
    - Max possible = 3 + 1 = 4 < 5 → Set `term_ERV_Ter1 = "1"` ✅
  - Example: 3 correct, 3 unanswered, need ≥5
    - Max possible = 3 + 3 = 6 ≥ 5 → **Don't set** (still possible) ⏸️
  - If PDF already contains termination value (filled during survey), it is preserved

## Parser Integration

The agent uses a Python-based PDF parser (`parser/parse_pdf_cli.py`) which calls the real PDF extraction engine from `parser/pdf_tools.py`. This extracts all form fields from the PDF and generates comprehensive JSON output.

**Field Mapping**: The parser uses `assets/id_mapping/pdfmapping.json` to map PDF field names (e.g., `"Student ID"`) to standardized friendly names (e.g., `"student-id"`) that match `jotformquestions.json` for seamless Jotform upload.

## Jotform Upload

After enrichment, the agent automatically uploads data to Jotform using an **upsert workflow**:

### Workflow
1. **Search** for existing submission by `sessionkey` (unique identifier)
2. **Update** if found (excluding immutable `sessionkey` field)
3. **Create** new submission if not found (including `sessionkey`)
4. **Write back** `jotformsubmissionid` to the JSON file

### Safety Features
- **Enriched JSON is written BEFORE upload** - ensures data is never lost even if upload fails
- **Idempotent** - Re-running same PDF updates existing submission (no duplicates)
- **Retry Logic** - Automatic retries with exponential backoff:
  - 3 attempts by default (configurable)
  - Delays: 10s, 30s, 90s (with ±20% jitter to avoid thundering herd)
  - Retryable errors: 429 (rate limit), 5xx (server errors), timeouts
  - Non-retryable: 4xx errors (except 429) fail immediately
- **Permanent Failure Handling** - After exhausting retries:
  - Logs error level message (single source of truth)
  - **Files to Unsorted folder** regardless of valid School ID
  - Data is preserved but marked for manual review
  - Logs contain full error details for debugging

### Configuration
- **API Credentials**: Stored in encrypted `assets/credentials.enc` (`jotformApiKey`, `jotformFormId`)
- **Field Mapping**: `assets/id_mapping/jotformquestions.json` maps field names to Jotform Question IDs (QIDs)
- **Rate Limiting**: Configured in `config/jotform_config.json` (see PRDs/processor_agent_prd.md)

### Verification
Check logs for upload status:
```powershell
Select-String -Path logs/YYYYMMDD_processing_agent.csv -Pattern "Jotform"
```

Expected log entries:
- `Jotform upload attempt 1 of 3`
- `Found existing Jotform submission: {id}` (update) OR `Creating new` (create)
- `Jotform upload successful, wrote back submissionID: {id} (took 1 attempt(s))`
- `Jotform upload PERMANENTLY FAILED after 3 attempts: {error}` (if failed)

### Failed Upload Detection

**Failed uploads are automatically filed to `Unsorted/` folder**, making them easy to identify:

```powershell
# Check Unsorted folder for failed uploads
Get-ChildItem filed/Unsorted -Filter "*.json" | ForEach-Object {
    $json = Get-Content $_.FullName | ConvertFrom-Json
    $sessionkey = $json.data.sessionkey
    
    if ([string]::IsNullOrWhiteSpace($json.data.jotformsubmissionid)) {
        Write-Host "Failed upload: $($_.Name) (sessionkey: $sessionkey)"
        
        # Find error in logs
        $logPattern = $sessionkey -replace '_', '\\_'
        Select-String -Path "logs/*_processing_agent.csv" -Pattern $logPattern | 
            Where-Object { $_.Line -match "PERMANENTLY FAILED|upload failed" } |
            ForEach-Object { Write-Host "  Error: $($_.Line)" }
    }
}
```

**Logs are the single source of truth** for failure reasons. Search logs by sessionkey:
```powershell
# Get detailed error for specific file
$sessionkey = "13268_20250904_14_07"
Select-String -Path "logs/*_processing_agent.csv" -Pattern $sessionkey | 
    Where-Object { $_.Line -match "ERROR|WARN" }
```
