import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type {
  InvestimentoAtivo, QuestionarioRespostas, TipoAtivoInvestimento,
  SubtipoRF, IndexadorRF, CategoriaFII,
} from '../types'

interface OpResult<T = void> { ok: boolean; dados: T | null; erro: string | null }

export interface CriarAtivoInput {
  ticker:        string
  nome:          string
  tipo_ativo:    TipoAtivoInvestimento
  moeda?:        string
  descricao?:    string | null
  nota_usuario?: number | null
  questionario_respostas?: QuestionarioRespostas | null
  ativo_pai?:    string | null
  // Renda fixa / Tesouro Direto
  rf_subtipo?:      SubtipoRF | null
  rf_indexador?:    IndexadorRF | null
  rf_taxa?:         string | null
  rf_emissor?:      string | null
  rf_vencimento?:   string | null
  rf_garantia_fgc?: boolean | null
  rf_isento_ir?:    boolean | null
  // FII
  fii_categoria?:   CategoriaFII | null
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

// ── Detalhe de um ativo (GET /investimentos/ativos/:id) ───────

export function useInvestimentoAtivo(id: string | null) {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading: loading, error } = useQuery({
    queryKey: qk.invAtivo(uid, id ?? ''),
    queryFn:  async () => {
      const res = await apiFetch<InvestimentoAtivo>(`/investimentos/ativos/${id}`)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar ativo')
      return res.dados
    },
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid && !!id,
  })

  return {
    ativo: data ?? null,
    loading,
    error: error ? (error as Error).message : null,
  }
}
