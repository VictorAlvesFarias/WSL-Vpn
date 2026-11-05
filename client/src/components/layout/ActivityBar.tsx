import type { LucideIcon } from 'lucide-react';
import { cn } from '../ui/cn';
import { Tip } from '../ui/Tip';

export interface Activity<T extends string> {
  id: T;
  label: string;
  icon: LucideIcon;
  shortcut: string;
  /** Small counter on the icon. */
  count?: number;
  /** A red dot: something there needs attention. */
  alert?: boolean;
}

interface ActivityBarProps<T extends string> {
  current: T;
  items: Activity<T>[];
  /** Pinned to the bottom, like VS Code's gear. */
  bottom?: Activity<T>[];
  onNavigate: (id: T) => void;
}

const item =
  'relative grid h-12 w-full place-items-center text-fg-subtle outline-none hover:text-fg focus-visible:bg-panel-2 [&_svg]:size-[22px]';

/** The icon column on the left, like VS Code's activity bar. */
export function ActivityBar<T extends string>({ current, items, bottom = [], onNavigate }: ActivityBarProps<T>) {
  const render = ({ id, label, icon: Icon, shortcut, count = 0, alert }: Activity<T>) => {
    const active = id === current;
    return (
      <Tip key={id} content={`${label} (${shortcut})`} side="right">
        <button
          onClick={() => onNavigate(id)}
          aria-current={active ? 'page' : undefined}
          aria-label={label}
          className={cn(item, active && 'text-fg before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:bg-accent')}
        >
          <Icon strokeWidth={1.6} />
          {count > 0 && (
            <span className="absolute right-1.5 bottom-2 min-w-4 rounded-full bg-accent px-1 text-center text-[9.5px] leading-4 font-semibold text-accent-fg">
              {count}
            </span>
          )}
          {alert && <span className="absolute top-3 right-3 size-2 rounded-full bg-danger ring-2 ring-sidebar" />}
        </button>
      </Tip>
    );
  };

  return (
    <nav className="flex w-12 shrink-0 flex-col border-r border-line bg-sidebar" aria-label="Seções">
      {items.map(render)}
      <div className="flex-1" />
      {bottom.map(render)}
    </nav>
  );
}
