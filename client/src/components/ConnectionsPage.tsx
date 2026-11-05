import { ArrowLeft, ChevronRight, Pencil, Plus, Power, ShieldCheck, Trash2, TriangleAlert, Unplug } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { tunnelSummary, type AppData, type Connection, type LogEntry, type PanelState } from '../types';
import { AuthenticatorCard } from './AuthenticatorCard';
import { LogView } from './LogView';
import { Dot, Empty, Page } from './Shell';
import { TunnelCard } from './TunnelCard';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { Input } from './ui/Input';
import { Panel, PanelHeader } from './ui/Panel';
import { Tip } from './ui/Tip';

interface ConnectionsPageProps {
  data: AppData;
  state: PanelState;
  log: LogEntry[];
  openId: string | null;
  onOpen: (id: string | null) => void;
  onNew: () => void;
  onEdit: (connection: Connection) => void;
  onDelete: (connection: Connection) => void;
  onManageTotp: (connection: Connection) => void;
  onError: (message: string) => void;
}

/** Screen 1 (every connection) and screen 2 (one connection), with the activity log beside them. */
export function ConnectionsPage(props: ConnectionsPageProps) {
  const { data, state, log, openId } = props;
  const active = data.connections.find((c) => c.id === state.status.activeId && state.status.up);
  const open = data.connections.find((c) => c.id === openId) ?? null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(300px,380px)] max-lg:grid-cols-1 max-lg:overflow-auto">
      <div className="min-h-0 overflow-auto">
        <Page>
          {open ? (
            <ConnectionDetail {...props} connection={open} otherActive={active && active.id !== open.id ? active.name : null} />
          ) : (
            <ConnectionList {...props} />
          )}
        </Page>
      </div>
      <div className="flex min-h-0 flex-col border-l border-line bg-sidebar/40 p-3 max-lg:h-80 max-lg:border-t max-lg:border-l-0">
        <LogView entries={log} className="flex-1" />
      </div>
    </div>
  );
}

export async function connectTo(connection: Connection, onOpen: (id: string) => void, onError: (message: string) => void) {
  // Without an authenticator the code has to be typed: that happens on the connection screen.
  if (connection.otpRequired && !connection.hasTotp) {
    onOpen(connection.id);
    onError(`Informe o código OTP de "${connection.name}".`);
    return;
  }
  try {
    await api.connect(connection.id, '');
  } catch (error) {
    onError((error as Error).message);
  }
}

function ConnectionList({ data, state, onOpen, onNew, onError }: ConnectionsPageProps) {
  const { status, busy } = state;
  const [starting, setStarting] = useState<string | null>(null);

  async function connect(connection: Connection) {
    setStarting(connection.id);
    await connectTo(connection, onOpen, onError);
    setStarting(null);
  }

  const disconnect = () => api.disconnect().catch((error: Error) => onError(error.message));

  return (
    <>
      {status.up && !status.activeId && (
        <div className="flex items-center gap-3 rounded-md border border-warn/30 bg-warn-soft px-4 py-2.5 text-[13px] text-warn">
          <TriangleAlert className="size-4 shrink-0" />
          <span className="flex-1">Há uma VPN conectada fora do app ({status.address}).</span>
          <Button size="sm" onClick={() => void disconnect()} disabled={Boolean(busy)}>
            Desconectar
          </Button>
        </div>
      )}

      {data.connections.length === 0 ? (
        <Empty
          icon={<ShieldCheck />}
          action={
            <Button variant="primary" onClick={onNew}>
              <Plus />
              Nova conexão
            </Button>
          }
        >
          <p className="text-[14px] font-semibold text-fg">Crie sua primeira conexão</p>
          Gateway, usuário e senha. O túnel para o Windows é escolhido depois, na tela da conexão.
        </Empty>
      ) : (
        <Panel className="overflow-hidden">
          <PanelHeader
            title="Conexões"
            description="Uma VPN por vez, isolada no Ubuntu do WSL2."
            actions={
              <Button size="sm" variant="primary" onClick={onNew}>
                <Plus />
                Nova conexão
              </Button>
            }
          />
          <ul className="divide-y divide-line">
            {data.connections.map((connection) => {
              const isUp = status.up && status.activeId === connection.id;
              const otherUp = status.up && !isUp;
              return (
                <li key={connection.id} className={cn('flex items-center gap-3 pr-4', isUp && 'bg-ok-soft/40')}>
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left outline-none hover:bg-panel-2/50 focus-visible:bg-panel-2"
                    onClick={() => onOpen(connection.id)}
                  >
                    <Dot state={isUp ? 'up' : 'idle'} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium">{connection.name}</span>
                      <span className="block truncate text-[12px] text-fg-muted">
                        {connection.user}@{connection.host}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1.5 max-md:hidden">
                      <Badge tone={connection.tunnel.mode !== 'off' ? 'accent' : 'neutral'}>{tunnelSummary(connection.tunnel)}</Badge>
                      {connection.otpRequired && connection.hasTotp && <Badge>Autenticador</Badge>}
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-fg-subtle" />
                  </button>
                  {isUp ? (
                    <Button size="sm" onClick={() => void disconnect()} disabled={Boolean(busy)}>
                      <Unplug />
                      Desconectar
                    </Button>
                  ) : (
                    <Tip content={otherUp ? 'Outra conexão está ativa' : undefined}>
                      <span>
                        <Button size="sm" variant="primary" onClick={() => void connect(connection)} disabled={Boolean(busy) || otherUp}>
                          <Power />
                          {starting === connection.id ? 'Conectando…' : 'Conectar'}
                        </Button>
                      </span>
                    </Tip>
                  )}
                </li>
              );
            })}
          </ul>
        </Panel>
      )}
    </>
  );
}

