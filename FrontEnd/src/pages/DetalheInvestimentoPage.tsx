import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Pencil, Coins, Wallet, TrendingUp, TrendingDown, Star } from 'lucide-react'
import { Line, Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, Tooltip, Legend,
  CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement,
} from 'chart.js'
import { useInvestimentoAtivo, useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes } from '../hooks/useInvestimentosPosicoes'
import { useInvestimentosHistorico } from '../hooks/useInvestimentosHistorico'
import { useDividendos } from '../hooks/useDividendos'
import { useInvestimentosOperacoes } from '../hooks/useInvestimentosOperacoes'
import { Drawer, Field, Input, BtnSalvar, BtnCancelar, Toast } from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import { formatBRL, formatData } from '../lib/utils'
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR } from '../lib/constants'

ChartJS.register(Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement)

const MUTED = '#8b92a8'
const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

function fmtMes(anoMes: string): string {
  const [ano, m] = anoMes.split('-')
  return `${MESES_PT[parseInt(m) - 1]}/${ano.slice(2)}`
}

function corValor(v: number): string {
  if (v > 0) return '#00c896'
  if (v < 0) return '#ff5c7a'
  return MUTED
}

const OPCOES_GRAFICO = {
  responsive: true,
  plugins: { legend: { display: false } },
  scales: {
    x: { ticks: { color: MUTED }, grid: { color: 'rgba(255,255,255,0.05)' } },
    y: { ticks: { color: MUTED }, grid: { color: 'rgba(255,255,255,0.05)' } },
  },
} as const

