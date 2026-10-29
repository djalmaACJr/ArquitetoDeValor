// Ordenação dos rankings da página Destaques + posição do ativo (sem rede/Supabase).
import { calcularRankingsDestaques, posicaoNosRankings } from '../FrontEnd/src/lib/destaquesRanking'
import type { InvestimentoRankingAtivo } from '../FrontEnd/src/types'

function ativo(p: Partial<InvestimentoRankingAtivo> & { ativo_id: string }): InvestimentoRankingAtivo {
  return {
    ticker: p.ativo_id, nome: p.ativo_id, tipo_ativo: 'ACOES', quantidade: 1, nota_usuario: null,
    valor_custo: 1000, valor_mercado: 1000, ganho_perda: 0, rentabilidade_pct: 0, dividendos_12m: 0,
    dividend_yield_pct: 0, yield_on_cost_pct: 0, dy_real_pct: 0, yoc_real_pct: 0, posse_12m: true,
    participacao_pct: 0, valor_mercado_inicio_periodo: 1000, rentabilidade_periodo_pct: 0,
    dividendos_periodo: 0, dy_periodo_pct: 0, periodo_desde_compra: false,
    ...p,
  } as InvestimentoRankingAtivo
}

const carteira = [
  ativo({ ativo_id: 'A', valor_mercado: 1500, rentabilidade_periodo_pct: 50, dy_periodo_pct: 2, dividendos_periodo: 30, participacao_pct: 30 }),
  ativo({ ativo_id: 'B', valor_mercado: 700,  rentabilidade_periodo_pct: -30, participacao_pct: 20 }),
  ativo({ ativo_id: 'C', valor_mercado: 1100, rentabilidade_periodo_pct: 10, dy_periodo_pct: 8, dividendos_periodo: 10, participacao_pct: 50 }),
]

describe('rankings dos destaques', () => {
  const r = calcularRankingsDestaques(carteira)

  it('CA-DST01 — contribuintes ordena pelo módulo do ganho em R$ (altas e baixas misturadas)', () => {
    expect(r.contribuintes.map((a) => a.ativo_id)).toEqual(['A', 'B', 'C'])
  })

  it('CA-DST02 — em alta só tem positivos; em prejuízo só negativos', () => {
    expect(r.emAlta.map((a) => a.ativo_id)).toEqual(['A', 'C'])
    expect(r.emBaixa.map((a) => a.ativo_id)).toEqual(['B'])
  })

  it('CA-DST03 — DY% e dividendos em R$ são rankings distintos e excluem quem não pagou', () => {
    expect(r.maiorDY.map((a) => a.ativo_id)).toEqual(['C', 'A'])
    expect(r.maiorDivRecebido.map((a) => a.ativo_id)).toEqual(['A', 'C'])
  })

  it('CA-DST05 — maior YoC ordena pelo yield_on_cost_pct de 12m (o de "Meus ativos"), não pelo período', () => {
    // O DY do período (÷ mercado) tem outra ordem: C 8% > A 2%; o YoC 12m põe A (6%) à frente de C (4%).
    const lista = [
      ativo({ ativo_id: 'A', yield_on_cost_pct: 6, dividendos_periodo: 0, dy_periodo_pct: 2 }),
      ativo({ ativo_id: 'B', yield_on_cost_pct: 0 }),
      ativo({ ativo_id: 'C', yield_on_cost_pct: 4, dividendos_periodo: 10, dy_periodo_pct: 8 }),
    ]
    const rk = calcularRankingsDestaques(lista)
    expect(rk.maiorYoC.map((x) => x.ativo_id)).toEqual(['A', 'C'])
    expect(rk.maiorDY.map((x) => x.ativo_id)).toEqual(['C', 'A'])
    expect(posicaoNosRankings(rk, 'B').maiorYoC).toBeNull()
  })

  it('CA-DST04 — posição do ativo: 1-based, com total; null fora do ranking', () => {
    const b = posicaoNosRankings(r, 'B')
    expect(b.emBaixa).toEqual({ posicao: 1, total: 1 })
    expect(b.maiorPeso).toEqual({ posicao: 3, total: 3 })
    expect(b.emAlta).toBeNull()
    expect(b.maiorDY).toBeNull()
    expect(posicaoNosRankings(r, 'C').maiorPeso).toEqual({ posicao: 1, total: 3 })
  })
})
