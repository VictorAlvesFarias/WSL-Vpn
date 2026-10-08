import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { paths } from './paths.ts';
import { HttpError } from './validation.ts';

/** Ubuntu side, shared by every connection. */
export interface Settings {
  distro: string;
  linuxUser: string;
}

/**
 * What Windows sends through this connection while it is up:
 * off - nothing (only Linux uses the VPN); global - every IPv4 destination; specific - the targets.
 */
export type TunnelMode = 'off' | 'global' | 'specific';
export const tunnelModes: readonly TunnelMode[] = ['off', 'global', 'specific'];

export interface Tunnel {
  mode: TunnelMode;
  /** Specific mode: also the official Microsoft 365 ranges (Teams, Outlook, OneDrive). */
  m365: boolean;
  /** Specific mode: networks (10.0.0.0/8), IPs, host names (intranet.company.com) or domains (*.company.local). */
  targets: string[];
}

export const emptyTunnel = (): Tunnel => ({ mode: 'off', m365: false, targets: [] });

/** Tunnels saved before the mode existed had enabled/global flags. */
function normalizeTunnel(raw: Partial<Tunnel> & { enabled?: boolean; global?: boolean }): Tunnel {
  const mode = raw.mode ?? (raw.enabled ? (raw.global ? 'global' : 'specific') : 'off');
  return { mode, m365: Boolean(raw.m365), targets: raw.targets ?? [] };
}

/** A Fortinet SSL-VPN connection. Its password and authenticator key live in the WSL vault. */
export interface Connection {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  trustedCert: string;
  otpRequired: boolean;
  otpDelay: number;
  tunnel: Tunnel;
}

export interface Data {
  settings: Settings;
  connections: Connection[];
  /** Id that the single-connection vault secrets must be renamed to (see vpn-helper migrate-legacy). */
  legacySecrets?: { vpnId: string };
}

const dataFile = () => join(paths.dataDir, 'data.json');
const legacyConfigFile = () => join(paths.dataDir, 'config.env');

export const newId = () => randomBytes(4).toString('hex');

function emptyData(): Data {
  return { settings: { distro: 'Ubuntu-24.04', linuxUser: '' }, connections: [] };
}

/** Parses KEY=value lines (bash/PowerShell style), dropping any *_PASSWORD entry. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || /_PASSWORD$/.test(match[1])) continue;
    let value = match[2].trim();
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

const splitList = (value = '') => value.split(/[\s,;]+/).filter(Boolean);

/**
 * Turns the single-connection configuration (original panel / first app version) into the new
 * model. Its RDP settings are dropped: RDP now runs on Windows itself, through the tunnel.
 */
export function fromLegacyEnv(env: Record<string, string>): Data {
  const data = emptyData();
  data.settings = { distro: env.WSL_DISTRO || 'Ubuntu-24.04', linuxUser: env.LINUX_USER ?? '' };
  if (env.VPN_HOST) {
    const vpnId = newId();
    data.connections.push({
      id: vpnId,
      name: env.VPN_HOST.split('.')[0] || 'VPN',
      host: env.VPN_HOST,
      port: Number(env.VPN_PORT) || 10443,
      user: env.VPN_USER ?? '',
      trustedCert: env.VPN_TRUSTED_CERT ?? '',
      otpRequired: env.VPN_OTP_REQUIRED !== '0',
      otpDelay: Number(env.VPN_OTP_DELAY) || 2,
      tunnel: {
        mode: 'off',
        m365: env.GATEWAY_MODE === 'm365',
        targets: [
          ...splitList(env.GATEWAY_ROUTES),
          ...splitList(env.GATEWAY_DNS_SUFFIXES).map((suffix) => `*.${suffix.replace(/^\.+/, '')}`),
        ],
      },
    });
    data.legacySecrets = { vpnId };
  }
  return data;
}

async function writeData(data: Data): Promise<void> {
  await mkdir(paths.dataDir, { recursive: true });
  const tmp = dataFile() + '.tmp';
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, dataFile());
}

export function dataExists(): boolean {
  return existsSync(dataFile());
}

/**
 * Creates data.json from the first app version's config.env, if there is one.
 * Returns whether something was migrated.
 */
export async function migrateLegacyConfigFile(): Promise<boolean> {
  if (dataExists() || !existsSync(legacyConfigFile())) return false;
  await writeData(fromLegacyEnv(parseEnv(await readFile(legacyConfigFile(), 'utf8'))));
  await rename(legacyConfigFile(), legacyConfigFile() + '.migrated');
  return true;
}

export async function importLegacyEnv(text: string): Promise<void> {
  if (!dataExists()) await writeData(fromLegacyEnv(parseEnv(text)));
}

export async function readData(): Promise<Data> {
  if (!dataExists()) return emptyData();
  const { settings, connections, legacySecrets } = JSON.parse(await readFile(dataFile(), 'utf8')) as Data;
  return {
    settings,
    connections: connections.map((c) => ({ ...c, tunnel: normalizeTunnel(c.tunnel ?? {}) })),
    ...(legacySecrets ? { legacySecrets } : {}),
  };
}

// Serialize writes so concurrent requests can't clobber each other.
let queue: Promise<unknown> = Promise.resolve();
export function mutate<T>(fn: (data: Data) => T | Promise<T>): Promise<T> {
  const next = queue.then(async () => {
    const data = await readData();
    const result = await fn(data);
    await writeData(data);
    return result;
  });
  queue = next.catch(() => undefined);
  return next;
}

export async function getConnection(id: string): Promise<Connection> {
  const connection = (await readData()).connections.find((c) => c.id === id);
  if (!connection) throw new HttpError(404, 'Conexão não encontrada');
  return connection;
}

export async function getSettings(): Promise<Settings> {
  return (await readData()).settings;
}
