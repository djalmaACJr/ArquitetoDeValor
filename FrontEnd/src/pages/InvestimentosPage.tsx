import { useMemo, useState } from 'react'
import { TrendingUp, TrendingDown, Wallet, Coins, PieChart, Percent, Trophy } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Line, Bar, Doughnut } from 'react-chartjs-2'
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
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR } from '../lib/constants'
import type { InvestimentoDashboardTipo, InvestimentoRankingAtivo } from '../types'

ChartJS.register(ArcElement, Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement)

const MUTED = '#8b92a8'

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
function fmtMes(anoMes: string): string {
  const [ano, m] = anoMes.split('-')
  return `${MESES_PT[parseInt(m) - 1]}/${ano.slice(2)}`
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
  if (v > 0) return '#00c896'
  if (v < 0) return '#ff5c7a'
  return MUTED
}

function CardResumo({ icone, titulo, valor, cor }: {
  icone: React.ReactNode; titulo: string; valor: string; cor?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-[13px]" style={{ color: MUTED }}>
        {icone}{titulo}
      </div>
      <p className="mt-1.5 text-[20px] font-bold" style={{ color: cor ?? '#fff' }}>{valor}</p>
    </div>
  )
}

function LinhaTipo({ t }: { t: InvestimentoDashboardTipo }) {
  const cor   = TIPO_ATIVO_COR[t.tipo_ativo]
  const label = TIPO_ATIVO_LABEL[t.tipo_ativo]
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: cor }} />
          <span className="font-semibold text-white text-[15px]">{label}</span>
        </div>
        <div className="text-right">
          <p className="font-bold text-white text-[15px]">{formatBRL(t.valor_mercado)}</p>
          <p className="text-[12px]" style={{ color: corValor(t.ganho_perda) }}>
            {t.ganho_perda >= 0 ? '+' : ''}{formatBRL(t.ganho_perda)} ({t.rentabilidade_pct >= 0 ? '+' : ''}{t.rentabilidade_pct}%)
          </p>
        </div>
      </div>

      {/* Alocação atual x ideal */}
      <div className="mt-3">
        <div className="flex justify-between text-[12px] mb-1" style={{ color: MUTED }}>
          <span>Atual {t.percentual_atual}%</span>
          <span>Meta {t.percentual_ideal}%
            {t.percentual_ideal > 0 && (
              <span style={{ color: corValor(-t.desvio_pct) }}> ({t.desvio_pct >= 0 ? '+' : ''}{t.desvio_pct}%)</span>
            )}
          </span>
        </div>
        <div className="relative h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="absolute inset-y-0 left-0 rounded-full"
               style={{ width: `${Math.min(100, t.percentual_atual)}%`, background: cor }} />
          {t.percentual_ideal > 0 && (
            <div className="absolute inset-y-0 w-0.5 bg-white/70"
                 style={{ left: `${Math.min(100, t.percentual_ideal)}%` }} title={`Meta ${t.percentual_ideal}%`} />
          )}
        </div>
      </div>

      {t.dividendos > 0 && (
        <p className="mt-2 text-[12px]" style={{ color: MUTED }}>
          Dividendos: <span style={{ color: '#00c896' }}>{formatBRL(t.dividendos)}</span>
        </p>
      )}
    </div>
  )
}

// ── Gráficos da carteira ──────────────────────────────────────

