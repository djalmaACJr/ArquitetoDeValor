import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // IMPORTANTE: não chame `signOut()` aqui quando `data.session` for
    // null. Cada componente que usa `useAuth` monta esse efeito e roda
    // `getSession()` em paralelo. Em race com `signIn()` em andamento
    // (clique no botão Entrar), o signOut "limpa" a sessão recém-criada
    // e o login parece falhar. Apenas reflete o estado atual.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session ?? null)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      setLoading(false)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  const signIn = (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = () => supabase.auth.signOut()

  return { session, loading, signIn, signOut }
}
