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
  FaturaImportSessao, FaturaImportItem, DecisaoFaturaImport, TxCandidata,
} from '../types'

interface OpResult<T = unknown> { ok: boolean; dados: T | null; erro: string | null }

interface GrupoPayload {
  chave:                   string
  categoria_id:            string
  item_ids:                string[]
  decisao:                 'CRIAR' | 'ATUALIZAR'
  descricao?:              string
  transacao_existente_id?: string | null
}

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

/** Resultado do upload, com `codigo` opcional pra erros estruturados
 *  (ex.: SENHA_OBRIGATORIA / SENHA_INCORRETA pra PDFs protegidos). */
export type UploadFaturaResult = OpResult<FaturaImportSessao> & { codigo?: string }

/**
 * Upload do PDF (multipart). `apiFetch`/`apiMutate` só fazem JSON, então
 * montamos fetch direto aqui mantendo o mesmo padrão de auth.
 *
 * `senha` é opcional — usada apenas pra PDFs protegidos. NÃO é persistida
 * em lugar algum; vai no FormData só desta request e é descartada.
 */
async function uploadFatura(payload: {
  conta_id: string
  arquivo:  File
  vencimento_fatura?: string | null
  valor_total?:       number | null
  senha?:             string
}): Promise<UploadFaturaResult> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) return { ok: false, dados: null, erro: 'Não autenticado' }

  const form = new FormData()
  form.append('conta_id', payload.conta_id)
  form.append('arquivo', payload.arquivo)
  if (payload.vencimento_fatura) form.append('vencimento_fatura', payload.vencimento_fatura)
  if (payload.valor_total != null) form.append('valor_total', String(payload.valor_total))
  if (payload.senha)               form.append('senha', payload.senha)

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
    const data = await res.json().catch(() => ({} as Record<string, unknown>))
    return {
      ok:     res.ok,
      dados:  res.ok ? (data as FaturaImportSessao) : null,
      erro:   res.ok ? null : (String((data as { erro?: string }).erro ?? '') || `Erro ${res.status}`),
      codigo: res.ok ? undefined : ((data as { codigo?: string }).codigo ?? undefined),
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
    senha?:             string
  }): Promise<UploadFaturaResult> => {
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

  /** Atualiza metadados/decisões de fluxo da sessão (modo, separar_por_cartao, valor_total). */
  const editarSessao = async (
    payload: Partial<Pick<FaturaImportSessao,
      'modo_importacao' | 'separar_por_cartao' | 'observacao' | 'status' | 'valor_total'
    >>,
  ): Promise<OpResult<FaturaImportSessao>> => {
    const r = await apiMutate<FaturaImportSessao>(`/faturas/${id}`, 'PUT', payload)
    if (r.ok) await invalidarSessao()
    return { ok: r.ok, dados: r.dados, erro: r.erro }
  }

  type PatchItem = Partial<Pick<FaturaImportItem,
    'decisao' | 'categoria_escolhida_id' | 'transacao_existente_id' |
    'descricao' | 'valor' | 'data_compra' | 'estabelecimento' |
    'parcela_atual' | 'parcela_total' | 'observacao' |
    'grupo_chave' | 'descricao_override'
  >>

  const editarItem = async (
    itemId: string,
    payload: PatchItem,
  ): Promise<OpResult<FaturaImportItem>> => {
    const r = await apiMutate<FaturaImportItem>(`/faturas/${id}/itens/${itemId}`, 'PUT', payload)
    if (r.ok) await invalidarSessao()
    return { ok: r.ok, dados: r.dados, erro: r.erro }
  }

  /** Aplica o mesmo patch em vários itens de uma vez. Usado para
   *  persistir edições de GRUPO inteiro (vincular, mudar descrição,
   *  alternar CRIAR/ATUALIZAR) sem N requisições sequenciais. */
  const patchItensBulk = async (
    itemIds: string[],
    patch:   PatchItem,
  ): Promise<OpResult<{ atualizados: number }>> => {
    if (itemIds.length === 0) return { ok: true, dados: { atualizados: 0 }, erro: null }
    const r = await apiMutate<{ atualizados: number }>(
      `/faturas/${id}/itens-bulk`, 'PATCH', { item_ids: itemIds, patch },
    )
    if (r.ok) await invalidarSessao()
    return { ok: r.ok, dados: r.dados ?? null, erro: r.erro }
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

  /** Aplica todas as categoria_sugerida_id como categoria_escolhida_id em lote. */
  const aplicarSugestoes = async (): Promise<OpResult<{ aplicados: number }>> => {
    const r = await apiMutate<{ aplicados: number }>(`/faturas/${id}/aplicar-sugestoes`, 'POST')
    if (r.ok) await invalidarSessao()
    return { ok: r.ok, dados: r.dados ?? null, erro: r.erro }
  }

  /** Busca transações candidatas para vincular manualmente (PENDENTE/PROJECAO).
   *  O `modo` muda a janela de datas considerada:
   *    - CATEGORIA: apenas o mês do vencimento (lançamento agrupado fica
   *                 datado no dia de pagamento, dentro do mês do venc.).
   *    - REGISTRO:  do mês do vencimento até 2 meses antes (a compra real
   *                 costuma cair em mês anterior ao venc.). */
  const buscarTransacoes = async (
    q?: string,
    modo?: 'REGISTRO' | 'CATEGORIA',
  ): Promise<OpResult<TxCandidata[]>> => {
    if (!id) return { ok: false, dados: null, erro: 'Sessão não carregada' }
    const params = new URLSearchParams()
    if (q?.trim())  params.set('q', q.trim())
    if (modo)       params.set('modo', modo)
    const qs = params.toString() ? `?${params}` : ''
    const r = await apiFetch<TxCandidata[]>(`/faturas/${id}/transacoes${qs}`)
    return { ok: r.ok, dados: r.ok ? (r.dados ?? []) : null, erro: r.erro }
  }

  /**
   * Confirma a sessão aplicando as decisões dos itens em arqvalor.transacoes.
   *   - modo REGISTRO: decisoes + descricoes por item.id
   *   - modo CATEGORIA: grupos[] com agrupamento explícito (parcelas separadas)
   *                     ou legado decisoes/descricoes por categoria_id
   */
  const confirmar = async (payload?: {
    modo:         'REGISTRO' | 'CATEGORIA'
    decisoes?:    Record<string, 'CRIAR' | 'ATUALIZAR'>
    descricoes?:  Record<string, string>
    grupos?:      GrupoPayload[]
  }): Promise<OpResult<{ criadas: number; atualizadas: number; modo: string }>> => {
    const r = await apiMutate<{ criadas: number; atualizadas: number; modo: string }>(
      `/faturas/${id}/confirmar`, 'POST', payload,
    )
    if (r.ok) {
      await invalidarSessao()
      await qc.invalidateQueries({ queryKey: qk.faturasImport(uid) })
      // Confirmação cria/atualiza transações reais — invalida o cache
      // canônico de transações para o resto do app refletir imediatamente.
      await qc.invalidateQueries({ queryKey: qk.transacoesMesPref(uid) })
      await qc.invalidateQueries({ queryKey: qk.contas(uid) })
    }
    return { ok: r.ok, dados: r.dados ?? null, erro: r.erro }
  }

  return {
    sessao,
    loading,
    error: error ? (error as Error).message : null,
    editarSessao,
    editarItem,
    patchItensBulk,
    setDecisao,
    setCategoria,
    sugerir,
    confirmar,
    aplicarSugestoes,
    buscarTransacoes,
  }
}
