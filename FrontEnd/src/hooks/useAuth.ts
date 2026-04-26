import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      // Se houver erro ou sessão expirada/inválida, limpa e redireciona para login
      if (error || !data.session) {
        supabase.auth.signOut()
        setSession(null)
      } else {
        setSession(data.session)
      }
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
