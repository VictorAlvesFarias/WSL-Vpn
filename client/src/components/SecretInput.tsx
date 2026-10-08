import { useState } from 'react';
import { Icon } from './Icon';

interface SecretInputProps {
  label: string;
  /** A secret is already in the vault: an empty field keeps it. */
  stored: boolean;
  value: string | undefined;
  /** undefined keeps the stored secret, "" removes it. */
  onChange: (value: string | undefined) => void;
  disabled?: boolean;
}

/** Password field for a vault secret: keep, replace or remove. */
export function SecretInput({ label, stored, value, onChange, disabled }: SecretInputProps) {
  const [show, setShow] = useState(false);
  const removing = stored && value === '';

  return (
    <label className="field">
      <span className="field-label">
        {label}
        {stored && !removing && <span className="chip chip-ok">no cofre</span>}
      </span>
      <div className="input-with-actions">
        <input
          type={show ? 'text' : 'password'}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || undefined)}
          placeholder={removing ? 'Será removida ao salvar' : stored ? 'Vazio: mantém a salva' : 'Senha'}
          autoComplete="new-password"
          disabled={disabled || removing}
        />
        <button type="button" className="icon-button" onClick={() => setShow(!show)} title="Mostrar">
          <Icon name={show ? 'eyeOff' : 'eye'} />
        </button>
      </div>
      {stored && (
        <button type="button" className="link-button small start" onClick={() => onChange(removing ? undefined : '')}>
          {removing ? 'Manter a senha salva' : 'Remover a senha salva'}
        </button>
      )}
    </label>
  );
}
