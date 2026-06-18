// src/hooks/useInvAvaliacoes.ts
//
// Avaliações da carteira feitas pelos MENTORES (todas as IAs configuradas
// em usuarios.ia_configs), via Edge Function /investimentos/avaliacoes.
//
// Cada chamada de `avaliarAtivo` roda TODOS os mentores para UM ativo
// (1 chamada de IA por mentor, server-side), calcula o consenso, persiste
// e sobrescreve a nota oficial do ativo (nota_usuario). O frontend
// orquestra o loop por ativo para mostrar progresso e não estourar o
// tempo de uma única Edge Function.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvAvaliacao, InvAvaliacaoMentor, PerguntaAvaliacao, PesosCriterio } from '../types'

async function fetchAvaliacoes(): Promise<InvAvaliacao[]> {
  const res = await apiFetch<InvAvaliacao[]>('/investimentos/avaliacoes')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar avaliações')
  return res.dados ?? []
}

export function useInvAvaliacoes() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: avaliacoes = [], isLoading: loading } = useQuery({
    queryKey: qk.invAvaliacoes(uid),
    queryFn:  fetchAvaliacoes,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  // 1 mentor avalia 1 ativo (sem persistir). Usado pelo loop por mentor
  // (que roda em paralelo) para alimentar a barra de progresso de cada um.
  const avaliarMentorAtivo = async (
    ativoId: string,
    configId: string,
    perguntas: PerguntaAvaliacao[],
    pesos: PesosCriterio,
  ): Promise<OpResult<InvAvaliacaoMentor>> => {
    const res = await apiMutate<InvAvaliacaoMentor>('/investimentos/avaliacoes/mentor', 'POST', {
      ativo_id: ativoId, config_id: configId, perguntas, pesos,
    })
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  // Consolida as respostas dos mentores de 1 ativo: calcula o consenso,
  // persiste e sobrescreve a nota do ativo. Não invalida a cada chamada —
  // quem orquestra invalida no fim via `concluir`.
  const salvarAvaliacao = async (
    ativoId: string,
    perguntas: PerguntaAvaliacao[],
    pesos: PesosCriterio,
    mentores: InvAvaliacaoMentor[],
  ): Promise<OpResult<InvAvaliacao>> => {
    const res = await apiMutate<InvAvaliacao>('/investimentos/avaliacoes/salvar', 'POST', {
      ativo_id: ativoId, perguntas, pesos, mentores,
    })
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  // Invalida avaliações + tudo que depende da nota do ativo (que foi
  // sobrescrita): lista de ativos, ranking e dashboard.
  const concluir = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: qk.invAvaliacoes(uid) }),
      qc.invalidateQueries({ queryKey: qk.invAtivosPref(uid) }),
      qc.invalidateQueries({ queryKey: qk.invRankingPref(uid) }),
      qc.invalidateQueries({ queryKey: qk.invDashboardPref(uid) }),
    ])
  }

  return { avaliacoes, loading, avaliarMentorAtivo, salvarAvaliacao, concluir }
}
