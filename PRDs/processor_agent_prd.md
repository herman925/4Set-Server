# 4set Web Successor — Processor Agent PRD

> **Documentation Status:** Updated (2025-10-16) to replace legacy TEMP/ documentation references with current implementations. See `DEPRECATIONS.md` for migration details.

## Purpose
Define the autonomous Windows-based agent that ingests PDFs from a watched OneDrive folder, executes the validation/parsing/merge/upload pipeline, and publishes telemetry for the monitoring web app.

## Goals
- Provide an unsupervised processing loop that reacts to new PDFs without manual interaction.
- Guarantee parity with legacy validation outcomes while operating continuously in the background.
- Surface structured status events to the web dashboard in near real time.
- Protect credentials and mapping files while operating on an end-user workstation.

## System Context
- **Primary host (Windows)**: Windows 10/11 Enterprise workstation or server with OneDrive sync client installed. Agent resolves the actual OneDrive root at runtime (environment variables `OneDriveCommercial`/`OneDrive`, registry `HKCU\Software\Microsoft\OneDrive\Commercial`, falling back to `HKLM\Software\Microsoft\OneDrive` when per-user keys are unavailable), then appends the configured relative path from `config/agent.json` (default: `\The Education University of Hong Kong\o365grp_KeySteps@JC - General\98 - IT Support\04 - Homemade Apps\4Set-Server`). Service accounts must have an initial OneDrive sign-in so at least one of these discovery mechanisms succeeds.
  - **OneDrive Configuration**: `config/agent.json` specifies `oneDrive.relativePath` which is appended to the detected OneDrive root. Supports `autoDetect: false` with `fallbackRoot` for manual configuration.
  - **Computer Number Detection**: Extracts `computerno` from `$env:COMPUTERNAME` (e.g., KS095 → 095). Supports override via `config/host_identity.json` for non-standard naming or container deployments.
- **Secondary host (Synology DS923+)**: DSM 7.x running Docker or Container Manager with Synology Cloud Sync mapped to the same OneDrive folder (e.g., `/volume1/onedrive/...`). Hardware: AMD Ryzen R1600 (dual-core 2.6 GHz, boost 3.1 GHz) with 4 GB DDR4 ECC (expandable to 32 GB).
  - **Container Configuration**: Mount `config/host_identity.json` with `computerno` and `hostName` explicitly set, as `$env:COMPUTERNAME` is unavailable in containers.
- **Upstream storage**: Microsoft 365 OneDrive for Business, synchronised via OneDrive desktop client (Windows) or Synology Cloud Sync (DSM).
- **Downstream services**: Jotform proxy (per `PRDs/pdfpipeline_prd.md`), encrypted mapping assets (`assets/*.enc`), monitoring web app (GitHub Pages or local UI).
- **Upload Interface**: `upload.html` provides drag-and-drop PDF upload targeting the watch folder. Browser limitations require Electron wrapper or backend endpoint for production file writes.

## Functional Requirements
1. **Folder Watcher**
   - Detect file creation, updates, and deletions within the configured directory, including subfolders (optional toggle).
   - Debounce partially-synced uploads using adaptive heuristics: verify file locks, require size deltas under 1 KB across a 15-second window, or short-circuit when OneDrive reports `SyncStatus = UpToDate`.
   - Immediately relocate arrivals into a local staging area (`/processing`) so the synced watch folder returns to empty state after each pickup.

2. **Validation Pipeline**
   - Reuse the two-phase gate from `PRDs/pdfpipeline_prd.md`:
     - Phase 1 filename reconstruction (`xxxxx_YYYYMMDD_HH_MM.pdf`).
     - Phase 2 PDF field extraction and mapping lookup.
   - Emit structured events (`Queued`, `Validating`, `Rejected`, with reason codes) to the telemetry channel.

3. **Parsing & Merge**
   - Execute WebAssembly or native Python modules (ported from legacy data tool) in worker threads.
   - Maintain autosave JSON with `sessionkey`, computed answers, enrichment metadata.
   - Persist intermediate data in a secure temp directory cleared after completion.

