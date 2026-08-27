import { useMemo, useState, useRef, useEffect } from 'react'
import { useLocation, Link } from 'react-router-dom'
import { TrendingUp, TrendingDown, Percent, Trophy, Calendar, Layers, Zap, ChevronDown, ChevronUp, Loader2, ArrowUp } from 'lucide-react'
import { Bar } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend,
} from 'chart.js'
import { useInvestimentosDestaques } from '../hooks/useInvestimentosDashboard'
import { useContas } from '../hooks/useContas'
import { useOrdemReordenavel, AlcaArrastar } from '../hooks/useOrdemReordenavel'
import { usePreferenciasOrdemQuadros } from '../hooks/usePreferenciasOrdemQuadros'
import { SelectDark } from '../components/ui/shared'
import InvestimentosNav from '../components/ui/InvestimentosNav'
import LoadingMascote from '../components/ui/LoadingMascote'
import QuadroRentabilidadeIndices from '../components/ui/QuadroRentabilidadeIndices'
import { formatBRL } from '../lib/utils'
import { TIPO_ATIVO_LABEL, TIPO_ATIVO_COR, TIPOS_ATIVO_INV } from '../lib/constants'
import type {
  InvestimentoRankingAtivo, InvestimentoRankingCategoria, PeriodoRanking, TipoAtivoInvestimento,
} from '../types'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const MUTED    = '#8b92a8'
const VERDE    = '#00c896'
const VERMELHO = '#ff5c7a'

// Rótulo de "Ano AAAA" usa o ano corrente do relógio do navegador — cálculo
// simples de exibição, não regra de negócio sensível a fuso (diferente do
// "hoje" usado no backend pra fechar mês/vencimento).
const ANO_ATUAL_LABEL = new Date().getFullYear()
const PERIODOS: { value: PeriodoRanking; label: string }[] = [
  { value: 'SEMANA',    label: 'Semana' },
  { value: 'MES_ATUAL', label: 'Mês atual' },
  { value: 'MES',       label: 'Últimos 30 dias' },
  { value: 'SEMESTRE',  label: 'Semestre' },
  { value: 'ANO_ATUAL', label: `Ano ${ANO_ATUAL_LABEL}` },
  { value: 'ANO',       label: 'Últimos 12 meses' },
  { value: 'DOIS_ANOS',  label: '2 anos' },
  { value: 'CINCO_ANOS', label: '5 anos' },
  { value: 'TUDO',      label: 'Desde o início' },
]

// Chaves dos 5 quadros gerais — ordem PADRÃO (usada quando o usuário nunca
// reordenou nada); a ordem de fato é definida por useOrdemReordenavel.
type ChaveGeral = 'contribuintes' | 'em_alta' | 'em_baixa' | 'maior_dy' | 'maior_peso'
const CHAVES_GERAIS: ChaveGeral[] = ['contribuintes', 'em_alta', 'em_baixa', 'maior_dy', 'maior_peso']

function corPct(v: number): string { return v > 0 ? VERDE : v < 0 ? VERMELHO : MUTED }
function fmtPct(v: number): string { return `${v > 0 ? '+' : ''}${v}%` }
// R$ que acompanha um %, exibido sempre logo depois dele (formatBRL já cuida
// do "-" em valores negativos; só precisamos do "+" explícito no positivo).
function fmtGanho(v: number): string { return `${v > 0 ? '+' : ''}${formatBRL(v)}` }

// Posição no ranking (1º, 2º, 3º...) — usado em toda lista já ordenada
// desta página, pra deixar explícito que é um ranking, não uma lista solta.
// As 3 primeiras colocações trocam o número por um troféu (ouro/prata/bronze).
const CORES_PODIO = ['#ffd700', '#c0c0c0', '#cd7f32']
function Posicao({ indice }: { indice: number }) {
  if (indice < 3) {
    return <Trophy size={14} className="w-5 shrink-0" style={{ color: CORES_PODIO[indice] }} />
  }
  return <span className="text-[11px] w-5 shrink-0 text-right" style={{ color: MUTED }}>{indice + 1}º</span>
}

const OPCOES_GRAFICO_BASE = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
} as const

// Total agregado de uma lista de ativos — NUNCA a média simples dos %
// individuais (um ativo pequeno com +50% não pode pesar igual a um grande
// com +2%): retorno do grupo = Σganho ÷ Σvalor_inicio, "yield" do grupo =
// Σdividendos ÷ Σvalor_mercado.
function totalRetorno(itens: InvestimentoRankingAtivo[]): { pct: number; ganho: number } {
  const mercado = itens.reduce((s, a) => s + a.valor_mercado, 0)
  const inicio  = itens.reduce((s, a) => s + a.valor_mercado_inicio_periodo, 0)
  const ganho   = mercado - inicio
  return { pct: inicio > 0 ? (ganho / inicio) * 100 : 0, ganho }
}
function totalDY(itens: InvestimentoRankingAtivo[]): { pct: number; dividendos: number } {
  const mercado = itens.reduce((s, a) => s + a.valor_mercado, 0)
  const dividendos = itens.reduce((s, a) => s + a.dividendos_periodo, 0)
  return { pct: mercado > 0 ? (dividendos / mercado) * 100 : 0, dividendos }
}

