# WSL-Vpn

Desktop app for a corporate **Fortinet SSL-VPN running inside WSL2**, so that **only traffic originating in Linux goes through the VPN**. Windows stays on the normal network (no routes, DNS or gateway from the tunnel), and RDP to internal machines runs through FreeRDP with the window shown on Windows via WSLg.

```
Windows host
├── Internet / home network        <-- untouched
├── personal apps
│
└── WSL2 (own NAT network)
    ├── openfortivpn  -> corporate SSL-VPN (ppp0)
    └── xfreerdp3     -> RDP to internal machines (window via WSLg)
```

It replaces the Python/Tk panel and the `Install.cmd`/`config.env` workflow of the original project with a single app: **Painel** (connect, RDP, use the VPN on Windows), **Configurações** and **Instalação**.

## Structure

- **server/** – Express API (TypeScript run natively by Node 24) on `127.0.0.1:4312`. Drives `wsl.exe`, streams state and log to the UI with Server-Sent Events.
- **server/scripts/** – PowerShell scripts: `install.ps1` (Windows + Ubuntu), `setup.ps1` (Ubuntu; embeds the Linux scripts), `gateway.ps1` (Windows routes/DNS, elevated), `wslg-reset.ps1`, `raise-window.ps1`.
- **client/** – React + Vite UI on `127.0.0.1:5312` (proxies `/api`).
- **desktop/** – Electron shell and NSIS installer.

## Usage

```sh
npm install
npm run dev       # API + Vite, open http://localhost:5312
npm run desktop   # build and open in an Electron window
npm run dist      # Windows installer: release/WSL-Vpn-Setup-<version>.exe
```

The installer is unsigned, so SmartScreen warns on first run ("More info" → "Run anyway").

## First run

1. **Configurações**: fill in the VPN, RDP and Ubuntu fields. If Ubuntu was already set up by the original panel, the configuration is imported automatically from `/etc/vpnwsl.env`.
2. **Instalação**: if WSL is missing, *Instalar o WSL* (UAC) and reboot. Then *Instalar / reparar*. It is idempotent: it checks before acting and only redoes what is missing (virtualization, WSL, `.wslconfig` in NAT mode, Ubuntu without interactive provisioning, Linux user, gateway certificate fingerprint, packages, DNS, VPN config, restricted sudoers, commands, vault).
3. **Painel**: connect. With an authenticator key registered, the OTP code is generated automatically (RFC 6238, computed with the Windows clock).

Coming from the original panel, the Ubuntu commands are version 1; the app shows a banner to update them (*Atualizar agora*, which runs `setup.ps1 -OnlyConfig`: no packages, no WSL restart).

## Secrets

Nothing secret is stored on Windows. `~/.wsl-vpn/config.env` (override with `WSLVPN_HOME`) holds only the configuration; passwords go straight to the vault inside WSL2:

| Secret | Where |
|---|---|
| VPN and RDP passwords | `/etc/vpnwsl.secrets`, `600 root:root` (*Configurações → Senhas no cofre*, or the install form) |
| Authenticator key | same vault (`TOTP_SECRET`) |
| Linux password | applied with `chpasswd` during install, never stored |
| OTP code | never stored |

- Secrets travel through stdin only (`vpn-helper set-secret`, `openfortivpn`, `xfreerdp3 /from-stdin`), never on a command line.
- The vault is only reachable through `/usr/local/sbin/vpn-helper`, the **only** binary allowed in sudoers.
- `/etc/vpnwsl.env` (world-readable copy of the configuration) never contains passwords; setup aborts if one leaks there.
- The local API only accepts requests to `localhost`, and state-changing requests must carry the `x-wsl-vpn` header, so other websites can't drive it.

> With the authenticator key on the same PC as the password, anyone with access to this Windows account can connect without your phone. Check that the company policy allows it.

## Use the VPN on Windows (optional)

Makes Windows reach the corporate network through the tunnel already open in WSL2 (e.g. `mstsc`, intranet, database clients) without installing a VPN client on Windows. Turning it on or off asks for UAC.

| Mode | Through the tunnel | At home |
|---|---|---|
| **Empresa** | networks in *Redes da empresa* | everything else |
| **+ Microsoft 365** | + official Microsoft 365 ranges (Teams, SharePoint/OneDrive, Outlook, login) | everything else |
| **Tudo** | all IPv4 traffic from Windows | only the local network and the router DNS |

- WSL2 forwards and masquerades (NAT) Windows traffic into `ppp0`; Windows gets routes with WSL2 as next hop and NRPT rules so only *Domínios internos* use the corporate DNS.
- In **+ Microsoft 365** and **Tudo**, the VPN gateway gets an exception route through the home router, otherwise the tunnel would try to go through itself.
- If the VPN drops with the gateway on, the app removes the routes by itself (UAC) to give Windows its internet back.
- Routes vanish on reboot; the DNS rule doesn't. If the panel shows *Restos de rotas/DNS no Windows*, click *Limpar rotas do Windows*.

## Why the isolation works

WSL2 in **NAT mode** runs in a light VM with its own network stack; the routes `openfortivpn` creates exist only inside it. The installer writes `%USERPROFILE%\.wslconfig`:

```ini
[wsl2]
networkingMode=NAT      # own stack - NEVER use "mirrored"
dnsTunneling=false      # Linux uses the VPN DNS, not the Windows one
autoProxy=false
```

To check, with the VPN connected:

```powershell
Get-NetRoute -DestinationPrefix '0.0.0.0/0'   # Windows: still the LAN gateway, no ppp
wsl -d Ubuntu-24.04 -- ip route               # WSL2: here are the VPN routes
```

## Troubleshooting

- **OTP rejected**: codes last ~30 s. If it fails on timing, raise *Atraso do OTP* to 3–4 and *Salvar e aplicar no Ubuntu*.
- **`Gateway certificate validation failed`**: the gateway certificate changed. Run *Instalar / reparar* with *Atualizar o certificado do gateway* checked.
- **No internet in WSL2 after disconnecting**: the app restores it on disconnect and before each connection. Manually: `wsl -d Ubuntu-24.04 -- sudo vpn-helper net-restore`.
- **RDP window doesn't show up**: the app restarts the WSLg host before each session and brings the window to the front; if it still fails, the log shows the `rdp-connect` output. Last resort: `wsl --shutdown`.
- **Start from scratch**: `wsl --unregister Ubuntu-24.04` (deletes Ubuntu and the vault), then *Instalar / reparar*.
