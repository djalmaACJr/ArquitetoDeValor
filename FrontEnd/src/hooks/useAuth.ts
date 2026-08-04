import { useSyncExternalStore } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

// Store módulo-level compartilhado entre TODAS as chamadas de useAuth(): antes,
// cada componente que chamava o hook montava seu próprio getSession() +
// onAuthStateChange, gerando uma dezena de listeners redundantes ativos ao
// mesmo tempo numa única tela (ex.: Dashboard). Agora só existe 1 listener
// real do Supabase para o app inteiro; useSyncExternalStore só inscreve os
// componentes nas mudanças, sem round-trip próprio.
interface AuthState { session: Session | null; loading: boolean }
let estado: AuthState = { session: null, loading: true }
const ouvintes = new Set<() => void>()
const notificar = () => { for (const fn of ouvintes) fn() }

let iniciado = false
function iniciarSeNecessario() {
  if (iniciado) return
  iniciado = true
  // Só onAuthStateChange — o evento INITIAL_SESSION dispara automaticamente
  // com a sessão atual assim que o listener é registrado, então uma chamada
  // getSession() separada é redundante e corria em paralelo com o primeiro
  // evento (race: se `signIn()` terminasse entre as duas, uma delas podia
  // sobrescrever o estado com um valor mais velho).
  supabase.auth.onAuthStateChange((_event, s) => {
    estado = { session: s, loading: false }
    notificar()
  })
}

const inscrever = (cb: () => void) => {
  iniciarSeNecessario()
  ouvintes.add(cb)
  return () => ouvintes.delete(cb)
}
const obterEstado = () => estado

export function useAuth() {
  const { session, loading } = useSyncExternalStore(inscrever, obterEstado)

  const signIn = (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = () => supabase.auth.signOut()

  return { session, loading, signIn, signOut }
}
