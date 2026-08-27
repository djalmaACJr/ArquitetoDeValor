// src/lib/api.ts
// Cliente HTTP centralizado.

import { supabase } from './supabase'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export interface ApiResult<T = unknown> {
  ok: boolean
  dados: T | null
  erro: string | null
  status: number
}

// Resultado enxuto de uma mutação (sem `status`), usado pelos hooks de
// domínio ao expor criar/editar/excluir para a UI. Centralizado aqui para
// não ser redefinido em cada hook.
export interface OpResult<T = void> {
  ok: boolean
  dados: T | null
  erro: string | null
}

// supabase-js serializa getSession()/refresh via Web Locks do navegador (uma
// trava por projeto, compartilhada entre abas no desktop — ver lib/supabase.ts).
// Uma trava "presa" (comum com várias abas abertas, ou um refresh que travou
// numa aba antiga) faz getSession() ficar pendurada para sempre — sem timeout,
// isso trava o app inteiro em silêncio: o botão fica "salvando..." e nenhum
// erro aparece, porque a Promise nunca resolve nem rejeita. O timeout garante
// que sempre sobra um erro visível (toast) em vez de um hang mudo.
function comTimeout<T>(p: Promise<T>, ms: number, msgTimeout: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msgTimeout)), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, (e) => { clearTimeout(t); reject(e) })
  })
}

async function getSession() {
  const { data: { session } } = await comTimeout(
    supabase.auth.getSession(), 10000,
    'Não foi possível confirmar a sessão (tempo esgotado) — feche outras abas do sistema abertas e recarregue a página.',
  )
  if (!session?.access_token) throw new Error('Não autenticado')
  return session
}

function makeHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    ...extra,
  }
}

// ── GET ───────────────────────────────────────────────────────────────────────
export async function apiFetch<T = unknown>(
  path: string,
  signal?: AbortSignal
): Promise<ApiResult<T>> {
  try {
    const session = await getSession()
    const res = await fetch(`${BASE}${path}`, {
      headers: makeHeaders(session.access_token),
      signal,
    })
    const data = await res.json().catch(() => ({}))
    return {
      ok:     res.ok,
      dados:  res.ok ? (data.dados ?? data) : null,
      erro:   res.ok ? null : (data.erro ?? `Erro ${res.status}`),
      status: res.status,
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return { ok: false, dados: null, erro: (e as Error).message, status: 0 }
  }
}

// ── POST / PUT / PATCH / DELETE ───────────────────────────────────────────────
export async function apiMutate<T = unknown>(
  path: string,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  body?: unknown,
  extraHeaders?: Record<string, string>
): Promise<ApiResult<T>> {
  try {
    const session = await getSession()
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: makeHeaders(session.access_token, extraHeaders),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({}))
    return {
      ok:     res.ok,
      dados:  res.ok ? (data.dados ?? data) : null,
      erro:   res.ok ? null : (data.erro ?? `Erro ${res.status}`),
      status: res.status,
    }
  } catch (e) {
    return { ok: false, dados: null, erro: (e as Error).message, status: 0 }
  }
}

// ── Helper: extrai array de dados do envelope da API ─────────────────────────
// A API retorna { dados: T[] } mas apiFetch já desembala um nível via data.dados ?? data.
// Em alguns hooks o retorno ainda vinha duplamente envelopado. Esta função
// resolve ambos os casos sem precisar de "as unknown as" no código chamador.
export function extrairLista<T>(raw: unknown): T[] {
  if (!raw) return []
  // Caso 1: { dados: T[] }  — envelope ainda presente
  if (typeof raw === 'object' && 'dados' in (raw as object)) {
    const env = (raw as { dados: unknown }).dados
    return Array.isArray(env) ? (env as T[]) : []
  }
  // Caso 2: T[]  — já é o array direto
  if (Array.isArray(raw)) return raw as T[]
  return []
}
