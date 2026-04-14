// src/hooks/useDashboard.ts
import { useState, useEffect, useCallback } from 'react'
import { apiFetch } from '../lib/api'
import { mesAtual } from '../lib/utils'
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
    // Validação de "mes" antes de qualquer request
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
      // Gera os 6 meses do histórico (inclui o mês atual como último)
      const meses6 = gerarUltimosMeses(ano, m, 6)

      // 8 requests paralelos com AbortSignal compartilhado
      const [contasRes, pendentesRes, ...historicosRes] = await Promise.all([
        apiFetch<Conta[]>('/contas', signal),
        apiFetch<{ dados: Transacao[] }>(`/transacoes?status=PENDENTE&mes=${mes}&saldo=true`, signal),
        ...meses6.map(mesHist =>
          apiFetch<{ dados: Transacao[] }>(`/transacoes?mes=${mesHist}&per_page=200&saldo=true`, signal)
        ),
      ])

      // ─ CONTAS ─
      setContas(contasRes.dados ?? [])

      // ─ PENDENTES / PRÓXIMAS ─
      const todasPend: Transacao[] = (pendentesRes.dados as unknown as { dados: Transacao[] })?.dados
        ?? (pendentesRes.dados as unknown as Transacao[])
        ?? []
      setPendentes(todasPend.filter(t => t.data <= hoje))
      setProximas(todasPend.filter(t => t.data > hoje))

      // ─ RESUMO DO MÊS ATUAL (último dos 6) ─
      const dadosMesAtual = historicosRes[historicosRes.length - 1]
      const doMes: Transacao[] = (dadosMesAtual?.dados as unknown as { dados: Transacao[] })?.dados
        ?? (dadosMesAtual?.dados as unknown as Transacao[])
        ?? []

      const entradas = doMes.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
      const saidas   = doMes.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)

      // userId disponível via API — usa fallback genérico pois não exposto diretamente aqui
      const userId = ''
      setResumo({ user_id: userId, mes, total_entradas: entradas, total_saidas: saidas })
      setDespesasCat(agruparPorCategoria(doMes, 'DESPESA', userId, mes, 5))
      setReceitasCat(agruparPorCategoria(doMes, 'RECEITA', userId, mes, 4))

      // ─ HISTÓRICO 6 MESES ─
      // Variável de iteração renomeada para mesHist (evita shadowing com "mes" do escopo externo)
      const hist: ResumoMensal[] = meses6.map((mesHist, idx) => {
        const resHist = historicosRes[idx]
        const fatia: Transacao[] = (resHist?.dados as unknown as { dados: Transacao[] })?.dados
          ?? (resHist?.dados as unknown as Transacao[])
          ?? []
        const totalEnt = fatia.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
        const totalSai = fatia.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)
        return { user_id: userId, mes: mesHist, total_entradas: totalEnt, total_saidas: totalSai }
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
