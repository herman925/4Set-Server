# 4Set System Development Agenda

**Project:** KeySteps@JC (Phase Two) - 4Set System 2025/26  
**Organization:** The Education University of Hong Kong  
**Last Updated:** October 2025

---

## Executive Summary

The 4Set System is a comprehensive web-based assessment data processing pipeline that automates the collection, validation, processing, and monitoring of educational survey data. It replaces legacy desktop workflows with an unsupervised, cloud-integrated solution that handles PDF form uploads, data validation, enrichment, and submission to JotForm while providing real-time monitoring dashboards for quality assurance.

### Key Objectives
1. **Automated Pipeline**: Eliminate manual intervention in PDF processing workflow
2. **Data Quality**: Enforce validation rules and detect inconsistencies automatically
3. **Real-Time Monitoring**: Provide live dashboards for upload status and data completeness
4. **Security First**: Maintain AES-256-GCM encryption for all sensitive data
5. **Scalability**: Process 20+ PDFs per minute with minimal resource requirements

---

## System Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                      OneDrive (Cloud Storage)                    │
│                  Shared Upload Folder + Sync                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│               Processor Agent (Windows/Synology)                 │
│  • File Watcher (Debounced)                                     │
│  • Two-Phase Validation                                          │
│  • PDF Parsing & Field Extraction                               │
│  • Data Enrichment & Termination Calculation                    │
│  • JotForm Upload with Retry Logic                              │
│  • Filing Protocol (Success → schoolId / Failure → Unsorted)    │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    JotForm (Cloud Database)                      │
│              Submission Storage & Management                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│              Monitoring Dashboard (GitHub Pages)                 │
│  • Upload Status & Queue Health                                 │
│  • Checking System (Data Completeness Validation)               │
│  • Multi-Level Drilldowns (District→School→Class→Student)       │
│  • Rejection & Error Reporting                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Core Components

#### 1. Processor Agent (`processor_agent.ps1`)
**Purpose**: Autonomous Windows/Synology service for PDF ingestion and processing

**Capabilities**:
- **Folder Watcher**: Monitors OneDrive sync folder with debounce logic
- **Phase 1 Validation**: Filename format verification (`xxxxx_YYYYMMDD_HH_MM.pdf`)
- **Phase 2 Validation**: Cross-field consistency via encrypted mappings
- **PDF Parser Integration**: Extracts form fields using Python tools
- **Data Enrichment**: Adds sessionkey, computerno, child-name, class-id
- **Termination Calculation**: Applies threshold rules (ERV, CM, CWR, FM)
- **Computer Number Enforcement**: Configurable requirement for PC tracking
  - When enforcement **ON** (`validation.requireComputerNumber = true`):
    - Agent retries the metadata file with OneDrive sync delay tolerance (configurable attempts/delay).
    - After all retries, files without PC number are rejected and filed to `Unsorted/` without JotForm upload.
  - When enforcement **OFF** (`validation.requireComputerNumber = false`):
    - Agent performs a **single immediate metadata check only** (no wait/retry loop).
    - If metadata is missing, it proceeds to JotForm upload without computer number and logs a single warning.
  - Toggle via `config/agent.json` → `validation.requireComputerNumber`
- **Data Overwrite Protection** (Optional - Configurable): Prevents accidental data corruption on re-uploads
  - Can be enabled/disabled via `config/agent.json` → `dataProtection.enableDataOverwriteProtection` (default: `true`)
  - When enabled: Validates that existing assessment answers won't be overwritten
  - Exception list allows administrative fields to be updated (student-id, child-name, etc.)
  - Conflicts logged with `DATA_OVERWRITE_DIFF` and filed to Unsorted/ when protection is enabled
  - When disabled: Allows full data overwrites during processor agent uploads to JotForm
  - File validation workflow is preserved regardless of this setting
- **JotForm Upload**: Idempotent upsert with exponential backoff retry
- **Filing Protocol**: Archives to `schoolId/` or `Unsorted/` folder
- **Telemetry API**: Exposes queue status via localhost:48500

**Configuration**:
- `config/agent.json` - Path resolution, polling, logging
- `config/jotform_config.json` - Rate limits, retry schedules, log levels
- `config/host_identity.json` - Computer number override (optional)

#### 2. Upload Interface (`upload.html`)
**Purpose**: Web-based drag-and-drop PDF submission interface

**Features**:
- Multi-file drag-and-drop support
- Real-time upload progress tracking
- OneDrive integration for file staging
- Browser-based PDF validation
- Session management and error handling

#### 3. Checking System (`checking_system_*.html`)
**Purpose**: Multi-level data quality and completeness monitoring

**Views**:
- **Home Dashboard**: System-wide statistics and recent activity
- **District View**: Aggregate completion by geographic region
- **Group View**: Project group performance metrics
- **School View**: Individual school progress tracking
- **Class View**: Per-class completion heatmaps
- **Student View**: Detailed task validation with answer verification

**Validation Functions**:
- **Display Uploaded Data**: Show exactly what was submitted to JotForm
- **Recalculate & Validate**: Compare administrator records vs. system calculations
- **Missing Data Detection**: Identify unanswered questions and incomplete tasks
- **Termination Rule Verification**: Flag mismatches between recorded and calculated terminations
- **Visual Indicators**: ✅ Verified, ⚠️ Mismatch, 🔴 Terminated, ⚪ Missing

#### 4. Parser Module (`parser/`)
**Purpose**: PDF field extraction and JSON generation

**Components**:
- `parse_pdf_cli.py` - Command-line interface for parsing
- `pdf_tools.py` - Core extraction engine using pypdf/PyPDF2
- Field mapping via `assets/jotformquestions.json`
- Score helper extraction (`_Sc` fields for termination calculation)

---

## Development Roadmap

### ✅ Phase 1: Foundation (Completed)
- [x] Design system architecture and component interactions
- [x] Create comprehensive PRD documentation suite
- [x] Implement AES-256-GCM encryption for sensitive assets
- [x] Build processor agent with file watcher and validation pipeline
- [x] Develop PDF parser with field extraction and mapping
- [x] Implement two-phase validation (filename + cross-field)

### ✅ Phase 2: Core Pipeline (Completed)
- [x] Data enrichment engine (sessionkey, computerno, class-id)
- [x] Termination rule calculation (ERV, CM, CWR, FM)
- [x] JotForm integration with upsert workflow
- [x] Retry logic with exponential backoff and jitter
- [x] Filing protocol (success → schoolId, failure → Unsorted)
- [x] Queue manifest for restart recovery

### ✅ Phase 3: Monitoring & Quality Assurance (Completed)
- [x] Upload status API and telemetry endpoints
- [x] Checking System dashboard suite
- [x] Multi-level drilldowns (5 levels: district → student)
- [x] Task completion calculation logic
- [x] Termination rule validation and mismatch detection
- [x] Visual status indicators and filtering
- [x] **Radio_text validation with priority-based scoring (Oct 2025)**
- [x] **_TEXT field display support for ToM questions (Oct 2025)**
- [x] **Gender branching verification across all pages (Oct 2025)**
- [x] **Adaptive batch sizing documentation (Oct 2025)**
- [x] **Comprehensive PRDs/calculation_bible.md updates (Oct 2025)**
- [x] **Interactive user guide system with spotlight effects (Oct 2025)**
  - Dynamic SVG-based masking for highlighting UI elements
  - Modal system with expandable previews
  - Tooltip system for contextual information
  - Comprehensive guideline documentation (PRDs/guideline_prd.md)
