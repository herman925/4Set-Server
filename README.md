# 4Set System - KeySteps@JC (Phase Two)

**Organization:** The Education University of Hong Kong  
**Project:** KeySteps@JC Assessment Data Processing System  
**Version:** 2025/26 Academic Year

---

## Overview

The 4Set System is a comprehensive web-based assessment data processing pipeline that automates the collection, validation, processing, and monitoring of educational survey data for the KeySteps@JC research project. It replaces legacy desktop workflows with an unsupervised, cloud-integrated solution capable of handling PDF form uploads, performing rigorous data validation, enriching submission data, and automatically submitting to JotForm while providing real-time monitoring dashboards for quality assurance.

### Key Features

✅ **Automated PDF Processing** - File watcher with debounce logic for OneDrive uploads  
✅ **Two-Phase Validation** - Filename format + cross-field consistency checks  
✅ **Data Enrichment** - Automatic field calculation and metadata injection  
✅ **Termination Rules** - Intelligent assessment exit criteria based on threshold logic  
✅ **JotForm Integration** - Idempotent upsert workflow with retry mechanisms  
✅ **Quality Monitoring** - Multi-level dashboards for data completeness verification  
✅ **Security First** - AES-256-GCM encryption for all sensitive assets  
✅ **Production Ready** - Windows Service + Synology Docker deployment support

### System Architecture

```
OneDrive Cloud Storage
        ↓
Processor Agent (Windows/Synology)
    • File Watcher & Validation
    • PDF Parsing & Enrichment
    • JotForm Upload with Retry
    • Filing Protocol
        ↓
JotForm Database
        ↓
Monitoring Dashboard (GitHub Pages)
    • Upload Status & Queue Health
    • Checking System (5-Level Drilldown)
    • Error Reporting & Analytics
```

---

## Quick Start

### Prerequisites

- **PowerShell 7+** (required for AES-GCM decryption)
- **Python 3.7+** with `pypdf` or `PyPDF2` library
  ```bash
  pip install pypdf
  # or
  pip install PyPDF2
  ```
- **Windows Credential Manager** entry with master key (Windows deployment)
- **OneDrive for Business** sync client or Synology Cloud Sync
- Encrypted credential bundles in `assets/` directory

### Installation

1. **Clone Repository**
   ```bash
   git clone https://github.com/herman925/4Set-Server.git
   cd 4Set-Server
   ```

2. **Configure Agent Settings**
   Edit `config/agent.json` to set OneDrive path and processing options:
   ```json
   {
     "oneDrive": {
       "autoDetect": true,
       "relativePath": "\\YourOrg\\YourPath\\4Set-Server"
     }
   }
   ```

3. **Set Up Credentials**
   - Windows: Store system password in Credential Manager
     ```powershell
     cmdkey /generic:4set-processor-master /user:system /pass:YourPassword
     ```
   - Synology: Configure Docker secret `processor_master_key`

4. **Start Processor Agent**
   ```powershell
   # Interactive mode (for testing)
   pwsh -File .\processor_agent.ps1

   # Single-run mode (process current files and exit)
   pwsh -File .\processor_agent.ps1 -SingleRun

   # Custom config path
   pwsh -File .\processor_agent.ps1 -ConfigPath "C:\custom\config.json"
   ```

5. **Access Web Dashboards**
   - **Main Entry**: Open `index.html` in browser
   - **Upload Interface**: `upload.html` for PDF submissions
   - **Checking System**: `checking_system_home.html` for data validation

### Local Development (CORS Proxy)

When running the Checking System locally, you'll need a CORS proxy to access JotForm API. The proxy is **not needed** for GitHub Pages or production deployment.

**One-Click Startup:**

```bash
# Windows - Double-click or run:
start_dev.bat

# Linux/Mac:
./start_dev.sh
```

This will:
1. Install Flask dependencies (if needed)
2. Start the CORS proxy server on `http://127.0.0.1:3000`
3. Automatically open your browser to the Checking System

**Manual Startup:**

```bash
# Install dependencies
pip install -r requirements.txt

# Start proxy server
python proxy_server.py --port 3000 --host 127.0.0.1

# Access at: http://127.0.0.1:3000/checking_system_home.html
```

**Why Needed:**
- Browsers block cross-origin API requests (CORS policy)
- JotForm API doesn't allow direct calls from `localhost`
- The Flask proxy routes requests through Python (no CORS restrictions)
- **Production (GitHub Pages)**: No proxy needed - works directly

---

## Project Structure

### Root Directory Files

| File | Purpose |
|------|---------|
| `processor_agent.ps1` | Main processor agent (PowerShell 7 service) |
| `worker.ps1` | Worker thread manager for parallel processing |
| `proxy_server.py` | Flask CORS proxy for local development |
| `start_dev.bat` | Windows one-click startup (proxy + browser) |
| `start_dev.sh` | Linux/Mac one-click startup (proxy + browser) |
| `upload.py` | Python upload utility (legacy/backup) |
| `index.html` | System entry page with navigation |
| `upload.html` | Drag-and-drop PDF upload interface |
| `queue_manifest.json` | Persistent queue state for restart recovery |
| `requirements.txt` | Python dependencies (pypdf, Flask, requests) |
| `README.md` | This file - comprehensive documentation |
| `AGENTS.md` | Development roadmap and strategic planning |

### Key Directories

#### `config/`
Configuration files for system behavior:
- `agent.json` – OneDrive paths, polling intervals, worker settings
- `jotform_config.json` – Rate limits, batch sizes, retry schedules
- `host_identity.json.example` – Computer number override template
- `checking_system_config.json` – Dashboard display options

#### `assets/`
Encrypted data assets and static resources:
- `credentials.enc` – API keys, system password (AES-256-GCM encrypted)
- `coreid.enc` – Student ID mappings (Core ID → School, Class, Name)
- `schoolid.enc` – School metadata (ID → Name, District, Group)
- `classid.enc` – Class mappings (Class ID → Actual Class Name)
- `jotformquestions.json` – Field name to Question ID (QID) mappings
- `css/`, `js/`, `logos/` – Dashboard styling and assets

#### `parser/`
PDF extraction engine:
- `parse_pdf_cli.py` – Command-line interface for PDF parsing
- `pdf_tools.py` – Core extraction using pypdf/PyPDF2 libraries

#### `PRDs/`
Comprehensive product requirement documents:
- `overview_prd.md` – System architecture and component overview
- `processor_agent_prd.md` – Agent specification and requirements
- `processor_agent_runbook_prd.md` – Operational procedures
- `checking_system_prd.md` – Quality assurance validation rules
- `data_security_prd.md` – Encryption and credential management
- `termination-rules.md` – Assessment termination logic
- `upload_monitoring_prd.md` – Upload failure detection

#### `tools/`
Utility scripts for testing and development:
- `test_jotform_filter.ps1` – JotForm API filter validation
- `test_chunked_update.ps1` – Batch update testing

#### `filed/`
Archived processed files (organized by school ID):
- `S###/` – Successfully processed PDFs and JSON by school
- `Unsorted/` – Failed validations or upload errors

#### `checking_system_*.html`
Multi-level monitoring dashboards:
- `checking_system_home.html` – System overview and navigation
- `checking_system_1_district.html` – District-level aggregation
- `checking_system_1_group.html` – Project group view
- `checking_system_2_school.html` – School-level completion
- `checking_system_3_class.html` – Class drilldown with heatmaps
- `checking_system_4_student.html` – Student detail validation

