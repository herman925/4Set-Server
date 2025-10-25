# 4set Web Successor — Overview PRD

> **Documentation Status:** This PRD has been updated (2025-10-16) to remove references to non-existent `TEMP/` documentation and align with current implementation.

## Context
- The system has evolved from a legacy desktop tool to a hybrid model: a Windows-based processor agent handles ingestion and processing, while a lightweight web dashboard (GitHub Pages) monitors status, surfacing telemetry and controls.
- Security model and mappings are governed by `PRDs/data_security_prd.md` and `assets/id_mapping/` artifacts.
- **NEW**: Complete API call process documentation including upload and create submission workflows is available in `PRDs/jotform_qualtrics_integration_prd.md` (see "Complete API Call Process Documentation" section).

## Goals
- Deliver an unsupervised pipeline that reacts to OneDrive uploads without manual triggers.
- Preserve lenient filename and cross-field validation safeguards (documented in `PRDs/data-pipeline.md`) and reject malformed records with actionable reasons.
- Provide a live status dashboard consuming telemetry emitted by the processor agent (queue state, health, recent activity).
- Maintain predictable performance and transparency comparable to the desktop app for large batch uploads.

## Non-Goals
- Replacing existing desktop utilities for operators lacking internet access.
- Altering the AES-256-GCM encryption chain or relaxing credential prompts.
- Building complex analytics beyond upload verification in the first release.

## Target Users
- Research assistants responsible for batch ingest and upload of survey responses.
- Project maintainers who audit uploads and troubleshoot mapping anomalies.

## User Journey
1. User unlocks the dashboard via system password; dashboard confirms processor agent connectivity, OneDrive sync health, and credential status (agent loads secrets locally without prompts).
2. PDFs are uploaded into the shared OneDrive folder by operators or automated sources (outside the dashboard).
3. Processor agent detects new files, runs validation/parsing/merge/upload autonomously, and emits telemetry events.
4. Dashboard displays queue activity (stage badges, recent events), highlights rejections with remediation guidance, and exposes quick links (open upload folder, download logs).
5. Maintainers optionally drill into pipeline detail views (`pipeline_3_validation_gate.html`, etc.) to inspect individual stages and the new monitoring drilldowns (`checking_system_drilldown_desktop_5.html` district → `..._4.html` group → `..._3.html` school → `..._2.html` class → `..._1.html` student).
6. Class drilldown surfaces per-student completion heatmaps and intervention logs before linking onward to student-level detail.
7. Dashboard presents daily summaries and open issues, enabling maintainers to resolve discrepancies or trigger retries.

## Functional Requirements
### Processor Agent (see `PRDs/processor_agent_prd.md`)
- **Folder Watcher**: Observe the configured OneDrive path, debounce partial files, enqueue stable PDFs.
  - Immediately relocate arrivals into local staging so the OneDrive watch folder remains empty post-intake.
- **Validation Gate**: Execute two-phase checks (filename normalization, cross-field consistency) with structured events (`queued`, `validating`, `rejected`).
- **Parsing & Merge**: Run extraction via worker threads/WebAssembly; enrich with mapping data; emit progress metrics.
- **Uploader**: Call the proxy-backed Jotform upsert pipeline, handle retries, then apply filing protocol to move artefacts into `...\97 - Project RAW Data\PDF Form Data\{schoolId}` (or `Unsorted` on failure).
- **Telemetry API**: Expose queue snapshots, event streams, and health reports to the dashboard.
- **Credential Handling**: Store secrets via OS-protected keystores/config files; no interactive password required once service is provisioned.
- **Runtime Requirements**: Agent is implemented in PowerShell 7+ and relies on native `System.Security.Cryptography.AesGcm` APIs for decryption. Windows hosts must install PowerShell 7 (pwsh) alongside legacy PowerShell 5.x to operate the service.
- **Credential Bundle Format**: `assets/credentials.enc` is AES-256-GCM encrypted using `systemPassword` as PBKDF2 input (100k iterations, SHA-256) with layout `[16-byte salt][12-byte IV][ciphertext+tag]`. Payload must include `supabaseUrl`, `supabaseKey`, `supabaseProjectId`, `supabaseTable`, `uploadTable`, `qualtricsDatacenter`, `qualtricsSurveyId`, `systemPassword`, `jotformApiKey`, and `jotformFormId`.
- **Platform Support**:
  - *Windows 10/11 Enterprise*: Install as service (NSSM/SC). Secrets managed via Windows Credential Manager or DPAPI-protected config. Native file watcher via ReadDirectoryChangesW.
  - *Synology DS923+*: Run inside Docker/Container Manager. Synology Cloud Sync maps OneDrive folder (`/volume1/onedrive/Uploads`). Secrets supplied via DSM Docker Secrets or encrypted shared folder unlocked at boot.

