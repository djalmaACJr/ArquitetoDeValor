// ============================================================
// Perfil de investidor — mini-questionário de risco (suitability)
//
// Deriva o perfil (CONSERVADOR | MODERADO | ARROJADO) combinando a
// tolerância a risco (respostas do quiz) com o horizonte até a
// aposentadoria (quanto mais longe, maior a capacidade de arriscar).
// Usado na tela de Configurações de Investimentos.
// ============================================================
import type { PerfilInvestidorTipo } from './constants'

export interface PerguntaSuitability {
  id:     string
  texto:  string
  // 5 opções ordenadas: índice 0 = mais conservador, 4 = mais arrojado.
  opcoes: [string, string, string, string, string]
}

export const PERGUNTAS_SUITABILITY: PerguntaSuitability[] = [
  {
    id: 's_reacao_queda',
    texto: 'Se seus investimentos caíssem 20% em um mês, o que você faria?',
    opcoes: ['Venderia tudo', 'Venderia parte', 'Manteria', 'Compraria um pouco', 'Compraria bastante'],
  },
  {
    id: 's_objetivo',
    texto: 'Qual frase melhor descreve seu objetivo principal?',
    opcoes: [
      'Preservar o que tenho, sem perdas',
      'Render um pouco acima da poupança',
      'Crescer com equilíbrio entre risco e retorno',
      'Crescer acima da média, aceitando oscilações',
      'Maximizar o retorno, mesmo com risco alto',
    ],
  },
  {
    id: 's_experiencia',
    texto: 'Qual a sua experiência com investimentos de risco (ações, FIIs, cripto)?',
    opcoes: ['Nenhuma', 'Pouca', 'Alguma', 'Boa', 'Avançada'],
  },
  {
    id: 's_volatilidade',
    texto: 'Quanto de oscilação no valor da carteira você tolera ao longo do ano?',
    opcoes: ['Quase nenhuma', 'Pequena', 'Moderada', 'Grande', 'Muito grande'],
  },
  {
    id: 's_reserva',
    texto: 'Você possui reserva de emergência separada destes investimentos?',
    opcoes: ['Não tenho', 'Menos de 3 meses', '3 a 6 meses', '6 a 12 meses', 'Mais de 12 meses'],
  },
]

// Pontua o horizonte (anos até aposentar) numa escala 0..100.
// Mais anos = maior capacidade de assumir risco.
function scoreHorizonte(anos: number): number {
  if (anos <= 3)  return 0
  if (anos <= 8)  return 30
  if (anos <= 15) return 55
  if (anos <= 25) return 80
  return 100
}

export interface ResultadoPerfil {
  perfil:    PerfilInvestidorTipo
  score:     number   // 0..100 (quanto maior, mais arrojado)
  horizonte: number   // anos até a aposentadoria
}

// Deriva o perfil a partir das respostas + idade/aposentadoria.
// `respostas` mapeia pergunta_id → índice 0..4. Perguntas sem resposta
// são ignoradas no cálculo da tolerância.
export function derivarPerfil(
  respostas: Record<string, number>,
  idade: number | null,
  idadeAposentadoria: number | null,
): ResultadoPerfil {
  const validas = PERGUNTAS_SUITABILITY.filter(
    (p) => Number.isInteger(respostas[p.id]) && respostas[p.id] >= 0 && respostas[p.id] <= 4,
  )
  // Tolerância a risco: média dos índices (0..4) escalada para 0..100.
  const risco = validas.length
    ? (validas.reduce((s, p) => s + respostas[p.id], 0) / validas.length / 4) * 100
    : 50

  const horizonte = idade != null && idadeAposentadoria != null
    ? Math.max(0, idadeAposentadoria - idade)
    : 0
  const horizScore = idade != null && idadeAposentadoria != null ? scoreHorizonte(horizonte) : 50

  // Tolerância pesa mais que a capacidade dada pelo horizonte.
  const score = Math.round(0.65 * risco + 0.35 * horizScore)

  const perfil: PerfilInvestidorTipo =
    score < 34 ? 'CONSERVADOR' : score < 67 ? 'MODERADO' : 'ARROJADO'

  return { perfil, score, horizonte }
}