- [x] **Log viewer E-Prime file type support (Dec 2025)**
  - File type badges (PDF vs E-Prime .edat3) in file summary table
  - Full filename display without extension for all file types
  - Separate File Summary card from Log Entries card
  - File type filter toggle (All / PDF / E-Prime)
  - Compact UI with smaller fonts, reduced padding
  - Scrollable summary table (max 200px height)

### 🔄 Phase 4: Production Deployment (In Progress)
- [x] Upload interface with drag-and-drop support
- [x] OneDrive auto-detection and path resolution
- [x] Host identity configuration for containers
- [ ] **Windows Service installation and configuration**
- [ ] **Synology Docker container deployment**
- [ ] **Production credential management setup**
- [ ] **Rate limiting and performance tuning**
- [ ] **Logging infrastructure and rotation**

### 📋 Phase 5: Operational Excellence (Planned)
- [ ] Automated alert system for upload failures
- [ ] Batch processing optimization for large uploads
- [ ] Historical trend analysis and reporting
- [ ] API documentation and developer guides
- [ ] Operator training materials and SOPs
- [ ] Disaster recovery and backup procedures
- [ ] Performance benchmarking and optimization
- [ ] Security audit and penetration testing

### 🔮 Phase 6: Future Enhancements (Backlog)
- [ ] Real-time Server-Sent Events for dashboard updates
- [ ] Advanced filtering and search capabilities
- [ ] Data export and report generation tools
- [ ] Integration with additional data sources (Qualtrics, Supabase)
- [ ] Mobile-responsive dashboard improvements
- [ ] Automated data quality scoring
- [ ] Machine learning for error prediction
- [ ] API rate limiting management dashboard

---

## Current Priorities

### High Priority (Immediate Action Required)
1. **Production Deployment Testing**
   - Validate Windows Service installation on target machines
   - Test Synology Docker container with Cloud Sync integration
   - Verify OneDrive path resolution across environments

2. **Credential Management**
   - Set up Windows Credential Manager entries on production machines
   - Configure DSM Docker Secrets for Synology deployment
   - Test credential rotation procedures

3. **Performance Validation**
   - Benchmark PDF processing throughput (target: 20/min)
   - Test JotForm rate limiting with concurrent uploads
   - Validate retry logic under various failure scenarios

### Medium Priority (Next 2-4 Weeks)
1. **Operational Procedures**
   - Document service installation and configuration
   - Create troubleshooting guides for common issues
   - Establish monitoring and alerting workflows

2. **Quality Assurance**
   - Comprehensive testing of termination rule calculations
   - Validation of cross-field mapping consistency
   - End-to-end data integrity verification
   - Add student page question-level provenance hover to surface merge sources

3. **Documentation Enhancement**
   - API documentation for telemetry endpoints
   - Configuration guide for all JSON files
   - Security best practices handbook

### Low Priority (Future Iterations)
1. **Feature Enhancements**
   - Advanced analytics and reporting
   - Bulk data operations and batch management
   - Enhanced search and filtering capabilities

2. **Platform Extensions**
   - Additional data source integrations
   - Mobile app development
   - Automated quality scoring

---

## Operational Knowledge

### Log File Locking Issue - File Access Conflicts

**Discovered:** November 14, 2025  
**Severity:** HIGH - Caused upload failures due to logging conflicts  
**Status:** ✅ RESOLVED

#### Problem
Processing failed with error: "The process cannot access the file 'C:\...\logs\20251113_processing_agent.csv' because it is being used by another process."

**Symptoms:**
- PDFs failing to upload to JotForm
- Error occurs during Write-Log operations
- Multiple concurrent processes trying to write to same log file
- Log file locked by Excel, log viewer, or other processes reading the CSV

#### Root Cause
**PowerShell's `Out-File -Append` uses exclusive file locking** that blocks other processes from accessing the file while writing. This caused conflicts when:
1. **Excel or other programs** had the CSV file open for viewing
2. **Log viewer (log.html)** was reading the file via proxy server
3. **Multiple PDF processing threads** tried to write logs simultaneously
4. **Parallel processing** workers competed for log file access

#### Solution
**Replaced `Out-File -Append` with thread-safe `StreamWriter` using `FileShare.ReadWrite`** in `processor_agent.ps1`:

```powershell
# BEFORE (PROBLEMATIC):
$logEntry | Out-File -FilePath $script:LogFile -Append -Encoding UTF8
# Result: Exclusive lock, blocks all other processes

# AFTER (THREAD-SAFE):
$fileStream = [System.IO.File]::Open(
    $script:LogFile,
    [System.IO.FileMode]::Append,
    [System.IO.FileAccess]::Write,
    [System.IO.FileShare]::ReadWrite  # ← Allows concurrent reads!
)
$streamWriter = New-Object System.IO.StreamWriter($fileStream, [System.Text.Encoding]::UTF8)
$streamWriter.WriteLine($logEntry)
$streamWriter.Flush()
$streamWriter.Close()
```

**Key Changes:**
1. **Write-Log function** (lines 176-232): Added retry mechanism with exponential backoff
   - Retries: 5 attempts with 50ms, 100ms, 150ms, 200ms, 250ms delays
   - FileShare.ReadWrite allows concurrent reads while writing
   - Fallback to console if all retries fail

2. **Log file initialization** (lines 2422-2445, 2517-2545): Safe file creation
   - Uses StreamWriter with FileShare.ReadWrite
   - Retry logic for initial file creation
   - Handles race conditions when multiple workers start simultaneously

3. **Log rotation** (daily rollover): Thread-safe file creation
   - FileMode.CreateNew prevents duplicate creation
   - Retry mechanism handles conflicts gracefully

#### Benefits
- ✅ **No more access conflicts** - Excel and log viewer can read while agent writes
- ✅ **Parallel processing safe** - Multiple workers can log simultaneously
- ✅ **Graceful degradation** - Falls back to console logging if file unavailable
- ✅ **Zero data loss** - Retry mechanism ensures logs are written
- ✅ **Better error handling** - Clear warnings when log writes fail

#### Monitoring Checklist
When reviewing logs, watch for:
- ✅ No "process cannot access the file" errors
- ✅ Continuous log writing during parallel processing
- ⚠️ Warning messages if retry attempts occur (investigate cause)
- ❌ Console fallback messages (indicates persistent file lock issue)

#### Related Files
- `processor_agent.ps1` lines 176-232 - Write-Log function with retry mechanism
- `processor_agent.ps1` lines 2422-2445 - Initial log file creation
- `processor_agent.ps1` lines 2517-2545 - Daily log rotation
- `log.html` - Log viewer using proxy server for safe concurrent reads

