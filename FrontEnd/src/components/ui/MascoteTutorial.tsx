// src/components/ui/MascoteTutorial.tsx
//
// Banner contextual do mascote no topo das páginas. Mostra:
//   - 1ª visita à página com aquele mascote: o TUTORIAL da página
//     (explica funcionalidades e regras, na voz da personalidade)
//   - Visitas seguintes: uma DICA ALEATÓRIA do pool do mascote
//
// Não é dispensável — o usuário pode trocar a dica clicando no botão
// "Próxima dica" (ícone de shuffle). A pose acompanha a dica.
//
// O estado "já viu tutorial" é por (página + mascote), em localStorage.
// Trocar o mascote em Perfil traz o tutorial de volta na voz nova —
// reforça o vínculo com a personalidade.

import { useState, useMemo, useEffect, useCallback } from 'react'
import { Shuffle } from 'lucide-react'
import MascoteDica from './MascoteDica'
import { useMascotePreferido } from '../../hooks/useMascotePreferido'
import { useTutoriaisVistos } from '../../hooks/useTutoriaisVistos'
import {
  falaTutorial,
  DICAS,
  type PaginaTutorial,
} from '../../lib/conteudoMascotes'

export default function MascoteTutorial({
  pagina,
  className = '',
}: {
  pagina:     PaginaTutorial
  className?: string
}) {
  const { mascote, semMascote } = useMascotePreferido()
  const { loading: tutoriaisLoading, foiVisto, marcarVisto } = useTutoriaisVistos()
  const chaveVisto = `tutorial-${pagina}-${mascote}`

  // `null` enquanto não decidimos (1º render); depois "tutorial" ou um
  // índice numérico (0..N-1) apontando pra DICAS[mascote][idx].
  const [estado, setEstado] = useState<'tutorial' | number | null>(null)

  const idxRandomDica = useCallback((atual?: number): number => {
    const p = DICAS[mascote]
    if (p.length <= 1) return 0
    let proximo = Math.floor(Math.random() * p.length)
    if (proximo === atual) proximo = (proximo + 1) % p.length
    return proximo
  }, [mascote])

  // Decide tutorial vs dica com base no banco (não mais localStorage).
  // Aguarda o estado dos tutoriais carregar antes de decidir — assim
  // mesmo num browser/dispositivo novo, se o tutorial já foi visto antes,
  // não vai aparecer de novo.
  useEffect(() => {
    if (tutoriaisLoading) return
    if (foiVisto(chaveVisto)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEstado(idxRandomDica())
    } else {
      // Mostra o tutorial e marca como visto no banco.
      setEstado('tutorial')
      void marcarVisto(chaveVisto)
    }
  }, [chaveVisto, tutoriaisLoading, foiVisto, marcarVisto, idxRandomDica])

  const tutorial = useMemo(() => falaTutorial(pagina, mascote), [pagina, mascote])
  const pool = DICAS[mascote]

  // Modo "Nenhum mentor" — esconde balão/banner completamente.
  if (semMascote) return null
  if (estado === null) return null  // 1º paint / carregando — evita flash

  const exibindoTutorial = estado === 'tutorial'
  const dica = exibindoTutorial ? null : pool[estado]
  const pose = exibindoTutorial ? tutorial.pose : dica!.pose
  const texto = exibindoTutorial ? tutorial.texto : dica!.texto

  const proxima = () => {
    setEstado(prev => idxRandomDica(typeof prev === 'number' ? prev : undefined))
  }

  return (
    <div className={`relative pr-10 ${className}`}>
      <MascoteDica nome={mascote} pose={pose} texto={texto} />
      <button
        type="button"
        onClick={proxima}
        title={exibindoTutorial ? 'Ver dica aleatória do mascote' : 'Outra dica'}
        aria-label="Próxima dica"
        className="absolute top-1 right-0 p-1.5 rounded-lg transition-all hover:scale-110"
        style={{
          color:       'var(--text-muted)',
          background:  'var(--tint-1)',
        }}
      >
        <Shuffle size={14} />
      </button>
    </div>
  )
}
