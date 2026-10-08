import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';
import { Icon, type IconName } from './components/Icon';
import { InstallView } from './components/InstallView';
import { PanelView } from './components/PanelView';
import type { AppData, SystemInfo } from './types';
import { useServerEvents } from './useServerEvents';

type Tab = 'panel' | 'install';

interface Toast {
  id: number;
  kind: 'ok' | 'error';
  message: string;
}

const tabs: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'panel', label: 'Painel', icon: 'power' },
  { id: 'install', label: 'Instalação', icon: 'download' },
];

const tabFromHash = (): Tab => {
  const hash = window.location.hash.slice(1);
  return tabs.some((item) => item.id === hash) ? (hash as Tab) : 'panel';
};

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [updating, setUpdating] = useState(false);

  const loadData = useCallback(() => {
    api.data().then(setData, () => undefined);
  }, []);
  const refreshSystem = useCallback(() => {
    api.system().then(setSystem, () => undefined);
    loadData();
  }, [loadData]);

  const { state, log, connected } = useServerEvents(loadData);

  const setTab = (next: Tab) => {
    setTabState(next);
    window.history.replaceState(null, '', `#${next}`);
    if (next === 'install') refreshSystem();
  };

  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 5000);
  }, []);

  useEffect(refreshSystem, [refreshSystem]);

  // Long tasks change what is installed: re-check when they finish.
  const wasBusy = useRef<string | null>(null);
  useEffect(() => {
    if (wasBusy.current && !state?.busy && /Instal|Atualizando/.test(wasBusy.current)) refreshSystem();
    wasBusy.current = state?.busy ?? null;
  }, [state?.busy, refreshSystem]);

  async function updateCommands() {
    setUpdating(true);
    try {
      const result = await api.updateCommands();
      notify(result.ok ? 'ok' : 'error', result.ok ? 'Comandos do Ubuntu atualizados' : 'Falha: veja o log');
    } catch (error) {
      notify('error', (error as Error).message);
    } finally {
      setUpdating(false);
      refreshSystem();
    }
  }

  const needsInstall = system && (!system.wslInstalled || !system.distroInstalled || system.helperVersion === null);
  const outdated = !needsInstall && data && !data.vaultReady && data.helperVersion !== null;
  const active = data?.connections.find((c) => state?.status.up && c.id === state.status.activeId);

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
              {state?.status.up ? `Conectada${active ? `: ${active.name}` : ''}` : 'VPN corporativa isolada no WSL2'}
            </p>
          </div>
        </div>
        <nav className="tabs">
          {tabs.map((item) => (
            <button key={item.id} className={tab === item.id ? 'is-active' : ''} onClick={() => setTab(item.id)}>
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

      {outdated && (
        <div className="banner warn">
          <Icon name="alert" />
          <span>Os comandos do Ubuntu são de uma versão anterior. Atualize para conectar, salvar senhas e usar o autenticador.</span>
          <span className="spacer" />
          <button className="button small" onClick={updateCommands} disabled={updating || Boolean(state?.busy)}>
            {updating ? 'Atualizando…' : 'Atualizar agora'}
          </button>
        </div>
      )}

      <main>
        {tab === 'panel' && data && state && (
          <PanelView data={data} state={state} log={log} onChanged={loadData} onNotify={notify} />
        )}
        {tab === 'install' && data && (
          <InstallView
            settings={data.settings}
            system={system}
            busy={state?.busy ?? null}
            log={log}
            onRefresh={refreshSystem}
            onNotify={notify}
          />
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
