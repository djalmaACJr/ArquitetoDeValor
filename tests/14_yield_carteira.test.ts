// Contas de yield (DY/YoC) do frontend — lib pura, sem rede/Supabase.
import { yieldAnualizadoPct, dyMedioPct, yocMedioPct } from '../FrontEnd/src/lib/yieldCarteira'

describe('yieldAnualizadoPct', () => {
  it('CA-YLD01 — dividendo mensal × 12 ÷ base (mercado = DY, custo = YoC)', () => {
    expect(yieldAnualizadoPct(1, 100)).toBeCloseTo(12, 6)       // R$1/mês numa cota de R$100
    expect(yieldAnualizadoPct(1, 80)).toBeCloseTo(15, 6)        // mesmo dividendo, custo médio menor → YoC maior
  })

  it('CA-YLD02 — base zero, negativa ou ausente devolve null (nunca Infinity/NaN)', () => {
    expect(yieldAnualizadoPct(1, 0)).toBeNull()
    expect(yieldAnualizadoPct(1, -5)).toBeNull()
    expect(yieldAnualizadoPct(1, NaN)).toBeNull()
  })
})

describe('médias ponderadas', () => {
  it('CA-YLD03 — YoC médio pondera pelo custo (ativo grande pesa mais que o pequeno)', () => {
    const r = yocMedioPct([
      { yield_on_cost_pct: 10, valor_custo: 1000 },
      { yield_on_cost_pct: 2,  valor_custo: 3000 },
    ])
    expect(r).toBeCloseTo(4, 6)               // (10×1000 + 2×3000) / 4000; a média simples daria 6
  })

  it('CA-YLD04 — DY médio pondera pelo valor de mercado; lista vazia ou sem peso = 0', () => {
    expect(dyMedioPct([
      { dividend_yield_pct: 8, valor_mercado: 500 },
      { dividend_yield_pct: 4, valor_mercado: 1500 },
    ])).toBeCloseTo(5, 6)
    expect(dyMedioPct([])).toBe(0)
    expect(yocMedioPct([{ yield_on_cost_pct: 9, valor_custo: 0 }])).toBe(0)
  })
})
