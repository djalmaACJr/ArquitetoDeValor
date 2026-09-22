// src/hooks/useInvQuestionarios.ts
//
// Questionários de avaliação customizados por tipo de ativo — e, no caso de
// FII, também por CATEGORIA (Tijolo/Papel/FoF/Desenvolvimento/FIAGRO/Outro)
// (arqvalor.inv_questionarios, via Edge Function /investimentos/questionarios).
//
// Expõe `questionarioEfetivo(tipo, perfil, pesosGlobais, categoriaFII)`:
// devolve o questionário CUSTOM salvo para o tipo (+categoria, se FII), ou
// — quando não há custom — o PADRÃO estático de questionarioAtivos.ts (com
// pesos sugeridos pelo perfil, se informado).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import { perguntasPadrao, PESOS_PADRAO } from '../lib/questionarioAtivos'
import { PESOS_SUGERIDOS_POR_PERFIL } from '../lib/constants'
import type {
  InvQuestionario, PerguntaAvaliacao, PesosCriterio,
  TipoAtivoInvestimento, PerfilInvestidorTipo, CategoriaFII,
} from '../types'

// Monta a rota /investimentos/questionarios/:tipo, com ?categoria= quando
// aplicável (só tipo_ativo=FII; '' = questionário genérico de FII).
function rotaTipo(tipo: TipoAtivoInvestimento, categoriaFII?: CategoriaFII | '' | null): string {
  const base = `/investimentos/questionarios/${tipo}`
  return tipo === 'FII' && categoriaFII ? `${base}?categoria=${categoriaFII}` : base
}

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

  // Resolve o questionário efetivo de um tipo (+ categoria, se FII): custom
  // (banco) ou padrão.
  //
  // Para FII, a resolução tenta primeiro o custom da CATEGORIA exata do
  // ativo, depois o custom GENÉRICO de FII (fii_categoria=''), e só then o
  // padrão estático (perguntasPadrao) — que já sabe montar o bloco certo por
  // categoria. Ignorar `categoriaFII` (ou tipo != FII) sempre resolve pelo
  // genérico, igual ao comportamento anterior.
  //
  // Os PESOS são GLOBAIS (valem para todos os tipos): se `pesosGlobais` for
  // informado, ele prevalece sobre os pesos por tipo (legado) e sobre o
  // padrão — só as PERGUNTAS variam por tipo/categoria.
  const questionarioEfetivo = (
    tipo: TipoAtivoInvestimento,
    perfil?: PerfilInvestidorTipo | null,
    pesosGlobais?: PesosCriterio | null,
    categoriaFII?: CategoriaFII | null,
  ): QuestionarioEfetivo => {
    const pesosPadrao = perfil ? { ...PESOS_SUGERIDOS_POR_PERFIL[perfil] } : { ...PESOS_PADRAO }
    const pesos = pesosGlobais ?? pesosPadrao
    const doTipo = questionarios.filter((q) => q.tipo_ativo === tipo)
    const custom = tipo === 'FII'
      ? (doTipo.find((q) => q.fii_categoria === (categoriaFII ?? '')) ?? doTipo.find((q) => q.fii_categoria === ''))
      : doTipo.find((q) => q.fii_categoria === '')
    if (custom) {
      return {
        tipo_ativo:  tipo,
        perguntas:   custom.perguntas,
        pesos,
        origem:      custom.origem,
        ia_provedor: custom.ia_provedor,
        ia_modelo:   custom.ia_modelo,
        custom:      true,
      }
    }
    return {
      tipo_ativo:  tipo,
      perguntas:   perguntasPadrao(tipo, categoriaFII),
      pesos,
      origem:      'PADRAO',
      ia_provedor: null,
      ia_modelo:   null,
      custom:      false,
    }
  }

  const salvar = async (
    tipo: TipoAtivoInvestimento, payload: SalvarQuestionarioInput, categoriaFII?: CategoriaFII | '' | null,
  ): Promise<OpResult<InvQuestionario>> => {
    const res = await apiMutate<InvQuestionario>(rotaTipo(tipo, categoriaFII), 'PUT', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (tipo: TipoAtivoInvestimento, categoriaFII?: CategoriaFII | '' | null): Promise<OpResult> => {
    const res = await apiMutate(rotaTipo(tipo, categoriaFII), 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  const gerarPorIA = async (
    tipo: TipoAtivoInvestimento, categoriaFII?: CategoriaFII | '' | null,
  ): Promise<OpResult<QuestionarioGerado>> => {
    const rota = tipo === 'FII' && categoriaFII
      ? `/investimentos/questionarios/${tipo}/gerar?categoria=${categoriaFII}`
      : `/investimentos/questionarios/${tipo}/gerar`
    const res = await apiMutate<QuestionarioGerado>(rota, 'POST', {})
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  return { questionarios, loading, questionarioEfetivo, salvar, excluir, gerarPorIA }
}
