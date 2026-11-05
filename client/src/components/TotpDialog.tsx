import { Eye, EyeOff, Save, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Connection, TotpCode } from '../types';
import { TotpDisplay } from './AuthenticatorCard';
import type { ConfirmOptions } from './ui/Confirm';
import { Button } from './ui/Button';
import { FormField, Input } from './ui/Input';
import { Modal } from './ui/Modal';

interface TotpDialogProps {
  connection: Connection;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onClose: () => void;
  onError: (message: string) => void;
}

/**
 * Registers a connection's authenticator key in the WSL vault. The live code of the typed key
 * is shown so it can be compared with the phone app before saving.
 */
export function TotpDialog({ connection, confirm, onClose, onError }: TotpDialogProps) {
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
    const ok = await confirm({
      title: `Remover o autenticador de ${connection.name}?`,
      description: 'O código OTP voltará a ser digitado ao conectar.',
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.removeTotp(connection.id);
      onClose();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Autenticador · ${connection.name}`}
      description={
        connection.hasTotp
          ? 'Já cadastrado. Para trocar, cole a nova chave e salve.'
          : 'Cole a chave secreta do autenticador (a mesma do app do celular). O código passa a aparecer na tela da conexão e é usado sozinho quando o campo OTP fica vazio.'
      }
      footer={
        <>
          {connection.hasTotp && (
            <Button variant="ghost" className="mr-auto text-danger hover:bg-danger-soft hover:text-danger" onClick={() => void remove()}>
              <Trash2 />
              Remover
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" onClick={() => void save()} disabled={saving || !preview?.valid}>
            <Save />
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <div className="space-y-4 px-5 py-4">
        <FormField label="Chave secreta ou link otpauth://">
          <div className="relative">
            <Input
              type={show ? 'text' : 'password'}
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              autoComplete="off"
              autoFocus
              placeholder="JBSWY3DPEHPK3PXP…"
              className="pr-9 font-mono"
            />
            <Button size="icon" variant="ghost" className="absolute top-1 right-1 size-6 [&_svg]:size-3.5" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar' : 'Mostrar'}>
              {show ? <EyeOff /> : <Eye />}
            </Button>
          </div>
        </FormField>

        <div className="rounded-md border border-line bg-panel-2/40 px-4 py-3">
          {preview?.valid && preview.code ? (
            <div className="space-y-2">
              <TotpDisplay code={preview.code} remaining={preview.remaining ?? 0} />
              <p className="text-[12px] text-fg-muted">Confira com o app do celular · {preview.remaining}s</p>
            </div>
          ) : preview && !preview.valid ? (
            <p className="text-[12.5px] text-danger">Chave inválida: use base32 (A-Z, 2-7) ou um link otpauth://.</p>
          ) : (
            <p className="text-[12.5px] text-fg-muted">Cole a chave para ver o código ao vivo.</p>
          )}
        </div>

        <p className="flex gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] leading-relaxed text-warn">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          Com a chave no mesmo PC que a senha, quem tiver acesso a este Windows conecta sem o seu celular. Confira se a política da empresa permite.
        </p>
      </div>
    </Modal>
  );
}
