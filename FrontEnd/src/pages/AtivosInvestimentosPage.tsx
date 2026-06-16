import { useState, useEffect, useMemo } from 'react'
import { Plus, Trash2, ArrowLeft, Search, RefreshCw } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip, Legend } from 'chart.js'
import {
  useInvestimentosAtivos, useBuscaAtivoExterno,
  type CriarAtivoInput, type EditarAtivoInput,
} from '../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes, type CriarPosicaoInput } from '../hooks/useInvestimentosPosicoes'
import { useInvestimentosHistorico, useBackfillHistorico, type RegistrarHistoricoInput } from '../hooks/useInvestimentosHistorico'
import { useInvestimentosDashboard, useInvestimentosRanking } from '../hooks/useInvestimentosDashboard'
import { useContas } from '../hooks/useContas'
import {
  Drawer, Field, Input, SelectDark, BtnSalvar, BtnCancelar, Toast,
} from '../components/ui/shared'
import QuadroTipoAtivos from '../components/ui/QuadroTipoAtivos'
import { linhaDeMeta, type AtivoLinha } from '../lib/ativosLinha'
import LoadingMascote from '../components/ui/LoadingMascote'
import { formatBRL, formatData } from '../lib/utils'
import {
  TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL, TIPO_ATIVO_COR,
  INDEXADORES_RF, INDEXADOR_RF_LABEL, INDEXADOR_RF_DESCRICAO,
  SUBTIPO_RF_INFO, subtiposParaTipo,
  CATEGORIAS_FII, FII_CATEGORIA_INFO,
  ACOES_SUBTIPOS, ACOES_SUBTIPO_LABEL, ACOES_SUBTIPO_DESCRICAO,
} from '../lib/constants'
import type {
  InvestimentoAtivo, TipoAtivoInvestimento, SubtipoRF, IndexadorRF, CategoriaFII,
  AcoesSubtipo, ResultadoBuscaAtivo, InvestimentoDashboardTipo, InvestimentoRankingAtivo,
} from '../types'

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend)

const MUTED = '#8b92a8'

const FORM_VAZIO: CriarAtivoInput = {
  ticker: '', nome: '', tipo_ativo: 'ACOES', moeda: 'BRL', descricao: '', nota_usuario: null,
  rf_subtipo: null, rf_indexador: null, rf_taxa: null, rf_emissor: null,
  rf_vencimento: null, rf_garantia_fgc: null, rf_isento_ir: null,
  fii_categoria: null, acoes_subtipo: null, cotacao_automatica: true,
}

const ehRendaFixa = (tipo: TipoAtivoInvestimento) => tipo === 'RENDA_FIXA' || tipo === 'TESOURO_DIRETO'

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

