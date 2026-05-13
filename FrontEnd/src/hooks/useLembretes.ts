import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import type { Lembrete } from '../types'

export type { Lembrete }

interface OpResult { ok: boolean; erro: string | null }

async function fetchLembretes(filtros: { mes?: string }): Promise<Lembrete[]> {
  const params = new URLSearchParams()
  if (filtros.mes) params.set('mes', filtros.mes)
  const res = await apiFetch<Lembrete[]>(`/lembretes?${params}`)
  // Retorna vazio silenciosamente se endpoint não existe ainda (404)
  if (res.status === 404 || res.status === 0) return []
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar lembretes')
  return res.dados ?? []
}

export function useLembretes(filtros: { mes?: string; enabled?: boolean } = {}) {
  const qc = useQueryClient()
  const { enabled = true, ...filtroQuery } = filtros

  const { data: lembretes = [], isLoading: loading, error } = useQuery({
    queryKey: qk.lembretes(filtroQuery),
    queryFn:  () => fetchLembretes(filtroQuery),
    staleTime: 30_000,
    retry: false,
    enabled,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: ['lembretes'] })

  const criar = async (payload: {
    data: string
    descricao: string
    lancamento_id?: string | null
  }): Promise<OpResult> => {
    const res = await apiMutate('/lembretes', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, erro: res.erro }
  }

  const editar = async (
    id: string,
    payload: { data?: string; descricao?: string; status?: 'PENDENTE' | 'CONCLUIDO' }
  ): Promise<OpResult> => {
    const res = await apiMutate(`/lembretes/${id}`, 'PUT', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/lembretes/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, erro: res.erro }
  }

  return {
    lembretes,
    loading,
    error: error ? (error as Error).message : null,
    criar,
    editar,
    excluir,
  }
}
