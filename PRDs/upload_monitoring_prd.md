---
title: Upload Monitoring & Failure Detection
owner: Project Maintainers
last-updated: 2025-10-14
status: Core Implementation Complete, Dashboard Optional
---

# Upload Monitoring & Failure Detection

Defines how the processor agent handles Jotform upload failures with retry logic, logging, and optional dashboard integration. Logging now uses level-based switches configured in `config/jotform_config.json`.

## Overview

The processor agent implements a robust upload pipeline with automatic retry logic and clear failure handling. Monitoring is achieved through:
- **CSV Logs** - Canonical on-disk audit trail for all events (errors, retries, successes), written as `YYYYMMDD_processing_agent.csv`
- **Supabase Log Mirror** (optional) - Central, queryable mirror of the same log entries in `public.pdf_upload_log` (per-entry rows), populated best-effort by the processor agent when Supabase credentials are present
- **Unsorted Folder** - Automatic filing destination for failed uploads
- **Optional Dashboard** - Future enhancement for visual monitoring

## Problem Statement

Jotform upload may fail for various reasons (network issues, API downtime, rate limiting). The system handles this by:

1. ✅ **Retry** uploads with exponential backoff (3 attempts)
2. ✅ **Log failures** as `REJECT`/`ERROR` entries in CSV logs (configurable per level) and, when configured, mirror the same entries into Supabase `public.pdf_upload_log` for central querying
3. ✅ **File to Unsorted** folder for easy identification
4. ⚙️ **Configurable Logging** via `config/jotform_config.json`
5. ⏳ **Optional Dashboard** for visual monitoring (future enhancement)

## Upload States

Each processed file can be in one of these states:

| State | Condition | jotformsubmissionid | Location | Primary Log Level |
|-------|-----------|---------------------|----------|-----------|
| **Enriched** | JSON written, upload pending | `""` (empty) | `processing/` | INFO (optional) |
| **Upload In Progress** | First upload attempt | `""` | `processing/` | INFO (optional) |
| **Upload Retry** | Retrying after transient failure | `""` | `processing/` | WARN |
| **Upload Success** | Uploaded and got submission ID | `"239512345"` (real ID) | `filed/{schoolId}/` | UPLOAD |
| **Upload Failed** | Exhausted all retries | `""` (empty) | **`filed/Unsorted/`** | ERROR / REJECT |

**Key Decision**: Failed uploads are always filed to `Unsorted/` regardless of valid School ID. This makes them easy to identify and manually review.

## Implemented Failure Handling

### During Processing (✅ Implemented)

1. **Enrichment completes** → Write JSON with `jotformsubmissionid = ""`
2. **First upload attempt**:
   - Success → Write back submission ID, file to correct school folder
   - Failure (429/5xx/timeout) → Log retry (`WARN`), apply exponential backoff
3. **Retry attempts**:
   - 3 attempts total with delays: 10s, 30s, 90s (with ±20% jitter)
   - Retryable errors: 429, 500, 502, 503, 504, timeouts
   - Non-retryable errors: Other 4xx codes (fail immediately)
4. **After exhausting retries**:
   - Log `REJECT`/`ERROR`: `"Jotform upload permanently failed after 3 attempts: {error} (StatusCode: {code})"`
   - **Override filing destination to `Unsorted/`** (even if School ID is valid)
   - Log WARN: `"Upload failed, overriding filing destination to Unsorted (original: S067)"`
   - **No modifications to JSON** - logs are single source of truth
   - jotformsubmissionid remains empty in JSON

### Manual Monitoring (No Dashboard Required)

**Check failed uploads**:
```powershell
# List all failed uploads
Get-ChildItem "TestWatchFolder/filed/Unsorted" -Filter "*.json"

# Check specific file details
$json = Get-Content "TestWatchFolder/filed/Unsorted/13268_20250904_14_07.json" | ConvertFrom-Json
$json.data.jotformsubmissionid  # Should be empty

# Find error in logs
$sessionkey = "13268_20250904_14_07"
Select-String -Path "TestWatchFolder/logs/*_processing_agent.csv" -Pattern $sessionkey | 
    Where-Object { $_.Line -match "ERROR|WARN" }
```

