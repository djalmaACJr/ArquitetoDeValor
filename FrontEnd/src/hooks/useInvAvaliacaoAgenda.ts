// src/hooks/useInvAvaliacaoAgenda.ts
//
// Agenda de reavaliação da carteira definida pelo usuário
// (arqvalor.usuarios.inv_avaliacao_agenda). A reavaliação roda no
// navegador (orquestra os mentores), então isto é uma PREFERÊNCIA: o
// usuário escolhe a frequência e o app deriva a próxima data e avisa
// quando está vencida. Lido/escrito direto via supabase client (exceção
// arqvalor.usuarios, como useInvPerfil / useInvPesos).

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { FrequenciaAgenda, InvAvaliacaoAgenda } from '../types'

// Dias aproximados de cada frequência (para derivar a próxima data).
export const DIAS_FREQUENCIA: Record<Exclude<FrequenciaAgenda, 'NENHUMA'>, number> = {
  SEMANAL: 7, QUINZENAL: 15, MENSAL: 30, TRIMESTRAL: 91, SEMESTRAL: 182, ANUAL: 365,
}

export const FREQUENCIA_LABEL: Record<FrequenciaAgenda, string> = {
  NENHUMA: 'Sem agenda', SEMANAL: 'Semanal', QUINZENAL: 'Quinzenal', MENSAL: 'Mensal',
  TRIMESTRAL: 'Trimestral', SEMESTRAL: 'Semestral', ANUAL: 'Anual',
}

export function useInvAvaliacaoAgenda() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading: loading } = useQuery<InvAvaliacaoAgenda | null>({
    queryKey: qk.invAvaliacaoAgenda(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .schema('arqvalor')
        .from('usuarios')
        .select('inv_avaliacao_agenda')
        .eq('id', uid!)
        .single()
      if (error) throw error
      return (data?.inv_avaliacao_agenda ?? null) as InvAvaliacaoAgenda | null
    },
    enabled: !!uid,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const salvar = async (frequencia: FrequenciaAgenda): Promise<{ ok: boolean; erro?: string }> => {
    if (!uid) return { ok: false, erro: 'Sessão expirada' }
    const valor: InvAvaliacaoAgenda | null = frequencia === 'NENHUMA' ? null : { frequencia }
    const { error } = await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ inv_avaliacao_agenda: valor })
      .eq('id', uid)
    if (error) return { ok: false, erro: error.message }
    await qc.invalidateQueries({ queryKey: qk.invAvaliacaoAgenda(uid) })
    return { ok: true }
  }

  return { frequencia: data?.frequencia ?? 'NENHUMA', loading, salvar }
}
