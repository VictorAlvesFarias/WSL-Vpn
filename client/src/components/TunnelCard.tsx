import { Globe, Monitor, Network, Plus, ShieldCheck, TriangleAlert, X, type LucideIcon } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { tunnelSignature, type Connection, type PanelState, type Tunnel, type TunnelMode } from '../types';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { Input } from './ui/Input';
import { Panel, PanelHeader } from './ui/Panel';
import { Tip } from './ui/Tip';

interface TunnelCardProps {
  connection: Connection;
  /** This connection is the one that is up. */
  isUp: boolean;
  state: PanelState;
  onError: (message: string) => void;
}

const modes: Array<{ mode: TunnelMode; label: string; hint: string }> = [
  { mode: 'off', label: 'Desativado', hint: 'Só o Linux usa a VPN' },
  { mode: 'global', label: 'Global', hint: 'Todo o tráfego do Windows' },
  { mode: 'specific', label: 'Específico', hint: 'Só os destinos da lista' },
];

function targetKind(target: string): { icon: LucideIcon; label: string } {
  if (/^\d/.test(target)) return { icon: Network, label: target.endsWith('/32') ? 'IP' : 'rede' };
  if (target.startsWith('*.')) return { icon: ShieldCheck, label: 'domínio (DNS)' };
  return { icon: Monitor, label: 'host' };
}

/**
 * What Windows sends through this connection. Edits are saved right away; while connected,
 * changing the mode applies it at once (UAC) and list edits wait for "Aplicar alterações".
 */
