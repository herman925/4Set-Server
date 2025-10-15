# Processor Agent Runbook PRD

## Purpose
Provide operational procedures to install, upgrade, and maintain the processor agent across Windows (service) and Synology DS923+ (Docker) hosts, including secret rotation and recovery steps.

## References
- `PRDs/processor_agent_prd.md`
- `PRDs/pdfpipeline_prd.md`
- `TEMP/data-tool/filing-protocol.md`

## 1. Prerequisites
- Agent package bundle (`processor-agent.zip`) containing PowerShell scripts, parsing modules, configuration templates.
- Access to encrypted assets (`assets/credentials.enc`, `assets/coreid.enc`, `assets/schoolid.enc`, `assets/classid.enc`).
- Master key for `credentials.enc` stored securely (Credential Manager entry or DSM Docker Secret).
- Service account with rights to the OneDrive sync folder and outbound HTTPS to proxy endpoints.

### Host Checks
- **Windows**: Verify OneDrive client signed in; confirm `OneDriveCommercial` or `OneDrive` environment variable resolves to the synced root.
- **Synology DS923+**: Ensure DSM 7.x, Docker/Container Manager installed, Synology Cloud Sync mapped to OneDrive `.../97 - Project RAW Data/` hierarchy.

## 2. Initial Installation — Windows 10/11 Enterprise
1. **Prepare directories**
   - Create `C:\ProcessorAgent` (or chosen install root).
   - Copy bundle contents, preserving `config/agent.json` and `modules/` structure.
2. **Configure secrets**
   - Add Credential Manager entry:
     ```powershell
     cmdkey /generic:"4set-processor-master" /user:"AgentKey" /pass:"<master-key>"
     ```
   - Confirm retrieval:
     ```powershell
     Import-Module CredentialManager
     Get-StoredCredential -Target "4set-processor-master"
     ```
3. **Update configuration**
   - Edit `config/agent.json`:
     - `watchPath`: leave blank to auto-resolve; agent appends `\The Education University of Hong Kong\o365grp_KeySteps@JC - General\97 - Project RAW Data\Uploads`.
     - `filingRoot`: `...\97 - Project RAW Data\PDF Form Data`.
     - Proxy endpoints, concurrency, logging retention.
4. **Register Windows service**
   - Option A (PowerShell 7 + NSSM):
     ```powershell
     nssm install 4set-processor "C:\Program Files\PowerShell\7\pwsh.exe" "-File C:\ProcessorAgent\service\Start-Agent.ps1"
     nssm set 4set-processor Start SERVICE_AUTO_START
     ```
   - Option B (Scheduled Task): create task `4set Processor Agent` triggered at logon + startup running `pwsh.exe -File ...Start-Agent.ps1`.
5. **Start service and validate**
   - `nssm start 4set-processor` or run task manually.
  - Monitor logs: `Get-Content C:\ProcessorAgent\logs\agent-*.log -Wait`.
   - Confirm telemetry endpoint responds: `Invoke-RestMethod http://localhost:48500/api/health`.

## 3. Initial Installation — Synology DS923+
1. **Prepare secrets**
   - DSM Control Panel → Security → Certificate & Secret → create Docker Secrets:
     - `processor_credentials_enc`: upload `credentials.enc`.
     - `processor_master_key`: text file containing master key.
2. **Set up volume**
   - Create shared folder `processor-agent` (if desired) for logs/config.
   - Ensure Cloud Sync maps OneDrive to `/volume1/onedrive` and folder `PDF Form Data` exists with subfolders `S###`.
3. **Deploy container**
   - Example `docker-compose.yml`:
     ```yaml
     services:
       processor-agent:
         image: mcr.microsoft.com/powershell:7.4
         command: pwsh -File /app/service/Start-Agent.ps1
         volumes:
           - /volume1/processor-agent:/app
           - /volume1/onedrive:/onedrive:rw
         secrets:
           - processor_credentials_enc
           - processor_master_key
         environment:
           - CONFIG_PATH=/app/config/agent.json
           - WATCH_PATH=/onedrive/Uploads
           - FILING_ROOT=/onedrive/PDF Form Data
     secrets:
       processor_credentials_enc:
         external: true
       processor_master_key:
         external: true
     ```
   - Place bundle under `/volume1/processor-agent` before compose up.
4. **Start container**
   - `docker compose up -d` from DSM Terminal or Container Manager UI.
   - Verify logs: `docker logs processor-agent -f`.
   - Ensure `/onedrive/Uploads` empties after test file processed.

## 4. Secret Rotation
### Windows
1. Generate new `credentials.enc` (update encrypted bundle offline).
2. Replace file in `assets/` or configured secret path.
3. Update Credential Manager entry:
   ```powershell
   cmdkey /delete:"4set-processor-master"
   cmdkey /generic:"4set-processor-master" /user:"AgentKey" /pass:"<new-master-key>"
   ```
4. Restart service: `nssm restart 4set-processor`.
5. Confirm agent logs `SecretsRehydrated` event.

### Synology
1. Update Docker Secret `processor_credentials_enc` via DSM (upload new file).
2. Update `processor_master_key` secret with new key.
3. Redeploy container: `docker compose pull` (if updated image) and `docker compose up -d`.
4. Verify new secrets loaded (`docker logs` shows `SecretsRehydrated`).

## 5. Upgrade Procedure
### Windows
1. Stop service: `nssm stop 4set-processor`.
2. Backup current install folder.
3. Replace binaries/scripts with new version (preserve `config/agent.json` and logs).
4. Run smoke test in staging mode: `pwsh -File .\service\Start-Agent.ps1 -Test` with sample PDFs.
5. Start service and monitor telemetry/dashboard for 15 minutes.

### Synology
1. `docker compose pull` new image or copy updated scripts to `/volume1/processor-agent`.
2. `docker compose up -d` (recreate container).
3. Check logs, ensure queue drains, confirm dashboard reflects activity.

## 6. Validation Checklist (Post-Install/Upgrade)
- `Uploads` folder remains empty after sample file drop.
- Processed file appears under `PDF Form Data\S###` with collision-safe naming.
- Dashboard hero shows correct host type and sync latency.
- Health endpoint reports `status: ok`.
- Telemetry log includes `Queued`, `Validated`, `Parsed`, `Merged`, `Uploaded`, `Filed` events.

## 7. Troubleshooting
- **Agent fails to start**: run `pwsh -File Start-Agent.ps1 -Verbose` to inspect dependency errors.
- **Cannot read secrets**: check Credential Manager entry or Docker Secret mount. Ensure service account matches credential scope.
- **Watch folder not clearing**: verify file lock polling threshold; inspect logs for `FileLockTimeout` warnings.
- **Slow throughput**: adjust worker count in config; confirm CPU availability (DS923+ may require RAM upgrade).
- **Failed filings**: review `PDF Form Data\Unsorted\` diagnostics; compare with rules in `TEMP/data-tool/filing-protocol.md`.

## 8. Rollback
- **Windows**: stop service, restore previous install backup, restart service.
- **Synology**: `docker compose down`, revert to prior image (`docker image ls`), redeploy, or restore previous `/volume1/processor-agent` snapshot.

## 9. Contact & Ownership
- Primary maintainer: Backend Ops Lead (KeySteps@JC).
- Escalation: IT Support Team via Teams channel `#4set-ops`.
