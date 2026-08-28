// src/lib/clientCache.ts
//
// Registry central de TODO o estado client-side que pode vazar entre
// usuários quando há logout + novo login na mesma aba/navegador:
//
//   - Variáveis module-level (`let _saved = ...`) em páginas com cache em
//     memória (AssinaturasPage, ComparativoMensalPage, ProjecaoEconomiaPage).
//   - Chaves de localStorage com PREFERÊNCIAS do usuário (tema, mascote,
//     ocultar valores, tutoriais vistos).
//
// O cache do React Query e a chave `arqv-lc` são limpos diretamente no
// listener de `supabase.auth.onAuthStateChange` em main.tsx.
//
// Antecedentes:
// Em 2026-05 descobrimos que após logout + login o usuário novo via
// dados financeiros do usuário anterior. Causa raiz: hidratação síncrona
// do cache do React Query + variáveis module-level guardando lançamentos
// não eram resetadas. Este módulo centraliza o reset.

type ResetFn = () => void

const resetCallbacks = new Set<ResetFn>()

/**
 * Registra uma função que zera estado in-memory específico de página.
 * Retorna uma função para desfazer o registro (útil em testes ou HMR).
 *
 * Convenção: a fn passa a variável module-level para `null`/array vazio.
 */
export function registrarResetCliente(fn: ResetFn): () => void {
  resetCallbacks.add(fn)
  return () => { resetCallbacks.delete(fn) }
}

/**
 * Chaves de localStorage a serem apagadas na troca de usuário.
 * Mantemos uma lista explícita para evitar apagar coisas alheias.
 *
 * `arqv-lc` (cache do React Query) é apagado direto no main.tsx; não
 * incluímos aqui para não duplicar.
 */
const LS_KEYS_USER_SCOPED = [
  'av-mascote',                    // mascote preferido (sync de arqvalor.usuarios)
  'av-theme',                      // tema (sync de arqvalor.usuarios.layout)
  'arqvalor:ocultar_valores',      // flag ocultar (sync de arqvalor.usuarios.ocultar_valores)
  'arqvalor:ultima-atividade',     // timestamp de auto-logout (useAutoLogout) — nunca herdar entre usuários
  'arqvalor:objetivos-sync-em',    // marca de última sincronização diária de progresso (useSincronizarObjetivosDiario)
  'arqvalor:biometria-recusada',   // "não perguntar de novo" sobre login por digital (LoginPage)
  'arqvalor:destaques-ordem-gerais',     // ordem arrastável dos 4 quadros gerais (DestaquesInvestimentosPage)
  'arqvalor:destaques-ordem-categorias', // ordem arrastável dos quadros "Por tipo de ativo" (idem)
  'arqvalor:chat-mascote-historico',     // LEGADO: histórico do chat mudou pra arqvalor.usuarios.chat_mascote_historico
                                          // (useChatMascote já limpa esta chave sozinho); mantida aqui só de rede de
                                          // segurança, caso algum resquício ainda exista no navegador de alguém.
] as const

// Chaves legadas que ainda podem existir no LS de versões anteriores.
// `tutoriais_vistos` agora vive em `arqvalor.usuarios` (JSONB), mas
// limpamos os resquícios antigos pra não ocupar quota.
const LS_PREFIXES_USER_SCOPED = [
  'av-tut-',   // av-tut-<pagina>-<mascote>=1  (legado)
  'av-tour-',  // av-tour-<pagina>-v1=1        (legado)
] as const

/**
 * Apaga TODO o estado client-side específico de usuário. Chamada pelo
 * listener de auth em main.tsx quando o usuário troca ou faz logout.
 */
export function limparEstadoCliente(): void {
  // 1) Variáveis module-level registradas pelas páginas
  resetCallbacks.forEach(fn => {
    try { fn() } catch { /* registro não pode quebrar o fluxo */ }
  })

  // 2) Chaves específicas de localStorage
  for (const k of LS_KEYS_USER_SCOPED) {
    localStorage.removeItem(k)
  }

  // 3) Chaves por prefixo (tutoriais)
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const key = localStorage.key(i)
    if (!key) continue
    if (LS_PREFIXES_USER_SCOPED.some(p => key.startsWith(p))) {
      localStorage.removeItem(key)
    }
  }
}
