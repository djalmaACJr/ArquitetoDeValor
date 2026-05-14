// src/lib/paretoAnalysis.ts
/**
 * Utilitários para análise de Paretto (80/20)
 * Identifica quais 20% de categorias causam 80% do volume de despesas/receitas
 */

export interface ItemParetto {
  categoria_id: string | null
  categoria_nome: string
  total: number
  percentual: number
  percentualAcumulado: number
  tipo: 'RECEITA' | 'DESPESA'
}

export interface ResumoParetto {
  total: number
  itens: ItemParetto[]
  itensAte80: ItemParetto[]
  itensAlem80: ItemParetto[]
  quantidadeCategorias: number
  quantidadeAte80: number
  quantidadeAlem80: number
  percentualCategorias80: number
  percentualCategorias20: number
}

/**
 * Calcula análise de Paretto para um conjunto de categorias
 * @param categorias Array de categorias com totais
 * @param tipo Tipo de transação (RECEITA ou DESPESA)
 * @returns Resumo da análise Paretto
 */
export function calcularParetto(
  categorias: Array<{ categoria_id: string | null; categoria_nome: string; total: number }>,
  tipo: 'RECEITA' | 'DESPESA'
): ResumoParetto {
  // Ordenar por total decrescente
  const ordenadas = [...categorias].sort((a, b) => b.total - a.total)

  // Calcular total geral
  const total = ordenadas.reduce((sum, c) => sum + c.total, 0)

  if (total === 0) {
    return {
      total: 0,
      itens: [],
      itensAte80: [],
      itensAlem80: [],
      quantidadeCategorias: 0,
      quantidadeAte80: 0,
      quantidadeAlem80: 0,
      percentualCategorias80: 0,
      percentualCategorias20: 0,
    }
  }

  // Calcular percentuais e acumulados
  let acumulado = 0
  const itens: ItemParetto[] = ordenadas.map(cat => {
    acumulado += cat.total
    return {
      categoria_id: cat.categoria_id,
      categoria_nome: cat.categoria_nome,
      total: cat.total,
      percentual: (cat.total / total) * 100,
      percentualAcumulado: (acumulado / total) * 100,
      tipo,
    }
  })

  // Separar itens até 80% de impacto
  const itensAte80 = itens.filter(i => i.percentualAcumulado <= 80)
  const itensAlem80 = itens.filter(i => i.percentualAcumulado > 80)

  // Se o primeiro item após 80% completa o 80%, incluí-lo nos "até 80"
  if (itensAlem80.length > 0 && itensAte80.length > 0) {
    const ultimoAte80 = itensAte80[itensAte80.length - 1]
    const proximoAlem = itensAlem80[0]
    if (ultimoAte80.percentualAcumulado < 80 && proximoAlem.percentualAcumulado >= 80) {
      itensAte80.push(itensAlem80.shift()!)
    }
  }

  const quantidadeCategorias = itens.length
  const quantidadeAte80 = itensAte80.length
  const quantidadeAlem80 = itensAlem80.length

  return {
    total,
    itens,
    itensAte80,
    itensAlem80,
    quantidadeCategorias,
    quantidadeAte80,
    quantidadeAlem80,
    percentualCategorias80: (quantidadeAte80 / quantidadeCategorias) * 100,
    percentualCategorias20: (quantidadeAlem80 / quantidadeCategorias) * 100,
  }
}

/**
 * Calcula cores para os items do Paretto (gradiente de impacto)
 */
export function getCorParetto(percentual: number, tipo: 'RECEITA' | 'DESPESA'): string {
  const corBase = tipo === 'RECEITA' ? '#00c896' : '#f87171'

  if (percentual >= 20) return corBase // Cor forte (20%+)
  if (percentual >= 10) return corBase + 'cc' // 80% opacity
  if (percentual >= 5) return corBase + '99' // 60% opacity
  return corBase + '66' // 40% opacity
}
