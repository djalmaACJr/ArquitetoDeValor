// src/hooks/useLancamentos.ts
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

function headers(token: string) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY as string,
  }
}
async function getToken() {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) throw new Error('Não autenticado')
  return session.access_token
}

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
  const [loading, setLoading]         = useState(true)
  const [error, setError]             = useState<string | null>(null)

  const carregar = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const token = await getToken()
      const params = new URLSearchParams({ mes: filtros.mes })
      // Sempre pede com saldo para ter campos enriquecidos da view
      params.set('saldo', 'true')
      if (filtros.conta_ids?.length === 1)     params.set('conta_id',    filtros.conta_ids[0])
      if (filtros.categoria_ids?.length === 1)  params.set('categoria_id', filtros.categoria_ids[0])
      if (filtros.status)                       params.set('status',       filtros.status)

      const res  = await fetch(`${BASE}/transacoes?${params}`, { headers: headers(token) })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.erro ?? 'Erro ao carregar lançamentos')

      let lista: Lancamento[] = data.dados ?? []

      // Filtragem multi no cliente
      if (filtros.conta_ids && filtros.conta_ids.length > 1)
        lista = lista.filter(l => filtros.conta_ids!.includes(l.conta_id))
      if (filtros.categoria_ids && filtros.categoria_ids.length > 1)
        lista = lista.filter(l => l.categoria_id != null && filtros.categoria_ids!.includes(l.categoria_id))

      setLancamentos(lista)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtros.mes, JSON.stringify(filtros.conta_ids), JSON.stringify(filtros.categoria_ids), filtros.status, filtros.com_saldo])

  useEffect(() => { carregar() }, [carregar])

  // ── Atualização local (sem reload completo) ──────────────
  const atualizarLocal = (id: string, campos: Partial<Lancamento>) => {
    setLancamentos(prev => prev.map(l => l.id === id ? { ...l, ...campos } : l))
  }

  const criar = async (payload: Partial<Lancamento>): Promise<OpResult> => {
    try {
      const token = await getToken()
      const res   = await fetch(`${BASE}/transacoes`, {
        method: 'POST', headers: headers(token), body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) await carregar() // criar precisa recarregar (recalcula saldos)
      return { ok: res.ok, erro: data?.erro ?? null }
    } catch (e) { return { ok: false, erro: (e as Error).message } }
  }

  const editar = async (
    id: string,
    payload: Partial<Lancamento>,
    escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS' = 'SOMENTE_ESTE'
  ): Promise<OpResult> => {
    try {
      const token = await getToken()
      const res   = await fetch(`${BASE}/transacoes/${id}?escopo=${escopo}`, {
        method: 'PUT', headers: headers(token), body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) {
        if (escopo === 'SOMENTE_ESTE') {
          // Atualiza só o item localmente — sem reload
          atualizarLocal(id, payload)
        } else {
          await carregar() // escopo amplo precisa recarregar
        }
      }
      return { ok: res.ok, erro: data?.erro ?? null }
    } catch (e) { return { ok: false, erro: (e as Error).message } }
  }

  const excluir = async (
    id: string,
    escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS' = 'SOMENTE_ESTE'
  ): Promise<OpResult> => {
    try {
      const token = await getToken()
      const res   = await fetch(`${BASE}/transacoes/${id}?escopo=${escopo}`, {
        method: 'DELETE', headers: headers(token),
      })
      const data = await res.json()
      if (res.ok) {
        if (escopo === 'SOMENTE_ESTE') {
          setLancamentos(prev => prev.filter(l => l.id !== id))
        } else {
          await carregar()
        }
      }
      return { ok: res.ok, erro: data?.erro ?? null }
    } catch (e) { return { ok: false, erro: (e as Error).message } }
  }

  // Antecipar: atualiza status localmente, sem reload
  const antecipar = async (id: string): Promise<OpResult> => {
    return editar(id, { status: 'PAGO' }, 'SOMENTE_ESTE')
  }

  const alterarStatus = async (
    id: string,
    status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
  ): Promise<OpResult> => {
    return editar(id, { status }, 'SOMENTE_ESTE')
  }

  const criarTransferencia = async (payload: {
    conta_origem_id: string
    conta_destino_id: string
    valor: number
    data: string
    descricao: string
    status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
    observacao?: string
  }): Promise<OpResult> => {
    try {
      const token = await getToken()
      const res   = await fetch(`${BASE}/transferencias`, {
        method: 'POST', headers: headers(token), body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) await carregar()
      return { ok: res.ok, erro: data?.erro ?? null }
    } catch (e) { return { ok: false, erro: (e as Error).message } }
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
    try {
      const token = await getToken()
      const res   = await fetch(`${BASE}/transferencias/${id}`, {
        method: 'PUT', headers: headers(token), body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (res.ok) await carregar()
      return { ok: res.ok, erro: data?.erro ?? null }
    } catch (e) { return { ok: false, erro: (e as Error).message } }
  }

  return { lancamentos, loading, error, carregar, criar, editar, excluir, antecipar, alterarStatus, criarTransferencia, editarTransferencia }
}