---

### Supabase-Backed Log Mirror

**Discovered:** November 14, 2025  
**Severity:** MEDIUM - Operational observability enhancement (dual log sinks)  
**Status:** ✅ IMPLEMENTED

#### Problem
CSV log files are:
- Stored **locally per day** (`logs/YYYYMMDD_processing_agent.csv`)
- Easy for Excel / local inspection, but
- Hard to query across days, machines, or deployments.

We needed a **central, queryable log store** to support:
- Remote monitoring
- Cross-day investigations
- Future dashboards without introducing more moving parts to the agent.

#### Solution
Mirror every `Write-Log` entry to **Supabase** while keeping CSV as the primary on-disk log.

1. **Dual-sink logging in `processor_agent.ps1`**
   - `Write-Log` still writes CSV rows:
     - `Timestamp,Level,File,Message`
   - After each successful file write, it calls `Write-SupabaseLog` with the same fields.

2. **Supabase helper (`Write-SupabaseLog`)**
   - Uses values loaded from `assets/credentials.enc` via `Load-AgentSecrets`:
     - `supabaseUrl`
     - `supabaseServiceKey` (service role key, server-side only)
     - `supabaseUploadLogTable` (currently `pdf_upload_log`)
   - Sends a POST to Supabase REST API:
     - URL: `supabaseUrl/rest/v1/pdf_upload_log`
     - Headers: `apikey` + `Authorization: Bearer <serviceKey>`
     - Body (per log entry):
       - `timestamp` – ISO string, same as CSV `Timestamp`
       - `level` – log level (`INFO`, `WARN`, `ERROR`, `REJECT`, `UPLOAD`, `FILED`, ...)
       - `file` – filename / sessionkey source (same as CSV `File`)
       - `message` – sanitized log message (same as CSV `Message`)
       - `host_name` – `[Environment]::MachineName`
       - `sessionkey` – currently populated with the `file` value for quick correlation
   - Best-effort only:
     - If Supabase is misconfigured or offline, the helper silently returns after a failed HTTP call.
     - **Failure to log to Supabase never affects PDF processing.**

3. **Supabase table schema (`public.pdf_upload_log`)**

```sql
create table public.pdf_upload_log (
  jotformsubmissionid text null,
  sessionkey          text null,
  uploaded_at         timestamptz null,
  computername        text null,
  "timestamp"        timestamptz null default timezone('Asia/Singapore', now()),
  level               text null,
  file                text null,
  message             text null,
  host_name           text null,
  extra               jsonb null,
  id                  bigserial not null,
  constraint pdf_upload_log_pkey primary key (id)
);

create index if not exists idx_pdf_upload_log_timestamp on public.pdf_upload_log ("timestamp" desc);
create index if not exists idx_pdf_upload_log_level     on public.pdf_upload_log (level);
create index if not exists idx_pdf_upload_log_file      on public.pdf_upload_log (file);
```

**Key points:**
- One row **per log entry** (mirrors CSV semantics).
- Primary key is `id` (surrogate key) to allow multiple rows per file/sessionkey.
- Columns used today:
  - Agent writes: `timestamp`, `level`, `file`, `message`, `host_name`, `sessionkey`.
  - `log.html` (Supabase mode) reads: `timestamp`, `level`, `file`, `message`.
- Remaining fields (`jotformsubmissionid`, `uploaded_at`, `computername`, `extra`) are reserved for future enrichment.

4. **Frontend config and source switch (`log.html`)**

`log.html` can now read logs from either **local CSVs** or **Supabase**, controlled via `config/log_check_config.json`:

```json
{
  "$comment_logSource": "Valid values: 'local' (read CSV logs from logDirectory) or 'supabase' (read logs from Supabase pdf_upload_log)",
  "logSource": "local",
  "supabase": {
    "url": "https://<project>.supabase.co",
    "anonKey": "<ANON_PUBLIC_KEY>",
    "uploadLogTable": "pdf_upload_log",
    "scanDays": 90
  }
}
```

- **`logSource`:**
  - `"local"` (default):
    - Calendar and log table load from daily CSV files in `logDirectory`.
    - Existing proxy / File System Access API behaviours unchanged.
  - `"supabase"`:
    - Calendar builds available days from Supabase by scanning `timestamp` over the last `scanDays`.
    - **Calendar day calculation:** the log viewer derives the day from the raw `timestamp` string (`YYYY-MM-DD` portion) before falling back to JS `Date` parsing, to avoid timezone conversions shifting entries to the wrong calendar day.
    - For a selected date, `log.html` queries:
      - `select=timestamp,level,file,message`
      - `timestamp` between **00:00–24:00** local (converted via ISO range).
      - Uses paging with `limit`/`offset` (1000 rows per request) to work around the Supabase REST API's per-request max row limit and ensure all logs for that day are loaded into the viewer.
    - Results are mapped to the same in-memory structure used for CSV logs, so filtering/stats UI is identical.
- **Keys:**
  - `supabase.anonKey` is the **anon public key**, safe for browser use under RLS.
  - The **service key** used by the agent is **only** stored in `credentials.enc` and never exposed in static assets.

#### Benefits
- ✅ Centralised, queryable log history without losing local CSV convenience.
- ✅ No behavioural change for existing CSV-based workflows (`logSource = "local"`).
- ✅ Low risk: Supabase logging is optional and non-blocking.
- ✅ Future-ready: extra columns allow per-file summary or JotForm linkage without schema changes.

#### 2025-11-19 Update
- `TEMP/supabase_log_upload_test.ps1` now uses `System.UriBuilder` for Supabase duplicate-cleanup queries (`select=` fetch + `id=in(...)` deletes) to eliminate malformed-host errors encountered when appending query strings manually.

#### Related Files
- `processor_agent.ps1` – `Write-Log` and `Write-SupabaseLog` implementations
- `assets/credentials.enc` – encrypted bundle containing `supabaseUrl`, `supabaseUploadLogTable`, `supabaseServiceKey`
- `config/log_check_config.json` – log source switch and Supabase anon key for frontend
- `log.html` – calendar + log viewer with local/Supabase source selection

---

### PowerShell Parallel Processing Overhead Issue

**Discovered:** November 7, 2025  
**Severity:** CRITICAL - Caused 100% production upload failures  
**Status:** ✅ RESOLVED

#### Problem
All production PDF uploads were failing with **504 Gateway Timeout** errors after ~40 seconds, even with adaptive chunk size reduction (100 → 50 → 30 → 6 fields). The stress test script worked perfectly (even with 100 fields in 0.88s), but production uploads had 100% failure rate.

#### Root Cause
**PowerShell's `ForEach-Object -Parallel` has massive overhead** (40+ seconds) even when `-ThrottleLimit 1` forces sequential processing. The parallel processing infrastructure adds:
- Variable marshalling overhead (`$using:` scope)
- Thread synchronization delays
- Context switching penalties
- Output stream redirection costs

**Proof:**
- **Stress test (direct)**: 100 fields → **0.88 seconds** ✅
- **Test upload (simple)**: 100 fields → **1.55 seconds** ✅  
- **Production (parallel)**: 100 fields → **40+ seconds timeout** ❌

