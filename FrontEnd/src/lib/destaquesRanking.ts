// Rankings da página Destaques — fonte ÚNICA da ordenação, usada pela própria
// página e pelo quadro "Posição nos destaques" da página do ativo.
import type { InvestimentoRankingAtivo } from '../types'

export const CHAVES_RANKING_DESTAQUE = [
  'contribuintes', 'emAlta', 'emBaixa', 'maiorDY', 'maiorYoC', 'maiorDivRecebido', 'maiorPeso',
] as const
export type ChaveRankingDestaque = typeof CHAVES_RANKING_DESTAQUE[number]

export type RankingsDestaques = Record<ChaveRankingDestaque, InvestimentoRankingAtivo[]>

export const ROTULO_RANKING_DESTAQUE: Record<ChaveRankingDestaque, string> = {
  contribuintes:    'Maiores contribuintes',
  emAlta:           'Em alta',
  emBaixa:          'Em prejuízo',
  maiorDY:          'Maior dividend yield',
  maiorYoC:         'Maior YoC',
  maiorDivRecebido: 'Maiores dividendos recebidos',
  maiorPeso:        'Maior participação',
}

export function calcularRankingsDestaques(ativos: InvestimentoRankingAtivo[]): RankingsDestaques {
  return {
    // Contribuição em R$ (módulo do ganho/perda): "quem mais mexeu o patrimônio",
    // pra cima ou pra baixo — não é o mesmo que "Em alta" (que ordena por %).
    contribuintes: [...ativos]
      .map((a) => ({ a, ganho: a.valor_mercado - a.valor_mercado_inicio_periodo }))
      .sort((x, y) => Math.abs(y.ganho) - Math.abs(x.ganho))
      .map(({ a }) => a),
    emAlta: [...ativos].filter((a) => a.rentabilidade_periodo_pct > 0)
      .sort((x, y) => y.rentabilidade_periodo_pct - x.rentabilidade_periodo_pct),
    emBaixa: [...ativos].filter((a) => a.rentabilidade_periodo_pct < 0)
      .sort((x, y) => x.rentabilidade_periodo_pct - y.rentabilidade_periodo_pct),
    // DY% (dividendos ÷ valor de mercado) e dividendos em R$ são rankings distintos.
    maiorDY: [...ativos].filter((a) => a.dy_periodo_pct > 0)
      .sort((x, y) => y.dy_periodo_pct - x.dy_periodo_pct),
    // YoC projetado de 12m (padrão investidor10) — o MESMO da coluna YoC de
    // "Meus ativos"; não depende do período selecionado.
    maiorYoC: [...ativos].filter((a) => a.yield_on_cost_pct > 0)
      .sort((x, y) => y.yield_on_cost_pct - x.yield_on_cost_pct),
    maiorDivRecebido: [...ativos].filter((a) => a.dividendos_periodo > 0)
      .sort((x, y) => y.dividendos_periodo - x.dividendos_periodo),
    maiorPeso: [...ativos].sort((x, y) => y.participacao_pct - x.participacao_pct),
  }
}

/** Posição (1-based) do ativo em cada ranking; null quando ele não entra na lista (ex.: sem prejuízo, sem dividendos). */
export function posicaoNosRankings(
  rankings: RankingsDestaques, ativoId: string,
): Record<ChaveRankingDestaque, { posicao: number; total: number } | null> {
  const out = {} as Record<ChaveRankingDestaque, { posicao: number; total: number } | null>
  for (const k of CHAVES_RANKING_DESTAQUE) {
    const i = rankings[k].findIndex((a) => a.ativo_id === ativoId)
    out[k] = i >= 0 ? { posicao: i + 1, total: rankings[k].length } : null
  }
  return out
}
