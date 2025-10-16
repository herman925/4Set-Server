# 4set Web Successor — PDF Upload Pipeline PRD

## Purpose
Document the autonomous PDF processing pipeline executed by the Windows-based processor agent, detailing ingestion, validation, parsing, merge, upload, and the telemetry surfaced to the monitoring dashboard.

## Goals
- Deliver an unsupervised workflow that reacts to new PDFs in the synced OneDrive folder without manual triggers.
- Preserve data integrity through strict yet lenient validation rules inherited from the legacy Data Tool.
- Provide structured telemetry so the web dashboard can visualise queue state, progress, and failures.
- Maintain the AES-256-GCM security model for credentials and mapping assets while operating on end-user hardware.

## Prerequisites
- Processor agent installed on Windows host, server, or supported NAS with OneDrive desktop client (or equivalent sync) running and synced to the configured uploads folder.
- Encrypted assets (`credentials.enc`, `coreid.enc`, `schoolid.enc`, `classid.enc`) accessible to the agent for in-memory decryption using OS-protected secrets or configuration files.
- Network connectivity to serverless proxy endpoints handling Jotform API operations.

## Watch Path
- **Windows host**: `C:\Users\<username>\The Education University of Hong Kong\o365grp_KeySteps@JC - General\97 - Project RAW Data\Uploads` (configurable via agent settings).
- **Synology DS923+**: `/volume1/onedrive/Uploads` (or chosen Cloud Sync target) mounted into the container as `/app/uploads`.
- Agent verifies path existence, available disk, and OneDrive/Cloud Sync health before enabling ingestion.
- Ingestion run keeps this folder empty post-intake by relocating files into local staging immediately.

## Pipeline Overview
1. **Initialization**
   - On service start, agent loads configuration, resolves secrets/keys via OS credential store or encrypted config, and decrypts assets into secure memory.
2. **Ingestion**
   - File watcher detects new PDFs in the synced folder (Win32 notifications on Windows, inotify/polling on Synology), verifies file lock release, and moves them to a local `/processing` queue.
   - Emits telemetry event `queued` with filename, size, and detection timestamp.
3. **Validation Gate**
   - Phase 1: Lenient filename normalization (`xxxxx_YYYYMMDD_HH_MM`). Rejects trigger `name_format_error`.
   - Phase 2: Cross-field check using PDF extraction and mapping lookup (`coreid_schoolid_mismatch`, `coreid_missing_in_mapping`, etc.).
   - Emits `validating`, `rejected` (with reason), or `validated` events to the dashboard channel.
4. **Parsing Engine**
   - Accepted PDFs processed in worker threads (WebAssembly or native binary) ported from `data_tool/pdf_tools.py`.
   - Autosave JSON structures held in memory; essential metadata includes `sessionkey`, ID fields, timestamps.
   - Emits progress notes (`parsing`, `parsed`) with key metrics (pages, duration).
5. **Merge & Enrichment**
   - JSON results merged into dataset per `merger-tool-enhancements.md` (strict `sessionkey`, provenance column).
   - Enrichment joins decrypted mapping data (school, district, class, student name) in memory; sensitive buffers cleared post-use.
   - Emits `merging`, then `merged` events with enrichment summary.
6. **Upload**
   - Batched payloads sent to serverless proxy for Jotform upsert (`sessionkey` unique) with retries/backoff.
   - Emits `uploading`, `completed` (with `jotformsubmissionid`), or `upload_error` events.
