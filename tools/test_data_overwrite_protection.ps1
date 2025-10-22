# Test: Data Overwrite Protection Mechanism
# Tests the new conflict detection logic for update operations

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Data Overwrite Protection Test Suite" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Test helper function to create mock submission data
function New-MockSubmission {
    param(
        [hashtable]$Answers
    )
    
    $answersObj = [PSCustomObject]@{}
    foreach ($qid in $Answers.Keys) {
        $answersObj | Add-Member -NotePropertyName $qid -NotePropertyValue ([PSCustomObject]@{
            answer = $Answers[$qid]
            text = $Answers[$qid]
        })
    }
    
    return [PSCustomObject]@{
        id = "TEST_SUBMISSION_123"
        answers = $answersObj
    }
}

# Mock JotForm Questions mapping (subset for testing)
$mockMapping = @{
    'student-id' = '20'
    'child-name' = '21'
    'school-id' = '22'
    'district' = '23'
    'class-id' = '24'
    'class-name' = '25'
    'computerno' = '647'
    'ERV_Q1' = '30'
    'ERV_Q2' = '31'
    'CM_Q1' = '456'
    'Gender' = '598'
}

# Define Test-DataOverwriteConflict function (copied from processor_agent.ps1)
function Test-DataOverwriteConflict {
    param(
        [PSCustomObject]$NewData,
        [PSCustomObject]$ExistingSubmission,
        [hashtable]$JotformQuestions,
        [string]$FileName
    )
    
    # Define exception fields that are allowed to be overwritten
    $exceptionFields = @(
        'student-id',
        'child-name',
        'school-id',
        'district',
        'class-id',
        'class-name',
        'computerno'
    )
    
    $conflicts = @()
    
    # Check each field in new data
    foreach ($fieldName in $NewData.PSObject.Properties.Name) {
        # Skip sessionkey (identifier, never updated)
        if ($fieldName -eq 'sessionkey') {
            continue
        }
        
        # Skip if field is in exception list (allowed to overwrite)
        if ($exceptionFields -contains $fieldName) {
            continue
        }
        
        # Skip if field not in mapping
        if (-not $JotformQuestions.ContainsKey($fieldName)) {
            continue
        }
        
        $qid = $JotformQuestions[$fieldName]
        $newValue = $NewData.$fieldName
        
        # Get existing value from JotForm submission
        $existingValue = $null
        if ($ExistingSubmission.answers -and $ExistingSubmission.answers.$qid) {
            $answer = $ExistingSubmission.answers.$qid
            if ($answer.answer) {
                $existingValue = $answer.answer
            } elseif ($answer.text) {
                $existingValue = $answer.text
            }
        }
        
        # Normalize values for comparison
        $normalizedNew = if ($newValue) { $newValue.ToString().Trim() } else { "" }
        $normalizedExisting = if ($existingValue) { $existingValue.ToString().Trim() } else { "" }
        
        # Check for conflict:
        # 1. Existing value must be non-empty (if empty, it's insertion not overwrite)
        # 2. New value must be different from existing value
        # 3. New value must be non-empty (null/empty new values don't count as conflicts)
        if (-not [string]::IsNullOrWhiteSpace($normalizedExisting) -and 
            -not [string]::IsNullOrWhiteSpace($normalizedNew) -and 
            $normalizedNew -ne $normalizedExisting) {
            
            $conflicts += [PSCustomObject]@{
                FieldName = $fieldName
                QID = $qid
                ExistingValue = $normalizedExisting
                NewValue = $normalizedNew
            }
        }
    }
    
    return [PSCustomObject]@{
        HasConflicts = ($conflicts.Count -gt 0)
        Conflicts = $conflicts
        ConflictCount = $conflicts.Count
    }
}

# Test Cases
$testsPassed = 0
$testsFailed = 0

