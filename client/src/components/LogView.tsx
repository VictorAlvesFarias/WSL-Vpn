import { useEffect, useRef, useState } from 'react';
import type { LogEntry } from '../types';
import { Icon } from './Icon';

interface LogViewProps {
  entries: LogEntry[];
  title?: string;
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour12: false });

export function LogView({ entries, title = 'Atividade' }: LogViewProps) {
  const [clearedAt, setClearedAt] = useState(0);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const visible = entries.filter((entry) => entry.id > clearedAt);

  // Follow new lines unless the user scrolled up to read something.
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [visible.length]);

  async function copy() {
    await navigator.clipboard.writeText(visible.map((e) => `${time(e.time)}  ${e.text}`).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <section className="card log-card">
      <header className="log-head">
        <span className="eyebrow">
          <Icon name="terminal" size={13} /> {title}
        </span>
        <span className="spacer" />
        <button className="icon-button" onClick={copy} title="Copiar" disabled={!visible.length}>
          <Icon name={copied ? 'check' : 'copy'} />
        </button>
        <button
          className="icon-button"
          onClick={() => setClearedAt(entries.at(-1)?.id ?? 0)}
          title="Limpar"
          disabled={!visible.length}
        >
          <Icon name="trash" />
        </button>
      </header>
      <div
        className="log"
        ref={box}
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {visible.length === 0 ? (
          <p className="log-empty">Nada por aqui ainda.</p>
        ) : (
          visible.map((entry) => (
            <div key={entry.id} className={`log-line ${entry.level}`}>
              <span className="log-time">{time(entry.time)}</span>
              <span className="log-text">{entry.text}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
