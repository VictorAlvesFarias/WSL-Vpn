import { useEffect, useState } from 'react';
import { api } from '../api';
import type { TotpCode } from '../types';
import { Icon } from './Icon';

interface TotpDialogProps {
  enabled: boolean;
  onClose: () => void;
  onError: (message: string) => void;
}

/**
 * Registers the authenticator key in the WSL vault. The live code (from the typed key, or from
 * the stored one) is shown so it can be compared with the phone app before trusting it.
 */
export function TotpDialog({ enabled, onClose, onError }: TotpDialogProps) {
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [live, setLive] = useState<TotpCode & { source?: 'typed' | 'stored'; invalid?: boolean }>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        if (secret.trim()) {
          const preview = await api.previewTotp(secret);
          if (!cancelled) setLive(preview.valid ? { ...preview, source: 'typed' } : { invalid: true });
        } else if (enabled) {
          const stored = await api.totp();
          if (!cancelled) setLive(stored.enabled ? { ...stored, source: 'stored' } : {});
        } else if (!cancelled) {
          setLive({});
        }
      } catch {
        if (!cancelled) setLive({});
      }
    }
    void tick();
    const timer = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [secret, enabled]);

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      await api.saveTotp(secret);
      setSecret('');
      setMessage({ kind: 'ok', text: 'Salvo. O código acima é o que o app vai usar ao conectar.' });
    } catch (error) {
      setMessage({ kind: 'error', text: (error as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm('Remover o autenticador cadastrado?\nO código OTP voltará a ser digitado.')) return;
    try {
      await api.removeTotp();
      setMessage({ kind: 'ok', text: 'Autenticador removido.' });
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="modal card">
        <header className="modal-head">
          <h2>Autenticador (OTP)</h2>
          <button className="icon-button" onClick={onClose} title="Fechar">
            <Icon name="x" />
          </button>
        </header>

        <p className="muted">
          {enabled
            ? 'Cadastrado: o app gera o código sozinho ao conectar. Para trocar, cole uma chave nova e salve.'
            : 'Nenhum cadastrado: o código é digitado a cada conexão.'}
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
          {live.code ? (
            <>
              <code className="totp-code">
                {live.code.slice(0, 3)} {live.code.slice(3)}
              </code>
              <div className="totp-bar">
                <div style={{ width: `${((live.remaining ?? 0) / 30) * 100}%` }} />
              </div>
              <span className="muted small">
                Confira com o app do celular ({live.source === 'typed' ? 'chave digitada' : 'chave cadastrada'}) ·{' '}
                {live.remaining}s
              </span>
            </>
          ) : live.invalid ? (
            <span className="error-text small">Chave inválida: use base32 (A-Z, 2-7) ou um link otpauth://.</span>
          ) : (
            <span className="muted small">Cole a chave para ver o código ao vivo.</span>
          )}
        </div>

        <p className="hint warn-text small">
          <Icon name="alert" size={13} /> Com a chave no mesmo PC que a senha, quem tiver acesso a este Windows conecta
          sem o seu celular. Confira se a política da empresa permite.
        </p>

        {message && <p className={message.kind === 'ok' ? 'form-ok' : 'form-error'}>{message.text}</p>}

        <footer className="modal-actions">
          {enabled && (
            <button className="button ghost danger-text" onClick={remove}>
              <Icon name="trash" />
              Remover
            </button>
          )}
          <span className="spacer" />
          <button className="button ghost" onClick={onClose}>
            Fechar
          </button>
          <button className="button primary" onClick={save} disabled={saving || !live.code || live.source !== 'typed'}>
            <Icon name="save" />
            {saving ? 'Salvando…' : 'Salvar'}
          </button>
        </footer>
      </div>
    </div>
  );
}
