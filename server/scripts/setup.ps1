<#
.SYNOPSIS
  Configures Ubuntu inside WSL2: packages, DNS, VPN base config, sudoers and commands.
.DESCRIPTION
  Called by install.ps1 (full setup) and by the app with -SkipPackages (updates the commands
  without touching packages or DNS). The Linux scripts are embedded here, so the project needs
  no separate folder for them. Idempotent: run it as many times as needed.

  Connections live in the app; the Linux commands receive their parameters as arguments and
  keep only the secrets, in the vault, keyed by connection id.
.PARAMETER Distro
  WSL distro name.
.PARAMETER LinuxUser
  Default Linux user (gets the restricted sudoers rule).
.PARAMETER SkipPackages
  Skips the kernel check, packages and DNS steps.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Distro,
    [Parameter(Mandatory)][string]$LinuxUser,
    [switch]$SkipPackages
)

$ErrorActionPreference = "Stop"

function Say  ($m) { Write-Host "==> $m" }
function Ok   ($m) { Write-Host "    [OK] $m" }
function Warn ($m) { Write-Host "    [!] $m" }
function Die  ($m) { Write-Host "    [X] $m"; exit 1 }

if ($LinuxUser -notmatch '^[a-z_][a-z0-9_-]{0,31}$') { Die "Usuario do Linux invalido: '$LinuxUser'" }

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
# Secrets are named KIND_ID, KIND in VPN_PASSWORD or TOTP_SECRET, ID being the app's id for
# the VPN connection.
#
# Usage:
#   vpn-helper version                helper version (the app checks it)
#   vpn-helper names                  names of the stored secrets (never the values)
#   vpn-helper get NAME               prints a secret
#   vpn-helper set-secret NAME        reads the value from stdin (empty = remove)
#   vpn-helper forget ID              removes every secret of a connection
#   vpn-helper migrate-legacy ID      renames the single-connection secrets to the connection ID
#   vpn-helper net-save               saves default route + DNS from outside the VPN
#   vpn-helper net-restore            restores default route + DNS after disconnecting
#   vpn-helper gw-on                  routes traffic coming from Windows into the VPN
#   vpn-helper gw-off                 undoes gw-on
#   vpn-helper gw-status              prints on/off
set -u
SECRETS=/etc/vpnwsl.secrets
DEFROUTE=/etc/vpnwsl.defroute
RESOLVBASE=/etc/resolv.conf.base
NAME_RE='^(VPN_PASSWORD|TOTP_SECRET)_[a-z0-9]{1,32}$'
ID_RE='^[a-z0-9]{1,32}$'

[ "$(id -u)" -eq 0 ] || { echo "vpn-helper: precisa rodar como root (use sudo)."; exit 1; }

derive_gw() {
  local net
  net=$(ip -4 route show dev eth0 proto kernel 2>/dev/null | awk '{print $1}' | head -1)
  [ -n "$net" ] || return 1
  echo "${net%.*}.1" | sed 's|/.*||'
}

# Current vault entries (without the header comment).
entries() {
  [ -f "$SECRETS" ] && grep -v '^#' "$SECRETS" | grep '=' || true
}

