# Data Security PRD

## 1. Purpose
- **Protect credentials and ID mappings**: Ensure sensitive configuration and identity data is always encrypted at rest and transmitted securely within the 4Set ecosystem.
- **Document encryption workflows**: Provide definitive guidance for encrypting/decrypting assets such as `assets/credentials.enc`, `assets/id_mapping/*.enc`, and related secure artifacts.
- **Align tooling**: Describe how PowerShell utilities and front-end modules interact with the encrypted blobs, ensuring consistent implementations across platforms.

## 2. Scope
- **Included**
  - AES-256-GCM encryption and decryption process for credentials, CSV mappings, and other secure assets.
  - Key derivation using PBKDF2 (100,000 iterations, SHA-256) with 16-byte salt and 12-byte IV conventions.
  - Operational procedures for unlocking secrets via production web modules (`secure-credentials.js`, `secure-csv.js`) and backend agents/services consuming the same bundles.
- **Excluded**
  - External secret rotation tooling (handled in `processor_agent_runbook_prd.md`).
  - Runtime transport security (TLS, VPN) which is governed by infrastructure SOPs.

## 3. Definitions & Terminology
- **System Password**: Shared bootstrap secret used to derive encryption keys for all `.enc` assets. Stored outside source control (Credential Manager entry `4set-processor-master` or DSM Docker Secret `processor_master_key`).
- **Encrypted Bundle**: Binary payload produced by concatenating salt + IV + ciphertext + authentication tag. File size must exceed 44 bytes.
- **Credential Bundle**: JSON object decrypted from `credentials.enc` that includes `systemPassword`, `jotformApiKey`, and other downstream secrets.
- **ID Mapping Assets**: CSV datasets (`coreid`, `schoolid`, `classid`) packaged as `.enc` files for runtime decryption.
- **Authorised Operator**: Staff member approved by Security Engineering to handle encryption operations (see Roles).

## 4. Roles & Responsibilities
- **Security Engineering**
  - Owns encryption standards, reviews changes, maintains system password distribution list.
  - Approves tooling updates (`secure-credentials.js`, PowerShell utilities) and monitors incident escalations.
- **Backend Ops Lead**
  - Executes credential rotations, validates PowerShell automation, and ensures secrets reach production agents.
- **Frontend Lead**
  - Maintains browser-side modules, updates UX around password prompts, and verifies console security logging.
- **Authorised Operator**
  - Runs encryption scripts, conducts verification/QA, uploads `.enc` files to production storage, and confirms plaintext purging.
- **Audit & Compliance**
  - Archives verification artefacts (hashes, checklists) and initiates quarterly reviews.

## 5. Asset Inventory
| Asset | Location | Contents | Encryption Status | Notes |
|-------|----------|----------|-------------------|-------|
| `credentials.enc` | `assets/` | API keys, system password, service tokens | Encrypted (mandatory) | Derived from `credentials.json` (never stored in repo) |
| `coreid.enc` | `assets/id_mapping/` | Student ID mapping CSV | Encrypted (mandatory) | Used by `parseSecureCsv()` |
| `schoolid.enc` | `assets/id_mapping/` | School ID mapping CSV | Encrypted (mandatory) | Same format as `coreid.enc` |
| `classid.enc` | `assets/id_mapping/` | Class ID mapping CSV | Encrypted (mandatory) | Same format as `coreid.enc` |
| `pdfmapping.json` | `assets/id_mapping/` | PDF field mapping | Plaintext (allowed) | Non-sensitive metadata |

## 6. References
- This document consolidates security architecture (formerly in legacy `TEMP/architecture/` documentation)
- `PRDs/processor_agent_runbook_prd.md`
- `PRDs/checking_system_pipeline_prd.md`
- Front-end modules (archived): `secure-credentials.js`, `secure-csv.js`

## 7. Encryption Architecture
- **Algorithm**: AES-256-GCM via Web Crypto API (browser) and .NET `System.Security.Cryptography.AesGcm` (PowerShell).
- **Key Derivation**: PBKDF2 with SHA-256, 100,000 iterations, 16-byte salt.
- **Initialization Vector**: 12-byte IV generated per encryption event.
- **Ciphertext Layout**: Concatenation of salt (16 bytes) + IV (12 bytes) + ciphertext (N bytes) + authentication tag (16 bytes).
- **File Extensions**: Encrypted blobs use `.enc` to distinguish from plaintext sources.

