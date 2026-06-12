import { useState, useEffect, useMemo, Fragment } from 'react'
import { Plus, Pencil, Trash2, Layers, ArrowLeft, LineChart, Search, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  useInvestimentosAtivos, useBuscaAtivoExterno,
  type CriarAtivoInput, type EditarAtivoInput,
} from '../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes, type CriarPosicaoInput } from '../hooks/useInvestimentosPosicoes'
import { useInvestimentosHistorico, type RegistrarHistoricoInput } from '../hooks/useInvestimentosHistorico'
import { useContas } from '../hooks/useContas'
import {
  Drawer, Field, Input, SelectDark, BtnSalvar, BtnCancelar, Toast, ModalExcluir,
} from '../components/ui/shared'
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
  AcoesSubtipo, ResultadoBuscaAtivo,
} from '../types'

const MUTED = '#8b92a8'

// Rótulo da categoria/subtipo de um ativo (FII: Tijolo/Papel…; Ações:
// ON/PN/BDR; Renda Fixa/Tesouro: CDB/LCI/Tesouro…). null = sem categoria.
function rotuloCategoriaAtivo(a: InvestimentoAtivo): string | null {
  if (a.tipo_ativo === 'FII' && a.fii_categoria) return FII_CATEGORIA_INFO[a.fii_categoria].label
  if (a.tipo_ativo === 'ACOES' && a.acoes_subtipo) return ACOES_SUBTIPO_LABEL[a.acoes_subtipo]
  if ((a.tipo_ativo === 'RENDA_FIXA' || a.tipo_ativo === 'TESOURO_DIRETO') && a.rf_subtipo) return SUBTIPO_RF_INFO[a.rf_subtipo].label
  return null
}

const FORM_VAZIO: CriarAtivoInput = {
  ticker: '', nome: '', tipo_ativo: 'ACOES', moeda: 'BRL', descricao: '', nota_usuario: null,
  rf_subtipo: null, rf_indexador: null, rf_taxa: null, rf_emissor: null,
  rf_vencimento: null, rf_garantia_fgc: null, rf_isento_ir: null,
  fii_categoria: null, acoes_subtipo: null,
}

const ehRendaFixa = (tipo: TipoAtivoInvestimento) => tipo === 'RENDA_FIXA' || tipo === 'TESOURO_DIRETO'

