import { useMemo, useState } from 'react'
import { Plus, Trash2, Search, RefreshCw, Wallet, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, Doughnut } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend } from 'chart.js'
import { useInvestimentosAtivos } from '../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes } from '../hooks/useInvestimentosPosicoes'
import { useInvestimentosHistorico, type RegistrarHistoricoInput } from '../hooks/useInvestimentosHistorico'
import { useInvestimentosDashboard, useInvestimentosRanking } from '../hooks/useInvestimentosDashboard'
import {
  Drawer, Field, Input, SelectDark, Toast,
} from '../components/ui/shared'
import DrawerAtivo from '../components/ui/DrawerAtivo'
import DrawerMovimentacoes from '../components/ui/DrawerMovimentacoes'
import QuadroTipoAtivos, { type Dimensao } from '../components/ui/QuadroTipoAtivos'
import InvestimentosNav from '../components/ui/InvestimentosNav'
import ResumoPorInstituicao from '../components/ui/ResumoPorInstituicao'
import TutorialTour from '../components/ui/TutorialTour'
import { TUTORIAL_INVESTIMENTOS_ATIVOS } from '../lib/tutoriaisPaginas'
import { useRegistrarContextoIA } from '../context/ContextoIAContext'
import { linhaDeMeta, type AtivoLinha } from '../lib/ativosLinha'
import LoadingMascote from '../components/ui/LoadingMascote'
import { formatBRL } from '../lib/utils'
import { roscaData, rotulosRosca } from '../lib/roscaChart'
import {
  TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL, TIPO_ATIVO_COR,
  setorLabel,
} from '../lib/constants'
import type {
  InvestimentoAtivo, TipoAtivoInvestimento,
  InvestimentoDashboardTipo, InvestimentoRankingAtivo,
} from '../types'

ChartJS.register(CategoryScale, LinearScale, BarElement, ArcElement, Tooltip, Legend)

const MUTED = '#8b92a8'

// ── Evolução do valor de mercado, empilhada por tipo de ativo ──
const PERIODOS_EVOLUCAO = [
  { value: '6',  label: '6 Meses' },
  { value: '12', label: '12 Meses' },
  { value: '24', label: '24 Meses' },
]
function fmtMesCurto(anoMes: string): string {
  const [ano, m] = anoMes.split('-')
  return `${m}/${ano.slice(2)}`
}

