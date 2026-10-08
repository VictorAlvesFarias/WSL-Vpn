import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { tunnelSignature, type Connection, type PanelState, type Tunnel, type TunnelMode } from '../types';
import { Icon, type IconName } from './Icon';

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

function targetKind(target: string): { icon: IconName; label: string } {
  if (/^\d/.test(target)) return { icon: 'globe', label: target.endsWith('/32') ? 'IP' : 'rede' };
  if (target.startsWith('*.')) return { icon: 'shield', label: 'domínio (DNS)' };
  return { icon: 'monitor', label: 'host' };
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
    const routable = mode === 'global' || tunnel.targets.length > 0 || tunnel.m365;
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
  const routable = tunnel.mode === 'global' || (tunnel.mode === 'specific' && (tunnel.targets.length > 0 || tunnel.m365));
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
    <section className={`card tunnel-card${active ? ' is-on' : ''}`}>
      <header className="tunnel-card-head">
        <span className="eyebrow">
          <Icon name="globe" size={13} /> Túnel no Windows
        </span>
        <span className={`small ${active ? 'ok-text' : 'muted'}`}>{statusText}</span>
      </header>

      <div className="radio-cards" role="radiogroup" aria-label="Túnel">
        {modes.map((item) => (
          <label key={item.mode} className={`radio-card${tunnel.mode === item.mode ? ' is-selected' : ''}${locked ? ' is-locked' : ''}`}>
            <input
              type="radio"
              name={`tunnel-${connection.id}`}
              checked={tunnel.mode === item.mode}
              onChange={() => changeMode(item.mode)}
              disabled={locked}
            />
            <span className="radio-text">
              <strong>{item.label}</strong>
              <span className="muted small">{item.hint}</span>
            </span>
          </label>
        ))}
      </div>

      {tunnel.mode === 'global' && (
        <p className="hint warn-text small">
          <Icon name="alert" size={13} /> O firewall da empresa costuma bloquear boa parte da internet (Google, YouTube…). Os
          nomes também passam a ser resolvidos pelo DNS da empresa.
        </p>
      )}

      {tunnel.mode === 'specific' && (
        <div className="targets">
          <form className="input-row" onSubmit={addTarget}>
            <input
              className="mono"
              value={newTarget}
              onChange={(event) => setNewTarget(event.target.value)}
              placeholder="10.0.0.0/8, intranet.empresa.com.br, https://portal…, *.empresa.local"
              spellCheck={false}
              disabled={locked}
            />
            <button type="submit" className="button" disabled={locked || !newTarget.trim()}>
              <Icon name="plus" />
              Adicionar
            </button>
          </form>

          {tunnel.targets.length === 0 ? (
            <p className="muted small targets-empty">Nenhum destino. Adicione redes, IPs, endereços ou domínios.</p>
          ) : (
            <ul className="target-list">
              {tunnel.targets.map((target) => {
                const kind = targetKind(target);
                return (
                  <li key={target}>
                    <Icon name={kind.icon} size={14} />
                    <code>{target}</code>
                    <span className="muted small">{kind.label}</span>
                    <span className="spacer" />
                    <button className="icon-button danger" onClick={() => removeTarget(target)} disabled={locked} title="Remover">
                      <Icon name="x" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <label className="check">
            <input
              type="checkbox"
              checked={tunnel.m365}
              onChange={(event) => save({ ...tunnel, m365: event.target.checked })}
              disabled={locked}
            />
            Incluir Microsoft 365 (Teams, Outlook, OneDrive)
          </label>
          <p className="muted small">
            Redes e IPs vão pelo túnel; endereços e URLs são resolvidos pelo DNS da empresa e roteados;
            <code> *.dominio</code> faz o Windows resolver esse domínio no DNS da empresa.
          </p>
        </div>
      )}

      {(pending || notApplied || status.tunnel === 'partial') && (
        <footer className="tunnel-actions">
          {status.tunnel === 'partial' ? (
            <>
              <span className="small warn-text">Restos de rotas/DNS no Windows.</span>
              <span className="spacer" />
              <button className="button warn small" onClick={() => api.tunnelOff().catch((e) => onError(e.message))} disabled={locked}>
                Limpar túnel
              </button>
            </>
          ) : (
            <>
              <span className="small warn-text">{pending ? 'Alterações ainda não aplicadas no Windows.' : 'O túnel não está aplicado.'}</span>
              <span className="spacer" />
              <button className="button primary small" onClick={apply} disabled={locked}>
                {pending ? 'Aplicar alterações' : 'Aplicar túnel'}
              </button>
            </>
          )}
        </footer>
      )}
    </section>
  );
}
