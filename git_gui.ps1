Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Create form
$form = New-Object System.Windows.Forms.Form
$form.Text = "Git Commit & Push (4Set-Server)"
$form.Size = New-Object System.Drawing.Size(1000,600)
$form.StartPosition = "CenterScreen"

# Label for git user info
$labelUser = New-Object System.Windows.Forms.Label
$labelUser.AutoSize = $true
$labelUser.Location = New-Object System.Drawing.Point(10,10)
$form.Controls.Add($labelUser)

# Label for repo info
$labelRepo = New-Object System.Windows.Forms.Label
$labelRepo.AutoSize = $true
$labelRepo.Location = New-Object System.Drawing.Point(10,30)
$form.Controls.Add($labelRepo)

# ===== Section 1: .enc file mover (left side, top) =====

$groupEnc = New-Object System.Windows.Forms.GroupBox
$groupEnc.Text = ".enc file mover"
$groupEnc.Location = New-Object System.Drawing.Point(10,55)
$groupEnc.Size = New-Object System.Drawing.Size(700,120)
$form.Controls.Add($groupEnc)

# Label for enc source folder
$labelEncSource = New-Object System.Windows.Forms.Label
$labelEncSource.Text = "Source folder for .enc files:" 
$labelEncSource.AutoSize = $true
$labelEncSource.Location = New-Object System.Drawing.Point(10,20)
$groupEnc.Controls.Add($labelEncSource)

# TextBox for enc source folder
$textEncSource = New-Object System.Windows.Forms.TextBox
$textEncSource.Location = New-Object System.Drawing.Point(10,40)
$textEncSource.Size = New-Object System.Drawing.Size(500,20)
$textEncSource.ReadOnly = $false
$groupEnc.Controls.Add($textEncSource)

# Label for enc target folder
$labelEncTarget = New-Object System.Windows.Forms.Label
$labelEncTarget.Text = "Destination folder for .enc files:" 
$labelEncTarget.AutoSize = $true
$labelEncTarget.Location = New-Object System.Drawing.Point(10,65)
$groupEnc.Controls.Add($labelEncTarget)

# TextBox for enc target folder
$textEncTarget = New-Object System.Windows.Forms.TextBox
$textEncTarget.Location = New-Object System.Drawing.Point(10,85)
$textEncTarget.Size = New-Object System.Drawing.Size(500,20)
$textEncTarget.ReadOnly = $false
$groupEnc.Controls.Add($textEncTarget)

# Button: Check & Move .enc Files (within enc group)
$buttonEnc = New-Object System.Windows.Forms.Button
$buttonEnc.Text = "Check && Move .enc"
$buttonEnc.Location = New-Object System.Drawing.Point(530,40)
$buttonEnc.Size = New-Object System.Drawing.Size(150,30)
$groupEnc.Controls.Add($buttonEnc)

# ===== Section 2: Git operations (left side, bottom) =====

# Label for changed files
$labelFiles = New-Object System.Windows.Forms.Label
$labelFiles.Text = "Files to be committed (all changes):"
$labelFiles.AutoSize = $true
$labelFiles.Location = New-Object System.Drawing.Point(10,170)
$form.Controls.Add($labelFiles)

# ListView for file list
$listViewFiles = New-Object System.Windows.Forms.ListView
$listViewFiles.Location = New-Object System.Drawing.Point(10,190)
$listViewFiles.Size = New-Object System.Drawing.Size(700,240)
$listViewFiles.View = [System.Windows.Forms.View]::Details
$listViewFiles.FullRowSelect = $true
$listViewFiles.GridLines = $true
$listViewFiles.MultiSelect = $false

$null = $listViewFiles.Columns.Add("Status",80)
$null = $listViewFiles.Columns.Add("File",660)

$form.Controls.Add($listViewFiles)

# Label for commit message
$labelCommit = New-Object System.Windows.Forms.Label
$labelCommit.Text = "Commit message:"
$labelCommit.AutoSize = $true
$labelCommit.Location = New-Object System.Drawing.Point(10,440)
$form.Controls.Add($labelCommit)