The problem was NOT JotForm's API or chunk size—it was the parallel processing wrapper causing 25x+ slowdown.

#### Solution
**Replaced `ForEach-Object -Parallel` with sequential `foreach` loop** in `processor_agent.ps1` lines 1636-1683:

```powershell
# BEFORE (SLOW):
$uploadResults = $chunks | ForEach-Object -ThrottleLimit 1 -Parallel { ... }
# Result: 40+ seconds timeout

# AFTER (FAST):
foreach ($chunk in $chunks) {
    Invoke-RestMethod -Uri $updateUri -Method Post -Body $chunk.Body ...
    Start-Sleep -Milliseconds $rateLimitMs  # 500ms between chunks
}
# Result: ~1.5s per chunk = ~6s total for 400 fields
```

**Configuration restored to optimal settings:**
- `maxFieldsPerChunk`: 100 (proven to work in 0.88s by stress test)
- `rateLimitMs`: 500 (brief pause between chunks for API courtesy)
- `maxConcurrentPdfs`: 2 (file-level parallelism is fine, chunk-level is not)

#### Retry Schedule with Adaptive Sizing

Starting from **100 fields baseline**, the system reduces on failures:

| Attempt | Chunk Size | Percentage | Expected Duration |
|---------|------------|------------|-------------------|
| 1 | 100 fields | 100% | ~1-2s per chunk |
| 2 | 50 fields | 50% | ~0.5-1s per chunk |
| 3 | 30 fields | 30% | ~0.3-0.5s per chunk |
| 4-6 | 20-5 fields | 20-5% | ~0.2-0.3s per chunk |

Total time for 400 fields at full baseline: **~6 seconds** (4 chunks × 1.5s each)

#### Performance Comparison

```powershell
# Stress Test (100 fields, direct call)
Invoke-RestMethod -Body "submission[q1]=val1&submission[q2]=val2..." 
# Result: 0.88 seconds ✅

# Test Upload Simple (100 fields, no parallel)
Invoke-RestMethod -Body $body -ContentType "application/x-www-form-urlencoded"
# Result: 1.55 seconds ✅

# Production BEFORE Fix (100 fields, ForEach-Object -Parallel)
$chunks | ForEach-Object -ThrottleLimit 1 -Parallel { Invoke-RestMethod ... }
# Result: 40+ seconds TIMEOUT ❌

# Production AFTER Fix (100 fields, sequential foreach)
foreach ($chunk in $chunks) { Invoke-RestMethod ... }
# Result: 1.5 seconds per chunk ✅
```

#### Key Takeaways

1. **PowerShell parallel processing has hidden costs** - `ForEach-Object -Parallel` adds 25x+ overhead even with `-ThrottleLimit 1`
2. **Stress tests must match production architecture** - Testing direct API calls doesn't expose parallel processing issues
3. **Sequential is faster for small batches** - When processing <10 items, sequential foreach beats parallel
4. **Variable marshalling is expensive** - Every `$using:` variable adds overhead in parallel blocks
5. **Profile before optimizing** - The assumed bottleneck (API speed) wasn't the real problem (parallel overhead)

#### Monitoring Checklist

When reviewing production logs, check for:
- ✅ Chunk upload messages appearing immediately (not 40s delay)
- ✅ Upload attempts completing in <2 seconds per chunk
- ✅ Successful filing to `schoolId/` folders
- ❌ PDFs filed to `Unsorted/` with upload failure reason

#### Related Files
- `config/jotform_config.json` - Chunk size and rate limit configuration
- `processor_agent.ps1` lines 1636-1683 - Sequential upload loop (FIXED)
- `TEMP/stress-test-100-fields.ps1` - Production payload simulation
- `TEMP/test-upload-simple.ps1` - Simple upload test (no chunking)

---

## Technical Decisions

### Architecture Choices

#### PowerShell 7+ for Processor Agent
**Decision**: Use PowerShell 7 instead of Python or Node.js  
**Rationale**:
- Native AES-GCM support via System.Security.Cryptography
- Excellent Windows integration (Credential Manager, registry, environment)
- Built-in file system watcher capabilities
- Cross-platform support (Windows + Synology via Docker)

#### Static GitHub Pages for Dashboard
**Decision**: Use static HTML/JS hosted on GitHub Pages  
**Rationale**:
- Zero hosting costs
- No server maintenance overhead
- Fast global CDN delivery
- Version control integration
- Simple deployment workflow

#### JotForm as Primary Database
**Decision**: Store submissions in JotForm instead of self-hosted DB  
**Rationale**:
- No database administration overhead
- Built-in form management and validation
- Native API with good rate limits
- Existing organizational subscription
- Reduced security attack surface

#### Flask Proxy for Local Development CORS
**Decision**: Use Flask (Python) proxy server instead of Node.js for local development  
**Date**: October 22, 2025  
**Rationale**:
- **Ecosystem Alignment**: Project already uses Python (parser/, upload.py, requirements.txt)
- **Zero New Dependencies**: Users already have Python installed for PDF parsing
- **Cross-Platform**: Flask works on Windows, Linux, macOS with consistent behavior
- **Production Simplicity**: Proxy only needed for localhost - GitHub Pages works directly
- **One-Click Startup**: Batch/shell scripts (`start_dev.bat`, `start_dev.sh`) auto-install deps and open browser
- **Auto-Detection**: JavaScript code automatically switches between proxy (local) and direct API (production)

**Alternative Considered**: Node.js + Express proxy  
**Why Rejected**: Would introduce new runtime dependency (Node.js) to an otherwise Python-based project

**Implementation**:
- `proxy_server.py` - Flask app with CORS headers, routes `/api/jotform/*` to `api.jotform.com`
- `jotform-cache.js` - Auto-detects hostname and uses `http://localhost:3000/api/jotform` locally
- `requirements.txt` - Added Flask, Flask-CORS, requests to existing pypdf dependency

#### Adaptive Batch Sizing for JotForm Fetches
**Decision**: Implement adaptive batch sizing for browser-based JotForm data fetching  
**Date**: October 22, 2025  
**Rationale**:
- **JotForm API Bug**: Large responses (1000 records = ~4.16 MB) get truncated mid-JSON at character 4,361,577
- **Dynamic Response**: Automatically reduces batch size on errors (504 timeout, JSON parse errors)
- **Gradual Recovery**: Increases batch size after consecutive successes (like processor_agent.ps1)
- **Configurable**: All settings in `config/jotform_config.json` for easy adjustment

**Discovery Process**:
- Test 1-3 (10 records, form access, basic API): ✅ Pass
- Test 4 (1000 records): ❌ Fail - JSON truncated at 4.16 MB
- Test 5 (100 records): ✅ Pass - Recommended production size

**Implementation** (mirrors `processor_agent.ps1` adaptive chunk sizing):
- `config/jotform_config.json` - Added `webFetch` section with batch size reductions `[1.0, 0.5, 0.3, 0.2, 0.1]`
- `jotform-cache.js` - Adaptive fetch loop with:
  - **Fall-off on error**: Reduces batch size by stepping through reduction array
  - **Gradual increase**: After 2 consecutive successes, increases one step
  - **Min/max bounds**: Enforces `minBatchSize: 10`, `maxBatchSize: 500`
