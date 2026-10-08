export type LogLevel = 'info' | 'step' | 'ok' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  time: string;
  level: LogLevel;
  text: string;
}

export type TunnelState = 'off' | 'on' | 'partial';

export interface VpnStatus {
  /** False when WSL didn't answer the last check; the other fields keep the last known values. */
  reachable: boolean;
  up: boolean;
  /** ppp0 address while connected. */
  address: string;
  /** Connection started by the app (null when connected some other way). */
  activeId: string | null;
  /** Windows using the tunnel: both ends on, both off, or leftovers of one end ("partial"). */
  tunnel: TunnelState;
  tunnelGlobal: boolean;
  tunnelRoutes: number;
  checkedAt: string | null;
}

export interface PanelState {
  status: VpnStatus;
  /** Label of the VPN/tunnel action in progress; other such actions are refused meanwhile. */
  busy: string | null;
}

type Listener = (event: 'state' | 'log' | 'data', data: unknown) => void;

const maxLog = 500;
let nextId = 1;
const log: LogEntry[] = [];
const listeners = new Set<Listener>();

export const state: PanelState = {
  status: {
    reachable: false,
    up: false,
    address: '',
    activeId: null,
    tunnel: 'off',
    tunnelGlobal: false,
    tunnelRoutes: 0,
    checkedAt: null,
  },
  busy: null,
};

function classify(text: string): LogLevel {
  if (/^==>/.test(text)) return 'step';
  if (/^\s*\[OK\]|^CONECTADA|^Desconectada/.test(text)) return 'ok';
  if (/^\s*\[!\]|^AVISO|^Aviso/.test(text)) return 'warn';
  if (/^\s*\[X\]|^ERRO|^FALHA|^CAUSA|^TIMEOUT|^Erro/.test(text)) return 'error';
  return 'info';
}

export function say(text: string, level?: LogLevel): void {
  const entry: LogEntry = { id: nextId++, time: new Date().toISOString(), level: level ?? classify(text), text: text.trimEnd() };
  log.push(entry);
  if (log.length > maxLog) log.splice(0, log.length - maxLog);
  for (const listener of listeners) listener('log', entry);
}

export function sayLines(output: string): void {
  for (const line of output.split(/\r?\n/)) if (line.trim()) say(line);
}

export function updateState(patch: Partial<PanelState>): void {
  Object.assign(state, patch);
  for (const listener of listeners) listener('state', state);
}

/** Tells the UI that connections or vault flags changed and must be reloaded. */
export function dataChanged(): void {
  for (const listener of listeners) listener('data', null);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const listenerCount = () => listeners.size;
export const recentLog = (limit = 200) => log.slice(-limit);
