<#
.SYNOPSIS
  Installer for the WSL2 side of WSL-Vpn: Ubuntu with openfortivpn.
.DESCRIPTION
  Checks what already exists and only does what is missing - run it as many times as needed.
  Prepares Windows (WSL2 in NAT mode), installs Ubuntu, creates the user and calls setup.ps1.
  Run by the app (unelevated); installing the WSL platform itself needs administrator rights
  and is a separate action in the app. VPN connections are managed in the app.

  Exit codes: 0 ok, 1 failure, 2 WSL not installed.
.PARAMETER Distro
  WSL distro name (e.g. Ubuntu-24.04).
.PARAMETER LinuxUser
  Linux user to create/use.
.PARAMETER SecretsFromStdin
  Reads one line from stdin: base64 of a UTF-8 JSON object with linuxPassword. Base64 keeps
  non-ASCII passwords intact whatever the console code page is.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Distro,
    [Parameter(Mandatory)][string]$LinuxUser,
    [switch]$SecretsFromStdin
)

$ErrorActionPreference = "Stop"
# No BOM when piping text to wsl.exe: Linux would receive the password with invisible garbage.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say  ($m) { Write-Host "==> $m" }
function Ok   ($m) { Write-Host "    [OK] $m" }
function Warn ($m) { Write-Host "    [!] $m" }
function Die  ($m, $code = 1) { Write-Host "    [X] $m"; exit $code }

if ($Distro -notmatch '^[A-Za-z0-9._-]+$') { Die "Distro invalida: '$Distro'" }
if ($LinuxUser -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { Die "Usuario do Linux invalido: '$LinuxUser'" }

$linuxPassword = ""
if ($SecretsFromStdin) {
    $line = [Console]::In.ReadLine()
    if ($line) {
        $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Trim())) | ConvertFrom-Json
        $linuxPassword = [string]$json.linuxPassword
    }
}

# ================================================================ 1 virtualization
Say "1/5 Virtualizacao"
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$hypervisor = (Get-CimInstance Win32_ComputerSystem).HypervisorPresent
# With an ACTIVE hypervisor Windows reports VirtualizationFirmwareEnabled=False, because the
# hypervisor took over the CPU extensions. Checking only the firmware would give a false
# negative on every reinstall.
if ($hypervisor) {
    Ok "Hypervisor ativo ($($cpu.Name.Trim()))."
} elseif ($cpu.VirtualizationFirmwareEnabled) {
    Ok "Habilitada no firmware ($($cpu.Name.Trim()))."
} else {
    Die "Virtualizacao DESABILITADA na BIOS/UEFI. Habilite VT-x/AMD-V e repita."
}

# ================================================================ 2 WSL
Say "2/5 WSL"
$wslOk = $false
try { wsl.exe --version *> $null; $wslOk = ($LASTEXITCODE -eq 0) } catch { $wslOk = $false }
if (-not $wslOk) {
    Die "WSL nao instalado: use 'Instalar o WSL' (pede administrador) e reinicie o Windows." 2
}
Ok "WSL presente."

# ================================================================ 3 isolation
Say "3/5 Isolamento de rede (.wslconfig)"
$wslConfigPath = Join-Path $env:USERPROFILE ".wslconfig"
$wslConfig = @"
# WSL2 network isolation (written by WSL-Vpn)
# NAT: the Linux VM has its own network stack. Routes/DNS/gateway created by the VPN inside
# WSL2 do NOT leak to the Windows host.
# Do NOT use "mirrored": that mode shares the network with the host.
[wsl2]
networkingMode=NAT
dnsTunneling=false
autoProxy=false
"@
if (Test-Path $wslConfigPath) {
    $current = Get-Content $wslConfigPath -Raw
    if ($current -match 'networkingMode\s*=\s*mirrored') {
        Warn "networkingMode=mirrored quebraria o isolamento."
    }
    if ($current.Trim() -ne $wslConfig.Trim()) {
        Copy-Item $wslConfigPath "$wslConfigPath.bak" -Force
        Warn "O .wslconfig anterior foi salvo em $wslConfigPath.bak"
    }
}
Set-Content -Path $wslConfigPath -Value $wslConfig -Encoding utf8
Ok "networkingMode=NAT gravado."

# ================================================================ 4 distro
Say "4/5 Ubuntu ($Distro)"
$installed = (wsl.exe -l -q) -replace "`0", "" | ForEach-Object { $_.Trim() } | Where-Object { $_ }
if ($installed -notcontains $Distro) {
    Warn "Instalando $Distro (sem provisionamento interativo)..."
    # --no-launch avoids the window asking for user/password: the user is created right below.
    wsl.exe --install -d $Distro --no-launch
    if ($LASTEXITCODE -ne 0) { Die "Falha ao instalar $Distro." }
    Ok "$Distro registrada."
} else {
    Ok "$Distro ja instalada."
}

$exists = (wsl.exe -d $Distro -u root -- bash -lc "id -u '$LinuxUser' >/dev/null 2>&1 && echo YES || echo NO") -replace "`0", "" -replace "\s", ""
if ($exists -ne "YES") {
    wsl.exe -d $Distro -u root -- bash -lc "useradd -m -s /bin/bash -G sudo '$LinuxUser'"
    if ($LASTEXITCODE -ne 0) { Die "Falha ao criar o usuario '$LinuxUser'." }
    if ($linuxPassword) { Ok "Usuario '$LinuxUser' criado." }
    else { Warn "Usuario '$LinuxUser' criado SEM senha (informe a senha do Linux na instalacao)." }
} else {
    Ok "Usuario '$LinuxUser' ja existe."
}
if ($linuxPassword) {
    # Through stdin: the password never appears on a command line.
    "$LinuxUser`:$linuxPassword" | wsl.exe -d $Distro -u root -- bash -c "sed '1s/^\xef\xbb\xbf//' | chpasswd"
    if ($LASTEXITCODE -ne 0) { Die "Falha ao definir a senha do Linux." }
    Ok "Senha do Linux definida."
}
$linuxPassword = $null

wsl.exe --shutdown; Start-Sleep -Seconds 6
Ok "WSL reiniciado (aplicando o .wslconfig)."

# ================================================================ 5 Ubuntu
Say "5/5 Configurando o Ubuntu"
& (Join-Path $Here "setup.ps1") -Distro $Distro -LinuxUser $LinuxUser
if ($LASTEXITCODE -ne 0) { Die "O setup do Ubuntu falhou." }

$windowsDefault = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1
Ok "Rota default do Windows preservada: $($windowsDefault.NextHop) via $($windowsDefault.InterfaceAlias)"
Say "INSTALACAO CONCLUIDA"
