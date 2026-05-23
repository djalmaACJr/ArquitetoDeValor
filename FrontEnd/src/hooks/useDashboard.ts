// src/hooks/useDashboard.ts
import { useMemo, useEffect, useState } from 'react'
import { useQuery, useQueries, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { apiFetch, extrairLista } from '../lib/api'
import { qk } from '../lib/queryKeys'
import { hojeLocal } from '../lib/utils'
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

/**
 * Agrupa transações por categoria classificando cada categoria como RECEITA
 * ou DESPESA pelo SALDO LÍQUIDO (somaReceitas − somaDespesas) naquele recorte.
 *
 * Motivo: o schema não tem categorias específicas de receita ou despesa — a
 * mesma categoria pode receber lançamentos de ambos os tipos (ex.: "Salário"
 * com estorno pontual, "Supermercado" com cashback). Aqui a categoria aparece
 * em UM donut só, classificada pelo sinal do líquido.
 *
 * Regra:
 *  - liquido > 0 → categoria classificada como RECEITA; total exibido = liquido.
 *  - liquido < 0 → categoria classificada como DESPESA; total exibido = |liquido|.
 *  - liquido = 0 → não entra em nenhum donut.
 */
function agruparPorCategoria(
  transacoes: Transacao[],
  tipoDesejado: 'RECEITA' | 'DESPESA',
): DespesaCategoria[] {
  interface Acc {
    nome:  string; icone: string
    somaR: number; somaD:  number
  }
  const map = new Map<string, Acc>()
  for (const t of transacoes) {
    if (!t.categoria_id || !t.categoria_nome) continue
    const ex = map.get(t.categoria_id) ?? {
      nome:  t.categoria_nome,
      icone: t.categoria_icone ?? '',
      somaR: 0, somaD: 0,
    }
    if (t.tipo === 'RECEITA') ex.somaR += t.valor
    else                       ex.somaD += t.valor
    map.set(t.categoria_id, ex)
  }

  const resultado: DespesaCategoria[] = []
  for (const [id, v] of map) {
    const liquido = v.somaR - v.somaD
    if (tipoDesejado === 'RECEITA' && liquido > 0) {
      resultado.push({ categoria_id: id, categoria_nome: v.nome, categoria_icone: v.icone, total: liquido })
    } else if (tipoDesejado === 'DESPESA' && liquido < 0) {
      resultado.push({ categoria_id: id, categoria_nome: v.nome, categoria_icone: v.icone, total: -liquido })
    }
  }
  return resultado.sort((a, b) => b.total - a.total)
}

/** Parseia "YYYY-MM" com segurança — retorna null se inválido */
function parseMes(mes: string): { ano: number; m: number } | null {
  const [anoStr, mesStr] = mes.split('-')
  const ano = parseInt(anoStr, 10)
  const m   = parseInt(mesStr, 10)
  if (Number.isNaN(ano) || Number.isNaN(m) || m < 1 || m > 12) return null
  return { ano, m }
}

/** Calcula mês adjacente com delta (ex: -1 = mês anterior, +1 = próximo) */
function mesAdjacente(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

const ehTransf = (t: Transacao) =>
  !!t.id_par_transferencia ||
  (t.descricao?.startsWith('[Transf.') ?? false) ||
  t.categoria_nome === 'Transferências'

interface Fase1 {
  pendMes:   Transacao[]
  pendProx:  Transacao[]
  doMesRaw:  Transacao[]   // sem aplicar filtros (para histórico fase 2)
}

async function fetchContas(signal?: AbortSignal): Promise<Conta[]> {
  const res = await apiFetch<Conta[]>('/contas', signal)
  if (!res.ok) throw new Error(res.erro ?? 'Erro ao carregar contas')
  return extrairLista<Conta>(res.dados)
}

async function fetchFase1(mes: string, signal?: AbortSignal): Promise<Fase1> {
  const [anoN, mesN] = mes.split('-').map(Number)
  const mesSeguinte = mesN === 12
    ? `${anoN + 1}-01`
    : `${anoN}-${String(mesN + 1).padStart(2, '0')}`

  const [mesAtualRes, mesSeguinteRes] = await Promise.all([
    apiFetch(`/transacoes?mes=${mes}&per_page=1000&saldo=true`, signal),
    apiFetch(`/transacoes?mes=${mesSeguinte}&per_page=1000&saldo=true`, signal),
  ])

  const doMesRaw  = extrairLista<Transacao>(mesAtualRes.dados)
  const doProxRaw = extrairLista<Transacao>(mesSeguinteRes.dados)
  const naoPago = (t: Transacao) => t.status === 'PENDENTE' || t.status === 'PROJECAO'

  return {
    pendMes:  doMesRaw.filter(naoPago),
    pendProx: doProxRaw.filter(naoPago),
    doMesRaw,
  }
}

/**
 * Busca todas as transações de um mês individual.
 * Usado pelo histórico (1 query por mês, cache compartilhado entre navegações).
 */
async function fetchTransacoesMes(mes: string, signal?: AbortSignal): Promise<Transacao[]> {
  const res = await apiFetch(`/transacoes?mes=${mes}&per_page=1000&saldo=true`, signal)
  return extrairLista<Transacao>(res.dados)
}

export function useDashboard(
  mes: string,
  contasFiltro: string[] = [],
  filtCats:     string[] = [],
  filtStatus:   string[] = [],
) {
  const qc = useQueryClient()
  const parsed = useMemo(() => parseMes(mes), [mes])
  
  // Lazy-load: ativa fase 2 somente após UI renderizar (500ms)
  const [fase2Enabled, setFase2Enabled] = useState(false)
  useEffect(() => {
    const timer = setTimeout(() => setFase2Enabled(true), 500)
    return () => clearTimeout(timer)
  }, [])

  // ── Prefetch em background: 3 meses para trás + 3 meses para frente ─────
  // Prefetcha tanto fase 1 (alertas/saldo) quanto cada mês individual do
  // histórico para que ambos os gráficos fiquem prontos ao navegar.
  useEffect(() => {
    if (!parsed) return

    // Prefetcha a janela do histórico completo + alguns meses adjacentes,
    // para que a troca de mês por setas e teclado já tenha os dados em cache.
    for (const delta of [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3]) {
      const mesPrefetch = mesAdjacente(mes, delta)
      if (delta !== 0) {
        qc.prefetchQuery({
          queryKey: ['dashboard-fase1', mesPrefetch],
          queryFn: ({ signal }) => fetchFase1(mesPrefetch, signal),
          staleTime: 60_000,
        })
      }

      // Mes individual — alimenta o histórico de QUALQUER mês adjacente
      // (cache key compartilhado entre todas as visões do dashboard)
      qc.prefetchQuery({
        queryKey: ['transacoes-mes', mesPrefetch],
        queryFn: ({ signal }) => fetchTransacoesMes(mesPrefetch, signal),
        staleTime: 60_000,
      })
    }
  }, [mes, parsed, qc])

  // Contas (cache compartilhado com useContas via mesma query key)
  const { data: contas = [] } = useQuery({
    queryKey: qk.contas(),
    queryFn:  ({ signal }) => fetchContas(signal),
    staleTime: 5 * 60_000, // 5 minutos
  })

  // FASE 1 — mês atual + próximos pendentes (libera UI imediato)
  // keepPreviousData: mantém dados do mês anterior enquanto carrega novos
  const fase1Q = useQuery({
    queryKey: ['dashboard-fase1', mes],
    queryFn:  ({ signal }) => fetchFase1(mes, signal),
    enabled:  !!parsed,
    staleTime: 60_000, // 1 minuto
    placeholderData: keepPreviousData,
  })

  // ── HISTÓRICO — 6 meses (5 anteriores + atual) com cache POR MÊS ──────
  // Cada mês é uma query individual. Ao navegar para o mês adjacente, 5 dos
  // 6 meses já estão no cache. Apenas o mês novo dispara fetch real.
  const meses6 = useMemo(() => {
    if (!parsed) return [] as string[]
    return gerarUltimosMeses(parsed.ano, parsed.m, 6)
  }, [parsed])

  const mesesAnteriores = useMemo(() => meses6.slice(0, -1), [meses6])

  const historicoQs = useQueries({
    queries: mesesAnteriores.map(mh => ({
      queryKey:        ['transacoes-mes', mh] as const,
      queryFn:         ({ signal }: { signal?: AbortSignal }) => fetchTransacoesMes(mh, signal),
      enabled:         fase2Enabled,
      staleTime:       60_000,
      placeholderData: keepPreviousData,
    })),
  })

  // Helpers derivados das queries individuais
  const historicoData = useMemo(() => historicoQs.map(q => q.data ?? []), [historicoQs])
  const historicoLoading = useMemo(
    () => historicoQs.some(q => q.isLoading),
    [historicoQs],
  )

  // ── Derivados (useMemo para evitar recomputação desnecessária) ─────
  const hoje = hojeLocal()

  // Filtros: passa contas (sempre) + categorias + status (com_status para alguns cálculos)
  const filtros = useMemo(() => {
    const passaConta  = (t: Transacao) => contasFiltro.length === 0 || contasFiltro.includes(t.conta_id)
    const passaCat    = (t: Transacao) => filtCats.length === 0     || (!!t.categoria_id && filtCats.includes(t.categoria_id))
    const passaStatus = (t: Transacao) => filtStatus.length === 0   || (!!t.status && filtStatus.includes(t.status))
    return {
      filtrarTx:        (t: Transacao) => !ehTransf(t) && passaConta(t) && passaCat(t) && passaStatus(t),
      filtrarSemStatus: (t: Transacao) => !ehTransf(t) && passaConta(t) && passaCat(t),
      filtrarPendentes: (t: Transacao) => passaConta(t) && passaCat(t),
    }
    // contasFiltro/filtCats/filtStatus são arrays; depender deles diretamente
    // gera recomputação a cada render. JSON.stringify estabiliza por valor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(contasFiltro), JSON.stringify(filtCats), JSON.stringify(filtStatus)])

  const { pendentes, proximas, proximasRaw, resumo, despesasCat, receitasCat } = useMemo(() => {
    if (!fase1Q.data || !parsed) {
      return {
        pendentes: [] as Transacao[], proximas: [] as Transacao[], proximasRaw: [] as Transacao[],
        resumo: null as ResumoMensal | null,
        despesasCat: [] as DespesaCategoria[], receitasCat: [] as DespesaCategoria[],
      }
    }

    const { pendMes, pendProx, doMesRaw } = fase1Q.data

    const pendMesF  = pendMes.filter(filtros.filtrarPendentes)
    const pendProxF = pendProx.filter(filtros.filtrarPendentes)
    const todasPend = [...pendMesF, ...pendProxF]

    const doMes = doMesRaw.filter(filtros.filtrarTx)
    const entradas = doMes.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
    const saidas   = doMes.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)

    return {
      pendentes:   todasPend.filter(t => t.data <= hoje),
      proximas:    todasPend.filter(t => t.data > hoje),
      proximasRaw: [...pendMes, ...pendProx].filter(t => t.data > hoje),
      resumo:      { mes, total_entradas: entradas, total_saidas: saidas },
      despesasCat: agruparPorCategoria(doMes, 'DESPESA'),
      receitasCat: agruparPorCategoria(doMes, 'RECEITA'),
    }
  }, [fase1Q.data, filtros, hoje, mes, parsed])

  const { historico, pagos, pendentesStatus, projecoes } = useMemo(() => {
    if (!fase1Q.data || !parsed) {
      return {
        historico: [] as ResumoMensal[],
        pagos:     [] as { receitas: number; despesas: number }[],
        pendentesStatus: [] as { receitas: number; despesas: number }[],
        projecoes: [] as { receitas: number; despesas: number }[],
      }
    }

    const meses6 = gerarUltimosMeses(parsed.ano, parsed.m, 6)
    const todos = [...historicoData, fase1Q.data.doMesRaw]
    // Se fase2 ainda não chegou, preenche com [] para manter ordem
    while (todos.length < 6) todos.unshift([])

    const status6 = meses6.map((_, idx) => {
      const fatia = (todos[idx] ?? []).filter(filtros.filtrarSemStatus)
      return calcularStatusMes(fatia)
    })

    const usarSaldoView =
      contasFiltro.length === 0 && filtCats.length === 0 && filtStatus.length === 0

    const hist: ResumoMensal[] = meses6.map((mh, idx) => {
      const fatia     = todos[idx] ?? []
      const fatiaFilt = fatia.filter(filtros.filtrarTx)
      const totalEnt  = fatiaFilt.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
      const totalSai  = fatiaFilt.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)

      let saldo_mes: number
      if (usarSaldoView) {
        const comSaldoAcum = fatia.filter(t => t.saldo_acumulado !== undefined)
        saldo_mes = comSaldoAcum.length > 0 ? comSaldoAcum[comSaldoAcum.length - 1].saldo_acumulado! : 0
      } else {
        const fatiaSemStatus = fatia.filter(filtros.filtrarSemStatus)
        const entPagas = fatiaSemStatus.filter(t => t.tipo === 'RECEITA' && t.status === 'PAGO').reduce((s, t) => s + t.valor, 0)
        const saiPagas = fatiaSemStatus.filter(t => t.tipo === 'DESPESA' && t.status === 'PAGO').reduce((s, t) => s + t.valor, 0)
        saldo_mes = entPagas - saiPagas
      }
      return { mes: mh, total_entradas: totalEnt, total_saidas: totalSai, saldo_mes }
    })

    return {
      historico:       hist,
      pagos:           status6.map(s => s.pagos),
      pendentesStatus: status6.map(s => s.pendentes),
      projecoes:       status6.map(s => s.projecoes),
    }
  }, [fase1Q.data, historicoData, filtros, parsed,
      contasFiltro.length, filtCats.length, filtStatus.length])

  /**
   * Data do lançamento mais recente por conta, considerando os 6 meses já
   * carregados (histórico + mês exibido). Usado pelo card "Minhas contas"
   * para anotar contas zeradas com a data do último movimento.
   *
   * Se a conta não tiver lançamentos nessa janela, a chave simplesmente não
   * aparece no objeto.
   */
  const ultimaTxPorConta = useMemo<Record<string, string>>(() => {
    if (!fase1Q.data) return {}
    const map: Record<string, string> = {}
    const fontes = [...historicoData, fase1Q.data.doMesRaw]
    for (const fonte of fontes) {
      for (const tx of fonte) {
        const atual = map[tx.conta_id]
        if (!atual || tx.data > atual) map[tx.conta_id] = tx.data
      }
    }
    return map
  }, [fase1Q.data, historicoData])

  const refetch = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['dashboard-fase1', mes] }),
      qc.invalidateQueries({ queryKey: ['transacoes-mes'] }),
      qc.invalidateQueries({ queryKey: qk.contas() }),
    ])
  }

  const prefetchMes = (delta: number) => {
    if (!parsed) return
    const [y, m] = mes.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const novoMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

    qc.prefetchQuery({
      queryKey: ['dashboard-fase1', novoMes],
      queryFn: ({ signal }) => fetchFase1(novoMes, signal),
      staleTime: 60_000,
    })
    qc.prefetchQuery({
      queryKey: ['transacoes-mes', novoMes],
      queryFn: ({ signal }) => fetchTransacoesMes(novoMes, signal),
      staleTime: 60_000,
    })
  }

  const prefetchMesSeguinte = () => prefetchMes(1)
  const prefetchMesAnterior = () => prefetchMes(-1)

  return {
    contas,
    pendentes, proximas, proximasRaw,
    // Todas as transações do mês exibido (qualquer status) — usado para
    // calcular saldo dia-a-dia (ex.: detecção de dias negativos).
    doMesRaw: fase1Q.data?.doMesRaw ?? ([] as Transacao[]),
    ultimaTxPorConta,
    resumo, despesasCat, receitasCat,
    historico, pagos, pendentesStatus, projecoes,
    loading:          fase1Q.isLoading,
    loadingHistorico: historicoLoading,
    error:            !parsed ? `Mês inválido: ${mes}` : (fase1Q.error ? (fase1Q.error as Error).message : null),
    refetch,
    prefetchMesSeguinte,
    prefetchMesAnterior,
  }
}
