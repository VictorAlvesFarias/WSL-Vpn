import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { expectedHelperVersion, type LogEntry, type SystemInfo } from '../types';
import { Icon } from './Icon';
import { LogView } from './LogView';

interface InstallViewProps {
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

export function InstallView({ system, busy, log, onRefresh, onNotify }: InstallViewProps) {
  const [linuxPassword, setLinuxPassword] = useState('');
  const [vpnPassword, setVpnPassword] = useState('');
  const [rdpPassword, setRdpPassword] = useState('');
  const [updateCert, setUpdateCert] = useState(false);
  const [running, setRunning] = useState(false);

  async function install(event: FormEvent) {
    event.preventDefault();
    if (!confirm('A instalação reinicia o WSL: se a VPN estiver conectada, ela vai cair. Continuar?')) return;
    setRunning(true);
    try {
      const result = await api.install({ linuxPassword, vpnPassword, rdpPassword, updateCert });
      setLinuxPassword('');
      setVpnPassword('');
      setRdpPassword('');
      onNotify(result.ok ? 'ok' : 'error', result.ok ? 'Instalação concluída' : 'A instalação falhou: veja o log');
    } catch (error) {
      onNotify('error', (error as Error).message);
    } finally {
      setRunning(false);
      onRefresh();
    }
  }

  async function installWsl() {
    try {
      const result = await api.installWsl();
      onNotify(result.ok ? 'ok' : 'error', result.ok ? 'WSL instalado: reinicie o Windows' : 'Instalação do WSL cancelada');
    } catch (error) {
      onNotify('error', (error as Error).message);
    } finally {
      onRefresh();
    }
  }

  const helperOk = (system?.helperVersion ?? 0) >= expectedHelperVersion;

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
              <Check ok={system.distroInstalled} label={`Ubuntu instalado`} detail={system.distro} />
              <Check
                ok={system.configured && helperOk}
                label="Comandos da VPN no Ubuntu"
                detail={
                  system.configured
                    ? helperOk
                      ? `versão ${system.helperVersion}`
                      : `versão ${system.helperVersion} (antiga - reinstale ou aplique a configuração)`
                    : undefined
                }
              />
              <Check ok={system.configExists} label="Configuração salva" />
            </ul>
          ) : (
            <p className="muted small">Verificando…</p>
          )}
          {system && !system.wslInstalled && (
            <button className="button primary" onClick={installWsl} disabled={Boolean(busy)}>
              <Icon name="download" />
              Instalar o WSL (administrador)
            </button>
          )}
        </section>

        <form className="card settings-section" onSubmit={install}>
          <h3>Instalar / reparar</h3>
          <p className="muted small">
            Verifica antes de agir e refaz só o que falta: Ubuntu, usuário, isolamento de rede (NAT), certificado do
            gateway, pacotes, comandos e cofre. Pode rodar quantas vezes quiser.
          </p>
          <label className="field">
            <span>Senha do usuário do Linux</span>
            <input type="password" value={linuxPassword} onChange={(e) => setLinuxPassword(e.target.value)} autoComplete="new-password" placeholder="vazio: mantém a atual" />
          </label>
          <label className="field">
            <span>Senha da VPN</span>
            <input type="password" value={vpnPassword} onChange={(e) => setVpnPassword(e.target.value)} autoComplete="new-password" placeholder="vazio: mantém a do cofre" />
          </label>
          <label className="field">
            <span>Senha do RDP</span>
            <input type="password" value={rdpPassword} onChange={(e) => setRdpPassword(e.target.value)} autoComplete="new-password" placeholder="vazio: mantém a do cofre" />
          </label>
          <label className="check">
            <input type="checkbox" checked={updateCert} onChange={(e) => setUpdateCert(e.target.checked)} />
            Atualizar o certificado do gateway se ele mudou
          </label>
          <p className="hint warn-text small">
            <Icon name="alert" size={13} /> O WSL é reiniciado durante a instalação: a VPN conectada vai cair.
          </p>
          <button
            type="submit"
            className="button primary"
            disabled={running || Boolean(busy) || !system?.wslInstalled || !system?.configExists}
          >
            <Icon name="download" />
            {running ? 'Instalando…' : 'Instalar / reparar'}
          </button>
          {system && !system.configExists && <p className="muted small">Salve a configuração antes de instalar.</p>}
        </form>
      </div>

      <LogView entries={log} title="Log da instalação e do painel" />
    </div>
  );
}