# TextBox for commit message
$textCommit = New-Object System.Windows.Forms.TextBox
$textCommit.Location = New-Object System.Drawing.Point(10,460)
$textCommit.Size = New-Object System.Drawing.Size(700,40)
$textCommit.Multiline = $true
$form.Controls.Add($textCommit)

# Status label
$labelStatus = New-Object System.Windows.Forms.Label
$labelStatus.Text = "Status: Ready"
$labelStatus.AutoSize = $true
$labelStatus.Location = New-Object System.Drawing.Point(10,480)
$form.Controls.Add($labelStatus)

# Button: Refresh file list
$buttonRefresh = New-Object System.Windows.Forms.Button
$buttonRefresh.Text = "Refresh Changes"
$buttonRefresh.Location = New-Object System.Drawing.Point(10,510)
$buttonRefresh.Size = New-Object System.Drawing.Size(120,30)
$form.Controls.Add($buttonRefresh)

 # Button: Commit & Push
$buttonPush = New-Object System.Windows.Forms.Button
$buttonPush.Text = "Commit && Push to master"
$buttonPush.Location = New-Object System.Drawing.Point(140,510)
$buttonPush.Size = New-Object System.Drawing.Size(180,30)
$form.Controls.Add($buttonPush)

# ===== Right panel: instructions =====

$labelInstructions = New-Object System.Windows.Forms.Label
$labelInstructions.AutoSize = $false
$labelInstructions.Location = New-Object System.Drawing.Point(720,40)
$labelInstructions.Size = New-Object System.Drawing.Size(260,530)
$labelInstructions.Text = @"
Section 1: .enc file mover

1. Confirm or edit the Source folder
    (default: your Downloads).
2. Confirm or edit the Destination folder
    (default: "assets" folder in 4Set-Server).
3. Click ""Check && Move .enc"".
    - The GUI will list all .enc files
      found in the Source folder.
    - Choose whether to move them.
    - For existing files in Destination,
      you can choose to overwrite or skip.

Section 2: Git commit & push

1. Review the repo info at the top to
    confirm you are in 4Set-Server.
2. Review the ""Files to be committed""
    list (left panel).
3. Enter a clear commit message.
4. Click ""Commit && Push to master"".
    - All changes will be added, committed
      with your message, and pushed to
      origin/master.
5. Use ""Refresh Changes"" to update the
    file list after edits or commits.
"@
$form.Controls.Add($labelInstructions)

# Function to run git command and capture output
function Invoke-GitCommand {
    param(
        [string]$Arguments
    )
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "git"
    $psi.Arguments = $Arguments
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
    $psi.WorkingDirectory = (Get-Location).Path

    $proc = New-Object System.Diagnostics.Process
    $proc.StartInfo = $psi
    $null = $proc.Start()
    $stdout = $proc.StandardOutput.ReadToEnd()
    $stderr = $proc.StandardError.ReadToEnd()
    $proc.WaitForExit()

    return [PSCustomObject]@{
        ExitCode = $proc.ExitCode
        StdOut   = $stdout.Trim()
        StdErr   = $stderr.Trim()
    }
}

# Load git global user info
function Get-GitGlobalUserInfo {
    $nameResult = Invoke-GitCommand -Arguments "config --global user.name"
    $emailResult = Invoke-GitCommand -Arguments "config --global user.email"

    $name = if ($nameResult.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($nameResult.StdOut)) { $nameResult.StdOut } else { "(no global user.name set)" }
    $email = if ($emailResult.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($emailResult.StdOut)) { $emailResult.StdOut } else { "(no global user.email set)" }

    return "Global Git: $name <$email>"
}

# Load repo info and verify it's 4Set-Server
function Get-GitRepoInfo {
    $root = Invoke-GitCommand -Arguments "rev-parse --show-toplevel"
    if ($root.ExitCode -ne 0) {
        return [PSCustomObject]@{
            IsRepo       = $false
            RootPath     = ""
            Origin       = ""
            Is4SetServer = $false
            Error        = $root.StdErr
        }
    }

    $origin = Invoke-GitCommand -Arguments "remote get-url origin"
    $originUrl = if ($origin.ExitCode -eq 0 -and -not [string]::IsNullOrWhiteSpace($origin.StdOut)) { $origin.StdOut } else { "(no origin remote)" }

    $is4SetServer = $false
    if ($originUrl -match "herman925/4Set-Server") {
        $is4SetServer = $true
    }

    return [PSCustomObject]@{
        IsRepo       = $true
        RootPath     = $root.StdOut
        Origin       = $originUrl
        Is4SetServer = $is4SetServer
        Error        = ""
    }
}

