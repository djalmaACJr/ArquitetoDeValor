import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoOperacao, TipoOperacaoInvestimento } from '../types'

export interface CriarOperacaoInput {
  // A operação mantém a posição: informe (ativo_id + conta_id) — a posição é
  // resolvida/criada no backend. posicao_id permanece aceito (compat).
  ativo_id?:       string
  conta_id:        string
  posicao_id?:     string
  tipo_operacao:   TipoOperacaoInvestimento
  quantidade:      number
  preco_unitario?: number
  valor_total?:    number
  data_operacao:   string
}

export type EditarOperacaoInput = Partial<CriarOperacaoInput>

export interface FiltrosOperacoes {
  posicao_id?: string
}

async function fetchOperacoes(filtros: FiltrosOperacoes): Promise<InvestimentoOperacao[]> {
  const params = new URLSearchParams()
  if (filtros.posicao_id) params.set('posicao_id', filtros.posicao_id)
  const qs  = params.toString()
  const res = await apiFetch<InvestimentoOperacao[]>(`/investimentos/operacoes${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar operações')
  return res.dados ?? []
}

export function useInvestimentosOperacoes(filtros: FiltrosOperacoes = {}) {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: operacoes = [], isLoading: loading, error } = useQuery({
    queryKey: qk.invOperacoes(uid, filtros),
    queryFn:  () => fetchOperacoes(filtros),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  // A operação agora altera a posição → invalida posições, dashboard, ranking
  // e histórico além das próprias operações.
  const invalidar = async () => {
    await qc.invalidateQueries({ queryKey: qk.invOperacoesPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invPosicoesPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invDashboardPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invRankingPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invHistoricoPref(uid) })
  }

  const criar = async (payload: CriarOperacaoInput): Promise<OpResult<InvestimentoOperacao>> => {
    const res = await apiMutate<InvestimentoOperacao>('/investimentos/operacoes', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const editar = async (opId: string, payload: EditarOperacaoInput): Promise<OpResult<InvestimentoOperacao>> => {
    const res = await apiMutate<InvestimentoOperacao>(`/investimentos/operacoes/${opId}`, 'PUT', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (opId: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/operacoes/${opId}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return {
    operacoes,
    loading,
    error: error ? (error as Error).message : null,
    criar,
    editar,
    excluir,
  }
}
