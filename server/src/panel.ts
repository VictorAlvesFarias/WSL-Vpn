import { runGatewayElevated } from './elevated.ts';
import { dataChanged, say, sayLines, state, updateState, type TunnelState } from './events.ts';
import { getConnection, getSettings, type Connection } from './store.ts';
import { parseTotpSecret, totpNow } from './totp.ts';
import { HttpError } from './validation.ts';
import { getSecret, secretName, setSecret } from './vault.ts';
import { hasTaggedNrptRule, wslGatewayRoutes } from './windowsNet.ts';
import { bash, helper, wslExec } from './wsl.ts';

/** Runs one VPN/tunnel action at a time, like the original panel: concurrent route changes would race. */
async function exclusive<T>(label: string, action: () => Promise<T>): Promise<T> {
  if (state.busy) throw new HttpError(409, `Aguarde: ${state.busy}`);
  updateState({ busy: label });
  try {
    return await action();
  } catch (error) {
    if (!(error instanceof HttpError)) say(`Erro: ${(error as Error).message}`, 'error');
    throw error;
  } finally {
    updateState({ busy: null });
    void refreshStatus();
  }
}

// ------------------------------------------------------------------ status

let polling = false;

/** Checks the tunnel (ppp0), which connection is up and both ends of the Windows tunnel. */
export async function refreshStatus(): Promise<void> {
  if (polling || state.busy) return;
  polling = true;
  try {
    const { distro } = await getSettings();
    let result;
    try {
      result = await bash(
        distro,
        'ip -br addr show ppp0 2>/dev/null; ' +
          "echo ETH0=$(ip -4 -br addr show eth0 | awk '{print $3}'); " +
          'echo GW=$(sudo -n /usr/local/sbin/vpn-helper gw-status 2>/dev/null); ' +
          'echo ACTIVE=$(cat /tmp/vpnwsl.active 2>/dev/null)',
        [],
        { timeoutMs: 25_000 },
      );
    } catch {
      result = null;
    }
    if (!result || result.code !== 0 || !result.stdout.includes('ETH0=')) {
      // No answer is not the same as "the VPN dropped": keep the last state, otherwise the
      // automatic tunnel shutdown below would fire for nothing.
      updateState({ status: { ...state.status, reachable: false, checkedAt: new Date().toISOString() } });
      return;
    }

    let ppp = '';
    const info: Record<string, string> = {};
    for (const line of result.stdout.split(/\r?\n/)) {
      const match = /^(ETH0|GW|ACTIVE)=(.*)$/.exec(line);
      if (match) info[match[1]] = match[2].trim();
      else if (line.startsWith('ppp0')) ppp = line;
    }

    // The tunnel has two ends: rules in Linux and routes/DNS on Windows. One without the other
    // (e.g. after a reboot, which drops the routes but keeps the NRPT rule) is "partial".
    const linuxOn = info.GW === 'on';
    const routes = await wslGatewayRoutes(info.ETH0 ?? '');
    const windowsOn = routes.length > 0 || (await hasTaggedNrptRule());
    const tunnel: TunnelState = linuxOn && windowsOn ? 'on' : linuxOn || windowsOn ? 'partial' : 'off';

    const up = Boolean(ppp);
    const dropped = state.status.up && !up;
    updateState({
      status: {
        reachable: true,
        up,
        address: up ? (ppp.split(/\s+/)[2] ?? '') : '',
        activeId: up ? info.ACTIVE || null : null,
        tunnel,
        tunnelGlobal: routes.some(([dest, mask]) => dest === '0.0.0.0' && mask === '128.0.0.0'),
        tunnelRoutes: routes.length,
        checkedAt: new Date().toISOString(),
      },
    });

    if (dropped && tunnel !== 'off') {
      // With the tunnel on (especially global) Windows depends on it and would stay offline
      // until someone clicked. Undo it right away.
      say('A VPN caiu: removendo o túnel do Windows para devolver a sua internet (confirme o UAC)...', 'warn');
      void tunnelOff().catch(() => undefined);
    }
  } finally {
    polling = false;
  }
}

