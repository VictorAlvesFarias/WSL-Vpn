import { readFile, rm } from 'node:fs/promises';
import { exec } from './exec.ts';
import { gatewayResultFile, scriptPath } from './paths.ts';

/** PowerShell single-quoted literal. */
const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;

/**
 * Runs gateway.ps1 as administrator (one UAC prompt per call): Windows routes and DNS rules
 * need elevation, while the app itself runs unelevated. The elevated process can't return its
 * output, so the script writes "OK"/"ERRO" plus messages to a result file.
 */
export async function runGatewayElevated(params: string[]): Promise<{ ok: boolean; lines: string[] }> {
  const resultFile = gatewayResultFile();
  await rm(resultFile, { force: true });
  const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptPath('gateway.ps1'), ...params, '-Result', resultFile];
  // Start-Process joins the arguments with spaces and no quoting: anything with a space
  // (a path, for instance) has to carry its own double quotes.
  const argumentList = args.map((arg) => quote(arg.includes(' ') ? `"${arg}"` : arg)).join(',');
  const command = `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList ${argumentList}`;
  const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeoutMs: 180_000 });
  if (result.code !== 0) return { ok: false, lines: ['Permissão de administrador negada (UAC).'] };

  let text: string;
  try {
    text = await readFile(resultFile, 'utf8');
  } catch {
    return { ok: false, lines: ['O gateway.ps1 não devolveu resultado.'] };
  }
  const lines = text
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: lines[0] === 'OK', lines: lines.slice(1) };
}

/** Installs the WSL platform itself, which needs administrator rights and usually a reboot. */
export async function installWslElevated(): Promise<boolean> {
  const command = "Start-Process wsl.exe -Verb RunAs -Wait -ArgumentList '--install','--no-distribution'";
  const result = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { timeoutMs: 1_800_000 });
  return result.code === 0;
}
