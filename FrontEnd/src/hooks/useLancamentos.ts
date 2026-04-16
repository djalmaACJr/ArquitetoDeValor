// src/hooks/useLancamentos.ts
import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiMutate } from '../lib/api'

export interface Lancamento {
  id: string
  user_id: string
  conta_id: string
  categoria_id: string | null
  data: string
  descricao: string
  valor: number
  tipo: 'RECEITA' | 'DESPESA'
  status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
  valor_projetado: number | null
  id_recorrencia: string | null
  id_par_transferencia: string | null  // identifica o par de transferência
  nr_parcela: number | null
  total_parcelas: number | null
  tipo_recorrencia: string | null
  observacao: string | null
  // Campos enriquecidos pela view vw_transacoes_com_saldo
  saldo_acumulado?: number
  conta_nome?: string
  conta_icone?: string
  conta_cor?: string
  categoria_nome?: string
  categoria_icone?: string
  categoria_cor?: string
  categoria_pai_nome?: string
}

export interface FiltrosLancamento {
  mes: string
  conta_ids?: string[]
  categoria_ids?: string[]
  status?: string
  com_saldo?: boolean
}

interface OpResult { ok: boolean; erro: string | null }

export function useLancamentos(filtros: FiltrosLancamento) {
  const [lancamentos, setLancamentos] = useState<Lancamento[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  const carregar = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams({ mes: filtros.mes, saldo: 'true' })

      // ── Filtragem server-side ─────────────────────────────────────────────
      // Corrigido: envia todos os conta_ids/categoria_ids como parâmetros
      // separados para que a API filtre corretamente independente da quantidade.
      // A filtragem no cliente era limitada pela paginação (50 registros).
      //
      // NOTA: A Edge Function /transacoes aceita conta_id e categoria_id como
      // parâmetro único. Se a API for atualizada para aceitar múltiplos valores
      // (ex: conta_ids[]=x&conta_ids[]=y), remova a filtragem client-side abaixo.
      if (filtros.conta_ids?.length === 1) {
        params.set('conta_id', filtros.conta_ids[0])
      }
      if (filtros.categoria_ids?.length === 1) {
        params.set('categoria_id', filtros.categoria_ids[0])
      }
      if (filtros.status) {
        params.set('status', filtros.status)
      }
      // Aumenta per_page quando há filtro multi para minimizar perda de dados
      // até a API suportar múltiplos filtros nativamente
      const temFiltroMulti = (filtros.conta_ids?.length ?? 0) > 1 || (filtros.categoria_ids?.length ?? 0) > 1
      params.set('per_page', temFiltroMulti ? '200' : '50')

      const res = await apiFetch<{ dados: Lancamento[] }>(`/transacoes?${params}`, signal)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar lançamentos')

      // Extrai a lista — a API retorna { dados: [...] }
      const raw = res.dados
      let lista: Lancamento[] = (raw as unknown as { dados: Lancamento[] })?.dados
        ?? (raw as unknown as Lancamento[])
        ?? []

      // Filtragem client-side residual para múltiplos IDs (enquanto a API não suporta)
      if ((filtros.conta_ids?.length ?? 0) > 1) {
        lista = lista.filter(l => filtros.conta_ids!.includes(l.conta_id))
      }
      if ((filtros.categoria_ids?.length ?? 0) > 1) {
        lista = lista.filter(l => l.categoria_id != null && filtros.categoria_ids!.includes(l.categoria_id))
      }

      setLancamentos(lista)
    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [filtros.mes, JSON.stringify(filtros.conta_ids), JSON.stringify(filtros.categoria_ids), filtros.status, filtros.com_saldo]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const controller = new AbortController()
    carregar(controller.signal)
    return () => controller.abort()
  }, [carregar])

  // ── Atualização local (sem reload completo) ──────────────────────────────
  const atualizarLocal = (id: string, campos: Partial<Lancamento>) => {
    setLancamentos(prev => prev.map(l => l.id === id ? { ...l, ...campos } : l))
  }

  const criar = async (payload: Partial<Lancamento>): Promise<OpResult> => {
    const res = await apiMutate('/transacoes', 'POST', payload)
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro }
  }

  const editar = async (
    id: string,
    payload: Partial<Lancamento>,
    escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS' = 'SOMENTE_ESTE'
  ): Promise<OpResult> => {
    const res = await apiMutate(`/transacoes/${id}?escopo=${escopo}`, 'PUT', payload)
    if (res.ok) {
      if (escopo === 'SOMENTE_ESTE') {
        atualizarLocal(id, payload)
      } else {
        await carregar()
      }
    }
    return { ok: res.ok, erro: res.erro }
  }

  const excluir = async (
    id: string,
    escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS' = 'SOMENTE_ESTE'
  ): Promise<OpResult> => {
    const res = await apiMutate(`/transacoes/${id}?escopo=${escopo}`, 'DELETE')
    if (res.ok) {
      if (escopo === 'SOMENTE_ESTE') {
        setLancamentos(prev => prev.filter(l => l.id !== id))
      } else {
        await carregar()
      }
    }
    return { ok: res.ok, erro: res.erro }
  }

  const antecipar = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/transacoes/${id}/antecipar`, 'POST')
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro ?? null }
  }

  const alterarStatus = async (
    id: string,
    status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
  ): Promise<OpResult> =>
    editar(id, { status }, 'SOMENTE_ESTE')

  const criarTransferencia = async (payload: {
    conta_origem_id: string
    conta_destino_id: string
    valor: number
    data: string
    descricao: string
    status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
    observacao?: string
  }): Promise<OpResult> => {
    const res = await apiMutate('/transferencias', 'POST', payload)
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro }
  }

  const editarTransferencia = async (
    id: string,
    payload: {
      conta_origem_id?: string
      conta_destino_id?: string
      valor?: number
      data?: string
      descricao?: string
      status?: 'PAGO' | 'PENDENTE' | 'PROJECAO'
      observacao?: string
    }
  ): Promise<OpResult> => {
    const res = await apiMutate(`/transferencias/${id}`, 'PUT', payload)
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro }
  }

  const excluirTransferencia = async (idPar: string): Promise<OpResult> => {
    const res = await apiMutate(`/transferencias/${idPar}`, 'DELETE')
    if (res.ok) await carregar()
    return { ok: res.ok, erro: res.erro ?? null }
  }

  return {
    lancamentos, loading, error, carregar,
    criar, editar, excluir, antecipar, alterarStatus,
    criarTransferencia, editarTransferencia, excluirTransferencia,
  }
}
