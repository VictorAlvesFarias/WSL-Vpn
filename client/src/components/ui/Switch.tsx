import * as SwitchPrimitive from '@radix-ui/react-switch';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'inline-flex h-[18px] w-8 shrink-0 items-center rounded-[4px] border border-line-strong bg-panel-2 outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-accent/60 disabled:opacity-40',
        'data-[state=checked]:border-accent data-[state=checked]:bg-accent',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3 translate-x-[2px] rounded-[2px] bg-fg-subtle transition-transform data-[state=checked]:translate-x-[16px] data-[state=checked]:bg-white" />
    </SwitchPrimitive.Root>
  );
}
