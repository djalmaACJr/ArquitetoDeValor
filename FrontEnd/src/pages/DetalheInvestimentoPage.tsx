import { useMemo, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Pencil, Coins, Wallet, TrendingUp, TrendingDown, Star, Trash2 } from 'lucide-react'
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
import { useInvestimentosDashboard } from '../hooks/useInvestimentosDashboard'
import { usePtax } from '../hooks/usePtax'
import { Drawer, BtnSalvar, BtnCancelar, Toast, ModalExcluir, LogoAtivo } from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import { formatBRL, formatData } from '../lib/utils'
import {
  TIPO_ATIVO_LABEL, TIPO_ATIVO_COR,
  INDEXADOR_RF_LABEL, INDEXADOR_RF_DESCRICAO, SUBTIPO_RF_INFO, FII_CATEGORIA_INFO,
  setorLabel,
} from '../lib/constants'
import { calcularNota, recomendacaoCompra } from '../lib/questionarioAtivos'
import { CRITERIOS_QUESTAO, CRITERIO_LABEL } from '../lib/constants'
import { useInvQuestionarios } from '../hooks/useInvQuestionarios'
import { useInvPerfil } from '../hooks/useInvPerfil'
import { useInvPesos } from '../hooks/useInvPesos'
import type { InvestimentoAtivo, QuestionarioRespostas, PerguntaAvaliacao, CriterioQuestao } from '../types'

ChartJS.register(Tooltip, Legend, CategoryScale, LinearScale, PointElement, LineElement, Filler, BarElement)

const MUTED = '#8b92a8'
const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']

