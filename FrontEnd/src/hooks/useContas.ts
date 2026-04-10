import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Conta, TipoConta } from '../types'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

function headers(token: string) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  }
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Não autenticado')
  return session.access_token
}

export function useContas() {
  const [contas, setContas]   = useState<Conta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const token = await getToken()
      const res   = await fetch(`${BASE}/contas`, { headers: headers(token) })
      const data  = await res.json()
      if (!res.ok) throw new Error(data?.erro ?? 'Erro ao carregar contas')
      setContas(data.dados ?? [])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  const criar = async (payload: {
    nome: string; tipo: TipoConta; saldo_inicial?: number
    icone?: string; cor?: string
  }): Promise<{ ok: boolean; erro: string | null }> => {
    try {
      const token = await getToken()
      const res   = await fetch(`${BASE}/contas`, {
        method: 'POST',
        headers: headers(token),
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) await carregar()
      return { ok: res.ok, erro: data?.erro ?? null }
    } catch (e) {
      return { ok: false, erro: (e as Error).message }
    }
  }

  const editar = async (id: string, payload: Partial<{
    nome: string; tipo: TipoConta; saldo_inicial: number
    icone: string; cor: string; ativa: boolean
  }>): Promise<{ ok: boolean; erro: string | null }> => {
    try {
      const token = await getToken()
      const res   = await fetch(`${BASE}/contas/${id}`, {
        method: 'PUT',
        headers: headers(token),
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) await carregar()
      return { ok: res.ok, erro: data?.erro ?? null }
    } catch (e) {
      return { ok: false, erro: (e as Error).message }
    }
  }

  const excluir = async (id: string): Promise<{ ok: boolean; erro: string | null }> => {
    try {
      const token = await getToken()
      const res   = await fetch(`${BASE}/contas/${id}`, {
        method: 'DELETE',
        headers: headers(token),
      })
      const data = await res.json()
      if (res.ok) await carregar()
      return { ok: res.ok, erro: data?.erro ?? null }
    } catch (e) {
      return { ok: false, erro: (e as Error).message }
    }
  }

  return { contas, loading, error, carregar, criar, editar, excluir }
}
