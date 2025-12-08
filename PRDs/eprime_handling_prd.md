# E-Prime Data File Handling PRD

---
**Title:** E-Prime `.edat3` File Processing Pipeline  
**Owner:** Project Maintainers  
**Last Updated:** 2025-12-03  
**Status:** Planning  
**Version:** 0.1 - Initial Discussion

---

## Overview

Extend the Processor Agent to handle E-Prime `.edat3` files alongside existing PDF processing. E-Prime files contain behavioral task data that needs to be extracted, normalized, and uploaded to JotForm.

### Objectives
1. **Filename Parsing** - Extract metadata (task name, school ID, core ID, computer number) from `.edat3` filenames
2. **ID Normalization** - Standardize variable-length IDs to match existing system conventions
3. **JSON Transformation** - Convert `.edat3` data to JSON format compatible with JotForm upload
4. **Unified Filing** - Integrate with existing staging → school folder filing protocol

---

## Filename Specification

### Pattern
```
{e-prime-task-name}-{schoolid}-{coreid}-{computerno}.edat3
```

### Examples (from real file: `NL-59-11603-51.edat3`)
```
NL-59-11603-51.edat3         # Real example: NL task, school 59, core 11603, PC 51
ToM-12-12345-51.edat3        # 2-digit school ID
ToM-123-12345-1.edat3        # 3-digit school ID, single-digit PC
CWR-12-12345-999.edat3       # Different task, 3-digit PC
```

### Field Extraction Rules

