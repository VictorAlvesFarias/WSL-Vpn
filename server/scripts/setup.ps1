<#
.SYNOPSIS
  Configures Ubuntu inside WSL2: packages, DNS, VPN, vault and commands.
.DESCRIPTION
  Called by install.ps1 (full setup) and by the app with -OnlyConfig (applies a configuration
  change without touching packages). The Linux scripts are embedded here, so the project needs
  no separate folder for them. Idempotent: run it as many times as needed.
.PARAMETER Distro
  WSL distro name.
.PARAMETER Config
  Path to the app's config.env (no passwords).
.PARAMETER Secrets
  Hashtable with VPN_PASSWORD / RDP_PASSWORD to store in the vault. Empty values are skipped,
  so the vault keeps what it already has.
.PARAMETER OnlyConfig
  Skips the kernel check, packages and DNS steps.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Distro,
    [Parameter(Mandatory)][string]$Config,
    [hashtable]$Secrets = @{},
    [switch]$OnlyConfig
)

$ErrorActionPreference = "Stop"
# No BOM when piping secrets to wsl.exe: Linux would receive invisible garbage before them.
$OutputEncoding = New-Object System.Text.UTF8Encoding $false

function Say  ($m) { Write-Host "==> $m" }
function Ok   ($m) { Write-Host "    [OK] $m" }
function Warn ($m) { Write-Host "    [!] $m" }
function Die  ($m) { Write-Host "    [X] $m"; exit 1 }

function Read-Env ($path) {
    $values = @{}
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

# Written with LF line endings: bash doesn't accept CRLF.
function Write-Lf ($path, $text) {
    [IO.File]::WriteAllText($path, ($text -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding $false))
}

function Invoke-Wsl ([string]$cmd, [switch]$AsRoot) {
    if ($AsRoot) { wsl.exe -d $Distro -u root -- bash -lc $cmd }
    else         { wsl.exe -d $Distro -- bash -lc $cmd }
}

function Test-WslOutput ([string]$cmd, [switch]$AsRoot) {
    ((Invoke-Wsl $cmd -AsRoot:$AsRoot) -replace "`0", "" -replace "\s", "")
}

$cfg = Read-Env $Config
$LinuxUser = $cfg.LINUX_USER

# =====================================================================
#  LINUX SCRIPTS (embedded)
# =====================================================================

# --------------------------------------------------------- root helper
$helper = @'
#!/usr/bin/env bash
# Privileged helper: the only entry point with root access to the secrets and the network.
# The sudoers rule allows ONLY this binary - granting generic 'sudo tee/rm/ip' to the user
# would amount to unrestricted root.
#
# Usage:
#   vpn-helper version          helper version (the app checks it)
#   vpn-helper get NAME         prints a secret from the vault
#   vpn-helper set-secret NAME  reads VPN_PASSWORD or RDP_PASSWORD from stdin (empty = remove)
#   vpn-helper set-totp         reads the authenticator key from stdin (empty = remove)
#   vpn-helper net-save         saves default route + DNS from outside the VPN
#   vpn-helper net-restore      restores default route + DNS after disconnecting
#   vpn-helper gw-on            routes traffic coming from Windows into the VPN
#   vpn-helper gw-off           undoes gw-on
#   vpn-helper gw-status        prints on/off
set -u
SECRETS=/etc/vpnwsl.secrets
DEFROUTE=/etc/vpnwsl.defroute
RESOLVBASE=/etc/resolv.conf.base

[ "$(id -u)" -eq 0 ] || { echo "vpn-helper: precisa rodar como root (use sudo)."; exit 1; }

derive_gw() {
  local net
  net=$(ip -4 route show dev eth0 proto kernel 2>/dev/null | awk '{print $1}' | head -1)
  [ -n "$net" ] || return 1
  echo "${net%.*}.1" | sed 's|/.*||'
}

# Writes the vault from stdin, atomically and already 600 root:root.
write_secrets() {
  local tmp
  umask 077
  tmp=$(mktemp /etc/.vpnwsl.XXXXXX)
  { echo "# Gerado pelo WSL-Vpn. Permissao 600 root:root."; cat; } > "$tmp"
  chown root:root "$tmp"; chmod 600 "$tmp"; mv -f "$tmp" "$SECRETS"
}

# Vault entries except NAME, so one secret can change without touching the others.
others() {
  grep -E '^(VPN_PASSWORD|RDP_PASSWORD|TOTP_SECRET)=' "$SECRETS" 2>/dev/null | grep -v "^$1=" || true
}

# Gateway: rules live in their own chains (VPNGW), so turning off is just removing the jumps
# and deleting the chains, without touching anything else.
gw_clear() {
  command -v iptables >/dev/null 2>&1 || return 0
  local t c
  for t in nat filter mangle; do
    case "$t" in nat) c=POSTROUTING ;; *) c=FORWARD ;; esac
    while iptables -t "$t" -D "$c" -j VPNGW 2>/dev/null; do :; done
    iptables -t "$t" -F VPNGW 2>/dev/null
    iptables -t "$t" -X VPNGW 2>/dev/null
  done
  return 0
}