const fmtUSD = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v)

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
  const navigate = useNavigate()
  const ativoId = id ?? null
  const [toast, setToast] = useState<string | null>(null)
  const [editandoNota, setEditandoNota] = useState(false)
  const [excluindo, setExcluindo] = useState(false)
  const [salvandoExclusao, setSalvandoExclusao] = useState(false)

  const { ativo, loading, error } = useInvestimentoAtivo(ativoId)
  const { excluir } = useInvestimentosAtivos()
  const { posicoes }  = useInvestimentosPosicoes(ativoId ? { ativo_id: ativoId } : {})
  const { historico } = useInvestimentosHistorico(ativoId ? { ativo_id: ativoId } : {})
  const { dividendos } = useDividendos(ativoId ? { ativo_id: ativoId } : {})
  const { operacoes } = useInvestimentosOperacoes()
  const { dashboard } = useInvestimentosDashboard()

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

  // ── Conversão cambial (ativos em moeda estrangeira) ────────────
  // Valores das posições estão na moeda do ativo (ex.: USD). Convertemos
  // para BRL no front com o PTAX: custo pela cotação da DATA DA COMPRA;
  // mercado/dividendos pela cotação aplicável (atual / data do pagamento).
  const moeda = (ativo?.moeda ?? 'BRL').toUpperCase()
  const ehMoedaEstrangeira = moeda !== 'BRL'
  const datasPtax = useMemo(
    () => [...new Set(posicoes.map((p) => p.data_compra).filter(Boolean))],
    [posicoes],
  )
  const { atual: ptaxAtual, atualData: ptaxData, taxaEm } = usePtax(datasPtax, ehMoedaEstrangeira)

  const resumoConvertido = useMemo(() => {
    if (!ehMoedaEstrangeira) return null
    const taxaAtual = ptaxAtual ?? 0
    const ativas = posicoes.filter((p) => p.status === 'ATIVA')
    const custo = ativas.reduce((s, p) => s + Number(p.valor_custo) * (taxaEm(p.data_compra) ?? taxaAtual), 0)
    // mercado: snapshot mais recente por conta (na moeda do ativo) × PTAX atual;
    // posições sem snapshot caem para o custo convertido na data da compra.
    const ultimoPorConta = new Map<string, number>()
    const mesPorConta = new Map<string, string>()
    for (const h of historico) {
      const m = mesPorConta.get(h.conta_id)
      if (!m || h.mes_ano > m) { mesPorConta.set(h.conta_id, h.mes_ano); ultimoPorConta.set(h.conta_id, Number(h.valor_mercado)) }
    }
    let mercado = [...ultimoPorConta.values()].reduce((s, v) => s + v * taxaAtual, 0)
    for (const p of ativas) {
      if (!ultimoPorConta.has(p.conta_id)) mercado += Number(p.valor_custo) * (taxaEm(p.data_compra) ?? taxaAtual)
    }
    const divs = dividendos.reduce((s, d) => s + Number(d.valor) * (taxaEm(d.data_pagamento) ?? taxaAtual), 0)
    return { custo, mercado, ganho: mercado - custo, dividendos: divs }
  }, [ehMoedaEstrangeira, posicoes, historico, dividendos, taxaEm, ptaxAtual])

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

  async function confirmarExclusao() {
    if (!ativo) return
    setSalvandoExclusao(true)
    const res = await excluir(ativo.id)
    setSalvandoExclusao(false)
    if (res.ok) navigate('/investimentos/ativos')
    else { setExcluindo(false); showToast(res.erro ?? 'Erro ao excluir o ativo') }
  }

  // Recomendação de compra: nota do usuário × desvio da alocação ideal do tipo
  const tipoDash = dashboard?.tipos.find((t) => t.tipo_ativo === ativo.tipo_ativo)
  const recomendacao = recomendacaoCompra(
    ativo.nota_usuario,
    tipoDash && tipoDash.percentual_ideal > 0 ? tipoDash.desvio_pct : null,
  )
  const COR_RECOMENDACAO = { COMPRAR: '#00c896', NEUTRO: '#8b92a8', AGUARDAR: '#ffb74d' } as const

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/investimentos/ativos" className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
            <ArrowLeft size={15} />
          </Link>
          <LogoAtivo url={ativo.logo_url} size={36} />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[22px] font-bold text-white">{ativo.ticker}</h1>
              <span className="inline-flex items-center gap-1.5 text-[12px] px-2 py-0.5 rounded-full"
                style={{ background: `${cor}22`, color: cor }}>
                {TIPO_ATIVO_LABEL[ativo.tipo_ativo]}
              </span>
              {setorLabel(ativo.setor) && (
                <span className="inline-flex items-center text-[12px] px-2 py-0.5 rounded-full border border-white/15"
                  style={{ color: MUTED }}>
                  {setorLabel(ativo.setor)}
                </span>
              )}
            </div>
            <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>{ativo.nome}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {recomendacao && (
            <span title={recomendacao.motivo}
              className="inline-flex items-center text-[12px] px-2.5 py-1 rounded-full font-medium"
              style={{ background: `${COR_RECOMENDACAO[recomendacao.recomendacao]}22`, color: COR_RECOMENDACAO[recomendacao.recomendacao] }}>
              {recomendacao.recomendacao === 'COMPRAR' ? 'Comprar' : recomendacao.recomendacao === 'AGUARDAR' ? 'Aguardar' : 'Neutro'}
            </span>
          )}
          <button onClick={() => setEditandoNota(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
            <Star size={14} style={{ color: '#f0b429' }} />
            Nota: {ativo.nota_usuario ?? '—'}
            <Pencil size={12} style={{ color: MUTED }} />
          </button>
          <button onClick={() => setExcluindo(true)} title="Excluir ativo"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border text-[13px] transition-colors hover:bg-red-400/10"
            style={{ borderColor: 'rgba(248,113,113,0.4)', color: '#ff5c7a' }}>
            <Trash2 size={14} /> Excluir
          </button>
        </div>
      </div>

      {recomendacao && (
        <p className="text-[12px] -mt-2 mb-4 text-right" style={{ color: MUTED }}>{recomendacao.motivo}</p>
      )}

      <Toast msg={toast} />

      {/* Cotação do dólar (ativos em moeda estrangeira) */}
      {ehMoedaEstrangeira && (
        <div className="mb-4 flex items-center gap-2 text-[13px] rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2" style={{ color: MUTED }}>
          <span className="font-medium text-white/80">Moeda: {moeda}</span>
          <span>·</span>
          {ptaxAtual != null ? (
            <span>Dólar PTAX{ptaxData ? ` (${formatData(ptaxData)})` : ''}: <span className="text-white/90 font-medium">{formatBRL(ptaxAtual)}</span></span>
          ) : (
            <span>Cotação PTAX indisponível no momento.</span>
          )}
        </div>
      )}

      {/* Cards de resumo — em BRL (com o valor original em USD quando estrangeiro) */}
      {(() => {
        const r = resumoConvertido ?? resumo
        const sub = (v: number) => ehMoedaEstrangeira ? fmtUSD(v) : undefined
        return (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
            <CardMini icone={<Wallet size={14} />} titulo="Valor de mercado" valor={formatBRL(r.mercado)} sub={sub(resumo.mercado)} />
            <CardMini icone={<Coins size={14} />} titulo="Custo" valor={formatBRL(r.custo)} sub={sub(resumo.custo)} />
            <CardMini icone={r.ganho >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              titulo="Ganho / Prejuízo"
              valor={`${r.ganho >= 0 ? '+' : ''}${formatBRL(r.ganho)}`} cor={corValor(r.ganho)} sub={sub(resumo.ganho)} />
            <CardMini icone={<Coins size={14} />} titulo="Dividendos" valor={formatBRL(r.dividendos)} cor="#00c896" sub={sub(resumo.dividendos)} />
          </div>
        )
      })()}

      {/* Características do título (renda fixa / Tesouro) e do FII */}
      <CaracteristicasAtivo ativo={ativo} />

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
        <DrawerQuestionario ativo={ativo}
          onClose={() => setEditandoNota(false)} onToast={showToast} />
      )}

      {excluindo && (
        <ModalExcluir nome={ativo.ticker}
          mensagem="Isso remove o ativo e todas as suas posições, operações e dividendos."
          onConfirmar={confirmarExclusao} onCancelar={() => setExcluindo(false)} salvando={salvandoExclusao} />
      )}
    </div>
  )
}