| Field | Source | Normalization | Notes |
|-------|--------|---------------|-------|
| **Task Name** | First segment | None (preserve as-is) | See [Known Task Names](#known-task-names) below |
| **School ID** | Second segment | S prefix + zero-pad to 3 digits | `59` → `S059`, `5` → `S005` |
| **Core ID** | Third segment | Prefix with `C` | `11603` → `C11603` |
| **Computer No** | Fourth segment | Zero-pad to 3 digits | `51` → `051`, `1` → `001` (matches `upload.html` format) |

### Known Task Names

| Task Code | Full Name | Example Filename |
|-----------|-----------|------------------|
| `NL` | Number Line | `NL-59-11603-51.edat3` |
| `SimpleReactionTime` | Simple Reaction Time | `SimpleReactionTime-59-11603-51.edat3` |
| `AnimalNumber` | Animal Number | `AnimalNumber-59-11603-51.edat3` |
| `GoNoGo` | Go/No-Go | `GoNoGo-59-11603-51.edat3` |
| `Simon` | Simon Task | `Simon-59-11603-51.edat3` |
| `CorsiForward` | Corsi Forward | `CorsiForward-59-11603-51.edat3` |
| `CorsiBackward` | Corsi Backward | `CorsiBackward-59-11603-51.edat3` |

**Note:** This list may be incomplete. Accept any alphanumeric task name but log a warning for unknown tasks.

### Validation Rules
- [x] Task name must be non-empty alphanumeric (**7 known tasks** — see above)
- [ ] School ID must be 1-3 digits (range: 1-999)
- [ ] Core ID must be 5 digits (confirm with existing data)
- [ ] Computer number must be 1-3 digits (range: 1-999, indicates laptop purchase sequence)
- [ ] File extension must be `.edat3` (case-insensitive?)

---

## Processing Pipeline

### Proposed Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Incoming Folder (OneDrive)                    │
│              *.pdf + *.edat3 files monitored                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    File Type Detection                           │
│         Get-ChildItem -Filter "*.pdf","*.edat3"                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │
          ┌───────────┴───────────┐
          ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│   PDF Pipeline  │     │  EDAT3 Pipeline │
│   (existing)    │     │    (new)        │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │              ┌────────┴────────┐
         │              │ 1. Filename     │
         │              │    Validation   │
         │              │ 2. ID Normal-   │
         │              │    ization      │
         │              │ 3. EDAT3→JSON   │
         │              │    Transform    │
         │              └────────┬────────┘
         │                       │
         └───────────┬───────────┘
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│                    JotForm Upload                                │
│              Unified upsert with sessionkey                      │
└─────────────────────┬───────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Filing Protocol                               │
│         Success → schoolId/ | Failure → Unsorted/               │
└─────────────────────────────────────────────────────────────────┘
```

---

## Implementation Considerations

### 1. File Discovery Changes

**Current** (line 2768 in `processor_agent.ps1`):
```powershell
$pending = Get-ChildItem -Path $script:WatchPath -File -Filter "*.pdf"
```

**Proposed**:
```powershell
$pending = Get-ChildItem -Path $script:WatchPath -File | 
    Where-Object { $_.Extension -in @('.pdf', '.edat3') }
```

### 2. File Type Routing

```powershell
foreach ($item in $pending) {
    switch ($item.Extension.ToLower()) {
        '.pdf'   { Process-IncomingPdf -Path $item.FullName }
        '.edat3' { Process-IncomingEdat3 -Path $item.FullName }
    }
}
```

### 3. EDAT3 Filename Validation Function

```powershell
function Invoke-Edat3FilenameValidation {
    param([string]$FileName)
    
    # Pattern: {task}-{schoolid}-{coreid}-{computerno}.edat3
    # Example: NL-59-11603-51.edat3
    $pattern = '^([A-Za-z0-9]+)-(\d{1,3})-(\d{5})-(\d{1,3})\.edat3$'
    
    if ($FileName -match $pattern) {
        $taskName = $Matches[1]
        $schoolId = $Matches[2].PadLeft(3, '0')  # Normalize to 3 digits: 59 → 059
        $coreId = "C" + $Matches[3]              # Add C prefix: 11603 → C11603
        $computerNo = $Matches[4].PadLeft(3, '0') # Normalize to 3 digits: 51 → 051 (matches upload.html)
        
        return @{
            IsValid = $true
            TaskName = $taskName
            SchoolId = $schoolId
            CoreId = $coreId
            ComputerNo = $computerNo
            CanonicalName = "$taskName-$schoolId-$coreId-$computerNo.edat3"
        }
    }
    
    return @{
        IsValid = $false
        ReasonCode = "INVALID_EDAT3_FILENAME"
        Reason = "Filename does not match pattern: {task}-{schoolid}-{coreid}-{computerno}.edat3"
    }
}
```

### 4. EDAT3 File Format

**Confirmed:** `.edat3` is a **binary/proprietary format** (contains null bytes, not text-based).

**Implication:** We **cannot decode the internal contents** without E-Prime SDK or reverse-engineering.

**Current Scope:** Extract metadata from **filename only** — no internal data extraction required.

**Future Consideration:** If internal data is ever needed, would require:
1. E-Prime SDK (commercial)
2. Third-party reverse-engineering tools
3. Export to CSV/text from E-Prime software first

---

## Validation Pipeline

### Cross-Validation with `coreid.enc` Mapping

Same validation logic as PDF pipeline — reject files where School ID doesn't match the expected School ID for that Core ID.

**Validation Steps:**
```
1. Parse filename → extract Core ID and School ID
2. Normalize: Core ID → "C{digits}", School ID → 3-digit padded
3. Lookup Core ID in coreid.enc mapping
4. If Core ID not found → REJECT (coreid_missing_in_mapping)
5. If mapping's School ID ≠ filename's School ID → REJECT (coreid_schoolid_mismatch)
6. If valid → proceed to JotForm upsert
```

**Rejection Codes (same as PDF):**
| Code | Meaning |
|------|---------|
| `coreid_missing_in_mapping` | Core ID from filename not found in `coreid.enc` |
| `coreid_schoolid_mismatch` | School ID in filename doesn't match expected school for this Core ID |

**Example Rejection:**
```
Filename: NL-59-11603-51.edat3
Extracted: Core ID = C11603, School ID = 059
Mapping shows: C11603 belongs to School 061
Result: REJECT - coreid_schoolid_mismatch
```

### Logging Requirements

EDAT3 rejections must follow the same logging pattern as PDF rejections for consistency in `log.html` viewer:

```powershell
# Use -Level "REJECT" for all validation failures
Write-Log -Message "coreid_schoolid_mismatch: Filename='059' vs Mapping='061' for Core ID 'C11603'" -Level "REJECT" -File $FileName
```

**Log Levels for EDAT3 Pipeline:**
| Scenario | Level | Example Message |
|----------|-------|-----------------|
| Filename format invalid | `REJECT` | `INVALID_EDAT3_FILENAME: {filename}` |
| Core ID not in mapping | `REJECT` | `coreid_missing_in_mapping: Core ID 'C11603' not found` |
| School ID mismatch | `REJECT` | `coreid_schoolid_mismatch: Filename='059' vs Mapping='061'` |
| JotForm upload success | `UPLOAD` | `EDAT3 data merged to submission {id}` |
| Filed to school folder | `FILED` | `Filed EDAT3 to {schoolId}/` |

This ensures:
- EDAT3 rejections appear in log viewer's "Errors" count
- Filtering by `REJECT` level shows both PDF and EDAT3 failures
- Consistent troubleshooting experience

### Validation Function (Proposed)

```powershell
function Invoke-Edat3CrossValidation {
    param(
        [string]$CoreId,      # e.g., "C11603"
        [string]$SchoolId,    # e.g., "059" (from filename)
        [hashtable]$CoreIdMap,
        [string]$FileName
    )
    
    $result = @{ IsValid = $true; ReasonCode = $null; Reason = $null }
    
    # 1. Check Core ID exists in mapping
    $studentRecord = $CoreIdMap.$CoreId
    if (-not $studentRecord) {
        $result.IsValid = $false
        $result.ReasonCode = "coreid_missing_in_mapping"
        $result.Reason = "Core ID '$CoreId' not found in mapping data."
        return $result
    }
    
    # 2. Cross-validate School ID
    $mappedSchoolId = $studentRecord.'School ID'
    if (-not $mappedSchoolId) { $mappedSchoolId = $studentRecord.schoolId }
    
    # Normalize both to 3-digit for comparison
    $normalizedMapped = $mappedSchoolId.ToString().PadLeft(3, '0')
    $normalizedFilename = $SchoolId.PadLeft(3, '0')
    
    if ($normalizedMapped -ne $normalizedFilename) {
        $result.IsValid = $false
        $result.ReasonCode = "coreid_schoolid_mismatch"
        $result.Reason = "School ID mismatch: Filename='$normalizedFilename' vs Mapping='$normalizedMapped' for Core ID '$CoreId'"
        return $result
    }
    
    # 3. Return success with student record for enrichment
    $result.StudentRecord = $studentRecord
    $result.MappedSchoolId = $normalizedMapped
    return $result
}
```

---

## JotForm Integration

### Upsert Strategy (Confirmed)

**Behavior:** Different from PDF uploads — match by **Core ID only** (not sessionkey).

```
1. Search JotForm for submissions with matching student-id (QID 20)
2. Results ordered by created_at ASC (oldest first)
3. If found: Update the FIRST/EARLIEST submission
4. If not found: Create NEW submission (handles case where EDAT3 arrives before PDF)
```

**Key Differences from PDF Pipeline:**
| Aspect | PDF Pipeline | EDAT3 Pipeline |
|--------|--------------|----------------|
| Search field | `sessionkey` (QID 3) | `student-id` (QID 20) |
| Match type | Exact sessionkey match | Any submission with same Core ID |
| Target | Specific submission | Earliest submission |
| Sessionkey | Populated from filename | **Not touched** (leave for PDF) |

**Rationale:** 
- EDAT3 files don't have timestamps in filename (unlike PDFs)
- One student may have multiple submissions; always update the first/earliest one
- Supports scenario where EDAT3 is uploaded before any PDF exists
- Sessionkey remains the PDF's domain — EDAT3 just "merges" E-Prime data onto existing record

**Edge Case: EDAT3 arrives before PDF**
- EDAT3 creates a new submission with only `student-id` and E-Prime fields
- When PDF arrives later, it creates a **separate** submission (searches by sessionkey, not student-id)
- **Result:** Two submissions for same student (one with E-Prime data, one with PDF data)
- **Resolution:** Checking system data merge pipeline will consolidate duplicates
- **Decision:** Option B — Allow duplicates, merge in checking system (simpler than modifying PDF pipeline)

### Search Implementation

Reuse existing JotForm filter API pattern but target `student-id` (QID 20):

```powershell
# EDAT3 search: by student-id (Core ID), get earliest
$studentIdQid = $JotformQuestions['student-id']  # QID 20
$filter = "{`"q${studentIdQid}:matches`":`"${CoreId}`"}"
$filterUri = "...&filter=$encodedFilter&limit=100"

