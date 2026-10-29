// ============================================================
// Radares da carteira (página Avaliações)
//
// 1) "Saúde da carteira" — 5 critérios de CARTEIRA (não de ativo), calculados
//    direto das posições (sem questionário): Diversificação, Liquidez,
//    Retorno, Eficiência e Proteção. Todos em escala 0..10.
// 2) "Qualidade dos ativos" — os 4 critérios dos questionários
//    (Fundamentos/Crescimento/Renda/Valuation): média das notas por critério
//    dos ativos avaliados, ponderada pelo valor de mercado de cada um.
// ============================================================
import type { InvestimentoRankingAtivo, TipoAtivoInvestimento } from '../types'
import type { CriterioQuestao } from './constants'
import { CRITERIOS_QUESTAO } from './constants'

export const CRITERIOS_CARTEIRA = ['DIVERSIFICACAO', 'LIQUIDEZ', 'RETORNO', 'EFICIENCIA', 'PROTECAO'] as const
export type CriterioCarteira = typeof CRITERIOS_CARTEIRA[number]

export const CRITERIO_CARTEIRA_LABEL: Record<CriterioCarteira, string> = {
  DIVERSIFICACAO: 'Diversificação',
  LIQUIDEZ:       'Liquidez',
  RETORNO:        'Retorno',
  EFICIENCIA:     'Eficiência',
  PROTECAO:       'Proteção',
}

// Como cada nota é calculada — exibido no quadro pra ninguém ter que adivinhar.
export const CRITERIO_CARTEIRA_REGRA: Record<CriterioCarteira, string> = {
  DIVERSIFICACAO: 'Nº efetivo de ativos (10 = 12 ou mais com pesos iguais) e de tipos de ativo (10 = 5 ou mais), 50% cada. Concentração em poucos ativos/tipos reduz a nota.',
  LIQUIDEZ:       'Média, ponderada pelo valor, da facilidade de converter em dinheiro de cada tipo (ações/ETFs ≈ D+2, FIIs, Tesouro, renda fixa com carência, cripto…).',
  RETORNO:        'Retorno total desde a compra: (ganho/perda + proventos dos últimos 12m) ÷ custo. 0% = nota 5; +20% ou mais = 10; −20% ou menos = 0.',
  EFICIENCIA:     '50% renda gerada sobre o capital (dividend yield real 12m: 8% ou mais = 10) + 50% do capital que está em ativos com retorno total não negativo.',
  PROTECAO:       'Parcela da carteira em ativos defensivos: renda fixa/Tesouro (peso total) e ativos no exterior (meio peso, proteção cambial). 40% defensivo = 10.',
}

// Liquidez típica por tipo (0..10) — heurística fixa, não vem do banco.
const LIQUIDEZ_POR_TIPO: Record<TipoAtivoInvestimento, number> = {
  ACOES:             9,
  ETF:               9,
  FII:               8,
  REIT:              7,
  STOCKS:            7,
  ETF_INTERNACIONAL: 7,
  CRIPTOMOEDAS:      7,
  TESOURO_DIRETO:    6,
  RENDA_FIXA:        4,
}

const PESO_DEFENSIVO: Partial<Record<TipoAtivoInvestimento, number>> = {
  RENDA_FIXA:        1,
  TESOURO_DIRETO:    1,
  STOCKS:            0.5,
  REIT:              0.5,
  ETF_INTERNACIONAL: 0.5,
}

const clamp = (v: number, min = 0, max = 10) => Math.min(max, Math.max(min, v))
const arred1 = (v: number) => Math.round(v * 10) / 10

// Nº efetivo de itens = 1 / Σ(p²) (inverso do índice de Herfindahl).
function nEfetivo(valores: number[]): number {
  const total = valores.reduce((s, v) => s + v, 0)
  if (total <= 0) return 0
  return 1 / valores.reduce((s, v) => s + (v / total) ** 2, 0)
}

// Dentro de UM tipo de ativo não faz sentido medir diversidade de tipos (seria
// sempre 1): a diversificação mede só a dispersão entre os ativos do tipo, e
// 10 = 8 ou mais ativos com pesos iguais.
export const REGRA_DIVERSIFICACAO_TIPO =
  'Nº efetivo de ativos dentro do tipo (10 = 8 ou mais com pesos iguais). Concentração em poucos ativos reduz a nota.'

export type EscopoRadar = 'carteira' | 'tipo'

export type NotasCarteira = Record<CriterioCarteira, number>

/**
 * Notas 0..10 da carteira (só posições com valor de mercado > 0). Null se vazia.
 * `escopo: 'tipo'` é para uma lista que já é de um único tipo de ativo.
 */
