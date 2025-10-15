---
title: Processor Agent Debug Messages Reference
owner: Project Maintainers
last-updated: 2025-10-14
status: Reference Document
---

# Processor Agent Debug Messages

Documents debug messages that were implemented during development to troubleshoot and verify the upload pipeline. These messages are removed from production logs but documented here for future debugging.

## Purpose

During implementation of the Jotform upload pipeline, several debug messages were added to trace issues with:
- File path resolution for jotformquestions.json
- Credential loading from encrypted bundle
- API authentication format
- Student record lookup by Core ID

This document preserves that knowledge for future troubleshooting.

## Debug Messages Implemented

### 1. File Loading & Path Resolution

**Message**: `"DEBUG: Looking for jotformquestions.json at: {path}"`
- **Location**: Load-AgentSecrets function, after jotformquestions path construction
- **Purpose**: Verify the path where the agent looks for Jotform field mappings
- **Issue Resolved**: Initially looked in `assets/id_mapping/jotformquestions.json` but file was actually in `assets/jotformquestions.json`
- **Outcome**: Path corrected to look in assets root directory

**Code**:
```powershell
$jotformQuestionsPath = Join-Path (Split-Path $SecretsPath) "jotformquestions.json"
Write-Log -Message "DEBUG: Looking for jotformquestions.json at: $jotformQuestionsPath" -Level "INFO"
```

**Resolution**: Removed after path confirmed working

---

### 2. Credential Verification

**Message**: `"DEBUG: apiKey length: {length}, formId: {id}"`
- **Location**: Invoke-JotformUpsert function, after extracting credentials
- **Purpose**: Verify credentials were successfully decrypted and passed to upload function
- **Issue Resolved**: 401 Unauthorized errors - needed to confirm API key was present and correct length
- **Outcome**: Confirmed credentials loaded (32 chars = valid Jotform API key)

**Code**:
```powershell
$apiKey = $ApiCredentials.jotformApiKey
$formId = $ApiCredentials.jotformFormId
Write-Log -Message "DEBUG: apiKey length: $($apiKey.Length), formId: $formId" -Level "INFO" -File $FileName
```

**Resolution**: Removed after authentication method fixed (Bearer → query param)

---

### 3. Student Record Lookup

**Message**: `"DEBUG: Found student record for {coreId}"`
- **Location**: Enrich-JsonFields function, after CoreIdMap lookup
- **Purpose**: Verify student data enrichment was finding records in coreid.enc
- **Issue Resolved**: Empty jotformsubmissionid - needed to confirm lookup working before upload
- **Outcome**: Confirmed student records being found and enriched

**Alternative Message**: `"DEBUG: No student record found for CoreId='{coreId}', CoreIdMap has {count} records"`
- **Purpose**: Alert when lookup fails (e.g., Core ID mismatch)
- **Issue**: Initially searched for "13268" but map used "C13268" prefix

**Code**:
```powershell
if ($studentRecord) {
    Write-Log -Message "DEBUG: Found student record for $CoreId" -Level "INFO" -File $FileName
} else {
    Write-Log -Message "DEBUG: No student record found for CoreId='$CoreId', CoreIdMap has $($CoreIdMap.Count) records" -Level "WARN" -File $FileName
}
```

**Resolution**: Removed after Core ID prefix handling confirmed working

---

### 4. Parsing Step Trace

**Message**: `"DEBUG: About to start parsing step"`
- **Location**: Main processing function, before Python parser call
- **Purpose**: Trace execution flow to isolate where processing stalled
- **Issue Resolved**: Parser hanging or failing silently
- **Outcome**: Confirmed parsing step entry point

**Code**:
```powershell
Write-Log -Message "DEBUG: About to start parsing step" -Level "INFO" -File $fileName
```

**Resolution**: Removed after parser reliability confirmed

---

### 5. JSON Path Validation