### Monitoring Dashboard (front page successor)
- Authenticate via system password, probe processor agent connectivity, display OneDrive sync status.
- Surface live metrics (active queue count, last processed file, health indicators) and activity feed.
- Provide detailed modals for each stage (validation, parsing, merge, upload) following design patterns documented in the "Design TBC" section.
- Offer drilldown navigation from district → group → school → class → student with parity across desktop and mobile reference layouts (see "Design TBC" section).
- Offer operational controls (open upload folder, download logs, trigger retry) by invoking agent endpoints.
- Highlight rejections with remediation guidance and links to naming rules.

### Dashboard Module
- Query the proxy for summarized Jotform submission data (e.g., counts by date, missing `sessionkey`s, retry queue).
- Highlight discrepancies where local batch contains `sessionkey`s absent from Jotform.
- Provide drill-down links that open native Jotform records for manual inspection.

- **Processor Agent**: Windows service/daemon managing file ingestion, validation, parsing, merge, upload, and telemetry emission (`PRDs/processor_agent_prd.md`).
- **Front-End**: Static monitoring dashboard hosted on GitHub Pages consuming agent APIs and proxy endpoints.
- **Security Layer**: Password prompt unlocks dashboard access; agent retrieves secrets from OS/NAS secure storage (Credential Manager/DPAPI or DSM Docker Secrets) and retains them in memory only.
- **Integration Layer**: Serverless proxy endpoints mediate Jotform access; agent communicates over HTTPS with mutual trust.
- **Data Flow**: PDFs reside on OneDrive/ local file system; agent archives completed/rejected copies; dashboard never uploads files.

## Security Considerations
- Enforce zero plaintext storage by decrypting assets in-memory and wiping buffers after use.
- Require HTTPS and Content Security Policy to prevent script injection on the GitHub Pages site.
- Proxy endpoints authenticate requests (JWT or signed timestamp headers) and shield API keys from exposure.
- Dashboard responses must omit PII, returning aggregate statistics keyed by `sessionkey` only.

- Agent processes PDFs asynchronously, applying backpressure (max concurrent workers) and exponential backoff on proxy errors; evaluate NAS hardware (Synology DS923+ w/ Ryzen R1600) to ensure adequate throughput and upgrade RAM if needed.
- Dashboard reflects near real-time updates (<5s latency) and gracefully handles agent downtime with retry banners.
- Mapping tables decrypted once per agent session; buffers cleared on shutdown/restart.

- Agent captures structured logs (JSON Lines) per day, emits heartbeats, and optionally forwards metrics to monitoring systems.
- Dashboard offers log download controls and surfaces outstanding rejections.
- Proxy endpoints emit metrics (success counts, latency, error codes) for operational monitoring.

## Design TBC (To Be Considered)

The following design iterations were prototyped in `.superdesign/design_iterations/` and may inform future enhancements. Most design elements have been integrated into the current active HTML files; these prototypes are archived here for reference.

### Checking System Design Iterations
- **checking_system_desktop_entry_1.html** — Entry point design for desktop checking system
- **checking_system_drilldown_desktop_1.html** — Student-level drilldown (desktop iteration)
- **checking_system_drilldown_desktop_2.html** — Class-level drilldown (desktop)
- **checking_system_drilldown_desktop_3.html** — School-level drilldown (desktop)
- **checking_system_drilldown_desktop_4.html** — Group-level drilldown (desktop)
- **checking_system_drilldown_desktop_5.html** — District-level drilldown (desktop)
- **checking_system_drilldown_desktop_task_visibility_modal_1.html** — Task visibility modal prototype
- **checking_system_drilldown_mobile_1.html** — Student-level drilldown (mobile)
- **checking_system_drilldown_mobile_2.html** — Class-level drilldown (mobile)
- **checking_system_drilldown_mobile_3.html** — School-level drilldown (mobile)
- **checking_system_drilldown_mobile_4.html** — Group-level drilldown (mobile)
- **checking_system_drilldown_mobile_5.html** — District-level drilldown (mobile)
- **checking_system_entry_mobile_1.html** — Entry point design for mobile checking system
- **home.html** — System entry page prototype

