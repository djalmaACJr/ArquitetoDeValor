import { useMemo, useState, useEffect, useRef } from 'react'
import {
  TrendingUp, TrendingDown, Wallet, Coins, PieChart, Percent, Trophy,
  HandCoins, BarChart3, Calendar, Upload, RefreshCw, History,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement,
} from 'chart.js'
import { useInvestimentosDashboard, useInvestimentosRanking } from '../hooks/useInvestimentosDashboard'
import { useInvestimentosHistorico, useAtualizarValoresMes, useBackfillHistorico, type ResumoBackfill } from '../hooks/useInvestimentosHistorico'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes } from '../hooks/useInvestimentosPosicoes'
import { useDividendos } from '../hooks/useDividendos'
import { useContas } from '../hooks/useContas'
import { useAuth } from '../hooks/useAuth'
import { useRegistrarContextoIA } from '../context/ContextoIAContext'
import LoadingMascote from '../components/ui/LoadingMascote'
import { SelectDark, Toast } from '../components/ui/shared'
import QuadroTipoAtivos from '../components/ui/QuadroTipoAtivos'
import InvestimentosNav from '../components/ui/InvestimentosNav'
import TutorialTour from '../components/ui/TutorialTour'
import { TUTORIAL_INVESTIMENTOS } from '../lib/tutoriaisPaginas'
import { linhaDeRanking, type AtivoLinha } from '../lib/ativosLinha'
import { formatBRL } from '../lib/utils'
import {
  TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL, TIPO_ATIVO_COR,
} from '../lib/constants'
import type {
  InvestimentoDashboardTipo, InvestimentoRankingAtivo, TipoAtivoInvestimento,
} from '../types'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement)

const MUTED = '#8b92a8'
const VERDE = '#00c896'
const VERMELHO = '#ff5c7a'

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
function fmtMes(anoMes: string): string {
  const [ano, m] = anoMes.split('-')
  return `${MESES_PT[parseInt(m) - 1]}/${ano.slice(2)}`
}
function fmtMesCurto(anoMes: string): string {
  const [ano, m] = anoMes.split('-')
  return `${m}/${ano.slice(2)}`
}

const OPCOES_GRAFICO = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: MUTED }, grid: { color: 'rgba(255,255,255,0.05)' } },
    y: { ticks: { color: MUTED }, grid: { color: 'rgba(255,255,255,0.05)' } },
  },
} as const

function corValor(v: number): string {
  if (v > 0) return VERDE
  if (v < 0) return VERMELHO
  return MUTED
}

function fmtPct(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%`
}

// Valor abreviado para rótulos compactos (eixo do gráfico): 12,3k / 1,2M
function fmtCompacto(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (abs >= 1_000)     return `${(v / 1_000).toFixed(1).replace('.', ',')}k`
  return v.toFixed(0)
}

// Mistura uma cor hex com branco para um tom pastel mais suave (mix=0..1)
function suavizar(hex: string, mix = 0.35): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const m = (c: number) => Math.round(c + (255 - c) * mix)
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`
}

// ── Cards superiores (estilo corretora) ───────────────────────

function SetaVariacao({ v, size = 12 }: { v: number; size?: number }) {
  return v >= 0 ? <TrendingUp size={size} /> : <TrendingDown size={size} />
}

