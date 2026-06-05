import { useState, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Pencil, Trash2, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react'
import { Doughnut, Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, PointElement, LineElement, Filler,
  BarElement, type ChartDataset,
} from 'chart.js'
import { useObjetivoDetalhe, useObjetivos } from '../hooks/useObjetivos'
import { useContas } from '../hooks/useContas'
import { useCategorias } from '../hooks/useCategorias'
import { DrawerObjetivo } from '../components/ui/DrawerObjetivo'
import { ModalExcluir, Toast } from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import { apiFetch } from '../lib/api'
import { useAuth } from '../hooks/useAuth'
import { formatBRL, formatData } from '../lib/utils'
import type { Objetivo, Transacao } from '../types'
import type { EditarObjetivoInput } from '../hooks/useObjetivos'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement)

// ── Helpers ───────────────────────────────────────────────────

const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

function fmtMes(anoMes: string): string {
  const [ano, m] = anoMes.split('-')
  return `${MESES_PT[parseInt(m) - 1]}/${ano.slice(2)}`
}

function extrairAtivo(descricao: string): string {
  return descricao.trim().split(/[\s\-\/]/)[0].toUpperCase().slice(0, 12) || descricao.slice(0, 12)
}

const PALETTE = [
  '#4da6ff','#00c896','#f0b429','#7F77DD',
  '#ff6b4a','#e91e8c','#00d2d3','#a29bfe',
  '#fdcb6e','#55efc4','#636e72','#b2bec3',
]

// ── Seção: Histórico de progresso (snapshots) ────────────────

function HistoricoProgresso({
  snapshots,
  valorMeta,
  cor,
}: {
  snapshots: { data_snapshot: string; valor_atingido: number; percentual: number }[]
  valorMeta: number
  cor: string
}) {
  if (snapshots.length < 2) return null

  const labels  = snapshots.map(s => formatData(s.data_snapshot))
  const valores  = snapshots.map(s => s.valor_atingido)
  const metaLine = snapshots.map(() => valorMeta)

  return (
    <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
      <h2 className="text-[15px] font-semibold text-white/70 mb-4">Histórico de Progresso</h2>
      <Line
        data={{
          labels,
          datasets: [
            {
              label: 'Valor atingido',
              data: valores,
              borderColor: cor,
              backgroundColor: `${cor}22`,
              fill: true,
              tension: 0.3,
              pointRadius: snapshots.length <= 10 ? 4 : 2,
              pointBackgroundColor: cor,
            },
            {
              label: 'Meta',
              data: metaLine,
              borderColor: '#ffffff33',
              borderDash: [5, 4],
              borderWidth: 1,
              pointRadius: 0,
              fill: false,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label: ctx => ` ${formatBRL(ctx.parsed.y)}`,
              },
            },
          },
          scales: {
            x: {
              ticks: {
                color: '#8b92a8', font: { size: 11 },
                maxTicksLimit: 8,
                maxRotation: 0,
              },
              grid: { color: 'rgba(255,255,255,0.05)' },
            },
            y: {
              ticks: {
                color: '#8b92a8', font: { size: 11 },
                callback: (v) => formatBRL(Number(v)),
              },
              grid: { color: 'rgba(255,255,255,0.05)' },
            },
          },
        }}
      />
    </section>
  )
}

// ── Fetch transações da categoria do objetivo ─────────────────

async function fetchTxsObjetivo(objetivo: Objetivo): Promise<Transacao[]> {
  // Usa exatamente as categorias salvas no objetivo (match exato), igual ao
  // cálculo de progresso do backend (fn_calcular_progresso_objetivo:
  // "t.categoria_id = ANY(categorias_objetivo)"). Ao marcar um pai, o MultiSelect
  // já grava o pai + todos os filhos no array; ao desmarcar um filho, ele sai do
  // array. Não expandimos pai→filho aqui para o gráfico não divergir da barra de
  // progresso.
  const cats: string[] = objetivo.categorias_objetivo?.length
    ? objetivo.categorias_objetivo
    : (objetivo.categoria_id ? [objetivo.categoria_id] : [])

  if (cats.length === 0) return []

  // Uma request por categoria, paginando TODAS as páginas. Categorias com muitos
  // lançamentos (recorrências de anos) ultrapassam 1000 transações; como a API
  // ordena por data crescente, parar em 1000 truncaria justamente os anos
  // recentes. Por isso buscamos página a página até esgotar.
  const PER_PAGE = 1000
  const respostas = await Promise.all(
    cats.map(async catId => {
      const todas: Transacao[] = []
      for (let page = 1; ; page++) {
        const params = new URLSearchParams({
          categoria_id: catId,
          per_page: String(PER_PAGE),
          page: String(page),
        })
        const result = await apiFetch<Transacao[]>(`/transacoes?${params}`)
        const lote = result.dados ?? []
        todas.push(...lote)
        if (lote.length < PER_PAGE) break
      }
      return todas.filter(t => t.categoria_id === catId)
    }),
  )

  const todas  = respostas.flat()
  const unicas = [...new Map(todas.map(t => [t.id, t])).values()]

  const hoje        = new Date().toISOString().split('T')[0]
  const mesCorrente = hoje.slice(0, 7)

  // CRESCIMENTO: inclui RECEITA e DESPESA para cálculo do líquido
  // OBJETIVO: apenas RECEITA (rastreamento de renda)
  const ehCrescimento = objetivo.tipo === 'CRESCIMENTO'
  const tiposValidos = ehCrescimento
    ? ['RECEITA', 'DESPESA']
    : ['RECEITA']

  // Não exibir períodos futuros (projeções):
  // - CRESCIMENTO: corta no dia de hoje (comparação YoY justa).
  // - OBJETIVO: corta no mês corrente inteiro (Resumo por Mês vai até o mês atual).
  return unicas.filter(t => {
    if (!tiposValidos.includes(t.tipo)) return false
    if (t.data < objetivo.data_inicio || t.data > objetivo.data_fim) return false
    return ehCrescimento ? t.data <= hoje : t.data.slice(0, 7) <= mesCorrente
  })
}

// ── Fetch transações das contas monitoradas (SONHO) ───────────
// Busca TODAS as transações de cada conta vinculada (paginando), para
// reconstruir o saldo mês a mês. Sem filtro de tipo/data: o saldo é
// cumulativo desde a abertura da conta.
async function fetchTxsContasSonho(objetivo: Objetivo): Promise<Transacao[]> {
  const contas: string[] = objetivo.contas_sonho?.length
    ? objetivo.contas_sonho
    : (objetivo.conta_id ? [objetivo.conta_id] : [])

  if (contas.length === 0) return []

  const PER_PAGE = 1000
  const respostas = await Promise.all(
    contas.map(async contaId => {
      const todas: Transacao[] = []
      for (let page = 1; ; page++) {
        const params = new URLSearchParams({
          conta_id: contaId,
          per_page: String(PER_PAGE),
          page: String(page),
        })
        const result = await apiFetch<Transacao[]>(`/transacoes?${params}`)
        const lote = result.dados ?? []
        todas.push(...lote)
        if (lote.length < PER_PAGE) break
      }
      return todas.filter(t => t.conta_id === contaId)
    }),
  )
  return respostas.flat()
}

// ── Seção: Evolução de saldo (SONHO) ──────────────────────────

const PALETTE_SALDO = [
  '#7F77DD','#4da6ff','#00c896','#f0b429','#ff6b4a',
  '#e91e8c','#00d2d3','#a29bfe','#fdcb6e','#55efc4',
]

