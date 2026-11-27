import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, type OpResult } from '../lib/api'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import { useEmEspacoDeAgregado } from './useEspacoAtivo'
import type { AnaliseRelatorioFii, RelatorioFiiDisponivel } from '../types'

// Análises de relatórios/resultados: FIIs (Relatório Gerencial), ações (CVM) e stocks/REITs (SEC). Sempre do PRÓPRIO usuário (a
// análise gasta a chave de IA de quem pede) — por isso usa o uid real da
// sessão, nunca o do espaço de um dono (ver BUSINESS_RULES.md).
export function useRelatoriosFii(ativoId?: string) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: analises = [], isLoading: loading } = useQuery({
    queryKey: qk.invRelatoriosFii(uid, ativoId),
    queryFn: async () => {
      const qs = ativoId ? `?ativo_id=${ativoId}` : ''
      const res = await apiFetch<AnaliseRelatorioFii[]>(`/investimentos/relatorios-fii${qs}`)
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar análises')
      return res.dados ?? []
    },
    enabled: !!uid,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })

  const invalidar = () => qc.invalidateQueries({ queryKey: qk.invRelatoriosFiiPref(uid) })

  const analisar = async (ativo_id: string, relatorio_id?: number | string, config_id?: string): Promise<OpResult<AnaliseRelatorioFii>> => {
    const res = await apiMutate<AnaliseRelatorioFii>('/investimentos/relatorios-fii/analisar', 'POST', { ativo_id, relatorio_id, config_id })
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  // Etapa 2: personaliza uma análise já feita (perfil, posição, peso na carteira, tempo de casa).
  const personalizar = async (analise_id: string, config_id?: string): Promise<OpResult<AnaliseRelatorioFii>> => {
    const res = await apiMutate<AnaliseRelatorioFii>('/investimentos/relatorios-fii/analise-pessoal', 'POST', { analise_id, config_id })
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const marcarVisto = async (id: string, visto = true): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/relatorios-fii/${id}`, 'PUT', { visto })
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  const excluir = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/relatorios-fii/${id}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return { analises, loading, analisar, personalizar, marcarVisto, excluir }
}

export async function listarRelatoriosDisponiveis(ativoId: string): Promise<RelatorioFiiDisponivel[]> {
  const res = await apiFetch<RelatorioFiiDisponivel[]>(`/investimentos/relatorios-fii/disponiveis?ativo_id=${ativoId}`)
  return res.ok ? (res.dados ?? []) : []
}

// Análises ainda não lidas (visto_em nulo) — alimenta o aviso de login e o
// destaque nos quadros de FIIs. Só do PRÓPRIO usuário e só em "Meus dados".
export function useAnalisesNaoVistas() {
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const emEspaco = useEmEspacoDeAgregado()
  const { data: naoVistas = [] } = useQuery({
    queryKey: qk.invRelatoriosFiiNaoVistas(uid),
    queryFn: async () => {
      const res = await apiFetch<AnaliseRelatorioFii[]>('/investimentos/relatorios-fii?nao_vistas=1&limite=50')
      if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar análises')
      return res.dados ?? []
    },
    enabled: !!uid && !emEspaco,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })
  const ativosComNova = useMemo(() => new Set(naoVistas.map((a) => a.ativo_id)), [naoVistas])
  return { naoVistas, ativosComNova }
}

// Busca no Fundos.NET uma janela maior de relatórios (o cron diário só guarda
// os últimos ~12 dias). Pode levar até ~100s.
// Com `ativoId` de uma ação/stock, busca só os documentos daquele papel (CVM/EDGAR).
export async function sincronizarRelatoriosFii(dias = 100, ativoId?: string): Promise<boolean> {
  const res = await apiMutate('/investimentos/relatorios-fii/sincronizar', 'POST', ativoId ? { dias, ativo_id: ativoId } : { dias })
  return res.ok
}

// Opt-in da análise automática diária (usa a chave de IA do usuário).
// `usuarios` pode ser lido/escrito direto pelo client (exceção documentada).
export function useRelatoriosAuto() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  const { data: flags = { auto: false, pessoal: false }, isLoading } = useQuery({
    queryKey: qk.invRelatoriosFiiAuto(uid),
    queryFn: async () => {
      const { data, error } = await supabase.schema('arqvalor').from('usuarios').select('inv_relatorios_auto, inv_relatorios_pessoal_auto').eq('id', uid!).single()
      if (error) throw error
      return { auto: !!data?.inv_relatorios_auto, pessoal: !!data?.inv_relatorios_pessoal_auto }
    },
    enabled: !!uid,
    staleTime: 60_000,
  })

  const definir = async (valor: boolean): Promise<boolean> => {
    const { error } = await supabase.schema('arqvalor').from('usuarios').update({ inv_relatorios_auto: valor }).eq('id', uid!)
    if (error) return false
    await qc.invalidateQueries({ queryKey: qk.invRelatoriosFiiAuto(uid) })
    return true
  }

  // Etapa 2 automática: subordinada à análise automática (só vale com ela ligada).
  const definirPessoal = async (valor: boolean): Promise<boolean> => {
    const { error } = await supabase.schema('arqvalor').from('usuarios').update({ inv_relatorios_pessoal_auto: valor }).eq('id', uid!)
    if (error) return false
    await qc.invalidateQueries({ queryKey: qk.invRelatoriosFiiAuto(uid) })
    return true
  }

  return { ativo: flags.auto, pessoal: flags.auto && flags.pessoal, loading: isLoading, definir, definirPessoal }
}

// Envia à mão o PDF de um relatório (quando a fonte automática não o tem). O texto é
// extraído no servidor e fica privado do usuário; devolve o documento criado, que então
// pode ser analisado normalmente (`analisar(ativoId, doc.id)`).
// `ativoId` opcional: sem ele o servidor identifica o ativo pelo texto do PDF; com ele, confere que é dele.
// `mesAno` opcional: sem ele a competência é detectada no PDF.
export async function enviarRelatorioManual(ativoId: string | undefined, arquivo: File, mesAno?: string): Promise<OpResult<RelatorioFiiDisponivel & { ativo_id: string; ticker: string }>> {
  const bytes = new Uint8Array(await arquivo.arrayBuffer())
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  const res = await apiMutate<RelatorioFiiDisponivel & { ativo_id: string; ticker: string }>('/investimentos/relatorios-fii/manual', 'POST', {
    ativo_id: ativoId || undefined, pdf_base64: btoa(bin), data_referencia: mesAno || undefined,
  })
  return { ok: res.ok, dados: res.dados, erro: res.erro }
}

export async function excluirRelatorioManual(id: string): Promise<boolean> {
  const res = await apiMutate(`/investimentos/relatorios-fii/manual?id=${encodeURIComponent(id)}`, 'DELETE')
  return res.ok
}

export interface CoberturaRelatorio {
  ativo_id: string; ticker: string; nome: string | null; tipo_ativo: string
  periodicidade: 'MENSAL' | 'TRIMESTRAL'
  /** Período esperado: "10/2026" (FII) ou "3T26". */
  periodo: string
  /** NO_PRAZO = o prazo de divulgação ainda não venceu. */
  status: 'TEM' | 'FALTA' | 'NO_PRAZO'
}

// Dos ativos em carteira, quais têm (ou não) o relatório esperado para o mês `mes` (AAAA-MM) —
// a periodicidade depende do tipo (FII mensal; ações/stocks trimestrais). Tipos sem relatório não vêm.
export async function buscarCoberturaRelatorios(mes: string): Promise<CoberturaRelatorio[] | null> {
  const res = await apiFetch<{ mes: string; itens: CoberturaRelatorio[] }>(`/investimentos/relatorios-fii/cobertura?mes=${mes}`)
  return res.ok ? (res.dados?.itens ?? []) : null
}