- `TEMP/test_jotform_api.py` - Diagnostic tool to test JotForm API health (10/100/1000 record tests)

**Behavior**:
```
Start: 100 records/batch → Success
  ↓
2 successes → Try 100 (baseline)
  ↓
Error (504/truncation) → Reduce to 50 (50%)
  ↓
Success → Success → Try 100 again (gradual increase)
```

#### JotForm API: orderby/direction Parameters Ignored
**Discovery**: JotForm filter API ignores `orderby` and `direction` parameters  
**Date**: December 5, 2025  
**Impact**: E-Prime upsert was updating wrong submission (newest instead of earliest)

**Test Results**:
```
direction=ASC  → Returns: Dec 2, Dec 1 (newest first)
direction=DESC → Returns: Dec 2, Dec 1 (same order!)
```

**Solution**: Sort results client-side in PowerShell:
```powershell
# Don't trust JotForm's ordering - sort ourselves
$sorted = $filterResponse.content | Sort-Object { [datetime]$_.created_at }
$foundSubmission = $sorted | Select-Object -First 1
```

**Files Updated**:
- `processor_agent.ps1` - `Invoke-JotformUpsertByStudentId` now sorts results locally
- `PRDs/eprime_handling_prd.md` - Documented the quirk with warning

#### Set 4 Completion Logic: MF Task Exclusion
**Decision**: Exclude Math Fluency (MF) from Set 4 green light criteria  
**Date**: October 31, 2025  
**Updated**: December 9, 2025 - Generalized to config-based `hiddenTasks` approach  
**Rationale**:
- **Practical Reality**: MF is frequently incomplete or not administered, blocking Set 4 completion status
- **Core Motor Priority**: FineMotor and TGMD are the essential motor assessments in Set 4
- **User Requirement**: Schools need Set 4 to show as complete when motor assessments are done, regardless of MF status

**Implementation** (December 2025 - Config-based):
```json
// config/checking_system_config.json
{
  "hiddenTasks": ["MF"]  // Tasks to exclude from completion calculations
}
```

```javascript
// jotform-cache.js - Uses config-based filtering
const isIgnoredForIncompleteChecks = this.isTaskHidden(taskId);

// All pages filter hidden tasks from survey structure at load time
const hiddenTasks = (systemConfig?.hiddenTasks || []).map(t => t.toLowerCase());
surveyStructure.sets = surveyStructure.sets.map(set => ({
  ...set,
  sections: set.sections.filter(section => {
    const taskName = section.file.replace('.json', '').toLowerCase();
    return !hiddenTasks.includes(taskName);
  })
}));
```

**Impact**:
- Set 4 shows **green** when FineMotor + TGMD are complete, even if MF is incomplete/not started
- Applies to all drilldown pages: district, group, school, class, student
- MF is completely hidden from task columns and set completion calculations
- Configuration-driven: Add/remove tasks from `hiddenTasks` array without code changes
- Documented in `PRDs/task_completion_calculation_logic_prd.md`

**Files Modified**:
- `config/checking_system_config.json` - `hiddenTasks` array configuration
- `assets/js/jotform-cache.js` - `loadSystemConfig()`, `isTaskHidden()` methods and set status calculation
- `assets/js/checking-system-class-page.js` - Added `hiddenTasks` filtering (was missing)
- `assets/js/checking-system-school-page.js` - Uses `hiddenTasks` filtering
- `assets/js/checking-system-district-page.js` - Uses `hiddenTasks` filtering
- `assets/js/checking-system-group-page.js` - Uses `hiddenTasks` filtering
- `assets/js/checking-system-student-page.js` - Uses `hiddenTasks` filtering

### Data Flow Principles

#### Absolute Certainty Principle for Terminations
Termination values are calculated **only when mathematically certain**:
- Set `"0"` (continued) if: `correct ≥ threshold` (already passed)
- Set `"1"` (terminated) if: `correct + unanswered < threshold` (impossible to pass)
- Otherwise: **Don't set** - still possible to pass with remaining questions

This ensures we never incorrectly mark terminations based on incomplete data.

#### Upsert-by-SessionKey Pattern
All JotForm uploads use `sessionkey` as the unique identifier:
1. Search for existing submission by sessionkey
2. Update if found (excluding immutable sessionkey field)
3. Create new submission if not found (including sessionkey)
4. Write back jotformsubmissionid to local JSON

This ensures idempotency and prevents duplicate submissions.

#### Failed Upload Handling Strategy
Files with failed uploads after retry exhaustion:
- Automatically filed to `Unsorted/` folder
- Logs contain complete error details
- Empty `jotformsubmissionid` field serves as detection flag
- Operators can identify and retry manually

---

## Security Architecture

### Encryption Standards
- **Algorithm**: AES-256-GCM (Galois/Counter Mode)
- **Key Derivation**: PBKDF2-SHA256, 100,000 iterations, 16-byte salt
- **IV Generation**: 12-byte random IV per encryption operation
- **Bundle Format**: `[16B salt][12B IV][N-B ciphertext][16B auth tag]`

### Protected Assets
1. **credentials.enc** - API keys, system password, service tokens
2. **coreid.enc** - Student ID mappings (Core ID → School, Class, Name)
3. **schoolid.enc** - School metadata (ID → Name, District, Group)
4. **classid.enc** - Class mappings (Class ID → Actual Class Name)

### Access Controls
- **System Password**: Stored in OS-protected keystores (Windows Credential Manager / DSM Docker Secrets)
- **In-Memory Only**: Secrets decrypted on demand, never written to disk in plaintext
- **Buffer Clearing**: Cryptographic buffers wiped after use
- **HTTPS Only**: All API communications over TLS
- **Loopback Binding**: Telemetry API restricted to localhost

### Credential Rotation Procedures
Documented in `PRDs/processor_agent_runbook_prd.md`:
1. Generate new credentials.json with updated keys
2. Encrypt using latest systemPassword
3. Deploy new credentials.enc to production
4. Restart processor agent services
5. Verify successful decryption in logs
6. Archive old credentials with timestamp

---

## Configuration Reference

### Agent Configuration (`config/agent.json`)
```json
{
  "oneDrive": {
    "autoDetect": true,
    "relativePath": "\\The Education University of Hong Kong\\...",
    "fallbackRoot": "C:\\Users\\KeySteps"
  },
  "watchPath": "./incoming",
  "stagingPath": "./processing",
  "filingRoot": "",
  "unsortedRoot": "./Unsorted",
  "logDirectory": "./logs",
  "queueManifest": "./queue_manifest.json",
  "hostIdentity": {
    "computerNameFallback": true,
    "overrideFile": "./config/host_identity.json"
  },
  "telemetry": {
    "endpoint": "http://localhost:48500",
    "enableSse": true,
    "apiKey": ""
  },
  "worker": {
    "maxConcurrent": 2,
    "perMinuteQuota": 60,
    "pollIntervalSeconds": 5
  },
  "validation": {
    "debounceWindowSeconds": 15,
    "sizeDriftBytes": 1024,
    "metadataRetries": 5,
    "metadataRetryDelaySeconds": 10,
    "requireComputerNumber": true
  }
}
```

