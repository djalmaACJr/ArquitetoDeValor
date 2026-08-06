import { createClient } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  throw new Error('Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias.')
}

// Sessão COMPARTILHADA entre abas no desktop (localStorage), mas VOLÁTIL no
// app nativo (sessionStorage).
//
// No Android/Capacitor, queremos que "fechar o app" (matar processo) deslogue
// o usuário por segurança. No desktop, priorizamos a conveniência de abrir
// links em nova aba (middle-click) sem pedir login de novo.
const storageEscolhido: Storage | undefined =
  typeof window === 'undefined'
    ? undefined
    : (Capacitor.isNativePlatform() ? window.sessionStorage : window.localStorage)

export const supabase = createClient(url, key, {
  auth: {
    storage:           storageEscolhido,
    persistSession:    true,    // dentro da aba — sobrevive a F5
    autoRefreshToken:  true,
    detectSessionInUrl: true,   // necessário para o fluxo de redefinir-senha
  },
})
