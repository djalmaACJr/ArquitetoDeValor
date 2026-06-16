import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoPosicao, StatusPosicaoInvestimento } from '../types'

export interface CriarPosicaoInput {
  ativo_id:    string
  conta_id:    string
  quantidade:  number
  preco_custo: number
  data_compra: string
  status?:     StatusPosicaoInvestimento
}

export type EditarPosicaoInput = Partial<CriarPosicaoInput>

export interface FiltrosPosicoes {
  ativo_id?: string
  conta_id?: string
  status?:   StatusPosicaoInvestimento
}

async function fetchPosicoes(filtros: FiltrosPosicoes): Promise<InvestimentoPosicao[]> {
  const params = new URLSearchParams()
  if (filtros.ativo_id) params.set('ativo_id', filtros.ativo_id)
  if (filtros.conta_id) params.set('conta_id', filtros.conta_id)
  if (filtros.status)   params.set('status', filtros.status)
  const qs  = params.toString()
  const res = await apiFetch<InvestimentoPosicao[]>(`/investimentos/posicoes${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar posições')
  return res.dados ?? []
}

export function useInvestimentosPosicoes(filtros: FiltrosPosicoes = {}) {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: posicoes = [], isLoading: loading, error } = useQuery({
    queryKey: qk.invPosicoes(uid, filtros),
    queryFn:  () => fetchPosicoes(filtros),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  // posições afetam o dashboard → invalida ambos
  const invalidar = async () => {
    await qc.invalidateQueries({ queryKey: qk.invPosicoesPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invDashboardPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invRankingPref(uid) })
  }

  const criar = async (payload: CriarPosicaoInput): Promise<OpResult<InvestimentoPosicao>> => {
    const res = await apiMutate<InvestimentoPosicao>('/investimentos/posicoes', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const editar = async (id: string, payload: EditarPosicaoInput): Promise<OpResult<InvestimentoPosicao>> => {
    const res = await apiMutate<InvestimentoPosicao>(`/investimentos/posicoes/${id}`, 'PUT', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/posicoes/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return {
    posicoes,
    loading,
    error: error ? (error as Error).message : null,
    criar,
    editar,
    excluir,
  }
}
