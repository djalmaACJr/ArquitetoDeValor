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

// Preferência salva: nome do mascote, "aleatorio" (rotação diária) ou
// "nenhum" (esconde balões/dicas; mantém apenas o parecer do resultado).
export type PreferenciaMascote = MascoteNome | 'aleatorio' | 'nenhum'
const VALORES_ESPECIAIS = ['aleatorio', 'nenhum'] as const

const LABEL_PADRAO: Record<MascoteNome, string> = {
  sabio:     'Conselheiro',
  arquiteta: 'Arquiteta',
  gato:      'Mago Gato',
  raposa:    'Raposa',
}

// Aliases dos nomes antigos pra preservar preferências salvas.
const ALIASES: Record<string, MascoteNome> = {
  engenheira: 'arquiteta',
  mago:       'gato',
}

function normalizarPreferencia(id: string | null | undefined): PreferenciaMascote {
  if (!id) return PADRAO
  if ((MASCOTES_VALIDOS as readonly string[]).includes(id)) return id as MascoteNome
  if ((VALORES_ESPECIAIS as readonly string[]).includes(id)) return id as 'aleatorio' | 'nenhum'
  if (id in ALIASES) return ALIASES[id]
  return PADRAO
}

// Resolve a `PreferenciaMascote` em um mascote concreto (sempre devolve um —
// útil para componentes que precisam de imagem/persona mesmo no modo
// "nenhum" — esses usam `semMascote` para esconder).
function resolverMascote(pref: PreferenciaMascote): MascoteNome {
  if (pref === 'nenhum') return PADRAO
  if (pref === 'aleatorio') {
    // Rotação determinística por DIA local — não muda dentro do dia, mas
    // troca à meia-noite. Usa epoch de dias para indexar.
    const hoje = new Date()
    const epochDays = Math.floor(hoje.getTime() / 86_400_000)
    return MASCOTES_VALIDOS[(epochDays % MASCOTES_VALIDOS.length + MASCOTES_VALIDOS.length) % MASCOTES_VALIDOS.length]
  }
  return pref
}

type Apelidos = Partial<Record<MascoteNome, string>>

export function useMascotePreferido() {
  const { session } = useAuth()
  const userId = session?.user?.id
  // `preferencia` é o valor RAW salvo (pode ser 'aleatorio'/'nenhum').
  // `mascote` é o mascote concreto resolvido (sempre um MascoteNome).
  const [preferencia, setPreferenciaState] = useState<PreferenciaMascote>(() =>
    normalizarPreferencia(localStorage.getItem(STORAGE_KEY)),
  )
  const [apelidos, setApelidos] = useState<Apelidos>({})
  // `primeiroAcesso` é true quando carregamos do banco e mascote_preferido
  // veio NULL — usuário ainda não passou pela tela de apresentação.
  // undefined = ainda não sabemos (carregando do banco).
  const [primeiroAcesso, setPrimeiroAcesso] = useState<boolean | undefined>(undefined)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, preferencia)
  }, [preferencia])

  // Sincroniza com o banco ao logar.
  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrimeiroAcesso(undefined)
      return
    }
    let cancelado = false
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('mascote_preferido, mascote_apelidos')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (cancelado || !data) return
        const remoto = normalizarPreferencia(data.mascote_preferido as string | null | undefined)
        setPreferenciaState(prev => (prev === remoto ? prev : remoto))
        const apels = (data.mascote_apelidos as Apelidos | null | undefined) ?? {}
        setApelidos(apels)
        // Primeiro acesso = nunca salvou mascote_preferido (NULL/vazio no banco)
        setPrimeiroAcesso(!data.mascote_preferido)
      })
    return () => { cancelado = true }
  }, [userId])

  // Aceita MascoteNome OU os valores especiais 'aleatorio' / 'nenhum'.
  const setMascote = useCallback((id: PreferenciaMascote) => {
    const novo = normalizarPreferencia(id)
    setPreferenciaState(novo)
    if (!userId) return
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ mascote_preferido: novo })
      .eq('id', userId)
      .then(() => { /* fire-and-forget */ })
  }, [userId])

  // Mascote concreto a renderizar — resolve 'aleatorio' via rotação diária
  // e usa o padrão para 'nenhum' (semMascote=true esconde a UI relacionada).
  const mascote: MascoteNome = resolverMascote(preferencia)
  const semMascote = preferencia === 'nenhum'
  const ehAleatorio = preferencia === 'aleatorio'

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

  /** Define vários apelidos de uma vez (usado no modo 'Aleatório', em que
   *  o usuário batiza os 4 mascotes na onboarding). */
  const definirVariosApelidos = useCallback(async (novosApelidos: Apelidos): Promise<{ ok: boolean }> => {
    const novo: Apelidos = { ...apelidos }
    for (const [nome, ap] of Object.entries(novosApelidos)) {
      const limpo = (ap ?? '').trim()
      if (limpo) novo[nome as MascoteNome] = limpo
      else       delete novo[nome as MascoteNome]
    }
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
    /** Mascote concreto a exibir (resolve 'aleatorio' → mascote do dia). */
    mascote,
    /** Preferência RAW: nome do mascote, 'aleatorio' ou 'nenhum'. */
    preferencia,
    /** Atualiza a preferência (aceita MascoteNome, 'aleatorio' ou 'nenhum'). */
    setMascote,
    mascotes: MASCOTES_VALIDOS,
    apelidos,
    definirApelido,
    definirVariosApelidos,
    apelidoDe,
    /** true quando preferencia === 'nenhum' — UI esconde balões/dicas. */
    semMascote,
    /** true quando preferencia === 'aleatorio'. */
    ehAleatorio,
    /** true = usuário ainda não passou pela tela de apresentação. undefined = carregando. */
    primeiroAcesso,
  }
}