function Run-Test {
    param(
        [string]$TestName,
        [PSCustomObject]$NewData,
        [PSCustomObject]$ExistingSubmission,
        [bool]$ExpectConflict,
        [int]$ExpectedConflictCount = 0
    )
    
    Write-Host "Test: $TestName" -ForegroundColor Yellow
    
    $result = Test-DataOverwriteConflict -NewData $NewData -ExistingSubmission $ExistingSubmission -JotformQuestions $mockMapping -FileName "test.pdf"
    
    $passed = $true
    if ($result.HasConflicts -ne $ExpectConflict) {
        Write-Host "  ✗ FAILED: Expected HasConflicts=$ExpectConflict, got $($result.HasConflicts)" -ForegroundColor Red
        $passed = $false
    }
    
    if ($ExpectConflict -and $result.ConflictCount -ne $ExpectedConflictCount) {
        Write-Host "  ✗ FAILED: Expected $ExpectedConflictCount conflicts, got $($result.ConflictCount)" -ForegroundColor Red
        $passed = $false
    }
    
    if ($passed) {
        Write-Host "  ✓ PASSED" -ForegroundColor Green
        if ($result.HasConflicts) {
            foreach ($conflict in $result.Conflicts) {
                Write-Host "    Conflict: $($conflict.FieldName) (QID $($conflict.QID)): '$($conflict.ExistingValue)' → '$($conflict.NewValue)'" -ForegroundColor Gray
            }
        }
        $script:testsPassed++
    } else {
        $script:testsFailed++
    }
    Write-Host ""
}

# TEST 1: No conflicts - new data same as existing
Write-Host "Category: No Conflicts" -ForegroundColor Cyan
$newData1 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'student-id' = 'C12345'
    'ERV_Q1' = 'A'
    'Gender' = 'M'
}
$existingSubmission1 = New-MockSubmission -Answers @{
    '30' = 'A'  # ERV_Q1
    '598' = 'M'  # Gender
}
Run-Test -TestName "Same values (no change)" -NewData $newData1 -ExistingSubmission $existingSubmission1 -ExpectConflict $false

# TEST 2: No conflicts - existing field is blank/null (insertion allowed)
$newData2 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'ERV_Q1' = 'B'
    'Gender' = 'F'
}
$existingSubmission2 = New-MockSubmission -Answers @{
    '30' = ''  # ERV_Q1 empty
    '598' = ''  # Gender empty
}
Run-Test -TestName "Existing fields blank (insertion allowed)" -NewData $newData2 -ExistingSubmission $existingSubmission2 -ExpectConflict $false

# TEST 3: No conflicts - new value is null/empty (no update)
$newData3 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'ERV_Q1' = ''
    'Gender' = $null
}
$existingSubmission3 = New-MockSubmission -Answers @{
    '30' = 'A'  # ERV_Q1 has value
    '598' = 'M'  # Gender has value
}
Run-Test -TestName "New values null/empty (no update)" -NewData $newData3 -ExistingSubmission $existingSubmission3 -ExpectConflict $false

# TEST 4: No conflicts - exception fields can be overwritten
$newData4 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'student-id' = 'C99999'
    'child-name' = 'New Name'
    'school-id' = 'S999'
    'district' = 'New District'
    'class-id' = 'K3B'
    'class-name' = 'New Class'
    'computerno' = '999'
}
$existingSubmission4 = New-MockSubmission -Answers @{
    '20' = 'C12345'
    '21' = 'Old Name'
    '22' = 'S001'
    '23' = 'Old District'
    '24' = 'K3A'
    '25' = 'Old Class'
    '647' = '001'
}
Run-Test -TestName "Exception fields (allowed to overwrite)" -NewData $newData4 -ExistingSubmission $existingSubmission4 -ExpectConflict $false

