<#
.SYNOPSIS
  Installer for the Fortinet SSL-VPN isolated in WSL2 + RDP through WSLg.
.DESCRIPTION
  Checks what already exists and only does what is missing - run it as many times as needed.
  Prepares Windows (WSL2 in NAT mode), installs Ubuntu, creates the user, detects the gateway
  certificate and calls setup.ps1. Run by the app (unelevated); installing the WSL platform
  itself needs administrator rights and is a separate action in the app.

  Exit codes: 0 ok, 1 failure, 2 WSL not installed.
.PARAMETER Config
  Path to the app's config.env (no passwords).
.PARAMETER SecretsFromStdin
  Reads one line from stdin: base64 of a UTF-8 JSON object with linuxPassword, vpnPassword and
  rdpPassword. Base64 keeps non-ASCII passwords intact whatever the console code page is.
.PARAMETER UpdateCert
  Accepts a changed gateway certificate (otherwise the stored fingerprint is kept).
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Config,
    [switch]$SecretsFromStdin,
    [switch]$UpdateCert
)

$ErrorActionPreference = "Stop"
# No BOM when piping text to wsl.exe: Linux would receive the password with invisible garbage.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say  ($m) { Write-Host "==> $m" }
function Ok   ($m) { Write-Host "    [OK] $m" }
function Warn ($m) { Write-Host "    [!] $m" }
function Die  ($m, $code = 1) { Write-Host "    [X] $m"; exit $code }

function Read-Env ($path) {
    $values = @{}
    if (-not (Test-Path $path)) { return $values }
    Get-Content $path | ForEach-Object {
        if ($_ -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') {
            $v = $Matches[2].Trim()
            if ($v.Length -ge 2 -and $v[0] -eq $v[-1] -and ($v[0] -eq '"' -or $v[0] -eq "'")) {
                $v = $v.Substring(1, $v.Length - 2)
            }
            $values[$Matches[1]] = $v
        }
    }
    return $values
}

