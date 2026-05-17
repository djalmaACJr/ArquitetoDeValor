// src/hooks/useTheme.ts
//
// Gerencia o tema ativo. Suporta múltiplos temas registrados em
// `lib/themes.ts`. A API mantém compatibilidade com o uso anterior
// (`dark` / `toggle`) — quem só precisava do toggle escuro/claro continua
// funcionando sem alterações.
//
// Aplica dois atributos no <html>:
//   - classe `.dark`  → ativa modificadores `dark:` do Tailwind (Tailwind
//                       está configurado com darkMode: 'class')
//   - `data-theme`    → seleciona o bloco de variáveis CSS do tema escolhido
//                       (ver globals.css)

import { useCallback, useEffect, useState } from 'react'
import { TEMAS, TEMA_PADRAO, temaPorId, type Tema } from '../lib/themes'

const STORAGE_KEY = 'av-theme'           // mantém o nome antigo p/ herdar a preferência salva
const LEGACY_DARK = 'dark'                // valores antigos: 'dark' / 'light'
const LEGACY_LIGHT = 'light'

function detectarPreferenciaInicial(): Tema {
  const salvo = localStorage.getItem(STORAGE_KEY)
  if (salvo === LEGACY_DARK)  return temaPorId('escuro')
  if (salvo === LEGACY_LIGHT) return temaPorId('claro')
  if (salvo)                  return temaPorId(salvo)
  const prefereDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  return temaPorId(prefereDark ? 'escuro' : 'claro')
}

function aplicarTema(tema: Tema) {
  const html = document.documentElement
  html.classList.toggle('dark', tema.escuro)
  html.setAttribute('data-theme', tema.id)
}

export function useTheme() {
  const [tema, setTemaState] = useState<Tema>(() => detectarPreferenciaInicial())

  useEffect(() => {
    aplicarTema(tema)
    localStorage.setItem(STORAGE_KEY, tema.id)
  }, [tema])

  const setTheme = useCallback((id: string) => {
    setTemaState(temaPorId(id))
  }, [])

  /** Alterna entre claro e escuro mantendo a "família" do tema atual quando
   *  possível. Ex.: midnight → claro; sepia → escuro. Mantém o comportamento
   *  do antigo `toggle()` (botão sol/lua na sidebar). */
  const toggle = useCallback(() => {
    setTemaState(t => temaPorId(t.escuro ? 'claro' : 'escuro'))
  }, [])

  return {
    /** Tema ativo (objeto completo) */
    tema,
    /** Lista de temas disponíveis — usada por pickers */
    temas: TEMAS,
    /** Define um tema pelo id */
    setTheme,
    /** Compat: true se o tema atual é escuro (mantém Tailwind `dark:` ok) */
    dark: tema.escuro,
    /** Compat: alterna escuro/claro */
    toggle,
    /** Compat: id do tema padrão */
    padrao: TEMA_PADRAO,
  }
}
