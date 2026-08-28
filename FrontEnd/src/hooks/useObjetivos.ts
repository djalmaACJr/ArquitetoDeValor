import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { Objetivo, TipoObjetivo, StatusObjetivo, Frequencia } from '../types'

export type { Objetivo, TipoObjetivo, StatusObjetivo }

interface OpResult<T = void> { ok: boolean; dados: T | null; erro: string | null }

// ── Tipos de input ────────────────────────────────────────────

export interface CriarObjetivoInput {
  tipo:            TipoObjetivo
  nome:            string
  descricao?:      string | null
  icone?:          string
  cor?:            string
  valor_meta:      number
  data_inicio:     string
  data_fim:        string
  // SONHO
  conta_id?:       string | null
  // OBJETIVO
  categoria_id?:   string | null
  frequencia?:     Frequencia | null
  // SONHO — múltiplas contas
  contas_sonho?: string[]
  // PROJETO
  contas_projeto?: string[]
  // OBJETIVO — múltiplas categorias
  categorias_objetivo?: string[]
}

export interface EditarObjetivoInput {
  nome?:                string
  descricao?:           string | null
  icone?:               string
  cor?:                 string
  ativo?:               boolean
  valor_meta?:          number
  motivo_revisao?:      string
  data_inicio?:         string
  data_fim?:            string
  conta_id?:            string | null
  categoria_id?:        string | null
  frequencia?:          Frequencia | null
  contas_sonho?:        string[]
  contas_projeto?:      string[]
  categorias_objetivo?: string[]
}

export interface FiltrosObjetivos {
  tipo?:   TipoObjetivo
  status?: StatusObjetivo
  ativo?:  boolean
}

// ── Fetchers ──────────────────────────────────────────────────

async function fetchObjetivos(filtros: FiltrosObjetivos): Promise<Objetivo[]> {
  const params = new URLSearchParams()
  if (filtros.tipo)              params.set('tipo',   filtros.tipo)
  if (filtros.status)            params.set('status', filtros.status)
  if (filtros.ativo !== undefined) params.set('ativo', String(filtros.ativo))

  const qs  = params.toString()
  const res = await apiFetch<Objetivo[]>(`/objetivos${qs ? `?${qs}` : ''}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar objetivos')
  return res.dados ?? []
}

async function fetchObjetivoDetalhe(id: string): Promise<Objetivo> {
  const res = await apiFetch<Objetivo>(`/objetivos/${id}`)
  if (!res.ok) throw new Error(res.erro ?? 'Objetivo não encontrado')
  return res.dados!
}

// ── Sincronização automática de progresso ───────────────────────
//
// valor_atingido/percentual só são recalculados quando o registro do
// objetivo é salvo (trigger) ou via POST /objetivos/sincronizar-progresso.
// Novas transações de receita/despesa NÃO disparam recálculo sozinhas, então
// sem isso o progresso fica parado no último snapshot. Chamamos o mesmo
// endpoint do botão "Sincronizar" automaticamente em dois gatilhos:
//   1) sempre que a tela de detalhe de um objetivo é aberta;
//   2) no máximo 1x por dia em qualquer página logada (AppLayout), pra quem
//      não visita a tela de detalhe todo dia.
// Ambos compartilham a mesma marca de "última sincronização" em localStorage
// pra não duplicar a chamada quando os dois gatilhos caem no mesmo dia.

const LS_ULTIMA_SINCRONIZACAO = 'arqvalor:objetivos-sync-em'

async function sincronizarProgressoSilencioso(uid: string, qc: QueryClient): Promise<void> {
  const res = await apiMutate('/objetivos/sincronizar-progresso', 'POST')
  if (res.ok) {
    localStorage.setItem(LS_ULTIMA_SINCRONIZACAO, new Date().toDateString())
    await qc.invalidateQueries({ queryKey: ['objetivos', uid] })
  }
}

/** Sincroniza o progresso de todos os objetivos ativos no máximo 1x por dia.
 * Montar uma única vez num componente sempre presente enquanto logado (ex.: AppLayout). */
export function useSincronizarObjetivosDiario(): void {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  useEffect(() => {
    if (!uid) return
    if (localStorage.getItem(LS_ULTIMA_SINCRONIZACAO) === new Date().toDateString()) return
    sincronizarProgressoSilencioso(uid, qc)
  }, [uid, qc])
}

// ── Hook principal ────────────────────────────────────────────

export function useObjetivos(filtros: FiltrosObjetivos = {}) {
  const qc  = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: objetivos = [], isLoading: loading, error } = useQuery({
    queryKey: qk.objetivos(uid, filtros),
    queryFn:  () => fetchObjetivos(filtros),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: ['objetivos', uid] })

  const criar = async (payload: CriarObjetivoInput): Promise<OpResult<Objetivo>> => {
    const res = await apiMutate<Objetivo>('/objetivos', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const editar = async (id: string, payload: EditarObjetivoInput): Promise<OpResult<Objetivo>> => {
    const res = await apiMutate<Objetivo>(`/objetivos/${id}`, 'PUT', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/objetivos/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  const sincronizar = async (): Promise<OpResult<{ sincronizados: number }>> => {
    const res = await apiMutate<{ sincronizados: number }>(
      '/objetivos/sincronizar-progresso',
      'POST',
    )
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  return {
    objetivos,
    loading,
    error: error ? (error as Error).message : null,
    criar,
    editar,
    excluir,
    sincronizar,
  }
}

// ── Hook de detalhe (com snapshots de progresso) ──────────────

export function useObjetivoDetalhe(id: string | null) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  // Sincroniza o progresso ao abrir a tela de detalhe, mesmo que já tenha
  // rodado hoje via useSincronizarObjetivosDiario — o usuário quer ver o
  // número mais atual justamente quando entra nessa tela.
  useEffect(() => {
    if (!uid || !id) return
    sincronizarProgressoSilencioso(uid, qc)
  }, [uid, id, qc])

  const { data: objetivo, isLoading: loading, error } = useQuery({
    queryKey: qk.objetivoDetalhe(uid ?? '', id ?? ''),
    queryFn:  () => fetchObjetivoDetalhe(id!),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid && !!id,
  })

  return {
    objetivo: objetivo ?? null,
    loading,
    error: error ? (error as Error).message : null,
  }
}
