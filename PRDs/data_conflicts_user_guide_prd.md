# Operator Guide: Handling Data Overwrite Conflicts

**Document Version:** 1.0  
**Last Updated:** October 2025  
**Target Audience:** System Operators, Data Administrators

---

## Overview

The 4Set Processor Agent includes **Data Overwrite Protection** (configurable) to prevent accidental corruption of existing assessment data. When enabled, if a PDF is uploaded for a student who already has data in the system, the agent validates that no existing assessment answers will be overwritten.

### Configuration

Data overwrite protection can be **enabled or disabled** via the agent configuration file:

**File**: `config/agent.json`  
**Setting**: `validation.enableDataOverwriteProtection`  
**Default**: `true` (protection enabled)

```json
{
  "validation": {
    "enableDataOverwriteProtection": true
  }
}
```

- **When `true` (default)**: Files that would overwrite existing assessment data are rejected and moved to `Unsorted/` for manual review
- **When `false`**: Files are allowed to overwrite existing data without conflict checks (full data overwrite mode)

⚠️ **Important**: Disabling protection should only be done when human operators take full responsibility for data integrity, such as during supervised data correction workflows.

### When This Guide Applies

**This guide applies ONLY when `enableDataOverwriteProtection: true`**

If protection is disabled, PDFs will update JotForm submissions without conflict detection. In that mode, operators must ensure data correctness before uploading.

### What Gets Protected?

✅ **Protected Fields** (Cannot Overwrite):
- All assessment answers (ERV, CM, CWR, TEC, etc.)
- Demographic data already filled
- Any other non-administrative field with existing data

❌ **Exception Fields** (Can Overwrite):
- `student-id` - Student identifier
- `child-name` - Student name
- `school-id` - School identifier
- `district` - District name
- `class-id` - Class identifier
- `class-name` - Class name
- `computerno` - Computer number

---

## Conflict Detection

### What Triggers a Conflict?

A conflict is detected when:
1. ✅ An existing submission already exists (same sessionkey)
2. ✅ A protected field has a non-empty value in JotForm
3. ✅ The new PDF has a **different** non-empty value for that field
4. ✅ The field is **not** in the exception list

### What Does NOT Trigger a Conflict?

❌ **Inserting data into blank fields** (e.g., blank → "A")
❌ **Same value** (e.g., "A" → "A")
❌ **Null/empty new value** (e.g., "A" → blank)
❌ **Exception fields** (e.g., updating student name)
❌ **Case differences only** (e.g., "male" → "Male" - PowerShell is case-insensitive)

---

## Handling Conflicts

### Step 1: Identify Conflicted Files

Conflicted files are automatically moved to the **`Unsorted/`** folder:

```
OneDrive/
└── 97 - Project RAW Data/
    └── PDF Form Data/
        └── Unsorted/
            ├── 12345_20250101_10_30.pdf  ← Conflicted PDF
            └── 12345_20250101_10_30.json ← Associated JSON data
```

### Step 2: Review the Log

1. Open the daily log file: `logs/YYYYMMDD_processing_agent.csv`
2. Search for `DATA_OVERWRITE_DIFF` entries
3. Review the conflict details:

**Example Log Entry:**
```csv
Timestamp,Level,File,Message
2025-10-22T14:30:45.123Z,DATA_OVERWRITE_DIFF,12345_20250101_10_30.pdf,"Data overwrite conflict detected (2 field(s)): ERV_Q1 (QID 30): existing='A' → new='B'; Gender (QID 598): existing='M' → new='F'"
```

**What This Tells You:**
- **File**: `12345_20250101_10_30.pdf`
- **Conflicts**: 2 fields
  - `ERV_Q1` (QID 30): Was "A", PDF has "B"
  - `Gender` (QID 598): Was "M", PDF has "F"

### Step 3: Investigate the Cause

Ask yourself:
1. **Is this a re-upload?** Did someone accidentally re-run this assessment?
2. **Is the existing data correct?** Check JotForm submission history
3. **Is the new data correct?** Review the PDF file
4. **Was there an administrative error?** Wrong student ID, wrong session key?

### Step 4: Resolve the Conflict

Choose one of the following actions:

#### Option A: Keep Existing Data (Recommended)
If the existing data is correct:
1. **Archive the conflicted PDF** (move to a backup folder)
2. **Delete the JSON file** from Unsorted/
3. **No further action needed** - existing data is preserved

