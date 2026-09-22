// src/hooks/useAvisosDataCom.ts
//
// Aviso de login: ativos da carteira cuja "Data COM" (última data com
// direito ao próximo provento) cai nos próximos DIAS_JANELA dias — última
// chance de manter/comprar o papel antes dele virar "ex". Fonte: os
// próprios proventos já provisionados pelo cron `dividendos-cron-br`
// (`inv_dividendos.data_com`, ver dividendos.ts), reaproveitando o hook
// genérico `useDividendos` — sem endpoint novo.
//
// "Visto" é um CONJUNTO de chaves "ticker|data_com" (usuarios.
// datacom_avisos_vistos), não um timestamp único como `cron_avisos_vistos_em`
// (useAvisosCron.ts): o conjunto de ativos "na janela" muda todo dia (um
// item sai quando a data passa, outro pode entrar), então um corte único
// esconderia um ativo novo que entrasse na janela antes da próxima
// dispensa. Ao dispensar, funde as chaves atualmente exibidas no conjunto
// e poda as que já passaram da data (evita crescer pra sempre).
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { hojeLocal, dataParaYMD } from '../lib/utils'
import { useAuth } from './useAuth'
import { useDividendos } from './useDividendos'

const DIAS_JANELA = 5

export interface AvisoDataComItem {
  ativo_id:        string
  ticker:          string
  data_com:        string
  valor_projetado: number
}

function chave(ticker: string, dataCom: string): string {
  return `${ticker}|${dataCom}`
}

export function useAvisosDataCom() {
  const qc = useQueryClient()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null

  // Já carregado em várias telas do módulo — cache do React Query dedupe a
  // requisição, não paga custo extra por causa deste hook.
  const { dividendos } = useDividendos({})

  // Lazy initializers: o relógio só é lido 1x (na montagem), não a cada
  // render — mesmo padrão de useAvisosCron.ts (Date.now/new Date direto no
  // corpo do componente/useMemo é impuro e quebra a regra de pureza dos hooks).
  const [hoje]   = useState(() => hojeLocal())
  const [limite] = useState(() => dataParaYMD(new Date(Date.now() + DIAS_JANELA * 86_400_000)))

  const { data: vistos = [] } = useQuery({
    queryKey: qk.invDataComVistos(uid),
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .schema('arqvalor')
        .from('usuarios')
        .select('datacom_avisos_vistos')
        .eq('id', uid!)
        .single()
      if (error) throw error
      return (data?.datacom_avisos_vistos as string[] | null) ?? []
    },
    enabled: !!uid,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  const avisos = useMemo<AvisoDataComItem[]>(() => {
    const vistosSet = new Set(vistos)

    // Dedup por ativo: guarda só a Data COM mais próxima de cada um.
    const porAtivo = new Map<string, AvisoDataComItem>()
    for (const d of dividendos) {
      if (!d.data_com || d.data_com < hoje || d.data_com > limite) continue
      if (d.transacoes?.status !== 'PROJECAO') continue
      const ticker = d.inv_ativos?.ticker ?? ''
      if (!ticker || vistosSet.has(chave(ticker, d.data_com))) continue
      const atual = porAtivo.get(d.ativo_id)
      if (!atual || d.data_com < atual.data_com) {
        porAtivo.set(d.ativo_id, { ativo_id: d.ativo_id, ticker, data_com: d.data_com, valor_projetado: d.valor })
      }
    }
    return [...porAtivo.values()].sort((a, b) => a.data_com.localeCompare(b.data_com))
  }, [dividendos, vistos, hoje, limite])

  const dispensar = async () => {
    if (!uid || avisos.length === 0) return
    const novoConjunto = new Set(vistos.filter((v) => {
      const dataCom = v.split('|')[1]
      return dataCom && dataCom >= hoje // poda chaves de datas já passadas
    }))
    for (const a of avisos) novoConjunto.add(chave(a.ticker, a.data_com))
    const novaLista = [...novoConjunto]
    qc.setQueryData(qk.invDataComVistos(uid), novaLista)
    await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ datacom_avisos_vistos: novaLista })
      .eq('id', uid)
  }

  return { avisos, dispensar }
}
