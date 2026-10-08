import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Connection, ConnectionInput } from '../types';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { SecretInput } from './SecretInput';

interface ConnectionFormProps {
  /** null creates a new connection. */
  connection: Connection | null;
  vaultReady: boolean;
  onClose: () => void;
  onSaved: (connection: Connection) => void;
}

const blank: ConnectionInput = {
  name: '',
  host: '',
  port: 10443,
  user: '',
  trustedCert: '',
  otpRequired: true,
  otpDelay: 2,
};

/** Connection details. The tunnel is set on the connection screen. */
export function ConnectionForm({ connection, vaultReady, onClose, onSaved }: ConnectionFormProps) {
  const [draft, setDraft] = useState<ConnectionInput>(() => {
    if (!connection) return blank;
    const { id: _id, hasPassword: _p, hasTotp: _t, tunnel: _tunnel, ...rest } = connection;
    return rest;
  });
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  async function detect() {
    setDetecting(true);
    setError(null);
    try {
      set('trustedCert', (await api.detectCertificate(draft.host, draft.port)).fingerprint);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDetecting(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      onSaved(connection ? await api.updateConnection(connection.id, draft) : await api.createConnection(draft));
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  }

  return (
    <Modal
      title={connection ? `Editar ${connection.name}` : 'Nova conexão VPN'}
      onClose={onClose}
      onSubmit={submit}
      wide
      footer={
        <>
          <span className="spacer" />
          <button type="button" className="button ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="button primary" disabled={saving}>
            <Icon name="save" />
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label className="field span-2">
          <span>Nome</span>
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Empresa, Cliente X…" autoFocus required />
        </label>
        <label className="field">
          <span>Gateway (Fortinet SSL-VPN)</span>
          <input value={draft.host} onChange={(e) => set('host', e.target.value)} placeholder="vpn.empresa.com.br" required />
        </label>
        <label className="field">
          <span>Porta</span>
          <input type="number" min={1} max={65535} value={draft.port} onChange={(e) => set('port', Number(e.target.value))} />
        </label>
        <label className="field">
          <span>Usuário</span>
          <input value={draft.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" required />
        </label>
        <SecretInput
          label="Senha"
          stored={Boolean(connection?.hasPassword)}
          value={draft.password}
          onChange={(password) => set('password', password)}
          disabled={!vaultReady}
        />
        <label className="field span-2">
          <span>Certificado do gateway (SHA-256)</span>
          <div className="input-row">
            <input
              className="mono"
              value={draft.trustedCert}
              onChange={(e) => set('trustedCert', e.target.value.trim().toLowerCase())}
              placeholder="Vazio: detectado ao salvar"
              spellCheck={false}
            />
            <button type="button" className="button" onClick={detect} disabled={!draft.host || detecting}>
              <Icon name="refresh" />
              {detecting ? 'Detectando…' : 'Detectar'}
            </button>
          </div>
          <small className="muted">O FortiGate não envia a cadeia completa, então o certificado é fixado. Se ele mudar, clique em Detectar.</small>
        </label>
        <div className="span-2 inline-fields">
          <label className="check">
            <input type="checkbox" checked={draft.otpRequired} onChange={(e) => set('otpRequired', e.target.checked)} />
            Exige código OTP (MFA)
          </label>
          {draft.otpRequired && (
            <label className="check">
              Atraso
              <input
                className="tiny"
                type="number"
                min={0}
                max={30}
                value={draft.otpDelay}
                onChange={(e) => set('otpDelay', Number(e.target.value))}
              />
              s
            </label>
          )}
        </div>
      </div>

      {!vaultReady && (
        <p className="hint warn-text small">
          <Icon name="alert" size={13} /> Atualize os comandos do Ubuntu para salvar senhas no cofre.
        </p>
      )}
      {error && <p className="form-error">{error}</p>}
    </Modal>
  );
}
