import { useMemo, useState } from 'react'
import {
  TrendingUp, TrendingDown, Wallet, Coins, PieChart, Percent, Trophy,
  HandCoins, BarChart3, ChevronDown, ChevronUp, Calendar,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, Doughnut } from 'react-chartjs-2'
import {
  Chart as ChartJS, ArcElement, Tooltip, Legend,
  CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement,
} from 'chart.js'
import { useInvestimentosDashboard, useInvestimentosRanking } from '../hooks/useInvestimentosDashboard'
import { useInvestimentosHistorico } from '../hooks/useInvestimentosHistorico'
import { useDividendos } from '../hooks/useDividendos'
import { useContas } from '../hooks/useContas'
import LoadingMascote from '../components/ui/LoadingMascote'
import { SelectDark } from '../components/ui/shared'
import { formatBRL } from '../lib/utils'
import { TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL, TIPO_ATIVO_COR } from '../lib/constants'
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

function EvolucaoPatrimonio({ contaId }: { contaId: string | null }) {
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
            ],
          }}
          options={{
            ...OPCOES_GRAFICO,
            plugins: { legend: { display: true, position: 'top', labels: { color: MUTED, boxWidth: 12, font: { size: 11 } } } },
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

function AtivosNaCarteira({ tipos }: { tipos: InvestimentoDashboardTipo[] }) {
  const ordenados = [...tipos].sort((a, b) => b.percentual_atual - a.percentual_atual)
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <h2 className="text-[15px] font-semibold text-white mb-3">Ativos na Carteira</h2>
      <div className="flex items-center gap-4">
        <div className="w-1/2 max-w-[180px]">
          <Doughnut
            data={{
              labels: ordenados.map((t) => TIPO_ATIVO_LABEL[t.tipo_ativo]),
              datasets: [{
                data: ordenados.map((t) => t.valor_mercado),
                backgroundColor: ordenados.map((t) => TIPO_ATIVO_COR[t.tipo_ativo]),
                borderWidth: 0,
              }],
            }}
            options={{ responsive: true, cutout: '55%', plugins: { legend: { display: false } } }}
          />
        </div>
        <div className="flex-1 space-y-1.5">
          {ordenados.map((t) => (
            <div key={t.tipo_ativo} className="flex items-center justify-between gap-2 text-[12px]">
              <span className="flex items-center gap-1.5 text-white/80">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: TIPO_ATIVO_COR[t.tipo_ativo] }} />
                {TIPO_ATIVO_LABEL[t.tipo_ativo]}
              </span>
              <span className="font-semibold text-white">{t.percentual_atual.toFixed(2).replace('.', ',')}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Lista expansível por tipo ─────────────────────────────────

function LinhaTipoExpansivel({ t, ativos }: {
  t: InvestimentoDashboardTipo; ativos: InvestimentoRankingAtivo[]
}) {
  const [aberto, setAberto] = useState(false)
  const cor = TIPO_ATIVO_COR[t.tipo_ativo]
  const variacaoPct = t.valor_custo > 0 ? (t.ganho_perda / t.valor_custo) * 100 : 0

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <button onClick={() => setAberto(!aberto)} className="w-full px-4 py-3 grid grid-cols-2 md:grid-cols-4 gap-3 items-center text-left">
        {/* Tipo + contagem */}
        <div>
          <p className="font-semibold text-[15px]" style={{ color: cor }}>{TIPO_ATIVO_LABEL[t.tipo_ativo]}</p>
          <p className="text-[12px]" style={{ color: MUTED }}>{ativos.length} {ativos.length === 1 ? 'Ativo' : 'Ativos'}</p>
        </div>

        {/* Variação total */}
        <div className="text-right md:text-center">
          <p className="text-[12px] inline-flex items-center gap-1" style={{ color: corValor(t.ganho_perda) }}>
            <SetaVariacao v={t.ganho_perda} size={11} /> Variação Total
          </p>
          <p className="text-[13px] font-medium" style={{ color: corValor(t.ganho_perda) }}>
            {fmtPct(variacaoPct)} ({formatBRL(t.ganho_perda)})
          </p>
        </div>

        {/* Dividendos do tipo */}
        <div className="hidden md:block text-center">
          <p className="text-[12px]" style={{ color: MUTED }}>Dividendos</p>
          <p className="text-[13px] font-medium" style={{ color: t.dividendos > 0 ? VERDE : MUTED }}>
            {formatBRL(t.dividendos)}
          </p>
        </div>

        {/* Valor + participação */}
        <div className="flex items-center justify-end gap-2">
          <div className="text-right">
            <p className="text-[13px] font-semibold text-white">{formatBRL(t.valor_mercado)}</p>
            <div className="flex items-center gap-1.5 justify-end">
              <div className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, t.percentual_atual)}%`, background: cor }} />
              </div>
              <span className="text-[12px] font-semibold text-white">{t.percentual_atual.toFixed(2).replace('.', ',')}%</span>
            </div>
          </div>
          {aberto ? <ChevronUp size={15} style={{ color: MUTED }} /> : <ChevronDown size={15} style={{ color: MUTED }} />}
        </div>
      </button>

      {aberto && (
        <div className="border-t border-white/5 px-4 py-3 space-y-3">
          {/* Alocação atual × meta */}
          {t.percentual_ideal > 0 && (
            <div>
              <div className="flex justify-between text-[12px] mb-1" style={{ color: MUTED }}>
                <span>Alocação atual {t.percentual_atual}%</span>
                <span>Meta {t.percentual_ideal}%
                  <span style={{ color: corValor(-t.desvio_pct) }}> ({t.desvio_pct >= 0 ? '+' : ''}{t.desvio_pct}%)</span>
                </span>
              </div>
              <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
                <div className="absolute inset-y-0 left-0 rounded-full"
                     style={{ width: `${Math.min(100, t.percentual_atual)}%`, background: cor }} />
                <div className="absolute inset-y-0 w-0.5 bg-white/70"
                     style={{ left: `${Math.min(100, t.percentual_ideal)}%` }} title={`Meta ${t.percentual_ideal}%`} />
              </div>
            </div>
          )}

          {/* Ativos do tipo */}
          {ativos.length === 0 ? (
            <p className="text-[13px] text-center py-2" style={{ color: MUTED }}>Nenhum ativo com posição ativa neste tipo.</p>
          ) : (
            <div className="space-y-1.5">
              {ativos.map((a) => (
                <Link key={a.ativo_id} to={`/investimentos/ativos/${a.ativo_id}`}
                  className="flex items-center justify-between gap-2 text-[13px] rounded-lg px-2 py-1.5 hover:bg-white/[0.04]">
                  <span className="flex items-center gap-2 min-w-0">
                    <span className="text-white font-semibold">{a.ticker}</span>
                    <span className="truncate" style={{ color: MUTED }}>{a.nome}</span>
                  </span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span style={{ color: corValor(a.rentabilidade_pct) }}>{fmtPct(a.rentabilidade_pct)}</span>
                    <span className="text-white font-medium">{formatBRL(a.valor_mercado)}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mt-6">
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
  const { dashboard, loading, error } = useInvestimentosDashboard(contaId || null)
  const { ranking } = useInvestimentosRanking(contaId || null)
  const { dividendos } = useDividendos()
  const { contas } = useContas()
  // Só contas de investimento ATIVAS são relevantes na carteira
  const contasInvest = contas.filter((c) => c.tipo === 'INVESTIMENTO' && c.ativa)

  // Proventos recebidos nos últimos 12 meses
  const proventos12m = useMemo(() => {
    const corte = new Date()
    corte.setMonth(corte.getMonth() - 12)
    const corteISO = corte.toISOString().split('T')[0]
    return dividendos
      .filter((d) => d.data_pagamento >= corteISO)
      .reduce((s, d) => s + Number(d.valor), 0)
  }, [dividendos])

  if (loading) return <LoadingMascote />

  const tipos = dashboard?.tipos ?? []
  const ativosRanking = ranking?.ativos ?? []
  const vazio = tipos.length === 0

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white">Investimentos</h1>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
            Visão consolidada da carteira por tipo de ativo
          </p>
        </div>
        <div className="flex items-center gap-2">
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
          <Link to="/investimentos/dividendos"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10
              text-[13px] text-white transition-all hover:border-white/25">
            <Coins size={15} /> Dividendos
          </Link>
          <Link to="/investimentos/ativos"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10
              text-[13px] text-white transition-all hover:border-white/25">
            <Wallet size={15} /> Meus ativos
          </Link>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] text-red-300">
          {error}
        </div>
      )}

      {vazio ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
          <PieChart size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
          <p className="text-white font-medium">Sua carteira está vazia</p>
          <p className="text-[13px] mt-1" style={{ color: MUTED }}>
            Cadastre ativos e posições para ver a composição por tipo.
          </p>
          <Link to="/investimentos/ativos"
            className="inline-flex items-center gap-1.5 mt-4 px-4 py-2 rounded-lg text-[13px] font-medium text-white"
            style={{ background: '#3b82f6' }}>
            <Wallet size={15} /> Cadastrar ativos
          </Link>
        </div>
      ) : (
        <>
          {/* Cards superiores */}
          <CardsResumo
            d={{
              total_custo:      dashboard?.total_custo ?? 0,
              total_mercado:    dashboard?.total_mercado ?? 0,
              ganho_perda:      dashboard?.ganho_perda ?? 0,
              total_dividendos: dashboard?.total_dividendos ?? 0,
            }}
            proventos12m={proventos12m}
          />

          {/* Evolução + composição */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-5">
            <EvolucaoPatrimonio contaId={contaId || null} />
            <AtivosNaCarteira tipos={tipos} />
          </div>

          {/* Lista expansível por tipo */}
          <div className="space-y-2">
            {tipos.map((t) => (
              <LinhaTipoExpansivel key={t.tipo_ativo} t={t}
                ativos={ativosRanking.filter((a) => a.tipo_ativo === t.tipo_ativo)} />
            ))}
          </div>

          <SecaoRanking ativos={ativosRanking} />

          <DividendosPorMes dividendos={dividendos} />
        </>
      )}
    </div>
  )
}
