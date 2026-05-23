// src/hooks/useSaldoBaseMes.ts
//
// Hook que devolve o saldo PAGO de cada conta do usuário até o último dia
// do mês ANTERIOR ao `mes` informado. Resultado em mapa { conta_id → saldo }.
// Usado por Dashboard (alertas de saldo negativo) e Extrato (recálculo de
// saldo acumulado por conta).
//
// Antes esse mesmo código existia inline duplicado em DashboardPage e
// LancamentosPage — agora vive aqui. Como a função `fn_saldos_contas_ate_data`
// é SECURITY INVOKER e valida `auth.uid()`, o user_id passado precisa ser o
// próprio usuário; obtemos via supabase.auth.getSession() para evitar passar
// errado por engano.

import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ultimoDiaMesAnterior } from '../lib/utils'
import { log } from '../lib/logger'

export type SaldoBaseMes = Record<string, number>

export function useSaldoBaseMes(mes: string, ativo: boolean = true): SaldoBaseMes {
  const [saldoBase, setSaldoBase] = useState<SaldoBaseMes>({})

  useEffect(() => {
    if (!ativo) return
    const [y, m] = mes.split('-').map(Number)
    if (Number.isNaN(y) || Number.isNaN(m)) return

    const dataLimite = ultimoDiaMesAnterior(mes)
    let cancelado = false

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelado || !session?.user?.id) return
      supabase
        .schema('arqvalor')
        .rpc('fn_saldos_contas_ate_data', {
          p_user_id: session.user.id,
          p_data:    dataLimite,
        })
        .then(({ data, error }) => {
          if (cancelado) return
          if (error) { log('[useSaldoBaseMes] erro:', error); return }
          const mapa: SaldoBaseMes = {}
          ;(data as { conta_id: string; saldo: number }[] ?? []).forEach(r => {
            mapa[r.conta_id] = r.saldo
          })
          setSaldoBase(mapa)
        })
    })

    return () => { cancelado = true }
  }, [mes, ativo])

  // Quando o hook é desativado (ex.: filtro de conta muda no Extrato),
  // descartamos o saldo retornado ao chamador, sem precisar setar estado.
  return ativo ? saldoBase : EMPTY
}

const EMPTY: SaldoBaseMes = Object.freeze({}) as SaldoBaseMes
