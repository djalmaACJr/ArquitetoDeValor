// src/hooks/useFiltrosSalvos.ts
import { useState, useEffect, useCallback } from 'react'
import { apiFetch, apiMutate } from '../lib/api'
import type { FiltroSalvo } from '../types'

// pagina undefined → busca todos os filtros do usuário (usado no perfil)
export function useFiltrosSalvos(pagina?: string) {
  const [filtros,    setFiltros]    = useState<FiltroSalvo[]>([])
  const [carregando, setCarregando] = useState(false)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const path = pagina
      ? `/filtros?pagina=${encodeURIComponent(pagina)}`
      : '/filtros'
    const { ok, dados } = await apiFetch<FiltroSalvo[]>(path)
    if (ok && Array.isArray(dados)) setFiltros(dados)
    setCarregando(false)
  }, [pagina])

  useEffect(() => { carregar() }, [carregar])

  const salvar = async (nome: string, dados: Record<string, unknown>): Promise<boolean> => {
    const { ok } = await apiMutate('/filtros', 'POST', { pagina, nome, dados })
    if (ok) await carregar()
    return ok
  }

  const excluir = async (id: string): Promise<boolean> => {
    const { ok } = await apiMutate(`/filtros/${id}`, 'DELETE')
    if (ok) setFiltros(prev => prev.filter(f => f.id !== id))
    return ok
  }

  const excluirTodos = async (): Promise<void> => {
    await Promise.all(filtros.map(f => apiMutate(`/filtros/${f.id}`, 'DELETE')))
    setFiltros([])
  }

  return { filtros, carregando, salvar, excluir, excluirTodos }
}
