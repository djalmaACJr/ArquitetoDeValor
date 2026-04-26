// src/hooks/useCategorias.ts
import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiMutate } from '../lib/api'
import type { Categoria } from '../types'

interface OpResult { ok: boolean; erro: string | null }

export function useCategorias() {
  const [categorias, setCategorias] = useState<Categoria[]>([])
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const carregar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null)
    try {
      const res = await apiFetch<Categoria[]>('/categorias', signal)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar categorias')
      setCategorias(res.dados ?? [])
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
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
    descricao: string; id_pai?: string | null; icone?: string; cor?: string
  }): Promise<OpResult> => {
    const res = await apiMutate('/categorias', 'POST', payload)
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro }
  }

  const editar = async (id: string, payload: Partial<{
    descricao: string; id_pai: string | null; icone: string; cor: string; ativa: boolean
  }>): Promise<OpResult> => {
    const res = await apiMutate(`/categorias/${id}`, 'PUT', payload)
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/categorias/${id}`, 'DELETE')
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro }
  }

  return { categorias, loading, error, carregar, criar, editar, excluir }
}
