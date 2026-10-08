import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api } from '../api';
import { modeLabels, type Config, type ConfigKey, type GatewayMode, type VaultSecret, type VaultStatus } from '../types';
import { Icon } from './Icon';
import { TotpDialog } from './TotpDialog';

interface SettingsViewProps {
  config: Config;
  busy: boolean;
  totpEnabled: boolean;
  onSaved: (config: Config) => void;
  onNotify: (kind: 'ok' | 'error', message: string) => void;
}

interface FieldProps {
  name: ConfigKey;
  label: string;
  hint?: ReactNode;
  placeholder?: string;
  mono?: boolean;
  wide?: boolean;
}

export function SettingsView({ config, busy, totpEnabled, onSaved, onNotify }: SettingsViewProps) {
  const [draft, setDraft] = useState<Config>(config);
  const [saving, setSaving] = useState(false);
  const [vault, setVault] = useState<VaultStatus | null>(null);
  const [totpOpen, setTotpOpen] = useState(false);
  const dirty = (Object.keys(draft) as ConfigKey[]).some((key) => draft[key] !== config[key]);

  useEffect(() => setDraft(config), [config]);
  useEffect(() => {
    api.vault().then(setVault, () => setVault(null));
  }, [totpEnabled]);

  const set = (name: ConfigKey, value: string) => setDraft((current) => ({ ...current, [name]: value }));

  function Field({ name, label, hint, placeholder, mono, wide }: FieldProps) {
    return (
      <label className={`field${wide ? ' wide' : ''}`}>
        <span>{label}</span>
        <input
          className={mono ? 'mono' : undefined}
          value={draft[name]}
          onChange={(event) => set(name, event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
        />
        {hint && <small className="muted">{hint}</small>}
      </label>
    );
  }

  async function save(event: FormEvent, apply: boolean) {
    event.preventDefault();
    setSaving(true);
    try {
      const saved = await api.saveConfig(draft);
      onSaved(saved.values);
      onNotify('ok', 'Configuração salva');
      if (apply) {
        const result = await api.applyConfig();
        onNotify(result.ok ? 'ok' : 'error', result.ok ? 'Aplicada no Ubuntu' : 'Falha ao aplicar: veja o log no Painel');
      }
    } catch (error) {
      onNotify('error', (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings">
      <form className="settings-form" onSubmit={(event) => save(event, true)}>
        <section className="card settings-section">
          <h3>VPN (Fortinet SSL-VPN)</h3>
          <div className="grid-fields">
            {Field({ name: 'VPN_HOST', label: 'Gateway', placeholder: 'vpn.empresa.com.br' })}
            {Field({ name: 'VPN_PORT', label: 'Porta', placeholder: '10443' })}
            {Field({ name: 'VPN_USER', label: 'Usuário da VPN' })}
            {Field({
              name: 'VPN_TRUSTED_CERT',
              label: 'Fingerprint do certificado (SHA-256)',
              placeholder: 'vazio: detectado na instalação',
              mono: true,
              wide: true,
              hint: 'O FortiGate não envia a cadeia completa, então o certificado é fixado por fingerprint.',
            })}
            <label className="field">
              <span>Código OTP</span>
              <select value={draft.VPN_OTP_REQUIRED} onChange={(event) => set('VPN_OTP_REQUIRED', event.target.value)}>
                <option value="1">Obrigatório (MFA)</option>
                <option value="0">Não usa</option>
              </select>
            </label>
            {Field({ name: 'VPN_OTP_DELAY', label: 'Atraso do OTP (s)', hint: 'Aumente para 3–4 se o código for recusado por tempo.' })}
          </div>
        </section>

        <section className="card settings-section">
          <h3>RDP</h3>
          <div className="grid-fields">
            {Field({ name: 'RDP_HOST', label: 'Máquina', placeholder: 'maquina.interna' })}
            {Field({ name: 'RDP_USER', label: 'Usuário' })}
            {Field({ name: 'RDP_DOMAIN', label: 'Domínio' })}
            {Field({ name: 'RDP_RESOLUTION', label: 'Resolução', placeholder: 'fullscreen ou 1600x900' })}
            {Field({ name: 'RDP_EXTRA_OPTS', label: 'Opções extras do xfreerdp3', mono: true, wide: true })}
          </div>
        </section>

        <section className="card settings-section">
          <h3>Usar a VPN no Windows</h3>
          <div className="grid-fields">
            {Field({
              name: 'GATEWAY_ROUTES',
              label: 'Redes da empresa',
              placeholder: '10.0.0.0/8 172.16.0.0/12',
              mono: true,
              hint: 'Enviadas ao túnel enquanto o botão estiver ligado.',
            })}
            {Field({
              name: 'GATEWAY_DNS_SUFFIXES',
              label: 'Domínios internos',
              placeholder: '.empresa.local',
              mono: true,
              hint: 'Resolvidos no DNS da empresa; o resto segue o DNS normal.',
            })}
            <label className="field">
              <span>Modo inicial</span>
              <select value={draft.GATEWAY_MODE} onChange={(event) => set('GATEWAY_MODE', event.target.value)}>
                {(Object.keys(modeLabels) as GatewayMode[]).map((mode) => (
                  <option key={mode} value={mode}>
                    {modeLabels[mode]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <section className="card settings-section">
          <h3>Ubuntu (WSL2)</h3>
          <div className="grid-fields">
            {Field({ name: 'WSL_DISTRO', label: 'Distro', placeholder: 'Ubuntu-24.04' })}
            {Field({ name: 'LINUX_USER', label: 'Usuário do Linux' })}
          </div>
        </section>

        <footer className="settings-actions">
          <span className="muted small">{dirty ? 'Alterações não salvas' : 'Tudo salvo'}</span>
          <span className="spacer" />
          <button type="button" className="button ghost" onClick={() => setDraft(config)} disabled={!dirty || saving}>
            Descartar
          </button>
          <button type="button" className="button" onClick={(event) => save(event, false)} disabled={!dirty || saving}>
            <Icon name="save" />
            Salvar
          </button>
          <button type="submit" className="button primary" disabled={saving || busy}>
            <Icon name="upload" />
            {saving ? 'Aplicando…' : 'Salvar e aplicar no Ubuntu'}
          </button>
        </footer>
      </form>

      <aside className="settings-side">
        <section className="card settings-section">
          <h3>
            <Icon name="shield" size={15} /> Senhas no cofre
          </h3>
          <p className="muted small">
            Ficam só dentro do WSL2, em <code>/etc/vpnwsl.secrets</code> (600 root:root). Nunca são gravadas no Windows.
          </p>
          <SecretRow name="VPN_PASSWORD" label="Senha da VPN" vault={vault} onVault={setVault} onNotify={onNotify} />
          <SecretRow name="RDP_PASSWORD" label="Senha do RDP" vault={vault} onVault={setVault} onNotify={onNotify} />
          <div className="secret-row">
            <div className="secret-row-head">
              <strong>Autenticador (OTP)</strong>
              <StatusChip on={totpEnabled} onText="Cadastrado" offText="Não cadastrado" />
            </div>
            <button className="button small" onClick={() => setTotpOpen(true)}>
              <Icon name="key" />
              {totpEnabled ? 'Gerenciar' : 'Cadastrar'}
            </button>
          </div>
        </section>
      </aside>

      {totpOpen && (
        <TotpDialog enabled={totpEnabled} onClose={() => setTotpOpen(false)} onError={(m) => onNotify('error', m)} />
      )}
    </div>
  );
}

function StatusChip({ on, onText, offText }: { on: boolean | undefined; onText: string; offText: string }) {
  if (on === undefined) return <span className="chip">…</span>;
  return <span className={`chip ${on ? 'chip-ok' : 'chip-warn'}`}>{on ? onText : offText}</span>;
}

interface SecretRowProps {
  name: VaultSecret;
  label: string;
  vault: VaultStatus | null;
  onVault: (vault: VaultStatus) => void;
  onNotify: (kind: 'ok' | 'error', message: string) => void;
}

function SecretRow({ name, label, vault, onVault, onNotify }: SecretRowProps) {
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  async function store(next: string) {
    setSaving(true);
    try {
      onVault(await api.setSecret(name, next));
      setValue('');
      onNotify('ok', next ? `${label} salva no cofre` : `${label} removida`);
    } catch (error) {
      onNotify('error', (error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="secret-row">
      <div className="secret-row-head">
        <strong>{label}</strong>
        <StatusChip on={vault?.[name]} onText="Salva" offText="Pedida a cada uso" />
      </div>
      <form
        className="secret-row-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (value) void store(value);
        }}
      >
        <div className="input-with-actions">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={vault?.[name] ? 'Trocar senha' : 'Senha'}
            autoComplete="new-password"
          />
          <button type="button" className="icon-button" onClick={() => setShow(!show)} title="Mostrar">
            <Icon name={show ? 'eyeOff' : 'eye'} />
          </button>
        </div>
        <button type="submit" className="button small" disabled={!value || saving}>
          Salvar
        </button>
        {vault?.[name] && (
          <button
            type="button"
            className="icon-button danger"
            title="Remover do cofre"
            disabled={saving}
            onClick={() => confirm(`Remover a ${label.toLowerCase()} do cofre?`) && store('')}
          >
            <Icon name="trash" />
          </button>
        )}
      </form>
    </div>
  );
}
