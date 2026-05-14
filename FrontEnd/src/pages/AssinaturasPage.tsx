// src/pages/AssinaturasPage.tsx
import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { Doughnut, Bar, Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, ArcElement, CategoryScale, LinearScale,
  BarElement, LineElement, PointElement, Tooltip, Legend, Filler,
} from 'chart.js'
import { Download, RefreshCw, Search, X, Pencil, ChevronDown } from 'lucide-react'
import DrawerLancamento from '../components/ui/DrawerLancamento'
import { fetchLancamentos, mesAdjacente, type Lancamento } from '../hooks/useLancamentos'
import { formatBRL, mesLabel } from '../lib/utils'

ChartJS.register(ArcElement, CategoryScale, LinearScale, BarElement, LineElement, PointElement, Tooltip, Legend, Filler)

// ── Types ────────────────────────────────────────────────────────
type Frequencia = 'SEMANAL' | 'MENSAL' | 'TRIMESTRAL' | 'ANUAL'
type StatusRec  = 'ATIVA' | 'NOVA' | 'SUSPEITA_INATIVIDADE' | 'AUMENTO_RECENTE'

interface Recorrencia {
  id:             string
  nome:           string
  categoria:      string
  categoriaId:    string | null
  valorMedio:     number
  valorMensal:    number
  frequencia:     Frequencia
  ultimaCobranca: string
  ocorrencias:    number
  status:         StatusRec
  lancamentos:    Lancamento[]
}

