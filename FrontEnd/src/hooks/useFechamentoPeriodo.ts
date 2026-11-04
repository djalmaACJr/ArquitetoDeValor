// src/hooks/useFechamentoPeriodo.ts
//
// Data de fechamento de período (v7.5.0): para cada conta o banco guarda o
// saldo até essa data e os saldos passam a somar só o que veio depois. O hook
// consulta/define/remove a data. A gestão é sempre do próprio usuário (nunca
// do espaço de um dono), por isso a chave usa o uid da sessão.
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { useAuth } from './useAuth'

interface Fechamento { data_fechamento: string | null; atualizado_em: string | null }
interface OpResult { ok: boolean; erro: string | null }

const SEM_FECHAMENTO: Fechamento = { data_fechamento: null, atualizado_em: null }

/** Maior data de fechamento aceita: hoje − 1 ano (YYYY-MM-DD, no fuso local). */
export function dataMaximaFechamento(): string {
  const d = new Date()
  d.setFullYear(d.getFullYear() - 1)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export function useFechamentoPeriodo() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const chave = ['fechamento-periodo', uid] as const

  const { data = SEM_FECHAMENTO, isLoading: loading } = useQuery({
    queryKey: chave,
    enabled:  !!uid,
    queryFn:  async () => {
      const res = await apiFetch<Fechamento>('/contas/fechamento')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar o fechamento')
      return res.dados ?? SEM_FECHAMENTO
    },
  })

  const depois = async () => {
    await qc.invalidateQueries({ queryKey: chave })
    await qc.invalidateQueries({ queryKey: ['contas'] })
  }

  const fechar = async (dataFechamento: string): Promise<OpResult> => {
    const res = await apiMutate('/contas/fechamento', 'PUT', { data_fechamento: dataFechamento })
    if (res.ok) await depois()
    return { ok: res.ok, erro: res.erro }
  }

  const remover = async (): Promise<OpResult> => {
    const res = await apiMutate('/contas/fechamento', 'DELETE')
    if (res.ok) await depois()
    return { ok: res.ok, erro: res.erro }
  }

  return { dataFechamento: data.data_fechamento, loading, fechar, remover }
}