export function calcularRadarCarteira(
  ativos: InvestimentoRankingAtivo[], escopo: EscopoRadar = 'carteira',
): NotasCarteira | null {
  const lista = ativos.filter((a) => a.quantidade > 0 && a.valor_mercado > 0)
  if (lista.length === 0) return null
  const mercado = lista.reduce((s, a) => s + a.valor_mercado, 0)
  const custo   = lista.reduce((s, a) => s + a.valor_custo, 0)

  // Diversificação
  const porTipo = new Map<string, number>()
  for (const a of lista) porTipo.set(a.tipo_ativo, (porTipo.get(a.tipo_ativo) ?? 0) + a.valor_mercado)
  const notaAtivos = clamp((nEfetivo(lista.map((a) => a.valor_mercado)) / 12) * 10)
  const notaTipos  = clamp((nEfetivo([...porTipo.values()]) / 5) * 10)
  const diversificacao = escopo === 'tipo'
    ? clamp((nEfetivo(lista.map((a) => a.valor_mercado)) / 8) * 10)
    : (notaAtivos + notaTipos) / 2

  // Liquidez
  const liquidez = lista.reduce((s, a) => s + LIQUIDEZ_POR_TIPO[a.tipo_ativo] * a.valor_mercado, 0) / mercado

  // Retorno (ganho/perda não inclui proventos — somados aqui)
  const proventos12m = lista.reduce((s, a) => s + a.dividendos_12m, 0)
  const retornoPct = custo > 0 ? ((mercado - custo + proventos12m) / custo) * 100 : 0
  const retorno = clamp(5 + retornoPct / 4)

  // Eficiência
  const dyReal = (proventos12m / mercado) * 100
  const notaDy = clamp((dyReal / 8) * 10)
  const mercadoNaoNegativo = lista
    .filter((a) => a.valor_mercado - a.valor_custo + a.dividendos_12m >= 0)
    .reduce((s, a) => s + a.valor_mercado, 0)
  const eficiencia = (notaDy + (mercadoNaoNegativo / mercado) * 10) / 2

  // Proteção
  const defensivo = lista.reduce((s, a) => s + (PESO_DEFENSIVO[a.tipo_ativo] ?? 0) * a.valor_mercado, 0) / mercado
  const protecao = clamp((defensivo / 0.4) * 10)

  return {
    DIVERSIFICACAO: arred1(diversificacao),
    LIQUIDEZ:       arred1(liquidez),
    RETORNO:        arred1(retorno),
    EFICIENCIA:     arred1(eficiencia),
    PROTECAO:       arred1(protecao),
  }
}

export type NotasCriteriosAtivos = Record<CriterioQuestao, number | null>

/**
 * Média das notas por critério dos ativos avaliados, ponderada pelo valor de
 * mercado. Critério sem nenhuma nota → null. `pesoPorAtivo` ausente ou 0
 * cai na média simples (peso 1), pra ativo avaliado sem cotação não sumir.
 */
export function calcularRadarCriteriosAtivos(
  linhas: { ativoId: string; medias: NotasCriteriosAtivos }[],
  pesoPorAtivo: Map<string, number>,
): NotasCriteriosAtivos {
  const out = {} as NotasCriteriosAtivos
  for (const cr of CRITERIOS_QUESTAO) {
    let soma = 0
    let pesos = 0
    for (const l of linhas) {
      const v = l.medias[cr]
      if (v == null) continue
      const p = pesoPorAtivo.get(l.ativoId) || 1
      soma += v * p
      pesos += p
    }
    out[cr] = pesos > 0 ? arred1(soma / pesos) : null
  }
  return out
}

// ── Relevância por tipo (radares dentro de cada quadro de tipo de ativo) ──
// Liquidez e Proteção são constantes dentro de um tipo (vêm do próprio tipo),
// então não discriminam nada ali. Eficiência mistura renda gerada (DY), que
// só faz sentido onde o tipo distribui proventos. Diversificação precisa de
// ao menos 2 ativos. Um radar com menos de 3 eixos não é desenhado.
export const MIN_EIXOS_RADAR = 3

const TIPOS_QUE_DISTRIBUEM = new Set<TipoAtivoInvestimento>(['ACOES', 'FII', 'REIT', 'STOCKS', 'ETF'])

export function criteriosCarteiraRelevantes(tipo: TipoAtivoInvestimento, nAtivos: number): CriterioCarteira[] {
  const out: CriterioCarteira[] = []
  if (nAtivos >= 2) out.push('DIVERSIFICACAO')
  out.push('RETORNO')
  if (TIPOS_QUE_DISTRIBUEM.has(tipo)) out.push('EFICIENCIA')
  return out
}

// Critério de questionário sem sentido para o tipo (ativo que não distribui
// proventos não tem "geração de renda" a ser comparada).
const TIPOS_SEM_RENDA = new Set<TipoAtivoInvestimento>(['CRIPTOMOEDAS', 'ETF_INTERNACIONAL'])

export function criteriosQuestaoRelevantes(tipo: TipoAtivoInvestimento): CriterioQuestao[] {
  return CRITERIOS_QUESTAO.filter((c) => !(c === 'DIVIDENDOS' && TIPOS_SEM_RENDA.has(tipo)))
}
