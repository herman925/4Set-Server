param(
    [string]$ConfigPath,
    [switch]$SingleRun
)

if (-not $ConfigPath) {
    $scriptPath = $MyInvocation.MyCommand.Path
    if (-not $scriptPath) {
        $scriptPath = (Get-Location).ProviderPath
    }
    $ConfigPath = Join-Path (Split-Path -Parent $scriptPath) "config/agent.json"
}

function Resolve-RelativePath {
    param(
        [string]$BasePath,
        [string]$PathValue
    )
    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return $BasePath
    }
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return [System.IO.Path]::GetFullPath($PathValue)
    }
    $combined = Join-Path $BasePath $PathValue
    return [System.IO.Path]::GetFullPath($combined)
}

function Get-OneDriveBasePath {
    param(
        [object]$Config
    )
    
    # If autoDetect is disabled, use fallback
    if ($Config.oneDrive -and -not $Config.oneDrive.autoDetect) {
        $fallback = $Config.oneDrive.fallbackRoot
        if ($fallback -and $Config.oneDrive.relativePath) {
            $fullPath = Join-Path $fallback $Config.oneDrive.relativePath
            Write-Host "[OneDrive] AutoDetect disabled - using configured fallback: $fullPath" -ForegroundColor Cyan
            return $fullPath
        }
    }
    
    # Strategy 1: Environment variables (per PRD line 13)
    Write-Host "[OneDrive] Strategy 1: Environment variables" -ForegroundColor Gray
    
    # OneDriveCommercial (business account - highest priority)
    if ($env:OneDriveCommercial) {
        $testPath = Join-Path $env:OneDriveCommercial $Config.oneDrive.relativePath
        if (Test-Path $testPath) {
            Write-Host "[OneDrive] ✓ Found via OneDriveCommercial: $testPath" -ForegroundColor Green
            return $testPath
        } else {
            Write-Host "[OneDrive] OneDriveCommercial exists but path invalid: $testPath" -ForegroundColor Yellow
        }
    }
    
    # OneDrive (personal account)
    if ($env:OneDrive) {
        $testPath = Join-Path $env:OneDrive $Config.oneDrive.relativePath
        if (Test-Path $testPath) {
            Write-Host "[OneDrive] ✓ Found via OneDrive: $testPath" -ForegroundColor Green
            return $testPath
        }
    }
    
    # Strategy 2: Registry keys (per PRD line 13)
    Write-Host "[OneDrive] Strategy 2: Registry keys" -ForegroundColor Gray
    
    $regPaths = @(
        @{ Path = "HKCU:\Software\Microsoft\OneDrive\Accounts\Business1"; Name = "UserFolder" },
        @{ Path = "HKCU:\Software\Microsoft\OneDrive\Commercial"; Name = "UserFolder" },
        @{ Path = "HKLM:\Software\Microsoft\OneDrive"; Name = "UserFolder" }
    )
    
    foreach ($reg in $regPaths) {
        try {
            if (Test-Path $reg.Path) {
                $regValue = Get-ItemProperty -Path $reg.Path -Name $reg.Name -ErrorAction SilentlyContinue
                if ($regValue -and $regValue.($reg.Name)) {
                    # Check if this is already the full path or just the root
                    $regRoot = $regValue.($reg.Name)
                    
                    # Try direct use first (in case it's already the project root)
                    if (Test-Path $regRoot) {
                        $testPath = Join-Path $regRoot $Config.oneDrive.relativePath
                        if (Test-Path $testPath) {
                            Write-Host "[OneDrive] ✓ Found via registry ($($reg.Path)): $testPath" -ForegroundColor Green
                            return $testPath
                        }
                    }
                }
            }
        } catch {
            # Silently continue to next registry path
        }
    }
    
    # Strategy 3: User Profile root
    Write-Host "[OneDrive] Strategy 3: User profile root" -ForegroundColor Gray
    $userProfile = [Environment]::GetFolderPath('UserProfile')
    if ($userProfile) {
        $testPath = Join-Path $userProfile $Config.oneDrive.relativePath
        if (Test-Path $testPath) {
            Write-Host "[OneDrive] ✓ Found via user profile: $testPath" -ForegroundColor Green
            return $testPath
        }
    }
    
    # Strategy 4: Common OneDrive locations
    Write-Host "[OneDrive] Strategy 4: Common OneDrive locations" -ForegroundColor Gray
    $commonPaths = @(
        "$userProfile\OneDrive - The Education University of Hong Kong",
        "$userProfile\OneDrive for Business"
    )
    
    foreach ($commonPath in $commonPaths) {
        if (Test-Path $commonPath -ErrorAction SilentlyContinue) {
            $testPath = Join-Path $commonPath $Config.oneDrive.relativePath
            if (Test-Path $testPath) {
                Write-Host "[OneDrive] ✓ Found via common location: $testPath" -ForegroundColor Green
                return $testPath
            }
        }
    }
    
    # Strategy 5: Script location analysis
    Write-Host "[OneDrive] Strategy 5: Script location analysis" -ForegroundColor Gray
    $scriptPath = $PSScriptRoot
    if (-not $scriptPath) {
        $scriptPath = (Get-Location).ProviderPath
    }
    
    # Try to extract root from script path
    if ($scriptPath -match '(.*?)(\\The Education University of Hong Kong.*)') {
        $extractedRoot = $Matches[1]
        $testPath = Join-Path $extractedRoot $Config.oneDrive.relativePath
        if (Test-Path $testPath) {
            Write-Host "[OneDrive] ✓ Found via script path analysis: $testPath" -ForegroundColor Green
            return $testPath
        }
    }
    
    # Strategy 6: Configured fallback (final resort)
    Write-Host "[OneDrive] Strategy 6: Configured fallback" -ForegroundColor Yellow
    if ($Config.oneDrive -and $Config.oneDrive.fallbackRoot -and $Config.oneDrive.relativePath) {
        $fullPath = Join-Path $Config.oneDrive.fallbackRoot $Config.oneDrive.relativePath
        Write-Host "[OneDrive] Using fallback path: $fullPath" -ForegroundColor Yellow
        return $fullPath
    }
    
    # Absolute final fallback: script directory
    Write-Host "[OneDrive] All detection failed - using script directory: $scriptPath" -ForegroundColor Red
    return $scriptPath
}

# Get-ComputerNumber function removed - computer number now comes from web upload metadata

$script:AgentSecrets = $null

function Convert-SecureStringToPlainText {
    param([System.Security.SecureString]$SecureString)

    if (-not $SecureString) {
        return ""
    }

    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

function Write-Log {
    <#
    .SYNOPSIS
    Thread-safe logging function with file locking retry mechanism
    
    .DESCRIPTION
    Writes log entries to CSV file using StreamWriter with FileShare.ReadWrite
    to allow concurrent reads while writing. Implements retry logic with 
    exponential backoff to handle file locking conflicts.
    
    Fixed Issue: "The process cannot access the file because it is being used by another process"
    - Excel, log viewer, or other processes reading the CSV file
    - Multiple concurrent PDF processing threads
    
    .PARAMETER Message
    Log message content
    
    .PARAMETER Level
    Log level (INFO, WARN, ERROR, REJECT, UPLOAD, FILED, etc.)
    
    .PARAMETER File
    PDF filename being processed (optional)
    #>
    param(
        [string]$Message,
        [string]$Level = "INFO",
        [string]$File = ""
    )
    
    # Check if this log level is enabled
    if ($script:LogLevels -and $script:LogLevels.PSObject.Properties[$Level]) {
        $enabled = $script:LogLevels.$Level
        if (-not $enabled) {
            return  # Level is explicitly disabled
        }
    }
    
    if (-not $script:LogFile) {
        return
    }
    
    $timestamp = Get-Date -Format "o"
    # Sanitize message: remove line breaks and extra spaces
    $cleanMessage = $Message -replace '[\r\n]+', ' ' -replace '\s+', ' ' -replace '"', '""'
    $logEntry = '{0},{1},"{2}","{3}"' -f $timestamp, $Level, $File, $cleanMessage
    
    # Retry mechanism for file locking conflicts
    $maxRetries = 5
    $retryDelayMs = 50
    $attempt = 0
    
    while ($attempt -lt $maxRetries) {
        try {
            # Use StreamWriter with FileShare.ReadWrite to allow concurrent reads
            $fileStream = [System.IO.File]::Open(
                $script:LogFile,
                [System.IO.FileMode]::Append,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::ReadWrite
            )
            $streamWriter = New-Object System.IO.StreamWriter($fileStream, [System.Text.Encoding]::UTF8)
            $streamWriter.WriteLine($logEntry)
            $streamWriter.Flush()
            $streamWriter.Close()
            $fileStream.Close()
            break  # Success, exit retry loop
        }
        catch {
            $attempt++
            if ($attempt -ge $maxRetries) {
                # Final attempt failed - write to console as fallback
                Write-Warning "Failed to write to log file after $maxRetries attempts: $_"
                Write-Host "[LOG FALLBACK] $logEntry"
                break
            }
            # Wait before retry with exponential backoff
            Start-Sleep -Milliseconds ($retryDelayMs * $attempt)
        }
    }
}

function Get-MasterKeyFromCredentialManager {
    param([string]$Target)

    $password = $null

    if (Get-Command -Name Get-StoredCredential -ErrorAction SilentlyContinue) {
        $credential = Get-StoredCredential -Target $Target -ErrorAction SilentlyContinue
        if ($credential -and $credential.Password) {
            $plain = Convert-SecureStringToPlainText -SecureString $credential.Password
            if (-not [string]::IsNullOrWhiteSpace($plain)) {
                return $plain
            }
        }
    }

    try {
        Import-Module CredentialManager -ErrorAction Stop
        $credential = Get-StoredCredential -Target $Target -ErrorAction SilentlyContinue
        if ($credential -and $credential.Password) {
            $plain = Convert-SecureStringToPlainText -SecureString $credential.Password
            if (-not [string]::IsNullOrWhiteSpace($plain)) {
                return $plain
            }
        }
    } catch {
        try {
            Import-Module CredentialManager -UseWindowsPowerShell -ErrorAction Stop
            $credential = Get-StoredCredential -Target $Target -ErrorAction SilentlyContinue
            if ($credential -and $credential.Password) {
                $plain = Convert-SecureStringToPlainText -SecureString $credential.Password
                if (-not [string]::IsNullOrWhiteSpace($plain)) {
                    return $plain
                }
            }
        } catch {
            # Fall through to native API
        }
    }

    if (-not ("NativeCred.CredMan" -as [Type])) {
        Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

namespace NativeCred {
    public enum CredType : int { Generic = 1 }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct Credential {
        public uint Flags;
        public uint Type;
        public IntPtr TargetName;
        public IntPtr Comment;
        public long LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist;
        public uint AttributeCount;
        public IntPtr Attributes;
        public IntPtr TargetAlias;
        public IntPtr UserName;
    }

    public static class CredMan {
        [DllImport("advapi32", SetLastError = true, CharSet = CharSet.Unicode)]
        public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);

        [DllImport("advapi32", SetLastError = true)]
        public static extern void CredFree(IntPtr cred);
    }
}
'@ -Language CSharp
    }

    $credPtr = [IntPtr]::Zero
    if (-not [NativeCred.CredMan]::CredRead($Target, [int][NativeCred.CredType]::Generic, 0, [ref]$credPtr)) {
        $errorCode = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        throw "Master key '$Target' not found in Credential Manager (CredRead error $errorCode)."
    }

    try {
        $cred = [Runtime.InteropServices.Marshal]::PtrToStructure($credPtr, [type]([NativeCred.Credential]))
        $blobBytes = @()
        if ($cred.CredentialBlobSize -gt 0) {
            $blobBytes = New-Object byte[] $cred.CredentialBlobSize
            [Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $blobBytes, 0, $cred.CredentialBlobSize)
        }
        $password = [System.Text.Encoding]::Unicode.GetString($blobBytes)
    } finally {
        if ($credPtr -ne [IntPtr]::Zero) {
            [NativeCred.CredMan]::CredFree($credPtr)
        }
    }

    if ([string]::IsNullOrWhiteSpace($password)) {
        throw "Master key '$Target' retrieved but empty."
    }
    return $password
}

function Unlock-AgentBundle {
    param(
        [byte[]]$EncryptedBytes,
        [string]$Passphrase
    )

    $saltLength = 16
    $ivLength = 12
    $tagLength = 16

    if (-not $EncryptedBytes -or $EncryptedBytes.Length -lt ($saltLength + $ivLength + $tagLength + 1)) {
        throw "Encrypted credential bundle is invalid or empty."
    }

    $offset = 0
    $salt = New-Object byte[] $saltLength
    [Array]::Copy($EncryptedBytes, $offset, $salt, 0, $saltLength)
    $offset += $saltLength

    $iv = New-Object byte[] $ivLength
    [Array]::Copy($EncryptedBytes, $offset, $iv, 0, $ivLength)
    $offset += $ivLength

    $remaining = $EncryptedBytes.Length - $offset
    if ($remaining -le $tagLength) {
        throw "Encrypted credential bundle is missing authentication tag."
    }

    $cipherLength = $remaining - $tagLength
    $cipherBytes = New-Object byte[] $cipherLength
    [Array]::Copy($EncryptedBytes, $offset, $cipherBytes, 0, $cipherLength)
    $offset += $cipherLength

    $tagBytes = New-Object byte[] $tagLength
    [Array]::Copy($EncryptedBytes, $offset, $tagBytes, 0, $tagLength)

    $keyBytes = $null

    try {
        $candidate = [Convert]::FromBase64String($Passphrase)
        if ($candidate.Length -eq 32) {
            $keyBytes = $candidate
        }
    } catch {
        # passphrase is not base64, fall back to PBKDF2
    }

    if (-not $keyBytes) {
        $passphraseBytes = [System.Text.Encoding]::UTF8.GetBytes($Passphrase)
        $pbkdf2 = [System.Security.Cryptography.Rfc2898DeriveBytes]::new($passphraseBytes, $salt, 100000, [System.Security.Cryptography.HashAlgorithmName]::SHA256)
        $keyBytes = $pbkdf2.GetBytes(32)
    }

    $plaintext = New-Object byte[] $cipherBytes.Length
    try {
        $aesGcm = [System.Security.Cryptography.AesGcm]::new($keyBytes)
        $aesGcm.Decrypt($iv, $cipherBytes, $tagBytes, $plaintext)
    } catch [System.Management.Automation.RuntimeException] {
        if ($_.Exception.Message -like "*Unable to find type*AesGcm*") {
            throw "AES-GCM encryption requires PowerShell 7 or later. Please install PowerShell 7: https://aka.ms/powershell-release?tag=stable"
        }
        throw "Failed to decrypt credential bundle: $($_.Exception.Message)"
    } catch {
        throw "Failed to decrypt credential bundle: $($_.Exception.Message)"
    }

    $text = [System.Text.Encoding]::UTF8.GetString($plaintext)
    return $text
}

