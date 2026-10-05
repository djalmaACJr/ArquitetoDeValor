import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Capacitor } from '@capacitor/core'
import { CapacitorUpdater } from '@capgo/capacitor-updater'
import App from './App'
import { supabase } from './lib/supabase'
import { limparEstadoCliente } from './lib/clientCache'
import { LS_ULTIMA_ATIVIDADE } from './hooks/useAutoLogout'
import { initEspacoAtivo } from './lib/espacoAtivo'
import './styles/globals.css'

// Confirma pro plugin de OTA (@capgo/capacitor-updater) que o bundle atual
// carregou com sucesso — sem isso, ele reverte pro bundle anterior por
// segurança (proteção contra publicar um update quebrado). Só existe efeito
// dentro do app nativo; no navegador normal isNativePlatform() é false.
if (Capacitor.isNativePlatform()) {
  CapacitorUpdater.notifyAppReady()
}

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
// true só até o 1º callback do listener abaixo (ver uso em onAuthStateChange).
let primeiroEventoAuth = true

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
    (event.query.queryKey as unknown[])[0] === 'transacoes-mes' &&
    event.query.state.status === 'success'
  ) {
    persistirCache()
  }
})

// ── Hidratação + limpeza em troca de usuário ────────────────────────────────
// O listener resolve a sessão real ANTES de hidratar — eliminando o vazamento.
supabase.auth.onAuthStateChange((event, session) => {
  const newUserId = session?.user?.id ?? null
  const ehPrimeiroEvento = primeiroEventoAuth
  primeiroEventoAuth = false

  // Seletor de espaço (ver lib/espacoAtivo.ts) — carrega o vínculo salvo
  // para ESTE uid (chave já namespaced por usuário, não precisa limpar em
  // troca de conta). Roda em todo evento pra já estar pronto antes do
  // primeiro fetch da sessão recém-logada.
  initEspacoAtivo(newUserId)

  // 1º callback: tenta hidratar (só funciona se o userId bate)
  if (!cacheHidratado) {
    tentarHidratar(newUserId)
  }

  // Login de verdade (1ª vez numa aba nova, ou re-login da MESMA conta após
  // sessão anterior morrer sem um SIGNED_OUT real — token expirado no
  // servidor, aba suspensa/fechada antes do auto-logout do cliente rodar até
  // o fim) zera o relógio de inatividade do useAutoLogout — sem isso, o
  // timestamp antigo (de horas atrás) sobrevivia e disparava o modal "Aba
  // inativa" na cara assim que o AppLayout montava pós-login (bug relatado:
  // aviso de aba parada logo após logar).
  //
  // EXCETO no 1º evento recebido por este listener na vida da aba: nesse
  // caso SIGNED_IN é a restauração automática da sessão já persistida (ao
  // abrir/recarregar a página com um refresh token ainda válido) — não um
  // login interativo de verdade. Achado real (E2E): o SDK do Supabase aqui
  // dispara SIGNED_IN em TODO carregamento com sessão restaurada, inclusive
  // antes do próprio INITIAL_SESSION — sem esta checagem, um simples F5 (ou
  // reabrir a aba) numa sessão esquecida havia horas também zerava o
  // relógio, destruindo exatamente a defesa que esta feature existe pra dar
  // ("sessão esquecida em PC compartilhado", ver CLAUDE.md): o check de
  // `persistida` vencida no mount do useAutoLogout encontrava o timestamp já
  // apagado e recomeçava a contagem do zero em vez de deslogar na hora.
  if (event === 'SIGNED_IN' && !ehPrimeiroEvento) {
    localStorage.removeItem(LS_ULTIMA_ATIVIDADE)
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