# Writes the vault from stdin, atomically and already 600 root:root.
write_secrets() {
  local tmp
  umask 077
  tmp=$(mktemp /etc/.vpnwsl.XXXXXX)
  { echo "# Gerado pelo WSL-Vpn. Permissao 600 root:root."; cat; } > "$tmp"
  chown root:root "$tmp"; chmod 600 "$tmp"; mv -f "$tmp" "$SECRETS"
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
    echo 3
    ;;
  names)
    entries | cut -d= -f1
    ;;
  get)
    NAME="${2:-}"
    [[ "$NAME" =~ $NAME_RE ]] || { echo "ERRO: nome invalido: $NAME" >&2; exit 2; }
    entries | grep -m1 "^${NAME}=" | cut -d= -f2-
    ;;
  set-secret)
    NAME="${2:-}"
    [[ "$NAME" =~ $NAME_RE ]] || { echo "ERRO: nome invalido: $NAME"; exit 2; }
    IFS= read -r V || V=""
    # Drop a UTF-8 BOM at the start and a CR at the end (senders using CRLF).
    V=$(printf '%s' "$V" | sed '1s/^\xef\xbb\xbf//')
    V="${V%$'\r'}"
    {
      entries | grep -v "^${NAME}=" || true
      [ -n "$V" ] && printf '%s=%s\n' "$NAME" "$V"
    } | write_secrets
    if [ -n "$V" ]; then echo "$NAME salvo no cofre"; else echo "$NAME removido do cofre"; fi
    unset V
    ;;
  forget)
    ID="${2:-}"
    [[ "$ID" =~ $ID_RE ]] || { echo "ERRO: id invalido: $ID"; exit 2; }
    { entries | grep -vE "^[A-Z_]+_${ID}=" || true; } | write_secrets
    echo "segredos de $ID removidos"
    ;;
  migrate-legacy)
    # The original panel kept one connection: VPN_PASSWORD, TOTP_SECRET and RDP_PASSWORD.
    # RDP now runs on Windows through the tunnel, so its password is dropped.
    V="${2:-}"
    [[ "$V" =~ $ID_RE ]] || { echo "ERRO: id invalido: $V"; exit 2; }
    [ -f "$SECRETS" ] || { echo "nada a migrar"; exit 0; }
    entries | grep -v '^RDP_PASSWORD' \
      | sed -e "s/^VPN_PASSWORD=/VPN_PASSWORD_${V}=/" -e "s/^TOTP_SECRET=/TOTP_SECRET_${V}=/" | write_secrets
    echo "segredos migrados"
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
    # Forwarding is shared by every distro (WSL 2 has one network namespace): remember what it was.
    [ -f /run/wsl-vpn-ip-forward ] || cat /proc/sys/net/ipv4/ip_forward > /run/wsl-vpn-ip-forward
    sysctl -qw net.ipv4.ip_forward=1
    # Read by the app: the IP for the Windows routes and the DNS servers for NRPT.
    echo "WSL_IP=$(ip -4 -br addr show eth0 | awk '{print $3}' | cut -d/ -f1)"
    echo "DNS=$(corp_dns)"
    ;;
  gw-off)
    gw_clear
    # Put back the forwarding from before gw-on, but never turn it off under Docker (in this or
    # another distro): its containers lose the internet without it.
    previous=$(cat /run/wsl-vpn-ip-forward 2>/dev/null || echo 0)
    rm -f /run/wsl-vpn-ip-forward
    if [ "$previous" = 0 ] && ! ip link show docker0 >/dev/null 2>&1; then
      sysctl -qw net.ipv4.ip_forward=0
    fi
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
    echo "uso: vpn-helper {version|names|get|set-secret|forget|migrate-legacy|net-save|net-restore|gw-on|gw-off|gw-status}" >&2
    exit 2
    ;;
esac
'@

# --------------------------------------------------------------- vpn-up
$vpnUp = @'
#!/usr/bin/env bash
# Connects a Fortinet SSL-VPN connection.
#   vpn-up ID HOST PORT USER CERT OTP_REQUIRED OTP_DELAY     (OTP code on stdin when required)
# The password comes from the vault (VPN_PASSWORD_ID) and goes through stdin - never on the
# command line, so it doesn't show up in 'ps'. The OTP is never stored: it changes every time.
set -o pipefail
ID="${1:-}"; HOST="${2:-}"; PORT="${3:-}"; VUSER="${4:-}"; CERT="${5:-}"
OTP_REQUIRED="${6:-0}"; OTP_DELAY="${7:-2}"
BASE=/etc/openfortivpn/wsl-vpn.conf
LOG=/tmp/vpnwsl.log
ACTIVE=/tmp/vpnwsl.active

