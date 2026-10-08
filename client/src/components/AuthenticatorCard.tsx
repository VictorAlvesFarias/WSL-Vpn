import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Connection, TotpCode } from '../types';
import { Icon } from './Icon';

interface AuthenticatorCardProps {
  connection: Connection;
  vaultReady: boolean;
  onManage: () => void;
}

/** Live code of the connection's authenticator, like the phone app shows it. */
export function AuthenticatorCard({ connection, vaultReady, onManage }: AuthenticatorCardProps) {
  const [live, setLive] = useState<TotpCode | null>(null);

  useEffect(() => {
    setLive(null);
    if (!connection.hasTotp) return;
    let cancelled = false;
    const tick = () => api.totp(connection.id).then((result) => !cancelled && setLive(result.enabled ? result : null), () => undefined);
    void tick();
    const timer = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection.id, connection.hasTotp]);

  if (!connection.hasTotp) {
    return (
      <section className="auth-card empty">
        <span className="eyebrow">
          <Icon name="key" size={13} /> Autenticador
        </span>
        <p className="muted small">Cadastre a chave para ver os números aqui e conectar sem digitar o código.</p>
        <button className="button small" onClick={onManage} disabled={!vaultReady}>
          <Icon name="key" />
          Cadastrar autenticador
        </button>
      </section>
    );
  }

  const remaining = live?.remaining ?? 0;
  return (
    <section className="auth-card">
      <div className="auth-head">
        <span className="eyebrow">
          <Icon name="key" size={13} /> Autenticador
        </span>
        <button className="icon-button" onClick={onManage} title="Gerenciar autenticador">
          <Icon name="settings" />
        </button>
      </div>
      <code className={`auth-code${remaining > 0 && remaining <= 5 ? ' expiring' : ''}`}>
        {live?.code ? `${live.code.slice(0, 3)} ${live.code.slice(3)}` : '··· ···'}
      </code>
      <div className="totp-bar">
        <div style={{ width: `${(remaining / 30) * 100}%` }} />
      </div>
      <span className="muted small">{live ? `${remaining}s` : 'carregando…'}</span>
    </section>
  );
}