**Manual retry**:
```powershell
# Move file back to incoming for reprocessing
Move-Item "TestWatchFolder/filed/Unsorted/13268_20250904_14_07.pdf" `
          "TestWatchFolder/incoming/"
# Processor will automatically reprocess and upload
```

**Benefits of this approach**:
- ✅ Simple: Check one folder (`Unsorted/`)
- ✅ Clean: No extra fields polluting data JSONs
- ✅ Comprehensive: Logs contain full error context
- ✅ Auditable: CSV logs retained for historical analysis
- ✅ Self-healing: Easy manual retry by moving file

## Optional Dashboard (Future Enhancement)

### Status File Approach (Recommended for GitHub Pages)

Processor agent writes status to a JSON file with **adaptive frequency**:

**File**: `TestWatchFolder/status/upload_status.json`

**Adaptive Write Strategy**:
- **Active** (15s interval): During file processing
- **Moderate** (60s): < 15 min since last activity
- **Idle** (5 min): 15-60 min since last activity  
- **Sleep** (1 hour): > 60 min since last activity

**Write Triggers** (immediate):
- File detected in `incoming/`
- File processing completes
- Upload success/failure
- Any error occurs

**Implementation Concept**:
```powershell
# In main processing loop
$script:LastFileProcessed = Get-Date
$script:StatusWriteTimer = New-Object System.Timers.Timer

function Update-StatusFileAdaptive {
    $timeSinceActivity = (Get-Date) - $script:LastFileProcessed
    
    # Determine interval
    if ($timeSinceActivity.TotalMinutes -lt 2) {
        $interval = 15000  # 15s - Active
    } elseif ($timeSinceActivity.TotalMinutes -lt 15) {
        $interval = 60000  # 60s - Moderate
    } elseif ($timeSinceActivity.TotalMinutes -lt 60) {
        $interval = 300000  # 5min - Idle
    } else {
        $interval = 3600000  # 1hr - Sleep
    }
    
    $script:StatusWriteTimer.Interval = $interval
    Write-StatusFile  # Actual write logic
}

# Trigger on file detection
$watcher.Changed += {
    $script:LastFileProcessed = Get-Date
    Write-StatusFile  # Immediate write
}

# Trigger on processing complete
Process-File ... {
    $script:LastFileProcessed = Get-Date
    Write-StatusFile  # Immediate write
}
```

**Status File Schema**:
```json
{
  "lastUpdate": "2025-10-14T00:20:00+08:00",
  "agent": {
    "hostName": "KS095",
    "version": "1.0.0",
    "uptime": "2d 5h 30m"
  },
  "summary": {
    "total": 245,
    "success": 238,
    "failed": 5,
    "unsortedCount": 12
  },
  "failures": [
    {
      "sessionkey": "13268_20250904_14_07",
      "fileName": "13268_20250904_14_07.pdf",
      "errorSummary": "Rate limit (429)",
      "attempts": 3,
      "filedAt": "2025-10-14T00:15:30+08:00"
    }
  ]
}
```

**Sync to GitHub Pages via OneDrive** (when implemented):
1. Status file is in OneDrive-synced `TestWatchFolder/status/`
2. GitHub Action copies file to `gh-pages` branch every 2-5 minutes
3. Dashboard fetches static JSON via CORS-enabled endpoint
4. Auto-refresh every 30-60 seconds on dashboard

## Dashboard Design (Optional - Future Enhancement)

### Visual Layout Concept

```
┌─────────────────────────────────────────────────────────────┐
│  4Set Processor Agent Dashboard                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌───────────────────────┐  ┌───────────────────────────┐  │
│  │ Agent Health          │  │ Today's Processing        │  │
│  │                       │  │                           │  │
│  │ Status: 🟢 Running   │  │ ✅ Processed: 42 files   │  │
│  │ Uptime: 6h 20m       │  │ ⚠️  Failed: 3 uploads    │  │
│  │ Last Update: 2m ago  │  │ 📁 Queue: 0 pending      │  │
│  └───────────────────────┘  └───────────────────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┤
│  │ Recent Upload Failures                                  │
│  │                                                         │
│  │ • 13268_20250904_14_07                                 │
│  │   Error: Rate limit (429) - 3 attempts                 │
│  │   Filed: 2 hours ago                                   │
│  │                                                         │
│  │ • 13269_20250904_15_00                                 │
│  │   Error: Connection timeout                            │
│  │   Filed: 3 hours ago                                   │
│  │                                                         │
│  │ [View All in Unsorted Folder →] [View Logs →]         │
│  └─────────────────────────────────────────────────────────┘
│                                                              │
│  ┌─────────────────────────────────────────────────────────┤
│  │ Rate Limit Heatmap (Last 7 Days)                       │
│  │                                                         │
│  │ Hour │ Mon │ Tue │ Wed │ Thu │ Fri │ Sat │ Sun         │
│  │ 08:00│  2  │  1  │  3  │  0  │  1  │  0  │  0          │
│  │ 09:00│ 🔴15│ 🔴18│ 🔴12│ 🔴20│ 🔴17│  5  │  3          │
│  │ 10:00│  8  │  9  │  7  │ 11  │  9  │  4  │  2          │
│  │ 11:00│  3  │  2  │  4  │  1  │  2  │  1  │  0          │
│  │                                                         │
│  │ 💡 Insight: Peak rate limits 9-10 AM weekdays         │
│  │ 📊 Recommendation: Reduce perMinuteQuota to 90        │
│  └─────────────────────────────────────────────────────────┘
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### What Dashboard Provides

