# Test: JotForm Filter API with Proper URL Encoding
# Tests the officially documented filter syntax from JotForm support
# Goal: Find if filters work so we can avoid slow pagination

# Load System.Web for URL encoding
Add-Type -AssemblyName System.Web

$apiKey = "f45162cb1d42e5e725ef38c9ccc06915"
$formId = "252152307582049"
$testSessionKey = "10036_20250915_10_41"  # Known sessionkey to search for

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "JotForm Filter API Test (Enhanced)" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Form ID: $formId"
Write-Host "Testing sessionkey lookup: $testSessionKey"
Write-Host ""
Write-Host "Based on official JotForm support guidance:"
Write-Host "- Proper URL encoding required"
Write-Host "- Using QID-based and field name-based filters"
Write-Host "- Testing :eq, :contains, :startswith operators"
Write-Host ""

# Step 1: Get Question ID for sessionkey field
Write-Host "========================================" -ForegroundColor Yellow
Write-Host "STEP 1: Retrieving Form Questions" -ForegroundColor Yellow
Write-Host "========================================" -ForegroundColor Yellow

$questionsUri = "https://api.jotform.com/form/$formId/questions?apiKey=$apiKey"
try {
    $questionsResponse = Invoke-RestMethod -Uri $questionsUri -Method Get -TimeoutSec 30
    $sessionKeyQid = $null
    
    foreach ($qid in $questionsResponse.content.PSObject.Properties.Name) {
        $question = $questionsResponse.content.$qid
        if ($question.name -eq "sessionkey") {
            $sessionKeyQid = $qid
            Write-Host "✓ Found 'sessionkey' field:" -ForegroundColor Green
            Write-Host "  QID: $sessionKeyQid" -ForegroundColor White
            Write-Host "  Name: $($question.name)" -ForegroundColor White
            Write-Host "  Type: $($question.type)" -ForegroundColor White
            break
        }
    }
    
    if (-not $sessionKeyQid) {
        Write-Host "✗ ERROR: 'sessionkey' field not found in form questions!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host "✗ Failed to retrieve form questions: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}

Write-Host ""

$stopwatch0 = [System.Diagnostics.Stopwatch]::StartNew()
$filterFound = $null
$filterWorks = $false

try {
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host "STEP 2: Testing Filter Formats" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Yellow
    Write-Host ""
    
    # Based on JotForm support: use QID:eq and field name filters with proper encoding
    # Raw filter example: {"3:eq":"10036_20250915_10_41"}
    # URL-encoded: %7B%223%3Aeq%22%3A%2210036_20250915_10_41%22%7D
    
    $filterFormats = @(
        # JotForm-recommended formats
        @{ 
            Name = "QID:eq (Official)"
            Filter = "{`"${sessionKeyQid}:eq`":`"$testSessionKey`"}"
            Description = "Exact match using QID with :eq operator"
        },
        @{ 
            Name = "Field Name:eq"
            Filter = "{`"sessionkey:eq`":`"$testSessionKey`"}"
            Description = "Exact match using field name with :eq operator"
        },
        @{ 
            Name = "QID:contains"
            Filter = "{`"${sessionKeyQid}:contains`":`"$($testSessionKey.Substring(0, 10))`"}"
            Description = "Partial match using QID (first 10 chars)"
        },
        @{ 
            Name = "Field Name:contains"
            Filter = "{`"sessionkey:contains`":`"$($testSessionKey.Substring(0, 10))`"}"
            Description = "Partial match using field name (first 10 chars)"
        },
        @{ 
            Name = "QID:startswith"
            Filter = "{`"${sessionKeyQid}:startswith`":`"$($testSessionKey.Split('_')[0])`"}"
            Description = "Starts with student ID portion"
        },
        @{ 
            Name = "Simple QID (No operator)"
            Filter = "{`"$sessionKeyQid`":`"$testSessionKey`"}"
            Description = "Direct QID without operator (legacy)"
        }
    )
    
    $workingFilter = $null
    
    foreach ($fmt in $filterFormats) {
        Write-Host "Trying: $($fmt.Name)" -ForegroundColor Cyan
        Write-Host "  Description: $($fmt.Description)" -ForegroundColor Gray
        Write-Host "  Raw Filter: $($fmt.Filter)" -ForegroundColor DarkGray
        
        $filter = $fmt.Filter
        $encodedFilter = [System.Web.HttpUtility]::UrlEncode($filter)
        Write-Host "  Encoded: $encodedFilter" -ForegroundColor DarkGray
        
        # Add limit, orderby, and direction parameters as recommended
        $filterUri = "https://api.jotform.com/form/$formId/submissions?apiKey=$apiKey&filter=$encodedFilter&limit=1000&orderby=created_at&direction=ASC"
        
        Write-Host "  Calling API..." -ForegroundColor Gray
        $filterResponse = Invoke-RestMethod -Uri $filterUri -Method Get -TimeoutSec 30
        
        $count = 0
        if ($filterResponse.content) {
            $count = $filterResponse.content.Count
        }
        
        Write-Host "  → Returned $count submissions" -ForegroundColor Green
        
        if ($count -gt 0) {
            # Check if any match the sessionkey
            foreach ($sub in $filterResponse.content) {
                $sessionKeyValue = $null
                if ($sub.answers.$sessionKeyQid.answer) {
                    $sessionKeyValue = $sub.answers.$sessionKeyQid.answer
                } elseif ($sub.answers.$sessionKeyQid.text) {
                    $sessionKeyValue = $sub.answers.$sessionKeyQid.text
                }
                
                if ($sessionKeyValue) {
                    $sessionKeyValue = $sessionKeyValue.Trim() -replace '\s+', ' '
                }
                
                if ($sessionKeyValue -eq $testSessionKey) {
                    $filterFound = $sub
                    $filterWorks = $true
                    $workingFilter = $fmt
                    Write-Host "  🎯 MATCH! This filter format works!" -ForegroundColor Green -BackgroundColor Black
                    Write-Host "     Submission ID: $($sub.id)" -ForegroundColor Green
                    Write-Host "     SessionKey: '$sessionKeyValue'" -ForegroundColor Green
                    Write-Host "     Working filter: $($fmt.Filter)" -ForegroundColor Cyan
                    Write-Host "     Encoded: $encodedFilter" -ForegroundColor Cyan
                    break
                }
            }
            
            if ($filterWorks) {
                break  # Exit loop if we found a working format
            }
            
            if (-not $filterWorks) {
                $firstVal = if ($filterResponse.content.Count -gt 0) { $filterResponse.content[0].answers.$sessionKeyQid.answer } else { "N/A" }
                Write-Host "  ✗ No exact match (first returned: '$firstVal')" -ForegroundColor Yellow
            }
        } else {
            Write-Host "  ✗ Returned 0 results" -ForegroundColor Yellow
        }
        
        Write-Host ""
    }
    
} catch {
    Write-Host "✗ Filter failed: $($_.Exception.Message)" -ForegroundColor Red
}

