import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { supabase } from './lib/supabase'
import { limparEstadoCliente } from './lib/clientCache'
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
// Navegação entre meses é instantânea a partir da 2ª visita: ao confirmar
// que a sessão atual é do mesmo usuário que populou o cache, os dados do
// localStorage aparecem imediatamente e o React Query refaz o fetch em
// background pra atualizar.
//
// IMPORTANTE — vazamento entre usuários:
// O cache NÃO é hidratado de forma síncrona no boot. Antes, fazíamos
// `hydratarCache()` no carregamento do módulo, e o `onAuthStateChange`
// limpava depois, mas com uma janela de ~50-500ms em que o user que
// acabou de logar via dados do user anterior. Agora hidratamos APENAS
// dentro do listener de auth, e só se o userId do cache bater com o da
// sessão atual.
const LS_KEY     = 'arqv-lc'
const LS_MAX_AGE = 8 * 60 * 60 * 1000 // 8 horas

let currentUserId: string | null | undefined = undefined
let cacheHidratado = false

function tentarHidratar(userIdAtual: string | null) {
  if (cacheHidratado) return
  cacheHidratado = true
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) {
      // Mesmo sem cache do React Query, pode haver preferências (tema,
      // mascote, ocultar) deixadas por outro usuário — limpa pra garantir.
      if (userIdAtual) limparEstadoCliente()
      return
    }
    const parsed = JSON.parse(raw) as {
      data: Record<string, unknown>
      savedAt: number
      userId?: string | null
    }
    // Cache expirado, anônimo ou de OUTRO usuário → descarta sem hidratar
    if (Date.now() - parsed.savedAt > LS_MAX_AGE) {
      localStorage.removeItem(LS_KEY)
      if (userIdAtual) limparEstadoCliente()
      return
    }
    if (!userIdAtual || (parsed.userId ?? null) !== userIdAtual) {
      // Aba foi reaberta com sessão de OUTRO usuário (ou anônimo).
      // Limpa TUDO — não só o cache do React Query, mas também
      // preferências (tema, mascote, ocultar) e estado in-memory das
      // páginas que se registraram.
      localStorage.removeItem(LS_KEY)
      limparEstadoCliente()
      return
    }
    for (const [keyStr, value] of Object.entries(parsed.data)) {
      queryClient.setQueryData(JSON.parse(keyStr), value)
    }
    // Marca como stale — React Query refresca em background quando os
    // componentes se inscreverem, sem bloquear a exibição imediata.
    queryClient.invalidateQueries({ queryKey: ['transacoes-mes'] })
  } catch {
    localStorage.removeItem(LS_KEY)
  }
}

function persistirCache() {
  // Não persiste antes do INITIAL_SESSION resolver — evita gravar com userId errado
  if (currentUserId === undefined || currentUserId === null) return
  try {
    const data: Record<string, unknown> = {}
    queryClient.getQueryCache().getAll()
      .filter(q =>
        (q.queryKey as unknown[])[0] === 'transacoes-mes' &&
        q.state.status === 'success'
      )
      .forEach(q => { data[JSON.stringify(q.queryKey)] = q.state.data })
    if (Object.keys(data).length === 0) return
    localStorage.setItem(LS_KEY, JSON.stringify({ data, savedAt: Date.now(), userId: currentUserId }))
  } catch { /* quota exceeded — ignora silenciosamente */ }
}

queryClient.getQueryCache().subscribe(event => {
  if (
    event.type === 'updated' &&
    (event.query.queryKey as unknown[])[0] === 'lancamentos' &&
    event.query.state.status === 'success'
  ) {
    persistirCache()
  }
})

// ── Hidratação + limpeza em troca de usuário ────────────────────────────────
// O listener resolve a sessão real ANTES de hidratar — eliminando o vazamento.
supabase.auth.onAuthStateChange((_event, session) => {
  const newUserId = session?.user?.id ?? null

  // 1º callback: tenta hidratar (só funciona se o userId bate)
  if (!cacheHidratado) {
    tentarHidratar(newUserId)
  }

  // Troca de usuário durante a sessão (login em outra conta, logout): limpa
  // TODOS os caches client-side do usuário anterior. Sem isso já tivemos
  // vazamento de lançamentos entre sessões (usuário B via dados do A).
  //
  // cancelQueries() ANTES de clear() — sem isso, fetches já disparados com
  // o JWT antigo podem terminar DEPOIS do clear() e repopular o cache com
  // dados do usuário anterior (race janela de ~100-500ms entre signOut e o
  // signIn novo). cancelQueries marca os fetches como abortados; o cleanup
  // do React Query descarta o resultado quando ele chegar.
  if (currentUserId !== undefined && newUserId !== currentUserId) {
    queryClient.cancelQueries()
    queryClient.clear()
    localStorage.removeItem(LS_KEY)
    limparEstadoCliente()
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
