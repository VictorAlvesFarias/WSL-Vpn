import { useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import { Icon } from './Icon';

interface ModalProps {
  title: string;
  onClose: () => void;
  /** When given, the modal is a form and Enter submits it. */
  onSubmit?: (event: FormEvent) => void;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}

export function Modal({ title, onClose, onSubmit, footer, wide, children }: ModalProps) {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && close.current();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const content = (
    <>
      <header className="modal-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} title="Fechar">
          <Icon name="x" />
        </button>
      </header>
      {children}
      {footer && <footer className="modal-actions">{footer}</footer>}
    </>
  );

  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      {onSubmit ? (
        <form className={`modal card${wide ? ' wide' : ''}`} onSubmit={onSubmit}>
          {content}
        </form>
      ) : (
        <div className={`modal card${wide ? ' wide' : ''}`}>{content}</div>
      )}
    </div>
  );
}
