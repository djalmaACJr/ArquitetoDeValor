import { useState } from 'react'
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvestimentoHistoricoMensal } from '../types'

export interface ResumoSnapshotAuto {
  mes_ano:     string
  atualizados: number
  ignorados:   { ticker: string; motivo: string }[]
}

export interface ResumoBackfill {
  ate:                string
  meses_gravados:     number
  ativos_processados: number
  ignorados:          { ticker: string; motivo: string }[]
  diagnostico?:       Record<string, unknown>[]
}

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

  // placeholderData: mantém o histórico anterior visível ao trocar de conta
  // (chave muda) em vez de zerar a tela por um instante — mesmo motivo do
  // keepPreviousData em useInvestimentosDestaques.
  const { data: historico = [], isLoading: loading, error } = useQuery({
    queryKey: qk.invHistorico(uid, filtros),
    queryFn:  () => fetchHistorico(filtros),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
    placeholderData: keepPreviousData,
  })

  // snapshots alimentam o valor de mercado do dashboard → invalida ambos
  const invalidar = async () => {
    await qc.invalidateQueries({ queryKey: qk.invHistoricoPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invDashboardPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invRankingPref(uid) })
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

// ── Captura automática do valor de mercado do mês corrente ──────
// Busca a cotação atual de cada posição ativa (ações/FII/ETF/cripto),
// calcula a renda fixa pelo indexador e grava o snapshot do mês.
export function useAtualizarValoresMes() {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const [executando, setExecutando] = useState(false)

  const atualizar = async (mesAno?: string): Promise<OpResult<ResumoSnapshotAuto>> => {
    setExecutando(true)
    const res = await apiMutate<ResumoSnapshotAuto>(
      '/investimentos/snapshot-auto', 'POST', mesAno ? { mes_ano: mesAno } : {},
    )
    if (res.ok) {
      await qc.invalidateQueries({ queryKey: qk.invHistoricoPref(uid) })
      await qc.invalidateQueries({ queryKey: qk.invDashboardPref(uid) })
      await qc.invalidateQueries({ queryKey: qk.invRankingPref(uid) })
    }
    setExecutando(false)
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  return { atualizar, executando }
}

// ── Backfill do histórico (itens antigos/importados) ────────────
// Varre de cada compra até hoje e preenche os meses sem snapshot,
// buscando a série histórica de cotação (cotados/cripto) e calculando
// a renda fixa pelo indexador. Não sobrescreve meses já registrados.
export function useBackfillHistorico() {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const [executando, setExecutando] = useState(false)

  const invalidar = async () => {
    await qc.invalidateQueries({ queryKey: qk.invHistoricoPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invDashboardPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invRankingPref(uid) })
  }

  const preencher = async (opts: { conta_id?: string; ativo_id?: string; ate?: string } = {}): Promise<OpResult<ResumoBackfill>> => {
    setExecutando(true)
    const res = await apiMutate<ResumoBackfill>('/investimentos/snapshot-backfill', 'POST', opts)
    if (res.ok) await invalidar()
    setExecutando(false)
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  // Backfill da carteira INTEIRA, um ativo por chamada. Cobrir todos os ativos
  // numa única invocação estoura o limite de recursos da Edge Function (HTTP
  // 546 / WORKER_LIMIT) quando há muitos ativos — cada um faz várias buscas
  // externas (Yahoo/brapi/CoinGecko/PTAX). Fatiar por ativo mantia cada
  // invocação leve; o cache de cotações e a PTAX já sincronizada são
  // reaproveitados entre as chamadas. `onProgress` permite logar o avanço.
  const preencherTodos = async (
    opts: { ate?: string; onProgress?: (feito: number, total: number, ticker?: string) => void } = {},
  ): Promise<OpResult<ResumoBackfill>> => {
    setExecutando(true)
    try {
      const lista  = await apiFetch<{ id: string; ticker: string; cotacao_automatica?: boolean }[]>('/investimentos/ativos')
      const ativos = (lista.dados ?? []).filter((a) => a.cotacao_automatica !== false)
      const agg: ResumoBackfill = { ate: opts.ate ?? '', meses_gravados: 0, ativos_processados: 0, ignorados: [] }
      if (ativos.length === 0) return { ok: true, dados: agg, erro: null }

      let algumOk = false
      let ultimoErro: string | null = null
      for (let i = 0; i < ativos.length; i++) {
        const a   = ativos[i]
        const res = await apiMutate<ResumoBackfill>('/investimentos/snapshot-backfill', 'POST', { ativo_id: a.id, ate: opts.ate })
        if (res.ok && res.dados) {
          algumOk = true
          agg.meses_gravados     += res.dados.meses_gravados ?? 0
          agg.ativos_processados += res.dados.ativos_processados ?? 0
          if (res.dados.ignorados?.length) agg.ignorados.push(...res.dados.ignorados)
          if (res.dados.ate) agg.ate = res.dados.ate
        } else {
          ultimoErro = res.erro
        }
        opts.onProgress?.(i + 1, ativos.length, a.ticker)
      }
      if (algumOk) await invalidar()
      // Só falha total se NENHUMA chamada vingou; falhas pontuais não abortam.
      return { ok: algumOk, dados: agg, erro: algumOk ? null : ultimoErro }
    } finally {
      setExecutando(false)
    }
  }

  return { preencher, preencherTodos, executando }
}
