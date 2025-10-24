# User Guide: Qualtrics Data Integration

## Overview

The 4Set system now supports fetching **all assessment task data** from Qualtrics surveys and merging it with JotForm submission data. This includes TGMD (Test of Gross Motor Development) as well as all other tasks such as ERV, SYM, TOM, CM, CWR, HTKS, TEC, and more. This provides a unified view of all assessment data in one place.

> **⚠️ Important Update (October 2024):** Qualtrics has deprecated the `au1.qualtrics.com` datacenter. The system now uses `syd1.qualtrics.com` (Sydney datacenter). If you encounter 400 Bad Request errors when syncing with Qualtrics, please ensure your `credentials.enc` file has been updated with `qualtricsDatacenter: "syd1"` instead of `"au1"`. Contact your system administrator for assistance.

> **📝 Credential Field Name:** The correct field name in `credentials.enc` is `qualtricsApiKey` (not `qualtricsApiToken`). The system code supports both for backwards compatibility, but all new configurations should use `qualtricsApiKey`.

## Key Features

- **Complete Data Integration**: Qualtrics responses for **all tasks** are automatically merged with JotForm data by sessionkey
- **Comprehensive Task Coverage**: Merges data for TGMD, ERV, SYM, TOM, CM, CWR, HTKS, TEC, and all other assessment tasks
- **Conflict Resolution**: When both sources have data for the same field, Qualtrics values take precedence
- **Offline Caching**: Merged data is cached locally for instant access
- **Progress Tracking**: Real-time progress display during Qualtrics sync
- **Conflict Reporting**: Detailed statistics on data conflicts and resolution
- **Grade Detection**: Automatic K1/K2/K3 classification based on assessment dates

## How to Use

### Step 1: Build JotForm Cache

Before syncing with Qualtrics, you must first have JotForm data cached:

1. Open the checking system home page
2. Enter the system password to decrypt credentials
3. Click the **"System Not Ready"** red pill
4. Click **"Sync with Jotform"**
5. Wait for the cache to build (~90 seconds for 544 submissions)
6. The pill will turn green showing **"System Ready"**

### Step 2: Refresh with Qualtrics

Once JotForm data is cached, you can fetch and merge Qualtrics TGMD data:

1. Click the green **"System Ready"** pill
2. In the modal that appears, click **"Refresh with Qualtrics"** (purple button)
3. A progress modal will appear showing the sync status:
   - Starting Qualtrics export (5-10%)
   - Export progress polling (10-40%)
   - Downloading responses (45-60%)
   - Transforming data (65%)
   - Merging datasets (70-80%)
   - Updating cache (85-100%)
4. When complete, a summary modal shows:
   - Total records processed
   - Records with Qualtrics data
   - Data merged from both sources
   - Any conflicts detected and resolved

### Step 3: View Merged Data

After syncing, navigate to student detail pages to see:

- **All task data** from Qualtrics (TGMD, ERV, SYM, TOM, CM, CWR, HTKS, TEC, etc.)
- Data source indicators showing which fields came from Qualtrics vs JotForm
- Automatically calculated grade (K1/K2/K3) based on assessment dates
- Unified view combining the best data from both sources

## Understanding the Data

### Data Sources

- **JotForm**: Form submission data from PDF uploads (all assessment tasks)
- **Qualtrics**: Web survey data (all assessment tasks including TGMD, ERV, SYM, TOM, CM, CWR, HTKS, TEC, etc.)

### Merge Logic

The system intelligently merges data from both sources using a **two-level merge strategy**:

#### Level 1: Within-Source Merging (Earliest Non-Empty Wins)

When a student has **multiple submissions** from the same data source:

- **JotForm**: Multiple JotForm submissions are sorted by `created_at` (earliest first). For each field, the **earliest non-empty value wins**.
- **Qualtrics**: Multiple Qualtrics responses are sorted by `recordedDate` (earliest first). For each field, the **earliest non-empty value wins**.

This matches the JotForm API's native behavior and ensures consistency across all data sources.

#### Level 2: Cross-Source Merging (Qualtrics Priority)

When merging Qualtrics data INTO JotForm data:

