// src/hooks/useMediaDespesasMensais.ts
//
// Média mensal de despesas pagas nos últimos 24 meses completos (sem
// transferências), calculada no banco por fn_media_despesas_mensais. Alimenta a
// "Reserva" do card de saldo do Dashboard: saldo ÷ média = quantos meses dura.
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useContextoUserId } from './useEspacoAtivo'

export const MESES_MEDIA_DESPESAS = 24

export interface MediaDespesas {
  media: number
  /** Meses efetivamente usados no divisor (menor que 24 se o histórico é curto). */
  meses: number
  /** Média mensal de proventos B3 associados ao extrato (pagos). */
  proventos: number
  proventosMeses: number
  /** Categorias marcadas como despesa esporádica (fora da média). */
  categoriasIgnoradas: number
}

export function useMediaDespesasMensais(): MediaDespesas | null {
  const uid = useContextoUserId()
  const { data } = useQuery({
    queryKey:  ['media-despesas-mensais', uid],
    enabled:   !!uid,
    staleTime: 10 * 60_000,
    queryFn:   async (): Promise<MediaDespesas> => {
      const { data, error } = await supabase
        .schema('arqvalor')
        .rpc('fn_media_despesas_mensais', { p_user_id: uid, p_meses: MESES_MEDIA_DESPESAS })
      if (error) throw error
      const linha = (data as { media: number; meses_considerados: number; proventos_media: number; proventos_meses: number; categorias_ignoradas: number }[] | null)?.[0]
      return { media: Number(linha?.media ?? 0), meses: Number(linha?.meses_considerados ?? 0),
        proventos: Number(linha?.proventos_media ?? 0), proventosMeses: Number(linha?.proventos_meses ?? 0),
        categoriasIgnoradas: Number(linha?.categorias_ignoradas ?? 0) }
    },
  })
  return data ?? null
}
