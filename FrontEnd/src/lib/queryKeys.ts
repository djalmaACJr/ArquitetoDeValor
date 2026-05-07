// src/lib/queryKeys.ts
// Chaves centralizadas do TanStack Query — usadas para cache e invalidação.
// Convenção: a query key é um array, com o nome do recurso na primeira posição
// e parâmetros nas seguintes.

import type { FiltrosLancamento } from '../hooks/useLancamentos'

export const qk = {
  contas:      () => ['contas']           as const,
  categorias:  () => ['categorias']       as const,
  filtros:     () => ['filtros']          as const,

  // Lançamentos por filtro — chave inclui os filtros para cache por consulta
  lancamentos: (f: FiltrosLancamento) => ['lancamentos', f] as const,

  // Dashboard — chave inclui mês e filtros para cache por visão
  dashboard: (
    mes: string,
    contas: readonly string[],
    cats:   readonly string[],
    status: readonly string[],
  ) => ['dashboard', mes, contas, cats, status] as const,
}
