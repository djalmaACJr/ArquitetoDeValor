// Cálculo puro dos radares da página Avaliações (sem rede/Supabase).
import { calcularRadarCarteira, calcularRadarCriteriosAtivos, criteriosCarteiraRelevantes, criteriosQuestaoRelevantes, MIN_EIXOS_RADAR } from '../FrontEnd/src/lib/radarCarteira'
import type { InvestimentoRankingAtivo } from '../FrontEnd/src/types'

function ativo(p: Partial<InvestimentoRankingAtivo> & { ativo_id: string }): InvestimentoRankingAtivo {
  return {
    ticker: p.ativo_id, nome: p.ativo_id, tipo_ativo: 'ACOES', quantidade: 1,
    nota_usuario: null, valor_custo: 1000, valor_mercado: 1000, ganho_perda: 0,
    rentabilidade_pct: 0, dividendos_12m: 0, dividend_yield_pct: 0, yield_on_cost_pct: 0,
    dy_real_pct: 0, yoc_real_pct: 0, posse_12m: true, participacao_pct: 0,
    valor_mercado_inicio_periodo: 1000, rentabilidade_periodo_pct: 0, dividendos_periodo: 0,
    dy_periodo_pct: 0, periodo_desde_compra: false,
    ...p,
  } as InvestimentoRankingAtivo
}

describe('calcularRadarCarteira', () => {
  it('CA-RAD01 — carteira vazia ou sem saldo devolve null', () => {
    expect(calcularRadarCarteira([])).toBeNull()
    expect(calcularRadarCarteira([ativo({ ativo_id: 'A', quantidade: 0 })])).toBeNull()
  })

  it('CA-RAD02 — um único ativo concentrado tem diversificação baixa', () => {
    const r = calcularRadarCarteira([ativo({ ativo_id: 'A' })])!
    // 1 ativo (1/12 → 0,8) e 1 tipo (1/5 → 2,0) → média 1,4
    expect(r.DIVERSIFICACAO).toBeCloseTo(1.4, 1)
  })

  it('CA-RAD03 — 12 ativos iguais em 5 tipos atingem diversificação 10', () => {
    const tipos = ['ACOES', 'FII', 'RENDA_FIXA', 'STOCKS', 'CRIPTOMOEDAS'] as const
    const lista = Array.from({ length: 15 }, (_, i) => ativo({ ativo_id: `A${i}`, tipo_ativo: tipos[i % 5] }))
    expect(calcularRadarCarteira(lista)!.DIVERSIFICACAO).toBe(10)
  })

  it('CA-RAD04 — retorno: 0% = 5, +20% (com proventos) = 10, −20% = 0', () => {
    const base = { valor_custo: 1000 }
    expect(calcularRadarCarteira([ativo({ ativo_id: 'A', ...base })])!.RETORNO).toBe(5)
    expect(calcularRadarCarteira([ativo({ ativo_id: 'A', ...base, valor_mercado: 1100, dividendos_12m: 100 })])!.RETORNO).toBe(10)
    expect(calcularRadarCarteira([ativo({ ativo_id: 'A', ...base, valor_mercado: 800 })])!.RETORNO).toBe(0)
  })

  it('CA-RAD05 — proteção: 40% em renda fixa/Tesouro = 10; exterior vale meio peso', () => {
    const rf = calcularRadarCarteira([
      ativo({ ativo_id: 'A', valor_mercado: 600 }),
      ativo({ ativo_id: 'B', tipo_ativo: 'RENDA_FIXA', valor_mercado: 400 }),
    ])!
    expect(rf.PROTECAO).toBe(10)
    const ext = calcularRadarCarteira([
      ativo({ ativo_id: 'A', valor_mercado: 600 }),
      ativo({ ativo_id: 'B', tipo_ativo: 'STOCKS', valor_mercado: 400 }),
    ])!
    expect(ext.PROTECAO).toBe(5)
  })

  it('CA-RAD06 — liquidez é a média ponderada por valor e fica entre 0 e 10', () => {
    const r = calcularRadarCarteira([
      ativo({ ativo_id: 'A', valor_mercado: 500 }),                          // ações = 9
      ativo({ ativo_id: 'B', tipo_ativo: 'RENDA_FIXA', valor_mercado: 500 }), // RF = 4
    ])!
    expect(r.LIQUIDEZ).toBe(6.5)
  })

  it('CA-RAD07 — eficiência: sem proventos e sem perdas = 5; DY 8% sem perdas = 10', () => {
    expect(calcularRadarCarteira([ativo({ ativo_id: 'A' })])!.EFICIENCIA).toBe(5)
    expect(calcularRadarCarteira([ativo({ ativo_id: 'A', dividendos_12m: 80 })])!.EFICIENCIA).toBe(10)
  })
})

