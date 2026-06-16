import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '../lib/api'

// Cotações de marcação a mercado do Tesouro Direto (prefixado e IPCA+),
// da tabela compartilhada arqvalor.cotacoes_tesouro via Edge Function.
// Cache mensal: PU de resgate (venda) por (tipo_titulo, vencimento, mês).

export interface CotacaoTesouro {
  tipo_titulo: string
  vencimento: string   // YYYY-MM-DD
  mes_ano: string      // YYYY-MM
  data_base: string    // YYYY-MM-DD (dia útil de referência)
  pu_venda: number     // PU de resgate (marcação a mercado)
  taxa_venda: number | null
}

interface TesouroResposta { cotacoes: CotacaoTesouro[] }

// `desde`: competência mínima 'YYYY-MM' (default/mínimo 2020-01). Filtros
// opcionais por tipo de título e/ou vencimento (YYYY-MM-DD).
export function useCotacoesTesouro(
  opts: { desde?: string; tipo?: string; vencimento?: string; enabled?: boolean } = {},
) {
  const { desde = '2020-01', tipo, vencimento, enabled = true } = opts

  const { data, isLoading } = useQuery({
    queryKey: ['cotacoes-tesouro', desde, tipo ?? '', vencimento ?? ''],
    queryFn: async (): Promise<TesouroResposta> => {
      const qs = new URLSearchParams({ desde })
      if (tipo) qs.set('tipo', tipo)
      if (vencimento) qs.set('vencimento', vencimento)
      const res = await apiFetch<TesouroResposta>(`/investimentos/tesouro?${qs.toString()}`)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar cotações do Tesouro')
      return res.dados ?? { cotacoes: [] }
    },
    staleTime: 6 * 60 * 60 * 1000,    // 6h — fechamento mensal muda devagar
    refetchOnWindowFocus: false,
    enabled,
  })

  const cotacoes = data?.cotacoes ?? []

  return {
    loading: isLoading,
    cotacoes,
    // PU de resgate de um título numa competência ('YYYY-MM'); cai para a
    // cotação mais recente <= competência se o mês exato não existir.
    puEm: (tipoTitulo: string, venc: string, comp: string): number | null => {
      let aplicavel: number | null = null
      for (const c of cotacoes) {
        if (c.tipo_titulo !== tipoTitulo || c.vencimento !== venc) continue
        if (c.mes_ano <= comp) aplicavel = c.pu_venda
        else break // cotacoes vêm ordenadas por mes_ano asc
      }
      return aplicavel
    },
  }
}
