// src/context/AuthContext.tsx
// Correção: usa apenas onAuthStateChange com INITIAL_SESSION para estado inicial,
// eliminando a race condition entre getSession() e onAuthStateChange() simultâneos.

import { createContext, useContext, useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Session } from '@supabase/supabase-js'

interface AuthContextType {
  session: Session | null
  loading: boolean
  signIn: (email: string, password: string) => ReturnType<typeof supabase.auth.signInWithPassword>
  signOut: () => ReturnType<typeof supabase.auth.signOut>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Usando apenas onAuthStateChange — o evento INITIAL_SESSION dispara
    // imediatamente com a sessão atual, eliminando a necessidade de
    // chamar getSession() separadamente e a race condition que isso causava.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s)
      // INITIAL_SESSION e todos os eventos subsequentes encerram o loading
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signIn = (email: string, password: string) =>
    supabase.auth.signInWithPassword({ email, password })

  const signOut = () => supabase.auth.signOut()

  return (
    <AuthContext.Provider value={{ session, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}
