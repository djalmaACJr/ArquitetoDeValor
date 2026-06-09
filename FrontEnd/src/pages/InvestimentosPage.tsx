import { useState } from 'react'
import { TrendingUp, TrendingDown, Wallet, Coins, PieChart } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useInvestimentosDashboard } from '../hooks/useInvestimentosDashboard'
import { useContas } from '../hooks/useContas'
import LoadingMascote from '../components/ui/LoadingMascote'
import { formatBRL } from '../lib/utils'
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR } from '../lib/constants'
import type { InvestimentoDashboardTipo } from '../types'

const MUTED = '#8b92a8'

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

export default function InvestimentosPage() {
  const [contaId, setContaId] = useState<string>('')
  const { dashboard, loading, error } = useInvestimentosDashboard(contaId || null)
  const { contas } = useContas()

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
          <select
            value={contaId}
            onChange={(e) => setContaId(e.target.value)}
            className="px-3 py-2 rounded-lg border border-white/10 bg-white/[0.02] text-[13px] text-white"
          >
            <option value="">Todas as contas</option>
            {contas.map((c) => (
              <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>
            ))}
          </select>
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
        </>
      )}
    </div>
  )
}
