import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoAtivo, TipoAtivoInvestimento } from '../types'

interface OpResult<T = void> { ok: boolean; dados: T | null; erro: string | null }

export interface CriarAtivoInput {
  ticker:        string
  nome:          string
  tipo_ativo:    TipoAtivoInvestimento
  moeda?:        string
  descricao?:    string | null
  nota_usuario?: number | null
  ativo_pai?:    string | null
}

export type EditarAtivoInput = Partial<CriarAtivoInput>

export interface FiltrosAtivos {
  tipo?: TipoAtivoInvestimento
}

async function fetchAtivos(filtros: FiltrosAtivos): Promise<InvestimentoAtivo[]> {
  const params = new URLSearchParams()
  if (filtros.tipo) params.set('tipo', filtros.tipo)
  const qs  = params.toString()
  const res = await apiFetch<InvestimentoAtivo[]>(`/investimentos/ativos${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar ativos')
  return res.dados ?? []
}

export function useInvestimentosAtivos(filtros: FiltrosAtivos = {}) {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: ativos = [], isLoading: loading, error } = useQuery({
    queryKey: qk.invAtivos(uid, filtros),
    queryFn:  () => fetchAtivos(filtros),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: ['inv-ativos', uid] })

  const criar = async (payload: CriarAtivoInput): Promise<OpResult<InvestimentoAtivo>> => {
    const res = await apiMutate<InvestimentoAtivo>('/investimentos/ativos', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const editar = async (id: string, payload: EditarAtivoInput): Promise<OpResult<InvestimentoAtivo>> => {
    const res = await apiMutate<InvestimentoAtivo>(`/investimentos/ativos/${id}`, 'PUT', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/ativos/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return {
    ativos,
    loading,
    error: error ? (error as Error).message : null,
    criar,
    editar,
    excluir,
  }
}