// ----------------------------------------------------------- authenticator

const totpKeys = new Map<string, string | null>();

async function totpKey(connectionId: string): Promise<string | null> {
  if (totpKeys.has(connectionId)) return totpKeys.get(connectionId) ?? null;
  const { distro } = await getSettings();
  const key = parseTotpSecret(await getSecret(distro, secretName('TOTP_SECRET', connectionId)));
  totpKeys.set(connectionId, key);
  return key;
}

export function forgetTotpKey(connectionId: string): void {
  totpKeys.delete(connectionId);
}

/** Live code of a connection's authenticator, computed with the Windows clock. */
export async function currentTotp(connectionId: string): Promise<{ enabled: boolean; code?: string; remaining?: number }> {
  const key = await totpKey(connectionId);
  return key ? { enabled: true, ...totpNow(key) } : { enabled: false };
}

/** Saves a connection's authenticator key in the vault ("" removes it). */
export async function saveTotp(connectionId: string, key: string): Promise<void> {
  const { distro } = await getSettings();
  await setSecret(distro, secretName('TOTP_SECRET', connectionId), key);
  totpKeys.set(connectionId, key || null);
  say(key ? 'Autenticador salvo no cofre do WSL2.' : 'Autenticador removido.', 'ok');
  dataChanged();
}

async function totpCodeForConnect(connectionId: string): Promise<string | null> {
  const key = await totpKey(connectionId);
  if (!key) return null;
  let { code, remaining } = totpNow(key);
  // vpn-up still waits the OTP delay before sending the code; near the end of the 30 s window
  // it would reach the gateway already expired.
  if (remaining < 8) {
    say(`Aguardando ${remaining}s pelo próximo código...`);
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
    ({ code } = totpNow(key));
  }
  say('Código OTP gerado pelo autenticador.');
  return code;
}

// --------------------------------------------------------------- connection

export async function connect(connectionId: string, typedOtp: string): Promise<void> {
  const connection = await getConnection(connectionId);
  const { distro } = await getSettings();
  if (state.status.up) throw new HttpError(409, 'Já existe uma VPN conectada: desconecte antes.');
  // Digits only: spaces or a BOM pasted with the code make the gateway reject a valid token.
  let otp = typedOtp.replace(/\D/g, '');

  await exclusive(`Conectando ${connection.name}`, async () => {
    say(`Conectando a ${connection.name} (${connection.host})...`, 'step');
    // A typed code wins; when the field is empty the registered authenticator fills it in.
    if (connection.otpRequired && !otp) {
      const generated = await totpCodeForConnect(connection.id);
      if (!generated) {
        say('Informe o código OTP ou cadastre o autenticador desta conexão.', 'error');
        return;
      }
      otp = generated;
    }
    // The password comes from the vault inside WSL; only the OTP travels through stdin.
    const result = await wslExec(
      distro,
      [
        'vpn-up',
        connection.id,
        connection.host,
        String(connection.port),
        connection.user,
        connection.trustedCert,
        connection.otpRequired ? '1' : '0',
        String(connection.otpDelay),
      ],
      { input: otp + '\n', timeoutMs: 150_000 },
    );
    sayLines(result.stdout + result.stderr);
    if (result.code < 0) say('Tempo esgotado ao conectar.', 'error');
    if (result.code === 0 && connection.tunnel.mode !== 'off') await tunnelOnSteps(connection, distro);
  });
}