---

## Component Documentation

### Processor Agent

**Purpose**: Autonomous Windows/Synology service for PDF ingestion and processing

**Core Functionality**:
- Monitors OneDrive sync folder for new PDF uploads
- Applies two-phase validation (filename format + cross-field consistency)
- Extracts form fields and generates enriched JSON
- Calculates termination rules based on threshold logic
- Uploads to JotForm with idempotent upsert pattern
- Files successfully processed PDFs by school ID
- Moves failed uploads to `Unsorted/` for manual review
- Exposes telemetry API for dashboard integration

**Configuration Options** (`config/agent.json`):
```json
{
  "oneDrive": {
    "autoDetect": true,
    "relativePath": "\\Organization\\Path\\4Set-Server",
    "fallbackRoot": "C:\\Users\\Username"
  },
  "watchFolders": ["incoming"],
  "pollingIntervalSeconds": 5,
  "maxConcurrentWorkers": 2,
  "logRetentionDays": 30
}
```

**OneDrive Detection Strategy**:
1. `$env:OneDriveCommercial` (Business account - highest priority)
2. `$env:OneDrive` (Personal account fallback)
3. Registry: `HKCU\Software\Microsoft\OneDrive\Commercial`
4. Registry: `HKLM\Software\Microsoft\OneDrive` (system-wide)
5. `fallbackRoot` from config (manual override)

**Running the Agent**:

```powershell
# Interactive mode (for testing and development)
pwsh -File .\processor_agent.ps1

# Single-run mode (process current files once and exit)
pwsh -File .\processor_agent.ps1 -SingleRun

# Custom configuration path
pwsh -File .\processor_agent.ps1 -ConfigPath "C:\custom\agent.json"

# Windows Service installation (production)
# See PRDs/processor_agent_runbook_prd.md for NSSM setup
```

**Usage Example**:
1. Start the agent in a PowerShell window
2. Drop PDF files into the configured watch folder (e.g., `incoming/`)
3. Agent automatically:
   - Moves file to `processing/` staging area
   - Validates filename format (xxxxx_YYYYMMDD_HH_MM.pdf)
   - Extracts PDF form fields to JSON
   - Cross-validates against encrypted mappings
   - Enriches with computed fields (sessionkey, computerno, class-id)
   - Calculates termination rules
   - Uploads to JotForm (upsert by sessionkey)
   - Files both PDF + JSON to `filed/{schoolId}/` or `filed/Unsorted/`
4. Review processing logs in `logs/YYYYMMDD_processing_agent.csv`
5. Check queue state in `queue_manifest.json` for restart recovery

**Stopping the Agent**:
- Press `Ctrl+C` in PowerShell session (graceful shutdown)
- Service stop command: `Stop-Service -Name "4SetProcessor"` (if installed as service)

---

## Processing Pipeline