1. **By Sessionkey**: Records are matched using the unique `sessionkey` field (format: `coreId_YYYYMMDD_HH_MM`)
2. **Qualtrics Priority**: When both JotForm and Qualtrics have data for the same field, **Qualtrics data takes precedence**
3. **Complete Field Merge**: ALL Qualtrics fields are merged (not just TGMD), including:
   - TGMD: Gross motor development assessments
   - ERV: Expressive vocabulary
   - SYM: Symbolic understanding
   - TOM: Theory of mind
   - CM: Counting and magnitude
   - CWR: Chinese word reading
   - HTKS: Head-toes-knees-shoulders
   - TEC: Test of emotional comprehension
   - And all other assessment tasks
4. **Conflict Detection**: When values differ, both are logged for audit purposes, but Qualtrics is used
5. **Grade Assignment**: Automatically determines K1/K2/K3 based on assessment date using August-July school year boundaries

**Example:**
- Student has 3 JotForm submissions → Earliest non-empty values merged into one JotForm record
- Student has 2 Qualtrics responses → Earliest non-empty values merged into one Qualtrics record
- Final merge: Qualtrics record overwrites matching fields in JotForm record

### Field Mapping

Qualtrics uses Question IDs (QIDs) that are automatically mapped to standard field names. The system uses `assets/qualtrics-mapping.json` which contains **632 field mappings** covering all assessment tasks:

**Example TGMD Mappings:**

| Standard Field | Qualtrics QID | Description |
|---------------|---------------|-------------|
| TGMD_Hand | QID126166418 | Hand preference |
| TGMD_Leg | QID126166419 | Leg preference |
| TGMD_111_Hop_t1 | QID126166420#1_1 | Hopping criterion 1, trial 1 |

**Example Other Task Mappings:**

| Standard Field | Qualtrics QID | Task |
|---------------|---------------|------|
| ERV_Q1 | QID123456789 | Expressive Vocabulary Q1 |
| SYM_Q1 | QID987654321 | Symbolic Understanding Q1 |
| TOM_Q1 | QID456789123 | Theory of Mind Q1 |

**Total**: 632 fields mapped across all assessment tasks

## Troubleshooting

### "Qualtrics modules not loaded" Error

**Problem**: Required JavaScript modules are not loaded

**Solution**: 
- Refresh the page (Ctrl+F5 or Cmd+Shift+R)
- Ensure you're accessing the page from the correct URL (not a local file)
- Check browser console for JavaScript errors

### "Qualtrics credentials not found" Error

**Problem**: Credentials file doesn't contain Qualtrics API credentials

**Solution**:
- Contact system administrator to add Qualtrics credentials to `credentials.enc`
- Required fields: `qualtricsApiKey`, `qualtricsDatacenter`, `qualtricsSurveyId`

### "Bad Request" Error (400) - Deprecated Datacenter

**Problem**: Qualtrics API returns 400 Bad Request error, possibly with timeout messages

**Cause**: The `au1.qualtrics.com` datacenter has been deprecated by Qualtrics and replaced with `syd1.qualtrics.com` (Sydney datacenter)

**Solution**:
- Update `qualtricsDatacenter` in `credentials.enc` from `"au1"` to `"syd1"`
- Contact system administrator if you don't have access to update credentials
- After updating credentials, clear your cache and try syncing again

### "Invalid Qualtrics API token" Error (401)

**Problem**: API token is incorrect or expired

**Solution**:
- Verify API token in Qualtrics account settings
- Generate a new API token if expired
- Update `credentials.enc` with new token

### "TGMD survey not found" Error (404)

**Problem**: Survey ID is incorrect or survey was deleted

**Solution**:
- Verify survey ID in Qualtrics
- Update `qualtricsSurveyId` in `credentials.enc`

### "Rate limit exceeded" Error (429)

**Problem**: Too many API requests in a short time

**Solution**:
- Wait 60 seconds before retrying
- Avoid multiple simultaneous syncs

### Export Timeout

**Problem**: Qualtrics export takes longer than 2 minutes

**Solution**:
- Check Qualtrics system status
- Try again during off-peak hours
- Contact administrator if issue persists

## Data Conflicts

### What are conflicts?

Conflicts occur when the same TGMD field has different values in JotForm and Qualtrics. For example:

