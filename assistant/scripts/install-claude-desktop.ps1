#requires -Version 7
<#
.SYNOPSIS
  Adds (or removes) the TaskFlow MCP server in Claude Desktop's claude_desktop_config.json.

.DESCRIPTION
  Claude Desktop's Chat loads local MCP servers from %APPDATA%\Claude\claude_desktop_config.json
  (a Claude Code plugin cannot provide one). This merges a "taskflow" entry into the existing
  file without touching the app's other settings, after saving a timestamped backup.

  Claude Desktop rewrites that file while it runs, so the script refuses to change it while the
  app is open. Quit Claude Desktop completely (tray icon > Quit), run this, then start it again.
  Run ./build.ps1 first so plugin/bin contains the published server.

.PARAMETER ApiUrl
  TaskFlow API base URL. Default: http://localhost:8081 (local Docker).

.PARAMETER DryRun
  Print the entry that would be written and exit without changing anything.

.PARAMETER Uninstall
  Remove the "taskflow" entry instead.
#>
[CmdletBinding()]
param(
    [string] $ApiUrl = 'http://localhost:8081',
    [switch] $DryRun,
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$dll = Join-Path $repo 'plugin/bin/TaskFlow.Mcp.dll'
$config = Join-Path $env:APPDATA 'Claude/claude_desktop_config.json'

if (-not $Uninstall -and -not (Test-Path $dll)) { throw "Server not published at $dll. Run ./build.ps1 first." }
$dotnet = (Get-Command dotnet -ErrorAction Stop).Source

# The desktop app's processes (the Claude Code CLI under WinGet also uses claude.exe, so match by install location).
$desktop = Get-Process claude -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -match 'WindowsApps\\Claude_|AnthropicClaude' }
if ($desktop -and -not $DryRun) {
    throw 'Claude Desktop is running. Quit it completely (tray icon > Quit), then run this again.'
}

$settings = if (Test-Path $config) { Get-Content $config -Raw | ConvertFrom-Json -AsHashtable } else { [ordered]@{} }

if ($Uninstall) {
    if ($settings.ContainsKey('mcpServers')) {
        $settings['mcpServers'].Remove('taskflow')
        if ($settings['mcpServers'].Count -eq 0) { $settings.Remove('mcpServers') }
    }
}
else {
    if (-not $settings.ContainsKey('mcpServers')) { $settings['mcpServers'] = [ordered]@{} }
    $settings['mcpServers']['taskflow'] = [ordered]@{
        command = $dotnet
        args    = @($dll)
        env     = [ordered]@{ TASKFLOW_API_URL = $ApiUrl }
    }
}

if ($DryRun) {
    Write-Host "Dry run. Config file: $config"
    ($settings['mcpServers'] ?? @{}) | ConvertTo-Json -Depth 8
    return
}

$json = $settings | ConvertTo-Json -Depth 32
$null = $json | ConvertFrom-Json   # must round-trip before we write anything

if (Test-Path $config) {
    $backup = "$config.bak-$(Get-Date -Format 'yyyyMMddHHmmss')"
    Copy-Item $config $backup
    Write-Host "Backup: $backup"
}
else {
    New-Item -ItemType Directory -Force (Split-Path $config) | Out-Null
}

[IO.File]::WriteAllText($config, $json, [Text.UTF8Encoding]::new($false))
Write-Host ($Uninstall ? "Removed 'taskflow' from $config" : "Added 'taskflow' to $config")
Write-Host 'Start Claude Desktop again, then check the connector list under the + menu in a chat.'
