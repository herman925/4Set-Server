# Worker Script - Processes a single PDF file
# Called by processor_agent.ps1 for parallel processing
# Usage: pwsh -File worker.ps1 -FilePath "path/to/file.pdf"

param(
    [Parameter(Mandatory=$true)]
    [string]$FilePath
)

# Get script directory and source the main processor to load all functions
$scriptDir = Split-Path -Parent $PSCommandPath
$mainScript = Join-Path $scriptDir "processor_agent.ps1"

# Set worker mode to prevent main loop from running
$global:WORKER_MODE = $true

# Source the main script to load all functions
. $mainScript

# Now call the processing function
try {
    Process-IncomingFile -Path $FilePath
    exit 0
} catch {
    Write-Error "Worker failed: $_"
    exit 1
}
