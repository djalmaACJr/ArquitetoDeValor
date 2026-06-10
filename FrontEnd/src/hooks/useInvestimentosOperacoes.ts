import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoOperacao, TipoOperacaoInvestimento } from '../types'

interface OpResult<T = void> { ok: boolean; dados: T | null; erro: string | null }

export interface CriarOperacaoInput {
  posicao_id:      string
  tipo_operacao:   TipoOperacaoInvestimento
  conta_id:        string
  quantidade:      number
  preco_unitario?: number
  valor_total?:    number
  data_operacao:   string
}

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

  const criar = async (payload: CriarOperacaoInput): Promise<OpResult<InvestimentoOperacao>> => {
    const res = await apiMutate<InvestimentoOperacao>('/investimentos/operacoes', 'POST', payload)
    if (res.ok) await qc.invalidateQueries({ queryKey: ['inv-operacoes', uid] })
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  return {
    operacoes,
    loading,
    error: error ? (error as Error).message : null,
    criar,
  }
}