function EvolucaoSaldoSonho({
  transacoes,
  contas,
  dataInicio,
  valorMeta,
}: {
  transacoes: Transacao[]
  contas:     { conta_id: string; nome: string; cor: string | null; saldo_inicial: number }[]
  dataInicio: string
  valorMeta:  number
}) {
  const [mesSelRaw, setMesSel] = useState<string | null>(null)

  const dados = useMemo(() => {
    if (contas.length === 0) return null

    // Meses: do início do objetivo até o mês corrente (sem projeções futuras).
    const hoje        = new Date().toISOString().slice(0, 10)
    const mesCorrente = hoje.slice(0, 7)
    const meses: string[] = []
    let [y, m]     = dataInicio.slice(0, 7).split('-').map(Number)
    const [yf, mf] = mesCorrente.split('-').map(Number)
    while ((y < yf || (y === yf && m <= mf)) && meses.length <= 240) {
      meses.push(`${y}-${String(m).padStart(2, '0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }
    if (meses.length === 0) return null

    // Agrupa transações por conta e ordena por data.
    const txPorConta: Record<string, Transacao[]> = {}
    for (const c of contas) txPorConta[c.conta_id] = []
    for (const t of transacoes) if (txPorConta[t.conta_id]) txPorConta[t.conta_id].push(t)

    // Saldo de cada mês = saldo_inicial + soma cumulativa das transações até o
    // fim daquele mês. No mês corrente o corte é HOJE (não conta projeções
    // futuras do mês), de modo que o último ponto = saldo atual da conta.
    const saldoConta: Record<string, number[]> = {}
    for (const c of contas) {
      const txs = txPorConta[c.conta_id].slice().sort((a, b) => a.data.localeCompare(b.data))
      let saldo = c.saldo_inicial
      let i = 0
      saldoConta[c.conta_id] = meses.map(mAlvo => {
        const cutoff = mAlvo === mesCorrente ? hoje : `${mAlvo}-99`
        while (i < txs.length && txs[i].data <= cutoff) {
          saldo += txs[i].tipo === 'DESPESA' ? -txs[i].valor : txs[i].valor
          i++
        }
        return saldo
      })
    }

    // Ordena as contas pelo saldo final — maior primeiro (base da pilha).
    const ordenadas = [...contas].sort(
      (a, b) => saldoConta[b.conta_id][meses.length - 1] - saldoConta[a.conta_id][meses.length - 1],
    )

    return { meses, saldoConta, ordenadas }
  }, [transacoes, contas, dataInicio])

  if (!dados) return null
  const { meses, saldoConta, ordenadas } = dados

  // Mês selecionado (default = último). idxSel/idxPrev para o comparativo.
  const idxSelRaw = mesSelRaw ? meses.indexOf(mesSelRaw) : -1
  const idxSel    = idxSelRaw >= 0 ? idxSelRaw : meses.length - 1
  const mesSel    = meses[idxSel]
  const idxPrev   = idxSel - 1
  const temPrev   = idxPrev >= 0

  const corConta = (c: { conta_id: string; cor: string | null }) => {
    const i = ordenadas.findIndex(o => o.conta_id === c.conta_id)
    return c.cor ?? PALETTE_SALDO[i % PALETTE_SALDO.length]
  }

  const datasets = [
    ...ordenadas.map(c => ({
      type: 'bar' as const,
      label: c.nome,
      data: saldoConta[c.conta_id],
      backgroundColor: meses.map((_, i) =>
        corConta(c) + (i === idxSel ? 'ee' : '55'),
      ),
      stack: 'saldo',
      order: 2,
    })),
    {
      type: 'line' as const,
      label: 'Meta',
      data: meses.map(() => valorMeta),
      borderColor: '#ffffff55',
      borderDash: [5, 4],
      borderWidth: 1.5,
      pointRadius: 0,
      order: 1,
    },
  ]

  // Comparativo mês selecionado × mês anterior
  const totalSel  = ordenadas.reduce((s, c) => s + saldoConta[c.conta_id][idxSel], 0)
  const totalPrev = temPrev ? ordenadas.reduce((s, c) => s + saldoConta[c.conta_id][idxPrev], 0) : 0
  const deltaTot  = totalSel - totalPrev
  const pctTot    = temPrev && totalPrev !== 0 ? (deltaTot / Math.abs(totalPrev)) * 100 : null

  // Contas ordenadas pelo saldo do mês selecionado (maior → menor)
  const contasSel = [...ordenadas].sort(
    (a, b) => saldoConta[b.conta_id][idxSel] - saldoConta[a.conta_id][idxSel],
  )

  return (
    <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
      <h2 className="text-[15px] font-semibold text-white/70 mb-1">Evolução do Saldo</h2>
      <p className="text-[12px] mb-4" style={{ color: '#8b92a8' }}>
        Clique num mês para comparar com o anterior
      </p>
      <Bar
        data={{ labels: meses.map(fmtMes), datasets }}
        options={{
          responsive: true,
          onClick: (_, elements) => {
            if (elements.length > 0) setMesSel(meses[elements[0].index])
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y)}` },
              footer: items => {
                const tot = items
                  .filter(it => it.dataset.type !== 'line')
                  .reduce((s: number, it) => s + (it.parsed.y as number), 0)
                return `Total: ${formatBRL(tot)}`
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { color: '#8b92a8', font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
              grid: { display: false },
            },
            y: {
              stacked: true,
              ticks: { color: '#8b92a8', font: { size: 11 }, callback: v => formatBRL(Number(v)) },
              grid: { color: 'rgba(255,255,255,0.05)' },
            },
          },
        }}
      />

      {/* ── Comparativo mês selecionado × anterior ── */}
      <div className="mt-4">
        {/* Cabeçalho: mês selecionado + variação total */}
        <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/8">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-white/90">{fmtMes(mesSel)}</span>
            {temPrev
              ? pctTot !== null && (
                <span className="text-[12px] font-medium px-2 py-0.5 rounded" style={{
                  background: deltaTot >= 0 ? '#00c89622' : '#f8717122',
                  color:      deltaTot >= 0 ? '#00c896'   : '#f87171',
                }}>
                  {deltaTot >= 0 ? '+' : ''}{formatBRL(deltaTot)} ({pctTot >= 0 ? '+' : ''}{pctTot.toFixed(1)}%) vs {fmtMes(meses[idxPrev])}
                </span>
              )
              : <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/40">1º mês</span>
            }
          </div>
          <span className="text-[14px] font-medium text-white/70 tabular-nums">{formatBRL(totalSel)}</span>
        </div>

        {/* Colunas */}
        <div className="grid pb-1 text-[11px] uppercase tracking-wide"
          style={{ gridTemplateColumns: '12px 1fr 8rem 8rem 8.5rem', color: '#8b92a8', gap: '0 12px' }}>
          <span />
          <span>Conta</span>
          {temPrev
            ? <><span className="text-right">{fmtMes(meses[idxPrev])}</span><span className="text-right">{fmtMes(mesSel)}</span></>
            : <span className="text-right col-span-2">{fmtMes(mesSel)}</span>
          }
          <span className="text-right">{temPrev ? 'Variação' : ''}</span>
        </div>

        <div className="divide-y divide-white/5">
          {contasSel.map(c => {
            const vSel  = saldoConta[c.conta_id][idxSel]
            const vPrev = temPrev ? saldoConta[c.conta_id][idxPrev] : 0
            const delta = vSel - vPrev
            const pct   = temPrev && vPrev !== 0 ? (delta / Math.abs(vPrev)) * 100 : null
            const corDelta = delta > 0 ? '#00c896' : delta < 0 ? '#f87171' : '#8b92a8'
            return (
              <div key={c.conta_id} className="grid py-1.5 items-center"
                style={{ gridTemplateColumns: '12px 1fr 8rem 8rem 8.5rem', gap: '0 12px' }}>
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: corConta(c) }} />
                <span className="text-[12px] text-white/70 truncate" title={c.nome}>{c.nome}</span>
                {temPrev ? (
                  <>
                    <span className="text-[12px] text-right tabular-nums" style={{ color: '#8b92a8' }}>{formatBRL(vPrev)}</span>
                    <span className="text-[12px] text-right tabular-nums text-white/70">{formatBRL(vSel)}</span>
                  </>
                ) : (
                  <span className="text-[12px] text-right tabular-nums text-white/70 col-span-2">{formatBRL(vSel)}</span>
                )}
                <span className="text-[12px] text-right tabular-nums" style={{ color: corDelta }}>
                  {!temPrev ? '—'
                    : `${delta >= 0 ? '+' : ''}${formatBRL(delta)}${pct !== null ? ` (${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%)` : ''}`}
                </span>
              </div>
            )
          })}
        </div>

        {/* Total */}
        {temPrev && (
          <div className="grid pt-2 mt-1 border-t border-white/8 items-center font-semibold"
            style={{ gridTemplateColumns: '12px 1fr 8rem 8rem 8.5rem', gap: '0 12px' }}>
            <span />
            <span className="text-[11px] text-white/40 uppercase tracking-wide">Total</span>
            <span className="text-[13px] text-right tabular-nums" style={{ color: '#8b92a8' }}>{formatBRL(totalPrev)}</span>
            <span className="text-[13px] text-right tabular-nums text-white/80">{formatBRL(totalSel)}</span>
            <span className="text-[13px] text-right tabular-nums font-bold"
              style={{ color: deltaTot >= 0 ? '#00c896' : '#f87171' }}>
              {deltaTot >= 0 ? '+' : ''}{formatBRL(deltaTot)}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

// ── Seção: Gráfico de rosca por ativo ─────────────────────────

function GraficoAtivos({ transacoes }: { transacoes: Transacao[] }) {
  const grupos = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of transacoes) {
      const ativo = extrairAtivo(t.descricao)
      map[ativo] = (map[ativo] ?? 0) + t.valor
    }
    return Object.entries(map).sort(([,a],[,b]) => b - a)
  }, [transacoes])

  const total = grupos.reduce((s, [,v]) => s + v, 0)
  if (grupos.length === 0 || total === 0) return null

  const TOP = 10
  const tops  = grupos.slice(0, TOP)
  const resto = grupos.slice(TOP)
  const restTotal = resto.reduce((s, [,v]) => s + v, 0)

  const labels = [...tops.map(([k]) => k), ...(restTotal > 0 ? ['Outros'] : [])]
  const values = [...tops.map(([,v]) => v), ...(restTotal > 0 ? [restTotal] : [])]
  const cores  = labels.map((_, i) => PALETTE[i % PALETTE.length])

  return (
    <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
      <h2 className="text-[15px] font-semibold text-white/70 mb-4">Retorno por Ativo</h2>

      {/* Donut centralizado */}
      <div className="flex justify-center mb-4">
        <div style={{ width: 170, height: 170 }}>
          <Doughnut
            data={{ labels, datasets: [{ data: values, backgroundColor: cores, borderWidth: 0, hoverOffset: 4 }] }}
            options={{
              responsive: false,
              cutout: '66%',
              plugins: {
                legend: { display: false },
                tooltip: {
                  callbacks: { label: ctx => ` ${formatBRL(ctx.parsed)} (${((ctx.parsed / total) * 100).toFixed(1)}%)` },
                },
              },
            }}
          />
        </div>
      </div>

      {/* Legenda em grade de 2 colunas — nome fixo + linha tracejada + valor + % */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
        {labels.map((label, i) => (
          <div key={label} className="flex items-center gap-1.5 text-[12px] min-w-0">
            <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: cores[i] }} />
            <span className="w-[52px] flex-shrink-0 text-white/80 font-medium truncate" title={label}>{label}</span>
            <div className="flex-1 border-b border-dashed border-white/10 mx-1 mb-px" />
            <span className="flex-shrink-0 text-white/50 tabular-nums">{formatBRL(values[i])}</span>
            <span className="w-7 text-right flex-shrink-0 font-semibold tabular-nums" style={{ color: cores[i] }}>
              {((values[i] / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="mt-3 pt-2.5 border-t border-white/8 flex justify-between text-[12px]">
        <span style={{ color: '#8b92a8' }}>Total no período</span>
        <span className="font-semibold text-white/80">{formatBRL(total)}</span>
      </div>
    </section>
  )
}

// ── Seção: Evolução mensal (OBJETIVO) ─────────────────────────

function EvolucaoMensalObjetivo({
  transacoes,
  dataInicio,
  valorMeta,
  cor,
}: {
  transacoes: Transacao[]
  dataInicio: string
  valorMeta:  number
  cor:        string
}) {
  const { labels, valores } = useMemo(() => {
    const map: Record<string, number> = {}
    for (const t of transacoes) {
      const m = t.data.slice(0, 7)
      map[m] = (map[m] ?? 0) + t.valor
    }
    const comDado = Object.keys(map).sort()
    if (comDado.length === 0) return { labels: [], valores: [] }

    // Sequência contínua de meses: do início do objetivo (ou 1º mês com dado)
    // até o último mês com dado, preenchendo lacunas com 0.
    const ini    = dataInicio.slice(0, 7)
    const inicio = ini < comDado[0] ? ini : comDado[0]
    const fim    = comDado[comDado.length - 1]

    const meses: string[] = []
    let [y, m]   = inicio.split('-').map(Number)
    const [yf, mf] = fim.split('-').map(Number)
    while ((y < yf || (y === yf && m <= mf)) && meses.length <= 120) {
      meses.push(`${y}-${String(m).padStart(2, '0')}`)
      m++; if (m > 12) { m = 1; y++ }
    }
    return { labels: meses, valores: meses.map(mm => map[mm] ?? 0) }
  }, [transacoes, dataInicio])

  if (labels.length < 1) return null

  return (
    <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
      <h2 className="text-[15px] font-semibold text-white/70 mb-4">Evolução Mensal</h2>
      <Bar
        data={{
          labels: labels.map(fmtMes),
          datasets: [
            {
              type: 'bar' as const,
              label: 'Recebido no mês',
              data: valores,
              backgroundColor: valores.map(v => v >= valorMeta ? '#00c896cc' : `${cor}cc`),
              borderRadius: 4,
              order: 2,
            },
            {
              type: 'line' as const,
              label: 'Meta',
              data: labels.map(() => valorMeta),
              borderColor: '#ffffff44',
              borderDash: [5, 4],
              borderWidth: 1.5,
              pointRadius: 0,
              order: 1,
            },
          ] as ChartDataset<'bar', (number | null)[]>[],
        }}
        options={{
          responsive: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: { label: ctx => ` ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y ?? 0)}` },
            },
          },
          scales: {
            x: {
              ticks: { color: '#8b92a8', font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 12 },
              grid: { display: false },
            },
            y: {
              ticks: { color: '#8b92a8', font: { size: 11 }, callback: v => formatBRL(Number(v)) },
              grid: { color: 'rgba(255,255,255,0.05)' },
            },
          },
        }}
      />
    </section>
  )
}

// ── Seção: Resumo por mês ──────────────────────────────────────

function ResumoPorMes({ transacoes, valorMeta }: { transacoes: Transacao[]; valorMeta: number }) {
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())

  const porMes = useMemo(() => {
    const map: Record<string, Transacao[]> = {}
    for (const t of transacoes) {
      const mes = t.data.slice(0, 7)
      if (!map[mes]) map[mes] = []
      map[mes].push(t)
    }
    return Object.entries(map)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([mes, txs]) => ({
        mes,
        txs: txs.sort((a, b) => b.data.localeCompare(a.data)),
        total: txs.reduce((s, t) => s + t.valor, 0),
      }))
  }, [transacoes])

  if (porMes.length === 0) {
    return (
      <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/70 mb-1">Resumo por Mês</h2>
        <p className="text-[13px]" style={{ color: '#8b92a8' }}>Nenhum lançamento encontrado no período.</p>
      </section>
    )
  }

  function toggle(mes: string) {
    setExpandidos(prev => {
      const next = new Set(prev)
      next.has(mes) ? next.delete(mes) : next.add(mes)
      return next
    })
  }

  return (
    <section className="bg-[#1a1f2e] rounded-xl border border-white/5 overflow-hidden">
      <h2 className="text-[15px] font-semibold text-white/70 px-4 pt-4 pb-2">Resumo por Mês</h2>
      <div className="divide-y divide-white/5">
        {porMes.map(({ mes, txs, total }) => {
          const pct   = valorMeta > 0 ? Math.min(100, (total / valorMeta) * 100) : 0
          const aberto = expandidos.has(mes)
          const corBarra = pct >= 100 ? '#00c896' : pct >= 70 ? '#f0b429' : '#4da6ff'

          return (
            <div key={mes}>
              {/* Linha do mês */}
              <button
                onClick={() => toggle(mes)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/3 transition-colors text-left"
              >
                {aberto
                  ? <ChevronDown size={14} className="flex-shrink-0" style={{ color: '#8b92a8' }} />
                  : <ChevronRight size={14} className="flex-shrink-0" style={{ color: '#8b92a8' }} />
                }
                <span className="w-16 flex-shrink-0 text-[14px] font-medium text-white/80">{fmtMes(mes)}</span>

                {/* Barra de progresso compacta */}
                <div className="flex-1 h-1.5 rounded-full bg-white/8">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${pct}%`, background: corBarra }} />
                </div>

                <span className="w-16 text-right flex-shrink-0 text-[14px] font-semibold" style={{ color: corBarra }}>
                  {pct.toFixed(0)}%
                </span>
                <span className="w-24 text-right flex-shrink-0 text-[14px] text-white/70">
                  {formatBRL(total)}
                </span>
              </button>

              {/* Lançamentos do mês */}
              {aberto && (
                <div className="bg-[#141824] divide-y divide-white/4">
                  {txs.map(tx => (
                    <div key={tx.id} className="flex items-center gap-3 px-6 py-2.5 text-[13px]">
                      <span className="flex-1 text-white/70 truncate">{tx.descricao}</span>
                      <span style={{ color: '#8b92a8' }}>{formatData(tx.data)}</span>
                      <span className="w-24 text-right font-medium text-av-green flex-shrink-0">
                        {formatBRL(tx.valor)}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center gap-3 px-6 py-2 text-[12px]" style={{ color: '#8b92a8' }}>
                    <span className="flex-1">{txs.length} lançamento{txs.length !== 1 ? 's' : ''}</span>
                    <span className="w-24 text-right font-medium text-white/60">{formatBRL(total)}</span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ── Gráfico: barras empilhadas + linha YoY (CRESCIMENTO) ──────

function GraficoCategoriasAno({
  transacoes,
  dataInicio,
  dataFim,
  valorMeta,
}: {
  transacoes: Transacao[]
  dataInicio: string
  dataFim:    string
  valorMeta:  number
}) {
  const { categorias: todasCats } = useCategorias()
  const anoBase = parseInt(dataInicio.slice(0, 4))
  const anoFim  = Math.min(new Date().getFullYear(), parseInt(dataFim.slice(0, 4)))

  const [anoSel,    setAnoSel]    = useState<number>(anoFim)
  const [expandPos, setExpandPos] = useState(false)
  const [expandNeg, setExpandNeg] = useState(false)

  const nomesCat = useMemo(() => {
    const m: Record<string, string> = {}
    for (const cat of todasCats) m[cat.id] = cat.descricao
    return m
  }, [todasCats])

  const { anos, categorias, totaisPorAnoCat, totaisPorAno } = useMemo(() => {
    const anos: number[] = []
    for (let y = anoBase; y <= anoFim; y++) anos.push(y)

    const catMap: Record<string, string> = {}
    for (const t of transacoes) {
      const id = t.categoria_id ?? '__sem__'
      if (!catMap[id]) catMap[id] = nomesCat[id] ?? t.categoria_nome ?? id
    }

    const totaisPorAnoCat: Record<number, Record<string, number>> = {}
    for (const ano of anos) totaisPorAnoCat[ano] = {}
    for (const t of transacoes) {
      const ano = parseInt(t.data.slice(0, 4))
      if (ano < anoBase || ano > anoFim) continue
      const id   = t.categoria_id ?? '__sem__'
      const sign = t.tipo === 'DESPESA' ? -1 : 1   // líquido: receita + / despesa −
      totaisPorAnoCat[ano][id] = (totaisPorAnoCat[ano][id] ?? 0) + t.valor * sign
    }

    const totaisPorAno: Record<number, number> = {}
    for (const ano of anos) {
      totaisPorAno[ano] = Object.values(totaisPorAnoCat[ano]).reduce((s, v) => s + v, 0)
    }

    const totalPorCat = (id: string) =>
      anos.reduce((s, ano) => s + (totaisPorAnoCat[ano][id] ?? 0), 0)
    const categorias = Object.entries(catMap)
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => totalPorCat(b.id) - totalPorCat(a.id))

    return { anos, categorias, totaisPorAnoCat, totaisPorAno }
  }, [transacoes, anoBase, anoFim, nomesCat])

  if (anos.length === 0 || categorias.length === 0) return null

  // Período equivalente YTD (dia/mês de hoje)
  const hoje      = new Date()
  const anoAtual  = hoje.getFullYear()
  const mmdd      = `${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`

  // Totais YTD por ano (até o dia/mês de hoje) — para a linha YoY ficar
  // proporcional quando o ano corrente ainda está incompleto.
  const totaisPorAnoYTD: Record<number, number> = {}
  for (const ano of anos) totaisPorAnoYTD[ano] = 0
  for (const t of transacoes) {
    const ano = parseInt(t.data.slice(0, 4))
    if (ano < anoBase || ano > anoFim) continue
    if (t.data.slice(5) > mmdd) continue
    const sign = t.tipo === 'DESPESA' ? -1 : 1
    totaisPorAnoYTD[ano] += t.valor * sign
  }

  const yoyPct: (number | null)[] = anos.map((ano, i) => {
    if (i === 0) return null
    const isParcialAno = ano === anoAtual && mmdd < '12-31'
    const prev = isParcialAno ? (totaisPorAnoYTD[anos[i - 1]] ?? 0) : (totaisPorAno[anos[i - 1]] ?? 0)
    const curr = isParcialAno ? (totaisPorAnoYTD[ano]        ?? 0) : (totaisPorAno[ano]        ?? 0)
    return prev > 0 ? ((curr - prev) / prev) * 100 : null
  })

  const anoPrev    = Math.max(anoBase, anoSel - 1)
  const isBaseYear = anoSel === anoBase
  const totalSel   = totaisPorAno[anoSel] ?? 0

  const isParcial = !isBaseYear && anoSel === anoAtual && mmdd < '12-31'
  const cutoffPrev = `${anoPrev}-${mmdd}`

  const prevFairByCat: Record<string, number> = {}
  if (isParcial) {
    for (const t of transacoes) {
      if (parseInt(t.data.slice(0, 4)) !== anoPrev) continue
      if (t.data > cutoffPrev) continue
      const id   = t.categoria_id ?? '__sem__'
      const sign = t.tipo === 'DESPESA' ? -1 : 1
      prevFairByCat[id] = (prevFairByCat[id] ?? 0) + t.valor * sign
    }
  }

  const getPrevFair   = (id: string) =>
    isParcial ? (prevFairByCat[id] ?? 0) : (totaisPorAnoCat[anoPrev]?.[id] ?? 0)
  const totalPrevFair = isParcial
    ? Object.values(prevFairByCat).reduce((s, v) => s + v, 0)
    : (totaisPorAno[anoPrev] ?? 0)

  const yoyTotal = !isBaseYear && totalPrevFair > 0
    ? ((totalSel - totalPrevFair) / totalPrevFair) * 100 : null

  // ── Separa créditos (líquido > 0) e débitos (líquido < 0) ──
  const TOP_N = 5
  const PALETTE_POS = ['#00c896','#4da6ff','#7F77DD','#55efc4','#00d2d3','#a29bfe','#6c5ce7','#81ecec']
  const PALETTE_NEG = ['#f87171','#f0b429','#ff6b4a','#e91e8c','#fdcb6e','#ff7675','#d63031','#e17055']

  const overallNet = (id: string) =>
    anos.reduce((s, ano) => s + (totaisPorAnoCat[ano][id] ?? 0), 0)

  const catPos = categorias
    .filter(c => overallNet(c.id) > 0)
    .sort((a, b) => overallNet(b.id) - overallNet(a.id))
  const catNeg = categorias
    .filter(c => overallNet(c.id) < 0)
    .sort((a, b) => overallNet(a.id) - overallNet(b.id))

  const catNeutra = categorias
    .filter(c => overallNet(c.id) === 0 && anos.some(ano => (totaisPorAnoCat[ano][c.id] ?? 0) !== 0))

  type CatVis = { id: string; nome: string }

  // Listas completas (para legenda e cálculo de cores)
  const visPos: CatVis[] = catPos
  const visNeg: CatVis[] = [...catNeg, ...catNeutra]

  // Listas para o gráfico: top-5 + "Outros" agregado
  const chartTopPos  = catPos.slice(0, TOP_N)
  const chartRestPos = catPos.slice(TOP_N)
  const chartTopNeg  = [...catNeg, ...catNeutra].slice(0, TOP_N)
  const chartRestNeg = [...catNeg, ...catNeutra].slice(TOP_N)

  const OUTROS_POS_ID = '__outros_pos__'
  const OUTROS_NEG_ID = '__outros_neg__'

  const chartPos: CatVis[] = [
    ...chartTopPos,
    ...(chartRestPos.length > 0 ? [{ id: OUTROS_POS_ID, nome: 'Outros Créditos' }] : []),
  ]
  const chartNeg: CatVis[] = [
    ...chartTopNeg,
    ...(chartRestNeg.length > 0 ? [{ id: OUTROS_NEG_ID, nome: 'Outros Débitos' }] : []),
  ]

  const getValCat = (cat: CatVis, ano: number): number => {
    if (cat.id === OUTROS_POS_ID) return chartRestPos.reduce((s, c) => s + (totaisPorAnoCat[ano][c.id] ?? 0), 0)
    if (cat.id === OUTROS_NEG_ID) return chartRestNeg.reduce((s, c) => s + (totaisPorAnoCat[ano][c.id] ?? 0), 0)
    return totaisPorAnoCat[ano][cat.id] ?? 0
  }

  const getPrevFairVis = (cat: CatVis): number => {
    if (cat.id === OUTROS_POS_ID) return chartRestPos.reduce((s, c) => s + getPrevFair(c.id), 0)
    if (cat.id === OUTROS_NEG_ID) return chartRestNeg.reduce((s, c) => s + getPrevFair(c.id), 0)
    return getPrevFair(cat.id)
  }

  const labels = anos.map(String)

  // Cor "Outros" usa paleta com leve transparência extra para distinguir visualmente
  const COR_OUTROS_POS = '#8b92a8'
  const COR_OUTROS_NEG = '#636e72'

  const barDatasets = [
    ...chartPos.map((cat, i) => {
      const isOutros = cat.id === OUTROS_POS_ID
      const cor = isOutros ? COR_OUTROS_POS : PALETTE_POS[i % PALETTE_POS.length]
      return {
        type: 'bar' as const,
        label: cat.nome,
        data: anos.map(ano => getValCat(cat, ano)),
        backgroundColor: anos.map(ano =>
          ano === anoSel ? cor + 'dd' : cor + '44',
        ),
        borderWidth: anos.map(ano => ano === anoSel ? 1 : 0),
        borderColor: cor,
        yAxisID: 'y',
        order: 2,
      }
    }),
    ...chartNeg.map((cat, i) => {
      const isOutros = cat.id === OUTROS_NEG_ID
      const cor = isOutros ? COR_OUTROS_NEG : PALETTE_NEG[i % PALETTE_NEG.length]
      return {
        type: 'bar' as const,
        label: cat.nome,
        data: anos.map(ano => getValCat(cat, ano)),
        backgroundColor: anos.map(ano =>
          ano === anoSel ? cor + 'dd' : cor + '44',
        ),
        borderWidth: anos.map(ano => ano === anoSel ? 1 : 0),
        borderColor: cor,
        yAxisID: 'y',
        order: 2,
      }
    }),
  ]

  const lineYoY = {
    type: 'line' as const,
    label: 'Crescimento YoY (%)',
    data: yoyPct,
    yAxisID: 'y2',
    borderColor: '#f0b429',
    backgroundColor: 'transparent',
    pointBackgroundColor: yoyPct.map((v, i) =>
      anos[i] === anoSel ? '#ffffff'
      : v === null ? 'transparent'
      : v >= valorMeta ? '#00c896' : v >= 0 ? '#f0b429' : '#f87171',
    ),
    pointRadius: yoyPct.map((v, i) => anos[i] === anoSel ? 7 : v === null ? 0 : 4),
    pointHoverRadius: 7,
    borderWidth: 2,
    tension: 0.3,
    spanGaps: false,
    order: 1,
  }

  const lineMeta = {
    type: 'line' as const,
    label: `Meta (${valorMeta}%)`,
    data: anos.map(() => valorMeta),
    yAxisID: 'y2',
    borderColor: '#ffffff33',
    borderDash: [5, 4],
    borderWidth: 1.5,
    pointRadius: 0,
    order: 0,
  }

  // Categorias com valor no ano selecionado ou anterior
  const posComValor = visPos.filter(cat => getValCat(cat, anoSel) !== 0 || (!isBaseYear && getPrevFairVis(cat) !== 0))
  const negComValor = visNeg.filter(cat => getValCat(cat, anoSel) !== 0 || (!isBaseYear && getPrevFairVis(cat) !== 0))

  // Na legenda: top-5 por padrão, expansível
  const posSel = expandPos ? posComValor : posComValor.slice(0, TOP_N)
  const negSel = expandNeg ? negComValor : negComValor.slice(0, TOP_N)
  const catsSel = [...posSel, ...negSel]

  // Cor consistente entre gráfico e legenda
  const corPos = (cat: CatVis) => PALETTE_POS[visPos.indexOf(cat) % PALETTE_POS.length]
  const corNeg = (cat: CatVis) => PALETTE_NEG[visNeg.indexOf(cat) % PALETTE_NEG.length]

  // Escala y2 explícita: garante que 0 esteja sempre visível com folga
  const yoyValues = yoyPct.filter((v): v is number => v !== null)
  const yoyMin = yoyValues.length > 0 ? Math.min(...yoyValues) : 0
  const yoyMax = yoyValues.length > 0 ? Math.max(...yoyValues) : 100
  const rangePad = Math.max(20, (yoyMax - yoyMin) * 0.15)
  const y2min = Math.floor((Math.min(0, yoyMin) - rangePad) / 10) * 10
  const y2max = Math.ceil((Math.max(0, yoyMax) + rangePad) / 10) * 10

  // Plugin inline: desenha linha do zero no eixo y2 diretamente no canvas
  const zeroLinePlugin = {
    id: 'crescZeroLine',
    afterDraw(chart: ChartJS) {
      const scale = chart.scales['y2']
      if (!scale) return
      const y0 = scale.getPixelForValue(0)
      const { top, bottom, left, right } = chart.chartArea
      if (y0 < top || y0 > bottom) return
      const c = chart.ctx
      c.save()
      c.strokeStyle = 'rgba(255,255,255,0.35)'
      c.lineWidth = 1.5
      c.setLineDash([6, 4])
      c.beginPath()
      c.moveTo(left, y0)
      c.lineTo(right, y0)
      c.stroke()
      c.setLineDash([])
      c.restore()
    },
  }

  return (
    <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
      <h2 className="text-[15px] font-semibold text-white/70 mb-1">Arrecadação por Ano</h2>
      <p className="text-[12px] mb-4" style={{ color: '#8b92a8' }}>
        Clique numa barra para detalhar o ano
      </p>

      <Bar
        plugins={[zeroLinePlugin]}
        data={{ labels, datasets: [...barDatasets, lineYoY, lineMeta] as ChartDataset<'bar', (number | null)[]>[] }}
        options={{
          responsive: true,
          onClick: (_, elements) => {
            if (elements.length > 0) setAnoSel(anos[elements[0].index])
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              mode: 'index',
              filter: item => {
                const d = item.dataset as { type?: string }
                if (d.type === 'line') return item.raw != null
                return (item.raw as number) !== 0
              },
              callbacks: {
                label: ctx => {
                  if (ctx.dataset.yAxisID === 'y2') {
                    const v = ctx.parsed.y
                    if (v == null) return ''
                    return ` ${ctx.dataset.label}: ${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
                  }
                  return ` ${ctx.dataset.label}: ${formatBRL(ctx.parsed.y ?? 0)}`
                },
                footer: items => {
                  const bar = items.find(i => i.dataset.yAxisID !== 'y2')
                  if (!bar) return ''
                  return `Total: ${formatBRL(totaisPorAno[parseInt(bar.label)] ?? 0)}`
                },
              },
            },
          },
          scales: {
            x: {
              stacked: true,
              ticks: { color: '#8b92a8', font: { size: 12 } },
              grid: { display: false },
            },
            y: {
              stacked: true,
              position: 'left',
              ticks: { color: '#8b92a8', font: { size: 11 }, callback: v => formatBRL(Number(v)) },
              grid: { color: 'rgba(255,255,255,0.05)' },
            },
            y2: {
              position: 'right',
              min: y2min,
              max: y2max,
              grid: { drawOnChartArea: false },
              ticks: { color: '#f0b429', font: { size: 11 }, callback: v => `${Number(v) >= 0 ? '+' : ''}${v}%` },
            },
          },
        }}
      />

      {/* ── Legenda interativa ── */}
      <div className="mt-4">
        {/* Cabeçalho: ano selecionado + YoY total */}
        <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/8">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[14px] font-semibold text-white/90">{anoSel}</span>
            {isBaseYear
              ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/40">ano base</span>
              : yoyTotal !== null && (
                <span className="text-[12px] font-medium px-2 py-0.5 rounded" style={{
                  background: yoyTotal >= valorMeta ? '#00c89622' : yoyTotal >= 0 ? '#f0b42922' : '#f8717122',
                  color:      yoyTotal >= valorMeta ? '#00c896'   : yoyTotal >= 0 ? '#f0b429'   : '#f87171',
                }}>
                  {yoyTotal >= 0 ? '+' : ''}{yoyTotal.toFixed(1)}% vs {anoPrev}
                  {yoyTotal >= valorMeta && ' ✓'}
                </span>
              )
            }
            {isParcial && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-white/40">
                jan–{mmdd.replace('-', '/')} de {anoPrev} vs {anoSel}
              </span>
            )}
          </div>
          <span className="text-[14px] font-medium text-white/70 tabular-nums">{formatBRL(totalSel)}</span>
        </div>

        {/* Colunas */}
        <div className="grid pb-1 text-[11px] uppercase tracking-wide"
          style={{ gridTemplateColumns: '12px 1fr 5.5rem 5.5rem 4.5rem', color: '#8b92a8', gap: '0 8px' }}>
          <span />
          <span>Categoria</span>
          {isBaseYear
            ? <span className="text-right col-span-2">{anoSel}</span>
            : <><span className="text-right">{anoPrev}</span><span className="text-right">{anoSel}</span></>
          }
          <span className="text-right">{isBaseYear ? '' : 'Δ%'}</span>
        </div>

        <div className="divide-y divide-white/5">
          {/* ── Créditos ── */}
          {visPos.some(c => catsSel.includes(c)) && (() => {
            const posCats  = catsSel.filter(c => visPos.includes(c as CatVis))
            const subPosSel  = posCats.reduce((s, c) => s + getValCat(c as CatVis, anoSel), 0)
            const subPosPrev = posCats.reduce((s, c) => s + getPrevFairVis(c as CatVis), 0)
            const subPosYoy  = !isBaseYear && subPosPrev > 0 ? ((subPosSel - subPosPrev) / subPosPrev) * 100 : null
            const corYoyPos  = subPosYoy === null ? '#8b92a8'
                             : subPosYoy >= valorMeta ? '#00c896' : subPosYoy >= 0 ? '#f0b429' : '#f87171'
            return (
              <>
                <div className="py-1 text-[10px] uppercase tracking-wide" style={{ color: '#00c896' }}>
                  Créditos
                </div>
                {posCats.map((cat) => {
                  const cor  = corPos(cat as CatVis)
                  const vSel = getValCat(cat as CatVis, anoSel)
                  const vPrv = getPrevFairVis(cat as CatVis)
                  const yoy  = !isBaseYear && vPrv > 0 ? ((vSel - vPrv) / vPrv) * 100 : null
                  const corYoy = yoy === null ? '#8b92a8'
                               : yoy >= valorMeta ? '#00c896' : yoy >= 0 ? '#f0b429' : '#f87171'
                  return (
                    <div key={cat.id} className="grid py-1 items-center"
                      style={{ gridTemplateColumns: '12px 1fr 5.5rem 5.5rem 4.5rem', gap: '0 8px' }}>
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: cor }} />
                      <span className="text-[12px] text-white/60 truncate">{cat.nome}</span>
                      {isBaseYear ? (
                        <span className="text-[12px] text-right tabular-nums text-white/60 col-span-2">{formatBRL(vSel)}</span>
                      ) : (
                        <>
                          <span className="text-[12px] text-right tabular-nums" style={{ color: '#8b92a8' }}>{vPrv !== 0 ? formatBRL(vPrv) : '—'}</span>
                          <span className="text-[12px] text-right tabular-nums text-white/60">{vSel !== 0 ? formatBRL(vSel) : '—'}</span>
                        </>
                      )}
                      <span className="text-[12px] text-right tabular-nums" style={{ color: corYoy }}>
                        {yoy === null ? '—' : `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`}
                      </span>
                    </div>
                  )
                })}
                {/* Botão expandir créditos */}
                {posComValor.length > TOP_N && (
                  <button onClick={() => setExpandPos(v => !v)}
                    className="w-full text-[11px] py-1 text-center hover:text-white/60 transition-colors"
                    style={{ color: '#8b92a8' }}>
                    {expandPos
                      ? `▲ Mostrar menos`
                      : `▼ Ver todos (${posComValor.length - TOP_N} ocultos)`}
                  </button>
                )}

                {/* Subtotal créditos */}
                {!isBaseYear && (
                  <div className="grid py-1.5 items-center font-semibold border-t border-white/8"
                    style={{ gridTemplateColumns: '12px 1fr 5.5rem 5.5rem 4.5rem', gap: '0 8px' }}>
                    <span />
                    <span className="text-[11px] uppercase tracking-wide" style={{ color: '#00c896' }}>Total Créditos</span>
                    <span className="text-[13px] text-right tabular-nums" style={{ color: '#8b92a8' }}>{formatBRL(subPosPrev)}</span>
                    <span className="text-[13px] text-right tabular-nums" style={{ color: '#00c896' }}>{formatBRL(subPosSel)}</span>
                    <span className="text-[13px] text-right tabular-nums font-bold" style={{ color: corYoyPos }}>
                      {subPosYoy === null ? '—' : `${subPosYoy >= 0 ? '+' : ''}${subPosYoy.toFixed(1)}%`}
                    </span>
                  </div>
                )}
              </>
            )
          })()}

          {/* ── Débitos ── */}
          {visNeg.some(c => catsSel.includes(c)) && (() => {
            const negCats    = catsSel.filter(c => visNeg.includes(c as CatVis))
            const subNegSel  = negCats.reduce((s, c) => s + Math.abs(getValCat(c as CatVis, anoSel)), 0)
            const subNegPrev = negCats.reduce((s, c) => s + Math.abs(getPrevFairVis(c as CatVis)), 0)
            const subNegYoy  = !isBaseYear && subNegPrev > 0 ? ((subNegSel - subNegPrev) / subNegPrev) * 100 : null
            // Aumento de despesas = ruim (vermelho), redução = bom (verde)
            const corYoyNeg  = subNegYoy === null ? '#8b92a8'
                             : subNegYoy <= -valorMeta ? '#00c896' : subNegYoy <= 0 ? '#f0b429' : '#f87171'
            return (
              <>
                <div className="py-1 mt-1 text-[10px] uppercase tracking-wide border-t border-white/5" style={{ color: '#f87171' }}>
                  Débitos
                </div>
                {negCats.map((cat) => {
                  const cor    = corNeg(cat as CatVis)
                  const vSel   = getValCat(cat as CatVis, anoSel)
                  const vPrv   = getPrevFairVis(cat as CatVis)
                  const absSel = Math.abs(vSel)
                  const absPrv = Math.abs(vPrv)
                  const yoy    = !isBaseYear && absPrv > 0 ? ((absSel - absPrv) / absPrv) * 100 : null
                  const corYoy = yoy === null ? '#8b92a8'
                               : yoy <= -valorMeta ? '#00c896' : yoy <= 0 ? '#f0b429' : '#f87171'
                  return (
                    <div key={cat.id} className="grid py-1 items-center"
                      style={{ gridTemplateColumns: '12px 1fr 5.5rem 5.5rem 4.5rem', gap: '0 8px' }}>
                      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: cor }} />
                      <span className="text-[12px] text-white/60 truncate">{cat.nome}</span>
                      {isBaseYear ? (
                        <span className="text-[12px] text-right tabular-nums text-white/60 col-span-2">{formatBRL(absSel)}</span>
                      ) : (
                        <>
                          <span className="text-[12px] text-right tabular-nums" style={{ color: '#8b92a8' }}>{absPrv > 0 ? formatBRL(absPrv) : '—'}</span>
                          <span className="text-[12px] text-right tabular-nums text-white/60">{absSel > 0 ? formatBRL(absSel) : '—'}</span>
                        </>
                      )}
                      <span className="text-[12px] text-right tabular-nums" style={{ color: corYoy }}>
                        {yoy === null ? '—' : `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`}
                      </span>
                    </div>
                  )
                })}
                {/* Botão expandir débitos */}
                {negComValor.length > TOP_N && (
                  <button onClick={() => setExpandNeg(v => !v)}
                    className="w-full text-[11px] py-1 text-center hover:text-white/60 transition-colors"
                    style={{ color: '#8b92a8' }}>
                    {expandNeg
                      ? `▲ Mostrar menos`
                      : `▼ Ver todos (${negComValor.length - TOP_N} ocultos)`}
                  </button>
                )}

                {/* Subtotal débitos */}
                {!isBaseYear && (
                  <div className="grid py-1.5 items-center font-semibold border-t border-white/8"
                    style={{ gridTemplateColumns: '12px 1fr 5.5rem 5.5rem 4.5rem', gap: '0 8px' }}>
                    <span />
                    <span className="text-[11px] uppercase tracking-wide" style={{ color: '#f87171' }}>Total Débitos</span>
                    <span className="text-[13px] text-right tabular-nums" style={{ color: '#8b92a8' }}>{formatBRL(subNegPrev)}</span>
                    <span className="text-[13px] text-right tabular-nums" style={{ color: '#f87171' }}>{formatBRL(subNegSel)}</span>
                    <span className="text-[13px] text-right tabular-nums font-bold" style={{ color: corYoyNeg }}>
                      {subNegYoy === null ? '—' : `${subNegYoy >= 0 ? '+' : ''}${subNegYoy.toFixed(1)}%`}
                    </span>
                  </div>
                )}
              </>
            )
          })()}
        </div>

        {/* Total líquido (créditos − débitos) */}
        {!isBaseYear && (
          <div className="grid pt-2 mt-1 border-t border-white/8 items-center font-semibold"
            style={{ gridTemplateColumns: '12px 1fr 5.5rem 5.5rem 4.5rem', gap: '0 8px' }}>
            <span />
            <span className="text-[11px] text-white/40 uppercase tracking-wide">Líquido</span>
            <span className="text-[13px] text-right tabular-nums" style={{ color: '#8b92a8' }}>
              {formatBRL(totalPrevFair)}
            </span>
            <span className="text-[13px] text-right tabular-nums"
              style={{ color: totalSel >= 0 ? '#e8eaf0' : '#f87171' }}>
              {formatBRL(totalSel)}
            </span>
            <span className="text-[13px] text-right tabular-nums" style={{
              color: yoyTotal === null ? '#8b92a8'
                   : yoyTotal >= valorMeta ? '#00c896' : yoyTotal >= 0 ? '#f0b429' : '#f87171',
            }}>
              {yoyTotal === null ? '—' : `${yoyTotal >= 0 ? '+' : ''}${yoyTotal.toFixed(1)}%`}
            </span>
          </div>
        )}

        {/* Referência das linhas */}
        <div className="flex gap-4 pt-2 mt-2 border-t border-white/8 flex-wrap">
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="w-5 h-0.5 inline-block rounded" style={{ background: '#f0b429' }} />
            <span style={{ color: '#8b92a8' }}>Crescimento YoY</span>
          </div>
          <div className="flex items-center gap-1.5 text-[12px]">
            <span className="w-5 h-0.5 inline-block rounded opacity-40" style={{ background: '#fff' }} />
            <span style={{ color: '#8b92a8' }}>Meta {valorMeta}%</span>
          </div>
        </div>
      </div>
    </section>
  )
}