4. **Upload Engine**
   - Batch requests to the Jotform proxy with retries/backoff (3 attempts, jitter).
   - On success, apply filing protocol (implemented in `processor_agent.ps1`) and move original artefacts into the OneDrive hierarchy `...\97 - Project RAW Data\PDF Form Data\{schoolId}` with collision-safe naming; log the `jotformsubmissionid`.
   - On failure, relocate files to `PDF Form Data\Unsorted\` with diagnostic JSON and queue remediation telemetry.
   - Instrument each processed file with the host identifier captured at validation time: on Windows read `COMPUTERNAME`; on Synology/container deployments require `agent.json`/environment `hostName` override. Persist the resolved value in telemetry events and include it in the payload posted to the Jotform proxy using the mapped field `computerno` (ID `647`) from `assets/id_mapping/jotformquestions.json`.

6. **Jotform Upload Configuration**
   - Read `config/jotform_config.json` to control rate limits, batching, and retry cadence without code changes (parity with legacy desktop uploader).
   - Schema:
     ```json
     {
       "maxConcurrent": 2,
       "batchSize": 25,
       "perMinuteQuota": 120,
       "retryScheduleSeconds": [10, 30, 90],
       "burstCooldownSeconds": 60
     }
     ```
   - Defaults configured in `config/jotform_config.json`: two concurrent uploads, ~120 ops/min pacing, 25-record batches, and exponential retries. See `PRDs/jotform-integration.md` for full configuration reference.
   - Agent enforces `maxConcurrent` worker uploads, splits payloads using `batchSize`, sleeps when reaching `perMinuteQuota`, and applies `retryScheduleSeconds` plus `burstCooldownSeconds` when HTTP 429/5xx responses occur.

5. **Telemetry & API**
   - Expose a lightweight local API (e.g., HTTP on `localhost:48500`) delivering:
     - Current queue snapshot (per-file stage, timestamps, retry count).
     - **Upload status summary** (`/api/upload-status`): Total files, success count, failed uploads, pending retries.
     - **Failure details**: List of files with empty `jotformsubmissionid` after retry exhaustion, including error messages and attempt counts.
     - Recent event stream (Server-Sent Events or WebSocket) for real-time monitoring.
     - Health information (last successful run, service uptime, OneDrive sync status).
   - **Alternative for static hosting (GitHub Pages)**: Write `status/upload_status.json` every 60 seconds with aggregated upload statistics, failures, and pending retries. File can be synced via OneDrive and served as static JSON.
   - Persist daily CSV audit logs named `YYYYMMDD_processing_agent.csv`, rotating automatically at midnight while retaining prior files for historical analysis. Each row captures `Timestamp, Level, File, Message` to tie telemetry back to individual PDFs.
   - See `PRDs/upload_monitoring_prd.md` for detailed upload failure detection, retry logic, and dashboard integration options.

## Non-Functional Requirements
- **Reliability**: Recover gracefully on restart by replaying the processing queue and resuming unfinished files.
- Maintain a durable queue manifest (e.g., `%ProgramData%\\4set\\queue_manifest.json`) that records each file's staging path, current stage, and last checkpoint so restarts can reconcile in-flight work.
- **Performance**: Process at least 20 PDFs per minute on a quad-core i5 with 8 GB RAM when documents pass validation.
- **Security**: Decrypt credential/mapping files only in memory; purge buffers when tasks complete. Protect API with loopback-only binding and optional token authentication for remote dashboards.
- **Configurability**: Provide JSON config files (`config/agent.json`, `config/host_identity.json`) defining OneDrive paths, watched folders, concurrency, log retention, and proxy endpoints. Support hot reload on file change or require controlled restart.
  - **OneDrive Detection Schema** (`config/agent.json`):
    ```json
    {
      "oneDrive": {
        "autoDetect": true,
        "relativePath": "\\The Education University of Hong Kong\\o365grp_KeySteps@JC - General\\98 - IT Support\\04 - Homemade Apps\\4Set-Server",
        "fallbackRoot": "C:\\Users\\[Username]"
      }
    }
    ```
    Detection strategy: `$env:OneDriveCommercial` → `$env:OneDrive` → Registry `HKCU/HKLM` → `fallbackRoot`. Append `relativePath` to detected root.
  - **Host Identity Override** (`config/host_identity.json` - optional):
    ```json
    {
      "computerno": "095",
      "hostName": "KS095"
    }
    ```
    Used for Synology/containers where `$env:COMPUTERNAME` unavailable. Overrides automatic extraction from computer name.
- **Updatability**: Support silent updates (e.g., MSI or auto-updater) without disrupting the queue.

## Operational Workflow
1. Service starts on system boot or scheduled task trigger (Windows Service, Task Scheduler, or DSM container autostart).
- Loads encrypted assets using locally stored credentials (Windows Credential Manager/DPAPI, DSM secrets, or encrypted env vars) without requiring interactive password entry.
- Watches the synchronized folder for new PDFs; when detected, adds to queue and notifies dashboard.
- Executes validation → parsing → merge → upload stages with telemetry events.
- Applies filing protocol move into `PDF Form Data` hierarchy and emits completion events; rejected items remain in review/`Unsorted` folder with diagnostics.
- Periodically reports heartbeat, sync latency, and disk usage to the dashboard.
- Supervisory heartbeat verifies watcher activity; if no filesystem events or queue progress are observed within the guard interval, emit `watcher_stalled` telemetry and restart the watcher component.

## Credential Storage & Secrets
- **Windows 10/11 Enterprise**
  - Keep `assets/credentials.enc` as the consolidated encrypted bundle for system password, mapping keys, and proxy tokens.
  - Store the bundle's master decryption key in Windows Credential Manager (Generic Credential) under the service account; agent retrieves it via GUID at startup and unlocks `credentials.enc` in-memory.
  - Bundle payload (AES-256-GCM + PBKDF2 as derived in the agent) must include:
    - `supabaseUrl`
    - `supabaseKey` (publishable key)
    - `supabaseProjectId`
    - `supabaseTable`
    - `uploadTable`
    - `qualtricsDatacenter`
    - `qualtricsSurveyId`
    - `systemPassword` (passphrase used to decrypt survey mappings)
    - `jotformApiKey`
    - `jotformFormId`
  - Rotation: update `credentials.enc`, write the new master key to Credential Manager (`cmdkey`/PowerShell), restart the agent.
- **Synology DS923+**
  - Mount `credentials.enc` into the container via DSM Docker Secrets (read-only) and supply the master key as a second secret or encrypted environment variable.
  - Agent loads both secrets at startup, decrypts in-memory, and purges buffers after use.
  - Rotation: upload updated secret files in DSM, redeploy/restart container to pick up new values.

## Host Design Considerations
- **Windows**
  - Preferred for highest throughput; native file notifications via Win32 ReadDirectoryChangesW.
  - Supports GPU/AVX acceleration if parsing stack leverages native libraries.
- **Synology DS923+**
  - Dockerised agent listens on loopback/host network, binds to `/volume1/onedrive` for file I/O.
  - Use inotify-based watcher (fswatch/libinotify) with polling fallback (3000 ms) because Synology Cloud Sync writes temp files before final rename.
  - Cap worker pool to available cores (2 physical / 4 threads); expect ~10 PDFs/min baseline, expandable with RAM upgrade.

### Optional Enhancements (Future)
- Lightweight Windows tray or WinUI companion could surface local status, secret rotation reminders, and quick log access. Defer until operators express need; ensure parity with containerized deployments before implementation.
- Shared rate limiter across agents remains a deferred safeguard: current deployment plans assume a single host consuming the Jotform proxy quota, but if additional watchers (e.g., Windows + Synology) operate simultaneously the limiter will coordinate global throughput. Keep the feature flagged in configuration so it can be enabled quickly when scaling beyond one host.

## Monitoring & Alerts
- Integrate with Windows Event Log for high-severity errors.
- Optional email/Teams webhook notifications for repeated failures (`coreid_schoolid_mismatch`, proxy downtime, disk full).
- Dashboard consumes the telemetry API to visualise live status, history, and retry controls.

- Package as Windows service (PowerShell `New-Service`, NSSM, or native installer) or containerised daemon for NAS platforms (Docker on Synology DSM, etc.).
- Require OneDrive sync client (or compatible WebDAV/Graph sync) to be signed in and running; include preflight check verifying folder availability and latency.
- Document firewall exceptions for local API and outbound HTTPS to proxy endpoints.
- For NAS deployments, evaluate CPU/RAM capacity (e.g., DSM with Intel Celeron/i3 for WebAssembly workloads) and ensure container has access to encrypted assets.

## Open Questions
- Should we support multi-tenant monitoring (multiple watched folders) within a single agent instance?
- How do we authenticate remote dashboards if the monitoring UI is hosted outside the local machine?
- What mechanism should trigger auto-updates (Microsoft Intune, custom updater, manual installer)?
- Which NAS models (CPU/RAM profiles) meet performance expectations for parsing workloads, and do we require hardware acceleration?
