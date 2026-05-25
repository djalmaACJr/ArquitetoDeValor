// supabase/functions/faturas/parsers/tipos.ts
//
// Contrato de parser de fatura: cada emissor (Nubank/Inter/C6/genérico)
// implementa este shape. A pipeline detecta o emissor pelo texto extraído
// do PDF e despacha para o parser correspondente.

/** Resultado de parsear UMA linha de lançamento da fatura. */
export interface ParsedLinha {
  /** Data da compra (YYYY-MM-DD). */
  data_compra:     string
  /** Descrição completa do lançamento (ex.: "UBER *TRIP HELP.UBER.COM"). */
  descricao:       string
  /** Estabelecimento extraído (opcional — varia por emissor). */
  estabelecimento?: string | null
  /** Valor em reais (sempre positivo; o sinal vem do tipo em transacoes). */
  valor:           number
  /** Parcela atual quando detectada (ex.: 3 em "3/10"). */
  parcela_atual?:  number | null
  /** Total de parcelas quando detectado (ex.: 10 em "3/10"). */
  parcela_total?:  number | null
  /** Observação livre do parser (ex.: "Cartão final 3690" do Nubank). */
  observacao?:     string | null
}

/** Resultado completo de parsear uma fatura. */
export interface ParsedFatura {
  /** Identificador do emissor detectado (ex.: "nubank", "inter", "generico"). */
  emissor:           string
  /** Vencimento da fatura (YYYY-MM-DD) — null se o parser não encontrar. */
  vencimento_fatura: string | null
  /** Valor total da fatura — null se o parser não encontrar. */
  valor_total:       number | null
  /** Lançamentos extraídos. Vazio se o parser não conseguir nenhum. */
  lancamentos:       ParsedLinha[]
  /** Mensagens informativas (parser usou fallback, formato suspeito, etc.). */
  avisos:            string[]
}

/** Interface implementada por cada parser de emissor. */
export interface ParserFatura {
  /** Identificador único (ex.: "nubank"). */
  id: string
  /**
   * Decide se este parser é o adequado para o texto extraído do PDF.
   * Tipicamente procura marcadores no cabeçalho (logo/cnpj/razão social).
   */
  detectar(texto: string): boolean
  /**
   * Faz o parse completo do texto da fatura. Sempre retorna um ParsedFatura
   * — mesmo que erros parciais ocorram, registra em `avisos` e retorna o
   * que conseguiu extrair.
   */
  parsear(texto: string): ParsedFatura
}
