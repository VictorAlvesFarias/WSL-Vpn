export type GatewayMode = 'empresa' | 'm365' | 'tudo';
export type GatewayState = 'off' | 'on' | 'partial';
export type LogLevel = 'info' | 'step' | 'ok' | 'warn' | 'error';

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
  gateway: GatewayState;
  activeMode: GatewayMode;
  checkedAt: string | null;
}

export interface PanelState {
  status: VpnStatus;
  busy: string | null;
  rdpOpening: boolean;
  totpEnabled: boolean | null;
  selectedMode: GatewayMode;
}

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

export interface SystemInfo {
  wslInstalled: boolean;
  distro: string;
  distroInstalled: boolean;
  configured: boolean;
  helperVersion: number | null;
  configExists: boolean;
  configPath: string;
}

export interface VaultStatus {
  VPN_PASSWORD: boolean;
  RDP_PASSWORD: boolean;
  TOTP_SECRET: boolean;
}

export type VaultSecret = 'VPN_PASSWORD' | 'RDP_PASSWORD';

export interface TotpCode {
  code?: string;
  remaining?: number;
}

export const expectedHelperVersion = 2;

export const modeLabels: Record<GatewayMode, string> = {
  empresa: 'Empresa',
  m365: '+ Microsoft 365',
  tudo: 'Tudo',
};

export const modeText: Record<GatewayMode, string> = {
  empresa: 'só a rede da empresa',
  m365: 'rede da empresa + Microsoft 365',
  tudo: 'TODO o tráfego pela empresa',
};
