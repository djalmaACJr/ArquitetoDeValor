// src/hooks/useContas.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { Conta, TipoConta, CartaoVirtual } from '../types'

interface OpResult { ok: boolean; erro: string | null }

async function fetchContas(): Promise<Conta[]> {
  const res = await apiFetch<Conta[]>('/contas')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar contas')
  return res.dados ?? []
}

export function useContas() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: contasRaw = [], isLoading: loading, error } = useQuery({
    queryKey: qk.contas(uid),
    queryFn:  fetchContas,
    enabled:  !!uid,
  })

  // Regra de ordenação por grupo de tipo (ContasPage e Dashboard agrupam por tipo;
  // a ordem global aqui é o que cada grupo herda).
  //   • CARTAO: saldo ASCENDENTE — maior dívida primeiro (-1000 antes de -100),
  //     porque saldo de cartão é negativo e o usuário quer ver o mais devido no topo.
  //   • Demais tipos: saldo DESCENDENTE — mais positivo primeiro (comportamento histórico).
  // Tie-break em ambos os casos: nome em pt-BR.
  const contas = [...contasRaw].sort((a, b) => {
    const aCartao = a.tipo === 'CARTAO'
    const bCartao = b.tipo === 'CARTAO'
    if (aCartao && bCartao) {
      return a.saldo_atual - b.saldo_atual || a.nome.localeCompare(b.nome, 'pt-BR')
    }
    if (!aCartao && !bCartao) {
      return b.saldo_atual - a.saldo_atual || a.nome.localeCompare(b.nome, 'pt-BR')
    }
    // Cartão vs não-cartão: cada página agrupa por tipo antes de exibir, então
    // a ordem inter-grupos é irrelevante; mantemos algo estável.
    return a.tipo.localeCompare(b.tipo) || a.nome.localeCompare(b.nome, 'pt-BR')
  })

  const carregar = async () => { await qc.invalidateQueries({ queryKey: qk.contas(uid) }) }

  const criar = async (payload: {
    nome: string; tipo: TipoConta; saldo_inicial?: number
    icone?: string; cor?: string
    dia_fechamento?: number | null; dia_pagamento?: number | null
    limite_credito?: number | null
    cartoes_virtuais?: CartaoVirtual[]
  }): Promise<OpResult> => {
    const res = await apiMutate('/contas', 'POST', payload)
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.contas(uid) })
    return { ok: res.ok, erro: res.erro }
  }

  const editar = async (id: string, payload: Partial<{
    nome: string; tipo: TipoConta; saldo_inicial: number
    icone: string; cor: string; ativa: boolean
    dia_fechamento: number | null; dia_pagamento: number | null
    limite_credito: number | null
    cartoes_virtuais: CartaoVirtual[]
  }>): Promise<OpResult> => {
    const res = await apiMutate(`/contas/${id}`, 'PUT', payload)
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.contas(uid) })
    return { ok: res.ok, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/contas/${id}`, 'DELETE')
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.contas(uid) })
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
