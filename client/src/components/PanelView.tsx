import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { modeLabels, modeText, type Config, type GatewayMode, type LogEntry, type PanelState } from '../types';
import { Icon } from './Icon';
import { LogView } from './LogView';
import { TotpDialog } from './TotpDialog';

interface PanelViewProps {
  state: PanelState;
  config: Config | null;
  log: LogEntry[];
  onError: (message: string) => void;
}

export function PanelView({ state, config, log, onError }: PanelViewProps) {
  const [otp, setOtp] = useState('');
  const [totpOpen, setTotpOpen] = useState(false);
  const { status, busy, rdpOpening, totpEnabled, selectedMode } = state;

  const otpRequired = config?.VPN_OTP_REQUIRED === '1';
  // With an authenticator registered the code is generated automatically.
  const needsOtp = otpRequired && !status.up && !totpEnabled;

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
    } catch (error) {
      onError((error as Error).message);
    }
  }

  function connect(event?: FormEvent) {
    event?.preventDefault();
    const code = otp;
    setOtp('');
    void run(() => api.connect(code));
  }

  const statusKind = busy ? 'busy' : !status.reachable && status.checkedAt ? 'unknown' : status.up ? 'up' : 'down';
  const statusLabel = busy
    ? `${busy}…`
    : statusKind === 'unknown'
      ? 'WSL não respondeu'
      : !status.checkedAt
        ? 'Verificando…'
        : status.up
          ? 'Conectada'
          : 'Desconectada';

  const gatewayButton =
    status.gateway === 'on'
      ? { label: 'Parar de usar a VPN no Windows', className: 'button warn', action: api.gatewayOff }
      : status.gateway === 'partial'
        ? { label: 'Limpar rotas do Windows', className: 'button warn', action: api.gatewayOff }
        : { label: 'Usar a VPN no Windows', className: 'button', action: api.gatewayOn };

  const gatewayLabel =
    status.gateway === 'on'
      ? { text: `Windows: ${modeText[status.activeMode]}`, className: status.activeMode === 'tudo' ? 'warn-text' : 'ok-text' }
      : status.gateway === 'partial'
        ? { text: 'Restos de rotas/DNS no Windows', className: 'warn-text' }
        : { text: 'Windows fora da rede corporativa', className: 'muted' };

  return (
    <div className="panel-grid">
      <div className="panel-controls">
        <section className={`card status-card ${statusKind}`}>
          <div className="status-row">
            <span className={`dot ${statusKind}`} />
            <strong className="status-label">{statusLabel}</strong>
          </div>
          <code className="status-address">{status.up ? `ppp0  ${status.address}` : ' '}</code>
          <span className={`small ${gatewayLabel.className}`}>{gatewayLabel.text}</span>
        </section>

        {needsOtp && (
          <form className="otp" onSubmit={connect}>
            <label className="field">
              <span>Código OTP</span>
              <input
                className="otp-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(event) => setOtp(event.target.value)}
                placeholder="000000"
                disabled={Boolean(busy)}
              />
            </label>
          </form>
        )}

        <div className="actions">
          <button className="button primary big" onClick={() => connect()} disabled={Boolean(busy) || status.up}>
            <Icon name="power" />
            Conectar VPN
          </button>
          <button
            className="button success big"
            onClick={() => run(api.openRdp)}
            disabled={Boolean(busy) || !status.up || rdpOpening || !config?.RDP_HOST}
          >
            <Icon name="monitor" />
            {rdpOpening ? 'Abrindo RDP…' : 'Abrir RDP'}
          </button>
          <button
            className={`${gatewayButton.className} big`}
            onClick={() => run(gatewayButton.action)}
            disabled={Boolean(busy) || (status.gateway === 'off' && !status.up)}
          >
            <Icon name="globe" />
            {gatewayButton.label}
          </button>

          <div className="segmented" role="radiogroup" aria-label="Pelo túnel">
            <span className="segmented-label">Pelo túnel</span>
            {(Object.keys(modeLabels) as GatewayMode[]).map((mode) => (
              <button
                key={mode}
                role="radio"
                aria-checked={selectedMode === mode}
                className={selectedMode === mode ? 'is-selected' : ''}
                onClick={() => selectedMode !== mode && run(() => api.setMode(mode))}
                disabled={Boolean(busy)}
                title={modeText[mode]}
              >
                {modeLabels[mode]}
              </button>
            ))}
          </div>

          <button className="button big" onClick={() => run(api.disconnect)} disabled={Boolean(busy) || !status.up}>
            <Icon name="unplug" />
            Desconectar
          </button>
        </div>

        <button className="link-button" onClick={() => setTotpOpen(true)}>
          <Icon name="key" size={13} />
          {totpEnabled ? 'Autenticador: código automático' : 'Autenticador (OTP)…'}
        </button>

        <p className="muted small center">
          {config?.RDP_HOST ? (
            <>
              RDP: {config.RDP_USER ? `${config.RDP_USER}@` : ''}
              {config.RDP_HOST}
            </>
          ) : (
            'RDP não configurado'
          )}
        </p>
      </div>

      <LogView entries={log} />

      {totpOpen && <TotpDialog enabled={Boolean(totpEnabled)} onClose={() => setTotpOpen(false)} onError={onError} />}
    </div>
  );
}
