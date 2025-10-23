# User Guide: Qualtrics TGMD Integration

## Overview

The 4Set system now supports fetching TGMD (Test of Gross Motor Development) assessment data from Qualtrics surveys and merging it with JotForm submission data. This provides a unified view of all assessment data in one place.

## Key Features

- **Automatic Data Merging**: Qualtrics TGMD responses are automatically merged with JotForm data by sessionkey
- **Conflict Resolution**: When both sources have TGMD data, Qualtrics values take precedence (as the primary TGMD platform)
- **Offline Caching**: Merged data is cached locally for instant access
- **Progress Tracking**: Real-time progress display during Qualtrics sync
- **Conflict Reporting**: Detailed statistics on data conflicts and resolution

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
   - Total records
   - Records with TGMD data
   - TGMD from Qualtrics vs JotForm
   - Any conflicts detected

### Step 3: View Merged Data

After syncing, navigate to student detail pages to see:

- TGMD assessment data populated from Qualtrics
- Data source indicator showing "Source: Qualtrics"
- All other assessment data from JotForm

## Understanding the Data

### Data Sources

- **JotForm**: Primary source for all non-TGMD assessments (ERV, SYM, CM, etc.)
- **Qualtrics**: Primary source for TGMD assessments (Hand/Leg preference, Hop, Jump, Slide, etc.)

### Merge Logic

The system merges data as follows:

1. **By Sessionkey**: Records are matched using the unique `sessionkey` field
2. **Qualtrics Priority**: For TGMD fields, Qualtrics data overwrites JotForm data
3. **Non-TGMD Fields**: All non-TGMD fields remain from JotForm
4. **Conflict Detection**: When values differ, both are logged but Qualtrics is used

### Field Mapping

Qualtrics uses Question IDs (QIDs) that are mapped to standard field names:

| Standard Field | Qualtrics QID | Description |
|---------------|---------------|-------------|
| TGMD_Hand | QID126166418 | Hand preference |
| TGMD_Leg | QID126166419 | Leg preference |
| TGMD_111_Hop_t1 | QID126166420#1_1 | Hopping criterion 1, trial 1 |
| ... | ... | 45 total TGMD fields |

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
- Required fields: `qualtricsApiToken`, `qualtricsDatacenter`, `qualtricsSurveyId`

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