**Message**: `"DEBUG: jsonPath='{path}', exists={bool}"`
- **Location**: Phase 2 validation, after JSON path construction
- **Purpose**: Verify parser output file was created and accessible
- **Issue Resolved**: Validation failing due to incorrect JSON path
- **Outcome**: Confirmed JSON exists before proceeding

**Code**:
```powershell
Write-Log -Message "DEBUG: jsonPath='$jsonPath', exists=$(Test-Path $jsonPath)" -Level "INFO" -File $FileName
```

**Resolution**: Kept in reduced form for validation errors

---

## Production Log Messages (Final)

After debugging complete, only these 5 messages per PDF:

1. **Queued**: `"Queued {filename}"`
2. **Moved**: `"Moved {filename} to staging"`
3. **Enriched**: `"Enriched JSON written (ready for Jotform upload)"`
4. **Upload attempt**: `"Jotform upload attempt {n} of {max}"`
5. **Upload result**:
   - Success: `"Jotform upload completed successfully: {submissionId} (took {n} attempt(s))"`
   - Update: `"Found existing Jotform submission: {id} (will update)"`
   - Failure: `"Jotform upload PERMANENTLY FAILED after {n} attempts: {error}"`

Plus filing: `"Filed {filename} to {path}"`

---

## Key Issues Resolved Through Debug Messages

### Issue 1: File Not Found
- **Symptom**: `"Jotform upload skipped: jotformquestions.json not loaded"`
- **Debug**: Added path logging
- **Root Cause**: Incorrect path (`id_mapping/jotformquestions.json` vs `jotformquestions.json`)
- **Fix**: Updated path construction

### Issue 2: Authentication Failure
- **Symptom**: `"401 (Unauthorized)"`
- **Debug**: Added credential length logging
- **Root Cause**: Using `Authorization: Bearer` header instead of `?apiKey=` query param
- **Fix**: Changed API authentication method

### Issue 3: Student Data Not Enriching
- **Symptom**: Empty child-name, class-id fields
- **Debug**: Added CoreIdMap lookup logging
- **Root Cause**: Searching for "13268" but map key was "C13268"
- **Fix**: Updated Core ID extraction to preserve "C" prefix

### Issue 4: Parser Errors
- **Symptom**: `"Cannot index into a null array"`
- **Debug**: Added execution trace before parser
- **Root Cause**: Null reference in upload function
- **Fix**: Added null checks for jotformQuestions bundle

---

## Troubleshooting Guide

If you need to re-enable debug messages for troubleshooting:

### 1. Enable Path Debugging
```powershell
# In Load-AgentSecrets function
Write-Log -Message "DEBUG: Looking for jotformquestions.json at: $jotformQuestionsPath" -Level "INFO"
```

### 2. Enable Credential Debugging
```powershell
# In Invoke-JotformUpsert function (DO NOT log actual keys!)
Write-Log -Message "DEBUG: apiKey length: $($apiKey.Length), formId: $formId" -Level "INFO" -File $FileName
```

### 3. Enable Student Lookup Debugging
```powershell
# In Enrich-JsonFields function
if ($studentRecord) {
    Write-Log -Message "DEBUG: Found student record for $CoreId" -Level "INFO" -File $FileName
} else {
    Write-Log -Message "DEBUG: No student record found for CoreId='$CoreId'" -Level "WARN" -File $FileName
}
```

### 4. Enable JSON Path Debugging
```powershell
# In Phase 2 validation
Write-Log -Message "DEBUG: jsonPath='$jsonPath', exists=$(Test-Path $jsonPath)" -Level "INFO" -File $FileName
```

---

## Notes

- Debug messages should always be prefixed with `"DEBUG:"` for easy filtering
- Never log sensitive data (passwords, full API keys, PII)
- Use INFO level for trace messages, WARN for unexpected states
- Remove debug messages after issue is resolved and verified in production
- This document preserves institutional knowledge for future debugging sessions
