import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoDashboard, InvestimentoAlocacaoTipo, TipoAtivoInvestimento } from '../types'

interface OpResult<T = void> { ok: boolean; dados: T | null; erro: string | null }

async function fetchDashboard(contaId?: string | null): Promise<InvestimentoDashboard> {
  const params = new URLSearchParams()
  if (contaId) params.set('conta_id', contaId)
  const qs  = params.toString()
  const res = await apiFetch<InvestimentoDashboard>(`/investimentos/dashboard${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar dashboard')
  return res.dados ?? { total_custo: 0, total_mercado: 0, ganho_perda: 0, total_dividendos: 0, tipos: [] }
}

export function useInvestimentosDashboard(contaId?: string | null) {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading: loading, error } = useQuery({
    queryKey: qk.invDashboard(uid, contaId),
    queryFn:  () => fetchDashboard(contaId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  return {
    dashboard: data ?? null,
    loading,
    error: error ? (error as Error).message : null,
  }
}

// ── Alocação ideal por tipo ───────────────────────────────────

async function fetchAlocacoes(): Promise<InvestimentoAlocacaoTipo[]> {
  const res = await apiFetch<InvestimentoAlocacaoTipo[]>('/investimentos/alocacoes')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar alocações')
  return res.dados ?? []
}

export interface AlocacaoInput {
  tipo_ativo:       TipoAtivoInvestimento
  percentual_ideal: number
}

export function useInvestimentosAlocacao() {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: alocacoes = [], isLoading: loading, error } = useQuery({
    queryKey: qk.invAlocacoes(uid),
    queryFn:  fetchAlocacoes,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  // a soma dos percentuais deve ser 100% (validado também no backend)
  const salvar = async (itens: AlocacaoInput[]): Promise<OpResult<InvestimentoAlocacaoTipo[]>> => {
    const res = await apiMutate<InvestimentoAlocacaoTipo[]>('/investimentos/alocacoes', 'PUT', { alocacoes: itens })
    if (res.ok) {
      await qc.invalidateQueries({ queryKey: ['inv-alocacoes', uid] })
      await qc.invalidateQueries({ queryKey: ['inv-dashboard', uid] })
    }
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  return {
    alocacoes,
    loading,
    error: error ? (error as Error).message : null,
    salvar,
  }
}
