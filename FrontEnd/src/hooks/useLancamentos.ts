// src/hooks/useLancamentos.ts
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate } from '../lib/api'
import { qk } from '../lib/queryKeys'

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

async function fetchLancamentos(filtros: FiltrosLancamento, signal?: AbortSignal): Promise<Lancamento[]> {
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

export function useLancamentos(filtros: FiltrosLancamento) {
  const qc = useQueryClient()

  const { data: lancamentos = [], isLoading: loading, error } = useQuery({
    queryKey: qk.lancamentos(filtros),
    queryFn:  ({ signal }) => fetchLancamentos(filtros, signal),
  })

  const carregar = async () => {
    await qc.invalidateQueries({ queryKey: qk.lancamentos(filtros) })
  }

  // Atualização local — atualiza o cache do TanStack diretamente sem refetch
  const atualizarLocal = (id: string, campos: Partial<Lancamento>) => {
    qc.setQueryData<Lancamento[]>(qk.lancamentos(filtros), prev =>
      prev?.map(l => l.id === id ? { ...l, ...campos } : l) ?? []
    )
  }

  // Remove imediatamente da lista local — usado após exclusão via Drawer
  const removerLocal = (id: string, idPar?: string | null) => {
    qc.setQueryData<Lancamento[]>(qk.lancamentos(filtros), prev =>
      idPar
        ? prev?.filter(l => l.id_par_transferencia !== idPar) ?? []
        : prev?.filter(l => l.id !== id) ?? []
    )
  }

  // Invalida TODAS as queries de lançamentos (qualquer filtro) — usado quando
  // a mudança pode afetar outros meses/filtros.
  const invalidarTudo = () => qc.invalidateQueries({ queryKey: ['lancamentos'] })

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
    error: error ? (error as Error).message : null,
    carregar,
    removerLocal,
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
