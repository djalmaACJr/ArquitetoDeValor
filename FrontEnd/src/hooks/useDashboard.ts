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
    t => t.tipo === tipo && t.categoria_id && t.categoria_nome && !t.id_par_transferencia
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
      // Gera 6 meses terminando no mês selecionado (garante que o mês selecionado sempre esteja no histórico)
      const meses6 = gerarUltimosMeses(ano, m, 6)

      // Mês seguinte para cobrir "próximos 30 dias"
      const [anoN, mesN] = mes.split('-').map(Number)
      const mesSeguinte  = mesN === 12
        ? `${anoN + 1}-01`
        : `${anoN}-${String(mesN + 1).padStart(2, '0')}`

      const [contasRes, pendentesRes, proximosRes, ...historicosRes] = await Promise.all([
        apiFetch<Conta[]>('/contas', signal),
        apiFetch(`/transacoes?status=PENDENTE&mes=${mes}&per_page=500&saldo=true`, signal),
        apiFetch(`/transacoes?status=PENDENTE&mes=${mesSeguinte}&per_page=500&saldo=true`, signal),
        ...meses6.map(mesHist =>
          apiFetch(`/transacoes?mes=${mesHist}&per_page=1000&saldo=true`, signal)
        ),
      ])

      // ─ CONTAS ─
      setContas(extrairLista<Conta>(contasRes.dados))

      // ─ PENDENTES / PRÓXIMAS ─
      // Combina mês atual + mês seguinte para suportar filtro "30 dias"
      const filtrarTransf = (t: Transacao) =>
        !t.id_par_transferencia &&
        !t.descricao?.startsWith('[Transf.') &&
        t.categoria_nome !== 'Transferências'

      const pendMes      = extrairLista<Transacao>(pendentesRes.dados).filter(filtrarTransf)
      const pendProximos = extrairLista<Transacao>(proximosRes.dados).filter(filtrarTransf)
      const todasPend    = [...pendMes, ...pendProximos]

      setPendentes(todasPend.filter(t => t.data <= hoje))
      setProximas(todasPend.filter(t => t.data > hoje))

      // ─ RESUMO DO MÊS ATUAL (último dos 6) ─
      const doMes = extrairLista<Transacao>(historicosRes[historicosRes.length - 1]?.dados)

      // Exclui transferências — pelo id_par_transferencia, prefixo na descrição OU categoria "Transferências"
      const isTransf = (t: Transacao) =>
        !!t.id_par_transferencia ||
        t.descricao?.startsWith('[Transf.') ||
        t.categoria_nome === 'Transferências'
      const entradas = doMes.filter(t => t.tipo === 'RECEITA' && !isTransf(t)).reduce((s, t) => s + t.valor, 0)
      const saidas   = doMes.filter(t => t.tipo === 'DESPESA' && !isTransf(t)).reduce((s, t) => s + t.valor, 0)

      setResumo({ mes, total_entradas: entradas, total_saidas: saidas })
      setDespesasCat(agruparPorCategoria(doMes, 'DESPESA', 5))
      setReceitasCat(agruparPorCategoria(doMes, 'RECEITA', 4))

      // ─ HISTÓRICO 6 MESES ─
      // saldo_acumulado: pega o maior saldo_acumulado do último lançamento PAGO do mês
      const hist: ResumoMensal[] = meses6.map((mesHist, idx) => {
        const fatia = extrairLista<Transacao>(historicosRes[idx]?.dados)
        const isTransfH = (t: Transacao) =>
          !!t.id_par_transferencia ||
          t.descricao?.startsWith('[Transf.') ||
          t.categoria_nome === 'Transferências'
        const totalEnt = fatia.filter(t => t.tipo === 'RECEITA' && !isTransfH(t)).reduce((s, t) => s + t.valor, 0)
        const totalSai = fatia.filter(t => t.tipo === 'DESPESA' && !isTransfH(t)).reduce((s, t) => s + t.valor, 0)
        // Saldo ao final do mês: saldo_acumulado do último lançamento do mês
        // (global — PARTITION BY user_id na view, já inclui todas as contas)
        // Usa o último lançamento independente de status (data ASC, criado_em ASC)
        const comSaldoAcum = fatia.filter(t => t.saldo_acumulado !== undefined)
        const saldo_mes = comSaldoAcum.length > 0
          ? comSaldoAcum[comSaldoAcum.length - 1].saldo_acumulado!
          : 0
        return { mes: mesHist, total_entradas: totalEnt, total_saidas: totalSai, saldo_mes }
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