# Corporate DNS = the private-range servers openfortivpn wrote.
corp_dns() {
  awk '/^nameserver/ {print $2}' /etc/resolv.conf 2>/dev/null |
    grep -E '^(10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)' | paste -sd, -
}

case "${1:-}" in
  version)
    echo 2
    ;;
  get)
    [ -f "$SECRETS" ] || exit 1
    grep -m1 "^${2:-}=" "$SECRETS" 2>/dev/null | cut -d= -f2-
    ;;
  set-secret)
    NAME="${2:-}"
    case "$NAME" in
      VPN_PASSWORD|RDP_PASSWORD) ;;
      *) echo "ERRO: segredo desconhecido: $NAME"; exit 2 ;;
    esac
    IFS= read -r V || V=""
    # Drop a UTF-8 BOM at the start and a CR at the end (senders using CRLF).
    V=$(printf '%s' "$V" | sed '1s/^\xef\xbb\xbf//')
    V="${V%$'\r'}"
    {
      others "$NAME"
      [ -n "$V" ] && printf '%s=%s\n' "$NAME" "$V"
    } | write_secrets
    if [ -n "$V" ]; then echo "$NAME salva no cofre"; else echo "$NAME removida do cofre"; fi
    unset V
    ;;
  set-totp)
    # Authenticator key (TOTP), base32, from stdin. Empty = remove.
    IFS= read -r S || S=""
    # Strip BOM and any whitespace - including the \r of senders using CRLF.
    S=$(printf '%s' "$S" | sed '1s/^\xef\xbb\xbf//' | tr -d '[:space:]=-' | tr 'a-z' 'A-Z')
    if [ -n "$S" ] && ! printf '%s' "$S" | grep -qE '^[A-Z2-7]{16,}$'; then
      echo "ERRO: chave invalida (esperado base32: letras A-Z e digitos 2-7)."
      exit 1
    fi
    {
      others TOTP_SECRET
      [ -n "$S" ] && echo "TOTP_SECRET=$S"
    } | write_secrets
    if [ -n "$S" ]; then echo "autenticador salvo"; else echo "autenticador removido"; fi
    unset S
    ;;
  net-save)
    ip link show ppp0 >/dev/null 2>&1 && exit 0   # VPN up: don't overwrite
    ip -4 route show default > "$DEFROUTE" 2>/dev/null || true
    [ -s "$DEFROUTE" ] || rm -f "$DEFROUTE"
    cp -f /etc/resolv.conf "$RESOLVBASE" 2>/dev/null || true
    ;;
  net-restore)
    # On exit openfortivpn leaves the corporate DNS in resolv.conf and does NOT put back the
    # original default route. Without this WSL2 has no internet and no DNS - not even the VPN
    # gateway resolves, which prevents reconnecting.
    [ -f "$RESOLVBASE" ] || printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > "$RESOLVBASE"
    cp -f "$RESOLVBASE" /etc/resolv.conf
    chmod 644 /etc/resolv.conf
    if ! ip -4 route show default 2>/dev/null | grep -q .; then
      if [ -s "$DEFROUTE" ] && ip route add $(cat "$DEFROUTE") 2>/dev/null; then
        :
      else
        GW=$(derive_gw || true)
        [ -n "$GW" ] && ip route add default via "$GW" dev eth0 2>/dev/null || true
      fi
    fi
    echo "rede restaurada"
    ;;
  gw-on)
    ip link show ppp0 >/dev/null 2>&1 || { echo "ERRO: a VPN nao esta conectada."; exit 1; }
    command -v iptables >/dev/null 2>&1 || {
      echo "ERRO: iptables ausente. Rode a Instalacao no app com a VPN desconectada."; exit 1; }
    NET=$(ip -4 route show dev eth0 proto kernel scope link | awk '{print $1; exit}')
    [ -n "$NET" ] || { echo "ERRO: rede da eth0 nao encontrada."; exit 1; }
    # PPP has a smaller MTU than the Windows network (1500). Without clamping the MSS, TCP
    # connections open but stall on the first large transfer.
    MSS=$(( $(cat /sys/class/net/ppp0/mtu) - 40 ))
    gw_clear
    iptables -t nat -N VPNGW
    iptables -t nat -A VPNGW -s "$NET" -o ppp0 -j MASQUERADE
    iptables -t nat -A POSTROUTING -j VPNGW
    iptables -N VPNGW
    iptables -A VPNGW -i eth0 -o ppp0 -s "$NET" -j ACCEPT
    iptables -A VPNGW -i ppp0 -o eth0 -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
    iptables -A FORWARD -j VPNGW
    iptables -t mangle -N VPNGW
    iptables -t mangle -A VPNGW -p tcp --tcp-flags SYN,RST SYN \
      -m tcpmss --mss "$((MSS + 1)):65535" -j TCPMSS --set-mss "$MSS"
    iptables -t mangle -A FORWARD -j VPNGW
    sysctl -qw net.ipv4.ip_forward=1
    # Read by the app: the IP for the Windows routes and the DNS servers for NRPT.
    echo "WSL_IP=$(ip -4 -br addr show eth0 | awk '{print $3}' | cut -d/ -f1)"
    echo "DNS=$(corp_dns)"
    ;;
  gw-off)
    gw_clear
    sysctl -qw net.ipv4.ip_forward=0
    echo "gateway desligado"
    ;;
  gw-status)
    if command -v iptables >/dev/null 2>&1 && iptables -t nat -C POSTROUTING -j VPNGW 2>/dev/null; then
      echo on
    else
      echo off
    fi
    ;;
  *)
    echo "uso: vpn-helper {version|get NOME|set-secret NOME|set-totp|net-save|net-restore|gw-on|gw-off|gw-status}" >&2
    exit 2
    ;;
