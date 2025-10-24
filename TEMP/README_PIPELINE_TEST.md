# JotForm + Qualtrics Merge Pipeline Test Tool

## Overview

This test tool (`test-pipeline-core-id.html`) validates the complete data pipeline for merging JotForm and Qualtrics data for individual students identified by their Core ID. It emulates the same process used by the checking system to display student data in the drilldown view.

## Purpose

The primary goal is to verify that:
1. JotForm API filtering works correctly using the `:matches` operator on sessionkey
2. Qualtrics TGMD data can be fetched and transformed properly
3. Data from both sources merges correctly by Core ID
4. Task validation produces accurate completion metrics with proper termination rules
5. The final output matches what students see in the checking system drilldown page

## How It Works

### Pipeline Steps

The test executes the following steps in sequence:

1. **Load Credentials** - Reads API keys and configuration from `assets/credentials.json`
2. **Fetch JotForm Data** - Uses the `:matches` filter on sessionkey field (QID 3) to retrieve submissions
3. **Fetch Qualtrics Data** - Exports TGMD responses using the export-poll-download API flow
4. **Transform Qualtrics** - Converts Qualtrics QID-based format to standardized field names
5. **Merge Data** - Combines JotForm + Qualtrics data by Core ID (Qualtrics TGMD fields take precedence)
6. **Validate Tasks** - Applies termination rules and calculates completion metrics for all tasks

### Key Features

- **Visual Status Indicators**: Color-coded lights for task completion status
  - 🟢 Green: Complete (100%)
  - 🟡 Yellow: Post-term (terminated/timed out, but complete up to termination point)
  - 🔴 Red: Incomplete (<100%)
  - ⚪ Grey: Not started (0%)

- **Real-time Progress**: Watch each pipeline step execute with status updates

- **Comprehensive Results**: Displays student overview, task validation results, and summary statistics

- **Debug Inspector**: View raw data at each stage (JotForm, Qualtrics, merged, validation)

## Usage

### Prerequisites

1. **Credentials File**: Ensure `assets/credentials.json` exists with valid credentials:
   ```json
   {
     "jotformApiKey": "your-jotform-api-key",
     "jotformFormId": "your-form-id",
     "qualtricsApiKey": "your-qualtrics-api-key",
     "qualtricsDatacenter": "syd1",
     "qualtricsSurveyId": "your-survey-id"
   }
   ```

2. **Web Server**: The file must be served via HTTP (not opened directly as `file://`)
   ```bash
   # From repository root
   python3 -m http.server 8080
   # Then open: http://localhost:8080/TEMP/test-pipeline-core-id.html
   ```

### Running a Test

1. **Enter Core ID**: Input a numeric Core ID (e.g., `10261`) - do NOT include the "C" prefix
2. **Click "Run Pipeline Test"**: The pipeline will execute all steps automatically
3. **Review Results**: 
   - Check the student overview section
   - Review task completion status with color indicators
   - Examine summary statistics
   - Optionally inspect raw data for debugging

### Example Core IDs

Based on the issue description, you can test with Core IDs like:
- `10261` (referenced in test files)
- Any valid Core ID from your JotForm submissions

## Expected Output

### Student Overview
- Core ID with "C" prefix (e.g., C10261)
- Student name (from JotForm "child-name" field)
- Count of JotForm submissions found
- Count of Qualtrics responses found

### Task Validation Results
Each task displays:
- **Status Light**: Color-coded completion status
- **Answered**: Number of questions answered / total questions
- **Correct**: Number of correct answers
- **Accuracy**: Percentage of answered questions that are correct
- **Progress Bar**: Visual representation of completion percentage

### Summary Statistics
- Total count of tasks in each status category:
  - Complete (green)
  - Post-term (yellow)
  - Incomplete (red)
  - Not started (grey)

