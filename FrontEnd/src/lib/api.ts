// src/lib/api.ts
// Cliente HTTP centralizado — substitui headers() e getToken() duplicados em cada hook.
// Todos os hooks devem importar apiFetch/apiMutate daqui.

import { supabase } from './supabase'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

export interface ApiResult<T = unknown> {
  ok: boolean
  dados: T | null
  erro: string | null
  status: number
}

// ── Token: lido do contexto Supabase (sem nova roundtrip ao servidor) ──────────
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

// ── GET ────────────────────────────────────────────────────────────────────────
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
    if ((e as Error).name === 'AbortError') throw e  // propaga abort para o hook tratar
    return { ok: false, dados: null, erro: (e as Error).message, status: 0 }
  }
}

// ── POST / PUT / DELETE ────────────────────────────────────────────────────────
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
