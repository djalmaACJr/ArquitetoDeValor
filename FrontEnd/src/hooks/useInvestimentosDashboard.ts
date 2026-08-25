import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type {
  InvestimentoDashboard, InvestimentoAlocacaoTipo, InvestimentoRanking, TipoAtivoInvestimento,
  PeriodoRanking,
} from '../types'

export async function fetchDashboard(contaId?: string | null): Promise<InvestimentoDashboard> {
  const params = new URLSearchParams()
  if (contaId) params.set('conta_id', contaId)
  const qs  = params.toString()
  const res = await apiFetch<InvestimentoDashboard>(`/investimentos/dashboard${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar dashboard')
  return res.dados ?? { total_custo: 0, total_mercado: 0, ganho_perda: 0, total_dividendos: 0, tipos: [] }
}

export interface TotalPorConta { conta_id: string; valor_custo: number; total_mercado: number }

// Total de mercado de TODAS as contas de investimento numa única requisição
// (agrupar=conta no backend) — usado pelo resumo "por instituição" no
// dashboard, que antes chamava fetchDashboard() uma vez POR conta só para
// ler total_mercado (N requisições HTTP + 4N queries no Postgres).
export async function fetchTotaisPorConta(): Promise<TotalPorConta[]> {
  const res = await apiFetch<{ totais_por_conta: TotalPorConta[] }>('/investimentos/dashboard?agrupar=conta')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar totais por conta')
  return res.dados?.totais_por_conta ?? []
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

// ── Ranking por ativo (em alta/prejuízo, yield, participação) ─

async function fetchRanking(contaId?: string | null): Promise<InvestimentoRanking> {
  const params = new URLSearchParams()
  if (contaId) params.set('conta_id', contaId)
  const qs  = params.toString()
  const res = await apiFetch<InvestimentoRanking>(`/investimentos/ranking${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar ranking')
  return res.dados ?? { total_mercado: 0, ativos: [] }
}

export function useInvestimentosRanking(contaId?: string | null) {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading: loading, error } = useQuery({
    queryKey: qk.invRanking(uid, contaId),
    queryFn:  () => fetchRanking(contaId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  return {
    ranking: data ?? null,
    loading,
    error: error ? (error as Error).message : null,
  }
}

// ── Destaques (ranking + filtro de período) ────────────────────
// Mesmo endpoint do ranking acima, com o filtro de período da página
// "Destaques" (Semana/Mês/Semestre/Ano/Período todo) — devolve a carteira
// INTEIRA (não só o top 3) + o ranking por categoria (Tipo de Ativo).

async function fetchDestaques(contaId: string | null | undefined, periodo: PeriodoRanking): Promise<InvestimentoRanking> {
  const params = new URLSearchParams()
  if (contaId) params.set('conta_id', contaId)
  params.set('periodo', periodo)
  const res = await apiFetch<InvestimentoRanking>(`/investimentos/ranking?${params.toString()}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar destaques')
  return res.dados ?? { total_mercado: 0, periodo, ativos: [], categorias: [] }
}

export function useInvestimentosDestaques(contaId: string | null | undefined, periodo: PeriodoRanking) {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading: loading, error } = useQuery({
    queryKey: qk.invDestaques(uid, contaId, periodo),
    queryFn:  () => fetchDestaques(contaId, periodo),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  return {
    destaques: data ?? null,
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
      await qc.invalidateQueries({ queryKey: qk.invAlocacoes(uid) })
      await qc.invalidateQueries({ queryKey: qk.invDashboardPref(uid) })
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
