import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoDividendo, TipoAtivoInvestimento } from '../types'

interface OpResult<T = void> { ok: boolean; dados: T | null; erro: string | null }

export interface CriarDividendoInput {
  ativo_id:          string
  conta_id:          string
  valor:             number
  data_pagamento:    string
  tipo_ativo:        TipoAtivoInvestimento
  tipo_dividendo_id: string
  descricao?:        string | null
}

export interface EditarDividendoInput {
  valor?:          number
  data_pagamento?: string
  descricao?:      string | null
  conta_id?:       string
}

export interface ConfirmarDividendoInput {
  valor?:          number
  data_pagamento?: string
}

// Associação inversa: vincula a um provento que já existe no extrato.
export interface AssociarDividendoInput {
  transacao_extrato_id: string
  ativo_id:             string
  tipo_dividendo_id?:   string | null
  descricao?:           string | null
}

export interface FiltrosDividendos {
  ativo_id?:   string
  tipo_ativo?: TipoAtivoInvestimento
}

async function fetchDividendos(filtros: FiltrosDividendos): Promise<InvestimentoDividendo[]> {
  const params = new URLSearchParams()
  if (filtros.ativo_id)   params.set('ativo_id', filtros.ativo_id)
  if (filtros.tipo_ativo) params.set('tipo_ativo', filtros.tipo_ativo)
  const qs  = params.toString()
  const res = await apiFetch<InvestimentoDividendo[]>(`/investimentos/dividendos${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar dividendos')
  return res.dados ?? []
}

export function useDividendos(filtros: FiltrosDividendos = {}) {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: dividendos = [], isLoading: loading, error } = useQuery({
    queryKey: qk.invDividendos(uid, filtros),
    queryFn:  () => fetchDividendos(filtros),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  // dividendos entram no extrato (Fase 5) e no dashboard → invalida tudo relacionado
  const invalidar = async () => {
    await qc.invalidateQueries({ queryKey: ['inv-dividendos', uid] })
    await qc.invalidateQueries({ queryKey: ['inv-dashboard', uid] })
    await qc.invalidateQueries({ queryKey: ['inv-ranking', uid] })
    await qc.invalidateQueries({ queryKey: ['transacoes-mes', uid] })
  }

  const criar = async (payload: CriarDividendoInput): Promise<OpResult<InvestimentoDividendo>> => {
    const res = await apiMutate<InvestimentoDividendo>('/investimentos/dividendos', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const editar = async (id: string, payload: EditarDividendoInput): Promise<OpResult<InvestimentoDividendo>> => {
    const res = await apiMutate<InvestimentoDividendo>(`/investimentos/dividendos/${id}`, 'PUT', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  // Vincula um provento já existente no extrato (não cria transação nova).
  const associar = async (payload: AssociarDividendoInput): Promise<OpResult<InvestimentoDividendo>> => {
    const res = await apiMutate<InvestimentoDividendo>('/investimentos/dividendos', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  // Reconcilia projeção: transação do extrato vira PAGO com valor/data reais
  const confirmar = async (id: string, payload: ConfirmarDividendoInput = {}): Promise<OpResult<InvestimentoDividendo>> => {
    const res = await apiMutate<InvestimentoDividendo>(`/investimentos/dividendos/${id}/confirmar`, 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/dividendos/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return {
    dividendos,
    loading,
    error: error ? (error as Error).message : null,
    criar,
    editar,
    associar,
    confirmar,
    excluir,
  }
}
