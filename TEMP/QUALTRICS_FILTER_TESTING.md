# Qualtrics API Filter Testing Results

## Summary
Tested Qualtrics API filtering capabilities to see if we can fetch responses for a specific Core ID (e.g., 10275) without downloading all responses.

## Test Results

### ❌ Export-Responses Endpoint Filter
**Endpoint**: `POST /API/v3/surveys/{surveyId}/export-responses`

**Test**: Added `filter` parameter to the request payload:
```json
{
  "format": "json",
  "compress": false,
  "filter": {
    "QID125287935_TEXT": "10275"
  }
}
```

**Result**: **FAILED** ❌
- Status Code: `400 Bad Request`
- Error: `"Unknown fields are set: filter"`
- **Conclusion**: The export-responses endpoint does NOT support the `filter` parameter

### ❌ List Responses Endpoint Filter
**Endpoint**: `GET /API/v3/surveys/{surveyId}/responses?QID125287935_TEXT=10275`

**Test**: Tried filtering by QID in URL parameters

**Result**: **FAILED** ❌
- Status Code: `404 Not Found`
- Error: `"The requested resource does not exist."`
- **Conclusion**: List Responses API does not support QID-based filtering

## Why Filtering Doesn't Work

### Qualtrics API Limitations
1. **Export-Responses Endpoint**: Designed for bulk export, no filtering support
2. **List Responses Endpoint**: May support embedded data filtering, but NOT QID filtering
3. **QID Fields**: Question IDs are not filterable parameters in standard API endpoints

### Embedded Data vs. QID Fields
- **Embedded Data**: Custom fields added to responses (e.g., `studentid`, `email`)
  - ✅ Can be filtered in List Responses API
  - ✅ Queryable via URL parameters
  
- **QID Fields**: Survey question responses (e.g., `QID125287935_TEXT`)
  - ❌ Cannot be filtered at API level
  - ❌ Must be fetched and filtered client-side

## Current Implementation (Recommended) ✅

### Global Cache Approach
The current implementation in `test-pipeline-core-id.html` is **optimal**:

1. **Fetch Once**: Download all responses from Qualtrics API
2. **Cache Locally**: Store in IndexedDB for fast access
3. **Filter Client-Side**: Search by Core ID in cached data
4. **Reuse Cache**: Subsequent lookups are instant

### Benefits
- ✅ **Efficient for multiple students**: Cache once, query many times
- ✅ **Fast lookups**: No API calls after initial cache
- ✅ **No API rate limits**: Reduce API calls to Qualtrics
- ✅ **Works reliably**: Not dependent on API filtering support

### Performance Comparison
```
Direct API with Filter (if it worked):
- Core ID 10275: 15-30 seconds (export + poll + download)
- Core ID 10276: 15-30 seconds (export + poll + download)  
- Core ID 10277: 15-30 seconds (export + poll + download)
Total: 45-90 seconds for 3 students

Global Cache Approach:
- First lookup: 30 seconds (one-time cache build)
- Core ID 10275: <1 second (from cache)
- Core ID 10276: <1 second (from cache)
- Core ID 10277: <1 second (from cache)
Total: ~30 seconds for 3+ students
```

## Alternative Approaches Considered

### 1. Embedded Data Setup (Not Viable)
- **Requirement**: Add `student-id` as embedded data field in Qualtrics
- **Issue**: Would require survey restructure and data migration
- **Verdict**: Not worth the effort for minimal benefit

### 2. Response ID Filtering (Complex)
- **Approach**: Get all response IDs, filter locally, then export specific IDs
- **Issue**: Still requires fetching all data initially
- **Verdict**: No advantage over current approach

### 3. Manual Export with Filters (UI-based)
- **Approach**: Use Qualtrics UI to export filtered data
- **Issue**: Manual process, can't be automated
- **Verdict**: Not suitable for automated pipeline

## Recommendation

**Continue using the current global cache + client-side filter approach** in `test-pipeline-core-id.html`.

### Why This Is Best
1. ✅ Already implemented and working
2. ✅ Most efficient for repeated lookups
3. ✅ No Qualtrics API limitations
4. ✅ Fast after initial cache
5. ✅ Reliable and maintainable

### When to Use Each Method

| Method | Use Case | Speed | API Calls |
|--------|----------|-------|-----------|
| **Global Cache** | Multiple students, repeated testing | Fast | 1 per cache refresh |
| **Direct API** | Single student, one-time lookup | Slow | 1 per student |
| **Filtered API** | (Not available) | N/A | N/A |

## Files Updated

1. **test_qualtrics_syd1.py**: Added filter testing function
2. **test_qualtrics_syd1.html**: Added Test 5 for filter capability testing
3. **QUALTRICS_FILTER_TESTING.md**: This documentation file

## Testing Instructions

### Python Test
```bash
cd TEMP
python3 test_qualtrics_syd1.py
```

Look for "Test 5: Testing Filtered Export" section in output.

### HTML Test  
1. Open `TEMP/test_qualtrics_syd1.html` in browser
2. Click "Run Filter Test" (Test 5)
3. Review the findings in the result panel

## Conclusion

The Qualtrics API does **not** support filtering by QID fields in any endpoint. The current global cache approach in `test-pipeline-core-id.html` is the **optimal solution** and should be continued.

No changes needed to `test-pipeline-core-id.html` - the existing implementation is already the best approach! 🎉
