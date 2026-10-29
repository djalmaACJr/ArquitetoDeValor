// ============================================================
// Cálculos de yield (DY / YoC) no frontend — fonte ÚNICA.
//
// O yield de CADA ativo (trailing 12m, padrão investidor10) vem pronto do
// backend (supabase/functions/investimentos/dashboard.ts: dividend_yield_pct /
// yield_on_cost_pct) — Deno não importa esta lib, então essa conta fica lá, uma
// vez só. Aqui ficam as duas contas que o frontend refaz:
//  - yield ANUALIZADO a partir de um dividendo por cota (simuladores);
//  - yield MÉDIO ponderado de um conjunto de ativos (quadros/rankings).
// ============================================================

/**
 * Yield anualizado (%) = dividendo mensal por cota (run-rate) × 12 ÷ base.
 * A `base` define o nome: preço de mercado → DY; custo médio (PM) → YoC; VP → DY a P/VP = 1.
 * null quando a base não é um número positivo.
 */
export function yieldAnualizadoPct(valorPorCota: number, base: number): number | null {
  return base > 0 ? ((valorPorCota * 12) / base) * 100 : null
}

interface ComDy  { dividend_yield_pct: number; valor_mercado: number }
interface ComYoc { yield_on_cost_pct: number; valor_custo: number }

function mediaPonderada(itens: { pct: number; peso: number }[]): number {
  const soma = itens.reduce((s, i) => s + i.peso, 0)
  return soma > 0 ? itens.reduce((s, i) => s + i.pct * i.peso, 0) / soma : 0
}

// Não é a média simples dos %: um ativo pequeno com yield alto não pode pesar
// igual a um grande. Equivale a Σdividendos ÷ Σbase, sem precisar do valor
// bruto do dividendo (só temos o % pronto em cada linha).

/** DY médio (%) ponderado pelo valor de mercado. */
export function dyMedioPct(itens: ComDy[]): number {
  return mediaPonderada(itens.map((i) => ({ pct: i.dividend_yield_pct, peso: i.valor_mercado })))
}

/** YoC médio (%) ponderado pelo custo. */
export function yocMedioPct(itens: ComYoc[]): number {
  return mediaPonderada(itens.map((i) => ({ pct: i.yield_on_cost_pct, peso: i.valor_custo })))
}