function Invoke-PdfParser {
    param(
        [string]$PdfPath,
        [string]$OutputJsonPath
    )

    $result = @{
        success = $false
        error = ""
        jsonPath = ""
    }

    try {
        $parserScript = Join-Path $PSScriptRoot "parser/parse_pdf_cli.py"
        
        if (-not (Test-Path $parserScript)) {
            throw "Python parser not found: $parserScript"
        }
        
        # Parsing started - no log (too verbose)
        
        $pythonCmd = $null
        
        $pythonCandidates = Get-Command "python","python3" -ErrorAction SilentlyContinue | Where-Object { $_.Source -notlike "*WindowsApps*" }
        if ($pythonCandidates) {
            $pythonCmd = $pythonCandidates[0].Source
        } else {
            $fallbackPaths = Get-ChildItem "C:\Python*\python.exe" -ErrorAction SilentlyContinue
            if ($fallbackPaths) {
                $pythonCmd = $fallbackPaths[0].FullName
            }
        }
        
        if (-not $pythonCmd) {
            throw "Python executable not found. Please install Python 3.7+ and ensure it's in PATH (not Windows Store stub)."
        }
        
        $processInfo = New-Object System.Diagnostics.ProcessStartInfo
        $processInfo.FileName = $pythonCmd
        $processInfo.Arguments = "`"$parserScript`" `"$PdfPath`" `"$OutputJsonPath`""
        $processInfo.RedirectStandardOutput = $true
        $processInfo.RedirectStandardError = $true
        $processInfo.UseShellExecute = $false
        $processInfo.CreateNoWindow = $true
        
        $process = New-Object System.Diagnostics.Process
        $process.StartInfo = $processInfo
        
        $process.Start() | Out-Null
        $stderr = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        
        if ($process.ExitCode -eq 0) {
            $result.success = $true
            $result.jsonPath = $OutputJsonPath
            # Parser succeeded - no log (too verbose)
        } else {
            $result.error = "Python parser failed (exit code $($process.ExitCode)): $stderr"
            Write-Log -Message "Python parser failed: $stderr" -Level "ERROR" -File ([System.IO.Path]::GetFileName($PdfPath))
        }
        
        return $result
    } catch {
        $result.error = $_.Exception.Message
        Write-Log -Message "Parser invocation failed: $($_.Exception.Message)" -Level "ERROR" -File ([System.IO.Path]::GetFileName($PdfPath))
        return $result
    }
}

function Extract-PdfMetadata {
    param([string]$JsonPath)

    $result = @{
        success = $false
        error = ""
        coreId = ""
        schoolId = ""
        sessionkey = ""
        fields = @{}
    }

    try {
        if (-not (Test-Path $JsonPath)) {
            $result.error = "JSON file not found: $JsonPath"
            return $result
        }

        $json = Get-Content -Path $JsonPath -Raw | ConvertFrom-Json
        
        # Field names now match jotformquestions.json (lowercase with hyphens)
        $studentId = $json.data.'student-id'
        if (-not $studentId) { $studentId = $json.data.'Student ID' }  # Fallback for old format
        
        $schoolId = $json.data.'school-id'
        if (-not $schoolId) { $schoolId = $json.data.'School ID' }  # Fallback for old format
        
        $sessionkey = $json.data.'sessionkey'
        if (-not $sessionkey) { $sessionkey = $json.data.'Sessionkey' }  # Fallback for old format
        
        if ($studentId) {
            $cleanId = $studentId -replace '[^\d]', ''
            $result.coreId = "C" + $cleanId
        }
        
        if ($schoolId) {
            $cleanSchoolId = $schoolId -replace '[^\d]', ''
            $result.schoolId = "S" + $cleanSchoolId.PadLeft(3, '0')
        }
        
        if ($sessionkey) {
            $result.sessionkey = $sessionkey.Trim()
        }
        
        if ([string]::IsNullOrWhiteSpace($result.coreId)) {
            $result.error = "Could not extract Core ID from JSON data"
            return $result
        }

        $result.fields = $json.data
        $result.success = $true
        return $result
    } catch {
        $result.error = $_.Exception.Message
        return $result
    }
}

function Load-AgentSecrets {
    param(
        [string]$SecretsPath,
        [string]$KeyIdentifier
    )

    if ($script:AgentSecrets) {
        return $script:AgentSecrets
    }

    $bundle = $null

    try {
        $masterKey = Get-MasterKeyFromCredentialManager -Target $KeyIdentifier
        $encryptedBytes = [System.IO.File]::ReadAllBytes($SecretsPath)
        $bundleText = Unlock-AgentBundle -EncryptedBytes $encryptedBytes -Passphrase $masterKey
        $bundle = $bundleText | ConvertFrom-Json
        
        $systemPassword = $bundle.systemPassword
        if ($systemPassword) {
            $coreidPath = Join-Path (Split-Path $SecretsPath) "coreid.enc"
            $schoolidPath = Join-Path (Split-Path $SecretsPath) "schoolid.enc"
            
            if (Test-Path $coreidPath) {
                $coreidBytes = [System.IO.File]::ReadAllBytes($coreidPath)
                $coreidText = Unlock-AgentBundle -EncryptedBytes $coreidBytes -Passphrase $systemPassword
                
                if ($coreidText.TrimStart().StartsWith('{') -or $coreidText.TrimStart().StartsWith('[')) {
                    $coreidData = $coreidText | ConvertFrom-Json
                } else {
                    $coreidData = $coreidText | ConvertFrom-Csv
                    $coreidMap = @{}
                    foreach ($row in $coreidData) {
                        $coreId = $row.'Core ID'
                        if (-not $coreId.StartsWith('C')) {
                            $coreId = "C" + $coreId
                        }
                        $coreidMap[$coreId] = $row
                    }
                    $coreidData = $coreidMap
                }
                
                $bundle | Add-Member -NotePropertyName "coreIdMap" -NotePropertyValue $coreidData -Force
            }
            
            if (Test-Path $schoolidPath) {
                $schoolidBytes = [System.IO.File]::ReadAllBytes($schoolidPath)
                $schoolidText = Unlock-AgentBundle -EncryptedBytes $schoolidBytes -Passphrase $systemPassword
                
                if ($schoolidText.TrimStart().StartsWith('{') -or $schoolidText.TrimStart().StartsWith('[')) {
                    $schoolidData = $schoolidText | ConvertFrom-Json
                } else {
                    $schoolidData = $schoolidText | ConvertFrom-Csv
                    # Convert to hashtable for easier lookup by School ID
                    $schoolidMap = @{}
                    foreach ($row in $schoolidData) {
                        $schoolKey = $row.'School ID'
                        if (-not [string]::IsNullOrWhiteSpace($schoolKey)) {
                            $schoolidMap[$schoolKey] = $row
                        }
                    }
                    $schoolidData = $schoolidMap
                }
                
                $bundle | Add-Member -NotePropertyName "schoolIdMap" -NotePropertyValue $schoolidData -Force
            }
            
            $classidPath = Join-Path (Split-Path $SecretsPath) "classid.enc"
            if (Test-Path $classidPath) {
                $classidBytes = [System.IO.File]::ReadAllBytes($classidPath)
                $classidText = Unlock-AgentBundle -EncryptedBytes $classidBytes -Passphrase $systemPassword
                
                if ($classidText.TrimStart().StartsWith('{') -or $classidText.TrimStart().StartsWith('[')) {
                    $classidData = $classidText | ConvertFrom-Json
                } else {
                    $classidData = $classidText | ConvertFrom-Csv
                    # Convert to hashtable for easier lookup by Class ID
                    $classidMap = @{}
                    foreach ($row in $classidData) {
                        $classKey = $row.'Class ID'
                        if (-not [string]::IsNullOrWhiteSpace($classKey)) {
                            $classidMap[$classKey] = $row
                        }
                    }
                    $classidData = $classidMap
                }
                
                $bundle | Add-Member -NotePropertyName "classIdMap" -NotePropertyValue $classidData -Force
            }
            
            # Load jotformquestions.json mapping (from assets root)
            $jotformQuestionsPath = Join-Path (Split-Path $SecretsPath) "jotformquestions.json"
            
            if (Test-Path $jotformQuestionsPath) {
                $jotformQuestionsText = Get-Content $jotformQuestionsPath -Raw
                $jotformQuestionsData = $jotformQuestionsText | ConvertFrom-Json
                
                # Convert to hashtable for easy lookup (field name → QID)
                $jotformMap = @{}
                foreach ($prop in $jotformQuestionsData.PSObject.Properties) {
                    $jotformMap[$prop.Name] = $prop.Value
                }
                
                $bundle | Add-Member -NotePropertyName "jotformQuestions" -NotePropertyValue $jotformMap -Force
            }
        }
    } catch {
        Write-Log -Message ("Failed to load secrets: {0}" -f $_.Exception.Message) -Level "ERROR"
        $script:AgentSecrets = @{
            CredentialBundlePath = $SecretsPath
            MasterKeyReference   = $KeyIdentifier
            LoadedAt             = (Get-Date -Format o)
            Error                = $_.Exception.Message
            Bundle               = $null
        }
        return $script:AgentSecrets
    }

    $script:AgentSecrets = @{
        CredentialBundlePath = $SecretsPath
        MasterKeyReference   = $KeyIdentifier
        LoadedAt             = (Get-Date -Format o)
        Bundle               = $bundle
    }
    return $script:AgentSecrets
}

