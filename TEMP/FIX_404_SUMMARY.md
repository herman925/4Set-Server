# Fix Summary: 404 Error for qualtrics-mapping.json

## Problem

The test page `TEMP/test-pipeline-core-id.html` was failing with the following error:

```
assets/qualtrics-mapping.json:1   Failed to load resource: the server responded with a status of 404 (NOT FOUND)
qualtrics-transformer.js:41  [QualtricsTransformer] Failed to load mapping: Error: Failed to load mapping: 404
```

## Root Cause

The test page is located in the `TEMP/` subdirectory, but the JavaScript modules it uses (`qualtrics-transformer.js`, `task-validator.js`) are designed to run from the root directory and contain hardcoded paths to asset files like `assets/qualtrics-mapping.json`.

When the test page loads these modules from `../assets/js/`, the JavaScript code still tries to load asset files using paths relative to the current page location. Since the page is in `TEMP/`, the path `assets/qualtrics-mapping.json` looks for `TEMP/assets/qualtrics-mapping.json` instead of the root-level `assets/qualtrics-mapping.json`.

## Solution

Without modifying the core JavaScript files (as requested in the issue), we created a mirror directory structure in `TEMP/assets/` containing copies of the necessary asset files:

### Files Added:

1. **TEMP/assets/qualtrics-mapping.json**
   - Copy of `/assets/qualtrics-mapping.json`
   - Required by `qualtrics-transformer.js` to map Qualtrics QID fields to standardized names

2. **TEMP/assets/tasks/** (directory)
   - Copy of `/assets/tasks/` directory
   - Contains 17 task definition JSON files
   - Required by `task-validator.js` and other validation modules

3. **TEMP/assets/README.md**
   - Documentation explaining why this directory exists
   - Maintenance instructions for keeping files in sync

4. **TEMP/verify-assets.sh**
   - Verification script to check all required assets are present
   - Can be run before testing to ensure setup is correct

### Documentation Updates:

1. **TEMP/README_PIPELINE_TEST.md**
   - Added prerequisite section about asset files
   - Added troubleshooting entry for 404 errors
   - Updated numbering in troubleshooting section

## Why This Approach?

The issue specifically requested: "Considering NOT modifying the js which is designed for the main checking system, can we supply a fix for this test page still?"

Alternative approaches considered:
- **Modifying JS files**: Would affect the main checking system (rejected)
- **Symlinks**: Not reliable on Windows systems
- **Path detection in JS**: Would require modifying the core JS files (rejected)
- **Current solution (file copies)**: Simple, cross-platform, doesn't modify core files ✓

## Testing

Run the verification script to ensure all files are in place:

```bash
cd TEMP
./verify-assets.sh
```

Expected output:
```
All required files are present!
```

## Maintenance

When asset files are updated in the main `/assets/` directory, remember to update the copies:

```bash
# From repository root
cp assets/qualtrics-mapping.json TEMP/assets/
cp assets/tasks/*.json TEMP/assets/tasks/
```

## Files Changed

- `TEMP/assets/qualtrics-mapping.json` (new)
- `TEMP/assets/tasks/*.json` (new, 17 files)
- `TEMP/assets/README.md` (new)
- `TEMP/README_PIPELINE_TEST.md` (updated)
- `TEMP/verify-assets.sh` (new)

## Impact

- ✅ Fixes the 404 error when loading qualtrics-mapping.json
- ✅ Ensures task-validator.js can load required task definitions
- ✅ No changes to core JavaScript files
- ✅ No changes to main checking system
- ✅ Test page can now run successfully from TEMP/ directory

## Future Considerations

If this becomes a maintenance burden, consider:
1. Adding a build script to automatically sync these files
2. Using a more sophisticated path resolution in the JS modules (would require modifying core JS)
3. Serving the test page from the root directory instead of TEMP/