**Benefits**:
- 📊 Visual summary (files processed, failed, queued)
- 🚨 Quick failure detection (no need to check Unsorted folder manually)
- 💚 Agent health check (stalled detection via heartbeat)
- 📈 Rate limit patterns to optimize upload timing

**Data Source**: Static JSON file synced from processor agent via OneDrive

**Implementation** (when needed):
1. Processor agent writes `status/upload_status.json` with adaptive frequency
2. File is in OneDrive synced folder
3. GitHub Action copies file to `gh-pages` branch every 2-5 minutes
4. Simple HTML page fetches JSON and displays stats

**Minimal Dashboard HTML**:
```html
<!DOCTYPE html>
<html>
<head>
  <title>4Set Processor Agent Status</title>
  <style>
    .status-card { border: 1px solid #ddd; padding: 20px; margin: 10px; border-radius: 8px; }
    .success { color: green; }
    .error { color: red; }
  </style>
</head>
<body>
  <h1>Processor Agent Status</h1>
  
  <div class="status-card">
    <h2>Agent Health</h2>
    <p id="agent-status">Loading...</p>
    <p id="last-update"></p>
  </div>
  
  <div class="status-card">
    <h2>Today's Processing</h2>
    <p>✅ Processed: <span id="processed-count">-</span></p>
    <p>⚠️ Failed: <span id="failed-count">-</span></p>
  </div>
  
  <div class="status-card">
    <h2>Recent Failures</h2>
    <ul id="failures-list"></ul>
    <a href="logs/">View detailed logs →</a>
  </div>

  <script>
    async function loadStatus() {
      const response = await fetch('/data/upload_status.json');
      const data = await response.json();
      
      // Check heartbeat
      const lastUpdate = new Date(data.lastUpdate);
      const age = (new Date() - lastUpdate) / 60000; // minutes
      
      document.getElementById('agent-status').textContent = 
        age < 10 ? '🟢 Running' : '🔴 Stalled';
      document.getElementById('last-update').textContent = 
        `Last update: ${Math.round(age)} minutes ago`;
      
      // Update counts
      document.getElementById('processed-count').textContent = data.summary.success;
      document.getElementById('failed-count').textContent = data.summary.failed;
      
      // Show failures
      const list = document.getElementById('failures-list');
      list.innerHTML = data.failures.map(f => 
        `<li>${f.sessionkey}: ${f.errorSummary}</li>`
      ).join('');
    }
    
    loadStatus();
    setInterval(loadStatus, 30000); // Refresh every 30s
  </script>
</body>
</html>
```

### Alternative: Manual Monitoring (No Dashboard)

**Simpler approach** - Just use PowerShell scripts:
```powershell
# Check agent health
Get-Process -Name "pwsh" | Where-Object { $_.CommandLine -like "*processor_agent*" }

# Check failed uploads
Get-ChildItem "TestWatchFolder/filed/Unsorted" -Filter "*.json"

# View recent logs
Get-Content "TestWatchFolder/logs/20251014_processing_agent.csv" -Tail 50
```

