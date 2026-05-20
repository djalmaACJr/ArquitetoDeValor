// src/components/ui/MascoteDica.tsx
//
// Bloco compacto "mascote + balão de fala" para dicas contextuais.
// O mascote aparece como um headshot (square com object-cover top) —
// economiza espaço vertical no Dashboard / Comparativo. O balão fica
// ao lado, vertical-centrado, ocupando a largura restante.
//
// Renderiza nada se o PNG da pose ainda não existir — assim a UI
// continua limpa enquanto as imagens não estão prontas.
//
// Clicar no mascote abre o chat com a IA (ChatMascote).

import { useState } from 'react'
import Mascote, { srcMascote, type MascoteNome, type MascotePose } from './Mascote'
import ChatMascote from './ChatMascote'

export default function MascoteDica({
  nome,
  pose = 'sentado',
  texto,
  /**
   * Tamanho do AVATAR (quadrado). Default 64px — formato compacto
   * pensado para Dashboards e Insights. Passe um número maior se quiser
   * mostrar o mascote por inteiro (modo hero), mas então use o
   * `Mascote` direto em vez do `MascoteDica`.
   */
  size = 64,
  className = '',
}: {
  nome:   MascoteNome
  pose?:  MascotePose
  texto:  string
  size?:  number
  className?: string
}) {
  const [imgFalhou, setImgFalhou] = useState(false)
  const [chatAberto, setChatAberto] = useState(false)
  if (imgFalhou) return null

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      {/* Avatar — headshot quadrado mostrando só a parte superior do mascote */}
      <button
        type="button"
        onClick={() => setChatAberto(true)}
        title="Conversar com o mascote"
        className="flex-shrink-0 rounded-full overflow-hidden transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-av-green/40 cursor-pointer"
        style={{
          width: size,
          height: size,
          background:  'var(--tint-2)',
          border:      '2px solid var(--border-subtle)',
          padding: 0,
        }}
      >
        <img
          src={srcMascote(nome, pose)}
          alt={`Conversar com ${nome}`}
          loading="lazy"
          onError={() => setImgFalhou(true)}
          className="select-none pointer-events-none"
          style={{
            width:  '100%',
            height: '100%',
            objectFit:       'cover',
            objectPosition:  'top',
          }}
        />
      </button>
      <ChatMascote nome={nome} aberto={chatAberto} onFechar={() => setChatAberto(false)} />

      {/* Balão */}
      <div className="flex-1 relative min-w-0">
        <div
          className="rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed border"
          style={{
            background:  'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
            color:       'var(--text-secondary)',
          }}
        >
          {texto}
        </div>
        {/* Pico apontando para o avatar */}
        <div
          className="absolute left-[-7px] top-1/2 w-3 h-3 rotate-45 border-l border-b"
          style={{
            background:  'var(--bg-elevated)',
            borderColor: 'var(--border-subtle)',
            transform:   'translateY(-50%) rotate(45deg)',
          }}
        />
      </div>
    </div>
  )
}

// Re-export pra facilitar consumo
export { Mascote, type MascoteNome, type MascotePose }
