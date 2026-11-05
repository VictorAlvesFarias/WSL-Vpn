import { Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

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
    <div className="flex min-w-0 flex-col gap-1.5">
      <label className="flex items-center gap-2 text-[12.5px] font-medium">
        {label}
        {stored && !removing && <Badge tone="ok">salvo (criptografado)</Badge>}
        {removing && <Badge tone="danger">será removido</Badge>}
      </label>
      <div className="relative">
        <Input
          type={show ? 'text' : 'password'}
          value={value ?? ''}
          onChange={(event) => onChange(event.target.value || undefined)}
          placeholder={removing ? 'Será removido ao salvar' : stored ? 'Vazio: mantém o valor salvo' : ''}
          autoComplete="new-password"
          disabled={disabled || removing}
          className="pr-9 font-mono"
          aria-label={label}
        />
        <Button size="icon" variant="ghost" className="absolute top-1 right-1 size-6 [&_svg]:size-3.5" onClick={() => setShow(!show)} aria-label={show ? 'Ocultar' : 'Mostrar'}>
          {show ? <EyeOff /> : <Eye />}
        </Button>
      </div>
      {stored && (
        <button type="button" className="self-start text-[12px] text-accent hover:underline" onClick={() => onChange(removing ? undefined : '')}>
          {removing ? 'Manter o valor salvo' : 'Remover o valor salvo'}
        </button>
      )}
    </div>
  );
}