export async function disconnect(): Promise<void> {
  const { distro } = await getSettings();
  await exclusive('Desconectando', async () => {
    say('Desconectando...', 'step');
    if (state.status.tunnel !== 'off') {
      // Without the VPN, the Windows routes would point at nothing.
      say('Removendo antes o túnel do Windows (confirme o UAC)...');
      if (!(await tunnelOffSteps(distro))) say("Aviso: rotas do Windows mantidas; use 'Limpar túnel' depois.", 'warn');
    }
    const result = await wslExec(distro, ['vpn-down'], { timeoutMs: 90_000 });
    sayLines(result.stdout + result.stderr);
  });
}

// ------------------------------------------------------------------ tunnel

/** Resolves host names inside WSL, i.e. through the company DNS while the VPN is up. */
async function resolveInWsl(distro: string, hosts: string[]): Promise<Map<string, string[]>> {
  const resolved = new Map<string, string[]>();
  if (!hosts.length) return resolved;
  const result = await bash(
    distro,
    'for h in "$@"; do getent ahostsv4 "$h" | awk -v h="$h" \'{print h, $1}\' | sort -u; done',
    hosts,
    { timeoutMs: 60_000 },
  );
  for (const line of result.stdout.split(/\r?\n/)) {
    const [host, ip] = line.trim().split(/\s+/);
    if (host && ip) resolved.set(host, [...(resolved.get(host) ?? []), ip]);
  }
  return resolved;
}

/** Identifies what a tunnel routes, so the UI can tell when the saved one differs from the applied one. */
export function tunnelSignature(connection: Connection): string {
  const { mode, m365, targets } = connection.tunnel;
  return JSON.stringify({ id: connection.id, mode, m365: mode === 'specific' && m365, targets: mode === 'specific' ? targets : [] });
}

const hasTargets = (connection: Connection) => connection.tunnel.targets.length > 0 || connection.tunnel.m365;

