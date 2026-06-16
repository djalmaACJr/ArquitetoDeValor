import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'

// Aviso gerado pelo job de proventos BRL (dividendos-cron-br): tipos cujo
// provento FUTURO não foi provisionado por falta de mapeamento tipo → categoria.
// Persistido em arqvalor.usuarios.inv_dividendos_avisos (lido direto, mesmo
// padrão de useOcultarValores). Auto-regenerado pelo cron → ao mapear a
// categoria, a próxima execução limpa e este hook deixa de retornar o aviso.

export type MotivoAvisoDividendo = 'sem_categoria' | 'tipo_inexistente'

export interface AvisoTipoDividendo {
  tipo:    string
  motivo:  MotivoAvisoDividendo
  tickers: string[]
}

export interface AvisosDividendos {
  atualizado_em: string
  tipos:         AvisoTipoDividendo[]
}

async function fetchAvisos(userId: string): Promise<AvisosDividendos | null> {
  const { data } = await supabase
    .schema('arqvalor')
    .from('usuarios')
    .select('inv_dividendos_avisos')
    .eq('id', userId)
    .single()
  const raw = (data?.inv_dividendos_avisos ?? null) as AvisosDividendos | null
  return raw && Array.isArray(raw.tipos) && raw.tipos.length > 0 ? raw : null
}

export function useAvisosDividendos() {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: avisos = null, isLoading: loading } = useQuery({
    queryKey: qk.invAvisosDividendos(uid),
    queryFn:  () => fetchAvisos(uid as string),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  return { avisos, loading }
}