**Key Configuration Options:**

- **`validation.requireComputerNumber`** (boolean, default: `true`)  
  **Purpose**: Controls whether computer number tracking is mandatory for PDF processing
  
  - **When `true` (Enforced - Default)**:
    - PDFs without `.meta.json` file containing computer number are **rejected**
    - Filed to `Unsorted/` folder for manual review
    - **No JotForm upload** occurs
    - Log message: `metadata_not_found: ... (enforcement enabled)`
    
  - **When `false` (Optional)**:
    - PDFs without `.meta.json` file still **proceed to processing**
    - Computer number field in JotForm will be `null`/empty
    - **JotForm upload still occurs**
    - Log message: `metadata_not_found: ... (proceeding without computer number - enforcement disabled)`
  
  **Use Cases**:
  - Set to `true`: Production environments requiring audit trail
  - Set to `false`: Testing environments, development, or when computer tracking is not needed
  
  **Upload Paths**:
  - **Web Uploader (`upload.html`)**: Always requires PC number (strict enforcement)
  - **Manual Upload (OneDrive/Teams/SharePoint)**: Subject to `requireComputerNumber` toggle
    - Users can place PDFs directly in OneDrive folder without using web uploader
    - Processor agent applies configured enforcement policy
  
  **Related Components**:
  - `upload.html`: Always enforces PC number requirement (cannot bypass)
  - `processor_agent.ps1`: Retries metadata file (5 attempts, 10s intervals), then applies enforcement logic

### JotForm Configuration (`config/jotform_config.json`)
```json
{
  "maxConcurrent": 2,
  "batchSize": 25,
  "perMinuteQuota": 120,
  "retryScheduleSeconds": [10, 30, 90],
  "burstCooldownSeconds": 60
}
```

### Host Identity Override (`config/host_identity.json`)
```json
{
  "computerno": "095",
  "hostName": "KS095"
}
```
*Note: Optional - used for Synology/containers where $env:COMPUTERNAME unavailable*

---

## Performance Metrics

### Target KPIs
- **Processing Throughput**: ≥ 20 PDFs/minute (validated environment)
- **Upload Success Rate**: ≥ 99% (including retries)
- **Validation Pass Rate**: ≥ 95% (well-formed submissions)
- **Dashboard Latency**: < 5 seconds (near real-time updates)
- **Queue Recovery Time**: < 60 seconds (after service restart)

### Current Status
- **Processor Agent**: ✅ Production-ready
- **Upload Interface**: ✅ Functional
- **Checking System**: ✅ Fully operational
- **OneDrive Integration**: ✅ Auto-detection working
- **JotForm API**: ✅ Upsert workflow stable
- **Telemetry API**: ✅ Endpoints responding

---

## Operational Procedures

### Daily Operations
1. **Morning Health Check**
   - Verify processor agent service is running
   - Check OneDrive sync status (green checkmark)
   - Review dashboard for overnight uploads
   - Clear any files in `Unsorted/` folder

2. **Upload Processing**
   - Monitor queue via telemetry API or status JSON
   - Investigate rejections with detailed logs
   - Retry failed uploads after fixing issues
   - Verify data completeness in Checking System

3. **End-of-Day Review**
   - Check upload success rates and error patterns
   - Review daily CSV logs for anomalies
   - Back up queue manifest and critical logs
   - Update operational log with issues/resolutions

### Weekly Maintenance
- Review and archive old log files
- Check disk space on filing directories
- Validate encrypted asset integrity (SHA-256 hashes)
- Test credential rotation procedures (dry run)

### Monthly Tasks
- Performance benchmarking and trend analysis
- Security audit of access logs
- Update documentation for process changes
- Stakeholder reporting on completion rates

---

## Troubleshooting Guide

### Common Issues

#### Agent Not Processing Files
**Symptoms**: Files accumulate in `incoming/` folder  
**Diagnosis**:
1. Check service status: `Get-Service -Name "4SetProcessor"`
2. Verify OneDrive sync: Look for green checkmarks
3. Review logs: `logs/YYYYMMDD_processing_agent.csv`

**Solutions**:
- Restart service if hung
- Verify OneDrive path resolution in logs
- Check file permissions on processing directories

#### Upload Failures
**Symptoms**: Files moved to `Unsorted/` folder  
**Diagnosis**:
1. Check JSON for empty `jotformsubmissionid`
2. Search logs by sessionkey for error details
3. Verify JotForm API rate limits not exceeded

**Solutions**:
- Wait for rate limit cooldown (60+ seconds)
- Retry manually after fixing data issues
- Check network connectivity to JotForm API

#### Validation Rejections
**Symptoms**: Files rejected with reason codes  
**Diagnosis**:
1. Review rejection reason in logs
2. Check PDF filename format
3. Verify student ID exists in coreid.enc

**Common Rejection Codes**:
- `pdf_extraction_failed` - Corrupted PDF or parsing error
- `coreid_missing_in_mapping` - Student not in database
- `coreid_schoolid_mismatch` - School IDs don't match

**Solutions**:
- Re-scan PDF with correct settings
- Add missing student to coreid.enc and re-encrypt
- Verify correct school ID in PDF form

#### Checking System Mismatches
**Symptoms**: Orange warning icons (⚠️) in dashboard  
**Diagnosis**:
1. Compare "Recorded" vs "Calculated" termination values
2. Review actual question responses
3. Check for missing or incorrect answer data

**Solutions**:
- If calculation is correct: Update PDF and re-upload
- If data is missing: Complete assessment and re-submit
- If edge case: Document and escalate to development team

---

## Development Guidelines

### Code Standards
- **PowerShell**: Follow PSScriptAnalyzer recommendations
- **JavaScript**: ES6+ with strict mode enabled
- **Python**: PEP 8 compliant, type hints where applicable
- **HTML/CSS**: Semantic markup, Tailwind CSS utilities

### Test Environment Isolation
**CRITICAL REQUIREMENT**: Test environment files **must always be isolated** from production checking system files.

#### Isolation Principles
1. **Separate Test Files**: Test pages and utilities must use test-specific versions of shared modules
   - Example: `TEMP/task-validator-test.js` instead of `assets/js/task-validator.js`
   - Example: `TEMP/jotform-cache-test.js` instead of `assets/js/jotform-cache.js`

2. **Dedicated Test Assets**: All supporting files (JSON, configuration) must be copied to test directories
   - Test task definitions: `TEMP/assets/tasks/*.json` (16 files)
   - Test mappings and configurations isolated in `TEMP/` folder

3. **No Production File Modification**: Test code must never modify or depend on production checking system files
   - Prevents accidental corruption of production validation logic
   - Ensures test changes don't impact live monitoring dashboards
   - Maintains clear separation of concerns