export default function AtivosInvestimentosPage() {
  const [tipoFiltro, setTipoFiltro] = useState<TipoAtivoInvestimento | ''>('')
  const [drawer,     setDrawer]     = useState(false)
  const [editando,   setEditando]   = useState<InvestimentoAtivo | null>(null)
  const [form,       setForm]       = useState<CriarAtivoInput>(FORM_VAZIO)
  const [salvando,   setSalvando]   = useState(false)
  const [excluindo,  setExcluindo]  = useState<InvestimentoAtivo | null>(null)
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
  const { ativos, loading, error, criar, editar, excluir } = useInvestimentosAtivos(filtros)

  // Categorias colapsadas (expansível). Vazio = todas abertas.
  const [catsFechadas, setCatsFechadas] = useState<Set<string>>(new Set())
  const toggleCat = (key: string) => setCatsFechadas((s) => {
    const n = new Set(s)
    if (n.has(key)) n.delete(key); else n.add(key)
    return n
  })

  // Contas (de investimento) onde cada ativo tem posição ATIVA — para
  // mostrar a conta do ativo e sinalizar os que ficaram sem posição.
  const { posicoes: todasPosicoes } = useInvestimentosPosicoes({})
  const contasPorAtivo = useMemo(() => {
    const m = new Map<string, Set<string>>()
    for (const p of todasPosicoes) {
      if (p.status !== 'ATIVA') continue
      const nome = p.contas?.nome
      if (!nome) continue
      if (!m.has(p.ativo_id)) m.set(p.ativo_id, new Set())
      m.get(p.ativo_id)!.add(nome)
    }
    return m
  }, [todasPosicoes])

  // Agrupa por Tipo → Categoria/subtipo (mesmo estilo do Relatório por categoria)
  const grupos = useMemo(() => {
    const porTipo = new Map<TipoAtivoInvestimento, Map<string, InvestimentoAtivo[]>>()
    for (const a of ativos) {
      if (!porTipo.has(a.tipo_ativo)) porTipo.set(a.tipo_ativo, new Map())
      const cats = porTipo.get(a.tipo_ativo)!
      const cat = rotuloCategoriaAtivo(a) ?? 'Sem categoria'
      if (!cats.has(cat)) cats.set(cat, [])
      cats.get(cat)!.push(a)
    }
    return [...porTipo.entries()]
      .sort((x, y) => TIPOS_ATIVO_INV.indexOf(x[0]) - TIPOS_ATIVO_INV.indexOf(y[0]))
      .map(([tipo, cats]) => ({
        tipo,
        total: [...cats.values()].reduce((s, l) => s + l.length, 0),
        categorias: [...cats.entries()].sort((a, b) => b[1].length - a[1].length).map(([cat, lista]) => ({ cat, lista })),
      }))
  }, [ativos])

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

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
    // Ações no exterior (Stocks) são, por padrão, em dólar. BDRs e ETFs
    // internacionais listados na B3 são cotados em BRL (campo editável).
    const moedaPadrao = tipo === 'STOCKS' ? 'USD' : 'BRL'
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
    if (!form.ticker.trim() || !form.nome.trim()) { showToast('Ticker e nome são obrigatórios'); return }
    setSalvando(true)
    const payload: CriarAtivoInput | EditarAtivoInput = {
      ...form,
      ticker: form.ticker.trim().toUpperCase(),
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

  async function confirmarExclusao() {
    if (!excluindo) return
    setSalvando(true)
    const res = await excluir(excluindo.id)
    setSalvando(false)
    if (res.ok) showToast('Ativo excluído.')
    else showToast(res.erro ?? 'Erro ao excluir')
    setExcluindo(null)
  }

  if (loading) return <LoadingMascote />

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
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
        <div className="flex items-center gap-2">
          <SelectDark value={tipoFiltro} onChange={(e) => setTipoFiltro(e.target.value as TipoAtivoInvestimento | '')}
            style={{ width: 'auto' }} className="!text-[13px] !py-2">
            <option value="">Todos os tipos</option>
            {TIPOS_ATIVO_INV.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
          </SelectDark>
          <button onClick={abrirNovo}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[13px] font-medium text-white"
            style={{ background: '#3b82f6' }}>
            <Plus size={15} /> Novo ativo
          </button>
        </div>
      </div>

      <Toast msg={toast} />
      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-[13px] text-red-300">{error}</div>}

      {/* Lista */}
      {ativos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-10 text-center">
          <p className="text-white font-medium">Nenhum ativo cadastrado</p>
          <p className="text-[13px] mt-1" style={{ color: MUTED }}>Comece adicionando o primeiro ativo da sua carteira.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-white/10 overflow-hidden">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="text-left" style={{ color: MUTED }}>
                <th className="px-4 py-2.5 font-medium">Ticker</th>
                <th className="px-4 py-2.5 font-medium">Nome</th>
                <th className="px-4 py-2.5 font-medium">Tipo</th>
                <th className="px-4 py-2.5 font-medium text-center">Nota</th>
                <th className="px-4 py-2.5 font-medium text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {grupos.map((g) => (
                <Fragment key={g.tipo}>
                  {/* Cabeçalho do tipo (pai) */}
                  <tr className="border-t border-white/10" style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <td colSpan={5} className="px-4 py-2">
                      <span className="text-[13px] font-bold uppercase tracking-wider" style={{ color: TIPO_ATIVO_COR[g.tipo] }}>{TIPO_ATIVO_LABEL[g.tipo]}</span>
                      <span className="text-[12px] ml-2" style={{ color: MUTED }}>· {g.total} {g.total === 1 ? 'ativo' : 'ativos'}</span>
                    </td>
                  </tr>
                  {g.categorias.map((c) => {
                    const temHeader = g.categorias.length > 1 || c.cat !== 'Sem categoria'
                    const key = `${g.tipo}|${c.cat}`
                    const aberta = !temHeader || !catsFechadas.has(key)
                    return (
                    <Fragment key={c.cat}>
                      {/* Cabeçalho da categoria (sub) — expansível */}
                      {temHeader && (
                        <tr className="border-t border-white/[0.03] cursor-pointer hover:bg-white/[0.02]" onClick={() => toggleCat(key)}>
                          <td colSpan={5} className="px-4 py-1.5">
                            <span className="inline-flex items-center gap-2 pl-1">
                              {aberta ? <ChevronDown size={12} style={{ color: MUTED }} /> : <ChevronRight size={12} style={{ color: MUTED }} />}
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: TIPO_ATIVO_COR[g.tipo] }} />
                              <span className="text-[12px] font-semibold" style={{ color: '#c5cad8' }}>{c.cat}</span>
                              <span className="text-[11px]" style={{ color: MUTED }}>· {c.lista.length}</span>
                            </span>
                          </td>
                        </tr>
                      )}
                      {aberta && c.lista.map((a) => (
                <tr key={a.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5">
                    <Link to={`/investimentos/ativos/${a.id}`} className="font-semibold text-white hover:underline">
                      {a.ticker}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-white/80">
                    {a.nome}
                    {(() => {
                      const cs = contasPorAtivo.get(a.id)
                      return cs && cs.size > 0
                        ? <span className="block text-[11px]" style={{ color: MUTED }}>{[...cs].join(', ')}</span>
                        : <span className="block text-[11px]" style={{ color: '#ffb74d' }}>Sem posição em conta</span>
                    })()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[12px] px-2 py-0.5 rounded-full"
                      style={{ background: `${TIPO_ATIVO_COR[a.tipo_ativo]}22`, color: TIPO_ATIVO_COR[a.tipo_ativo] }}>
                      {TIPO_ATIVO_LABEL[a.tipo_ativo]}
                    </span>
                    {a.tipo_ativo === 'RENDA_FIXA' && a.rf_subtipo && (
                      <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full border border-white/15" style={{ color: MUTED }}>
                        {SUBTIPO_RF_INFO[a.rf_subtipo].label}
                      </span>
                    )}
                    {a.tipo_ativo === 'FII' && a.fii_categoria && (
                      <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full border border-white/15" style={{ color: MUTED }}>
                        {FII_CATEGORIA_INFO[a.fii_categoria].label}
                      </span>
                    )}
                    {a.tipo_ativo === 'ACOES' && a.acoes_subtipo && (
                      <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full border border-white/15" style={{ color: MUTED }}>
                        {ACOES_SUBTIPO_LABEL[a.acoes_subtipo]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center text-white/80">{a.nota_usuario ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setPosicoesDe(a)} title="Posições"
                        className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
                        <Layers size={13} />
                      </button>
                      <button onClick={() => setHistoricoDe(a)} title="Valor de mercado"
                        className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
                        <LineChart size={13} />
                      </button>
                      <button onClick={() => abrirEditar(a)} title="Editar"
                        className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setExcluindo(a)} title="Excluir"
                        className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-red-400/40" style={{ color: '#ff5c7a' }}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
                      ))}
                    </Fragment>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
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
            <Field label="Nome">
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Ex.: Vale S.A." maxLength={120} disabled={!editando && !manualLivre} />
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

      {excluindo && (
        <ModalExcluir nome={excluindo.ticker}
          mensagem="Isso remove o ativo e todas as suas posições, operações e dividendos."
          onConfirmar={confirmarExclusao} onCancelar={() => setExcluindo(null)} salvando={salvando} />
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
    if (res.ok) { setForm(POS_VAZIO); onToast('Posição adicionada!') }
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
