// src/components/ui/CampoSenha.tsx
// Campo de senha com botão de mostrar/ocultar (olho). Reaproveitado nas telas
// de Login, Cadastro e Redefinir Senha. Mantém a aparência do input recebido
// via `className` — só reserva espaço à direita para o ícone.
import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

interface Props {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  required?: boolean
  autoComplete?: string
}

export function CampoSenha({
  value, onChange, placeholder, className = '', required, autoComplete,
}: Props) {
  const [visivel, setVisivel] = useState(false)
  return (
    <div className="relative">
      <input
        type={visivel ? 'text' : 'password'}
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        autoComplete={autoComplete}
        className={`${className} pr-11`}
        placeholder={placeholder}
      />
      <button
        type="button"
        onClick={() => setVisivel(v => !v)}
        tabIndex={-1}
        aria-label={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        title={visivel ? 'Ocultar senha' : 'Mostrar senha'}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/75 transition-colors"
      >
        {visivel ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}
