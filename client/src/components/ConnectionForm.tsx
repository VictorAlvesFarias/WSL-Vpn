import { RefreshCw, Save, TriangleAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { Connection, ConnectionInput } from '../types';
import { SecretInput } from './SecretInput';
import { Button } from './ui/Button';
import { Checkbox, FormField, Input } from './ui/Input';
import { Modal } from './ui/Modal';

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

  const set = <K extends keyof ConnectionInput>(key: K, value: ConnectionInput[K]) => setDraft((current) => ({ ...current, [key]: value }));

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
      open
      onOpenChange={(open) => !open && onClose()}
      title={connection ? `Editar ${connection.name}` : 'Nova conexão VPN'}
      description="Gateway Fortinet SSL-VPN, usuário e senha. O túnel para o Windows é escolhido na tela da conexão."
      className="w-[min(640px,calc(100vw-32px))]"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="connection-form" variant="primary" disabled={saving}>
            <Save />
            {saving ? 'Salvando…' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id="connection-form" onSubmit={submit} className="grid grid-cols-2 gap-4 px-5 py-4 max-sm:grid-cols-1">
        <FormField label="Nome" className="col-span-2 max-sm:col-span-1">
          <Input value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Empresa, Cliente X…" autoFocus required />
        </FormField>
        <FormField label="Gateway (Fortinet SSL-VPN)">
          <Input value={draft.host} onChange={(e) => set('host', e.target.value)} placeholder="vpn.empresa.com.br" required />
        </FormField>
        <FormField label="Porta">
          <Input type="number" min={1} max={65535} value={draft.port} onChange={(e) => set('port', Number(e.target.value))} />
        </FormField>
        <FormField label="Usuário">
          <Input value={draft.user} onChange={(e) => set('user', e.target.value)} autoComplete="off" required />
        </FormField>
        <SecretInput label="Senha" stored={Boolean(connection?.hasPassword)} value={draft.password} onChange={(password) => set('password', password)} disabled={!vaultReady} />
        <FormField
          label="Certificado do gateway (SHA-256)"
          hint="O FortiGate não envia a cadeia completa, então o certificado é fixado. Se ele mudar, clique em Detectar."
          className="col-span-2 max-sm:col-span-1"
        >
          <div className="flex gap-2">
            <Input
              className="font-mono text-[12px]"
              value={draft.trustedCert}
              onChange={(e) => set('trustedCert', e.target.value.trim().toLowerCase())}
              placeholder="Vazio: detectado ao salvar"
            />
            <Button onClick={() => void detect()} disabled={!draft.host || detecting}>
              <RefreshCw className={detecting ? 'animate-spin' : undefined} />
              {detecting ? 'Detectando…' : 'Detectar'}
            </Button>
          </div>
        </FormField>
        <div className="col-span-2 flex flex-wrap items-center gap-x-6 gap-y-2 max-sm:col-span-1">
          <Checkbox checked={draft.otpRequired} onChange={(value) => set('otpRequired', value)}>
            Exige código OTP (MFA)
          </Checkbox>
          {draft.otpRequired && (
            <label className="flex items-center gap-2 text-[13px]">
              Atraso
              <Input className="h-7 w-16" type="number" min={0} max={30} value={draft.otpDelay} onChange={(e) => set('otpDelay', Number(e.target.value))} />s
            </label>
          )}
        </div>

        {!vaultReady && (
          <p className="col-span-2 flex gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn max-sm:col-span-1">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            Atualize os comandos do Ubuntu para salvar senhas no cofre.
          </p>
        )}
        {error && (
          <p className="col-span-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-[12.5px] text-danger max-sm:col-span-1">{error}</p>
        )}
      </form>
    </Modal>
  );
}
