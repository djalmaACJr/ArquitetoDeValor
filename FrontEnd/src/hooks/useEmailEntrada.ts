import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import { useEmEspacoDeAgregado } from './useEspacoAtivo'
import type { EmailEntrada } from '../types'

const BASE = '/investimentos/email-entrada'
const VAZIO: EmailEntrada = { endereco: null, remetentes: [], mensagens: [] }

// Caixa de entrada por e-mail (endereço próprio, remetentes, mensagens). Sempre do PRÓPRIO usuário.
export function useEmailEntrada() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const emEspaco = useEmEspacoDeAgregado()

  const { data = VAZIO, isLoading: loading } = useQuery({
    queryKey: qk.invEmailEntrada(uid),
    queryFn: async () => {
      const res = await apiFetch<EmailEntrada>(BASE)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar a caixa de entrada')
      return res.dados ?? VAZIO
    },
    enabled: !!uid && !emEspaco,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const chamar = async (caminho: string, metodo: 'POST' | 'PUT' | 'DELETE', corpo?: unknown): Promise<OpResult> => {
    const res = await apiMutate(`${BASE}${caminho}`, metodo, corpo)
    if (res.ok) await qc.invalidateQueries({ queryKey: qk.invEmailEntrada(uid) })
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return {
    ...data, loading,
    criarEndereco:    (apelido: string) => chamar('/endereco', 'POST', { apelido }),
    renovarCodigo:    () => chamar('/renovar', 'POST'),
    configurar:       (cfg: { ativo?: boolean; retencao_dias?: number; resumo_ia?: boolean }) => chamar('/config', 'PUT', cfg),
    adicionarRemetente: (padrao: string, status: 'PERMITIDO' | 'BLOQUEADO' = 'PERMITIDO') => chamar('/remetentes', 'POST', { padrao, status }),
    removerRemetente: (id: string) => chamar(`/remetentes/${id}`, 'DELETE'),
    decidirMensagem:  (id: string, acao: 'aprovar' | 'bloquear') => chamar(`/mensagens/${id}`, 'PUT', { acao }),
    marcarVista:      (id: string) => chamar(`/mensagens/${id}`, 'PUT', { acao: 'visto' }),
    excluirMensagem:  (id: string) => chamar(`/mensagens/${id}`, 'DELETE'),
  }
}