export function TunnelCard({ connection, isUp, state, onError }: TunnelCardProps) {
  const { tunnel } = connection;
  const { status, busy } = state;
  const [newTarget, setNewTarget] = useState('');
  const [saving, setSaving] = useState(false);

  async function save(next: Tunnel): Promise<boolean> {
    setSaving(true);
    try {
      await api.saveTunnel(connection.id, next);
      return true;
    } catch (error) {
      onError((error as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function apply() {
    try {
      await api.applyTunnel(connection.id);
    } catch (error) {
      onError((error as Error).message);
    }
  }

  async function changeMode(mode: TunnelMode) {
    if (mode === tunnel.mode || !(await save({ ...tunnel, mode }))) return;
    const routable = mode === 'global' || tunnel.targets.length > 0;
    // While connected the choice takes effect immediately.
    if (isUp && (mode === 'off' ? status.tunnel !== 'off' : routable)) await apply();
  }

  async function addTarget(event: FormEvent) {
    event.preventDefault();
    const value = newTarget.trim();
    if (!value) return;
    if (await save({ ...tunnel, targets: [...tunnel.targets, value] })) setNewTarget('');
  }

  const removeTarget = (target: string) => save({ ...tunnel, targets: tunnel.targets.filter((t) => t !== target) });

  const active = isUp && status.tunnel === 'on';
  const pending = active && state.appliedTunnel !== null && state.appliedTunnel !== tunnelSignature(connection);
  const routable = tunnel.mode === 'global' || (tunnel.mode === 'specific' && tunnel.targets.length > 0);
  const notApplied = isUp && routable && status.tunnel === 'off';
  const locked = Boolean(busy) || saving;

  const statusText = !isUp
    ? tunnel.mode === 'off'
      ? 'O Windows não usa a VPN.'
      : 'Será aplicado ao conectar (pede o UAC).'
    : active
      ? status.tunnelGlobal
        ? 'Ativo: todo o tráfego do Windows passa pela VPN.'
        : `Ativo no Windows (${status.tunnelRoutes} rota${status.tunnelRoutes === 1 ? '' : 's'}).`
      : tunnel.mode === 'off'
        ? 'O Windows não usa a VPN.'
        : 'Inativo no Windows.';

  return (
    <Panel className={cn('overflow-hidden', active && 'border-ok/40')}>
      <PanelHeader icon={<Globe />} title="Túnel no Windows" description={<span className={active ? 'text-ok' : undefined}>{statusText}</span>} />

      <div className="space-y-4 px-4 py-4">
        <div className="grid grid-cols-3 gap-2 max-sm:grid-cols-1" role="radiogroup" aria-label="Túnel">
          {modes.map((item) => {
            const selected = tunnel.mode === item.mode;
            return (
              <button
                key={item.mode}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={locked}
                onClick={() => void changeMode(item.mode)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-60',
                  selected ? 'border-accent bg-accent-soft' : 'border-line bg-panel hover:border-line-strong hover:bg-panel-2',
                )}
              >
                <span className={cn('text-[13px] font-medium', selected && 'text-accent')}>{item.label}</span>
                <span className="text-[12px] text-fg-muted">{item.hint}</span>
              </button>
            );
          })}
        </div>

        {tunnel.mode === 'global' && (
          <p className="flex gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] leading-relaxed text-warn">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
            O firewall da empresa costuma bloquear boa parte da internet (Google, YouTube…). Os nomes também passam a ser resolvidos pelo DNS da
            empresa.
          </p>
        )}

        {tunnel.mode === 'specific' && (
          <div className="space-y-3">
            <form className="flex gap-2" onSubmit={addTarget}>
              <Input
                className="font-mono text-[12.5px]"
                value={newTarget}
                onChange={(event) => setNewTarget(event.target.value)}
                placeholder="10.0.0.0/8, intranet.empresa.com.br, https://portal…, *.empresa.local"
                disabled={locked}
              />
              <Button type="submit" disabled={locked || !newTarget.trim()}>
                <Plus />
                Adicionar
              </Button>
            </form>

            {tunnel.targets.length === 0 ? (
              <p className="rounded-md border border-dashed border-line-strong px-3 py-4 text-center text-[12.5px] text-fg-muted">
                Nenhum destino. Adicione redes, IPs, endereços ou domínios.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-md border border-line">
                {tunnel.targets.map((target) => {
                  const { icon: Icon, label } = targetKind(target);
                  return (
                    <li key={target} className="flex items-center gap-2.5 px-3 py-1.5">
                      <Icon className="size-3.5 shrink-0 text-fg-subtle" />
                      <code className="selectable min-w-0 truncate font-mono text-[12.5px]">{target}</code>
                      <span className="flex-1 text-[12px] text-fg-subtle">{label}</span>
                      <Tip content="Remover">
                        <Button size="icon" variant="ghost" className="size-6 hover:text-danger [&_svg]:size-3.5" onClick={() => void removeTarget(target)} disabled={locked} aria-label="Remover">
                          <X />
                        </Button>
                      </Tip>
                    </li>
                  );
                })}
              </ul>
            )}

            <p className="text-[12px] leading-relaxed text-fg-muted">
              Redes e IPs vão pelo túnel; endereços e URLs são resolvidos pelo DNS da empresa e roteados;{' '}
              <code className="font-mono text-fg">*.dominio</code> faz o Windows resolver esse domínio no DNS da empresa.
            </p>
          </div>
        )}
      </div>

      {(pending || notApplied || status.tunnel === 'partial') && (
        <footer className="flex items-center gap-3 border-t border-line bg-warn-soft/50 px-4 py-2.5">
          {status.tunnel === 'partial' ? (
            <>
              <span className="flex-1 text-[12.5px] text-warn">Restos de rotas/DNS no Windows.</span>
              <Button size="sm" onClick={() => api.tunnelOff().catch((e: Error) => onError(e.message))} disabled={locked}>
                Limpar túnel
              </Button>
            </>
          ) : (
            <>
              <span className="flex-1 text-[12.5px] text-warn">{pending ? 'Alterações ainda não aplicadas no Windows.' : 'O túnel não está aplicado.'}</span>
              <Button size="sm" variant="primary" onClick={() => void apply()} disabled={locked}>
                {pending ? 'Aplicar alterações' : 'Aplicar túnel'}
              </Button>
            </>
          )}
        </footer>
      )}
    </Panel>
  );
}
