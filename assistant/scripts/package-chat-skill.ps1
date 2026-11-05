#requires -Version 7
<#
.SYNOPSIS
  Zips the Claude Desktop (Chat) skill into dist/taskflow-assistant-skill.zip for upload.

.DESCRIPTION
  Upload the zip in Claude Desktop under Customize > Skills > + > Upload a skill.
  Chat accepts only a subset of SKILL.md frontmatter keys, so this script fails if the
  skill uses anything else (the Claude Code plugin skills under plugin/skills may; this one must not).
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot
$skillDir = Join-Path $repo 'chat/taskflow-assistant'
$skillFile = Join-Path $skillDir 'SKILL.md'
$allowed = @('name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools')

$lines = Get-Content $skillFile
if ($lines[0] -ne '---') { throw "SKILL.md must start with '---' on line 1." }
$end = [array]::IndexOf($lines, '---', 1)
if ($end -lt 0) { throw 'SKILL.md frontmatter is not closed.' }

$keys = $lines[1..($end - 1)] | Where-Object { $_ -match '^([A-Za-z_-]+):' } | ForEach-Object { $Matches[1] }
$unexpected = $keys | Where-Object { $_ -notin $allowed }
if ($unexpected) { throw "Frontmatter keys not accepted by Claude Chat: $($unexpected -join ', ')" }
if ('name' -notin $keys -or 'description' -notin $keys) { throw 'Frontmatter needs name and description.' }

$dist = Join-Path $repo 'dist'
New-Item -ItemType Directory -Force $dist | Out-Null
$zip = Join-Path $dist 'taskflow-assistant-skill.zip'
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path $skillDir -DestinationPath $zip
Write-Host "Created $zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
[IO.Compression.ZipFile]::OpenRead($zip).Entries | ForEach-Object { "  $($_.FullName)" }
