// src/hooks/useAgregados.ts
//
// Hook de domínio para "usuários agregados" (compartilhamento de dados) —
// consome supabase/functions/agregados/. Usado pelo seletor de espaço
// (Sidebar) e pela CompartilhamentoPage.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'

export type ModuloAgregado = 'EXTRATO' | 'OBJETIVOS' | 'INVESTIMENTOS'
export type StatusConviteAgregado = 'PENDENTE' | 'ACEITO' | 'RECUSADO' | 'REVOGADO'

export interface PermissaoAgregado { modulo: ModuloAgregado; pode_escrever: boolean }
export interface ContaLiberadaAgregado { conta_id: string }

/** Vínculo como aparece em GET /agregados (visão do DONO). */
export interface VinculoComoDono {
  id: string
  dono_id: string
  agregado_id: string | null
  email_convidado: string
  status: StatusConviteAgregado
  criado_em: string
  atualizado_em: string
  aceito_em: string | null
  revogado_em: string | null
  agregados_permissoes: PermissaoAgregado[]
  agregados_contas: ContaLiberadaAgregado[]
}

/** Vínculo como aparece em GET /agregados/convites-recebidos (visão do
 *  AGREGADO) — enriquecido com o nome do dono (fn_meus_vinculos_como_agregado). */
export interface VinculoComoAgregado {
  id: string
  dono_id: string
  dono_nome: string
  email_convidado: string
  status: StatusConviteAgregado
  criado_em: string
  aceito_em: string | null
  // Fase 5: quando o vínculo foi revogado pelo dono — alimenta o aviso de
  // login (ver useAvisosRevogacaoAgregado). `null` pra quem nunca foi
  // revogado (PENDENTE/ACEITO/RECUSADO).
  revogado_em: string | null
  // Fase 2: permissões por módulo (inclusive `pode_escrever`) — a Fase 1
  // deixava isto sempre `[]` (vazio) no frontend, já que escrita de
  // agregado não existia ainda.
  permissoes: PermissaoAgregado[]
}

interface OpResult<T = void> { ok: boolean; erro: string | null; dados: T | null }

export function useAgregadosComoDonos() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const queryKey = ['agregados-como-donos', uid] as const

  const { data: vinculos = [], isLoading: loading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch<VinculoComoDono[]>('/agregados')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar agregados')
      return res.dados ?? []
    },
    enabled: !!uid,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey })

  const convidar = async (email: string): Promise<OpResult<VinculoComoDono>> => {
    const res = await apiMutate<VinculoComoDono>('/agregados', 'POST', { email })
    if (res.ok) await invalidar()
    return { ok: res.ok, erro: res.erro, dados: res.dados }
  }

  const reenviar = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/agregados/${id}/reenviar`, 'POST')
    return { ok: res.ok, erro: res.erro, dados: null }
  }

  const revogar = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/agregados/${id}/revogar`, 'POST')
    if (res.ok) await invalidar()
    return { ok: res.ok, erro: res.erro, dados: null }
  }

  const definirPermissao = async (
    id: string, modulo: ModuloAgregado, liberado: boolean, podeEscrever: boolean,
  ): Promise<OpResult> => {
    const res = await apiMutate(`/agregados/${id}/permissoes`, 'PUT', {
      modulo, liberado, pode_escrever: podeEscrever,
    })
    if (res.ok) await invalidar()
    return { ok: res.ok, erro: res.erro, dados: null }
  }

  const definirContas = async (id: string, contaIds: string[]): Promise<OpResult> => {
    const res = await apiMutate(`/agregados/${id}/contas`, 'PUT', { conta_ids: contaIds })
    if (res.ok) await invalidar()
    return { ok: res.ok, erro: res.erro, dados: null }
  }

  return {
    vinculos, loading, error: error ? (error as Error).message : null,
    convidar, reenviar, revogar, definirPermissao, definirContas, recarregar: invalidar,
  }
}

export function useConvitesRecebidos() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const queryKey = ['agregados-convites-recebidos', uid] as const

  const { data: convites = [], isLoading: loading, error } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await apiFetch<VinculoComoAgregado[]>('/agregados/convites-recebidos')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar convites recebidos')
      return res.dados ?? []
    },
    enabled: !!uid,
    // Dado de "espaço disponível" — não precisa ficar re-buscando a cada
    // foco de janela; o seletor de espaço já invalida isto quando necessário.
    staleTime: 60_000,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey })

  // Por ID, não por token — fn_meus_vinculos_como_agregado() nunca expõe o
  // token (só existe no link de e-mail); quem já está autenticado e vê o
  // convite listado aqui não precisa dele pra provar quem é (ver
  // fn_aceitar_convite_agregado_por_id, mesmas checagens de e-mail+status).
  const aceitar = async (id: string): Promise<OpResult<VinculoComoAgregado>> => {
    const res = await apiMutate<VinculoComoAgregado>(`/agregados/${id}/aceitar`, 'POST')
    if (res.ok) await invalidar()
    return { ok: res.ok, erro: res.erro, dados: res.dados }
  }

  const recusar = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/agregados/${id}/recusar`, 'POST')
    if (res.ok) await invalidar()
    return { ok: res.ok, erro: res.erro, dados: null }
  }

  return {
    convites, loading, error: error ? (error as Error).message : null,
    aceitar, recusar, recarregar: invalidar,
    // Só os aceitos servem de opção no seletor de espaço.
    aceitos: convites.filter(c => c.status === 'ACEITO'),
  }
}

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

/** Aviso de login (Fase 5): quando um dono revoga um vínculo, o agregado
 *  só descobria na próxima vez que tentasse abrir aquele espaço (sumia do
 *  seletor sem explicação). Reaproveita `useConvitesRecebidos` (já traz
 *  vínculos REVOGADO onde o usuário é o agregado) — sem endpoint novo,
 *  mesmo padrão de useAvisosCron/useAvisosDataCom. "Visto até" é um
 *  timestamp único (não um conjunto de chaves): revogação nunca "volta"
 *  a ficar pendente, então um corte de tempo simples basta. */
export function useAvisosRevogacaoAgregado() {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const qc = useQueryClient()
  const { convites } = useConvitesRecebidos()

  const { data: vistosEm = null } = useQuery({
    queryKey: qk.agregadosAvisosVistos(uid),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .schema('arqvalor')
        .from('usuarios')
        .select('agregados_avisos_vistos_em')
        .eq('id', uid!)
        .single()
      if (error) throw error
      return (data?.agregados_avisos_vistos_em as string | null) ?? null
    },
    enabled: !!uid,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // Lazy initializer: Date.now() só é lido 1x (na montagem).
  const [seteDiasAtras] = useState(() => new Date(Date.now() - SETE_DIAS_MS))
  const corte = vistosEm ? new Date(vistosEm) : seteDiasAtras
  const avisos = convites.filter(
    (c) => c.status === 'REVOGADO' && c.revogado_em && new Date(c.revogado_em) > corte,
  )

  const dispensar = async () => {
    if (!uid) return
    const agora = new Date().toISOString()
    qc.setQueryData(qk.agregadosAvisosVistos(uid), agora)
    await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ agregados_avisos_vistos_em: agora })
      .eq('id', uid)
  }

  return { avisos, dispensar }
}
