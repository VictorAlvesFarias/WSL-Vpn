import type { ReactNode } from 'react';
import { cn } from '../ui/cn';
import { Tip } from '../ui/Tip';

const tones = {
  accent: 'bg-accent text-accent-fg',
  warn: 'bg-warn text-black',
  danger: 'bg-danger text-white',
};

/** The bottom bar, like VS Code's. Its color says the overall state: accent when all is well. */
export function StatusBar({ tone = 'accent', children }: { tone?: keyof typeof tones; children: ReactNode }) {
  return <footer className={cn('flex h-6 shrink-0 items-stretch overflow-hidden text-[12px]', tones[tone])}>{children}</footer>;
}

interface StatusItemProps {
  tip: ReactNode;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}

export function StatusItem({ tip, onClick, className, children }: StatusItemProps) {
  return (
    <Tip content={tip}>
      <button
        onClick={onClick}
        className={cn(
          'flex h-full min-w-0 shrink-0 items-center gap-1.5 px-2 whitespace-nowrap outline-none hover:bg-white/15 focus-visible:bg-white/15 [&_svg]:size-3.5 [&_svg]:shrink-0',
          className,
        )}
      >
        {children}
      </button>
    </Tip>
  );
}

export const StatusSpacer = () => <span className="flex-1" />;
