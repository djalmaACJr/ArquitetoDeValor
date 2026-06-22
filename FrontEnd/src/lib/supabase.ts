import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  throw new Error('Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias.')
}

// Sessão COMPARTILHADA entre abas — `localStorage` (padrão do supabase-js).
//
// Decisão (jun/2026): priorizar a conveniência de abrir links em nova aba.
// Com `localStorage` a sessão é compartilhada entre todas as abas e sobrevive
// ao fechar a aba — então middle-click / "abrir em nova aba" NÃO pede login de
// novo e já cai na página pretendida.
//
// Tradeoff: perde-se a proteção "fechar a aba = desloga" do `sessionStorage`.
// Quem abrir o navegador depois entra logado como o último usuário. A defesa
// contra sessão "esquecida" passa a depender de:
//   - `useAutoLogout` (15min de inatividade no client) — montado em AppLayout;
//   - Inactivity timeout do Supabase (server-side) — config no Dashboard.
//
// (E2E/Playwright já dependia de `localStorage` via `storageState`; agora é o
// padrão para todos, sem precisar detectar `navigator.webdriver`.)
const storageEscolhido: Storage | undefined =
  typeof window === 'undefined' ? undefined : window.localStorage

export const supabase = createClient(url, key, {
  auth: {
    storage:           storageEscolhido,
    persistSession:    true,    // dentro da aba — sobrevive a F5
    autoRefreshToken:  true,
    detectSessionInUrl: true,   // necessário para o fluxo de redefinir-senha
  },
})
