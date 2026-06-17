// src/hooks/useInvPesos.ts
//
// Pesos GLOBAIS dos critérios de avaliação (arqvalor.usuarios.inv_pesos_criterio).
// Valem para TODOS os tipos de ativo — só as perguntas dos questionários são
// separadas por tipo. Lido/escrito direto via supabase client (exceção
// arqvalor.usuarios, como useInvPerfil / PerfilPage).
//
// NULL no banco = usa o padrão do app (PESOS_PADRAO). A pontuação dos ativos
// (calcularNota) usa estes pesos para todos os tipos.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import { PESOS_PADRAO } from '../lib/questionarioAtivos'
import type { PesosCriterio } from '../types'

export function useInvPesos() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading: loading } = useQuery<PesosCriterio | null>({
    queryKey: qk.invPesos(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .schema('arqvalor')
        .from('usuarios')
        .select('inv_pesos_criterio')
        .eq('id', uid!)
        .single()
      if (error) throw error
      return (data?.inv_pesos_criterio ?? null) as PesosCriterio | null
    },
    enabled: !!uid,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const salvar = async (pesos: PesosCriterio): Promise<{ ok: boolean; erro?: string }> => {
    if (!uid) return { ok: false, erro: 'Sessão expirada' }
    const { error } = await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ inv_pesos_criterio: pesos })
      .eq('id', uid)
    if (error) return { ok: false, erro: error.message }
    await qc.invalidateQueries({ queryKey: qk.invPesos(uid) })
    return { ok: true }
  }

  // pesos sempre definido (cai para o padrão do app quando não há custom).
  // Referência ESTÁVEL: retorna `data` (cache do React Query) ou a constante
  // PESOS_PADRAO — nunca um objeto novo a cada render (evita loop em quem
  // sincroniza estado derivado a partir deste valor).
  return { pesos: data ?? PESOS_PADRAO, pesosSalvos: data ?? null, loading, salvar }
}