// ── Seção: tabela ano-a-ano (CRESCIMENTO) ─────────────────────

function ResumoPorAno({
  transacoes,
  dataInicio,
  dataFim,
  valorMeta,
}: {
  transacoes: Transacao[]
  dataInicio: string
  dataFim:    string
  valorMeta:  number
}) {
  const anoAtual = new Date().getFullYear()
  const mmddHoje = (() => {
    const d = new Date()
    return `${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
  })()

  const anoBase = parseInt(dataInicio.slice(0, 4))
  // Não exibe anos futuros (sem dados ainda) — limita ao ano corrente.
  const anoFim  = Math.min(anoAtual, parseInt(dataFim.slice(0, 4)))

  // Totais LÍQUIDOS por ano (receitas − despesas), para exibição
  const porAno = useMemo(() => {
    const map: Record<number, number> = {}
    for (let y = anoBase; y <= anoFim; y++) map[y] = 0
    for (const t of transacoes) {
      const y    = parseInt(t.data.slice(0, 4))
      const sign = t.tipo === 'DESPESA' ? -1 : 1
      if (y >= anoBase && y <= anoFim) map[y] = (map[y] ?? 0) + t.valor * sign
    }
    return Object.entries(map)
      .map(([ano, total]) => ({ ano: parseInt(ano), total }))
      .sort((a, b) => a.ano - b.ano)
  }, [transacoes, anoBase, anoFim])

  // Totais LÍQUIDOS YTD por ano (para comparações justas com o ano corrente parcial)
  const ytdPorAno = useMemo(() => {
    const map: Record<number, number> = {}
    for (let y = anoBase; y <= anoFim; y++) map[y] = 0
    for (const t of transacoes) {
      const y    = parseInt(t.data.slice(0, 4))
      const sign = t.tipo === 'DESPESA' ? -1 : 1
      if (y < anoBase || y > anoFim) continue
      const cutoff = `${y}-${mmddHoje}`
      if (y < anoAtual && t.data > cutoff) continue
      map[y] = (map[y] ?? 0) + t.valor * sign
    }
    return map
  }, [transacoes, anoBase, anoFim, anoAtual, mmddHoje])

  if (porAno.length === 0) return null

  const baseTotal = porAno[0]?.total ?? 0

  // Pré-calcula YoY de cada ano para poder computar a média
  const yoyPorAno: (number | null)[] = porAno.map(({ ano, total }, i) => {
    if (i === 0) return null
    const prevAno      = porAno[i - 1].ano
    const isParcialAno = ano === anoAtual && mmddHoje < '12-31'
    const prevCompar   = isParcialAno ? (ytdPorAno[prevAno] ?? 0) : porAno[i - 1].total
    const totalCompar  = isParcialAno ? (ytdPorAno[ano] ?? 0) : total
    return prevCompar > 0 ? ((totalCompar - prevCompar) / prevCompar) * 100 : null
  })

  // Exclui o ano corrente parcial (YTD) da média — ainda não completou o ciclo
  const yoyValidos = yoyPorAno.filter((v, i): v is number => {
    if (v === null) return false
    const { ano } = porAno[i]
    const isParcialAno = ano === anoAtual && mmddHoje < '12-31'
    return !isParcialAno
  })
  const mediaYoy   = yoyValidos.length > 0
    ? yoyValidos.reduce((s, v) => s + v, 0) / yoyValidos.length
    : null

  return (
    <section className="bg-[#1a1f2e] rounded-xl border border-white/5 overflow-hidden">
      <h2 className="text-[15px] font-semibold text-white/70 px-4 pt-4 pb-3">
        Evolução por Ano
      </h2>

      {/* Cabeçalho — 5 colunas */}
      <div className="grid gap-2 px-4 pb-2 text-[11px] uppercase tracking-wide"
        style={{ gridTemplateColumns: '3rem 1fr 6rem 6rem 5.5rem', color: '#8b92a8' }}>
        <span>Ano</span>
        <span />
        <span className="text-right">Total (R$)</span>
        <span className="text-right">vs Anterior</span>
        <span className="text-right">vs Base</span>
      </div>

      <div className="divide-y divide-white/5">
        {porAno.map(({ ano, total }, i) => {
          const isBase       = i === 0
          const isParcialAno = !isBase && ano === anoAtual && mmddHoje < '12-31'
          const yoy          = yoyPorAno[i]
          // vs base: no ano parcial compara YTD vs YTD-base (proporcional ao período)
          const baseCompar = isParcialAno ? (ytdPorAno[anoBase] ?? 0) : baseTotal
          const totalVsBase = isParcialAno ? (ytdPorAno[ano] ?? 0) : total
          const vsBase = !isBase && baseCompar > 0
            ? ((totalVsBase - baseCompar) / baseCompar) * 100 : null

          const metaOk  = yoy !== null && yoy >= valorMeta
          const corYoy  = yoy === null ? '#8b92a8'
                        : yoy >= valorMeta ? '#00c896'
                        : yoy >= 0         ? '#f0b429'
                        : '#f87171'
          const barPct  = isBase ? 0 : yoy !== null
            ? Math.min(100, Math.max(0, (yoy / valorMeta) * 100)) : 0

          return (
            <div key={ano} className="px-4 py-3">
              <div className="grid gap-2 items-center text-[13px]"
                style={{ gridTemplateColumns: '3rem 1fr 6rem 6rem 5.5rem' }}>
                <span className="font-medium text-white/80">{ano}</span>
                <span className="flex items-center gap-1 flex-wrap">
                  {isBase && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-white/40">base</span>
                  )}
                  {isParcialAno && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/8 text-white/35">YTD</span>
                  )}
                  {metaOk && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                      style={{ background: '#00c89622', color: '#00c896' }}>✓ meta</span>
                  )}
                </span>
                <span className="text-right tabular-nums text-white/70">{formatBRL(total)}</span>
                <span className="text-right tabular-nums font-medium" style={{ color: corYoy }}>
                  {yoy === null ? '—' : `${yoy >= 0 ? '+' : ''}${yoy.toFixed(1)}%`}
                </span>
                <span className="text-right tabular-nums text-[12px]"
                  style={{ color: vsBase === null ? '#8b92a8' : vsBase >= 0 ? '#8b92a8' : '#f87171' }}>
                  {vsBase === null ? '—' : `${vsBase >= 0 ? '+' : ''}${vsBase.toFixed(1)}%`}
                </span>
              </div>

              {/* Barra YoY relativa à meta */}
              {!isBase && (
                <div className="mt-2 h-1 rounded-full bg-white/8">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: `${barPct}%`, background: corYoy }} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="px-4 py-2.5 border-t border-white/8 flex items-center justify-between">
        <div className="flex gap-4 text-[11px]" style={{ color: '#8b92a8' }}>
          <span>Meta: +{valorMeta.toFixed(1)}% ao ano</span>
          <span>Base ({anoBase}): {formatBRL(baseTotal)}</span>
        </div>
        {mediaYoy !== null && (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px]" style={{ color: '#8b92a8' }}>Média YoY:</span>
            <span className="text-[13px] font-semibold tabular-nums" style={{
              color: mediaYoy >= valorMeta ? '#00c896' : mediaYoy >= 0 ? '#f0b429' : '#f87171',
            }}>
              {mediaYoy >= 0 ? '+' : ''}{mediaYoy.toFixed(1)}%
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

// ── Barra de progresso principal ──────────────────────────────

function BarraProgresso({ objetivo }: { objetivo: Objetivo }) {
  const tipoCor: Record<string, string> = {
    SONHO: '#7F77DD', OBJETIVO: '#4da6ff', PROJETO: '#f0b429', CRESCIMENTO: '#00c896',
  }
  const statusCor: Record<string, string> = {
    EM_PROGRESSO: '#4da6ff', ATINGIDO: '#00c896', CANCELADO: '#636e72',
  }
  const baraCor = objetivo.status === 'ATINGIDO' ? '#00c896'
               : objetivo.status === 'CANCELADO' ? '#636e72'
               : tipoCor[objetivo.tipo] ?? '#4da6ff'

  const subtitulo = objetivo.tipo === 'OBJETIVO'
    ? `${formatBRL(objetivo.valor_atingido)}/mês de ${formatBRL(objetivo.valor_meta)}/mês`
    : objetivo.tipo === 'CRESCIMENTO'
    ? `${objetivo.valor_atingido >= 0 ? '+' : ''}${objetivo.valor_atingido.toFixed(1)}% de crescimento (meta: +${objetivo.valor_meta.toFixed(1)}%)`
    : `${formatBRL(objetivo.valor_atingido)} de ${formatBRL(objetivo.valor_meta)}`

  return (
    <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[13px]" style={{ color: '#8b92a8' }}>{subtitulo}</span>
        <span className="text-[22px] font-bold" style={{ color: baraCor }}>
          {objetivo.percentual}%
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/8">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${objetivo.percentual}%`, background: baraCor }} />
      </div>
      <div className="flex justify-between mt-2 text-[12px]" style={{ color: '#8b92a8' }}>
        <span>{formatData(objetivo.data_inicio)}</span>
        <span
          className="px-2 py-0.5 rounded-full text-[11px]"
          style={{ background: `${statusCor[objetivo.status]}22`, color: statusCor[objetivo.status] }}>
          {{EM_PROGRESSO: 'Em progresso', ATINGIDO: 'Atingido', CANCELADO: 'Cancelado'}[objetivo.status]}
        </span>
        <span>{formatData(objetivo.data_fim)}</span>
      </div>
    </section>
  )
}

