import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const here = import.meta.dirname;

/** Read at call time so the desktop app can point them at its packaged resources. */
export const paths = {
  dataDir: process.env.WSLVPN_HOME ?? join(homedir(), '.wsl-vpn'),
  scriptsDir: resolve(here, '..', 'scripts'),
  clientDistDir: resolve(here, '..', '..', 'client', 'dist'),
};

export function configurePaths(overrides: Partial<typeof paths>): void {
  Object.assign(paths, overrides);
}

export const scriptPath = (name: string) => join(paths.scriptsDir, name);
/** gateway.ps1 runs elevated and can't hand its output back, so it writes it here. */
export const gatewayResultFile = () => join(tmpdir(), 'wsl-vpn-gateway.txt');
/** Requests and results exchanged with the elevated helper (gateway-service.ps1). */
export const gatewayServiceDir = () => join(tmpdir(), 'wsl-vpn-gateway');