function Invoke-Phase2Validation {
    param(
        [string]$FilePath,
        [string]$FileName,
        [hashtable]$AgentSecrets,
        [string]$CoreId,
        [datetime]$ParsedDate,
        [int]$Hour,
        [int]$Minute
    )

    $result = [pscustomobject]@{
        IsValid    = $true
        Reason     = ""
        ReasonCode = ""
        Metadata   = @{}
    }

    if (-not $AgentSecrets) {
        $result.IsValid = $false
        $result.Reason = "Agent secrets unavailable; cannot perform mapping lookup."
        $result.ReasonCode = "secrets_unavailable"
        return $result
    }

    $bundle = $AgentSecrets.Bundle
    if (-not $bundle) {
        Write-Log -Message "Phase2: AgentSecrets exists but Bundle is null" -Level "ERROR" -File $FileName
        $result.IsValid = $false
        $result.Reason = "Secrets bundle not available; mapping data missing."
        $result.ReasonCode = "secrets_unavailable"
        return $result
    }
    
    # Validation bundle loaded

    $pdfData = Extract-PdfMetadata -JsonPath $FilePath
    if (-not $pdfData.success) {
        Write-Log -Message "Phase2: PDF extraction failed - $($pdfData.error)" -Level "ERROR" -File $FileName
        $result.IsValid = $false
        $result.Reason = "PDF extraction failed: $($pdfData.error)"
        $result.ReasonCode = "pdf_extraction_failed"
        return $result
    }

    $extractedCoreId = $pdfData.coreId
    $extractedSchoolId = $pdfData.schoolId
    $extractedSessionkey = $pdfData.sessionkey
    
    if ([string]::IsNullOrWhiteSpace($extractedCoreId)) {
        Write-Log -Message "Phase2: Could not extract Core ID from JSON" -Level "ERROR" -File $FileName
        $result.IsValid = $false
        $result.Reason = "Core ID missing in parsed data"
        $result.ReasonCode = "coreid_missing_in_pdf"
        return $result
    }

    # CRITICAL VALIDATION 1: Construct and compare sessionkey (FULL match including date/time)
    # PDF's sessionkey field format: "YYYY/MM/DD HH:MM" (e.g., "2025/09/04 14:07")
    # Filename format: "coreID_YYYYMMDD_HH_MM" (e.g., "13268_20250904_14_07")
    # We must CONSTRUCT the canonical sessionkey from BOTH PDF and filename components
    
    # Construct canonical filename sessionkey from validated components
    # This ensures we compare canonical forms, not raw strings with extra symbols
    $filenameSessionkey = "{0}_{1}_{2:D2}_{3:D2}" -f $CoreId, $ParsedDate.ToString("yyyyMMdd"), $Hour, $Minute
    
    # Extract Core ID digits from PDF (remove "C" prefix)
    $pdfCoreIdDigits = $extractedCoreId -replace '^C', ''
    
    # Parse PDF's sessionkey field to construct canonical format
    # Expected format: "YYYY/MM/DD HH:MM" or "YYYY/M/D H:M"
    $pdfConstructedSessionkey = $null
    
    if (-not [string]::IsNullOrWhiteSpace($extractedSessionkey)) {
        try {
            # Try parsing common datetime formats (PowerShell syntax)
            $parsedDateTime = $null
            $formats = @(
                'yyyy/MM/dd HH:mm',
                'yyyy/M/d H:m',
                'yyyy/MM/dd H:mm',
                'yyyy/M/dd HH:mm',
                'yyyy-MM-dd HH:mm',
                'yyyy-M-d H:m'
            )
            
            foreach ($format in $formats) {
                try {
                    # PowerShell DateTime parsing
                    $parsedDateTime = [DateTime]::ParseExact($extractedSessionkey, $format, [System.Globalization.CultureInfo]::InvariantCulture)
                    
                    # Successfully parsed - construct canonical sessionkey
                    $pdfConstructedSessionkey = "{0}_{1}_{2:D2}_{3:D2}" -f $pdfCoreIdDigits, $parsedDateTime.ToString("yyyyMMdd"), $parsedDateTime.Hour, $parsedDateTime.Minute
                    # Sessionkey constructed - no log (too verbose)
                    break
                } catch {
                    # Try next format
                    continue
                }
            }
            
            if (-not $pdfConstructedSessionkey) {
                Write-Log -Message "Phase2: Could not parse PDF sessionkey timestamp: '$extractedSessionkey' (tried $($formats.Count) formats)" -Level "WARN" -File $FileName
            }
        } catch {
            Write-Log -Message "Phase2: Error parsing PDF sessionkey: $($_.Exception.Message)" -Level "WARN" -File $FileName
        }
    }
    
    # Compare constructed PDF sessionkey with filename
    if ($pdfConstructedSessionkey -and $pdfConstructedSessionkey -ne $filenameSessionkey) {
        # Break down the mismatch to show exactly what's different
        $filenameParts = $filenameSessionkey -split '_'
        $pdfParts = $pdfConstructedSessionkey -split '_'
        
        $mismatchDetails = @()
        if ($filenameParts[0] -ne $pdfParts[0]) {
            $mismatchDetails += "Core ID (filename: '$($filenameParts[0])' vs PDF: '$($pdfParts[0])')"
        }
        if ($filenameParts[1] -ne $pdfParts[1]) {
            $mismatchDetails += "Date (filename: '$($filenameParts[1])' vs PDF: '$($pdfParts[1])')"
        }
        if ($filenameParts[2] -ne $pdfParts[2]) {
            $mismatchDetails += "Hour (filename: '$($filenameParts[2])' vs PDF: '$($pdfParts[2])')"
        }
        if ($filenameParts[3] -ne $pdfParts[3]) {
            $mismatchDetails += "Minute (filename: '$($filenameParts[3])' vs PDF: '$($pdfParts[3])')"
        }
        
        $mismatchSummary = $mismatchDetails -join ', '
        
        Write-Log -Message "Sessionkey mismatch: $mismatchSummary" -Level "REJECT" -File $FileName
        Write-Log -Message "Details: Filename='$filenameSessionkey' vs PDF='$pdfConstructedSessionkey' (from student-id='$pdfCoreIdDigits' + timestamp='$extractedSessionkey')" -Level "REJECT" -File $FileName
        $result.IsValid = $false
        $result.Reason = "Sessionkey mismatch: $mismatchSummary"
        $result.ReasonCode = "sessionkey_filename_mismatch"
        return $result
    }
    
    # Fallback: If we couldn't construct full sessionkey, at least validate Core ID
    if (-not $pdfConstructedSessionkey) {
        $filenameCoreId = $CoreId
        if ($pdfCoreIdDigits -ne $filenameCoreId) {
            Write-Log -Message "Core ID mismatch: Filename='$filenameCoreId' vs PDF='$pdfCoreIdDigits'" -Level "REJECT" -File $FileName
            $result.IsValid = $false
            $result.Reason = "PDF Core ID Mismatch: Filename indicates '$filenameCoreId' but PDF contains '$pdfCoreIdDigits'. This indicates data corruption or incorrect filing."
            $result.ReasonCode = "coreid_filename_mismatch"
            return $result
        }
    }
    
    # Log successful match
    # Validation passed - no log (logged as SUCCESS at end)

    # Extracted Core ID, School ID, and Sessionkey from JSON validated

    $result.Metadata = @{
        coreId     = $extractedCoreId
        extractedCoreId = $extractedCoreId
        extractedSchoolId = $extractedSchoolId
        extractedSessionkey = $extractedSessionkey
        pdfConstructedSessionkey = $pdfConstructedSessionkey
        filenameSessionkey = $filenameSessionkey
        date       = if ($ParsedDate) { $ParsedDate.ToString("yyyy-MM-dd") } else { $null }
        hour       = $Hour
        minute     = $Minute
        bundlePath = $AgentSecrets.CredentialBundlePath
    }

    $coreMap = $null
    if ($bundle.coreIdMap) {
        $coreMap = $bundle.coreIdMap
    } elseif ($bundle.coreMappings) {
        $coreMap = $bundle.coreMappings
    }

    if (-not $coreMap) {
        Write-Log -Message "No mapping data available, skipping school ID cross-validation" -Level "WARN" -File $FileName
        return $result
    }

    $studentRecord = $coreMap.$extractedCoreId
    if (-not $studentRecord) {
        Write-Log -Message "Phase2: Core ID $extractedCoreId not found in mapping" -Level "WARN" -File $FileName
        $result.IsValid = $false
        $result.Reason = "Core ID '$extractedCoreId' not found in mapping data."
        $result.ReasonCode = "coreid_missing_in_mapping"
        return $result
    }

    $mappedSchoolId = if ($studentRecord.'School ID') { $studentRecord.'School ID' } else { $studentRecord.schoolId }
    if (-not $mappedSchoolId) {
        $mappedSchoolId = $studentRecord.SchoolId
    }

    if ($extractedSchoolId -and $mappedSchoolId -and ($mappedSchoolId -ne $extractedSchoolId)) {
        Write-Log -Message "School ID mismatch: PDF='$extractedSchoolId' vs Mapping='$mappedSchoolId'" -Level "REJECT" -File $FileName
        $result.IsValid = $false
        $result.Reason = "School ID mismatch: JSON shows '$extractedSchoolId' but mapping expects '$mappedSchoolId' for Core ID '$extractedCoreId'."
        $result.ReasonCode = "coreid_schoolid_mismatch"
        return $result
    }

    $result.Metadata.schoolId = $mappedSchoolId
    $result.Metadata.mappedSchoolId = $mappedSchoolId
    $result.Metadata.studentName = $studentRecord.studentName
    if (-not $result.Metadata.studentName) {
        $result.Metadata.studentName = $studentRecord.StudentName
    }

    # Validation passed
    return $result
}

function Add-TerminationOutcomes {
    param(
        [PSCustomObject]$Data,
        [string]$FileName
    )
    
    try {
        # Load task definitions to get correct answers
        $taskPath = Join-Path (Split-Path $PSScriptRoot) "assets\tasks"
        
        # ERV Terminations
        # ERV_Ter1: Q1-Q12, need ≥5 correct to continue
        # Only calculate if the field exists in PDF structure but is empty
        if ($Data.PSObject.Properties['ERV_Ter1'] -and [string]::IsNullOrWhiteSpace($Data.ERV_Ter1)) {
            $totalQuestions = 12
            $threshold = 5
            $answered = 0
            $correct = 0
            
            for ($i = 1; $i -le $totalQuestions; $i++) {
                $fieldName = "ERV_Q${i}"
                if ($Data.PSObject.Properties[$fieldName] -and -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
                    $answered++
                    $scoreField = "ERV_Q${i}_Sc"
                    if ($Data.$scoreField -eq '1') { $correct++ }
                }
            }
            
            $unanswered = $totalQuestions - $answered
            $maxPossible = $correct + $unanswered
            
            # Only set termination if we're absolutely certain
            if ($correct -ge $threshold) {
                # Already passed threshold
                $Data.ERV_Ter1 = "0"
                $Data | Add-Member -NotePropertyName 'term_ERV_Ter1' -NotePropertyValue "0" -Force
            } elseif ($maxPossible -lt $threshold) {
                # Impossible to reach threshold even if all remaining are correct
                $Data.ERV_Ter1 = "1"
                $Data | Add-Member -NotePropertyName 'term_ERV_Ter1' -NotePropertyValue "1" -Force
            }
            # Else: still possible to pass, don't set termination
        }
        
        # ERV_Ter2: Q13-Q24, need ≥5 correct to continue
        if ($Data.PSObject.Properties['ERV_Ter2'] -and [string]::IsNullOrWhiteSpace($Data.ERV_Ter2)) {
            $totalQuestions = 12
            $threshold = 5
            $answered = 0
            $correct = 0
            
            for ($i = 13; $i -le 24; $i++) {
                $fieldName = "ERV_Q${i}"
                if ($Data.PSObject.Properties[$fieldName] -and -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
                    $answered++
                    $scoreField = "ERV_Q${i}_Sc"
                    if ($Data.$scoreField -eq '1') { $correct++ }
                }
            }
            
            $unanswered = $totalQuestions - $answered
            $maxPossible = $correct + $unanswered
            
            if ($correct -ge $threshold) {
                $Data.ERV_Ter2 = "0"
                $Data | Add-Member -NotePropertyName 'term_ERV_Ter2' -NotePropertyValue "0" -Force
            } elseif ($maxPossible -lt $threshold) {
                $Data.ERV_Ter2 = "1"
                $Data | Add-Member -NotePropertyName 'term_ERV_Ter2' -NotePropertyValue "1" -Force
            }
        }
        
        # ERV_Ter3: Q25-Q36, need ≥5 correct to continue
        if ($Data.PSObject.Properties['ERV_Ter3'] -and [string]::IsNullOrWhiteSpace($Data.ERV_Ter3)) {
            $totalQuestions = 12
            $threshold = 5
            $answered = 0
            $correct = 0
            
            for ($i = 25; $i -le 36; $i++) {
                $fieldName = "ERV_Q${i}"
                if ($Data.PSObject.Properties[$fieldName] -and -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
                    $answered++
                    $scoreField = "ERV_Q${i}_Sc"
                    if ($Data.$scoreField -eq '1') { $correct++ }
                }
            }
            
            $unanswered = $totalQuestions - $answered
            $maxPossible = $correct + $unanswered
            
            if ($correct -ge $threshold) {
                $Data.ERV_Ter3 = "0"
                $Data | Add-Member -NotePropertyName 'term_ERV_Ter3' -NotePropertyValue "0" -Force
            } elseif ($maxPossible -lt $threshold) {
                $Data.ERV_Ter3 = "1"
                $Data | Add-Member -NotePropertyName 'term_ERV_Ter3' -NotePropertyValue "1" -Force
            }
        }
        
        # CM Terminations
        # CM_Ter1: Q1-Q7, need ≥4 correct to continue
        if ($Data.PSObject.Properties['CM_Ter1'] -and [string]::IsNullOrWhiteSpace($Data.CM_Ter1)) {
            $totalQuestions = 7
            $threshold = 4
            $answered = 0
            $correct = 0
            
            for ($i = 1; $i -le $totalQuestions; $i++) {
                $fieldName = "CM_Q${i}_TEXT"
                if ($Data.PSObject.Properties[$fieldName] -and -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
                    $answered++
                    if ($Data.$fieldName -eq '1') { $correct++ }
                }
            }
            
            $unanswered = $totalQuestions - $answered
            $maxPossible = $correct + $unanswered
            
            if ($correct -ge $threshold) {
                $Data.CM_Ter1 = "0"
                $Data | Add-Member -NotePropertyName 'term_CM_Ter1' -NotePropertyValue "0" -Force
            } elseif ($maxPossible -lt $threshold) {
                $Data.CM_Ter1 = "1"
                $Data | Add-Member -NotePropertyName 'term_CM_Ter1' -NotePropertyValue "1" -Force
            }
        }
        
        # CM_Ter2: Q8-Q12, need ≥4 correct to continue
        if ($Data.PSObject.Properties['CM_Ter2'] -and [string]::IsNullOrWhiteSpace($Data.CM_Ter2)) {
            $totalQuestions = 5
            $threshold = 4
            $answered = 0
            $correct = 0
            
            for ($i = 8; $i -le 12; $i++) {
                $fieldName = "CM_Q${i}_TEXT"
                if ($Data.PSObject.Properties[$fieldName] -and -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
                    $answered++
                    if ($Data.$fieldName -eq '1') { $correct++ }
                }
            }
            
            $unanswered = $totalQuestions - $answered
            $maxPossible = $correct + $unanswered
            
            if ($correct -ge $threshold) {
                $Data.CM_Ter2 = "0"
                $Data | Add-Member -NotePropertyName 'term_CM_Ter2' -NotePropertyValue "0" -Force
            } elseif ($maxPossible -lt $threshold) {
                $Data.CM_Ter2 = "1"
                $Data | Add-Member -NotePropertyName 'term_CM_Ter2' -NotePropertyValue "1" -Force
            }
        }
        
        # CM_Ter3: Q13-Q17, need ≥4 correct to continue
        if ($Data.PSObject.Properties['CM_Ter3'] -and [string]::IsNullOrWhiteSpace($Data.CM_Ter3)) {
            $totalQuestions = 5
            $threshold = 4
            $answered = 0
            $correct = 0
            
            for ($i = 13; $i -le 17; $i++) {
                $fieldName = "CM_Q${i}_TEXT"
                if ($Data.PSObject.Properties[$fieldName] -and -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
                    $answered++
                    if ($Data.$fieldName -eq '1') { $correct++ }
                }
            }
            
            $unanswered = $totalQuestions - $answered
            $maxPossible = $correct + $unanswered
            
            if ($correct -ge $threshold) {
                $Data.CM_Ter3 = "0"
                $Data | Add-Member -NotePropertyName 'term_CM_Ter3' -NotePropertyValue "0" -Force
            } elseif ($maxPossible -lt $threshold) {
                $Data.CM_Ter3 = "1"
                $Data | Add-Member -NotePropertyName 'term_CM_Ter3' -NotePropertyValue "1" -Force
            }
        }
        
        # CM_Ter4: Q18-Q22, need ≥4 correct to continue
        if ($Data.PSObject.Properties['CM_Ter4'] -and [string]::IsNullOrWhiteSpace($Data.CM_Ter4)) {
            $totalQuestions = 5
            $threshold = 4
            $answered = 0
            $correct = 0
            
            for ($i = 18; $i -le 22; $i++) {
                $fieldName = "CM_Q${i}_TEXT"
                if ($Data.PSObject.Properties[$fieldName] -and -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
                    $answered++
                    if ($Data.$fieldName -eq '1') { $correct++ }
                }
            }
            
            $unanswered = $totalQuestions - $answered
            $maxPossible = $correct + $unanswered
            
            if ($correct -ge $threshold) {
                $Data.CM_Ter4 = "0"
                $Data | Add-Member -NotePropertyName 'term_CM_Ter4' -NotePropertyValue "0" -Force
            } elseif ($maxPossible -lt $threshold) {
                $Data.CM_Ter4 = "1"
                $Data | Add-Member -NotePropertyName 'term_CM_Ter4' -NotePropertyValue "1" -Force
            }
        }
        
        # CWR: 10 consecutive incorrect
        # Only terminate if we've actually observed 10 consecutive incorrect
        if ($Data.PSObject.Properties['CWR_10Incorrect'] -and [string]::IsNullOrWhiteSpace($Data.CWR_10Incorrect)) {
            $consecutiveIncorrect = 0
            $maxConsecutive = 0
            
            for ($i = 1; $i -le 60; $i++) {
                $fieldName = "CWR_Q${i}_TEXT"
                if ($Data.PSObject.Properties[$fieldName] -and -not [string]::IsNullOrWhiteSpace($Data.$fieldName)) {
                    if ($Data.$fieldName -eq '0') {
                        $consecutiveIncorrect++
                        if ($consecutiveIncorrect -gt $maxConsecutive) {
                            $maxConsecutive = $consecutiveIncorrect
                        }
                    } else {
                        $consecutiveIncorrect = 0
                    }
                }
            }
            
            # Only set to "1" if we've actually seen 10 consecutive incorrect
            # Set to "0" only if impossible (would need correct answer to exist)
            if ($maxConsecutive -ge 10) {
                $Data.CWR_10Incorrect = "1"
                $Data | Add-Member -NotePropertyName 'term_CWR_10Incorrect' -NotePropertyValue "1" -Force
            }
            # Don't set to "0" unless we're sure they passed - CWR doesn't have a "passed" state
        }
        
        # FM Fine Motor: Square cutting termination
        # Only terminate if ALL 3 square items answered AND all are 0
        if ($Data.PSObject.Properties['FM_Ter'] -and [string]::IsNullOrWhiteSpace($Data.FM_Ter)) {
            $totalSquareItems = 3
            $answered = 0
            $correct = 0
            
            foreach ($field in @('FM_squ_1', 'FM_squ_2', 'FM_squ_3')) {
                if ($Data.PSObject.Properties[$field] -and -not [string]::IsNullOrWhiteSpace($Data.$field)) {
                    $answered++
                    if ($Data.$field -ne '0') {
                        $correct++
                    }
                }
            }
            
            $unanswered = $totalSquareItems - $answered
            
            # Only set termination if we're absolutely certain
            if ($correct -gt 0) {
                # At least one correct answer, did not terminate
                $Data.FM_Ter = "0"
                $Data | Add-Member -NotePropertyName 'term_FM_Ter' -NotePropertyValue "0" -Force
            } elseif ($unanswered -eq 0 -and $correct -eq 0) {
                # All answered, all incorrect (score 0), terminated
                $Data.FM_Ter = "1"
                $Data | Add-Member -NotePropertyName 'term_FM_Ter' -NotePropertyValue "1" -Force
            }
            # Else: some unanswered and no correct yet - still possible to get > 0
        }
        
    } catch {
        Write-Log -Message "Termination calculation warning: $($_.Exception.Message)" -Level "WARN" -File $FileName
    }
}

