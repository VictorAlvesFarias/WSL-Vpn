import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { cn } from './cn';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons pinned under the scrolling body. */
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** A centered window over the app, closed with Esc, the X or a click outside. */
export function Modal({ open, onOpenChange, title, description, footer, className, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 flex max-h-[min(860px,calc(100vh-48px))] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-line-strong bg-bg shadow-2xl shadow-black/40 outline-none',
            className,
          )}
        >
          <header className="flex items-start gap-3 border-b border-line px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-[15px] font-semibold">{title}</Dialog.Title>
              {description ? (
                <Dialog.Description className="mt-0.5 text-[12.5px] text-fg-muted">{description}</Dialog.Description>
              ) : (
                <Dialog.Description className="sr-only">{title}</Dialog.Description>
              )}
            </div>
            <Dialog.Close asChild>
              <Button size="icon" variant="ghost" className="-mr-1.5 size-7" aria-label="Fechar">
                <X />
              </Button>
            </Dialog.Close>
          </header>
          <div className="min-h-0 flex-1 overflow-auto">{children}</div>
          {footer && <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
