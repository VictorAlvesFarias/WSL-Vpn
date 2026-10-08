import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { readConfig, splitList, type Config, type GatewayMode } from './config.ts';
import { runGatewayElevated } from './elevated.ts';
import { say, sayLines, state, updateState, type GatewayState } from './events.ts';
import { runPowerShellScript } from './exec.ts';
import { rdpLogFile, scriptPath } from './paths.ts';
import { parseTotpSecret, totpNow } from './totp.ts';
import { HttpError } from './validation.ts';
import { hasTaggedNrptRule, wslGatewayRoutes } from './windowsNet.ts';
import { helper, wsl } from './wsl.ts';

export const modeText: Record<GatewayMode, string> = {
  empresa: 'só a rede da empresa',
  m365: 'rede da empresa + Microsoft 365',
  tudo: 'TODO o tráfego pela empresa',
};

/** Runs one action at a time, like the original panel: concurrent VPN/route changes would race. */
async function exclusive<T>(label: string, action: () => Promise<T>): Promise<T> {
  if (state.busy) throw new HttpError(409, `Aguarde: ${state.busy}`);
  updateState({ busy: label });
  try {
    return await action();
  } catch (error) {
    say(`Erro: ${(error as Error).message}`, 'error');
    throw error;
  } finally {
    updateState({ busy: null });
    void refreshStatus();
  }
}

// ------------------------------------------------------------------ status

let polling = false;

/** Checks the tunnel (ppp0) and both ends of the Windows gateway, then publishes the result. */
export async function refreshStatus(): Promise<void> {
  if (polling || state.busy) return;
  polling = true;
  try {
    const config = await readConfig();
    let result;
    try {
      result = await wsl(
        config.WSL_DISTRO,
        [
          'bash',
          '-lc',
          'ip -br addr show ppp0 2>/dev/null; ' +
            "echo ETH0=$(ip -4 -br addr show eth0 | awk '{print $3}'); " +
            'echo GW=$(sudo -n vpn-helper gw-status 2>/dev/null)',
        ],
        { timeoutMs: 25_000 },
      );
    } catch {
      result = null;
    }
    if (!result || result.code !== 0 || !result.stdout.includes('ETH0=')) {
      // No answer is not the same as "the VPN dropped": keep the last state, otherwise
      // the automatic gateway shutdown below would fire for nothing.
      updateState({ status: { ...state.status, reachable: false, checkedAt: new Date().toISOString() } });
      return;
    }

    let ppp = '';
    const info: Record<string, string> = {};
    for (const line of result.stdout.split(/\r?\n/)) {
      if (/^(ETH0|GW)=/.test(line)) {
        const [key, ...value] = line.split('=');
        info[key] = value.join('=').trim();
      } else if (line.startsWith('ppp0')) {
        ppp = line;
      }
    }

    // The gateway has two ends: rules in Linux and routes/DNS on Windows. One without the
    // other (e.g. after a reboot, which drops the routes but keeps the NRPT rule) is "partial".
    const linuxOn = info.GW === 'on';
    const routes = await wslGatewayRoutes(info.ETH0 ?? '');
    const windowsOn = routes.length > 0 || (await hasTaggedNrptRule());
    const gateway: GatewayState = linuxOn && windowsOn ? 'on' : linuxOn || windowsOn ? 'partial' : 'off';

    const companyRoutes = splitList(config.GATEWAY_ROUTES).length;
    const activeMode: GatewayMode = routes.some(([dest, mask]) => dest === '0.0.0.0' && mask === '128.0.0.0')
      ? 'tudo'
      : routes.length > companyRoutes
        ? 'm365'
        : 'empresa';

    const up = Boolean(ppp);
    const dropped = state.status.up && !up;
    updateState({
      status: {
        reachable: true,
        up,
        address: up ? (ppp.split(/\s+/)[2] ?? '') : '',
        gateway,
        activeMode,
        checkedAt: new Date().toISOString(),
      },
    });

    if (dropped && gateway !== 'off') {
      // With the gateway on (especially in "tudo" mode) Windows depends on the tunnel and
      // would stay offline until someone clicked. Undo it right away.
      say('A VPN caiu: removendo as rotas do Windows para devolver a sua internet (confirme o UAC)...', 'warn');
      void gatewayOff().catch(() => undefined);
    }
  } finally {
    polling = false;
  }
}

// --------------------------------------------------------------- vault/TOTP

let cachedTotpKey: string | null | undefined;

async function vaultTotpKey(config: Config): Promise<string | null> {
  if (cachedTotpKey !== undefined) return cachedTotpKey;
  const result = await helper(config.WSL_DISTRO, ['get', 'TOTP_SECRET'], { timeoutMs: 20_000 });
  cachedTotpKey = result.code === 0 ? parseTotpSecret(result.stdout) : null;
  return cachedTotpKey;
}

