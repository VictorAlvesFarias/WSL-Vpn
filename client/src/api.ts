import type { AppData, Connection, ConnectionInput, Settings, SystemInfo, TotpCode } from './types';

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
  data: () => request<AppData>('GET', '/data'),
  saveSettings: (settings: Settings) => request<Settings>('PUT', '/settings', settings),

  system: () => request<SystemInfo>('GET', '/system'),
  install: (linuxPassword: string) => request<{ ok: boolean; code: number }>('POST', '/system/install', { linuxPassword }),
  updateCommands: () => request<{ ok: boolean }>('POST', '/system/update'),
  installWsl: () => request<{ ok: boolean }>('POST', '/system/install-wsl'),

  createConnection: (input: ConnectionInput) => request<Connection>('POST', '/connections', input),
  updateConnection: (id: string, input: ConnectionInput) => request<Connection>('PUT', `/connections/${id}`, input),
  deleteConnection: (id: string) => request<{ ok: boolean }>('DELETE', `/connections/${id}`),
  detectCertificate: (host: string, port: number) => request<{ fingerprint: string }>('POST', '/certificate', { host, port }),

  connect: (id: string, otp: string) => request<{ ok: boolean }>('POST', `/connections/${id}/connect`, { otp }),
  disconnect: () => request<{ ok: boolean }>('POST', '/vpn/disconnect'),
  tunnelOn: (id: string) => request<{ ok: boolean }>('POST', `/connections/${id}/tunnel`),
  tunnelOff: () => request<{ ok: boolean }>('POST', '/tunnel/off'),

  totp: (id: string) => request<TotpCode & { enabled: boolean }>('GET', `/connections/${id}/totp`),
  saveTotp: (id: string, secret: string) => request<{ enabled: boolean }>('PUT', `/connections/${id}/totp`, { secret }),
  removeTotp: (id: string) => request<{ enabled: boolean }>('DELETE', `/connections/${id}/totp`),
  previewTotp: (secret: string) => request<TotpCode & { valid: boolean }>('POST', '/totp/preview', { secret }),
};
