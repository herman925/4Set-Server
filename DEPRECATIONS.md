# Deprecated Documentation and References

This document tracks deprecated, outdated, or non-existent documentation references in the 4Set-Server codebase to help maintainers understand what has been superseded or removed.

**Last Updated:** 2025-10-16

---

## Overview

As the 4Set-Server project has evolved from a desktop-based tool to a web-based processor agent system, some documentation references have become outdated. This file clarifies what's deprecated and what should be used instead.

---

## Deprecated Directory: `TEMP/`

### Status: **PARTIALLY DEPRECATED**

The `TEMP/` directory is referenced extensively in PRD documents but many of the subdirectories **no longer exist** in the current codebase.

### What's Referenced vs. What Exists:

#### ❌ **Non-Existent** (Referenced but Missing):
- `TEMP/README.md` - Legacy desktop workflow documentation
- `TEMP/architecture/security-architecture.md` - Security model documentation
- `TEMP/data-tool/parser-panel-enhancements.md` - Parser validation rules
- `TEMP/data-tool/filing-protocol.md` - File archival rules
- `TEMP/data-tool/merger-tool-enhancements.md` - CSV merge specifications
- `TEMP/integrations/jotform-integration.md` - Jotform configuration details
- `TEMP/tasks/termination-rules.md` - Task termination logic

#### ✅ **Currently Exists** (Active Files):
- `TEMP/student-report_C10207_2025-10-16 (1).md` - Generated student reports
- `TEMP/school-report_S023_2025-10-16.md` - Generated school reports
- `TEMP/class-report_C-023-03_2025-10-16.md` - Generated class reports

### Migration Path:

| Deprecated Reference | Current Location | Notes |
|---------------------|------------------|-------|
| `TEMP/tasks/termination-rules.md` | `PRDs/termination-rules.md` | Moved to PRDs directory |
| `TEMP/integrations/jotform-integration.md` | `PRDs/jotform-integration.md` | Consolidated in PRDs |
| `TEMP/data-tool/filing-protocol.md` | Documented inline in `processor_agent.ps1` | Logic embedded in code |
| `TEMP/architecture/security-architecture.md` | `PRDs/data_security_prd.md` | Consolidated security documentation |
| `TEMP/data-tool/*` | `PRDs/data-pipeline.md` | Pipeline documentation consolidated |

---

## Deprecated References in PRDs

### Files with Broken TEMP/ References:

1. **`PRDs/overview_prd.md`**
   - References: `TEMP/README.md`, `TEMP/architecture/security-architecture.md`, `TEMP/data-tool/parser-panel-enhancements.md`
   - **Action Needed:** Update to reference current PRD files

2. **`PRDs/processor_agent_prd.md`**
   - References: `TEMP/data-tool/filing-protocol.md`, `TEMP/integrations/jotform-integration.md`
   - **Action Needed:** Reference actual PRD files and code implementations

3. **`PRDs/pdfpipeline_prd.md`**
   - References: `TEMP/data-tool/filing-protocol.md`, `TEMP/data-tool/merger-tool-enhancements.md`
   - **Action Needed:** Update to reference implementation in processor_agent.ps1

4. **`PRDs/checking_system_prd.md`**
   - References: `TEMP/tasks/termination-rules.md`
   - **Action Needed:** Update to `PRDs/termination-rules.md`

5. **`PRDs/checking_system_pipeline_prd.md`**
   - References: `TEMP/tasks/termination-rules.md`, `/TEMP/checking-system/sample_responses/`
   - **Action Needed:** Update reference and clarify sample response location

6. **`PRDs/data_security_prd.md`**
   - References: `TEMP/architecture/security-architecture.md`
   - **Action Needed:** Self-reference or mark as consolidated

7. **`PRDs/processor_agent_runbook_prd.md`**
   - References: `TEMP/data-tool/filing-protocol.md`
   - **Action Needed:** Reference processor_agent.ps1 implementation

---

## Legacy System References

### "TestWatchFolder" References

**Status:** **DEPRECATED**

The README.md contains references to `TestWatchFolder/` which appears to be from an earlier proof-of-concept phase.

**Current Reality:**
- The actual directory structure doesn't use `TestWatchFolder/`
- The processor agent (`processor_agent.ps1`) is at the root level
- Watch folders are configurable via `config/agent.json`

