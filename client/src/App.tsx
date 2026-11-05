import { Download, Globe, Loader, Power, ShieldCheck, ShieldOff, Unplug, Waypoints } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { CommandPalette, type Command } from './components/CommandPalette';
import { ConnectionForm } from './components/ConnectionForm';
import { ConnectionsPage, connectTo } from './components/ConnectionsPage';
import { InstallPage } from './components/InstallPage';
import { ActivityBar, type Activity } from './components/layout/ActivityBar';
import { StatusBar, StatusItem, StatusSpacer } from './components/layout/StatusBar';
import { TitleBar, type Menu } from './components/layout/TitleBar';
import { AboutDialog, Banner, Toasts, useShortcuts, useToasts } from './components/Shell';
import { TotpDialog } from './components/TotpDialog';
import { Button } from './components/ui/Button';
import { useConfirm } from './components/ui/Confirm';
import { TipProvider } from './components/ui/Tip';
import type { AppData, Connection, SystemInfo } from './types';
import { useServerEvents } from './useServerEvents';

type Tab = 'panel' | 'install';
type Dialog = { kind: 'connection'; connection: Connection | null } | { kind: 'totp'; connection: Connection };

const labels: Record<Tab, string> = { panel: 'Conexões', install: 'Instalação' };

const tabFromHash = (): Tab => {
  const hash = window.location.hash.slice(1);
  return hash in labels ? (hash as Tab) : 'panel';
};

