import { useState } from 'react';
import { api } from '../api';
import { tunnelSummary, type Connection, type PanelState } from '../types';
import { Icon } from './Icon';

interface ConnectionListProps {
  connections: Connection[];
  state: PanelState;
  onOpen: (connection: Connection) => void;
  onNew: () => void;
  onError: (message: string) => void;
}

/** Screen 1: every connection, each with its own connect button. */
export function ConnectionList({ connections, state, onOpen, onNew, onError }: ConnectionListProps) {
  const { status, busy } = state;
  const [starting, setStarting] = useState<string | null>(null);

  async function connect(connection: Connection) {
    // Without an authenticator the code has to be typed: that happens on the connection screen.
    if (connection.otpRequired && !connection.hasTotp) {
      onOpen(connection);
      onError(`Informe o código OTP de "${connection.name}".`);
      return;
    }
    setStarting(connection.id);
    try {
      await api.connect(connection.id, '');
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setStarting(null);
    }
  }

  async function disconnect() {
    try {
      await api.disconnect();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <section className="connection-list">
      <header className="section-head">
        <h2>Conexões</h2>
        <button className="button primary" onClick={onNew}>
          <Icon name="plus" />
          Nova conexão
        </button>
      </header>

      {status.up && !status.activeId && (
        <div className="banner warn">
          <Icon name="alert" />
          <span>Há uma VPN conectada fora do app ({status.address}).</span>
          <span className="spacer" />
          <button className="button small" onClick={disconnect} disabled={Boolean(busy)}>
            Desconectar
          </button>
        </div>
      )}

      {connections.length === 0 ? (
        <div className="card empty-state">
          <Icon name="shield" size={32} />
          <h2>Crie sua primeira conexão</h2>
          <p className="muted">Gateway, usuário e senha. O túnel para o Windows é escolhido depois, na tela da conexão.</p>
          <button className="button primary" onClick={onNew}>
            <Icon name="plus" />
            Nova conexão
          </button>
        </div>
      ) : (
        <ul className="connection-cards">
          {connections.map((connection) => {
            const isUp = status.up && status.activeId === connection.id;
            const otherUp = status.up && !isUp;
            return (
              <li key={connection.id} className={`card connection-card${isUp ? ' is-up' : ''}`}>
                <button className="connection-card-body" onClick={() => onOpen(connection)} title="Abrir a conexão">
                  <span className={`dot ${isUp ? 'up' : 'idle'}`} />
                  <span className="list-text">
                    <strong>{connection.name}</strong>
                    <span className="muted small">
                      {connection.user}@{connection.host}
                    </span>
                  </span>
                  <span className="connection-tags">
                    <span className={`chip${connection.tunnel.mode !== 'off' ? ' chip-accent' : ''}`}>
                      {tunnelSummary(connection.tunnel)}
                    </span>
                    {connection.otpRequired && connection.hasTotp && <span className="chip">Autenticador</span>}
                  </span>
                  <Icon name="chevron" />
                </button>
                {isUp ? (
                  <button className="button" onClick={disconnect} disabled={Boolean(busy)}>
                    <Icon name="unplug" />
                    Desconectar
                  </button>
                ) : (
                  <button
                    className="button primary"
                    onClick={() => connect(connection)}
                    disabled={Boolean(busy) || otherUp}
                    title={otherUp ? 'Outra conexão está ativa' : undefined}
                  >
                    <Icon name="power" />
                    {starting === connection.id ? 'Conectando…' : 'Conectar'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