if ! [[ "$ID" =~ ^[a-z0-9]{1,32}$ && "$HOST" =~ ^[A-Za-z0-9.-]+$ && "$PORT" =~ ^[0-9]{1,5}$ && -n "$VUSER" ]] ||
   ! [[ -z "$CERT" || "$CERT" =~ ^[0-9a-f]{64}$ ]] || ! [[ "$OTP_DELAY" =~ ^[0-9]{1,2}$ ]]; then
  echo "ERRO: parametros da conexao invalidos."
  exit 2
fi

if pgrep -x openfortivpn >/dev/null; then
  echo "VPN ja conectada."
  exit 0
fi

# Sanity: if the previous session dropped without restoring, the corporate DNS remains and the
# default route is missing - not even the VPN gateway would resolve.
NEEDS_FIX=0
ip -4 route show default 2>/dev/null | grep -q . || NEEDS_FIX=1
getent hosts "$HOST" >/dev/null 2>&1 || NEEDS_FIX=1
if [ "$NEEDS_FIX" -eq 1 ]; then
  echo "Restaurando a rede antes de conectar..."
  sudo -n vpn-helper net-restore >/dev/null 2>&1 || true
fi
sudo -n vpn-helper net-save >/dev/null 2>&1 || true

PASS=$(sudo -n vpn-helper get "VPN_PASSWORD_$ID" 2>/dev/null || true)
[ -n "$PASS" ] || { echo "ERRO: sem senha para esta conexao. Salve-a em Editar conexao > Senha."; exit 1; }

OTP_ARGS=()
if [ "$OTP_REQUIRED" = "1" ]; then
  read -r OTP || OTP=""
  # The code may arrive with a BOM, CR or spaces through stdin.
  # Any invisible character makes the gateway reject the token.
  OTP=$(printf '%s' "$OTP" | tr -cd '0-9')
  [ -n "$OTP" ] || { echo "ERRO: esta VPN exige codigo OTP."; exit 1; }
  OTP_ARGS=(--otp="$OTP" --otp-delay="$OTP_DELAY")
fi
CERT_ARGS=()
[ -n "$CERT" ] && CERT_ARGS=(--trusted-cert="$CERT")

printf '%s\n' "$PASS" | sudo openfortivpn "$HOST:$PORT" -c "$BASE" -u "$VUSER" "${CERT_ARGS[@]}" "${OTP_ARGS[@]}" >"$LOG" 2>&1 &
unset PASS OTP
echo "$ID" > "$ACTIVE"

echo "Conectando a ${HOST}:${PORT}..."
for _ in $(seq 1 40); do
  sleep 1
  if ip link show ppp0 >/dev/null 2>&1; then
    echo "CONECTADA"
    ip -br addr show ppp0
    exit 0
  fi
  if ! pgrep -x openfortivpn >/dev/null; then
    rm -f "$ACTIVE"
    echo "FALHA NA CONEXAO."
    # Order matters: Fortinet emits "check the password, client certificate, etc." on ANY
    # failure - it doesn't point at a certificate problem.
    if   grep -qi 'no otp specified\|one-time password\|otp is required' "$LOG"; then
      echo "CAUSA: codigo OTP ausente, incorreto ou expirado (eles duram ~30s)."
    elif grep -qi 'gateway certificate validation failed\|certificate digest\|untrusted certificate' "$LOG"; then
      echo "CAUSA: o certificado do gateway mudou. Edite a conexao e clique em 'Detectar'."
    elif grep -qi 'authentication failed\|wrong credentials' "$LOG"; then
      echo "CAUSA: usuario ou senha incorretos (confira a conexao)."
    elif grep -qi 'could not authenticate to gateway' "$LOG"; then
      echo "CAUSA: o gateway recusou o login (senha ou codigo OTP)."
    elif grep -qi 'operation not permitted\|/dev/ppp' "$LOG"; then
      echo "CAUSA: problema no PPP. Rode 'wsl --update' no Windows."
    elif grep -qi 'could not connect\|connection refused\|timed out\|name resolution' "$LOG"; then
      echo "CAUSA: nao foi possivel alcancar ${HOST}:${PORT}."
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
rm -f /tmp/vpnwsl.active
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

