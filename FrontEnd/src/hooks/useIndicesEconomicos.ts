import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

// Índices econômicos (IPCA e SELIC) vindos da tabela compartilhada
// arqvalor.indices_economicos via Edge Function. As taxas são mensais
// (% no mês) e iguais para todos os usuários — populadas a partir do
// SGS/BCB com data de corte 2020-01.

export type IndiceNome = 'IPCA' | 'SELIC' | 'CDI'
export interface PontoIndice { competencia: string; valor: number } // competencia: 'YYYY-MM'

interface IndicesResposta {
  series: Record<string, PontoIndice[]>
  ultimo: Record<string, PontoIndice | null>
  desde: string
}

// `indices`: quais séries buscar (default: ambas). `desde`: competência
// mínima 'YYYY-MM' (default e mínimo: 2020-01).
export function useIndicesEconomicos(
  indices: IndiceNome[] = ['IPCA', 'SELIC', 'CDI'],
  desde = '2020-01',
  enabled = true,
) {
  const nomes = [...new Set(indices)].sort()
  const chave = nomes.join(',')

  const { data, isLoading } = useQuery({
    queryKey: ['indices-economicos', chave, desde],
    queryFn: async (): Promise<IndicesResposta> => {
      const qs = `?indices=${encodeURIComponent(chave)}&desde=${encodeURIComponent(desde)}`
      const res = await apiFetch<IndicesResposta>(`/investimentos/indices${qs}`)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar índices')
      return res.dados ?? { series: {}, ultimo: {}, desde }
    },
    staleTime: 6 * 60 * 60 * 1000,    // 6h — séries mensais mudam ~1x/mês
    refetchOnWindowFocus: false,
    enabled,
  })

  const series = data?.series ?? {}
  const ultimo = data?.ultimo ?? {}

  return {
    loading: isLoading,
    series,
    // Série completa de um índice (ordenada por competência asc).
    serie: (i: IndiceNome): PontoIndice[] => series[i] ?? [],
    // Taxa mais recente (% no mês) de um índice, ou null.
    ultimo: (i: IndiceNome): PontoIndice | null => ultimo[i] ?? null,
    // Taxa de um índice numa competência ('YYYY-MM') específica.
    taxaEm: (i: IndiceNome, comp: string): number | null =>
      (series[i] ?? []).find((p) => p.competencia === comp)?.valor ?? null,
  }
}
