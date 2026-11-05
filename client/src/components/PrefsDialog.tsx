import { RefreshCw, ShieldCheck } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Prefs } from '../types';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { Switch } from './ui/Switch';

interface PrefsDialogProps {
  prefs: Prefs;
  /** The elevated helper is running right now. */
  elevated: boolean;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}

function Row({ icon, title, description, children }: { icon: ReactNode; title: ReactNode; description: ReactNode; children: ReactNode }) {
  return (
    <label className="flex items-start gap-3 px-5 py-4 [&+&]:border-t [&+&]:border-line">
      <span className="mt-0.5 text-fg-muted [&_svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex items-center gap-2 text-[13px] font-medium">{title}</span>
        <span className="block text-[12.5px] leading-relaxed text-fg-muted">{description}</span>
      </span>
      {children}
    </label>
  );
}

/** How the app behaves: reconnect by itself, and administrator once instead of at every tunnel change. */
export function PrefsDialog({ prefs, elevated, onClose, onSaved, onError }: PrefsDialogProps) {
  const [saving, setSaving] = useState(false);
  const [elevating, setElevating] = useState(false);

  async function save(next: Prefs) {
    setSaving(true);
    try {
      await api.savePrefs(next);
      onSaved();
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function elevateNow() {
    setElevating(true);
    try {
      const { elevated: up } = await api.elevate();
      if (!up) onError('A permissão de administrador não foi concedida.');
    } catch (error) {
      onError((error as Error).message);
    } finally {
      setElevating(false);
    }
  }

  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Preferências"
      description="Valem para todas as conexões."
      footer={
        <Button variant="primary" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      <Row
        icon={<RefreshCw />}
        title="Reconectar sozinho quando a VPN cair"
        description={
          <>
            Tenta de novo após 5 s, 15 s, 30 s… até 5 min entre tentativas, e reaplica o túnel do Windows. Precisa do autenticador cadastrado (ou de uma
            conexão sem OTP). Com uma VPN conectada, fechar a janela deixa o app na bandeja vigiando.
          </>
        }
      >
        <Switch checked={prefs.autoReconnect} disabled={saving} onCheckedChange={(value) => void save({ ...prefs, autoReconnect: value })} aria-label="Reconectar sozinho" />
      </Row>
      <Row
        icon={<ShieldCheck />}
        title={
          <>
            Pedir administrador uma vez, ao abrir
            {elevated ? <Badge tone="ok">ativo agora</Badge> : <Badge>inativo</Badge>}
          </>
        }
        description={
          <>
            Um UAC quando o app abre, e o túnel do Windows (rotas e DNS) não pede mais nada enquanto ele estiver aberto, nem na reconexão. Desligado, cada
            mudança no túnel pede o seu UAC.
            {prefs.elevateOnStart && !elevated && (
              <Button size="sm" className="mt-2 flex" onClick={() => void elevateNow()} disabled={elevating}>
                <ShieldCheck />
                {elevating ? 'Aguardando o UAC…' : 'Pedir agora'}
              </Button>
            )}
          </>
        }
      >
        <Switch checked={prefs.elevateOnStart} disabled={saving} onCheckedChange={(value) => void save({ ...prefs, elevateOnStart: value })} aria-label="Pedir administrador ao abrir" />
      </Row>
    </Modal>
  );
}