### Pipeline Monitoring Design Iterations
- **pipeline_1_entry_confirmation.html** — Session verification and credentials confirmation screen
- **pipeline_2_file_intake.html** — File watcher status dashboard
- **pipeline_3_validation_gate.html** — Validation details and gate status view
- **pipeline_4_parsing_and_merge.html** — Parsing and merge telemetry interface
- **pipeline_5_upload_engine.html** — Jotform upload queue monitoring
- **pipeline_6_rejected_retry.html** — Remediation board for rejected files
- **pipeline_7_responsive_modal.html** — Responsive modal design pattern

### Design Assets
- **theme_pantone_light_1.css** — Pantone-inspired light theme stylesheet
- **default_ui_darkmode.css** — Dark mode UI stylesheet

**Note (October 2025):** Documentation has been consolidated. All implementation notes, bug fix documentation, cache system details, and historical summaries previously scattered across TEMP folder markdown files have been moved into authoritative PRD files:
- **Cache System**: `PRDs/jotform_qualtrics_integration_prd.md` (comprehensive cache implementation section)
- **Implementation Notes**: `PRDs/checking_system_prd.md` (all major fixes and enhancements documented)
- **Test Files**: `TEMP/README.md` (explains remaining test utilities and their purpose)

TEMP folder now contains only active test files (3 MD files vs 19 before), making it easier to find relevant test documentation and understand what's current.

## Recent Enhancements (October 2025)

### Validation Logic Improvements
The system now includes advanced validation logic for Theory of Mind (ToM) assessments:

**Radio_text Question Handling:**
- Priority-based scoring for questions with associated text fields
- If correct answer selected → CORRECT (text field ignored as mistyped input)
- If other option or text filled → INCORRECT
- Affects: ToM_Q3a/ToM_Q3a_TEXT, ToM_Q4a/ToM_Q4a_TEXT, ToM_Q6a/ToM_Q6a_TEXT, ToM_Q7a/ToM_Q7a_TEXT, ToM_Q7b/ToM_Q7b_TEXT

**_TEXT Field Display:**
- New feature displaying text answer fields with smart status indicators
- Four status states: N/A (correct answer selected), Answered (text provided), Not answered (expected but missing), — (no display needed)
- Critical rule: "Not answered" status ONLY appears when radio answer is incorrect
- _TEXT fields NEVER counted in completion percentage calculations

**Gender-Based Branching:**
- TEC_Male/TEC_Female conditional logic verified across all drilldown pages
- Proper gender normalization (M→male, F→female) ensures accurate task counting
- Set completion calculations account for gender-specific task exclusions

**Documentation:**
- Comprehensive `PRDs/calculation_bible.md` updates (~350 lines added)
- Test scripts with 100% pass rate (`TEMP/test_radio_text_validation.py`, `TEMP/test_text_field_display.py`)
- Visual mockup (`TEMP/text_field_display_example.html`)

### JotForm Integration Enhancements
- Documented adaptive batch sizing algorithm with fall-off on error and gradual recovery
- JotForm API bug documentation (4.16 MB truncation at 1000 records)
- Recommended production batch size: 100 records
- Complete caching architecture documentation

## Open Questions
- Preferred identity provider for operator authentication on GitHub Pages (GitHub OAuth vs. enterprise SSO).
- Hosting choice for serverless proxies (Cloudflare Workers, Azure Functions, or Supabase Edge Functions).
- Strategy for optional Qualtrics/Supabase uploads in the web successor.

## Milestones (Draft)
1. Prototype client-side parser using WebAssembly to validate performance.
2. Build merger module with encryption unlock workflow and CSV export.
3. Implement proxy-backed Jotform uploader with idempotent upsert.
4. Add dashboard visualizations and discrepancy alerts.
5. Conduct security review and penetration testing prior to launch.
