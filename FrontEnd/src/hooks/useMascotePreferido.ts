// src/hooks/useMascotePreferido.ts
//
// Gerencia qual dos 4 mascotes o usuário escolhe ver nos balões/dicas
// e quais apelidos personalizados ele deu para cada um.
//
// Persistido em:
//   - `arqvalor.usuarios.mascote_preferido` (TEXT) — id do mascote ativo
//   - `arqvalor.usuarios.mascote_apelidos` (JSONB) — { [nome]: apelido }
//   - `localStorage` — cache do mascote pra evitar flicker no boot
//
// Componentes consumidores chamam `useMascotePreferido()` e usam
// `mascote` (id) e `apelidoDe(nome)` para exibir o nome dado pelo
// usuário (ou o nome padrão se ele não definiu).

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { MascoteNome } from '../components/ui/Mascote'

const STORAGE_KEY = 'av-mascote'
const MASCOTES_VALIDOS: readonly MascoteNome[] = ['sabio', 'arquiteta', 'gato', 'raposa']
const PADRAO: MascoteNome = 'sabio'

const LABEL_PADRAO: Record<MascoteNome, string> = {
  sabio:     'Sábio',
  arquiteta: 'Arquiteta',
  gato:      'Mago Gato',
  raposa:    'Raposa',
}

// Aliases dos nomes antigos pra preservar preferências salvas.
const ALIASES: Record<string, MascoteNome> = {
  engenheira: 'arquiteta',
  mago:       'gato',
}

function normalizar(id: string | null | undefined): MascoteNome {
  if (!id) return PADRAO
  if ((MASCOTES_VALIDOS as readonly string[]).includes(id)) return id as MascoteNome
  if (id in ALIASES) return ALIASES[id]
  return PADRAO
}

type Apelidos = Partial<Record<MascoteNome, string>>

export function useMascotePreferido() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [mascote, setMascoteState] = useState<MascoteNome>(() =>
    normalizar(localStorage.getItem(STORAGE_KEY)),
  )
  const [apelidos, setApelidos] = useState<Apelidos>({})

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, mascote)
  }, [mascote])

  // Sincroniza com o banco ao logar.
  useEffect(() => {
    if (!userId) return
    let cancelado = false
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('mascote_preferido, mascote_apelidos')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (cancelado || !data) return
        const remoto = normalizar(data.mascote_preferido as string | null | undefined)
        setMascoteState(prev => (prev === remoto ? prev : remoto))
        const apels = (data.mascote_apelidos as Apelidos | null | undefined) ?? {}
        setApelidos(apels)
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

  /** Define o apelido para um mascote específico. Vazio remove o apelido. */
  const definirApelido = useCallback(async (nome: MascoteNome, apelido: string): Promise<{ ok: boolean }> => {
    const limpo = apelido.trim()
    const novo: Apelidos = { ...apelidos }
    if (limpo) novo[nome] = limpo
    else       delete novo[nome]
    setApelidos(novo)
    if (!userId) return { ok: true }
    const { error } = await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ mascote_apelidos: novo })
      .eq('id', userId)
    return { ok: !error }
  }, [apelidos, userId])

  /** Retorna o apelido dado pelo usuário ou o nome padrão se não houver. */
  const apelidoDe = useCallback((nome: MascoteNome): string => {
    return apelidos[nome] ?? LABEL_PADRAO[nome]
  }, [apelidos])

  return {
    mascote,
    setMascote,
    mascotes: MASCOTES_VALIDOS,
    apelidos,
    definirApelido,
    apelidoDe,
  }
}