function Enrich-JsonFields {
    param(
        [string]$JsonPath,
        [string]$SessionKey,
        [string]$CoreId,
        [hashtable]$CoreIdMap,
        [hashtable]$ClassIdMap,
        [hashtable]$SchoolIdMap,
        [string]$FileName,
        [string]$ComputerNo = $null
    )
    
    try {
        $json = Get-Content -Path $JsonPath -Raw | ConvertFrom-Json
        $data = $json.data
        
        # 1. Construct canonical sessionkey from PDF data (student-id + timestamp)
        # The PDF has a sessionkey timestamp field (e.g., "2025/09/04 15:38")
        # We need to combine it with student-id to create the canonical format
        $studentId = $data.'student-id'
        $sessionkeyTimestamp = $data.'sessionkey'
        
        if ($studentId -and $sessionkeyTimestamp) {
            # Parse the timestamp and construct canonical sessionkey
            $formats = @(
                'yyyy/MM/dd HH:mm',
                'yyyy/M/d H:m',
                'yyyy/MM/dd H:mm',
                'yyyy/M/dd HH:mm'
            )
            
            $canonicalSessionkey = $null
            foreach ($format in $formats) {
                try {
                    $parsedDateTime = [DateTime]::ParseExact($sessionkeyTimestamp, $format, [System.Globalization.CultureInfo]::InvariantCulture)
                    $studentIdDigits = $studentId -replace '[^\d]', ''
                    $canonicalSessionkey = "{0}_{1}_{2:D2}_{3:D2}" -f $studentIdDigits, $parsedDateTime.ToString("yyyyMMdd"), $parsedDateTime.Hour, $parsedDateTime.Minute
                    break
                } catch {
                    # Try next format
                }
            }
            
            if ($canonicalSessionkey) {
                $data | Add-Member -NotePropertyName 'sessionkey' -NotePropertyValue $canonicalSessionkey -Force
            } else {
                # Fallback to SessionKey parameter if parsing fails
                $data | Add-Member -NotePropertyName 'sessionkey' -NotePropertyValue $SessionKey -Force
            }
        } else {
            # Fallback: use SessionKey parameter if PDF data is missing
            $data | Add-Member -NotePropertyName 'sessionkey' -NotePropertyValue $SessionKey -Force
        }
        
        # 2. Set computerno from web upload metadata
        if ($ComputerNo) {
            # Computer number from metadata file (web upload)
            $computerNo = $ComputerNo
            Write-Log -Message "Using computer number from web upload: $computerNo" -Level "INFO" -File $FileName
        } else {
            # No metadata - use fallback
            $computerNo = "000"
            Write-Log -Message "No metadata found, using fallback computer number: 000" -Level "WARN" -File $FileName
        }
        
        $data | Add-Member -NotePropertyName 'computerno' -NotePropertyValue $computerNo -Force
        
        # 3. Format school-id to Sxxx format
        $rawSchoolId = $data.'school-id'
        $formattedSchoolId = $null
        if ($rawSchoolId) {
            $cleanSchoolId = $rawSchoolId -replace '[^\d]', ''
            $formattedSchoolId = "S" + $cleanSchoolId.PadLeft(3, '0')
            $data | Add-Member -NotePropertyName 'school-id' -NotePropertyValue $formattedSchoolId -Force
            Write-Log -Message "Formatted school-id: $rawSchoolId → $formattedSchoolId" -Level "INFO" -File $FileName
        }
        
        # 3.5. Lookup District from schoolid.enc based on School ID
        if ($formattedSchoolId -and $SchoolIdMap -and $SchoolIdMap.ContainsKey($formattedSchoolId)) {
            $schoolRecord = $SchoolIdMap[$formattedSchoolId]
            $district = $schoolRecord.'District Cleaned'
            if (-not [string]::IsNullOrWhiteSpace($district)) {
                $data | Add-Member -NotePropertyName 'District' -NotePropertyValue $district -Force
                Write-Log -Message "Added District: $district (from $formattedSchoolId)" -Level "INFO" -File $FileName
            }
        }
        
        # 4. Initialize jotformsubmissionid as empty
        if (-not $data.jotformsubmissionid) {
            $data | Add-Member -NotePropertyName 'jotformsubmissionid' -NotePropertyValue "" -Force
        }
        
        # 5. Lookup student record from CoreIdMap
        $studentRecord = $null
        if ($CoreIdMap -and $CoreIdMap.ContainsKey($CoreId)) {
            $studentRecord = $CoreIdMap[$CoreId]
        }
        
        if ($studentRecord) {
            # 6. Add child-name from coreid.enc
            $childName = $studentRecord.'Student Name'
            if (-not [string]::IsNullOrWhiteSpace($childName)) {
                $data | Add-Member -NotePropertyName 'child-name' -NotePropertyValue $childName -Force
            }
            
            # 7. Get class-id (only from Class ID 25/26, no fallback)
            $classId = $studentRecord.'Class ID 25/26'
            
            if (-not [string]::IsNullOrWhiteSpace($classId)) {
                $data | Add-Member -NotePropertyName 'class-id' -NotePropertyValue $classId -Force
                
                # 8. Lookup class-name from ClassIdMap
                if ($ClassIdMap -and $ClassIdMap.ContainsKey($classId)) {
                    $className = $ClassIdMap[$classId].'Actual Class Name'
                    if (-not [string]::IsNullOrWhiteSpace($className)) {
                        $data | Add-Member -NotePropertyName 'class-name' -NotePropertyValue $className -Force
                    }
                }
            }
            
            # 9. Fallback Gender from coreid.enc if missing in PDF
            $pdfGender = $data.Gender
            if ([string]::IsNullOrWhiteSpace($pdfGender)) {
                $encGender = $studentRecord.Gender
                if (-not [string]::IsNullOrWhiteSpace($encGender)) {
                    $data | Add-Member -NotePropertyName 'Gender' -NotePropertyValue $encGender -Force
                }
            }
        }
        
        # 10. Calculate termination outcomes
        Add-TerminationOutcomes -Data $data -FileName $FileName
        
        # 11. Remove all _Sc helper fields (used for termination calculation, not for upload)
        $scFields = $data.PSObject.Properties | Where-Object { $_.Name -like '*_Sc' }
        foreach ($field in $scFields) {
            $data.PSObject.Properties.Remove($field.Name)
        }
        
        # 12. Write enriched JSON (with jotformsubmissionid still empty)
        # This ensures we have the data saved even if Jotform upload fails
        $json.data = $data
        $enrichedJson = $json | ConvertTo-Json -Depth 10
        Set-Content -Path $JsonPath -Value $enrichedJson -Encoding UTF8
        
        # Enriched - no log (too verbose)
        return $true
        
    } catch {
        Write-Log -Message "Field enrichment failed: $($_.Exception.Message)" -Level "WARN" -File $FileName
        return $false
    }
}

