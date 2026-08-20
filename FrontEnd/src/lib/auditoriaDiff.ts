// src/lib/auditoriaDiff.ts
//
// Helpers puros pra interpretar um evento da trilha de auditoria
// (arqvalor.trilha_auditoria) — separados de components/ui/DiffAuditoria.tsx
// porque um arquivo .tsx só pode exportar componentes (react-refresh/
// only-export-components) sem perder o Fast Refresh.

export type OperacaoAuditoriaDiff = 'INSERT' | 'UPDATE' | 'DELETE'

export interface ItemDiffAuditoria {
  operacao:      OperacaoAuditoriaDiff
  dados_antigos: Record<string, unknown> | null
  dados_novos:   Record<string, unknown> | null
}

export const MUTED_AUDITORIA = '#8b92a8'

// Campos internos que não ajudam a entender "o que mudou" — poluem o diff.
export const CAMPOS_OMITIDOS_AUDITORIA = new Set(['id', 'user_id', 'criado_em', 'atualizado_em', 'ano_tx', 'mes_tx'])

// Nome do campo cru (coluna do banco) → rótulo amigável no diff. Sem
// entrada aqui, mostra o nome cru mesmo (fallback).
const LABEL_CAMPO: Record<string, string> = {
  conta_id: 'conta',
}

export function labelCampoAuditoria(campo: string): string {
  return LABEL_CAMPO[campo] ?? campo
}

export function formatValorAuditoria(v: unknown): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

// Para UPDATE, devolve só os campos que realmente mudaram (antes → depois).
export function camposAlteradosAuditoria(
  antigos: Record<string, unknown> | null, novos: Record<string, unknown> | null,
): { campo: string; de: unknown; para: unknown }[] {
  const chaves = new Set([...Object.keys(antigos ?? {}), ...Object.keys(novos ?? {})])
  const out: { campo: string; de: unknown; para: unknown }[] = []
  for (const k of chaves) {
    if (CAMPOS_OMITIDOS_AUDITORIA.has(k)) continue
    const de = antigos?.[k]
    const para = novos?.[k]
    if (JSON.stringify(de) !== JSON.stringify(para)) out.push({ campo: k, de, para })
  }
  return out
}
