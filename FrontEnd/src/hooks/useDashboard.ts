// FrontEnd/src/hooks/useDashboard.ts

import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Conta, Transacao, ResumoMensal, DespesaCategoria } from '../types'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function apiFetch(path: string, session: { access_token: string }) {
  const separator = path.includes('?') ? '&' : '?'
  const fullPath = `${path}${separator}saldo=true`

  const res = await fetch(`${BASE}${fullPath}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ erro: res.statusText }))
    console.error(`❌ API ${fullPath}: ${res.status}`, err)
    throw new Error(`API ${fullPath}: ${res.status}`)
  }
  const data = await res.json()
  console.log(`✅ ${fullPath}:`, data.dados?.length ?? 0, 'itens')
  return data
}

/** Gera array com os últimos N meses a partir de ano/mes, em ordem cronológica */
function gerarUltimosMeses(ano: number, mes: number, n: number): string[] {
  const meses: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(ano, mes - 1 - i, 1)
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  return meses
}

function agruparPorCategoria(
  transacoes: Transacao[],
  tipo: 'RECEITA' | 'DESPESA',
  userId: string,
  mes: string,
  limite: number
): DespesaCategoria[] {
  const comCat = transacoes.filter(
    t => t.tipo === tipo && t.categoria_id && t.categoria_nome
  )
  const map = new Map<string, DespesaCategoria>()
  comCat.forEach(t => {
    const key = t.categoria_id!
    const ex  = map.get(key)
    if (ex) {
      ex.total += t.valor
    } else {
      map.set(key, {
        user_id:         userId,
        mes,
        categoria_id:    t.categoria_id!,
        categoria_nome:  t.categoria_nome!,
        categoria_icone: t.categoria_icone ?? '',
        total:           t.valor,
      })
    }
  })
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limite)
}

export function useDashboard(mes: string) {
  const [contas,      setContas]      = useState<Conta[]>([])
  const [pendentes,   setPendentes]   = useState<Transacao[]>([])
  const [proximas,    setProximas]    = useState<Transacao[]>([])
  const [resumo,      setResumo]      = useState<ResumoMensal | null>(null)
  const [despesasCat, setDespesasCat] = useState<DespesaCategoria[]>([])
  const [receitasCat, setReceitasCat] = useState<DespesaCategoria[]>([])
  const [historico,   setHistorico]   = useState<ResumoMensal[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setError('Não autenticado')
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const [anoStr, mesStr] = mes.split('-')
      const ano  = parseInt(anoStr)
      const m    = parseInt(mesStr)
      const hoje = new Date().toISOString().split('T')[0]

      console.log(`\n========== DASHBOARD ${mes} ==========`)

      // Gera os 6 meses do histórico (inclui o mês atual como último)
      const meses6 = gerarUltimosMeses(ano, m, 6)
      console.log(`📈 Meses do histórico: ${meses6.join(', ')}`)

      // Dispara todas as chamadas em paralelo:
      // - contas
      // - pendentes do mês atual
      // - 6 chamadas individuais por mês (histórico + mês atual)
      const [contasRes, pendentesRes, ...historicosRes] = await Promise.all([
        apiFetch('/contas', session),
        apiFetch(`/transacoes?status=PENDENTE&mes=${mes}`, session),
        ...meses6.map(m => apiFetch(`/transacoes?mes=${m}&per_page=200`, session)),
      ])

      // ─ CONTAS ─
      setContas(contasRes.dados ?? [])

      // ─ PENDENTES / PRÓXIMAS ─
      const todasPend: Transacao[] = pendentesRes.dados ?? []
      console.log(`📌 Pendentes: ${todasPend.length}`)
      setPendentes(todasPend.filter(t => t.data <= hoje))
      setProximas(todasPend.filter(t => t.data > hoje))

      // ─ RESUMO DO MÊS ATUAL ─
      // O mês atual é sempre o último item de meses6 / historicosRes
      const doMes: Transacao[] = historicosRes[historicosRes.length - 1]?.dados ?? []
      console.log(`📅 Transações de ${mes}: ${doMes.length}`)

      const entradas = doMes.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
      const saidas   = doMes.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)
      console.log(`💰 Resumo: E=${entradas} | S=${saidas}`)
      setResumo({ user_id: session.user.id, mes, total_entradas: entradas, total_saidas: saidas })

      // ─ DESPESAS E RECEITAS POR CATEGORIA ─
      setDespesasCat(agruparPorCategoria(doMes, 'DESPESA', session.user.id, mes, 5))
      setReceitasCat(agruparPorCategoria(doMes, 'RECEITA', session.user.id, mes, 4))

      // ─ HISTÓRICO 6 MESES ─
      console.log('\n📈 DEBUG HISTÓRICO:')
      const hist: ResumoMensal[] = meses6.map((mesStr, idx) => {
        const fatia: Transacao[] = historicosRes[idx]?.dados ?? []
        const totalEnt = fatia.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
        const totalSai = fatia.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)
        console.log(`   ${mesStr}: ${fatia.length} tx | E=${totalEnt} | S=${totalSai}`)
        return { user_id: session.user.id, mes: mesStr, total_entradas: totalEnt, total_saidas: totalSai }
      })
      setHistorico(hist)
      console.log(`   ✅ Histórico carregado com ${hist.length} meses`)

      console.log(`\n========== FIM DASHBOARD ==========\n`)
    } catch (e) {
      console.error('❌ Erro:', e)
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [mes])

  useEffect(() => { carregar() }, [carregar])

  return { contas, pendentes, proximas, resumo, despesasCat, receitasCat, historico, loading, error, refetch: carregar }
}
