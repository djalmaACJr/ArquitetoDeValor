// src/hooks/useMascotePreferido.ts
//
// Gerencia qual dos 4 mascotes o usuário escolhe ver nos balões/dicas
// contextuais. A escolha é persistida em duas camadas:
//
//   1. `localStorage` — leitura síncrona no boot (sem flicker).
//   2. `arqvalor.usuarios.mascote_preferido` (Supabase) — fonte oficial;
//      sincroniza ao logar e em cada mudança.
//
// Componentes consumidores (DashboardPage, ComparativoMensalPage etc.)
// chamam `useMascotePreferido()` e usam `mascote` no lugar de hardcoded.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { MascoteNome } from '../components/ui/Mascote'

const STORAGE_KEY = 'av-mascote'
const MASCOTES_VALIDOS: readonly MascoteNome[] = ['sabio', 'engenheira', 'mago', 'raposa']
const PADRAO: MascoteNome = 'sabio'

function normalizar(id: string | null | undefined): MascoteNome {
  if (id && (MASCOTES_VALIDOS as readonly string[]).includes(id)) return id as MascoteNome
  return PADRAO
}

export function useMascotePreferido() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [mascote, setMascoteState] = useState<MascoteNome>(() =>
    normalizar(localStorage.getItem(STORAGE_KEY)),
  )

  // Persiste local a cada troca
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mascote)
  }, [mascote])

  // Sincroniza com o banco ao logar — banco vence se diferente.
  useEffect(() => {
    if (!userId) return
    let cancelado = false
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('mascote_preferido')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (cancelado || !data) return
        const remoto = normalizar(data.mascote_preferido as string | null | undefined)
        setMascoteState(prev => (prev === remoto ? prev : remoto))
      })
    return () => { cancelado = true }
  }, [userId])

  const setMascote = useCallback((id: MascoteNome) => {
    const novo = normalizar(id)
    setMascoteState(novo)
    if (!userId) return
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ mascote_preferido: novo })
      .eq('id', userId)
      .then(() => { /* fire-and-forget */ })
  }, [userId])

  return { mascote, setMascote, mascotes: MASCOTES_VALIDOS }
}
