import { useEffect, useState } from 'react';
import { api } from '../api';
import type { AppData, Connection, LogEntry, PanelState } from '../types';
import { ConnectionForm } from './ConnectionForm';
import { ConnectionPanel } from './ConnectionPanel';
import { Icon } from './Icon';
import { LogView } from './LogView';
import { TotpDialog } from './TotpDialog';

interface PanelViewProps {
  data: AppData;
  state: PanelState;
  log: LogEntry[];
  onChanged: () => void;
  onNotify: (kind: 'ok' | 'error', message: string) => void;
}

type Dialog = { kind: 'connection'; connection: Connection | null } | { kind: 'totp'; connection: Connection };

const selectedKey = 'wsl-vpn:selected';

function rememberedSelection(): string | null {
  try {
    return localStorage.getItem(selectedKey);
  } catch {
    return null;
  }
}

export function PanelView({ data, state, log, onChanged, onNotify }: PanelViewProps) {
  const [selectedId, setSelectedId] = useState<string | null>(rememberedSelection);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { connections, vaultReady } = data;
  const { status } = state;
  const notifyError = (message: string) => onNotify('error', message);

  const active = connections.find((c) => c.id === status.activeId && status.up);
  const selected = connections.find((c) => c.id === selectedId) ?? active ?? connections[0] ?? null;

  useEffect(() => {
    try {
      if (selected) localStorage.setItem(selectedKey, selected.id);
    } catch {
      // Storage unavailable: the selection just isn't remembered.
    }
  }, [selected?.id]);

  async function remove(connection: Connection) {
    if (!confirm(`Excluir "${connection.name}"? A senha e o autenticador dela no cofre também são apagados.`)) return;
    try {
      await api.deleteConnection(connection.id);
      onNotify('ok', `"${connection.name}" excluída`);
      onChanged();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  const newConnection = () => setDialog({ kind: 'connection', connection: null });

  return (
    <div className="panel-layout">
      <aside className="sidebar">
        <section className="card list-card">
          <header className="list-head">
            <span className="eyebrow">
              <Icon name="shield" size={13} /> Conexões
            </span>
            <button className="button small primary" onClick={newConnection}>
              <Icon name="plus" />
              Nova conexão
            </button>
          </header>
          {connections.length === 0 ? (
            <p className="list-empty muted small">Nenhuma conexão ainda.</p>
          ) : (
            <ul className="list">
              {connections.map((connection) => {
                const isUp = status.up && status.activeId === connection.id;
                return (
                  <li key={connection.id}>
                    <button
                      className={`list-item${selected?.id === connection.id ? ' is-selected' : ''}`}
                      onClick={() => setSelectedId(connection.id)}
                    >
                      <span className={`dot small-dot ${isUp ? 'up' : 'idle'}`} />
                      <span className="list-text">
                        <strong>{connection.name}</strong>
                        <span className="muted small">{connection.host}</span>
                      </span>
                      {connection.tunnel.enabled && (
                        <span title="Com túnel para o Windows">
                          <Icon name="globe" size={14} />
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </aside>

      <div className="panel-main">
        {selected ? (
          <ConnectionPanel
            connection={selected}
            otherActive={active && active.id !== selected.id ? active.name : null}
            state={state}
            vaultReady={vaultReady}
            onEdit={() => setDialog({ kind: 'connection', connection: selected })}
            onDelete={() => remove(selected)}
            onManageTotp={() => setDialog({ kind: 'totp', connection: selected })}
            onError={notifyError}
          />
        ) : (
          <section className="card empty-state">
            <Icon name="shield" size={32} />
            <h2>Crie sua primeira conexão</h2>
            <p className="muted">Gateway, usuário, senha e, se quiser, o túnel para o Windows usar a VPN.</p>
            <button className="button primary" onClick={newConnection}>
              <Icon name="plus" />
              Nova conexão
            </button>
          </section>
        )}
        <LogView entries={log} />
      </div>

      {dialog?.kind === 'connection' && (
        <ConnectionForm
          connection={dialog.connection}
          vaultReady={vaultReady}
          onClose={() => setDialog(null)}
          onSaved={(connection) => {
            setDialog(null);
            setSelectedId(connection.id);
            onNotify('ok', `Conexão "${connection.name}" salva`);
            onChanged();
          }}
        />
      )}
      {dialog?.kind === 'totp' && (
        <TotpDialog
          connection={connections.find((c) => c.id === dialog.connection.id) ?? dialog.connection}
          onClose={() => setDialog(null)}
          onError={notifyError}
        />
      )}
    </div>
  );
}
