import * as Menubar from '@radix-ui/react-menubar';
import { Search } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../ui/cn';
import { Tip } from '../ui/Tip';

export interface MenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  /** Extra words the command palette finds this item by. */
  keywords?: string;
  onSelect: () => void;
}

/** null draws a separator. */
export type Menu = { label: string; items: (MenuItem | null)[] };

interface TitleBarProps {
  /** The app's mark, drawn in the accent square. */
  icon: ReactNode;
  title: string;
  menus: Menu[];
  /** What the command palette searches, shown in the tooltip of the command center. */
  searchHint: string;
  onCommandPalette: () => void;
  /** Buttons on the right, before the window buttons. */
  actions?: ReactNode;
}

// The window has no native title bar (Electron draws only the min/max/close buttons over this one): the bar drags
// the window, its controls must not.
const drag = '[-webkit-app-region:drag]';
export const noDrag = '[-webkit-app-region:no-drag]';

/** The top bar, like VS Code's: menus, the search box that opens the command palette, and a few actions. */
export function TitleBar({ icon, title, menus, searchHint, onCommandPalette, actions }: TitleBarProps) {
  return (
    <header
      className={cn('flex h-9 shrink-0 items-center gap-1 border-b border-line bg-sidebar pl-2', drag)}
      // Room for the window buttons Electron draws on the right (Window Controls Overlay); 0 in a browser.
      style={{ paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 6px)' }}
    >
      <span className="mr-1 grid size-6 shrink-0 place-items-center rounded bg-accent text-accent-fg [&_svg]:size-3.5" aria-hidden="true">
        {icon}
      </span>

      <Menubar.Root className={cn('flex h-full items-center', noDrag)}>
        {menus.map((menu) => (
          <Menubar.Menu key={menu.label}>
            <Menubar.Trigger className="h-6 rounded px-2 text-[13px] text-fg-muted outline-none hover:bg-panel-2 hover:text-fg data-[highlighted]:bg-panel-2 data-[state=open]:bg-panel-2 data-[state=open]:text-fg">
              {menu.label}
            </Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content align="start" sideOffset={4} className="z-50 min-w-60 rounded-md border border-line-strong bg-panel p-1 shadow-2xl shadow-black/30">
                {menu.items.map((entry, index) =>
                  entry === null ? (
                    <Menubar.Separator key={index} className="my-1 h-px bg-line" />
                  ) : (
                    <Menubar.Item
                      key={entry.label}
                      disabled={entry.disabled}
                      onSelect={entry.onSelect}
                      className="flex h-7 items-center gap-8 rounded px-2.5 text-[13px] outline-none data-[disabled]:opacity-40 data-[highlighted]:bg-accent data-[highlighted]:text-accent-fg"
                    >
                      <span className="flex-1">{entry.label}</span>
                      {entry.shortcut && <span className="text-[12px] opacity-60">{entry.shortcut}</span>}
                    </Menubar.Item>
                  ),
                )}
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </Menubar.Root>

      {/* VS Code's command center: shows where you are, and opens the command palette. */}
      <div className="flex min-w-0 flex-1 justify-center px-3">
        <Tip content={`${searchHint} (Ctrl+Shift+P)`}>
          <button
            type="button"
            onClick={onCommandPalette}
            className={cn(
              'flex h-6 w-[min(440px,100%)] min-w-0 items-center justify-center gap-2 rounded border border-line bg-panel-2/60 px-2.5 text-[12.5px] text-fg-muted',
              'hover:border-line-strong hover:bg-panel-2 hover:text-fg focus-visible:border-accent focus-visible:outline-none max-md:w-7 max-md:px-0',
              noDrag,
            )}
          >
            <Search className="size-3.5 shrink-0" />
            <span className="truncate max-md:hidden">{title}</span>
          </button>
        </Tip>
      </div>

      {actions && <div className={cn('flex items-center gap-1', noDrag)}>{actions}</div>}
    </header>
  );
}
