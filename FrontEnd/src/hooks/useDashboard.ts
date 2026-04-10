import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Conta, Transacao, ResumoMensal, DespesaCategoria } from '../types'

const BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`

async function apiFetch(path: string, session: { access_token: string }) {
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
  })
  if (!res.ok) throw new Error(`API ${path}: ${res.status}`)
  return res.json()
}

export function useDashboard(mes: string) {
  const [contas, setContas]     = useState<Conta[]>([])
  const [pendentes, setPendentes] = useState<Transacao[]>([])
  const [proximas, setProximas]   = useState<Transacao[]>([])
  const [resumo, setResumo]     = useState<ResumoMensal | null>(null)
  const [despesasCat, setDespesasCat] = useState<DespesaCategoria[]>([])
  const [receitasCat, setReceitasCat] = useState<DespesaCategoria[]>([])
  const [historico, setHistorico] = useState<ResumoMensal[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  const carregar = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return

    setLoading(true)
    setError(null)

    try {
      const [anoStr, mesStr] = mes.split('-')
      const ano = parseInt(anoStr)
      const m   = parseInt(mesStr)
      const hoje = new Date().toISOString().split('T')[0]

      const [
        contasRes,
        pendentesRes,
        resumoMensalRes,
      ] = await Promise.all([
        apiFetch('/contas', session),
        apiFetch(`/transacoes?status=PENDENTE&mes=${mes}`, session),
        apiFetch('/transacoes', session),
      ])

      setContas(contasRes.dados ?? [])

      // Anteriores não consolidadas: PENDENTE ou PROJECAO com data <= hoje
      const todasPend: Transacao[] = pendentesRes.dados ?? []
      setPendentes(todasPend.filter((t: Transacao) => t.data <= hoje))
      setProximas(todasPend.filter((t: Transacao) => t.data > hoje))

      // Resumo do mês atual a partir das transações
      const todas: Transacao[] = resumoMensalRes.dados ?? []
      const doMes = todas.filter((t: Transacao) => t.ano_tx === ano && t.mes_tx === m)
      const entradas = doMes.filter((t: Transacao) => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
      const saidas   = doMes.filter((t: Transacao) => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)
      setResumo({ user_id: session.user.id, mes, total_entradas: entradas, total_saidas: saidas })

      // Agrupamento por categoria — despesas
      const mapDesp = new Map<string, DespesaCategoria>()
      doMes.filter((t: Transacao) => t.tipo === 'DESPESA' && t.categoria_nome).forEach((t: Transacao) => {
        const key = t.categoria_id ?? t.categoria_nome!
        const ex  = mapDesp.get(key)
        if (ex) ex.total += t.valor
        else mapDesp.set(key, { user_id: session.user.id, mes, categoria_id: t.categoria_id ?? '', categoria_nome: t.categoria_nome!, categoria_icone: t.categoria_icone ?? '', total: t.valor })
      })
      setDespesasCat([...mapDesp.values()].sort((a, b) => b.total - a.total).slice(0, 5))

      // Agrupamento por categoria — receitas
      const mapRec = new Map<string, DespesaCategoria>()
      doMes.filter((t: Transacao) => t.tipo === 'RECEITA' && t.categoria_nome).forEach((t: Transacao) => {
        const key = t.categoria_id ?? t.categoria_nome!
        const ex  = mapRec.get(key)
        if (ex) ex.total += t.valor
        else mapRec.set(key, { user_id: session.user.id, mes, categoria_id: t.categoria_id ?? '', categoria_nome: t.categoria_nome!, categoria_icone: t.categoria_icone ?? '', total: t.valor })
      })
      setReceitasCat([...mapRec.values()].sort((a, b) => b.total - a.total).slice(0, 4))

      // Histórico últimos 6 meses
      const hist: ResumoMensal[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(ano, m - 1 - i, 1)
        const a = d.getFullYear(), mm = d.getMonth() + 1
        const fatia = todas.filter((t: Transacao) => t.ano_tx === a && t.mes_tx === mm)
        hist.push({
          user_id: session.user.id,
          mes: `${a}-${String(mm).padStart(2, '0')}`,
          total_entradas: fatia.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0),
          total_saidas:   fatia.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0),
        })
      }
      setHistorico(hist)

    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [mes])

  useEffect(() => { carregar() }, [carregar])

  return { contas, pendentes, proximas, resumo, despesasCat, receitasCat, historico, loading, error, refetch: carregar }
}