if (-not $SkipPackages) {
    Say "Ubuntu 1/5 Requisitos do kernel (PPP)"
    if ((Test-WslOutput "[ -e /dev/ppp ] && grep -q ppp /proc/devices && echo OK || echo FALTA") -ne "OK") {
        Die "O kernel do WSL2 nao tem suporte a PPP. Rode 'wsl --update'."
    }
    Ok "/dev/ppp presente."

    Say "Ubuntu 2/5 Pacotes (openfortivpn)"
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
    Invoke-Wsl "export DEBIAN_FRONTEND=noninteractive; apt-get update -qq && apt-get install -y -qq openfortivpn ppp iproute2 dnsutils iputils-ping openssl ca-certificates iptables >/dev/null" -AsRoot
    if ($LASTEXITCODE -ne 0) { Die "Falha ao instalar os pacotes." }
    $version = (Invoke-Wsl "openfortivpn --version") -replace "`0", ""
    Ok "openfortivpn $($version.Trim())"

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

Say "Ubuntu 4/5 Base da VPN e sudoers"
# Options shared by every connection; host, user and certificate come as arguments.
$baseConfig = @"
# Base options for every WSL-Vpn connection (host, user and certificate come from the app).
set-routes = 1
set-dns = 1
# use-resolvconf=0: on Ubuntu 24.04 resolvconf delegates to systemd-resolved, which is disabled.
# With 0 openfortivpn writes /etc/resolv.conf directly.
use-resolvconf = 0
pppd-use-peerdns = 1
# NO password: it lives in the vault /etc/vpnwsl.secrets (600 root:root).
"@
Write-Lf (Join-Path $tmp "wsl-vpn.conf") $baseConfig

$sudoers = "$LinuxUser ALL=(root) NOPASSWD: /usr/bin/openfortivpn`n" +
           "$LinuxUser ALL=(root) NOPASSWD: /usr/bin/pkill -SIGINT -x openfortivpn`n" +
           "$LinuxUser ALL=(root) NOPASSWD: /usr/local/sbin/vpn-helper`n"
Write-Lf (Join-Path $tmp "sudoers") $sudoers

Invoke-Wsl @"
set -e
mkdir -p /etc/openfortivpn
install -m 0644 -o root -g root '$tmpLinux/wsl-vpn.conf' /etc/openfortivpn/wsl-vpn.conf
cp '$tmpLinux/sudoers' /etc/sudoers.d/vpnwsl
chmod 440 /etc/sudoers.d/vpnwsl
visudo -c -f /etc/sudoers.d/vpnwsl >/dev/null
"@ -AsRoot
if ($LASTEXITCODE -ne 0) { Die "Falha ao gravar a base da VPN." }
Ok "Base da VPN sem senha; sudoers restrito validado."

Say "Ubuntu 5/5 Comandos do Linux"
Write-Lf (Join-Path $tmp "vpn-helper") $helper
Write-Lf (Join-Path $tmp "vpn-up")     $vpnUp
Write-Lf (Join-Path $tmp "vpn-down")   $vpnDown

Invoke-Wsl @"
set -e
install -m 0755 -o root -g root '$tmpLinux/vpn-helper' /usr/local/sbin/vpn-helper
ln -sf /usr/local/sbin/vpn-helper /usr/local/bin/vpn-helper
install -m 0755 '$tmpLinux/vpn-up'   /usr/local/bin/vpn-up
install -m 0755 '$tmpLinux/vpn-down' /usr/local/bin/vpn-down
"@ -AsRoot
if ($LASTEXITCODE -ne 0) { Die "Falha ao instalar os comandos." }
Ok "vpn-up, vpn-down, vpn-helper (versao 3) instalados."

Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
Ok "Ubuntu configurado."
