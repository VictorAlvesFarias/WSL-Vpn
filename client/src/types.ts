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
  /** Signature of the tunnel last applied by the app (see tunnelSignature). */
  appliedTunnel: string | null;
  /** The elevated helper is up: tunnel changes don't ask for the UAC. */
  elevated: boolean;
  /** Reconnection in progress after the VPN dropped. */
  reconnect: { connectionId: string; name: string; attempt: number; nextAt: string } | null;
}

export interface Prefs {
  autoReconnect: boolean;
  elevateOnStart: boolean;
}

export interface Settings {
  distro: string;
  linuxUser: string;
}

export type TunnelMode = 'off' | 'global' | 'specific';

export interface Tunnel {
  mode: TunnelMode;
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

export type ConnectionInput = Omit<Connection, 'id' | 'hasPassword' | 'hasTotp' | 'tunnel'> & { password?: string };

export interface AppData {
  settings: Settings;
  prefs: Prefs;
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
  if (tunnel.mode === 'off') return 'Túnel desativado';
  if (tunnel.mode === 'global') return 'Túnel global';
  const count = tunnel.targets.length;
  return `Túnel específico · ${count ? `${count} destino${count > 1 ? 's' : ''}` : 'sem destinos'}`;
}

/** Same as the server's tunnelSignature: tells whether the saved tunnel differs from the applied one. */
export function tunnelSignature(connection: Connection): string {
  const { mode, targets } = connection.tunnel;
  return JSON.stringify({ id: connection.id, mode, targets: mode === 'specific' ? targets : [] });
}
