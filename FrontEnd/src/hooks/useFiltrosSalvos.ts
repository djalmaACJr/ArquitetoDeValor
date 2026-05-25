// src/hooks/useFiltrosSalvos.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { FiltroSalvo } from '../types'

async function fetchFiltros(): Promise<FiltroSalvo[]> {
  const res = await apiFetch<FiltroSalvo[]>('/filtros')
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar filtros')
  return Array.isArray(res.dados) ? res.dados : []
}

// pagina undefined → busca todos os filtros do usuário (usado no perfil)
export function useFiltrosSalvos(pagina?: string) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: filtros = [], isLoading: carregando } = useQuery({
    queryKey: qk.filtros(uid),
    queryFn:  fetchFiltros,
    enabled:  !!uid,
  })

  const salvar = async (nome: string, dados: Record<string, unknown>): Promise<boolean> => {
    const { ok } = await apiMutate('/filtros', 'POST', { pagina, nome, dados })
    if (ok) await qc.invalidateQueries({ queryKey: qk.filtros(uid) })
    return ok
  }

  const renomear = async (id: string, novoNome: string): Promise<boolean> => {
    const { ok } = await apiMutate(`/filtros/${id}`, 'PUT', { nome: novoNome.trim() })
    if (ok) {
      // Optimistic-ish: atualiza cache localmente sem refetch
      qc.setQueryData<FiltroSalvo[]>(qk.filtros(uid), prev =>
        prev?.map(f => f.id === id ? { ...f, nome: novoNome.trim() } : f) ?? []
      )
    }
    return ok
  }

  const excluir = async (id: string): Promise<boolean> => {
    const { ok } = await apiMutate(`/filtros/${id}`, 'DELETE')
    if (ok) {
      qc.setQueryData<FiltroSalvo[]>(qk.filtros(uid), prev =>
        prev?.filter(f => f.id !== id) ?? []
      )
    }
    return ok
  }

  const excluirTodos = async (): Promise<void> => {
    await Promise.all(filtros.map(f => apiMutate(`/filtros/${f.id}`, 'DELETE')))
    qc.setQueryData<FiltroSalvo[]>(qk.filtros(uid), [])
  }

  return { filtros, carregando, salvar, renomear, excluir, excluirTodos }
}
