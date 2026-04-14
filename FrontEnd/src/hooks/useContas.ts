// src/hooks/useContas.ts
import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiMutate } from '../lib/api'
import type { Conta, TipoConta } from '../types'

interface OpResult { ok: boolean; erro: string | null }

export function useContas() {
  const [contas,  setContas]  = useState<Conta[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const carregar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<Conta[]>('/contas', signal)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar contas')
      setContas(res.dados ?? [])
    } catch (e) {
      if ((e as Error).name === 'AbortError') return  // componente desmontado — ignora
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    carregar(controller.signal)
    return () => controller.abort()
  }, [carregar])

  const criar = async (payload: {
    nome: string; tipo: TipoConta; saldo_inicial?: number
    icone?: string; cor?: string
  }): Promise<OpResult> => {
    const res = await apiMutate('/contas', 'POST', payload)
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro }
  }

  const editar = async (id: string, payload: Partial<{
    nome: string; tipo: TipoConta; saldo_inicial: number
    icone: string; cor: string; ativa: boolean
  }>): Promise<OpResult> => {
    const res = await apiMutate(`/contas/${id}`, 'PUT', payload)
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/contas/${id}`, 'DELETE')
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro }
  }

  return { contas, loading, error, carregar, criar, editar, excluir }
}
