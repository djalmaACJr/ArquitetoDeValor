// src/hooks/useDashboard.ts
import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch, extrairLista } from '../lib/api'
import { qk } from '../lib/queryKeys'
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
  limite: number,
): DespesaCategoria[] {
  const comCat = transacoes.filter(
    t => t.tipo === tipo && t.categoria_id && t.categoria_nome,
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

  const [pendentesRes, proximosRes, mesAtualRes] = await Promise.all([
    apiFetch(`/transacoes?status=PENDENTE&mes=${mes}&per_page=500&saldo=true`, signal),
    apiFetch(`/transacoes?status=PENDENTE&mes=${mesSeguinte}&per_page=500&saldo=true`, signal),
    apiFetch(`/transacoes?mes=${mes}&per_page=1000&saldo=true`, signal),
  ])

  return {
    pendMes:  extrairLista<Transacao>(pendentesRes.dados),
    pendProx: extrairLista<Transacao>(proximosRes.dados),
    doMesRaw: extrairLista<Transacao>(mesAtualRes.dados),
  }
}

async function fetchFase2(mesesAnteriores: readonly string[], signal?: AbortSignal): Promise<Transacao[][]> {
  const arr = await Promise.all(
    mesesAnteriores.map(mh =>
      apiFetch(`/transacoes?mes=${mh}&per_page=1000&saldo=true`, signal),
    ),
  )
  return arr.map(r => extrairLista<Transacao>(r.dados))
}

export function useDashboard(
  mes: string,
  contasFiltro: string[] = [],
  filtCats:     string[] = [],
  filtStatus:   string[] = [],
) {
  const qc = useQueryClient()
  const parsed = useMemo(() => parseMes(mes), [mes])

  // Contas (cache compartilhado com useContas via mesma query key)
  const { data: contas = [] } = useQuery({
    queryKey: qk.contas(),
    queryFn:  ({ signal }) => fetchContas(signal),
  })

  // FASE 1 — mês atual + próximos pendentes (libera UI imediato)
  const fase1Q = useQuery({
    queryKey: ['dashboard-fase1', mes],
    queryFn:  ({ signal }) => fetchFase1(mes, signal),
    enabled:  !!parsed,
  })

  // FASE 2 — 5 meses anteriores (atualiza gráfico em background)
  const mesesAnteriores = useMemo(() => {
    if (!parsed) return [] as string[]
    return gerarUltimosMeses(parsed.ano, parsed.m, 6).slice(0, 5)
  }, [parsed])

  const fase2Q = useQuery({
    queryKey: ['dashboard-fase2', mes, mesesAnteriores],
    queryFn:  ({ signal }) => fetchFase2(mesesAnteriores, signal),
    enabled:  !!parsed && mesesAnteriores.length > 0,
  })

  // ── Derivados (useMemo para evitar recálculo desnecessário) ─────
  const hoje = new Date().toISOString().split('T')[0]

  // Filtros: passa contas (sempre) + categorias + status (com_status para alguns cálculos)
  const filtros = useMemo(() => {
    const passaConta  = (t: Transacao) => contasFiltro.length === 0 || contasFiltro.includes(t.conta_id)
    const passaCat    = (t: Transacao) => filtCats.length === 0     || (!!t.categoria_id && filtCats.includes(t.categoria_id))
    const passaStatus = (t: Transacao) => filtStatus.length === 0   || (!!t.status && filtStatus.includes(t.status))
    return {
      filtrarTx:        (t: Transacao) => !ehTransf(t) && passaConta(t) && passaCat(t) && passaStatus(t),
      filtrarSemStatus: (t: Transacao) => !ehTransf(t) && passaConta(t) && passaCat(t),
    }
    // contasFiltro/filtCats/filtStatus são arrays; depender deles diretamente
    // gera recomputação a cada render. JSON.stringify estabiliza por valor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(contasFiltro), JSON.stringify(filtCats), JSON.stringify(filtStatus)])

  const { pendentes, proximas, resumo, despesasCat, receitasCat } = useMemo(() => {
    if (!fase1Q.data || !parsed) {
      return {
        pendentes: [] as Transacao[], proximas: [] as Transacao[],
        resumo: null as ResumoMensal | null,
        despesasCat: [] as DespesaCategoria[], receitasCat: [] as DespesaCategoria[],
      }
    }
    const { pendMes, pendProx, doMesRaw } = fase1Q.data

    // Pendentes / Próximas — status já é PENDENTE pela query
    const pendMesF  = pendMes.filter(filtros.filtrarSemStatus)
    const pendProxF = pendProx.filter(filtros.filtrarSemStatus)
    const todasPend = [...pendMesF, ...pendProxF]

    // Resumo
    const doMes = doMesRaw.filter(filtros.filtrarTx)
    const entradas = doMes.filter(t => t.tipo === 'RECEITA').reduce((s, t) => s + t.valor, 0)
    const saidas   = doMes.filter(t => t.tipo === 'DESPESA').reduce((s, t) => s + t.valor, 0)

    return {
      pendentes:   todasPend.filter(t => t.data <= hoje),
      proximas:    todasPend.filter(t => t.data > hoje),
      resumo:      { mes, total_entradas: entradas, total_saidas: saidas },
      despesasCat: agruparPorCategoria(doMes, 'DESPESA', 5),
      receitasCat: agruparPorCategoria(doMes, 'RECEITA', 4),
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
    const todos = [...(fase2Q.data ?? []), fase1Q.data.doMesRaw]
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
  }, [fase1Q.data, fase2Q.data, filtros, parsed,
      contasFiltro.length, filtCats.length, filtStatus.length])

  const refetch = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['dashboard-fase1', mes] }),
      qc.invalidateQueries({ queryKey: ['dashboard-fase2', mes, mesesAnteriores] }),
      qc.invalidateQueries({ queryKey: qk.contas() }),
    ])
  }

  return {
    contas,
    pendentes, proximas,
    resumo, despesasCat, receitasCat,
    historico, pagos, pendentesStatus, projecoes,
    loading:          fase1Q.isLoading,
    loadingHistorico: fase2Q.isLoading,
    error:            !parsed ? `Mês inválido: ${mes}` : (fase1Q.error ? (fase1Q.error as Error).message : null),
    refetch,
  }
}
