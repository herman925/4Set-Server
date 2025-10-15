# Jotform Filter Test Script
# Tests sessionkey filter (QID 3) vs student-id filter (QID 20)
# Based on processor_agent.ps1 logic

param(
    [string]$SessionKey = "11097_20250904_11_34",
    [string]$StudentId = "10261",
    [string]$ApiKey = "f45162cb1d42e5e725ef38c9ccc06915",
    [string]$FormId = "252152307582049"
)

Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "Jotform API Filter Test" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Load System.Web for URL encoding
Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue

# Test 1: SessionKey Filter (QID 3) - This SHOULD work based on processor_agent.ps1
Write-Host "TEST 1: SessionKey Filter (QID 3)" -ForegroundColor Yellow
Write-Host "SessionKey: $SessionKey" -ForegroundColor Gray
Write-Host ""

try {
    # Build filter exactly like processor_agent.ps1 does
    $sessionkeyQid = "3"
    $filter1 = "{`"${sessionkeyQid}:eq`":`"${SessionKey}`"}"
    $encodedFilter1 = [System.Web.HttpUtility]::UrlEncode($filter1)
    $url1 = "https://api.jotform.com/form/$FormId/submissions?apiKey=$ApiKey&filter=$encodedFilter1&limit=1000&orderby=created_at&direction=ASC"
    
    Write-Host "Raw Filter: $filter1" -ForegroundColor Gray
    Write-Host "Encoded: $encodedFilter1" -ForegroundColor Gray
    Write-Host ""
    Write-Host "COMPLETE URL (copy to browser to test):" -ForegroundColor Cyan
    Write-Host $url1 -ForegroundColor White
    Write-Host ""
    
    $response1 = Invoke-RestMethod -Uri $url1 -Method Get -TimeoutSec 30
    
    $totalReturned = if ($response1.content) { $response1.content.Count } else { 0 }
    Write-Host "✅ Response Code: $($response1.responseCode)" -ForegroundColor Green
    Write-Host "📦 Total Submissions Returned by API: $totalReturned" -ForegroundColor Cyan
    Write-Host ""
    
    # VALIDATE RESULTS - Mirror processor_agent.ps1 logic
    $foundMatch = $null
    $exactMatchCount = 0
    
    if ($totalReturned -gt 0) {
        Write-Host "🔍 Validating each submission (like processor_agent.ps1):" -ForegroundColor Yellow
        
        foreach ($sub in $response1.content) {
            # Extract sessionkey value (try .answer first, fallback to .text)
            $sessionKeyValue = $null
            if ($sub.answers.$sessionkeyQid.answer) {
                $sessionKeyValue = $sub.answers.$sessionkeyQid.answer
            } elseif ($sub.answers.$sessionkeyQid.text) {
                $sessionKeyValue = $sub.answers.$sessionkeyQid.text
            }
            
            # Normalize whitespace (like processor_agent.ps1)
            if ($sessionKeyValue) {
                $sessionKeyValue = $sessionKeyValue.Trim() -replace '\s+', ' '
            }
            
            # Check for EXACT match
            if ($sessionKeyValue -eq $SessionKey) {
                $exactMatchCount++
                if (-not $foundMatch) {
                    $foundMatch = $sub
                    Write-Host "   ✅ FOUND EXACT MATCH: $sessionKeyValue (Submission ID: $($sub.id))" -ForegroundColor Green
                }
            }
        }
        
        Write-Host ""
        Write-Host "📊 VALIDATION RESULTS:" -ForegroundColor Cyan
        Write-Host "   API returned: $totalReturned submissions" -ForegroundColor Gray
        Write-Host "   Exact matches: $exactMatchCount" -ForegroundColor Gray
        Write-Host ""
        
        if ($foundMatch) {
            Write-Host "✅ SUCCESS: Found submission $($foundMatch.id) for sessionkey $SessionKey" -ForegroundColor Green
            if ($exactMatchCount -eq $totalReturned) {
                Write-Host "✅ FILTER WORKS PERFECTLY - all returned results are exact matches!" -ForegroundColor Green
            } else {
                Write-Host "⚠️ WARNING: Filter returned $totalReturned submissions but only $exactMatchCount match!" -ForegroundColor Yellow
                Write-Host "   This means the filter is NOT working correctly." -ForegroundColor Yellow
            }
        } else {
            Write-Host "❌ FAILURE: No exact match found for sessionkey $SessionKey" -ForegroundColor Red
            Write-Host "   Filter returned $totalReturned submissions but none match!" -ForegroundColor Red
        }
    } else {
        Write-Host "❌ No submissions returned by API" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Test 2: Student-ID Filter (QID 20) - Testing if this works
Write-Host "TEST 2: Student-ID Filter (QID 20)" -ForegroundColor Yellow
Write-Host "Student ID: $StudentId" -ForegroundColor Gray
Write-Host ""

try {
    # Build filter for student-id
    $studentIdQid = "20"
    $filter2 = "{`"${studentIdQid}:eq`":`"${StudentId}`"}"
    $encodedFilter2 = [System.Web.HttpUtility]::UrlEncode($filter2)
    $url2 = "https://api.jotform.com/form/$FormId/submissions?apiKey=$ApiKey&filter=$encodedFilter2&limit=1000&orderby=created_at&direction=ASC"
    
    Write-Host "Raw Filter: $filter2" -ForegroundColor Gray
    Write-Host "Encoded: $encodedFilter2" -ForegroundColor Gray
    Write-Host ""
    Write-Host "COMPLETE URL (copy to browser to test):" -ForegroundColor Cyan
    Write-Host $url2 -ForegroundColor White
    Write-Host ""
    
    $response2 = Invoke-RestMethod -Uri $url2 -Method Get -TimeoutSec 30
    
    $totalReturned2 = if ($response2.content) { $response2.content.Count } else { 0 }
    Write-Host "✅ Response Code: $($response2.responseCode)" -ForegroundColor Green
    Write-Host "📦 Total Submissions Returned by API: $totalReturned2" -ForegroundColor Cyan
    Write-Host ""
    
    # VALIDATE RESULTS - Mirror processor_agent.ps1 logic
    $foundMatch2 = $null
    $exactMatchCount2 = 0
    
    if ($totalReturned2 -gt 0) {
        Write-Host "🔍 Validating each submission (like processor_agent.ps1):" -ForegroundColor Yellow
        Write-Host "   Showing first 10 student IDs:" -ForegroundColor Gray
        
        $count = 0
        foreach ($sub in $response2.content) {
            # Extract student-id value (try .answer first, fallback to .text)
            $studentIdValue = $null
            if ($sub.answers.$studentIdQid.answer) {
                $studentIdValue = $sub.answers.$studentIdQid.answer
            } elseif ($sub.answers.$studentIdQid.text) {
                $studentIdValue = $sub.answers.$studentIdQid.text
            }
            
            # Normalize whitespace
            if ($studentIdValue) {
                $studentIdValue = $studentIdValue.Trim() -replace '\s+', ' '
            }
            
            # Show first 10
            if ($count -lt 10) {
                $match = if ($studentIdValue -eq $StudentId) { "✅ MATCH" } else { "❌ WRONG" }
                Write-Host "   [$count] $studentIdValue $match" -ForegroundColor Gray
                $count++
            }
            
            # Check for EXACT match
            if ($studentIdValue -eq $StudentId) {
                $exactMatchCount2++
                if (-not $foundMatch2) {
                    $foundMatch2 = $sub
                }
            }
        }
        
        Write-Host ""
        Write-Host "📊 VALIDATION RESULTS:" -ForegroundColor Cyan
        Write-Host "   API returned: $totalReturned2 submissions" -ForegroundColor Gray
        Write-Host "   Exact matches: $exactMatchCount2" -ForegroundColor Gray
        Write-Host ""
        
        if ($foundMatch2) {
            Write-Host "✅ SUCCESS: Found submission(s) for student-id $StudentId" -ForegroundColor Green
            if ($exactMatchCount2 -eq $totalReturned2) {
                Write-Host "✅ FILTER WORKS PERFECTLY - all returned results are exact matches!" -ForegroundColor Green
            } else {
                Write-Host "❌ FILTER IS BROKEN!" -ForegroundColor Red
                Write-Host "   Returned $totalReturned2 submissions but only $exactMatchCount2 match!" -ForegroundColor Red
                Write-Host "   Need client-side filtering fallback!" -ForegroundColor Yellow
            }
        } else {
            Write-Host "❌ FAILURE: No exact match found for student-id $StudentId" -ForegroundColor Red
            Write-Host "   Filter returned $totalReturned2 submissions but none match!" -ForegroundColor Red
        }
    } else {
        Write-Host "❌ No submissions returned by API" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Test 3: Field Name Filter (student-id:eq instead of 20:eq)
Write-Host "TEST 3: Field Name Filter (student-id:eq)" -ForegroundColor Yellow
Write-Host "Student ID: $StudentId" -ForegroundColor Gray
Write-Host ""

try {
    $filter3 = "{`"student-id:eq`":`"${StudentId}`"}"
    $encodedFilter3 = [System.Web.HttpUtility]::UrlEncode($filter3)
    $url3 = "https://api.jotform.com/form/$FormId/submissions?apiKey=$ApiKey&filter=$encodedFilter3&limit=1000&orderby=created_at&direction=ASC"
    
    Write-Host "Raw Filter: $filter3" -ForegroundColor Gray
    Write-Host "Encoded: $encodedFilter3" -ForegroundColor Gray
    Write-Host ""
    Write-Host "COMPLETE URL (copy to browser to test):" -ForegroundColor Cyan
    Write-Host $url3 -ForegroundColor White
    Write-Host ""
    
    $response3 = Invoke-RestMethod -Uri $url3 -Method Get -TimeoutSec 30
    
    $totalReturned3 = $response3.content.Count
    Write-Host "✅ Response Code: $($response3.responseCode)" -ForegroundColor Green
    Write-Host "📦 Total Submissions Returned: $totalReturned3" -ForegroundColor Cyan
    
    if ($totalReturned3 -gt 0) {
        Write-Host "📋 First 10 Student IDs:" -ForegroundColor Cyan
        $response3.content | Select-Object -First 10 | ForEach-Object {
            $studentIdValue = $_.answers."20".answer
            $match = if ($studentIdValue -eq $StudentId) { "✅ MATCH" } else { "❌ WRONG" }
            Write-Host "   $studentIdValue $match" -ForegroundColor Gray
        }
        
        # Count exact matches
        $exactMatches3 = ($response3.content | Where-Object { $_.answers."20".answer -eq $StudentId }).Count
        Write-Host ""
        Write-Host "✨ Exact Matches: $exactMatches3 / $totalReturned3" -ForegroundColor Cyan
        
        if ($exactMatches3 -eq $totalReturned3) {
            Write-Host "✅ FILTER WORKS PERFECTLY!" -ForegroundColor Green
        } else {
            Write-Host "⚠️ FILTER IS BROKEN - returned $totalReturned3 submissions but only $exactMatches3 match!" -ForegroundColor Red
        }
    }
} catch {
    Write-Host "❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""

# Test 4: Contains Operator (student-id:contains) - Alternative approach
Write-Host "TEST 4: Contains Operator (student-id:contains)" -ForegroundColor Yellow
Write-Host "Student ID: $StudentId" -ForegroundColor Gray
Write-Host "(Jotform support suggests trying :contains instead of :eq)" -ForegroundColor Gray
Write-Host ""

try {
    $filter4 = "{`"${studentIdQid}:contains`":`"${StudentId}`"}"
    $encodedFilter4 = [System.Web.HttpUtility]::UrlEncode($filter4)
    $url4 = "https://api.jotform.com/form/$FormId/submissions?apiKey=$ApiKey&filter=$encodedFilter4&limit=1000&orderby=created_at&direction=ASC"
    
    Write-Host "Raw Filter: $filter4" -ForegroundColor Gray
    Write-Host "Encoded: $encodedFilter4" -ForegroundColor Gray
    Write-Host ""
    Write-Host "COMPLETE URL (copy to browser to test):" -ForegroundColor Cyan
    Write-Host $url4 -ForegroundColor White
    Write-Host ""
    
    $response4 = Invoke-RestMethod -Uri $url4 -Method Get -TimeoutSec 30
    
    $totalReturned4 = if ($response4.content) { $response4.content.Count } else { 0 }
    Write-Host "✅ Response Code: $($response4.responseCode)" -ForegroundColor Green
    Write-Host "📦 Total Submissions Returned by API: $totalReturned4" -ForegroundColor Cyan
    Write-Host ""
    
    # VALIDATE RESULTS
    $foundMatch4 = $null
    $exactMatchCount4 = 0
    
    if ($totalReturned4 -gt 0) {
        Write-Host "🔍 Validating each submission:" -ForegroundColor Yellow
        Write-Host "   Showing first 10 student IDs:" -ForegroundColor Gray
        
        $count = 0
        foreach ($sub in $response4.content) {
            $studentIdValue = $null
            if ($sub.answers.$studentIdQid.answer) {
                $studentIdValue = $sub.answers.$studentIdQid.answer
            } elseif ($sub.answers.$studentIdQid.text) {
                $studentIdValue = $sub.answers.$studentIdQid.text
            }
            
            if ($studentIdValue) {
                $studentIdValue = $studentIdValue.Trim() -replace '\s+', ' '
            }
            
            if ($count -lt 10) {
                $match = if ($studentIdValue -eq $StudentId) { "✅ EXACT" } elseif ($studentIdValue -like "*$StudentId*") { "⚠️ PARTIAL" } else { "❌ WRONG" }
                Write-Host "   [$count] $studentIdValue $match" -ForegroundColor Gray
                $count++
            }
            
            if ($studentIdValue -eq $StudentId) {
                $exactMatchCount4++
                if (-not $foundMatch4) {
                    $foundMatch4 = $sub
                }
            }
        }
        
        Write-Host ""
        Write-Host "📊 VALIDATION RESULTS:" -ForegroundColor Cyan
        Write-Host "   API returned: $totalReturned4 submissions" -ForegroundColor Gray
        Write-Host "   Exact matches: $exactMatchCount4" -ForegroundColor Gray
        Write-Host ""
        
        if ($foundMatch4) {
            Write-Host "✅ SUCCESS: Found submission(s) for student-id $StudentId" -ForegroundColor Green
            if ($exactMatchCount4 -eq $totalReturned4) {
                Write-Host "✅ :contains WORKS PERFECTLY - all returned results are exact matches!" -ForegroundColor Green
            } else {
                Write-Host "⚠️ :contains returned partial matches (expected behavior)" -ForegroundColor Yellow
                Write-Host "   Returned $totalReturned4 submissions, $exactMatchCount4 are exact matches" -ForegroundColor Yellow
            }
        } else {
            Write-Host "❌ FAILURE: No matches found" -ForegroundColor Red
        }
    } else {
        Write-Host "❌ No submissions returned by API" -ForegroundColor Red
    }
} catch {
    Write-Host "❌ ERROR: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host "SUMMARY" -ForegroundColor Cyan
Write-Host "=====================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "SessionKey filter (QID 3): Uses same logic as processor_agent.ps1" -ForegroundColor Gray
Write-Host "Student-ID filter (QID 20): Testing if it works like sessionkey" -ForegroundColor Gray
Write-Host "Field Name filter: Alternative approach recommended by Jotform" -ForegroundColor Gray
Write-Host ""
Write-Host "If student-id filters return 517 submissions but only 2-3 match," -ForegroundColor Yellow
Write-Host "then the filter is BROKEN and we need client-side filtering." -ForegroundColor Yellow
Write-Host ""
