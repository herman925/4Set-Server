# Test: Chunked UPDATE to avoid 504 timeout
# Tests different payload sizes to find optimal chunk size

# Load System.Web for URL encoding
Add-Type -AssemblyName System.Web

$apiKey = "f45162cb1d42e5e725ef38c9ccc06915"
$formId = "252152307582049"
$testSubmissionId = "6362513510228864449"  # Known submission ID

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Jotform Chunked UPDATE Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Form ID: $formId"
Write-Host "Testing UPDATE on submission: $testSubmissionId"
Write-Host ""
Write-Host "Goal: Find optimal chunk size to avoid 504 timeout"
Write-Host ""

# Load a sample enriched JSON to get realistic payload
$sampleJsonPath = "C:\Users\Herman\The Education University of Hong Kong\o365grp_KeySteps@JC - General\98 - IT Support\04 - Homemade Apps\4Set-Server\filed\S067\11099_20250904_12_44.json"

if (-not (Test-Path $sampleJsonPath)) {
    Write-Host "ERROR: Sample JSON not found at: $sampleJsonPath" -ForegroundColor Red
    Write-Host "Please provide a valid enriched JSON file path" -ForegroundColor Yellow
    exit 1
}

$json = Get-Content $sampleJsonPath -Raw | ConvertFrom-Json
$data = $json.data

# Load Jotform mapping
$mappingPath = "C:\Users\Herman\The Education University of Hong Kong\o365grp_KeySteps@JC - General\98 - IT Support\04 - Homemade Apps\4Set-Server\assets\jotformquestions.json"
$mappingObj = Get-Content $mappingPath -Raw | ConvertFrom-Json

# Convert to hashtable manually (for older PowerShell compatibility)
$JotformQuestions = @{}
foreach ($prop in $mappingObj.PSObject.Properties) {
    $JotformQuestions[$prop.Name] = $prop.Value
}

# Get all fields except sessionkey
$allFields = @()
foreach ($key in $data.PSObject.Properties.Name) {
    if ($key -ne 'sessionkey' -and $JotformQuestions.ContainsKey($key)) {
        $allFields += $key
    }
}

Write-Host "Loaded $($allFields.Count) fields from sample JSON" -ForegroundColor Green
Write-Host ""

# Function to build payload
function Build-UpdatePayload {
    param(
        [PSCustomObject]$Data,
        [hashtable]$Mapping,
        [array]$Fields
    )
    
    $body = @()
    foreach ($field in $Fields) {
        if ($Mapping.ContainsKey($field)) {
            $qid = $Mapping[$field]
            $value = $Data.$field
            if ($null -ne $value) {
                $body += "submission[$qid]=$([System.Web.HttpUtility]::UrlEncode($value.ToString()))"
            }
        }
    }
    return ($body -join "&")
}

# Test different chunk sizes - focus on finding 1KB threshold
# Based on initial tests: 50 fields (0.89 KB) = success, 100 fields (1.75 KB) = fail
# Test granularly between 50-100 to find the exact limit
$chunkSizes = @(10, 50, 60, 70, 80, 90, 100, 120, 150)

Write-Host "Testing to find payload size limit (hypothesis: ~1KB threshold)" -ForegroundColor Yellow
Write-Host ""

$results = @()

