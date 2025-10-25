# TEMP Folder - Test Files and Documentation

This folder contains test scripts, test-specific module versions, and development tools that are not part of the production system.

## Purpose

The TEMP folder serves as a development and QA workspace for:
- **Testing**: Isolated test scripts that don't affect production code
- **Validation**: Tools to verify production behavior without modifying main files
- **Development**: Prototyping and debugging utilities

## Contents

### Test Scripts (HTML/JavaScript)

Test pages for validating specific functionality:

- **`test-pipeline-core-id.html`** - Tests complete JotForm + Qualtrics merge pipeline for individual students
- **`test_qualtrics_syd1.html`** - Tests Qualtrics API connection and export workflow
- **`test-grade-detector-compatibility.html`** - Browser-based grade detection tests
- **`test-grade-detector-node.js`** - Node.js automated grade detection tests
- **`test-validator-compatibility.html`** - Task validator compatibility tests
- **`test-text-field-extraction.html`** - Qualtrics _TEXT field extraction tests
- **`test-jotform-filter.html`** - JotForm API filter testing (`:matches` operator validation)
- **`verify-core-id-10275-fix.html`** - Specific bug fix verification

### Test-Specific Module Versions

These files provide UMD (Universal Module Definition) pattern versions of production modules, enabling both browser and Node.js testing:

- **`grade-detector-test.js`** - Test version with Node.js exports (production: `assets/js/grade-detector.js`)
- **`task-validator-test.js`** - Test version with Node.js exports (production: `assets/js/task-validator.js`)
- **`jotform-cache-test.js`** - Test version with 502 error handling enhancements
- **`qualtrics-transformer-test.js`** - Test version with multi-path resolution for mapping file

**Why separate test versions?**
- Production files are optimized for browser-only usage
- Test files need to work in both browser and Node.js environments
- Allows automated testing without modifying production code
- Provides sandbox for testing experimental features

### Python Test Scripts

- **`test_jotform_api.py`** - Direct JotForm API testing
- **`test_qualtrics_syd1.py`** - Python-based Qualtrics API testing
- **`test_data_overwrite_protection.ps1`** - Data safety validation
- **`test_chunked_update.ps1`** - Batch update testing
- **`test_jotform_filter.ps1`** - PowerShell JotForm filter tests

### Batch/Shell Scripts

Startup scripts for local development:

- **`start_pipeline_test.bat`** (Windows) - Starts CORS proxy and opens test page
- **`start_pipeline_test.sh`** (Linux/Mac) - Same functionality for Unix systems
- **`test_jotform.bat`** - JotForm API testing launcher
- **`test_jotform.sh`** - Unix version
- **`test_jotform_filters.ps1`** - PowerShell filter testing

### Documentation

- **`README_PIPELINE_TEST.md`** - Comprehensive guide for pipeline test tool including:
  - How to use test-pipeline-core-id.html
  - Direct API vs Global Cache testing methods
  - Performance metrics and comparison
  - Troubleshooting guide
  - Technical implementation details

### Assets

- **`assets/`** - Test-specific assets (icons, images) separate from production assets

## Key Differences: Test vs Production

| Aspect | Production Files | Test Files (TEMP) |
|--------|-----------------|------------------|
| **Location** | `assets/js/` | `TEMP/` |
| **Module Pattern** | Browser-only (window global) | UMD (browser + Node.js) |
| **Purpose** | Production use | Testing & validation |
| **Dependencies** | Minimal external dependencies | May include test-only libraries |
| **Error Handling** | User-friendly messages | Detailed debugging output |
| **Performance** | Optimized for production | Includes performance metrics |

## Using Test Files

### Browser Tests

1. **Local Server Required** (for CORS):
   ```bash
   # Windows
   .\start_pipeline_test.bat
   
   # Linux/Mac
   ./start_pipeline_test.sh
   
   # Manual
   python3 ../proxy_server.py --port 3000 --host 127.0.0.1
   ```

2. Open the appropriate test HTML file in your browser

3. Check browser console (F12) for detailed debugging output

### Node.js Tests

Run directly with Node.js:
```bash
node test-grade-detector-node.js
# Expected output: 12/12 tests passed
```

### Python Tests

Ensure dependencies are installed:
```bash
pip install -r ../requirements.txt
python test_qualtrics_syd1.py
```

## When to Use TEMP Files

✅ **Use TEMP files when:**
- Testing new features before production deployment
- Validating bug fixes with isolated test cases
- Running automated test suites (Node.js)
- Debugging production issues without modifying main code
- Measuring performance differences between implementations

❌ **Don't use TEMP files for:**
- Production deployments
- User-facing features
- Main checking system functionality
- Permanent solutions (prototype here, then move to production)

## Documentation Consolidation (October 2025)

Previously, TEMP contained 19+ markdown files with implementation notes, bug fix documentation, and historical PR/issue summaries. These have been consolidated:

**Cache System Documentation** → `PRDs/jotform_qualtrics_integration_prd.md`
- Cache architecture details
- Cache operations (build, delete, refresh)
- Data merging strategies
- Performance considerations
- Troubleshooting guide

**Implementation Notes** → `PRDs/checking_system_prd.md`
- Task validator fixes and UMD pattern
- TGMD matrix-radio scoring
- Qualtrics text field extraction
- Status light calculation fixes
- Grade detection logic
- JotForm API filter implementation
- Qualtrics API bug fixes
- Data transformation fixes

**Why consolidate?**
- Reduced clutter in TEMP folder
- Easier to find up-to-date information
- PRDs are the authoritative source for production features
- Test documentation (README_PIPELINE_TEST.md) remains for developer reference
- Git history preserves all historical issue/PR summaries

## Cleanup Policy

TEMP files should be periodically reviewed and cleaned:

1. **Keep**: Active test files, test modules, and current test documentation
2. **Archive**: Outdated test files (move to `TEMP/archive/` if needed for reference)
3. **Remove**: Duplicate documentation now consolidated in PRDs
4. **Update**: README_PIPELINE_TEST.md when test procedures change

## Related Documentation

**Production Documentation:**
- `PRDs/checking_system_prd.md` - Main system architecture and implementation notes
- `PRDs/jotform_qualtrics_integration_prd.md` - API integration and cache system
- `PRDs/checking_system_pipeline_prd.md` - Data pipeline specifications

**User Guides:**
- `USER_GUIDE_CHECKING_SYSTEM.md` - End-user documentation
- `USER_GUIDE_QUALTRICS_TGMD.md` - Qualtrics integration guide
- `user_guide_*.html` - Interactive help pages

**Configuration:**
- `config/checking_system_config.json` - System settings
- `config/jotform_config.json` - API and cache parameters

---

**Last Updated**: 2025-10-25  
**Maintainer**: 4Set Development Team  
**Purpose**: Test workspace and development tools
