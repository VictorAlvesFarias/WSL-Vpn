import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { exec } from './exec.ts';
import { say, state, updateState } from './events.ts';
import { gatewayResultFile, gatewayServiceDir, scriptPath } from './paths.ts';

/** PowerShell single-quoted literal. */
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Start-Process joins the arguments with spaces and no quoting: anything with a space carries its own quotes. */
const argumentList = (args: string[]) => args.map((arg) => quote(arg.includes(' ') ? `"${arg}"` : arg)).join(',');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function parseResult(text: string): { ok: boolean; lines: string[] } {
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: lines[0] === 'OK', lines: lines.slice(1) };
}

// ------------------------------------------------------------ elevated service

/**
 * The elevated helper (gateway-service.ps1): started with one UAC prompt when the app opens, it
 * runs gateway.ps1 on request until the app exits, so the tunnel never asks again. Without it
 * (prompt declined, or the option turned off) every tunnel change asks for its own UAC.
 */
const readyFile = () => join(gatewayServiceDir(), 'ready');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // An elevated process can't be signalled by an unelevated one, but it exists.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

async function servicePid(): Promise<number | null> {
  const pid = Number((await readFile(readyFile(), 'utf8').catch(() => '')).trim());
  return pid > 0 && alive(pid) ? pid : null;
}

let starting: Promise<boolean> | null = null;

/** Starts the elevated helper if it isn't running (one UAC prompt). Resolves to whether it is up. */
export function startGatewayService(): Promise<boolean> {
  starting ??= (async () => {
    try {
      if (await servicePid()) return true;
      await rm(readyFile(), { force: true });
      say('Pedindo permissão de administrador uma vez, para o túnel não pedir de novo enquanto o app estiver aberto (confirme o UAC)...', 'step');
      const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('gateway-service.ps1'), '-ParentPid', String(process.pid), '-Dir', gatewayServiceDir()];
      const command = `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList ${argumentList(args)}`;
      const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeoutMs: 180_000 });
      if (result.code !== 0) {
        say('Permissão de administrador negada: cada mudança no túnel vai pedir o UAC.', 'warn');
        return false;
      }
      for (let waited = 0; waited < 20_000; waited += 250) {
        if (await servicePid()) {
          say('Administrador concedido: o túnel não pede mais o UAC enquanto o app estiver aberto.', 'ok');
          return true;
        }
        await sleep(250);
      }
      say('O ajudante de administrador não respondeu: cada mudança no túnel vai pedir o UAC.', 'warn');
      return false;
    } finally {
      starting = null;
    }
  })().then((up) => {
    updateState({ elevated: up });
    return up;
  });
  return starting;
}

/** Keeps state.elevated true to what is running (the helper ends with the app, or if killed). */
export async function checkGatewayService(): Promise<boolean> {
  const up = (await servicePid()) !== null;
  if (up !== state.elevated) updateState({ elevated: up });
  return up;
}

async function runThroughService(params: string[]): Promise<{ ok: boolean; lines: string[] } | null> {
  if (!(await servicePid())) return null;
  const id = randomBytes(6).toString('hex');
  const dir = gatewayServiceDir();
  const request = join(dir, `${id}.req`);
  const result = join(dir, `${id}.res`);
  // Written aside and renamed, so the service never reads half a request.
  await writeFile(`${request}.tmp`, JSON.stringify(params), 'utf8');
  await rename(`${request}.tmp`, request);
  for (let waited = 0; waited < 180_000; waited += 200) {
    const text = await readFile(result, 'utf8').catch(() => null);
    // gateway.ps1 writes the whole file at once, at the end; an empty read is a write in progress.
    if (text?.trim()) {
      await rm(result, { force: true });
      return parseResult(text);
    }
    if (waited > 5_000 && !(await servicePid())) break;
    await sleep(200);
  }
  await rm(request, { force: true });
  await checkGatewayService();
  return null;
}

// --------------------------------------------------------------- gateway.ps1

/**
 * Runs gateway.ps1 as administrator: Windows routes and DNS rules need elevation, while the app
 * itself runs unelevated. Through the elevated helper when it is up; otherwise one UAC prompt per
 * call. The elevated process can't return its output, so the script writes "OK"/"ERRO" plus
 * messages to a result file.
 */
export async function runGatewayElevated(params: string[]): Promise<{ ok: boolean; lines: string[] }> {
  const viaService = await runThroughService(params);
  if (viaService) return viaService;

  const resultFile = gatewayResultFile();
  await rm(resultFile, { force: true });
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('gateway.ps1'), ...params, '-Result', resultFile];
  const command = `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList ${argumentList(args)}`;
  const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeoutMs: 180_000 });
  if (result.code !== 0) return { ok: false, lines: ['Permissão de administrador negada (UAC).'] };

  try {
    return parseResult(await readFile(resultFile, 'utf8'));
  } catch {
    return { ok: false, lines: ['O gateway.ps1 não devolveu resultado.'] };
  }
}

/** Installs the WSL platform itself, which needs administrator rights and usually a reboot. */
export async function installWslElevated(): Promise<boolean> {
  const command = "Start-Process wsl.exe -Verb RunAs -Wait -ArgumentList '--install','--no-distribution'";
  const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeoutMs: 1_800_000 });
  return result.code === 0;
}
