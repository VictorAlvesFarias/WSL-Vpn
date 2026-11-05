<#
.SYNOPSIS
  Runs gateway.ps1 on request, elevated, for as long as the app is open.
.DESCRIPTION
  Started once by the app with one UAC prompt (Start-Process -Verb RunAs). From then on the app
  drops a request in -Dir (<id>.req: a JSON array with gateway.ps1's parameters) and this
  process runs gateway.ps1 with them in a child PowerShell, which inherits the elevation, so
  turning the tunnel on and off asks nothing more. gateway.ps1 writes <id>.res as usual.

  The process ends by itself when the app (-ParentPid) is gone. The "ready" file, holding
  this process' PID, tells the app it is up.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][int]$ParentPid,
    [Parameter(Mandatory)][string]$Dir
)

$ErrorActionPreference = "Stop"
$gateway = Join-Path $PSScriptRoot "gateway.ps1"
$ready = Join-Path $Dir "ready"

New-Item -ItemType Directory -Force -Path $Dir | Out-Null
Get-ChildItem -Path (Join-Path $Dir "*") -Include "*.req", "*.res" -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
Set-Content -Path $ready -Value $PID -Encoding ascii

try {
    while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
        foreach ($request in Get-ChildItem -Path $Dir -Filter "*.req" -File -ErrorAction SilentlyContinue) {
            $result = [IO.Path]::ChangeExtension($request.FullName, ".res")
            try {
                [string[]]$params = Get-Content -Raw -Path $request.FullName | ConvertFrom-Json
                Remove-Item -Path $request.FullName -Force
                # Only gateway.ps1's own parameters, each a -Name followed by its value.
                for ($i = 0; $i -lt $params.Count; $i += 2) {
                    if ($params[$i] -notmatch '^-(Action|WslIp|Dns|Routes|Suffixes|Mode|VpnHost)$') { throw "Parametro invalido: $($params[$i])" }
                }
                & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $gateway @params -Result $result | Out-Null
                if (-not (Test-Path $result)) { Set-Content -Path $result -Encoding utf8 -Value @("ERRO", "O gateway.ps1 nao devolveu resultado.") }
            } catch {
                Set-Content -Path $result -Encoding utf8 -Value @("ERRO", "$($_.Exception.Message)")
            }
        }
        Start-Sleep -Milliseconds 250
    }
} finally {
    Remove-Item -Path $ready -Force -ErrorAction SilentlyContinue
}
