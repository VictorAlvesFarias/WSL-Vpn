import { exec, type ExecOptions } from './exec.ts';

// Makes wsl.exe print its own messages as UTF-8 instead of UTF-16.
const wslEnv = { WSL_UTF8: '1' };

/** Runs a command inside the distro as the default (configured) user. */
export function wsl(distro: string, args: string[], options: ExecOptions = {}) {
  return exec('wsl.exe', ['-d', distro, '--', ...args], { ...options, env: { ...wslEnv, ...options.env } });
}

/** Runs a vpn-helper subcommand; it is the only binary the sudoers rule allows. */
export function helper(distro: string, args: string[], options: ExecOptions = {}) {
  return wsl(distro, ['sudo', '-n', 'vpn-helper', ...args], options);
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