function Refresh-FileList {
    $labelStatus.Text = "Status: Checking git status..."
    $result = Invoke-GitCommand -Arguments "status -s"

    if ($result.ExitCode -ne 0) {
        $listViewFiles.Items.Clear()
        $null = $listViewFiles.Items.Add((New-Object System.Windows.Forms.ListViewItem("ERR"))).SubItems.Add($result.StdErr)
        $labelStatus.Text = "Status: git status failed"
        return
    }

    if ([string]::IsNullOrWhiteSpace($result.StdOut)) {
        $listViewFiles.Items.Clear()
        $null = $listViewFiles.Items.Add((New-Object System.Windows.Forms.ListViewItem("OK"))).SubItems.Add("No changes to commit.")
    } else {
        $listViewFiles.Items.Clear()

        $lines = $result.StdOut -split "`n"
        foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) { continue }

            # git status -s format: "XY path" where X/Y are status codes
            $statusPart = $line.Substring(0,2).Trim()
            $pathPart = $line.Substring(3).Trim()

            switch -Regex ($statusPart) {
                'M'    { $status = "Modified"; break }
                'A'    { $status = "Added"; break }
                'D'    { $status = "Deleted"; break }
                'R'    { $status = "Renamed"; break }
                'C'    { $status = "Copied"; break }
                '\?\?' { $status = "Untracked"; break }
                default { $status = $statusPart }
            }

            $item = New-Object System.Windows.Forms.ListViewItem($status)
            $null = $item.SubItems.Add($pathPart)
            [void]$listViewFiles.Items.Add($item)
        }
    }

    $labelStatus.Text = "Status: Ready"
}

$buttonRefresh.Add_Click({ Refresh-FileList })

# Handler to check and move .enc files from Downloads to assets
$buttonEnc.Add_Click({
    try {
        $downloads = $textEncSource.Text
        if ([string]::IsNullOrWhiteSpace($downloads)) {
            $downloads = Join-Path $env:USERPROFILE 'Downloads'
        }

        $target = $textEncTarget.Text
        if ([string]::IsNullOrWhiteSpace($target)) {
            $target = 'C:\Users\keysteps\The Education University of Hong Kong\o365grp_KeySteps@JC - General\98 - IT Support\04 - Homemade Apps\4Set-Server\assets'
        }

        $textEncSource.Text = $downloads
        $textEncTarget.Text = $target

        if (-not (Test-Path -LiteralPath $downloads)) {
            [System.Windows.Forms.MessageBox]::Show("Downloads folder not found: $downloads",".enc check","OK","Information") | Out-Null
            return
        }

    $encFiles = Get-ChildItem -LiteralPath $downloads -Filter '*.enc' -File -ErrorAction SilentlyContinue
        if (-not $encFiles -or $encFiles.Count -eq 0) {
            [System.Windows.Forms.MessageBox]::Show("No .enc files found in $downloads",".enc check","OK","Information") | Out-Null
            return
        }

        $names = ($encFiles | Select-Object -ExpandProperty Name) -join "`r`n  - "
        $message = "The following .enc files were found in:`r`n  $downloads`r`n`r`n  - $names`r`n`r`nMove them to:`r`n  $target ?"

        $result = [System.Windows.Forms.MessageBox]::Show($message, "Move .enc files", [System.Windows.Forms.MessageBoxButtons]::YesNoCancel, [System.Windows.Forms.MessageBoxIcon]::Question)

        if ($result -eq [System.Windows.Forms.DialogResult]::Cancel) { return }

        if (-not (Test-Path -LiteralPath $target)) {
            New-Item -ItemType Directory -Path $target -Force | Out-Null
        }

        foreach ($f in $encFiles) {
            $dest = Join-Path $target $f.Name
            if (Test-Path -LiteralPath $dest) {
                $overwriteMsg = "File '$($f.Name)' already exists in assets.`r`nOverwrite?"
                $ow = [System.Windows.Forms.MessageBox]::Show($overwriteMsg, "Overwrite?", [System.Windows.Forms.MessageBoxButtons]::YesNoCancel, [System.Windows.Forms.MessageBoxIcon]::Warning)
                if ($ow -eq [System.Windows.Forms.DialogResult]::Cancel) { return }
                if ($ow -ne [System.Windows.Forms.DialogResult]::Yes) { continue }
            }
            Move-Item -LiteralPath $f.FullName -Destination $dest -Force
        }

        [System.Windows.Forms.MessageBox]::Show(".enc file processing completed.",".enc check","OK","Information") | Out-Null
    }
    catch {
        [System.Windows.Forms.MessageBox]::Show("Error while processing .enc files:`r`n" + $_.Exception.Message,"Error","OK","Error") | Out-Null
    }
})

