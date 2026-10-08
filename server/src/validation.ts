import { configKeys, defaultConfig, gatewayModes, splitList, type Config, type ConfigKey } from './config.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);

// Values end up double-quoted in a file that bash sources and PowerShell parses,
// and some are interpolated into shell commands, so these characters never get through.
const unsafe = /["$`\\\r\n\0]/;

const hostname = /^[A-Za-z0-9.-]+$/;
const cidr = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

const rules: Partial<Record<ConfigKey, [RegExp, string]>> = {
  WSL_DISTRO: [/^[A-Za-z0-9._-]+$/, 'Distro inválida (ex.: Ubuntu-24.04)'],
  LINUX_USER: [/^[a-z_][a-z0-9_-]{0,31}$/, 'Usuário do Linux inválido (minúsculas, números, _ e -)'],
  VPN_HOST: [hostname, 'Host da VPN inválido'],
  VPN_TRUSTED_CERT: [/^([0-9a-f]{64})?$/, 'Fingerprint deve ter 64 caracteres hexadecimais (ou ficar vazio)'],
  VPN_OTP_REQUIRED: [/^[01]$/, 'OTP obrigatório deve ser 0 ou 1'],
  VPN_OTP_DELAY: [/^([0-9]|[12][0-9]|30)$/, 'Atraso do OTP deve ser de 0 a 30 segundos'],
  RDP_HOST: [/^([A-Za-z0-9.-]+)?$/, 'Host do RDP inválido'],
  RDP_RESOLUTION: [/^(fullscreen|\d{3,5}x\d{3,5})$/, 'Resolução deve ser "fullscreen" ou LARGURAxALTURA'],
};

const labels: Record<ConfigKey, string> = {
  WSL_DISTRO: 'Distro',
  LINUX_USER: 'Usuário do Linux',
  VPN_HOST: 'Host da VPN',
  VPN_PORT: 'Porta da VPN',
  VPN_USER: 'Usuário da VPN',
  VPN_TRUSTED_CERT: 'Fingerprint do certificado',
  VPN_OTP_REQUIRED: 'OTP obrigatório',
  VPN_OTP_DELAY: 'Atraso do OTP',
  RDP_HOST: 'Host do RDP',
  RDP_USER: 'Usuário do RDP',
  RDP_DOMAIN: 'Domínio do RDP',
  RDP_RESOLUTION: 'Resolução do RDP',
  RDP_EXTRA_OPTS: 'Opções extras do RDP',
  GATEWAY_ROUTES: 'Redes da empresa',
  GATEWAY_DNS_SUFFIXES: 'Domínios internos',
  GATEWAY_MODE: 'Modo inicial',
};

export function parseConfig(body: Record<string, unknown>): Config {
  const config = { ...defaultConfig };
  for (const key of configKeys) {
    const raw = body[key] ?? defaultConfig[key];
    if (typeof raw !== 'string') throw badRequest(`${labels[key]} inválido`);
    const value = raw.trim();
    if (unsafe.test(value)) throw badRequest(`${labels[key]} não pode conter aspas, $, \` ou \\`);
    if (value.length > 400) throw badRequest(`${labels[key]} é muito longo`);
    const rule = rules[key];
    if (rule && !rule[0].test(value)) throw badRequest(rule[1]);
    config[key] = value;
  }

  const port = Number(config.VPN_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw badRequest('Porta da VPN inválida');
  if (!config.VPN_HOST || !config.VPN_USER || !config.LINUX_USER) {
    throw badRequest('Preencha usuário do Linux, host e usuário da VPN');
  }
  if (!splitList(config.GATEWAY_ROUTES).every((route) => cidr.test(route))) {
    throw badRequest('Redes da empresa devem estar no formato 10.0.0.0/8, separadas por espaço');
  }
  if (!splitList(config.GATEWAY_DNS_SUFFIXES).every((suffix) => /^\.?[A-Za-z0-9.-]+$/.test(suffix))) {
    throw badRequest('Domínios internos inválidos (ex.: .empresa.local)');
  }
  if (!(gatewayModes as readonly string[]).includes(config.GATEWAY_MODE)) throw badRequest('Modo inicial inválido');
  return config;
}

export function parseGatewayMode(value: unknown) {
  if (typeof value !== 'string' || !(gatewayModes as readonly string[]).includes(value)) {
    throw badRequest('Modo inválido');
  }
  return value as (typeof gatewayModes)[number];
}

/** A single-line secret: newlines would let it spill into other vault entries. */
export function parseSecret(value: unknown, label: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw badRequest(`${label} inválida`);
  if (/[\r\n\0]/.test(value)) throw badRequest(`${label} não pode ter quebras de linha`);
  if (value.length > 500) throw badRequest(`${label} é muito longa`);
  return value;
}
