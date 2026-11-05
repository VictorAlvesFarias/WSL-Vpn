import { Check, Download, HardDrive, ListChecks, RefreshCw, Save, TriangleAlert, Upload, Wrench, X } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import type { LogEntry, Settings, SystemInfo } from '../types';
import { LogView } from './LogView';
import { Page } from './Shell';
import type { ConfirmOptions } from './ui/Confirm';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { FormField, Input } from './ui/Input';
import { Panel, PanelHeader } from './ui/Panel';
import { Tip } from './ui/Tip';

interface InstallPageProps {
  settings: Settings;
  system: SystemInfo | null;
  busy: string | null;
  log: LogEntry[];
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  onRefresh: () => void;
  onNotify: (kind: 'ok' | 'error', message: string) => void;
}

function CheckRow({ ok, label, detail }: { ok: boolean; label: string; detail?: string }) {
  return (
    <li className="flex items-center gap-2.5 py-1.5 text-[13px]">
      <span className={cn('grid size-5 shrink-0 place-items-center rounded-full [&_svg]:size-3', ok ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
        {ok ? <Check strokeWidth={3} /> : <X strokeWidth={3} />}
      </span>
      <span className={ok ? undefined : 'text-fg-muted'}>
        {label}
        {detail && <span className="text-fg-subtle"> · {detail}</span>}
      </span>
    </li>
  );
}

export function InstallPage({ settings, system, busy, log, confirm, onRefresh, onNotify }: InstallPageProps) {
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

  async function install(event: FormEvent) {
    event.preventDefault();
    const ok = await confirm({
      title: 'Instalar / reparar agora?',
      description: 'A instalação reinicia o WSL: se a VPN estiver conectada, ela vai cair.',
      confirmLabel: 'Instalar',
    });
    if (!ok) return;
    const password = linuxPassword;
    setLinuxPassword('');
    void run(() => api.install(password), 'Instalação concluída', 'A instalação falhou: veja o log');
  }

  const helperOk = system?.helperVersion === system?.requiredHelperVersion;
  const disabled = running || Boolean(busy);

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_minmax(320px,480px)] max-lg:grid-cols-1 max-lg:overflow-auto">
      <div className="min-h-0 overflow-auto">
        <Page className="max-w-3xl">
          <Panel>
            <PanelHeader
              icon={<ListChecks />}
              title="Situação"
              actions={
                <Tip content="Verificar de novo">
                  <Button size="icon" variant="ghost" className="size-7" onClick={onRefresh} aria-label="Verificar de novo">
                    <RefreshCw />
                  </Button>
                </Tip>
              }
            />
            <div className="space-y-3 px-4 py-3">
              {system ? (
                <ul>
                  <CheckRow ok={system.wslInstalled} label="WSL instalado" />
                  <CheckRow ok={system.distroInstalled} label="Ubuntu instalado" detail={system.distro} />
                  <CheckRow
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
                <p className="text-[13px] text-fg-muted">Verificando…</p>
              )}
              {system && !system.wslInstalled && (
                <Button variant="primary" onClick={() => void run(api.installWsl, 'WSL instalado: reinicie o Windows', 'Instalação do WSL cancelada')} disabled={disabled}>
                  <Download />
                  Instalar o WSL (administrador)
                </Button>
              )}
              {system?.distroInstalled && !helperOk && (
                <Button onClick={() => void run(api.updateCommands, 'Comandos atualizados', 'Falha: veja o log')} disabled={disabled}>
                  <Upload />
                  Atualizar os comandos (sem reiniciar o WSL)
                </Button>
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader icon={<HardDrive />} title="Ubuntu" description="A distro do WSL onde a VPN roda." />
            <form onSubmit={saveSettings}>
              <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
                <FormField label="Distro">
                  <Input value={draft.distro} onChange={(e) => setDraft({ ...draft, distro: e.target.value })} placeholder="Ubuntu-24.04" />
                </FormField>
                <FormField label="Usuário do Linux">
                  <Input value={draft.linuxUser} onChange={(e) => setDraft({ ...draft, linuxUser: e.target.value })} placeholder="usuario" />
                </FormField>
              </div>
              <footer className="flex justify-end border-t border-line px-4 py-3">
                <Button type="submit" disabled={!dirty}>
                  <Save />
                  Salvar
                </Button>
              </footer>
            </form>
          </Panel>

          <Panel>
            <PanelHeader
              icon={<Wrench />}
              title="Instalar / reparar"
              description="Verifica antes de agir e refaz só o que falta."
            />
            <form onSubmit={(event) => void install(event)}>
              <div className="space-y-4 px-4 py-4">
                <p className="text-[12.5px] leading-relaxed text-fg-muted">
                  Virtualização, isolamento de rede (NAT), Ubuntu, usuário, openfortivpn, DNS, sudoers e comandos.
                </p>
                <FormField label="Senha do usuário do Linux" className="max-w-sm">
                  <Input type="password" value={linuxPassword} onChange={(e) => setLinuxPassword(e.target.value)} autoComplete="new-password" placeholder="vazio: mantém a atual" />
                </FormField>
                <p className="flex gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />O WSL é reiniciado durante a instalação: a VPN conectada vai cair.
                </p>
              </div>
              <footer className="flex items-center justify-end gap-3 border-t border-line px-4 py-3">
                {!settings.linuxUser && <span className="flex-1 text-[12px] text-fg-muted">Salve o usuário do Linux antes de instalar.</span>}
                <Button type="submit" variant="primary" disabled={disabled || !system?.wslInstalled || !settings.linuxUser}>
                  <Download />
                  {running ? 'Trabalhando…' : 'Instalar / reparar'}
                </Button>
              </footer>
            </form>
          </Panel>
        </Page>
      </div>
      <div className="flex min-h-0 flex-col border-l border-line bg-sidebar/40 p-3 max-lg:h-96 max-lg:border-t max-lg:border-l-0">
        <LogView entries={log} title="Log da instalação e do painel" className="flex-1" />
      </div>
    </div>
  );
}
