import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { tunnelSummary, type Connection, type PanelState } from '../types';
import { AuthenticatorCard } from './AuthenticatorCard';
import { Icon } from './Icon';

interface ConnectionPanelProps {
  connection: Connection;
  /** Name of another connection that is up, if any. */
  otherActive: string | null;
  state: PanelState;
  vaultReady: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onManageTotp: () => void;
  onError: (message: string) => void;
}

export function ConnectionPanel(props: ConnectionPanelProps) {
  const { connection, otherActive, state, vaultReady, onEdit, onDelete, onManageTotp, onError } = props;
  const { status, busy } = state;
  const [otp, setOtp] = useState('');

  useEffect(() => setOtp(''), [connection.id]);

  // Up through the app with this connection, or up some other way while nothing else claims it.
  const isUp = status.up && (status.activeId === connection.id || (!status.activeId && !otherActive));

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      onError((error as Error).message);
    }
  }

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

  const statusKind = busy ? 'busy' : !status.reachable && status.checkedAt ? 'unknown' : isUp ? 'up' : 'down';
  const statusLabel = busy
    ? `${busy}…`
    : statusKind === 'unknown'
      ? 'WSL não respondeu'
      : !status.checkedAt
        ? 'Verificando…'
        : isUp
          ? 'Conectada'
          : 'Desconectada';

  const tunnelConfigured = connection.tunnel.enabled;
  const tunnelOn = isUp && status.tunnel === 'on';

  return (
    <section className="card connection-panel">
      <header className="connection-head">
        <div className="connection-title">
          <h2>{connection.name}</h2>
          <span className="muted small">
            {connection.user}@{connection.host}:{connection.port}
          </span>
        </div>
        <button className="icon-button" onClick={onEdit} title="Editar conexão">
          <Icon name="edit" />
        </button>
        <button className="icon-button danger" onClick={onDelete} title="Excluir conexão" disabled={isUp}>
          <Icon name="trash" />
        </button>
      </header>

      <div className="connection-body">
        <div className={`status-block ${statusKind}`}>
          <div className="status-row">
            <span className={`dot ${statusKind}`} />
            <strong className="status-label">{statusLabel}</strong>
          </div>
          <code className="status-address">{isUp ? `ppp0  ${status.address}` : ' '}</code>
          {otherActive && <span className="small warn-text">“{otherActive}” está conectada</span>}
          {!connection.hasPassword && vaultReady && (
            <span className="small warn-text">Sem senha salva: edite a conexão</span>
          )}
        </div>

        {connection.otpRequired ? (
          <AuthenticatorCard connection={connection} vaultReady={vaultReady} onManage={onManageTotp} />
        ) : (
          <section className="auth-card empty">
            <span className="eyebrow">
              <Icon name="key" size={13} /> Autenticador
            </span>
            <p className="muted small">Esta conexão não usa código OTP.</p>
          </section>
        )}
      </div>

      <form className="connect-row" onSubmit={connect}>
        {connection.otpRequired && (
          <input
            className="otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={otp}
            onChange={(event) => setOtp(event.target.value)}
            placeholder={connection.hasTotp ? 'Código OTP · vazio usa o autenticador' : 'Código OTP'}
            disabled={Boolean(busy) || status.up}
          />
        )}
        {isUp ? (
          <button type="button" className="button big" onClick={() => run(api.disconnect)} disabled={Boolean(busy)}>
            <Icon name="unplug" />
            Desconectar
          </button>
        ) : (
          <button type="submit" className="button primary big" disabled={Boolean(busy) || status.up}>
            <Icon name="power" />
            Conectar
          </button>
        )}
      </form>

      <div className={`tunnel-row${tunnelOn ? ' is-on' : ''}`}>
        <Icon name="globe" />
        <div className="tunnel-text">
          <strong>Túnel no Windows</strong>
          <span className="muted small">
            {tunnelConfigured
              ? `${tunnelSummary(connection.tunnel)} · ${tunnelOn ? (status.tunnelGlobal ? 'ativo (global)' : 'ativo') : 'liga ao conectar'}`
              : 'Não configurado: Editar > Adicionar túnel'}
          </span>
        </div>
        {status.tunnel === 'partial' ? (
          <button className="button warn small" onClick={() => run(api.tunnelOff)} disabled={Boolean(busy)}>
            Limpar túnel
          </button>
        ) : (
          <label className="switch" title={tunnelOn ? 'Remover o túnel' : 'Adicionar o túnel'}>
            <input
              type="checkbox"
              checked={tunnelOn}
              disabled={Boolean(busy) || !isUp || (!tunnelConfigured && !tunnelOn)}
              onChange={(event) => run(event.target.checked ? () => api.tunnelOn(connection.id) : api.tunnelOff)}
            />
            <span />
          </label>
        )}
      </div>
    </section>
  );
}