# TEST 5: CONFLICT - non-exception field value changed
Write-Host "Category: Conflicts Detected" -ForegroundColor Cyan
$newData5 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'ERV_Q1' = 'B'
    'Gender' = 'F'
}
$existingSubmission5 = New-MockSubmission -Answers @{
    '30' = 'A'  # ERV_Q1 different
    '598' = 'M'  # Gender different
}
Run-Test -TestName "Non-exception fields changed (2 conflicts)" -NewData $newData5 -ExistingSubmission $existingSubmission5 -ExpectConflict $true -ExpectedConflictCount 2

# TEST 6: CONFLICT - single field changed
$newData6 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'ERV_Q1' = 'A'
    'CM_Q1' = '2'
}
$existingSubmission6 = New-MockSubmission -Answers @{
    '30' = 'A'  # ERV_Q1 same
    '456' = '1'  # CM_Q1 different
}
Run-Test -TestName "Single field conflict" -NewData $newData6 -ExistingSubmission $existingSubmission6 -ExpectConflict $true -ExpectedConflictCount 1

# TEST 7: Mixed scenario - some fields same, some different, some exception
$newData7 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'student-id' = 'C99999'  # Exception field (allowed)
    'ERV_Q1' = 'A'  # Same (no conflict)
    'ERV_Q2' = 'C'  # Different (CONFLICT)
    'CM_Q1' = ''  # Empty new value (no conflict)
}
$existingSubmission7 = New-MockSubmission -Answers @{
    '20' = 'C12345'
    '30' = 'A'
    '31' = 'B'
    '456' = '1'
}
Run-Test -TestName "Mixed scenario (1 conflict among mixed changes)" -NewData $newData7 -ExistingSubmission $existingSubmission7 -ExpectConflict $true -ExpectedConflictCount 1

# TEST 8: Whitespace normalization - values same after trim
Write-Host "Category: Edge Cases" -ForegroundColor Cyan
$newData8 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'ERV_Q1' = '  A  '
}
$existingSubmission8 = New-MockSubmission -Answers @{
    '30' = 'A'
}
Run-Test -TestName "Whitespace normalization (no conflict)" -NewData $newData8 -ExistingSubmission $existingSubmission8 -ExpectConflict $false

# TEST 9: Case insensitivity - values match case-insensitively
$newData9 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'Gender' = 'male'
}
$existingSubmission9 = New-MockSubmission -Answers @{
    '598' = 'Male'
}
Run-Test -TestName "Case insensitivity (no conflict, PowerShell default)" -NewData $newData9 -ExistingSubmission $existingSubmission9 -ExpectConflict $false

# TEST 10: Complex conflict - multiple fields with various states
$newData10 = [PSCustomObject]@{
    'sessionkey' = '12345_20250101_10_30'
    'student-id' = 'C99999'  # Exception (allowed)
    'child-name' = 'New Name'  # Exception (allowed)
    'ERV_Q1' = 'A'  # Same (no conflict)
    'ERV_Q2' = 'D'  # Different (CONFLICT)
    'CM_Q1' = '3'  # Different (CONFLICT)
    'Gender' = 'F'  # Was blank, now filled (no conflict - insertion)
}
$existingSubmission10 = New-MockSubmission -Answers @{
    '20' = 'C12345'
    '21' = 'Old Name'
    '30' = 'A'
    '31' = 'B'
    '456' = '1'
    '598' = ''  # Blank
}
Run-Test -TestName "Complex multi-field scenario (2 conflicts)" -NewData $newData10 -ExistingSubmission $existingSubmission10 -ExpectConflict $true -ExpectedConflictCount 2

# Summary
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Test Results Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total Tests: $($testsPassed + $testsFailed)" -ForegroundColor White
Write-Host "Passed: $testsPassed" -ForegroundColor Green
Write-Host "Failed: $testsFailed" -ForegroundColor Red
Write-Host ""

if ($testsFailed -eq 0) {
    Write-Host "✓ All tests passed!" -ForegroundColor Green
    exit 0
} else {
    Write-Host "✗ Some tests failed" -ForegroundColor Red
    exit 1
}
