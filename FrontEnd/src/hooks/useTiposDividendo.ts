import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoTipoDividendo } from '../types'

interface OpResult<T = void> { ok: boolean; dados: T | null; erro: string | null }

export interface CriarTipoDividendoInput {
  nome:          string
  categoria_id?: string | null
}

export interface EditarTipoDividendoInput {
  nome?:         string
  categoria_id?: string | null
  ativo?:        boolean
}

async function fetchTipos(): Promise<InvestimentoTipoDividendo[]> {
  const res = await apiFetch<InvestimentoTipoDividendo[]>('/investimentos/tipos-dividendo')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar tipos de dividendo')
  return res.dados ?? []
}

export function useTiposDividendo() {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: tipos = [], isLoading: loading, error } = useQuery({
    queryKey: qk.invTiposDividendo(uid),
    queryFn:  fetchTipos,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: ['inv-tipos-dividendo', uid] })

  const criar = async (payload: CriarTipoDividendoInput): Promise<OpResult<InvestimentoTipoDividendo>> => {
    const res = await apiMutate<InvestimentoTipoDividendo>('/investimentos/tipos-dividendo', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const editar = async (id: string, payload: EditarTipoDividendoInput): Promise<OpResult<InvestimentoTipoDividendo>> => {
    const res = await apiMutate<InvestimentoTipoDividendo>(`/investimentos/tipos-dividendo/${id}`, 'PUT', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/tipos-dividendo/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return {
    tipos,
    loading,
    error: error ? (error as Error).message : null,
    criar,
    editar,
    excluir,
  }
}