export async function refreshTotpEnabled(): Promise<void> {
  try {
    const key = await vaultTotpKey(await readConfig());
    updateState({ totpEnabled: key !== null });
  } catch {
    // WSL unavailable: leave it unknown.
  }
}

export async function currentTotp(): Promise<{ enabled: boolean; code?: string; remaining?: number }> {
  const key = await vaultTotpKey(await readConfig());
  return key ? { enabled: true, ...totpNow(key) } : { enabled: false };
}

/** Saves the authenticator key in the vault ("" removes it). */
export async function saveTotp(secret: string): Promise<void> {
  const config = await readConfig();
  const result = await helper(config.WSL_DISTRO, ['set-totp'], { input: secret + '\n', timeoutMs: 20_000 });
  if (result.code !== 0) {
    throw new HttpError(500, (result.stdout + result.stderr).trim() || 'Falha ao gravar no cofre do WSL.');
  }
  cachedTotpKey = secret || null;
  updateState({ totpEnabled: Boolean(secret) });
  say(secret ? 'Autenticador salvo no cofre do WSL2.' : 'Autenticador removido.', 'ok');
}

async function totpCodeForConnect(config: Config): Promise<string | null> {
  const key = await vaultTotpKey(config);
  if (!key) return null;
  let { code, remaining } = totpNow(key);
  // vpn-up still waits VPN_OTP_DELAY before sending the code; near the end of the 30 s
  // window it would reach the gateway already expired.
  if (remaining < 8) {
    say(`Aguardando ${remaining}s pelo próximo código...`);
    await new Promise((resolve) => setTimeout(resolve, (remaining + 1) * 1000));
    ({ code } = totpNow(key));
  }
  say('Código OTP gerado pelo autenticador.');
  return code;
}

// --------------------------------------------------------------- connection

export async function connect(typedOtp: string): Promise<void> {
  const config = await readConfig();
  // Digits only: spaces or a BOM pasted with the code make the gateway reject a valid token.
  let otp = typedOtp.replace(/\D/g, '');
  const otpRequired = config.VPN_OTP_REQUIRED === '1';
  if (otpRequired && !otp && !state.totpEnabled) throw new HttpError(400, 'Informe o código OTP do autenticador.');

  await exclusive('Conectando', async () => {
    say(`Conectando a ${config.VPN_HOST}...`, 'step');
    // A typed code wins; otherwise the authenticator generates one.
    if (otpRequired && !otp && state.totpEnabled) {
      const generated = await totpCodeForConnect(config);
      if (!generated) {
        say('Não consegui gerar o código: recadastre o autenticador.', 'error');
        return;
      }
      otp = generated;
    }
    // The password comes from the vault inside WSL; only the OTP travels through stdin.
    const result = await wsl(config.WSL_DISTRO, ['vpn-up'], { input: otp + '\n', timeoutMs: 150_000 });
    sayLines(result.stdout + result.stderr);
    if (result.code === null || result.code < 0) say('Tempo esgotado ao conectar.', 'error');
  });
}

export async function disconnect(): Promise<void> {
  const config = await readConfig();
  await exclusive('Desconectando', async () => {
    say('Desconectando...', 'step');
    if (state.status.gateway !== 'off') {
      // Without the tunnel, the Windows routes would point at nothing.
      say('Removendo antes as rotas e DNS do Windows (confirme o UAC)...');
      if (!(await gatewayOffSteps(config))) say("Aviso: rotas do Windows mantidas; use 'Limpar' depois.", 'warn');
    }
    const result = await wsl(config.WSL_DISTRO, ['vpn-down'], { timeoutMs: 90_000 });
    sayLines(result.stdout + result.stderr);
  });
}

// ------------------------------------------------------------------ gateway

async function gatewayOnSteps(config: Config, mode: GatewayMode): Promise<boolean> {
  // Linux first (forwarding + NAT), then routes and DNS on Windows.
  const result = await helper(config.WSL_DISTRO, ['gw-on'], { timeoutMs: 30_000 });
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

  const params = ['-Action', 'On', '-WslIp', info.WSL_IP, '-Routes', splitList(config.GATEWAY_ROUTES).join(',')];
  // An empty parameter disappears in Start-Process and shifts the following ones.
  if (info.DNS) params.push('-Dns', info.DNS);
  const suffixes = splitList(config.GATEWAY_DNS_SUFFIXES).join(',');
  if (suffixes) params.push('-Suffixes', suffixes);
  params.push('-Mode', mode);
  if (mode !== 'empresa') params.push('-VpnHost', config.VPN_HOST);

  const previous = state.status.gateway;
  const { ok, lines } = await runGatewayElevated(params);
  lines.forEach((line) => say(line));
  if (!ok) {
    // gateway.ps1 validates everything before touching Windows, so only undo Linux
    // when Windows wasn't already using the tunnel.
    if (previous === 'off') await helper(config.WSL_DISTRO, ['gw-off'], { timeoutMs: 30_000 });
    return false;
  }
  say(`Windows: ${modeText[mode]}.`, 'ok');
  if (mode !== 'empresa') say('Feche o Teams por completo e abra de novo para ele reconectar.');
  return true;
}

