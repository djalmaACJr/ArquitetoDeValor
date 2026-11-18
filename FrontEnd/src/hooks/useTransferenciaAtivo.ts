import { useQueryClient } from '@tanstack/react-query'
import { apiMutate, type OpResult } from '../lib/api'
import { useContextoUserId } from './useEspacoAtivo'
import { qk } from '../lib/queryKeys'

export interface CriarTransferenciaAtivoInput {
  ativo_origem_id:    string
  conta_origem_id:    string
  ativo_destino_id:   string
  conta_destino_id?:  string
  quantidade_saida?:  number   // padrão: posição inteira
  quantidade_entrada: number
  custo_total?:       number   // padrão: qtd saída × preço médio (custo carregado, sem ganho/perda)
  data_operacao:      string
}

export interface TransferenciaAtivoCriada {
  id_par_transferencia: string
  custo_transferido:    number
}

// Migra posição de um ativo para outro carregando o custo (liquidação com
// entrega de cotas, incorporação, troca de ticker). Ver BUSINESS_RULES.md.
export function useTransferenciaAtivo() {
  const qc  = useQueryClient()
  const uid = useContextoUserId()

  const invalidar = async () => {
    await qc.invalidateQueries({ queryKey: qk.invAtivosPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invOperacoesPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invPosicoesPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invDashboardPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invRankingPref(uid) })
    await qc.invalidateQueries({ queryKey: qk.invHistoricoPref(uid) })
  }

  const criar = async (payload: CriarTransferenciaAtivoInput): Promise<OpResult<TransferenciaAtivoCriada>> => {
    const res = await apiMutate<TransferenciaAtivoCriada>('/investimentos/transferencias-ativo', 'POST', payload)
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: res.dados, erro: res.erro }
  }

  const excluir = async (idPar: string): Promise<OpResult> => {
    const res = await apiMutate(`/investimentos/transferencias-ativo/${idPar}`, 'DELETE')
    if (res.ok) await invalidar()
    return { ok: res.ok, dados: null, erro: res.erro }
  }

  return { criar, excluir }
}
