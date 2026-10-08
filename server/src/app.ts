import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler } from 'express';
import { configExists, readConfig, writeConfig, type GatewayMode } from './config.ts';
import { listenerCount, recentLog, state, subscribe, updateState } from './events.ts';
import {
  applyConfig,
  importConfigFromDistro,
  installWsl,
  runInstall,
  setVaultSecret,
  systemInfo,
  vaultSecrets,
  vaultStatus,
  type VaultSecret,
} from './installer.ts';
import {
  connect,
  currentTotp,
  disconnect,
  gatewayOff,
  gatewayOn,
  openRdp,
  refreshStatus,
  refreshTotpEnabled,
  saveTotp,
  setGatewayMode,
} from './panel.ts';
import { paths } from './paths.ts';
import { parseTotpSecret, totpNow } from './totp.ts';
import { badRequest, parseConfig, parseGatewayMode, parseSecret } from './validation.ts';

// The API drives the VPN, Windows routes and the password vault, so only same-machine requests
// are accepted (blocks DNS rebinding), and every state-changing request must carry a custom
// header that cross-site pages can't send without a CORS preflight (which is never granted).
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export function createApp() {
  const app = express();
  app.use(express.json());

  app.use('/api', (req, res, next) => {
    const safeMethod = req.method === 'GET' || req.method === 'HEAD';
    if (!allowedHosts.has(req.hostname) || (!safeMethod && req.get('x-wsl-vpn') !== '1')) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    next();
  });

  // Live state and log (Server-Sent Events).
  app.get('/api/events', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.flushHeaders();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('state', state);
    send('history', recentLog());
    const unsubscribe = subscribe(send);
    const keepAlive = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(keepAlive);
      unsubscribe();
    });
    void refreshStatus();
  });

  app.get('/api/config', async (_req, res) => {
    res.json({ exists: configExists(), values: await readConfig() });
  });

  app.put('/api/config', async (req, res) => {
    const config = parseConfig(req.body ?? {});
    await writeConfig(config);
    if (!state.busy) updateState({ selectedMode: config.GATEWAY_MODE as GatewayMode });
    res.json({ exists: true, values: config });
  });

  app.post('/api/config/apply', async (_req, res) => {
    res.json({ ok: (await applyConfig()) === 0 });
  });

  app.get('/api/system', async (_req, res) => {
    res.json(await systemInfo());
  });

  app.post('/api/system/install', async (req, res) => {
    const body = req.body ?? {};
    const code = await runInstall({
      linuxPassword: parseSecret(body.linuxPassword, 'Senha do Linux'),
      vpnPassword: parseSecret(body.vpnPassword, 'Senha da VPN'),
      rdpPassword: parseSecret(body.rdpPassword, 'Senha do RDP'),
      updateCert: body.updateCert === true,
    });
    res.json({ ok: code === 0, code });
  });

  app.post('/api/system/install-wsl', async (_req, res) => {
    res.json({ ok: await installWsl() });
  });

  app.get('/api/vault', async (_req, res) => {
    res.json(await vaultStatus());
  });

  app.put('/api/vault/:name', async (req, res) => {
    const name = req.params.name as VaultSecret;
    if (!vaultSecrets.includes(name)) throw badRequest('Segredo desconhecido');
    await setVaultSecret(name, parseSecret(req.body?.value, 'Senha'));
    res.json(await vaultStatus());
  });

  app.post('/api/vpn/connect', async (req, res) => {
    await connect(typeof req.body?.otp === 'string' ? req.body.otp : '');
    res.json({ ok: state.status.up });
  });

  app.post('/api/vpn/disconnect', async (_req, res) => {
    await disconnect();
    res.json({ ok: true });
  });

  app.post('/api/rdp/open', async (_req, res) => {
    await openRdp();
    res.json({ ok: true });
  });

  app.post('/api/gateway/on', async (_req, res) => {
    await gatewayOn();
    res.json({ ok: true });
  });

  app.post('/api/gateway/off', async (_req, res) => {
    await gatewayOff();
    res.json({ ok: true });
  });

  app.put('/api/gateway/mode', async (req, res) => {
    await setGatewayMode(parseGatewayMode(req.body?.mode));
    res.json({ ok: true });
  });

  // Live code of the stored authenticator key, to compare with the phone app.
  app.get('/api/totp', async (_req, res) => {
    res.json(await currentTotp());
  });

  app.post('/api/totp/preview', (req, res) => {
    const key = parseTotpSecret(typeof req.body?.secret === 'string' ? req.body.secret : '');
    res.json(key ? { valid: true, ...totpNow(key) } : { valid: false });
  });

  app.put('/api/totp', async (req, res) => {
    const key = parseTotpSecret(typeof req.body?.secret === 'string' ? req.body.secret : '');
    if (!key) throw badRequest('Chave inválida: use base32 (A-Z, 2-7) ou um link otpauth://');
    await saveTotp(key);
    res.json({ enabled: true });
  });

  app.delete('/api/totp', async (_req, res) => {
    await saveTotp('');
    res.json({ enabled: false });
  });

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (existsSync(paths.clientDistDir)) {
    app.use(express.static(paths.clientDistDir));
  }

  app.use(errorHandler);
  return app;
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error.name === 'AbortError' || res.headersSent) return;
  const status = typeof error.status === 'number' ? error.status : 500;
  if (status >= 500) console.error(error);
  res.status(status).json({ error: error.message ?? 'Erro inesperado' });
};

/** Polls the VPN state every few seconds while someone is watching (the window is open). */
function startPolling(): void {
  setInterval(() => {
    if (listenerCount() > 0) void refreshStatus();
  }, 4000);
}

async function initialize(): Promise<void> {
  try {
    await importConfigFromDistro();
  } catch {
    // Distro unavailable: the Installation tab will guide the user.
  }
  updateState({ selectedMode: (await readConfig()).GATEWAY_MODE as GatewayMode });
  void refreshTotpEnabled();
}

/** Starts the API (and the built UI, when present) on 127.0.0.1. Port 0 picks a free port. */
export async function startServer(port: number): Promise<{ port: number; close: () => void }> {
  await initialize();
  startPolling();
  return new Promise((resolve, reject) => {
    const server = createApp().listen(port, '127.0.0.1', (error?: Error) => {
      if (error) return reject(error);
      resolve({ port: (server.address() as AddressInfo).port, close: () => server.close() });
    });
  });
}
