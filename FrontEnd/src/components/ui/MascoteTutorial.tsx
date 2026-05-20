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

import { useState, useMemo, useEffect } from 'react'
import { Shuffle } from 'lucide-react'
import MascoteDica from './MascoteDica'
import { useMascotePreferido } from '../../hooks/useMascotePreferido'
import {
  falaTutorial,
  DICAS,
  type PaginaTutorial,
} from '../../lib/conteudoMascotes'

const STORAGE_PREFIX = 'av-tut-visto-'

export default function MascoteTutorial({
  pagina,
  className = '',
}: {
  pagina:     PaginaTutorial
  className?: string
}) {
  const { mascote } = useMascotePreferido()
  const storageKey = `${STORAGE_PREFIX}${pagina}-${mascote}`

  // `null` enquanto não decidimos (1º render); depois "tutorial" ou um
  // índice numérico (0..N-1) apontando pra DICAS[mascote][idx].
  const [estado, setEstado] = useState<'tutorial' | number | null>(null)

  // Lê o "já viu tutorial" do localStorage ao montar / trocar mascote.
  useEffect(() => {
    // Limpeza one-shot: chaves do schema antigo (com X dispensável)
    // ficavam em `av-tutorial-...`. Removemos pra esquecer "fechado".
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith('av-tutorial-')) localStorage.removeItem(k)
    }

    const jaViu = localStorage.getItem(storageKey) === '1'
    if (jaViu) {
      // Vai direto pra dica aleatória.
      setEstado(idxRandomDica())
    } else {
      // Mostra o tutorial e marca como visto.
      localStorage.setItem(storageKey, '1')
      setEstado('tutorial')
    }
  }, [storageKey])

  const tutorial = useMemo(() => falaTutorial(pagina, mascote), [pagina, mascote])
  const pool = DICAS[mascote]

  function idxRandomDica(atual?: number): number {
    if (pool.length <= 1) return 0
    let proximo = Math.floor(Math.random() * pool.length)
    // Evita repetir a mesma dica em sequência (se possível)
    if (proximo === atual) proximo = (proximo + 1) % pool.length
    return proximo
  }

  if (estado === null) return null  // 1º paint — evita flash

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
