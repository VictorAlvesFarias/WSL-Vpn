import { existsSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import express, { type ErrorRequestHandler, type Request } from 'express';
import { dataChanged, listenerCount, recentLog, say, state, subscribe } from './events.ts';
import { finishPendingMigration, importExistingSetup, installWsl, runInstall, systemInfo, updateCommands } from './installer.ts';
import {
  applyTunnel,
  connect,
  currentTotp,
  detectCertificate,
  disconnect,
  forgetTotpKey,
  refreshStatus,
  saveTotp,
  tunnelOff,
} from './panel.ts';
import { paths } from './paths.ts';
import { emptyTunnel, getSettings, mutate, newId, readData, type Connection } from './store.ts';
import { parseTotpSecret, totpNow } from './totp.ts';
import { badRequest, HttpError, optionalSecret, parseConnection, parseSecret, parseSettings, parseTunnel } from './validation.ts';
import {
  forgetSecrets,
  helperVersion,
  requiredHelperVersion,
  secretName,
  secretNames,
  setSecret,
  type SecretKind,
} from './vault.ts';

// The API drives the VPN, Windows routes and the password vault, so only same-machine requests
// are accepted (blocks DNS rebinding), and every state-changing request must carry a custom
// header that cross-site pages can't send without a CORS preflight (which is never granted).
const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

const body = (req: Request) => (req.body ?? {}) as Record<string, unknown>;

/** Everything the UI lists, plus which secrets each connection has (never their values). */
async function publicData() {
  const data = await readData();
  const version = await helperVersion(data.settings.distro).catch(() => null);
  const vaultReady = version === requiredHelperVersion;
  const names = vaultReady ? await secretNames(data.settings.distro).catch(() => new Set<string>()) : new Set<string>();
  const has = (kind: SecretKind, id: string) => names.has(secretName(kind, id));
  return {
    settings: data.settings,
    connections: data.connections.map((c) => ({ ...c, hasPassword: has('VPN_PASSWORD', c.id), hasTotp: has('TOTP_SECRET', c.id) })),
    /** False until the Ubuntu commands are updated: secrets can't be read or saved yet. */
    vaultReady,
    helperVersion: version,
  };
}

/** Stores or removes a secret when the request carries one (undefined keeps it). */
async function applySecret(kind: SecretKind, id: string, value: string | undefined): Promise<void> {
  if (value === undefined) return;
  await setSecret((await getSettings()).distro, secretName(kind, id), value);
}

/** Fills in the gateway certificate when it was left empty; never blocks saving. */
async function withCertificate<T extends Omit<Connection, 'id' | 'tunnel'>>(connection: T): Promise<T> {
  if (connection.trustedCert) return connection;
  try {
    const trustedCert = await detectCertificate(connection.host, connection.port);
    say(`Certificado de ${connection.host} detectado: ${trustedCert.slice(0, 16)}...`, 'ok');
    return { ...connection, trustedCert };
  } catch (error) {
    say(`Aviso: ${(error as Error).message} Use "Detectar" depois.`, 'warn');
    return connection;
  }
}

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

  app.get('/api/data', async (_req, res) => {
    res.json(await publicData());
  });

  // ------------------------------------------------------------- settings/system
  app.put('/api/settings', async (req, res) => {
    const settings = parseSettings(body(req));
    await mutate((data) => {
      data.settings = settings;
    });
    dataChanged();
    res.json(settings);
  });

  app.get('/api/system', async (_req, res) => {
    res.json(await systemInfo());
  });

  app.post('/api/system/install', async (req, res) => {
    const code = await runInstall(parseSecret(body(req).linuxPassword, 'Senha do Linux'));
    res.json({ ok: code === 0, code });
  });

  app.post('/api/system/update', async (_req, res) => {
    res.json({ ok: (await updateCommands()) === 0 });
  });

  app.post('/api/system/install-wsl', async (_req, res) => {
    res.json({ ok: await installWsl() });
  });

  // ---------------------------------------------------------------- connections
  app.post('/api/connections', async (req, res) => {
    const input = await withCertificate(parseConnection(body(req)));
    const password = optionalSecret(body(req).password, 'Senha');
    const id = newId();
    // Secret first: if the vault refuses it, nothing is half-saved.
    await applySecret('VPN_PASSWORD', id, password || undefined);
    const connection: Connection = { id, ...input, tunnel: emptyTunnel() };
    await mutate((data) => {
      data.connections.push(connection);
    });
    dataChanged();
    res.status(201).json(connection);
  });

  app.put('/api/connections/:id', async (req, res) => {
    const id = req.params.id;
    const input = await withCertificate(parseConnection(body(req)));
    await applySecret('VPN_PASSWORD', id, optionalSecret(body(req).password, 'Senha'));
    const connection = await mutate((data) => {
      const index = data.connections.findIndex((c) => c.id === id);
      if (index < 0) throw new HttpError(404, 'Conexão não encontrada');
      // The tunnel is edited separately (see /tunnel below).
      data.connections[index] = { ...data.connections[index], ...input };
      return data.connections[index];
    });
    dataChanged();
    res.json(connection);
  });

  app.delete('/api/connections/:id', async (req, res) => {
    const id = req.params.id;
    if (state.status.up && state.status.activeId === id) throw new HttpError(409, 'Desconecte antes de excluir esta conexão.');
    await mutate((data) => {
      data.connections = data.connections.filter((c) => c.id !== id);
    });
    await forgetSecrets((await getSettings()).distro, id);
    forgetTotpKey(id);
    dataChanged();
    res.json({ ok: true });
  });

  app.post('/api/certificate', async (req, res) => {
    const { host, port } = parseConnection({ name: 'x', user: 'x', ...body(req) });
    res.json({ fingerprint: await detectCertificate(host, port) });
  });

  app.post('/api/connections/:id/connect', async (req, res) => {
    const otp = body(req).otp;
    await connect(req.params.id, typeof otp === 'string' ? otp : '');
    res.json({ ok: state.status.up });
  });

  app.post('/api/vpn/disconnect', async (_req, res) => {
    await disconnect();
    res.json({ ok: true });
  });

  // The tunnel is edited on the connection screen; saving never touches Windows by itself.
  app.put('/api/connections/:id/tunnel', async (req, res) => {
    const id = req.params.id;
    const tunnel = parseTunnel(body(req));
    const connection = await mutate((data) => {
      const found = data.connections.find((c) => c.id === id);
      if (!found) throw new HttpError(404, 'Conexão não encontrada');
      found.tunnel = tunnel;
      return found;
    });
    dataChanged();
    res.json(connection);
  });

  // Makes Windows match the saved tunnel while the VPN is up (UAC).
  app.post('/api/connections/:id/tunnel/apply', async (req, res) => {
    await applyTunnel(req.params.id);
    res.json({ ok: true });
  });

  app.post('/api/tunnel/off', async (_req, res) => {
    await tunnelOff();
    res.json({ ok: true });
  });

  // Live code of a connection's authenticator, shown on the home screen.
  app.get('/api/connections/:id/totp', async (req, res) => {
    res.json(await currentTotp(req.params.id));
  });

  app.put('/api/connections/:id/totp', async (req, res) => {
    const secret = body(req).secret;
    const key = parseTotpSecret(typeof secret === 'string' ? secret : '');
    if (!key) throw badRequest('Chave inválida: use base32 (A-Z, 2-7) ou um link otpauth://');
    await saveTotp(req.params.id, key);
    res.json({ enabled: true });
  });

  app.delete('/api/connections/:id/totp', async (req, res) => {
    await saveTotp(req.params.id, '');
    res.json({ enabled: false });
  });

  app.post('/api/totp/preview', (req, res) => {
    const secret = body(req).secret;
    const key = parseTotpSecret(typeof secret === 'string' ? secret : '');
    res.json(key ? { valid: true, ...totpNow(key) } : { valid: false });
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
    await importExistingSetup();
  } catch {
    // Distro unavailable: the Installation tab will guide the user.
  }
  void finishPendingMigration();
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