function Test-DataOverwriteConflict {
    param(
        [PSCustomObject]$NewData,
        [PSCustomObject]$ExistingSubmission,
        [hashtable]$JotformQuestions,
        [string]$FileName
    )
    
    # Define exception fields that are allowed to be overwritten
    # These are administrative/metadata fields that can be updated freely
    $exceptionFields = @(
        'student-id',      # QID 20
        'child-name',      # QID 21
        'school-id',       # QID 22
        'district',        # QID 23
        'class-id',        # QID 24
        'class-name',      # QID 25
        'computerno'       # QID 647
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

function Build-JotformPayload {
    param(
        [PSCustomObject]$Data,
        [hashtable]$Mapping,
        [string[]]$ExcludeFields = @()
    )
    
    $body = @{}
    
    foreach ($field in $Data.PSObject.Properties) {
        $fieldName = $field.Name
        
        # Skip excluded fields
        if ($ExcludeFields -contains $fieldName) {
            continue
        }
        
        # Get QID from mapping
        if ($Mapping.ContainsKey($fieldName)) {
            $qid = $Mapping[$fieldName]
            $value = $field.Value
            
            # Build submission[QID] = value (form-encoded format)
            $body["submission[$qid]"] = if ($value -eq $null) { "" } else { $value.ToString() }
        }
    }
    
    return $body
}

function Invoke-JotformUpsert {
    param(
        [string]$JsonPath,
        [string]$SessionKey,
        [PSCustomObject]$ApiCredentials,
        [hashtable]$JotformQuestions,
        [string]$FileName,
        [int]$MaxRetries = 3,
        [int[]]$RetryDelaySeconds = @(10, 30, 90)
    )
    
    # 1. Read the enriched JSON that was already written
    $json = Get-Content -Path $JsonPath -Raw | ConvertFrom-Json
    $data = $json.data
    
    # 2. The sessionkey should already be in canonical format from enrichment
    # But ensure it exists as a fallback
    if (-not $data.sessionkey) {
        $data | Add-Member -NotePropertyName 'sessionkey' -NotePropertyValue $SessionKey -Force
    }
    
    # 3. Get Jotform credentials
    $apiKey = $ApiCredentials.jotformApiKey
    $formId = $ApiCredentials.jotformFormId
    
    if ([string]::IsNullOrWhiteSpace($apiKey) -or [string]::IsNullOrWhiteSpace($formId)) {
        Write-Log -Message "Jotform credentials missing (apiKey or formId)" -Level "WARN" -File $FileName
        return @{ Success = $false; Error = "Missing credentials"; Retryable = $false }
    }
    
    # 4. Build field mapping
    $sessionkeyQid = $JotformQuestions['sessionkey']
    if ([string]::IsNullOrWhiteSpace($sessionkeyQid)) {
        Write-Log -Message "sessionkey QID not found in jotformquestions.json" -Level "ERROR" -File $FileName
        return @{ Success = $false; Error = "Missing sessionkey mapping"; Retryable = $false }
    }
    
    # 5. Adaptive chunk sizing with retry loop
    $attempt = 0
    $lastError = $null
    $lastStatusCode = $null
    $baseChunkSize = $script:JotformConfig.maxFieldsPerChunk
    $currentChunkSize = $baseChunkSize  # Start with configured size
    $lastSuccessfulSize = $null  # Track what worked
    $lastSuccessfulIndex = 0  # Track which reduction level worked
    $chunkSizeReductions = @(1.0, 0.5, 0.3, 0.2, 0.1, 0.05)  # 100%, 50%, 30%, 20%, 10%, 5%
    $reductionIndex = 0
    $consecutiveSuccesses = 0  # Track consecutive successes for gradual increase
    
    while ($attempt -lt $MaxRetries) {
        $attempt++
        
        # Calculate chunk size based on current reduction level
        if ($reductionIndex -gt 0) {
            $currentChunkSize = [Math]::Max(1, [Math]::Floor($baseChunkSize * $chunkSizeReductions[$reductionIndex]))
            Write-Log -Message "Attempt $attempt with adjusted chunk size: $currentChunkSize fields ($([Math]::Round($chunkSizeReductions[$reductionIndex] * 100))% of $baseChunkSize)" -Level "INFO" -File $FileName
        } elseif ($lastSuccessfulSize -and $lastSuccessfulSize -lt $baseChunkSize) {
            # Gradual increase: if we've had success with smaller chunks, try increasing
            Write-Log -Message "Attempt $attempt testing increased chunk size (last successful: $lastSuccessfulSize fields)" -Level "INFO" -File $FileName
        }
        
        try {
            # Search for existing submission using filter API (fast path) with pagination fallback
            Write-Log -Message "Searching for existing submission with sessionkey: $SessionKey" -Level "INFO" -File $FileName
            
            $foundSubmission = $null
            
            # METHOD 1: Try filter API first (much faster for large datasets)
            # NOTE: JotForm's :eq filter is BROKEN (Oct 2025 testing shows it returns all 545+ submissions)
            # We use :matches operator which works better, then validate client-side for exact match
            try {
                Add-Type -AssemblyName System.Web -ErrorAction SilentlyContinue
                
                # Extract student ID from sessionkey for pattern matching
                # SessionKey format: {studentId}_{yyyymmdd}_{hh}_{mm}
                $studentIdPattern = $SessionKey -split '_' | Select-Object -First 1
                
                # Use :matches operator on sessionkey field (QID 3) - this actually filters server-side
                # Unlike :eq which returns everything, :matches returns only submissions containing the pattern
                $filter = "{`"q${sessionkeyQid}:matches`":`"${studentIdPattern}`"}"
                $encodedFilter = [System.Web.HttpUtility]::UrlEncode($filter)
                $filterUri = "https://api.jotform.com/form/$formId/submissions?apiKey=$apiKey&filter=$encodedFilter&limit=1000&orderby=created_at&direction=ASC"
                
                Write-Log -Message "Using :matches filter with pattern '$studentIdPattern' (extracted from sessionkey)" -Level "DEBUG" -File $FileName
                
                $filterResponse = Invoke-RestMethod -Uri $filterUri -Method Get -TimeoutSec $script:JotformConfig.searchTimeoutSec
                
                if ($filterResponse.content -and $filterResponse.content.Count -gt 0) {
                    Write-Log -Message "Filter API returned $($filterResponse.content.Count) submission(s), validating for exact sessionkey match..." -Level "DEBUG" -File $FileName
                    
                    # CRITICAL: Verify exact match (filter returns pattern matches, we need exact sessionkey)
                    foreach ($sub in $filterResponse.content) {
                        $sessionKeyValue = $null
                        if ($sub.answers.$sessionkeyQid.answer) {
                            $sessionKeyValue = $sub.answers.$sessionkeyQid.answer
                        } elseif ($sub.answers.$sessionkeyQid.text) {
                            $sessionKeyValue = $sub.answers.$sessionkeyQid.text
                        }
                        
                        # Normalize whitespace
                        if ($sessionKeyValue) {
                            $sessionKeyValue = $sessionKeyValue.Trim() -replace '\s+', ' '
                        }
                        
                        # DEBUG: Log what we're comparing
                        Write-Log -Message "Comparing submission $($sub.id): '$sessionKeyValue' vs '$SessionKey'" -Level "DEBUG" -File $FileName
                        
                        # Check for exact match
                        if ($sessionKeyValue -eq $SessionKey) {
                            $foundSubmission = $sub
                            Write-Log -Message "Found existing submission via filter API: $($sub.id)" -Level "INFO" -File $FileName
                            break
                        }
                    }
                    
                    # DEBUG: If no match found, log it
                    if (-not $foundSubmission -and $filterResponse.content.Count -gt 0) {
                        Write-Log -Message "No exact match found in $($filterResponse.content.Count) filtered submission(s) - will CREATE new" -Level "INFO" -File $FileName
                    }
                }
            } catch {
                Write-Log -Message "Filter API search failed, will CREATE new submission: $($_.Exception.Message)" -Level "INFO" -File $FileName
            }
            
            # REMOVED: Pagination fallback (Nov 7, 2025)
            # Pagination was causing 40+ second timeouts when filter API didn't find exact match
            # If filter doesn't find a match, we should CREATE new submission, not scan 500+ submissions
            # Filter API with :matches already searches the entire form efficiently
            
            $submissionId = $null
            
            if ($foundSubmission) {
                # UPDATE existing submission with chunked payload
                $submissionId = $foundSubmission.id
                Write-Log -Message "Will UPDATE existing submission $submissionId" -Level "INFO" -File $FileName
                
                # Check for data overwrite conflicts BEFORE updating (if protection is enabled)
                if ($script:EnableDataOverwriteProtection) {
                    Write-Log -Message "Checking for data overwrite conflicts..." -Level "INFO" -File $FileName
                    $conflictResult = Test-DataOverwriteConflict -NewData $data -ExistingSubmission $foundSubmission -JotformQuestions $JotformQuestions -FileName $FileName
                    
                    if ($conflictResult.HasConflicts) {
                        # Build detailed conflict message
                        $conflictDetails = @()
                        foreach ($conflict in $conflictResult.Conflicts) {
                            $conflictDetails += "$($conflict.FieldName) (QID $($conflict.QID)): existing='$($conflict.ExistingValue)' → new='$($conflict.NewValue)'"
                        }
                        $conflictMessage = "Data overwrite conflict detected ($($conflictResult.ConflictCount) field(s)): " + ($conflictDetails -join "; ")
                        
                        Write-Log -Message $conflictMessage -Level "DATA_OVERWRITE_DIFF" -File $FileName
                        Write-Log -Message "Update rejected - file will be moved to Unsorted/ for manual review" -Level "WARN" -File $FileName
                        
                        # Return failure - this will cause the file to be moved to Unsorted/
                        return @{ 
                            Success = $false
                            Error = "Data overwrite conflict: $($conflictResult.ConflictCount) field(s) would be changed"
                            ConflictDetails = $conflictDetails
                            Retryable = $false
                            OverwriteConflict = $true
                        }
                    }
                    
                    Write-Log -Message "No overwrite conflicts detected - proceeding with update" -Level "INFO" -File $FileName
                } else {
                    Write-Log -Message "Data overwrite protection disabled - allowing full data overwrite" -Level "INFO" -File $FileName
                }
                
                # Get all fields excluding sessionkey, and filter out nulls
                $fieldsToUpdate = @()
                foreach ($key in $data.PSObject.Properties.Name) {
                    if ($key -ne 'sessionkey' -and $JotformQuestions.ContainsKey($key)) {
                        $value = $data.$key
                        if ($null -ne $value -and $value -ne '' -and $value -ne 'null') {
                            $fieldsToUpdate += $key
                        }
                    }
                }
                
                Write-Log -Message "Preparing to update $($fieldsToUpdate.Count) fields" -Level "INFO" -File $FileName
                
                # Smart chunking: balance chunks evenly using adaptive chunk size
                $maxFieldsPerChunk = $currentChunkSize  # Use adaptive size
                $totalChunks = [Math]::Ceiling($fieldsToUpdate.Count / $maxFieldsPerChunk)
                $chunkSize = [Math]::Ceiling($fieldsToUpdate.Count / $totalChunks)  # Distribute evenly
                
                # Prepare all chunks first and build range summary
                $chunks = @()
                $chunkRanges = @()
                for ($chunkIndex = 0; $chunkIndex -lt $totalChunks; $chunkIndex++) {
                    $start = $chunkIndex * $chunkSize
                    $end = [Math]::Min($start + $chunkSize - 1, $fieldsToUpdate.Count - 1)
                    $chunkFields = $fieldsToUpdate[$start..$end]
                    
                    # Track range for logging
                    $rangeStart = $start + 1  # Human-readable (1-indexed)
                    $rangeEnd = $end + 1
                    $chunkRanges += "[$rangeStart-$rangeEnd]"
                    
                    # Build payload for this chunk
                    $chunkData = [PSCustomObject]@{}
                    foreach ($field in $chunkFields) {
                        $chunkData | Add-Member -NotePropertyName $field -NotePropertyValue $data.$field
                    }
                    
                    $chunkBody = Build-JotformPayload -Data $chunkData -Mapping $JotformQuestions
                    
                    $chunks += [PSCustomObject]@{
                        Index = $chunkIndex
                        Fields = $chunkFields
                        Body = $chunkBody
                        Count = $chunkFields.Count
                        RangeStart = $rangeStart
                        RangeEnd = $rangeEnd
                    }
                }
                
                # Log chunk split with field ranges
                $rangesSummary = $chunkRanges -join ", "
                Write-Log -Message "Split into $totalChunks chunks: $rangesSummary" -Level "INFO" -File $FileName
                
                # Upload chunks sequentially (CRITICAL FIX: ForEach-Object -Parallel has massive overhead even with ThrottleLimit=1)
                # Sequential processing takes ~1.5s per chunk vs 40s+ timeout with parallel infrastructure
                $uploadResults = @()
                $updateUri = "https://api.jotform.com/submission/$submissionId`?apiKey=$apiKey"
                
                foreach ($chunk in $chunks) {
                    try {
                        # Log chunk upload start with field range and actual count
                        $rangeInfo = "$($chunk.Count) fields (positions $($chunk.RangeStart)-$($chunk.RangeEnd))"
                        Write-Log -Message "Uploading chunk $($chunk.Index + 1)/$totalChunks ($rangeInfo)..." -Level "INFO" -File $FileName
                        
                        $response = Invoke-RestMethod -Uri $updateUri -Method Post -Body $chunk.Body -ContentType "application/x-www-form-urlencoded" -TimeoutSec $script:JotformConfig.updateTimeoutSec
                        
                        Write-Log -Message "Chunk $($chunk.Index + 1)/$totalChunks uploaded successfully" -Level "INFO" -File $FileName
                        
                        $uploadResults += [PSCustomObject]@{ 
                            Success = $true
                            Index = $chunk.Index
                            Fields = $chunk.Count
                            RangeStart = $chunk.RangeStart
                            RangeEnd = $chunk.RangeEnd
                        }
                        
                        # Rate limiting between chunks
                        if ($chunk.Index -lt ($totalChunks - 1) -and $script:JotformConfig.rateLimitMs -gt 0) {
                            Start-Sleep -Milliseconds $script:JotformConfig.rateLimitMs
                        }
                    } catch {
                        # Capture status code for adaptive retry
                        $statusCode = $null
                        if ($_.Exception.Response) {
                            $statusCode = [int]$_.Exception.Response.StatusCode.value__
                        }
                        
                        $uploadResults += [PSCustomObject]@{
                            Success = $false
                            Index = $chunk.Index
                            Fields = $chunk.Count
                            RangeStart = $chunk.RangeStart
                            RangeEnd = $chunk.RangeEnd
                            Error = $_.Exception.Message
                            StatusCode = $statusCode
                        }
                        
                        # Break on first failure (will trigger retry at outer level)
                        break
                    }
                }
                
                # Check results and log
                $failedChunks = @($uploadResults | Where-Object { -not $_.Success })
                if ($failedChunks.Count -gt 0) {
                    # Check if any chunk failed with 504
                    $has504 = $failedChunks | Where-Object { $_.StatusCode -eq 504 }
                    
                    $errorMsg = "Failed to upload $($failedChunks.Count) chunks: " + (($failedChunks | ForEach-Object { "chunk $($_.Index + 1) [fields $($_.RangeStart)-$($_.RangeEnd)]: $($_.Error)" }) -join "; ")
                    
                    # Create error with status code preserved for adaptive retry
                    $chunkError = [System.Exception]::new($errorMsg)
                    if ($has504) {
                        # Attach 504 status for outer catch to detect
                        $chunkError.Data['StatusCode'] = 504
                    }
                    throw $chunkError
                }
                
                # Chunks completed - no individual logs (too verbose)
                
                Write-Log -Message "Updated submission $submissionId ($($fieldsToUpdate.Count) fields, $totalChunks chunks)" -Level "UPLOAD" -File $FileName
                
            } else {
                # CREATE new submission
                Write-Log -Message "No existing submission found, will CREATE new submission" -Level "INFO" -File $FileName
                
                # Count non-null fields (excluding sessionkey which is always included)
                $fieldCount = 0
                foreach ($key in $data.PSObject.Properties.Name) {
                    if ($key -ne 'sessionkey' -and $JotformQuestions.ContainsKey($key)) {
                        $value = $data.$key
                        if ($null -ne $value -and $value -ne '' -and $value -ne 'null') {
                            $fieldCount++
                        }
                    }
                }
                Write-Log -Message "Preparing to CREATE with $fieldCount fields (plus sessionkey)" -Level "INFO" -File $FileName
                
                # Build create payload (include sessionkey)
                $createBody = Build-JotformPayload -Data $data -Mapping $JotformQuestions
                
                $createUri = "https://api.jotform.com/form/$formId/submissions?apiKey=$apiKey"
                $createResponse = Invoke-RestMethod -Uri $createUri -Method Post -Body $createBody -ContentType "application/x-www-form-urlencoded" -TimeoutSec $script:JotformConfig.createTimeoutSec
                
                # Extract submission ID from response
                $submissionId = $createResponse.content.submissionID
                Write-Log -Message "Created new submission $submissionId with $fieldCount fields" -Level "UPLOAD" -File $FileName
            }
            
            # Write back jotformsubmissionid to JSON file
            if ($submissionId) {
                $data.jotformsubmissionid = $submissionId
                
                # Write back the updated JSON with real submission ID
                $json.data = $data
                $updatedJson = $json | ConvertTo-Json -Depth 10
                Set-Content -Path $JsonPath -Value $updatedJson -Encoding UTF8
                
                # Upload successful!
                $lastSuccessfulSize = $currentChunkSize
                $lastSuccessfulIndex = $reductionIndex
                $consecutiveSuccesses++
                
                # Log appropriate success message based on operation type
                if ($foundSubmission) {
                    Write-Log -Message "Update succeeded (uploaded $($fieldsToUpdate.Count) fields in $totalChunks chunk(s), attempt $attempt)" -Level "INFO" -File $FileName
                } else {
                    Write-Log -Message "Create succeeded (uploaded $fieldCount fields, attempt $attempt)" -Level "INFO" -File $FileName
                }
                
                # Gradually increase chunk size if we're below baseline and have multiple consecutive successes
                if ($reductionIndex -gt 0 -and $consecutiveSuccesses -ge 2) {
                    # Move one step up the reduction scale (increase chunk size) - requires 2+ successes
                    $successCount = $consecutiveSuccesses
                    $reductionIndex = [Math]::Max(0, $reductionIndex - 1)
                    $newSize = [Math]::Floor($baseChunkSize * $chunkSizeReductions[$reductionIndex])
                    $consecutiveSuccesses = 0  # Reset counter after increase
                    Write-Log -Message "After $successCount consecutive successes, will try larger chunks ($newSize fields, $([Math]::Round($chunkSizeReductions[$reductionIndex] * 100))%)" -Level "INFO" -File $FileName
                } elseif ($reductionIndex -gt 0) {
                    Write-Log -Message "Holding at current size ($currentChunkSize fields) - need more successes before increasing" -Level "INFO" -File $FileName
                }
                
                return @{ Success = $true; SubmissionId = $submissionId; Attempts = $attempt }
            } else {
                throw "No submission ID returned from Jotform"
            }
            
        } catch {
            # Try to get status code from response or exception data (for chunk errors)
            $statusCode = $null
            if ($_.Exception.Response) {
                $statusCode = $_.Exception.Response.StatusCode.value__
            } elseif ($_.Exception.Data -and $_.Exception.Data.Contains('StatusCode')) {
                $statusCode = $_.Exception.Data['StatusCode']
            }
            
            $lastError = $_.Exception.Message
            $lastStatusCode = $statusCode
            
            # Determine if error is retryable
            $isRetryable = $statusCode -in @(429, 500, 502, 503, 504) -or $_.Exception.Message -match "timeout"
            
            if (-not $isRetryable) {
                # Non-retryable error (4xx except 429)
                Write-Log -Message "Jotform upload failed with non-retryable error: $lastError (status: $statusCode)" -Level "ERROR" -File $FileName
                break
            }
            
            Write-Log -Message "Jotform upload attempt $attempt failed: $lastError (status: $statusCode)" -Level "WARN" -File $FileName
            
            # Reset consecutive successes on any failure
            $consecutiveSuccesses = 0
            
            # Adaptive chunk sizing: adjust on 504 Gateway Timeout
            if ($statusCode -eq 504) {
                # If we were trying to increase and failed, revert to last successful size
                if ($lastSuccessfulIndex -gt 0 -and $reductionIndex -lt $lastSuccessfulIndex) {
                    $reductionIndex = $lastSuccessfulIndex
                    Write-Log -Message "Increase attempt failed - reverting to last successful size ($([Math]::Round($chunkSizeReductions[$reductionIndex] * 100))%)" -Level "WARN" -File $FileName
                }
                # Otherwise reduce if we haven't hit minimum
                elseif ($reductionIndex -lt ($chunkSizeReductions.Length - 1)) {
                    $reductionIndex++
                    Write-Log -Message "504 timeout detected - will reduce chunk size to $([Math]::Round($chunkSizeReductions[$reductionIndex] * 100))% on next attempt" -Level "WARN" -File $FileName
                }
            }
            
            # Apply exponential backoff if not last attempt
            if ($attempt -lt $MaxRetries) {
                $delayIndex = [Math]::Min($attempt - 1, $RetryDelaySeconds.Length - 1)
                $baseDelay = $RetryDelaySeconds[$delayIndex]
                # Add jitter (±20%)
                $jitter = Get-Random -Minimum (-0.2 * $baseDelay) -Maximum (0.2 * $baseDelay)
                $delay = [Math]::Max(1, $baseDelay + $jitter)
                
                Write-Log -Message "Retrying in $([Math]::Round($delay, 1)) seconds..." -Level "INFO" -File $FileName
                Start-Sleep -Seconds $delay
            }
        }
    }
    
    # All retries exhausted - mark as permanently failed (log only, no JSON modification)
    Write-Log -Message "Jotform upload permanently failed after $attempt attempts: $lastError (StatusCode: $lastStatusCode)" -Level "ERROR" -File $FileName
    
    return @{ 
        Success = $false
        Error = $lastError
        StatusCode = $lastStatusCode
        Attempts = $attempt
        PermanentFailure = $true
    }
}

function Get-QueueManifest {
    param([string]$Path)
    if (-not (Test-Path $Path)) {
        return [pscustomobject]@{ files = @() }
    }
    
    # Retry logic for parallel worker file locking
    $maxRetries = 5
    $retryCount = 0
    
    while ($retryCount -lt $maxRetries) {
        try {
            $raw = Get-Content -Path $Path -Raw -ErrorAction Stop
            if ([string]::IsNullOrWhiteSpace($raw)) {
                return [pscustomobject]@{ files = @() }
            }
            $manifest = $raw | ConvertFrom-Json
            if (-not $manifest.files) {
                $manifest | Add-Member -NotePropertyName files -NotePropertyValue @() -Force
            }
            return $manifest
        } catch [System.IO.IOException] {
            # File locked by another worker, retry
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Start-Sleep -Milliseconds (50 * $retryCount)
            }
        } catch {
            # JSON parse error or other issue
            Write-Log -Message "Failed to parse queue manifest: $($_.Exception.Message)" -Level "WARN"
            return [pscustomobject]@{ files = @() }
        }
    }
    
    # Max retries exceeded, return empty manifest
    return [pscustomobject]@{ files = @() }
}