4. **Documentation Requirements**: All test-specific files must be clearly marked
   - Comments indicating "TEST VERSION" at the top of files
   - README files explaining the isolation strategy
   - Maintenance instructions for syncing test files when production changes

#### Implementation Example
```javascript
// ❌ INCORRECT - Test file loading production validator
<script src="../assets/js/task-validator.js"></script>

// ✅ CORRECT - Test file loading isolated test validator
<script src="task-validator-test.js"></script>
```

#### Benefits
- **Safety**: Production system remains stable during testing
- **Independence**: Tests can be modified without affecting production
- **Clarity**: Clear distinction between test and production code
- **Maintainability**: Easier to track test-specific changes

### Testing Requirements
- Unit tests for all data transformation functions
- Integration tests for end-to-end pipeline flows
- Security tests for encryption/decryption workflows
- Performance tests for throughput benchmarks
- **Test isolation compliance**: All test files must follow isolation principles above

### Git Workflow
- Feature branches: `feature/description`
- Bug fixes: `fix/issue-number`
- Documentation: `docs/topic`
- Pull requests require review before merge
- Commit messages follow conventional commits format

### Deployment Process
1. Test changes in development environment
2. Update relevant documentation (PRDs, README, Agent)
3. Create pull request with detailed description
4. Code review by at least one team member
5. Merge to main branch
6. Deploy to production with rollback plan
7. Monitor for 24 hours post-deployment

---

## Support & Resources

