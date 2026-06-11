import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

// Cotação PTAX do dólar (USD/BRL), vinda da tabela compartilhada via
// Edge Function. Recebe a lista de datas relevantes (ex.: datas de compra
// dos ativos em USD); o backend devolve, para cada uma, a cotação do dia
// útil <= data, além da cotação mais recente ("atual").
interface PtaxResposta {
  byDate: Record<string, number>
  atual: number | null
  atual_data: string | null
}

export function usePtax(datas: string[] = [], enabled = true) {
  // Chave estável: datas únicas e ordenadas
  const chave = [...new Set(datas.filter(Boolean))].sort().join(',')

  const { data } = useQuery({
    queryKey: ['ptax', chave],
    queryFn: async (): Promise<PtaxResposta> => {
      const qs = chave ? `?datas=${encodeURIComponent(chave)}` : ''
      const res = await apiFetch<PtaxResposta>(`/investimentos/ptax${qs}`)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar PTAX')
      return res.dados ?? { byDate: {}, atual: null, atual_data: null }
    },
    staleTime: 60 * 60 * 1000,        // 1h — PTAX muda 1x/dia útil
    refetchOnWindowFocus: false,
    enabled,
  })

  const byDate = data?.byDate ?? {}
  const atual = data?.atual ?? null

  return {
    atual,
    atualData: data?.atual_data ?? null,
    // Taxa aplicável a uma data (cai para a atual se a data não vier no mapa).
    taxaEm: (d?: string | null): number | null => (d && byDate[d] != null ? byDate[d] : atual),
  }
}
