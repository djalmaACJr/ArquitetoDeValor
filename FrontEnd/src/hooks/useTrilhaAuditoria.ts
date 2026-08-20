// src/hooks/useTrilhaAuditoria.ts
//
// Trilha de auditoria (arqvalor.trilha_auditoria) — quem mudou o quê, quando.
// Cobre transações/transferências e o módulo de investimentos inteiro, mais
// contas/categorias/objetivos/lembretes/filtros salvos/assistente/fatura
// (ver migrations 20260806000004 + 20260820000001). Um usuário comum só
// enxerga a própria trilha (RLS); admin (usuarios.admin = true) enxerga a de
// todos — a proteção real é a RLS, este hook só chama o endpoint.
// Ver AdminAuditoriaPage.tsx.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'

export type OperacaoAuditoria = 'INSERT' | 'UPDATE' | 'DELETE'

export interface TrilhaAuditoriaItem {
  id:            string
  user_id:       string
  tabela:        string
  operacao:      OperacaoAuditoria
  registro_id:   string
  dados_antigos: Record<string, unknown> | null
  dados_novos:   Record<string, unknown> | null
  alterado_em:   string
  usuarios?:     { email: string | null; nome: string | null } | null
}

export interface FiltrosAuditoria {
  tabela?:      string
  operacao?:    OperacaoAuditoria
  registro_id?: string
  user_id?:     string
  conta_id?:    string
  desde?:       string
  ate?:         string
  limit?:       number
}

function montarQuery(f: FiltrosAuditoria): string {
  const p = new URLSearchParams()
  if (f.tabela)      p.set('tabela', f.tabela)
  if (f.operacao)    p.set('operacao', f.operacao)
  if (f.registro_id) p.set('registro_id', f.registro_id)
  if (f.user_id)     p.set('user_id', f.user_id)
  if (f.conta_id)    p.set('conta_id', f.conta_id)
  if (f.desde)       p.set('desde', f.desde)
  if (f.ate)         p.set('ate', f.ate)
  if (f.limit)       p.set('limit', String(f.limit))
  const qs = p.toString()
  return qs ? `?${qs}` : ''
}

export function useTrilhaAuditoria(filtros: FiltrosAuditoria = {}, enabled = true) {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.trilhaAuditoria(uid, filtros),
    queryFn: async (): Promise<TrilhaAuditoriaItem[]> => {
      const res = await apiFetch<TrilhaAuditoriaItem[]>(`/auditoria${montarQuery(filtros)}`)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar auditoria')
      return res.dados ?? []
    },
    enabled: !!uid && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  return { itens: data ?? [], loading: isLoading, erro: error, recarregar: refetch }
}

// ── Retenção (arqvalor.config_auditoria) ────────────────────────────────
// Período (em dias) que a trilha de auditoria fica guardada antes do job
// diário (fn_purgar_trilha_auditoria, pg_cron) apagar — editável só por
// admin (RLS de config_auditoria, ver 20260820000002). GET devolve `null`
// pra quem não é admin (RLS filtra a linha), mesma lógica de outros
// endpoints admin-only do sistema.

export interface ConfigAuditoria {
  retencao_dias: number
  atualizado_em: string
  atualizado_por: string | null
}

export function useConfigAuditoria(enabled = true) {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const qc = useQueryClient()

  const queryKey = qk.configAuditoria(uid)

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async (): Promise<ConfigAuditoria | null> => {
      const res = await apiFetch<ConfigAuditoria>('/auditoria/config')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar configuração')
      return res.dados
    },
    enabled: !!uid && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const mutation = useMutation({
    mutationFn: async (retencaoDias: number): Promise<ConfigAuditoria> => {
      const res = await apiMutate<ConfigAuditoria>('/auditoria/config', 'PUT', { retencao_dias: retencaoDias })
      if (!res.ok || !res.dados) throw new Error(res.erro ?? 'Erro ao salvar configuração')
      return res.dados
    },
    onSuccess: (novaConfig) => qc.setQueryData(queryKey, novaConfig),
  })

  return {
    config: data ?? null,
    loading: isLoading,
    erro: error,
    recarregar: refetch,
    salvarRetencao: mutation.mutateAsync,
    salvando: mutation.isPending,
    erroSalvar: mutation.error,
  }
}
