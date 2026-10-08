import { installWslElevated } from './elevated.ts';
import { dataChanged, say, state, updateState } from './events.ts';
import { runPowerShellScript } from './exec.ts';
import { refreshStatus } from './panel.ts';
import { scriptPath } from './paths.ts';
import { dataExists, getSettings, importLegacyEnv, migrateLegacyConfigFile } from './store.ts';
import { HttpError } from './validation.ts';
import { forgetHelperVersion, helperVersion, migrateLegacySecrets, requiredHelperVersion } from './vault.ts';
import { isWslInstalled, listDistros, wslExec } from './wsl.ts';

export interface SystemInfo {
  wslInstalled: boolean;
  distro: string;
  distroInstalled: boolean;
  /** vpn-helper version in the distro (null when not installed). */
  helperVersion: number | null;
  requiredHelperVersion: number;
  settingsSaved: boolean;
}

export async function systemInfo(): Promise<SystemInfo> {
  const settings = await getSettings();
  const info: SystemInfo = {
    wslInstalled: await isWslInstalled(),
    distro: settings.distro,
    distroInstalled: false,
    helperVersion: null,
    requiredHelperVersion,
    settingsSaved: Boolean(settings.linuxUser),
  };
  if (!info.wslInstalled) return info;
  info.distroInstalled = (await listDistros()).includes(settings.distro);
  if (info.distroInstalled) info.helperVersion = await helperVersion(settings.distro, true);
  return info;
}

/**
 * First run: brings in the single-connection configuration of an existing installation, either
 * from the first app version (config.env) or from the original panel (/etc/vpnwsl.env in the
 * distro). Its secrets are renamed once the Ubuntu commands are up to date.
 */
export async function importExistingSetup(): Promise<void> {
  if (dataExists()) return;
  if (await migrateLegacyConfigFile()) {
    say('Configuração anterior convertida em uma conexão VPN.', 'ok');
    return;
  }
  const distro = (await getSettings()).distro;
  if (!(await listDistros()).includes(distro)) return;
  const result = await wslExec(distro, ['cat', '/etc/vpnwsl.env'], { timeoutMs: 30_000 });
  if (result.code !== 0 || !result.stdout.includes('VPN_HOST')) return;
  await importLegacyEnv(result.stdout);
  say('Configuração do Ubuntu já instalado importada como uma conexão VPN.', 'ok');
}

function exclusiveTask(label: string) {
  if (state.busy) throw new HttpError(409, `Aguarde: ${state.busy}`);
  updateState({ busy: label });
  return () => {
    updateState({ busy: null });
    void refreshStatus();
  };
}

/** After the commands change: re-check the helper, rename legacy secrets, refresh the UI. */
async function afterCommandsChanged(): Promise<void> {
  forgetHelperVersion();
  await migrateLegacySecrets((await getSettings()).distro);
  dataChanged();
}

/** Runs install.ps1, streaming its output to the log. Returns its exit code. */
export async function runInstall(linuxPassword: string): Promise<number> {
  const settings = await getSettings();
  if (!settings.linuxUser) throw new HttpError(400, 'Salve o usuário do Linux antes de instalar.');
  const done = exclusiveTask('Instalando');
  try {
    say('Instalação iniciada. O WSL será reiniciado: a VPN, se conectada, vai cair.', 'step');
    // The password travels through stdin as base64 JSON: never on a command line, and immune
    // to the console code page.
    const payload = Buffer.from(JSON.stringify({ linuxPassword }), 'utf8').toString('base64');
    const result = await runPowerShellScript(
      scriptPath('install.ps1'),
      ['-Distro', settings.distro, '-LinuxUser', settings.linuxUser, '-SecretsFromStdin'],
      { input: payload + '\n', timeoutMs: 30 * 60_000, onLine: (line) => say(line) },
    );
    if (result.code === 0) say('Instalação concluída.', 'ok');
    else say(`A instalação terminou com erro (código ${result.code}).`, 'error');
    await afterCommandsChanged();
    return result.code;
  } finally {
    done();
  }
}

/** Reinstalls only the Ubuntu commands, base config and sudoers (no packages, no WSL restart). */
export async function updateCommands(): Promise<number> {
  const settings = await getSettings();
  if (!settings.linuxUser) throw new HttpError(400, 'Salve o usuário do Linux em Instalação.');
  const done = exclusiveTask('Atualizando os comandos do Ubuntu');
  try {
    say('Atualizando os comandos do Ubuntu (a VPN conectada continua de pé)...', 'step');
    const result = await runPowerShellScript(
      scriptPath('setup.ps1'),
      ['-Distro', settings.distro, '-LinuxUser', settings.linuxUser, '-SkipPackages'],
      { timeoutMs: 5 * 60_000, onLine: (line) => say(line) },
    );
    if (result.code !== 0) say('Falha ao atualizar os comandos.', 'error');
    await afterCommandsChanged();
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

/** On startup: legacy secrets whose rename was pending (e.g. commands updated outside the app). */
export async function finishPendingMigration(): Promise<void> {
  try {
    await migrateLegacySecrets((await getSettings()).distro);
  } catch {
    // WSL unavailable: retried after the next install/update.
  }
}
