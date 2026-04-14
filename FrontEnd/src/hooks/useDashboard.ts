// src/hooks/useDashboard.ts
import { useState, useEffect, useCallback } from 'react'
import { apiFetch, extrairLista } from '../lib/api'
import type { Conta, Transacao, ResumoMensal, DespesaCategoria } from '../types'

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
        categoria_id:    t.categoria_id!,
        categoria_nome:  t.categoria_nome!,
        categoria_icone: t.categoria_icone ?? '',
        total:           t.valor,
      })
    }
  })
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limite)
}

/** Parseia "YYYY-MM" com segurança — retorna null se inválido */
function parseMes(mes: string): { ano: number; m: number } | null {
  const [anoStr, mesStr] = mes.split('-')
  const ano = parseInt(anoStr, 10)
  const m   = parseInt(mesStr, 10)
  if (Number.isNaN(ano) || Number.isNaN(m) || m < 1 || m > 12) return null
  return { ano, m }
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

  const carregar = useCallback(async (signal?: AbortSignal) => {
    const parsed = parseMes(mes)
    if (!parsed) {
      setError(`Mês inválido: ${mes}`)
      setLoading(false)
      return
    }
    const { ano, m } = parsed
    const hoje = new Date().toISOString().split('T')[0]

    setLoading(true)
    setError(null)

    try {
      const meses6 = gerarUltimosMeses(ano, m, 6)

      const [contasRes, pendentesRes, ...historicosRes] = await Promise.all([
        apiFetch<Conta[]>('/contas', signal),
        apiFetch(`/transacoes?status=PENDENTE&mes=${mes}&saldo=true`, signal),
        ...meses6.map(mesHist =>
          apiFetch(`/transacoes?mes=${mesHist}&per_page=200&saldo=true`, signal)
        ),
      ])

      // ─ CONTAS ─
      // A API de contas retorna { dados: Conta[] } — extrairLista resolve sem cast
      setContas(extrairLista<Conta>(contasRes.dados))

      // ─ PENDENTES / PRÓXIMAS ─
      const todasPend = extrairLista<Transacao>(pendentesRes.dados)
      setPendentes(todasPend.filter(t => t.data <= hoje))
      setProximas(todasPend.filter(t => t.data > hoje))

      // ─ RESUMO DO MÊS ATUAL (último dos 6) ─
      const doMes = extrairLista<Transacao>(historicosRes[historicosRes.length - 1]?.dados)

      const entradas = doMes.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
      const saidas   = doMes.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)

      setResumo({ mes, total_entradas: entradas, total_saidas: saidas })
      setDespesasCat(agruparPorCategoria(doMes, 'DESPESA', 5))
      setReceitasCat(agruparPorCategoria(doMes, 'RECEITA', 4))

      // ─ HISTÓRICO 6 MESES ─
      const hist: ResumoMensal[] = meses6.map((mesHist, idx) => {
        const fatia = extrairLista<Transacao>(historicosRes[idx]?.dados)
        const totalEnt = fatia.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
        const totalSai = fatia.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)
        return { mes: mesHist, total_entradas: totalEnt, total_saidas: totalSai }
      })
      setHistorico(hist)

    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [mes])

  useEffect(() => {
    const controller = new AbortController()
    carregar(controller.signal)
    return () => controller.abort()
  }, [carregar])

  return { contas, pendentes, proximas, resumo, despesasCat, receitasCat, historico, loading, error, refetch: carregar }
}