**Files Affected:**
- `README.md` (lines 20, 24, 30, 34)

**Recommended Action:**
- Update README.md to reflect actual directory structure
- Remove references to `TestWatchFolder/`
- Update paths to match current implementation

---

## Desktop Tool References

### Status: **LEGACY - Documented for Historical Context**

Multiple PRDs reference a "legacy desktop workflow" and "desktop tools" that predate the current processor agent implementation.

**References:**
- "Legacy desktop workflow documented in TEMP/README.md" (overview_prd.md)
- "Desktop throttling: GUI renders first" (data-pipeline.md)
- "Desktop Integration: data_tool/upload.py" (jotform-integration.md)

**Clarification:**
- The desktop tool was an earlier Windows GUI application
- The current system uses `processor_agent.ps1` (PowerShell-based service)
- Desktop tool code may exist elsewhere but is not the primary system

**Action Needed:**
- Clearly mark these as "Historical Context" or "Previous Implementation"
- Document the transition from desktop tool to processor agent
- Clarify which features were migrated vs. deprecated

---

## Inconsistent Version Information

### `PRDs/assessment_uploader_prd.md`

**Issue:** Document shows "Last Updated: 2025-10-15" and version history entries for dates in the past (from future perspective of 2025-10-16)

**Note:** This appears to be a date formatting issue. The document is well-maintained and current.

---

## Missing Mapping Files

### `assets/pdfmapping.json`

**Status:** **EXISTS BUT NOT USED**

From `PRDs/data-pipeline.md` (line 63):
> **Note**: `assets/pdfmapping.json` exists but is **not used** in practice (zero matches) because PDF fields don't use QID names. It's kept for compatibility only.

**Clarification:**
- File exists but hardcoded `HEADER_MAPPING` in `parser/pdf_tools.py` is used instead
- Not deprecated, but purpose is limited to compatibility

---

## Configuration Files

### Status: **EXAMPLES PROVIDED**

Some configuration files are example-only:
- `config/host_identity.json.example` - Example file, actual file should not be committed

---

## Recommendations for Maintainers

### Immediate Actions:
1. ✅ Create this DEPRECATIONS.md file
2. Update README.md to remove TestWatchFolder references
3. Add deprecation notices to PRD files with broken TEMP/ links
4. Replace TEMP/ references with actual file locations

### Medium-Term Actions:
1. Consider creating `docs/archive/` for historical documentation
2. Move legacy system documentation to archive with clear labels
3. Create migration guide from desktop tool to processor agent
4. Standardize PRD cross-references

### Long-Term Actions:
1. Establish documentation versioning policy
2. Create automated link checker for PRD references
3. Regular documentation audits (quarterly)
4. Version control for configuration examples

---

## How to Report Deprecated Documentation

If you find additional deprecated or broken references:

1. **Document here** - Add to appropriate section above
2. **Create an issue** - Tag with `documentation` label
3. **Update references** - Fix in place when possible
4. **Archive when appropriate** - Move to `docs/archive/` if historical value

---

## Consolidated/Deprecated PRD Files

### Status: **CONSOLIDATED INTO SINGLE DOCUMENTS**

Several PRD files were consolidated into comprehensive documents to reduce redundancy and improve maintainability.

### Data Pipeline Consolidation

**Consolidated Into:** `PRDs/data-pipeline.md`

**Deprecated Files** (no longer exist):
- `PRDs/csv-export-and-qualtrics-upload-prd.md`
- `PRDs/data_tool-uploader-spec.md`
- `PRDs/merge-dialog-csv-merge-prd.md`
- `PRDs/data_tool-file-timestamps.md`

All content from these files has been merged into `data-pipeline.md` as the single source of truth.

### Jotform Integration Consolidation

**Consolidated Into:** `PRDs/jotform-integration.md`

**Deprecated Files** (no longer exist):
- `PRDs/sessionkey-jotform-pipeline-plan.md`
- `PRDs/jotform-api.md`

All Jotform-related specifications are now in `jotform-integration.md`.

---

## Version History

- **2025-10-16:** Initial creation - Documented TEMP/ references, TestWatchFolder, legacy system references, and consolidated PRD files
