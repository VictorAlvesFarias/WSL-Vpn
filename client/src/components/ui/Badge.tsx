import type { ComponentProps } from 'react';
import { cn } from './cn';

const tones = {
  neutral: 'bg-panel-2 text-fg-muted',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

interface BadgeProps extends ComponentProps<'span'> {
  tone?: keyof typeof tones;
}

export function Badge({ tone = 'neutral', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] shrink-0 items-center gap-1 rounded-[3px] px-1.5 text-[11px] font-medium whitespace-nowrap [&_svg]:size-3',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
