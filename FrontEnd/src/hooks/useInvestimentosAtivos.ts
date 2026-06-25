import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type {
  InvestimentoAtivo, QuestionarioRespostas, TipoAtivoInvestimento,
  SubtipoRF, IndexadorRF, IndiceRF, CategoriaFII, AcoesSubtipo,
} from '../types'

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
  rf_indice?:            IndiceRF | null
  rf_percentual_indice?: number | null
  rf_taxa_fixa?:         number | null
  rf_taxa?:         string | null
  rf_emissor?:      string | null
  rf_vencimento?:   string | null
  rf_garantia_fgc?: boolean | null
  rf_isento_ir?:    boolean | null
  // FII
  fii_categoria?:   CategoriaFII | null
  // Ações
  acoes_subtipo?:   AcoesSubtipo | null
  // Cripto — rendimento (yield) anual em % a.a. (gera operações RENDIMENTO)
  cripto_rendimento_aa?: number | null
  cripto_rendimento_inicio?: string | null
  cripto_rendimento_periodicidade?: 'DIARIA' | 'SEMANAL' | 'MENSAL' | null
  // Quando false, o ativo é pulado pela busca automática de cotação
  cotacao_automatica?: boolean
}

export type EditarAtivoInput = Partial<CriarAtivoInput>

export interface AtualizarAtivosResultado {
  processados: number
  atualizados: number
  ativos: { ticker: string; nome: string }[]
}

export interface NormalizarTesouroResultado {
  processados: number
  renomeados: number
  ativos: { de: string; para: string }[]
  ignorados: { ticker: string; motivo: string }[]
}

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

  const invalidar = () => qc.invalidateQueries({ queryKey: qk.invAtivosPref(uid) })

  const criar = async (payload: CriarAtivoInput): Promise<OpResult<InvestimentoAtivo>> => {
    const res = await apiMutate<InvestimentoAtivo>('/investimentos/ativos', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const editar = async (id: string, payload: EditarAtivoInput): Promise<OpResult<InvestimentoAtivo>> => {
    const res = await apiMutate<InvestimentoAtivo>(`/investimentos/ativos/${id}`, 'PUT', payload)
    if (res.ok) {
      // Editar pode mudar tipo_ativo/nome — o que reflete nos dividendos
      // (tipo_ativo é desnormalizado e sincronizado no banco por trigger),
      // no dashboard e no ranking. Invalida o módulo todo, não só os ativos.
      for (const k of ['inv-ativos', 'inv-posicoes', 'inv-dividendos', 'inv-historico', 'inv-dashboard', 'inv-ranking']) {
        await qc.invalidateQueries({ queryKey: [k, uid] })
      }
    }
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const atualizarAtivos = async (): Promise<OpResult<AtualizarAtivosResultado>> => {
    const res = await apiMutate<AtualizarAtivosResultado>('/investimentos/atualizar-ativos', 'POST', {})
    if (res.ok) {
      // Nome/moeda podem ter mudado — invalida o que exibe ativos.
      for (const k of ['inv-ativos', 'inv-posicoes', 'inv-dividendos', 'inv-historico', 'inv-dashboard', 'inv-ranking']) {
        await qc.invalidateQueries({ queryKey: [k, uid] })
      }
    }
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const normalizarTesouro = async (): Promise<OpResult<NormalizarTesouroResultado>> => {
    const res = await apiMutate<NormalizarTesouroResultado>('/investimentos/normalizar-tesouro', 'POST', {})
    if (res.ok) {
      // Ticker/nome mudam → reflete em tudo que exibe o ativo.
      for (const k of ['inv-ativos', 'inv-posicoes', 'inv-dividendos', 'inv-historico', 'inv-dashboard', 'inv-ranking']) {
        await qc.invalidateQueries({ queryKey: [k, uid] })
      }
    }
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/ativos/${id}`, 'DELETE')
    if (res.ok) {
      // A exclusão cascateia para posições/operações/dividendos/histórico —
      // invalida todos os caches do módulo de investimentos.
      for (const k of ['inv-ativos', 'inv-posicoes', 'inv-operacoes', 'inv-dividendos', 'inv-historico', 'inv-dashboard', 'inv-ranking']) {
        await qc.invalidateQueries({ queryKey: [k, uid] })
      }
    }
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  // Materializa o rendimento (yield) das criptos como operações RENDIMENTO
  // (mais tokens). Aumenta a quantidade → reflete em posições/histórico/ranking.
  const provisionarRendimentoCripto = async (): Promise<OpResult<RendimentoCriptoResultado>> => {
    const res = await apiMutate<RendimentoCriptoResultado>('/investimentos/rendimento-cripto', 'POST', {})
    if (res.ok) {
      for (const k of ['inv-ativos', 'inv-posicoes', 'inv-operacoes', 'inv-historico', 'inv-dashboard', 'inv-ranking']) {
        await qc.invalidateQueries({ queryKey: [k, uid] })
      }
    }
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  return {
    ativos,
    loading,
    error: error ? (error as Error).message : null,
    criar,
    editar,
    excluir,
    atualizarAtivos,
    normalizarTesouro,
    provisionarRendimentoCripto,
  }
}

export interface RendimentoCriptoResultado {
  posicoes: number
  operacoes_criadas: number
  operacoes_atualizadas: number
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

// ── Busca externa de ticker (brapi / Tesouro Direto) ──────────
// Vale para todos os tipos; para RENDA_FIXA cobre só papéis listados
// na B3 (CDB/LCI/LCA são privados) — o formulário oferece fallback manual.

export function useBuscaAtivoExterno(tipo: TipoAtivoInvestimento, q: string) {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const termo = q.trim()

  const { data, isFetching: buscando, error } = useQuery({
    queryKey: ['inv-busca-externa', uid, tipo, termo],
    queryFn:  async () => {
      const res = await apiFetch<import('../types').ResultadoBuscaAtivo[]>(
        `/investimentos/busca-externa?tipo=${tipo}&q=${encodeURIComponent(termo)}`,
      )
      if (!res.ok) throw new Error(res.erro ?? 'Erro na busca')
      return res.dados ?? []
    },
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: !!uid && termo.length >= 2,
  })

  return {
    resultados: data ?? [],
    buscando,
    erroBusca: error ? (error as Error).message : null,
  }
}
