import { tunnelModes, type Connection, type Prefs, type Settings, type Tunnel, type TunnelMode } from './store.ts';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message: string) => new HttpError(400, message);

type Body = Record<string, unknown>;

// Values are passed as arguments to Linux commands and shown in the UI: no control characters,
// and none of the characters that would matter if a value ever reached a shell.
const unsafe = /["$`\\\r\n\0]/;
const hostname = /^[A-Za-z0-9.-]+$/;

function text(body: Body, field: string, label: string, { required = false, max = 200, pattern = undefined as RegExp | undefined, patternMessage = '' } = {}): string {
  const raw = body[field];
  if (raw !== undefined && raw !== null && typeof raw !== 'string') throw badRequest(`${label} inválido`);
  const value = (raw ?? '').trim();
  if (required && !value) throw badRequest(`${label} é obrigatório`);
  if (value.length > max) throw badRequest(`${label} é muito longo`);
  if (unsafe.test(value)) throw badRequest(`${label} não pode conter aspas, $, \` ou \\`);
  if (value && pattern && !pattern.test(value)) throw badRequest(patternMessage || `${label} inválido`);
  return value;
}

function integer(body: Body, field: string, label: string, min: number, max: number, fallback: number): number {
  const raw = body[field] ?? fallback;
  const value = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw badRequest(`${label} deve ser um número de ${min} a ${max}`);
  }
  return value;
}

export function parsePrefs(body: Body): Prefs {
  return { autoReconnect: body.autoReconnect === true, elevateOnStart: body.elevateOnStart === true };
}

export function parseSettings(body: Body): Settings {
  return {
    distro: text(body, 'distro', 'Distro', { required: true, pattern: /^[A-Za-z0-9._-]+$/, patternMessage: 'Distro inválida (ex.: Ubuntu-24.04)' }),
    linuxUser: text(body, 'linuxUser', 'Usuário do Linux', {
      required: true,
      max: 32,
      pattern: /^[a-z_][a-z0-9_-]{0,31}$/,
      patternMessage: 'Usuário do Linux inválido (minúsculas, números, _ e -)',
    }),
  };
}

const ipv4 = (value: string) => /^(\d{1,3}\.){3}\d{1,3}$/.test(value) && value.split('.').every((part) => Number(part) <= 255);

/**
 * Normalizes one tunnel target:
 *   10.0.0.0/8 or 10.1.2.3          -> network (an IP becomes /32)
 *   https://intranet.company.com/x  -> intranet.company.com (host: resolved via the company DNS and routed)
 *   *.company.local or .company.local -> *.company.local (domain: only its DNS goes to the company)
 */
export function parseTarget(input: string): string {
  let value = input.trim().toLowerCase();
  const cidr = /^(\d{1,3}(?:\.\d{1,3}){3})(?:\/(\d{1,2}))?$/.exec(value);
  if (cidr) {
    const bits = cidr[2] === undefined ? 32 : Number(cidr[2]);
    if (!ipv4(cidr[1]) || bits > 32) throw badRequest(`Destino inválido: ${input}`);
    return `${cidr[1]}/${bits}`;
  }
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '');
  const domain = /^(\*\.|\.)(.+)$/.exec(value);
  const name = domain ? domain[2] : value;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(name)) throw badRequest(`Destino inválido: ${input}`);
  if (ipv4(name)) return `${name}/32`;
  return domain ? `*.${name}` : name;
}

/** The tunnel is edited on the connection screen; an empty target list is fine while building it. */
export function parseTunnel(body: Body): Tunnel {
  if (!tunnelModes.includes(body.mode as TunnelMode)) throw badRequest('Modo do túnel inválido');
  const rawTargets = Array.isArray(body.targets) ? body.targets : [];
  if (rawTargets.some((item) => typeof item !== 'string')) throw badRequest('Destinos do túnel inválidos');
  const targets = [...new Set((rawTargets as string[]).filter((item) => item.trim()).map(parseTarget))];
  if (targets.length > 200) throw badRequest('Destinos demais (máximo 200)');
  return { mode: body.mode as TunnelMode, targets };
}

/** Connection fields edited in the modal (the tunnel has its own endpoint). */
export function parseConnection(body: Body): Omit<Connection, 'id' | 'tunnel'> {
  return {
    name: text(body, 'name', 'Nome', { required: true, max: 60 }),
    host: text(body, 'host', 'Gateway', { required: true, pattern: hostname, patternMessage: 'Gateway inválido (ex.: vpn.empresa.com.br)' }),
    port: integer(body, 'port', 'Porta', 1, 65535, 10443),
    user: text(body, 'user', 'Usuário da VPN', { required: true, max: 120 }),
    trustedCert: text(body, 'trustedCert', 'Fingerprint', {
      pattern: /^[0-9a-f]{64}$/,
      patternMessage: 'Fingerprint deve ter 64 caracteres hexadecimais (ou ficar vazio)',
    }).toLowerCase(),
    otpRequired: body.otpRequired !== false,
    otpDelay: integer(body, 'otpDelay', 'Atraso do OTP', 0, 30, 2),
  };
}

/** A single-line secret: newlines would let it spill into other vault entries. */
export function parseSecret(value: unknown, label: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw badRequest(`${label} inválida`);
  if (/[\r\n\0]/.test(value)) throw badRequest(`${label} não pode ter quebras de linha`);
  if (value.length > 500) throw badRequest(`${label} é muito longa`);
  return value;
}

/** undefined keeps the stored secret, "" removes it. */
export function optionalSecret(value: unknown, label: string): string | undefined {
  return value === undefined ? undefined : parseSecret(value, label);
}
