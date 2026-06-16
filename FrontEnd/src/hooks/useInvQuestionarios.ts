// src/hooks/useInvQuestionarios.ts
//
// Questionários de avaliação customizados por tipo de ativo
// (arqvalor.inv_questionarios, via Edge Function /investimentos/questionarios).
//
// Expõe `questionarioEfetivo(tipo, perfil)`: devolve o questionário CUSTOM
// salvo para o tipo, ou — quando não há custom — o PADRÃO estático de
// questionarioAtivos.ts (com pesos sugeridos pelo perfil, se informado).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import { perguntasPadrao, PESOS_PADRAO } from '../lib/questionarioAtivos'
import { PESOS_SUGERIDOS_POR_PERFIL } from '../lib/constants'
import type {
  InvQuestionario, PerguntaAvaliacao, PesosCriterio,
  TipoAtivoInvestimento, PerfilInvestidorTipo,
} from '../types'

// Questionário resolvido (custom ou padrão) usado para avaliar e configurar.
export interface QuestionarioEfetivo {
  tipo_ativo:  TipoAtivoInvestimento
  perguntas:   PerguntaAvaliacao[]
  pesos:       PesosCriterio
  origem:      'MANUAL' | 'IA' | 'PADRAO'
  ia_provedor: string | null
  ia_modelo:   string | null
  custom:      boolean   // true se veio de inv_questionarios
}

// Payload para salvar (PUT) um questionário custom.
export interface SalvarQuestionarioInput {
  perguntas:    PerguntaAvaliacao[]
  pesos:        PesosCriterio
  origem:       'MANUAL' | 'IA'
  ia_provedor?: string | null
  ia_modelo?:   string | null
}

// Resultado da geração por IA (não persistido — preview).
export interface QuestionarioGerado {
  tipo_ativo:  TipoAtivoInvestimento
  perguntas:   PerguntaAvaliacao[]
  pesos:       PesosCriterio
  ia_provedor: string | null
  ia_modelo:   string | null
}

async function fetchQuestionarios(): Promise<InvQuestionario[]> {
  const res = await apiFetch<InvQuestionario[]>('/investimentos/questionarios')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar questionários')
  return res.dados ?? []
}

export function useInvQuestionarios() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: questionarios = [], isLoading: loading } = useQuery({
    queryKey: qk.invQuestionarios(uid),
    queryFn:  fetchQuestionarios,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: qk.invQuestionarios(uid) })

  // Resolve o questionário efetivo de um tipo: custom (banco) ou padrão.
  const questionarioEfetivo = (
    tipo: TipoAtivoInvestimento,
    perfil?: PerfilInvestidorTipo | null,
  ): QuestionarioEfetivo => {
    const custom = questionarios.find((q) => q.tipo_ativo === tipo)
    if (custom) {
      return {
        tipo_ativo:  tipo,
        perguntas:   custom.perguntas,
        pesos:       custom.pesos,
        origem:      custom.origem,
        ia_provedor: custom.ia_provedor,
        ia_modelo:   custom.ia_modelo,
        custom:      true,
      }
    }
    return {
      tipo_ativo:  tipo,
      perguntas:   perguntasPadrao(tipo),
      pesos:       perfil ? { ...PESOS_SUGERIDOS_POR_PERFIL[perfil] } : { ...PESOS_PADRAO },
      origem:      'PADRAO',
      ia_provedor: null,
      ia_modelo:   null,
      custom:      false,
    }
  }

  const salvar = async (
    tipo: TipoAtivoInvestimento, payload: SalvarQuestionarioInput,
  ): Promise<OpResult<InvQuestionario>> => {
    const res = await apiMutate<InvQuestionario>(`/investimentos/questionarios/${tipo}`, 'PUT', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (tipo: TipoAtivoInvestimento): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/questionarios/${tipo}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  const gerarPorIA = async (tipo: TipoAtivoInvestimento): Promise<OpResult<QuestionarioGerado>> => {
    const res = await apiMutate<QuestionarioGerado>(`/investimentos/questionarios/${tipo}/gerar`, 'POST', {})
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  return { questionarios, loading, questionarioEfetivo, salvar, excluir, gerarPorIA }
}
