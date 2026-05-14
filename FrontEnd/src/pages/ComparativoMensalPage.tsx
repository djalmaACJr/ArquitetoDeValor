// src/pages/ComparativoMensalPage.tsx
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Chart as ChartJS,
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
} from 'chart.js'
import { Bar, Line } from 'react-chartjs-2'
import type { ChartData, ChartOptions } from 'chart.js'
import {
  TrendingUp, TrendingDown, Minus, RefreshCw, Download, X, Pencil,
  AlertTriangle, CheckCircle, Info, ArrowUpRight, ArrowDownRight,
} from 'lucide-react'
import { apiFetch } from '../lib/api'
import DrawerLancamento from '../components/ui/DrawerLancamento'
import { formatBRL, mesLabel, mesAtual } from '../lib/utils'
import { BotaoOcultar } from '../components/ui/BotaoOcultar'
import { useOcultarValores } from '../hooks/useOcultarValores'

ChartJS.register(
  CategoryScale, LinearScale, BarElement, LineElement,
  PointElement, Title, Tooltip, Legend, Filler,
)

// ── Types ──────────────────────────────────────────────────────────────────────
interface Lancamento {
  id: string
  tipo: 'RECEITA' | 'DESPESA'
  status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
  valor: number
  data: string
  descricao: string
  categoria_id: string | null
  categoria_nome: string | null
  categoria_pai_nome: string | null
  id_par_transferencia: string | null
}

interface ResumoPeriodo {
  totalReceitas: number
  totalDespesas: number
  resultado: number
  // chave = categoria_id (sem prefixo de tipo); net = receitas − despesas (pode ser negativo)
  porCategoria: Map<string, { nome: string; net: number }>
}

interface CatComparativo {
  catKey: string
  nome: string
  tipo: 'RECEITA' | 'DESPESA'
  atual: number
  anterior: number
  diferenca: number
  variacao: number | null
}

type SortCol = 'nome' | 'atual' | 'anterior' | 'diferenca' | 'variacao'

// ── Date helpers ───────────────────────────────────────────────────────────────
function diffDays(inicio: string, fim: string): number {
  const a = new Date(`${inicio}T00:00:00`)
  const b = new Date(`${fim}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}

function ultimoDiaMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return `${mes}-${String(ultimo).padStart(2, '0')}`
}

/** Months (YYYY-MM) that a date range [inicio, fim] spans. */
function getMonthsInRange(inicio: string, fim: string): string[] {
  const meses: string[] = []
  let [y, m] = inicio.slice(0, 7).split('-').map(Number)
  const [yf, mf] = fim.slice(0, 7).split('-').map(Number)
  while (y < yf || (y === yf && m <= mf)) {
    meses.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) { m = 1; y++ }
  }
  return meses
}

/** Short label for a date range (e.g. "Mai/26", "01/Jan–31/Mar/26"). */
function periodoLabel(inicio: string, fim: string): string {
  const NOMES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  if (inicio.slice(0, 7) === fim.slice(0, 7)) return mesLabel(inicio.slice(0, 7))
  const fmtD = (d: string) => {
    const [, mm, dd] = d.split('-')
    return `${parseInt(dd)}/${NOMES[parseInt(mm) - 1]}`
  }
  const sameYear = inicio.slice(0, 4) === fim.slice(0, 4)
  return `${fmtD(inicio)}–${fmtD(fim)}${sameYear ? `/${inicio.slice(2, 4)}` : ''}`
}

/** Long label for headers (e.g. "1 jan/2026 a 31 mar/2026"). */
function periodoLabelLongo(inicio: string, fim: string): string {
  const NOMES = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez']
  const fmtD = (d: string) => {
    const [y, mm, dd] = d.split('-')
    return `${parseInt(dd)} ${NOMES[parseInt(mm) - 1]}/${y}`
  }
  return `${fmtD(inicio)} a ${fmtD(fim)}`
}

// ── Pure analysis helpers ──────────────────────────────────────────────────────
function calcVariacao(atual: number, anterior: number): number | null {
  if (anterior === 0) return null
  return ((atual - anterior) / anterior) * 100
}

function isTransf(l: Lancamento): boolean {
  return (
    !!l.id_par_transferencia ||
    !!l.descricao?.startsWith('[Transf.') ||
    l.categoria_nome === 'Transferências'
  )
}

function processarPeriodo(lancamentos: Lancamento[]): ResumoPeriodo {
  let totalReceitas = 0
  let totalDespesas = 0
  const porCategoria = new Map<string, { nome: string; net: number }>()
  for (const l of lancamentos) {
    if (isTransf(l)) continue
    if (l.tipo === 'RECEITA') totalReceitas += l.valor
    else totalDespesas += l.valor
    const key  = l.categoria_id ?? '__sem__'
    const nome = l.categoria_nome || l.categoria_pai_nome || 'Sem categoria'
    if (!porCategoria.has(key)) porCategoria.set(key, { nome, net: 0 })
    // net = receitas − despesas; receitas somam positivo, despesas somam negativo
    porCategoria.get(key)!.net += l.tipo === 'RECEITA' ? l.valor : -l.valor
  }
  return { totalReceitas, totalDespesas, resultado: totalReceitas - totalDespesas, porCategoria }
}

function parseApiRes(r: unknown): Lancamento[] {
  const res = r as { dados?: unknown }
  const d = res?.dados
  if (Array.isArray(d)) return d as Lancamento[]
  const inner = (d as { dados?: unknown })?.dados
  if (Array.isArray(inner)) return inner as Lancamento[]
  return []
}

function abbrBRL(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$${(v / 1_000_000).toFixed(1)}M`
  if (Math.abs(v) >= 1_000)     return `R$${(v / 1_000).toFixed(0)}k`
  return `R$${v.toFixed(0)}`
}

// ── Initial period defaults ────────────────────────────────────────────────────
// B = Período final: 3 meses atrás até mês atual
// A = Período inicial: mesmo intervalo no ano anterior
function getDefaultPeriods() {
  const hoje = mesAtual()                                   // "YYYY-MM"
  const [y, m] = hoje.split('-').map(Number)

  // Período final (B): mês 3 meses atrás → mês atual
  const d3 = new Date(y, m - 1 - 3, 1)                    // 3 meses antes
  const iniMesB = `${d3.getFullYear()}-${String(d3.getMonth() + 1).padStart(2, '0')}`
  const inicioB = `${iniMesB}-01`
  const fimB    = ultimoDiaMes(hoje)

  // Período inicial (A): mesmo intervalo no ano anterior
  const inicioA = `${d3.getFullYear() - 1}-${String(d3.getMonth() + 1).padStart(2, '0')}-01`
  const fimA    = ultimoDiaMes(`${y - 1}-${String(m).padStart(2, '0')}`)

  return { inicioA, fimA, inicioB, fimB }
}

// ── Module-level state — persiste entre navegações (desmonte/remonte) ──────────
interface PageState {
  inicioA: string; fimA: string; inicioB: string; fimB: string
  lancA: Lancamento[]; lancB: Lancamento[]
  tendencia: { mes: string; receitas: number; despesas: number }[]
  tendPeriodo: string; buscado: boolean
  busca: string; sortCat: { col: SortCol; dir: 1 | -1 }
}
let _saved: PageState | null = null

// ── KPI Card ───────────────────────────────────────────────────────────────────
function KpiCard({
  label, valor, valorAnterior, variacao, corPositiva = 'green', subtitulo, oculto = false,
}: {
  label: string
  valor: number
  valorAnterior?: number
  variacao?: number | null
  corPositiva?: 'green' | 'red'
  subtitulo?: string
  oculto?: boolean
}) {
  const cor =
    variacao == null    ? '#8b92a8'
    : variacao === 0    ? '#f0b429'
    : (variacao > 0) === (corPositiva === 'green') ? '#00c896'
    : '#f87171'

  const Icon = variacao == null ? null
    : variacao > 0 ? ArrowUpRight
    : variacao < 0 ? ArrowDownRight
    : Minus

  return (
    <div className="bg-[#1a1f2e] border border-white/10 rounded-xl px-4 py-4 flex flex-col gap-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>{label}</p>
      <p className="text-[20px] font-bold leading-tight truncate" style={{ color: '#e8eaf0' }}>
        {oculto ? '••••••' : formatBRL(valor)}
      </p>
      {variacao !== undefined && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {Icon && <Icon size={13} style={{ color: cor }} />}
          <span className="text-[11px] font-semibold" style={{ color: cor }}>
            {variacao === null ? 'Novo'
              : variacao === 0  ? 'Estável'
              : `${variacao > 0 ? '+' : ''}${variacao.toFixed(1)}%`}
          </span>
          {valorAnterior !== undefined && (
            <span className="text-[10px]" style={{ color: '#4a5168' }}>
              vs {oculto ? '••••' : formatBRL(valorAnterior)}
            </span>
          )}
        </div>
      )}
      {subtitulo && <p className="text-[10px]" style={{ color: '#8b92a8' }}>{subtitulo}</p>}
    </div>
  )
}