function ConnectionDetail({
  connection,
  otherActive,
  state,
  data,
  onOpen,
  onEdit,
  onDelete,
  onManageTotp,
  onError,
}: ConnectionsPageProps & { connection: Connection; otherActive: string | null }) {
  const { status, busy } = state;
  const [otp, setOtp] = useState('');

  useEffect(() => setOtp(''), [connection.id]);

  // Up through the app with this connection, or up some other way while nothing else claims it.
  const isUp = status.up && (status.activeId === connection.id || (!status.activeId && !otherActive));

  const run = (action: () => Promise<unknown>) => action().catch((error: Error) => onError(error.message));

  function connect(event?: FormEvent) {
    event?.preventDefault();
    if (connection.otpRequired && !otp && !connection.hasTotp) {
      onError('Informe o código OTP ou cadastre o autenticador desta conexão.');
      return;
    }
    const code = otp;
    setOtp('');
    void run(() => api.connect(connection.id, code));
  }

  const statusKind = busy ? 'busy' : !status.reachable && status.checkedAt ? 'down' : isUp ? 'up' : 'idle';
  const statusLabel = busy
    ? `${busy}…`
    : !status.reachable && status.checkedAt
      ? 'WSL não respondeu'
      : !status.checkedAt
        ? 'Verificando…'
        : isUp
          ? 'Conectada'
          : 'Desconectada';

  return (
    <>
      <Panel className={cn('overflow-hidden', isUp && 'border-ok/40')}>
        <header className="flex items-center gap-2 border-b border-line px-2 py-2">
          <Tip content="Voltar para as conexões">
            <Button size="icon" variant="ghost" className="size-8" onClick={() => onOpen(null)} aria-label="Voltar">
              <ArrowLeft />
            </Button>
          </Tip>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[15px] font-semibold">{connection.name}</h2>
            <p className="truncate text-[12px] text-fg-muted">
              {connection.user}@{connection.host}:{connection.port}
            </p>
          </div>
          <Tip content="Editar conexão">
            <Button size="icon" variant="ghost" className="size-8" onClick={() => onEdit(connection)} aria-label="Editar">
              <Pencil />
            </Button>
          </Tip>
          <Tip content={isUp ? 'Desconecte antes de excluir' : 'Excluir conexão'}>
            <span>
              <Button size="icon" variant="ghost" className="size-8 hover:text-danger" onClick={() => onDelete(connection)} disabled={isUp} aria-label="Excluir">
                <Trash2 />
              </Button>
            </span>
          </Tip>
        </header>

        <div className="grid gap-3 px-4 py-4 md:grid-cols-2">
          <section className={cn('flex flex-col gap-2 rounded-md border px-4 py-3', isUp ? 'border-ok/30 bg-ok-soft' : 'border-line bg-panel-2/40')}>
            <span className="text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">Status</span>
            <div className="flex items-center gap-2">
              <Dot state={statusKind} />
              <strong className={cn('text-[17px] font-semibold', isUp && 'text-ok')}>{statusLabel}</strong>
            </div>
            <code className="selectable min-h-4 font-mono text-[12px] text-fg-muted">{isUp ? `ppp0  ${status.address}` : ''}</code>
            {otherActive && <span className="text-[12px] text-warn">“{otherActive}” está conectada</span>}
            {!connection.hasPassword && data.vaultReady && <span className="text-[12px] text-warn">Sem senha salva: edite a conexão</span>}
          </section>
          <AuthenticatorCard connection={connection} vaultReady={data.vaultReady} onManage={() => onManageTotp(connection)} />
        </div>

        <form className="flex gap-2 border-t border-line px-4 py-3" onSubmit={connect}>
          {connection.otpRequired && (
            <Input
              className="h-9 font-mono"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              placeholder={connection.hasTotp ? 'Código OTP · vazio usa o autenticador' : 'Código OTP'}
              disabled={Boolean(busy) || status.up}
              autoFocus={!connection.hasTotp && !status.up}
            />
          )}
          {isUp ? (
            <Button className="h-9 px-5" onClick={() => void run(api.disconnect)} disabled={Boolean(busy)}>
              <Unplug />
              Desconectar
            </Button>
          ) : (
            <Button type="submit" variant="primary" className={cn('h-9 px-5', !connection.otpRequired && 'flex-1 justify-center')} disabled={Boolean(busy) || status.up}>
              <Power />
              Conectar
            </Button>
          )}
        </form>
      </Panel>

      <TunnelCard connection={connection} isUp={isUp} state={state} onError={onError} />
    </>
  );
}
