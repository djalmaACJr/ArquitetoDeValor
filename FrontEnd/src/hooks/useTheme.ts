// src/hooks/useTheme.ts
//
// Gerencia a família de layout (Clássico/Sábio/Engenheira/Mago/Raposa) e
// o modo (dia/noite) ativos. Persiste em duas camadas:
//
//   1. `localStorage` — leitura síncrona no boot (sem flicker).
//   2. `arqvalor.usuarios.layout` (Supabase) — fonte oficial; sincroniza
//      ao logar e em cada mudança. Coluna armazena composto `<familia>-<modo>`.
//
// Aplica no <html>:
//   - classe `.dark`  → quando modo === 'noite' (ativa `dark:` do Tailwind)
//   - `data-theme`    → família (lê o bloco CSS correspondente)
//
// Compatibilidade: a API antiga (`dark`, `toggle`) continua existindo —
// `dark` reflete o modo atual e `toggle()` alterna entre dia/noite na MESMA
// família. Para trocar de família use `setFamilia(id)`.

import { useCallback, useEffect, useState } from 'react'
import {
  FAMILIAS, FAMILIA_PADRAO, MODO_PADRAO,
  familiaPorId, parseLayoutId, gerarLayoutId,
  type Familia, type Modo,
} from '../lib/themes'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'

const STORAGE_KEY = 'av-theme'

interface Estado {
  familia: Familia['id']
  modo:    Modo
}

function detectarInicial(): Estado {
  const salvo = localStorage.getItem(STORAGE_KEY)
  if (salvo) return parseLayoutId(salvo)
  const prefereDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return { familia: FAMILIA_PADRAO, modo: prefereDark ? 'noite' : 'dia' }
}

function aplicarNoDom(e: Estado) {
  const html = document.documentElement
  html.classList.toggle('dark', e.modo === 'noite')
  html.setAttribute('data-theme', e.familia)
}

export function useTheme() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [estado, setEstado] = useState<Estado>(() => detectarInicial())

  // Sincroniza DOM + localStorage a cada mudança
  useEffect(() => {
    aplicarNoDom(estado)
    localStorage.setItem(STORAGE_KEY, gerarLayoutId(estado.familia, estado.modo))
  }, [estado])

  // Ao logar, busca preferência do banco. Banco vence se diferente.
  useEffect(() => {
    if (!userId) return
    let cancelado = false
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('layout')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (cancelado || !data) return
        const remoto = parseLayoutId(data.layout as string | null | undefined)
        setEstado(prev =>
          prev.familia === remoto.familia && prev.modo === remoto.modo ? prev : remoto
        )
      })
    return () => { cancelado = true }
  }, [userId])

  // Persiste no banco (fire-and-forget)
  const salvarNoBanco = useCallback((novo: Estado) => {
    if (!userId) return
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ layout: gerarLayoutId(novo.familia, novo.modo) })
      .eq('id', userId)
      .then(() => { /* descarta */ })
  }, [userId])

  /** Troca a família mantendo o modo atual (dia ou noite). */
  const setFamilia = useCallback((id: Familia['id']) => {
    setEstado(prev => {
      const familia = familiaPorId(id).id
      const novo = { familia, modo: prev.modo }
      salvarNoBanco(novo)
      return novo
    })
  }, [salvarNoBanco])

  /** Define modo explicitamente. */
  const setModo = useCallback((modo: Modo) => {
    setEstado(prev => {
      if (prev.modo === modo) return prev
      const novo = { ...prev, modo }
      salvarNoBanco(novo)
      return novo
    })
  }, [salvarNoBanco])

  /** Alterna entre dia e noite mantendo a família — o botão sol/lua. */
  const toggle = useCallback(() => {
    setEstado(prev => {
      const novo = { ...prev, modo: (prev.modo === 'noite' ? 'dia' : 'noite') as Modo }
      salvarNoBanco(novo)
      return novo
    })
  }, [salvarNoBanco])

  const familia = familiaPorId(estado.familia)

  return {
    /** Família ativa (objeto completo) */
    familia,
    /** Modo ativo ('dia' | 'noite') */
    modo: estado.modo,
    /** Lista de famílias disponíveis — para o picker */
    familias: FAMILIAS,
    /** Troca família (mantém modo) */
    setFamilia,
    /** Define modo explicitamente */
    setModo,
    /** Alterna entre dia/noite (botão sol/lua) */
    toggle,

    /** Compat com código antigo: true = modo noite ativo */
    dark: estado.modo === 'noite',
    /** Compat: id composto, ex. "sabio-noite" */
    layoutId: gerarLayoutId(estado.familia, estado.modo),
    /** Compat: usado por componentes que ainda esperam `tema.escuro` */
    tema: { id: gerarLayoutId(estado.familia, estado.modo), escuro: estado.modo === 'noite' },
    /** Compat: defaults antigos */
    padrao: gerarLayoutId(FAMILIA_PADRAO, MODO_PADRAO),
  }
}