async function gatewayOffSteps(config: Config): Promise<boolean> {
  // Windows first: if the UAC prompt is denied, the routes keep working.
  const { ok, lines } = await runGatewayElevated(['-Action', 'Off']);
  lines.forEach((line) => say(line));
  if (!ok) return false;
  await helper(config.WSL_DISTRO, ['gw-off'], { timeoutMs: 30_000 });
  say('Windows fora da rede corporativa.', 'ok');
  return true;
}

export async function gatewayOn(): Promise<void> {
  const config = await readConfig();
  const mode = state.selectedMode;
  await exclusive('Ligando a VPN no Windows', async () => {
    say(`Ligando a VPN no Windows: ${modeText[mode]} (confirme o UAC)...`, 'step');
    await gatewayOnSteps(config, mode);
  });
}

export async function gatewayOff(): Promise<void> {
  const config = await readConfig();
  await exclusive('Removendo rotas do Windows', async () => {
    say('Removendo rotas e DNS do Windows (confirme o UAC)...', 'step');
    await gatewayOffSteps(config);
  });
}

/** Changes the mode; with the gateway on it is reapplied right away. */
export async function setGatewayMode(mode: GatewayMode): Promise<void> {
  updateState({ selectedMode: mode });
  if (state.status.gateway === 'on' && !state.busy) await gatewayOn();
}

// ---------------------------------------------------------------------- RDP

/** Brings the FreeRDP window forward once it exists: it is born behind every other window. */
async function raiseRdpWindow(host: string): Promise<boolean> {
  const result = await runPowerShellScript(scriptPath('raise-window.ps1'), ['-Match', host], {
    timeoutMs: 150_000,
  });
  return result.stdout.includes('OK');
}

async function rdpLogTail(limit = 12): Promise<string[]> {
  let lines: string[];
  try {
    lines = (await readFile(rdpLogFile(), 'utf8')).split(/\r?\n/).filter((line) => line.trim());
  } catch (error) {
    return [`(não consegui ler ${rdpLogFile()}: ${(error as Error).message})`];
  }
  if (!lines.length) return ['(vazio - o rdp-connect não chegou a escrever nada)'];
  // FreeRDP is very verbose; the known noise only gets in the way.
  const noise = ['set_termianl_nonblock', 'load_map_from_xkbfile', 'no RDP scancode found'];
  const useful = lines.filter((line) => !noise.some((item) => line.includes(item)));
  return (useful.length ? useful : lines).slice(-limit);
}

/**
 * Opens RDP in a separate, detached process: closing or reopening it never drops the VPN.
 * Always a clean session: ends the previous one and restarts the WSLg graphics host first,
 * since after sleep/resume it can create windows that never get painted.
 */
export async function openRdp(): Promise<void> {
  const config = await readConfig();
  if (!config.RDP_HOST) throw new HttpError(400, 'Preencha o host e o usuário do RDP em Configurações.');
  if (state.rdpOpening) throw new HttpError(409, 'O RDP já está abrindo.');
  updateState({ rdpOpening: true });
  say(`Abrindo RDP: ${config.RDP_HOST} (aguarde a janela)`, 'step');
  try {
    await wsl(config.WSL_DISTRO, ['pkill', '-x', 'xfreerdp3'], { timeoutMs: 15_000 });
    const reset = await runPowerShellScript(scriptPath('wslg-reset.ps1'), [], { timeoutMs: 45_000 });
    if (!reset.stdout.includes('OK')) say('Aviso: o host gráfico do WSLg demorou a voltar.', 'warn');
    // Gives the new msrdc time to finish connecting to WSLg before a window is created.
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const logFd = openSync(rdpLogFile(), 'w');
    try {
      spawn('wsl.exe', ['-d', config.WSL_DISTRO, '--', 'rdp-connect'], {
        detached: true,
        windowsHide: true,
        stdio: ['ignore', logFd, logFd],
        env: { ...process.env, WSL_UTF8: '1' },
      }).unref();
    } finally {
      closeSync(logFd);
    }

    if (await raiseRdpWindow(config.RDP_HOST)) {
      say('Sessão RDP em primeiro plano.', 'ok');
    } else {
      say('A janela do RDP não apareceu. Saída do rdp-connect:', 'error');
      for (const line of await rdpLogTail()) say(`  ${line}`);
    }
  } finally {
    updateState({ rdpOpening: false });
  }
}
