// src/hooks/useAdmin.ts
//
// Flag de administrador — lida direto de `arqvalor.usuarios.admin` (mesmo
// padrão de useUsuarioPerfil: acesso direto ao Supabase client é a exceção
// documentada em CLAUDE.md pra tabela `usuarios`).
//
// Única fonte da verdade: não existe lógica de "quem é admin" no frontend
// além de ler esse campo. A proteção de dado real fica nas policies RLS
// (ex.: cron_execucoes só libera SELECT pra admin=true) — esta flag aqui
// só decide se a UI mostra ou esconde o link/página; um usuário que
// forçasse a rota sem ser admin só veria uma tela vazia (RLS filtra tudo).

import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'

export function useAdmin(): boolean {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data } = useQuery<boolean>({
    queryKey: qk.usuarioAdmin(uid),
    queryFn: async () => {
      const { data, error } = await supabase
        .schema('arqvalor')
        .from('usuarios')
        .select('admin')
        .eq('id', uid!)
        .single()
      if (error) throw error
      return !!data?.admin
    },
    enabled: !!uid,
    staleTime: 5 * 60_000,
  })

  return data ?? false
}
