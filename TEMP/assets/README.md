# TEMP/assets Directory

This directory contains a minimal set of asset files needed by the test page.

## Self-Contained Test Page

The test page `test-pipeline-core-id.html` is designed to be as self-contained as possible:

- **Credentials**: Embedded directly in the HTML (no credentials.json needed)
- **Qualtrics Mapping**: Embedded directly in the HTML (no qualtrics-mapping.json needed)
- **Task Structure**: Single file needed for TaskValidator module

## Files

- **tasks/survey-structure.json**: Task metadata file required by `task-validator.js`. This file cannot be embedded without modifying the core JavaScript modules, so a copy is maintained here.

## Why This Approach?

The test page embeds credentials and the Qualtrics mapping directly to avoid:
1. Dependency on external credential files
2. 404 errors when loading mapping data
3. Complex directory mirroring

However, `task-validator.js` still needs `tasks/survey-structure.json` because:
- It's a core JavaScript module that cannot be modified per issue requirements
- It hardcodes the path to `assets/tasks/survey-structure.json`
- The file is small (2.6KB) and rarely changes

## Maintenance

If `assets/tasks/survey-structure.json` is updated in the main directory, sync it here:

```bash
# From repository root
cp assets/tasks/survey-structure.json TEMP/assets/tasks/
```

If credentials or mapping data needs to be updated, edit them directly in the `test-pipeline-core-id.html` file (they are embedded as JavaScript constants).
