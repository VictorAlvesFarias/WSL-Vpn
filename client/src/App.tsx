import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Icon, type IconName } from './components/Icon';
import { InstallView } from './components/InstallView';
import { PanelView } from './components/PanelView';
import { SettingsView } from './components/SettingsView';
import { expectedHelperVersion, type Config, type SystemInfo } from './types';
import { useServerEvents } from './useServerEvents';

type Tab = 'panel' | 'settings' | 'install';

interface Toast {
  id: number;
  kind: 'ok' | 'error';
  message: string;
}

const tabs: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'panel', label: 'Painel', icon: 'power' },
  { id: 'settings', label: 'Configurações', icon: 'settings' },
  { id: 'install', label: 'Instalação', icon: 'download' },
];

const tabFromHash = (): Tab => {
  const hash = window.location.hash.slice(1);
  return tabs.some((item) => item.id === hash) ? (hash as Tab) : 'panel';
};

export function App() {
  const { state, log, connected } = useServerEvents();
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const setTab = (next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, '', `#${next}`);
  };
  const [config, setConfig] = useState<Config | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [applying, setApplying] = useState(false);

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);
  const notifyError = useCallback((message: string) => notify('error', message), [notify]);

  const refreshSystem = useCallback(() => {
    api.system().then(setSystem, () => undefined);
    api.config().then((result) => setConfig(result.values), () => undefined);
  }, []);

  useEffect(refreshSystem, [refreshSystem]);

  // Long tasks (install, apply) change what is installed: re-check when they finish.
  const wasBusy = useRef<string | null>(null);
  useEffect(() => {
    if (wasBusy.current && !state?.busy && /Instal|Aplicando/.test(wasBusy.current)) refreshSystem();
    wasBusy.current = state?.busy ?? null;
  }, [state?.busy, refreshSystem]);

  async function applyNow() {
    setApplying(true);
    try {
      const result = await api.applyConfig();
      notify(result.ok ? 'ok' : 'error', result.ok ? 'Comandos do Ubuntu atualizados' : 'Falha: veja o log');
    } catch (error) {
      notifyError((error as Error).message);
    } finally {
      setApplying(false);
      refreshSystem();
    }
  }

  const needsInstall = system && (!system.wslInstalled || !system.distroInstalled || !system.configured);
  const oldHelper = system?.configured && (system.helperVersion ?? 0) < expectedHelperVersion;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="shield" size={22} />
          </span>
          <div>
            <h1>WSL-Vpn</h1>
            <p className="muted">
              {config?.VPN_USER && config.VPN_HOST ? `${config.VPN_USER}@${config.VPN_HOST}` : 'VPN corporativa isolada no WSL2'}
            </p>
          </div>
        </div>
        <nav className="tabs">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'is-active' : ''}
              onClick={() => {
                setTab(item.id);
                if (item.id !== 'panel') refreshSystem();
              }}
            >
              <Icon name={item.icon} size={15} />
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      {!connected && <div className="banner error">Sem conexão com o servidor interno. Tentando de novo…</div>}

      {needsInstall && tab !== 'install' && (
        <div className="banner warn">
          <Icon name="alert" />
          <span>O Ubuntu da VPN ainda não está pronto neste PC.</span>
          <span className="spacer" />
          <button className="button small" onClick={() => setTab('install')}>
            Ir para a instalação
          </button>
        </div>
      )}

      {oldHelper && !needsInstall && (
        <div className="banner warn">
          <Icon name="alert" />
          <span>Os comandos do Ubuntu são da versão antiga do painel. Atualize para salvar senhas pelo app.</span>
          <span className="spacer" />
          <button className="button small" onClick={applyNow} disabled={applying || Boolean(state?.busy)}>
            {applying ? 'Atualizando…' : 'Atualizar agora'}
          </button>
        </div>
      )}

      <main>
        {tab === 'panel' && state && <PanelView state={state} config={config} log={log} onError={notifyError} />}
        {tab === 'settings' && config && (
          <SettingsView
            config={config}
            busy={Boolean(state?.busy)}
            totpEnabled={Boolean(state?.totpEnabled)}
            onSaved={setConfig}
            onNotify={notify}
          />
        )}
        {tab === 'install' && (
          <InstallView system={system} busy={state?.busy ?? null} log={log} onRefresh={refreshSystem} onNotify={notify} />
        )}
      </main>

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}