// Ativo como link pra sua página de detalhe — usado em toda listagem desta
// página (mesmo padrão de QuadroTipoAtivos: preserva a origem pro "voltar").
// Nome do ativo NÃO aparece mais como texto — vira `title` (hint nativo do
// navegador ao passar o mouse), pra manter as linhas enxutas.
function LinkAtivo({ a, origem, className }: { a: InvestimentoRankingAtivo; origem: string; className?: string }) {
  return (
    <Link to={`/investimentos/ativos/${a.ativo_id}`} state={{ from: origem }} title={a.nome || a.ticker}
      className={className ?? 'text-white text-[13px] font-semibold shrink-0 hover:underline'}>
      {a.ticker}
    </Link>
  )
}

// ── Ranking por categoria (Tipo de Ativo) — topo da página ─────

function RankingCategorias({ categorias, rentabilidadePeriodoTotal, aoSelecionar, focoTipo, focoSinal, sectionRef }: {
  categorias: InvestimentoRankingCategoria[]
  // % composto mês a mês (líquido de fluxo) já calculado pelo backend pro
  // total geral — mesma técnica usada por categoria/ativo (ver dashboard.ts).
  // Some quando o período não permite calcular assim (ex.: "Desde o
  // início"); aí cai pro cálculo simples início↔fim a partir das
  // categorias, como sempre foi.
  rentabilidadePeriodoTotal: number | null
  // Clicar numa linha rola até o quadro correspondente em "Por tipo de
  // ativo" (abaixo) e o expande — atalho complementar ao botão "Voltar ao
  // ranking completo" de QuadroCategoria, que faz o caminho inverso.
  aoSelecionar?: (tipo: TipoAtivoInvestimento) => void
  // Realce temporário da linha de origem quando o usuário volta de um
  // QuadroCategoria pelo botão — focoSinal muda a cada clique (mesmo
  // repetindo o mesmo tipo) pra sempre re-disparar o efeito de scroll/realce.
  focoTipo?:   TipoAtivoInvestimento | null
  focoSinal?:  number | null
  sectionRef?: React.RefObject<HTMLElement | null>
}) {
  const [destaque, setDestaque] = useState(false)
  useEffect(() => {
    if (focoSinal == null) return
    const id = requestAnimationFrame(() => setDestaque(true))
    const t = setTimeout(() => setDestaque(false), 2200)
    return () => { cancelAnimationFrame(id); clearTimeout(t) }
  }, [focoSinal])
  useEffect(() => {
    if (!destaque) return
    const id = requestAnimationFrame(() => {
      const alvo = sectionRef?.current
      if (!alvo) return
      const cabe = alvo.getBoundingClientRect().height <= window.innerHeight - 100
      alvo.scrollIntoView({ behavior: 'smooth', block: cabe ? 'center' : 'start' })
    })
    return () => cancelAnimationFrame(id)
  }, [destaque, sectionRef])

  if (categorias.length === 0) return null
  const totalMercado = categorias.reduce((s, c) => s + c.valor_mercado, 0)
  const totalInicio  = categorias.reduce((s, c) => s + c.valor_mercado_inicio_periodo, 0)
  const totalDiv     = categorias.reduce((s, c) => s + c.dividendos_periodo, 0)
  const totalPct     = rentabilidadePeriodoTotal
    ?? (totalInicio > 0 ? ((totalMercado - totalInicio) / totalInicio) * 100 : 0)
  return (
    <section ref={sectionRef} className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-5 scroll-mt-4">
      <div className="flex items-center gap-2 text-[15px] font-semibold text-white mb-3">
        <Layers size={16} /> Ranking por categoria
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left" style={{ color: MUTED }}>
              <th className="font-medium pb-2 pr-2 text-right">#</th>
              <th className="font-medium pb-2 pr-3">Categoria</th>
              <th className="font-medium pb-2 pr-3 text-right">Valor de mercado</th>
              <th className="font-medium pb-2 pr-3 text-right">Retorno do período</th>
              <th className="font-medium pb-2 pr-3 text-right">Dividendos do período</th>
              <th className="font-medium pb-2 text-right">Participação</th>
            </tr>
          </thead>
          <tbody>
            {categorias.map((cat, idx) => {
              const realce = destaque && focoTipo === cat.tipo_ativo
              return (
                <tr key={cat.tipo_ativo}
                  className={`border-t border-white/5 transition-colors duration-700 ${aoSelecionar ? 'cursor-pointer hover:bg-white/[0.04]' : ''}`}
                  style={realce ? { background: `${TIPO_ATIVO_COR[cat.tipo_ativo]}22` } : undefined}
                  onClick={() => aoSelecionar?.(cat.tipo_ativo)}
                  title={aoSelecionar ? 'Ver este tipo de ativo no quadro abaixo' : undefined}>
                  <td className="py-2 pr-2"><Posicao indice={idx} /></td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2 text-white font-medium">
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[cat.tipo_ativo] }} />
                      {TIPO_ATIVO_LABEL[cat.tipo_ativo]}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right text-white whitespace-nowrap">{formatBRL(cat.valor_mercado)}</td>
                  <td className="py-2 pr-3 text-right font-medium whitespace-nowrap" style={{ color: corPct(cat.rentabilidade_periodo_pct) }}>
                    {fmtPct(cat.rentabilidade_periodo_pct)}
                    <span className="block font-normal text-[11px]" style={{ color: MUTED }}>
                      {fmtGanho(cat.valor_mercado - cat.valor_mercado_inicio_periodo)}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right text-white whitespace-nowrap">{formatBRL(cat.dividendos_periodo)}</td>
                  <td className="py-2 text-right text-white whitespace-nowrap">{cat.participacao_pct}%</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10">
              <td className="py-2 pr-2"></td>
              <td className="py-2 pr-3 text-white font-semibold">Total</td>
              <td className="py-2 pr-3 text-right text-white font-semibold whitespace-nowrap">{formatBRL(totalMercado)}</td>
              <td className="py-2 pr-3 text-right font-semibold whitespace-nowrap" style={{ color: corPct(totalPct) }}>
                {fmtPct(Number(totalPct.toFixed(2)))}
                <span className="block font-normal text-[11px]" style={{ color: MUTED }}>{fmtGanho(totalMercado - totalInicio)}</span>
              </td>
              <td className="py-2 pr-3 text-right text-white font-semibold whitespace-nowrap">{formatBRL(totalDiv)}</td>
              <td className="py-2 text-right text-white font-semibold whitespace-nowrap">100%</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

// ── Lista completa de um destaque (Em alta / Em prejuízo / Maior DY / Maior participação) ──

function ListaDestaque({ titulo, icone, itens, metrica, colunaLabel, periodo, origem, total, dragHandleProps, dropTargetProps, bordaClasse }: {
  titulo: string; icone: React.ReactNode; itens: InvestimentoRankingAtivo[]
  metrica: (a: InvestimentoRankingAtivo) => { texto: string; valorTexto: string; cor: string }
  colunaLabel: string
  periodo: PeriodoRanking; origem: string
  total: { pctTexto: string; valorTexto: string; cor: string }
  dragHandleProps: React.HTMLAttributes<HTMLSpanElement>
  dropTargetProps: React.HTMLAttributes<HTMLDivElement>
  bordaClasse: string
}) {
  // Recolhido por padrão — mesma razão dos quadros "Por tipo de ativo": com
  // vários quadros na grade, um arrasto do último até o primeiro fica
  // impraticável se cada card já vem com a lista inteira aberta.
  const [aberto, setAberto] = useState(false)
  return (
    <div data-quadro-arrastavel className={`rounded-xl bg-white/[0.02] p-4 flex flex-col transition-all duration-150 ${bordaClasse}`} {...dropTargetProps}>
      {/* div, não <button>: um <button> engolindo a alça arrastável dentro
          dele impede o `dragstart` de disparar no Firefox (bug conhecido,
          Mozilla #646823) — o arraste simplesmente nunca começava. */}
      <div role="button" tabIndex={0} onClick={() => setAberto(!aberto)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAberto(!aberto) } }}
        className={`w-full flex items-center justify-between gap-2 text-[13px] text-left cursor-pointer ${aberto ? 'mb-2.5' : ''}`} style={{ color: MUTED }}>
        <span className="flex items-center gap-2 min-w-0">
          <AlcaArrastar {...dragHandleProps} onClick={(e) => e.stopPropagation()} />
          {icone}{titulo} <span className="opacity-60">({itens.length})</span>
        </span>
        <span className="flex items-center gap-2 shrink-0">
          <span className="font-semibold whitespace-nowrap" style={{ color: total.cor }}>
            {total.pctTexto} <span className="font-normal" style={{ color: MUTED }}>{total.valorTexto}</span>
          </span>
          {aberto ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </div>
      {aberto && (itens.length === 0 ? (
        <p className="text-[13px] py-4 text-center" style={{ color: MUTED }}>Nada por aqui neste período/categoria.</p>
      ) : (
        <div className="max-h-[420px] overflow-y-auto pr-1">
          <table className="w-full text-[12px]">
            <thead>
              <tr style={{ color: MUTED }}>
                <th className="text-left font-medium pb-1.5">Ativo</th>
                <th className="text-right font-medium pb-1.5">{colunaLabel}</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((a, idx) => {
                const m = metrica(a)
                return (
                  <tr key={a.ativo_id} className="border-t border-white/5">
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Posicao indice={idx} />
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: TIPO_ATIVO_COR[a.tipo_ativo] }} />
                        <LinkAtivo a={a} origem={origem} />
                        {periodo !== 'TUDO' && a.periodo_desde_compra && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 border border-white/10" style={{ color: MUTED }}>
                            desde a compra
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 text-right font-medium whitespace-nowrap" style={{ color: m.cor }}>
                      {m.texto}
                      <span className="block font-normal text-[10px]" style={{ color: MUTED }}>{m.valorTexto}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-white/10">
                <td className="py-1.5 font-medium" style={{ color: MUTED }}>Total</td>
                <td className="py-1.5 text-right font-semibold whitespace-nowrap" style={{ color: total.cor }}>
                  {total.pctTexto}
                  <span className="block font-normal text-[10px]" style={{ color: MUTED }}>{total.valorTexto}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      ))}
    </div>
  )
}

// ── Quadro por tipo de ativo (gráfico + lista completa) ─────────

function QuadroCategoria({ categoria, ativos, periodo, origem, focoSinal, onVoltarRanking, dragHandleProps, dropTargetProps, bordaClasse }: {
  categoria: InvestimentoRankingCategoria; ativos: InvestimentoRankingAtivo[]
  periodo: PeriodoRanking; origem: string
  // Disparado ao clicar na linha correspondente em "Ranking por categoria"
  // (topo da página) — muda a cada clique (mesmo repetindo o mesmo tipo)
  // pra sempre re-disparar o efeito de abrir + rolar + realçar.
  focoSinal?: number | null
  onVoltarRanking?: () => void
  dragHandleProps: React.HTMLAttributes<HTMLSpanElement>
  dropTargetProps: React.HTMLAttributes<HTMLDivElement>
  bordaClasse: string
}) {
  const cor = TIPO_ATIVO_COR[categoria.tipo_ativo]
  // Recolhido por padrão — com vários tipos de ativo cadastrados, o quadro
  // aberto (gráfico + lista inteira) fica alto o suficiente pra atrapalhar
  // o arrastar-e-soltar (arrastar um quadro do fim da lista até o topo vira
  // impraticável com a página gigante). Recolhido, só o resumo do
  // cabeçalho aparece — abre com um clique quando quiser ver o detalhe.
  const [aberto, setAberto] = useState(false)
  const [destaque, setDestaque] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Foco vindo do "Ranking por categoria": abre, rola até o quadro e o
  // destaca por alguns instantes — mesmo padrão de QuadroTipoAtivos (foco
  // vindo do gráfico de rosca) pra consistência visual entre as páginas.
  useEffect(() => {
    if (focoSinal == null) return
    const id = requestAnimationFrame(() => {
      setAberto(true)
      setDestaque(true)
    })
    const t = setTimeout(() => setDestaque(false), 2200)
    return () => { cancelAnimationFrame(id); clearTimeout(t) }
  }, [focoSinal])
  useEffect(() => {
    if (!destaque) return
    const id = requestAnimationFrame(() => {
      const alvo = ref.current
      if (!alvo) return
      const cabe = alvo.getBoundingClientRect().height <= window.innerHeight - 100
      alvo.scrollIntoView({ behavior: 'smooth', block: cabe ? 'center' : 'start' })
    })
    return () => cancelAnimationFrame(id)
  }, [destaque])

  // Gráfico mostra só os maiores (por saldo) — legível mesmo em categorias
  // com muitos ativos; a lista logo abaixo traz a carteira INTEIRA da
  // categoria, com scroll.
  const ordenadosPorSaldo = useMemo(
    () => [...ativos].sort((x, y) => y.valor_mercado - x.valor_mercado),
    [ativos],
  )
  const noGrafico = ordenadosPorSaldo.slice(0, 10)

  return (
    <div ref={ref} data-quadro-arrastavel className={`rounded-xl bg-white/[0.02] p-4 transition-all duration-150 scroll-mt-4 ${bordaClasse}`}
      style={{ boxShadow: destaque ? `0 0 0 2px ${cor}, 0 0 26px ${cor}88` : 'none' }}
      {...dropTargetProps}>
      {/* div, não <button>: um <button> engolindo a alça arrastável dentro
          dele impede o `dragstart` de disparar no Firefox (bug conhecido,
          Mozilla #646823) — o arraste simplesmente nunca começava. */}
      <div role="button" tabIndex={0} onClick={() => setAberto(!aberto)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setAberto(!aberto) } }}
        className={`w-full flex items-center justify-between gap-3 flex-wrap text-left cursor-pointer ${aberto ? 'mb-3' : ''}`}>
        <div className="flex items-center gap-2 min-w-0">
          <AlcaArrastar {...dragHandleProps} onClick={(e) => e.stopPropagation()} />
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: cor }} />
          <p className="font-semibold text-[15px]" style={{ color: cor }}>{TIPO_ATIVO_LABEL[categoria.tipo_ativo]}</p>
          <span className="text-[12px]" style={{ color: MUTED }}>{ativos.length} {ativos.length === 1 ? 'ativo' : 'ativos'}</span>
        </div>
        <div className="flex items-center gap-4 text-[13px]">
          <div className="text-right">
            <p className="text-[10px]" style={{ color: MUTED }}>Saldo</p>
            <p className="text-white font-medium whitespace-nowrap">{formatBRL(categoria.valor_mercado)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px]" style={{ color: MUTED }}>Retorno do período</p>
            <p className="font-medium whitespace-nowrap" style={{ color: corPct(categoria.rentabilidade_periodo_pct) }}>
              {fmtPct(categoria.rentabilidade_periodo_pct)}{' '}
              <span className="font-normal text-[12px]" style={{ color: MUTED }}>
                {fmtGanho(categoria.valor_mercado - categoria.valor_mercado_inicio_periodo)}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="text-[10px]" style={{ color: MUTED }}>Da carteira</p>
            <p className="text-white font-medium whitespace-nowrap">{categoria.participacao_pct}%</p>
          </div>
          {aberto ? <ChevronUp size={15} style={{ color: MUTED }} /> : <ChevronDown size={15} style={{ color: MUTED }} />}
        </div>
      </div>

      {aberto && (
        <div className="flex justify-end -mt-1 mb-2">
          <button type="button" onClick={() => onVoltarRanking?.()}
            className="inline-flex items-center gap-1 text-[11px] hover:underline" style={{ color: MUTED }}>
            <ArrowUp size={11} /> Voltar ao ranking completo
          </button>
        </div>
      )}

      {aberto && noGrafico.length > 0 && (
        <div className="mb-3">
          <p className="text-[11px] mb-1" style={{ color: MUTED }}>
            Retorno do período por ativo
            {ordenadosPorSaldo.length > noGrafico.length && ` — ${noGrafico.length} maiores por saldo`}
          </p>
          <div style={{ height: Math.max(120, noGrafico.length * 30) }}>
            <Bar
              data={{
                labels: noGrafico.map((a) => a.ticker),
                datasets: [{
                  label: 'Retorno do período',
                  data: noGrafico.map((a) => a.rentabilidade_periodo_pct),
                  backgroundColor: noGrafico.map((a) => (a.rentabilidade_periodo_pct >= 0 ? VERDE : VERMELHO)),
                  borderRadius: 4,
                  barThickness: 16,
                }],
              }}
              options={{
                ...OPCOES_GRAFICO_BASE,
                indexAxis: 'y' as const,
                plugins: {
                  ...OPCOES_GRAFICO_BASE.plugins,
                  tooltip: { callbacks: { label: (ctx) => fmtPct(Number(ctx.parsed.x)) } },
                },
                scales: {
                  x: { ticks: { color: MUTED, callback: (v) => `${v}%` }, grid: { color: 'rgba(255,255,255,0.05)' } },
                  y: { ticks: { color: '#e8eaf0', font: { size: 11 } }, grid: { display: false } },
                },
              }}
            />
          </div>
        </div>
      )}

      {aberto && (
      <div className="max-h-[280px] overflow-y-auto pr-1 border-t border-white/5 pt-3">
        <table className="w-full text-[12px]">
          <thead>
            <tr style={{ color: MUTED }}>
              <th className="text-left font-medium pb-1.5">Ativo</th>
              <th className="text-right font-medium pb-1.5">Saldo</th>
              <th className="text-right font-medium pb-1.5">Retorno do período</th>
            </tr>
          </thead>
          <tbody>
            {ordenadosPorSaldo.map((a, idx) => (
              <tr key={a.ativo_id} className="border-t border-white/5">
                <td className="py-1.5 pr-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Posicao indice={idx} />
                    <LinkAtivo a={a} origem={origem} />
                    {periodo !== 'TUDO' && a.periodo_desde_compra && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 border border-white/10" style={{ color: MUTED }}>
                        desde a compra
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-1.5 pl-2 text-right whitespace-nowrap" style={{ color: MUTED }}>{formatBRL(a.valor_mercado)}</td>
                <td className="py-1.5 pl-2 text-right font-medium whitespace-nowrap" style={{ color: corPct(a.rentabilidade_periodo_pct) }}>
                  {fmtPct(a.rentabilidade_periodo_pct)}
                  <span className="block font-normal text-[10px]" style={{ color: MUTED }}>
                    {fmtGanho(a.valor_mercado - a.valor_mercado_inicio_periodo)}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-white/10">
              <td className="py-1.5 font-medium" style={{ color: MUTED }}>Total da categoria</td>
              <td className="py-1.5 pl-2 text-right text-white font-medium whitespace-nowrap">{formatBRL(categoria.valor_mercado)}</td>
              <td className="py-1.5 pl-2 text-right font-semibold whitespace-nowrap" style={{ color: corPct(categoria.rentabilidade_periodo_pct) }}>
                {fmtPct(categoria.rentabilidade_periodo_pct)}
                <span className="block font-normal text-[10px]" style={{ color: MUTED }}>
                  {fmtGanho(categoria.valor_mercado - categoria.valor_mercado_inicio_periodo)}
                </span>
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      )}
    </div>
  )
}

// ── Página ────────────────────────────────────────────────────

export default function DestaquesInvestimentosPage() {
  const location = useLocation()
  // Origem pro botão "voltar" da página de detalhe do ativo — mesmo padrão
  // de QuadroTipoAtivos (preserva de onde o usuário abriu o ativo).
  const origem = location.pathname + location.search

  // Navegação cruzada entre "Ranking por categoria" (topo) e os quadros "Por
  // tipo de ativo" (abaixo): clicar numa linha do ranking foca o quadro
  // correspondente (abre + rola + realça); o botão "Voltar ao ranking
  // completo" dentro do quadro faz o caminho inverso. `n` incrementa a cada
  // clique pra sempre re-disparar o efeito mesmo repetindo o mesmo tipo.
  const rankingRef = useRef<HTMLElement>(null)
  const [focoCategoria, setFocoCategoria] = useState<{ tipo: TipoAtivoInvestimento; n: number } | null>(null)
  const [focoRanking, setFocoRanking]     = useState<{ tipo: TipoAtivoInvestimento; n: number } | null>(null)

  const [contaId, setContaId]   = useState('')
  // Aceita ?periodo=... na URL (ex.: atalho "quem mais contribuiu este mês"
  // do gráfico Evolução do Patrimônio) — cai pro default se vier vazio/inválido.
  const [periodo, setPeriodo]   = useState<PeriodoRanking>(() => {
    const p = new URLSearchParams(location.search).get('periodo')
    return (PERIODOS.some((x) => x.value === p) ? p : 'TUDO') as PeriodoRanking
  })
  const [categoria, setCategoria] = useState<TipoAtivoInvestimento | ''>('')
  const { contas } = useContas()
  const contasInvest = contas.filter((c) => c.tipo === 'INVESTIMENTO' && c.ativa)

  const { destaques, loading, atualizando, error } = useInvestimentosDestaques(contaId || null, periodo)
  const ativos     = destaques?.ativos ?? []
  const categorias = destaques?.categorias ?? []
  const rentabilidadePeriodoTotal = destaques?.rentabilidade_periodo_pct_total ?? null

  // Filtro de categoria é só client-side: o "ranking por categoria" do topo
  // precisa SEMPRE de todas as categorias pra fazer sentido comparativo; só
  // as 4 listas de destaque e os quadros por tipo é que respeitam o recorte.
  const ativosFiltrados = useMemo(
    () => (categoria ? ativos.filter((a) => a.tipo_ativo === categoria) : ativos),
    [ativos, categoria],
  )
  const categoriasFiltradas = useMemo(
    () => (categoria ? categorias.filter((c) => c.tipo_ativo === categoria) : categorias),
    [categorias, categoria],
  )
  const ativosPorTipo = useMemo(() => {
    const m = new Map<TipoAtivoInvestimento, InvestimentoRankingAtivo[]>()
    for (const a of ativosFiltrados) {
      const lista = m.get(a.tipo_ativo) ?? []
      lista.push(a)
      m.set(a.tipo_ativo, lista)
    }
    return m
  }, [ativosFiltrados])

  // Contribuição em R$ pro resultado do período — NÃO é a mesma coisa que
  // "Em alta" (que ordena por %): um ativo pequeno com +50% pode contribuir
  // menos em dinheiro do que um grande com +2%. Ordena pelo módulo do ganho/
  // perda em reais, misturando altas e baixas — "quem mais mexeu o
  // patrimônio", pra cima ou pra baixo.
  const contribuintes = useMemo(
    () => [...ativosFiltrados]
      .map((a) => ({ a, ganho: a.valor_mercado - a.valor_mercado_inicio_periodo }))
      .sort((x, y) => Math.abs(y.ganho) - Math.abs(x.ganho))
      .map(({ a }) => a),
    [ativosFiltrados],
  )
  const emAlta = useMemo(
    () => [...ativosFiltrados].filter((a) => a.rentabilidade_periodo_pct > 0)
      .sort((x, y) => y.rentabilidade_periodo_pct - x.rentabilidade_periodo_pct),
    [ativosFiltrados],
  )
  const emBaixa = useMemo(
    () => [...ativosFiltrados].filter((a) => a.rentabilidade_periodo_pct < 0)
      .sort((x, y) => x.rentabilidade_periodo_pct - y.rentabilidade_periodo_pct),
    [ativosFiltrados],
  )
  const maiorDY = useMemo(
    () => [...ativosFiltrados].filter((a) => a.dy_periodo_pct > 0)
      .sort((x, y) => y.dy_periodo_pct - x.dy_periodo_pct),
    [ativosFiltrados],
  )
  const maiorPeso = useMemo(
    () => [...ativosFiltrados].sort((x, y) => y.participacao_pct - x.participacao_pct),
    [ativosFiltrados],
  )

  const totalContribuintes = useMemo(() => totalRetorno(contribuintes), [contribuintes])
  const totalEmAlta  = useMemo(() => totalRetorno(emAlta), [emAlta])
  const totalEmBaixa = useMemo(() => totalRetorno(emBaixa), [emBaixa])
  const totalDYLista = useMemo(() => totalDY(maiorDY), [maiorDY])
  const totalPeso    = useMemo(() => ({
    pct: maiorPeso.reduce((s, a) => s + a.participacao_pct, 0),
    valor: maiorPeso.reduce((s, a) => s + a.valor_mercado, 0),
  }), [maiorPeso])

  // Ordem dos quadros — arrastável pelo usuário, persistida em
  // arqvalor.usuarios.ordem_quadros (mantém entre sessões/aparelhos).
  const { blob: ordemDb, salvar: salvarOrdemDb } = usePreferenciasOrdemQuadros()
  const { ordem: ordemGerais, dragHandleProps: alcaGeral, dropTargetProps: alvoGeral, dropTargetClass: bordaGeral } =
    useOrdemReordenavel<ChaveGeral>('arqvalor:destaques-ordem-gerais', CHAVES_GERAIS, {
      valorRemoto: (ordemDb['destaques-gerais'] as ChaveGeral[] | undefined) ?? null,
      aoMudar: (nova) => salvarOrdemDb('destaques-gerais', nova),
    })
  const chavesCategorias = useMemo(() => categoriasFiltradas.map((c) => c.tipo_ativo), [categoriasFiltradas])
  const { ordem: ordemCategorias, dragHandleProps: alcaCategoria, dropTargetProps: alvoCategoria, dropTargetClass: bordaCategoria } =
    useOrdemReordenavel<TipoAtivoInvestimento>('arqvalor:destaques-ordem-categorias', chavesCategorias, {
      valorRemoto: (ordemDb['destaques-categorias'] as TipoAtivoInvestimento[] | undefined) ?? null,
      aoMudar: (nova) => salvarOrdemDb('destaques-categorias', nova),
    })
  const categoriaPorTipo = useMemo(
    () => new Map(categoriasFiltradas.map((c) => [c.tipo_ativo, c])),
    [categoriasFiltradas],
  )

  const PAINEIS_GERAIS: Record<ChaveGeral, React.ReactNode> = {
    contribuintes: (
      <ListaDestaque titulo="Maiores contribuintes" icone={<Zap size={14} />} itens={contribuintes} periodo={periodo} origem={origem}
        colunaLabel="Contribuição no período"
        metrica={(a) => {
          const ganho = a.valor_mercado - a.valor_mercado_inicio_periodo
          return { texto: fmtGanho(ganho), cor: corPct(ganho), valorTexto: fmtPct(a.rentabilidade_periodo_pct) }
        }}
        total={{
          pctTexto: fmtGanho(totalContribuintes.ganho),
          valorTexto: fmtPct(Number(totalContribuintes.pct.toFixed(2))),
          cor: corPct(totalContribuintes.ganho),
        }}
        dragHandleProps={alcaGeral('contribuintes')} dropTargetProps={alvoGeral('contribuintes')} bordaClasse={bordaGeral('contribuintes')} />
    ),
    em_alta: (
      <ListaDestaque titulo="Em alta" icone={<TrendingUp size={14} />} itens={emAlta} periodo={periodo} origem={origem}
        colunaLabel="Retorno do período"
        metrica={(a) => ({
          texto: fmtPct(a.rentabilidade_periodo_pct), cor: VERDE,
          valorTexto: fmtGanho(a.valor_mercado - a.valor_mercado_inicio_periodo),
        })}
        total={{ pctTexto: fmtPct(Number(totalEmAlta.pct.toFixed(2))), valorTexto: fmtGanho(totalEmAlta.ganho), cor: VERDE }}
        dragHandleProps={alcaGeral('em_alta')} dropTargetProps={alvoGeral('em_alta')} bordaClasse={bordaGeral('em_alta')} />
    ),
    em_baixa: (
      <ListaDestaque titulo="Em prejuízo" icone={<TrendingDown size={14} />} itens={emBaixa} periodo={periodo} origem={origem}
        colunaLabel="Retorno do período"
        metrica={(a) => ({
          texto: fmtPct(a.rentabilidade_periodo_pct), cor: VERMELHO,
          valorTexto: fmtGanho(a.valor_mercado - a.valor_mercado_inicio_periodo),
        })}
        total={{ pctTexto: fmtPct(Number(totalEmBaixa.pct.toFixed(2))), valorTexto: fmtGanho(totalEmBaixa.ganho), cor: VERMELHO }}
        dragHandleProps={alcaGeral('em_baixa')} dropTargetProps={alvoGeral('em_baixa')} bordaClasse={bordaGeral('em_baixa')} />
    ),
    maior_dy: (
      <ListaDestaque titulo="Maior dividend yield" icone={<Percent size={14} />} itens={maiorDY} periodo={periodo} origem={origem}
        colunaLabel="Dividend yield"
        metrica={(a) => ({ texto: `${a.dy_periodo_pct}%`, cor: VERDE, valorTexto: formatBRL(a.dividendos_periodo) })}
        total={{ pctTexto: `${totalDYLista.pct.toFixed(2)}%`, valorTexto: formatBRL(totalDYLista.dividendos), cor: VERDE }}
        dragHandleProps={alcaGeral('maior_dy')} dropTargetProps={alvoGeral('maior_dy')} bordaClasse={bordaGeral('maior_dy')} />
    ),
    maior_peso: (
      <ListaDestaque titulo="Maior participação" icone={<Trophy size={14} />} itens={maiorPeso} periodo={periodo} origem={origem}
        colunaLabel="% da carteira"
        metrica={(a) => ({ texto: `${a.participacao_pct}%`, cor: '#fff', valorTexto: formatBRL(a.valor_mercado) })}
        total={{ pctTexto: `${totalPeso.pct.toFixed(2)}%`, valorTexto: formatBRL(totalPeso.valor), cor: '#fff' }}
        dragHandleProps={alcaGeral('maior_peso')} dropTargetProps={alvoGeral('maior_peso')} bordaClasse={bordaGeral('maior_peso')} />
    ),
  }

  return (
    <div className="p-5">
      {/* Nav + filtros num único wrapper sticky: InvestimentosNav já é
          sticky por conta própria, mas empilhar dois sticky top-0
          independentes faz um cobrir o outro ao rolar — juntar os dois
          num só (o de fora "engole" o de dentro, que fica inerte) resolve
          sem precisar medir a altura do nav (variável — MascoteDica tem
          texto de tamanho aleatório). Filtros aqui pilotam TANTO o ranking
          abaixo quanto o gráfico de Rentabilidade, lá embaixo — por isso
          precisam continuar visíveis ao rolar até lá (pedido explícito). */}
      <div className="sticky top-0 z-20 pb-3" style={{ background: 'var(--bg-page, #0d1220)' }}>
        <InvestimentosNav />
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-[22px] font-bold text-white flex items-center gap-2">
              Destaques da carteira
              {/* Fica visível com dados ANTIGOS na tela (placeholderData) —
                  esse spinner é o único sinal de que o filtro já disparou a
                  atualização, sem substituir a página inteira por um loading
                  (o que jogava a rolagem de volta pro topo). */}
              {atualizando && <Loader2 size={15} className="animate-spin" style={{ color: MUTED }} />}
            </h1>
            <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
              Ranking completo por período e categoria
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2">
              <Calendar size={13} style={{ color: MUTED }} />
              <SelectDark value={periodo} onChange={(e) => setPeriodo(e.target.value as PeriodoRanking)}
                style={{ width: 'auto', border: 'none', background: 'transparent' }} className="!text-[13px] !py-2">
                {PERIODOS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </SelectDark>
            </div>
            <SelectDark value={categoria} onChange={(e) => setCategoria(e.target.value as TipoAtivoInvestimento | '')}
              style={{ width: 'auto' }} className="!text-[13px] !py-2">
              <option value="">Todas as categorias</option>
              {TIPOS_ATIVO_INV.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
            </SelectDark>
            <SelectDark value={contaId} onChange={(e) => setContaId(e.target.value)}
              style={{ width: 'auto' }} className="!text-[13px] !py-2">
              <option value="">Todas as contas</option>
              {contasInvest.map((c) => (
                <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>
              ))}
            </SelectDark>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4 mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] text-red-300">
          {error}
        </div>
      )}

      <div className="mt-5">
        {/* `loading` só é true no 1º carregamento de verdade (placeholderData
            mantém a tela anterior visível durante trocas de filtro — ver
            useInvestimentosDestaques) — então esse spinner de página cheia só
            aparece uma vez, não a cada troca de período/categoria/conta. */}
        {loading ? <LoadingMascote /> : ativos.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
            <p className="text-white font-medium">Sem ativos pra rankear</p>
            <p className="text-[13px] mt-1" style={{ color: MUTED }}>
              Cadastre ativos e posições na carteira pra ver os destaques aqui.
            </p>
          </div>
        ) : (
          <>
            <RankingCategorias categorias={categorias} rentabilidadePeriodoTotal={rentabilidadePeriodoTotal}
              aoSelecionar={(tipo) => setFocoCategoria((f) => ({ tipo, n: (f?.n ?? 0) + 1 }))}
              focoTipo={focoRanking?.tipo ?? null} focoSinal={focoRanking?.n ?? null} sectionRef={rankingRef} />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {ordemGerais.map((chave) => <div key={chave}>{PAINEIS_GERAIS[chave]}</div>)}
            </div>

            {ordemCategorias.length > 0 && (
              <>
                <h2 className="text-[15px] font-semibold text-white mt-6 mb-3">Por tipo de ativo</h2>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {ordemCategorias.map((tipo) => {
                    const cat = categoriaPorTipo.get(tipo)
                    if (!cat) return null
                    return (
                      <QuadroCategoria key={tipo} categoria={cat}
                        ativos={ativosPorTipo.get(tipo) ?? []} periodo={periodo} origem={origem}
                        focoSinal={focoCategoria?.tipo === tipo ? focoCategoria.n : null}
                        onVoltarRanking={() => setFocoRanking((f) => ({ tipo, n: (f?.n ?? 0) + 1 }))}
                        dragHandleProps={alcaCategoria(tipo)} dropTargetProps={alvoCategoria(tipo)} bordaClasse={bordaCategoria(tipo)} />
                    )
                  })}
                </div>
              </>
            )}
          </>
        )}

        {/* Rentabilidade — abaixo dos destaques (pedido explícito), FORA do
            `loading`/`ativos.length===0` acima de propósito: tem fonte de
            dados própria (histórico mensal, não o ranking), então não deve
            desmontar/sumir quando o ranking está recarregando — isso é
            exatamente o que fazia a tela "voltar pro topo" ao trocar de
            filtro (o bloco inteiro virava um spinner menor, encolhendo a
            página). Segue os MESMOS filtros de período/categoria/conta do
            topo (sem seletor próprio) — por isso o bloco de filtros lá em
            cima é sticky: continuam acessíveis mesmo rolando até aqui. */}
        {!loading && (
          <>
            <h2 className="text-[15px] font-semibold text-white mt-6 mb-3">Rentabilidade</h2>
            <QuadroRentabilidadeIndices contaId={contaId || null} periodo={periodo} tipoAtivo={categoria}
              periodoLabel={PERIODOS.find((p) => p.value === periodo)?.label ?? 'Desde o início'} />
          </>
        )}
      </div>
    </div>
  )
}
