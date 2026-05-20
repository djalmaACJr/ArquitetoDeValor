// src/components/ui/LoadingMascote.tsx
//
// Loading screen com o mascote preferido na pose "andando". Substitui
// os spinners genéricos em telas de carregamento de conteúdo. O
// mascote ganha um pequeno movimento de "balanço" (CSS) que sugere
// caminhada — sem framework de animação extra.
//
// Em contextos sem autenticação (App boot, antes do login) use a
// variante `LoadingMascoteEstatico` que aceita `nome` explícito —
// não tenta consumir o hook.

import Mascote, { type MascoteNome } from './Mascote'
import { useMascotePreferido } from '../../hooks/useMascotePreferido'

interface PropsBase {
  texto?:     string
  size?:      number
  className?: string
}

function Conteudo({
  nome,
  texto = 'Carregando…',
  size = 120,
  className = '',
}: PropsBase & { nome: MascoteNome }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 py-6 ${className}`}>
      <div className="loading-mascote-walk" style={{ width: size, height: 'auto' }}>
        <Mascote nome={nome} pose="andando" size={size} />
      </div>
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
