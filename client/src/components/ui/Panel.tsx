import type { ComponentProps, ReactNode } from 'react';
import { cn } from './cn';

export function Panel({ className, ...props }: ComponentProps<'section'>) {
  return <section className={cn('rounded-md border border-line bg-panel', className)} {...props} />;
}

interface PanelHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
}

export function PanelHeader({ title, description, icon, actions, className }: PanelHeaderProps) {
  return (
    <header className={cn('flex min-h-12 items-center gap-3 border-b border-line px-4 py-2.5', className)}>
      {icon && <span className="text-fg-muted [&_svg]:size-4">{icon}</span>}
      <div className="min-w-0 flex-1">
        <h2 className="text-[13px] font-semibold">{title}</h2>
        {description && <p className="truncate text-[12px] text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/** Label + control row used in settings panels. */
export function Field({ label, hint, value, children }: { label: ReactNode; hint?: ReactNode; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[12.5px] font-medium">{label}</span>
        {value && <span className="text-[12.5px] font-medium text-accent">{value}</span>}
      </div>
      {children}
      {hint && <p className="text-[12px] leading-relaxed text-fg-muted">{hint}</p>}
    </div>
  );
}