function EvolucaoPorTipo() {
  const [periodo, setPeriodo] = useState('12')
  const { historico } = useInvestimentosHistorico({})

  // Por mês: valor de mercado somado por tipo de ativo (segmentos da pilha)
  const { meses, tipos, porMes } = useMemo(() => {
    const porMes = new Map<string, Map<string, number>>()
    const presentes = new Set<string>()
    for (const h of historico) {
      const tipo = h.inv_ativos?.tipo_ativo
      if (!tipo) continue
      presentes.add(tipo)
      if (!porMes.has(h.mes_ano)) porMes.set(h.mes_ano, new Map())
      const mt = porMes.get(h.mes_ano)!
      mt.set(tipo, (mt.get(tipo) ?? 0) + Number(h.valor_mercado))
    }
    const meses = [...porMes.keys()].sort().slice(-Number(periodo))
    const tipos = TIPOS_ATIVO_INV.filter((t) => presentes.has(t))
    return { meses, tipos, porMes }
  }, [historico, periodo])

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-[15px] font-semibold text-white">Evolução por tipo de ativo</h2>
        <SelectDark value={periodo} onChange={(e) => setPeriodo(e.target.value)}
          style={{ width: 'auto' }} className="!text-[13px] !py-2">
          {PERIODOS_EVOLUCAO.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </SelectDark>
      </div>

      {meses.length < 2 ? (
        <p className="text-[13px] py-10 text-center" style={{ color: MUTED }}>
          Registre o valor de mercado mensal dos seus ativos para acompanhar a evolução por tipo.
        </p>
      ) : (
        <Bar
          data={{
            labels: meses.map(fmtMesCurto),
            datasets: tipos.map((t) => ({
              label: TIPO_ATIVO_LABEL[t],
              data: meses.map((m) => Number((porMes.get(m)?.get(t) ?? 0).toFixed(2))),
              backgroundColor: TIPO_ATIVO_COR[t],
              borderRadius: 4,
              stack: 'tipos',
            })),
          }}
          options={{
            responsive: true,
            maintainAspectRatio: true,
            aspectRatio: 2.4,
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

// ── Rosca de composição por dimensão (segmento/categoria) ──────
// Fatia = soma do valor de mercado por grupo; quando ainda não há valor de
// mercado (ativos sem posição), cai para a contagem de ativos para não
// renderizar uma rosca vazia.
function RoscaCategoria({ titulo, fatias, centro, onFoco }: {
  titulo: string
  fatias: { label: string; valor: number; count: number }[]
  centro: string  // rótulo do buraco central (ex.: "Patrimônio")
  onFoco?: (chave: string) => void  // recebe o rótulo da fatia clicada
}) {
  const totalValor = fatias.reduce((s, f) => s + f.valor, 0)
  const usarContagem = totalValor <= 0
  const dados = fatias.map((f) => (usarContagem ? f.count : f.valor))
  const total = dados.reduce((s, v) => s + v, 0)
  const data = roscaData(
    fatias.map((f, i) => ({ label: f.label, valor: dados[i] })),
    centro, usarContagem ? `${total}` : formatBRL(total),
  )

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 flex flex-col">
      <h2 className="text-[15px] font-semibold text-white mb-3">{titulo}</h2>
      <div className="flex-1 min-h-[300px] flex items-center justify-center">
        <Doughnut
          plugins={[rotulosRosca]}
          data={data}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            cutout: '62%',
            layout: { padding: { top: 16, bottom: 16, left: 64, right: 64 } },
            onClick: (_evt, elements) => {
              if (elements.length > 0) onFoco?.(fatias[elements[0].index].label)
            },
            onHover: (evt, elements) => {
              const alvo = evt.native?.target as HTMLElement | null
              if (alvo) alvo.style.cursor = elements.length && onFoco ? 'pointer' : 'default'
            },
            plugins: {
              legend: { display: false },
              tooltip: {
                callbacks: {
                  label: (ctx) => {
                    const f = fatias[ctx.dataIndex]
                    const pct = total > 0 ? (Number(ctx.parsed) / total) * 100 : 0
                    const qtd = `${f.count} ativo${f.count === 1 ? '' : 's'}`
                    return usarContagem
                      ? ` ${qtd} · ${pct.toFixed(1).replace('.', ',')}%`
                      : ` ${formatBRL(f.valor)} · ${pct.toFixed(1).replace('.', ',')}% (${qtd})`
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

// Agrupa as linhas de um tipo pela chave informada, somando valor de mercado
// e contando ativos. Ordena pelas fatias maiores primeiro.
function fatiasPorChave(
  linhas: AtivoLinha[], chaveDe: (l: AtivoLinha) => string,
): { label: string; valor: number; count: number }[] {
  const m = new Map<string, { valor: number; count: number }>()
  for (const l of linhas) {
    const k = chaveDe(l)
    const cur = m.get(k) ?? { valor: 0, count: 0 }
    cur.valor += l.valor_mercado
    cur.count += 1
    m.set(k, cur)
  }
  return [...m.entries()]
    .map(([label, v]) => ({ label, ...v }))
    .sort((a, b) => b.valor - a.valor || b.count - a.count)
}

export default function AtivosInvestimentosPage() {
  const [tipoFiltro, setTipoFiltro] = useState<TipoAtivoInvestimento | ''>('')
  const [pesquisa,   setPesquisa]   = useState('')
  const [soComValor, setSoComValor] = useState(false)
  const [drawer,     setDrawer]     = useState(false)
  const [editando,   setEditando]   = useState<InvestimentoAtivo | null>(null)
  const [toast,      setToast]      = useState<string | null>(null)
  const [posicoesDe, setPosicoesDe] = useState<InvestimentoAtivo | null>(null)
  const [historicoDe, setHistoricoDe] = useState<InvestimentoAtivo | null>(null)

  const filtros = tipoFiltro ? { tipo: tipoFiltro } : {}
  const { ativos, loading, error, atualizarAtivos, normalizarTesouro } = useInvestimentosAtivos(filtros)
  const [atualizando, setAtualizando] = useState(false)
  const [normalizando, setNormalizando] = useState(false)

  // Foco vindo do clique numa fatia da rosca: abre o quadro do tipo, rola até
  // ele e realça só o agrupamento (dim + chave) que originou aquela fatia.
  const [foco, setFoco] = useState<{ tipo: TipoAtivoInvestimento; dim: Dimensao; chave: string; n: number } | null>(null)
  const focar = (tipo: TipoAtivoInvestimento, dim: Dimensao, chave: string) =>
    setFoco((f) => ({ tipo, dim, chave, n: (f?.n ?? 0) + 1 }))

  // Agregados financeiros por tipo (valor, variação, dividendos, participação),
  // usados no cabeçalho de cada card — mesma fonte da página de Investimentos.
  const { dashboard } = useInvestimentosDashboard(null)
  const dadosPorTipo = useMemo(() => {
    const m = new Map<TipoAtivoInvestimento, InvestimentoDashboardTipo>()
    for (const t of dashboard?.tipos ?? []) m.set(t.tipo_ativo, t)
    return m
  }, [dashboard])

  // Métricas por ativo (quant., preços, variação, % carteira) — junta-se ao
  // metadado para preencher as colunas financeiras do quadro compartilhado.
  const { ranking } = useInvestimentosRanking(null)
  const rankingPorAtivo = useMemo(() => {
    const m = new Map<string, InvestimentoRankingAtivo>()
    for (const a of ranking?.ativos ?? []) m.set(a.ativo_id, a)
    return m
  }, [ranking])

  // Contas (de investimento) onde cada ativo tem posição ATIVA — para
  // mostrar a conta do ativo e sinalizar os que ficaram sem posição.
  const { posicoes: todasPosicoes } = useInvestimentosPosicoes({})
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

  // Agrupa por tipo de ativo e monta as linhas unificadas (metadado + ranking).
  // O agrupamento por categoria/segmento fica a cargo do quadro compartilhado.
  const grupos = useMemo(() => {
    const termo = pesquisa.trim().toLowerCase()
    const filtrados = termo
      ? ativos.filter((a) => a.ticker.toLowerCase().includes(termo) || a.nome.toLowerCase().includes(termo))
      : ativos
    const porTipo = new Map<TipoAtivoInvestimento, AtivoLinha[]>()
    for (const a of filtrados) {
      const linha = linhaDeMeta(a, rankingPorAtivo.get(a.id), contasPorAtivo.get(a.id) ?? [])
      // "Somente com valor": esconde ativos sem valor de mercado (sem posição
      // ativa ou já encerrados) — deixa só o que de fato compõe a carteira.
      if (soComValor && !(linha.valor_mercado > 0)) continue
      const lista = porTipo.get(a.tipo_ativo) ?? []
      lista.push(linha)
      porTipo.set(a.tipo_ativo, lista)
    }
    return [...porTipo.entries()]
      .sort((x, y) => TIPOS_ATIVO_INV.indexOf(x[0]) - TIPOS_ATIVO_INV.indexOf(y[0]))
      .map(([tipo, linhas]) => ({ tipo, linhas }))
  }, [ativos, pesquisa, soComValor, rankingPorAtivo, contasPorAtivo])

  // Fatias das roscas: Ações por segmento (setor) e FIIs por categoria.
  const { segmentosAcoes, categoriasFII } = useMemo(() => {
    const linhasDe = (t: TipoAtivoInvestimento) => grupos.find((g) => g.tipo === t)?.linhas ?? []
    return {
      segmentosAcoes: fatiasPorChave(linhasDe('ACOES'), (l) => setorLabel(l.setor) ?? 'Sem segmento'),
      categoriasFII:  fatiasPorChave(linhasDe('FII'),   (l) => l.categoria ?? 'Sem categoria'),
    }
  }, [grupos])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  // Re-busca nome/moeda oficiais (brapi) de todos os ativos — útil quando a
  // busca externa falhou no cadastro/importação e o ativo ficou só com o ticker.
  async function handleAtualizarAtivos() {
    if (atualizando) return
    setAtualizando(true)
    const res = await atualizarAtivos()
    setAtualizando(false)
    if (!res.ok) { showToast(res.erro ?? 'Erro ao atualizar tickets'); return }
    const d = res.dados
    showToast(
      !d || d.atualizados === 0
        ? 'Nada a atualizar — tickets já estão completos'
        : `${d.atualizados} ticket(s) atualizado(s) de ${d.processados}`,
    )
  }

  // Padroniza o ticker/nome dos títulos do Tesouro já cadastrados para o
  // formato legível (TD-IPCA-2040…). Idempotente — re-rodar não muda nada.
  async function handleNormalizarTesouro() {
    if (normalizando) return
    const temTesouro = ativos.some((a) => a.tipo_ativo === 'TESOURO_DIRETO')
    if (!temTesouro) { showToast('Nenhum título do Tesouro cadastrado'); return }
    setNormalizando(true)
    const res = await normalizarTesouro()
    setNormalizando(false)
    if (!res.ok) { showToast(res.erro ?? 'Erro ao padronizar os títulos do Tesouro'); return }
    const d = res.dados
    const ign = d?.ignorados?.length ? ` · ${d.ignorados.length} ignorado(s)` : ''
    showToast(
      !d || d.renomeados === 0
        ? `Tesouro já está padronizado${ign}`
        : `${d.renomeados} título(s) padronizado(s)${ign}`,
    )
  }

  function abrirNovo() { setEditando(null); setDrawer(true) }
  function abrirEditar(a: InvestimentoAtivo) { setEditando(a); setDrawer(true) }

  // ── Snapshot pra IA ───────────────────────────────────────────────────────
  useRegistrarContextoIA(useMemo(() => {
    if (loading || ativos.length === 0) return null
    return {
      titulo:    'Investimentos · Meus ativos',
      descricao: 'Ativos cadastrados na carteira, agrupados por tipo',
      dados: {
        filtro_tipo:     tipoFiltro || null,
        filtro_pesquisa: pesquisa || null,
        so_com_valor:    soComValor,
        grupos: grupos.map((g) => ({
          tipo: g.tipo,
          ativos: g.linhas.map((l) => ({
            ticker: l.ticker, nome: l.nome, valor_mercado: l.valor_mercado,
            rentabilidade_pct: l.rentabilidade_pct, participacao_pct: l.participacao_pct,
          })),
        })),
      },
    }
  }, [loading, ativos.length, grupos, tipoFiltro, pesquisa, soComValor]))

  if (loading) return <LoadingMascote />

  return (
    <div className="p-5">
      <InvestimentosNav />
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white">Meus ativos</h1>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>Cartela de ativos e posições</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap" data-tutorial="ativos-header">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: MUTED }} />
            <input value={pesquisa} onChange={(e) => setPesquisa(e.target.value)}
              placeholder="Buscar por ticker ou nome…"
              className="w-56 rounded-lg border border-white/10 bg-white/[0.03] pl-8 pr-7 py-2 text-[13px] text-white outline-none focus:border-white/25 placeholder:text-white/30" />
            {pesquisa && (
              <button onClick={() => setPesquisa('')} title="Limpar"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-[13px]" style={{ color: MUTED }}>✕</button>
            )}
          </div>
          <SelectDark value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value as TipoAtivoInvestimento | '')}
            style={{ width: 'auto' }} className="!text-[13px] !py-2">
            <option value="">Todos os tipos</option>
            {TIPOS_ATIVO_INV.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
          </SelectDark>
          <button onClick={() => setSoComValor((v) => !v)}
            aria-pressed={soComValor}
            title="Mostra apenas ativos com valor de mercado (posição ativa na carteira)"
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border ${
              soComValor
                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                : 'border-white/15 text-white/90 hover:border-white/30'
            }`}>
            <Wallet size={15} /> Somente com valor
          </button>
          <button onClick={handleAtualizarAtivos} disabled={atualizando}
            title="Re-busca nome e moeda oficiais dos ativos (corrige tickets que ficaram só com o código)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border border-white/15 text-white/90 hover:border-white/30 disabled:opacity-50">
            <RefreshCw size={15} className={atualizando ? 'animate-spin' : ''} />
            {atualizando ? 'Atualizando…' : 'Atualizar tickets'}
          </button>
          <button onClick={handleNormalizarTesouro} disabled={normalizando}
            title="Padroniza o código e o nome dos títulos do Tesouro já cadastrados (ex.: TD-IPCA-2040)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border border-white/15 text-white/90 hover:border-white/30 disabled:opacity-50">
            <RefreshCw size={15} className={normalizando ? 'animate-spin' : ''} />
            {normalizando ? 'Padronizando…' : 'Padronizar Tesouro'}
          </button>
          <Link to="/investimentos/avaliacoes"
            title="Seus mentores (IAs) avaliam cada ativo da carteira"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white border border-white/15 hover:border-white/30">
            <Sparkles size={15} style={{ color: '#8b5cf6' }} /> Avaliações
          </Link>
          <button onClick={abrirNovo} data-tutorial="ativos-novo"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white"
            style={{ background: '#3b82f6' }}>
            <Plus size={15} /> Novo ativo
          </button>
        </div>
      </div>

      <Toast msg={toast} />
      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] text-red-300">{error}</div>}

      {/* Lista — um card por tipo de ativo (mesmo estilo da página de Investimentos) */}
      {ativos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
          <p className="text-white font-medium">Nenhum ativo cadastrado</p>
          <p className="text-[13px] mt-1" style={{ color: MUTED }}>Comece adicionando o primeiro ativo da sua carteira.</p>
        </div>
      ) : (
        <>
          {!pesquisa && (
            <div data-tutorial="ativos-evolucao">
              <EvolucaoPorTipo />
              <div className="mb-5">
                <ResumoPorInstituicao />
              </div>
              {(segmentosAcoes.length > 0 || categoriasFII.length > 0) && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-5">
                  {segmentosAcoes.length > 0 && (
                    <RoscaCategoria titulo="Ações por segmento" fatias={segmentosAcoes}
                      centro="Ações" onFoco={(chave) => focar('ACOES', 'segmento', chave)} />
                  )}
                  {categoriasFII.length > 0 && (
                    <RoscaCategoria titulo="FIIs por categoria" fatias={categoriasFII}
                      centro="FIIs" onFoco={(chave) => focar('FII', 'categoria', chave)} />
                  )}
                </div>
              )}
            </div>
          )}
          {grupos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center text-[13px]" style={{ color: MUTED }}>
              {pesquisa
                ? `Nenhum ativo encontrado para “${pesquisa}”.`
                : soComValor
                  ? 'Nenhum ativo com valor de mercado na carteira.'
                  : 'Nenhum ativo encontrado.'}
            </div>
          ) : (
            <div className="space-y-3" data-tutorial="ativos-lista">
              {grupos.map((g) => (
                <QuadroTipoAtivos key={g.tipo} tipo={g.tipo} dados={dadosPorTipo.get(g.tipo) ?? null}
                  linhas={g.linhas} defaultAberto
                  focoSinal={foco?.tipo === g.tipo ? foco.n : null}
                  focoGrupo={foco?.tipo === g.tipo ? { dim: foco.dim, chave: foco.chave } : null}
                  acoes={{ onPosicoes: setPosicoesDe, onHistorico: setHistoricoDe, onEditar: abrirEditar }} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Drawer criar/editar ativo (componente compartilhado) */}
      {drawer && (
        <DrawerAtivo ativo={editando} onClose={() => setDrawer(false)} onToast={showToast} />
      )}

      {/* Drawer movimentações (posição = soma das operações) */}
      {posicoesDe && (
        <DrawerMovimentacoes ativo={posicoesDe} onClose={() => setPosicoesDe(null)} onToast={showToast} />
      )}

      {/* Drawer histórico mensal de valor de mercado */}
      {historicoDe && (
        <DrawerHistorico ativo={historicoDe} onClose={() => setHistoricoDe(null)} onToast={showToast} />
      )}

      <TutorialTour pageKey="investimentos-ativos-v1" passos={TUTORIAL_INVESTIMENTOS_ATIVOS} />
    </div>
  )
}

// ── Drawer de histórico mensal (valor de mercado) ───────────────

const mesAtual = () => new Date().toISOString().slice(0, 7)
const HIST_VAZIO = { conta_id: '', mes_ano: mesAtual(), valor_mercado: '', quantidade: '' }

function DrawerHistorico({ ativo, onClose, onToast }: {
  ativo: InvestimentoAtivo; onClose: () => void; onToast: (m: string) => void
}) {
  const { historico, loading, registrar, excluir } = useInvestimentosHistorico({ ativo_id: ativo.id })
  const { posicoes } = useInvestimentosPosicoes({ ativo_id: ativo.id, status: 'ATIVA' })
  const [form, setForm] = useState(HIST_VAZIO)
  const [salvando, setSalvando] = useState(false)

  // Contas onde o ativo tem posição ativa (destino natural do snapshot)
  const contasDoAtivo = [...new Map(posicoes.map((p) => [p.conta_id, p.contas?.nome ?? '—'])).entries()]

  async function salvar() {
    if (!form.conta_id) { onToast('Selecione a conta'); return }
    const valor = Number(form.valor_mercado)
    if (!(valor >= 0)) { onToast('Valor de mercado inválido'); return }
    setSalvando(true)
    const payload: RegistrarHistoricoInput = {
      ativo_id: ativo.id, conta_id: form.conta_id, mes_ano: form.mes_ano, valor_mercado: valor,
      ...(form.quantidade !== '' ? { quantidade: Number(form.quantidade) } : {}),
    }
    const res = await registrar(payload)
    setSalvando(false)
    if (res.ok) { setForm({ ...HIST_VAZIO, conta_id: form.conta_id }); onToast('Valor registrado!') }
    else onToast(res.erro ?? 'Erro ao registrar valor')
  }

  async function remover(id: string) {
    const res = await excluir(id)
    onToast(res.ok ? 'Registro removido.' : (res.erro ?? 'Erro ao remover'))
  }

  return (
    <Drawer open onClose={onClose} titulo={`Valor de mercado · ${ativo.ticker}`} subtitulo={ativo.nome}>
      <div className="rounded-lg border border-white/10 p-3 space-y-3">
        <Field label="Conta">
          <SelectDark value={form.conta_id} onChange={(e) => setForm({ ...form, conta_id: e.target.value })}>
            <option value="">Selecione...</option>
            {contasDoAtivo.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </SelectDark>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Mês">
            <Input type="month" value={form.mes_ano} onChange={(e) => setForm({ ...form, mes_ano: e.target.value })} />
          </Field>
          <Field label="Valor de mercado">
            <Input type="number" min={0} step="any" value={form.valor_mercado}
              onChange={(e) => setForm({ ...form, valor_mercado: e.target.value })} placeholder="0,00" />
          </Field>
        </div>
        <Field label="Quantidade (opcional — usa as posições se vazio)">
          <Input type="number" min={0} step="any" value={form.quantidade}
            onChange={(e) => setForm({ ...form, quantidade: e.target.value })} placeholder="Automática" />
        </Field>
        <button onClick={salvar} disabled={salvando}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: '#3b82f6' }}>
          <Plus size={14} /> Registrar valor do mês
        </button>
      </div>

      {loading ? (
        <p className="text-[13px]" style={{ color: MUTED }}>Carregando...</p>
      ) : historico.length === 0 ? (
        <p className="text-[13px] text-center py-4" style={{ color: MUTED }}>
          Nenhum valor registrado. Sem snapshots, o dashboard usa o valor de custo.
        </p>
      ) : (
        <div className="space-y-2">
          {historico.map((h) => (
            <div key={h.id} className="rounded-lg border border-white/10 p-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-white text-[14px] font-medium">
                  {h.mes_ano} · {formatBRL(h.valor_mercado)}
                </p>
                <p className="text-[12px]" style={{ color: MUTED }}>
                  {h.quantidade} un. ·{' '}
                  <span style={{ color: h.variacao_percentual >= 0 ? '#00c896' : '#ff5c7a' }}>
                    {h.variacao_percentual >= 0 ? '+' : ''}{h.variacao_percentual.toFixed(2)}%
                    {' '}({formatBRL(h.rentabilidade_mes)})
                  </span>
                </p>
              </div>
              <button onClick={() => remover(h.id)} className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-red-400/40" style={{ color: '#ff5c7a' }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