function Set-EnvField ($path, $name, $value) {
    $found = $false
    $lines = @(Get-Content $path | ForEach-Object {
        if ($_ -match "^\s*$name\s*=") { $found = $true; "$name=`"$value`"" } else { $_ }
    })
    if (-not $found) { $lines += "$name=`"$value`"" }
    [IO.File]::WriteAllText($path, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding $false))
}

$secrets = @{ LINUX_PASSWORD = ""; VPN_PASSWORD = ""; RDP_PASSWORD = "" }
if ($SecretsFromStdin) {
    $line = [Console]::In.ReadLine()
    if ($line) {
        $json = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($line.Trim())) | ConvertFrom-Json
        $secrets.LINUX_PASSWORD = [string]$json.linuxPassword
        $secrets.VPN_PASSWORD = [string]$json.vpnPassword
        $secrets.RDP_PASSWORD = [string]$json.rdpPassword
    }
}

# ================================================================ 1 config
Say "1/7 Configuracao"
if (-not (Test-Path $Config)) { Die "Configuracao nao encontrada: salve-a em Configuracoes." }
$cfg = Read-Env $Config
$Distro = if ($cfg.WSL_DISTRO) { $cfg.WSL_DISTRO } else { "Ubuntu-24.04" }

$missing = @()
foreach ($key in @("VPN_HOST", "VPN_PORT", "VPN_USER", "LINUX_USER")) {
    if (-not $cfg[$key]) { $missing += $key }
}
if ($missing.Count) { Die "Preencha em Configuracoes: $($missing -join ', ')" }
Ok "Gateway: $($cfg.VPN_HOST):$($cfg.VPN_PORT)   Usuario VPN: $($cfg.VPN_USER)"
if (-not $cfg.RDP_HOST) { Warn "Host do RDP vazio: preencha em Configuracoes para usar o RDP." }

# ================================================================ 2 virtualization
Say "2/7 Virtualizacao"
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

# ================================================================ 3 WSL
Say "3/7 WSL"
$wslOk = $false
try { wsl.exe --version *> $null; $wslOk = ($LASTEXITCODE -eq 0) } catch { $wslOk = $false }
if (-not $wslOk) {
    Die "WSL nao instalado: use 'Instalar o WSL' (pede administrador) e reinicie o Windows." 2
}
Ok "WSL presente."

# ================================================================ 4 isolation
Say "4/7 Isolamento de rede (.wslconfig)"
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

# ================================================================ 5 distro
Say "5/7 Ubuntu ($Distro)"
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

$linuxUser = $cfg.LINUX_USER
$exists = (wsl.exe -d $Distro -u root -- bash -lc "id -u '$linuxUser' >/dev/null 2>&1 && echo YES || echo NO") -replace "`0", "" -replace "\s", ""
if ($exists -ne "YES") {
    wsl.exe -d $Distro -u root -- bash -lc "useradd -m -s /bin/bash -G sudo '$linuxUser'"
    if ($LASTEXITCODE -ne 0) { Die "Falha ao criar o usuario '$linuxUser'." }
    if ($secrets.LINUX_PASSWORD) {
        Ok "Usuario '$linuxUser' criado."
    } else {
        Warn "Usuario '$linuxUser' criado SEM senha (informe a senha do Linux na instalacao)."
    }
} else {
    Ok "Usuario '$linuxUser' ja existe."
}
if ($secrets.LINUX_PASSWORD) {
    # Through stdin: the password never appears on a command line.
    "$linuxUser`:$($secrets.LINUX_PASSWORD)" | wsl.exe -d $Distro -u root -- bash -c "sed '1s/^\xef\xbb\xbf//' | chpasswd"
    if ($LASTEXITCODE -ne 0) { Die "Falha ao definir a senha do Linux." }
    Ok "Senha do Linux definida."
}

wsl.exe --shutdown; Start-Sleep -Seconds 6
Ok "WSL reiniciado (aplicando o .wslconfig)."

# ================================================================ 6 certificate
Say "6/7 Certificado do gateway"
# Leftovers of a previous VPN session keep the corporate DNS in resolv.conf; without the tunnel
# they don't answer and the gateway lookup would hang until timeout.
$dnsOk = (wsl.exe -d $Distro -- bash -lc "getent hosts $($cfg.VPN_HOST) >/dev/null 2>&1 && echo OK || echo FAIL") -replace "`0", "" -replace "\s", ""
if ($dnsOk -ne "OK") {
    Warn "DNS sem resposta; restaurando o estado de fora da VPN..."
    wsl.exe -d $Distro -u root -- bash -lc "printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf; cp -f /etc/resolv.conf /etc/resolv.conf.base"
}
$fingerprint = (wsl.exe -d $Distro -- bash -lc @"
command -v openssl >/dev/null 2>&1 || exit 0
echo | timeout 15 openssl s_client -connect $($cfg.VPN_HOST):$($cfg.VPN_PORT) -servername $($cfg.VPN_HOST) 2>/dev/null |
  openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//; s/://g' | tr 'A-Z' 'a-z'
"@) -replace "`0", "" -replace "\s", ""

if ($fingerprint -and $fingerprint.Length -eq 64) {
    if (-not $cfg.VPN_TRUSTED_CERT) {
        Set-EnvField $Config "VPN_TRUSTED_CERT" $fingerprint
        Ok "Fingerprint detectado e gravado: $($fingerprint.Substring(0, 16))..."
    } elseif ($cfg.VPN_TRUSTED_CERT -ne $fingerprint) {
        Warn "O certificado do gateway MUDOU."
        Warn "  configurado: $($cfg.VPN_TRUSTED_CERT.Substring(0, 16))..."
        Warn "  servidor   : $($fingerprint.Substring(0, 16))..."
        if ($UpdateCert) {
            Set-EnvField $Config "VPN_TRUSTED_CERT" $fingerprint
            Ok "Atualizado."
        } else {
            Warn "Mantido; a conexao vai falhar. Rode de novo marcando 'Atualizar o certificado do gateway'."
        }
    } else {
        Ok "Confere com o servidor."
    }
} elseif ($cfg.VPN_TRUSTED_CERT) {
    Warn "Gateway inacessivel agora; usando o fingerprint configurado."
} else {
    Warn "Nao foi possivel obter o fingerprint. Preencha-o em Configuracoes."
}

# ================================================================ 7 Ubuntu
Say "7/7 Configurando o Ubuntu"
& (Join-Path $Here "setup.ps1") -Distro $Distro -Config $Config -Secrets $secrets
if ($LASTEXITCODE -ne 0) { Die "O setup do Ubuntu falhou." }
$secrets = $null

$windowsDefault = Get-NetRoute -DestinationPrefix '0.0.0.0/0' | Select-Object -First 1
Ok "Rota default do Windows preservada: $($windowsDefault.NextHop) via $($windowsDefault.InterfaceAlias)"
Say "INSTALACAO CONCLUIDA"
