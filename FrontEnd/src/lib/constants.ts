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
