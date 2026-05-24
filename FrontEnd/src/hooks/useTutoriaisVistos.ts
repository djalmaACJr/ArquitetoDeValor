// src/hooks/useTutoriaisVistos.ts
//
// Controla quais tutoriais o usuário já viu, persistindo em
// `arqvalor.usuarios.tutoriais_vistos` (JSONB). Antes era só localStorage,
// o que fazia o tutorial reaparecer ao trocar de browser/dispositivo ou
// quando o cache era limpo (ex.: pelo `limparEstadoCliente` em troca de
// usuário).
//
// Chaves convencionais:
//   - TutorialTour:    "tour-<pageKey>"          (ex.: "tour-dashboard-v1")
//   - MascoteTutorial: "tutorial-<pagina>-<mascote>" (ex.: "tutorial-dashboard-sabio")

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

type Mapa = Record<string, boolean>

export function useTutoriaisVistos() {
  const { session } = useAuth()
  const userId = session?.user?.id
  // null = ainda carregando. {} = carregado vazio.
  const [vistos, setVistos] = useState<Mapa | null>(null)

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVistos(null)
      return
    }
    let cancelado = false
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('tutoriais_vistos')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (cancelado) return
        setVistos((data?.tutoriais_vistos as Mapa | null) ?? {})
      })
    return () => { cancelado = true }
  }, [userId])

  /** true quando ainda não carregou do banco. Componentes devem NÃO
   *  exibir o tutorial enquanto loading=true pra evitar flash. */
  const loading = vistos === null

  const foiVisto = useCallback((key: string): boolean => {
    return !!vistos?.[key]
  }, [vistos])

  /** Marca o tutorial como visto e persiste no banco. Idempotente —
   *  se já estiver marcado, não faz round-trip. */
  const marcarVisto = useCallback(async (key: string): Promise<void> => {
    if (!userId || !vistos) return
    if (vistos[key]) return
    const novo = { ...vistos, [key]: true }
    setVistos(novo)
    await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ tutoriais_vistos: novo })
      .eq('id', userId)
  }, [vistos, userId])

  /** Apaga todos os "vistos" — útil pra um botão "ver tutoriais de novo". */
  const resetar = useCallback(async (): Promise<void> => {
    if (!userId) return
    setVistos({})
    await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ tutoriais_vistos: {} })
      .eq('id', userId)
  }, [userId])

  return { loading, foiVisto, marcarVisto, resetar }
}