esac
'@

# --------------------------------------------------------------- vpn-up
$vpnUp = @'
#!/usr/bin/env bash
# Connects the Fortinet SSL-VPN.
# The password comes from the vault (/etc/vpnwsl.secrets) and goes through stdin - never on the
# command line, so it doesn't show up in 'ps'. The OTP arrives through stdin (app) or the
# prompt, and is never stored: it changes on every connection.
set -o pipefail
CFG=/etc/openfortivpn/config
LOG="${XDG_RUNTIME_DIR:-/tmp}/vpnwsl.log"
[ -f /etc/vpnwsl.env ] && . /etc/vpnwsl.env

if pgrep -x openfortivpn >/dev/null; then
  echo "VPN ja conectada."
  exit 0
fi

# Sanity: if the previous session dropped without restoring, the corporate DNS remains and the
# default route is missing - not even the VPN gateway would resolve.
NEEDS_FIX=0
ip -4 route show default 2>/dev/null | grep -q . || NEEDS_FIX=1
getent hosts "${VPN_HOST}" >/dev/null 2>&1 || NEEDS_FIX=1
if [ "$NEEDS_FIX" -eq 1 ]; then
  echo "Restaurando a rede antes de conectar..."
  sudo -n vpn-helper net-restore >/dev/null 2>&1 || true
