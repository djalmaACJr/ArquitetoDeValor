// src/lib/agrupamentoCategoria.ts
//
// Utilitários compartilhados entre relatórios que oferecem o agrupamento por
// categoria pai ("Resumo") com linhas expansíveis. Centraliza:
//
//  - estado de expansão (`useExpansaoCategoria`)
//  - lookup de categoria pai a partir do hook `useCategorias`
//    (`paiPorCategoriaId`)
//
// Consumido por: RelatoriosPage, ComparativoMensalPage, AssinaturasPage.
// A lógica de consolidação dos valores fica em cada página, pois depende da
// forma dos dados (lançamentos crus vs. linhas comparativas vs. recorrências).

import { useCallback, useState } from 'react'
import type { Categoria } from '../types'

/**
 * Hook que gerencia o estado de expansão de categorias pai (modo "Resumo").
 *
 *  - `expandidos`        — Set<string> com as chaves expandidas
 *  - `toggle(id)`        — alterna uma chave
 *  - `expandirTodas(ids)`— expande todas as ids fornecidas
 *  - `colapsar()`        — limpa (colapsa tudo)
 *  - `todasExpandidas(ids)` — verifica se todas as ids passadas estão abertas
 *                           (útil pro botão "Expandir/Colapsar todas")
 */
export function useExpansaoCategoria() {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const toggle = useCallback((id: string) => {
    setExpandidos(prev => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }, [])

  const expandirTodas = useCallback((ids: Iterable<string>) => {
    setExpandidos(new Set(ids))
  }, [])

  const colapsar = useCallback(() => setExpandidos(new Set()), [])

  const todasExpandidas = useCallback((ids: Iterable<string>) => {
    const arr = [...ids]
    if (arr.length === 0) return false
    for (const id of arr) if (!expandidos.has(id)) return false
    return true
  }, [expandidos])

  return { expandidos, toggle, expandirTodas, colapsar, todasExpandidas, setExpandidos }
}

/**
 * Constrói Map<categoria_id, { id, nome }> com a categoria raiz (pai) para
 * cada categoria. Para categorias já raiz (sem `id_pai`), aponta para si
 * mesma. Usa lookup O(1) via Map interno — versão otimizada do padrão antes
 * duplicado em RelatoriosPage.
 */
export function paiPorCategoriaId(
  categorias: Categoria[],
): Map<string, { id: string; nome: string }> {
  const byId = new Map(categorias.map(c => [c.id, c]))
  const out  = new Map<string, { id: string; nome: string }>()
  for (const c of categorias) {
    if (c.id_pai) {
      const pai = byId.get(c.id_pai)
      out.set(c.id, { id: pai?.id ?? c.id, nome: pai?.descricao ?? c.descricao })
    } else {
      out.set(c.id, { id: c.id, nome: c.descricao })
    }
  }
  return out
}