// ── DateInput ──────────────────────────────────────────────────────────────────
function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>{label}</p>
      <input
        type="date"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="px-3 py-[7px] rounded-lg border text-[12px] outline-none"
        style={{
          background:   '#0e1320',
          borderColor:  'rgba(255,255,255,0.12)',
          color:        '#e8eaf0',
          colorScheme:  'dark',
        }}
      />
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────
export default function ComparativoMensalPage() {
  const [inicioA, setInicioA] = useState(() => _saved?.inicioA ?? getDefaultPeriods().inicioA)
  const [fimA,    setFimA]    = useState(() => _saved?.fimA    ?? getDefaultPeriods().fimA)
  const [inicioB, setInicioB] = useState(() => _saved?.inicioB ?? getDefaultPeriods().inicioB)
  const [fimB,    setFimB]    = useState(() => _saved?.fimB    ?? getDefaultPeriods().fimB)

  const [loading,     setLoading]     = useState(false)
  const [lancA,       setLancA]       = useState<Lancamento[]>(() => _saved?.lancA ?? [])
  const [lancB,       setLancB]       = useState<Lancamento[]>(() => _saved?.lancB ?? [])
  const [tendencia,   setTendencia]   = useState<{ mes: string; receitas: number; despesas: number }[]>(() => _saved?.tendencia ?? [])
  const [tendPeriodo, setTendPeriodo] = useState(() => _saved?.tendPeriodo ?? '')
  const [buscado,     setBuscado]     = useState(() => _saved?.buscado ?? false)
  const [busca,       setBusca]       = useState(() => _saved?.busca ?? '')
  const [sortCat,     setSortCat]     = useState<{ col: SortCol; dir: 1 | -1 }>(() => _saved?.sortCat ?? { col: 'variacao', dir: -1 })
  // drill-down: não persiste — o usuário clica novamente; os dados ficam em cache
  const [drillDown,   setDrillDown]   = useState<{ catKey: string; nome: string; periodo: 'inicial' | 'final' } | null>(null)
  const [editandoId,  setEditandoId]  = useState<string | null>(null)
  const drillDownRef = useRef<HTMLDivElement>(null)
  const { oculto, toggle: toggleOculto } = useOcultarValores()

  // Scroll para o painel de drill-down ao abri-lo
  useEffect(() => {
    if (drillDown && drillDownRef.current) {
      drillDownRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [drillDown])

  // Persiste estado ao navegar para outra página
  useEffect(() => {
    _saved = { inicioA, fimA, inicioB, fimB, lancA, lancB, tendencia, tendPeriodo, buscado, busca, sortCat }
  }, [inicioA, fimA, inicioB, fimB, lancA, lancB, tendencia, tendPeriodo, buscado, busca, sortCat])

  const diasA   = useMemo(() => diffDays(inicioA, fimA),   [inicioA, fimA])
  const diasB   = useMemo(() => diffDays(inicioB, fimB),   [inicioB, fimB])
  const diasOk  = diasA === diasB
  const periodoInvalido = inicioA > fimA || inicioB > fimB

  // Auto-ajustar período A (base) para ter a mesma duração que B, terminando no dia antes de B
  function autoAjustarA(novoInicioB: string, novoFimB: string) {
    const dur      = diffDays(novoInicioB, novoFimB)
    const novoFimA   = shiftDate(novoInicioB, -1)
    const novoInicioA = shiftDate(novoFimA, -(dur - 1))
    setInicioA(novoInicioA)
    setFimA(novoFimA)
  }

  // Quando B (período atual) muda → auto-ajusta A; quando A muda → usuário está editando manualmente
  function handleInicioA(v: string) { setInicioA(v); setBuscado(false) }
  function handleFimA(v: string)    { setFimA(v);    setBuscado(false) }
  function handleInicioB(v: string) { setInicioB(v); autoAjustarA(v, fimB); setBuscado(false) }
  function handleFimB(v: string)    { setFimB(v);    autoAjustarA(inicioB, v); setBuscado(false) }

  // ── Buscar ─────────────────────────────────────────────────────────────────
  const buscar = useCallback(async () => {
    setLoading(true)
    try {
      const mesesA = getMonthsInRange(inicioA, fimA)
      const mesesB = getMonthsInRange(inicioB, fimB)
      // Tendência: últimos 12 meses completos a partir do mês atual
      const hoje = mesAtual()
      const [hy, hm] = hoje.split('-').map(Number)
      const mesesTend = Array.from({ length: 12 }, (_, i) => {
        const d = new Date(hy, hm - 1 - (11 - i), 1)
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      })

      // saldo=true → usa vw_transacoes_com_saldo que inclui categoria_nome, categoria_pai_nome, conta_nome
      const [resA, resB, resTend] = await Promise.all([
        Promise.all(mesesA.map(m    => apiFetch<unknown>(`/transacoes?mes=${m}&saldo=true`))),
        Promise.all(mesesB.map(m    => apiFetch<unknown>(`/transacoes?mes=${m}&saldo=true`))),
        Promise.all(mesesTend.map(m => apiFetch<unknown>(`/transacoes?mes=${m}&saldo=true`))),
      ])

      // Flatten + filter to date range
      const filtrar = (res: unknown[], de: string, ate: string) =>
        res.flatMap(parseApiRes).filter(l => l.data >= de && l.data <= ate)

      setLancA(filtrar(resA, inicioA, fimA))
      setLancB(filtrar(resB, inicioB, fimB))
      setTendencia(mesesTend.map((mes, i) => {
        const r = processarPeriodo(parseApiRes(resTend[i]))
        return { mes, receitas: r.totalReceitas, despesas: r.totalDespesas }
      }))
      setTendPeriodo(
        mesesTend.length >= 2
          ? `${mesLabel(mesesTend[0])} – ${mesLabel(mesesTend[mesesTend.length - 1])}`
          : ''
      )
      setBuscado(true)
    } finally {
      setLoading(false)
    }
  }, [inicioA, fimA, inicioB, fimB])

  // ── Computed ───────────────────────────────────────────────────────────────
  const resumoA = useMemo(() => processarPeriodo(lancA), [lancA])
  const resumoB = useMemo(() => processarPeriodo(lancB), [lancB])

  // A = Período inicial (base) · B = Período final (atual)
  // net é assinado: positivo = líquido receita, negativo = líquido despesa
  const comparativo = useMemo((): CatComparativo[] => {
    const allKeys = new Set([...resumoA.porCategoria.keys(), ...resumoB.porCategoria.keys()])
    return [...allKeys].map(key => {
      const a    = resumoA.porCategoria.get(key)
      const b    = resumoB.porCategoria.get(key)
      const netB = b?.net ?? 0
      const netA = a?.net ?? 0
      const nome = b?.nome || a?.nome || 'Sem categoria'
      // tipo determinado pelo período com maior valor absoluto (ou B se empate)
      const refNet = Math.abs(netB) >= Math.abs(netA) ? netB : netA
      const tipo: 'RECEITA' | 'DESPESA' = refNet >= 0 ? 'RECEITA' : 'DESPESA'
      const atual    = Math.abs(netB)
      const anterior = Math.abs(netA)
      return {
        catKey: key,
        nome, tipo, atual, anterior,
        diferenca: atual - anterior,
        variacao:  calcVariacao(atual, anterior),
      }
    })
  }, [resumoA, resumoB])

  const topAumento = useMemo(() =>
    comparativo.filter(c => c.tipo === 'DESPESA' && c.variacao !== null && c.variacao > 0)
      .sort((a, b) => (b.variacao ?? 0) - (a.variacao ?? 0))[0]
  , [comparativo])

  const topReducao = useMemo(() =>
    comparativo.filter(c => c.tipo === 'DESPESA' && c.variacao !== null && c.variacao < 0)
      .sort((a, b) => (a.variacao ?? 0) - (b.variacao ?? 0))[0]
  , [comparativo])

  // ── Insights ───────────────────────────────────────────────────────────────
  const insights = useMemo(() => {
    if (!buscado) return []
    const items: { tipo: 'alerta' | 'positivo' | 'info'; texto: string }[] = []
    // B = 2º período (atual), A = 1º período (base) — variação = B vs A
    const vRes  = calcVariacao(resumoB.resultado,     resumoA.resultado)
    const vDesp = calcVariacao(resumoB.totalDespesas, resumoA.totalDespesas)
    const vRec  = calcVariacao(resumoB.totalReceitas, resumoA.totalReceitas)

    if (resumoB.resultado > resumoA.resultado)
      items.push({ tipo: 'positivo', texto: `Resultado líquido melhorou${vRes !== null ? ` ${vRes > 0 ? '+' : ''}${vRes.toFixed(1)}%` : ''} em relação ao Período inicial.` })
    else if (resumoB.resultado < resumoA.resultado)
      items.push({ tipo: 'alerta', texto: 'Resultado líquido piorou em relação ao Período inicial.' })

    if (vDesp !== null && vDesp > 5)
      items.push({ tipo: 'alerta', texto: `Despesas totais aumentaram ${vDesp.toFixed(1)}% no Período final.` })
    else if (vDesp !== null && vDesp < -5)
      items.push({ tipo: 'positivo', texto: `Despesas totais reduziram ${Math.abs(vDesp).toFixed(1)}% — ótima gestão!` })

    if (vRec !== null && vRec > 10)
      items.push({ tipo: 'positivo', texto: `Receitas cresceram ${vRec.toFixed(1)}% no Período final — excelente!` })
    else if (vRec !== null && vRec < -10)
      items.push({ tipo: 'alerta', texto: `Receitas reduziram ${Math.abs(vRec).toFixed(1)}% — atenção ao fluxo de caixa.` })

    comparativo.filter(c => c.tipo === 'DESPESA' && c.variacao !== null && c.variacao > 25)
      .sort((a, b) => (b.variacao ?? 0) - (a.variacao ?? 0)).slice(0, 3)
      .forEach(c => items.push({ tipo: 'alerta', texto: `Os gastos com "${c.nome}" aumentaram ${c.variacao!.toFixed(0)}%.` }))

    comparativo.filter(c => c.tipo === 'DESPESA' && c.variacao !== null && c.variacao < -15)
      .sort((a, b) => (a.variacao ?? 0) - (b.variacao ?? 0)).slice(0, 2)
      .forEach(c => items.push({ tipo: 'positivo', texto: `A categoria "${c.nome}" teve redução de ${Math.abs(c.variacao!).toFixed(0)}%.` }))

    const novas = comparativo.filter(c => c.tipo === 'DESPESA' && c.anterior === 0 && c.atual > 0)
    if (novas.length > 0)
      items.push({ tipo: 'info', texto: `${novas.length} nova(s) categoria(s) de despesa surgiu no Período final.` })

    if (resumoB.totalReceitas > 0) {
      const pct = (resumoB.totalDespesas / resumoB.totalReceitas) * 100
      if (pct > 90)
        items.push({ tipo: 'alerta', texto: `Despesas representam ${pct.toFixed(0)}% das receitas no Período final.` })
    }
    return items
  }, [buscado, resumoA, resumoB, comparativo])

  // ── Table (sorted + filtered) ─────────────────────────────────────────────
  const tableCats = useMemo(() => {
    let rows = [...comparativo]
    if (busca.trim()) {
      const q = busca.toLowerCase()
      rows = rows.filter(c => c.nome.toLowerCase().includes(q))
    }
    rows.sort((a, b) => {
      if (sortCat.col === 'nome') return a.nome.localeCompare(b.nome) * sortCat.dir
      if (sortCat.col === 'variacao') {
        if (a.variacao === null && b.variacao === null) return 0
        if (a.variacao === null) return 1
        if (b.variacao === null) return -1
        return (a.variacao - b.variacao) * sortCat.dir
      }
      return (a[sortCat.col] - b[sortCat.col]) * sortCat.dir
    })
    return rows
  }, [comparativo, busca, sortCat])

  const drillDownLancamentos = useMemo(() => {
    if (!drillDown) return []
    const lances = drillDown.periodo === 'inicial' ? lancA : lancB
    const catId  = drillDown.catKey === '__sem__' ? null : drillDown.catKey
    return lances
      .filter(l => !isTransf(l) && l.categoria_id === catId)
      .sort((a, b) => a.data.localeCompare(b.data))
  }, [drillDown, lancA, lancB])

  function toggleSort(col: SortCol) {
    setSortCat(prev => ({ col, dir: prev.col === col ? (-prev.dir as 1 | -1) : -1 }))
  }

  // ── Export ─────────────────────────────────────────────────────────────────
  const exportar = useCallback(async () => {
    if (!buscado || tableCats.length === 0) return
    // @ts-expect-error CDN dynamic import
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
    const lA = periodoLabel(inicioA, fimA)
    const lB = periodoLabel(inicioB, fimB)
    const rows: (string | number)[][] = [
      ['Categoria', 'Tipo', lB, lA, 'Diferença', '% Variação'],
      ...tableCats.map(c => [
        c.nome, c.tipo === 'RECEITA' ? 'Receita' : 'Despesa',
        c.atual, c.anterior, c.diferenca,
        c.variacao !== null ? c.variacao / 100 : 'Novo',
      ]),
      [],
      ['Total Receitas', '', resumoB.totalReceitas, resumoA.totalReceitas,
        resumoB.totalReceitas - resumoA.totalReceitas,
        calcVariacao(resumoB.totalReceitas, resumoA.totalReceitas) !== null
          ? (calcVariacao(resumoB.totalReceitas, resumoA.totalReceitas)! / 100) : 'N/A'],
      ['Total Despesas', '', resumoB.totalDespesas, resumoA.totalDespesas,
        resumoB.totalDespesas - resumoA.totalDespesas,
        calcVariacao(resumoB.totalDespesas, resumoA.totalDespesas) !== null
          ? (calcVariacao(resumoB.totalDespesas, resumoA.totalDespesas)! / 100) : 'N/A'],
      ['Resultado', '', resumoB.resultado, resumoA.resultado,
        resumoB.resultado - resumoA.resultado, ''],
    ]
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 14 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Comparativo MoM')
    XLSX.writeFile(wb, `comparativo_${inicioA}_${fimA}_vs_${inicioB}_${fimB}.xlsx`)
  }, [buscado, tableCats, inicioA, fimA, inicioB, fimB, resumoA, resumoB])

  // ── Chart data ─────────────────────────────────────────────────────────────
  const labA = periodoLabel(inicioA, fimA)
  const labB = periodoLabel(inicioB, fimB)

  const chartBarComp = useMemo((): ChartData<'bar'> => ({
    labels: ['Receitas', 'Despesas', 'Saldo'],
    datasets: [
      {
        label: 'Período inicial',
        data: [resumoA.totalReceitas, resumoA.totalDespesas, resumoA.resultado],
        backgroundColor: ['rgba(0,200,150,0.55)', 'rgba(248,113,113,0.55)', 'rgba(77,166,255,0.55)'],
        borderColor:     ['#00c896', '#f87171', '#4da6ff'],
        borderWidth: 1.5, borderRadius: 6,
      },
      {
        label: 'Período final',
        data: [resumoB.totalReceitas, resumoB.totalDespesas, resumoB.resultado],
        backgroundColor: ['rgba(0,200,150,0.15)', 'rgba(248,113,113,0.15)', 'rgba(77,166,255,0.15)'],
        borderColor:     ['rgba(0,200,150,0.4)', 'rgba(248,113,113,0.4)', 'rgba(77,166,255,0.4)'],
        borderWidth: 1.5, borderRadius: 6,
      },
    ],
  }), [resumoA, resumoB])

  const chartBarCats = useMemo((): ChartData<'bar'> => {
    const top = [...comparativo]
      .filter(c => c.variacao !== null)
      .sort((a, b) => Math.abs(b.diferenca) - Math.abs(a.diferenca))
      .slice(0, 10)
    return {
      labels: top.map(c => c.nome.length > 20 ? c.nome.slice(0, 18) + '…' : c.nome),
      datasets: [
        {
          label: 'Período inicial',
          data: top.map(c => c.anterior),
          backgroundColor: top.map(c => c.tipo === 'RECEITA' ? 'rgba(0,200,150,0.5)' : 'rgba(248,113,113,0.5)'),
          borderColor:     top.map(c => c.tipo === 'RECEITA' ? '#00c896' : '#f87171'),
          borderWidth: 1, borderRadius: 3,
        },
        {
          label: 'Período final',
          data: top.map(c => c.atual),
          backgroundColor: 'rgba(255,255,255,0.08)',
          borderColor:     'rgba(255,255,255,0.2)',
          borderWidth: 1, borderRadius: 3,
        },
      ],
    }
  }, [comparativo])

  const chartLinha = useMemo((): ChartData<'line'> => ({
    labels: tendencia.map(t => mesLabel(t.mes)),
    datasets: [
      { label: 'Receitas', data: tendencia.map(t => t.receitas),
        borderColor: '#00c896', backgroundColor: 'rgba(0,200,150,0.06)',
        tension: 0.4, fill: false, pointRadius: 3, pointBackgroundColor: '#00c896' },
      { label: 'Despesas', data: tendencia.map(t => t.despesas),
        borderColor: '#f87171', backgroundColor: 'rgba(248,113,113,0.06)',
        tension: 0.4, fill: false, pointRadius: 3, pointBackgroundColor: '#f87171' },
      { label: 'Saldo', data: tendencia.map(t => t.receitas - t.despesas),
        borderColor: '#4da6ff', backgroundColor: 'rgba(77,166,255,0.06)',
        tension: 0.4, fill: false, pointRadius: 3, pointBackgroundColor: '#4da6ff',
        borderDash: [5, 3] },
    ],
  }), [tendencia])

  // ── Chart options ──────────────────────────────────────────────────────────
  const tooltipPlugin = {
    backgroundColor: '#1a1f2e', titleColor: '#e8eaf0', bodyColor: '#8b92a8',
    borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1,
    callbacks: {
      label: (ctx: { dataset: { label?: string }; raw: unknown }) => {
        return ` ${ctx.dataset.label}: ${formatBRL(Number(ctx.raw) || 0)}`
      },
    },
  }
  const scaleX: ChartOptions<'bar'>['scales'] = {
    x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b92a8', font: { size: 11 } } },
    y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b92a8', font: { size: 10 }, callback: (v) => abbrBRL(Number(v)) } },
  }
  const barCompOpts: ChartOptions<'bar'> = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: '#8b92a8', font: { size: 11 }, boxWidth: 12 } }, tooltip: tooltipPlugin },
    scales: scaleX,
  }
  const barCatOpts: ChartOptions<'bar'> = {
    responsive: true, maintainAspectRatio: false, indexAxis: 'y',
    plugins: { legend: { position: 'bottom', labels: { color: '#8b92a8', font: { size: 11 }, boxWidth: 12 } }, tooltip: tooltipPlugin },
    scales: {
      y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b92a8', font: { size: 10 } } },
      x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#8b92a8', font: { size: 10 }, callback: (v) => abbrBRL(Number(v)) } },
    },
  }
  const linhaOpts: ChartOptions<'line'> = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { color: '#8b92a8', font: { size: 11 }, boxWidth: 12 } }, tooltip: tooltipPlugin },
    scales: scaleX as ChartOptions<'line'>['scales'],
  }

  function SortIcon({ col }: { col: SortCol }) {
    if (sortCat.col !== col) return <span style={{ color: '#2d3348', marginLeft: 3 }}>↕</span>
    return <span style={{ color: '#00c896', marginLeft: 3 }}>{sortCat.dir === 1 ? '↑' : '↓'}</span>
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="p-5 min-h-screen" style={{ background: '#0e1320' }}>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-[18px] font-bold" style={{ color: '#e8eaf0' }}>
            Comparativo Períodos
          </h1>
          <p className="text-[11px] mt-0.5" style={{ color: '#8b92a8' }}>
            Análise período a período · receitas, despesas e tendências
          </p>
        </div>
        <BotaoOcultar oculto={oculto} onToggle={toggleOculto} />
      </div>

      {/* Filters */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-4 mb-5">
        <div className="flex flex-wrap gap-4 items-end">

          {/* Period A */}
          <div className="flex items-end gap-2">
            <DateInput label="Período inicial — início" value={inicioA}
              onChange={handleInicioA} />
            <span className="pb-[8px] text-[12px]" style={{ color: '#4a5168' }}>→</span>
            <DateInput label="fim" value={fimA}
              onChange={handleFimA} />
            <div className="pb-[6px]">
              <span className="text-[11px] font-semibold px-2 py-1 rounded-lg"
                style={{ background: 'rgba(77,166,255,0.1)', color: '#4da6ff' }}>
                {diasA} dias
              </span>
            </div>
          </div>

          {/* vs separator */}
          <div className="pb-[8px]">
            <span className="text-[14px] font-bold px-1" style={{ color: '#4a5168' }}>vs</span>
          </div>

          {/* Period B */}
          <div className="flex items-end gap-2">
            <DateInput label="Período final — início" value={inicioB} onChange={handleInicioB} />
            <span className="pb-[8px] text-[12px]" style={{ color: '#4a5168' }}>→</span>
            <DateInput label="fim" value={fimB} onChange={handleFimB} />
            <div className="pb-[6px] flex items-center gap-1.5">
              <span className={`text-[11px] font-semibold px-2 py-1 rounded-lg`}
                style={{
                  background: diasOk ? 'rgba(0,200,150,0.1)' : 'rgba(248,113,113,0.1)',
                  color:      diasOk ? '#00c896' : '#f87171',
                }}>
                {diasB} dias {diasOk ? '✓' : '≠'}
              </span>
            </div>
          </div>

          {/* Auto-adjust button + actions */}
          <div className="flex items-end gap-2 ml-auto flex-wrap pb-[1px]">
            {!diasOk && (
              <button
                onClick={() => autoAjustarA(inicioB, fimB)}
                className="flex items-center gap-1.5 px-3 py-[7px] rounded-lg border text-[11px] font-semibold transition-all hover:opacity-90"
                style={{ borderColor: 'rgba(240,180,41,0.3)', color: '#f0b429', background: 'rgba(240,180,41,0.07)' }}
                title="Ajusta o Período inicial para ter a mesma duração que o Período final"
              >
                Auto-ajustar Período inicial
              </button>
            )}
            {buscado && (
              <button onClick={exportar}
                className="flex items-center gap-2 px-3 py-[7px] rounded-lg text-[12px] font-semibold border transition-all hover:opacity-90"
                style={{ color: '#4da6ff', background: 'rgba(77,166,255,0.08)', borderColor: 'rgba(77,166,255,0.2)' }}>
                <Download size={13} /> Exportar
              </button>
            )}
            <button onClick={buscar}
              disabled={loading || !diasOk || periodoInvalido}
              className="flex items-center gap-2 px-4 py-[7px] rounded-lg text-[12px] font-semibold transition-all hover:opacity-90"
              style={{ background: '#00c896', color: '#0a0f1a', opacity: (loading || !diasOk || periodoInvalido) ? 0.5 : 1 }}>
              {loading
                ? <><RefreshCw size={13} className="animate-spin" /> Carregando…</>
                : <><RefreshCw size={13} /> Comparar</>}
            </button>
          </div>
        </div>

        {/* Info linha */}
        {(!diasOk && !periodoInvalido) && (
          <p className="text-[10px] mt-2.5" style={{ color: '#f87171' }}>
            Os períodos têm durações diferentes ({diasA} vs {diasB} dias). Ajuste as datas ou clique em "Auto-ajustar Período inicial".
          </p>
        )}
        {buscado && diasOk && (
          <p className="text-[10px] mt-2.5" style={{ color: '#4a5168' }}>
            Comparando Período final{' '}
            <span style={{ color: '#8b92a8' }}>{periodoLabelLongo(inicioB, fimB)}</span>
            {' '}com Período inicial{' '}
            <span style={{ color: '#8b92a8' }}>{periodoLabelLongo(inicioA, fimA)}</span>
            {' '}({diasA} dias cada)
          </p>
        )}
      </div>

      {/* Empty state */}
      {!buscado && !loading && (
        <div className="flex flex-col items-center justify-center py-24">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(77,166,255,0.08)', border: '1px solid rgba(77,166,255,0.15)' }}>
            <TrendingUp size={26} style={{ color: '#4da6ff' }} />
          </div>
          <p className="text-[15px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>Compare dois períodos</p>
          <p className="text-[12px]" style={{ color: '#8b92a8' }}>
            {diasOk ? 'Clique em Comparar para gerar o relatório' : 'Ajuste as datas para que ambos os períodos tenham a mesma duração'}
          </p>
        </div>
      )}

      {buscado && !loading && (
        <>
          {/* KPI Cards — B = 2º período (atual), A = 1º período (base) */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
            <KpiCard label="Receita Total"
              valor={resumoB.totalReceitas} valorAnterior={resumoA.totalReceitas}
              variacao={calcVariacao(resumoB.totalReceitas, resumoA.totalReceitas)}
              corPositiva="green" oculto={oculto} />
            <KpiCard label="Despesa Total"
              valor={resumoB.totalDespesas} valorAnterior={resumoA.totalDespesas}
              variacao={calcVariacao(resumoB.totalDespesas, resumoA.totalDespesas)}
              corPositiva="red" oculto={oculto} />
            <KpiCard label="Resultado Líquido"
              valor={resumoB.resultado} valorAnterior={resumoA.resultado}
              variacao={calcVariacao(resumoB.resultado, resumoA.resultado)}
              corPositiva="green" oculto={oculto} />
            <KpiCard label="Δ Despesas"
              valor={resumoB.totalDespesas - resumoA.totalDespesas}
              variacao={calcVariacao(resumoB.totalDespesas, resumoA.totalDespesas)}
              corPositiva="red"
              subtitulo={resumoB.totalDespesas <= resumoA.totalDespesas ? '✓ Economizou' : '↑ Gastou mais'}
              oculto={oculto} />
            <div className="bg-[#1a1f2e] border border-white/10 rounded-xl px-4 py-4 flex flex-col gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Maior Aumento</p>
              {topAumento ? (
                <>
                  <p className="text-[13px] font-bold truncate" style={{ color: '#f87171' }}>{topAumento.nome}</p>
                  <div className="flex items-center gap-1">
                    <ArrowUpRight size={13} style={{ color: '#f87171' }} />
                    <span className="text-[12px] font-semibold" style={{ color: '#f87171' }}>+{topAumento.variacao!.toFixed(1)}%</span>
                  </div>
                  <p className="text-[10px]" style={{ color: '#4a5168' }}>{oculto ? '••••' : formatBRL(topAumento.atual)}</p>
                </>
              ) : <p className="text-[11px]" style={{ color: '#4a5168' }}>—</p>}
            </div>
            <div className="bg-[#1a1f2e] border border-white/10 rounded-xl px-4 py-4 flex flex-col gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Maior Redução</p>
              {topReducao ? (
                <>
                  <p className="text-[13px] font-bold truncate" style={{ color: '#00c896' }}>{topReducao.nome}</p>
                  <div className="flex items-center gap-1">
                    <ArrowDownRight size={13} style={{ color: '#00c896' }} />
                    <span className="text-[12px] font-semibold" style={{ color: '#00c896' }}>{topReducao.variacao!.toFixed(1)}%</span>
                  </div>
                  <p className="text-[10px]" style={{ color: '#4a5168' }}>{oculto ? '••••' : formatBRL(topReducao.atual)}</p>
                </>
              ) : <p className="text-[11px]" style={{ color: '#4a5168' }}>—</p>}
            </div>
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-4">
            <div className="lg:col-span-2 bg-[#1a1f2e] border border-white/10 rounded-2xl p-4">
              <p className="text-[12px] font-bold mb-0.5" style={{ color: '#e8eaf0' }}>Receitas vs Despesas</p>
              <p className="text-[10px] mb-3" style={{ color: '#4a5168' }}>Comparativo direto dos dois períodos</p>
              <div style={{ height: 230 }}><Bar data={chartBarComp} options={barCompOpts} /></div>
            </div>
            <div className="lg:col-span-3 bg-[#1a1f2e] border border-white/10 rounded-2xl p-4">
              <p className="text-[12px] font-bold mb-0.5" style={{ color: '#e8eaf0' }}>Top Categorias</p>
              <p className="text-[10px] mb-3" style={{ color: '#4a5168' }}>Top 10 por maior variação absoluta · presentes em ambos os períodos</p>
              <div style={{ height: 230 }}><Bar data={chartBarCats} options={barCatOpts} /></div>
            </div>
          </div>

          {/* Trend chart */}
          {tendencia.length > 0 && (
            <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-4 mb-4">
              <p className="text-[12px] font-bold mb-0.5" style={{ color: '#e8eaf0' }}>Tendência Financeira</p>
              <p className="text-[10px] mb-3" style={{ color: '#4a5168' }}>
                Últimos 12 meses completos{tendPeriodo ? ` · ${tendPeriodo}` : ''}
              </p>
              <div style={{ height: 190 }}><Line data={chartLinha} options={linhaOpts} /></div>
            </div>
          )}

          {/* Table + Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-[#1a1f2e] border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[12px] font-bold" style={{ color: '#e8eaf0' }}>Análise por Categoria</p>
                  <p className="text-[10px]" style={{ color: '#4a5168' }}>
                    {tableCats.filter(c => c.tipo === 'RECEITA').length} receita · {tableCats.filter(c => c.tipo === 'DESPESA').length} despesa
                  </p>
                </div>
                <input type="text" placeholder="Buscar categoria…" value={busca}
                  onChange={e => setBusca(e.target.value)}
                  className="px-3 py-1.5 rounded-lg text-[11px] border outline-none"
                  style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: '#e8eaf0', width: 170 }} />
              </div>
              <div className="overflow-auto" style={{ maxHeight: 440 }}>
                <table className="w-full border-collapse">
                  <thead className="sticky top-0 z-10" style={{ background: '#1a1f2e' }}>
                    <tr>
                      {([
                        { col: 'nome'      as SortCol, label: 'Categoria',        align: 'left'  },
                        { col: 'anterior'  as SortCol, label: 'Período inicial', align: 'right' },
                        { col: 'atual'     as SortCol, label: 'Período final',   align: 'right' },
                        { col: 'diferenca' as SortCol, label: 'Diferença',   align: 'right' },
                        { col: 'variacao'  as SortCol, label: '% Var.',      align: 'right' },
                      ]).map(({ col, label, align }) => (
                        <th key={col} onClick={() => toggleSort(col)}
                          className={`px-4 py-2.5 border-b border-white/5 cursor-pointer hover:bg-white/[0.03] text-${align} select-none`}>
                          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
                            {label}<SortIcon col={col} />
                          </span>
                        </th>
                      ))}
                      <th className="px-3 py-2.5 border-b border-white/5 text-center">
                        <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#8b92a8' }}>↕</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const receitaRows = tableCats.filter(c => c.tipo === 'RECEITA')
                      const despesaRows = tableCats.filter(c => c.tipo === 'DESPESA')
                      if (tableCats.length === 0) return (
                        <tr>
                          <td colSpan={6} className="text-center py-10">
                            <span className="text-[11px]" style={{ color: '#4a5168' }}>Nenhum resultado encontrado</span>
                          </td>
                        </tr>
                      )
                      const renderRow = (c: CatComparativo, i: number) => {
                        const melhorou = c.tipo === 'RECEITA' ? c.diferenca >= 0 : c.diferenca <= 0
                        const cor = c.variacao === null ? '#f0b429' : melhorou ? '#00c896' : '#f87171'
                        const TendIcon = c.variacao === null ? null
                          : c.diferenca > 0 ? TrendingUp
                          : c.diferenca < 0 ? TrendingDown
                          : Minus
                        const ativoAnterior = drillDown?.catKey === c.catKey && drillDown?.periodo === 'inicial'
                        const ativoAtual    = drillDown?.catKey === c.catKey && drillDown?.periodo === 'final'
                        return (
                          <tr key={`${c.catKey}-${i}`}
                            className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-2.5">
                              <span className="text-[11px]" style={{ color: '#e8eaf0' }}>{c.nome}</span>
                            </td>
                            <td className="px-4 py-2.5 text-right cursor-pointer"
                              onClick={() => setDrillDown(ativoAnterior ? null : { catKey: c.catKey, nome: c.nome, periodo: 'inicial' })}
                              title="Ver lançamentos do Período inicial">
                              <span className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${ativoAnterior ? 'font-bold' : ''}`}
                                style={{
                                  color: ativoAnterior ? '#4da6ff' : '#8b92a8',
                                  background: ativoAnterior ? 'rgba(77,166,255,0.12)' : 'transparent',
                                }}>
                                {oculto ? '••••' : formatBRL(c.anterior)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right cursor-pointer"
                              onClick={() => setDrillDown(ativoAtual ? null : { catKey: c.catKey, nome: c.nome, periodo: 'final' })}
                              title="Ver lançamentos do Período final">
                              <span className={`text-[11px] px-1.5 py-0.5 rounded transition-colors ${ativoAtual ? 'font-bold' : ''}`}
                                style={{
                                  color: ativoAtual ? '#4da6ff' : '#c5cad8',
                                  background: ativoAtual ? 'rgba(77,166,255,0.12)' : 'transparent',
                                }}>
                                {oculto ? '••••' : formatBRL(c.atual)}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              <span className="text-[11px] font-medium" style={{ color: cor }}>
                                {oculto ? '••••' : `${c.diferenca >= 0 ? '+' : ''}${formatBRL(c.diferenca)}`}
                              </span>
                            </td>
                            <td className="px-4 py-2.5 text-right">
                              {c.variacao === null ? (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                                  style={{ background: 'rgba(240,180,41,0.12)', color: '#f0b429' }}>
                                  Novo
                                </span>
                              ) : (
                                <span className="text-[11px] font-semibold" style={{ color: cor }}>
                                  {`${c.variacao >= 0 ? '+' : ''}${c.variacao.toFixed(1)}%`}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2.5 text-center">
                              {TendIcon && <TendIcon size={13} style={{ color: cor }} />}
                            </td>
                          </tr>
                        )
                      }
                      return (
                        <>
                          {receitaRows.length > 0 && (
                            <>
                              <tr style={{ background: 'rgba(0,200,150,0.06)' }}>
                                <td colSpan={6} className="px-4 py-1.5">
                                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#00c896' }}>
                                    Receitas · {receitaRows.length} categoria{receitaRows.length !== 1 ? 's' : ''}
                                  </span>
                                </td>
                              </tr>
                              {receitaRows.map((c, i) => renderRow(c, i))}
                            </>
                          )}
                          {despesaRows.length > 0 && (
                            <>
                              <tr style={{ background: 'rgba(248,113,113,0.06)' }}>
                                <td colSpan={6} className="px-4 py-1.5">
                                  <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#f87171' }}>
                                    Despesas · {despesaRows.length} categoria{despesaRows.length !== 1 ? 's' : ''}
                                  </span>
                                </td>
                              </tr>
                              {despesaRows.map((c, i) => renderRow(c, i))}
                            </>
                          )}
                        </>
                      )
                    })()}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Insights */}
            <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl overflow-hidden flex flex-col">
              <div className="px-5 py-3 border-b border-white/10">
                <p className="text-[12px] font-bold" style={{ color: '#e8eaf0' }}>Insights Automáticos</p>
                <p className="text-[10px] mt-0.5" style={{ color: '#4a5168' }}>
                  {insights.length} observação{insights.length !== 1 ? 'ões' : ''}
                </p>
              </div>
              <div className="p-4 space-y-2.5 overflow-auto flex-1" style={{ maxHeight: 440 }}>
                {insights.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <CheckCircle size={22} style={{ color: '#00c896', opacity: 0.4 }} />
                    <p className="text-[11px] text-center" style={{ color: '#4a5168' }}>
                      Nenhum alerta identificado.<br />Suas finanças estão estáveis!
                    </p>
                  </div>
                )}
                {insights.map((ins, i) => {
                  const cfg =
                    ins.tipo === 'alerta'   ? { bg: 'rgba(248,113,113,0.07)', cor: '#f87171', Icon: AlertTriangle }
                    : ins.tipo === 'positivo' ? { bg: 'rgba(0,200,150,0.07)',   cor: '#00c896', Icon: CheckCircle }
                    :                          { bg: 'rgba(77,166,255,0.07)',   cor: '#4da6ff', Icon: Info }
                  return (
                    <div key={i} className="flex gap-2.5 p-3 rounded-xl"
                      style={{ background: cfg.bg, border: `1px solid ${cfg.cor}25` }}>
                      <cfg.Icon size={14} style={{ color: cfg.cor, flexShrink: 0, marginTop: 1 }} />
                      <p className="text-[11px] leading-relaxed" style={{ color: '#c5cad8' }}>{ins.texto}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Drill-down: lançamentos analíticos da célula selecionada */}
          {drillDown && (
            <div ref={drillDownRef} className="mt-4 bg-[#1a1f2e] border border-white/10 rounded-2xl overflow-hidden">
              <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-[12px] font-bold" style={{ color: '#e8eaf0' }}>
                    {drillDown.nome}
                    <span className="ml-2 text-[11px] font-normal px-2 py-0.5 rounded-full"
                      style={{ background: 'rgba(77,166,255,0.12)', color: '#4da6ff' }}>
                      {drillDown.periodo === 'inicial' ? 'Período inicial' : 'Período final'}
                    </span>
                  </p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#4a5168' }}>
                    {drillDown.periodo === 'inicial' ? periodoLabelLongo(inicioA, fimA) : periodoLabelLongo(inicioB, fimB)}
                    {' · '}{drillDownLancamentos.length} lançamento{drillDownLancamentos.length !== 1 ? 's' : ''}
                  </p>
                </div>
                <button onClick={() => setDrillDown(null)}
                  className="p-1.5 rounded-lg transition-colors hover:bg-white/[0.06]"
                  style={{ color: '#4a5168' }} title="Fechar">
                  <X size={14} />
                </button>
              </div>
              {drillDownLancamentos.length === 0 ? (
                <p className="text-center py-8 text-[11px]" style={{ color: '#4a5168' }}>
                  Nenhum lançamento encontrado para esta categoria neste período.
                </p>
              ) : (
                <div className="overflow-auto" style={{ maxHeight: 320 }}>
                  <table className="w-full border-collapse">
                    <thead className="sticky top-0 z-10" style={{ background: '#1a1f2e' }}>
                      <tr>
                        {(['Data', 'Descrição', 'Tipo', 'Valor', ''] as const).map(h => (
                          <th key={h} className={`px-4 py-2.5 border-b border-white/5 ${h === 'Valor' ? 'text-right' : 'text-left'}`}>
                            <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#8b92a8' }}>{h}</span>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {drillDownLancamentos.map((l, i) => (
                        <tr key={`${l.id}-${i}`}
                          className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="text-[11px]" style={{ color: '#8b92a8' }}>
                              {new Date(`${l.data}T00:00:00`).toLocaleDateString('pt-BR')}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-[11px]" style={{ color: '#e8eaf0' }}>{l.descricao || '—'}</span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold"
                              style={{
                                background: l.tipo === 'RECEITA' ? 'rgba(0,200,150,0.1)' : 'rgba(248,113,113,0.1)',
                                color:      l.tipo === 'RECEITA' ? '#00c896' : '#f87171',
                              }}>
                              {l.tipo === 'RECEITA' ? 'Receita' : 'Despesa'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="text-[11px] font-semibold"
                              style={{ color: l.tipo === 'RECEITA' ? '#00c896' : '#f87171' }}>
                              {oculto ? '••••' : formatBRL(l.valor)}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-center">
                            <button
                              onClick={() => setEditandoId(l.id)}
                              className="p-1 rounded-md transition-colors hover:bg-blue-400/10"
                              style={{ color: '#4a5168' }}
                              title="Editar lançamento"
                            >
                              <Pencil size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                        <td colSpan={3} className="px-4 py-2 text-right">
                          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
                            Saldo líquido
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          {(() => {
                            const net = drillDownLancamentos.reduce(
                              (s, l) => s + (l.tipo === 'RECEITA' ? l.valor : -l.valor), 0
                            )
                            return (
                              <span className="text-[11px] font-bold"
                                style={{ color: net >= 0 ? '#00c896' : '#f87171' }}>
                                {oculto ? '••••' : `${net >= 0 ? '+' : ''}${formatBRL(net)}`}
                              </span>
                            )
                          })()}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Drawer de edição de lançamento */}
      {editandoId && (
        <DrawerLancamento
          lancamentoId={editandoId}
          onFechar={() => setEditandoId(null)}
          onSalvo={() => { setEditandoId(null); buscar() }}
          onExcluido={() => { setEditandoId(null); buscar() }}
        />
      )}
    </div>
  )
}