foreach ($chunkSize in $chunkSizes) {
    Write-Host "========================================" -ForegroundColor Magenta
    Write-Host "Test: Chunk Size = $chunkSize fields" -ForegroundColor Magenta
    Write-Host "========================================" -ForegroundColor Magenta
    
    # Take first N fields
    $fieldsToTest = $allFields | Select-Object -First $chunkSize
    
    Write-Host "Building payload with $($fieldsToTest.Count) fields..." -ForegroundColor Gray
    $updateBody = Build-UpdatePayload -Data $data -Mapping $JotformQuestions -Fields $fieldsToTest
    
    $payloadSize = [System.Text.Encoding]::UTF8.GetByteCount($updateBody)
    Write-Host "Payload size: $payloadSize bytes ($([Math]::Round($payloadSize/1024, 2)) KB)" -ForegroundColor Gray
    
    $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
    
    try {
        $updateUri = "https://api.jotform.com/submission/$testSubmissionId" + "?apiKey=$apiKey"
        
        Write-Host "Sending UPDATE request..." -ForegroundColor Gray
        Write-Host "URI: $updateUri" -ForegroundColor DarkGray
        
        # Use Invoke-WebRequest to get full response details
        $webResponse = Invoke-WebRequest -Uri $updateUri -Method Post -Body $updateBody -ContentType "application/x-www-form-urlencoded" -TimeoutSec 30
        
        $stopwatch.Stop()
        $elapsed = $stopwatch.Elapsed.TotalSeconds
        
        Write-Host "✓ SUCCESS!" -ForegroundColor Green -BackgroundColor Black
        Write-Host "  Time: $([Math]::Round($elapsed, 2)) seconds" -ForegroundColor Green
        Write-Host "  Status Code: $($webResponse.StatusCode)" -ForegroundColor Green
        Write-Host "  Status Description: $($webResponse.StatusDescription)" -ForegroundColor Green
        
        # Parse JSON response
        $response = $webResponse.Content | ConvertFrom-Json
        Write-Host "  Response Code: $($response.responseCode)" -ForegroundColor Gray
        Write-Host "  Message: $($response.message)" -ForegroundColor Gray
        
        if ($response.content) {
            Write-Host "  Content: $($response.content | ConvertTo-Json -Depth 2 -Compress)" -ForegroundColor DarkGray
        }
        Write-Host ""
        
        # Track result
        $results += [PSCustomObject]@{
            Fields = $chunkSize
            PayloadKB = [Math]::Round($payloadSize/1024, 2)
            Success = $true
            Time = [Math]::Round($elapsed, 2)
        }
        
    } catch {
        $stopwatch.Stop()
        $elapsed = $stopwatch.Elapsed.TotalSeconds
        
        Write-Host "✗ FAILED" -ForegroundColor Red
        Write-Host "  Time: $([Math]::Round($elapsed, 2)) seconds" -ForegroundColor Red
        
        # Detailed error information
        $errorMsg = $_.Exception.Message
        $errorDetails = $_
        
        Write-Host "  Error Message: $errorMsg" -ForegroundColor Red
        
        # Check if it's an HTTP error with response
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode
            $statusDescription = $_.Exception.Response.StatusDescription
            
            Write-Host "  HTTP Status: $statusCode $statusDescription" -ForegroundColor Yellow
            
            if ($statusCode -eq 504) {
                Write-Host "  → This chunk size is TOO LARGE (gateway timeout)" -ForegroundColor Yellow
            }
            
            # Try to read response body
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $responseBody = $reader.ReadToEnd()
                $reader.Close()
                
                if ($responseBody) {
                    Write-Host "  Response Body: $responseBody" -ForegroundColor DarkYellow
                }
            } catch {
                Write-Host "  (Could not read response body)" -ForegroundColor Gray
            }
        }
        
        Write-Host "  Full Exception:" -ForegroundColor DarkGray
        Write-Host "  $($_.Exception | Format-List * | Out-String)" -ForegroundColor DarkGray
        Write-Host ""
        
        # Track result
        $results += [PSCustomObject]@{
            Fields = $chunkSize
            PayloadKB = [Math]::Round($payloadSize/1024, 2)
            Success = $false
            Time = [Math]::Round($elapsed, 2)
        }
    }
    
    Start-Sleep -Seconds 2  # Rate limiting
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "SUMMARY: Payload Size Threshold Analysis" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Display results table
Write-Host "Fields | Payload KB | Status  | Time (s)" -ForegroundColor White
Write-Host "-------|------------|---------|----------" -ForegroundColor DarkGray
foreach ($result in $results) {
    $status = if ($result.Success) { "✓ SUCCESS" } else { "✗ FAILED " }
    $color = if ($result.Success) { "Green" } else { "Red" }
    Write-Host ("{0,-6} | {1,-10} | " -f $result.Fields, $result.PayloadKB) -NoNewline
    Write-Host $status -ForegroundColor $color -NoNewline
    Write-Host (" | {0}" -f $result.Time)
}

Write-Host ""

# Find the threshold
$successfulTests = $results | Where-Object { $_.Success -eq $true }
$failedTests = $results | Where-Object { $_.Success -eq $false }

if ($successfulTests.Count -gt 0) {
    $maxSuccess = $successfulTests | Sort-Object PayloadKB -Descending | Select-Object -First 1
    Write-Host "✓ Maximum successful payload: $($maxSuccess.Fields) fields = $($maxSuccess.PayloadKB) KB" -ForegroundColor Green
}

if ($failedTests.Count -gt 0) {
    $minFail = $failedTests | Sort-Object PayloadKB | Select-Object -First 1
    Write-Host "✗ Minimum failed payload: $($minFail.Fields) fields = $($minFail.PayloadKB) KB" -ForegroundColor Red
}

Write-Host ""
Write-Host "RECOMMENDATION:" -ForegroundColor Yellow
if ($maxSuccess) {
    Write-Host "  Use maximum $($maxSuccess.Fields) fields per chunk (~$($maxSuccess.PayloadKB) KB)" -ForegroundColor Yellow
    Write-Host "  This is the safe limit to avoid 504 Gateway Timeout errors" -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Next Steps:"
Write-Host "1. If ALL failed → Jotform UPDATE endpoint is completely broken"
Write-Host "2. If some succeeded → Implement chunked updates with that size"
Write-Host "3. If only small chunks work → May not be worth the complexity"
Write-Host ""
Write-Host "Recommendation: If only 10-20 fields work, just CREATE new submissions instead."
