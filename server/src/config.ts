import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { configFile, paths } from './paths.ts';

/**
 * Everything the app and the Linux scripts need, except secrets.
 * Passwords never live on Windows: they go straight to the WSL vault (/etc/vpnwsl.secrets).
 */
export const configKeys = [
  'WSL_DISTRO',
  'LINUX_USER',
  'VPN_HOST',
  'VPN_PORT',
  'VPN_USER',
  'VPN_TRUSTED_CERT',
  'VPN_OTP_REQUIRED',
  'VPN_OTP_DELAY',
  'RDP_HOST',
  'RDP_USER',
  'RDP_DOMAIN',
  'RDP_RESOLUTION',
  'RDP_EXTRA_OPTS',
  'GATEWAY_ROUTES',
  'GATEWAY_DNS_SUFFIXES',
  'GATEWAY_MODE',
] as const;

export type ConfigKey = (typeof configKeys)[number];
export type Config = Record<ConfigKey, string>;

export const gatewayModes = ['empresa', 'm365', 'tudo'] as const;
export type GatewayMode = (typeof gatewayModes)[number];

export const defaultConfig: Config = {
  WSL_DISTRO: 'Ubuntu-24.04',
  LINUX_USER: '',
  VPN_HOST: '',
  VPN_PORT: '10443',
  VPN_USER: '',
  VPN_TRUSTED_CERT: '',
  VPN_OTP_REQUIRED: '1',
  VPN_OTP_DELAY: '2',
  RDP_HOST: '',
  RDP_USER: '',
  RDP_DOMAIN: '',
  RDP_RESOLUTION: 'fullscreen',
  RDP_EXTRA_OPTS: '/clipboard /dynamic-resolution /floatbar:sticky:off,default:visible,show:always',
  GATEWAY_ROUTES: '10.0.0.0/8 172.16.0.0/12',
  GATEWAY_DNS_SUFFIXES: '',
  GATEWAY_MODE: 'empresa',
};

const secretKeyPattern = /_PASSWORD$/;

/** Parses KEY=value lines (bash/PowerShell style), dropping any *_PASSWORD entry. */
export function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match || secretKeyPattern.test(match[1])) continue;
    let value = match[2].trim();
    if (value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

export function pickConfig(values: Record<string, string>): Config {
  const config = { ...defaultConfig };
  for (const key of configKeys) if (values[key] !== undefined) config[key] = values[key];
  return config;
}

export function configExists(): boolean {
  return existsSync(configFile());
}

export async function readConfig(): Promise<Config> {
  if (!configExists()) return { ...defaultConfig };
  return pickConfig(parseEnv(await readFile(configFile(), 'utf8')));
}

const header = `# WSL-Vpn configuration (managed by the app; edit it in Configuracoes).
# No passwords here: they are stored in the WSL vault (/etc/vpnwsl.secrets, 600 root:root).
# This file is copied to /etc/vpnwsl.env and sourced by the Linux scripts.
`;

export async function writeConfig(config: Config): Promise<void> {
  // Values are validated to be safe inside double quotes for both bash and PowerShell.
  const body = configKeys.map((key) => `${key}="${config[key]}"`).join('\n');
  await mkdir(paths.dataDir, { recursive: true });
  const tmp = configFile() + '.tmp';
  await writeFile(tmp, `${header}\n${body}\n`, 'utf8');
  await rename(tmp, configFile());
}

export function splitList(value: string): string[] {
  return value.split(/[\s,;]+/).filter(Boolean);
}