export default function AtivosInvestimentosPage() {
  const [tipoFiltro, setTipoFiltro] = useState<TipoAtivoInvestimento | ''>('')
  const [pesquisa,   setPesquisa]   = useState('')
  const [drawer,     setDrawer]     = useState(false)
  const [editando,   setEditando]   = useState<InvestimentoAtivo | null>(null)
  const [form,       setForm]       = useState<CriarAtivoInput>(FORM_VAZIO)
  const [salvando,   setSalvando]   = useState(false)
  const [toast,      setToast]      = useState<string | null>(null)
  const [posicoesDe, setPosicoesDe] = useState<InvestimentoAtivo | null>(null)
  const [historicoDe, setHistoricoDe] = useState<InvestimentoAtivo | null>(null)

  // Busca externa (ticker → nome/preço/características)
  const [busca,       setBusca]       = useState('')
  const [buscaDeb,    setBuscaDeb]    = useState('')
  const [selecionado, setSelecionado] = useState(false)  // nome veio da lista
  const [manualLivre, setManualLivre] = useState(false)  // fallback de cadastro manual
  const [precoSel,    setPrecoSel]    = useState<number | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca), 400)
    return () => clearTimeout(t)
  }, [busca])

  const { resultados, buscando, erroBusca } = useBuscaAtivoExterno(form.tipo_ativo, drawer ? buscaDeb : '')

  const filtros = tipoFiltro ? { tipo: tipoFiltro } : {}
  const { ativos, loading, error, criar, editar, atualizarAtivos } = useInvestimentosAtivos(filtros)
  const [atualizando, setAtualizando] = useState(false)

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
      const lista = porTipo.get(a.tipo_ativo) ?? []
      lista.push(linhaDeMeta(a, rankingPorAtivo.get(a.id), contasPorAtivo.get(a.id) ?? []))
      porTipo.set(a.tipo_ativo, lista)
    }
    return [...porTipo.entries()]
      .sort((x, y) => TIPOS_ATIVO_INV.indexOf(x[0]) - TIPOS_ATIVO_INV.indexOf(y[0]))
      .map(([tipo, linhas]) => ({ tipo, linhas }))
  }, [ativos, pesquisa, rankingPorAtivo, contasPorAtivo])

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

  function resetBusca() {
    setBusca(''); setBuscaDeb(''); setSelecionado(false); setManualLivre(false); setPrecoSel(null)
  }

  function abrirNovo() { setEditando(null); setForm(FORM_VAZIO); resetBusca(); setDrawer(true) }
  function abrirEditar(a: InvestimentoAtivo) {
    setEditando(a)
    setForm({
      ticker: a.ticker, nome: a.nome, tipo_ativo: a.tipo_ativo, moeda: a.moeda,
      descricao: a.descricao ?? '', nota_usuario: a.nota_usuario,
      rf_subtipo: a.rf_subtipo, rf_indexador: a.rf_indexador, rf_taxa: a.rf_taxa,
      rf_emissor: a.rf_emissor, rf_vencimento: a.rf_vencimento,
      rf_garantia_fgc: a.rf_garantia_fgc, rf_isento_ir: a.rf_isento_ir,
      fii_categoria: a.fii_categoria, acoes_subtipo: a.acoes_subtipo,
      cotacao_automatica: a.cotacao_automatica,
    })
    resetBusca()
    setSelecionado(true)   // já tem nome definido — não exige nova seleção
    setDrawer(true)
  }

  // Resultado escolhido na lista: preenche ticker, nome e características
  function selecionarResultado(r: ResultadoBuscaAtivo) {
    setForm({
      ...form,
      ticker: r.ticker,
      nome:   r.nome,
      moeda:  r.moeda || form.moeda,
      ...(r.emissor    ? { rf_emissor: r.emissor } : {}),
      ...(r.taxa       ? { rf_taxa: r.taxa } : {}),
      ...(r.vencimento ? { rf_vencimento: r.vencimento } : {}),
      ...(r.indexador  ? { rf_indexador: r.indexador } : {}),
    })
    setPrecoSel(r.preco)
    setSelecionado(true)
    setBusca(''); setBuscaDeb('')
  }

  // Troca de tipo limpa/pré-preenche as características específicas
  // e zera a busca/seleção (a fonte de dados muda com o tipo)
  function mudarTipo(tipo: TipoAtivoInvestimento) {
    if (!editando) { resetBusca() }
    const limpaIdent = editando ? {} : { ticker: '', nome: '' }
    // Ações no exterior (Stocks) e REITs são, por padrão, em dólar. BDRs e
    // ETFs internacionais listados na B3 são cotados em BRL (campo editável).
    const moedaPadrao = tipo === 'STOCKS' || tipo === 'REIT' ? 'USD' : 'BRL'
    if (tipo === 'TESOURO_DIRETO') {
      const info = SUBTIPO_RF_INFO.TESOURO
      setForm({ ...form, ...limpaIdent, tipo_ativo: tipo, fii_categoria: null, acoes_subtipo: null, moeda: 'BRL',
        rf_subtipo: 'TESOURO', rf_emissor: info.emissor,
        rf_garantia_fgc: info.fgc, rf_isento_ir: info.isentoIR })
    } else if (tipo === 'RENDA_FIXA') {
      setForm({ ...form, ...limpaIdent, tipo_ativo: tipo, fii_categoria: null, acoes_subtipo: null, moeda: 'BRL',
        rf_subtipo: form.rf_subtipo === 'TESOURO' ? null : form.rf_subtipo })
    } else {
      setForm({ ...form, ...limpaIdent, tipo_ativo: tipo, moeda: moedaPadrao,
        rf_subtipo: null, rf_indexador: null, rf_taxa: null, rf_emissor: null,
        rf_vencimento: null, rf_garantia_fgc: null, rf_isento_ir: null,
        fii_categoria: tipo === 'FII' ? form.fii_categoria : null,
        acoes_subtipo: tipo === 'ACOES' ? form.acoes_subtipo : null })
    }
  }

  // Subtipo de renda fixa pré-preenche FGC/IR/emissor (continuam editáveis)
  function mudarSubtipoRF(sub: SubtipoRF | '') {
    if (!sub) { setForm({ ...form, rf_subtipo: null }); return }
    const info = SUBTIPO_RF_INFO[sub]
    setForm({ ...form, rf_subtipo: sub,
      rf_emissor: form.rf_emissor || info.emissor || null,
      rf_garantia_fgc: info.fgc, rf_isento_ir: info.isentoIR })
  }

  async function salvar() {
    if (!editando && !selecionado && !manualLivre) {
      showToast('Busque e selecione o ativo na lista — ou ative o cadastro manual')
      return
    }
    if (!form.ticker.trim()) { showToast('Ticker é obrigatório'); return }
    setSalvando(true)
    const payload: CriarAtivoInput | EditarAtivoInput = {
      ...form,
      ticker: form.ticker.trim().toUpperCase(),
      // Nome opcional: se em branco, o backend busca o nome oficial pelo ticker
      nome: form.nome.trim(),
      descricao: form.descricao?.trim() || null,
      nota_usuario: form.nota_usuario === null || form.nota_usuario === undefined || Number.isNaN(form.nota_usuario)
        ? null : Number(form.nota_usuario),
    }
    const res = editando ? await editar(editando.id, payload) : await criar(payload as CriarAtivoInput)
    setSalvando(false)
    if (res.ok) { setDrawer(false); showToast(editando ? 'Ativo atualizado!' : 'Ativo criado!') }
    else showToast(res.erro ?? 'Erro ao salvar')
  }

  if (loading) return <LoadingMascote />

  return (
    <div className="p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/investimentos" className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="text-[22px] font-bold text-white">Meus ativos</h1>
            <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>Cartela de ativos e posições</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
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
          <button onClick={handleAtualizarAtivos} disabled={atualizando}
            title="Re-busca nome e moeda oficiais dos ativos (corrige tickets que ficaram só com o código)"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium border border-white/15 text-white/90 hover:border-white/30 disabled:opacity-50">
            <RefreshCw size={15} className={atualizando ? 'animate-spin' : ''} />
            {atualizando ? 'Atualizando…' : 'Atualizar tickets'}
          </button>
          <button onClick={abrirNovo}
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
          {!pesquisa && <EvolucaoPorTipo />}
          {grupos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center text-[13px]" style={{ color: MUTED }}>
              Nenhum ativo encontrado para “{pesquisa}”.
            </div>
          ) : (
            <div className="space-y-3">
              {grupos.map((g) => (
                <QuadroTipoAtivos key={g.tipo} tipo={g.tipo} dados={dadosPorTipo.get(g.tipo) ?? null}
                  linhas={g.linhas} defaultAberto
                  acoes={{ onPosicoes: setPosicoesDe, onHistorico: setHistoricoDe, onEditar: abrirEditar }} />
              ))}
            </div>
          )}
        </>
      )}

      {/* Drawer criar/editar ativo */}
      <Drawer open={drawer} onClose={() => setDrawer(false)}
        titulo={editando ? 'Editar ativo' : 'Novo ativo'}
        subtitulo={editando ? editando.ticker : 'Cadastre um ativo da sua carteira'}
        rodape={<><BtnCancelar onClick={() => setDrawer(false)} /><BtnSalvar editando={!!editando} onClick={salvar} salvando={salvando} /></>}>
        {/* 1) Tipo primeiro — define a fonte da busca */}
        <Field label="Tipo de ativo">
          <SelectDark value={form.tipo_ativo} onChange={(e) => mudarTipo(e.target.value as TipoAtivoInvestimento)}>
            {TIPOS_ATIVO_INV.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
          </SelectDark>
        </Field>

        {/* 2) Subtipo / categoria — refina a busca */}
        {form.tipo_ativo === 'RENDA_FIXA' && (
          <Field label="Tipo do título">
            <SelectDark value={form.rf_subtipo ?? ''} onChange={(e) => mudarSubtipoRF(e.target.value as SubtipoRF | '')}>
              <option value="">Selecione...</option>
              {subtiposParaTipo('RENDA_FIXA').map((s) => (
                <option key={s} value={s}>{SUBTIPO_RF_INFO[s].label}</option>
              ))}
            </SelectDark>
          </Field>
        )}
        {form.tipo_ativo === 'FII' && (
          <Field label="Categoria do fundo">
            <SelectDark value={form.fii_categoria ?? ''}
              onChange={(e) => setForm({ ...form, fii_categoria: (e.target.value || null) as CategoriaFII | null })}>
              <option value="">Selecione...</option>
              {CATEGORIAS_FII.map((c) => <option key={c} value={c}>{FII_CATEGORIA_INFO[c].label}</option>)}
            </SelectDark>
            {form.fii_categoria && (
              <div className="text-[12px] space-y-0.5 mt-1" style={{ color: MUTED }}>
                <p><span className="text-white/70">Compra:</span> {FII_CATEGORIA_INFO[form.fii_categoria].compra}</p>
                <p><span className="text-white/70">Fonte de lucro:</span> {FII_CATEGORIA_INFO[form.fii_categoria].fonteLucro}</p>
                <p><span className="text-white/70">Risco:</span> {FII_CATEGORIA_INFO[form.fii_categoria].risco} ·{' '}
                  <span className="text-white/70">Vantagem:</span> {FII_CATEGORIA_INFO[form.fii_categoria].vantagem}</p>
              </div>
            )}
          </Field>
        )}
        {form.tipo_ativo === 'ACOES' && (
          <Field label="Subtipo da ação">
            <SelectDark value={form.acoes_subtipo ?? ''}
              onChange={(e) => setForm({ ...form, acoes_subtipo: (e.target.value || null) as AcoesSubtipo | null })}>
              <option value="">Selecione...</option>
              {ACOES_SUBTIPOS.map((s) => <option key={s} value={s}>{ACOES_SUBTIPO_LABEL[s]}</option>)}
            </SelectDark>
            {form.acoes_subtipo && (
              <p className="text-[12px] mt-1" style={{ color: MUTED }}>{ACOES_SUBTIPO_DESCRICAO[form.acoes_subtipo]}</p>
            )}
          </Field>
        )}

        {/* 3) Busca na internet — ticker, nome e preço vêm da lista */}
        {!editando && (
          <div className="rounded-lg border border-white/10 p-3 space-y-2">
            <Field label="Buscar ativo (ticker ou nome)">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
                <Input value={busca} onChange={(e) => { setBusca(e.target.value); setSelecionado(false) }}
                  placeholder={form.tipo_ativo === 'TESOURO_DIRETO' ? 'Ex.: IPCA 2029, Selic...' : 'Ex.: PETR, Vale, BTC...'}
                  className="!pl-8" />
                {buscando && <RefreshCw size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 animate-spin" style={{ color: MUTED }} />}
              </div>
            </Field>

            {/* Resultados */}
            {buscaDeb.length >= 2 && !buscando && !selecionado && (
              resultados.length === 0 && !erroBusca ? (
                <p className="text-[12px]" style={{ color: MUTED }}>Nada encontrado para "{buscaDeb}".</p>
              ) : (
                <div className="max-h-52 overflow-y-auto space-y-1">
                  {resultados.map((r) => (
                    <button key={`${r.ticker}-${r.nome}`} type="button" onClick={() => selecionarResultado(r)}
                      className="w-full text-left px-2.5 py-1.5 rounded-md border border-white/10 hover:border-blue-400/50 hover:bg-blue-500/10 flex items-center justify-between gap-2">
                      <span className="min-w-0">
                        <span className="text-white text-[13px] font-semibold">{r.ticker}</span>
                        <span className="text-[12px] ml-2 truncate" style={{ color: MUTED }}>{r.nome}</span>
                      </span>
                      {r.preco != null && (
                        <span className="text-[12px] shrink-0" style={{ color: '#00c896' }}>{formatBRL(r.preco)}</span>
                      )}
                    </button>
                  ))}
                </div>
              )
            )}

            {erroBusca && (
              <p className="text-[12px]" style={{ color: '#ffb74d' }}>
                {erroBusca} — você pode cadastrar manualmente abaixo.
              </p>
            )}

            {/* Selecionado */}
            {selecionado && form.ticker && (
              <div className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-white text-[13px] font-semibold">{form.ticker}
                    {precoSel != null && <span className="ml-2 font-normal" style={{ color: '#00c896' }}>{formatBRL(precoSel)}</span>}
                  </p>
                  <p className="text-[12px] truncate" style={{ color: MUTED }}>{form.nome}</p>
                </div>
                <button type="button" onClick={() => { setSelecionado(false); setForm({ ...form, ticker: '', nome: '' }); setPrecoSel(null) }}
                  className="text-[12px] shrink-0 underline" style={{ color: MUTED }}>trocar</button>
              </div>
            )}

            {!selecionado && (
              <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: MUTED }}>
                <input type="checkbox" checked={manualLivre} onChange={(e) => setManualLivre(e.target.checked)} />
                Não encontrei — cadastrar manualmente
              </label>
            )}
          </div>
        )}

        {/* 4) Identificação — preenchida pela busca (editável só no manual) */}
        {(editando || manualLivre || selecionado) && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ticker">
                <Input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })}
                  placeholder="Ex.: VALE3" maxLength={20} disabled={!editando && !manualLivre} />
              </Field>
              <Field label="Moeda">
                <Input value={form.moeda} onChange={(e) => setForm({ ...form, moeda: e.target.value.toUpperCase() })} maxLength={3} placeholder="BRL" />
              </Field>
            </div>
            <Field label="Nome (opcional — busca automática pelo ticker)">
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Deixe em branco para buscar pelo ticker" maxLength={120} disabled={!editando && !manualLivre} />
            </Field>
          </>
        )}

        <div className="grid grid-cols-2 gap-3">
          <Field label="Nota (0–10)">
            <Input type="number" min={0} max={10} step={0.5}
              value={form.nota_usuario ?? ''}
              onChange={(e) => setForm({ ...form, nota_usuario: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="—" />
          </Field>
          <Field label="Descrição">
            <Input value={form.descricao ?? ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Opcional" />
          </Field>
        </div>

        {/* Busca automática de cotação — desligue para ativos sem fonte gratuita */}
        <label className="flex items-start gap-2 text-[13px] cursor-pointer rounded-lg border border-white/10 p-3">
          <input type="checkbox" className="mt-0.5"
            checked={form.cotacao_automatica !== false}
            onChange={(e) => setForm({ ...form, cotacao_automatica: e.target.checked })} />
          <span>
            <span className="text-white">Buscar cotação automaticamente</span>
            <span className="block text-[12px] mt-0.5" style={{ color: MUTED }}>
              Desligue para ativos sem fonte gratuita (ex.: FIIs pequenos, papéis deslistados).
              Ele sai das atualizações automáticas e do aviso de lacuna — você lança o valor manualmente.
            </span>
          </span>
        </label>

        {/* Características de renda fixa / Tesouro Direto */}
        {ehRendaFixa(form.tipo_ativo) && (
          <div className="rounded-lg border border-white/10 p-3 space-y-3">
            <p className="text-[13px] font-semibold text-white">Características do título</p>

            <Field label="Forma de rentabilidade">
              <SelectDark value={form.rf_indexador ?? ''}
                onChange={(e) => setForm({ ...form, rf_indexador: (e.target.value || null) as IndexadorRF | null })}>
                <option value="">Selecione...</option>
                {INDEXADORES_RF.map((i) => <option key={i} value={i}>{INDEXADOR_RF_LABEL[i]}</option>)}
              </SelectDark>
              {form.rf_indexador && (
                <p className="text-[12px] mt-1" style={{ color: MUTED }}>
                  {INDEXADOR_RF_DESCRICAO[form.rf_indexador]}
                </p>
              )}
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Taxa">
                <Input value={form.rf_taxa ?? ''} maxLength={40}
                  onChange={(e) => setForm({ ...form, rf_taxa: e.target.value || null })}
                  placeholder={form.rf_indexador === 'POS_FIXADO' ? '110% CDI'
                    : form.rf_indexador === 'HIBRIDO' ? 'IPCA + 6,2%' : '13,5% a.a.'} />
              </Field>
              <Field label="Vencimento">
                <Input type="date" value={form.rf_vencimento ?? ''}
                  onChange={(e) => setForm({ ...form, rf_vencimento: e.target.value || null })} />
              </Field>
            </div>

            <Field label="Emissor">
              <Input value={form.rf_emissor ?? ''} maxLength={80}
                onChange={(e) => setForm({ ...form, rf_emissor: e.target.value || null })}
                placeholder={form.rf_subtipo ? SUBTIPO_RF_INFO[form.rf_subtipo].emissor : 'Banco / empresa'} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-2 text-[13px] text-white/80 cursor-pointer">
                <input type="checkbox" checked={form.rf_garantia_fgc ?? false}
                  onChange={(e) => setForm({ ...form, rf_garantia_fgc: e.target.checked })} />
                Garantia do FGC
              </label>
              <label className="flex items-center gap-2 text-[13px] text-white/80 cursor-pointer">
                <input type="checkbox" checked={form.rf_isento_ir ?? false}
                  onChange={(e) => setForm({ ...form, rf_isento_ir: e.target.checked })} />
                Isento de IR
              </label>
            </div>
            {form.rf_subtipo && (
              <p className="text-[12px]" style={{ color: MUTED }}>
                {SUBTIPO_RF_INFO[form.rf_subtipo].label}: {SUBTIPO_RF_INFO[form.rf_subtipo].obsIR}
                {form.rf_subtipo === 'TESOURO' && ' · sem FGC (garantia soberana do Governo Federal)'}
                {SUBTIPO_RF_INFO[form.rf_subtipo].fgc && ' · FGC cobre até R$ 250 mil por CPF/instituição'}
              </p>
            )}
          </div>
        )}

      </Drawer>

      {/* Drawer posições */}
      {posicoesDe && (
        <DrawerPosicoes ativo={posicoesDe} onClose={() => setPosicoesDe(null)} onToast={showToast} />
      )}

      {/* Drawer histórico mensal de valor de mercado */}
      {historicoDe && (
        <DrawerHistorico ativo={historicoDe} onClose={() => setHistoricoDe(null)} onToast={showToast} />
      )}

    </div>
  )
}

// ── Drawer de posições de um ativo ──────────────────────────────

const POS_VAZIO = { conta_id: '', quantidade: '', preco_custo: '', data_compra: new Date().toISOString().split('T')[0] }

function DrawerPosicoes({ ativo, onClose, onToast }: {
  ativo: InvestimentoAtivo; onClose: () => void; onToast: (m: string) => void
}) {
  const { posicoes, loading, criar, excluir } = useInvestimentosPosicoes({ ativo_id: ativo.id })
  const { contas } = useContas()
  const { preencher } = useBackfillHistorico()
  const [form, setForm] = useState(POS_VAZIO)
  const [salvando, setSalvando] = useState(false)

  // Opções de conta: contas de investimento ativas + qualquer conta onde o
  // ativo já tem posição (mesmo inativa/outro tipo), pra nunca ficar vazio
  // quando a posição caiu numa conta que não é INVESTIMENTO ativa.
  const contasOpcoes = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of contas) if (c.tipo === 'INVESTIMENTO' && c.ativa) m.set(c.conta_id, c.nome)
    for (const p of posicoes) if (p.conta_id && !m.has(p.conta_id)) m.set(p.conta_id, p.contas?.nome ?? '—')
    return [...m.entries()]
  }, [contas, posicoes])

  async function adicionar() {
    if (!form.conta_id) { onToast('Selecione a conta'); return }
    const qtd = Number(form.quantidade), preco = Number(form.preco_custo)
    if (!(qtd > 0) || !(preco >= 0)) { onToast('Quantidade e preço inválidos'); return }
    setSalvando(true)
    const payload: CriarPosicaoInput = {
      ativo_id: ativo.id, conta_id: form.conta_id, quantidade: qtd, preco_custo: preco, data_compra: form.data_compra,
    }
    const res = await criar(payload)
    setSalvando(false)
    if (res.ok) {
      setForm(POS_VAZIO); onToast('Posição adicionada!')
      // Reconstrói o histórico de cotação deste ativo (desde a data de compra)
      preencher({ ativo_id: ativo.id }).then((bf) => {
        if (bf.ok && (bf.dados?.meses_gravados ?? 0) > 0) onToast(`Histórico reconstruído: ${bf.dados!.meses_gravados} mês(es).`)
      })
    }
    else onToast(res.erro ?? 'Erro ao adicionar posição')
  }

  async function remover(id: string) {
    const res = await excluir(id)
    onToast(res.ok ? 'Posição removida.' : (res.erro ?? 'Erro ao remover'))
  }

  return (
    <Drawer open onClose={onClose} titulo={`Posições · ${ativo.ticker}`} subtitulo={ativo.nome}>
      {/* Form rápido */}
      <div className="rounded-lg border border-white/10 p-3 space-y-3">
        <Field label="Conta">
          <SelectDark value={form.conta_id} onChange={(e) => setForm({ ...form, conta_id: e.target.value })}>
            <option value="">Selecione...</option>
            {contasOpcoes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </SelectDark>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade">
            <Input type="number" min={0} step="any" value={form.quantidade}
              onChange={(e) => setForm({ ...form, quantidade: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Preço de custo">
            <Input type="number" min={0} step="any" value={form.preco_custo}
              onChange={(e) => setForm({ ...form, preco_custo: e.target.value })} placeholder="0,00" />
          </Field>
        </div>
        <Field label="Data da compra">
          <Input type="date" value={form.data_compra} onChange={(e) => setForm({ ...form, data_compra: e.target.value })} />
        </Field>
        <button onClick={adicionar} disabled={salvando}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: '#3b82f6' }}>
          <Plus size={14} /> Adicionar posição
        </button>
      </div>

      {/* Lista de posições */}
      {loading ? (
        <p className="text-[13px]" style={{ color: MUTED }}>Carregando...</p>
      ) : posicoes.length === 0 ? (
        <p className="text-[13px] text-center py-4" style={{ color: MUTED }}>Nenhuma posição neste ativo.</p>
      ) : (
        <div className="space-y-2">
          {posicoes.map((p) => (
            <div key={p.id} className="rounded-lg border border-white/10 p-3 flex items-center justify-between gap-2">
              <div>
                <p className="text-white text-[14px] font-medium">{p.contas?.nome ?? '—'}</p>
                <p className="text-[12px]" style={{ color: MUTED }}>
                  {p.quantidade} × {formatBRL(p.preco_custo)} = {formatBRL(p.valor_custo)} · {formatData(p.data_compra)}
                </p>
              </div>
              <button onClick={() => remover(p.id)} className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-red-400/40" style={{ color: '#ff5c7a' }}>
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Drawer>
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
