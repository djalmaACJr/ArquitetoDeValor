// src/hooks/useLancamentos.ts
import { useQuery, useQueryClient, keepPreviousData, type QueryClient } from '@tanstack/react-query'
import { useEffect, useCallback, useMemo } from 'react'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'

export interface Lancamento {
  id: string
  user_id: string
  conta_id: string
  categoria_id: string | null
  data: string
  descricao: string
  valor: number
  tipo: 'RECEITA' | 'DESPESA'
  status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
  valor_projetado: number | null
  id_recorrencia: string | null
  id_par_transferencia: string | null  // identifica o par de transferência
  nr_parcela: number | null
  total_parcelas: number | null
  tipo_recorrencia: string | null
  intervalo_recorrencia?: number | null
  observacao: string | null
  // Campos enriquecidos pela view vw_transacoes_com_saldo
  saldo_acumulado?: number
  conta_nome?: string | null
  conta_icone?: string | null
  conta_cor?: string | null
  categoria_nome?: string | null
  categoria_icone?: string | null
  categoria_cor?: string | null
  categoria_pai_nome?: string | null
}

export interface FiltrosLancamento {
  mes: string
  conta_ids?: string[]
  categoria_ids?: string[]
  status?: string       // legado — valor único
  status_ids?: string[] // novo — múltiplos status
  com_saldo?: boolean
}

interface OpResult { ok: boolean; erro: string | null }

export async function fetchLancamentos(filtros: FiltrosLancamento, signal?: AbortSignal): Promise<Lancamento[]> {
  const params = new URLSearchParams({ mes: filtros.mes, saldo: 'true' })

  // Server-side: API aceita só 1 valor por filtro hoje. Para múltiplos,
  // baixamos uma página maior e filtramos no client.
  if (filtros.conta_ids?.length === 1) params.set('conta_id', filtros.conta_ids[0])
  if (filtros.categoria_ids?.length === 1) params.set('categoria_id', filtros.categoria_ids[0])
  if ((filtros.status_ids?.length ?? 0) === 1) params.set('status', filtros.status_ids![0])
  else if (filtros.status) params.set('status', filtros.status)

  const temFiltroMulti =
    (filtros.conta_ids?.length ?? 0) > 1 ||
    (filtros.categoria_ids?.length ?? 0) > 1 ||
    (filtros.status_ids?.length ?? 0) > 1
  params.set('per_page', temFiltroMulti ? '200' : '50')

  const res = await apiFetch<{ dados: Lancamento[] }>(`/transacoes?${params}`, signal)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar lançamentos')

  // API retorna { dados: [...] } — apiFetch já desembala um nível
  const raw = res.dados
  let lista: Lancamento[] =
    (raw as unknown as { dados: Lancamento[] })?.dados
    ?? (raw as unknown as Lancamento[])
    ?? []

  // Filtragem residual para múltiplos IDs
  if ((filtros.conta_ids?.length ?? 0) > 1) {
    lista = lista.filter(l => filtros.conta_ids!.includes(l.conta_id))
  }
  if ((filtros.categoria_ids?.length ?? 0) > 1) {
    lista = lista.filter(l => l.categoria_id != null && filtros.categoria_ids!.includes(l.categoria_id))
  }
  if ((filtros.status_ids?.length ?? 0) > 1) {
    lista = lista.filter(l => filtros.status_ids!.includes(l.status))
  }

  return lista
}