async function tunnelOnSteps(connection: Connection, distro: string): Promise<boolean> {
  const { tunnel } = connection;
  const global = tunnel.mode === 'global';
  // Global ignores the list: everything goes through the tunnel, DNS included.
  const targets = global ? [] : tunnel.targets;
  const networks = targets.filter((t) => /^\d/.test(t));
  const hosts = targets.filter((t) => !/^\d/.test(t) && !t.startsWith('*.'));
  const domains = targets.filter((t) => t.startsWith('*.')).map((t) => `.${t.slice(2)}`);
  const mode = global ? 'tudo' : tunnel.m365 ? 'm365' : 'empresa';
  if (!global && !hasTargets(connection)) {
    say('Túnel específico sem destinos: adicione algum na lista.', 'warn');
    return false;
  }
  say(
    `Adicionando o túnel no Windows: ${global ? 'todo o tráfego (global)' : `${targets.length} destino(s)${tunnel.m365 ? ' + Microsoft 365' : ''}`} (confirme o UAC)...`,
    'step',
  );

  // Host names are routed by IP: resolve them now, through the company DNS.
  const resolved = await resolveInWsl(distro, hosts);
  for (const host of hosts) {
    const ips = resolved.get(host);
    if (ips?.length) {
      networks.push(...ips.map((ip) => `${ip}/32`));
      say(`${host} -> ${ips.join(', ')}`);
    } else {
      say(`Aviso: ${host} não resolveu; ficou de fora das rotas.`, 'warn');
    }
  }
  const routes = [...new Set(networks)];
  if (!routes.length && mode === 'empresa') {
    say('Nenhum destino do túnel pôde ser roteado.', 'error');
    return false;
  }

  // Linux first (forwarding + NAT), then routes and DNS on Windows.
  const result = await helper(distro, ['gw-on'], { timeoutMs: 30_000 });
  const info = Object.fromEntries(
    result.stdout
      .split(/\r?\n/)
      .filter((line) => line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
  );
  if (result.code !== 0 || !info.WSL_IP) {
    sayLines(result.stdout + result.stderr);
    return false;
  }

  // Empty parameters disappear in Start-Process and shift the following ones: only pass what exists.
  const params = ['-Action', 'On', '-WslIp', info.WSL_IP, '-Mode', mode];
  if (routes.length) params.push('-Routes', routes.join(','));
  if (info.DNS) params.push('-Dns', info.DNS);
  // Names must resolve on Windows through the company DNS: in global mode all of them ("."),
  // otherwise the listed domains plus each exact host name.
  const namespaces = global ? ['.'] : [...domains, ...hosts];
  if (namespaces.length) params.push('-Suffixes', namespaces.join(','));
  if (mode !== 'empresa') params.push('-VpnHost', connection.host);

  const previous = state.status.tunnel;
  const { ok, lines } = await runGatewayElevated(params);
  lines.forEach((line) => say(line));
  if (!ok) {
    // gateway.ps1 validates everything before touching Windows, so only undo Linux when
    // Windows wasn't already using the tunnel.
    if (previous === 'off') await helper(distro, ['gw-off'], { timeoutMs: 30_000 });
    return false;
  }
  updateState({ appliedTunnel: tunnelSignature(connection) });
  say(global ? 'Túnel global ativo: todo o tráfego do Windows passa pela VPN.' : 'Túnel ativo no Windows.', 'ok');
  if (mode !== 'empresa') say('Feche o Teams por completo e abra de novo para ele reconectar.');
  return true;
}

async function tunnelOffSteps(distro: string): Promise<boolean> {
  // Windows first: if the UAC prompt is denied, the routes keep working.
  const { ok, lines } = await runGatewayElevated(['-Action', 'Off']);
  lines.forEach((line) => say(line));
  if (!ok) return false;
  await helper(distro, ['gw-off'], { timeoutMs: 30_000 });
  updateState({ appliedTunnel: null });
  say('Túnel removido: Windows fora da rede corporativa.', 'ok');
  return true;
}

/**
 * Makes Windows match the connection's saved tunnel while it is up: removes it in "off" mode,
 * otherwise (re)applies it (one UAC prompt).
 */
export async function applyTunnel(connectionId: string): Promise<void> {
  const connection = await getConnection(connectionId);
  const { distro } = await getSettings();
  if (!state.status.up) throw new HttpError(409, 'Conecte a VPN antes de aplicar o túnel.');
  if (connection.tunnel.mode === 'off') {
    if (state.status.tunnel === 'off') return;
    await exclusive('Removendo o túnel', async () => {
      say('Túnel desativado: removendo do Windows (confirme o UAC)...', 'step');
      await tunnelOffSteps(distro);
    });
    return;
  }
  if (connection.tunnel.mode === 'specific' && !hasTargets(connection)) {
    throw new HttpError(400, 'Adicione destinos à lista do túnel específico.');
  }
  await exclusive('Aplicando o túnel', () => tunnelOnSteps(connection, distro));
}

/** Removes the tunnel (also cleans up leftovers of a previous session). */
export async function tunnelOff(): Promise<void> {
  const { distro } = await getSettings();
  await exclusive('Removendo o túnel', async () => {
    say('Removendo o túnel do Windows (confirme o UAC)...', 'step');
    await tunnelOffSteps(distro);
  });
}

// --------------------------------------------------------------- certificate

/** SHA-256 fingerprint of the gateway certificate, fetched from inside WSL. */
export async function detectCertificate(host: string, port: number): Promise<string> {
  const { distro } = await getSettings();
  const result = await bash(
    distro,
    'echo | timeout 15 openssl s_client -connect "$1:$2" -servername "$1" 2>/dev/null | ' +
      "openssl x509 -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//; s/://g' | tr 'A-Z' 'a-z'",
    [host, String(port)],
    { timeoutMs: 40_000 },
  );
  const fingerprint = result.stdout.replace(/\s/g, '');
  if (!/^[0-9a-f]{64}$/.test(fingerprint)) throw new HttpError(502, `Não consegui obter o certificado de ${host}:${port}.`);
  return fingerprint;
}
