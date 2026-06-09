// src/lib/constants.ts
// Fonte única de enums do domínio. Manter sincronizado com:
//   supabase/migrations/* (CHECK constraints e ENUMs)
//   supabase/functions/_shared/utils.ts e edge functions (validações)

// ── Tipos de conta ───────────────────────────────────────────
export const TIPOS_CONTA = ['CORRENTE', 'REMUNERACAO', 'CARTAO', 'INVESTIMENTO', 'CARTEIRA'] as const
export type TipoConta = typeof TIPOS_CONTA[number]

// ── Tipos de transação ───────────────────────────────────────
export const TIPOS_TX = ['RECEITA', 'DESPESA'] as const
export type TipoTransacao = typeof TIPOS_TX[number]

// Tipo estendido usado no DrawerLancamento (transferência é UI-only;
// no banco vira par RECEITA + DESPESA)
export const TIPOS_LANCAMENTO_UI = ['RECEITA', 'DESPESA', 'TRANSFERENCIA'] as const
export type TipoLancamentoUI = typeof TIPOS_LANCAMENTO_UI[number]

// ── Status de transação ──────────────────────────────────────
export const STATUS_TX = ['PAGO', 'PENDENTE', 'PROJECAO'] as const
export type StatusTransacao = typeof STATUS_TX[number]

// ── Frequências de recorrência ───────────────────────────────
export const FREQUENCIAS = ['DIARIA', 'SEMANAL', 'MENSAL', 'ANUAL'] as const
export type Frequencia = typeof FREQUENCIAS[number]

// ── Escopos de edição/exclusão de série recorrente ───────────
export const ESCOPOS_EDICAO = ['SOMENTE_ESTE', 'ESTE_E_SEGUINTES', 'TODOS'] as const
export type EscopoEdicao = typeof ESCOPOS_EDICAO[number]

// ── Tipo de recorrência (interno do banco) ───────────────────
export const TIPOS_RECORRENCIA_BANCO = ['PARCELA', 'PROJECAO'] as const
export type TipoRecorrenciaBanco = typeof TIPOS_RECORRENCIA_BANCO[number]

// ── Objetivos Financeiros ─────────────────────────────────────
export const TIPOS_OBJETIVO = ['SONHO', 'OBJETIVO', 'PROJETO', 'CRESCIMENTO'] as const
export type TipoObjetivo = typeof TIPOS_OBJETIVO[number]

export const STATUS_OBJETIVO = ['EM_PROGRESSO', 'ATINGIDO', 'CANCELADO'] as const
export type StatusObjetivo = typeof STATUS_OBJETIVO[number]

// ── Investimentos ─────────────────────────────────────────────
export const TIPOS_ATIVO_INV = [
  'ACOES', 'ETF', 'FII', 'STOCKS',
  'ETF_INTERNACIONAL', 'RENDA_FIXA', 'CRIPTOMOEDAS', 'TESOURO_DIRETO',
] as const
export type TipoAtivoInvestimento = typeof TIPOS_ATIVO_INV[number]

export const STATUS_POSICAO_INV = ['ATIVA', 'ENCERRADA'] as const
export type StatusPosicaoInvestimento = typeof STATUS_POSICAO_INV[number]

export const TIPOS_OPERACAO_INV = ['COMPRA', 'VENDA', 'APORTE', 'RESGATE', 'DIVIDENDO'] as const
export type TipoOperacaoInvestimento = typeof TIPOS_OPERACAO_INV[number]

// Rótulos amigáveis e cor consistente por tipo de ativo
export const TIPO_ATIVO_LABEL: Record<TipoAtivoInvestimento, string> = {
  ACOES:             'Ações',
  ETF:               'ETF',
  FII:               'FIIs',
  STOCKS:            'Stocks',
  ETF_INTERNACIONAL: 'ETF Internacional',
  RENDA_FIXA:        'Renda Fixa',
  CRIPTOMOEDAS:      'Criptomoedas',
  TESOURO_DIRETO:    'Tesouro Direto',
}

export const TIPO_ATIVO_COR: Record<TipoAtivoInvestimento, string> = {
  ACOES:             '#3b82f6',
  ETF:               '#06b6d4',
  FII:               '#00c896',
  STOCKS:            '#8b5cf6',
  ETF_INTERNACIONAL: '#ec4899',
  RENDA_FIXA:        '#f59e0b',
  CRIPTOMOEDAS:      '#f97316',
  TESOURO_DIRETO:    '#10b981',
}
