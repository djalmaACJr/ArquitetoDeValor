// src/hooks/useContas.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import type { Conta, TipoConta } from '../types'

interface OpResult { ok: boolean; erro: string | null }

async function fetchContas(): Promise<Conta[]> {
  const res = await apiFetch<Conta[]>('/contas')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar contas')
  return res.dados ?? []
}

export function useContas() {
  const qc = useQueryClient()

  const { data: contas = [], isLoading: loading, error } = useQuery({
    queryKey: qk.contas(),
    queryFn:  fetchContas,
  })

  const carregar = async () => { await qc.invalidateQueries({ queryKey: qk.contas() }) }

  const criar = async (payload: {
    nome: string; tipo: TipoConta; saldo_inicial?: number
    icone?: string; cor?: string
    dia_fechamento?: number | null; dia_pagamento?: number | null
  }): Promise<OpResult> => {
    const res = await apiMutate('/contas', 'POST', payload)
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.contas() })
    return { ok: res.ok, erro: res.erro }
  }

  const editar = async (id: string, payload: Partial<{
    nome: string; tipo: TipoConta; saldo_inicial: number
    icone: string; cor: string; ativa: boolean
    dia_fechamento: number | null; dia_pagamento: number | null
  }>): Promise<OpResult> => {
    const res = await apiMutate(`/contas/${id}`, 'PUT', payload)
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.contas() })
    return { ok: res.ok, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/contas/${id}`, 'DELETE')
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.contas() })
    return { ok: res.ok, erro: res.erro }
  }

  return {
    contas,
    loading,
    error: error ? (error as Error).message : null,
    carregar,
    criar,
    editar,
    excluir,
  }
}
