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
    if (ex) { ex.total += t.valor }
    else {
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

/** Extrai totais por status de uma fatia de transações já filtrada */
function calcularStatusMes(fatia: Transacao[]) {
  const soma = (tipo: 'RECEITA' | 'DESPESA', status: string) =>
    fatia.filter(t => t.tipo === tipo && t.status === status).reduce((s, t) => s + t.valor, 0)
  return {
    pagos:     { receitas: soma('RECEITA', 'PAGO'),     despesas: soma('DESPESA', 'PAGO')     },
    pendentes: { receitas: soma('RECEITA', 'PENDENTE'), despesas: soma('DESPESA', 'PENDENTE') },
    projecoes: { receitas: soma('RECEITA', 'PROJECAO'), despesas: soma('DESPESA', 'PROJECAO') },
  }
}

export function useDashboard(mes: string, contasFiltro: string[] = []) {
  const [contas,           setContas]           = useState<Conta[]>([])
  const [pendentes,        setPendentes]        = useState<Transacao[]>([])
  const [proximas,         setProximas]         = useState<Transacao[]>([])
  const [resumo,           setResumo]           = useState<ResumoMensal | null>(null)
  const [despesasCat,      setDespesasCat]      = useState<DespesaCategoria[]>([])
  const [receitasCat,      setReceitasCat]      = useState<DespesaCategoria[]>([])
  const [historico,        setHistorico]        = useState<ResumoMensal[]>([])
  const [pagos,            setPagos]            = useState<{ receitas: number; despesas: number }[]>([])
  const [pendentesStatus,  setPendentesStatus]  = useState<{ receitas: number; despesas: number }[]>([])
  const [projecoes,        setProjecoes]        = useState<{ receitas: number; despesas: number }[]>([])
  const [loading,          setLoading]          = useState(true)
  const [loadingHistorico, setLoadingHistorico] = useState(true)
  const [error,            setError]            = useState<string | null>(null)

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
    setLoadingHistorico(true)
    setError(null)

    try {
      const meses6          = gerarUltimosMeses(ano, m, 6)
      const mesesAnteriores = meses6.slice(0, 5) // 5 meses antes do atual

      const [anoN, mesN] = mes.split('-').map(Number)
      const mesSeguinte  = mesN === 12
        ? `${anoN + 1}-01`
        : `${anoN}-${String(mesN + 1).padStart(2, '0')}`
      const contaParam = contasFiltro.length === 1 ? `&conta_id=${contasFiltro[0]}` : ''

      // ── FASE 1: 4 chamadas — libera a página imediatamente ────────────────
      const [contasRes, pendentesRes, proximosRes, mesAtualRes] = await Promise.all([
        apiFetch<Conta[]>('/contas', signal),
        apiFetch(`/transacoes?status=PENDENTE&mes=${mes}&per_page=500&saldo=true${contaParam}`, signal),
        apiFetch(`/transacoes?status=PENDENTE&mes=${mesSeguinte}&per_page=500&saldo=true${contaParam}`, signal),
        apiFetch(`/transacoes?mes=${mes}&per_page=1000&saldo=true${contaParam}`, signal),
      ])
      if (signal?.aborted) return

      const ehTransf = (t: Transacao) =>
        !!t.id_par_transferencia ||
        (t.descricao?.startsWith('[Transf.') ?? false) ||
        t.categoria_nome === 'Transferências'

      const filtrarTx = (t: Transacao) =>
        !ehTransf(t) && (contasFiltro.length === 0 || contasFiltro.includes(t.conta_id))

      // ─ Contas ─
      setContas(extrairLista<Conta>(contasRes.dados))

      // ─ Pendentes / Próximas ─
      const pendMes      = extrairLista<Transacao>(pendentesRes.dados).filter(filtrarTx)
      const pendProximos = extrairLista<Transacao>(proximosRes.dados).filter(filtrarTx)
      const todasPend    = [...pendMes, ...pendProximos]
      setPendentes(todasPend.filter(t => t.data <= hoje))
      setProximas(todasPend.filter(t => t.data > hoje))

      // ─ Resumo do mês atual ─
      const doMes    = extrairLista<Transacao>(mesAtualRes.dados).filter(filtrarTx)
      const entradas = doMes.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
      const saidas   = doMes.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)
      setResumo({ mes, total_entradas: entradas, total_saidas: saidas })
      setDespesasCat(agruparPorCategoria(doMes, 'DESPESA', 5))
      setReceitasCat(agruparPorCategoria(doMes, 'RECEITA', 4))

      setLoading(false) // ← página renderiza, gráfico ainda mostra skeleton

      // ── FASE 2: 5 meses anteriores — atualiza o gráfico em background ─────
      const historicosAntRes = await Promise.all(
        mesesAnteriores.map(mesHist =>
          apiFetch(`/transacoes?mes=${mesHist}&per_page=1000&saldo=true${contaParam}`, signal)
        )
      )
      if (signal?.aborted) return

      // Combina os 5 anteriores + mês atual (reutiliza a resposta da fase 1, sem re-fetch)
      const todosRes = [...historicosAntRes, mesAtualRes]

      const historicoStatus = meses6.map((_, idx) => {
        const fatia = extrairLista<Transacao>(todosRes[idx]?.dados).filter(filtrarTx)
        return calcularStatusMes(fatia)
      })
      setPagos(historicoStatus.map(h => h.pagos))
      setPendentesStatus(historicoStatus.map(h => h.pendentes))
      setProjecoes(historicoStatus.map(h => h.projecoes))

      const hist: ResumoMensal[] = meses6.map((mesHist, idx) => {
        const fatia     = extrairLista<Transacao>(todosRes[idx]?.dados)
        const fatiaFilt = fatia.filter(t => !ehTransf(t) && (contasFiltro.length === 0 || contasFiltro.includes(t.conta_id)))
        const totalEnt  = fatiaFilt.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
        const totalSai  = fatiaFilt.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)

        let saldo_mes: number
        if (contasFiltro.length === 0) {
          const comSaldoAcum = fatia.filter(t => t.saldo_acumulado !== undefined)
          saldo_mes = comSaldoAcum.length > 0 ? comSaldoAcum[comSaldoAcum.length - 1].saldo_acumulado! : 0
        } else {
          const fatiaConta = fatia.filter(t => contasFiltro.includes(t.conta_id) && !ehTransf(t))
          const entPagas   = fatiaConta.filter(t => t.tipo === 'RECEITA' && t.status === 'PAGO').reduce((s, t) => s + t.valor, 0)
          const saiPagas   = fatiaConta.filter(t => t.tipo === 'DESPESA' && t.status === 'PAGO').reduce((s, t) => s + t.valor, 0)
          const comSaldo   = fatiaConta.filter(t => t.saldo_acumulado !== undefined)
          saldo_mes = comSaldo.length > 0 ? comSaldo[comSaldo.length - 1].saldo_acumulado! : entPagas - saiPagas
        }
        return { mes: mesHist, total_entradas: totalEnt, total_saidas: totalSai, saldo_mes }
      })
      setHistorico(hist)

    } catch (e) {
      if ((e as Error).name === 'AbortError') return
      setError((e as Error).message)
    } finally {
      setLoading(false)
      setLoadingHistorico(false)
    }
  }, [mes, contasFiltro]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const controller = new AbortController()
    carregar(controller.signal)
    return () => controller.abort()
  }, [carregar])

  return {
    contas, pendentes, proximas, resumo, despesasCat, receitasCat,
    historico, pagos, pendentesStatus, projecoes,
    loading, loadingHistorico, error, refetch: carregar,
  }
}