fi
sudo -n vpn-helper net-save >/dev/null 2>&1 || true

PASS=$(sudo -n vpn-helper get VPN_PASSWORD 2>/dev/null || true)
if [ -z "$PASS" ]; then
  if [ -t 0 ]; then
    read -r -s -p "Senha da VPN (${VPN_USER}): " PASS; echo
  else
    echo "ERRO: sem senha da VPN. Salve-a no app em Configuracoes > Senhas no cofre."
    exit 1
  fi
fi
[ -n "$PASS" ] || { echo "ERRO: sem senha da VPN."; exit 1; }

OTP_ARGS=()
if [ "${VPN_OTP_REQUIRED:-0}" = "1" ]; then
  if [ -t 0 ]; then
    read -r -p "Codigo OTP: " OTP
  else
    read -r OTP
  fi
  # The code may arrive with a BOM, CR or spaces through stdin.
  # Any invisible character makes the gateway reject the token.
  OTP=$(printf '%s' "${OTP:-}" | tr -cd '0-9')
  [ -n "$OTP" ] || { echo "ERRO: esta VPN exige codigo OTP."; exit 1; }
  OTP_ARGS=(--otp="$OTP" --otp-delay="${VPN_OTP_DELAY:-2}")
fi

printf '%s\n' "$PASS" | sudo openfortivpn -c "$CFG" "${OTP_ARGS[@]}" >"$LOG" 2>&1 &
unset PASS OTP

echo "Conectando a ${VPN_HOST}:${VPN_PORT}..."
for _ in $(seq 1 40); do
  sleep 1
  if ip link show ppp0 >/dev/null 2>&1; then
    echo "CONECTADA"
    ip -br addr show ppp0
    exit 0
  fi
  if ! pgrep -x openfortivpn >/dev/null; then
    echo "FALHA NA CONEXAO."
    # Order matters: Fortinet emits "check the password, client certificate, etc." on ANY
    # failure - it doesn't point at a certificate problem.
    if   grep -qi 'no otp specified\|one-time password\|otp is required' "$LOG"; then
      echo "CAUSA: codigo OTP ausente, incorreto ou expirado (eles duram ~30s)."
    elif grep -qi 'gateway certificate validation failed\|certificate digest\|untrusted certificate' "$LOG"; then
      echo "CAUSA: o certificado do gateway mudou. Rode a Instalacao no app marcando"
      echo "       'Atualizar o certificado do gateway'."
    elif grep -qi 'authentication failed\|wrong credentials' "$LOG"; then
      echo "CAUSA: usuario ou senha incorretos (confira em Configuracoes)."
    elif grep -qi 'could not authenticate to gateway' "$LOG"; then
      echo "CAUSA: o gateway recusou o login (senha ou codigo OTP)."
    elif grep -qi 'operation not permitted\|/dev/ppp' "$LOG"; then
      echo "CAUSA: problema no PPP. Rode 'wsl --update' no Windows."
    elif grep -qi 'could not connect\|connection refused\|timed out\|name resolution' "$LOG"; then
      echo "CAUSA: nao foi possivel alcancar ${VPN_HOST}:${VPN_PORT}."
    else
      echo "CAUSA: nao identificada."
    fi
    tail -12 "$LOG"
    exit 1
  fi
done
echo "TIMEOUT aguardando a interface ppp0."
tail -12 "$LOG"
exit 1
'@

# ------------------------------------------------------------- vpn-down
$vpnDown = @'
#!/usr/bin/env bash
# Disconnects the VPN and restores the network outside the tunnel (default route + DNS).
if ! pgrep -x openfortivpn >/dev/null; then
  echo "VPN nao esta conectada."
  sudo -n vpn-helper net-restore >/dev/null 2>&1 || true
  exit 0
