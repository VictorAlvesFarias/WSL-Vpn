import * as AlertDialog from '@radix-ui/react-alert-dialog';
import { useCallback, useState, type ReactNode } from 'react';
import { Button } from './Button';

export interface ConfirmOptions {
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
}

interface Pending extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/** In-app replacement for window.confirm: `if (await confirm({...}))`. Render the returned element once. */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const close = (confirmed: boolean) => {
    pending?.resolve(confirmed);
    setPending(null);
  };

  const dialog = (
    <AlertDialog.Root open={pending !== null} onOpenChange={(open) => !open && close(false)}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[2px]" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-50 w-[min(420px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-md border border-line-strong bg-panel p-5 shadow-2xl shadow-black/40">
          <AlertDialog.Title className="text-[15px] font-semibold">{pending?.title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-[13px] leading-relaxed text-fg-muted">
            {pending?.description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild>
              <Button variant="ghost">Cancelar</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant={pending?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
                {pending?.confirmLabel}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );

  return [confirm, dialog];
}
