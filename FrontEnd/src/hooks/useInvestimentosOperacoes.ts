import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoOperacao, TipoAtivoInvestimento, TipoOperacaoInvestimento } from '../types'

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
  // Só faz sentido junto de (ativo_id + conta_id), sem posicao_id: força a
  // criação de uma posição NOVA em vez de somar na ATIVA existente — usado
  // para registrar um novo "lote" (ex.: mesmo título comprado depois a uma
  // taxa diferente). rf_taxa é o rótulo opcional desse lote.
  novo_lote?:      boolean
  rf_taxa?:        string
}

export type EditarOperacaoInput = Partial<CriarOperacaoInput>

export interface FiltrosOperacoes {
  posicao_id?: string
  ativo_id?:   string
  tipo_ativo?: TipoAtivoInvestimento
  // Período (data_operacao), usado no Extrato — ignorado se ativo_id/
  // posicao_id também vierem junto de tipo_ativo (backend prioriza ativo_id).
  de?: string
  ate?: string
}

async function fetchOperacoes(filtros: FiltrosOperacoes): Promise<InvestimentoOperacao[]> {
  const params = new URLSearchParams()
  if (filtros.posicao_id) params.set('posicao_id', filtros.posicao_id)
  if (filtros.ativo_id)   params.set('ativo_id', filtros.ativo_id)
  if (filtros.tipo_ativo) params.set('tipo_ativo', filtros.tipo_ativo)
  if (filtros.de)         params.set('de', filtros.de)
  if (filtros.ate)        params.set('ate', filtros.ate)
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
