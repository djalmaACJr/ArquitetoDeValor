import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { supabase } from './lib/supabase'
import './styles/globals.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Domínio financeiro raramente muda fora da ação do usuário —
      // refetch em foco/reconexão é desnecessário e custoso (loga ruído na rede).
      // Mutations invalidam explicitamente o que precisa.
      refetchOnWindowFocus: false,
      refetchOnReconnect:   false,
      retry:                1,
      staleTime:            30_000, // 30s — dedup de fetch entre telas próximas
    },
  },
})

// ── Cache persistido em localStorage ─────────────────────────────────────────
// Navegação entre meses é instantânea a partir da 2ª visita (mesmo após
// refresh/login): os dados do localStorage aparecem imediatamente e o
// React Query refaz o fetch em background para atualizar.
const LS_KEY     = 'arqv-lc'
const LS_MAX_AGE = 8 * 60 * 60 * 1000 // 8 horas

// userId é carimbado no payload e usado para invalidar o cache quando
// o usuário trocar (login em outra conta na mesma aba/navegador).
let currentUserId: string | null | undefined = undefined
let cachedUserId:  string | null = null

function hydratarCache() {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as {
      data: Record<string, unknown>
      savedAt: number
      userId?: string | null
    }
    if (Date.now() - parsed.savedAt > LS_MAX_AGE) { localStorage.removeItem(LS_KEY); return }
    cachedUserId = parsed.userId ?? null
    for (const [keyStr, value] of Object.entries(parsed.data)) {
      queryClient.setQueryData(JSON.parse(keyStr), value)
    }
    // Marca como stale — React Query vai refrescar em background quando o
    // componente se inscrever, sem bloquear a exibição imediata do cache.
    queryClient.invalidateQueries({ queryKey: ['lancamentos'] })
  } catch {
    localStorage.removeItem(LS_KEY)
  }
}

function persistirCache() {
  // Não persiste antes do INITIAL_SESSION resolver — evita gravar com userId errado
  if (currentUserId === undefined) return
  try {
    const data: Record<string, unknown> = {}
    queryClient.getQueryCache().getAll()
      .filter(q =>
        (q.queryKey as unknown[])[0] === 'lancamentos' &&
        q.state.status === 'success'
      )
      .forEach(q => { data[JSON.stringify(q.queryKey)] = q.state.data })
    if (Object.keys(data).length === 0) return
    localStorage.setItem(LS_KEY, JSON.stringify({ data, savedAt: Date.now(), userId: currentUserId }))
  } catch { /* quota exceeded — ignora silenciosamente */ }
}

hydratarCache()

queryClient.getQueryCache().subscribe(event => {
  if (
    event.type === 'updated' &&
    (event.query.queryKey as unknown[])[0] === 'lancamentos' &&
    event.query.state.status === 'success'
  ) {
    persistirCache()
  }
})

// ── Limpeza de cache em troca de usuário ─────────────────────────────────────
// Sem isso, dados do usuário anterior (contas, categorias, lançamentos) ficam
// no cache do React Query e podem vazar para a próxima sessão (ex.: novo
// lançamento usando UUID de conta do outro usuário → RV-004 no backend).
supabase.auth.onAuthStateChange((_event, session) => {
  const newUserId = session?.user?.id ?? null
  const trocou = currentUserId === undefined
    ? cachedUserId !== null && cachedUserId !== newUserId
    : newUserId !== currentUserId
  if (trocou) {
    queryClient.clear()
    localStorage.removeItem(LS_KEY)
  }
  currentUserId = newUserId
})
// ─────────────────────────────────────────────────────────────────────────────

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App/>
    </QueryClientProvider>
  </React.StrictMode>
)