fi
# Without a tunnel there is nowhere to forward to: turn off the Linux side of the gateway.
sudo -n vpn-helper gw-off >/dev/null 2>&1 || true
sudo pkill -SIGINT -x openfortivpn
for _ in $(seq 1 15); do
  sleep 1
  if ! pgrep -x openfortivpn >/dev/null; then
    sudo -n vpn-helper net-restore >/dev/null 2>&1 || true
    echo "Desconectada. Rede normal restaurada."
    exit 0
  fi
done
echo "AVISO: o processo ainda esta ativo."
exit 1
'@

# ---------------------------------------------------------- rdp-connect
$rdp = @'
#!/usr/bin/env bash
# Opens the RDP session through WSLg. The window shows up on Windows like any other.
[ -f /etc/vpnwsl.env ] && . /etc/vpnwsl.env

HOST="${1:-${RDP_HOST:-}}"
USER_RDP="${2:-${RDP_USER:-}}"
RES="${RDP_RESOLUTION:-1600x900}"

# Checking DISPLAY/WAYLAND_DISPLAY proves nothing: WSL fills both even with WSLg down. The real
# test is opening the X server socket. It matters because the WSLg graphics host (msrdc.exe)
# crashes and is relaunched by WSLGd on sleep/resume, display changes or fights with fullscreen
# games - and whatever is launched in between runs with no window at all.
wslg_ready() {
  [ -S /tmp/.X11-unix/X0 ] || return 1
  python3 -c 'import socket, sys
try:
    s = socket.socket(socket.AF_UNIX); s.settimeout(2)
    s.connect("/tmp/.X11-unix/X0"); s.close()
except Exception: sys.exit(1)' 2>/dev/null
}

waited=0
while ! wslg_ready; do
  waited=$((waited + 1))
  [ "$waited" = 1 ] && echo "Aguardando o WSLg ficar pronto..."
  if [ "$waited" -ge 20 ]; then
    echo "ERRO: o servidor grafico do WSLg nao respondeu em 20s."
    echo "      O host grafico (msrdc.exe) provavelmente caiu."
    echo "      Feche o app e rode no PowerShell:  wsl --shutdown"
    echo "      Depois abra o app de novo."
    exit 1
  fi
  sleep 1
done
if ! ip link show ppp0 >/dev/null 2>&1; then
  echo "ERRO: a VPN nao esta conectada."
  exit 1
fi
if [ -z "$HOST" ] || [ -z "$USER_RDP" ]; then
  echo "ERRO: preencha o host e o usuario do RDP em Configuracoes."
  exit 1
fi

if timeout 6 bash -c "cat < /dev/null > /dev/tcp/$HOST/3389" 2>/dev/null; then
  echo "Host acessivel na porta 3389."
else
  echo "AVISO: a porta 3389 de $HOST nao respondeu; tentando mesmo assim."
fi

if [ "$RES" = "fullscreen" ]; then GEOM="/f"; else GEOM="/size:${RES}"; fi
DOM_OPT=""
[ -n "${RDP_DOMAIN:-}" ] && DOM_OPT="/d:${RDP_DOMAIN}"

echo "Abrindo RDP: ${USER_RDP}@${HOST} (${RES})"
[ "$RES" = "fullscreen" ] && echo "  Barra de controle: encoste o mouse no topo. Ctrl+Alt+Enter alterna."

# /from-stdin keeps the password off the command line (visible in 'ps aux').
RPASS=$(sudo -n vpn-helper get RDP_PASSWORD 2>/dev/null || true)
OPTS="${RDP_EXTRA_OPTS:-/clipboard /dynamic-resolution /floatbar:sticky:off,default:visible,show:always}"

if [ -n "$RPASS" ]; then
  # shellcheck disable=SC2086
  printf '%s\n' "$RPASS" | xfreerdp3 /v:"$HOST" /u:"$USER_RDP" $DOM_OPT $GEOM \
    /from-stdin /cert:ignore $OPTS
else
  # shellcheck disable=SC2086
  exec xfreerdp3 /v:"$HOST" /u:"$USER_RDP" $DOM_OPT $GEOM /cert:ignore $OPTS
fi
'@

# =====================================================================
#  SETUP
# =====================================================================

