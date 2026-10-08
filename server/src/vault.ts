import { say } from './events.ts';
import { mutate, readData } from './store.ts';
import { HttpError } from './validation.ts';
import { helper } from './wsl.ts';

/**
 * Secrets live only in the WSL vault (/etc/vpnwsl.secrets, 600 root:root), named KIND_ID.
 * Values travel through stdin and, except the authenticator key (needed to compute codes on
 * Windows), never leave the vault.
 */
export type SecretKind = 'VPN_PASSWORD' | 'TOTP_SECRET';

export const secretName = (kind: SecretKind, id: string) => `${kind}_${id}`;

/** vpn-helper version this app needs (see setup.ps1). The original panel's helper is 1. */
export const requiredHelperVersion = 3;

let helperVersionCache: number | null | undefined;

export async function helperVersion(distro: string, refresh = false): Promise<number | null> {
  if (helperVersionCache !== undefined && !refresh) return helperVersionCache;
  try {
    const result = await helper(distro, ['version'], { timeoutMs: 20_000 });
    const version = Number(result.stdout.trim());
    // Version 1 has no "version" command; it prints its usage and fails.
    helperVersionCache = result.code === 0 && version > 0 ? version : result.stderr.includes('uso:') ? 1 : null;
  } catch {
    helperVersionCache = null;
  }
  return helperVersionCache;
}

export function forgetHelperVersion(): void {
  helperVersionCache = undefined;
}

async function requireCurrentHelper(distro: string): Promise<void> {
  const version = await helperVersion(distro);
  if ((version ?? 0) < requiredHelperVersion) {
    throw new HttpError(409, 'Os comandos do Ubuntu estão desatualizados: clique em "Atualizar agora" (ou rode a Instalação).');
  }
}

/** Names of the stored secrets; an empty set when the vault isn't reachable. */
export async function secretNames(distro: string): Promise<Set<string>> {
  if ((await helperVersion(distro)) !== requiredHelperVersion) return new Set();
  const result = await helper(distro, ['names'], { timeoutMs: 20_000 });
  return new Set(result.code === 0 ? result.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : []);
}

export async function getSecret(distro: string, name: string): Promise<string> {
  await requireCurrentHelper(distro);
  const result = await helper(distro, ['get', name], { timeoutMs: 20_000 });
  return result.code === 0 ? result.stdout.replace(/\r?\n$/, '') : '';
}

/** Stores a secret ("" removes it). */
export async function setSecret(distro: string, name: string, value: string): Promise<void> {
  await requireCurrentHelper(distro);
  const result = await helper(distro, ['set-secret', name], { input: value + '\n', timeoutMs: 20_000 });
  if (result.code !== 0) throw new HttpError(500, (result.stdout + result.stderr).trim() || 'Falha ao gravar no cofre do WSL.');
}

/** Removes every secret of a connection. */
export async function forgetSecrets(distro: string, id: string): Promise<void> {
  if ((await helperVersion(distro)) !== requiredHelperVersion) return;
  await helper(distro, ['forget', id], { timeoutMs: 20_000 });
}

/**
 * Renames the single-connection secrets (VPN_PASSWORD, TOTP_SECRET) to the id of the migrated
 * connection and drops the old RDP password. Runs entirely inside WSL; values never leave it.
 */
export async function migrateLegacySecrets(distro: string): Promise<void> {
  const { legacySecrets } = await readData();
  if (!legacySecrets || (await helperVersion(distro)) !== requiredHelperVersion) return;
  const result = await helper(distro, ['migrate-legacy', legacySecrets.vpnId], { timeoutMs: 20_000 });
  if (result.code !== 0) {
    say(`Falha ao migrar as senhas antigas: ${(result.stdout + result.stderr).trim()}`, 'error');
    return;
  }
  await mutate((data) => {
    delete data.legacySecrets;
  });
  say('Senhas e autenticador da configuração antiga movidos para a conexão migrada.', 'ok');
}