export function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [tab, setTabState] = useState<Tab>(tabFromHash);
  const [updating, setUpdating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { toasts, notify } = useToasts();
  const [confirm, confirmDialog] = useConfirm();
  const notifyError = useCallback((message: string) => notify('error', message), [notify]);

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
  const openConnection = (id: string | null): void => {
    setOpenId(id);
    if (tab !== 'panel') setTab('panel');
  };

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
      notifyError((error as Error).message);
    } finally {
      setUpdating(false);
      refreshSystem();
    }
  }

  async function remove(connection: Connection) {
    const ok = await confirm({
      title: `Excluir "${connection.name}"?`,
      description: 'A senha e o autenticador dela no cofre também são apagados.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteConnection(connection.id);
      setOpenId(null);
      notify('ok', `"${connection.name}" excluída`);
      loadData();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  const disconnect = () => api.disconnect().catch((error: Error) => notifyError(error.message));

  const needsInstall = system && (!system.wslInstalled || !system.distroInstalled || system.helperVersion === null);
  const outdated = !needsInstall && data && !data.vaultReady && data.helperVersion !== null;
  const status = state?.status;
  const busy = state?.busy ?? null;
  const active = data?.connections.find((c) => status?.up && c.id === status.activeId);

  const activities: Activity<Tab>[] = [
    { id: 'panel', label: labels.panel, icon: Waypoints, shortcut: 'Ctrl+1' },
    { id: 'install', label: labels.install, icon: Download, shortcut: 'Ctrl+2', alert: Boolean(needsInstall || outdated) },
  ];

  const menus: Menu[] = [
    {
      label: 'Arquivo',
      items: [{ label: 'Nova conexão', shortcut: 'Ctrl+N', keywords: 'criar vpn', onSelect: () => setDialog({ kind: 'connection', connection: null }) }],
    },
    {
      label: 'VPN',
      items: [
        { label: 'Desconectar', disabled: !status?.up || Boolean(busy), keywords: 'sair desligar', onSelect: () => void disconnect() },
        { label: 'Limpar túnel do Windows', disabled: status?.tunnel === 'off' || Boolean(busy), keywords: 'rotas dns', onSelect: () => void api.tunnelOff().catch((e: Error) => notifyError(e.message)) },
        null,
        { label: 'Atualizar os comandos do Ubuntu', disabled: updating || Boolean(busy), keywords: 'helper', onSelect: () => void updateCommands() },
      ],
    },
    {
      label: 'Exibir',
      items: [
        { label: labels.panel, shortcut: 'Ctrl+1', onSelect: () => openConnection(null) },
        { label: labels.install, shortcut: 'Ctrl+2', onSelect: () => setTab('install') },
        null,
        { label: 'Paleta de comandos', shortcut: 'Ctrl+Shift+P', keywords: 'buscar', onSelect: () => setPaletteOpen(true) },
      ],
    },
    { label: 'Ajuda', items: [{ label: 'Sobre o WSL-Vpn', keywords: 'versão', onSelect: () => setAboutOpen(true) }] },
  ];

  const commands: Command[] = useMemo(
    () => [
      ...menus.flatMap((menu) =>
        menu.items
          .filter((item) => item !== null)
          .map((item) => ({
            id: `${menu.label}/${item.label}`,
            category: menu.label,
            label: item.label,
            shortcut: item.shortcut,
            keywords: item.keywords,
            disabled: item.disabled,
            run: item.onSelect,
          })),
      ),
      ...(data?.connections ?? []).flatMap((connection) => [
        {
          id: `connect/${connection.id}`,
          category: 'Conexão',
          label: `Conectar ${connection.name}`,
          detail: connection.host,
          icon: <Power />,
          disabled: Boolean(status?.up) || Boolean(busy),
          run: (): void => void connectTo(connection, openConnection, notifyError),
        },
        {
          id: `open/${connection.id}`,
          category: 'Conexão',
          label: `Abrir ${connection.name}`,
          detail: `${connection.user}@${connection.host}`,
          icon: <Waypoints />,
          run: () => openConnection(connection.id),
        },
      ]),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, state, updating, tab],
  );

  useShortcuts({
    'ctrl+shift+p': () => setPaletteOpen(true),
    'ctrl+p': () => setPaletteOpen(true),
    f1: () => setPaletteOpen(true),
    'ctrl+1': () => openConnection(null),
    'ctrl+2': () => setTab('install'),
    'ctrl+n': () => setDialog({ kind: 'connection', connection: null }),
  });

  const statusTone = !connected ? 'danger' : busy ? 'warn' : 'accent';

  return (
    <TipProvider delayDuration={350}>
      <div className="flex h-full flex-col overflow-hidden">
        <TitleBar
          icon={<ShieldCheck strokeWidth={2.4} />}
          title={`${tab === 'panel' && openId ? (data?.connections.find((c) => c.id === openId)?.name ?? labels.panel) : labels[tab]} — WSL-Vpn`}
          menus={menus}
          searchHint="Buscar comandos e conexões"
          onCommandPalette={() => setPaletteOpen(true)}
        />

        <div className="flex min-h-0 flex-1">
          <ActivityBar current={tab} items={activities} onNavigate={(id) => (id === 'panel' ? openConnection(null) : setTab(id))} />

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {(!connected || (needsInstall && tab !== 'install') || outdated) && (
              <div className="space-y-2 p-5 pb-0">
                {!connected && <Banner>Sem conexão com o servidor interno. Tentando de novo…</Banner>}
                {needsInstall && tab !== 'install' && (
                  <Banner tone="warn">
                    <div className="flex items-center gap-3">
                      <span className="flex-1">O Ubuntu da VPN ainda não está pronto neste PC.</span>
                      <Button size="sm" onClick={() => setTab('install')}>
                        Ir para a instalação
                      </Button>
                    </div>
                  </Banner>
                )}
                {outdated && (
                  <Banner tone="warn">
                    <div className="flex items-center gap-3">
                      <span className="flex-1">Os comandos do Ubuntu são de uma versão anterior. Atualize para conectar, salvar senhas e usar o autenticador.</span>
                      <Button size="sm" onClick={() => void updateCommands()} disabled={updating || Boolean(busy)}>
                        {updating ? 'Atualizando…' : 'Atualizar agora'}
                      </Button>
                    </div>
                  </Banner>
                )}
              </div>
            )}
            <div className="min-h-0 flex-1 overflow-auto">
              {tab === 'panel' &&
                (data && state ? (
                  <ConnectionsPage
                    data={data}
                    state={state}
                    log={log}
                    openId={openId}
                    onOpen={setOpenId}
                    onNew={() => setDialog({ kind: 'connection', connection: null })}
                    onEdit={(connection) => setDialog({ kind: 'connection', connection })}
                    onDelete={(connection) => void remove(connection)}
                    onManageTotp={(connection) => setDialog({ kind: 'totp', connection })}
                    onError={notifyError}
                  />
                ) : (
                  <p className="py-16 text-center text-[13px] text-fg-muted">Carregando…</p>
                ))}
              {tab === 'install' && data && (
                <InstallPage settings={data.settings} system={system} busy={busy} log={log} confirm={confirm} onRefresh={refreshSystem} onNotify={notify} />
              )}
            </div>
          </main>
        </div>

        <StatusBar tone={statusTone}>
          {!connected ? (
            <StatusItem tip="O servidor interno não respondeu">
              <Unplug />
              Sem conexão com o servidor interno
            </StatusItem>
          ) : (
            status && (
              <>
                <StatusItem tip={status.up ? `ppp0 ${status.address}` : 'Nenhuma VPN conectada'} onClick={() => openConnection(active?.id ?? null)}>
                  {status.up ? <ShieldCheck /> : <ShieldOff />}
                  {status.up ? `Conectada${active ? `: ${active.name}` : ''}` : 'Desconectada'}
                </StatusItem>
                {status.up && (
                  <StatusItem tip="Endereço na VPN" className="max-sm:hidden">
                    {status.address}
                  </StatusItem>
                )}
                {busy && (
                  <StatusItem tip="Tarefa em andamento">
                    <Loader className="animate-spin" />
                    {busy}…
                  </StatusItem>
                )}
                <StatusSpacer />
                <StatusItem
                  tip="O que o Windows manda pela VPN"
                  onClick={() => openConnection(active?.id ?? openId)}
                  className="max-sm:hidden"
                >
                  <Globe />
                  {status.tunnel === 'on'
                    ? status.tunnelGlobal
                      ? 'Túnel global'
                      : `Túnel: ${status.tunnelRoutes} rota(s)`
                    : status.tunnel === 'partial'
                      ? 'Túnel: restos no Windows'
                      : 'Sem túnel no Windows'}
                </StatusItem>
              </>
            )
          )}
        </StatusBar>
      </div>

      {dialog?.kind === 'connection' && data && (
        <ConnectionForm
          connection={dialog.connection}
          vaultReady={data.vaultReady}
          onClose={() => setDialog(null)}
          onSaved={(connection) => {
            setDialog(null);
            openConnection(connection.id);
            notify('ok', `Conexão "${connection.name}" salva`);
            loadData();
          }}
        />
      )}
      {dialog?.kind === 'totp' && (
        <TotpDialog
          connection={data?.connections.find((c) => c.id === dialog.connection.id) ?? dialog.connection}
          confirm={confirm}
          onClose={() => setDialog(null)}
          onError={notifyError}
        />
      )}
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} commands={commands} />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} name="WSL-Vpn" icon={<ShieldCheck strokeWidth={2.4} />}>
        <p>A VPN corporativa (Fortinet SSL-VPN) isolada num Ubuntu do WSL2, com o túnel para o Windows sob controle: desligado, global ou só para os destinos da lista.</p>
      </AboutDialog>
      {confirmDialog}
      <Toasts toasts={toasts} />
    </TipProvider>
  );
}
