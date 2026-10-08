export type LogLevel = 'info' | 'step' | 'ok' | 'warn' | 'error';
export type TunnelState = 'off' | 'on' | 'partial';

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  text: string;
}

export interface VpnStatus {
  reachable: boolean;
  up: boolean;
  address: string;
  activeId: string | null;
  tunnel: TunnelState;
  tunnelGlobal: boolean;
  tunnelRoutes: number;
  checkedAt: string | null;
}

export interface PanelState {
  status: VpnStatus;
  busy: string | null;
}

export interface Settings {
  distro: string;
  linuxUser: string;
}

export interface Tunnel {
  enabled: boolean;
  global: boolean;
  m365: boolean;
  targets: string[];
}

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
  hasPassword: boolean;
  hasTotp: boolean;
}

export type ConnectionInput = Omit<Connection, 'id' | 'hasPassword' | 'hasTotp'> & { password?: string };

export interface AppData {
  settings: Settings;
  connections: Connection[];
  vaultReady: boolean;
  helperVersion: number | null;
}

export interface SystemInfo {
  wslInstalled: boolean;
  distro: string;
  distroInstalled: boolean;
  helperVersion: number | null;
  requiredHelperVersion: number;
  settingsSaved: boolean;
}

export interface TotpCode {
  code?: string;
  remaining?: number;
}

export function tunnelSummary(tunnel: Tunnel): string {
  if (tunnel.global) return 'todo o tráfego do Windows';
  const parts = [];
  if (tunnel.targets.length) parts.push(`${tunnel.targets.length} destino${tunnel.targets.length > 1 ? 's' : ''}`);
  if (tunnel.m365) parts.push('Microsoft 365');
  return parts.join(' + ') || 'sem destinos';
}
