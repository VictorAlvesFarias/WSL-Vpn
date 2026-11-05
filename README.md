# WSL-Vpn

Desktop app for corporate **Fortinet SSL-VPN connections running inside WSL2**, so that by default **only traffic originating in Linux goes through the VPN**. Windows stays on the normal network until you add a **tunnel**: then Windows reaches the chosen destinations (or everything) through the VPN that is already open in WSL2. RDP, browsers and any other program just use it, with no VPN client installed on Windows.

```
Windows host
├── Internet / home network            <-- untouched
├── mstsc, browser, ... ──(tunnel targets, optional)──┐
│                                                     ▼
└── WSL2 (own NAT network) ── openfortivpn ── ppp0 ── corporate network
```

## Structure

- **server/** – Express API (TypeScript run natively by Node 24) on `127.0.0.1:4312`. Drives `wsl.exe`, streams state and log to the UI with Server-Sent Events. Connections are stored in `~/.wsl-vpn/data.json` (override with `WSLVPN_HOME`).
- **server/scripts/** – PowerShell: `install.ps1` (Windows + Ubuntu), `setup.ps1` (Ubuntu; embeds the Linux commands `vpn-up`, `vpn-down`, `vpn-helper`), `gateway.ps1` (Windows routes/DNS, elevated).
- **client/** – React + Vite + Tailwind 4 + Radix (Geist font, Lucide icons) on `127.0.0.1:5312` (proxies `/api`). Same layout as the other desktop panels (Audable, Gituser…): its own title bar with the menus and the command center (Ctrl+Shift+P opens the command palette), an activity bar (Conexões, Instalação) and a status bar with the VPN, the task in progress and the Windows tunnel.
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

1. **Instalação**: set the distro and Linux user. If WSL is missing, *Instalar o WSL* (UAC) and reboot. Then *Instalar / reparar*: idempotent, it only redoes what is missing (virtualization, WSL, `.wslconfig` in NAT mode, Ubuntu without interactive provisioning, Linux user, openfortivpn, DNS, restricted sudoers, commands).
2. **Painel → Nova conexão**: name, gateway, port, user, password and the gateway certificate (detected automatically, or with *Detectar*).
3. Connect from the list, or open the connection to type the OTP code and choose the tunnel. The OTP field is always there; **left empty, the registered authenticator fills it in**.

Coming from the original panel (or the first app version), the existing setup is imported as one connection. Its Ubuntu commands are older, so the app shows *Atualizar agora*: it reinstalls the commands (`setup.ps1 -SkipPackages`, no WSL restart, the VPN stays up) and moves the stored password and authenticator key to the imported connection, inside WSL.

## Connections

Each connection has its own gateway, user, certificate, OTP settings and tunnel. Only one can be up at a time.

- **Screen 1 – list**: every connection with its status, tunnel summary and a *Conectar*/*Desconectar* button. Connections without an authenticator open screen 2 so the code can be typed.
- **Screen 2 – connection**: status, live authenticator code, OTP field, connect/disconnect, and the tunnel. Editing the connection details (gateway, user, password, certificate, OTP) happens in a modal.

### Authenticator

*Cadastrar autenticador* (a modal) stores the TOTP key of the connection in the vault. The home screen then shows its live code, like the phone app, and connecting with an empty OTP field uses it (RFC 6238, computed with the Windows clock, which is NTP-synced; near the end of a 30 s window it waits for the next code).

> With the authenticator key on the same PC as the password, anyone with access to this Windows account can connect without your phone. Check that the company policy allows it.

### Tunnel (screen 2)

A radio chooses what Windows sends through the connection: **Desativado** (only Linux uses the VPN), **Global** or **Específico**. Changes are saved right away. The tunnel is added right after connecting (UAC) and removed before disconnecting; while connected, changing the mode applies it at once, and list edits wait for *Aplicar alterações*.

- **Global**: all IPv4 traffic from Windows goes through the VPN, and Windows resolves every name through the company DNS (the local network stays at home). The company firewall usually blocks much of the internet.
- **Específico**: only the targets in the list, added one by one:

| Target | Effect |
|---|---|
| `10.0.0.0/8`, `10.1.2.3` | routed through the tunnel |
| `intranet.company.com`, `https://portal.company.com/app` | resolved through the company DNS (inside WSL) and routed; Windows also resolves that name through the company DNS |
| `*.company.local` | Windows resolves the whole domain through the company DNS (add the networks it lives in as targets) |

How it works: WSL2 forwards and masquerades (NAT) Windows traffic into `ppp0`; Windows gets routes with WSL2 as next hop (in the ActiveStore, gone on reboot) and NRPT rules tagged `vpnwsl-gateway`. In global mode the VPN gateway gets an exception route through the home router, otherwise the tunnel would try to go through itself. If the VPN drops with the tunnel on, the app removes it to give Windows its internet back, and puts it back when it reconnects (see Preferências). Leftovers (e.g. after a reboot, which keeps NRPT rules) show up as *Limpar túnel*.

## Preferências (gear icon, Ctrl+comma)

- **Reconectar sozinho quando a VPN cair** (on by default). The connection you connected through the app is "wanted": when the status check sees `ppp0` gone, the app removes the Windows tunnel (as before), then reconnects after 5 s, 15 s, 30 s, 1, 2 and 5 min (and every 5 min after that), reapplying the tunnel. The code comes from the authenticator, so a connection that requires OTP without one is not reconnected (the log says so). Disconnecting, or connecting another one, cancels it; so does *VPN › Cancelar a reconexão*. A VPN that was already up when the app opened is watched too. While a connection is wanted, closing the window leaves the app in the tray (status checks go on with the window closed); *Sair* in the tray menu quits.
- **Pedir administrador uma vez, ao abrir** (on by default). The tunnel's Windows side (routes, NRPT) needs elevation. Instead of one UAC prompt per change, the desktop app starts `server/scripts/gateway-service.ps1` elevated once (one UAC when it opens): it runs `gateway.ps1` on request (JSON files in `%TEMP%wsl-vpn-gateway`, only gateway.ps1's own parameters accepted) and ends by itself when the app exits. The app itself, and WSL, stay unelevated. If the prompt is declined, every change asks again, as before. The status bar shows *Admin* while the helper is up.

## Secrets

Nothing secret is stored on Windows. Passwords and authenticator keys go straight to the vault inside WSL2, `/etc/vpnwsl.secrets` (`600 root:root`), as `VPN_PASSWORD_<id>` and `TOTP_SECRET_<id>`.

- Secrets travel through stdin only (`vpn-helper set-secret`, `openfortivpn`), never on a command line; the app only ever reads the authenticator key (to compute codes) and the list of secret names.
- The vault is only reachable through `/usr/local/sbin/vpn-helper`, the **only** binary allowed in sudoers besides `openfortivpn` and stopping it.
- Connection parameters reach Linux as literal arguments (`wsl.exe --exec`), never through a shell.
- The local API only accepts requests to `localhost`, and state-changing requests must carry the `x-wsl-vpn` header, so other websites can't drive it.

## Why the isolation works

WSL2 in **NAT mode** runs in a light VM with its own network stack; the routes `openfortivpn` creates exist only inside it. The installer writes `%USERPROFILE%\.wslconfig` (keeping a `.bak` of a different one):

```ini
[wsl2]
networkingMode=NAT      # own stack - NEVER use "mirrored"
dnsTunneling=false      # Linux uses the VPN DNS, not the Windows one
autoProxy=false
```

To check, with the VPN connected and no tunnel:

```powershell
Get-NetRoute -DestinationPrefix '0.0.0.0/0'   # Windows: still the LAN gateway, no ppp
wsl -d Ubuntu-24.04 -- ip route               # WSL2: here are the VPN routes
```

## Troubleshooting

- **OTP rejected**: codes last ~30 s. If it fails on timing, raise the OTP delay of the connection to 3–4 s.
- **`Gateway certificate validation failed`**: the gateway certificate changed. Edit the connection and click *Detectar*.
- **A tunnel host name didn't resolve**: it is resolved through the company DNS while connected; check the name, or add its network instead.
- **No internet in WSL2 after disconnecting**: the app restores it on disconnect and before each connection. Manually: `wsl -d Ubuntu-24.04 -- sudo vpn-helper net-restore`.
- **Start from scratch**: `wsl --unregister Ubuntu-24.04` (deletes Ubuntu and the vault), then *Instalar / reparar*.