function Save-QueueManifest {
    param(
        [string]$Path,
        [pscustomobject]$Manifest
    )
    
    $json = $Manifest | ConvertTo-Json -Depth 6
    
    # Retry logic for parallel worker file locking
    $maxRetries = 5
    $retryCount = 0
    $written = $false
    
    while (-not $written -and $retryCount -lt $maxRetries) {
        try {
            Set-Content -Path $Path -Value $json -Encoding UTF8 -ErrorAction Stop
            $written = $true
        } catch {
            $retryCount++
            if ($retryCount -lt $maxRetries) {
                Start-Sleep -Milliseconds (50 * $retryCount)
            }
        }
    }
}

function Set-ManifestStatus {
    param(
        [string]$Path,
        [string]$Id,
        [string]$FileName,
        [string]$Status
    )
    $manifest = Get-QueueManifest -Path $Path
    $entries = @()
    if ($manifest.files) {
        $entries = @($manifest.files)
    }
    $match = $null
    foreach ($item in $entries) {
        if ($item.id -eq $Id) {
            $match = $item
            break
        }
    }
    if (-not $match) {
        $match = [pscustomobject]@{
            id = $Id
            fileName = $FileName
            status = $Status
            updated = (Get-Date).ToString("o")
        }
        $manifest.files = @($entries + $match)
    } else {
        $match.status = $Status
        $match.updated = (Get-Date).ToString("o")
        $manifest.files = $entries
    }
    Save-QueueManifest -Path $Path -Manifest $manifest
}

function Remove-ManifestEntry {
    param(
        [string]$Path,
        [string]$Id
    )
    $manifest = Get-QueueManifest -Path $Path
    $filtered = @()
    if ($manifest.files) {
        foreach ($item in $manifest.files) {
            if ($item.id -ne $Id) {
                $filtered += $item
            }
        }
    }
    $manifest.files = $filtered
    Save-QueueManifest -Path $Path -Manifest $manifest
}

function Test-IsFileReady {
    param([string]$Path)
    try {
        $stream = [System.IO.File]::Open($Path,[System.IO.FileMode]::Open,[System.IO.FileAccess]::Read,[System.IO.FileShare]::None)
        $stream.Close()
        return $true
    } catch {
        return $false
    }
}

