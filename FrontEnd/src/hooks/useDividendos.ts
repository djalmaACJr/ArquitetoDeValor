import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoDividendo, TipoAtivoInvestimento } from '../types'

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
    await qc.invalidateQueries({ queryKey: qk.invDividendosPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invDashboardPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invRankingPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.transacoesMesPref(uid) })
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
  // `skipInvalidar` permite associar em lote sem disparar refetch a cada item;
  // nesse caso o chamador deve invocar `invalidar()` uma única vez ao final.
  const associar = async (
    payload: AssociarDividendoInput,
    opts: { skipInvalidar?: boolean } = {},
  ): Promise<OpResult<InvestimentoDividendo>> => {
    const res = await apiMutate<InvestimentoDividendo>('/investimentos/dividendos', 'POST', payload)
    if (res.ok && !opts.skipInvalidar) await invalidar()
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

  // Dispara a busca de proventos BRL (B3) só para o usuário logado — mesma
  // rotina do cron, mas autenticada (não precisa do CRON_SECRET).
  const buscarBrl = async (): Promise<OpResult<ResultadoBuscaProventos>> => {
    const res = await apiMutate<ResultadoBuscaProventos>('/investimentos/dividendos-buscar-br', 'POST')
    if (res.ok) {
      await invalidar()
      await qc.invalidateQueries({ queryKey: qk.invAvisosDividendos(uid) })
      await qc.invalidateQueries({ queryKey: qk.invNovidadesProventos(uid) })
    }
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  // Idem para ativos internacionais em USD (Polygon) — sem ativos USD a rota
  // devolve zeros sem exigir a POLYGON_API_KEY.
  const buscarUsd = async (): Promise<OpResult<ResultadoBuscaProventos>> => {
    const res = await apiMutate<ResultadoBuscaProventos>('/investimentos/dividendos-buscar-usd', 'POST')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  // Preenche o dividendo-por-cota (rate) dos proventos antigos re-buscando da
  // B3. É o que destrava DY/Yield on Cost no padrão investidor10 no histórico.
  const backfillRate = async (): Promise<OpResult<ResultadoBackfillRate>> => {
    const res = await apiMutate<ResultadoBackfillRate>('/investimentos/dividendos-backfill-rate', 'POST')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  // Diagnóstico DRY-RUN da busca de proventos: testa cada elo (posição,
  // fonte, HTTP, janela, tipos mapeados) sem lançar nada.
  const diagnostico = async (): Promise<OpResult<DiagnosticoProventos>> => {
    const res = await apiFetch<DiagnosticoProventos>('/investimentos/dividendos-diagnostico')
    return { ok: res.ok, dados: res.dados ?? null, erro: res.erro }
  }

  // Vincula em lote proventos já no extrato (RECEITA em categoria de
  // investimento) que estão sem inv_dividendos — ex.: projeções de FII na mão.
  const associarMassa = async (): Promise<OpResult<ResultadoAssociarMassa>> => {
    const res = await apiMutate<ResultadoAssociarMassa>('/investimentos/associar-extrato-massa', 'POST')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
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
    buscarBrl,
    buscarUsd,
    diagnostico,
    backfillRate,
    associarMassa,
    invalidar,
  }
}

export interface ResultadoBackfillRate {
  processados: number
  preenchidos: number
  sem_fonte:   number
  ambiguos:    number
}

export interface ResultadoAssociarMassa {
  associados:     number
  sem_ativo:      number
  ja_vinculados:  number
}

export interface DiagnosticoProventosAtivo {
  ticker:          string
  tipo_ativo:      string
  moeda:           string
  posicao_ativa:   boolean
  fonte:           'B3' | 'Polygon' | null
  http:            number | null
  erro:            string | null
  proventos_fonte: number
  na_janela:       number
  futuros:         number
  tipos_pendentes: string[]
}

export interface DiagnosticoProventos {
  hoje:        string
  janela_dias: number
  data_corte:  string
  ptax_ultima: string | null
  polygon_key: boolean
  tipos:       { nome: string; mapeado: boolean }[]
  ativos:      DiagnosticoProventosAtivo[]
}

export interface ResultadoBuscaProventos {
  processados: number
  criados:     number
  atualizados: number
  pulados:     number
  // Ativos cuja fonte externa (B3/Polygon) não respondeu nesta execução —
  // permite diferenciar "sem provento novo" de "a fonte falhou".
  falhas_fonte?: number
  fontes_falha?: string[]
  // Falhas ao gravar no banco (ex.: migration não aplicada)
  erros?:        number
  erro_exemplo?: string | null
}
