import { configExists, parseEnv, pickConfig, readConfig, writeConfig } from './config.ts';
import { installWslElevated } from './elevated.ts';
import { say, state, updateState } from './events.ts';
import { runPowerShellScript } from './exec.ts';
import { refreshStatus, refreshTotpEnabled } from './panel.ts';
import { configFile, scriptPath } from './paths.ts';
import { HttpError } from './validation.ts';
import { helper, isWslInstalled, listDistros, wsl } from './wsl.ts';

/** Version of vpn-helper this app expects (see setup.ps1). The original panel's helper is 1. */
export const expectedHelperVersion = 2;

export interface SystemInfo {
  wslInstalled: boolean;
  distro: string;
  distroInstalled: boolean;
  /** vpn-up and vpn-helper are installed in the distro. */
  configured: boolean;
  helperVersion: number | null;
  configExists: boolean;
  configPath: string;
}

export async function systemInfo(): Promise<SystemInfo> {
  const config = await readConfig();
  const info: SystemInfo = {
    wslInstalled: await isWslInstalled(),
    distro: config.WSL_DISTRO,
    distroInstalled: false,
    configured: false,
    helperVersion: null,
    configExists: configExists(),
    configPath: configFile(),
  };
  if (!info.wslInstalled) return info;
  info.distroInstalled = (await listDistros()).includes(config.WSL_DISTRO);
  if (!info.distroInstalled) return info;

  const result = await wsl(
    config.WSL_DISTRO,
    ['bash', '-lc', 'command -v vpn-up >/dev/null && echo UP=yes; echo HELPER=$(sudo -n vpn-helper version 2>/dev/null)'],
    { timeoutMs: 30_000 },
  );
  info.configured = result.stdout.includes('UP=yes');
  const version = /HELPER=(\d+)/.exec(result.stdout);
  // The original helper has no "version" command but is installed alongside vpn-up.
  info.helperVersion = version ? Number(version[1]) : info.configured ? 1 : null;
  return info;
}

/**
 * First run with an existing installation (e.g. from the original panel): the distro keeps a
 * copy of the configuration, without passwords, in /etc/vpnwsl.env.
 */
export async function importConfigFromDistro(): Promise<boolean> {
  if (configExists()) return false;
  const distro = (await readConfig()).WSL_DISTRO;
  if (!(await listDistros()).includes(distro)) return false;
  const result = await wsl(distro, ['cat', '/etc/vpnwsl.env'], { timeoutMs: 30_000 });
  if (result.code !== 0 || !result.stdout.includes('VPN_HOST')) return false;
  await writeConfig(pickConfig({ WSL_DISTRO: distro, ...parseEnv(result.stdout) }));
  say('Configuração importada do Ubuntu já instalado (/etc/vpnwsl.env).', 'ok');
  return true;
}

function exclusiveTask(label: string) {
  if (state.busy) throw new HttpError(409, `Aguarde: ${state.busy}`);
  updateState({ busy: label });
  return () => {
    updateState({ busy: null });
    void refreshStatus();
  };
}

export interface InstallOptions {
  linuxPassword: string;
  vpnPassword: string;
  rdpPassword: string;
  updateCert: boolean;
}

/** Runs install.ps1, streaming its output to the log. Returns its exit code. */
export async function runInstall(options: InstallOptions): Promise<number> {
  if (!configExists()) throw new HttpError(400, 'Salve a configuração antes de instalar.');
  const done = exclusiveTask('Instalando');
  try {
    say('Instalação iniciada. O WSL será reiniciado: a VPN, se conectada, vai cair.', 'step');
    // Passwords travel through stdin as base64 JSON: never on a command line, and immune to
    // the console code page.
    const payload = Buffer.from(
      JSON.stringify({ linuxPassword: options.linuxPassword, vpnPassword: options.vpnPassword, rdpPassword: options.rdpPassword }),
      'utf8',
    ).toString('base64');
    const args = ['-Config', configFile(), '-SecretsFromStdin', ...(options.updateCert ? ['-UpdateCert'] : [])];
    const result = await runPowerShellScript(scriptPath('install.ps1'), args, {
      input: payload + '\n',
      timeoutMs: 30 * 60_000,
      onLine: (line) => say(line),
    });
    if (result.code === 0) say('Instalação concluída.', 'ok');
    else say(`A instalação terminou com erro (código ${result.code}).`, 'error');
    return result.code;
  } finally {
    done();
    void refreshTotpEnabled();
  }
}

/** Re-applies the configuration inside Ubuntu (setup.ps1 -OnlyConfig): fast, no packages. */
export async function applyConfig(): Promise<number> {
  const config = await readConfig();
  const done = exclusiveTask('Aplicando a configuração no Ubuntu');
  try {
    say('Aplicando a configuração no Ubuntu...', 'step');
    const result = await runPowerShellScript(
      scriptPath('setup.ps1'),
      ['-Distro', config.WSL_DISTRO, '-Config', configFile(), '-OnlyConfig'],
      { timeoutMs: 5 * 60_000, onLine: (line) => say(line) },
    );
    if (result.code !== 0) say('Falha ao aplicar a configuração.', 'error');
    return result.code;
  } finally {
    done();
  }
}

export async function installWsl(): Promise<boolean> {
  const done = exclusiveTask('Instalando o WSL');
  try {
    say('Instalando o WSL (confirme o UAC). Ao terminar, reinicie o Windows.', 'step');
    const ok = await installWslElevated();
    say(ok ? 'WSL instalado. Reinicie o Windows e volte para concluir a instalação.' : 'Instalação do WSL cancelada ou falhou.', ok ? 'ok' : 'error');
    return ok;
  } finally {
    done();
  }
}

// -------------------------------------------------------------------- vault

export const vaultSecrets = ['VPN_PASSWORD', 'RDP_PASSWORD'] as const;
export type VaultSecret = (typeof vaultSecrets)[number];

/** Which secrets are stored. Values never leave this process. */
export async function vaultStatus(): Promise<Record<VaultSecret | 'TOTP_SECRET', boolean>> {
  const distro = (await readConfig()).WSL_DISTRO;
  const has = async (name: string) =>
    (await helper(distro, ['get', name], { timeoutMs: 20_000 })).stdout.trim().length > 0;
  const [vpn, rdp, totp] = await Promise.all([has('VPN_PASSWORD'), has('RDP_PASSWORD'), has('TOTP_SECRET')]);
  return { VPN_PASSWORD: vpn, RDP_PASSWORD: rdp, TOTP_SECRET: totp };
}

export async function setVaultSecret(name: VaultSecret, value: string): Promise<void> {
  const distro = (await readConfig()).WSL_DISTRO;
  const result = await helper(distro, ['set-secret', name], { input: value + '\n', timeoutMs: 20_000 });
  if (result.code !== 0) {
    const message = (result.stdout + result.stderr).trim();
    throw new HttpError(
      result.code === 2 || /uso:/.test(message) ? 409 : 500,
      /uso:|desconhecido/.test(message)
        ? 'O Ubuntu tem os comandos da versão antiga: rode a Instalação (ou "Aplicar no Ubuntu") primeiro.'
        : message || 'Falha ao gravar no cofre do WSL.',
    );
  }
  say(`${name === 'VPN_PASSWORD' ? 'Senha da VPN' : 'Senha do RDP'} ${value ? 'salva no' : 'removida do'} cofre do WSL2.`, 'ok');
}
