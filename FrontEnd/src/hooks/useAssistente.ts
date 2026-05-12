// src/hooks/useAssistente.ts
// Assistente de Lançamentos — busca/upsert de "lançamentos padrão" do usuário.
// Endpoint: /assistente (edge function).
import { apiFetch, apiMutate } from '../lib/api'
import { log } from '../lib/logger'

export interface SugestaoLancamento {
  id:                string
  descricao:         string
  categoria_id:      string | null
  conta_origem_id:   string | null
  conta_destino_id:  string | null
  is_transferencia:  boolean
  atualizado_em:     string
}

interface UpsertPayload {
  descricao:         string
  categoria_id?:     string | null
  conta_origem_id?:  string | null
  conta_destino_id?: string | null
  is_transferencia:  boolean
}

/**
 * Busca sugestões compatíveis com o termo digitado.
 * - Mínimo 2 caracteres (a edge function também valida).
 * - Ordenado por `atualizado_em DESC` — o mais recente vem primeiro.
 * - Retorna `[]` se não houver sugestão ou em caso de erro.
 * - Aceita `AbortSignal` para cancelar buscas obsoletas durante a digitação.
 */
export async function buscarSugestoes(
  termo: string,
  signal?: AbortSignal,
): Promise<SugestaoLancamento[]> {
  if (termo.trim().length < 2) return []
  const res = await apiFetch<SugestaoLancamento[]>(
    `/assistente?termo=${encodeURIComponent(termo.trim())}`,
    signal,
  )
  log('[assistente] busca:', { termo, ok: res.ok, status: res.status, erro: res.erro, dados: res.dados })
  if (!res.ok) return []
  if (!res.dados) return []
  return Array.isArray(res.dados) ? res.dados : []
}

/**
 * Insere ou atualiza (por descrição, case-insensitive) um padrão de lançamento.
 */
export async function salvarSugestao(payload: UpsertPayload) {
  const res = await apiMutate<SugestaoLancamento>('/assistente', 'POST', payload)
  return { ok: res.ok, erro: res.erro, dados: res.dados }
}

/**
 * Remove um padrão salvo (uso futuro — ex.: tela de gerenciamento).
 */
export async function excluirSugestao(id: string) {
  const res = await apiMutate(`/assistente/${id}`, 'DELETE')
  return { ok: res.ok, erro: res.erro }
}
