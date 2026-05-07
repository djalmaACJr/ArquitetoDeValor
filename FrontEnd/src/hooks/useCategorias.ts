// src/hooks/useCategorias.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import type { Categoria } from '../types'

interface OpResult { ok: boolean; erro: string | null }

async function fetchCategorias(): Promise<Categoria[]> {
  const res = await apiFetch<Categoria[]>('/categorias')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar categorias')
  return res.dados ?? []
}

export function useCategorias() {
  const qc = useQueryClient()

  const { data: categorias = [], isLoading: loading, error } = useQuery({
    queryKey: qk.categorias(),
    queryFn:  fetchCategorias,
  })

  const carregar = async () => { await qc.invalidateQueries({ queryKey: qk.categorias() }) }

  const criar = async (payload: {
    descricao: string; id_pai?: string | null; icone?: string; cor?: string
  }): Promise<OpResult> => {
    const res = await apiMutate('/categorias', 'POST', payload)
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.categorias() })
    return { ok: res.ok, erro: res.erro }
  }

  const editar = async (id: string, payload: Partial<{
    descricao: string; id_pai: string | null; icone: string; cor: string; ativa: boolean
  }>): Promise<OpResult> => {
    const res = await apiMutate(`/categorias/${id}`, 'PUT', payload)
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.categorias() })
    return { ok: res.ok, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/categorias/${id}`, 'DELETE')
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.categorias() })
    return { ok: res.ok, erro: res.erro }
  }

  return {
    categorias,
    loading,
    error: error ? (error as Error).message : null,
    carregar,
    criar,
    editar,
    excluir,
  }
}
