// src/pages/ProjecaoEconomiaPage.tsx
import { useState, useEffect, useMemo, useCallback } from 'react'
import { Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, LineElement,
  BarElement, PointElement, Tooltip, Legend, Filler,
} from 'chart.js'
import { Download, RefreshCw, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { fetchLancamentos, mesAdjacente, type Lancamento } from '../hooks/useLancamentos'
import { formatBRL, mesLabel } from '../lib/utils'
import MascoteDica from '../components/ui/MascoteDica'
import MascoteTutorial from '../components/ui/MascoteTutorial'
import { useMascotePreferido } from '../hooks/useMascotePreferido'

ChartJS.register(CategoryScale, LinearScale, LineElement, BarElement, PointElement, Tooltip, Legend, Filler)

// ── Types ─────────────────────────────────────────────────────────
interface DadosMes {
  mes: string
  receitas: number
  despesas: number
  economia: number
  porCategoria: Record<string, number>
}

// ── Helpers ───────────────────────────────────────────────────────
function mesAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fvAnnuity(pmt: number, taxa: number, n: number): number {
  if (Math.abs(taxa) < 0.000001) return pmt * n
  return pmt * ((Math.pow(1 + taxa, n) - 1) / taxa)
}

function serieMensal(pmt: number, taxa: number, n: number): number[] {
  const s: number[] = []
  let acum = 0
  for (let i = 0; i < n; i++) { acum = acum * (1 + taxa) + pmt; s.push(acum) }
  return s
}

// ── Constants ─────────────────────────────────────────────────────
const GRID  = { color: 'rgba(255,255,255,0.04)' as const }
const TICKS = { color: '#8b92a8', font: { size: 14 as const } }

// ── KpiCard ───────────────────────────────────────────────────────
function KpiCard({ label, value, sub, color = '#e8eaf0', trend }: {
  label: string; value: string; sub?: string; color?: string
  trend?: 'up' | 'down' | 'neutral'
}) {
  const Icon   = trend === 'up' ? TrendingUp : trend === 'down' ? TrendingDown : Minus
  const tColor = trend === 'up' ? '#00c896' : trend === 'down' ? '#f87171' : '#4a5168'
  return (
    <div className="bg-[#1a1f2e] border border-white/10 rounded-xl px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[13px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>{label}</p>
        {trend && <Icon size={13} style={{ color: tColor }} />}
      </div>
      <p className="text-[22px] font-bold leading-tight" style={{ color }}>{value}</p>
      {sub && <p className="text-[14px] mt-1 truncate" style={{ color: '#8b92a8' }}>{sub}</p>}
    </div>
  )
}

// ── Slider ────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, fmt, onChange, color = '#4da6ff' }: {
  label: string; value: number; min: number; max: number; step: number
  fmt: (v: number) => string; onChange: (v: number) => void; color?: string
}) {
  return (
    <div>
      <div className="flex justify-between items-center mb-1.5">
        <span className="text-[15px]" style={{ color: '#8b92a8' }}>{label}</span>
        <span className="text-[16px] font-bold" style={{ color }}>{fmt(value)}</span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full h-1 rounded-full appearance-none cursor-pointer"
        style={{ accentColor: color }}
      />
      <div className="flex justify-between mt-0.5">
        <span className="text-[13px]" style={{ color: '#4a5168' }}>{fmt(min)}</span>
        <span className="text-[13px]" style={{ color: '#4a5168' }}>{fmt(max)}</span>
      </div>
    </div>
  )
}

// ── State persistence ─────────────────────────────────────────────
interface PageCache { lancamentos: Lancamento[] }
let _saved: PageCache | null = null

