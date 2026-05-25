// supabase/functions/faturas/parsers/helpers.ts
//
// Helpers compartilhados entre os parsers de fatura. Mantém regras de
// formato BR centralizadas para que os parsers por emissor fiquem só
// com a lógica específica do layout deles.

/**
 * Converte "1.234,56" → 1234.56. Aceita variações com/sem milhares,
 * sinal opcional, R$ no início. Devolve NaN se a string não bater.
 */
export function parseValorBR(s: string): number {
  const limpo = s
    .replace(/r\$/i, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')   // remove separador de milhar
    .replace(',', '.')    // vírgula decimal → ponto
  const n = Number(limpo)
  return Number.isFinite(n) ? n : NaN
}

/**
 * "DD/MM/YYYY" ou "DD/MM" → "YYYY-MM-DD".
 *
 * Quando o ano vier omitido (formato curto comum em faturas), assume
 * o ano da fatura passado em `anoFatura`. Se o mês da compra for maior
 * que o mês da fatura+1, considera-se que veio do ano anterior (ex.:
 * fatura de janeiro com compras de dezembro).
 */
export function parseDataBR(s: string, anoFatura?: number, mesFatura?: number): string | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/)
  if (!m) return null
  const dia = parseInt(m[1], 10)
  const mes = parseInt(m[2], 10)
  let ano: number
  if (m[3]) {
    ano = parseInt(m[3], 10)
    if (ano < 100) ano += 2000
  } else if (anoFatura) {
    ano = anoFatura
    // Heurística: se mês da compra > mês da fatura, é do ano anterior
    if (mesFatura && mes > mesFatura) ano -= 1
  } else {
    return null
  }
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

/**
 * Detecta parcelas em descrições como:
 *   "PARC 03/10"   "3/10"   "PARCELA 3 DE 10"   "(3 de 10)"   "3 DE 10"
 * Retorna { atual, total } ou null se nada bater.
 *
 * Ignora padrões "MM/YY" e "DD/MM" para não confundir parcela com data
 * — só aceita quando o segundo número ≤ 60 (limite razoável de parcelas).
 */
export function detectarParcelas(descricao: string): { atual: number; total: number } | null {
  const t = descricao.toUpperCase()

  // "PARC 3/10" ou "PARCELA 3/10"
  let m = t.match(/PARC(?:ELA)?\s*(\d{1,2})\s*\/\s*(\d{1,2})/)
  if (m) return mkParcela(m[1], m[2])

  // "3 DE 10" / "3DE10"
  m = t.match(/\b(\d{1,2})\s*DE\s*(\d{1,2})\b/)
  if (m) return mkParcela(m[1], m[2])

  // "(3/10)" entre parênteses
  m = t.match(/\((\d{1,2})\s*\/\s*(\d{1,2})\)/)
  if (m) return mkParcela(m[1], m[2])

  // "X/Y" solto — só quando Y é plausível como total de parcelas
  m = t.match(/\b(\d{1,2})\s*\/\s*(\d{1,2})\b/)
  if (m) {
    const total = parseInt(m[2], 10)
    if (total >= 2 && total <= 60) return mkParcela(m[1], m[2])
  }

  return null
}

function mkParcela(atual: string, total: string): { atual: number; total: number } | null {
  const a = parseInt(atual, 10)
  const t = parseInt(total, 10)
  if (!Number.isInteger(a) || !Number.isInteger(t)) return null
  if (a < 1 || t < 1 || a > t) return null
  return { atual: a, total: t }
}

/**
 * Tenta extrair o vencimento da fatura procurando padrões comuns:
 *   "Vencimento: DD/MM/YYYY", "Vence em DD/MM", "Data de pagamento DD/MM/YYYY"
 */
export function extrairVencimento(texto: string): string | null {
  const padroes = [
    /vencimento[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /vence\s+em[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /data\s+de\s+pagamento[:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /pagamento\s+at[éé][:\s]+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ]
  for (const re of padroes) {
    const m = texto.match(re)
    if (m) {
      const d = parseDataBR(m[1])
      if (d) return d
    }
  }
  return null
}

/**
 * Tenta extrair o valor total da fatura. Aceita variações como:
 *   "Total da fatura: R$ 1.234,56"
 *   "Valor total: 1.234,56"
 *   "Total a pagar  R$ 1.234,56"
 */
export function extrairValorTotal(texto: string): number | null {
  const padroes = [
    /total\s+da\s+fatura[:\s]+R?\$?\s*([\d.,]+)/i,
    /valor\s+total[:\s]+R?\$?\s*([\d.,]+)/i,
    /total\s+a\s+pagar[:\s]+R?\$?\s*([\d.,]+)/i,
  ]
  for (const re of padroes) {
    const m = texto.match(re)
    if (m) {
      const v = parseValorBR(m[1])
      if (Number.isFinite(v) && v > 0) return v
    }
  }
  return null
}

/**
 * Quebra um bloco de texto em linhas removendo espaços extras. Útil
 * porque a saída do unpdf concatena com `\n` mas pode ter espaços
 * múltiplos dentro da mesma linha.
 */
export function normalizarLinhas(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(l => l.length > 0)
}