function SecaoGraficos({ contaId, tipos }: { contaId: string | null; tipos: InvestimentoDashboardTipo[] }) {
  const { historico }  = useInvestimentosHistorico(contaId ? { conta_id: contaId } : {})
  const { dividendos } = useDividendos()

  // Evolução da carteira: soma dos snapshots por mês
  const evolucao = useMemo(() => {
    const porMes = new Map<string, number>()
    for (const h of historico) porMes.set(h.mes_ano, (porMes.get(h.mes_ano) ?? 0) + Number(h.valor_mercado))
    return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [historico])

  // Dividendos por mês (carteira inteira — endpoint não filtra por conta)
  const divPorMes = useMemo(() => {
    const porMes = new Map<string, number>()
    for (const d of dividendos) {
      const mes = d.data_pagamento.slice(0, 7)
      porMes.set(mes, (porMes.get(mes) ?? 0) + Number(d.valor))
    }
    return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)
  }, [dividendos])

  const temAlgo = evolucao.length >= 2 || divPorMes.length > 0 || tipos.length > 1
  if (!temAlgo) return null

  return (
    <>
      <h2 className="text-[15px] font-semibold text-white mt-6 mb-3">Gráficos</h2>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {evolucao.length >= 2 && (
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 lg:col-span-2">
            <h3 className="text-[13px] mb-3" style={{ color: MUTED }}>Evolução da carteira</h3>
            <Line
              data={{
                labels: evolucao.map(([mes]) => fmtMes(mes)),
                datasets: [{
                  label: 'Valor de mercado',
                  data: evolucao.map(([, v]) => v),
                  borderColor: '#3b82f6',
                  backgroundColor: '#3b82f622',
                  fill: true,
                  tension: 0.3,
                  pointRadius: evolucao.length <= 12 ? 4 : 2,
                  pointBackgroundColor: '#3b82f6',
                }],
              }}
              options={OPCOES_GRAFICO}
            />
          </section>
        )}

        {tipos.length > 0 && (
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
            <h3 className="text-[13px] mb-3" style={{ color: MUTED }}>Composição por tipo</h3>
            <Doughnut
              data={{
                labels: tipos.map((t) => TIPO_ATIVO_LABEL[t.tipo_ativo]),
                datasets: [{
                  data: tipos.map((t) => t.valor_mercado),
                  backgroundColor: tipos.map((t) => TIPO_ATIVO_COR[t.tipo_ativo]),
                  borderWidth: 0,
                }],
              }}
              options={{
                responsive: true,
                plugins: { legend: { position: 'bottom', labels: { color: MUTED, boxWidth: 10, font: { size: 11 } } } },
              }}
            />
          </section>
        )}

        {divPorMes.length > 0 && (
          <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 lg:col-span-3">
            <h3 className="text-[13px] mb-3" style={{ color: MUTED }}>Dividendos por mês</h3>
            <Bar
              data={{
                labels: divPorMes.map(([mes]) => fmtMes(mes)),
                datasets: [{
                  label: 'Dividendos',
                  data: divPorMes.map(([, v]) => v),
                  backgroundColor: '#00c896aa',
                  borderRadius: 4,
                }],
              }}
              options={{ ...OPCOES_GRAFICO, maintainAspectRatio: true, aspectRatio: 4 }}
            />
          </section>
        )}
      </div>
    </>
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

function SecaoRanking({ contaId }: { contaId: string | null }) {
  const { ranking, loading } = useInvestimentosRanking(contaId)
  const ativos = ranking?.ativos ?? []
  if (loading || ativos.length === 0) return null

  const emAlta     = ativos.filter((a) => a.rentabilidade_pct > 0).slice(0, 3)
  const emBaixa    = ativos.filter((a) => a.rentabilidade_pct < 0).sort((x, y) => x.rentabilidade_pct - y.rentabilidade_pct).slice(0, 3)
  const maiorYield = [...ativos].filter((a) => a.dividend_yield_pct > 0).sort((x, y) => y.dividend_yield_pct - x.dividend_yield_pct).slice(0, 3)
  const maiorPeso  = [...ativos].sort((x, y) => y.participacao_pct - x.participacao_pct).slice(0, 3)

  return (
    <>
      <h2 className="text-[15px] font-semibold text-white mt-6 mb-3">Destaques da carteira</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <CardRanking titulo="Em alta" icone={<TrendingUp size={14} />} itens={emAlta}
          metrica={(a) => ({ texto: `+${a.rentabilidade_pct}%`, cor: '#00c896' })} />
        <CardRanking titulo="Em prejuízo" icone={<TrendingDown size={14} />} itens={emBaixa}
          metrica={(a) => ({ texto: `${a.rentabilidade_pct}%`, cor: '#ff5c7a' })} />
        <CardRanking titulo="Maior dividend yield (12m)" icone={<Percent size={14} />} itens={maiorYield}
          metrica={(a) => ({ texto: `${a.dividend_yield_pct}%`, cor: '#00c896' })} />
        <CardRanking titulo="Maior participação" icone={<Trophy size={14} />} itens={maiorPeso}
          metrica={(a) => ({ texto: `${a.participacao_pct}%`, cor: '#fff' })} />
      </div>
    </>
  )
}

export default function InvestimentosPage() {
  const [contaId, setContaId] = useState<string>('')
  const { dashboard, loading, error } = useInvestimentosDashboard(contaId || null)
  const { contas } = useContas()
  // Só contas de investimento são relevantes na carteira
  const contasInvest = contas.filter((c) => c.tipo === 'INVESTIMENTO')

  if (loading) return <LoadingMascote />

  const tipos = dashboard?.tipos ?? []
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

      {/* Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <CardResumo icone={<Wallet size={15} />} titulo="Valor de mercado"
          valor={formatBRL(dashboard?.total_mercado ?? 0)} />
        <CardResumo icone={<Coins size={15} />} titulo="Custo total"
          valor={formatBRL(dashboard?.total_custo ?? 0)} />
        <CardResumo
          icone={(dashboard?.ganho_perda ?? 0) >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
          titulo="Ganho / Prejuízo"
          valor={`${(dashboard?.ganho_perda ?? 0) >= 0 ? '+' : ''}${formatBRL(dashboard?.ganho_perda ?? 0)}`}
          cor={corValor(dashboard?.ganho_perda ?? 0)} />
        <CardResumo icone={<Coins size={15} />} titulo="Dividendos"
          valor={formatBRL(dashboard?.total_dividendos ?? 0)} cor="#00c896" />
      </div>

      {/* Composição por tipo */}
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
          <h2 className="text-[15px] font-semibold text-white mb-3">Composição por tipo</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {tipos.map((t) => <LinhaTipo key={t.tipo_ativo} t={t} />)}
          </div>

          <SecaoRanking contaId={contaId || null} />

          <SecaoGraficos contaId={contaId || null} tipos={tipos} />
        </>
      )}
    </div>
  )
}
