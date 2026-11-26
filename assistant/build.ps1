#requires -Version 7
<#
.SYNOPSIS
  Publishes the TaskFlow MCP server into mcp/bin.

.DESCRIPTION
  Framework-dependent publish (the server needs the .NET 11 runtime on PATH when it runs).
  mcp/bin is gitignored; run this after cloning and after changing the server.

  Refuses to run while a TaskFlow MCP server (a dotnet process whose command line contains
  TaskFlow.Mcp.dll) is running, because it holds mcp/bin open. Disable the server in /mcp
  or quit Claude Desktop first. It publishes to .build-staging, then swaps it into mcp/bin;
  if the publish or the swap fails, the previous mcp/bin is kept or restored.
#>
[CmdletBinding()]
param([string] $Configuration = 'Release')

$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot (Join-Path 'mcp' 'bin')
# Staging and backup sit in assistant/, on the same volume as mcp/bin, so the swap is a
# rename, not a copy.
$staging = Join-Path $PSScriptRoot '.build-staging'
$backup = Join-Path $PSScriptRoot '.build-backup'

function Get-BlockingServer {
    $all = Get-CimInstance Win32_Process
    $found = @($all | Where-Object {
            # A process whose command line cannot be read (elevated or other user) is skipped.
            $_.Name -eq 'dotnet.exe' -and $_.CommandLine -and $_.CommandLine -like '*TaskFlow.Mcp.dll*'
        })
    foreach ($p in $found) {
        $parent = $all | Where-Object ProcessId -eq $p.ParentProcessId | Select-Object -First 1
        $parentName = if ($parent -and $parent.Name) { $parent.Name } else { '<exited>' }
        [pscustomobject]@{ ProcessId = $p.ProcessId; ParentName = $parentName }
    }
}

function Format-BlockingList($servers) {
    ($servers | ForEach-Object { "  PID $($_.ProcessId)  (parent: $($_.ParentName))" }) -join [Environment]::NewLine
}

# 1. Clean up leftovers from an earlier failed run.
try {
    if (Test-Path $staging) { Remove-Item $staging -Recurse -Force -ErrorAction Stop }
    if (Test-Path $backup) {
        if (Test-Path $out) {
            Remove-Item $backup -Recurse -Force -ErrorAction Stop
        }
        else {
            $null = New-Item -ItemType Directory -Force (Split-Path $out) -ErrorAction Stop
            [System.IO.Directory]::Move($backup, $out)
            Write-Host 'Restored mcp/bin from a backup left by an earlier failed run.'
        }
    }
}
catch {
    throw "Could not clean up a leftover build directory: $($_.Exception.Message.TrimEnd('.')). Nothing was published and mcp/bin is untouched. Remove $staging and $backup by hand (if $backup exists and mcp/bin does not, rename it to mcp/bin), then run ./build.ps1 again."
}

# 2. Refuse to run while a server holds mcp/bin open.
$blocking = @(Get-BlockingServer)
if ($blocking.Count -gt 0) {
    throw ("build.ps1 stopped: a TaskFlow MCP server is running and holds mcp/bin open." + [Environment]::NewLine +
        (Format-BlockingList $blocking) + [Environment]::NewLine +
        "Disable the taskflow server in /mcp (Claude Code) or quit Claude Desktop completely, then run ./build.ps1 again." + [Environment]::NewLine +
        "mcp/bin was not changed.")
}

# 3. Publish to staging.
dotnet publish (Join-Path $PSScriptRoot 'src/TaskFlow.Mcp/TaskFlow.Mcp.csproj') `
    -c $Configuration -o $staging --no-self-contained -p:UseAppHost=false
if ($LASTEXITCODE -ne 0) {
    $exit = $LASTEXITCODE
    $tail = 'Staging directory removed.'
    try { if (Test-Path $staging) { Remove-Item $staging -Recurse -Force -ErrorAction Stop } }
    catch { $tail = "Staging directory $staging was left behind; the next build removes it." }
    throw "dotnet publish failed (exit code $exit). mcp/bin was not changed. $tail"
}

# 4. Verify staging.
$stagingProblem = $null
foreach ($required in 'TaskFlow.Mcp.dll', 'TaskFlow.Contracts.dll') {
    if (-not $stagingProblem -and -not (Test-Path (Join-Path $staging $required))) {
        $stagingProblem = "$required is missing from the staging directory"
    }
}
if (-not $stagingProblem) {
    # The MCP server must not drag in the API or its web/database stack through TaskFlow.Contracts.
    $forbidden = @(Get-ChildItem $staging -Filter '*.dll' | Where-Object {
            $_.Name -like 'Microsoft.EntityFrameworkCore*' -or $_.Name -like 'Microsoft.AspNetCore*' -or $_.Name -eq 'TaskFlow.Api.dll'
        } | Select-Object -First 1)
    if ($forbidden.Count -gt 0) {
        $stagingProblem = "the staging directory contains $($forbidden[0].Name), which must not ship with the MCP server"
    }
}
if ($stagingProblem) {
    try { Remove-Item $staging -Recurse -Force -ErrorAction Stop } catch { Write-Warning "Could not remove ${staging}: $($_.Exception.Message)" }
    throw "dotnet publish succeeded but $stagingProblem. mcp/bin was not changed."
}

# 5. Swap staging into mcp/bin.
$step = '5a'
try {
    if (Test-Path $out) {
        [System.IO.Directory]::Move($out, $backup)
    }
    else {
        $null = New-Item -ItemType Directory -Force (Split-Path $out) -ErrorAction Stop
    }
    $step = '5b'
    [System.IO.Directory]::Move($staging, $out)
}
catch {
    $swapError = $_.Exception.Message.TrimEnd('.')
    $restoreError = $null
    if ($step -eq '5b' -and (Test-Path $backup) -and -not (Test-Path $out)) {
        try { [System.IO.Directory]::Move($backup, $out) }
        catch { $restoreError = $_.Exception.Message.TrimEnd('.') }
    }

    $binState = if (-not (Test-Path $out)) { 'is missing' }
    elseif (Test-Path $backup) { 'is the new build' }
    elseif (Test-Path $staging) { 'restored to the previous build' }
    else { 'is the new build' }
    $backupState = if (Test-Path $backup) { "left in place at $backup" } else { 'removed' }
    $stagingState = if (Test-Path $staging) { "left in place at $staging" } else { 'removed' }
    $state = "State: mcp/bin $binState; backup $backupState; staging $stagingState."
    if ($restoreError) {
        $state += " Restore failed: $restoreError. The previous build is in $backup; rename it to mcp/bin by hand."
    }

    try { $now = @(Get-BlockingServer) } catch { $now = @() }
    if ($now.Count -gt 0) {
        Write-Host (Format-BlockingList $now)
        throw "Could not replace mcp/bin: $swapError. A TaskFlow server appears to have started or holds a lock (see PIDs above). $state Stop the server and run ./build.ps1 again."
    }
    throw "Could not replace mcp/bin: $swapError. No TaskFlow server is running, so another program (antivirus, a file explorer window, an editor) may hold a handle on mcp/bin. $state Close it and run ./build.ps1 again."
}

# 5c. The new build is in place; a leftover backup is only a warning.
if (Test-Path $backup) {
    try { Remove-Item $backup -Recurse -Force -ErrorAction Stop }
    catch { Write-Warning "mcp/bin was replaced, but the old build in $backup could not be deleted: $($_.Exception.Message.TrimEnd('.')). The next build removes it." }
}

Write-Host "Published to $out"
