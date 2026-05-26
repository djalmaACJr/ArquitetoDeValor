// src/components/ui/LoadingMascote.tsx
//
// Loading screen com o mascote preferido. Substitui spinners genéricos
// em telas de carregamento de conteúdo.
//
// - Mascotes com WebM disponível (`COM_WEBM`): cena especial — o
//   mascote caminha até a estante e pega um livro. Gerados por
//   `scripts/gerar_anim_mascote.py`.
// - Demais mascotes: pose `andando` com um "balanço" CSS sutil.
//
// Em contextos sem autenticação (App boot, antes do login) use a
// variante `LoadingMascoteEstatico` que aceita `nome` explícito —
// não tenta consumir o hook.

import { useState } from 'react'
import Mascote, { type MascoteNome } from './Mascote'
import { useMascotePreferido } from '../../hooks/useMascotePreferido'

interface PropsBase {
  texto?:     string
  size?:      number
  className?: string
}

// Mascotes que já têm WebM de loading gerado em /public/mascotes/.
const COM_WEBM: readonly MascoteNome[] = ['sabio', 'arquiteta', 'gato', 'raposa']

/** Cena WebM de loading — vídeo de ~4s em loop com alpha. Se o WebM
 *  falhar (autoplay bloqueado, codec não suportado, 404) cai pra pose
 *  estática `andando` com a mesma animação CSS dos mascotes sem WebM. */
function CenaWebM({ nome, size }: { nome: MascoteNome; size: number }) {
  // O vídeo agora é portrait 360×640 (9:16). Dimensionamos pela ALTURA
  // (não largura) pra não ocupar muito espaço horizontal nas telas.
  // `size` é a "altura nominal" do personagem; o vídeo fica um pouco
  // maior por causa das margens superior/inferior dele.
  const FATOR_ALTURA = 1.5
  const videoH = Math.round(size * FATOR_ALTURA)
  const [erro, setErro] = useState(false)

  if (erro) {
    return (
      <div className="loading-mascote-walk" style={{ width: size, height: 'auto' }}>
        <Mascote nome={nome} pose="andando" size={size} />
      </div>
    )
  }

  return (
    <video
      key={nome}
      src={`/mascotes/${nome}-andando.webm`}
      autoPlay
      loop
      muted
      playsInline
      aria-hidden="true"
      style={{ height: videoH, width: 'auto', display: 'block' }}
      onError={() => setErro(true)}
      onStalled={() => setErro(true)}
    />
  )
}

function Conteudo({
  nome,
  texto = 'Carregando…',
  size = 120,
  className = '',
}: PropsBase & { nome: MascoteNome }) {
  const temWebM = COM_WEBM.includes(nome)
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-6 ${className}`}>
      {temWebM ? (
        <CenaWebM nome={nome} size={size} />
      ) : (
        <div className="loading-mascote-walk" style={{ width: size, height: 'auto' }}>
          <Mascote nome={nome} pose="andando" size={size} />
        </div>
      )}
      {texto && (
        <p className="text-[15px] font-medium" style={{ color: 'var(--text-muted)' }}>
          {texto}
        </p>
      )}
      <style>{`
        @keyframes loading-mascote-walk {
          0%, 100% { transform: translateY(0)    rotate(-1deg); }
          25%      { transform: translateY(-3px) rotate(1deg);  }
          50%      { transform: translateY(0)    rotate(-1deg); }
          75%      { transform: translateY(-2px) rotate(1deg);  }
        }
        .loading-mascote-walk {
          animation: loading-mascote-walk 0.9s ease-in-out infinite;
          transform-origin: center bottom;
        }
        @media (prefers-reduced-motion: reduce) {
          .loading-mascote-walk { animation: none; }
        }
      `}</style>
    </div>
  )
}

/** Versão padrão — usa o mascote preferido do usuário logado. */
export default function LoadingMascote(props: PropsBase) {
  const { mascote } = useMascotePreferido()
  return <Conteudo {...props} nome={mascote} />
}

/** Versão sem hook — usar antes de o usuário logar (App boot,
 *  splash inicial, etc.). */
export function LoadingMascoteEstatico({
  nome = 'sabio',
  ...rest
}: PropsBase & { nome?: MascoteNome }) {
  return <Conteudo {...rest} nome={nome} />
}