describe('calcularRadarCarteira — escopo tipo', () => {
  it('CA-RAD10 — diversificação do tipo mede só os ativos (8 iguais = 10; 1 = 1,3)', () => {
    const oito = Array.from({ length: 8 }, (_, i) => ativo({ ativo_id: `F${i}`, tipo_ativo: 'FII' }))
    expect(calcularRadarCarteira(oito, 'tipo')!.DIVERSIFICACAO).toBe(10)
    expect(calcularRadarCarteira([oito[0]], 'tipo')!.DIVERSIFICACAO).toBe(1.3)
    // no escopo da carteira, a mesma lista de FIIs perde pontos por ser de um tipo só
    expect(calcularRadarCarteira(oito)!.DIVERSIFICACAO).toBeLessThan(10)
  })
})

describe('calcularRadarCriteriosAtivos', () => {
  const med = (f: number | null, c: number | null, d: number | null, v: number | null) =>
    ({ FUNDAMENTOS: f, CRESCIMENTO: c, DIVIDENDOS: d, VALUATION: v })

  it('CA-RAD08 — pondera pelo valor de mercado e ignora critério sem nota', () => {
    const r = calcularRadarCriteriosAtivos(
      [
        { ativoId: 'A', medias: med(10, null, 8, 6) },
        { ativoId: 'B', medias: med(0, null, null, 6) },
      ],
      new Map([['A', 3000], ['B', 1000]]),
    )
    expect(r.FUNDAMENTOS).toBe(7.5)
    expect(r.CRESCIMENTO).toBeNull()
    expect(r.DIVIDENDOS).toBe(8)
    expect(r.VALUATION).toBe(6)
  })

  it('CA-RAD09 — ativo sem valor de mercado cai na média simples (peso 1)', () => {
    const r = calcularRadarCriteriosAtivos(
      [{ ativoId: 'A', medias: med(10, 0, 0, 0) }, { ativoId: 'B', medias: med(0, 0, 0, 0) }],
      new Map(),
    )
    expect(r.FUNDAMENTOS).toBe(5)
  })
})

describe('relevância por tipo', () => {
  it('CA-RAD11 — tipos que distribuem têm Div (≥2 ativos), Retorno e Eficiência; os demais ficam com < 3 eixos', () => {
    expect(criteriosCarteiraRelevantes('FII', 3)).toEqual(['DIVERSIFICACAO', 'RETORNO', 'EFICIENCIA'])
    expect(criteriosCarteiraRelevantes('FII', 1)).toEqual(['RETORNO', 'EFICIENCIA'])
    expect(criteriosCarteiraRelevantes('RENDA_FIXA', 5).length).toBeLessThan(MIN_EIXOS_RADAR)
    expect(criteriosCarteiraRelevantes('CRIPTOMOEDAS', 5).length).toBeLessThan(MIN_EIXOS_RADAR)
  })

  it('CA-RAD12 — cripto e ETF internacional não comparam geração de renda', () => {
    expect(criteriosQuestaoRelevantes('CRIPTOMOEDAS')).not.toContain('DIVIDENDOS')
    expect(criteriosQuestaoRelevantes('ETF_INTERNACIONAL')).not.toContain('DIVIDENDOS')
    expect(criteriosQuestaoRelevantes('ACOES')).toContain('DIVIDENDOS')
  })
})
