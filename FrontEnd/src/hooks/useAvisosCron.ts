// src/hooks/useAvisosCron.ts
//
// Aviso de login pros admins quando algum cron falhou — inclui a classe de
// falha que cron_execucoes sozinha não pegava (pg_cron/pg_net não conseguindo
// nem chegar na Edge Function, ex.: secret ausente do Vault — achado real,
// rendimento-cripto-diario ficou 30 dias falhando 100% sem nenhum aviso).
// fn_verificar_saude_cron (20260821000002) grava essa classe de falha como
// uma linha normal de cron_execucoes (status='erro'), então este hook só
// filtra o que já não foi visto — reaproveita useCronExecucoes, sem endpoint
// novo.
//
// "Visto até" é POR ADMIN (usuarios.cron_avisos_vistos_em, cada um dispensa
// por conta própria) — NULL vira "últimos 7 dias" pra não despejar o
// histórico inteiro na primeira vez que a coluna existir.

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { qk } from '../lib/queryKeys'
import { useAuth } from './useAuth'
import { useAdmin } from './useAdmin'
import { useCronExecucoes, type CronExecucao } from './useCronExecucoes'

const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000

export function useAvisosCron() {
  const isAdmin = useAdmin()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  const qc = useQueryClient()

  const { execucoes } = useCronExecucoes(isAdmin)

  const { data: vistosEm = null } = useQuery({
    queryKey: qk.cronAvisosVistos(uid),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .schema('arqvalor')
        .from('usuarios')
        .select('cron_avisos_vistos_em')
        .eq('id', uid!)
        .single()
      if (error) throw error
      return (data?.cron_avisos_vistos_em as string | null) ?? null
    },
    enabled: !!uid && isAdmin,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  })

  // Lazy initializer: Date.now() só é chamado 1x (na montagem), não a cada
  // render — evita a impureza de ler o relógio direto no corpo do componente.
  const [seteDiasAtras] = useState(() => new Date(Date.now() - SETE_DIAS_MS))
  const corte = vistosEm ? new Date(vistosEm) : seteDiasAtras
  const avisos: CronExecucao[] = isAdmin
    ? execucoes.filter(e => e.status === 'erro' && new Date(e.executado_em) > corte)
    : []

  const dispensar = async () => {
    if (!uid) return
    const agora = new Date().toISOString()
    qc.setQueryData(qk.cronAvisosVistos(uid), agora)
    await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ cron_avisos_vistos_em: agora })
      .eq('id', uid)
  }

  return { avisos, dispensar }
}
