import type { ComponentProps } from 'react';
import { cn } from './cn';

const variants = {
  primary: 'border-transparent bg-accent text-accent-fg hover:brightness-110',
  secondary: 'border-line-strong bg-panel text-fg hover:bg-panel-2',
  ghost: 'border-transparent text-fg-muted hover:bg-panel-2 hover:text-fg',
  danger: 'border-transparent bg-danger text-white hover:brightness-110',
};

const sizes = {
  sm: 'h-7 gap-1.5 px-2.5 text-[12.5px]',
  md: 'h-8 gap-2 px-3 text-[13px]',
  icon: 'size-8 justify-center',
};

interface ButtonProps extends ComponentProps<'button'> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
}

export function Button({ variant = 'secondary', size = 'md', className, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex shrink-0 items-center rounded border font-medium whitespace-nowrap outline-none transition-[background-color,color,filter]',
        'focus-visible:ring-2 focus-visible:ring-accent/60 disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}
