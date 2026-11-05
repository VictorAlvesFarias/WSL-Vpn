import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Modal } from './ui/Modal';
import { cn } from './ui/cn';

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  message: string;
}

/** Short messages in the bottom-right corner; errors stay longer. */
export function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((kind: Toast['kind'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, kind, message }]);
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 4500);
  }, []);
  return { toasts, notify };
}

export function Toasts({ toasts }: { toasts: Toast[] }) {
  return (
    <div className="fixed right-4 bottom-9 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            'max-w-[380px] rounded-md border px-3.5 py-2.5 text-[13px] shadow-2xl shadow-black/30',
            toast.kind === 'error' ? 'border-danger/40 bg-danger text-white' : 'border-line-strong bg-panel text-fg',
          )}
          style={{ animation: 'toast-in 0.16s ease-out' }}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

/**
 * Keyboard shortcuts of the menus, as "ctrl+shift+p", "ctrl+1", "f5"… F5 and Ctrl+P would otherwise reload or print
 * the page in a browser.
 */
export function useShortcuts(shortcuts: Record<string, () => void>) {
  const current = useRef(shortcuts);
  current.current = shortcuts;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = `${event.ctrlKey ? 'ctrl+' : ''}${event.shiftKey ? 'shift+' : ''}${event.key.toLowerCase()}`;
      const action = current.current[key];
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  icon: ReactNode;
  children: ReactNode;
}

export function AboutDialog({ open, onOpenChange, name, icon, children }: AboutDialogProps) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Sobre o ${name}`} className="w-[min(440px,calc(100vw-32px))]">
      <div className="space-y-4 px-5 py-5 text-[13px]">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-md bg-accent text-accent-fg [&_svg]:size-5">{icon}</span>
          <div>
            <p className="text-[15px] font-semibold">{name}</p>
            <p className="text-fg-muted">Versão {__APP_VERSION__}</p>
          </div>
        </div>
        <div className="space-y-3 leading-relaxed text-fg-muted">{children}</div>
      </div>
    </Modal>
  );
}

/** The page body: centered, scrolling, with the usual padding. */
export function Page({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('mx-auto w-full max-w-6xl space-y-5 p-5', className)}>{children}</div>;
}

/** A red or amber strip at the top of a page. */
export function Banner({ tone = 'danger', children }: { tone?: 'danger' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-md border px-4 py-3 text-[13px]',
        tone === 'danger' ? 'border-danger/30 bg-danger-soft text-danger' : 'border-warn/30 bg-warn-soft text-warn',
      )}
    >
      {children}
    </div>
  );
}

/** Centered message in an empty list. */
export function Empty({ icon, children, action }: { icon?: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-dashed border-line-strong px-6 py-10 text-center text-[13px] text-fg-muted [&>svg]:size-7 [&>svg]:text-fg-subtle">
      {icon}
      <div className="max-w-md leading-relaxed">{children}</div>
      {action}
    </div>
  );
}

/** Animated dot for a connection: up, busy, down or off. */
export function Dot({ state }: { state: 'up' | 'busy' | 'down' | 'idle' }) {
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        state === 'up' && 'bg-ok',
        state === 'busy' && 'animate-pulse bg-warn',
        state === 'down' && 'bg-danger',
        state === 'idle' && 'bg-fg-subtle',
      )}
    />
  );
}
