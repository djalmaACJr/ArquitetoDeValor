// src/lib/retornoPosExpiracao.ts
//
// Quando o auto-logout por inatividade derruba a sessão, o usuário não
// deve perder o contexto de trabalho: guardamos a ROTA atual e os
// FILTROS das páginas em sessionStorage e restauramos no próximo login
// — somente se for o MESMO usuário, na MESMA aba.
//
// Por que sessionStorage:
//   - morre quando a aba fecha (mesmo perfil de segurança da sessão
//     Supabase do app — proteção de PC compartilhado);
//   - sobrevive ao remount do React (logout → /login → login).
//
// O snapshot carrega o userId: se outra pessoa logar na mesma aba, o
// snapshot não bate e é descartado sem restaurar nada.

const KEY_ROTA    = 'av-retorno-rota'
const KEY_FILTROS = 'av-retorno-filtros'
// sessionStorage já morre com a aba; o TTL é só higiene contra abas
// esquecidas abertas por muito tempo.
const MAX_AGE_MS  = 12 * 60 * 60 * 1000

interface Snapshot<T> {
  userId:  string
  valor:   T
  savedAt: number
}

function salvar<T>(key: string, userId: string, valor: T): void {
  try {
    const snap: Snapshot<T> = { userId, valor, savedAt: Date.now() }
    sessionStorage.setItem(key, JSON.stringify(snap))
  } catch { /* quota/SSR — restaurar é melhoria, não pode quebrar o logout */ }
}

// Lê e CONSOME (remove) o snapshot se pertencer ao usuário informado.
// Snapshot de outro usuário é preservado (pode ser o dono relogando em
// seguida); snapshot expirado é descartado.
function consumir<T>(key: string, userId: string | null): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const snap = JSON.parse(raw) as Snapshot<T>
    if (Date.now() - snap.savedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(key)
      return null
    }
    if (!userId || snap.userId !== userId) return null
    sessionStorage.removeItem(key)
    return snap.valor
  } catch {
    sessionStorage.removeItem(key)
    return null
  }
}

export function salvarRetornoPosExpiracao(
  userId: string, rota: string, filtros: unknown,
): void {
  // Não faz sentido "voltar" para telas públicas
  if (rota.startsWith('/login') || rota.startsWith('/cadastro')) return
  salvar(KEY_ROTA, userId, rota)
  salvar(KEY_FILTROS, userId, filtros)
}

export function consumirRotaPosExpiracao(userId: string | null): string | null {
  return consumir<string>(KEY_ROTA, userId)
}

export function consumirFiltrosPosExpiracao<T>(userId: string | null): T | null {
  return consumir<T>(KEY_FILTROS, userId)
}