$tmp = Join-Path $env:TEMP "wsl-vpn-setup"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
# wsl.exe eats the backslashes in arguments: pass the path with "/".
$tmpForward = $tmp.Replace([char]92, [char]47)
$tmpLinux = ((wsl.exe -d $Distro -- wslpath -a "$tmpForward") -replace "`0", "" | Select-Object -First 1)
if (-not $tmpLinux -or -not $tmpLinux.Trim()) { Die "Nao foi possivel converter o caminho temporario para o Linux." }
$tmpLinux = $tmpLinux.Trim()

if (-not $OnlyConfig) {
    Say "Ubuntu 1/5 Requisitos do kernel (PPP)"
    if ((Test-WslOutput "[ -e /dev/ppp ] && grep -q ppp /proc/devices && echo OK || echo FALTA") -ne "OK") {
        Die "O kernel do WSL2 nao tem suporte a PPP. Rode 'wsl --update'."
    }
    Ok "/dev/ppp presente."

    Say "Ubuntu 2/5 Pacotes (openfortivpn, FreeRDP)"
    # If a previous VPN session dropped without restoring, resolv.conf still points at the
    # corporate DNS - which only answers inside the tunnel. apt would hang on timeouts, so fix
    # it before any download.
    if ((Test-WslOutput "getent hosts archive.ubuntu.com >/dev/null 2>&1 && echo OK || echo FALHA") -ne "OK") {
        Warn "DNS sem resposta (residuo de uma sessao VPN?). Restaurando..."
        Invoke-Wsl "printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf; cp -f /etc/resolv.conf /etc/resolv.conf.base" -AsRoot
        if ((Test-WslOutput "getent hosts archive.ubuntu.com >/dev/null 2>&1 && echo OK || echo FALHA") -ne "OK") {
            Die "Sem DNS no WSL2. Verifique a conexao de internet."
        }
        Ok "DNS restaurado."
    }
    Invoke-Wsl "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq openfortivpn ppp iproute2 dnsutils iputils-ping openssl freerdp3-x11 ca-certificates iptables python3 >/dev/null" -AsRoot
    if ($LASTEXITCODE -ne 0) { Die "Falha ao instalar os pacotes." }
    $versions = (Invoke-Wsl "echo `$(openfortivpn --version) / `$(xfreerdp3 --version | head -1 | awk '{print `$5}')") -replace "`0", ""
    Ok "Instalados: $($versions.Trim())"

    Say "Ubuntu 3/5 DNS e rede"
    # systemd-resolved hijacks /etc/resolv.conf: openfortivpn couldn't write the corporate DNS
    # (it would try through D-Bus and fail).
    $wslConf = @"
[boot]
systemd=true

[user]
default=$LinuxUser

[network]
generateResolvConf = false
"@
    Write-Lf (Join-Path $tmp "wsl.conf") $wslConf
    Invoke-Wsl @"
set -e
systemctl disable --now systemd-resolved >/dev/null 2>&1 || true
cp '$tmpLinux/wsl.conf' /etc/wsl.conf
if [ -L /etc/resolv.conf ] || [ ! -s /etc/resolv.conf ] || grep -q '127.0.0.53' /etc/resolv.conf 2>/dev/null; then
  rm -f /etc/resolv.conf
  printf 'nameserver 1.1.1.1\nnameserver 8.8.8.8\n' > /etc/resolv.conf
fi
chattr -i /etc/resolv.conf 2>/dev/null || true
cp -f /etc/resolv.conf /etc/resolv.conf.base
"@ -AsRoot
    if ($LASTEXITCODE -ne 0) { Die "Falha ao configurar o DNS." }
    Ok "resolv.conf gravavel; systemd-resolved desativado."
}

Say "Ubuntu 4/5 Configuracao da VPN"
$vpnConfig = @"
host = $($cfg.VPN_HOST)
port = $($cfg.VPN_PORT)
username = $($cfg.VPN_USER)
trusted-cert = $($cfg.VPN_TRUSTED_CERT)
set-routes = 1
set-dns = 1
# use-resolvconf=0: on Ubuntu 24.04 resolvconf delegates to systemd-resolved, which is disabled.
# With 0 openfortivpn writes /etc/resolv.conf directly.
use-resolvconf = 0
pppd-use-peerdns = 1
# NO password: it lives in the vault /etc/vpnwsl.secrets (600 root:root).
"@
Write-Lf (Join-Path $tmp "openfortivpn.conf") $vpnConfig

