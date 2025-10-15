# 4set Successor — Agent Charter

## Mission
- Deliver a GitHub Pages-hosted successor that collapses the legacy `parse → merge → upload` flow into a single "upload PDF" action while eliminating desktop install friction.
- Automate the full pipeline—lenient filename validation, PDF parsing, JSON normalization, CSV generation, and authenticated Jotform upserts—so operators drag once and the browser handles the rest.
- Surface a separate dashboard sourced from Jotform APIs to confirm which `sessionkey` records were uploaded, all while upholding the AES-256-GCM guarantees in `TEMP/architecture/security-architecture.md`.

## Core Principles
- **Naming discipline**: All files, folders, modules, and symbols use lowercase snake_case. Prefer descriptive, human-readable names (e.g., `merge_session_runner.py`, not `msr.py`).
- **Small, cohesive units**: Keep every file under ~500 lines. When growth approaches the limit, refactor into purpose-built modules and update import surfaces accordingly.
- **Security-first changes**: No modification may weaken encryption, credential storage, or audit logging defined in the security architecture documents.
- **Traceable decisions**: Reference the originating spec or ticket within commit messages or PR notes, pointing back to paths under `TEMP/` when applicable.

## Operating Procedure
- **Discovery**: Before coding, review the relevant spec under `TEMP/` (e.g., `TEMP/data-tool/parser-panel-enhancements.md`) and summarize assumptions in task notes.
- **Recommended actions**: For each user request, identify actionable next steps (tests, refactors, docs) and surface them explicitly in responses.
- **Validation**: Run targeted checks (unit tests, linting, or manual verification scripts) whenever code changes touch parsing, merging, or upload flows. Document what was executed and remaining manual verifications.
- **Documentation upkeep**: If behavior diverges from legacy expectations, update the nearest README or spec beneath `TEMP/` so knowledge stays current.
- **Two-phase validation**: Enforce lenient filename checks (per `TEMP/data-tool/parser-panel-enhancements.md`) followed by cross-validation of `sessionkey`, `coreid`, and `schoolid`; reject any PDF that fails with a precise reason and log it for operator follow-up.
- **Client/server split**: For any Jotform or Supabase interaction requiring secrets, design a serverless proxy (e.g., Cloudflare Workers) and document how the static GitHub Pages front-end exchanges tokens without exposing keys.
- **Live status reporting**: Surface upload progress and rejection reasons inside a modal timeline (queued → validating → parsing → merging → uploading → completed/rejected) so operators track the one-stop pipeline without leaving the page.

## Refactoring Mandate
- Split modules once they cover more than one responsibility (parsing vs. uploading, UI vs. backend logic).
- Extract shared utilities into dedicated helpers under a `utils/` or `services/` namespace while keeping function names self-descriptive.
- Remove dead code inherited from the legacy app, especially GUI fragments deprecated in `TEMP/README.md`.
- Prefer dependency inversion over ad-hoc singletons for credential, logging, or storage services.

## Web Delivery Guardrails
- Host static assets (HTML/JS/CSS/WebAssembly) via GitHub Pages and keep bundle modules under 500 lines by splitting views (`parser_view.js`, `merger_view.js`, `uploader_view.js`).
- Run heavy parsing in Web Workers or WebAssembly compiled from the legacy Python modules and reuse validation rules from `TEMP/data-tool/parser-panel-enhancements.md` and `TEMP/data-tool/merger-tool-enhancements.md`.
- Enforce zero-trust for API secrets: integrate with a secrets-holding proxy for Jotform uploads and dashboard aggregation; never embed API keys in the static bundle.
- Reuse the encryption helpers so drag-and-drop inputs decrypt locally using the system password prompt before transmitting any data.

## Data & Security Handling
- Load credentials exclusively through centralized loaders (per `secure-credentials.js`) to enforce password prompts.
- Never persist plaintext credentials, CSVs, or session exports inside the repository. Test fixtures must rely on sanitized mock data only.
- Ensure any export functionality preserves optional password protection, mirroring `TEMP/architecture/security-architecture.md` requirements.
- Document how the dashboard fetch layer reads aggregated Jotform data without caching personal fields in plaintext storage.

## Review Checklist
- [ ] File and symbol names follow lowercase snake_case and are human-readable.
- [ ] Touched files remain below ~500 lines or are scheduled for refactor.
- [ ] Security posture is unchanged or improved; encryption paths validated.
- [ ] Documentation and tests updated alongside behavioral changes.
- [ ] Recommended follow-up actions communicated to the user or maintainer.

## Collaboration Notes
- Capture open questions and blockers as inline TODOs with clear owners (e.g., `# TODO(agent): confirm Jotform QID mapping`).
- Keep a running changelog in future project docs so downstream operators see what evolved from the legacy tool.
- Escalate design shifts that affect integrations documented in `TEMP/integrations/` before implementation.