$stopwatch0.Stop()
$filterTime = $stopwatch0.Elapsed.TotalSeconds

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Filter Test Results" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Time: $([Math]::Round($filterTime, 2)) seconds" -ForegroundColor White
Write-Host "  Works: $(if ($filterWorks) { 'YES' } else { 'NO' })" -ForegroundColor $(if ($filterWorks) { 'Green' } else { 'Red' })
if ($filterFound) {
    Write-Host "  Submission ID: $($filterFound.id)" -ForegroundColor Gray
    Write-Host ""
    Write-Host "🎉 SUCCESS! Filters work with this format:" -ForegroundColor Green -BackgroundColor Black
    Write-Host "   Name: $($workingFilter.Name)" -ForegroundColor Cyan
    Write-Host "   Raw: $($workingFilter.Filter)" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📋 Copy this for your code:" -ForegroundColor Yellow
    Write-Host "   `$filter = `"$($workingFilter.Filter)`"" -ForegroundColor White
    Write-Host "   `$encoded = [System.Web.HttpUtility]::UrlEncode(`$filter)" -ForegroundColor White
    Write-Host "   `$uri = `"https://api.jotform.com/form/`$formId/submissions?apiKey=`$apiKey&filter=`$encoded&limit=1000&orderby=created_at&direction=ASC`"" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "❌ Filters don't work. Falling back to pagination..." -ForegroundColor Yellow
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "METHOD 1: API Paginated Scan" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "Using GET /form/{id}/submissions with pagination"
Write-Host ""

$stopwatch1 = [System.Diagnostics.Stopwatch]::StartNew()
$apiFound = $null
$apiScanned = 0

try {
    $found = $null
    $offset = 0
    $limit = 1000
    $totalScanned = 0
    $maxPages = 10  # Scan up to 10,000 submissions max (10 pages)
    $pageNum = 1
    
    while ($pageNum -le $maxPages -and -not $found) {
        Write-Host "Page $pageNum (offset $offset, limit $limit)..." -ForegroundColor Gray
        
        $pageUri = "https://api.jotform.com/form/$formId/submissions?apiKey=$apiKey&limit=$limit&offset=$offset&orderby=created_at"
        $pageResponse = Invoke-RestMethod -Uri $pageUri -Method Get -TimeoutSec 60
        
        $pageCount = 0
        if ($pageResponse.content) {
            $pageCount = $pageResponse.content.Count
        }
        
        Write-Host "  ✓ Downloaded $pageCount submissions" -ForegroundColor Green
        
        if ($pageCount -eq 0) {
            Write-Host "  No more submissions available" -ForegroundColor Gray
            break
        }
        
        # Scan this page
        foreach ($sub in $pageResponse.content) {
            $totalScanned++
            
            # Try to get sessionkey from answers[3].answer first
            $sessionKeyValue = $null
            if ($sub.answers.$sessionKeyQid.answer) {
                $sessionKeyValue = $sub.answers.$sessionKeyQid.answer
            } elseif ($sub.answers.$sessionKeyQid.text) {
                $sessionKeyValue = $sub.answers.$sessionKeyQid.text
            }
            
            # Normalize whitespace (like Python does)
            if ($sessionKeyValue) {
                $sessionKeyValue = $sessionKeyValue.Trim() -replace '\s+', ' '
            }
            
            # Compare
            if ($sessionKeyValue -eq $testSessionKey) {
                $found = $sub
                Write-Host "  🎯 FOUND MATCH at position $totalScanned!" -ForegroundColor Green -BackgroundColor Black
                Write-Host "     Submission ID: $($found.id)" -ForegroundColor Green
                Write-Host "     SessionKey: '$sessionKeyValue'" -ForegroundColor Green
                Write-Host "     Created: $($found.created_at)" -ForegroundColor Gray
                Write-Host "     Page: $pageNum, Position in page: $($totalScanned - $offset)" -ForegroundColor Gray
                break
            }
        }
        
        # If page returned less than limit, we've reached the end
        if ($pageCount -lt $limit) {
            Write-Host "  Reached end of submissions (last page)" -ForegroundColor Gray
            break
        }
        
        $offset += $limit
        $pageNum++
        Start-Sleep -Milliseconds 500  # Rate limiting
    }
    
    $apiScanned = $totalScanned
    $apiFound = $found
    
} catch {
    Write-Host "✗ API scan failed: $($_.Exception.Message)" -ForegroundColor Red
}

$stopwatch1.Stop()
$apiTime = $stopwatch1.Elapsed.TotalSeconds

Write-Host ""
Write-Host "API Results:" -ForegroundColor Cyan
Write-Host "  Time: $([Math]::Round($apiTime, 2)) seconds" -ForegroundColor White
Write-Host "  Scanned: $apiScanned submissions" -ForegroundColor White
Write-Host "  Found: $(if ($apiFound) { 'YES' } else { 'NO' })" -ForegroundColor $(if ($apiFound) { 'Green' } else { 'Red' })
if ($apiFound) {
    Write-Host "  Submission ID: $($apiFound.id)" -ForegroundColor Gray
}

# Skip HTML table method - not practical for automation

# ============================================================
# FINAL COMPARISON
# ============================================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Performance Comparison" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Method 0 (Direct Filter with Proper Encoding):" -ForegroundColor White
if ($filterWorks) {
    Write-Host "  ✓ FASTEST - instant results!" -ForegroundColor Green
    Write-Host "  ✓ No pagination needed" -ForegroundColor Green
    Write-Host "  ✓ Returns only matching submissions" -ForegroundColor Green
    Write-Host "  ✓ Time: $([Math]::Round($filterTime, 2))s" -ForegroundColor White
    Write-Host ""
    Write-Host "  Working Format: $($workingFilter.Name)" -ForegroundColor Cyan
    Write-Host "  Raw Filter: $($workingFilter.Filter)" -ForegroundColor Gray
} else {
    Write-Host "  ✗ Doesn't work (returns wrong/no results)" -ForegroundColor Red
    Write-Host "  - Time: $([Math]::Round($filterTime, 2))s" -ForegroundColor Gray
}
Write-Host ""

Write-Host "Method 1 (API Pagination - Fallback):" -ForegroundColor White
Write-Host "  ✓ Reliable and complete data access" -ForegroundColor Green
Write-Host "  ✓ Handles large datasets (paginated)" -ForegroundColor Green
Write-Host "  ✓ Returns structured JSON" -ForegroundColor Green
Write-Host "  - Time: $([Math]::Round($apiTime, 2))s for $apiScanned submissions" -ForegroundColor White
if ($apiScanned -gt 0) {
    Write-Host "  - Speed: ~$([Math]::Round($apiScanned/$apiTime, 0)) submissions/sec" -ForegroundColor White
}
Write-Host ""

Write-Host "========================================" -ForegroundColor Cyan
if ($filterWorks) {
    Write-Host "🎉 RECOMMENDATION: Use Direct Filter!" -ForegroundColor Green -BackgroundColor Black
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Filters work with proper URL encoding!" -ForegroundColor Green
    Write-Host "This is the fastest method - no pagination needed!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Implementation for processor_agent.ps1:" -ForegroundColor Yellow
    Write-Host "----------------------------------------" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "# Search for submission by sessionkey using filter" -ForegroundColor Gray
    Write-Host "`$filter = `"$($workingFilter.Filter)`"" -ForegroundColor White
    Write-Host "`$encodedFilter = [System.Web.HttpUtility]::UrlEncode(`$filter)" -ForegroundColor White
    Write-Host "`$uri = `"https://api.jotform.com/form/`$formId/submissions?apiKey=`$apiKey&filter=`$encodedFilter&limit=1000&orderby=created_at`"" -ForegroundColor White
    Write-Host "`$response = Invoke-RestMethod -Uri `$uri -Method Get -TimeoutSec 30" -ForegroundColor White
    Write-Host "if (`$response.content.Count -gt 0) {" -ForegroundColor White
    Write-Host "    `$existingSubmission = `$response.content[0]" -ForegroundColor White
    Write-Host "    # Update existing submission" -ForegroundColor Gray
    Write-Host "} else {" -ForegroundColor White
    Write-Host "    # Create new submission" -ForegroundColor Gray
    Write-Host "}" -ForegroundColor White
    Write-Host ""
    Write-Host "Speed improvement: ~$([Math]::Round($apiTime / $filterTime, 1))x faster than pagination!" -ForegroundColor Green
} else {
    Write-Host "⚠ RECOMMENDATION: Continue Using API Pagination" -ForegroundColor Yellow
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Filters don't work, but pagination is reliable." -ForegroundColor Yellow
    Write-Host "Current implementation in processor_agent.ps1 is optimal." -ForegroundColor Yellow
    Write-Host "Downloads up to 10,000 submissions in chunks and scans manually." -ForegroundColor Gray
}
Write-Host ""
