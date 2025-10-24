# TEMP/assets Directory

This directory contains test-specific asset files for the pipeline test page.

## Test-Isolated Environment

The test page `test-pipeline-core-id.html` uses **test-specific versions** of files to avoid interfering with the main checking system:

- **Credentials**: Embedded directly in the HTML (no credentials.json needed)
- **Qualtrics Mapping**: Embedded directly in the HTML (no qualtrics-mapping.json needed)
- **Task Validator**: Test-specific `task-validator-test.js` in TEMP/ folder
- **Task Definitions**: Complete set of task JSON files in `tasks/` subdirectory

## Files

### tasks/ subdirectory
Contains copies of all task definition files from `assets/tasks/`:

- **survey-structure.json**: Task metadata file (15 tasks)
- **Task definitions**: ERV.json, SYM.json, NONSYM.json, TheoryofMind.json, ChineseWordReading.json, TEC_Female.json, TEC_Male.json, MathPattern.json, CCM.json, HeadToeKneeShoulder.json, EPN.json, CM.json, FineMotor.json, TGMD.json, MF.json, background.json

## Why This Approach?

Per issue requirements: "I would expect you to use another file instead of the those that are already used by the main core checking system. build these files in the temp folder instead."

Benefits:
1. **Test Isolation**: Test page doesn't interfere with production checking system
2. **No 404 Errors**: All task files are local to TEMP folder
3. **Self-Contained**: Test environment is independent and portable
4. **Safe Testing**: Changes to test files don't affect production system

## Maintenance

If task definition files are updated in the main `assets/tasks/` directory, sync them here:

```bash
# From repository root
cp assets/tasks/*.json TEMP/assets/tasks/
```

If credentials or mapping data needs to be updated, edit them directly in the `test-pipeline-core-id.html` file (they are embedded as JavaScript constants).
