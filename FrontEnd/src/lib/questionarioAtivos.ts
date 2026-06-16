// ============================================================
// Questionário de avaliação de ativos — definições PADRÃO por tipo
//
// Cada pergunta pertence a um critério (Fundamentos / Crescimento /
// Pagadora de dividendos) e tem 5 opções (índice 0..4); quanto maior o
// índice, mais favorável a resposta. A nota final (0..10) é a média
// PONDERADA por critério (pesos somam 100).
//
// Este arquivo é a SEMENTE (default). O usuário pode sobrepor por tipo
// com um questionário customizado (manual ou gerado por IA) guardado em
// arqvalor.inv_questionarios — ver useInvQuestionarios.
//
// Respostas são persistidas em inv_ativos.questionario_respostas
// ({pergunta_id: indice 0..4}) e a nota em inv_ativos.nota_usuario.
// ============================================================
import type { TipoAtivoInvestimento } from './constants'
import { CRITERIOS_QUESTAO, PESOS_SUGERIDOS_POR_PERFIL } from './constants'
import type { PerguntaAvaliacao, PesosCriterio } from '../types'

// Pesos padrão quando não há perfil/custom — perfil Moderado (equilibrado).
export const PESOS_PADRAO: PesosCriterio = { ...PESOS_SUGERIDOS_POR_PERFIL.MODERADO }

// ── Perguntas base (comuns a todos os tipos) ───────────────────
// 10 perguntas cobrindo os 3 critérios. Garante o mínimo de 10 por tipo;
// tipos com perguntas específicas as acrescentam.
const PERGUNTAS_BASE: PerguntaAvaliacao[] = [
  // Fundamentos
  {
    id: 'f_solidez',
    criterio: 'FUNDAMENTOS',
    texto: 'Quão sólida é a saúde financeira do ativo/emissor (lucro, dívida, caixa)?',
    opcoes: ['Muito fraca', 'Fraca', 'Razoável', 'Boa', 'Excelente'],
  },
  {
    id: 'f_governanca',
    criterio: 'FUNDAMENTOS',
    texto: 'Como você avalia a governança, gestão e transparência?',
    opcoes: ['Muito ruim', 'Ruim', 'Mediana', 'Boa', 'Excelente'],
  },
  {
    id: 'f_risco',
    criterio: 'FUNDAMENTOS',
    texto: 'O risco deste ativo é compatível com a sua tolerância?',
    opcoes: ['Muito acima do que tolero', 'Acima', 'Compatível', 'Abaixo', 'Bem abaixo'],
  },
  {
    id: 'f_liquidez',
    criterio: 'FUNDAMENTOS',
    texto: 'A liquidez do ativo atende à sua necessidade de resgate?',
    opcoes: ['Não atende', 'Atende mal', 'Parcialmente', 'Atende bem', 'Atende totalmente'],
  },
  // Crescimento
  {
    id: 'c_perspectiva',
    criterio: 'CRESCIMENTO',
    texto: 'Qual a perspectiva de valorização no horizonte que pretende manter?',
    opcoes: ['Em queda', 'Estagnada', 'Estável', 'Em alta', 'Em forte alta'],
  },
  {
    id: 'c_setor',
    criterio: 'CRESCIMENTO',
    texto: 'Como está o momento do setor/segmento deste ativo?',
    opcoes: ['Em declínio', 'Estagnado', 'Estável', 'Em crescimento', 'Em forte expansão'],
  },
  {
    id: 'c_vantagem',
    criterio: 'CRESCIMENTO',
    texto: 'O ativo tem diferencial competitivo frente a alternativas similares?',
    opcoes: ['Nenhum', 'Pouco', 'Moderado', 'Forte', 'Muito forte'],
  },
  // Pagadora de dividendos
  {
    id: 'd_historico',
    criterio: 'DIVIDENDOS',
    texto: 'O histórico de distribuição de proventos é consistente?',
    opcoes: ['Não distribui', 'Muito irregular', 'Irregular', 'Consistente', 'Muito consistente'],
  },
  {
    id: 'd_sustentabilidade',
    criterio: 'DIVIDENDOS',
    texto: 'A distribuição é sustentável (não compromete o caixa/futuro do ativo)?',
    opcoes: ['Insustentável', 'Frágil', 'Razoável', 'Sustentável', 'Muito sólida'],
  },
  {
    id: 'd_yield',
    criterio: 'DIVIDENDOS',
    texto: 'O retorno em proventos (yield) é atrativo frente às alternativas?',
    opcoes: ['Bem abaixo', 'Abaixo', 'Na média', 'Acima', 'Bem acima'],
  },
]