function CardsResumo({ d, proventos12m }: {
  d: { total_custo: number; total_mercado: number; ganho_perda: number; total_dividendos: number }
  proventos12m: number
}) {
  const variacaoPct     = d.total_custo > 0 ? (d.ganho_perda / d.total_custo) * 100 : 0
  const lucroTotal      = d.ganho_perda + d.total_dividendos
  const rentabilidadePct = d.total_custo > 0 ? (lucroTotal / d.total_custo) * 100 : 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
      {/* Patrimônio total */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 text-[13px] text-white font-medium">
          <Wallet size={15} style={{ color: MUTED }} /> Patrimônio total
        </div>
        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
          <p className="text-[20px] font-bold text-white">{formatBRL(d.total_mercado)}</p>
          <span className="inline-flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-full font-medium"
            style={{ background: `${corValor(variacaoPct)}22`, color: corValor(variacaoPct) }}>
            {fmtPct(variacaoPct)} <SetaVariacao v={variacaoPct} size={11} />
          </span>
        </div>
        <p className="text-[12px] mt-2" style={{ color: MUTED }}>Valor investido</p>
        <p className="text-[13px] font-medium text-white/80">{formatBRL(d.total_custo)}</p>
      </div>

      {/* Lucro total */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 text-[13px] text-white font-medium">
          <HandCoins size={15} style={{ color: MUTED }} /> Lucro total
        </div>
        <p className="text-[20px] font-bold mt-1.5" style={{ color: corValor(lucroTotal) }}>
          {formatBRL(lucroTotal)}
        </p>
        <div className="flex gap-5 mt-2">
          <div>
            <p className="text-[12px]" style={{ color: MUTED }}>Ganho de Capital</p>
            <p className="text-[13px] font-medium text-white/80">{formatBRL(d.ganho_perda)}</p>
          </div>
          <div>
            <p className="text-[12px]" style={{ color: MUTED }}>Dividendos Recebidos</p>
            <p className="text-[13px] font-medium text-white/80">{formatBRL(d.total_dividendos)}</p>
          </div>
        </div>
      </div>

      {/* Proventos recebidos 12M */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="flex items-center gap-2 text-[13px] text-white font-medium">
          <Coins size={15} style={{ color: MUTED }} /> Proventos Recebidos (12M)
        </div>
        <p className="text-[20px] font-bold text-white mt-1.5">{formatBRL(proventos12m)}</p>
        <p className="text-[12px] mt-2" style={{ color: MUTED }}>Total</p>
        <p className="text-[13px] font-medium text-white/80">{formatBRL(d.total_dividendos)}</p>
      </div>

      {/* Variação + Rentabilidade */}
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
        <div className="grid grid-cols-2 gap-3 h-full">
          <div>
            <div className="flex items-center gap-2 text-[13px] text-white font-medium">
              <BarChart3 size={15} style={{ color: MUTED }} /> Variação
            </div>
            <p className="text-[18px] font-bold mt-1.5 inline-flex items-center gap-1" style={{ color: corValor(variacaoPct) }}>
              {fmtPct(variacaoPct)} <SetaVariacao v={variacaoPct} />
            </p>
            <p className="text-[13px] font-medium text-white/80 mt-1">{formatBRL(d.ganho_perda)}</p>
          </div>
          <div>
            <div className="flex items-center gap-2 text-[13px] text-white font-medium">
              <Percent size={15} style={{ color: MUTED }} /> Rentabilidade
            </div>
            <p className="text-[18px] font-bold mt-1.5 inline-flex items-center gap-1" style={{ color: corValor(rentabilidadePct) }}>
              {fmtPct(rentabilidadePct)} <SetaVariacao v={rentabilidadePct} />
            </p>
            <p className="text-[12px] mt-1" style={{ color: MUTED }}>capital + proventos</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Evolução do Patrimônio (barras empilhadas) ────────────────

const PERIODOS = [
  { value: '6',  label: '6 Meses' },
  { value: '12', label: '12 Meses' },
  { value: '24', label: '24 Meses' },
]

// Plugin: desenha abaixo de cada coluna os valores de cada série (aplicado /
// ganho / proventos) nas cores do gráfico — funciona como legenda no eixo X.
// Números alinhados à direita da coluna (mais fácil de comparar entre meses)
// e uma linha de total (soma das séries) ao final, em destaque.
const valoresEixoX = {
  id: 'valoresEixoX',
  afterDatasetsDraw(chart: ChartJS) {
    const x = chart.scales.x
    if (!x) return
    const { ctx } = chart
    const labels = chart.data.labels as string[]
    const larguraCategoria = x.width / labels.length
    ctx.save()
    ctx.textAlign = 'right'
    const baseY = x.bottom + 18
    labels.forEach((_, i) => {
      const rightEdge = Math.round(x.getPixelForTick(i) + larguraCategoria / 2 - 4)
      let total = 0
      chart.data.datasets.forEach((ds, di) => {
        const v = Number(ds.data[i])
        total += v
        ctx.font = '600 11px system-ui, sans-serif'
        ctx.fillStyle = ds.backgroundColor as string
        ctx.fillText(fmtCompacto(v), rightEdge, baseY + di * 14)
      })
      ctx.font = '700 11px system-ui, sans-serif'
      ctx.fillStyle = '#fff'
      ctx.fillText(fmtCompacto(total), rightEdge, baseY + chart.data.datasets.length * 14 + 4)
    })
    ctx.restore()
  },
}

function EvolucaoPatrimonio({ contaId, dividendos }: {
  contaId: string | null
  dividendos: { conta_id: string; tipo_ativo: TipoAtivoInvestimento; data_pagamento: string; valor: number }[]
}) {
  const [periodo, setPeriodo] = useState('12')
  const [tipo, setTipo] = useState<TipoAtivoInvestimento | ''>('')
  const { historico } = useInvestimentosHistorico(contaId ? { conta_id: contaId } : {})

  // Por mês: valor aplicado (qtd × preço médio) e ganho de capital (mercado − aplicado)
  const meses = useMemo(() => {
    const porMes = new Map<string, { aplicado: number; mercado: number }>()
    for (const h of historico) {
      if (tipo && h.inv_ativos?.tipo_ativo !== tipo) continue
      const m = porMes.get(h.mes_ano) ?? { aplicado: 0, mercado: 0 }
      m.aplicado += Number(h.quantidade) * Number(h.preco_medio)
      m.mercado  += Number(h.valor_mercado)
      porMes.set(h.mes_ano, m)
    }
    return [...porMes.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-Number(periodo))
  }, [historico, tipo, periodo])

  // Proventos recebidos por mês (respeita os filtros de conta e tipo)
  const provPorMes = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of dividendos) {
      if (contaId && d.conta_id !== contaId) continue
      if (tipo && d.tipo_ativo !== tipo) continue
      const mes = d.data_pagamento.slice(0, 7)
      m.set(mes, (m.get(mes) ?? 0) + Number(d.valor))
    }
    return m
  }, [dividendos, contaId, tipo])

  // Total exibido na legenda = soma das 3 séries do mês mais recente
  // (aplicado + ganho + proventos), ou seja, a altura da última barra.
  const legendaTotal = useMemo(() => {
    if (meses.length === 0) return 0
    const [mes, v] = meses[meses.length - 1]
    return v.mercado + (provPorMes.get(mes) ?? 0)
  }, [meses, provPorMes])

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 lg:col-span-2">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-[15px] font-semibold text-white">Evolução do Patrimônio</h2>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2">
            <Calendar size={13} style={{ color: MUTED }} />
            <SelectDark value={periodo} onChange={(e) => setPeriodo(e.target.value)}
              style={{ width: 'auto', border: 'none', background: 'transparent' }} className="!text-[13px] !py-2">
              {PERIODOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </SelectDark>
          </div>
          <SelectDark value={tipo} onChange={(e) => setTipo(e.target.value as TipoAtivoInvestimento | '')}
            style={{ width: 'auto' }} className="!text-[13px] !py-2">
            <option value="">Todos os tipos</option>
            {TIPOS_ATIVO_INV.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
          </SelectDark>
        </div>
      </div>

      {meses.length < 2 ? (
        <p className="text-[13px] py-10 text-center" style={{ color: MUTED }}>
          Registre o valor de mercado mensal dos seus ativos (em Meus ativos) para acompanhar a evolução.
        </p>
      ) : (
        <Bar
          plugins={[valoresEixoX]}
          data={{
            labels: meses.map(([mes]) => fmtMesCurto(mes)),
            datasets: [
              {
                label: 'Valor aplicado',
                data: meses.map(([, v]) => Number(v.aplicado.toFixed(2))),
                backgroundColor: '#10a37f',
                borderRadius: 4,
                stack: 'patrimonio',
              },
              {
                label: 'Ganho de Capital',
                data: meses.map(([, v]) => Number((v.mercado - v.aplicado).toFixed(2))),
                backgroundColor: '#7be3c3',
                borderRadius: 4,
                stack: 'patrimonio',
              },
              {
                label: 'Proventos',
                data: meses.map(([mes]) => Number((provPorMes.get(mes) ?? 0).toFixed(2))),
                backgroundColor: '#e8b84b',
                borderRadius: 4,
                stack: 'patrimonio',
              },
            ],
          }}
          options={{
            ...OPCOES_GRAFICO,
            layout: { padding: { bottom: 78 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
              legend: {
                display: true, position: 'top',
                labels: {
                  color: MUTED, boxWidth: 12, font: { size: 11 },
                  // Acrescenta um item "Total" (soma das 3 séries do mês atual).
                  generateLabels: (chart) => {
                    const base = ChartJS.defaults.plugins.legend.labels.generateLabels(chart)
                    base.push({
                      text: `Total: ${formatBRL(legendaTotal)}`,
                      fillStyle: 'transparent', strokeStyle: 'transparent', lineWidth: 0,
                      fontColor: '#fff', hidden: false,
                    } as never)
                    return base
                  },
                },
                // Mantém o toggle padrão só nos itens de série (o "Total" não tem índice).
                onClick: (_e, item, legend) => {
                  if (typeof item.datasetIndex !== 'number') return
                  const ci = legend.chart
                  if (ci.isDatasetVisible(item.datasetIndex)) ci.hide(item.datasetIndex)
                  else ci.show(item.datasetIndex)
                },
              },
              tooltip: {
                mode: 'index', intersect: false,
                bodyFont: { family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
                footerFont: { family: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', weight: 'normal' },
                callbacks: {
                  // Rótulo à esquerda, valor à direita — colunas alinhadas via
                  // padding em fonte monoespaçada (label:valor de cada linha
                  // tem o mesmo comprimento total).
                  label: (ctx) => {
                    const ds = ctx.chart.data.datasets
                    const rotulos = ds.map((d) => String(d.label))
                    const valores = ds.map((_, i) => formatBRL(Number(ds[i].data[ctx.dataIndex])))
                    const maxRotulo = Math.max(...rotulos.map((r) => r.length))
                    const maxValor = Math.max(...valores.map((v) => v.length))
                    return `${String(ctx.dataset.label).padEnd(maxRotulo)}: ${formatBRL(Number(ctx.parsed.y)).padStart(maxValor)}`
                  },
                  footer: (items) => {
                    const maxRotulo = Math.max('Total'.length, ...items.map((it) => String(it.dataset.label).length))
                    const valores = items.map((it) => formatBRL(Number(it.parsed.y)))
                    const maxValor = Math.max(...valores.map((v) => v.length))
                    const total = items.reduce((s, it) => s + Number(it.parsed.y), 0)
                    const largura = maxRotulo + 2 + maxValor
                    return ['='.repeat(largura), `${'Total'.padEnd(maxRotulo)}: ${formatBRL(total).padStart(maxValor)}`]
                  },
                },
              },
            },
            scales: {
              x: { stacked: true, ticks: { color: MUTED }, grid: { color: 'rgba(255,255,255,0.05)' } },
              y: { stacked: true, ticks: { color: MUTED }, grid: { color: 'rgba(255,255,255,0.05)' } },
            },
          }}
        />
      )}
    </section>
  )
}

// ── Ativos na Carteira (doughnut + legenda %) ─────────────────

function AtivosNaCarteira({ tipos, onSelecionarTipo }: {
  tipos: InvestimentoDashboardTipo[]
  onSelecionarTipo: (tipo: TipoAtivoInvestimento) => void
}) {
  const ordenados = [...tipos].sort((a, b) => b.percentual_atual - a.percentual_atual)
  const total = ordenados.reduce((s, t) => s + t.valor_mercado, 0)
  const cores = ordenados.map((t) => suavizar(TIPO_ATIVO_COR[t.tipo_ativo]))

  // Rótulos (nome + %) dentro de cada fatia grande o suficiente + total no centro.
  const rotulosInternos = useMemo(() => ({
    id: 'rotulosInternos',
    afterDatasetsDraw(chart: ChartJS) {
      const { ctx } = chart
      const meta = chart.getDatasetMeta(0)
      const dataset = chart.data.datasets[0]
      const soma = (dataset.data as number[]).reduce((s, v) => s + Number(v), 0)
      ctx.save()
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      meta.data.forEach((arc, i) => {
        const pct = soma > 0 ? (Number(dataset.data[i]) / soma) * 100 : 0
        if (pct < 5) return // fatia muito pequena: identifica só no tooltip
        const pos = (arc as unknown as { tooltipPosition: () => { x: number; y: number } }).tooltipPosition()
        ctx.fillStyle = '#0e1525'
        ctx.font = '600 10px system-ui, sans-serif'
        ctx.fillText(TIPO_ATIVO_LABEL[ordenados[i].tipo_ativo], pos.x, pos.y - 6)
        ctx.font = '700 12px system-ui, sans-serif'
        ctx.fillText(`${pct.toFixed(1).replace('.', ',')}%`, pos.x, pos.y + 8)
      })
      // total no buraco central
      const arc0 = meta.data[0] as unknown as { x: number; y: number } | undefined
      if (arc0) {
        ctx.fillStyle = MUTED
        ctx.font = '500 11px system-ui, sans-serif'
        ctx.fillText('Patrimônio', arc0.x, arc0.y - 11)
        ctx.fillStyle = '#fff'
        ctx.font = '700 16px system-ui, sans-serif'
        ctx.fillText(formatBRL(soma), arc0.x, arc0.y + 9)
      }
      ctx.restore()
    },
  }), [ordenados])

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col">
      <h2 className="text-[15px] font-semibold text-white mb-3">Ativos na Carteira</h2>
      {/* Rosca em destaque: rótulos (nome + %) dentro das fatias e total no
          centro. Fatias muito pequenas aparecem só no tooltip. */}
      <div className="flex-1 min-h-[360px] flex items-center justify-center">
        <Doughnut
          plugins={[rotulosInternos]}
          data={{
            labels: ordenados.map((t) => TIPO_ATIVO_LABEL[t.tipo_ativo]),
            datasets: [{
              data: ordenados.map((t) => t.valor_mercado),
              backgroundColor: cores,
              borderColor: 'rgba(14,21,37,0.55)',
              borderWidth: 2,
              borderRadius: 8,
              hoverOffset: 6,
            }],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            onClick: (_evt, elements) => {
              if (elements.length > 0) onSelecionarTipo(ordenados[elements[0].index].tipo_ativo)
            },
            onHover: (evt, elements) => {
              const alvo = evt.native?.target as HTMLElement | null
              if (alvo) alvo.style.cursor = elements.length ? 'pointer' : 'default'
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const pct = total > 0 ? (Number(ctx.parsed) / total) * 100 : 0
                    return ` ${formatBRL(Number(ctx.parsed))} · ${pct.toFixed(1).replace('.', ',')}%`
                  },
                },
              },
            },
          }}
        />
      </div>
    </section>
  )
}

// ── Destaques da carteira (ranking por ativo) ─────────────────

function CardRanking({ titulo, icone, itens, metrica }: {
  titulo: string; icone: React.ReactNode; itens: InvestimentoRankingAtivo[]
  metrica: (a: InvestimentoRankingAtivo) => { texto: string; cor: string }
}) {
  if (itens.length === 0) return null
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-[13px] mb-2.5" style={{ color: MUTED }}>
        {icone}{titulo}
      </div>
      <div className="space-y-2">
        {itens.map((a) => {
          const m = metrica(a)
          return (
            <div key={a.ativo_id} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[a.tipo_ativo] }} />
                <span className="text-white text-[13px] font-semibold">{a.ticker}</span>
                <span className="text-[12px] truncate" style={{ color: MUTED }}>{a.nome}</span>
              </div>
              <span className="text-[13px] font-medium shrink-0" style={{ color: m.cor }}>{m.texto}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SecaoRanking({ ativos }: { ativos: InvestimentoRankingAtivo[] }) {
  if (ativos.length === 0) return null

  const emAlta     = ativos.filter((a) => a.rentabilidade_pct > 0).slice(0, 3)
  const emBaixa    = ativos.filter((a) => a.rentabilidade_pct < 0).sort((x, y) => x.rentabilidade_pct - y.rentabilidade_pct).slice(0, 3)
  const maiorYield = [...ativos].filter((a) => a.dividend_yield_pct > 0).sort((x, y) => y.dividend_yield_pct - x.dividend_yield_pct).slice(0, 3)
  const maiorPeso  = [...ativos].sort((x, y) => y.participacao_pct - x.participacao_pct).slice(0, 3)

  return (
    <>
      <h2 className="text-[15px] font-semibold text-white mt-6 mb-3">Destaques da carteira</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <CardRanking titulo="Em alta" icone={<TrendingUp size={14} />} itens={emAlta}
          metrica={(a) => ({ texto: `+${a.rentabilidade_pct}%`, cor: VERDE })} />
        <CardRanking titulo="Em prejuízo" icone={<TrendingDown size={14} />} itens={emBaixa}
          metrica={(a) => ({ texto: `${a.rentabilidade_pct}%`, cor: VERMELHO })} />
        <CardRanking titulo="Maior dividend yield (12m)" icone={<Percent size={14} />} itens={maiorYield}
          metrica={(a) => ({ texto: `${a.dividend_yield_pct}%`, cor: VERDE })} />
        <CardRanking titulo="Maior participação" icone={<Trophy size={14} />} itens={maiorPeso}
          metrica={(a) => ({ texto: `${a.participacao_pct}%`, cor: '#fff' })} />
      </div>
    </>
  )
}

// ── Dividendos por mês (barras) ───────────────────────────────

function DividendosPorMes({ dividendos }: { dividendos: { data_pagamento: string; valor: number }[] }) {
  const divPorMes = useMemo(() => {
    const porMes = new Map<string, number>()
    for (const d of dividendos) {
      const mes = d.data_pagamento.slice(0, 7)
      porMes.set(mes, (porMes.get(mes) ?? 0) + Number(d.valor))
    }
    return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)
  }, [dividendos])

  if (divPorMes.length === 0) return null
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mt-6" data-tutorial="investimentos-dividendos">
      <h2 className="text-[15px] font-semibold text-white mb-3">Dividendos por mês</h2>
      <Bar
        data={{
          labels: divPorMes.map(([mes]) => fmtMes(mes)),
          datasets: [{
            label: 'Dividendos',
            data: divPorMes.map(([, v]) => v),
            backgroundColor: `${VERDE}aa`,
            borderRadius: 4,
          }],
        }}
        options={{ ...OPCOES_GRAFICO, maintainAspectRatio: true, aspectRatio: 4 }}
      />
    </section>
  )
}

// ── Página ────────────────────────────────────────────────────

export default function InvestimentosPage() {
  const [contaId, setContaId] = useState<string>('')
  // Sinal de foco disparado ao clicar numa fatia do gráfico "Ativos na Carteira"
  const [foco, setFoco] = useState<{ tipo: TipoAtivoInvestimento; n: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const showToast = (m: string) => { setToast(m); setTimeout(() => setToast(null), 3000) }
  const { dashboard, loading, error } = useInvestimentosDashboard(contaId || null)
  const { ranking } = useInvestimentosRanking(contaId || null)
  const { dividendos } = useDividendos()
  const { contas } = useContas()
  const { ativos: ativosMeta } = useInvestimentosAtivos()
  const { session } = useAuth()
  const uid = session?.user?.id ?? null
  // Só contas de investimento ATIVAS são relevantes na carteira
  const contasInvest = contas.filter((c) => c.tipo === 'INVESTIMENTO' && c.ativa)

  // Captura automática (B) + botão "Atualizar valores" (C) do mês corrente
  const mesAtual = new Date().toISOString().slice(0, 7)
  const { atualizar, executando } = useAtualizarValoresMes()
  const { historico: histMes, loading: histMesLoading } = useInvestimentosHistorico({ mes_ano: mesAtual })
  const autoDisparado = useRef(false)

  const atualizarValores = async (silencioso = false) => {
    const res = await atualizar(mesAtual)
    if (!res.ok) { if (!silencioso) showToast(res.erro ?? 'Erro ao atualizar valores'); return }
    const d = res.dados
    const ign = d?.ignorados.length ?? 0
    showToast(
      `Valores do mês ${silencioso ? 'registrados automaticamente' : 'atualizados'}: ${d?.atualizados ?? 0} ativo(s)`
      + (ign ? ` · ${ign} sem cotação` : ''),
    )
  }

  // (Passo 2) Preenche o histórico de meses passados dos itens antigos.
  // O botão só aparece quando há LACUNA real AINDA NÃO TENTADA. Lacuna =
  // buraco INTERNO (mês faltando ENTRE o primeiro e o último snapshot do
  // ativo). Meses antes do 1º snapshot (pré-IPO / fora do alcance da fonte)
  // não contam, e furos que o backfill já tentou e não conseguiu também não.
  const { preencherTodos, executando: preenchendo } = useBackfillHistorico()
  const [resultadoBackfill, setResultadoBackfill] = useState<ResumoBackfill | null>(null)
  const { posicoes: todasPosicoes } = useInvestimentosPosicoes({})
  const { historico: todoHistorico } = useInvestimentosHistorico({})

  const lacunas = useMemo(() => {
    // ativos que optaram por não buscar cotação automática saem do aviso
    const semCotacao = new Set(ativosMeta.filter((a) => a.cotacao_automatica === false).map((a) => a.id))
    // Lacuna = mês sem snapshot dentro de uma JANELA fillável: dos últimos ~12
    // meses (limite da fonte mais restrita — CoinGecko free vai a 365 dias) até
    // o mês anterior ao corrente (o mês atual é tarefa do "Atualizar cotação").
    // Não usar meses anteriores a isso evita "nagar" por períodos que a fonte
    // não tem (o que dava lista gigante e "0 preenchidos"). O início real é o
    // maior entre a data da compra e a janela.
    const mesRel = (off: number) => {
      const d = new Date()
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + off, 1)).toISOString().slice(0, 7)
    }
    const fim = mesRel(-1)
    const janela = mesRel(-12)

    const inicioPorChave = new Map<string, string>()  // chave → mês da 1ª compra
    const tickerPorAtivo = new Map<string, string>()
    for (const p of todasPosicoes) {
      if (p.status !== 'ATIVA' || semCotacao.has(p.ativo_id)) continue
      const mes = (p.data_compra ?? '').slice(0, 7)
      if (!mes) continue
      const key = `${p.ativo_id}|${p.conta_id}`
      const cur = inicioPorChave.get(key)
      if (!cur || mes < cur) inicioPorChave.set(key, mes)
      if (p.inv_ativos?.ticker) tickerPorAtivo.set(p.ativo_id, p.inv_ativos.ticker)
    }
    const presentesPorChave = new Map<string, Set<string>>()
    for (const h of todoHistorico) {
      if (h.inv_ativos?.ticker) tickerPorAtivo.set(h.ativo_id, h.inv_ativos.ticker)
      const key = `${h.ativo_id}|${h.conta_id}`
      if (!inicioPorChave.has(key)) continue
      if (!presentesPorChave.has(key)) presentesPorChave.set(key, new Set())
      presentesPorChave.get(key)!.add(h.mes_ano)
    }
    const keys = new Set<string>()
    const tickers = new Set<string>()
    for (const [key, inicio] of inicioPorChave) {
      const ativoId = key.split('|')[0]
      const presentes = presentesPorChave.get(key) ?? new Set<string>()
      // início = máximo(compra, janela de 12 meses); fim = mês anterior
      const ini = inicio > janela ? inicio : janela
      if (ini > fim) continue
      let [y, mo] = ini.split('-').map(Number)
      const [yf, mf] = fim.split('-').map(Number)
      let guard = 0
      while ((y < yf || (y === yf && mo <= mf)) && guard++ < 600) {
        const me = `${y}-${String(mo).padStart(2, '0')}`
        if (!presentes.has(me)) { keys.add(`${ativoId}|${me}`); tickers.add(tickerPorAtivo.get(ativoId) ?? ativoId) }
        mo++; if (mo > 12) { mo = 1; y++ }
      }
    }
    return { keys, tickers: [...tickers] }
  }, [todasPosicoes, todoHistorico, ativosMeta])

  // Furos que o backfill já tentou NESTA SESSÃO e não conseguiu preencher —
  // evita o loop do botão sem persistir. Assim, após um deploy/correção que
  // torne o período disponível, o botão reaparece no próximo carregamento.
  const [tentadas, setTentadas] = useState<Set<string>>(new Set())

  const lacunasNovas = useMemo(() => [...lacunas.keys].filter((k) => !tentadas.has(k)), [lacunas, tentadas])
  const mostrarPreencher = lacunasNovas.length > 0

  const preencherHistorico = async () => {
    setResultadoBackfill(null)
    const res = await preencherTodos()
    if (!res.ok) { showToast(res.erro ?? 'Erro ao preencher histórico'); return }
    setResultadoBackfill(res.dados ?? null)
    // marca os furos atuais como já tentados: os preenchidos deixam de ser
    // furo; os que sobrarem (fonte não tem) não reexibem o botão nesta sessão
    setTentadas(new Set([...tentadas, ...lacunas.keys]))
  }

  // (B) Ao abrir: se o mês corrente ainda não tem snapshot, captura uma vez.
  // Trava por sessão+mês para não repetir a cada navegação.
  useEffect(() => {
    if (loading || histMesLoading || autoDisparado.current) return
    if (!dashboard || dashboard.tipos.length === 0) return
    if (histMes.length > 0) return
    const flag = `snapauto:${uid ?? 'anon'}:${mesAtual}`
    if (sessionStorage.getItem(flag)) return
    autoDisparado.current = true
    sessionStorage.setItem(flag, '1')
    void atualizarValores(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, histMesLoading, dashboard, histMes.length, uid])

  // Metadado (logo, setor, categoria) por ativo — junta-se ao ranking no quadro
  const metaPorAtivo = useMemo(() => new Map(ativosMeta.map((a) => [a.id, a])), [ativosMeta])

  // Contas (de investimento) onde cada ativo tem posição ATIVA
  const contasPorAtivo = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of todasPosicoes) {
      if (p.status !== 'ATIVA') continue
      const nome = p.contas?.nome
      if (!nome) continue
      const lista = m.get(p.ativo_id) ?? []
      if (!lista.includes(nome)) lista.push(nome)
      m.set(p.ativo_id, lista)
    }
    return m
  }, [todasPosicoes])

  // Linhas unificadas por tipo de ativo (ranking + metadado)
  const linhasPorTipo = useMemo(() => {
    const m = new Map<TipoAtivoInvestimento, AtivoLinha[]>()
    for (const a of ranking?.ativos ?? []) {
      const lista = m.get(a.tipo_ativo) ?? []
      lista.push(linhaDeRanking(a, metaPorAtivo.get(a.ativo_id), contasPorAtivo.get(a.ativo_id) ?? []))
      m.set(a.tipo_ativo, lista)
    }
    return m
  }, [ranking, metaPorAtivo, contasPorAtivo])

  // Proventos RECEBIDOS nos últimos 12 meses — exclui projeções futuras
  // (transação PROJECAO), senão o card somava proventos ainda não pagos e
  // ficava maior que o total real do extrato (mesmo bug do "Recebidos" vs
  // "Provisionado" já tratado em DividendosPage/ehProvisionado).
  const proventos12m = useMemo(() => {
    const corte = new Date()
    corte.setMonth(corte.getMonth() - 12)
    const corteISO = corte.toISOString().split('T')[0]
    return dividendos
      .filter((d) => d.data_pagamento >= corteISO && d.transacoes?.status !== 'PROJECAO')
      .reduce((s, d) => s + Number(d.valor), 0)
  }, [dividendos])

  // ── Snapshot pra IA ───────────────────────────────────────────────────────
  useRegistrarContextoIA(useMemo(() => {
    const tiposD = dashboard?.tipos ?? []
    if (loading || tiposD.length === 0) return null
    return {
      titulo:    'Investimentos · Painel',
      descricao: 'Resumo consolidado da carteira por tipo de ativo',
      dados: {
        conta_filtro:               contaId || 'todas',
        total_investido:            dashboard?.total_custo ?? 0,
        total_mercado:              dashboard?.total_mercado ?? 0,
        ganho_capital:              dashboard?.ganho_perda ?? 0,
        dividendos_totais:          dashboard?.total_dividendos ?? 0,
        proventos_ultimos_12_meses: proventos12m,
        composicao_por_tipo: tiposD.map((t) => ({
          tipo: t.tipo_ativo, valor_mercado: t.valor_mercado, percentual: t.percentual_atual,
        })),
        destaques: (ranking?.ativos ?? []).slice(0, 15).map((a) => ({
          ticker: a.ticker, tipo: a.tipo_ativo, rentabilidade_pct: a.rentabilidade_pct,
          dividend_yield_pct: a.dividend_yield_pct, participacao_pct: a.participacao_pct,
        })),
      },
    }
  }, [loading, dashboard, ranking, proventos12m, contaId]))

  if (loading) return <LoadingMascote />

  const tipos = dashboard?.tipos ?? []
  const ativosRanking = ranking?.ativos ?? []
  const vazio = tipos.length === 0

  return (
    <div className="p-5">
      <InvestimentosNav />
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white">Investimentos</h1>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
            Visão consolidada da carteira por tipo de ativo
          </p>
        </div>
        <div className="flex items-center gap-2" data-tutorial="investimentos-header">
          <SelectDark
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            style={{ width: 'auto' }}
            className="!text-[13px] !py-2"
          >
            <option value="">Todas as contas</option>
            {contasInvest.map((c) => (
              <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>
            ))}
          </SelectDark>
          <button onClick={() => atualizarValores(false)} disabled={executando}
            title="Busca a cotação atual de cada ativo e grava o valor de mercado do mês"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10
              text-[13px] text-white transition-all hover:border-white/25 disabled:opacity-50">
            <RefreshCw size={15} className={executando ? 'animate-spin' : ''} />
            {executando ? 'Atualizando…' : 'Atualizar cotação'}
          </button>
          {mostrarPreencher && (
            <button onClick={preencherHistorico} disabled={preenchendo}
              title={`Há meses faltando no histórico de: ${lacunas.tickers.join(', ')}`}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] text-white transition-all disabled:opacity-50"
              style={{ borderColor: 'rgba(240,180,41,0.5)', color: '#f0b429' }}>
              <History size={15} className={preenchendo ? 'animate-spin' : ''} />
              {preenchendo ? 'Preenchendo…' : 'Preencher histórico'}
            </button>
          )}
          <Link to="/importexport?import=investimentos"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10
              text-[13px] text-white transition-all hover:border-white/25">
            <Upload size={15} /> Importar
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] text-red-300">
          {error}
        </div>
      )}

      {resultadoBackfill && (() => {
        const r = resultadoBackfill
        const ok = r.ignorados.length === 0 && lacunas.keys.size === 0
        return (
          <div className="mb-4 rounded-lg border px-4 py-3 text-[13px] flex items-start justify-between gap-3"
            style={ok
              ? { borderColor: 'rgba(0,200,150,0.4)', background: 'rgba(0,200,150,0.08)', color: '#7be3c3' }
              : { borderColor: 'rgba(240,180,41,0.45)', background: 'rgba(240,180,41,0.08)', color: '#f0b429' }}>
            <div className="min-w-0">
              <p className="font-medium">
                {ok ? '✅ ' : ''}Histórico preenchido: {r.meses_gravados} mês(es) em {r.ativos_processados} ativo(s).
              </p>
              {r.ignorados.length > 0 && (
                <>
                  <p className="mt-1">Ainda sem série histórica (não consegui cotação):</p>
                  <ul className="mt-0.5 list-disc list-inside">
                    {r.ignorados.map((i) => <li key={i.ticker}>{i.ticker} — {i.motivo}</li>)}
                  </ul>
                </>
              )}
              {r.ignorados.length === 0 && lacunas.keys.size > 0 && (
                <p className="mt-1">
                  Ainda há meses faltando em: <span className="font-medium">{lacunas.tickers.join(', ')}</span>
                  {' '}— alguns períodos podem não estar disponíveis na fonte.
                </p>
              )}
              {ok && <p className="mt-0.5 opacity-80">Tudo certo, sem pendências.</p>}
              {Array.isArray(r.diagnostico) && r.diagnostico.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer opacity-80">Diagnóstico (por que faltou)</summary>
                  <pre className="mt-1 text-[11px] whitespace-pre-wrap opacity-90" style={{ color: '#c5cad8' }}>
                    {JSON.stringify(r.diagnostico, null, 2)}
                  </pre>
                </details>
              )}
            </div>
            <button onClick={() => setResultadoBackfill(null)} className="shrink-0 opacity-70 hover:opacity-100" title="Fechar">✕</button>
          </div>
        )
      })()}

      {vazio ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
          <PieChart size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
          <p className="text-white font-medium">Sua carteira está vazia</p>
          <p className="text-[13px] mt-1" style={{ color: MUTED }}>
            Cadastre ativos e posições manualmente — ou <strong className="text-white">importe seus investimentos</strong> pelo
            módulo de Importações usando os relatórios da B3 (posição e movimentação) ou a carteira do Status Invest.
          </p>
          <div className="flex items-center justify-center gap-2 mt-4 flex-wrap">
            <Link to="/investimentos/ativos"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-white"
              style={{ background: '#3b82f6' }}>
              <Wallet size={15} /> Cadastrar ativos
            </Link>
            <Link to="/importexport?import=investimentos"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-medium text-white border border-white/15 hover:border-white/30 transition-all">
              <Upload size={15} /> Importar investimentos
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* Cards superiores */}
          <div data-tutorial="investimentos-cards">
            <CardsResumo
              d={{
                total_custo:      dashboard?.total_custo ?? 0,
                total_mercado:    dashboard?.total_mercado ?? 0,
                ganho_perda:      dashboard?.ganho_perda ?? 0,
                total_dividendos: dashboard?.total_dividendos ?? 0,
              }}
              proventos12m={proventos12m}
            />
          </div>

          {/* Evolução + composição */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5" data-tutorial="investimentos-evolucao">
            <EvolucaoPatrimonio contaId={contaId || null} dividendos={dividendos} />
            <AtivosNaCarteira tipos={tipos}
              onSelecionarTipo={(tipo) => setFoco((f) => ({ tipo, n: (f?.n ?? 0) + 1 }))} />
          </div>

          {/* Lista expansível por tipo */}
          <div className="space-y-2" data-tutorial="investimentos-lista">
            {tipos.map((t) => (
              <QuadroTipoAtivos key={t.tipo_ativo} tipo={t.tipo_ativo} dados={t}
                linhas={linhasPorTipo.get(t.tipo_ativo) ?? []}
                focoSinal={foco?.tipo === t.tipo_ativo ? foco.n : null} />
            ))}
          </div>

          <div data-tutorial="investimentos-destaques">
            <SecaoRanking ativos={ativosRanking} />
          </div>

          <DividendosPorMes dividendos={dividendos} />
        </>
      )}

      <Toast msg={toast} />

      <TutorialTour pageKey="investimentos-v1" passos={TUTORIAL_INVESTIMENTOS} />
    </div>
  )
}