- JotForm: TGMD_Hand = "2" (Left)
- Qualtrics: TGMD_Hand = "1" (Right)

### How are conflicts resolved?

The system always uses the **Qualtrics value** for TGMD fields because:
1. Qualtrics is the primary TGMD assessment platform
2. Data is entered directly during assessment
3. Less prone to transcription errors

### Viewing conflicts

Conflicts are shown in the completion modal after sync:
- Number of conflicts detected
- Warning message if conflicts > 0

To see detailed conflict information:
1. Check browser console logs
2. Look for entries like: `[DataMerger] Conflicts detected for 10261_20251005_10_30: 1 fields`

### Conflict report (Future)

In a future update, you'll be able to:
- Export conflict report as CSV
- View conflict details in a modal
- Review all conflicting records

## Cache Management

### Cache Invalidation

The system uses a 1-hour cache lifetime. After 1 hour:
- JotForm cache is marked invalid
- Qualtrics cache remains but may be outdated
- You'll need to refresh both to get latest data

### Manual Cache Refresh

To force a fresh sync:

1. Click green **"System Ready"** pill
2. Click **"Delete Cache"** (red button)
3. Confirm deletion
4. Rebuild JotForm cache
5. Refresh with Qualtrics again

### Storage Usage

Cache storage estimates:
- JotForm cache: ~30 MB (544 submissions)
- Qualtrics cache: ~5 MB (200 responses)
- Merged cache: ~32 MB
- Validation cache: ~24 MB
- **Total: ~91 MB**

Most modern browsers support 50 MB to several GB of IndexedDB storage.

## Best Practices

### When to Sync

- **Morning**: Sync at start of day to get overnight submissions
- **After Assessment Sessions**: Re-sync after bulk TGMD assessments
- **Weekly**: Perform full refresh weekly even if no new data

### Data Quality

- **Verify Sessionkeys**: Ensure sessionkeys match between JotForm and Qualtrics
- **Check Conflicts**: Review conflict statistics after each sync
- **Report Issues**: If conflict rate > 10%, report to administrator

### Performance

- **Sync During Low Usage**: Perform syncs during off-peak hours
- **One Sync at a Time**: Don't initiate multiple syncs simultaneously
- **Monitor Progress**: Watch progress modal to ensure sync completes

## FAQ

**Q: How long does Qualtrics sync take?**

A: Typically 30-60 seconds for ~200 responses. Includes:
- Export request: 5-10 seconds
- Export processing: 15-30 seconds
- Download: 5-10 seconds
- Transform & merge: 10-15 seconds

**Q: Can I use the system while sync is in progress?**

A: No, wait for sync to complete. The modal will show "Done" when ready.

**Q: What happens if sync fails halfway?**

A: The system uses atomic operations. If sync fails, your existing cache remains unchanged. You can safely retry.

**Q: Do I need to sync with Qualtrics every time?**

A: No. Qualtrics data is cached. Only re-sync when:
- New TGMD assessments are completed
- You need latest data
- Cache is older than 1 hour

**Q: Can I see which students have Qualtrics TGMD data?**

A: Yes, in student detail pages, TGMD sections will show "Source: Qualtrics" badge when data comes from Qualtrics.

**Q: What if a student has no Qualtrics data?**

A: The system will show TGMD data from JotForm (if available) or empty TGMD fields.

**Q: How do I know if my Qualtrics credentials are correct?**

A: Try running a sync. If credentials are invalid, you'll see specific error messages:
- 401: Invalid API token
- 404: Survey not found
- Other errors: Check console log

## Technical Details

For developers and administrators, see:
- `PRDs/qualtrics_implementation_plan.md` - Complete technical specification
- `PRDs/jotform_qualtrics_integration_prd.md` - API documentation
- `assets/qualtrics-mapping.json` - Field mapping configuration
- Browser DevTools → Application → IndexedDB → JotFormCacheDB - View cached data

## Support

For issues or questions:
1. Check this guide first
2. Review browser console logs for errors
3. Contact system administrator with:
   - Error message
   - Browser console log
   - Steps to reproduce

---

**Last Updated**: 2025-10-23
**Version**: 1.0