7. **Archival & Reporting**
   - Successful runs apply the filing protocol (implemented in `processor_agent.ps1`) to move artefacts into `...\97 - Project RAW Data\PDF Form Data\{schoolId}` on OneDrive with collision-safe naming.
   - Rejected/failed items relocate to `PDF Form Data\Unsorted\` alongside diagnostic JSON for follow-up.
   - Summaries persisted to daily log and exposed to dashboard via telemetry API (`/api/summary`, `/api/events`).

### Telemetry & Feedback
- Each stage transition emits a structured event consumed by the monitoring UI (`eventType`, `filename`, `timestamp`, `metadata`).
- Rejected events include remediation tips and reference links for operator review.
- Health beats broadcast agent uptime, OneDrive sync status, and proxy latency for dashboard summarisation.

## Detailed Stage Specifications

### Validation Gate Protocols
- **Filename Cleaning**
  - Remove spaces, hyphens, underscores, non-alphanumeric chars.
  - Expect tokens: `coreid` (5 digits) + timestamp `YYYYMMDD_HH_MM` (allow single-digit month/hour before padding).
  - Failures: `name_format_error`, `timestamp_unreadable`, `extension_invalid`.
- **Cross-Field Consistency**
  - Temporary parse of PDF fields for `student-id`, `school-id`.
  - Normalize to `Cxxxxx` / `Sxxx` before comparison.
  - Lookup `coreid.enc` to confirm mapping.
  - Failures: `coreid_schoolid_mismatch`, `coreid_missing_in_mapping`, `schoolid_missing_in_mapping`, `pdf_field_missing`.
- **Modal Feedback**
  - Each file row shows stage badge, timestamp, and reason when rejected.
  - Operators can remove rejected files from the queue or download diagnostic snippets.

### Parsing Engine
- Worker thread pool sized `min(4, cpu_count//2)`; progress events posted back to main thread.
- Retains order of pages and annotations; applies fuzzy mapping guards as per legacy logic.
- Stores autosave JSON with `sessionkey`, `data`, `answered`, `unanswered`, `terminationFlags`.

### Merge & Enrichment
- Maintains canonical `sessionkey` (lowercase) per row and `JSON Origin` column for traceability.
- Enrichment reads decrypted CSVs only in memory; data wiped after run unless user exports.

### Upload Module
- Interfaces with serverless proxy that holds Jotform API key.
- Sequence per record: search by `sessionkey` QID → update if found, create otherwise.
- Retries with exponential backoff (3 attempts, jitter) on 5xx/429/timeouts.
- Logs include HTTP status, error code, `jotformsubmissionid`, elapsed time.

### Logging
- Persist JSON Lines (`.jsonl`) per day capturing raw events, redacting PII where applicable.
- Archive merged dataset snapshots (without PDFs) for audit when configured.
- Provide log retrieval endpoints for dashboard download and CLI diagnostics.
- Emit filing outcomes (destination path, collision suffixes applied) so operations can trace archived files.

## Security Protocols
- On Windows, secrets load via Credential Manager/DPAPI; on Synology, via Docker secrets or encrypted shared folders. Agent holds decrypted values in memory only and resets on restart.
- Decrypt assets using AES-256-GCM utilities; wipe decrypted buffers when pipeline completes or window closes.
- Enforce HTTPS, CSP, and integrity checks on CDN assets (Tailwind/Flowbite) to prevent tampering when the dashboard fetches resources.
{{ ... }}
- Monitoring UI polls/streams from the agent API; ensure endpoints provide CORS headers for local dashboard origins.
- Queue snapshot responses include pagination for large backlogs; front end should render stage-colour badges matching `frontpage_prd.md`.
- Provide signed download links or base64 payloads for log exports requested via the dashboard.
- Display host profile (Windows vs Synology) and sync latency in the dashboard hero metrics so operators know where the agent runs.
- Agent emits structured logs locally and can forward anonymised metrics to remote collectors (optional).
- Proxy services record request IDs, error counts, and throughput for monitoring.
- Optional integration with analytics/telemetry (e.g., Application Insights) to measure average processing time per stage and failure frequency.

## Error Handling & Recovery
- Rejected files relocate to `PDF Form Data\Unsorted\` with diagnostic bundles; dashboard surfaces "Fix & Re-ingest" instructions.
- Network/Proxy failures surface as `upload_error` events; agent retries automatically (3 attempts) then parks file in `/retry_pending/`.
- Catastrophic worker failure triggers service restart logic; agent replays in-progress queue on boot and records error in Windows Event Log.

## Open Questions
- Should the agent support remote configuration (e.g., via REST) or remain local-only?
- Do we require Supabase integration in the first release, or is Jotform sufficiency acceptable?
- Preferred retention period for archived PDFs and telemetry logs.
