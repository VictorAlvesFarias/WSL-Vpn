import * as Dialog from '@radix-ui/react-dialog';
import { CornerDownLeft, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { matches, normalize } from '../search';
import { cn } from './ui/cn';

export interface Command {
  id: string;
  /** "Arquivo", "Exibir", "Perfil"…: shown before the label, and searchable. */
  category: string;
  label: string;
  /** Muted text after the label (a profile's e-mail). */
  detail?: string | null;
  /** Searchable but not shown. */
  keywords?: string;
  shortcut?: string;
  icon?: ReactNode;
  disabled?: boolean;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}

/**
 * Commands whose label starts with what was typed come first, then the label containing it, then the rest; the ones
 * that can't run now (Salvar with nothing to save) go last, so Enter on the first result always does something.
 */
function rank(command: Command, query: string): number {
  const q = normalize(query.trim());
  const label = normalize(command.label);
  const unavailable = command.disabled ? 10 : 0;
  if (!q || label.startsWith(q)) return unavailable;
  if (label.includes(q)) return unavailable + 1;
  return unavailable + 2;
}

/** VS Code's command palette: type to filter every action of the app (and the saved profiles), Enter runs it. */
export function CommandPalette({ open, onOpenChange, commands }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const list = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () =>
      commands
        .filter((c) => matches(query, c.category, c.label, c.detail, c.keywords))
        .map((command, order) => ({ command, order }))
        .sort((a, b) => rank(a.command, query) - rank(b.command, query) || a.order - b.order)
        .map(({ command }) => command),
    [commands, query],
  );

  // A fresh palette each time it opens, with the first result ready for Enter.
  useEffect(() => {
    if (open) setQuery('');
  }, [open]);
  useEffect(() => setActive(0), [query, open]);
  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (command: Command | undefined) => {
    if (!command || command.disabled) return;
    onOpenChange(false);
    // After the dialog closes, so a command that opens another dialog gets the focus.
    setTimeout(command.run, 0);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      setActive((i) => Math.min(i + 10, results.length - 1));
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      setActive((i) => Math.max(i - 10, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      run(results[active]);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/25" />
        <Dialog.Content
          onKeyDown={onKeyDown}
          className="fixed top-11 left-1/2 z-50 flex max-h-[min(480px,calc(100vh-80px))] w-[min(620px,calc(100vw-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-line-strong bg-panel shadow-2xl shadow-black/40 outline-none"
        >
          <Dialog.Title className="sr-only">Paleta de comandos</Dialog.Title>
          <Dialog.Description className="sr-only">Digite para buscar comandos e conexões; Enter executa.</Dialog.Description>
          <div className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute top-1/2 left-4.5 size-4 -translate-y-1/2 text-fg-subtle" />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar comandos e conexões"
              aria-label="Buscar comandos e conexões"
              aria-controls="command-results"
              aria-activedescendant={results[active] ? `command-${results[active].id}` : undefined}
              spellCheck={false}
              className="h-8 w-full rounded border border-accent bg-panel-2 pr-3 pl-8 text-[13px] text-fg outline-none placeholder:text-fg-subtle"
            />
          </div>
          <div ref={list} id="command-results" role="listbox" className="min-h-0 flex-1 overflow-auto py-1">
            {results.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-fg-muted">Nada encontrado com “{query.trim()}”.</p>}
            {results.map((command, index) => (
              <div
                key={command.id}
                id={`command-${command.id}`}
                data-index={index}
                role="option"
                aria-selected={index === active}
                aria-disabled={command.disabled}
                onMouseMove={() => setActive(index)}
                onClick={() => run(command)}
                className={cn(
                  'mx-1 flex h-8 cursor-default items-center gap-2.5 rounded px-2.5 text-[13px]',
                  index === active && 'bg-accent text-accent-fg',
                  command.disabled && 'opacity-40',
                )}
              >
                {command.icon && (
                  <span className={cn('shrink-0 [&_svg]:size-4', index === active ? 'text-accent-fg' : 'text-fg-muted')}>{command.icon}</span>
                )}
                <span className="min-w-0 flex-1 truncate">
                  <span className={cn(index === active ? 'text-accent-fg/80' : 'text-fg-muted')}>{command.category}: </span>
                  {command.label}
                  {command.detail && (
                    <span className={cn('ml-2 text-[12px]', index === active ? 'text-accent-fg/70' : 'text-fg-subtle')}>{command.detail}</span>
                  )}
                </span>
                {command.shortcut && (
                  <kbd className={cn('shrink-0 font-sans text-[11.5px]', index === active ? 'text-accent-fg/80' : 'text-fg-subtle')}>
                    {command.shortcut}
                  </kbd>
                )}
                {index === active && !command.shortcut && <CornerDownLeft className="size-3.5 shrink-0 opacity-70" />}
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