// Perguntas específicas adicionais por tipo (enriquecem o default).
const PERGUNTAS_POR_TIPO: Partial<Record<TipoAtivoInvestimento, PerguntaAvaliacao[]>> = {
  ACOES: [
    { id: 'a_valuation', criterio: 'FUNDAMENTOS', texto: 'O preço atual está atrativo frente aos fundamentos (valuation)?',
      opcoes: ['Muito caro', 'Caro', 'Justo', 'Barato', 'Muito barato'] },
    { id: 'a_lucro', criterio: 'CRESCIMENTO', texto: 'Qual a tendência de crescimento de lucros da empresa?',
      opcoes: ['Em queda', 'Estagnado', 'Leve alta', 'Crescente', 'Forte crescimento'] },
  ],
  FII: [
    { id: 'fii_vacancia', criterio: 'FUNDAMENTOS', texto: 'Como está a vacância/inadimplência dos imóveis do fundo?',
      opcoes: ['Muito alta', 'Alta', 'Média', 'Baixa', 'Muito baixa'] },
    { id: 'fii_pvp', criterio: 'CRESCIMENTO', texto: 'O preço sobre valor patrimonial (P/VP) está favorável?',
      opcoes: ['Muito acima', 'Acima', 'Em linha', 'Abaixo', 'Bem abaixo'] },
  ],
  REIT: [
    { id: 'reit_ocupacao', criterio: 'FUNDAMENTOS', texto: 'Como está a taxa de ocupação dos imóveis do REIT?',
      opcoes: ['Muito baixa', 'Baixa', 'Média', 'Alta', 'Muito alta'] },
  ],
  RENDA_FIXA: [
    { id: 'rf_credito', criterio: 'FUNDAMENTOS', texto: 'Qual o risco de crédito do emissor?',
      opcoes: ['Muito alto', 'Alto', 'Médio', 'Baixo', 'Muito baixo (ou FGC)'] },
    { id: 'rf_indexador', criterio: 'CRESCIMENTO', texto: 'O indexador/taxa combina com o seu objetivo e o cenário?',
      opcoes: ['Não combina', 'Combina pouco', 'Parcialmente', 'Combina bem', 'Perfeito'] },
  ],
  TESOURO_DIRETO: [
    { id: 'td_vencimento', criterio: 'FUNDAMENTOS', texto: 'O vencimento do título está alinhado ao seu objetivo?',
      opcoes: ['Desalinhado', 'Pouco alinhado', 'Parcialmente', 'Alinhado', 'Perfeito'] },
  ],
  CRIPTOMOEDAS: [
    { id: 'cripto_adocao', criterio: 'CRESCIMENTO', texto: 'Qual o nível de adoção e utilidade real do projeto?',
      opcoes: ['Nenhum', 'Especulativo', 'Inicial', 'Crescente', 'Consolidado'] },
  ],
}

// Perguntas PADRÃO (semente) de um tipo: base + específicas. Sempre ≥10.
export function perguntasPadrao(tipo: TipoAtivoInvestimento): PerguntaAvaliacao[] {
  return [...PERGUNTAS_BASE, ...(PERGUNTAS_POR_TIPO[tipo] ?? [])]
}

// ── Cálculo da nota (média ponderada por critério) ─────────────
// Nota de cada critério = média dos índices respondidos × 2.5 (0..10).
// Nota final = média ponderada pelos pesos dos critérios COM resposta.
// Se nenhum critério com peso > 0 tiver resposta, cai para média simples.
// Retorna null quando nenhuma pergunta foi respondida.
export function calcularNota(
  perguntas: PerguntaAvaliacao[],
  pesos: PesosCriterio,
  respostas: Record<string, number>,
): number | null {
  const notasPorCriterio = new Map<string, number>()
  for (const criterio of CRITERIOS_QUESTAO) {
    const doCriterio = perguntas.filter(
      (p) => p.criterio === criterio &&
        Number.isInteger(respostas[p.id]) && respostas[p.id] >= 0 && respostas[p.id] <= 4,
    )
    if (doCriterio.length === 0) continue
    const soma = doCriterio.reduce((s, p) => s + respostas[p.id], 0)
    notasPorCriterio.set(criterio, (soma / doCriterio.length) * 2.5)
  }
  if (notasPorCriterio.size === 0) return null

  let somaPond = 0
  let somaPeso = 0
  for (const [criterio, nota] of notasPorCriterio) {
    const peso = Math.max(0, pesos[criterio as keyof PesosCriterio] ?? 0)
    somaPond += nota * peso
    somaPeso += peso
  }
  // Fallback: critérios respondidos têm peso 0 → média simples entre eles.
  if (somaPeso === 0) {
    const media = [...notasPorCriterio.values()].reduce((s, n) => s + n, 0) / notasPorCriterio.size
    return Math.round(media * 10) / 10
  }
  return Math.round((somaPond / somaPeso) * 10) / 10
}

// ── Recomendação de compra ────────────────────────────────────
// Combina a nota do usuário (qualidade do ativo) com o desvio da
// alocação ideal do TIPO (desvio negativo = abaixo da meta = espaço
// para comprar). Sem nota ou sem meta definida → sem recomendação.

export type Recomendacao = 'COMPRAR' | 'NEUTRO' | 'AGUARDAR'

export function recomendacaoCompra(
  nota: number | null,
  desvioPct: number | null,        // percentual_atual - percentual_ideal do tipo
): { recomendacao: Recomendacao; motivo: string } | null {
  if (nota == null || desvioPct == null) return null

  const notaBoa     = nota >= 7
  const notaRuim    = nota < 5
  const abaixoMeta  = desvioPct < -2   // mais de 2 p.p. abaixo da alocação ideal
  const acimaMeta   = desvioPct > 2

  if (notaBoa && abaixoMeta) {
    return { recomendacao: 'COMPRAR', motivo: 'Nota alta e tipo abaixo da alocação ideal' }
  }
  if (notaRuim || acimaMeta) {
    return {
      recomendacao: 'AGUARDAR',
      motivo: notaRuim ? 'Nota baixa — reavalie o ativo' : 'Tipo acima da alocação ideal',
    }
  }
  return { recomendacao: 'NEUTRO', motivo: 'Nota e alocação dentro do esperado' }
}