## 8. Credential Workflow (`credentials.enc`)
### 8.1 Prerequisites
- **Authorised Operator** assigned and listed in access control sheet.
- **Tools**: Latest browser build with `secure-credentials.js`, or PowerShell 7.4+ on Windows/Synology, or approved offline Node.js encryptor.
- **System Password Access**: Retrieve via Credential Manager (`cmdkey /list` verify) or DSM Docker Secret download workflow. Never transmit via chat/email.
- **Source File**: `credentials.json` kept in encrypted volume or secure USB. Must include at minimum:
  ```json
  {
    "systemPassword": "<bootstrap secret>",
    "jotformApiKey": "JF-XXXXXXXX",
    "processorClientId": "...",
    "supabaseKey": "..."
  }
  ```

### 8.2 Encryption Procedure
1. **Sanity checks**
   - Validate JSON schema using `jq` or equivalent.
   - Confirm `systemPassword` matches the rotation schedule.
2. **Invoke encryption utility**
   - Browser path: open security dashboard → run `encryptCredentialsFile()`.
   - PowerShell path (headless example):
     ```powershell
     pwsh -File ./tools/Encrypt-Credentials.ps1 -Source ./credentials.json -Destination ./credentials.enc
     ```
   - Node path: `node scripts/encrypt-credentials.mjs ./credentials.json ./credentials.enc`
3. **Process details**
   - Salt generated via CSPRNG (16 bytes).
   - PBKDF2 derives 32-byte key (iterations = 100000, hash = SHA-256).
   - AES-GCM encrypts payload using new IV (12 bytes); auth tag appended (16 bytes).
4. **Post-processing**
   - Record SHA-256 hash of resulting `credentials.enc` in security logbook.
   - Move `.enc` to `assets/` directory (OneDrive sync path) with restricted permissions.
   - Shred (`sdelete` or equivalent) the temporary plaintext copy if local machine is not secured.

### 8.3 Decryption (Front-End Modules)
1. **Trigger**: Application startup or debug mode access to credentials.
2. **Fetch**: `loadCredentials()` performs `fetch('assets/credentials.enc')`.
3. **Prompt loop**: `promptPassword('Enter system password')` continues until AES-GCM success; wrong password shows blocking alert.
4. **Decryption**: Uses `decryptData()` splitting buffer into salt, IV, ciphertext, tag. Web Crypto `crypto.subtle.deriveKey` & `crypto.subtle.decrypt` mirror encryption parameters.
5. **Caching**: Successful result stored in `credentialsCache`; future calls reuse without re-prompting during session.
6. **Fallback**: If `.enc` missing, module attempts plaintext `credentials.json` and emits warnings (`🚨 SECURITY RISK`). Operators must treat as severity-high incident.

### 8.4 Server/Agent Decryption Workflow
1. **Trigger**: Backend services (e.g., processor agent, ingestion pipelines) start up or refresh credentials.
2. **Secret resolution**: Services load encrypted payload from mounted volume (`assets/credentials.enc`) or secret store mirror.
3. **Password retrieval**: Password sourced from platform-specific secret manager (Windows Credential Manager entry `4set-processor-master`, Docker Secret `processor_master_key`, or Kubernetes Secret).
4. **Processing steps**:
   - Service derives encryption key via PBKDF2 (100k iterations) using retrieved password and embedded salt.
   - AES-GCM decrypts bundle; plaintext JSON retained only in-process memory.
   - Service-specific configuration (API tokens, system password) injected into runtime environment.
5. **Error handling**: Failed decrypt attempts trigger exponential backoff, emit security telemetry, and escalate to on-call engineer.

### 8.5 Verification & Logging
- **Integrity**: Compare stored SHA-256 digest against `Get-FileHash credentials.enc -Algorithm SHA256` output.
- **Audit trail**: Update `SECURITY_LOG.md` with timestamp, operator, tool used, hash, ticket reference.
- **Access review**: Security Engineering reviews log monthly and after each rotation.

## 9. ID Mapping Workflow (`coreid.enc`, `schoolid.enc`, `classid.enc`)
### 9.1 Prerequisites
- Plaintext CSVs updated in offline secure environment (air-gapped or encrypted disk).
- Verified header formats (e.g., `student_id,class_code,legacy_id`).
- System password retrieved as per Section 8.1.

### 9.2 Encryption Procedure
1. Execute `encryptSystemCsvFiles()` from administrative UI or run CLI script with parameters `--source-dir ./csv --dest-dir ./enc`.
2. For each CSV:
   - Generate salt/IV per file; derive key with PBKDF2 using system password.
   - Encrypt UTF-8 CSV text; append auth tag.
