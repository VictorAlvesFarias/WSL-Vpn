import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { forwardRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from './cn';

const control =
  'h-8 w-full min-w-0 rounded border border-line-strong bg-bg px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-subtle focus:border-accent focus:ring-2 focus:ring-accent/25 disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, ComponentProps<'input'>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} spellCheck={false} className={cn(control, className)} {...props} />;
});

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(control, 'pr-1.5', className)} {...props} />;
}

/** A label over its control, with an optional hint under it. */
export function FormField({ label, hint, className, children }: { label: ReactNode; hint?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-[12.5px] font-medium">{label}</span>
      {children}
      {hint && <span className="text-[12px] leading-relaxed text-fg-muted">{hint}</span>}
    </label>
  );
}

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
}

export function Checkbox({ checked, onChange, children, className }: CheckboxProps) {
  return (
    <label className={cn('flex items-center gap-2 text-[13px]', className)}>
      <CheckboxPrimitive.Root
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
        className="grid size-4 shrink-0 place-items-center rounded-[3px] border border-line-strong bg-bg outline-none focus-visible:ring-2 focus-visible:ring-accent/60 data-[state=checked]:border-accent data-[state=checked]:bg-accent"
      >
        <CheckboxPrimitive.Indicator>
          <Check className="size-3 text-accent-fg" strokeWidth={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      {children}
    </label>
  );
}
