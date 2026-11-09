// Oportunidades de compra da página Destaques (lib pura, sem rede/Supabase).
import { calcularOportunidadesCompra } from '../FrontEnd/src/lib/oportunidadesCompra'
import type { InvestimentoRankingAtivo, InvestimentoDashboardTipo } from '../FrontEnd/src/types'

function ativo(p: Partial<InvestimentoRankingAtivo> & { ativo_id: string }): InvestimentoRankingAtivo {
  return {
    ticker: p.ativo_id, nome: p.ativo_id, tipo_ativo: 'FII', quantidade: 10, nota_usuario: 8,
    valor_custo: 1000, valor_mercado: 800, participacao_pct: 1,
    ...p,
  } as InvestimentoRankingAtivo
}
const tipoFII = (o: Partial<InvestimentoDashboardTipo> = {}): InvestimentoDashboardTipo => ({
  tipo_ativo: 'FII', valor_custo: 0, valor_mercado: 1600, ganho_perda: 0, rentabilidade_pct: 0, dividendos: 0,
  percentual_atual: 16, percentual_ideal: 30, desvio_pct: -14, ...o,
} as InvestimentoDashboardTipo)

describe('oportunidades de compra', () => {
  it('CA-OPC01 — só entra ativo COMPRAR com preço atual abaixo do médio', () => {
    const r = calcularOportunidadesCompra([
      ativo({ ativo_id: 'A' }),                                  // PA 80 < PM 100 → entra
      ativo({ ativo_id: 'B', valor_mercado: 1200 }),             // PA 120 > PM 100 → fora
      ativo({ ativo_id: 'C', nota_usuario: 4 }),                 // nota ruim → fora
    ], [tipoFII()], 10000)
    expect(r.map((o) => o.ativo.ativo_id)).toEqual(['A'])
    expect(r[0].precoMedio).toBe(100)
    expect(r[0].precoAtual).toBe(80)
  })

  it('CA-OPC02 — tipo sem meta ou acima da meta não gera oportunidade', () => {
    const a = [ativo({ ativo_id: 'A' })]
    expect(calcularOportunidadesCompra(a, [tipoFII({ percentual_ideal: 0 })], 10000)).toEqual([])
    expect(calcularOportunidadesCompra(a, [tipoFII({ desvio_pct: 5 })], 10000)).toEqual([])
  })

  it('CA-OPC03 — valor sugerido = fatia ideal do ativo − valor atual, limitado ao que falta pro tipo', () => {
    // meta 30% de 10.000 = 3.000 rateada pela nota (A=8, B=8 → 1.500 cada)
    const dois = [ativo({ ativo_id: 'A' }), ativo({ ativo_id: 'B' })]
    const r = calcularOportunidadesCompra(dois, [tipoFII()], 10000)
    expect(r[0].valorSugerido).toBe(700)            // 1500 − 800
    // tipo só falta 300 pra meta → teto no limite do tipo
    const limitado = calcularOportunidadesCompra(dois, [tipoFII({ valor_mercado: 2700 })], 10000)
    expect(limitado[0].valorSugerido).toBe(300)
  })

  it('CA-OPC04 — nunca sugere valor negativo', () => {
    const r = calcularOportunidadesCompra([ativo({ ativo_id: 'A', valor_mercado: 900 })], [tipoFII({ percentual_ideal: 8, desvio_pct: -1.5, valor_mercado: 500 })], 10000)
    expect(r[0].valorSugerido).toBeGreaterThanOrEqual(0)
  })
})