**Conclusion**: Dashboard is nice-to-have for visual monitoring, but logs + Unsorted folder provide complete observability.

### Rate Limit Optimization Features

When dashboard is implemented, include rate limit tracking for performance optimization:

**Data Collection Script** (parse existing logs):
```powershell
# Parse logs for 429 errors
$rateLimits = Select-String -Path "TestWatchFolder/logs/*_processing_agent.csv" -Pattern "429" | 
    ForEach-Object {
        $parts = $_.Line -split ','
        [PSCustomObject]@{
            Timestamp = [datetime]::Parse($parts[0])
            Hour = [datetime]::Parse($parts[0]).Hour
            File = $parts[2]
        }
    }

# Group by hour to identify peak times
$rateLimitsByHour = $rateLimits | Group-Object Hour | 
    Select-Object @{N='Hour';E={$_.Name}}, @{N='Count';E={$_.Count}} |
    Sort-Object Count -Descending

# Example output:
# Hour Count
# ---- -----
# 9    82     ← Peak period
# 10   45
# 14   23
# 11   15
```

**Optimization Workflow**:
1. **Identify patterns**: Which hours/days have most 429 errors?
2. **Correlate volume**: Are errors due to high upload volume or too aggressive config?
3. **Test adjustments**:
   - Lower `perMinuteQuota`: 120 → 90 during peak hours
   - Reduce `maxConcurrent`: 2 → 1 to be more conservative
   - Increase retry delays: Allow more breathing room
4. **Monitor results**: Did error rate decrease? Is upload time acceptable?
5. **Iterate**: Find optimal balance between speed and stability

**Metrics to Track**:
- 429 errors per hour/day/week
- Average upload time per file  
- Successful uploads per hour
- Retry rate (% of files requiring retries)
- Queue clearance time

**Example Scenario**:
```
Week 1 (Default Config):
- 9-10 AM: 82 rate limits, 200 files processed, avg 2.3 retries per file
- Config: perMinuteQuota=120, maxConcurrent=2

Dashboard shows: High 429 cluster during morning peak

Week 2 (Tuned Config):
- 9-10 AM: 15 rate limits, 200 files processed, avg 1.1 retries per file
- Config: perMinuteQuota=90, maxConcurrent=1 during peaks
- Trade-off: 5 minutes slower, but 82% fewer errors

Result: More stable operation, less API stress ✅
```

This data-driven approach ensures efficient operation within Jotform's API limits.

## Implementation Status

### ✅ Core Upload Pipeline (COMPLETE)
- [x] **Retry logic** with exponential backoff (3 attempts: 10s, 30s, 90s + jitter)
- [x] **Smart error detection**: Retryable (429, 5xx, timeout) vs non-retryable (4xx)
- [x] **Failed uploads file to Unsorted/** regardless of valid School ID
- [x] **Logs as single source of truth** - no JSON pollution
- [x] **Clean data**: jotformsubmissionid remains empty on failure
- [x] **Manual retry workflow**: Move file from Unsorted back to incoming

### ⏳ Optional Dashboard (Future Enhancement - To Be Decided)
When visual monitoring is needed, implement:
- [ ] Adaptive status file writer (15s active → 1hr sleep)
- [ ] GitHub Action to sync status file to gh-pages
- [ ] Simple HTML dashboard (agent health + stats + failures)
- [ ] **Rate limit tracking** - Chart 429 errors throughout the day to optimize upload timing:
  - Hourly heatmap showing when rate limits occur most
  - Upload throughput vs rate limit correlation
  - Recommendations for adjusting `perMinuteQuota`, `maxConcurrent`, or `batchSize`
  - Goal: Optimize config for faster uploads while avoiding excessive errors

**Current state**: Manual monitoring via PowerShell scripts and log files is sufficient. Dashboard can be added later for convenience.

## Technical Notes

- **Idempotency**: Retries are safe because Jotform upsert searches by sessionkey first
- **Rate limiting**: 429 errors trigger exponential backoff with jitter
- **Network issues**: Transient failures (5xx, timeout) retry automatically  
- **Permanent errors**: 4xx errors (except 429) are non-retryable and fail immediately
- **Clean architecture**: Logs contain all diagnostics, no extra fields in data JSONs