// ── Seção: contas do SONHO ────────────────────────────────────

function ContasSonho({ objetivo }: { objetivo: Objetivo }) {
  const { contas } = useContas()

  const idsContas = objetivo.contas_sonho?.length
    ? objetivo.contas_sonho
    : (objetivo.conta_id ? [objetivo.conta_id] : [])

  const contasVinculadas = contas.filter(c => idsContas.includes(c.conta_id))

  if (contasVinculadas.length === 0) {
    if (objetivo.conta_nome) {
      return (
        <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
          <p className="text-[14px]" style={{ color: '#8b92a8' }}>
            Conta monitorada: <span className="text-white/80 font-medium">{objetivo.conta_nome}</span>
          </p>
        </section>
      )
    }
    return null
  }

  return (
    <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
      <h2 className="text-[15px] font-semibold text-white/70 mb-3">
        {contasVinculadas.length === 1 ? 'Conta monitorada' : `${contasVinculadas.length} contas monitoradas`}
      </h2>
      <div className="flex flex-col gap-2">
        {contasVinculadas.map(c => (
          <div key={c.conta_id} className="flex items-center justify-between text-[14px]">
            <span className="text-white/80 font-medium">{c.nome}</span>
            <span className="tabular-nums" style={{ color: '#8b92a8' }}>
              {formatBRL(c.saldo_atual)}
            </span>
          </div>
        ))}
        {contasVinculadas.length > 1 && (
          <div className="pt-2 mt-1 border-t border-white/8 flex justify-between text-[13px]">
            <span style={{ color: '#8b92a8' }}>Total</span>
            <span className="font-semibold text-white/80 tabular-nums">
              {formatBRL(contasVinculadas.reduce((s, c) => s + c.saldo_atual, 0))}
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

// ── Página principal ──────────────────────────────────────────

export default function ObjetivoDetalhe() {
  const { id }    = useParams<{ id: string }>()
  const navigate  = useNavigate()
  const { session } = useAuth()
  const uid       = session?.user?.id ?? null
  const qc        = useQueryClient()

  const { objetivo, loading, error } = useObjetivoDetalhe(id ?? null)
  const { editar, excluir, sincronizar } = useObjetivos()
  const { contas } = useContas()

  const [drawerAberto,  setDrawerAberto]  = useState(false)
  const [excluindo,     setExcluindo]     = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [toast,         setToast]         = useState<string | null>(null)

  // Transações — para OBJETIVO e CRESCIMENTO com categoria
  const { data: transacoes = [] } = useQuery({
    queryKey: ['objetivo-txs', uid, id],
    queryFn:  () => fetchTxsObjetivo(objetivo!),
    enabled:  !!uid && !!objetivo &&
              (objetivo.tipo === 'OBJETIVO' || objetivo.tipo === 'CRESCIMENTO') &&
              (!!objetivo.categorias_objetivo?.length || !!objetivo.categoria_id),
    staleTime: 60_000,
  })

  // Transações das contas monitoradas — para o gráfico de saldo do SONHO
  const { data: txsSonho = [] } = useQuery({
    queryKey: ['objetivo-saldo-txs', uid, id],
    queryFn:  () => fetchTxsContasSonho(objetivo!),
    enabled:  !!uid && !!objetivo && objetivo.tipo === 'SONHO' &&
              (!!objetivo.contas_sonho?.length || !!objetivo.conta_id),
    staleTime: 60_000,
  })

  const contasSonho = useMemo(() => {
    if (!objetivo) return []
    const ids = objetivo.contas_sonho?.length
      ? objetivo.contas_sonho
      : (objetivo.conta_id ? [objetivo.conta_id] : [])
    return contas.filter(c => ids.includes(c.conta_id))
  }, [contas, objetivo])

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  async function onSalvar(payload: EditarObjetivoInput): Promise<{ ok: boolean; erro: string | null }> {
    if (!id) return { ok: false, erro: 'ID inválido' }
    const res = await editar(id, payload)
    if (res.ok) {
      showToast('Objetivo atualizado!')
      qc.invalidateQueries({ queryKey: ['objetivo-txs', uid, id] })
    }
    return { ok: res.ok, erro: res.erro }
  }

  async function onExcluir() {
    if (!id) return
    const res = await excluir(id)
    if (res.ok) { navigate('/objetivos'); return }
    showToast(res.erro ?? 'Erro ao cancelar')
    setExcluindo(false)
  }

  async function onSincronizar() {
    setSincronizando(true)
    const res = await sincronizar()
    setSincronizando(false)
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ['objetivo-txs', uid, id] })
      showToast('Progresso atualizado!')
    } else {
      showToast(res.erro ?? 'Erro ao sincronizar')
    }
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <LoadingMascote texto="Carregando objetivo…" size={120} />
    </div>
  )

  if (error || !objetivo) return (
    <div className="p-6 text-center">
      <p className="text-red-400 mb-3">{error ?? 'Objetivo não encontrado'}</p>
      <Link to="/objetivos" className="text-av-blue hover:underline text-[14px]">← Voltar</Link>
    </div>
  )

  const tipoCor: Record<string, string> = {
    SONHO: '#7F77DD', OBJETIVO: '#4da6ff', PROJETO: '#f0b429', CRESCIMENTO: '#00c896',
  }
  const tipoLabel: Record<string, string> = {
    SONHO: '💭 Sonho', OBJETIVO: '🎯 Objetivo', PROJETO: '📦 Projeto', CRESCIMENTO: '📈 Crescimento',
  }
  const cor = tipoCor[objetivo.tipo] ?? '#4da6ff'

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto">

      {/* Breadcrumb + ações */}
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <button onClick={() => navigate('/objetivos')}
          className="flex items-center gap-1.5 text-[14px] transition-colors hover:text-white"
          style={{ color: '#8b92a8' }}>
          <ArrowLeft size={14} />
          Objetivos
        </button>
        <div className="flex items-center gap-2">
          <button onClick={onSincronizar} disabled={sincronizando}
            title="Recalcular progresso"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10
              text-[13px] hover:border-white/25 disabled:opacity-50 transition-all"
            style={{ color: '#8b92a8' }}>
            <RefreshCw size={12} className={sincronizando ? 'animate-spin' : ''} />
            Sincronizar
          </button>
          <button onClick={() => setDrawerAberto(true)}
            className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center
              hover:border-white/30 hover:text-white transition-colors"
            style={{ color: '#8b92a8' }}>
            <Pencil size={13} />
          </button>
          <button onClick={() => setExcluindo(true)}
            className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center
              hover:border-red-400/50 hover:text-red-400 transition-colors"
            style={{ color: '#8b92a8' }}>
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* Cabeçalho do objetivo */}
      <div className="flex items-center gap-3 mb-5">
        <div className="w-12 h-12 rounded-xl flex items-center justify-center text-[26px] flex-shrink-0"
          style={{ background: `${objetivo.cor}22`, border: `2px solid ${objetivo.cor}55` }}>
          {objetivo.icone}
        </div>
        <div className="min-w-0">
          <h1 className="text-[20px] font-bold text-white leading-tight">{objetivo.nome}</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-[12px] px-2 py-0.5 rounded-full font-medium"
              style={{ background: `${cor}22`, color: cor }}>
              {tipoLabel[objetivo.tipo]}
            </span>
            {objetivo.descricao && (
              <span className="text-[13px] truncate" style={{ color: '#8b92a8' }}>{objetivo.descricao}</span>
            )}
          </div>
        </div>
      </div>

      {/* Progresso */}
      <div className="mb-4">
        <BarraProgresso objetivo={objetivo} />
      </div>

      {/* Dias restantes + info */}
      {objetivo.status === 'EM_PROGRESSO' && (
        <p className="text-[13px] mb-4 text-center" style={{ color: '#8b92a8' }}>
          {objetivo.dias_restantes > 0
            ? `${objetivo.dias_restantes} dias restantes para ${formatData(objetivo.data_fim)}`
            : `Prazo encerrado em ${formatData(objetivo.data_fim)}`}
        </p>
      )}

      {/* Histórico de progresso (snapshots) — não no OBJETIVO, que usa
          a Evolução Mensal (derivada dos lançamentos) no lugar dos snapshots. */}
      {objetivo.tipo !== 'OBJETIVO' && objetivo.progresso && objetivo.progresso.length >= 2 && (
        <div className="mb-4">
          <HistoricoProgresso
            snapshots={objetivo.progresso}
            valorMeta={objetivo.valor_meta}
            cor={cor}
          />
        </div>
      )}

      {/* Seções específicas por tipo */}
      {objetivo.tipo === 'OBJETIVO' && (
        <div className="flex flex-col gap-4">
          <EvolucaoMensalObjetivo
            transacoes={transacoes}
            dataInicio={objetivo.data_inicio}
            valorMeta={objetivo.valor_meta}
            cor={cor}
          />
          <GraficoAtivos transacoes={transacoes} />
          <ResumoPorMes transacoes={transacoes} valorMeta={objetivo.valor_meta} />
        </div>
      )}

      {objetivo.tipo === 'CRESCIMENTO' && (
        <div className="flex flex-col gap-4">
          <GraficoCategoriasAno
            transacoes={transacoes}
            dataInicio={objetivo.data_inicio}
            dataFim={objetivo.data_fim}
            valorMeta={objetivo.valor_meta}
          />
          <ResumoPorAno
            transacoes={transacoes}
            dataInicio={objetivo.data_inicio}
            dataFim={objetivo.data_fim}
            valorMeta={objetivo.valor_meta}
          />
        </div>
      )}

      {objetivo.tipo === 'SONHO' && (objetivo.contas_sonho?.length > 0 || objetivo.conta_nome) && (
        <div className="flex flex-col gap-4">
          {contasSonho.length > 0 && (
            <EvolucaoSaldoSonho
              transacoes={txsSonho}
              contas={contasSonho}
              dataInicio={objetivo.data_inicio}
              valorMeta={objetivo.valor_meta}
            />
          )}
          <ContasSonho objetivo={objetivo} />
        </div>
      )}

      {objetivo.tipo === 'PROJETO' && objetivo.contas_projeto.length > 0 && (
        <section className="bg-[#1a1f2e] rounded-xl p-4 border border-white/5">
          <p className="text-[14px]" style={{ color: '#8b92a8' }}>
            {objetivo.contas_projeto.length} conta{objetivo.contas_projeto.length !== 1 ? 's' : ''} vinculada{objetivo.contas_projeto.length !== 1 ? 's' : ''} ao projeto
          </p>
        </section>
      )}

      {/* Drawer edição */}
      <DrawerObjetivo
        open={drawerAberto}
        objetivo={objetivo}
        onClose={() => setDrawerAberto(false)}
        onSalvar={p => onSalvar(p as EditarObjetivoInput)}
      />

      {/* Modal cancelamento */}
      {excluindo && (
        <ModalExcluir
          nome={objetivo.nome}
          mensagem="O objetivo será marcado como cancelado."
          onConfirmar={onExcluir}
          onCancelar={() => setExcluindo(false)}
          salvando={false}
        />
      )}

      <Toast msg={toast} />
    </div>
  )
}