### Raw Data Inspector
Four expandable sections showing:
1. **JotForm Merged Answers**: Combined JotForm data (earliest non-empty wins)
2. **Qualtrics Transformed Data**: TGMD responses in standardized format
3. **Merged Data (Final)**: Combined JotForm + Qualtrics dataset
4. **Validation Results (Full)**: Complete task validator output with all metrics

## Technical Details

### JotForm API Filter

Uses the working `:matches` operator discovered in October 2025:
```javascript
const filter = { "q3:matches": coreId };
```

This filters on the sessionkey field (QID 3) which has format: `{studentId}_{yyyymmdd}_{hh}_{mm}`

**Why this works**: The `:matches` operator performs server-side pattern matching, returning only submissions where the sessionkey contains the student ID. This is significantly more efficient than downloading all submissions and filtering client-side.

### Qualtrics Export Flow

1. **POST** `/surveys/{surveyId}/export-responses` - Start export
2. **GET** `/surveys/{surveyId}/export-responses/{progressId}` - Poll until complete
3. **GET** `/surveys/{surveyId}/export-responses/{fileId}/file` - Download JSON

### Data Merging Strategy

- **JotForm merging**: Multiple submissions merged using "earliest non-empty value wins"
- **Qualtrics merging**: Multiple responses merged using the same principle
- **Cross-source merging**: Qualtrics TGMD fields take precedence over JotForm for TGMD_* fields

### Task Validation

Uses the centralized `TaskValidator` module which implements:
- **Termination Rules**: Stage-based (ERV, CM), consecutive incorrect (CWR), threshold-based (Fine Motor)
- **Timeout Detection**: Special handling for SYM/NONSYM 2-minute timers
- **Completion Metrics**: Questions after termination/timeout are excluded from totals
- **Accuracy Calculation**: Based on answered questions only

## Troubleshooting

### Common Issues

1. **"Credentials not available"**
   - Ensure `assets/credentials.json` exists and is valid JSON
   - Check that file paths are correct (test file is in `TEMP/` directory)

2. **"JotForm API error: 401"**
   - Verify `jotformApiKey` is correct
   - Check API key hasn't expired

3. **"Qualtrics export failed"**
   - Verify `qualtricsApiKey` and `qualtricsSurveyId` are correct
   - Check datacenter region is correct (e.g., `syd1`)

4. **"No submissions found"**
   - Verify the Core ID exists in the system
   - Check that the student has submitted data
   - Try a different Core ID

5. **"TaskValidator not available"**
   - Ensure `assets/js/task-validator.js` is loaded correctly
   - Check browser console for script loading errors

### Debug Mode

Open browser DevTools (F12) and check the Console tab for detailed logs:
- Each pipeline step logs its progress
- API responses are logged
- Merge operations show field counts
- Validation results show task-by-task processing

## Related Files

- **Main Implementation**: `assets/js/checking-system-student-page.js`
- **JotForm API**: `assets/js/jotform-api.js`
- **Qualtrics API**: `assets/js/qualtrics-api.js`
- **Qualtrics Transformer**: `assets/js/qualtrics-transformer.js`
- **Data Merger**: `assets/js/data-merger.js`
- **Task Validator**: `assets/js/task-validator.js`
- **PRD Documentation**: `PRDs/checking_system_pipeline_prd.md`

## Future Enhancements

Potential improvements to this test tool:
- [ ] Add batch testing for multiple Core IDs
- [ ] Export test results to JSON/CSV
- [ ] Compare results with production checking system
- [ ] Add performance metrics (API call timing)
- [ ] Cache Qualtrics export to avoid repeated API calls
- [ ] Add visual diff between JotForm-only vs merged data

## Notes

- This is a **testing tool** for development and QA purposes
- It uses the same logic as the production checking system
- Results should match what users see in `checking_system_4_student.html`
- The tool requires valid API credentials to function
- Qualtrics exports may take 10-30 seconds depending on data volume

---

**Created**: October 2025  
**Purpose**: Pipeline validation and QA testing  
**Location**: `/TEMP/test-pipeline-core-id.html`
