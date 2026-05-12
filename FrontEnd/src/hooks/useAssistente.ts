// src/hooks/useAssistente.ts
// Assistente de Lançamentos — busca/upsert de "lançamentos padrão" do usuário.
// Endpoint: /assistente (edge function).
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
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
 * Lista todos os padrões salvos do usuário (sem filtro de termo).
 * Usado pelo atalho Ctrl+Espaço quando o campo descrição está vazio ou curto.
 */
export async function buscarTodasSugestoes(): Promise<SugestaoLancamento[]> {
  const res = await apiFetch<SugestaoLancamento[]>('/assistente')
  if (!res.ok) return []
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
 * Remove um padrão salvo.
 */
export async function excluirSugestao(id: string) {
  const res = await apiMutate(`/assistente/${id}`, 'DELETE')
  return { ok: res.ok, erro: res.erro }
}

/**
 * Atualiza campos de um padrão existente (por ID).
 */
export async function editarSugestao(
  id: string,
  payload: Partial<Pick<SugestaoLancamento, 'descricao' | 'categoria_id' | 'conta_origem_id'>>,
) {
  const res = await apiMutate<SugestaoLancamento>(`/assistente/${id}`, 'PUT', payload)
  return { ok: res.ok, erro: res.erro, dados: res.dados }
}

/**
 * Hook para listar todos os padrões salvos do usuário (para o gerenciador).
 * Retorna também mutações com invalidação automática do cache.
 */
export function useSugestoes() {
  const qc = useQueryClient()

  const { data: sugestoes = [], isLoading: carregando } = useQuery({
    queryKey: qk.assistente(),
    queryFn:  async () => {
      const res = await apiFetch<SugestaoLancamento[]>('/assistente')
      if (!res.ok) return []
      return Array.isArray(res.dados) ? res.dados : []
    },
    staleTime: 30_000,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: qk.assistente() })

  const editar = async (id: string, descricao: string) => {
    const r = await editarSugestao(id, { descricao })
    if (r.ok) await invalidar()
    return r
  }

  const excluir = async (id: string) => {
    const r = await excluirSugestao(id)
    if (r.ok) await invalidar()
    return r
  }

  const excluirTodas = async () => {
    await Promise.all(sugestoes.map(s => excluirSugestao(s.id)))
    await invalidar()
  }

  return { sugestoes, carregando, editar, excluir, excluirTodas }
}