// ── Características do título (RF/Tesouro) ou do FII ──────────

function ItemCaracteristica({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <div>
      <p className="text-[12px]" style={{ color: MUTED }}>{rotulo}</p>
      <p className="text-[13px] font-medium" style={{ color: cor ?? '#fff' }}>{valor}</p>
    </div>
  )
}

function CaracteristicasAtivo({ ativo }: { ativo: InvestimentoAtivo }) {
  const ehRF  = ativo.tipo_ativo === 'RENDA_FIXA' || ativo.tipo_ativo === 'TESOURO_DIRETO'
  const ehFII = ativo.tipo_ativo === 'FII'
  if (!ehRF && !ehFII) return null

  if (ehFII) {
    if (!ativo.fii_categoria) return null
    const info = FII_CATEGORIA_INFO[ativo.fii_categoria]
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
        <h2 className="text-[14px] font-semibold text-white/80 mb-3">
          Categoria do fundo: <span style={{ color: TIPO_ATIVO_COR.FII }}>{info.label}</span>
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <ItemCaracteristica rotulo="O que compra" valor={info.compra} />
          <ItemCaracteristica rotulo="Fonte de lucro" valor={info.fonteLucro} />
          <ItemCaracteristica rotulo="Nível de risco" valor={info.risco}
            cor={info.risco.startsWith('Alto') ? '#ff5c7a' : info.risco.startsWith('Baixo') ? '#00c896' : '#f0b429'} />
          <ItemCaracteristica rotulo="Principal vantagem" valor={info.vantagem} />
        </div>
      </section>
    )
  }

  const temAlgo = ativo.rf_subtipo || ativo.rf_indexador || ativo.rf_taxa || ativo.rf_vencimento || ativo.rf_emissor
  if (!temAlgo) return null
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
      <h2 className="text-[14px] font-semibold text-white/80 mb-3">Características do título</h2>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {ativo.rf_subtipo && (
          <ItemCaracteristica rotulo="Tipo" valor={SUBTIPO_RF_INFO[ativo.rf_subtipo].label} />
        )}
        {ativo.rf_indexador && (
          <ItemCaracteristica rotulo="Rentabilidade"
            valor={`${INDEXADOR_RF_LABEL[ativo.rf_indexador]}${ativo.rf_taxa ? ` · ${ativo.rf_taxa}` : ''}`} />
        )}
        {ativo.rf_emissor && <ItemCaracteristica rotulo="Emissor" valor={ativo.rf_emissor} />}
        {ativo.rf_vencimento && <ItemCaracteristica rotulo="Vencimento" valor={formatData(ativo.rf_vencimento)} />}
        <ItemCaracteristica rotulo="Garantia do FGC"
          valor={ativo.rf_garantia_fgc ? 'Sim (até R$ 250 mil)' : ativo.rf_subtipo === 'TESOURO' ? 'Não (garantia soberana)' : 'Não'}
          cor={ativo.rf_garantia_fgc || ativo.rf_subtipo === 'TESOURO' ? '#00c896' : '#f0b429'} />
        <ItemCaracteristica rotulo="Imposto de Renda"
          valor={ativo.rf_isento_ir ? 'Isento' : (ativo.rf_subtipo ? SUBTIPO_RF_INFO[ativo.rf_subtipo].obsIR : 'Tabela regressiva')}
          cor={ativo.rf_isento_ir ? '#00c896' : undefined} />
      </div>
      {ativo.rf_indexador && (
        <p className="text-[12px] mt-3" style={{ color: MUTED }}>
          {INDEXADOR_RF_DESCRICAO[ativo.rf_indexador]}
        </p>
      )}
    </section>
  )
}

