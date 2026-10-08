import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { LogEntry, Settings, SystemInfo } from '../types';
import { Icon } from './Icon';
import { LogView } from './LogView';

interface InstallViewProps {
  settings: Settings;
  system: SystemInfo | null;
  busy: string | null;
  log: LogEntry[];
  onRefresh: () => void;
  onNotify: (kind: 'ok' | 'error', message: string) => void;
}

function Check({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className={ok ? 'ok' : 'todo'}>
      <span className="check-icon">{ok ? <Icon name="check" size={14} /> : <Icon name="x" size={14} />}</span>
      <span>
        {label}
        {detail && <small className="muted"> · {detail}</small>}
      </span>
    </li>
  );
}

export function InstallView({ settings, system, busy, log, onRefresh, onNotify }: InstallViewProps) {
  const [draft, setDraft] = useState(settings);
  const [linuxPassword, setLinuxPassword] = useState('');
  const [running, setRunning] = useState(false);
  const dirty = draft.distro !== settings.distro || draft.linuxUser !== settings.linuxUser;

  useEffect(() => setDraft(settings), [settings]);

  async function run(action: () => Promise<{ ok: boolean }>, okText: string, failText: string) {
    setRunning(true);
    try {
      const result = await action();
      onNotify(result.ok ? 'ok' : 'error', result.ok ? okText : failText);
    } catch (error) {
      onNotify('error', (error as Error).message);
    } finally {
      setRunning(false);
      onRefresh();
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    try {
      await api.saveSettings(draft);
      onNotify('ok', 'Configuração do Ubuntu salva');
      onRefresh();
    } catch (error) {
      onNotify('error', (error as Error).message);
    }
  }

  function install(event: FormEvent) {
    event.preventDefault();
    if (!confirm('A instalação reinicia o WSL: se a VPN estiver conectada, ela vai cair. Continuar?')) return;
    const password = linuxPassword;
    setLinuxPassword('');
    void run(() => api.install(password), 'Instalação concluída', 'A instalação falhou: veja o log');
  }

  const helperOk = system?.helperVersion === system?.requiredHelperVersion;
  const disabled = running || Boolean(busy);

  return (
    <div className="install-grid">
      <div className="install-side">
        <section className="card settings-section">
          <div className="section-title">
            <h3>Situação</h3>
            <button className="icon-button" onClick={onRefresh} title="Verificar de novo">
              <Icon name="refresh" />
            </button>
          </div>
          {system ? (
            <ul className="checklist">
              <Check ok={system.wslInstalled} label="WSL instalado" />
              <Check ok={system.distroInstalled} label="Ubuntu instalado" detail={system.distro} />
              <Check
                ok={helperOk}
                label="Comandos da VPN no Ubuntu"
                detail={
                  system.helperVersion === null
                    ? undefined
                    : helperOk
                      ? `versão ${system.helperVersion}`
                      : `versão ${system.helperVersion} (precisa da ${system.requiredHelperVersion})`
                }
              />
            </ul>
          ) : (
            <p className="muted small">Verificando…</p>
          )}
          {system && !system.wslInstalled && (
            <button className="button primary" onClick={() => run(api.installWsl, 'WSL instalado: reinicie o Windows', 'Instalação do WSL cancelada')} disabled={disabled}>
              <Icon name="download" />
              Instalar o WSL (administrador)
            </button>
          )}
          {system?.distroInstalled && !helperOk && (
            <button className="button" onClick={() => run(api.updateCommands, 'Comandos atualizados', 'Falha: veja o log')} disabled={disabled}>
              <Icon name="upload" />
              Atualizar os comandos (sem reiniciar o WSL)
            </button>
          )}
        </section>

        <form className="card settings-section" onSubmit={saveSettings}>
          <h3>Ubuntu</h3>
          <div className="form-grid">
            <label className="field">
              <span>Distro</span>
              <input value={draft.distro} onChange={(e) => setDraft({ ...draft, distro: e.target.value })} placeholder="Ubuntu-24.04" />
            </label>
            <label className="field">
              <span>Usuário do Linux</span>
              <input value={draft.linuxUser} onChange={(e) => setDraft({ ...draft, linuxUser: e.target.value })} placeholder="usuario" />
            </label>
          </div>
          <button type="submit" className="button start" disabled={!dirty}>
            <Icon name="save" />
            Salvar
          </button>
        </form>

        <form className="card settings-section" onSubmit={install}>
          <h3>Instalar / reparar</h3>
          <p className="muted small">
            Verifica antes de agir e refaz só o que falta: virtualização, isolamento de rede (NAT), Ubuntu, usuário,
            openfortivpn, DNS, sudoers e comandos.
          </p>
          <label className="field">
            <span>Senha do usuário do Linux</span>
            <input type="password" value={linuxPassword} onChange={(e) => setLinuxPassword(e.target.value)} autoComplete="new-password" placeholder="vazio: mantém a atual" />
          </label>
          <p className="hint warn-text small">
            <Icon name="alert" size={13} /> O WSL é reiniciado durante a instalação: a VPN conectada vai cair.
          </p>
          <button type="submit" className="button primary" disabled={disabled || !system?.wslInstalled || !settings.linuxUser}>
            <Icon name="download" />
            {running ? 'Trabalhando…' : 'Instalar / reparar'}
          </button>
          {!settings.linuxUser && <p className="muted small">Salve o usuário do Linux antes de instalar.</p>}
        </form>
      </div>

      <LogView entries={log} title="Log da instalação e do painel" />
    </div>
  );
}