// ── Helpers ──────────────────────────────────────────────────────
function mesAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function normalizarNome(desc: string | null | undefined): string {
  if (!desc) return '__sem__'
  return desc
    .toLowerCase()
    .replace(/\s*-\s*\d+\/\d+/g, '')
    .replace(/\s+\d+\/\d+/g, '')
    .replace(/\s*#\d+\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function diasEntre(d1: string, d2: string): number {
  return (new Date(d2 + 'T12:00:00').getTime() - new Date(d1 + 'T12:00:00').getTime()) / 86_400_000
}

function detectarFrequencia(avg: number): Frequencia | null {
  if (avg >= 5  && avg <= 10)  return 'SEMANAL'
  if (avg >= 25 && avg <= 36)  return 'MENSAL'
  if (avg >= 80 && avg <= 105) return 'TRIMESTRAL'
  if (avg >= 335 && avg <= 395) return 'ANUAL'
  return null
}

function valorParaMensal(v: number, f: Frequencia): number {
  if (f === 'SEMANAL')    return v * 52 / 12
  if (f === 'TRIMESTRAL') return v / 3
  if (f === 'ANUAL')      return v / 12
  return v
}

function detectarStatus(sorted: Lancamento[], hoje: string): StatusRec {
  if (sorted.length <= 2) return 'NOVA'
  const dias = diasEntre(sorted[sorted.length - 1].data, hoje)
  if (dias > 45) return 'SUSPEITA_INATIVIDADE'
  if (sorted.length >= 2) {
    const prev = sorted[sorted.length - 2].valor
    const last = sorted[sorted.length - 1].valor
    if (last > prev * 1.07) return 'AUMENTO_RECENTE'
  }
  return 'ATIVA'
}

function detectarRecorrencias(lancamentos: Lancamento[], hoje: string): Recorrencia[] {
  const isTransf = (l: Lancamento) =>
    !!l.id_par_transferencia || l.categoria_nome === 'Transferências'

  const base = lancamentos.filter(l =>
    l.tipo === 'DESPESA' && !isTransf(l) && l.status !== 'PROJECAO',
  )

  // Agrupa por categoria + descrição normalizada (ignora id_recorrencia)
  const grupos = new Map<string, Lancamento[]>()
  for (const l of base) {
    const key = (l.categoria_id ?? '__') + '||' + normalizarNome(l.descricao)
    const arr = grupos.get(key) ?? []
    arr.push(l)
    grupos.set(key, arr)
  }

  const resultado: Recorrencia[] = []

  for (const [, items] of grupos) {
    if (items.length < 2) continue
    const sorted = [...items].sort((a, b) => a.data.localeCompare(b.data))

    const intervals: number[] = []
    for (let i = 1; i < sorted.length; i++) intervals.push(diasEntre(sorted[i - 1].data, sorted[i].data))
    const avgDias = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const freq = detectarFrequencia(avgDias)
    if (!freq) continue

    const valores = sorted.map(l => l.valor)
    const valorMedio = valores.reduce((a, b) => a + b, 0) / valores.length
    const maxVar = Math.max(...valores.map(v => Math.abs(v - valorMedio) / valorMedio))
    if (maxVar > 0.20 && items.length < 4) continue

    const ultima = sorted[sorted.length - 1]
    resultado.push({
      id: (ultima.categoria_id ?? '') + '_' + normalizarNome(ultima.descricao),
      nome: ultima.descricao || 'Sem descrição',
      categoria: ultima.categoria_nome || ultima.categoria_pai_nome || 'Outros',
      categoriaId: ultima.categoria_id,
      valorMedio,
      valorMensal: valorParaMensal(valorMedio, freq),
      frequencia: freq,
      ultimaCobranca: ultima.data,
      ocorrencias: items.length,
      status: detectarStatus(sorted, hoje),
      lancamentos: sorted,
    })
  }

  return resultado.sort((a, b) => b.valorMensal - a.valorMensal)
}

// ── Constants ────────────────────────────────────────────────────
const CHART_COLORS = [
  '#4da6ff', '#00c896', '#f0b429', '#f87171', '#a78bfa',
  '#fb923c', '#2dd4bf', '#f472b6', '#34d399', '#60a5fa', '#facc15',
]

const FREQ_LABEL: Record<Frequencia, string> = {
  SEMANAL: 'Semanal', MENSAL: 'Mensal', TRIMESTRAL: 'Trimestral', ANUAL: 'Anual',
}

const STATUS_INFO: Record<StatusRec, { label: string; color: string; bg: string }> = {
  ATIVA:                { label: 'Ativa',     color: '#00c896', bg: 'rgba(0,200,150,0.12)'   },
  NOVA:                 { label: 'Nova',       color: '#4da6ff', bg: 'rgba(77,166,255,0.12)'  },
  SUSPEITA_INATIVIDADE: { label: 'Inativa?',   color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  AUMENTO_RECENTE:      { label: 'Reajuste',   color: '#f0b429', bg: 'rgba(240,180,41,0.12)'  },
}

// ── UI components ────────────────────────────────────────────────
function StatusBadge({ status }: { status: StatusRec }) {
  const s = STATUS_INFO[status]
  return (
    <span style={{
      background: s.bg, color: s.color,
      fontSize: 10, fontWeight: 700, padding: '2px 8px',
      borderRadius: 20, letterSpacing: '0.3px', whiteSpace: 'nowrap',
    }}>{s.label}</span>
  )
}

function KpiCard({ label, value, sub, color = '#e8eaf0' }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div className="bg-[#1a1f2e] border border-white/10 rounded-xl px-4 py-3">
      <p className="text-[9px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>{label}</p>
      <p className="text-[18px] font-bold leading-tight" style={{ color }}>{value}</p>
      {sub && <p className="text-[10px] mt-1 truncate" style={{ color: '#8b92a8' }}>{sub}</p>}
    </div>
  )
}

// ── State persistence ────────────────────────────────────────────
interface PageCache { lancamentos: Lancamento[] }
let _saved: PageCache | null = null

// ── Chart defaults ───────────────────────────────────────────────
const TICK_STYLE  = { color: '#8b92a8', font: { size: 10 as const } }
const GRID_STYLE  = { color: 'rgba(255,255,255,0.04)' as const }
const tipFmt      = (v: unknown) => formatBRL(Number(v))

// ── Page ─────────────────────────────────────────────────────────
export default function AssinaturasPage() {
  const hoje = useMemo(() => new Date().toISOString().split('T')[0], [])
  const [lancamentos, setLancamentos] = useState<Lancamento[]>(() => _saved?.lancamentos ?? [])
  const [loading, setLoading]         = useState(!_saved)
  const [busca, setBusca]             = useState('')
  const [recSelecionada, setRecSelecionada] = useState<Recorrencia | null>(null)
  const [editandoId, setEditandoId]         = useState<string | null>(null)
  const detalheRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (recSelecionada && detalheRef.current) {
      detalheRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [recSelecionada])

  const carregar = useCallback(async (force = false) => {
    if (_saved && !force) return
    setLoading(true)
    try {
      const mes  = mesAtual()
      const meses = Array.from({ length: 13 }, (_, i) => mesAdjacente(mes, -i))
      const res  = await Promise.all(
        meses.map(m =>
          fetchLancamentos({ mes: m, status_ids: ['PAGO', 'PENDENTE'] })
            .catch(() => [] as Lancamento[]),
        ),
      )
      const todos = res.flat()
      setLancamentos(todos)
      _saved = { lancamentos: todos }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { carregar() }, [carregar])

  // ── Derived ──────────────────────────────────────────────────
  const recorrencias = useMemo(() => detectarRecorrencias(lancamentos, hoje), [lancamentos, hoje])

  const kpis = useMemo(() => {
    const totalMensal = recorrencias.reduce((s, r) => s + r.valorMensal, 0)
    const porCatMap   = new Map<string, number>()
    for (const r of recorrencias) porCatMap.set(r.categoria, (porCatMap.get(r.categoria) ?? 0) + r.valorMensal)
    const porCat = [...porCatMap.entries()].sort((a, b) => b[1] - a[1])
    return {
      totalMensal,
      totalAnual:   totalMensal * 12,
      ativas:       recorrencias.filter(r => r.status === 'ATIVA' || r.status === 'AUMENTO_RECENTE').length,
      novas:        recorrencias.filter(r => r.status === 'NOVA').length,
      inativos:     recorrencias.filter(r => r.status === 'SUSPEITA_INATIVIDADE').length,
      reajustadas:  recorrencias.filter(r => r.status === 'AUMENTO_RECENTE').length,
      maior:        recorrencias[0] ?? null,
      porCat,
    }
  }, [recorrencias])

  const evolucao = useMemo(() => {
    const mes   = mesAtual()
    const meses = Array.from({ length: 12 }, (_, i) => mesAdjacente(mes, -(11 - i)))
    const ids   = new Set(recorrencias.flatMap(r => r.lancamentos.map(l => l.id)))
    const por: Record<string, number> = {}
    for (const l of lancamentos) {
      if (!ids.has(l.id)) continue
      const m = l.data.substring(0, 7)
      por[m] = (por[m] ?? 0) + l.valor
    }
    return { meses, data: meses.map(m => por[m] ?? 0) }
  }, [recorrencias, lancamentos])

  const insights = useMemo(() => {
    const { totalMensal, totalAnual, ativas, novas, inativos, reajustadas, porCat } = kpis
    const list: { icon: string; text: string }[] = []
    if (recorrencias.length)
      list.push({ icon: '📋', text: `${recorrencias.length} cobranças recorrentes detectadas — ${ativas} ativas.` })
    if (totalMensal > 0)
      list.push({ icon: '💰', text: `Total comprometido: ${formatBRL(totalMensal)}/mês · ${formatBRL(totalAnual)}/ano projetado.` })
    if (reajustadas > 0)
      list.push({ icon: '⚠️', text: `${reajustadas} serviço${reajustadas > 1 ? 's' : ''} com reajuste recente de preço.` })
    if (inativos > 0)
      list.push({ icon: '🔍', text: `${inativos} cobrança${inativos > 1 ? 's' : ''} sem movimentação há +45 dias — verifique cancelamentos.` })
    if (novas > 0)
      list.push({ icon: '✨', text: `${novas} nova${novas > 1 ? 's' : ''} recorrência${novas > 1 ? 's' : ''} detectada${novas > 1 ? 's' : ''} no histórico recente.` })
    if (porCat[0])
      list.push({ icon: '📊', text: `Categoria mais cara: "${porCat[0][0]}" com ${formatBRL(porCat[0][1])}/mês.` })
    return list
  }, [recorrencias, kpis])

  const filtradas = useMemo(() => {
    if (!busca) return recorrencias
    const t = busca.toLowerCase()
    return recorrencias.filter(r => r.nome.toLowerCase().includes(t) || r.categoria.toLowerCase().includes(t))
  }, [recorrencias, busca])

  const exportar = () => {
    const rows = [
      ['Serviço', 'Categoria', 'Frequência', 'Custo Mensal', 'Custo Anual', 'Última Cobrança', 'Ocorrências', 'Status'],
      ...recorrencias.map(r => [
        r.nome, r.categoria, FREQ_LABEL[r.frequencia],
        r.valorMensal.toFixed(2).replace('.', ','),
        (r.valorMensal * 12).toFixed(2).replace('.', ','),
        r.ultimaCobranca, String(r.ocorrencias), STATUS_INFO[r.status].label,
      ]),
    ]
    const csv  = rows.map(r => r.map(c => `"${c}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    const a    = Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob), download: `assinaturas_${hoje}.csv`,
    })
    a.click()
  }

  // ── Render: loading ──────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="text-center">
        <RefreshCw size={24} className="animate-spin mx-auto mb-3" style={{ color: '#4da6ff' }} />
        <p className="text-[13px]" style={{ color: '#8b92a8' }}>Analisando histórico de transações…</p>
      </div>
    </div>
  )

  const { totalMensal, totalAnual, ativas, novas, inativos, reajustadas, maior, porCat } = kpis

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[20px] font-bold text-white">Assinaturas &amp; Recorrências</h1>
          <p className="text-[12px] mt-0.5" style={{ color: '#8b92a8' }}>
            Últimos 13 meses · {recorrencias.length} recorrências detectadas
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportar} disabled={!recorrencias.length}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] font-medium transition-all disabled:opacity-40 hover:border-white/30"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#8b92a8' }}>
            <Download size={13} /> Exportar CSV
          </button>
          <button onClick={() => carregar(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[12px] font-medium transition-all hover:border-white/30"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#8b92a8' }}>
            <RefreshCw size={13} /> Atualizar
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Custo Mensal"         value={formatBRL(totalMensal)}          color="#00c896" />
        <KpiCard label="Projeção Anual"        value={formatBRL(totalAnual)}           color="#4da6ff" />
        <KpiCard label="Recorrências Ativas"   value={String(ativas)}                  color="#e8eaf0"
          sub={novas > 0 ? `+${novas} nova${novas > 1 ? 's' : ''}` : undefined} />
        <KpiCard label="Maior Cobrança/Mês"    value={maior ? formatBRL(maior.valorMensal) : '—'}
          color="#f0b429" sub={maior?.nome} />
        <KpiCard label="Categoria Mais Cara"   value={porCat[0]?.[0] ?? '—'}
          color="#a78bfa" sub={porCat[0] ? formatBRL(porCat[0][1]) + '/mês' : undefined} />
        <KpiCard label="Reajustes Recentes"    value={String(reajustadas)} color={reajustadas > 0 ? '#f0b429' : '#e8eaf0'}
          sub={reajustadas > 0 ? 'verificar preços' : 'nenhum detectado'} />
        <KpiCard label="Novas Recorrências"    value={String(novas)}    color={novas > 0 ? '#4da6ff' : '#e8eaf0'} />
        <KpiCard label="Suspeita Inatividade"  value={String(inativos)} color={inativos > 0 ? '#f87171' : '#e8eaf0'}
          sub={inativos > 0 ? 'possíveis cancelamentos' : 'todas ativas'} />
      </div>

      {recorrencias.length === 0 ? (
        <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-12 text-center">
          <p className="text-[14px] font-semibold text-white mb-2">Nenhuma recorrência detectada</p>
          <p className="text-[12px] max-w-md mx-auto" style={{ color: '#8b92a8' }}>
            O sistema analisa despesas com padrão de repetição (mesmo serviço, intervalos regulares).
            São necessários pelo menos 2 lançamentos semelhantes para detecção automática.
          </p>
        </div>
      ) : (
        <>
          {/* ── Charts ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Donut por categoria */}
            <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-4">
              <p className="text-[13px] font-semibold text-white mb-3">Distribuição por Categoria</p>
              <div className="h-56">
                <Doughnut
                  data={{
                    labels: porCat.map(([k]) => k),
                    datasets: [{
                      data: porCat.map(([, v]) => v),
                      backgroundColor: CHART_COLORS.slice(0, porCat.length),
                      borderWidth: 0, hoverOffset: 4,
                    }],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false, cutout: '65%',
                    plugins: {
                      legend: { position: 'right', labels: { color: '#8b92a8', font: { size: 11 }, padding: 10 } },
                      tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${tipFmt(ctx.raw)}/mês` } },
                    },
                  }}
                />
              </div>
            </div>

            {/* Evolução mensal */}
            <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-4">
              <p className="text-[13px] font-semibold text-white mb-3">Evolução Mensal (12 meses)</p>
              <div className="h-56">
                <Line
                  data={{
                    labels: evolucao.meses.map(m => mesLabel(m)),
                    datasets: [{
                      label: 'Recorrências',
                      data: evolucao.data,
                      borderColor: '#4da6ff',
                      backgroundColor: 'rgba(77,166,255,0.08)',
                      borderWidth: 2, pointRadius: 3, tension: 0.3, fill: true,
                    }],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { display: false },
                      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${tipFmt(ctx.raw)}` } },
                    },
                    scales: {
                      x: { grid: GRID_STYLE, ticks: TICK_STYLE },
                      y: { grid: GRID_STYLE, ticks: { ...TICK_STYLE, callback: v => formatBRL(Number(v)) } },
                    },
                  }}
                />
              </div>
            </div>
          </div>

          {/* Top recorrências — barra horizontal */}
          <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-4">
            <p className="text-[13px] font-semibold text-white mb-3">Top Recorrências por Custo Mensal</p>
            <div style={{ height: Math.max(200, Math.min(recorrencias.length, 10) * 34 + 48) }}>
              <Bar
                data={{
                  labels: recorrencias.slice(0, 10).map(r => r.nome.length > 30 ? r.nome.slice(0, 27) + '…' : r.nome),
                  datasets: [{
                    label: 'Custo Mensal',
                    data: recorrencias.slice(0, 10).map(r => r.valorMensal),
                    backgroundColor: recorrencias.slice(0, 10).map(r =>
                      r.status === 'SUSPEITA_INATIVIDADE' ? 'rgba(248,113,113,0.55)'
                      : r.status === 'AUMENTO_RECENTE'   ? 'rgba(240,180,41,0.65)'
                      : r.status === 'NOVA'              ? 'rgba(77,166,255,0.65)'
                      : 'rgba(0,200,150,0.55)'
                    ),
                    borderRadius: 4,
                  }],
                }}
                options={{
                  indexAxis: 'y',
                  responsive: true, maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: ctx => ` Mensal: ${tipFmt(ctx.raw)}  |  Anual: ${formatBRL(Number(ctx.raw) * 12)}`,
                      },
                    },
                  },
                  scales: {
                    x: { grid: GRID_STYLE, ticks: { ...TICK_STYLE, callback: v => formatBRL(Number(v)) } },
                    y: { grid: { display: false }, ticks: { color: '#e8eaf0', font: { size: 11 } } },
                  },
                }}
              />
            </div>
            {/* Legenda de cores */}
            <div className="flex gap-4 mt-3 flex-wrap">
              {([
                ['rgba(0,200,150,0.55)',   'Ativa'],
                ['rgba(77,166,255,0.65)',  'Nova'],
                ['rgba(240,180,41,0.65)',  'Reajuste'],
                ['rgba(248,113,113,0.55)', 'Inativa?'],
              ] as const).map(([bg, label]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: bg }} />
                  <span className="text-[10px]" style={{ color: '#8b92a8' }}>{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Insights */}
          {insights.length > 0 && (
            <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-4">
              <p className="text-[13px] font-semibold text-white mb-3">Insights Automáticos</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {insights.map((ins, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="text-[15px] leading-none mt-0.5 flex-shrink-0">{ins.icon}</span>
                    <p className="text-[11px] leading-relaxed" style={{ color: '#c8cad8' }}>{ins.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tabela detalhada */}
          <div className="bg-[#1a1f2e] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10 flex items-center gap-3 flex-wrap">
              <p className="text-[13px] font-semibold text-white flex-1">Detalhamento</p>
              <div className="flex items-center gap-2 rounded-lg px-3 py-1.5 border"
                style={{ background: '#131825', borderColor: busca ? 'rgba(77,166,255,0.4)' : 'rgba(255,255,255,0.1)', minWidth: 220 }}>
                <Search size={12} style={{ color: '#8b92a8' }} />
                <input
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                  placeholder="Buscar serviço ou categoria…"
                  className="flex-1 bg-transparent text-[12px] text-white placeholder-[#4a5168] focus:outline-none"
                />
                {busca && <button onClick={() => setBusca('')}><X size={11} style={{ color: '#8b92a8' }} /></button>}
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    {['Serviço', 'Categoria', 'Frequência', 'Custo Mensal', 'Custo Anual', 'Última Cobrança', 'Ocorr.', 'Status'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left border-b border-white/5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>{h}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtradas.map(r => {
                    const ativa = recSelecionada?.id === r.id
                    return (
                    <tr
                      key={r.id}
                      onClick={() => setRecSelecionada(ativa ? null : r)}
                      className="border-b border-white/5 transition-colors cursor-pointer"
                      style={{ background: ativa ? 'rgba(77,166,255,0.08)' : undefined }}
                      onMouseEnter={e => { if (!ativa) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
                      onMouseLeave={e => { if (!ativa) (e.currentTarget as HTMLElement).style.background = '' }}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <ChevronDown
                            size={12}
                            style={{
                              color: ativa ? '#4da6ff' : '#4a5168',
                              transform: ativa ? 'rotate(0deg)' : 'rotate(-90deg)',
                              transition: 'transform 0.2s',
                              flexShrink: 0,
                            }}
                          />
                          <span className="text-[12px] font-medium" style={{ color: ativa ? '#4da6ff' : '#e8eaf0' }}>{r.nome}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px]" style={{ color: '#8b92a8' }}>{r.categoria}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px]" style={{ color: '#8b92a8' }}>{FREQ_LABEL[r.frequencia]}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-[12px] font-semibold" style={{ color: '#00c896' }}>{formatBRL(r.valorMensal)}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-[11px]" style={{ color: '#4da6ff' }}>{formatBRL(r.valorMensal * 12)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[11px]" style={{ color: '#8b92a8' }}>
                          {new Date(r.ultimaCobranca + 'T12:00:00').toLocaleDateString('pt-BR')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-[11px]" style={{ color: '#8b92a8' }}>{r.ocorrencias}×</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={r.status} />
                      </td>
                    </tr>
                  )})}
                  {filtradas.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center">
                        <span className="text-[12px]" style={{ color: '#8b92a8' }}>Nenhuma recorrência encontrada</span>
                      </td>
                    </tr>
                  )}
                </tbody>
                {filtradas.length > 0 && (
                  <tfoot>
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <td colSpan={3} className="px-4 py-2.5 border-t border-white/10">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
                          Total ({filtradas.length})
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right border-t border-white/10">
                        <span className="text-[12px] font-bold" style={{ color: '#00c896' }}>
                          {formatBRL(filtradas.reduce((s, r) => s + r.valorMensal, 0))}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right border-t border-white/10">
                        <span className="text-[11px] font-semibold" style={{ color: '#4da6ff' }}>
                          {formatBRL(filtradas.reduce((s, r) => s + r.valorMensal * 12, 0))}
                        </span>
                      </td>
                      <td colSpan={3} className="border-t border-white/10" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* ── Painel de lançamentos da recorrência selecionada ── */}
          {recSelecionada && (
            <div ref={detalheRef} className="bg-[#1a1f2e] border border-blue-400/30 rounded-xl overflow-hidden"
              style={{ scrollMarginTop: 80 }}>
              <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between gap-3"
                style={{ background: 'rgba(77,166,255,0.06)' }}>
                <div>
                  <p className="text-[13px] font-semibold text-white">{recSelecionada.nome}</p>
                  <p className="text-[10px] mt-0.5" style={{ color: '#8b92a8' }}>
                    {recSelecionada.ocorrencias} lançamento{recSelecionada.ocorrencias !== 1 ? 's' : ''} ·{' '}
                    {FREQ_LABEL[recSelecionada.frequencia]} · {formatBRL(recSelecionada.valorMensal)}/mês
                  </p>
                </div>
                <button
                  onClick={() => setRecSelecionada(null)}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                  style={{ color: '#8b92a8' }}
                >
                  <X size={14} />
                </button>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      {['Data', 'Descrição', 'Valor', ''].map(h => (
                        <th key={h} className="px-4 py-2 text-left border-b border-white/5">
                          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>{h}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[...recSelecionada.lancamentos]
                      .sort((a, b) => b.data.localeCompare(a.data))
                      .map(l => (
                        <tr key={l.id} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors">
                          <td className="px-4 py-2.5 whitespace-nowrap">
                            <span className="text-[11px]" style={{ color: '#8b92a8' }}>
                              {new Date(l.data + 'T12:00:00').toLocaleDateString('pt-BR')}
                            </span>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="text-[12px] text-white">{l.descricao}</span>
                          </td>
                          <td className="px-4 py-2.5 text-right whitespace-nowrap">
                            <span className="text-[12px] font-semibold" style={{ color: '#f87171' }}>
                              {formatBRL(l.valor)}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={e => { e.stopPropagation(); setEditandoId(l.id) }}
                              title="Editar lançamento"
                              className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center transition-all hover:bg-white/10 hover:border-white/25"
                              style={{ color: '#8b92a8' }}
                            >
                              <Pencil size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                      <td colSpan={2} className="px-4 py-2 border-t border-white/10">
                        <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
                          Total gasto no período
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right border-t border-white/10">
                        <span className="text-[12px] font-bold" style={{ color: '#f87171' }}>
                          {formatBRL(recSelecionada.lancamentos.reduce((s, l) => s + l.valor, 0))}
                        </span>
                      </td>
                      <td className="border-t border-white/10" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* DrawerLancamento para edição */}
      {editandoId && (
        <DrawerLancamento
          lancamentoId={editandoId}
          onFechar={() => setEditandoId(null)}
          onSalvo={() => { setEditandoId(null); carregar(true) }}
          onExcluido={() => { setEditandoId(null); carregar(true) }}
        />
      )}
    </div>
  )
}
