import * as Tooltip from '@radix-ui/react-tooltip';
import type { ReactElement, ReactNode } from 'react';

interface TipProps {
  content: ReactNode;
  children: ReactElement;
  side?: 'top' | 'right' | 'bottom' | 'left';
}

/** Tooltip on hover/focus. Renders the child alone when there is nothing to say. */
export function Tip({ content, children, side = 'top' }: TipProps) {
  if (!content) return children;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-72 rounded border border-line-strong bg-panel px-2.5 py-1.5 text-[12px] leading-snug text-fg shadow-xl shadow-black/20"
        >
          {content}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export const TipProvider = Tooltip.Provider;
