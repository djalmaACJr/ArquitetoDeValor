import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!url || !key) {
  throw new Error('Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY são obrigatórias.')
}

// Sessão por ABA — `sessionStorage` em vez de `localStorage` (padrão).
//
// Por quê: este é um app financeiro pessoal. Com localStorage (padrão do
// supabase-js), fechar a aba MANTÉM a sessão; qualquer pessoa que abrir o
// navegador depois entra logada como o último usuário (não é vazamento de
// código, é como sessões persistentes funcionam — mas é arriscado em PC
// compartilhado).
//
// Com sessionStorage:
//   - Fechar a aba = perde a sessão; o próximo acesso pede login.
//   - F5 (reload) na mesma aba mantém a sessão.
//   - Cada aba tem sessão independente (abrir nova aba = pede login).
//
// Combinada com o `useAutoLogout` (inatividade), cobre os dois cenários
// principais de sessão "esquecida" aberta.
//
// EXCEÇÃO E2E: testes do Playwright dependem de `storageState`, que só
// persiste `cookies` + `localStorage` entre specs. Detectamos automatica-
// mente browsers controlados via `navigator.webdriver` (que Playwright,
// Selenium e WebDriver sempre setam como `true`) e voltamos a usar
// `localStorage`. Também aceita override por `VITE_E2E=true` (útil em
// debug local fora do Playwright).
const ehAutomatizado =
  typeof navigator !== 'undefined' && (navigator as Navigator).webdriver === true
const ehE2E = import.meta.env.VITE_E2E === 'true' || ehAutomatizado
const storageEscolhido: Storage | undefined =
  typeof window === 'undefined'
    ? undefined
    : (ehE2E ? window.localStorage : window.sessionStorage)

export const supabase = createClient(url, key, {
  auth: {
    storage:           storageEscolhido,
    persistSession:    true,    // dentro da aba — sobrevive a F5
    autoRefreshToken:  true,
    detectSessionInUrl: true,   // necessário para o fluxo de redefinir-senha
  },
})
