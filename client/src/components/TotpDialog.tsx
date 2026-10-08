import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Connection, TotpCode } from '../types';
import { Icon } from './Icon';
import { Modal } from './Modal';

interface TotpDialogProps {
  connection: Connection;
  onClose: () => void;
  onError: (message: string) => void;
}

/**
 * Registers a connection's authenticator key in the WSL vault. The live code of the typed key
 * is shown so it can be compared with the phone app before saving.
 */
export function TotpDialog({ connection, onClose, onError }: TotpDialogProps) {
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [preview, setPreview] = useState<(TotpCode & { valid: boolean }) | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!secret.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    const tick = () => api.previewTotp(secret).then((result) => !cancelled && setPreview(result), () => undefined);
    void tick();
    const timer = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [secret]);

  async function save() {
    setSaving(true);
    try {
      await api.saveTotp(connection.id, secret);
      onClose();
    } catch (error) {
      onError((error as Error).message);
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm(`Remover o autenticador de ${connection.name}?\nO código OTP voltará a ser digitado.`)) return;
    try {
      await api.removeTotp(connection.id);
      onClose();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <Modal
      title={`Autenticador · ${connection.name}`}
      onClose={onClose}
      footer={
        <>
          {connection.hasTotp && (
            <button type="button" className="button ghost danger-text" onClick={remove}>
              <Icon name="trash" />
              Remover
            </button>
          )}
          <span className="spacer" />
          <button type="button" className="button ghost" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="button primary" onClick={save} disabled={saving || !preview?.valid}>
            <Icon name="save" />
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      <p className="muted">
        {connection.hasTotp
          ? 'Já cadastrado. Para trocar, cole a nova chave e salve.'
          : 'Cole a chave secreta do autenticador (a mesma do app do celular). O código passa a aparecer na tela inicial e é usado sozinho quando o campo OTP fica vazio.'}
      </p>

      <label className="field">
        <span>Chave secreta ou link otpauth://</span>
        <div className="input-with-actions">
          <input
            type={show ? 'text' : 'password'}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            autoComplete="off"
            autoFocus
            placeholder="JBSWY3DPEHPK3PXP…"
          />
          <button type="button" className="icon-button" onClick={() => setShow(!show)} title="Mostrar">
            <Icon name={show ? 'eyeOff' : 'eye'} />
          </button>
        </div>
      </label>

      <div className="totp-live">
        {preview?.valid && preview.code ? (
          <>
            <code className="totp-code">
              {preview.code.slice(0, 3)} {preview.code.slice(3)}
            </code>
            <div className="totp-bar">
              <div style={{ width: `${((preview.remaining ?? 0) / 30) * 100}%` }} />
            </div>
            <span className="muted small">Confira com o app do celular · {preview.remaining}s</span>
          </>
        ) : preview && !preview.valid ? (
          <span className="error-text small">Chave inválida: use base32 (A-Z, 2-7) ou um link otpauth://.</span>
        ) : (
          <span className="muted small">Cole a chave para ver o código ao vivo.</span>
        )}
      </div>

      <p className="hint warn-text small">
        <Icon name="alert" size={13} /> Com a chave no mesmo PC que a senha, quem tiver acesso a este Windows conecta sem o seu
        celular. Confira se a política da empresa permite.
      </p>
    </Modal>
  );
}