function CardMini({ icone, titulo, valor, cor, sub }: {
  icone: React.ReactNode; titulo: string; valor: string; cor?: string; sub?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-[13px]" style={{ color: MUTED }}>{icone}{titulo}</div>
      <p className="mt-1.5 text-[18px] font-bold" style={{ color: cor ?? '#fff' }}>{valor}</p>
      {sub && <p className="text-[12px] mt-0.5" style={{ color: MUTED }}>{sub}</p>}
    </div>
  )
}

// ── Drawer: questionário de avaliação (deriva a nota) ───────────

function DrawerQuestionario({ ativo, onClose, onToast }: {
  ativo: InvestimentoAtivo; onClose: () => void; onToast: (m: string) => void
}) {
  const { editar } = useInvestimentosAtivos()
  const { perfil } = useInvPerfil()
  const { pesos: pesosGlobais } = useInvPesos()
  const { questionarioEfetivo } = useInvQuestionarios()
  // Questionário efetivo (perguntas custom/padrão do tipo) + pesos GLOBAIS.
  const ef = questionarioEfetivo(ativo.tipo_ativo, perfil?.perfil ?? null, pesosGlobais)
  const perguntas = ef.perguntas
  const [respostas, setRespostas] = useState<QuestionarioRespostas>(ativo.questionario_respostas ?? {})
  const [salvando, setSalvando] = useState(false)

  const nota = calcularNota(perguntas, ef.pesos, respostas)
  const respondidas = perguntas.filter((p) => respostas[p.id] != null).length

  // Agrupa por critério para exibir junto do peso de cada bloco.
  const porCriterio: Record<CriterioQuestao, PerguntaAvaliacao[]> = { FUNDAMENTOS: [], CRESCIMENTO: [], DIVIDENDOS: [] }
  for (const p of perguntas) (porCriterio[p.criterio] ?? porCriterio.FUNDAMENTOS).push(p)

  async function salvar() {
    if (nota == null) { onToast('Responda pelo menos uma pergunta'); return }
    setSalvando(true)
    const res = await editar(ativo.id, { nota_usuario: nota, questionario_respostas: respostas })
    setSalvando(false)
    if (res.ok) { onToast(`Avaliação salva — nota ${nota}.`); onClose() }
    else onToast(res.erro ?? 'Erro ao salvar avaliação')
  }

  return (
    <Drawer open onClose={onClose} titulo={`Avaliar · ${ativo.ticker}`}
      subtitulo={`Questionário de ${TIPO_ATIVO_LABEL[ativo.tipo_ativo]} — a nota é a média ponderada por critério`}
      rodape={<><BtnCancelar onClick={onClose} /><BtnSalvar editando onClick={salvar} salvando={salvando} labelSalvar="Salvar avaliação" /></>}>

      {/* Nota ao vivo */}
      <div className="rounded-lg border border-white/10 p-3 flex items-center justify-between">
        <span className="text-[13px]" style={{ color: MUTED }}>
          {respondidas}/{perguntas.length} respondidas
        </span>
        <span className="text-[18px] font-bold" style={{ color: nota != null && nota >= 7 ? '#00c896' : nota != null && nota < 5 ? '#ff5c7a' : '#f0b429' }}>
          {nota != null ? `Nota ${nota}` : 'Sem nota'}
        </span>
      </div>

      {CRITERIOS_QUESTAO.map((c) => porCriterio[c].length === 0 ? null : (
        <div key={c} className="space-y-2">
          <div className="flex items-baseline gap-2 mt-1">
            <h3 className="text-[13.5px] font-semibold text-white">{CRITERIO_LABEL[c]}</h3>
            <span className="text-[11.5px]" style={{ color: MUTED }}>peso {ef.pesos[c] ?? 0}%</span>
          </div>
          {porCriterio[c].map((p) => (
            <div key={p.id} className="space-y-1.5">
              <p className="text-[13px] font-medium text-white">{p.texto}</p>
              <div className="space-y-1">
                {p.opcoes.map((opcao, idx) => {
                  const ativa = respostas[p.id] === idx
                  return (
                    <button key={idx} type="button"
                      onClick={() => setRespostas({ ...respostas, [p.id]: idx })}
                      className={`w-full text-left px-3 py-1.5 rounded-md border text-[13px] transition-colors ${
                        ativa ? 'border-blue-400/60 bg-blue-500/15 text-white' : 'border-white/10 text-white/70 hover:border-white/25'
                      }`}>
                      {opcao}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </Drawer>
  )
}