# Commit & push handler
$buttonPush.Add_Click({
    $commitMessage = $textCommit.Text.Trim()
    if ([string]::IsNullOrWhiteSpace($commitMessage)) {
        [System.Windows.Forms.MessageBox]::Show("Please enter a commit message.", "Missing commit message", "OK", "Warning") | Out-Null
        return
    }

    $labelStatus.Text = "Status: Adding all changes..."
    $form.Refresh()

    $addResult = Invoke-GitCommand -Arguments "add -A"
    if ($addResult.ExitCode -ne 0) {
        [System.Windows.Forms.MessageBox]::Show("git add failed:`r`n" + $addResult.StdErr, "Error", "OK", "Error") | Out-Null
        $labelStatus.Text = "Status: git add failed"
        return
    }

    $labelStatus.Text = "Status: Committing..."
    $form.Refresh()

    $commitResult = Invoke-GitCommand -Arguments "commit -m `"$commitMessage`""
    if ($commitResult.ExitCode -ne 0) {
        [System.Windows.Forms.MessageBox]::Show("git commit failed:`r`n" + $commitResult.StdErr, "Error", "OK", "Error") | Out-Null
        $labelStatus.Text = "Status: git commit failed"
        Refresh-FileList
        return
    }

    $labelStatus.Text = "Status: Pushing to origin/master (4Set-Server)..."
    $form.Refresh()

    $pushResult = Invoke-GitCommand -Arguments "push origin master"
    if ($pushResult.ExitCode -ne 0) {
        [System.Windows.Forms.MessageBox]::Show("git push failed:`r`n" + $pushResult.StdErr, "Error", "OK", "Error") | Out-Null
        $labelStatus.Text = "Status: git push failed"
        Refresh-FileList
        return
    }

    [System.Windows.Forms.MessageBox]::Show("Changes successfully pushed to origin/master.", "Success", "OK", "Information") | Out-Null
    $labelStatus.Text = "Status: Push completed"
    $textCommit.Text = ""
    Refresh-FileList
})

# Initialize
$labelUser.Text = Get-GitGlobalUserInfo
$repoInfo = Get-GitRepoInfo

if (-not $repoInfo.IsRepo) {
    $labelRepo.Text = "Repo: NOT a git repo here (" + $repoInfo.Error + ")"
    $buttonPush.Enabled = $false
} elseif (-not $repoInfo.Is4SetServer) {
    $labelRepo.Text = "Repo: " + $repoInfo.RootPath + " (origin: " + $repoInfo.Origin + ")"
    # Push remains enabled, but user clearly sees it's not 4Set-Server
} else {
    $labelRepo.Text = "Repo: 4Set-Server (origin: " + $repoInfo.Origin + ")"
}

if ([string]::IsNullOrWhiteSpace($textEncSource.Text)) {
    $textEncSource.Text = (Join-Path $env:USERPROFILE 'Downloads')
}
if ([string]::IsNullOrWhiteSpace($textEncTarget.Text)) {
    $textEncTarget.Text = 'C:\Users\keysteps\The Education University of Hong Kong\o365grp_KeySteps@JC - General\98 - IT Support\04 - Homemade Apps\4Set-Server\assets'
}

Refresh-FileList

[void]$form.ShowDialog()