function Wait-ForFile {
    param(
        [string]$Path,
        [int]$TimeoutSeconds
    )
    if ($TimeoutSeconds -le 0) {
        $TimeoutSeconds = 5
    }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-IsFileReady -Path $Path) {
            return $true
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Ensure-UniquePath {
    param(
        [string]$Directory,
        [string]$FileName
    )
    $target = Join-Path $Directory $FileName
    if (-not (Test-Path $target)) {
        return $target
    }
    $name = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $extension = [System.IO.Path]::GetExtension($FileName)
    $counter = 1
    do {
        $candidate = Join-Path $Directory ("{0}_{1}{2}" -f $name, (Get-Date -Format "yyyyMMddHHmmssfff"), $extension)
        if (-not (Test-Path $candidate)) {
            return $candidate
        }
        $counter += 1
        Start-Sleep -Milliseconds 50
    } while ($true)
}

function Clean-UnsortedJsonFiles {
    param(
        [string]$UnsortedPath
    )
    
    if (-not (Test-Path $UnsortedPath)) {
        return
    }
    
    try {
        $jsonFiles = Get-ChildItem -Path $UnsortedPath -Filter "*.json" -File -ErrorAction SilentlyContinue
        
        if ($jsonFiles.Count -gt 0) {
            Write-Log -Message "Removed $($jsonFiles.Count) orphaned JSON file(s) from filed/Unsorted/" -Level "CLEANUP" -File "CLEANUP"
            
            foreach ($jsonFile in $jsonFiles) {
                try {
                    Remove-Item -Path $jsonFile.FullName -Force
                    # Deleted JSON - no individual log (too verbose)
                } catch {
                    Write-Log -Message "Failed to delete $($jsonFile.Name): $($_.Exception.Message)" -Level "WARN" -File "CLEANUP"
                }
            }
        }
    } catch {
        Write-Log -Message "Error during unsorted JSON cleanup: $($_.Exception.Message)" -Level "WARN" -File "CLEANUP"
    }
}

function Invoke-FilenameValidation {
    param(
        [string]$FileName
    )

    $result = [pscustomobject]@{
        IsValid = $false
        CanonicalName = $FileName
        Reason = ""
        ReasonCode = ""
        CoreId = ""
        ParsedDate = $null
        Hour = $null
        Minute = $null
    }

    if ([string]::IsNullOrWhiteSpace($FileName)) {
        $result.Reason = "Filename is missing."
        $result.ReasonCode = "name_format_error"
        return $result
    }

    $extension = [System.IO.Path]::GetExtension($FileName)
    if (-not $extension -or $extension.ToLowerInvariant() -ne ".pdf") {
        $result.Reason = "Expected .pdf extension."
        $result.ReasonCode = "extension_invalid"
        return $result
    }

    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($FileName)
    $digits = [System.Text.RegularExpressions.Regex]::Replace($baseName, "[^0-9]", "")

    if ([string]::IsNullOrWhiteSpace($digits)) {
        $result.Reason = "Filename must contain numeric core, date, and time."
        $result.ReasonCode = "name_format_error"
        return $result
    }

    if ($digits.Length -lt 15 -or $digits.Length -gt 17) {
        $result.Reason = "Filename must match xxxxx_YYYYMMDD_HH_MM.pdf"
        $result.ReasonCode = "name_format_error"
        return $result
    }

    $core = $digits.Substring(0, [Math]::Min(5, $digits.Length))
    if ($core.Length -ne 5) {
        $result.Reason = "Core identifier must be five digits."
        $result.ReasonCode = "name_format_error"
        return $result
    }

    if ($digits.Length -lt 13) {
        $result.Reason = "Incomplete date component."
        $result.ReasonCode = "name_format_error"
        return $result
    }

    $dateSegment = $digits.Substring(5, 8)
    $parsedDate = [DateTime]::MinValue
    if (-not [DateTime]::TryParseExact($dateSegment, 'yyyyMMdd', [System.Globalization.CultureInfo]::InvariantCulture, [System.Globalization.DateTimeStyles]::None, [ref]$parsedDate)) {
        $result.Reason = "Date component is invalid."
        $result.ReasonCode = "timestamp_unreadable"
        return $result
    }

    $remaining = $digits.Substring(13)
    if ($remaining.Length -lt 2) {
        $result.Reason = "Time component is missing."
        $result.ReasonCode = "timestamp_unreadable"
        return $result
    }

    $combos = @()
    switch ($remaining.Length) {
        2 { $combos = @(@{HourLen = 1; MinuteLen = 1}) }
        3 { $combos = @(@{HourLen = 2; MinuteLen = 1}, @{HourLen = 1; MinuteLen = 2}) }
        4 { $combos = @(@{HourLen = 2; MinuteLen = 2}) }
    }

    if ($combos.Count -eq 0) {
        $result.Reason = "Time component is invalid length."
        $result.ReasonCode = "timestamp_unreadable"
        return $result
    }

    $hourValue = $null
    $minuteValue = $null
    foreach ($combo in $combos) {
        $hourDigits = $remaining.Substring(0, $combo.HourLen)
        $minuteDigits = $remaining.Substring($combo.HourLen)

        if ($hourDigits.Length -eq 0 -or $minuteDigits.Length -eq 0) {
            continue
        }

        $hourCandidate = [int]$hourDigits
        $minuteCandidate = [int]$minuteDigits
        if ($hourCandidate -ge 0 -and $hourCandidate -le 23 -and $minuteCandidate -ge 0 -and $minuteCandidate -le 59) {
            $hourValue = $hourCandidate
            $minuteValue = $minuteCandidate
            break
        }
    }

    if ($null -eq $hourValue -or $null -eq $minuteValue) {
        $result.Reason = "Time component is not recognisable."
        $result.ReasonCode = "timestamp_unreadable"
        return $result
    }

    $canonical = "{0}_{1}_{2:D2}_{3:D2}.pdf" -f $core, $dateSegment, $hourValue, $minuteValue
    $result.IsValid = $true
    $result.CanonicalName = $canonical
    $result.CoreId = $core
    $result.ParsedDate = $parsedDate
    $result.Hour = $hourValue
    $result.Minute = $minuteValue
    return $result
}

function Process-IncomingFile {
    param(
        [string]$Path
    )
    
    # CRITICAL: Atomic check - verify file still exists before processing
    # Prevents race condition where multiple workers pick up same file
    if (-not (Test-Path $Path)) {
        # File was already picked up by another worker - silently skip
        return
    }
    
    $fileName = [System.IO.Path]::GetFileName($Path)
    Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Queued"
    # Queued - no log (too verbose)
    
    if (-not (Wait-ForFile -Path $Path -TimeoutSeconds $script:DebounceWindow)) {
        Write-Log -Message "File not stable after $($script:DebounceWindow)s, skipping" -Level "WARN" -File $fileName
        return
    }
    
    # CRITICAL: Second atomic check after debounce wait
    # File might have been picked up during the wait period
    if (-not (Test-Path $Path)) {
        # File was picked up by another worker during debounce - silently skip
        Remove-ManifestEntry -Path $script:QueueManifestPath -Id $fileName
        return
    }
    
    try {
        # Read and cleanup metadata file BEFORE moving PDF to staging
        # Retry mechanism for slow OneDrive sync: Wait for .meta.json to appear
        $uploadComputerNo = $null
        $metadataFile = [System.IO.Path]::ChangeExtension($Path, '.meta.json')
        $metadataFound = $false
        $maxRetries = $script:MetadataRetries
        $retryDelaySeconds = $script:MetadataRetryDelay
        
        # Try to find metadata file with retries
        for ($attempt = 1; $attempt -le $maxRetries; $attempt++) {
            if (Test-Path $metadataFile) {
                $metadataFound = $true
                try {
                    $metadata = Get-Content -Path $metadataFile -Raw | ConvertFrom-Json
                    if ($metadata.uploadedFrom) {
                        $uploadComputerNo = $metadata.uploadedFrom
                        Write-Log -Message "Read computer number from metadata: $uploadComputerNo" -Level "INFO" -File $fileName
                    }
                    # Delete metadata file immediately after reading
                    Remove-Item -Path $metadataFile -Force -ErrorAction Stop
                    Write-Log -Message "Cleaned up metadata file from incoming folder" -Level "INFO" -File $fileName
                } catch {
                    Write-Log -Message "Failed to read/remove metadata file: $($_.Exception.Message)" -Level "WARN" -File $fileName
                    # Try to delete anyway
                    try { Remove-Item -Path $metadataFile -Force -ErrorAction SilentlyContinue } catch { }
                }
                break  # Found and processed, exit retry loop
            } else {
                # Metadata file not found yet
                if ($attempt -lt $maxRetries) {
                    Write-Log -Message "Metadata file not found (attempt $attempt/$maxRetries), waiting ${retryDelaySeconds}s for OneDrive sync..." -Level "INFO" -File $fileName
                    Start-Sleep -Seconds $retryDelaySeconds
                } else {
                    Write-Log -Message "Metadata file not found after $maxRetries attempts - proceeding without computer number" -Level "WARN" -File $fileName
                }
            }
        }
        
        # If metadata was never found after all retries, mark for special handling
        $missingMetadata = -not $metadataFound
        
        $stagingTarget = Ensure-UniquePath -Directory $script:StagingPath -FileName $fileName
        
        # CRITICAL: Atomic move - catch race condition
        try {
            Move-Item -Path $Path -Destination $stagingTarget -Force -ErrorAction Stop
            Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Staging"
            # Moved to staging - no log (too verbose)
        }
        catch {
            # Race condition: another worker already moved the file
            if (-not (Test-Path $Path)) {
                # Silently skip - file was picked up by another worker
                Remove-ManifestEntry -Path $script:QueueManifestPath -Id $fileName
                return
            }
            # Some other error - log and skip
            Write-Log -Message "Failed to move file to staging: $($_.Exception.Message)" -Level "ERROR" -File $fileName
            Remove-ManifestEntry -Path $script:QueueManifestPath -Id $fileName
            return
        }

        $validation = Invoke-FilenameValidation -FileName $fileName
        if (-not $validation.IsValid) {
            Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Rejected"
            Write-Log -Message ("Filename validation failed: {1} - {2}" -f $fileName, $validation.ReasonCode, $validation.Reason) -Level "REJECT" -File $fileName
            $rejectTarget = Ensure-UniquePath -Directory $script:UnsortedRoot -FileName $fileName
            Move-Item -Path $stagingTarget -Destination $rejectTarget -Force
            Remove-ManifestEntry -Path $script:QueueManifestPath -Id $fileName
            return
        }

        if ($validation.CanonicalName -ne $fileName) {
            $originalName = $fileName
            $newName = $validation.CanonicalName
            $newPath = Join-Path (Split-Path -Parent $stagingTarget) $newName
            Rename-Item -Path $stagingTarget -NewName $newName -Force
            $stagingTarget = $newPath
            $fileName = $newName
            Remove-ManifestEntry -Path $script:QueueManifestPath -Id $originalName
            Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Staging"
            Write-Log -Message ("Renamed {0} → {1}" -f $originalName, $fileName) -Level "RENAME" -File $fileName
        }

        # Check if metadata was missing after retries
        if ($missingMetadata) {
            if ($script:RequireComputerNumber) {
                # Enforcement enabled - reject and file to Unsorted without upload
                Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Rejected"
                Write-Log -Message "metadata_not_found: Computer number metadata file not found after $maxRetries retry attempts (enforcement enabled)" -Level "REJECT" -File $fileName
                $rejectTarget = Ensure-UniquePath -Directory $script:UnsortedRoot -FileName $fileName
                Move-Item -Path $stagingTarget -Destination $rejectTarget -Force
                Remove-ManifestEntry -Path $script:QueueManifestPath -Id $fileName
                return
            } else {
                # Enforcement disabled - proceed with upload but log warning
                Write-Log -Message "metadata_not_found: Computer number metadata file not found after $maxRetries retry attempts (proceeding without computer number - enforcement disabled)" -Level "WARN" -File $fileName
                # Continue processing - uploadComputerNo will be null/empty
            }
        }

        Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Parsing"
        # Parsing - no log (too verbose)
        
        $jsonFileName = [System.IO.Path]::GetFileNameWithoutExtension($fileName) + ".json"
        $jsonPath = Join-Path (Split-Path $stagingTarget) $jsonFileName
        
        $parseResult = Invoke-PdfParser -PdfPath $stagingTarget -OutputJsonPath $jsonPath
        if (-not $parseResult.success) {
            Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Rejected"
            Write-Log -Message ("Parser failed for {0}: {1}" -f $fileName, $parseResult.error) -Level "ERROR" -File $fileName
            $rejectTarget = Ensure-UniquePath -Directory $script:UnsortedRoot -FileName $fileName
            Move-Item -Path $stagingTarget -Destination $rejectTarget -Force
            Remove-ManifestEntry -Path $script:QueueManifestPath -Id $fileName
            return
        }

        Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Validating"
        # Validating - no log (too verbose)

        $phase2 = Invoke-Phase2Validation -FilePath $jsonPath -FileName $fileName -AgentSecrets $script:AgentSecrets -CoreId $validation.CoreId -ParsedDate $validation.ParsedDate -Hour $validation.Hour -Minute $validation.Minute
        if (-not $phase2.IsValid) {
            Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Rejected"
            Write-Log -Message ("{1}: {2}" -f $fileName, $phase2.ReasonCode, $phase2.Reason) -Level "REJECT" -File $fileName
            
            # Move PDF to unsorted for manual review
            $rejectPdfTarget = Ensure-UniquePath -Directory $script:UnsortedRoot -FileName $fileName
            Move-Item -Path $stagingTarget -Destination $rejectPdfTarget -Force
            
            # DELETE the JSON - it's invalid and won't be uploaded
            if (Test-Path $jsonPath) {
                Remove-Item -Path $jsonPath -Force
                # JSON deleted - already logged in ERROR above
            }
            
            Remove-ManifestEntry -Path $script:QueueManifestPath -Id $fileName
            return
        }

        # Enrich JSON with computed fields after validation
        $sessionKey = [System.IO.Path]::GetFileNameWithoutExtension($fileName)
        $enrichSuccess = Enrich-JsonFields -JsonPath $jsonPath -SessionKey $sessionKey -CoreId $phase2.Metadata.coreId -CoreIdMap $script:AgentSecrets.Bundle.coreIdMap -ClassIdMap $script:AgentSecrets.Bundle.classIdMap -SchoolIdMap $script:AgentSecrets.Bundle.schoolIdMap -FileName $fileName -ComputerNo $uploadComputerNo
        if (-not $enrichSuccess) {
            Write-Log -Message "Warning: Field enrichment failed, continuing with basic fields" -Level "WARN" -File $fileName
        }
        
        # Upload to Jotform (if enrichment succeeded and jotform config available)
        $uploadSuccess = $false
        if ($enrichSuccess) {
            # Check if Jotform configuration is available
            if (-not $script:AgentSecrets.Bundle.jotformQuestions) {
                Write-Log -Message "Jotform upload skipped: jotformquestions.json not loaded" -Level "WARN" -File $fileName
            } else {
                $uploadResult = Invoke-JotformUpsert `
                    -JsonPath $jsonPath `
                    -SessionKey $sessionKey `
                    -ApiCredentials $script:AgentSecrets.Bundle `
                    -JotformQuestions $script:AgentSecrets.Bundle.jotformQuestions `
                    -FileName $fileName `
                    -MaxRetries 3 `
                    -RetryDelaySeconds @(10, 30, 90)
            
                if ($uploadResult.Success) {
                    Write-Log -Message "Jotform upload completed successfully: $($uploadResult.SubmissionId) (took $($uploadResult.Attempts) attempt(s))" -Level "INFO" -File $fileName
                    $uploadSuccess = $true
                } else {
                    if ($uploadResult.PermanentFailure) {
                        Write-Log -Message "Jotform upload PERMANENTLY FAILED after $($uploadResult.Attempts) attempts: $($uploadResult.Error) - will file to Unsorted" -Level "ERROR" -File $fileName
                    } else {
                        Write-Log -Message "Jotform upload failed: $($uploadResult.Error) - will file to Unsorted" -Level "WARN" -File $fileName
                    }
                }
            }
        }

        Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Processed"
        # Processed - no log (final filing log is enough)
        
        # Determine filing destination
        $schoolId = $phase2.Metadata.schoolId
        if ([string]::IsNullOrWhiteSpace($schoolId)) {
            $schoolId = "Unsorted"
            Write-Log -Message "No School ID found, filing to Unsorted" -Level "WARN" -File $fileName
        } elseif (-not $uploadSuccess) {
            # Override school ID - failed uploads always go to Unsorted
            $schoolId = "Unsorted"
            Write-Log -Message "Upload failed, overriding filing destination to Unsorted (original: $($phase2.Metadata.schoolId))" -Level "WARN" -File $fileName
        }
        
        $schoolFolder = Join-Path $script:FilingRoot $schoolId
        if (-not (Test-Path $schoolFolder)) {
            New-Item -ItemType Directory -Path $schoolFolder -Force | Out-Null
            Write-Log -Message "Created school folder: $schoolFolder" -Level "INFO" -File $fileName
        }
        
        $finalPdfTarget = Join-Path $schoolFolder $fileName
        $finalJsonTarget = Join-Path $schoolFolder $jsonFileName
        
        Move-Item -Path $stagingTarget -Destination $finalPdfTarget -Force
        
        # Handle JSON based on upload success
        if (Test-Path $jsonPath) {
            if ($uploadSuccess) {
                # Upload succeeded - move JSON alongside PDF
                Move-Item -Path $jsonPath -Destination $finalJsonTarget -Force
            } else {
                # Upload failed - delete JSON, only keep PDF for manual review
                Remove-Item -Path $jsonPath -Force
                # JSON deleted for failed upload - logged in WARN above
            }
        }
        
        Set-ManifestStatus -Path $script:QueueManifestPath -Id $fileName -FileName $fileName -Status "Filed"
        Write-Log -Message "$fileName → $schoolId/" -Level "FILED" -File $fileName
        Remove-ManifestEntry -Path $script:QueueManifestPath -Id $fileName
    } catch {
        Write-Log -Message ("Processing failed for {0}: {1}" -f $fileName, $_.Exception.Message) -Level "ERROR" -File $fileName
        try {
            $fallbackTarget = Ensure-UniquePath -Directory $script:UnsortedRoot -FileName $fileName
            if (Test-Path $Path) {
                Move-Item -Path $Path -Destination $fallbackTarget -Force
            }
        } catch {
            Write-Log -Message ("Failed to relocate {0} after error: {1}" -f $fileName, $_.Exception.Message) -Level "ERROR" -File $fileName
        }
    }
}

$resolvedConfigPath = Resolve-Path -Path $ConfigPath -ErrorAction Stop
$configDirectory = Split-Path -Parent $resolvedConfigPath
$rootDirectory = Split-Path -Parent $configDirectory
$config = Get-Content -Path $resolvedConfigPath -Raw | ConvertFrom-Json

# Detect OneDrive base path if configured
$baseDirectory = $rootDirectory
if ($config.oneDrive) {
    $oneDriveBase = Get-OneDriveBasePath -Config $config
    if ($oneDriveBase -and (Test-Path $oneDriveBase)) {
        $baseDirectory = $oneDriveBase
        Write-Host "[Config] Using OneDrive base: $baseDirectory" -ForegroundColor Cyan
    }
}

$script:WatchPath = Resolve-RelativePath -BasePath $baseDirectory -PathValue $config.watchPath
$script:StagingPath = Resolve-RelativePath -BasePath $baseDirectory -PathValue $config.stagingPath
$script:FilingRoot = Resolve-RelativePath -BasePath $baseDirectory -PathValue $config.filingRoot
$script:UnsortedRoot = Resolve-RelativePath -BasePath $baseDirectory -PathValue $config.unsortedRoot

$script:RejectedRoot = $script:UnsortedRoot
$logDirectory = Resolve-RelativePath -BasePath $rootDirectory -PathValue $config.logDirectory
$script:QueueManifestPath = Resolve-RelativePath -BasePath $rootDirectory -PathValue $config.queueManifest
$script:DebounceWindow = 15
if ($config.validation -and $config.validation.debounceWindowSeconds) {
    $script:DebounceWindow = [int]$config.validation.debounceWindowSeconds
}
$script:MetadataRetries = 3
if ($config.validation -and $config.validation.metadataRetries) {
    $script:MetadataRetries = [int]$config.validation.metadataRetries
}
$script:MetadataRetryDelay = 2
if ($config.validation -and $config.validation.metadataRetryDelaySeconds) {
    $script:MetadataRetryDelay = [int]$config.validation.metadataRetryDelaySeconds
}
$script:RequireComputerNumber = $true
if ($config.validation -and $null -ne $config.validation.requireComputerNumber) {
    $script:RequireComputerNumber = [bool]$config.validation.requireComputerNumber
}
$script:EnableDataOverwriteProtection = $true
if ($config.validation -and $null -ne $config.validation.enableDataOverwriteProtection) {
    $script:EnableDataOverwriteProtection = [bool]$config.validation.enableDataOverwriteProtection
}
$pollSeconds = 5
if ($config.worker -and $config.worker.pollIntervalSeconds) {
    $pollSeconds = [int]$config.worker.pollIntervalSeconds
}

$directories = @($script:WatchPath, $script:StagingPath, $script:FilingRoot, $script:UnsortedRoot, $logDirectory)
foreach ($dir in $directories) {
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
}

$currentLogDate = (Get-Date).Date
$script:LogFile = Join-Path $logDirectory ("{0}_processing_agent.csv" -f ($currentLogDate.ToString("yyyyMMdd")))
if (-not (Test-Path $script:LogFile)) {
    # Use safe file creation with retry mechanism
    $maxRetries = 5
    $attempt = 0
    while ($attempt -lt $maxRetries) {
        try {
            $fileStream = [System.IO.File]::Open(
                $script:LogFile,
                [System.IO.FileMode]::CreateNew,
                [System.IO.FileAccess]::Write,
                [System.IO.FileShare]::ReadWrite
            )
            $streamWriter = New-Object System.IO.StreamWriter($fileStream, [System.Text.Encoding]::UTF8)
            $streamWriter.WriteLine("Timestamp,Level,File,Message")
            $streamWriter.Flush()
            $streamWriter.Close()
            $fileStream.Close()
            break
        }
        catch {
            $attempt++
            if ($attempt -ge $maxRetries) {
                Write-Warning "Failed to create initial log file after $maxRetries attempts: $_"
            }
            Start-Sleep -Milliseconds (50 * $attempt)
        }
    }
}
if (-not (Test-Path $script:QueueManifestPath)) {
    Save-QueueManifest -Path $script:QueueManifestPath -Manifest ([pscustomobject]@{ files = @() })
}

$script:AgentSecrets = Load-AgentSecrets -SecretsPath (Join-Path $rootDirectory "assets/credentials.enc") -KeyIdentifier "4set-processor-master"

# Load Jotform and Logging configuration
$jotformConfigPath = Join-Path $rootDirectory "config/jotform_config.json"
if (Test-Path $jotformConfigPath) {
    $jotformConfigJson = Get-Content $jotformConfigPath -Raw | ConvertFrom-Json
    
    # Load Jotform API config
    $script:JotformConfig = $jotformConfigJson.powershell
    Write-Host "Loaded Jotform config: PDFs=$($script:JotformConfig.maxConcurrentPdfs) parallel, chunks=$($script:JotformConfig.maxConcurrentChunks) sequential, chunk size=$($script:JotformConfig.maxFieldsPerChunk), timeout=$($script:JotformConfig.updateTimeoutSec)s" -ForegroundColor Green
    
    # Load logging config
    if ($jotformConfigJson.logging) {
        $script:LogLevels = $jotformConfigJson.logging
        
        # Build status message
        $enabledLevels = @()
        $disabledLevels = @()
        foreach ($prop in $script:LogLevels.PSObject.Properties) {
            if ($prop.Name -notlike "_*") {  # Skip comment fields
                if ($prop.Value -eq $true) {
                    $enabledLevels += $prop.Name
                } else {
                    $disabledLevels += $prop.Name
                }
            }
        }
        
        Write-Host "Loaded logging config: Enabled: $($enabledLevels -join ', ')" -ForegroundColor Green
        if ($disabledLevels.Count -gt 0) {
            Write-Host "                      Disabled: $($disabledLevels -join ', ')" -ForegroundColor DarkGray
        }
    } else {
        # Fallback to defaults if logging section missing
        $script:LogLevels = [PSCustomObject]@{
            REJECT = $true
            UPLOAD = $true
            FILED = $true
            CLEANUP = $true
            RENAME = $true
            WARN = $true
            ERROR = $true
            INFO = $false
        }
        Write-Host "Warning: Logging config not found, using defaults" -ForegroundColor Yellow
    }
} else {
    # Fallback to defaults if config file missing
    $script:JotformConfig = [PSCustomObject]@{
        maxConcurrentPdfs = 2
        maxFieldsPerChunk = 100
        maxConcurrentChunks = 1
        maxRetries = 3
        searchTimeoutSec = 20
        updateTimeoutSec = 25
        createTimeoutSec = 15
        rateLimitMs = 200
        maxPagesToScan = 5
        paginationLimit = 1000
        retryDelayBaseSec = 3
        retryDelayMaxSec = 60
    }
    $script:LogLevels = [PSCustomObject]@{
        REJECT = $true
        UPLOAD = $true
        FILED = $true
        CLEANUP = $true
        RENAME = $true
        WARN = $true
        ERROR = $true
        INFO = $false
    }
    Write-Host "Warning: Config file not found, using defaults" -ForegroundColor Yellow
}

# Clean up any orphaned JSON files in unsorted folder (rejected files should only have PDFs)
Clean-UnsortedJsonFiles -UnsortedPath $script:UnsortedRoot

# Skip main loop if running as worker
if ($global:WORKER_MODE) {
    return
}

do {
    $now = Get-Date
    if ($now.Date -ne $currentLogDate) {
        $currentLogDate = $now.Date
        $script:LogFile = Join-Path $logDirectory ("{0}_processing_agent.csv" -f ($currentLogDate.ToString("yyyyMMdd")))
        if (-not (Test-Path $script:LogFile)) {
            # Use safe file creation with retry mechanism
            $maxRetries = 5
            $attempt = 0
            while ($attempt -lt $maxRetries) {
                try {
                    $fileStream = [System.IO.File]::Open(
                        $script:LogFile,
                        [System.IO.FileMode]::CreateNew,
                        [System.IO.FileAccess]::Write,
                        [System.IO.FileShare]::ReadWrite
                    )
                    $streamWriter = New-Object System.IO.StreamWriter($fileStream, [System.Text.Encoding]::UTF8)
                    $streamWriter.WriteLine("Timestamp,Level,File,Message")
                    $streamWriter.Flush()
                    $streamWriter.Close()
                    $fileStream.Close()
                    break
                }
                catch {
                    $attempt++
                    if ($attempt -ge $maxRetries) {
                        Write-Warning "Failed to create log file after $maxRetries attempts: $_"
                    }
                    Start-Sleep -Milliseconds (50 * $attempt)
                }
            }
        }
        Write-Log -Message "Rolled log file to $script:LogFile"
    }

    $pending = @()
    if (Test-Path $script:WatchPath) {
        $pending = Get-ChildItem -Path $script:WatchPath -File -Filter "*.pdf" -ErrorAction SilentlyContinue
    }
    
    if ($pending.Count -gt 0) {
        $maxConcurrent = $script:JotformConfig.maxConcurrentPdfs
        
        if ($maxConcurrent -le 1) {
            # Sequential processing
            foreach ($item in $pending) {
                Process-IncomingFile -Path $item.FullName
            }
        } else {
            # Parallel processing using independent worker processes
            Write-Host "Processing $($pending.Count) file(s) with $maxConcurrent parallel workers..." -ForegroundColor Cyan
            
            $workerScript = Join-Path $PSScriptRoot "worker.ps1"
            $activeProcesses = @{}  # Dictionary: process -> filename
            $fileIndex = 0
            
            while ($fileIndex -lt $pending.Count -or $activeProcesses.Count -gt 0) {
                # Re-scan for new files if we've exhausted the current list but have idle workers
                if ($fileIndex -ge $pending.Count -and $activeProcesses.Count -lt $maxConcurrent) {
                    $newFiles = @()
                    if (Test-Path $script:WatchPath) {
                        $newFiles = Get-ChildItem -Path $script:WatchPath -File -Filter "*.pdf" -ErrorAction SilentlyContinue
                    }
                    if ($newFiles.Count -gt 0) {
                        # Found new files - add to pending list
                        $pending = $newFiles
                        $fileIndex = 0
                    }
                }
                
                # Start new workers up to maxConcurrent
                while ($fileIndex -lt $pending.Count -and $activeProcesses.Count -lt $maxConcurrent) {
                    $item = $pending[$fileIndex]
                    $fileIndex++
                    
                    # CRITICAL: Check if file still exists (might have been picked up by another scan)
                    if (-not (Test-Path $item.FullName)) {
                        Write-Host "  [Skipped] $($item.Name) - already being processed" -ForegroundColor Yellow
                        continue
                    }
                    
                    Write-Host "  [Worker $($activeProcesses.Count + 1)] Processing $($item.Name)..." -ForegroundColor Gray
                    
                    # Start independent PowerShell process running worker.ps1
                    $psi = New-Object System.Diagnostics.ProcessStartInfo
                    $psi.FileName = "pwsh"
                    $psi.Arguments = "-NoProfile -File `"$workerScript`" -FilePath `"$($item.FullName)`""
                    $psi.UseShellExecute = $false
                    $psi.CreateNoWindow = $true
                    $psi.RedirectStandardOutput = $true
                    $psi.RedirectStandardError = $true
                    
                    $process = New-Object System.Diagnostics.Process
                    $process.StartInfo = $psi
                    $process.Start() | Out-Null
                    
                    $activeProcesses[$process] = $item.Name
                }
                
                # Check for completed processes
                if ($activeProcesses.Count -gt 0) {
                    $completedProcesses = @()
                    
                    foreach ($proc in $activeProcesses.Keys) {
                        if ($proc.HasExited) {
                            $completedProcesses += $proc
                        }
                    }
                    
                    foreach ($proc in $completedProcesses) {
                        $fileName = $activeProcesses[$proc]
                        
                        if ($proc.ExitCode -eq 0) {
                            Write-Host "  ✓ Worker completed: $fileName" -ForegroundColor Green
                        } else {
                            Write-Host "  ✗ Worker failed: $fileName (exit code: $($proc.ExitCode))" -ForegroundColor Red
                            $stderr = $proc.StandardError.ReadToEnd()
                            if ($stderr) {
                                Write-Host "    Error: $stderr" -ForegroundColor Red
                            }
                        }
                        
                        $activeProcesses.Remove($proc)
                        $proc.Dispose()
                    }
                    
                    # Small sleep if nothing completed this iteration
                    if ($completedProcesses.Count -eq 0) {
                        Start-Sleep -Milliseconds 500
                    }
                }
            }
            
            Write-Host "All $($pending.Count) file(s) processed" -ForegroundColor Green
        }
    }
    if ($SingleRun) {
        break
    }
    Start-Sleep -Seconds $pollSeconds
} while ($true)

Write-Log -Message "Processor agent stopped"
