// src/hooks/useFaturasImport.ts
//
// Hook para o submenu "Importação de Fatura de Cartão" (Ferramentas).
// Gerencia o ciclo: upload do PDF → sessão sandbox → revisão de itens →
// confirmação. F1 (esta versão) entrega upload + listagem + edição básica
// de item. F2 acopla o parser PDF; F3 conclui o ciclo de confirmação.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import { supabase } from '../lib/supabase'
import type {
  FaturaImportSessao, FaturaImportItem, DecisaoFaturaImport,
} from '../types'

interface OpResult<T = unknown> { ok: boolean; dados: T | null; erro: string | null }

async function fetchSessoes(): Promise<FaturaImportSessao[]> {
  const res = await apiFetch<FaturaImportSessao[]>('/faturas')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar sessões de importação')
  return res.dados ?? []
}

async function fetchSessao(id: string): Promise<FaturaImportSessao> {
  const res = await apiFetch<FaturaImportSessao>(`/faturas/${id}`)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar sessão')
  if (!res.dados) throw new Error('Sessão não encontrada')
  return res.dados
}

/**
 * Upload do PDF (multipart). `apiFetch`/`apiMutate` só fazem JSON, então
 * montamos fetch direto aqui mantendo o mesmo padrão de auth.
 */
async function uploadFatura(payload: {
  conta_id: string
  arquivo:  File
  vencimento_fatura?: string | null
  valor_total?:       number | null
}): Promise<OpResult<FaturaImportSessao>> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { ok: false, dados: null, erro: 'Não autenticado' }

  const form = new FormData()
  form.append('conta_id', payload.conta_id)
  form.append('arquivo', payload.arquivo)
  if (payload.vencimento_fatura) form.append('vencimento_fatura', payload.vencimento_fatura)
  if (payload.valor_total != null) form.append('valor_total', String(payload.valor_total))

  try {
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/faturas`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey':        import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          // NÃO setar Content-Type — o browser monta o boundary do multipart
        },
        body: form,
      }
    )
    const data = await res.json().catch(() => ({}))
    return {
      ok:    res.ok,
      dados: res.ok ? (data as FaturaImportSessao) : null,
      erro:  res.ok ? null : (data.erro ?? `Erro ${res.status}`),
    }
  } catch (e) {
    return { ok: false, dados: null, erro: (e as Error).message }
  }
}

/** Lista as sessões do usuário (Importar Fatura → tela inicial). */
export function useFaturasImport() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: sessoes = [], isLoading: loading, error } = useQuery({
    queryKey: qk.faturasImport(uid),
    queryFn:  fetchSessoes,
    enabled:  !!uid,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: qk.faturasImport(uid) })

  const importar = async (payload: {
    conta_id: string
    arquivo:  File
    vencimento_fatura?: string | null
    valor_total?:       number | null
  }) => {
    const r = await uploadFatura(payload)
    if (r.ok) await invalidar()
    return r
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const r = await apiMutate(`/faturas/${id}`, 'DELETE')
    if (r.ok) await invalidar()
    return { ok: r.ok, dados: null, erro: r.erro }
  }

  return {
    sessoes,
    loading,
    error: error ? (error as Error).message : null,
    importar,
    excluir,
  }
}

/** Detalhe de UMA sessão (com seus itens) — usado na tela de revisão. */
export function useFaturaImportSessao(id: string | null) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: sessao, isLoading: loading, error } = useQuery({
    queryKey: qk.faturaImportSessao(uid, id ?? ''),
    queryFn:  () => fetchSessao(id!),
    enabled:  !!uid && !!id,
  })

  const invalidarSessao = () =>
    qc.invalidateQueries({ queryKey: qk.faturaImportSessao(uid, id ?? '') })

  const editarItem = async (
    itemId: string,
    payload: Partial<Pick<FaturaImportItem,
      'decisao' | 'categoria_escolhida_id' | 'transacao_existente_id' |
      'descricao' | 'valor' | 'data_compra' | 'estabelecimento' |
      'parcela_atual' | 'parcela_total' | 'observacao'
    >>
  ): Promise<OpResult<FaturaImportItem>> => {
    const r = await apiMutate<FaturaImportItem>(`/faturas/${id}/itens/${itemId}`, 'PUT', payload)
    if (r.ok) await invalidarSessao()
    return { ok: r.ok, dados: r.dados, erro: r.erro }
  }

  const setDecisao = (itemId: string, decisao: DecisaoFaturaImport) =>
    editarItem(itemId, { decisao })

  const setCategoria = (itemId: string, categoriaId: string | null) =>
    editarItem(itemId, { categoria_escolhida_id: categoriaId || null })

  const sugerir = async (): Promise<OpResult<{ atualizados: number }>> => {
    const r = await apiMutate<{ atualizados: number }>(`/faturas/${id}/sugerir`, 'POST')
    if (r.ok) await invalidarSessao()
    return { ok: r.ok, dados: r.dados ?? null, erro: r.erro }
  }

  /**
   * Confirma a sessão aplicando as decisões dos itens em arqvalor.transacoes.
   * Payload opcional contém o modo e overrides escolhidos pelo usuário na UI:
   *   - modo:       REGISTRO (1 lançamento por item) ou CATEGORIA (agrupado).
   *   - decisoes:   override CRIAR/ATUALIZAR por chave (item.id ou categoria_id
   *                 conforme o modo).
   *   - descricoes: override de descrição por chave.
   */
  const confirmar = async (payload?: {
    modo:        'REGISTRO' | 'CATEGORIA'
    decisoes?:   Record<string, 'CRIAR' | 'ATUALIZAR'>
    descricoes?: Record<string, string>
  }): Promise<OpResult<{ criadas: number; atualizadas: number; modo: string }>> => {
    const r = await apiMutate<{ criadas: number; atualizadas: number; modo: string }>(
      `/faturas/${id}/confirmar`, 'POST', payload,
    )
    if (r.ok) {
      await invalidarSessao()
      await qc.invalidateQueries({ queryKey: qk.faturasImport(uid) })
      // Confirmação cria/atualiza transações reais — invalida caches do
      // domínio para o resto do app refletir imediatamente.
      await qc.invalidateQueries({ queryKey: ['lancamentos', uid] })
      await qc.invalidateQueries({ queryKey: ['dashboard-fase1', uid] })
      await qc.invalidateQueries({ queryKey: ['transacoes-mes', uid] })
      await qc.invalidateQueries({ queryKey: qk.contas(uid) })
    }
    return { ok: r.ok, dados: r.dados ?? null, erro: r.erro }
  }

  return {
    sessao,
    loading,
    error: error ? (error as Error).message : null,
    editarItem,
    setDecisao,
    setCategoria,
    sugerir,
    confirmar,
  }
}
