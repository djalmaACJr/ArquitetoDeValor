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

async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Não autenticado')
  return session
}

function makeHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
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

// ── POST / PUT / DELETE ───────────────────────────────────────────────────────
export async function apiMutate<T = unknown>(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown
): Promise<ApiResult<T>> {
  try {
    const session = await getSession()
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: makeHeaders(session.access_token),
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
