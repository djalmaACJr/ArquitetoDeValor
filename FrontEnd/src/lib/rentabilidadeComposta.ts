// src/lib/rentabilidadeComposta.ts
// Composição mensal de retorno de um GRUPO de posições, LÍQUIDA de fluxo de
// aporte/resgate — extraído do QuadroRentabilidadeIndices.tsx (achado
// ago/2026: nunca somar % por ativo/mês e só depois agregar — some os R$ de
// TODOS os itens do grupo primeiro, mês a mês, e só então compõe os meses
// entre si por juros compostos) para ser reutilizado por qualquer tela que
// precise "quanto rendeu esse mês/período" a partir de `inv_historico_mensal`,
// sem duplicar o método uma 3ª vez com risco de divergir da versão corrigida.
//
// ⚠️ `inv_historico_mensal.rentabilidade_mes` NÃO é uma porcentagem — é o
// ganho em R$ do mês, líquido de fluxos (calcularDesempenho() em
// snapshot.ts: `rentab = valor_mercado − valor_mercado_ANTERIOR − fluxo`).
// `variacao_percentual` é esse ganho ÷ valor_mercado do MÊS ANTERIOR. As duas
// colunas juntas permitem reconstruir o valor de início do mês sem precisar
// buscar o snapshot anterior: início = ganho ÷ (variação / 100).
import type { InvestimentoHistoricoMensal } from '../types'

export interface AccGanhoInicio { ganho: number; inicio: number }

type LinhaHistorico = Pick<InvestimentoHistoricoMensal, 'mes_ano' | 'rentabilidade_mes' | 'variacao_percentual'>

// Acumula {ganho R$, início R$} por mês para um conjunto de linhas de
// histórico já filtrado (por tipo/conta/ativo, como o chamador precisar) —
// soma TODOS os itens do grupo antes de qualquer composição entre meses.
export function acumularGanhoInicioPorMes(historico: LinhaHistorico[]): Map<string, AccGanhoInicio> {
  const porMes = new Map<string, AccGanhoInicio>()
  for (const h of historico) {
    const ganhoRS = Number(h.rentabilidade_mes) || 0
    const pct     = Number(h.variacao_percentual) || 0
    // pct === 0 só acontece quando não há "mês anterior" pra comparar (1º
    // snapshot do ativo — mesma guarda de calcularDesempenho, onde ganhoRS
    // também sai 0) — sem um "início" confiável pra reconstruir, a linha não
    // entra no denominador (efeito neutro, não zera o grupo).
    const inicio = pct !== 0 ? ganhoRS / (pct / 100) : 0
    const cur = porMes.get(h.mes_ano) ?? { ganho: 0, inicio: 0 }
    cur.ganho  += ganhoRS
    cur.inicio += inicio
    porMes.set(h.mes_ano, cur)
  }
  return porMes
}

// % de retorno de CADA mês a partir do acumulado acima — Σganho ÷ Σinício,
// nunca a média dos % individuais.
export function retornoPorMes(porMes: Map<string, AccGanhoInicio>): Map<string, number> {
  const out = new Map<string, number>()
  for (const [mes, v] of porMes) out.set(mes, v.inicio > 0 ? (v.ganho / v.inicio) * 100 : 0)
  return out
}

// Compõe (juros compostos) os % mensais de uma janela de meses num único %.
// Meses sem dado no mapa (fora da série conhecida) contam 0%.
export function comporRetornoMensal(meses: string[], retorno: Map<string, number>): number {
  return (meses.reduce((acc, m) => acc * (1 + (retorno.get(m) ?? 0) / 100), 1) - 1) * 100
}

// Compõe (juros compostos) uma janela de {ganho, início} diretamente —
// usado quando só interessa o resultado agregado da janela (ex.: só 1 mês,
// como o "Δ vs mês anterior"), não a série mês a mês inteira. Meses sem
// "início" válido (nenhum item do grupo com posição no mês) são ignorados,
// não zerados. `meses` omitido = usa todos os meses do mapa.
export function comporGrupo(
  porMes: Map<string, AccGanhoInicio>, meses?: string[],
): { pct: number; ganho: number } | null {
  let acc = 1, ganhoTotal = 0, achouAlgum = false
  const chaves = [...(meses ?? porMes.keys())].sort()
  for (const mes of chaves) {
    const v = porMes.get(mes)
    if (!v || !(v.inicio > 0)) continue
    acc *= 1 + v.ganho / v.inicio
    ganhoTotal += v.ganho
    achouAlgum = true
  }
  return achouAlgum ? { pct: (acc - 1) * 100, ganho: ganhoTotal } : null
}