// ── Page ──────────────────────────────────────────────────────────
export default function ProjecaoEconomiaPage() {
  const [lancamentos, setLancamentos] = useState<Lancamento[]>(() => _saved?.lancamentos ?? [])
  const [loading, setLoading]         = useState(!_saved)
  const { mascote } = useMascotePreferido()

  // Simulador
  const [rendimento,  setRendimento]  = useState(0.8)   // % a.m.
  const [reducaoPerc, setReducaoPerc] = useState(10)    // % redução despesas
  const [horizonte,   setHorizonte]   = useState(12)    // meses

  const carregar = useCallback(async (force = false) => {
    if (_saved && !force) return
    setLoading(true)
    try {
      const mes   = mesAtual()
      const meses = Array.from({ length: 6 }, (_, i) => mesAdjacente(mes, -(i + 1)))
      const res   = await Promise.all(
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

  // ── Aggregation ───────────────────────────────────────────────
  const dadosMensais = useMemo((): DadosMes[] => {
    const isTransf = (l: Lancamento) =>
      !!l.id_par_transferencia || l.categoria_nome === 'Transferências'

    const byMes = new Map<string, DadosMes>()
    for (const l of lancamentos) {
      if (isTransf(l)) continue
      const m = l.data.substring(0, 7)
      if (!byMes.has(m)) byMes.set(m, { mes: m, receitas: 0, despesas: 0, economia: 0, porCategoria: {} })
      const d = byMes.get(m)!
      if (l.tipo === 'RECEITA') {
        d.receitas += l.valor
      } else {
        d.despesas += l.valor
        const cat = l.categoria_nome || l.categoria_pai_nome || 'Outros'
        d.porCategoria[cat] = (d.porCategoria[cat] ?? 0) + l.valor
      }
    }
    for (const d of byMes.values()) d.economia = d.receitas - d.despesas
    return [...byMes.values()].sort((a, b) => a.mes.localeCompare(b.mes))
  }, [lancamentos])

  const medias = useMemo(() => {
    if (!dadosMensais.length) return { receitas: 0, despesas: 0, economia: 0, taxaPoupanca: 0 }
    const n        = dadosMensais.length
    const receitas = dadosMensais.reduce((s, d) => s + d.receitas, 0) / n
    const despesas = dadosMensais.reduce((s, d) => s + d.despesas, 0) / n
    const economia = dadosMensais.reduce((s, d) => s + d.economia, 0) / n
    return { receitas, despesas, economia, taxaPoupanca: receitas > 0 ? (economia / receitas) * 100 : 0 }
  }, [dadosMensais])

  const categorias = useMemo(() => {
    if (!dadosMensais.length) return []
    const n      = dadosMensais.length
    const totais: Record<string, number> = {}
    for (const d of dadosMensais)
      for (const [cat, val] of Object.entries(d.porCategoria))
        totais[cat] = (totais[cat] ?? 0) + val
    return Object.entries(totais)
      .map(([cat, total]) => ({ cat, media: total / n }))
      .sort((a, b) => b.media - a.media)
      .slice(0, 8)
  }, [dadosMensais])

  // ── Projections ───────────────────────────────────────────────
  const taxa            = rendimento / 100
  const economiaAtual   = Math.max(0, medias.economia)
  const economiaOtimista = economiaAtual + medias.despesas * (reducaoPerc / 100)

  const pvAtual    = fvAnnuity(economiaAtual,    taxa, horizonte)
  const pvOtimista = fvAnnuity(economiaOtimista, taxa, horizonte)

  const chartData = useMemo(() => {
    const mes    = mesAtual()
    const labels = Array.from({ length: horizonte }, (_, i) => mesLabel(mesAdjacente(mes, i + 1)))
    return {
      labels,
      atual:    serieMensal(economiaAtual,    taxa, horizonte),
      otimista: serieMensal(economiaOtimista, taxa, horizonte),
    }
  }, [economiaAtual, economiaOtimista, taxa, horizonte])

  const hLabel = horizonte < 24
    ? `${horizonte} meses`
    : horizonte < 60
    ? `${(horizonte / 12).toFixed(0)} anos`
    : `${(horizonte / 12).toFixed(0)} anos`

  // ── Insights ─────────────────────────────────────────────────
  const insights = useMemo(() => {
    const list: { icon: string; text: string }[] = []
    if (medias.economia > 0)
      list.push({ icon: '💰', text: `Mantendo o ritmo atual, você economizará ${formatBRL(medias.economia * 12)} em 12 meses.` })
    if (medias.taxaPoupanca > 0)
      list.push({ icon: '📊', text: `Taxa de poupança de ${medias.taxaPoupanca.toFixed(1)}% da renda — ${medias.taxaPoupanca >= 20 ? 'excelente! Meta ideal atingida.' : `meta ideal: 20%.`}` })
    if (reducaoPerc > 0 && medias.despesas > 0) {
      const ganho = medias.despesas * (reducaoPerc / 100) * 12
      list.push({ icon: '✂️', text: `Reduzindo ${reducaoPerc}% das despesas, você teria mais ${formatBRL(ganho)}/ano para investir.` })
    }
    if (categorias[0])
      list.push({ icon: '🎯', text: `"${categorias[0].cat}" é sua maior categoria de gasto: ${formatBRL(categorias[0].media)}/mês em média.` })
    if (rendimento > 0 && economiaAtual > 0)
      list.push({ icon: '📈', text: `Com ${rendimento}% a.m. de rendimento, em ${hLabel} você acumularia ${formatBRL(pvAtual)}.` })
    if (medias.economia < 0)
      list.push({ icon: '⚠️', text: `Atenção: despesas superam receitas em ${formatBRL(Math.abs(medias.economia))}/mês. Priorize cortar gastos variáveis.` })
    if (economiaOtimista > economiaAtual * 1.2)
      list.push({ icon: '✨', text: `No cenário otimista, a diferença em ${hLabel} é de ${formatBRL(pvOtimista - pvAtual)} a mais do que o cenário atual.` })
    return list
  }, [medias, reducaoPerc, categorias, rendimento, economiaAtual, economiaOtimista, pvAtual, pvOtimista, hLabel])

  const exportar = () => {
    const rows = [
      ['Cenário', 'Economia/Mês', 'Economia Anual', `Patrimônio (${hLabel})`, 'Rendimento a.m.'],
      ['Atual',    formatBRL(economiaAtual),    formatBRL(economiaAtual * 12),    formatBRL(pvAtual),    `${rendimento}%`],
      ['Otimista', formatBRL(economiaOtimista), formatBRL(economiaOtimista * 12), formatBRL(pvOtimista), `${rendimento}%`],
    ]
    const csv  = rows.map(r => r.map(c => `"${c}"`).join(';')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
    Object.assign(document.createElement('a'), {
      href: URL.createObjectURL(blob),
      download: `projecao_${mesAtual()}.csv`,
    }).click()
  }

  // ── Loading ───────────────────────────────────────────────────
  if (loading) return (
    <div className="flex items-center justify-center py-24">
      <div className="text-center">
        <RefreshCw size={24} className="animate-spin mx-auto mb-3" style={{ color: '#4da6ff' }} />
        <p className="text-[17px]" style={{ color: '#8b92a8' }}>Analisando histórico financeiro…</p>
      </div>
    </div>
  )

  return (
    <div className="space-y-6">

      <MascoteTutorial pagina="projecao" />

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-[24px] font-bold text-white">Projeção de Economia</h1>
          <p className="text-[16px] mt-0.5" style={{ color: '#8b92a8' }}>
            Baseado nos últimos {dadosMensais.length} meses · projeção para {hLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportar}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[16px] font-medium transition-all hover:border-white/30"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#8b92a8' }}>
            <Download size={13} /> Exportar CSV
          </button>
          <button onClick={() => carregar(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[16px] font-medium transition-all hover:border-white/30"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#8b92a8' }}>
            <RefreshCw size={13} /> Atualizar
          </button>
        </div>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label="Economia Média/Mês"
          value={formatBRL(medias.economia)}
          color={medias.economia >= 0 ? '#00c896' : '#f87171'}
          trend={medias.economia > 0 ? 'up' : medias.economia < 0 ? 'down' : 'neutral'}
          sub={`média de ${dadosMensais.length} mes${dadosMensais.length !== 1 ? 'es' : ''}`} />
        <KpiCard label="Projeção 12 meses"
          value={formatBRL(Math.max(0, medias.economia) * 12)}
          color="#4da6ff" trend="up" sub="sem rendimento" />
        <KpiCard label={`Patrimônio em ${hLabel}`}
          value={formatBRL(pvAtual)}
          color="#a78bfa" sub={rendimento > 0 ? `c/ ${rendimento}% a.m.` : 'sem rendimento'} />
        <KpiCard label="Taxa de Poupança"
          value={`${Math.max(0, medias.taxaPoupanca).toFixed(1)}%`}
          color={medias.taxaPoupanca >= 20 ? '#00c896' : medias.taxaPoupanca >= 10 ? '#f0b429' : '#f87171'}
          sub={medias.taxaPoupanca >= 20 ? 'excelente' : medias.taxaPoupanca >= 10 ? 'moderada' : 'abaixo do ideal'}
          trend={medias.taxaPoupanca >= 20 ? 'up' : medias.taxaPoupanca >= 10 ? 'neutral' : 'down'} />
        <KpiCard label="Receita Média/Mês"  value={formatBRL(medias.receitas)} color="#e8eaf0" />
        <KpiCard label="Despesa Média/Mês"  value={formatBRL(medias.despesas)} color="#f87171" trend="down" />
        <KpiCard label="Economia c/ -10% gastos"
          value={formatBRL(medias.despesas * 0.10 * 12)}
          color="#f0b429" sub="potencial anual" />
        <KpiCard label={`Cenário Otimista (${hLabel})`}
          value={formatBRL(pvOtimista)}
          color="#00c896" sub={`-${reducaoPerc}% gastos + ${rendimento}% a.m.`} trend="up" />
      </div>

      {dadosMensais.length === 0 ? (
        <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-12 text-center">
          <p className="text-[18px] font-semibold text-white mb-2">Sem dados suficientes</p>
          <p className="text-[16px]" style={{ color: '#8b92a8' }}>
            São necessários lançamentos dos meses anteriores para gerar projeções.
          </p>
        </div>
      ) : (
        <>
          {/* ── Simulador Interativo ── */}
          <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-5">
            <p className="text-[17px] font-semibold text-white mb-1">Simulador Interativo</p>
            <p className="text-[15px] mb-4" style={{ color: '#8b92a8' }}>
              Ajuste os parâmetros e veja o impacto em tempo real nas projeções.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-5">
              <Slider
                label="Horizonte de projeção"
                value={horizonte} min={6} max={120} step={6}
                fmt={v => v < 24 ? `${v} meses` : `${(v / 12).toFixed(0)} anos`}
                onChange={setHorizonte} color="#4da6ff"
              />
              <Slider
                label="Rendimento mensal (investimento)"
                value={rendimento} min={0} max={3} step={0.1}
                fmt={v => `${v.toFixed(1)}% a.m.`}
                onChange={setRendimento} color="#00c896"
              />
              <Slider
                label="Redução de despesas"
                value={reducaoPerc} min={0} max={50} step={5}
                fmt={v => `${v}%`}
                onChange={setReducaoPerc} color="#f0b429"
              />
            </div>

            {/* Resumo dos cenários */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Poupança atual/mês',    v: economiaAtual,    c: '#4da6ff' },
                { label: 'Poupança otimista/mês', v: economiaOtimista, c: '#00c896' },
                { label: `Atual em ${hLabel}`,    v: pvAtual,          c: '#a78bfa' },
                { label: `Otimista em ${hLabel}`, v: pvOtimista,       c: '#f0b429' },
              ].map(s => (
                <div key={s.label} className="rounded-lg px-3 py-2.5"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p className="text-[13px] uppercase tracking-wider mb-1" style={{ color: '#8b92a8' }}>{s.label}</p>
                  <p className="text-[19px] font-bold" style={{ color: s.c }}>{formatBRL(s.v)}</p>
                </div>
              ))}
            </div>
          </div>

          {/* ── Charts ── */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

            {/* Evolução patrimonial */}
            <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-4">
              <p className="text-[17px] font-semibold text-white mb-0.5">Evolução Patrimonial Projetada</p>
              <p className="text-[14px] mb-3" style={{ color: '#8b92a8' }}>
                Juros compostos · {rendimento}% a.m. · economia reinvestida mensalmente
              </p>
              <div className="h-56">
                <Line
                  data={{
                    labels: chartData.labels,
                    datasets: [
                      {
                        label: 'Cenário Atual',
                        data: chartData.atual,
                        borderColor: '#4da6ff',
                        backgroundColor: 'rgba(77,166,255,0.07)',
                        borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
                      },
                      {
                        label: 'Cenário Otimista',
                        data: chartData.otimista,
                        borderColor: '#00c896',
                        backgroundColor: 'rgba(0,200,150,0.07)',
                        borderWidth: 2, pointRadius: 0, tension: 0.4, fill: true,
                      },
                    ],
                  }}
                  options={{
                    responsive: true, maintainAspectRatio: false,
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                      legend: { labels: { color: '#8b92a8', font: { size: 15 }, boxWidth: 10 } },
                      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatBRL(Number(ctx.raw))}` } },
                    },
                    scales: {
                      x: { grid: GRID, ticks: { ...TICKS, maxTicksLimit: 7 } },
                      y: { grid: GRID, ticks: { ...TICKS, callback: v => formatBRL(Number(v)) } },
                    },
                  }}
                />
              </div>
            </div>

            {/* Despesa por categoria + oportunidade */}
            <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-4">
              <p className="text-[17px] font-semibold text-white mb-0.5">Oportunidades por Categoria</p>
              <p className="text-[14px] mb-3" style={{ color: '#8b92a8' }}>
                Gasto médio mensal · verde = economia potencial com -{reducaoPerc}%
              </p>
              <div style={{ height: Math.max(200, categorias.length * 34 + 48) }}>
                <Bar
                  data={{
                    labels: categorias.map(c => c.cat.length > 22 ? c.cat.slice(0, 19) + '…' : c.cat),
                    datasets: [
                      {
                        label: 'Gasto médio/mês',
                        data: categorias.map(c => c.media),
                        backgroundColor: 'rgba(248,113,113,0.55)',
                        borderRadius: 3,
                      },
                      {
                        label: `Economia potencial (-${reducaoPerc}%)`,
                        data: categorias.map(c => c.media * (reducaoPerc / 100)),
                        backgroundColor: 'rgba(0,200,150,0.50)',
                        borderRadius: 3,
                      },
                    ],
                  }}
                  options={{
                    indexAxis: 'y',
                    responsive: true, maintainAspectRatio: false,
                    plugins: {
                      legend: { labels: { color: '#8b92a8', font: { size: 14 }, boxWidth: 10 } },
                      tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatBRL(Number(ctx.raw))}` } },
                    },
                    scales: {
                      x: { grid: GRID, ticks: { ...TICKS, callback: v => formatBRL(Number(v)) } },
                      y: { grid: { display: false }, ticks: { color: '#e8eaf0', font: { size: 15 } } },
                    },
                  }}
                />
              </div>
            </div>
          </div>

          {/* ── Comparativo de cenários ── */}
          <div className="bg-[#1a1f2e] border border-white/10 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-white/10">
              <p className="text-[17px] font-semibold text-white">Comparativo de Cenários</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    {['Cenário', 'Poupança/Mês', 'Poupança Anual', `Patrimônio (${hLabel})`, 'Ganho vs. Atual'].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left border-b border-white/5">
                        <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>{h}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { nome: 'Atual',    ec: economiaAtual,    pv: pvAtual,    ganho: 0,                color: '#4da6ff', bg: '' },
                    { nome: 'Otimista', ec: economiaOtimista, pv: pvOtimista, ganho: pvOtimista - pvAtual, color: '#00c896', bg: 'rgba(0,200,150,0.04)' },
                  ].map(row => (
                    <tr key={row.nome} className="border-b border-white/5" style={{ background: row.bg }}>
                      <td className="px-4 py-3.5">
                        <span className="text-[16px] font-semibold" style={{ color: row.color }}>{row.nome}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-[16px]" style={{ color: '#e8eaf0' }}>{formatBRL(row.ec)}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-[16px]" style={{ color: '#e8eaf0' }}>{formatBRL(row.ec * 12)}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        <span className="text-[17px] font-bold" style={{ color: row.color }}>{formatBRL(row.pv)}</span>
                      </td>
                      <td className="px-4 py-3.5">
                        {row.ganho > 0
                          ? <span className="text-[16px] font-semibold" style={{ color: '#00c896' }}>+{formatBRL(row.ganho)}</span>
                          : <span className="text-[15px]" style={{ color: '#4a5168' }}>—</span>
                        }
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Insights ── */}
          {insights.length > 0 && (
            <div className="bg-[#1a1f2e] border border-white/10 rounded-xl p-4">
              <p className="text-[17px] font-semibold text-white mb-3">Insights Automáticos</p>
              {/* Dica narrada — pose contextual ao cenário projetado */}
              <div className="mb-3">
                <MascoteDica
                  nome={mascote}
                  pose={
                    medias.economia < 0 ? 'espantado'
                    : medias.taxaPoupanca >= 20 ? 'feliz'
                    : medias.economia > 0 ? 'sentado'
                    : 'curioso'
                  }
                  texto={
                    medias.economia < 0
                      ? `Você está gastando mais do que recebe (${formatBRL(Math.abs(medias.economia))}/mês). Sem ajustes, o patrimônio diminui no horizonte de ${hLabel}.`
                    : medias.taxaPoupanca >= 20
                      ? `Excelente disciplina! Com ${medias.taxaPoupanca.toFixed(0)}% de taxa de poupança, em ${hLabel} você acumula ${formatBRL(pvAtual)} com rendimento de ${rendimento}% a.m.`
                    : medias.economia > 0
                      ? `Ritmo de poupança ${medias.taxaPoupanca.toFixed(0)}% — abaixo dos 20% recomendados. Pequenos cortes amplificam muito no horizonte de ${hLabel}.`
                    : 'Ainda não tenho histórico suficiente pra projetar. Continue lançando para uma análise mais rica.'
                  }
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {insights.map((ins, i) => (
                  <div key={i} className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg"
                    style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <span className="text-[19px] leading-none mt-0.5 flex-shrink-0">{ins.icon}</span>
                    <p className="text-[15px] leading-relaxed" style={{ color: '#c8cad8' }}>{ins.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
