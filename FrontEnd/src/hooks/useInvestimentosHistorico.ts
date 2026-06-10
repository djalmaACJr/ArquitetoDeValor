import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoHistoricoMensal } from '../types'

interface OpResult<T = void> { ok: boolean; dados: T | null; erro: string | null }

export interface RegistrarHistoricoInput {
  ativo_id:      string
  conta_id:      string
  mes_ano:       string  // YYYY-MM
  valor_mercado: number
  // Omitidos → backend deriva das posições ATIVAS do ativo+conta
  quantidade?:   number
  preco_medio?:  number
}

export interface FiltrosHistorico {
  ativo_id?: string
  conta_id?: string
  mes_ano?:  string
  de?:       string
  ate?:      string
}

async function fetchHistorico(filtros: FiltrosHistorico): Promise<InvestimentoHistoricoMensal[]> {
  const params = new URLSearchParams()
  if (filtros.ativo_id) params.set('ativo_id', filtros.ativo_id)
  if (filtros.conta_id) params.set('conta_id', filtros.conta_id)
  if (filtros.mes_ano)  params.set('mes_ano', filtros.mes_ano)
  if (filtros.de)       params.set('de', filtros.de)
  if (filtros.ate)      params.set('ate', filtros.ate)
  const qs  = params.toString()
  const res = await apiFetch<InvestimentoHistoricoMensal[]>(`/investimentos/historico-mensal${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar histórico')
  return res.dados ?? []
}

export function useInvestimentosHistorico(filtros: FiltrosHistorico = {}) {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: historico = [], isLoading: loading, error } = useQuery({
    queryKey: qk.invHistorico(uid, filtros),
    queryFn:  () => fetchHistorico(filtros),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  // snapshots alimentam o valor de mercado do dashboard → invalida ambos
  const invalidar = async () => {
    await qc.invalidateQueries({ queryKey: ['inv-historico', uid] })
    await qc.invalidateQueries({ queryKey: ['inv-dashboard', uid] })
  }

  const registrar = async (payload: RegistrarHistoricoInput): Promise<OpResult<InvestimentoHistoricoMensal>> => {
    const res = await apiMutate<InvestimentoHistoricoMensal>('/investimentos/historico-mensal', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/historico-mensal/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return {
    historico,
    loading,
    error: error ? (error as Error).message : null,
    registrar,
    excluir,
  }
}
