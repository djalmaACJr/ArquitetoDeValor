import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'

// Resumo do que o job de proventos BRL (dividendos-cron-br) criou/atualizou
// desde a última visualização. Persistido em usuarios.inv_dividendos_novidades.
// Exibido UMA vez no login (componente em AppLayout); ao descartar, zera a
// coluna. O cron só grava quando há mudança e mescla com o não-visto.

export interface NovidadeProventoItem {
  ticker:          string
  tipo:            string
  data_pagamento:  string
  valor:           number
  acao:            'criado' | 'atualizado'
}

export interface NovidadesProventos {
  gerado_em:   string
  criados:     number
  atualizados: number
  itens:       NovidadeProventoItem[]
}

async function fetchNovidades(userId: string): Promise<NovidadesProventos | null> {
  const { data } = await supabase
    .schema('arqvalor')
    .from('usuarios')
    .select('inv_dividendos_novidades')
    .eq('id', userId)
    .single()
  const raw = (data?.inv_dividendos_novidades ?? null) as NovidadesProventos | null
  return raw && (raw.criados + raw.atualizados) > 0 ? raw : null
}

export function useNovidadesProventos() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: novidades = null } = useQuery({
    queryKey: qk.invNovidadesProventos(uid),
    queryFn:  () => fetchNovidades(uid as string),
    staleTime: 0,
    refetchOnWindowFocus: false,
    enabled: !!uid,
  })

  // Marca como visto: zera a coluna e some da tela.
  const descartar = async () => {
    if (!uid) return
    qc.setQueryData(qk.invNovidadesProventos(uid), null)
    await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ inv_dividendos_novidades: null })
      .eq('id', uid)
  }

  return { novidades, descartar }
}
