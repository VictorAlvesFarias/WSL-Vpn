import { KeyRound, Settings2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { Connection, TotpCode } from '../types';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { Tip } from './ui/Tip';

/** A 6-digit code in two groups, with the bar that runs out with its 30 s. */
export function TotpDisplay({ code, remaining }: { code: string | undefined; remaining: number }) {
  const expiring = remaining > 0 && remaining <= 5;
  return (
    <div className="space-y-1.5">
      <code className={cn('block font-mono text-[28px] leading-none font-semibold tracking-[0.12em]', expiring ? 'text-warn' : 'text-fg')}>
        {code ? `${code.slice(0, 3)} ${code.slice(3)}` : '··· ···'}
      </code>
      <div className="h-1 overflow-hidden rounded-full bg-panel-2">
        <div className={cn('h-full rounded-full transition-[width] duration-1000 ease-linear', expiring ? 'bg-warn' : 'bg-accent')} style={{ width: `${(remaining / 30) * 100}%` }} />
      </div>
    </div>
  );
}

interface AuthenticatorCardProps {
  connection: Connection;
  vaultReady: boolean;
  onManage: () => void;
}

const box = 'flex min-w-0 flex-col gap-2 rounded-md border border-line bg-panel-2/40 px-4 py-3';
const heading = (
  <span className="flex items-center gap-1.5 text-[11.5px] font-semibold tracking-wide text-fg-subtle uppercase">
    <KeyRound className="size-3.5" /> Autenticador
  </span>
);

/** Live code of the connection's authenticator, like the phone app shows it. */
export function AuthenticatorCard({ connection, vaultReady, onManage }: AuthenticatorCardProps) {
  const [live, setLive] = useState<TotpCode | null>(null);

  useEffect(() => {
    setLive(null);
    if (!connection.hasTotp) return;
    let cancelled = false;
    const tick = () => api.totp(connection.id).then((result) => !cancelled && setLive(result.enabled ? result : null), () => undefined);
    void tick();
    const timer = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [connection.id, connection.hasTotp]);

  if (!connection.otpRequired) {
    return (
      <section className={box}>
        {heading}
        <p className="text-[12.5px] text-fg-muted">Esta conexão não usa código OTP.</p>
      </section>
    );
  }

  if (!connection.hasTotp) {
    return (
      <section className={box}>
        {heading}
        <p className="text-[12.5px] text-fg-muted">Cadastre a chave para ver os números aqui e conectar sem digitar o código.</p>
        <Button size="sm" className="self-start" onClick={onManage} disabled={!vaultReady}>
          <KeyRound />
          Cadastrar autenticador
        </Button>
      </section>
    );
  }

  const remaining = live?.remaining ?? 0;
  return (
    <section className={box}>
      <div className="flex items-center">
        <span className="flex-1">{heading}</span>
        <Tip content="Gerenciar autenticador">
          <Button size="icon" variant="ghost" className="-my-1 size-7" onClick={onManage} aria-label="Gerenciar autenticador">
            <Settings2 />
          </Button>
        </Tip>
      </div>
      <TotpDisplay code={live?.code} remaining={remaining} />
      <span className="text-[12px] text-fg-muted">{live ? `${remaining}s` : 'carregando…'}</span>
    </section>
  );
}
