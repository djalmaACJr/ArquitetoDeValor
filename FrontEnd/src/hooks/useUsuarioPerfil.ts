// src/hooks/useUsuarioPerfil.ts
//
// Lê nome + email do usuário logado direto de `arqvalor.usuarios`, em vez
// de pegar de `session.user.user_metadata` (que vem do JWT).
//
// Por quê: o JWT carrega `auth.users.raw_user_meta_data.nome`, que é um
// espelho de `arqvalor.usuarios.nome`. Se algum dos dois for editado
// isoladamente (ex.: ALTER direto via Studio na tabela arqvalor.usuarios
// sem atualizar auth.users), eles divergem — e a UI lendo do JWT mostra
// o valor errado mesmo com a tabela correta.
//
// A tabela `arqvalor.usuarios` é a fonte da verdade pra UI. O trigger
// `trg_sincronizar_usuario_update` em auth.users mantém o JWT em dia
// como defesa em profundidade, mas se ainda assim divergirem, o que o
// usuário vê é o valor da tabela.

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'

interface UsuarioPerfil {
  id:               string
  email:            string
  nome:             string | null
  data_nascimento:  string | null  // "YYYY-MM-DD" (dia fixado em 01)
}

export function useUsuarioPerfil() {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data, isLoading } = useQuery<UsuarioPerfil | null>({
    queryKey: qk.usuarioPerfil(uid),
    queryFn:  async () => {
      const { data, error } = await supabase
        .schema('arqvalor')
        .from('usuarios')
        .select('id, email, nome, data_nascimento')
        .eq('id', uid!)
        .single()
      if (error) throw error
      return data
    },
    enabled:   !!uid,
    staleTime: 5 * 60_000, // 5 minutos — nome muda raramente
  })

  // Fallbacks pra evitar UI vazia enquanto o fetch resolve.
  // Email cai pra session.user.email (sempre presente no JWT do user atual).
  // Nome cai pra prefixo do email — mesma estratégia que estava em PerfilPage.
  const email = data?.email ?? session?.user?.email ?? ''
  const nome  = data?.nome ?? email.split('@')[0] ?? ''

  return { nome, email, dataNascimento: data?.data_nascimento ?? null, loading: isLoading }
}