# /etc/vpnwsl.env is world-readable: it can never contain passwords.
$envLines = Get-Content $Config | Where-Object { $_ -notmatch '^\s*[A-Z0-9_]*_PASSWORD\s*=' }
Write-Lf (Join-Path $tmp "vpnwsl.env") ($envLines -join "`n")

$sudoers = "$LinuxUser ALL=(root) NOPASSWD: /usr/bin/openfortivpn`n" +
           "$LinuxUser ALL=(root) NOPASSWD: /usr/bin/pkill -SIGINT -x openfortivpn`n" +
           "$LinuxUser ALL=(root) NOPASSWD: /usr/local/sbin/vpn-helper`n"
Write-Lf (Join-Path $tmp "sudoers") $sudoers

Invoke-Wsl @"
set -e
mkdir -p /etc/openfortivpn
cp '$tmpLinux/openfortivpn.conf' /etc/openfortivpn/config
chown root:root /etc/openfortivpn/config
chmod 600 /etc/openfortivpn/config
grep -qi '^password' /etc/openfortivpn/config && { echo 'ERRO: senha no config da VPN'; exit 1; }

cp '$tmpLinux/vpnwsl.env' /etc/vpnwsl.env
chmod 644 /etc/vpnwsl.env
if grep -qE '^[[:space:]]*[A-Z0-9_]*_PASSWORD[[:space:]]*=[[:space:]]*[^[:space:]]' /etc/vpnwsl.env; then
  echo 'ERRO: senha vazou para /etc/vpnwsl.env'; exit 1
fi

cp '$tmpLinux/sudoers' /etc/sudoers.d/vpnwsl
chmod 440 /etc/sudoers.d/vpnwsl
visudo -c -f /etc/sudoers.d/vpnwsl >/dev/null
"@ -AsRoot
if ($LASTEXITCODE -ne 0) { Die "Falha ao gravar a configuracao da VPN." }
Ok "Config da VPN 600 root:root, sem senha; sudoers restrito validado."

Say "Ubuntu 5/5 Comandos do Linux"
Write-Lf (Join-Path $tmp "vpn-helper")  $helper
Write-Lf (Join-Path $tmp "vpn-up")      $vpnUp
Write-Lf (Join-Path $tmp "vpn-down")    $vpnDown
Write-Lf (Join-Path $tmp "rdp-connect") $rdp

Invoke-Wsl @"
set -e
install -m 0755 -o root -g root '$tmpLinux/vpn-helper' /usr/local/sbin/vpn-helper
ln -sf /usr/local/sbin/vpn-helper /usr/local/bin/vpn-helper
install -m 0755 '$tmpLinux/vpn-up'      /usr/local/bin/vpn-up
install -m 0755 '$tmpLinux/vpn-down'    /usr/local/bin/vpn-down
install -m 0755 '$tmpLinux/rdp-connect' /usr/local/bin/rdp-connect
"@ -AsRoot
if ($LASTEXITCODE -ne 0) { Die "Falha ao instalar os comandos." }
Ok "vpn-up, vpn-down, rdp-connect, vpn-helper instalados."

# Secrets go straight into the vault through stdin; empty ones keep what is there.
foreach ($name in @("VPN_PASSWORD", "RDP_PASSWORD")) {
    if ($Secrets[$name]) {
        $Secrets[$name] | wsl.exe -d $Distro -u root -- /usr/local/sbin/vpn-helper set-secret $name | Out-Null
        if ($LASTEXITCODE -ne 0) { Die "Falha ao gravar $name no cofre." }
        Ok "$name gravada em /etc/vpnwsl.secrets (600 root:root)."
    }
}

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Ok "Ubuntu configurado."