# IMPORTANT: JotForm ignores orderby/direction parameters (confirmed Dec 2025)
# Must sort results ourselves to get earliest submission
$sorted = $filterResponse.content | Sort-Object { [datetime]$_.created_at }
$foundSubmission = $sorted | Select-Object -First 1
```

> **⚠️ JotForm API Quirk (Dec 2025):** The `orderby` and `direction` parameters are ignored by JotForm's filter API. Results are always returned in an undefined order. Always sort results client-side.

---

## Field Mapping Strategy

### Shared Fields (Existing QIDs) — READ-ONLY for EDAT3

These fields are populated by PDF uploads. EDAT3 uses them for **matching only**, not updating:

| Field | QID | EDAT3 Behavior |
|-------|-----|----------------|
| `sessionkey` | 3 | **Do not touch** — PDF's unique identifier |
| `student-id` | 20 | **Match only** — used to find submission |
| `school-id` | 22 | **Do not touch** — already set by PDF |

### New Fields Required (Must Create in JotForm)

These fields are **exclusive to E-Prime data** and need new QIDs:

| Field Name | Purpose | Notes |
|------------|---------|-------|
| `EPrime_{Task}_Done` | Task completion flag | e.g., `EPrime_NL_Done` = `true` |
| `EPrime_{Task}_ComputerNo` | PC that ran E-Prime task | **Separate from PDF's `computerno`** |

**Note:** No date fields — EDAT3 filename doesn't contain timestamp and binary content is unreadable.

**Why separate `EPrime_ComputerNo`?**
- PDF's `computerno` (QID 647) = PC that **uploaded** the PDF (from `.meta.json`)
- E-Prime's computer = PC that **ran the behavioral task** (from filename)
- These may be different machines!

**Computer Number Handling in `upload.html`:**
- PDF files: Creates `.meta.json` with `uploadedFrom` PC number
- EDAT3 files: **No metadata file** — PC number is already in filename (e.g., `NL-59-11603-51.edat3` → PC 051)
- This avoids conflict between uploader PC and E-Prime PC

### Field Mapping Table (Final)

| EDAT3 Filename Field | JotForm Field | QID | Action |
|----------------------|---------------|-----|--------|
| Core ID | `student-id` | 20 | **Match only** (don't update) |
| School ID | `school-id` | 22 | Verify match, don't overwrite |
| Task Name | `EPrime_{Task}_Done` | TBD | **Update** → set to `"1"` |
| Computer No | `EPrime_{Task}_ComputerNo` | TBD | **Update** (new field) |

**CRITICAL: student-id Format**
- EDAT3 filename contains Core ID with C prefix: `C11603`
- JotForm stores `student-id` as **digits only**: `11603` (no C prefix)
- The EDAT3 processor strips the C prefix before searching/creating JotForm submissions
- This matches the PDF pipeline behavior which also stores digits only

---

## Open Questions (Remaining)

1. **Task Names** ✅ RESOLVED
   - 7 known tasks: `NL`, `SimpleReactionTime`, `AnimalNumber`, `GoNoGo`, `Simon`, `CorsiForward`, `CorsiBackward`
   - Strategy: Accept any alphanumeric, log warning for unknown tasks

2. **JotForm Field Creation** ✅ COMPLETED
   - 14 new fields created (7 tasks × 2 fields each)
   - QID assignments:
     | Field | QID |
     |-------|-----|
     | `EPrime_NL_Done` | 648 |
     | `EPrime_NL_ComputerNo` | 649 |
     | `EPrime_SimpleReactionTime_Done` | 650 |
     | `EPrime_SimpleReactionTime_ComputerNo` | 651 |
     | `EPrime_AnimalNumber_Done` | 652 |
     | `EPrime_AnimalNumber_ComputerNo` | 653 |
     | `EPrime_GoNoGo_Done` | 654 |
     | `EPrime_GoNoGo_ComputerNo` | 655 |
     | `EPrime_Simon_Done` | 656 |
     | `EPrime_Simon_ComputerNo` | 657 |
     | `EPrime_CorsiForward_Done` | 658 |
     | `EPrime_CorsiForward_ComputerNo` | 659 |
     | `EPrime_CorsiBackward_Done` | 660 |
     | `EPrime_CorsiBackward_ComputerNo` | 661 |
   - `jotformquestions.json` updated with new QIDs

3. **Filing Destination** ✅ RESOLVED
   - Same school folders as PDFs — EDAT3 files sit alongside filed PDFs
   - Success → `S{schoolId}/` folder (e.g., `S059/NL-59-11603-51.edat3`)
   - Failure (validation/upload) → `Unsorted/` folder

4. **Data Overwrite Protection** ✅ RESOLVED
   - Honours existing `config/agent.json` → `dataProtection.enableDataOverwriteProtection`
   - When `true`: Reject if E-Prime fields already have data
   - When `false`: Allow overwriting E-Prime fields
   - Same behavior as PDF pipeline — no special handling needed

---

## Next Steps

### Resolved ✅
- [x] Confirm filename pattern with sample file (`NL-59-11603-51.edat3`)
- [x] Investigate `.edat3` file format → **Binary/proprietary, cannot decode**
- [x] Decide on upsert strategy → **Match by Core ID (QID 20), update earliest submission**
- [x] Computer number format → **3-digit zero-padded**
- [x] Sessionkey handling → **Do not touch, leave for PDF**
- [x] PC number separation → **New field `EPrime_ComputerNo` (separate from PDF's `computerno`)**

### To Do 📋

**JotForm Setup:** ✅ COMPLETED
- [x] Get full list of E-Prime task names from project team → **7 tasks confirmed**
- [x] Create 14 new fields in JotForm (7 tasks × 2 fields each) → **QIDs 648-661**
- [x] Get QIDs for new fields → **See table above**
- [x] Update `assets/jotformquestions.json` with new QIDs → **Done**

**Implementation:** ✅ COMPLETED
- [x] Implement `Invoke-Edat3FilenameValidation` in `processor_agent.ps1` (lines 2265-2323)
- [x] Implement `Invoke-Edat3CrossValidation` (lines 2325-2369)
- [x] Implement `Invoke-JotformUpsertByStudentId` (lines 2371-2539)
- [x] Implement `Process-IncomingEdat3` function (lines 2541-2681)
- [x] Update file discovery to include `.edat3` (lines 3191-3205)
- [x] Add file type routing logic
- [ ] Test end-to-end pipeline

**Checking System Integration:** ✅ COMPLETED (Dec 2025)
- [x] Add E-Prime task definitions to `config/checking_system_config.json`
- [x] Update Class Page (`checking-system-class-page.js`) with E-Prime column
- [x] Update School Page (`checking-system-school-page.js`) with E-Prime column
- [x] Update Student Page (`checking-system-student-page.js`) with E-Prime section
- [ ] Update District/Group Pages with E-Prime aggregation (future enhancement)

**E-Prime Display Logic:**
- **Green (7/7):** All 7 E-Prime tasks complete
- **Red (1-6/7):** Partial completion
- **Grey (0/7):** No E-Prime data

---

## Revision History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 0.1 | 2025-12-03 | - | Initial planning discussion |
