import { Check, Copy, SquareTerminal, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../types';
import { Button } from './ui/Button';
import { cn } from './ui/cn';
import { Tip } from './ui/Tip';

interface LogViewProps {
  entries: LogEntry[];
  title?: string;
  className?: string;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour12: false });

const levelColor: Record<string, string> = {
  info: 'text-fg-muted',
  step: 'text-accent',
  ok: 'text-ok',
  warn: 'text-warn',
  error: 'text-danger',
};

/** The live activity of the service, like a terminal panel: follows new lines unless you scrolled up. */
export function LogView({ entries, title = 'Atividade', className }: LogViewProps) {
  const [clearedAt, setClearedAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const visible = entries.filter((entry) => entry.id > clearedAt);

  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [visible.length]);

  async function copy() {
    await navigator.clipboard.writeText(visible.map((e) => `${time(e.time)}  ${e.text}`).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className={cn('flex min-h-0 flex-col overflow-hidden rounded-md border border-line bg-panel', className)}>
      <header className="flex h-10 shrink-0 items-center gap-2 border-b border-line pr-1.5 pl-3">
        <SquareTerminal className="size-4 text-fg-muted" />
        <h2 className="flex-1 text-[12px] font-semibold tracking-wide text-fg-muted uppercase">{title}</h2>
        <Tip content={copied ? 'Copiado' : 'Copiar'}>
          <Button size="icon" variant="ghost" className="size-7" onClick={() => void copy()} disabled={!visible.length} aria-label="Copiar">
            {copied ? <Check className="text-ok" /> : <Copy />}
          </Button>
        </Tip>
        <Tip content="Limpar">
          <Button size="icon" variant="ghost" className="size-7" onClick={() => setClearedAt(entries.at(-1)?.id ?? 0)} disabled={!visible.length} aria-label="Limpar">
            <Trash2 />
          </Button>
        </Tip>
      </header>
      <div
        ref={box}
        className="selectable min-h-0 flex-1 overflow-auto bg-bg/60 px-3 py-2 font-mono text-[11.5px] leading-relaxed"
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {visible.length === 0 ? (
          <p className="py-6 text-center font-sans text-[12.5px] text-fg-subtle">Nada por aqui ainda.</p>
        ) : (
          visible.map((entry) => (
            <div key={entry.id} className="flex gap-3">
              <span className="shrink-0 text-fg-subtle">{time(entry.time)}</span>
              <span className={cn('min-w-0 break-words whitespace-pre-wrap', levelColor[entry.level] ?? 'text-fg')}>{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
