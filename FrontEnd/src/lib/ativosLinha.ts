// Linha unificada de ativo (metadados + métricas financeiras) compartilhada
// entre a página de Investimentos (origem: ranking) e Meus ativos (origem:
// metadado do ativo). Consumida pelo quadro `QuadroTipoAtivos`.
import {
  FII_CATEGORIA_INFO, ACOES_SUBTIPO_LABEL, SUBTIPO_RF_INFO,
} from './constants'
import type {
  InvestimentoAtivo, InvestimentoRankingAtivo, TipoAtivoInvestimento,
} from '../types'

// Rótulo da categoria/subtipo de um ativo (FII: Tijolo/Papel…; Ações:
// ON/PN/BDR; Renda Fixa/Tesouro: CDB/LCI/Tesouro…). null = sem categoria.
export function rotuloCategoriaAtivo(a: InvestimentoAtivo): string | null {
  if (a.tipo_ativo === 'FII' && a.fii_categoria) return FII_CATEGORIA_INFO[a.fii_categoria].label
  if (a.tipo_ativo === 'ACOES' && a.acoes_subtipo) return ACOES_SUBTIPO_LABEL[a.acoes_subtipo]
  if ((a.tipo_ativo === 'RENDA_FIXA' || a.tipo_ativo === 'TESOURO_DIRETO') && a.rf_subtipo)
    return SUBTIPO_RF_INFO[a.rf_subtipo].label
  return null
}

export interface AtivoLinha {
  ativo_id:           string
  ticker:             string
  nome:               string | null
  tipo_ativo:         TipoAtivoInvestimento
  nota_usuario:       number | null
  logo_url:           string | null
  setor:              string | null
  categoria:          string | null
  contas:             string[]
  quantidade:         number
  valor_custo:        number
  valor_mercado:      number
  rentabilidade_pct:  number
  dividend_yield_pct: number
  yield_on_cost_pct:  number
  dy_real_pct:        number
  yoc_real_pct:       number
  posse_12m:          boolean
  participacao_pct:   number
  // Metadado original — necessário para as ações de Posições/Histórico/Editar
  meta:               InvestimentoAtivo | null
}

// Monta a linha unificada a partir do ranking (página de Investimentos)
export function linhaDeRanking(
  a: InvestimentoRankingAtivo, meta: InvestimentoAtivo | undefined, contas: string[],
): AtivoLinha {
  return {
    ativo_id: a.ativo_id, ticker: a.ticker, nome: a.nome, tipo_ativo: a.tipo_ativo,
    nota_usuario: a.nota_usuario, logo_url: meta?.logo_url ?? null, setor: meta?.setor ?? null,
    categoria: meta ? rotuloCategoriaAtivo(meta) : null, contas,
    quantidade: Number(a.quantidade) || 0, valor_custo: a.valor_custo, valor_mercado: a.valor_mercado,
    rentabilidade_pct: a.rentabilidade_pct, dividend_yield_pct: a.dividend_yield_pct,
    yield_on_cost_pct: a.yield_on_cost_pct, dy_real_pct: a.dy_real_pct ?? 0,
    yoc_real_pct: a.yoc_real_pct ?? 0, posse_12m: a.posse_12m ?? true,
    participacao_pct: a.participacao_pct, meta: meta ?? null,
  }
}

// Monta a linha unificada a partir do metadado do ativo (página Meus ativos)
export function linhaDeMeta(
  meta: InvestimentoAtivo, r: InvestimentoRankingAtivo | undefined, contas: string[],
): AtivoLinha {
  return {
    ativo_id: meta.id, ticker: meta.ticker, nome: meta.nome, tipo_ativo: meta.tipo_ativo,
    nota_usuario: meta.nota_usuario, logo_url: meta.logo_url, setor: meta.setor,
    categoria: rotuloCategoriaAtivo(meta), contas,
    quantidade: Number(r?.quantidade) || 0, valor_custo: r?.valor_custo ?? 0, valor_mercado: r?.valor_mercado ?? 0,
    rentabilidade_pct: r?.rentabilidade_pct ?? 0, dividend_yield_pct: r?.dividend_yield_pct ?? 0,
    yield_on_cost_pct: r?.yield_on_cost_pct ?? 0, dy_real_pct: r?.dy_real_pct ?? 0,
    yoc_real_pct: r?.yoc_real_pct ?? 0, posse_12m: r?.posse_12m ?? true,
    participacao_pct: r?.participacao_pct ?? 0, meta,
  }
}
