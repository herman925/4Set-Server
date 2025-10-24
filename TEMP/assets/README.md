# TEMP/assets Directory

This directory contains copies of asset files needed by test pages in the TEMP directory.

## Why This Directory Exists

The test pages in the TEMP directory (like `test-pipeline-core-id.html`) use JavaScript modules that are designed to run from the root directory of the project. These modules contain hardcoded paths like `assets/qualtrics-mapping.json`.

When the test pages run from the TEMP subdirectory, the JavaScript modules still look for files relative to their own location (e.g., `assets/qualtrics-mapping.json`), not relative to the test page. To fix this without modifying the core JavaScript files, we maintain a copy of necessary asset files in `TEMP/assets/`.

## Files

- **qualtrics-mapping.json**: Copy of `/assets/qualtrics-mapping.json` - Maps Qualtrics QID fields to standardized field names. This file is loaded by `qualtrics-transformer.js` and is required for transforming Qualtrics responses.

- **tasks/**: Directory containing copies of all task definition files from `/assets/tasks/`:
  - **survey-structure.json**: Overall survey structure and task definitions. Loaded by `task-validator.js`.
  - **[TaskName].json**: Individual task definition files (e.g., `ERV.json`, `CM.json`, `SYM.json`, etc.) containing questions, correct answers, and termination rules. May be loaded dynamically by various modules.

## Maintenance

When the main asset files are updated, remember to update the copies here:

```bash
# From repository root
cp assets/qualtrics-mapping.json TEMP/assets/
cp assets/tasks/*.json TEMP/assets/tasks/
```

## Alternative Solutions Considered

1. **Modify core JS files**: Rejected because the issue specifically requested not to modify the main checking system JavaScript.
2. **Symlinks**: Could work on Unix systems but not reliable on Windows.
3. **Relative path detection**: Would require modifying the core JS files.
4. **Current solution (file copy)**: Simple, cross-platform, and doesn't modify core files.