export function mesAdjacente(mes: string, delta: number): string {
  const [ano, m] = mes.split('-').map(Number)
  const d = new Date(ano, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// staleTime do cache canônico de transações por mês. Os dados só mudam por
// mutation — e toda mutation invalida `transacoes-mes` explicitamente — então
// não há motivo para refetch em navegação dentro dessa janela.
export const TRANSACOES_MES_STALE = 5 * 60_000

/**
 * Fetch CANÔNICO de um mês de transações (sem filtros, com saldo corrente).
 * É a única fonte de dados de transações do app: Extrato, Dashboard (fase 1
 * e histórico) e prefetches compartilham a MESMA query key
 * (`qk.transacoesMes`), então cada mês trafega uma única vez e uma única
 * invalidação propaga para todas as visões.
 */
export async function fetchTransacoesMes(mes: string, signal?: AbortSignal): Promise<Lancamento[]> {
  const res = await apiFetch<{ dados: Lancamento[] }>(`/transacoes?mes=${mes}&per_page=1000&saldo=true`, signal)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar lançamentos')
  const raw = res.dados
  return (raw as unknown as { dados: Lancamento[] })?.dados
    ?? (raw as unknown as Lancamento[])
    ?? []
}

/**
 * Pré-aquece o cache canônico com os meses vizinhos ao mês informado. Ideal
 * para chamar logo após o login (AppLayout): Extrato E Dashboard encontram o
 * cache pronto, pois ambos leem de `qk.transacoesMes`.
 */
export function prefetchLancamentosVizinhos(qc: QueryClient, uid: string | null, mes: string) {
  if (!uid) return
  for (let delta = -3; delta <= 3; delta++) {
    const mesAdj = mesAdjacente(mes, delta)
    qc.prefetchQuery({
      queryKey: qk.transacoesMes(uid, mesAdj),
      queryFn:  ({ signal }) => fetchTransacoesMes(mesAdj, signal),
      staleTime: TRANSACOES_MES_STALE,
    })
  }
}

export function useLancamentos(filtros: FiltrosLancamento) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  // Cache CANÔNICO por mês (compartilhado com o Dashboard). Filtros são
  // aplicados no cliente sobre o mês completo — o mês trafega UMA vez,
  // qualquer combinação de filtro é instantânea e o saldo_acumulado das
  // linhas permanece o global real (a página recalcula quando filtra).
  const { data: doMes = [], isLoading: loading, isFetching: fetching, error } = useQuery({
    queryKey:        qk.transacoesMes(uid, filtros.mes),
    queryFn:         ({ signal }) => fetchTransacoesMes(filtros.mes, signal),
    staleTime:       TRANSACOES_MES_STALE,
    placeholderData: keepPreviousData,
    enabled:         !!uid,
  })

  const lancamentos = useMemo(() => {
    let lista = doMes
    if (filtros.conta_ids?.length)
      lista = lista.filter(l => filtros.conta_ids!.includes(l.conta_id))
    if (filtros.categoria_ids?.length)
      lista = lista.filter(l => l.categoria_id != null && filtros.categoria_ids!.includes(l.categoria_id))
    if (filtros.status_ids?.length)
      lista = lista.filter(l => filtros.status_ids!.includes(l.status))
    else if (filtros.status)
      lista = lista.filter(l => l.status === filtros.status)
    return lista
  }, [doMes, filtros.conta_ids, filtros.categoria_ids, filtros.status_ids, filtros.status])

  // Prefetch pontual — chamado no onMouseEnter dos botões de navegação
  const prefetchAdj = useCallback((delta: number) => {
    if (!uid) return
    const mesAdj = mesAdjacente(filtros.mes, delta)
    qc.prefetchQuery({
      queryKey: qk.transacoesMes(uid, mesAdj),
      queryFn:  ({ signal }) => fetchTransacoesMes(mesAdj, signal),
      staleTime: TRANSACOES_MES_STALE,
    })
  }, [filtros.mes, qc, uid])

  // Prefetch de background — só os meses imediatamente vizinhos (o cache é
  // compartilhado com Dashboard/AppLayout, que já aqueceram uma janela maior;
  // navegações sucessivas vão puxando o próximo mês conforme avançam).
  useEffect(() => {
    if (!uid) return
    for (const delta of [-1, 1]) {
      const mesAdj = mesAdjacente(filtros.mes, delta)
      qc.prefetchQuery({
        queryKey: qk.transacoesMes(uid, mesAdj),
        queryFn:  ({ signal }) => fetchTransacoesMes(mesAdj, signal),
        staleTime: TRANSACOES_MES_STALE,
      })
    }
  }, [filtros.mes, uid]) // eslint-disable-line react-hooks/exhaustive-deps

  // Invalida o cache canônico de transações — propaga para Extrato,
  // Dashboard (fase 1 + histórico) e qualquer outra visão de transações.
  const invalidarTudo = () =>
    qc.invalidateQueries({ queryKey: qk.transacoesMesPref(uid) })

  const carregar = async () => { await invalidarTudo() }

  // Campos que o backend espelha nas DUAS pernas de uma transferência
  // (fn_atualizar_par_transferencia, PUT /transacoes/:id — ver CLAUDE.md
  // › Consistência de transferências).
  const CAMPOS_ESPELHADOS_TRANSF = ['status', 'valor', 'data', 'observacao'] as const

  // Atualização otimista do mês exibido + refetch em background: a UI
  // responde na hora e o saldo_acumulado das linhas seguintes (e os outros
  // meses afetados) são corrigidos pelo refetch.
  //
  // Se o item editado for perna de transferência (id_par_transferencia),
  // espelha os mesmos campos na outra perna no cache local também — o
  // backend já faz isso atomicamente, mas sem espelhar aqui a tela fica
  // mostrando as duas pernas com status divergente até o refetch do
  // invalidarTudo() (abaixo) chegar. Ex.: marcar PAGO no Extrato filtrado
  // por só 1 conta do par mostrava a outra perna ainda como PENDENTE por
  // um instante (ou indefinidamente se o refetch falhar/demorar).
  const atualizarLocal = (id: string, campos: Partial<Lancamento>) => {
    const espelhado = Object.fromEntries(
      Object.entries(campos).filter(([k]) => (CAMPOS_ESPELHADOS_TRANSF as readonly string[]).includes(k))
    )
    qc.setQueryData<Lancamento[]>(qk.transacoesMes(uid, filtros.mes), prev => {
      if (!prev) return []
      const idPar = prev.find(l => l.id === id)?.id_par_transferencia
      return prev.map(l => {
        if (l.id === id) return { ...l, ...campos }
        if (idPar && l.id_par_transferencia === idPar && Object.keys(espelhado).length > 0) {
          return { ...l, ...espelhado }
        }
        return l
      })
    })
    invalidarTudo()
  }

  // Remove imediatamente da lista local — usado após exclusão via Drawer
  const removerLocal = (id: string, idPar?: string | null) => {
    qc.setQueryData<Lancamento[]>(qk.transacoesMes(uid, filtros.mes), prev =>
      idPar
        ? prev?.filter(l => l.id_par_transferencia !== idPar) ?? []
        : prev?.filter(l => l.id !== id) ?? []
    )
    invalidarTudo()
  }

  const criar = async (payload: Partial<Lancamento>): Promise<OpResult> => {
    const res = await apiMutate('/transacoes', 'POST', payload)
    if (res.ok) await invalidarTudo()
    return { ok: res.ok, erro: res.erro }
  }

  const editar = async (
    id: string,
    payload: Partial<Lancamento>,
    escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS' = 'SOMENTE_ESTE'
  ): Promise<OpResult> => {
    const res = await apiMutate(`/transacoes/${id}?escopo=${escopo}`, 'PUT', payload)
    if (res.ok) {
      if (escopo === 'SOMENTE_ESTE') atualizarLocal(id, payload)
      else await invalidarTudo()
    }
    return { ok: res.ok, erro: res.erro }
  }

  const excluir = async (
    id: string,
    escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS' = 'SOMENTE_ESTE'
  ): Promise<OpResult> => {
    const res = await apiMutate(`/transacoes/${id}?escopo=${escopo}`, 'DELETE')
    if (res.ok) {
      if (escopo === 'SOMENTE_ESTE') removerLocal(id)
      else await invalidarTudo()
    }
    return { ok: res.ok, erro: res.erro }
  }

  const antecipar = async (id: string): Promise<OpResult> => {
    const res = await apiMutate(`/transacoes/${id}/antecipar`, 'POST')
    if (res.ok) await invalidarTudo()
    return { ok: res.ok, erro: res.erro ?? null }
  }

  const alterarStatus = async (
    id: string,
    status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
  ): Promise<OpResult> =>
    editar(id, { status }, 'SOMENTE_ESTE')

  const criarTransferencia = async (payload: {
    conta_origem_id: string
    conta_destino_id: string
    valor: number
    data: string
    descricao: string
    status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
    observacao?: string
  }): Promise<OpResult> => {
    const res = await apiMutate('/transferencias', 'POST', payload)
    if (res.ok) await invalidarTudo()
    return { ok: res.ok, erro: res.erro }
  }

  const editarTransferencia = async (
    id: string,
    payload: {
      conta_origem_id?: string
      conta_destino_id?: string
      valor?: number
      data?: string
      descricao?: string
      status?: 'PAGO' | 'PENDENTE' | 'PROJECAO'
      observacao?: string
    }
  ): Promise<OpResult> => {
    const res = await apiMutate(`/transferencias/${id}`, 'PUT', payload)
    if (res.ok) await invalidarTudo()
    return { ok: res.ok, erro: res.erro }
  }

  const excluirTransferencia = async (idPar: string): Promise<OpResult> => {
    const res = await apiMutate(`/transferencias/${idPar}`, 'DELETE')
    if (res.ok) await invalidarTudo()
    return { ok: res.ok, erro: res.erro ?? null }
  }

  return {
    lancamentos,
    loading,
    fetching,
    error: error ? (error as Error).message : null,
    carregar,
    removerLocal,
    prefetchAdj,
    criar,
    editar,
    excluir,
    antecipar,
    alterarStatus,
    criarTransferencia,
    editarTransferencia,
    excluirTransferencia,
  }
}
