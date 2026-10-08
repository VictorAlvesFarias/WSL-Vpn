import { useState } from 'react';
import { api } from '../api';
import type { AppData, Connection, LogEntry, PanelState } from '../types';
import { ConnectionForm } from './ConnectionForm';
import { ConnectionList } from './ConnectionList';
import { ConnectionPanel } from './ConnectionPanel';
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

/** Screen 1 (list) and screen 2 (one connection), with the activity log beside them. */
export function PanelView({ data, state, log, onChanged, onNotify }: PanelViewProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const { connections, vaultReady } = data;
  const { status } = state;
  const notifyError = (message: string) => onNotify('error', message);

  const active = connections.find((c) => c.id === status.activeId && status.up);
  const open = connections.find((c) => c.id === openId) ?? null;

  async function remove(connection: Connection) {
    if (!confirm(`Excluir "${connection.name}"? A senha e o autenticador dela no cofre também são apagados.`)) return;
    try {
      await api.deleteConnection(connection.id);
      setOpenId(null);
      onNotify('ok', `"${connection.name}" excluída`);
      onChanged();
    } catch (error) {
      notifyError((error as Error).message);
    }
  }

  return (
    <div className="panel-layout">
      <div className="panel-main">
        {open ? (
          <ConnectionPanel
            connection={open}
            otherActive={active && active.id !== open.id ? active.name : null}
            state={state}
            vaultReady={vaultReady}
            onBack={() => setOpenId(null)}
            onEdit={() => setDialog({ kind: 'connection', connection: open })}
            onDelete={() => remove(open)}
            onManageTotp={() => setDialog({ kind: 'totp', connection: open })}
            onError={notifyError}
          />
        ) : (
          <ConnectionList
            connections={connections}
            state={state}
            onOpen={(connection) => setOpenId(connection.id)}
            onNew={() => setDialog({ kind: 'connection', connection: null })}
            onError={notifyError}
          />
        )}
      </div>

      <LogView entries={log} />

      {dialog?.kind === 'connection' && (
        <ConnectionForm
          connection={dialog.connection}
          vaultReady={vaultReady}
          onClose={() => setDialog(null)}
          onSaved={(connection) => {
            setDialog(null);
            setOpenId(connection.id);
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
