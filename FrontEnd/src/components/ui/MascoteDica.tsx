// src/components/ui/MascoteDica.tsx
//
// Bloco compacto "mascote + balão de fala" para insights/dicas contextuais.
// Renderiza nada se o PNG da pose ainda não existir — assim a UI continua
// limpa enquanto as imagens individuais não estão prontas (ver Mascote.tsx).

import { useState } from 'react'
import Mascote, { type MascoteNome, type MascotePose } from './Mascote'

export default function MascoteDica({
  nome,
  pose = 'hero',
  texto,
  size = 128,
  className = '',
}: {
  nome:   MascoteNome
  pose?:  MascotePose
  texto:  string
  size?:  number
  className?: string
}) {
  // Esconde o bloco inteiro se a imagem falhar — evita um balão "órfão".
  const [imgFalhou, setImgFalhou] = useState(false)
  if (imgFalhou) return null

  return (
    <div className={`flex items-end gap-3 ${className}`}>
      <img
        src={`/mascotes/${nome}-${pose}.png`}
        alt=""
        loading="lazy"
        onError={() => setImgFalhou(true)}
        className="flex-shrink-0 select-none pointer-events-none object-contain"
        style={{ width: size, height: 'auto' }}
      />
      <div className="flex-1 relative mb-3">
        <div
          className="rounded-2xl px-4 py-3 text-[15px] leading-relaxed border"
          style={{
            background:  'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
            color:       'var(--text-secondary)',
          }}
        >
          {texto}
        </div>
        {/* Pico do balão apontando para o mascote */}
        <div
          className="absolute left-[-7px] top-4 w-3 h-3 rotate-45 border-l border-b"
          style={{
            background:  'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
          }}
        />
      </div>
    </div>
  )
}

// Re-export pra facilitar consumo
export { Mascote, type MascoteNome, type MascotePose }