export default function DetalheInvestimentoPage() {
  const { id } = useParams<{ id: string }>()
  const ativoId = id ?? null
  const [toast, setToast] = useState<string | null>(null)
  const [editandoNota, setEditandoNota] = useState(false)

  const { ativo, loading, error } = useInvestimentoAtivo(ativoId)
  const { posicoes }  = useInvestimentosPosicoes(ativoId ? { ativo_id: ativoId } : {})
  const { historico } = useInvestimentosHistorico(ativoId ? { ativo_id: ativoId } : {})
  const { dividendos } = useDividendos(ativoId ? { ativo_id: ativoId } : {})
  const { operacoes } = useInvestimentosOperacoes()

  function showToast(m: string) { setToast(m); setTimeout(() => setToast(null), 3000) }

  // Resumo: custo das posições ativas; mercado = snapshot mais recente por conta
  const resumo = useMemo(() => {
    const ativas = posicoes.filter((p) => p.status === 'ATIVA')
    const custo = ativas.reduce((s, p) => s + Number(p.valor_custo), 0)
    const ultimoPorConta = new Map<string, { mes: string; valor: number }>()
    for (const h of historico) {
      const atual = ultimoPorConta.get(h.conta_id)
      if (!atual || h.mes_ano > atual.mes) ultimoPorConta.set(h.conta_id, { mes: h.mes_ano, valor: Number(h.valor_mercado) })
    }
    const contasComSnapshot = new Set(ultimoPorConta.keys())
    const custoSemSnapshot = ativas
      .filter((p) => !contasComSnapshot.has(p.conta_id))
      .reduce((s, p) => s + Number(p.valor_custo), 0)
    const mercado = [...ultimoPorConta.values()].reduce((s, v) => s + v.valor, 0) + custoSemSnapshot
    const totalDiv = dividendos.reduce((s, d) => s + Number(d.valor), 0)
    return { custo, mercado, ganho: mercado - custo, dividendos: totalDiv }
  }, [posicoes, historico, dividendos])

  // Evolução mensal (soma de todas as contas por mês, ordem cronológica)
  const evolucao = useMemo(() => {
    const porMes = new Map<string, number>()
    for (const h of historico) porMes.set(h.mes_ano, (porMes.get(h.mes_ano) ?? 0) + Number(h.valor_mercado))
    return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [historico])

  // Dividendos agregados por mês (últimos 12 com lançamento)
  const divPorMes = useMemo(() => {
    const porMes = new Map<string, number>()
    for (const d of dividendos) {
      const mes = d.data_pagamento.slice(0, 7)
      porMes.set(mes, (porMes.get(mes) ?? 0) + Number(d.valor))
    }
    return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-12)
  }, [dividendos])

  const operacoesDoAtivo = useMemo(() => {
    const posIds = new Set(posicoes.map((p) => p.id))
    return operacoes.filter((o) => posIds.has(o.posicao_id)).slice(0, 8)
  }, [operacoes, posicoes])

  if (loading) return <LoadingMascote />
  if (error || !ativo) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-[14px] text-red-300">
          {error ?? 'Ativo não encontrado'}
        </div>
        <Link to="/investimentos/ativos" className="inline-flex items-center gap-1.5 mt-4 text-[13px] text-white/70 hover:text-white">
          <ArrowLeft size={14} /> Voltar para meus ativos
        </Link>
      </div>
    )
  }

  const cor = TIPO_ATIVO_COR[ativo.tipo_ativo]

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/investimentos/ativos" className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
            <ArrowLeft size={15} />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[22px] font-bold text-white">{ativo.ticker}</h1>
              <span className="inline-flex items-center gap-1.5 text-[12px] px-2 py-0.5 rounded-full"
                style={{ background: `${cor}22`, color: cor }}>
                {TIPO_ATIVO_LABEL[ativo.tipo_ativo]}
              </span>
            </div>
            <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>{ativo.nome}</p>
          </div>
        </div>
        <button onClick={() => setEditandoNota(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
          <Star size={14} style={{ color: '#f0b429' }} />
          Nota: {ativo.nota_usuario ?? '—'}
          <Pencil size={12} style={{ color: MUTED }} />
        </button>
      </div>

      <Toast msg={toast} />

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <CardMini icone={<Wallet size={14} />} titulo="Valor de mercado" valor={formatBRL(resumo.mercado)} />
        <CardMini icone={<Coins size={14} />} titulo="Custo" valor={formatBRL(resumo.custo)} />
        <CardMini icone={resumo.ganho >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
          titulo="Ganho / Prejuízo"
          valor={`${resumo.ganho >= 0 ? '+' : ''}${formatBRL(resumo.ganho)}`} cor={corValor(resumo.ganho)} />
        <CardMini icone={<Coins size={14} />} titulo="Dividendos" valor={formatBRL(resumo.dividendos)} cor="#00c896" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Evolução do valor de mercado */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-[14px] font-semibold text-white/80 mb-3">Evolução mensal</h2>
          {evolucao.length < 2 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>
              Registre o valor de mercado de pelo menos 2 meses para ver o gráfico.
            </p>
          ) : (
            <Line
              data={{
                labels: evolucao.map(([mes]) => fmtMes(mes)),
                datasets: [{
                  label: 'Valor de mercado',
                  data: evolucao.map(([, v]) => v),
                  borderColor: cor,
                  backgroundColor: `${cor}22`,
                  fill: true,
                  tension: 0.3,
                  pointRadius: evolucao.length <= 12 ? 4 : 2,
                  pointBackgroundColor: cor,
                }],
              }}
              options={OPCOES_GRAFICO}
            />
          )}
        </section>

        {/* Rentabilidade mensal */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-[14px] font-semibold text-white/80 mb-3">Rentabilidade do mês (%)</h2>
          {historico.length < 2 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>
              Sem dados suficientes de variação mensal.
            </p>
          ) : (
            <Bar
              data={(() => {
                const ordenado = [...historico].sort((a, b) => a.mes_ano.localeCompare(b.mes_ano))
                return {
                  labels: ordenado.map((h) => fmtMes(h.mes_ano)),
                  datasets: [{
                    label: 'Variação %',
                    data: ordenado.map((h) => h.variacao_percentual),
                    backgroundColor: ordenado.map((h) => h.variacao_percentual >= 0 ? '#00c896aa' : '#ff5c7aaa'),
                    borderRadius: 4,
                  }],
                }
              })()}
              options={OPCOES_GRAFICO}
            />
          )}
        </section>

        {/* Dividendos mensais */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-[14px] font-semibold text-white/80 mb-3">Dividendos por mês</h2>
          {divPorMes.length === 0 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>Nenhum dividendo lançado para este ativo.</p>
          ) : (
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
              options={OPCOES_GRAFICO}
            />
          )}
        </section>

        {/* Posições */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-[14px] font-semibold text-white/80 mb-3">Posições</h2>
          {posicoes.length === 0 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>Nenhuma posição neste ativo.</p>
          ) : (
            <div className="space-y-2">
              {posicoes.map((p) => (
                <div key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <div>
                    <p className="text-white font-medium">{p.contas?.nome ?? '—'}
                      {p.status === 'ENCERRADA' && <span className="ml-2 text-[11px]" style={{ color: MUTED }}>(encerrada)</span>}
                    </p>
                    <p style={{ color: MUTED }}>{p.quantidade} × {formatBRL(p.preco_custo)} · {formatData(p.data_compra)}</p>
                  </div>
                  <span className="text-white font-semibold">{formatBRL(p.valor_custo)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Últimos dividendos */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-[14px] font-semibold text-white/80 mb-3">Últimos dividendos</h2>
          {dividendos.length === 0 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>Nenhum dividendo lançado.</p>
          ) : (
            <div className="space-y-2">
              {dividendos.slice(0, 8).map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <div>
                    <p className="text-white font-medium">{d.inv_tipos_dividendo?.nome ?? 'Dividendo'}</p>
                    <p style={{ color: MUTED }}>{formatData(d.data_pagamento)}
                      {d.transacoes?.status === 'PROJECAO' && <span className="ml-1.5" style={{ color: '#ffb74d' }}>· projetado</span>}
                    </p>
                  </div>
                  <span className="font-semibold" style={{ color: '#00c896' }}>{formatBRL(d.valor)}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Operações recentes */}
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
          <h2 className="text-[14px] font-semibold text-white/80 mb-3">Operações recentes</h2>
          {operacoesDoAtivo.length === 0 ? (
            <p className="text-[13px] py-6 text-center" style={{ color: MUTED }}>Nenhuma operação registrada.</p>
          ) : (
            <div className="space-y-2">
              {operacoesDoAtivo.map((o) => (
                <div key={o.id} className="flex items-center justify-between gap-2 text-[13px]">
                  <div>
                    <p className="text-white font-medium">{o.tipo_operacao}</p>
                    <p style={{ color: MUTED }}>{o.quantidade} × {formatBRL(o.preco_unitario)} · {formatData(o.data_operacao)}</p>
                  </div>
                  <span className="text-white font-semibold">{formatBRL(o.valor_total)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {editandoNota && (
        <DrawerNota ativoId={ativo.id} notaAtual={ativo.nota_usuario}
          onClose={() => setEditandoNota(false)} onToast={showToast} />
      )}
    </div>
  )
}

function CardMini({ icone, titulo, valor, cor }: {
  icone: React.ReactNode; titulo: string; valor: string; cor?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-[13px]" style={{ color: MUTED }}>{icone}{titulo}</div>
      <p className="mt-1.5 text-[18px] font-bold" style={{ color: cor ?? '#fff' }}>{valor}</p>
    </div>
  )
}

// ── Drawer: editar nota do usuário ─────────────────────────────

function DrawerNota({ ativoId, notaAtual, onClose, onToast }: {
  ativoId: string; notaAtual: number | null; onClose: () => void; onToast: (m: string) => void
}) {
  const { editar } = useInvestimentosAtivos()
  const [nota, setNota] = useState(notaAtual != null ? String(notaAtual) : '')
  const [salvando, setSalvando] = useState(false)

  async function salvar() {
    const n = nota === '' ? null : Number(nota)
    if (n !== null && (!(n >= 0) || n > 10)) { onToast('Nota deve estar entre 0 e 10'); return }
    setSalvando(true)
    const res = await editar(ativoId, { nota_usuario: n })
    setSalvando(false)
    if (res.ok) { onToast('Nota atualizada.'); onClose() }
    else onToast(res.erro ?? 'Erro ao salvar nota')
  }

  return (
    <Drawer open onClose={onClose} titulo="Nota do ativo" subtitulo="Sua avaliação pessoal (0 a 10)"
      rodape={<><BtnCancelar onClick={onClose} /><BtnSalvar editando onClick={salvar} salvando={salvando} /></>}>
      <Field label="Nota (0–10)">
        <Input type="number" min={0} max={10} step={0.5} value={nota}
          onChange={(e) => setNota(e.target.value)} placeholder="—" />
      </Field>
      <p className="text-[12px]" style={{ color: MUTED }}>
        Deixe em branco para remover a nota. Em breve a nota poderá ser calculada pelo questionário de avaliação.
      </p>
    </Drawer>
  )
}