#### Option B: Manually Update JotForm
If the new data is correct:
1. **Log into JotForm** (https://www.jotform.com)
2. **Search for the submission** by sessionkey (e.g., `12345_20250101_10_30`)
3. **Manually edit the submission** to correct the values
4. **Document the change** in your operator log
5. **Archive the PDF and JSON** from Unsorted/

#### Option C: Delete and Re-Upload
If you need to completely replace the data:
1. **Log into JotForm**
2. **Find and DELETE** the existing submission
3. **Move the PDF back** to the watch folder (`incoming/`)
4. **The agent will process it as a new submission** (no conflict)

⚠️ **Warning**: Option C permanently deletes the original data. Use only if you're certain.

---

## Common Scenarios

### Scenario 1: Legitimate Re-Assessment
**Situation**: Student took the assessment again with different answers (e.g., re-test)

**Resolution**:
- If **first assessment is valid** → Keep existing data (Option A)
- If **second assessment should replace** → Delete old submission and re-upload (Option C)
- **Document which assessment was kept** in your records

### Scenario 2: Administrative Error - Wrong Student ID
**Situation**: PDF has wrong student ID, causing conflict with another student's data

**Resolution**:
1. **Correct the student ID** in the PDF filename (or on the form itself)
2. **Re-scan the PDF** with correct student ID
3. **Upload the corrected PDF** - it will create a new submission
4. **Archive the incorrect PDF** from Unsorted/

### Scenario 3: Data Entry Correction
**Situation**: Operator realizes a field was marked incorrectly during assessment

**Resolution**:
1. **If only 1-2 fields** → Use Option B (manual JotForm edit)
2. **If many fields** → Use Option C (delete and re-upload)
3. **Document the correction** in your operator log

### Scenario 4: Partial Assessment Completion
**Situation**: Student completed first half, now uploading second half

**Resolution**:
- **This should NOT trigger a conflict** (blank fields being filled)
- If conflict occurs, check if fields were already answered
- May indicate duplicate assessment - investigate further

---

## Best Practices

### ✅ DO:
- **Review logs daily** for `DATA_OVERWRITE_DIFF` entries
- **Investigate each conflict** before taking action
- **Document all manual changes** in your operator log
- **Keep backups** of conflicted PDFs for 30 days
- **Communicate with administrators** about frequent conflicts

### ❌ DON'T:
- **Don't blindly delete submissions** without verification
- **Don't ignore conflicts** - they indicate data quality issues
- **Don't disable protection without approval** - requires configuration change and should only be done for supervised correction workflows
- **Don't re-upload the same PDF** repeatedly - it will keep conflicting

---

## Troubleshooting

### Q: Why did a re-upload trigger a conflict?
**A:** The system detected that assessment answers already exist. This is **by design** to prevent accidental data loss. If you need to update data, use one of the resolution options above.

### Q: Can I update administrative fields (student name, class, etc.)?
**A:** Yes! These are **exception fields** and can be updated freely. Just re-upload the PDF with corrected administrative fields, and it will update without conflict.

### Q: What if I have many conflicts from the same batch?
**A:** This indicates a systematic issue:
1. **Stop uploading** from that batch
2. **Investigate root cause** (wrong date? wrong session? duplicate assessments?)
3. **Resolve the issue** before continuing
4. **Contact technical support** if needed

### Q: How do I prevent conflicts?
**A:** Best practices:
1. **Unique session keys** - Never reuse student ID + date + time
2. **Quality control** - Verify PDFs before uploading
3. **Training** - Ensure operators understand the workflow
4. **Communication** - Coordinate with other operators to avoid duplicates

---

## Technical Reference

### Log Levels
- `DATA_OVERWRITE_DIFF` - Conflict detected, file moved to Unsorted/
- `FILED` - File successfully archived to school folder
- `REJECT` - Validation failure (different from conflicts)
- `ERROR` - System error during processing

### File Locations
```
OneDrive/
├── incoming/              ← Drop PDFs here for processing
├── processing/            ← Temporary staging (don't touch)
└── 97 - Project RAW Data/
    └── PDF Form Data/
        ├── S001/          ← Successfully processed (school folders)
        ├── S002/
        └── Unsorted/      ← Conflicts and failures
```

### Configuration
Current configuration in `config/agent.json`:
```json
{
  "validation": {
    "enableDataOverwriteProtection": true  // Set to false to allow full data overwrites
  }
}
```

Log level for conflicts can be controlled in `config/jotform_config.json`:
```json
{
  "logging": {
    "DATA_OVERWRITE_DIFF": false  // To disable conflict logging (not recommended)
  }
}
```

**Note**: When `enableDataOverwriteProtection` is `false`, conflict detection is completely bypassed and files update submissions directly.

---

## Support

### Need Help?
1. **Check the logs** first: `logs/YYYYMMDD_processing_agent.csv`
2. **Review this guide** for common scenarios
3. **Contact your system administrator** for technical issues
4. **Escalate to development team** for system bugs

### Reporting Issues
When reporting a conflict issue, include:
- ✅ **PDF filename** (sessionkey)
- ✅ **Log excerpt** (DATA_OVERWRITE_DIFF entry)
- ✅ **Conflict details** (which fields, what values)
- ✅ **What you tried** to resolve it
- ✅ **Screenshots** if helpful

---

## Appendix: Example Workflow

### Example: Handling a Conflict

**1. Discover Conflict**
```
- File found in Unsorted/: 13268_20250904_14_07.pdf
- Log entry: "ERV_Q1 (QID 30): existing='A' → new='B'"
```

**2. Investigate**
```
- Check JotForm: Student 13268 has submission from 2025-09-04 14:07
- Existing ERV_Q1 = "A"
- New PDF has ERV_Q1 = "B"
- Question: Which is correct?
```

**3. Determine Cause**
```
- Review PDF: Student marked "B" on paper
- Review JotForm history: "A" was entered on 2025-09-04 at 14:30
- Conclusion: Original data entry was correct, new PDF is duplicate assessment
```

**4. Resolve**
```
- Action: Keep existing data (Option A)
- Move PDF to backup folder: Unsorted/Archive/2025-10/
- Delete JSON from Unsorted/
- Document: "13268_20250904_14_07 - Duplicate assessment, kept original"
```

**5. Follow Up**
```
- Check if other PDFs from same batch have issues
- Remind operators to verify session keys before uploading
- Update operator training if needed
```

---

**End of Guide**
