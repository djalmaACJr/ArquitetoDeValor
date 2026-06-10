// ============================================================
// Questionário de avaliação de ativos — definições por tipo
//
// Cada pergunta tem 5 opções (índice 0..4); quanto maior o índice,
// mais favorável a resposta. A nota final (0..10) é a média dos
// índices respondidos × 2.5. As respostas são persistidas em
// inv_ativos.questionario_respostas e a nota em nota_usuario.
// ============================================================
import type { TipoAtivoInvestimento } from './constants'

export interface PerguntaQuestionario {
  id:       string
  texto:    string
  opcoes:   [string, string, string, string, string]  // índice 0 (pior) → 4 (melhor)
}

// Perguntas comuns a todos os tipos de ativo
const PERGUNTAS_BASE: PerguntaQuestionario[] = [
  {
    id: 'horizonte',
    texto: 'Qual o seu horizonte de investimento para este ativo?',
    opcoes: ['Menos de 6 meses', '6 meses a 1 ano', '1 a 3 anos', '3 a 5 anos', 'Mais de 5 anos'],
  },
  {
    id: 'risco',
    texto: 'Como você avalia o risco deste ativo em relação à sua tolerância?',
    opcoes: ['Muito acima do que tolero', 'Acima', 'Compatível', 'Abaixo', 'Bem abaixo do que tolero'],
  },
  {
    id: 'retorno',
    texto: 'Qual a sua expectativa de retorno frente a alternativas similares?',
    opcoes: ['Bem pior', 'Pior', 'Na média', 'Melhor', 'Bem melhor'],
  },
  {
    id: 'liquidez',
    texto: 'A liquidez deste ativo atende à sua necessidade?',
    opcoes: ['Não atende', 'Atende mal', 'Atende parcialmente', 'Atende bem', 'Atende totalmente'],
  },
  {
    id: 'volatilidade',
    texto: 'Como você reagiria a uma queda forte (-20%) deste ativo?',
    opcoes: ['Venderia tudo', 'Venderia parte', 'Manteria', 'Compraria um pouco', 'Compraria agressivamente'],
  },
]

// Perguntas adicionais por tipo de ativo
const PERGUNTAS_POR_TIPO: Record<TipoAtivoInvestimento, PerguntaQuestionario[]> = {
  ACOES: [
    {
      id: 'fundamentos',
      texto: 'Como você avalia os fundamentos da empresa (lucro, dívida, governança)?',
      opcoes: ['Muito fracos', 'Fracos', 'Razoáveis', 'Bons', 'Excelentes'],
    },
    {
      id: 'setor',
      texto: 'Qual a perspectiva do setor da empresa?',
      opcoes: ['Em declínio', 'Estagnado', 'Estável', 'Em crescimento', 'Em forte expansão'],
    },
  ],
  ETF: [
    {
      id: 'custo_taxa',
      texto: 'Como a taxa de administração se compara a ETFs similares?',
      opcoes: ['Muito mais cara', 'Mais cara', 'Na média', 'Mais barata', 'Muito mais barata'],
    },
    {
      id: 'indice',
      texto: 'Qual a sua confiança no índice que o ETF replica?',
      opcoes: ['Nenhuma', 'Baixa', 'Média', 'Alta', 'Total'],
    },
  ],
  FII: [
    {
      id: 'vacancia',
      texto: 'Como está a vacância/inadimplência dos imóveis do fundo?',
      opcoes: ['Muito alta', 'Alta', 'Média', 'Baixa', 'Muito baixa'],
    },
    {
      id: 'dividendos_fii',
      texto: 'O histórico de distribuição de rendimentos é consistente?',
      opcoes: ['Muito irregular', 'Irregular', 'Razoável', 'Consistente', 'Muito consistente'],
    },
  ],
  STOCKS: [
    {
      id: 'gestao',
      texto: 'Como você avalia a qualidade da gestão da empresa?',
      opcoes: ['Muito ruim', 'Ruim', 'Mediana', 'Boa', 'Excelente'],
    },
    {
      id: 'crescimento',
      texto: 'Qual o potencial de crescimento do negócio?',
      opcoes: ['Nenhum', 'Baixo', 'Moderado', 'Alto', 'Muito alto'],
    },
  ],
  ETF_INTERNACIONAL: [
    {
      id: 'diversificacao_geo',
      texto: 'A diversificação geográfica do ETF agrega à sua carteira?',
      opcoes: ['Nada', 'Pouco', 'Moderadamente', 'Bastante', 'Muito'],
    },
    {
      id: 'cambio',
      texto: 'Como você avalia sua exposição cambial com este ativo?',
      opcoes: ['Desconfortável', 'Pouco confortável', 'Neutra', 'Confortável', 'Desejada'],
    },
  ],
  RENDA_FIXA: [
    {
      id: 'prazo_indexador',
      texto: 'O prazo e o indexador (CDI/IPCA/pré) combinam com seu objetivo?',
      opcoes: ['Não combinam', 'Combinam pouco', 'Parcialmente', 'Combinam bem', 'Perfeitamente'],
    },
    {
      id: 'credito',
      texto: 'Qual o risco de crédito do emissor?',
      opcoes: ['Muito alto', 'Alto', 'Médio', 'Baixo', 'Muito baixo (ou garantido FGC)'],
    },
  ],
  CRIPTOMOEDAS: [
    {
      id: 'adocao',
      texto: 'Qual o nível de adoção e utilidade real do projeto?',
      opcoes: ['Nenhum', 'Especulativo', 'Inicial', 'Crescente', 'Consolidado'],
    },
    {
      id: 'volatilidade_cripto',
      texto: 'O tamanho da posição é adequado para a volatilidade de cripto?',
      opcoes: ['Muito exposto', 'Exposto', 'No limite', 'Adequado', 'Bem dimensionado'],
    },
  ],
  TESOURO_DIRETO: [
    {
      id: 'vencimento',
      texto: 'O vencimento do título está alinhado ao seu objetivo?',
      opcoes: ['Desalinhado', 'Pouco alinhado', 'Parcialmente', 'Alinhado', 'Perfeitamente alinhado'],
    },
    {
      id: 'marcacao',
      texto: 'Você entende e aceita a marcação a mercado até o vencimento?',
      opcoes: ['Não entendo', 'Entendo pouco', 'Entendo', 'Entendo e aceito', 'Domino e uso a favor'],
    },
  ],
}

export function perguntasParaTipo(tipo: TipoAtivoInvestimento): PerguntaQuestionario[] {
  return [...PERGUNTAS_BASE, ...(PERGUNTAS_POR_TIPO[tipo] ?? [])]
}

// Nota 0..10 = média dos índices respondidos × 2.5 (1 casa decimal).
// Retorna null se nenhuma pergunta foi respondida.
export function calcularNotaQuestionario(
  tipo: TipoAtivoInvestimento,
  respostas: Record<string, number>,
): number | null {
  const perguntas = perguntasParaTipo(tipo)
  const validas = perguntas.filter((p) => Number.isInteger(respostas[p.id]) && respostas[p.id] >= 0 && respostas[p.id] <= 4)
  if (validas.length === 0) return null
  const soma = validas.reduce((s, p) => s + respostas[p.id], 0)
  return Math.round((soma / validas.length) * 2.5 * 10) / 10
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
