import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import { useEmEspacoDeAgregado } from './useEspacoAtivo'
import type { AnaliseAssembleiaFii } from '../types'

// Assembleias de FIIs convocadas (análise por IA). Sempre do PRÓPRIO usuário — gasta a
// chave de IA de quem pede (ver useRelatoriosFii).
export function useAssembleiasFii() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const emEspaco = useEmEspacoDeAgregado()   // análises são do próprio usuário: não aparecem no espaço de um dono

  const { data: assembleias = [], isLoading: loading } = useQuery({
    queryKey: qk.invAssembleiasFii(uid),
    queryFn: async () => {
      const res = await apiFetch<AnaliseAssembleiaFii[]>('/investimentos/assembleias-fii')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar assembleias')
      return res.dados ?? []
    },
    enabled: !!uid && !emEspaco,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: qk.invAssembleiasFii(uid) })

  // `sincronizar=false` evita reconsultar o Fundos.NET a cada fundo quando se analisa em lote.
  const analisar = async (ativo_id: string, config_id?: string, sincronizar = true): Promise<OpResult<{ analisadas: number; mensagem?: string }>> => {
    const res = await apiMutate<{ analisadas: number; mensagem?: string }>('/investimentos/assembleias-fii/analisar', 'POST', { ativo_id, config_id, sincronizar })
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const marcarVisto = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/assembleias-fii/${id}`, 'PUT', { visto: true })
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/assembleias-fii/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return { assembleias, loading, analisar, marcarVisto, excluir }
}

// Assembleias ainda não lidas — alimenta o aviso de login. Só do próprio usuário e só em "Meus dados".
export function useAssembleiasNaoVistas() {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const emEspaco = useEmEspacoDeAgregado()
  const { data: naoVistas = [] } = useQuery({
    queryKey: qk.invAssembleiasFiiNaoVistas(uid),
    queryFn: async () => {
      const res = await apiFetch<AnaliseAssembleiaFii[]>('/investimentos/assembleias-fii?nao_vistas=1&limite=50')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar assembleias')
      return res.dados ?? []
    },
    enabled: !!uid && !emEspaco,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  return { naoVistas }
}
