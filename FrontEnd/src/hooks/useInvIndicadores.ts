import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { InvIndicador, PontoIndicador, TipoIndicador, OpcaoIndiceB3 } from '../types'

// Watchlist pessoal de indicadores de mercado (ETF / ETF internacional)
// usada como benchmark de comparação na página "Gerenciar dados", ao lado
// dos indicadores econômicos fixos (PTAX/IPCA/SELIC/CDI — useIndicesEconomicos).
// Backend: GET/POST/DELETE /investimentos/indicadores (ver indicadores.ts).

interface IndicadoresResposta {
  indicadores: InvIndicador[]
  series: Record<string, PontoIndicador[]>
  ultimo: Record<string, PontoIndicador | null>
  desde: string
  opcoesIndice: OpcaoIndiceB3[]
}

export interface CriarIndicadorInput {
  ticker: string
  tipo:   TipoIndicador
  nome:   string
  moeda:  string
}

// `desde`: competência mínima 'YYYY-MM' (default: 5 anos atrás, no servidor).
export function useInvIndicadores(desde?: string) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading: loading, error } = useQuery({
    queryKey: qk.invIndicadores(uid, desde),
    queryFn: async (): Promise<IndicadoresResposta> => {
      const qs = desde ? `?desde=${encodeURIComponent(desde)}` : ''
      const res = await apiFetch<IndicadoresResposta>(`/investimentos/indicadores${qs}`)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar indicadores')
      return res.dados ?? { indicadores: [], series: {}, ultimo: {}, desde: desde ?? '', opcoesIndice: [] }
    },
    staleTime: 6 * 60 * 60 * 1000,    // 6h — mesma cadência dos demais indicadores
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: ['inv-indicadores', uid] })

  const criar = async (payload: CriarIndicadorInput): Promise<OpResult<InvIndicador>> => {
    const res = await apiMutate<InvIndicador>('/investimentos/indicadores', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/indicadores/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return {
    indicadores: data?.indicadores ?? [],
    series: data?.series ?? {},
    ultimo: data?.ultimo ?? {},
    opcoesIndice: data?.opcoesIndice ?? [],
    loading,
    error: error ? (error as Error).message : null,
    criar,
    excluir,
  }
}
