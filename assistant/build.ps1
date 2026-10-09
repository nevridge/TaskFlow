#requires -Version 7
<#
.SYNOPSIS
  Publishes the TaskFlow MCP server into plugin/bin, which the plugin's .mcp.json launches.

.DESCRIPTION
  Framework-dependent publish (needs the .NET 10 runtime on PATH when the plugin runs).
  plugin/bin is gitignored; run this after cloning and after changing the server, then
  run /reload-plugins in Claude Code.
#>
[CmdletBinding()]
param([string] $Configuration = 'Release')

$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot 'plugin/bin'

if (Test-Path $out) { Remove-Item $out -Recurse -Force }

dotnet publish (Join-Path $PSScriptRoot 'src/TaskFlow.Mcp/TaskFlow.Mcp.csproj') `
    -c $Configuration -o $out --no-self-contained -p:UseAppHost=false
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed ($LASTEXITCODE)" }

Write-Host "Published to $out"