### Documentation
- **PRDs/** - Detailed product requirement documents (consolidated location)
- **README.md** - Quick start guide and technical overview
- **AGENTS.md** - Development roadmap and strategic planning
- **TEMP/README.md** - Test files documentation and usage guide

### Key PRD Files
- `overview_prd.md` - System architecture and user journeys
- `processor_agent_prd.md` - Agent specification and requirements
- `checking_system_prd.md` - Quality assurance, validation rules, and implementation notes
- `jotform_qualtrics_integration_prd.md` - API integration, cache system, and data merging
- `data_security_prd.md` - Encryption and credential management
- `termination-rules.md` - Assessment termination logic
- `upload_monitoring_prd.md` - Upload failure detection and retry
- `qualtrics_implementation_plan.md` - Qualtrics features implementation status
- `calculation_bible.md` - Complete calculation and validation reference
- `guideline_prd.md` - User guide system design specification (spotlight, modals, tooltips)

### Codebook (Statistical Analysis Reference)
Located in `assets/tasks/`, the codebook CSV files provide comprehensive variable documentation for statistical analysis:

- `codebook_ERV.csv` - English Reading Vocabulary (ERV) variable reference

**Codebook Structure** (18 columns):
| Column | Description |
|--------|-------------|
| `variable_code` | Variable name as uploaded to JotForm (e.g., `ERV_Q1`) |
| `jotform_qid` | JotForm Question ID number |
| `task` | Task abbreviation (e.g., `ERV`, `CM`, `CWR`) |
| `set` | Assessment set number (1-4) |
| `question_type` | Technical type (image-choice, radio, text, etc.) |
| `item_type` | Semantic type (vocabulary, practice, termination_flag, score, metadata) |
| `question_label_en` | English question text or vocabulary word |
| `valid_values` | Allowed response values (e.g., "1,2,3,4" or "0,1") |
| `correct_answer` | Correct response value for scored items |
| `data_type` | Data type (categorical, numeric, datetime, boolean) |
| `scale_level` | Measurement scale (nominal, ordinal, interval, ratio) |
| `termination_stage` | Stage number if part of termination logic (1-4) |
| `termination_type` | Termination rule type (stage-based, consecutive, threshold, timeout, none) |
| `termination_field` | Associated termination variable (e.g., `ERV_Ter1`) |
| `termination_threshold` | Pass threshold (e.g., 5 = need ≥5 correct to pass) |
| `is_practice` | TRUE if practice item (not scored) |
| `is_scored` | TRUE if contributes to task score |
| `notes` | Additional context and rules |

**Usage**:
- Import into SPSS, R, or Python for variable labeling
- Reference for valid value ranges and data types
- Documentation of termination rules per question
- Cross-reference JotForm QIDs with variable names

### User Guides (Consolidated October 2025)
All user guides moved to PRDs folder for centralized documentation:
- `guideline_prd.md` - User guide system design and implementation patterns
- `checking_system_user_guide_prd.md` - Checking system operational guide
- `assessment_uploader_user_guide_prd.md` - Upload interface usage
- `qualtrics_tgmd_user_guide_prd.md` - Qualtrics integration guide
- `data_conflicts_user_guide_prd.md` - Data conflict resolution

**Note**: Documentation consolidation (October 2025) moved all implementation summaries, bug fix documentation, and historical notes from TEMP folder into authoritative PRD files. TEMP now contains only active test files and test documentation.

### External References
- JotForm API Documentation: https://api.jotform.com/docs/
- PowerShell 7 Docs: https://docs.microsoft.com/powershell/
- Synology DSM Guide: https://www.synology.com/en-us/dsm

### Contact & Escalation
- **Development Team**: Technical issues and feature requests
- **Security Engineering**: Credential issues and security incidents
- **Project Maintainers**: Strategic decisions and priority changes
- **End Users**: Training requests and operational support

---

## Changelog

### October 2025 - Initial Release & Phase 3 Enhancements
- Completed core processor agent with full pipeline
- Deployed checking system with 5-level drilldowns
- Implemented upload interface with drag-and-drop
- Established security architecture and encryption standards
- Created comprehensive documentation suite

**Phase 3 Enhancements (October 22, 2025):**
- ✅ **Data Overwrite Protection** (Configurable): Implemented optional conflict detection for update operations
  - Prevents accidental data corruption from re-uploaded PDFs when enabled
  - Can be toggled via `config/agent.json` → `dataProtection.enableDataOverwriteProtection` (default: `true`)
  - Exception list allows administrative fields (student-id, child-name, etc.) to be updated
  - Protected fields (assessment answers) reject overwrites of existing non-empty values when enabled
  - Conflicts logged with `DATA_OVERWRITE_DIFF` level and filed to Unsorted/ when protection is enabled
  - When disabled: Allows full data overwrites, relying on human due diligence
  - Comprehensive test suite: `tools/test_data_overwrite_protection.ps1` (10/10 tests passing)
  - Performance impact: < 1% (uses existing search result, no additional API calls)
- ✅ **Radio_text Validation Logic**: Implemented priority-based scoring for ToM questions
  - If correct answer picked → CORRECT (text field ignored as mistyped input)
  - If other option OR text filled → INCORRECT
  - Comprehensive test suite with 100% pass rate
- ✅ **_TEXT Field Display Support**: New feature for Theory of Mind questions
  - Display text answers with smart status indicators (N/A, Answered, Not answered, —)
  - "Not answered" status ONLY appears when radio answer is incorrect
  - _TEXT fields NEVER counted in completion percentage
  - 4-state status system with contextual display
- ✅ **Gender Branching Verification**: Documented across all drilldown pages
  - TEC_Male/TEC_Female conditional logic verified
  - Gender normalization (M→male, F→female) across all hierarchy levels
- ✅ **Adaptive Batch Sizing**: Comprehensive documentation
  - JotForm API bug documentation (4.16 MB truncation)
  - Fall-off on error, gradual recovery algorithm
  - Configuration parameters and testing methodology
- ✅ **Calculation Bible Updates**: Major documentation enhancements
  - Added 5 new sections (~350 lines)
  - Radio-text validation with examples
  - Text display fields with status rules
  - Gender branching implementation
  - JotForm caching architecture
  - Adaptive batch sizing algorithm
- ✅ **Test Scripts**: Created comprehensive validation test suite
  - `TEMP/test_radio_text_validation.py` - 6/6 tests passing
  - `TEMP/test_text_field_display.py` - 6/6 tests passing
  - Visual mockup: `TEMP/text_field_display_example.html`

**Documentation Consolidation (October 25, 2025):**
- ✅ **User Guide Migration to PRDs**: Consolidated all root-level USER_GUIDE_*.md files into PRDs folder
  - Moved 4 user guide files: checking_system, uploader, qualtrics_tgmd, conflicts
  - Renamed following PRD naming convention: `*_user_guide_prd.md`
  - Updated all cross-references in PRD files
  - Root level now contains only README.md and AGENTS.md (as intended)
- ✅ **Merge Strategy Documentation**: Corrected outdated "Qualtrics priority" references
  - Updated to reflect actual implementation: "earliest non-empty wins" based on timestamps
  - Aligned with changes from PRs #90-#97
  - Consistent across all documentation files
- ✅ **PRD Verification**: Confirmed all PRD files reflect changes from issues #90-#97
  - Grade detection (K1/K2/K3) ✅
  - TGMD matrix-radio scoring ✅
  - Complete Qualtrics data extraction (632 fields) ✅
  - Unique Core ID filtering ✅
- ✅ **TEMP Folder Cleanup** (Issue #108):
  - Removed 18 redundant markdown files from TEMP folder (implementation summaries, bug docs, historical PR/issue summaries)
  - Consolidated information into authoritative PRD files:
    - `jotform_qualtrics_integration_prd.md` - Added comprehensive cache system documentation
    - `checking_system_prd.md` - Added implementation notes covering all major fixes and enhancements
  - Created `TEMP/README.md` to document remaining test files and their purpose
  - Retained only essential test documentation (3 MD files vs 19 before)
  - Result: Cleaner TEMP folder with only active test files, improved documentation discoverability

**Grade-Aware Data Display Fixes (December 5, 2025):**
- ✅ **Student Page Grade Fallback Bug**: Fixed issue where K3 data was displayed when K1 was selected
  - Root cause: When no K1 data existed in cache, page fell back to JotForm API which returned K3 data
  - Fix: When a specific grade is selected but no data exists, show "No Data" instead of falling back to API
  - File: `assets/js/checking-system-student-page.js` - Modified fallback logic in `fetchAndPopulateJotformData()`
- ✅ **Validation Cache coreId Lookup**: Fixed matching for Qualtrics-merged submissions
  - Root cause: Validation cache lookup used `answers['4']` for student ID, but Qualtrics data has `coreId` at root level
  - Fix: Check `submission.coreId` first, then fall back to `answers['4']`
  - File: `assets/js/jotform-cache.js` - Modified `buildStudentValidationCache()` matching logic
- ✅ **Cache Key Format Normalization**: Fixed C-prefix handling in composite cache keys
  - Added support for both `C10352_K3` and `10352_K3` formats in cache lookup
  - Ensures consistent matching between student list and cached validation data

**Console Logging Cleanup (December 5, 2025):**
- ✅ **Removed Verbose Debug Logs**: Cleaned up excessive `console.log()` statements across checking system
  - **Purpose**: Reduce browser console noise; improve production debugging experience
  - **Files cleaned**:
    - `assets/js/cache-validator.js` - Removed cache structure validation debug logs
    - `assets/js/cache-manager-ui.js` - Removed sync modal and status update logs
    - `assets/js/checking-system-class-page.js` - Removed initialization and view mode logs
    - `assets/js/checking-system-data-loader.js` - Removed data loading debug output
    - `assets/js/checking-system-district-page.js` - Removed district aggregation logs
    - `assets/js/checking-system-group-page.js` - Removed group aggregation logs
    - `assets/js/checking-system-preferences.js` - Removed preference save/restore logs
    - `assets/js/data-merger.js` - Removed merge operation debug output
    - `upload.html` - Removed PC detection and File System API logs
    - `log.html` - Removed calendar render and Supabase query logs
  - **Retained**: Essential `console.error()` and `console.warn()` for error reporting
  - **Impact**: Cleaner browser console; easier to identify actual errors in production

**Interactive User Guide System (October 27, 2025):**
- ✅ **Guideline & Spotlight System**: Comprehensive interactive learning system for all user guide pages
  - Dynamic SVG-based spotlight masking for highlighting UI elements
  - Modal system with flat hierarchy pattern for z-index management
  - Tooltip system with contextual information
  - Comprehensive design specification: `PRDs/guideline_prd.md`
  - Implementation files:
    - `assets/js/spotlight-system.js` - Core spotlight functionality
    - `assets/css/spotlight-system.css` - Spotlight styling
    - `assets/js/spotlight-system-README.md` - Technical documentation
  - Guide pages using the system:
    - `quick_start_guide.html` - Interactive quick start with spotlight
    - `user_guide_checking_system.html` - Checking system guide
    - `user_guide_uploader.html` - Uploader interface guide
    - `user_guide_qualtrics.html` - Qualtrics integration guide
    - `user_guide_conflicts.html` - Data conflicts guide
    - `guide_homepage.html` - Guide navigation hub

### Future Updates
This section will track major system updates, feature additions, and architectural changes as they occur.

- **2025-12-08**: Fixed Checking System “By Missing” views to retain class and grade context when toggling missing-data filters.

---

## Appendix

### Glossary
- **Session Key**: Unique identifier for each assessment submission (`xxxxx_YYYYMMDD_HH_MM`)
- **Core ID**: Student identifier format (`C#####`)
- **School ID**: School identifier format (`S###`)
- **Termination**: Early assessment exit based on threshold rules
- **Upsert**: Update existing record or insert new if not found
- **Debounce**: Delay processing until file modifications stabilize

### Acronyms
- **AES-GCM**: Advanced Encryption Standard - Galois/Counter Mode
- **API**: Application Programming Interface
- **CSV**: Comma-Separated Values
- **DSM**: DiskStation Manager (Synology OS)
- **IV**: Initialization Vector
- **JSON**: JavaScript Object Notation
- **PBKDF2**: Password-Based Key Derivation Function 2
- **PDF**: Portable Document Format
- **PRD**: Product Requirements Document
- **QID**: Question ID (JotForm field identifier)
- **SHA**: Secure Hash Algorithm
- **SOP**: Standard Operating Procedure
- **TLS**: Transport Layer Security

---

**Document Status**: Active - Regularly updated to reflect current priorities and system state  
**Next Review Date**: November 2025 (Monthly review cycle)