### Pipeline Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    STAGE 1: File Detection                   │
│                      incoming/ folder                        │
│              (OneDrive synced, watched by agent)             │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                     STAGE 2: File Staging                    │
│                     processing/ folder                       │
│         • Move from incoming/ to prevent re-processing       │
│         • Apply debounce logic (wait for file stability)     │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              STAGE 3: Phase 1 Validation                     │
│                  Filename Format Check                       │
│         • Pattern: xxxxx_YYYYMMDD_HH_MM.pdf                  │
│         • Extract student ID, date, time from filename       │
│         • Reject if format invalid                           │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  STAGE 4: PDF Parsing                        │
│              parse_pdf_cli.py (Python Engine)                │
│         • Extract all form fields from PDF                   │
│         • Generate raw answer fields (ERV_Q1, CM_Q1, etc.)   │
│         • Extract score helpers (ERV_Q1_Sc, etc.)            │
│         • Create initial JSON structure                      │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              STAGE 5: Phase 2 Validation                     │
│              Cross-Field Consistency Check                   │
│         • Decrypt coreid.enc, schoolid.enc mappings          │
│         • Lookup Core ID (C#####) in student database        │
│         • Verify school ID matches student record            │
│         • Reject if: coreid_missing_in_mapping               │
│         • Reject if: coreid_schoolid_mismatch                │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 STAGE 6: Data Enrichment                     │
│              Add Computed & Lookup Fields                    │
│         • sessionkey: Filename stem (unique ID)              │
│         • computerno: Extract from computer name             │
│         • child-name: Lookup from coreid.enc                 │
│         • class-id: Lookup from coreid.enc (25/26 only)      │
│         • class-name: Lookup from classid.enc                │
│         • Gender: Fallback if missing in PDF                 │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              STAGE 7: Termination Calculation                │
│           Apply Threshold Rules to Score Data                │
│         • ERV_Ter1/2/3: <5 correct in 12-question blocks     │
│         • CM_Ter1/2/3/4: <4 correct in 5-7 question blocks   │
│         • CWR_10Incorrect: 10 consecutive incorrect          │
│         • FM_Ter: All FM_squ scores = 0                      │
│         • Use "Absolute Certainty Principle"                 │
│         • Remove all _Sc helper fields after calculation     │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  STAGE 8: Write JSON                         │
│            Save Enriched Data to Disk                        │
│         • Write complete JSON with all enriched fields       │
│         • Set jotformsubmissionid = "" (placeholder)         │
│         • Ensure data integrity before upload                │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                 STAGE 9: JotForm Upload                      │
│              Idempotent Upsert Workflow                      │
│         • Search for existing submission by sessionkey       │
│         • IF FOUND: Update (exclude sessionkey field)        │
│         • IF NOT FOUND: Create new submission                │
│         • Retry with exponential backoff (3 attempts)        │
│         • Write back jotformsubmissionid to JSON             │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
                    ┌───────┴───────┐
                    │               │
              Upload Success  Upload Failed
                    │               │
                    ↓               ↓
        ┌────────────────┐  ┌──────────────┐
        │  filed/S###/   │  │filed/Unsorted/│
        │  • PDF file    │  │  • PDF file   │
        │  • JSON file   │  │  • JSON file  │
        │  (with subID)  │  │  (no subID)   │
        └────────────────┘  └──────────────┘
```

### Pipeline Stage Details

#### Stage 1: File Detection
- File system watcher monitors `incoming/` folder
- Triggers on file creation/modification events
- Debounce logic ensures file is fully uploaded (stable size)
- OneDrive sync status verification (if available)

#### Stage 2: File Staging
- Move file from `incoming/` to `processing/` immediately
- Prevents duplicate processing if watcher triggers again
- Clears watch folder for next batch
- Records file path in queue manifest

#### Stage 3: Phase 1 Validation
- **Filename Pattern**: `xxxxx_YYYYMMDD_HH_MM.pdf`
  - `xxxxx`: 5-digit student ID (can have "C" prefix internally)
  - `YYYYMMDD`: Date (e.g., 20250904)
  - `HH_MM`: Time (24-hour format, e.g., 14_07)
- **Validation Checks**:
  - Correct number of underscore separators
  - Valid date format (year, month, day ranges)
  - Valid time format (hour 00-23, minute 00-59)
- **Rejection**: Move to `Unsorted/` with reason code if invalid

#### Stage 4: PDF Parsing
- **Parser**: `parser/parse_pdf_cli.py` (Python engine)
- **Library**: pypdf or PyPDF2
- **Extraction**:
  - All form fields (text boxes, checkboxes, radio buttons)
  - Answer fields (ERV_Q1, CM_Q1_TEXT, etc.)
  - Score helper fields (ERV_Q1_Sc, CM_Q1_TEXT_Sc, etc.)
- **Field Mapping**: Uses `assets/jotformquestions.json` for friendly names
- **Output**: Initial JSON structure with raw PDF data

#### Stage 5: Phase 2 Validation
- **Cross-Field Consistency Check**:
  1. Decrypt `assets/coreid.enc` using system password
  2. Extract Core ID from JSON (e.g., "C13268")
  3. Look up Core ID in decrypted student database
  4. Retrieve expected School ID from student record
  5. Compare with School ID extracted from PDF
  6. Verify student name matches (optional secondary check)
- **Rejection Codes**:
  - `pdf_extraction_failed` - Parser error or corrupted PDF
  - `coreid_missing_in_mapping` - Student not found in database
  - `coreid_schoolid_mismatch` - School IDs don't match expectations
- **Security**: Encrypted mappings decrypted in-memory only, buffers cleared after use

#### Stage 6: Data Enrichment
- **Computed Fields**:
  - `sessionkey`: Derived from filename stem (e.g., "13268_20250904_14_07")
  - `computerno`: Extracted from $env:COMPUTERNAME (e.g., "KS095" → "095")
  - `jotformsubmissionid`: Initially empty, populated after upload
- **Lookup Fields** (from `coreid.enc`):
  - `child-name`: Student's full name
  - `class-id`: Class identifier for 25/26 academic year only
  - `Gender`: Fallback if missing in PDF
- **Lookup Fields** (from `classid.enc`):
  - `class-name`: Human-readable class name
- **Override Support**: `config/host_identity.json` for container deployments

#### Stage 7: Termination Calculation
- **Termination Rules** (see `PRDs/termination-rules.md`):
  | Rule | Questions | Threshold | Output Field |
  |------|-----------|-----------|--------------|
  | ERV_Ter1 | ERV_Q1–Q12 | <5 correct | term_ERV_Ter1 |
  | ERV_Ter2 | ERV_Q13–Q24 | <5 correct | term_ERV_Ter2 |
  | ERV_Ter3 | ERV_Q25–Q36 | <5 correct | term_ERV_Ter3 |
  | CM_Ter1 | CM_Q1–Q7 | <4 correct | term_CM_Ter1 |
  | CM_Ter2 | CM_Q8–Q12 | <4 correct | term_CM_Ter2 |
  | CM_Ter3 | CM_Q13–Q17 | <4 correct | term_CM_Ter3 |
  | CM_Ter4 | CM_Q18–Q22 | <4 correct | term_CM_Ter4 |
  | CWR_10Incorrect | CWR_Q1–Q60 | 10 consecutive | term_CWR_10Incorrect |
  | FM_Ter | FM_squ_1–3 | All = 0 | term_FM_Ter |

- **Absolute Certainty Principle**:
  - Set `"0"` (continued) if: `correct ≥ threshold` (already passed)
  - Set `"1"` (terminated) if: `correct + unanswered < threshold` (impossible to pass)
  - Otherwise: **Don't set** - still possible to pass with remaining questions
  - Example: ERV_Ter1 needs ≥5 correct out of 12
    - 3 correct, 1 unanswered: Max = 4 < 5 → Set "1" ✅
    - 3 correct, 3 unanswered: Max = 6 ≥ 5 → Don't set ⏸️

- **Score Field Cleanup**: Remove all `_Sc` helper fields after calculation (not uploaded)

#### Stage 8: Write JSON
- Write enriched JSON to disk at same location as PDF
- Filename: Same stem as PDF with `.json` extension
- Include all enriched fields, computed terminations
- Set `jotformsubmissionid = ""` as placeholder
- **Critical**: Data persisted BEFORE upload attempt (never lost)

#### Stage 9: JotForm Upload
- **Upsert Workflow**:
  1. Search JotForm for existing submission by `sessionkey`
  2. If found: Update submission (exclude immutable `sessionkey` field)
  3. If not found: Create new submission (include `sessionkey`)
  4. Write back `jotformsubmissionid` to JSON file
- **Retry Logic**:
  - 3 attempts with exponential backoff (default)
  - Delays: 10s, 30s, 90s (with ±20% jitter)
  - Retry on: 429 (rate limit), 5xx (server errors), timeouts
  - Fail immediately on: 4xx errors (except 429)
- **Rate Limiting** (`config/jotform_config.json`):
  - `maxConcurrent`: Parallel upload workers (default: 2)
  - `perMinuteQuota`: Max requests per minute (default: 120)
  - `batchSize`: Records per batch request (default: 25)
  - `burstCooldownSeconds`: Delay after rate limit hit (default: 60)
- **Permanent Failure Handling**:
  - After exhausting retries, log error details
  - File to `filed/Unsorted/` regardless of school ID
  - JSON retains empty `jotformsubmissionid` (detection flag)
  - Logs contain full error stack for debugging

#### Stage 10: Filing Protocol
- **Success Path**: `filed/{schoolId}/`
  - Both PDF and JSON moved to school-specific folder
  - JSON contains valid `jotformsubmissionid`
  - Files archived for audit trail
- **Failure Path**: `filed/Unsorted/`
  - Validation failures OR permanent upload failures
  - JSON has empty/missing `jotformsubmissionid`
  - Requires manual review and potential re-processing
- **Collision Handling**: If file exists, append timestamp suffix

---

## System Requirements

### Software Requirements

#### Required
- **PowerShell 7.0+** (required for AES-GCM decryption via System.Security.Cryptography)
  - Download: https://github.com/PowerShell/PowerShell/releases
  - Verify: `pwsh --version`
- **Python 3.7+** with PDF parsing library
  ```bash
  # Option 1: pypdf (recommended)
  pip install pypdf
  
  # Option 2: PyPDF2 (legacy support)
  pip install PyPDF2
  ```
- **OneDrive for Business** sync client OR **Synology Cloud Sync**
- **Web Browser** (Chrome, Firefox, Edge) for dashboard access

#### Optional
- **Windows Credential Manager** (Windows deployment credential storage)
- **NSSM** (Non-Sucking Service Manager) for Windows Service installation
- **Docker** (Synology NAS deployment)

### Hardware Requirements

#### Minimum (Development/Testing)
- **CPU**: Dual-core 2.0 GHz
- **RAM**: 4 GB
- **Disk**: 10 GB free space (for logs and filed PDFs)
- **Network**: Broadband internet (for OneDrive sync and JotForm API)

#### Recommended (Production)
- **CPU**: Quad-core 2.5 GHz or better (Intel i5/i7, AMD Ryzen)
- **RAM**: 8 GB or more
- **Disk**: 50 GB free space (SSD preferred for faster I/O)
- **Network**: Dedicated line with >10 Mbps upload

#### Validated Platforms
- **Windows 10/11 Enterprise** - Primary production platform
- **Synology DS923+** - NAS deployment (Ryzen R1600, 4+ GB RAM)
- **Windows Server 2019/2022** - Enterprise server deployment

### Security Requirements
- **Encrypted Assets**: `credentials.enc`, `coreid.enc`, `schoolid.enc`, `classid.enc`
- **System Password**: Stored in Windows Credential Manager or DSM Docker Secrets
- **HTTPS Access**: All external API calls over TLS 1.2+
- **File Permissions**: Restricted access to `assets/` and `config/` directories

---

## Data Enrichment & Transformation

### Field Enrichment Table

After validation, the agent enriches the JSON with computed and lookup fields:

| Field | Source | Type | Description | Example |
|-------|--------|------|-------------|---------|
| `sessionkey` | Filename stem | Computed | Unique identifier for submission | `"13268_20250904_14_07"` |
| `computerno` | `$env:COMPUTERNAME` | Computed | Computer number from hostname | `"KS095"` → `"095"` |
| `jotformsubmissionid` | JotForm API response | Returned | Submission ID after upload | `"5584719287206845678"` |
| `child-name` | `coreid.enc` lookup | Lookup | Student's full name | `"張三"` |
| `class-id` | `coreid.enc` lookup | Lookup | Class identifier (25/26 year only) | `"C-023-03"` |
| `class-name` | `classid.enc` lookup | Lookup | Human-readable class name | `"小一甲班"` |
| `Gender` | `coreid.enc` fallback | Conditional | Gender if missing in PDF | `"M"` or `"F"` |

### Score Helper Fields

**Important**: The PDF contains score helper fields (e.g., `ERV_Q1_Sc`, `CM_Q1_TEXT_Sc`) used internally for termination calculation. These fields are **removed after enrichment** and will **not** be uploaded to JotForm. Only raw answer values are preserved in the final submission.

**Processing Flow**:
1. Extract score helpers from PDF (`_Sc` fields)
2. Use helpers to calculate termination outcomes
3. Remove all `_Sc` fields from JSON
4. Upload only raw answers and computed terminations

### Termination Rules

The system calculates termination outcomes based on survey logic defined in `PRDs/termination-rules.md`:

| Rule | Question Range | Total Qs | Threshold | Output Field | Logic |
|------|---------------|----------|-----------|--------------|-------|
| **ERV_Ter1** | ERV_Q1–Q12 | 12 | ≥5 correct | `term_ERV_Ter1` | "1" if <5, "0" if ≥5 |
| **ERV_Ter2** | ERV_Q13–Q24 | 12 | ≥5 correct | `term_ERV_Ter2` | "1" if <5, "0" if ≥5 |
| **ERV_Ter3** | ERV_Q25–Q36 | 12 | ≥5 correct | `term_ERV_Ter3` | "1" if <5, "0" if ≥5 |
| **CM_Ter1** | CM_Q1–Q7 | 7 | ≥4 correct | `term_CM_Ter1` | "1" if <4, "0" if ≥4 |
| **CM_Ter2** | CM_Q8–Q12 | 5 | ≥4 correct | `term_CM_Ter2` | "1" if <4, "0" if ≥4 |
| **CM_Ter3** | CM_Q13–Q17 | 5 | ≥4 correct | `term_CM_Ter3` | "1" if <4, "0" if ≥4 |
| **CM_Ter4** | CM_Q18–Q22 | 5 | ≥4 correct | `term_CM_Ter4` | "1" if <4, "0" if ≥4 |
| **CWR_10Incorrect** | CWR_Q1–Q60 | 60 | <10 consecutive | `term_CWR_10Incorrect` | "1" if ≥10 seq., "0" otherwise |
| **FM_Ter** | FM_squ_1–3 | 3 | Any score >0 | `term_FM_Ter` | "1" if all=0, "0" if any>0 |

#### Termination Value Semantics
- **"0"** = Continued (threshold met, assessment proceeds)
- **"1"** = Terminated (threshold not met, assessment ended early)
- **Empty/Unset** = Indeterminate (not enough data to decide)

#### Absolute Certainty Principle

Termination values are calculated **only when mathematically certain**:

1. **Set "0" (continued)** if: `correct_count ≥ threshold`
   - Student has already met the passing criteria
   - Assessment definitely continues to next section
   - Example: 6 correct out of 12, need ≥5 → Set "0" ✅

2. **Set "1" (terminated)** if: `correct_count + unanswered_count < threshold`
   - Even if student answers all remaining questions correctly, cannot reach threshold
   - Assessment definitely terminates
   - Example: 3 correct, 1 unanswered, need ≥5 (out of 12)
     - Max possible = 3 + 1 = 4 < 5 → Set "1" ✅

3. **Don't set (leave empty)** otherwise
   - Student might still reach threshold with remaining questions
   - Need more data to make definitive determination
   - Example: 3 correct, 3 unanswered, need ≥5 (out of 12)
     - Max possible = 3 + 3 = 6 ≥ 5 → **Don't set** ⏸️

#### Important Notes
- Empty/unanswered questions are treated as **missing data**, not failures
- If PDF already contains termination value (filled during survey), it is **preserved**
- System calculations are used to **validate** administrator's recorded terminations
- Mismatches between recorded and calculated values trigger warnings in Checking System

#### Calculation Examples

**Example 1: ERV_Ter1 (English Vocab Block 1)**
- Questions: ERV_Q1 through ERV_Q12 (12 total)
- Threshold: ≥5 correct to continue
- Scenario A: 6 answered, 6 correct
  - Result: Set `term_ERV_Ter1 = "0"` (passed threshold) ✅
- Scenario B: 8 answered, 3 correct
  - Max possible = 3 + 4 = 7 ≥ 5
  - Result: **Don't set** (could still pass) ⏸️
- Scenario C: 11 answered, 3 correct
  - Max possible = 3 + 1 = 4 < 5
  - Result: Set `term_ERV_Ter1 = "1"` (cannot pass) ✅

**Example 2: CWR_10Incorrect (Chinese Word Reading)**
- Questions: CWR_Q1 through CWR_Q60 (60 total)
- Threshold: <10 consecutive incorrect to continue
- Scenario A: Questions 10-19 all incorrect (10 in sequence)
  - Result: Set `term_CWR_10Incorrect = "1"` (terminated) ✅
- Scenario B: 9 consecutive incorrect, then 1 correct
  - Result: Set `term_CWR_10Incorrect = "0"` (passed) ✅
- Scenario C: 5 consecutive incorrect, rest unanswered
  - Result: **Don't set** (need more data) ⏸️

---

## Checking System - Quality Assurance Dashboard

### Overview

The Checking System is a comprehensive data validation suite that provides multi-level drilldown views for monitoring assessment completion and data quality. It serves **two critical verification functions**:

#### A. Display Uploaded Data Accurately
**Purpose**: Show what test administrators recorded and uploaded to JotForm
- Display all student answers exactly as submitted
- Reflect administrator's manual decisions during assessment
- Provide complete visibility into database contents
- Serve as the "source of truth" view for uploaded data

#### B. Validate Through Recalculation
**Purpose**: Calculate what SHOULD be true and flag discrepancies
- Recalculate termination rules based on actual responses
- Compare administrator's recorded decisions vs. system calculations
- Identify data quality issues and missing data
- Alert administrators to inconsistencies requiring verification

### Dashboard Hierarchy

The system provides 5 levels of drill-down navigation:

```
Level 1: District View (checking_system_1_district.html)
    ↓ Geographic aggregation
Level 1B: Group View (checking_system_1_group.html)
    ↓ Project group organization
Level 2: School View (checking_system_2_school.html)
    ↓ Individual school performance
Level 3: Class View (checking_system_3_class.html)
    ↓ Class-level completion heatmaps
Level 4: Student View (checking_system_4_student.html)
    ↓ Individual student detail validation
```

### Key Questions Answered

#### 1. Data Completeness
- **Is there any missing data?**
  - How many questions are unanswered?
  - Which specific questions are missing?
  - Are there gaps in required fields?
- **Visual Indicators**: Grey status circles, "Missing only" filter, answered/total counts

#### 2. Administrator Accuracy Validation
- **Did the administrator mark termination rules correctly?**
  - What did the administrator record? (0=passed, 1=terminated)
  - What should they have recorded based on actual answers?
  - Do the two values match?
- **Visual Indicators**:
  - ✅ **Green checkmark** = Verified - Record matches calculation
  - ⚠️ **Orange warning** = Mismatch detected - Please verify
  - 🔴 **Red highlight** = Triggered termination
  - Side-by-side comparison views

### Status Indicators

| Icon | Meaning | Description |
|------|---------|-------------|
| ✅ | Complete & Verified | All tasks submitted, calculations match |
| ⚠️ | Incomplete / Mismatch | Missing data or calculation discrepancy |
| 🔴 | Terminated | Assessment ended early per rules |
| ⚪ | Not Started | No submission data available |
| 🔵 | In Progress | Partial completion |

### Text Field Display (_TEXT Fields)

**New Feature (October 2025)**: The Checking System now displays text answer fields for Theory of Mind (ToM) questions with smart status indicators.

**Applicable Fields:**
- ToM_Q3_TEXT, ToM_Q3a_TEXT, ToM_Q4a_TEXT, ToM_Q6a_TEXT, ToM_Q7a_TEXT, ToM_Q7b_TEXT

**Status Display Rules:**

| Scenario | Radio Answer | Text Content | Display | Meaning |
|----------|-------------|--------------|---------|---------|
| Correct selected | ✓ Correct | Any | 🔵 **N/A** | Text not needed |
| Wrong selected | ✗ Incorrect | Has text | 🔵 **Answered** | Text provided |
| Wrong selected | ✗ Incorrect | Empty | 🔴 **Not answered** | Expected but missing |
| No answer | (null) | Any | ⚪ **—** | No display needed |

**Key Rules:**
1. **"Not answered" status ONLY appears when the radio answer is incorrect**
2. When radio is not answered, _TEXT field shows "—" (no display needed)
3. _TEXT fields are **NEVER** counted in completion percentage calculations
4. Only scored questions (radio_text questions) count toward task completion

**Example:** In ToM_Q3a, if student selects "狗仔" (correct answer), the ToM_Q3a_TEXT field shows "N/A" even if text is accidentally entered. If student selects "其他" (other), the text field should contain the actual answer and shows "Answered" status.

**Documentation:** Complete validation logic and implementation details available in `calculation_bible.md` (Lines 158-220).

### JotForm API Filter Implementation

**⚠️ CRITICAL**: All student data retrieval MUST use the `:matches` operator on sessionkey field (QID 3).

After extensive testing in October 2025, we discovered that JotForm's standard filter operators (`:eq`, `:contains`) **DO NOT WORK** for student ID field (QID 20). They return the full dataset (545+ submissions) regardless of filter values.

**✅ CORRECT Implementation**:
```javascript
// Use :matches operator on sessionkey field (QID 3)
const studentIdNumeric = coreId.replace(/^C/, ''); // Remove "C" prefix
const filter = { "q3:matches": studentIdNumeric };

const url = `https://api.jotform.com/form/${formId}/submissions?` +
            `filter=${encodeURIComponent(JSON.stringify(filter))}`;
```

This reduces data transfer from ~30 MB to ~110 KB and improves performance from 3-5 seconds to <500ms.

### Accessing the Checking System

1. **From Main Entry Page** (`index.html`):
   - Click "Checking System" button
   - Navigate to `checking_system_home.html`

2. **Direct Access**:
   - Open `checking_system_home.html` in browser
   - Enter system password when prompted
   - Select desired view level (District/Group/School/Class/Student)

3. **Navigation Flow**:
   - Start at District or Group overview
   - Click on region to drill down to schools
   - Click on school to view classes
   - Click on class to see student list
   - Click on student to view detailed validation

---

## PDF Parser Integration

### Parser Architecture

The agent uses a Python-based PDF parser that extracts all form fields and generates enriched JSON output.

**Components**:
- **`parser/parse_pdf_cli.py`** - Command-line interface
  - Receives PDF path as argument
  - Returns JSON to stdout
  - Handles errors gracefully
  
- **`parser/pdf_tools.py`** - Core extraction engine
  - Uses `pypdf` or `PyPDF2` library
  - Extracts text boxes, checkboxes, radio buttons
  - Handles multi-page forms
  - Preserves field types and values

**Field Mapping**: Uses `assets/jotformquestions.json` to map PDF field names (e.g., `"Student ID"`) to standardized friendly names (e.g., `"student-id"`) that match JotForm question IDs for seamless upload.

**Usage Example**:
```bash
# Command-line invocation
python parser/parse_pdf_cli.py "/path/to/13268_20250904_14_07.pdf"

# Output (JSON to stdout)
{
  "student-id": "C13268",
  "school-id": "S023",
  "ERV_Q1": "2",
  "ERV_Q1_Sc": "1",
  ...
}
```

**Error Handling**:
- Returns error object with descriptive message if parsing fails
- Logs detailed stack trace to agent logs
- Moves problematic PDF to `Unsorted/` with reason code

---

## JotForm Upload Integration

### Upload Workflow

After enrichment, the agent automatically uploads data to JotForm using an **idempotent upsert workflow**:

#### Step-by-Step Process
1. **Search** for existing submission by `sessionkey` (unique identifier)
   - Use JotForm API: `GET /form/{formId}/submissions?filter={"q3:matches":"13268"}`
   - QID 3 contains the sessionkey field
   
2. **Decision Branch**:
   - **If found**: Update existing submission
     - Use `POST /submission/{submissionId}`
     - Exclude immutable `sessionkey` field from payload
     - Preserve existing `jotformsubmissionid`
   - **If not found**: Create new submission
     - Use `POST /form/{formId}/submissions`
     - Include `sessionkey` in payload
     - Generate new `jotformsubmissionid`

3. **Write Back**:
   - Extract `jotformsubmissionid` from API response
   - Update local JSON file with submission ID
   - Commit changes to disk before filing

### Safety Features

#### Data Persistence Guarantee
- **Enriched JSON is written BEFORE upload attempt**
  - Ensures data is never lost even if upload fails
  - JSON file serves as local backup and audit trail
  - Can be manually re-uploaded or debugged if needed

#### Idempotency
- **Re-running same PDF updates existing submission** (no duplicates)
- `sessionkey` serves as unique constraint
- Multiple uploads of same file converge to single JotForm record
- Safe to retry failed uploads without data duplication

#### Retry Logic with Exponential Backoff
- **Attempts**: 3 by default (configurable via `config/jotform_config.json`)
- **Delay Schedule**: 10s, 30s, 90s (with ±20% jitter to avoid thundering herd)
- **Retryable Errors**:
  - 429 (Rate Limit Exceeded) - Respect cooldown period
  - 5xx (Server Errors) - Transient failures, retry helps
  - Timeouts - Network issues may resolve
- **Non-Retryable Errors**:
  - 4xx (Client Errors, except 429) - Bad request, won't succeed on retry
  - Authentication failures - Credential issue needs manual fix
  - Malformed data - Validation error won't change

#### Permanent Failure Handling
After exhausting all retry attempts:
1. **Log error** with full details (level: ERROR)
   - Error message, HTTP status code
   - Request payload (sanitized)
   - Timestamp and attempt count
2. **File to `Unsorted/` folder** regardless of valid School ID
   - Both PDF and JSON moved together
   - JSON retains empty `jotformsubmissionid` (detection flag)
   - Data preserved for manual review
3. **Queue telemetry updated** for dashboard visibility

### Configuration

#### API Credentials (`assets/credentials.enc`)
Encrypted bundle containing:
- `jotformApiKey` - API key for authentication
- `jotformFormId` - Target form ID for submissions
- `systemPassword` - Master password for decryption

#### Field Mapping (`assets/jotformquestions.json`)
Maps friendly field names to JotForm Question IDs (QIDs):
```json
{
  "sessionkey": "3",
  "student-id": "20",
  "school-id": "21",
  "computerno": "647",
  "ERV_Q1": "100",
  ...
}
```

#### Rate Limiting (`config/jotform_config.json`)
```json
{
  "maxConcurrent": 2,          // Parallel upload workers
  "batchSize": 25,             // Records per batch request
  "perMinuteQuota": 120,       // Max requests per minute
  "retryScheduleSeconds": [10, 30, 90],  // Retry delays
  "burstCooldownSeconds": 60   // Delay after rate limit hit
}
```

### Verification & Monitoring

#### Check Upload Status in Logs
```powershell
# View all JotForm-related log entries
Select-String -Path logs/YYYYMMDD_processing_agent.csv -Pattern "Jotform"

# Filter for specific sessionkey
Select-String -Path logs/*.csv -Pattern "13268_20250904_14_07" | 
    Where-Object { $_.Line -match "Jotform" }
```

#### Expected Log Entries

**Successful Upload**:
```
2025-10-16 14:07:23,INFO,13268_20250904_14_07.pdf,Jotform upload attempt 1 of 3
2025-10-16 14:07:24,INFO,13268_20250904_14_07.pdf,Found existing Jotform submission: 5584719287206845678
2025-10-16 14:07:25,INFO,13268_20250904_14_07.pdf,Jotform upload successful, wrote back submissionID: 5584719287206845678 (took 1 attempt(s))
```

**Failed Upload (with retries)**:
```
2025-10-16 14:10:15,INFO,13269_20250904_15_30.pdf,Jotform upload attempt 1 of 3
2025-10-16 14:10:16,WARN,13269_20250904_15_30.pdf,Jotform upload failed (429 Rate Limit), retrying after 10s
2025-10-16 14:10:27,INFO,13269_20250904_15_30.pdf,Jotform upload attempt 2 of 3
2025-10-16 14:10:28,INFO,13269_20250904_15_30.pdf,Creating new Jotform submission
2025-10-16 14:10:29,INFO,13269_20250904_15_30.pdf,Jotform upload successful (took 2 attempt(s))
```

**Permanent Failure**:
```
2025-10-16 14:15:45,INFO,13270_20250904_16_00.pdf,Jotform upload attempt 3 of 3
2025-10-16 14:16:15,ERROR,13270_20250904_16_00.pdf,Jotform upload PERMANENTLY FAILED after 3 attempts: API Error 500 Internal Server Error
2025-10-16 14:16:15,INFO,13270_20250904_16_00.pdf,Filing to Unsorted due to upload failure
```

### Failed Upload Detection & Recovery

**Failed uploads are automatically filed to `filed/Unsorted/` folder**, making them easy to identify and retry:

#### Detecting Failed Uploads

```powershell
# PowerShell script to check Unsorted folder for failed uploads
Get-ChildItem filed/Unsorted -Filter "*.json" | ForEach-Object {
    $json = Get-Content $_.FullName | ConvertFrom-Json
    $sessionkey = $json.data.sessionkey
    
    # Check if jotformsubmissionid is empty/missing
    if ([string]::IsNullOrWhiteSpace($json.data.jotformsubmissionid)) {
        Write-Host "Failed upload: $($_.Name) (sessionkey: $sessionkey)" -ForegroundColor Yellow
        
        # Find error details in logs
        $logPattern = $sessionkey -replace '_', '\\_'
        Select-String -Path "logs/*_processing_agent.csv" -Pattern $logPattern | 
            Where-Object { $_.Line -match "PERMANENTLY FAILED|ERROR" } |
            ForEach-Object { 
                Write-Host "  Error: $($_.Line)" -ForegroundColor Red 
            }
    }
}
```

#### Logs as Single Source of Truth

**Logs are the single source of truth** for failure reasons. Search logs by sessionkey:

```powershell
# Get all log entries for specific file (errors and warnings)
$sessionkey = "13268_20250904_14_07"
Select-String -Path "logs/*_processing_agent.csv" -Pattern $sessionkey | 
    Where-Object { $_.Line -match "ERROR|WARN" }

# Get only permanent failures
Select-String -Path "logs/*_processing_agent.csv" -Pattern "PERMANENTLY FAILED"

# Get rate limit warnings
Select-String -Path "logs/*_processing_agent.csv" -Pattern "429.*Rate Limit"
```

#### Manual Retry Procedure

1. **Identify failed file** in `filed/Unsorted/` folder
2. **Review error** in logs to understand root cause
3. **Fix underlying issue**:
   - Rate limit: Wait for cooldown period (60+ seconds)
   - Network error: Check internet connectivity
   - API error: Verify JotForm service status
   - Data error: Manually correct JSON fields
4. **Move file back** to `incoming/` folder for re-processing
   ```powershell
   Move-Item "filed/Unsorted/13268_20250904_14_07.pdf" "incoming/"
   Move-Item "filed/Unsorted/13268_20250904_14_07.json" "incoming/"
   ```
5. **Monitor logs** for successful re-upload

#### Telemetry API for Dashboard Monitoring

The processor agent exposes upload status via telemetry API:

**Endpoint**: `GET http://localhost:48500/api/upload-status`

**Response**:
```json
{
  "totalFiles": 150,
  "successCount": 145,
  "failedCount": 5,
  "pendingRetries": 2,
  "lastUpdate": "2025-10-16T14:30:00Z",
  "failures": [
    {
      "sessionkey": "13270_20250904_16_00",
      "filename": "13270_20250904_16_00.pdf",
      "attempts": 3,
      "lastError": "API Error 500 Internal Server Error",
      "timestamp": "2025-10-16T14:16:15Z"
    }
  ]
}
```

**Alternative for GitHub Pages**: Write `status/upload_status.json` every 60 seconds with same structure for static hosting.

---

## Configuration Reference

### Agent Configuration (`config/agent.json`)

Complete configuration example with explanations:

```json
{
  "oneDrive": {
    "autoDetect": true,
    "relativePath": "\\The Education University of Hong Kong\\o365grp_KeySteps@JC - General\\98 - IT Support\\04 - Homemade Apps\\4Set-Server",
    "fallbackRoot": "C:\\Users\\YourUsername"
  },
  "watchFolders": ["incoming"],
  "pollingIntervalSeconds": 5,
  "maxConcurrentWorkers": 2,
  "logRetentionDays": 30,
  "telemetryPort": 48500,
  "queueManifestPath": "./queue_manifest.json"
}
```

**Field Descriptions**:
- `oneDrive.autoDetect` - Enable automatic OneDrive path detection
- `oneDrive.relativePath` - Path appended to detected OneDrive root
- `oneDrive.fallbackRoot` - Manual override if auto-detection fails
- `watchFolders` - Array of folders to monitor (relative to OneDrive path)
- `pollingIntervalSeconds` - File system check frequency
- `maxConcurrentWorkers` - Parallel PDF processing threads
- `logRetentionDays` - Auto-delete logs older than N days
- `telemetryPort` - Local HTTP API port for dashboard queries
- `queueManifestPath` - Persistent queue state file location

### JotForm Configuration (`config/jotform_config.json`)

Rate limiting and retry settings:

```json
{
  "maxConcurrent": 2,
  "batchSize": 25,
  "perMinuteQuota": 120,
  "retryScheduleSeconds": [10, 30, 90],
  "burstCooldownSeconds": 60,
  "timeoutSeconds": 30
}
```

**Field Descriptions**:
- `maxConcurrent` - Maximum parallel upload workers (1-5 recommended)
- `batchSize` - Records per batch API request (1-100)
- `perMinuteQuota` - Maximum API calls per minute (respect JotForm limits)
- `retryScheduleSeconds` - Delay array for successive retries
- `burstCooldownSeconds` - Additional delay after rate limit hit
- `timeoutSeconds` - HTTP request timeout duration

**Performance Tuning**:
- **High throughput**: Increase `maxConcurrent` to 4-5, ensure adequate CPU/RAM
- **Rate limit avoidance**: Decrease `perMinuteQuota` to 80-100
- **Large forms**: Decrease `batchSize` to 10-15, increase `timeoutSeconds` to 60

### Host Identity Override (`config/host_identity.json`)

Optional configuration for Synology/container deployments:

```json
{
  "computerno": "095",
  "hostName": "KS095"
}
```

**When to Use**:
- Synology NAS where `$env:COMPUTERNAME` is unavailable
- Docker containers with generic hostnames
- Testing environments with non-standard naming

**If omitted**: Agent extracts computer number from `$env:COMPUTERNAME` automatically

### Checking System Configuration (`config/checking_system_config.json`)

Dashboard display and behavior settings:

```json
{
  "districts": ["Shatin", "Sham Shui Po", "Kowloon City", "Tuen Mun", "Yuen Long", "Others"],
  "groups": [1, 2, 3, 4, 5],
  "refreshIntervalSeconds": 60,
  "defaultPageSize": 50,
  "enableDemoMode": false
}
```

---

## Troubleshooting Guide

### Common Issues & Solutions

#### 1. Agent Not Processing Files

**Symptoms**:
- Files accumulate in `incoming/` folder
- No log entries being generated
- Service appears running but inactive

**Diagnosis**:
```powershell
# Check service status (if installed as service)
Get-Service -Name "4SetProcessor"

# Check if process is running
Get-Process -Name "pwsh" | Where-Object { $_.CommandLine -match "processor_agent" }

# Verify OneDrive sync status
Get-ItemProperty -Path "HKCU:\Software\Microsoft\OneDrive" -Name "OneDriveCommercial"

# Review recent logs
Get-Content logs/*_processing_agent.csv -Tail 50
```

**Solutions**:
- **Service hung**: Restart service
  ```powershell
  Restart-Service -Name "4SetProcessor"
  ```
- **OneDrive not synced**: Check OneDrive system tray icon for errors
- **Path misconfigured**: Verify `config/agent.json` paths exist
- **Permission denied**: Run agent with appropriate file system permissions

#### 2. Upload Failures to JotForm

**Symptoms**:
- Files moved to `filed/Unsorted/` folder
- JSON files have empty `jotformsubmissionid`
- Error messages in logs about API failures

**Diagnosis**:
```powershell
# Check for permanent failures
Select-String -Path logs/*.csv -Pattern "PERMANENTLY FAILED"

# Check for rate limiting
Select-String -Path logs/*.csv -Pattern "429.*Rate Limit"

# Verify credentials decrypt correctly
# (test decrypt manually with debug script)
```

**Solutions**:
- **Rate limit exceeded**:
  - Wait 60+ seconds for cooldown
  - Decrease `perMinuteQuota` in `config/jotform_config.json`
  - Reduce `maxConcurrent` to 1-2
  
- **Network connectivity**:
  - Verify internet connection
  - Test JotForm API: `curl https://api.jotform.com/user`
  - Check firewall/proxy settings
  
- **Invalid credentials**:
  - Verify `credentials.enc` decrypts correctly
  - Check API key validity in JotForm account
  - Rotate credentials if compromised
  
- **Malformed data**:
  - Review JSON structure in `filed/Unsorted/`
  - Check for required fields in `jotformquestions.json`
  - Validate field mappings are correct

#### 3. Validation Rejections

**Symptoms**:
- Files moved to `filed/Unsorted/` immediately
- Log shows rejection reason codes
- No JotForm upload attempt made

**Rejection Codes & Solutions**:

| Code | Meaning | Solution |
|------|---------|----------|
| `pdf_extraction_failed` | Parser error | Re-scan PDF with correct settings, check file integrity |
| `coreid_missing_in_mapping` | Student not in database | Add student to `coreid.enc`, re-encrypt, restart agent |
| `coreid_schoolid_mismatch` | School IDs don't match | Verify correct school ID in PDF form, check mapping accuracy |
| `invalid_filename_format` | Filename pattern wrong | Rename file to `xxxxx_YYYYMMDD_HH_MM.pdf` format |

**Diagnosis**:
```powershell
# Find rejection reasons
Select-String -Path logs/*.csv -Pattern "rejected|Reject"

# Check specific file rejection
Select-String -Path logs/*.csv -Pattern "13268_20250904_14_07" | 
    Where-Object { $_.Line -match "reject" }
```

#### 4. Checking System Mismatches

**Symptoms**:
- Orange warning icons (⚠️) in dashboard
- "Recorded" vs "Calculated" values differ
- Termination flags don't match system computation

**Investigation Steps**:
1. **Review actual question responses** in student detail view
2. **Verify calculation logic** against `PRDs/termination-rules.md`
3. **Check for missing/unanswered questions** that affect thresholds
4. **Compare administrator's decision** with automatic calculation

**Common Causes**:
- **Incomplete data**: Unanswered questions make calculation indeterminate
- **Manual override**: Administrator intentionally marked differently
- **Data entry error**: Wrong answer recorded during assessment
- **Logic edge case**: Unusual response pattern not covered by rules

**Resolution**:
- If **calculation is correct**: Re-upload PDF with corrected termination value
- If **data is missing**: Complete assessment and re-submit
- If **edge case**: Document scenario and escalate to development team
- If **intentional override**: Add comment in system for audit trail

#### 5. OneDrive Path Not Detected

**Symptoms**:
- Agent logs "OneDrive path not found"
- Files not being picked up from watch folder
- Auto-detection fails in all strategies

**Diagnosis**:
```powershell
# Check environment variables
$env:OneDriveCommercial
$env:OneDrive

# Check registry keys
Get-ItemProperty -Path "HKCU:\Software\Microsoft\OneDrive\Commercial"
Get-ItemProperty -Path "HKLM:\Software\Microsoft\OneDrive"

# Verify OneDrive is signed in
Get-Process -Name "OneDrive"
```

**Solutions**:
- **Set fallback path** in `config/agent.json`:
  ```json
  {
    "oneDrive": {
      "autoDetect": false,
      "fallbackRoot": "C:\\Users\\YourUsername\\OneDrive - YourOrg",
      "relativePath": "\\Path\\To\\4Set-Server"
    }
  }
  ```
- **Sign in to OneDrive** on the machine
- **Verify sync folder** in OneDrive settings
- **Use UNC path** for network shares if applicable

#### 6. Performance Issues

**Symptoms**:
- Processing takes >10 seconds per file
- CPU usage constantly at 100%
- Queue backlog growing faster than processing

**Diagnosis**:
```powershell
# Check current queue size
$manifest = Get-Content queue_manifest.json | ConvertFrom-Json
$manifest.queue.Count

# Monitor CPU and memory
Get-Process -Name "pwsh" | Select-Object CPU, WS

# Check for disk I/O bottleneck
Get-Counter '\PhysicalDisk(*)\% Disk Time'
```

**Solutions**:
- **Reduce concurrent workers**:
  ```json
  { "maxConcurrentWorkers": 1 }
  ```
- **Increase polling interval**:
  ```json
  { "pollingIntervalSeconds": 10 }
  ```
- **Upgrade hardware**: 
  - Add RAM (8 GB+ recommended)
  - Use SSD for filed/ directory
  - Upgrade to quad-core CPU
- **Optimize Python parser**:
  - Use pypdf instead of PyPDF2 (faster)
  - Pre-compile Python scripts
  - Consider caching parsed results

---

## Security Best Practices

### Credential Management
1. **Never commit** `credentials.json` or decrypted files to version control
2. **Rotate API keys** quarterly or after suspected compromise
3. **Use Windows Credential Manager** for system password storage
4. **Restrict file permissions** on `assets/` directory (Admin/Service account only)
5. **Audit access logs** monthly for unauthorized access attempts

### Encryption Standards
- **Algorithm**: AES-256-GCM (authenticated encryption)
- **Key Derivation**: PBKDF2-SHA256, 100,000 iterations
- **Salt**: 16-byte random per encryption
- **IV**: 12-byte random per encryption
- **Never reuse** salts or IVs across encryption operations

### Network Security
- **Use HTTPS** for all JotForm API calls (enforced by client)
- **Bind telemetry API** to localhost only (prevent remote access)
- **Firewall rules**: Allow outbound HTTPS (443) only
- **No inbound** connections required for agent operation

### Access Controls
- **Service account**: Run agent as limited-privilege service account
- **File permissions**: `filed/` directory readable by agent only
- **Dashboard authentication**: System password required for web access
- **Audit logging**: All actions logged with timestamp and user

---

## Maintenance Procedures

### Daily Tasks
- [ ] Verify agent service is running
- [ ] Check OneDrive sync status (green checkmark)
- [ ] Review dashboard for overnight uploads
- [ ] Clear/investigate files in `filed/Unsorted/`
- [ ] Monitor queue size in `queue_manifest.json`

### Weekly Tasks
- [ ] Review and archive old log files (>7 days)
- [ ] Check disk space on `filed/` directories
- [ ] Validate encrypted asset integrity (SHA-256 hashes)
- [ ] Test credential rotation procedures (dry run)
- [ ] Review error patterns in logs

### Monthly Tasks
- [ ] Performance benchmarking and trend analysis
- [ ] Security audit of access logs
- [ ] Update documentation for process changes
- [ ] Stakeholder reporting on completion rates
- [ ] Backup critical configuration files

### Quarterly Tasks
- [ ] Rotate API keys and system passwords
- [ ] Full system security review
- [ ] Update dependencies (PowerShell, Python libraries)
- [ ] Disaster recovery drill
- [ ] Capacity planning and hardware assessment

---

## Development & Contribution

### Prerequisites for Developers
- **PowerShell 7.4+** for script development
- **Python 3.9+** with pypdf library
- **Git** for version control
- **Code editor** (VS Code recommended with PowerShell extension)

### Development Workflow
1. **Clone repository** and create feature branch
2. **Make changes** following code standards (see below)
3. **Test locally** with `-SingleRun` mode
4. **Update documentation** (PRDs, README, Agent)
5. **Commit with conventional commit messages**
6. **Create pull request** with detailed description

### Code Standards
- **PowerShell**: Follow PSScriptAnalyzer recommendations
- **Python**: PEP 8 compliant, type hints where applicable
- **JavaScript**: ES6+ with strict mode enabled
- **HTML/CSS**: Semantic markup, Tailwind CSS utilities

### Testing Guidelines
- Unit tests for data transformation functions
- Integration tests for end-to-end pipeline
- Security tests for encryption/decryption
- Performance tests for throughput benchmarks

### Commit Message Format
```
type(scope): description

[optional body]

[optional footer]
```

**Types**: feat, fix, docs, style, refactor, test, chore  
**Example**: `feat(parser): add support for multi-page PDFs`

---

## References & Resources

### Documentation
- **Main Documentation**: `/PRDs/` folder
- **Agent.md**: Development roadmap and priorities
- **Security Architecture**: `PRDs/data_security_prd.md`
- **Termination Rules**: `PRDs/termination-rules.md`
- **JotForm API Integration**: `PRDs/jotform-integration.md`
  - **NEW**: Complete API call process documentation (see "Complete API Call Process Documentation" section)
  - Includes upload workflow, create submission process, troubleshooting, and best practices

**Note**: All documentation has been consolidated into the `/PRDs/` directory. Legacy references to `TEMP/` subdirectories should use the following paths:
- `TEMP/tasks/termination-rules.md` → `PRDs/termination-rules.md`
- `TEMP/integrations/jotform-integration.md` → `PRDs/jotform-integration.md`
- `TEMP/architecture/security-architecture.md` → `PRDs/data_security_prd.md`
- `TEMP/data-tool/*` → `PRDs/data-pipeline.md`

### External APIs
- **JotForm API**: https://api.jotform.com/docs/
- **OneDrive API**: https://docs.microsoft.com/graph/onedrive-concept-overview

### Tools & Libraries
- **PowerShell 7**: https://github.com/PowerShell/PowerShell
- **pypdf**: https://pypdf.readthedocs.io/
- **Tailwind CSS**: https://tailwindcss.com/docs

### Support
- **Issues**: GitHub Issues tracker
- **Discussions**: GitHub Discussions
- **Email**: project-maintainers@eduhk.hk

---

## License

This project is developed for The Education University of Hong Kong's KeySteps@JC research initiative. All rights reserved.

---

## Acknowledgments

**Project Team**:
- KeySteps@JC Research Team
- The Education University of Hong Kong IT Support
- 4Set System Development Contributors

**Special Thanks**:
- JotForm for API access and support
- Microsoft for OneDrive integration capabilities
- Open-source contributors of pypdf and PowerShell

---

**Last Updated**: October 2025  
**Version**: 2025/26 Academic Year  
**Status**: Production Ready
