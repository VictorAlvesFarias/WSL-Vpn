import type { Config, GatewayMode, SystemInfo, TotpCode, VaultSecret, VaultStatus } from './types';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: {
      'x-wsl-vpn': '1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `Erro ${response.status}`);
  return data as T;
}

export const api = {
  config: () => request<{ exists: boolean; values: Config }>('GET', '/config'),
  saveConfig: (values: Config) => request<{ exists: boolean; values: Config }>('PUT', '/config', values),
  applyConfig: () => request<{ ok: boolean }>('POST', '/config/apply'),

  system: () => request<SystemInfo>('GET', '/system'),
  install: (body: { linuxPassword: string; vpnPassword: string; rdpPassword: string; updateCert: boolean }) =>
    request<{ ok: boolean; code: number }>('POST', '/system/install', body),
  installWsl: () => request<{ ok: boolean }>('POST', '/system/install-wsl'),

  vault: () => request<VaultStatus>('GET', '/vault'),
  setSecret: (name: VaultSecret, value: string) => request<VaultStatus>('PUT', `/vault/${name}`, { value }),

  connect: (otp: string) => request<{ ok: boolean }>('POST', '/vpn/connect', { otp }),
  disconnect: () => request<{ ok: boolean }>('POST', '/vpn/disconnect'),
  openRdp: () => request<{ ok: boolean }>('POST', '/rdp/open'),
  gatewayOn: () => request<{ ok: boolean }>('POST', '/gateway/on'),
  gatewayOff: () => request<{ ok: boolean }>('POST', '/gateway/off'),
  setMode: (mode: GatewayMode) => request<{ ok: boolean }>('PUT', '/gateway/mode', { mode }),

  totp: () => request<TotpCode & { enabled: boolean }>('GET', '/totp'),
  previewTotp: (secret: string) => request<TotpCode & { valid: boolean }>('POST', '/totp/preview', { secret }),
  saveTotp: (secret: string) => request<{ enabled: boolean }>('PUT', '/totp', { secret }),
  removeTotp: () => request<{ enabled: boolean }>('DELETE', '/totp'),
};
