// src/hooks/useInvPerfil.ts
//
// Perfil de investidor (arqvalor.usuarios.inv_perfil). Lido/escrito
// direto via supabase client — exceção permitida para arqvalor.usuarios
// (perfil/preferências), como em PerfilPage / useOcultarValores.
//
// Alimenta a tela de Configurações de Investimentos e os pesos sugeridos
// por perfil no questionário de avaliação.

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import type { PerfilInvestidor } from '../types'

export function useInvPerfil() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading: loading } = useQuery<PerfilInvestidor | null>({
    queryKey: qk.invPerfil(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .schema('arqvalor')
        .from('usuarios')
        .select('inv_perfil')
        .eq('id', uid!)
        .single()
      if (error) throw error
      return (data?.inv_perfil ?? null) as PerfilInvestidor | null
    },
    enabled: !!uid,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  })

  const salvar = async (perfil: PerfilInvestidor): Promise<{ ok: boolean; erro?: string }> => {
    if (!uid) return { ok: false, erro: 'Sessão expirada' }
    const payload: PerfilInvestidor = { ...perfil, atualizado_em: new Date().toISOString() }
    const { error } = await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ inv_perfil: payload })
      .eq('id', uid)
    if (error) return { ok: false, erro: error.message }
    await qc.invalidateQueries({ queryKey: qk.invPerfil(uid) })
    return { ok: true }
  }

  return { perfil: data ?? null, loading, salvar }
}