3. Save as `.enc` under `assets/id_mapping/`.
4. Generate file hashes and attach to rotation ticket.
5. Confirm plaintext CSVs removed from production sync directories.

### 9.3 Decryption & Consumption (Browser Runtime)
1. `loadSecureCsv()` tries encrypted path first; logs success message including byte size.
2. On decryption failure, module triggers password prompt via `getSystemPassword()` or escalates if password mismatch.
3. Fallback to plaintext permitted only when `ENV=development`. Operator must toggle feature flag and document reason.
4. `parseSecureCsv()` converts rows into objects; `getIdMappings()` aggregates results for runtime consumers.

### 9.4 Verification Checklist
- Decrypt randomly sampled `.enc` via QA script and confirm record counts.
- Validate that logs show `Encrypted: YES` entries for each mapping file in browser console.
- For each release, export diff of decrypted CSV vs canonical dataset to ensure no corruption.

## 10. Operational Procedures
- **Password Prompts**
  - Enforce human-in-the-loop entry. Password managers permitted only if approved by Security Engineering.
  - Three consecutive failures require escalation to incident response lead.
- **Logging Discipline**
  - Browser: ensure `logDebug` outputs captured in DevTools logs attached to QA evidence.
  - PowerShell: run probes with `-Verbose` during QA; archive transcript with `Start-Transcript`.
- **Secret Rotation**
  - Initiate change ticket → distribute new system password → re-encrypt credentials + CSVs → update Credential Manager/Docker secrets → verify using procedures in Sections 8.5 & 9.4.
- **Development Mode Controls**
  - Plaintext fallbacks must be gated behind `ALLOW_PLAINTEXT=1` env var plus red banner in UI.
  - Weekly scans ensure no plaintext `credentials.json` or CSVs exist in repo (`git ls-files | grep credentials.json` should return empty).

## 11. Security Considerations
- **No Hardcoding**: Secrets must never appear in committed code, CI variables, or configuration files.
- **Memory Handling**: PowerShell secure strings zeroed post-use; developers should avoid writing decrypted blobs to disk except transient buffers.
- **Error Messaging**: Maintain generic user-facing errors (`Incorrect system password`) while logging detail to secure channel.
- **Transport Security**: Host `.enc` files behind HTTPS with HSTS; confirm CDN caching disabled to avoid stale artefacts.
- **Tamper Detection**: Authentication tag validation will raise cryptographic exception; treat as potential tampering and escalate.

## 12. Incident Response & Escalation
- **Suspected Compromise**
  - Immediately revoke system password, rotate all `.enc` assets, and disable plaintext fallbacks.
  - File incident report referencing this PRD and `processor_agent_runbook_prd.md` Section 7.
- **Password Leakage**
  - Notify Security Engineering; invalidate distribution list and issue new secret via secure channel.
- **Corrupted Artefacts**
  - Re-run encryption from known-good plaintext backups; verify checksums against previous release.
- **Audit Requests**
  - Provide latest hash log, password rotation ticket IDs, and transcripts from verification runs.

## 13. Future Enhancements
- Multi-key support for segmented datasets.
- Hardware-backed key storage (TPM/HSM integration) in enterprise deployments.
- Automated compliance reporting of decryption attempts and audit trails.
- Dedicated CLI to standardise encryption across desktop/server environments.

## 14. Approval & Ownership
- **Maintainer**: Security Engineering (KeySteps@JC)
- **Review Cadence**: Quarterly security review or post-incident.
- **Change Control**: Updates require joint sign-off from Backend Ops Lead and Security Engineer.

## Appendix A — Command Reference
- **Credential Hashing**
  ```powershell
  Get-FileHash ./assets/credentials.enc -Algorithm SHA256
  ```
- **Credential Manager Verification**
  ```powershell
  Import-Module CredentialManager
  Get-StoredCredential -Target "4set-processor-master"
  ```
- **Search for Plaintext Credentials**
  ```bash
  git ls-files | grep credentials.json
  ```

## Appendix B — Verification Log Template
```
Date:
Operator:
Rotation Ticket:
Assets Processed:
Hash (credentials.enc):
Hash (coreid.enc):
Hash (schoolid.enc):
Hash (classid.enc):
Verification Steps:
Decryption Test Result:
Issues Found:
Follow-up Actions:
```
