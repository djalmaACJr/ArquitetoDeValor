// src/hooks/useCronExecucoes.ts
//
// Histórico de execução dos 4 cron jobs do sistema (dividendos-diario,
// dividendos-br-diario, snapshot-diario, rendimento-cripto-diario).
// Só admin (usuarios.admin = true) — RLS de cron_execucoes filtra o resto,
// então um não-admin só recebe lista vazia. Ver AdminCronsPage.tsx.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'

export interface CronExecucao {
  id:           string
  job_nome:     string
  status:       'sucesso' | 'erro'
  resumo:       unknown
  erro:         string | null
  duracao_ms:   number | null
  executado_em: string
}

/** Resultado da limpeza: `removidas` = apagadas (ou, em simulação, quantas seriam). */
export interface LimpezaCron { removidas: number; simulado: boolean; dias: number }

export function useCronExecucoes(enabled = true) {
  const { session } = useAuth()
  const qc = useQueryClient()
  const uid = session?.user?.id ?? null

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.cronExecucoes(uid),
    queryFn: async (): Promise<CronExecucao[]> => {
      const res = await apiFetch<CronExecucao[]>('/investimentos/cron-execucoes')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar execuções')
      return res.dados ?? []
    },
    enabled: !!uid && enabled,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  /** Limpa execuções com mais de `dias` dias (mínimo 30 — imposto no servidor/banco). Com
   *  `simular`, só conta quantas seriam apagadas, sem apagar nada. */
  const limparAntigas = async (dias: number, simular = false) => {
    const res = await apiMutate<LimpezaCron>(
      `/investimentos/cron-execucoes?dias=${dias}${simular ? '&simular=true' : ''}`, 'DELETE',
    )
    if (res.ok && !simular) await qc.invalidateQueries({ queryKey: qk.cronExecucoes(uid) })
    return res
  }

  return { execucoes: data ?? [], loading: isLoading, erro: error, recarregar: refetch, limparAntigas }
}
