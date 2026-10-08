import { exec, type ExecOptions } from './exec.ts';

// Makes wsl.exe print its own messages as UTF-8 instead of UTF-16.
const wslEnv = { WSL_UTF8: '1' };

/**
 * Runs a program inside the distro as the default user. --exec skips the default shell, so
 * every argument arrives literally (with "--" wsl.exe would hand the joined line to a shell).
 */
export function wslExec(distro: string, args: string[], options: ExecOptions = {}) {
  return exec('wsl.exe', ['-d', distro, '--exec', ...args], { ...options, env: { ...wslEnv, ...options.env } });
}

/** Runs a bash script in a login shell; extra arguments are available as "$@". */
export function bash(distro: string, script: string, args: string[] = [], options: ExecOptions = {}) {
  return wslExec(distro, ['bash', '-lc', script, 'wsl-vpn', ...args], options);
}

/** Runs a vpn-helper subcommand; it is the only binary the sudoers rule allows. */
export function helper(distro: string, args: string[], options: ExecOptions = {}) {
  return wslExec(distro, ['sudo', '-n', '/usr/local/sbin/vpn-helper', ...args], options);
}

export async function isWslInstalled(): Promise<boolean> {
  try {
    return (await exec('wsl.exe', ['--version'], { env: wslEnv, timeoutMs: 15_000 })).code === 0;
  } catch {
    return false;
  }
}

export async function listDistros(): Promise<string[]> {
  try {
    const result = await exec('wsl.exe', ['-l', '-q'], { env: wslEnv, timeoutMs: 15_000 });
    if (result.code !== 0) return [];
    return result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}
