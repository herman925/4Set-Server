# Qualtrics _TEXT Field Extraction Fix

## Issue Summary
**Problem**: Qualtrics data not showing after transformation, even though responses exist in Qualtrics online.

**Symptoms**:
- JotForm shows N records for a Core ID
- Qualtrics shows 0 records after transformation
- Task validation shows "answered = 0, Correct 0, Not Started"
- Checking system displays incomplete data

## Root Cause
The Qualtrics transformer's `extractValue` function was not correctly handling text entry fields (`_TEXT` suffix) when Qualtrics stores them directly.

### Technical Details
- **Field mapping**: `"student-id": "QID125287935_TEXT"`
- **Old behavior**: Strip `_TEXT` and look for `values["QID125287935"]`
- **Issue**: Some Qualtrics responses store values directly at `values["QID125287935_TEXT"]`
- **Impact**: Without `student-id`, no `coreId` is generated, preventing data merge

## Fix Applied
Updated `extractValue` function in `qualtrics-transformer.js`:

```javascript
// Handle text entry sub-fields: "QID125287935_TEXT"
if (qidSpec.endsWith('_TEXT')) {
  // Try direct lookup first (some Qualtrics responses store _TEXT fields directly)
  if (values[qidSpec] !== undefined && values[qidSpec] !== null) {
    return String(values[qidSpec]);
  }
  
  // Fall back to stripping _TEXT and looking for base QID
  const qid = qidSpec.replace('_TEXT', '');
  const textData = values[qid];
  
  if (!textData) {
    return '';
  }
  
  // Sometimes text is nested under 'text' property
  if (typeof textData === 'object' && textData.text) {
    return textData.text;
  }
  
  return String(textData);
}
```

## Supported Formats
The fix now handles all three Qualtrics response formats:

1. **Direct _TEXT storage** (new format)
   ```json
   {
     "values": {
       "QID125287935_TEXT": "10275"
     }
   }
   ```

2. **Base QID storage** (old format)
   ```json
   {
     "values": {
       "QID125287935": "10275"
     }
   }
   ```

3. **Nested text property**
   ```json
   {
     "values": {
       "QID125287935": { "text": "10275" }
     }
   }
   ```

## Priority Handling
When both formats exist, the fix prioritizes direct `_TEXT` field:
```json
{
  "values": {
    "QID125287935_TEXT": "10275",  // ✅ This value is used
    "QID125287935": "99999"          // ❌ This is ignored
  }
}
```

## Testing
Two test pages are provided to verify the fix:

### 1. Comprehensive Test Suite
**File**: `TEMP/test-text-field-extraction.html`
**Purpose**: Tests all 4 scenarios with different _TEXT field storage formats
**Usage**: Open in browser to see all test cases pass

### 2. Core ID 10275 Verification
**File**: `TEMP/verify-core-id-10275-fix.html`
**Purpose**: Demonstrates the specific fix for the reported issue
**Usage**: Shows before/after comparison with simulated data

## Affected Components
- `assets/js/qualtrics-transformer.js` - Main transformer (PRODUCTION)
- `TEMP/qualtrics-transformer-test.js` - Test version for `test-pipeline-core-id.html`

## Backward Compatibility
✅ **Fully backward compatible** - The fix maintains support for all existing response formats while adding support for the direct `_TEXT` format.

## When to Suspect This Issue
You might encounter this issue if:
- Qualtrics responses exist online but don't show in the checking system
- Task validation shows "Not Started" despite completed responses
- JotForm + Qualtrics merge results in 0 Qualtrics records
- Console logs show "Qualtrics record missing coreId"

## Related Fields
This fix applies to all fields in `qualtrics-mapping.json` that end with `_TEXT`:
- `student-id` (QID125287935_TEXT) - **Critical for Core ID matching**
- `school-id` (QID125287936_TEXT)
- All date fields (ERV_Date, CWR_Date, etc.)
- All text entry fields (ToM_Q3a_TEXT, CM_Q1_TEXT, etc.)

## Prevention
To prevent similar issues in the future:
1. Always test new Qualtrics fields with sample responses
2. Check both direct and nested field lookups
3. Use the test pages to verify extraction works correctly
4. Monitor console logs for "missing coreId" warnings

## Additional Notes
- The fix does NOT affect matrix fields (`#` notation) or simple QID fields
- Embedded data fields (no QID prefix) are handled separately and are not affected
- The fix is transparent to the data merger and task validator

## References
- Issue: "Tested with 10275 as Core ID for test-pipeline-core-id.html but data not shown"
- PR: [Link to PR]
- Related files:
  - `assets/qualtrics-mapping.json` - Field mappings
  - `assets/js/data-merger.js` - Data merging logic
  - `assets/js/task-validator.js` - Task validation
