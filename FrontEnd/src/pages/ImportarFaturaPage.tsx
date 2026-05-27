// src/pages/ImportarFaturaPage.tsx
//
// Importação de Fatura de Cartão — ciclo completo:
//   Fase 1 — Classificar itens (atribuir categoria ou ignorar)
//             Botão "Aplicar todas as sugestões" aplica em lote.
//             Sufixo "- Parcela X/Y" removido da descrição exibida.
//   Fase 2 — Escolher modo: REGISTRO (1 lançamento por item) ou
//             CATEGORIA (agrupar — parcelas viram grupos separados).
//   Fase 3 — Preview/confirmação.
//             CATEGORIA: grupos com checkboxes para separar itens.
//             REGISTRO : botão "🔗 Vincular…" para associar manualmente.

import { useState, useMemo, useEffect, useRef, Fragment } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  FileUp, Receipt, Trash2, ArrowLeft, AlertCircle,
  XCircle, RotateCcw, ChevronDown, Pencil,
} from 'lucide-react'
import { useContas } from '../hooks/useContas'
import { useCategorias } from '../hooks/useCategorias'
import { useFaturasImport, useFaturaImportSessao } from '../hooks/useFaturasImport'
import { formatBRL } from '../lib/utils'
import { Field, SelectDark, Toast, ModalExcluir } from '../components/ui/shared'
import ModalNovaCategoriaRapida from '../components/ui/ModalNovaCategoriaRapida'
import LoadingMascote from '../components/ui/LoadingMascote'
import type {
  FaturaImportSessao, FaturaImportItem, StatusFaturaImport, TxCandidata, Categoria,
} from '../types'

// ── Constantes de status ────────────────────────────────────────
const STATUS_LABEL: Record<StatusFaturaImport, string> = {
  EM_ANALISE: 'Em análise',
  CONFIRMADA: 'Confirmada',
  CANCELADA:  'Cancelada',
}
const STATUS_COR: Record<StatusFaturaImport, string> = {
  EM_ANALISE: '#f0b429',
  CONFIRMADA: '#00c896',
  CANCELADA:  '#8b92a8',
}

// ── Tipos locais ────────────────────────────────────────────────
type DecisaoImport = 'CRIAR' | 'ATUALIZAR'

interface LancamentoPreview {
  chave:                  string
  descricao:              string
  valor:                  number
  data:                   string
  categoria_id:           string
  categoria_nome:         string
  tipo:                   'RECEITA' | 'DESPESA'
  decisaoSugerida:        DecisaoImport
  transacao_existente_id: string | null
  item_ids:               string[]
}

interface GrupoImport {
  id:                     string
  categoria_id:           string
  item_ids:               string[]
  decisao:                DecisaoImport
  transacao_existente_id: string | null
  descricao:              string
}

// ── Helpers ─────────────────────────────────────────────────────

/** Remove "- Parcela X/Y" e variações do final da descrição. */
function stripParcela(s: string): string {
  return s
    .replace(/\s*[-–—]\s*(?:parc(?:ela)?\.?\s*)?\d+\s*\/\s*\d+\s*$/i, '')
    .replace(/\s*\(?\s*\d+\s*\/\s*\d+\s*\)?\s*$/i, '')
    .replace(/\s+parc(?:ela)?\.?\s*\d+\s*\/\s*\d+\s*$/i, '')
    .trim()
}

/** Inicializa grupos para o modo CATEGORIA:
 *  – Parcelas → 1 grupo por item.
 *  – Não-parcelas → 1 grupo por categoria. */
function initGrupos(
  itens:     FaturaImportItem[],
  catPorId:  Map<string, { descricao: string }>,
  contaNome: string,
): GrupoImport[] {
  const naoIgnorados = itens.filter(i => i.decisao !== 'IGNORAR' && !!i.categoria_escolhida_id)
  const comParcela   = naoIgnorados.filter(i => i.parcela_atual != null)
  const semParcela   = naoIgnorados.filter(i => i.parcela_atual == null)
  const result: GrupoImport[] = []

  for (const it of comParcela) {
    result.push({
      id:                     `parc-${it.id}`,
      categoria_id:           it.categoria_escolhida_id!,
      item_ids:               [it.id],
      decisao:                it.transacao_existente_id ? 'ATUALIZAR' : 'CRIAR',
      transacao_existente_id: it.transacao_existente_id,
      descricao:              stripParcela(it.descricao),
    })
  }

  const catMap = new Map<string, FaturaImportItem[]>()
  for (const it of semParcela) {
    const k = it.categoria_escolhida_id!
    if (!catMap.has(k)) catMap.set(k, [])
    catMap.get(k)!.push(it)
  }
  for (const [catId, items] of catMap) {
    const txEx = items.find(i => i.transacao_existente_id)?.transacao_existente_id ?? null
    result.push({
      id:                     `cat-${catId}`,
      categoria_id:           catId,
      item_ids:               items.map(i => i.id),
      decisao:                txEx ? 'ATUALIZAR' : 'CRIAR',
      transacao_existente_id: txEx,
      descricao:              `${contaNome} - ${catPorId.get(catId)?.descricao ?? ''}`.trim(),
    })
  }
  return result
}

// ── Router ───────────────────────────────────────────────────────
export default function ImportarFaturaPage() {
  const { id } = useParams()
  if (id) return <Sandbox id={id} />
  return <ListagemEUpload />
}

// ── Listagem + Upload ────────────────────────────────────────────
function ListagemEUpload() {
  const navigate = useNavigate()
  const { contas, loading: loadingContas } = useContas()
  const { sessoes, loading: loadingSessoes, importar, excluir } = useFaturasImport()

  const cartoes = contas.filter(c => c.tipo === 'CARTAO' && c.ativa)

  const [contaId,       setContaId]       = useState<string>('')
  const [arquivo,       setArquivo]       = useState<File | null>(null)
  const [enviando,      setEnviando]      = useState(false)
  const [feedback,      setFeedback]      = useState<string | null>(null)
  const [erro,          setErro]          = useState<string | null>(null)
  const [sessaoExcluir, setSessaoExcluir] = useState<FaturaImportSessao | null>(null)

  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3000) }

  const enviar = async () => {
    setErro(null)
    if (!contaId)  { setErro('Escolha um cartão.'); return }
    if (!arquivo)  { setErro('Selecione o PDF da fatura.'); return }
    setEnviando(true)
    const r = await importar({ conta_id: contaId, arquivo })
    setEnviando(false)
    if (r.ok && r.dados) {
      setArquivo(null)
      toast('Fatura recebida — abra a sandbox para revisar.')
      navigate(`/importar-fatura/${r.dados.id}`)
    } else {
      setErro(r.erro ?? 'Falha ao enviar a fatura.')
    }
  }

  const handleExcluir = async () => {
    if (!sessaoExcluir) return
    const r = await excluir(sessaoExcluir.id)
    setSessaoExcluir(null)
    toast(r.ok ? 'Sessão excluída.' : (r.erro ?? 'Falha ao excluir.'))
  }

  return (
    <div className="p-5">
      <div className="flex items-center gap-2 mb-5">
        <Receipt size={22} style={{ color: '#e8eaf0' }} />
        <h1 className="text-[21px] font-bold" style={{ color: '#e8eaf0' }}>
          Importação de Fatura de Cartão
        </h1>
      </div>

      <Toast msg={feedback} />

      <div className="rounded-xl border border-white/10 bg-[#1a1f2e] p-4 mb-6 max-w-2xl">
        <h2 className="text-[17px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>
          Nova importação
        </h2>
        <p className="text-[14px] mb-4" style={{ color: '#8b92a8' }}>
          Escolha o cartão e envie o PDF da fatura. Os lançamentos vão para uma
          área de revisão (sandbox) antes de serem confirmados no extrato.
        </p>
        <div className="grid gap-3">
          <Field label="Cartão">
            {loadingContas ? (
              <p className="text-[14px]" style={{ color: '#8b92a8' }}>Carregando…</p>
            ) : cartoes.length === 0 ? (
              <p className="text-[14px]" style={{ color: '#f0b429' }}>
                Você ainda não tem contas do tipo Cartão.{' '}
                <Link to="/contas" className="underline" style={{ color: '#4da6ff' }}>Criar uma agora</Link>.
              </p>
            ) : (
              <SelectDark value={contaId} onChange={e => setContaId(e.target.value)}>
                <option value="" style={{ background: '#1a1f2e', color: '#8b92a8' }}>— selecione —</option>
                {cartoes.map(c => (
                  <option key={c.conta_id} value={c.conta_id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                    {c.nome}
                  </option>
                ))}
              </SelectDark>
            )}
          </Field>

          <Field label="PDF da fatura">
            <label
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed cursor-pointer hover:bg-white/5 transition-colors"
              style={{ borderColor: '#8b92a8', color: '#e8eaf0' }}>
              <FileUp size={16} style={{ color: '#4da6ff' }} />
              <span className="text-[15px]">{arquivo ? arquivo.name : 'Escolher PDF…'}</span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={e => setArquivo(e.target.files?.[0] ?? null)}
              />
            </label>
          </Field>

          {erro && (
            <p className="text-[14px] bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
              style={{ color: '#f87171' }}>{erro}</p>
          )}

          <button
            onClick={enviar}
            disabled={enviando || cartoes.length === 0}
            className="w-full md:w-auto md:self-end px-4 py-2 rounded-lg bg-av-green text-[16px] font-semibold hover:bg-av-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ color: '#0a0f1a' }}>
            {enviando ? 'Enviando…' : 'Enviar fatura'}
          </button>
        </div>
      </div>

      <h2 className="text-[17px] font-semibold mb-2" style={{ color: '#e8eaf0' }}>
        Importações anteriores
      </h2>

      {loadingSessoes && (
        <div className="py-8"><LoadingMascote texto="Carregando sessões…" size={120} /></div>
      )}
      {!loadingSessoes && sessoes.length === 0 && (
        <p className="text-[15px] italic" style={{ color: '#8b92a8' }}>
          Nenhuma importação registrada ainda.
        </p>
      )}
      {!loadingSessoes && sessoes.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sessoes.map(s => (
            <div key={s.id}
              className="rounded-xl border border-white/10 bg-[#1a1f2e] p-3 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[16px] font-semibold truncate" style={{ color: '#e8eaf0' }}>
                  {s.conta?.nome ?? 'Cartão'}
                </p>
                <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: `${STATUS_COR[s.status]}22`, color: STATUS_COR[s.status] }}>
                  {STATUS_LABEL[s.status]}
                </span>
              </div>
              <p className="text-[13px] truncate" style={{ color: '#8b92a8' }}>{s.arquivo_nome}</p>
              <div className="flex items-center justify-between text-[13px]" style={{ color: '#8b92a8' }}>
                <span>{new Date(s.criado_em).toLocaleDateString('pt-BR')}</span>
                {s.valor_total != null && <span>{formatBRL(s.valor_total)}</span>}
              </div>
              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={() => navigate(`/importar-fatura/${s.id}`)}
                  className="flex-1 text-[14px] px-2.5 py-1.5 rounded-md border border-white/10 hover:border-av-green hover:text-av-green transition-colors"
                  style={{ color: '#e8eaf0' }}>
                  {s.status === 'EM_ANALISE' ? 'Revisar' : 'Ver detalhes'}
                </button>
                <button
                  onClick={() => setSessaoExcluir(s)}
                  title="Excluir sessão"
                  className="w-8 h-8 rounded-md border border-white/10 flex items-center justify-center hover:bg-red-400/10 hover:border-red-400/30 transition-colors"
                  style={{ color: '#f87171' }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {sessaoExcluir && (
        <ModalExcluir
          nome={sessaoExcluir.arquivo_nome}
          mensagem="A sessão e todos os itens em revisão serão excluídos. Esta ação não pode ser desfeita."
          onConfirmar={handleExcluir}
          onCancelar={() => setSessaoExcluir(null)}
          salvando={false}
        />
      )}
    </div>
  )
}

// ── Sandbox ──────────────────────────────────────────────────────
function Sandbox({ id }: { id: string }) {
  const navigate  = useNavigate()
  const {
    sessao, loading, error, editarItem, sugerir, confirmar,
    aplicarSugestoes, buscarTransacoes,
  } = useFaturaImportSessao(id)
  const { categorias } = useCategorias()
  const { contas }     = useContas()

  // ── Estado – geral ──────────────────────────────────────────
  const [confirmando,      setConfirmando]      = useState(false)
  const [feedback,         setFeedback]         = useState<string | null>(null)
  const [filtroDesc,       setFiltroDesc]       = useState('')
  const [selecionados,     setSelecionados]     = useState<Set<string>>(new Set())
  const [emLote,           setEmLote]           = useState(false)
  const [modoImportacao,   setModoImportacao]   = useState<null | 'REGISTRO' | 'CATEGORIA'>(null)
  const [gruposEncolhidos, setGruposEncolhidos] = useState<Set<string>>(new Set())
  const [aplicandoSugest,  setAplicandoSugest]  = useState(false)
  const [ordemFase1,       setOrdemFase1]       = useState<'original' | 'titulo_az' | 'titulo_za'>('original')
  const sugeridoRef = useRef(false)

  // ── Estado – REGISTRO: overrides de preview ─────────────────
  const [decisoesOverride,   setDecisaoOverride]   = useState<Map<string, DecisaoImport>>(new Map())
  const [descricoesOverride, setDescricaoOverride] = useState<Map<string, string>>(new Map())
  const [editandoDesc,       setEditandoDesc]       = useState<string | null>(null)
  const [descEditTemp,       setDescEditTemp]       = useState('')

  // ── Estado – CATEGORIA: grupos ──────────────────────────────
  const [grupos,              setGrupos]              = useState<GrupoImport[]>([])
  const [selGrupo,            setSelGrupo]            = useState<Map<string, Set<string>>>(new Map())
  // grupoId → set de itemIds selecionados para separar
  const [editandoDescGrupo,   setEditandoDescGrupo]   = useState<string | null>(null)
  const [descEditTempGrupo,   setDescEditTempGrupo]   = useState('')

  // ── Estado – Vincular modal ─────────────────────────────────
  const [vincularModal,  setVincularModal]  = useState<{ grupoId?: string; itemId?: string } | null>(null)
  const [txCandidatas,   setTxCandidatas]   = useState<TxCandidata[]>([])
  const [buscandoTxs,    setBuscandoTxs]    = useState(false)
  const [filtroTxBusca,  setFiltroTxBusca]  = useState('')

  // ── Estado – Nova Categoria modal ───────────────────────────
  // itemId = item-alvo (null = aplica em todos os selecionados)
  const [novaCatCtx, setNovaCatCtx] = useState<{ itemId: string | null } | null>(null)

  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3500) }

  // ── Efeito: sugestão automática ao carregar ─────────────────
  useEffect(() => {
    if (sugeridoRef.current || !sessao || sessao.status !== 'EM_ANALISE') return
    sugeridoRef.current = true
    sugerir()
  }, [sessao?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Efeito: limpa overrides ao trocar de modo ───────────────
  useEffect(() => {
    setDecisaoOverride(new Map())
    setDescricaoOverride(new Map())
    setEditandoDesc(null)
    setGrupos([])
    setSelGrupo(new Map())
    setEditandoDescGrupo(null)
  }, [modoImportacao])

  // ── Efeito: inicializa grupos ao entrar no modo CATEGORIA ───
  useEffect(() => {
    if (modoImportacao !== 'CATEGORIA' || !sessao) return
    const conta = contas.find(c => c.conta_id === sessao.conta_id)
    setGrupos(initGrupos(sessao.itens ?? [], catPorId, conta?.nome ?? 'Fatura'))
    setSelGrupo(new Map())
  }, [modoImportacao]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Dados derivados ─────────────────────────────────────────
  const catPorId = useMemo(() => new Map(categorias.map(c => [c.id, c])), [categorias])
  const catsPai  = useMemo(() => categorias.filter(c => !c.id_pai && !c.protegida && c.ativa), [categorias])
  const catsSub  = useMemo(() => categorias.filter(c => !!c.id_pai && c.ativa), [categorias])

  const itens         = sessao?.itens ?? []
  const naoClassif    = itens.filter(i => !i.categoria_escolhida_id && i.decisao !== 'IGNORAR')
  const classificados = itens.filter(i =>  i.categoria_escolhida_id || i.decisao === 'IGNORAR')

  const itensSugeridos = naoClassif.filter(i => !!i.categoria_sugerida_id)

  const nd = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const naoClassifFiltrados = filtroDesc.trim()
    ? naoClassif.filter(i => nd(i.descricao).includes(nd(filtroDesc.trim())))
    : naoClassif
  const selAtivos  = naoClassifFiltrados.filter(i => selecionados.has(i.id))
  const todosSelec = naoClassifFiltrados.length > 0 && selAtivos.length === naoClassifFiltrados.length
  const algumSelec = selAtivos.length > 0

  const naoClassifOrdenados = (() => {
    const cmp = (a: FaturaImportItem, b: FaturaImportItem) =>
      stripParcela(a.descricao).localeCompare(stripParcela(b.descricao), 'pt-BR')
    if (ordemFase1 === 'titulo_az') return [...naoClassifFiltrados].sort(cmp)
    if (ordemFase1 === 'titulo_za') return [...naoClassifFiltrados].sort((a, b) => cmp(b, a))
    return naoClassifFiltrados
  })()

  const gruposClassOrdenados = (() => {
    const m = new Map<string, FaturaImportItem[]>()
    for (const it of classificados) {
      const key = it.categoria_escolhida_id ?? '__IGNORAR__'
      if (!m.has(key)) m.set(key, [])
      m.get(key)!.push(it)
    }
    return [...m.entries()].sort(([a], [b]) => {
      if (a === '__IGNORAR__') return 1
      if (b === '__IGNORAR__') return -1
      return (catPorId.get(a)?.descricao ?? '').localeCompare(catPorId.get(b)?.descricao ?? '', 'pt-BR')
    })
  })()

  // Preview REGISTRO (useMemo — não usado no modo CATEGORIA)
  const lancamentosPreview = useMemo((): LancamentoPreview[] => {
    if (modoImportacao !== 'REGISTRO' || !sessao) return []
    const naoIgnoradosL = (sessao.itens ?? []).filter(
      i => i.decisao !== 'IGNORAR' && i.categoria_escolhida_id,
    )
    const vencMes = sessao.vencimento_fatura?.slice(0, 7) ?? null
    return naoIgnoradosL.map(it => ({
      chave:                  it.id,
      descricao:              it.descricao,
      valor:                  Number(it.valor),
      data:                   (it.parcela_atual != null && vencMes) ? `${vencMes}-01` : it.data_compra,
      categoria_id:           it.categoria_escolhida_id!,
      categoria_nome:         catPorId.get(it.categoria_escolhida_id!)?.descricao ?? '',
      tipo:                   it.tipo,
      decisaoSugerida:        (it.transacao_existente_id ? 'ATUALIZAR' : 'CRIAR') as DecisaoImport,
      transacao_existente_id: it.transacao_existente_id,
      item_ids:               [it.id],
    }))
  }, [modoImportacao, sessao, catPorId])

  const totalFatura = itens.reduce(
    (s, i) => s + (i.tipo === 'RECEITA' ? -Number(i.valor) : Number(i.valor)), 0,
  )

  const fase: 'classificar' | 'modo' | 'preview' =
    naoClassif.length > 0 ? 'classificar'
    : modoImportacao === null ? 'modo'
    : 'preview'

  const podeConfirmar =
    sessao?.status === 'EM_ANALISE' &&
    itens.length > 0 &&
    fase === 'preview'

  // ── Handlers – Fase 1 ───────────────────────────────────────
  const emAnalise = sessao?.status === 'EM_ANALISE'

  const classificar = (it: FaturaImportItem, catId: string | null) =>
    editarItem(it.id, { categoria_escolhida_id: catId || null, decisao: 'PENDENTE' })

  const aplicarSugestao = (it: FaturaImportItem) => {
    if (it.categoria_sugerida_id) classificar(it, it.categoria_sugerida_id)
  }

  const ignorar = (itemId: string) =>
    editarItem(itemId, { decisao: 'IGNORAR', categoria_escolhida_id: null })

  const voltar = (itemId: string) =>
    editarItem(itemId, { categoria_escolhida_id: null, decisao: 'PENDENTE' })

  const toggleItem = (itemId: string) =>
    setSelecionados(prev => {
      const next = new Set(prev)
      if (next.has(itemId)) next.delete(itemId); else next.add(itemId)
      return next
    })

  const toggleTodos = () =>
    setSelecionados(prev => {
      const next = new Set(prev)
      if (todosSelec) naoClassifFiltrados.forEach(i => next.delete(i.id))
      else            naoClassifFiltrados.forEach(i => next.add(i.id))
      return next
    })

  const classificarSelecionados = async (catId: string) => {
    if (!catId || emLote) return
    setEmLote(true)
    try {
      const targets = naoClassif.filter(i => selecionados.has(i.id))
      for (const it of targets) await classificar(it, catId)
      setSelecionados(new Set())
    } finally { setEmLote(false) }
  }

  const ignorarSelecionados = async () => {
    if (emLote) return
    setEmLote(true)
    try {
      const ids = [...selecionados].filter(sid => naoClassif.some(i => i.id === sid))
      for (const sid of ids) await ignorar(sid)
      setSelecionados(new Set())
    } finally { setEmLote(false) }
  }

  const handleAplicarSugestoes = async () => {
    if (!emAnalise || aplicandoSugest || itensSugeridos.length === 0) return
    setAplicandoSugest(true)
    const r = await aplicarSugestoes()
    setAplicandoSugest(false)
    const n = r.dados?.aplicados ?? 0
    toast(r.ok
      ? `${n} sugestão${n !== 1 ? 'ões' : ''} aplicada${n !== 1 ? 's' : ''}.`
      : (r.erro ?? 'Erro ao aplicar sugestões.'))
  }

  // ── Handlers – REGISTRO preview ─────────────────────────────
  const setDecisaoLancamento = (chave: string, d: DecisaoImport) =>
    setDecisaoOverride(prev => new Map(prev).set(chave, d))

  const iniciarEdicaoDesc = (chave: string, descAtual: string) => {
    setEditandoDesc(chave)
    setDescEditTemp(descAtual)
  }
  const confirmarEdicaoDesc = (chave: string) => {
    if (descEditTemp.trim()) setDescricaoOverride(prev => new Map(prev).set(chave, descEditTemp.trim()))
    setEditandoDesc(null)
  }
  const cancelarEdicaoDesc = () => setEditandoDesc(null)
  const toggleGrupo = (key: string) =>
    setGruposEncolhidos(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  // ── Handlers – CATEGORIA grupos ─────────────────────────────
  const toggleSelGrupo = (grupoId: string, itemId: string) =>
    setSelGrupo(prev => {
      const next = new Map(prev)
      const sel  = new Set(next.get(grupoId) ?? [])
      if (sel.has(itemId)) sel.delete(itemId); else sel.add(itemId)
      next.set(grupoId, sel)
      return next
    })

  const separarItensGrupo = (grupoId: string, idsParaSeparar: string[]) => {
    setGrupos(prev => {
      const idx = prev.findIndex(g => g.id === grupoId)
      if (idx === -1) return prev
      const grupo     = prev[idx]
      const restantes = grupo.item_ids.filter(id => !idsParaSeparar.includes(id))
      if (restantes.length === 0) return prev  // não deixa grupo ficar vazio

      const priItem = (sessao?.itens ?? []).find(i => i.id === idsParaSeparar[0])
      const next    = [...prev]
      next[idx] = { ...grupo, item_ids: restantes }
      next.push({
        id:                     `sep-${Date.now()}`,
        categoria_id:           grupo.categoria_id,
        item_ids:               idsParaSeparar,
        decisao:                'CRIAR',
        transacao_existente_id: null,
        descricao:              priItem ? stripParcela(priItem.descricao) : grupo.descricao,
      })
      return next
    })
    setSelGrupo(prev => { const n = new Map(prev); n.delete(grupoId); return n })
  }

  const setDecisaoGrupo = (grupoId: string, d: DecisaoImport) =>
    setGrupos(prev => prev.map(g => g.id === grupoId ? { ...g, decisao: d } : g))

  const iniciarEdicaoDescGrupo = (grupoId: string, desc: string) => {
    setEditandoDescGrupo(grupoId)
    setDescEditTempGrupo(desc)
  }
  const confirmarEdicaoDescGrupo = (grupoId: string) => {
    if (descEditTempGrupo.trim())
      setGrupos(prev => prev.map(g => g.id === grupoId ? { ...g, descricao: descEditTempGrupo.trim() } : g))
    setEditandoDescGrupo(null)
  }
  const cancelarEdicaoDescGrupo = () => setEditandoDescGrupo(null)

  // ── Handlers – Vincular modal ────────────────────────────────
  const abrirVincular = async (params: { grupoId?: string; itemId?: string; desc?: string }) => {
    setVincularModal({ grupoId: params.grupoId, itemId: params.itemId })
    setFiltroTxBusca(params.desc ?? '')
    setBuscandoTxs(true)
    setTxCandidatas([])
    const r = await buscarTransacoes(params.desc ?? '')
    setBuscandoTxs(false)
    if (r.ok) setTxCandidatas(r.dados ?? [])
  }

  const confirmarVincular = async (tx: TxCandidata) => {
    if (!vincularModal) return
    if (vincularModal.grupoId) {
      setGrupos(prev => prev.map(g =>
        g.id === vincularModal.grupoId
          ? { ...g, transacao_existente_id: tx.id, decisao: 'ATUALIZAR' }
          : g,
      ))
    } else if (vincularModal.itemId) {
      setDecisaoOverride(prev => new Map(prev).set(vincularModal.itemId!, 'ATUALIZAR'))
      await editarItem(vincularModal.itemId, { transacao_existente_id: tx.id })
    }
    setVincularModal(null)
  }

  // ── Handlers – Nova Categoria ────────────────────────────────
  const abrirNovaCat = (itemId: string | null = null) => setNovaCatCtx({ itemId })

  const aoCategoriaCriada = async (novaCat: Categoria) => {
    // Aplica a nova categoria ao(s) item(ns) alvo
    if (novaCatCtx?.itemId) {
      const it = itens.find(i => i.id === novaCatCtx.itemId)
      if (it) await classificar(it, novaCat.id)
    } else {
      // Modo bulk: aplica em todos os selecionados
      await classificarSelecionados(novaCat.id)
    }
    setNovaCatCtx(null)
    toast(`Categoria "${novaCat.descricao}" criada e aplicada!`)
  }

  // ── Handler – Confirmar ──────────────────────────────────────
  const handleConfirmar = async () => {
    if (!modoImportacao) { toast('Escolha o modo de importação.'); return }
    setConfirmando(true)

    let r
    if (modoImportacao === 'CATEGORIA') {
      r = await confirmar({
        modo:   'CATEGORIA',
        grupos: grupos.map(g => ({
          chave:                  g.id,
          categoria_id:           g.categoria_id,
          item_ids:               g.item_ids,
          decisao:                g.decisao,
          descricao:              g.descricao,
          transacao_existente_id: g.transacao_existente_id,
        })),
      })
    } else {
      const decisoes:   Record<string, 'CRIAR' | 'ATUALIZAR'> = {}
      const descricoes: Record<string, string>                = {}
      for (const l of lancamentosPreview) {
        decisoes[l.chave] = decisoesOverride.get(l.chave) ?? l.decisaoSugerida
        const descOv = descricoesOverride.get(l.chave)
        if (descOv && descOv !== l.descricao) descricoes[l.chave] = descOv
      }
      r = await confirmar({ modo: 'REGISTRO', decisoes, descricoes })
    }

    setConfirmando(false)
    if (r.ok) {
      const c_ = r.dados?.criadas     ?? 0
      const u  = r.dados?.atualizadas ?? 0
      toast(`Importação confirmada. ${c_} criado${c_ !== 1 ? 's' : ''}, ${u} atualizado${u !== 1 ? 's' : ''}.`)
      setTimeout(() => navigate('/importar-fatura'), 1200)
    } else {
      toast(r.erro ?? 'Falha ao confirmar.')
    }
  }

  // ── Select de categoria reutilizável ─────────────────────────
  const optsCat = (
    <>
      <option value="" style={{ background: '#0d1117' }}>— escolher categoria —</option>
      {catsPai.map(p => {
        const filhos = catsSub.filter(s => s.id_pai === p.id)
        if (filhos.length > 0) return (
          <optgroup key={p.id} label={p.descricao}>
            {filhos.map(f => (
              <option key={f.id} value={f.id} style={{ background: '#0d1117' }}>{f.descricao}</option>
            ))}
          </optgroup>
        )
        return <option key={p.id} value={p.id} style={{ background: '#0d1117' }}>{p.descricao}</option>
      })}
      <option value="__NOVA_CAT__" style={{ background: '#0d1117', color: '#4da6ff' }}>
        ✚ Nova categoria…
      </option>
    </>
  )

  // ── Filtro de texto do modal vincular ─────────────────────────
  const txsFiltradas = filtroTxBusca.trim()
    ? txCandidatas.filter(tx =>
        tx.descricao.toLowerCase().includes(filtroTxBusca.toLowerCase()) ||
        formatBRL(Number(tx.valor)).includes(filtroTxBusca),
      )
    : txCandidatas

  // ── Early returns ─────────────────────────────────────────────
  if (loading) return <div className="py-8"><LoadingMascote texto="Carregando sessão…" size={130} /></div>
  if (error || !sessao) return (
    <div className="p-5">
      <p className="text-[15px]" style={{ color: '#f87171' }}>{error ?? 'Sessão não encontrada.'}</p>
      <Link to="/importar-fatura" className="text-[15px] underline mt-2 inline-block"
        style={{ color: '#4da6ff' }}>← Voltar</Link>
    </div>
  )

  return (
    <div className="p-5">
      <Toast msg={feedback} />

      <div className="flex items-center gap-2 mb-1">
        <Link to="/importar-fatura" className="flex items-center gap-1 text-[14px]"
          style={{ color: '#8b92a8' }}>
          <ArrowLeft size={14} /> Importações
        </Link>
      </div>
      <h1 className="text-[21px] font-bold flex items-center gap-2 mb-1" style={{ color: '#e8eaf0' }}>
        <Receipt size={22} /> Revisão — {sessao.conta?.nome ?? 'Cartão'}
      </h1>
      <p className="text-[14px] mb-2" style={{ color: '#8b92a8' }}>
        {sessao.arquivo_nome}
        {' '}· <span style={{ color: STATUS_COR[sessao.status] }}>{STATUS_LABEL[sessao.status]}</span>
        {sessao.vencimento_fatura && (
          <> · Vencimento:{' '}
            <span style={{ color: '#e8eaf0' }}>
              {new Date(sessao.vencimento_fatura + 'T00:00').toLocaleDateString('pt-BR')}
            </span>
          </>
        )}
        {' '}· Total: <span style={{ color: '#e8eaf0' }}>{formatBRL(totalFatura)}</span>
      </p>

      {sessao.observacao && (
        <div className="text-[13px] mb-4 px-3 py-2 rounded-lg border"
          style={{ background: 'rgba(240,180,41,0.08)', borderColor: 'rgba(240,180,41,0.25)', color: '#f0b429' }}>
          <AlertCircle size={13} className="inline mr-1 -mt-0.5" />
          {sessao.observacao}
        </div>
      )}

      {/* ══ Fase 1: A classificar ════════════════════════════════ */}
      {fase === 'classificar' && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <h2 className="text-[16px] font-semibold" style={{ color: '#e8eaf0' }}>A classificar</h2>
            <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(240,180,41,0.15)', color: '#f0b429' }}>
              {naoClassif.length}
            </span>
            <input
              type="text"
              value={filtroDesc}
              onChange={e => setFiltroDesc(e.target.value)}
              placeholder="Filtrar por descrição…"
              className="flex-1 min-w-[180px] rounded-lg px-3 py-1.5 text-[13px] border border-white/10 outline-none focus:border-av-green/50 transition-colors"
              style={{ background: '#0d1117', color: '#e8eaf0' }}
            />
            {filtroDesc && (
              <button onClick={() => setFiltroDesc('')}
                className="text-[12px] px-2 py-1 rounded-md hover:bg-white/5 transition-colors"
                style={{ color: '#8b92a8' }}>
                Limpar filtro
              </button>
            )}
            {/* Botão aplicar todas as sugestões */}
            {itensSugeridos.length > 0 && emAnalise && (
              <button
                onClick={handleAplicarSugestoes}
                disabled={aplicandoSugest}
                className="flex items-center gap-1 text-[13px] px-3 py-1.5 rounded-lg border border-av-green/40 hover:bg-av-green/10 transition-colors disabled:opacity-50"
                style={{ color: '#00c896' }}>
                {aplicandoSugest
                  ? 'Aplicando…'
                  : `✓ Aplicar ${itensSugeridos.length} sugestão${itensSugeridos.length !== 1 ? 'ões' : ''}`}
              </button>
            )}
          </div>

          {algumSelec && (
            <div className="flex flex-wrap items-center gap-2 mb-2 px-3 py-2 rounded-lg border border-av-green/30"
              style={{ background: 'rgba(0,200,150,0.06)' }}>
              <span className="text-[13px] font-semibold flex-none" style={{ color: '#00c896' }}>
                {selAtivos.length} selecionado{selAtivos.length !== 1 ? 's' : ''}
              </span>
              <select
                value=""
                disabled={!emAnalise || emLote}
                onChange={e => {
                  if (e.target.value === '__NOVA_CAT__') { abrirNovaCat(null); return }
                  if (e.target.value) classificarSelecionados(e.target.value)
                }}
                className="flex-1 min-w-[160px] rounded-md px-2 py-1 text-[13px] border border-white/10 disabled:opacity-50"
                style={{ background: '#0d1117', color: '#8b92a8' }}>
                <option value="" style={{ background: '#0d1117' }}>
                  {emLote ? 'Classificando…' : '— classificar como… —'}
                </option>
                {catsPai.map(p => {
                  const filhos = catsSub.filter(s => s.id_pai === p.id)
                  if (filhos.length > 0) return (
                    <optgroup key={p.id} label={p.descricao}>
                      {filhos.map(f => (
                        <option key={f.id} value={f.id} style={{ background: '#0d1117' }}>{f.descricao}</option>
                      ))}
                    </optgroup>
                  )
                  return <option key={p.id} value={p.id} style={{ background: '#0d1117' }}>{p.descricao}</option>
                })}
                <option value="__NOVA_CAT__" style={{ background: '#0d1117', color: '#4da6ff' }}>
                  ✚ Nova categoria…
                </option>
              </select>
              <button
                onClick={ignorarSelecionados}
                disabled={!emAnalise || emLote}
                className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-white/10 hover:bg-red-400/10 hover:border-red-400/30 transition-colors disabled:opacity-40 flex-none"
                style={{ color: '#8b92a8' }}>
                <XCircle size={13} /> Ignorar selecionados
              </button>
              <button
                onClick={() => setSelecionados(new Set())}
                className="text-[12px] px-2 py-1 rounded-md hover:bg-white/5 transition-colors flex-none"
                style={{ color: '#8b92a8' }}>
                Limpar seleção
              </button>
            </div>
          )}

          <div className="rounded-xl border border-white/10 overflow-x-auto">
            <table className="w-full text-[14px]" style={{ color: '#e8eaf0' }}>
              <thead style={{ background: '#252d42' }}>
                <tr>
                  <th className="px-3 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={todosSelec}
                      ref={el => { if (el) el.indeterminate = algumSelec && !todosSelec }}
                      onChange={toggleTodos}
                      disabled={!emAnalise || naoClassifFiltrados.length === 0}
                      className="w-3.5 h-3.5 accent-av-green cursor-pointer disabled:opacity-40"
                      title="Selecionar todos"
                    />
                  </th>
                  <th className="text-left px-3 py-2 w-24">Data</th>
                  <th className="text-left px-3 py-2">
                    <button
                      onClick={() => setOrdemFase1(o =>
                        o === 'original' ? 'titulo_az' : o === 'titulo_az' ? 'titulo_za' : 'original'
                      )}
                      title={ordemFase1 === 'titulo_az' ? 'A→Z (clique para Z→A)' : ordemFase1 === 'titulo_za' ? 'Z→A (clique para remover ordenação)' : 'Clique para ordenar A→Z'}
                      className="flex items-center gap-1 select-none hover:opacity-80 transition-opacity"
                      style={{ color: ordemFase1 !== 'original' ? '#00c896' : 'inherit' }}>
                      Descrição
                      <span className="text-[11px] font-bold">
                        {ordemFase1 === 'titulo_az' ? '↑' : ordemFase1 === 'titulo_za' ? '↓' : '↕'}
                      </span>
                    </button>
                  </th>
                  <th className="text-right px-3 py-2 w-28">Valor</th>
                  <th className="text-left px-3 py-2 w-48">Categoria</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {naoClassifFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-4 text-[13px] italic" style={{ color: '#8b92a8' }}>
                      Nenhum item encontrado para "{filtroDesc}".
                    </td>
                  </tr>
                )}
                {naoClassifOrdenados.map(it => (
                  <tr key={it.id}
                    className={`border-t border-white/5 transition-colors${selecionados.has(it.id) ? ' bg-av-green/5' : ''}`}>
                    <td className="px-3 py-2">
                      <input type="checkbox" checked={selecionados.has(it.id)}
                        onChange={() => toggleItem(it.id)} disabled={!emAnalise}
                        className="w-3.5 h-3.5 accent-av-green cursor-pointer disabled:opacity-40" />
                    </td>
                    <td className="px-3 py-2 text-[13px]" style={{ color: '#8b92a8' }}>
                      {new Date(it.data_compra + 'T00:00').toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-3 py-2">
                      {/* Exibe descrição SEM o sufixo de parcela — info de parcela fica abaixo */}
                      <p className="leading-snug">{stripParcela(it.descricao)}</p>
                      {it.estabelecimento && stripParcela(it.estabelecimento) !== stripParcela(it.descricao) && (
                        <p className="text-[12px]" style={{ color: '#8b92a8' }}>{it.estabelecimento}</p>
                      )}
                      {it.parcela_atual && it.parcela_total && (
                        <p className="text-[11px]" style={{ color: '#8b92a8' }}>
                          Parcela {it.parcela_atual}/{it.parcela_total}
                        </p>
                      )}
                      {it.categoria_sugerida_id && catPorId.has(it.categoria_sugerida_id) && (
                        <button
                          onClick={() => aplicarSugestao(it)} disabled={!emAnalise}
                          title="Aplicar sugestão de categoria"
                          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border transition-colors hover:bg-yellow-400/10 disabled:opacity-40 mt-1"
                          style={{ borderColor: 'rgba(240,180,41,0.4)', color: '#f0b429' }}>
                          💡 {catPorId.get(it.categoria_sugerida_id)!.descricao}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium"
                      style={{ color: it.tipo === 'RECEITA' ? '#4ade80' : '#e8eaf0' }}>
                      {it.tipo === 'RECEITA' ? `−${formatBRL(Number(it.valor))}` : formatBRL(Number(it.valor))}
                    </td>
                    <td className="px-3 py-2">
                      <select value="" disabled={!emAnalise}
                        onChange={e => {
                          if (e.target.value === '__NOVA_CAT__') { abrirNovaCat(it.id); return }
                          classificar(it, e.target.value || null)
                        }}
                        className="w-full rounded-md px-2 py-1 text-[13px] border border-white/10 disabled:opacity-50"
                        style={{ background: '#0d1117', color: '#8b92a8' }}>
                        {optsCat}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <button onClick={() => ignorar(it.id)} disabled={!emAnalise}
                        title="Ignorar este item"
                        className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-white/10 hover:bg-red-400/10 hover:border-red-400/30 transition-colors disabled:opacity-40"
                        style={{ color: '#8b92a8' }}>
                        <XCircle size={13} /> Ignorar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Fase 2: Escolha do modo ════════════════════════════ */}
      {fase === 'modo' && emAnalise && (
        <div className="mb-6">
          <h2 className="text-[17px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>
            Como deseja importar os lançamentos?
          </h2>
          <p className="text-[14px] mb-4" style={{ color: '#8b92a8' }}>
            O sistema verifica se já existe um lançamento similar no mês do cartão e
            sugere automaticamente criar ou atualizar.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => setModoImportacao('REGISTRO')}
              className="text-left p-4 rounded-xl border border-white/10 hover:border-av-green/50 hover:bg-av-green/5 transition-all group"
              style={{ background: '#1a1f2e' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[22px]">🧾</span>
                <span className="text-[16px] font-semibold" style={{ color: '#e8eaf0' }}>
                  Um lançamento por registro
                </span>
              </div>
              <p className="text-[13px] leading-relaxed" style={{ color: '#8b92a8' }}>
                Cada item da fatura vira um lançamento separado. Parcelas são datadas
                no 1º dia do mês de vencimento.
              </p>
              <p className="mt-3 text-[13px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: '#00c896' }}>
                Selecionar →
              </p>
            </button>

            <button
              onClick={() => setModoImportacao('CATEGORIA')}
              className="text-left p-4 rounded-xl border border-white/10 hover:border-av-green/50 hover:bg-av-green/5 transition-all group"
              style={{ background: '#1a1f2e' }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[22px]">📊</span>
                <span className="text-[16px] font-semibold" style={{ color: '#e8eaf0' }}>
                  Agrupar por categoria
                </span>
              </div>
              <p className="text-[13px] leading-relaxed" style={{ color: '#8b92a8' }}>
                Itens da mesma categoria viram um único lançamento. Parcelas ficam
                em grupos separados. Você pode redistribuir itens entre grupos
                antes de confirmar.
              </p>
              <p className="mt-3 text-[13px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: '#00c896' }}>
                Selecionar →
              </p>
            </button>
          </div>
        </div>
      )}

      {/* ══ Classificados (fases 1 e 2) ════════════════════════ */}
      {fase !== 'preview' && classificados.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-[16px] font-semibold" style={{ color: '#e8eaf0' }}>Classificados</h2>
            <span className="text-[12px] font-semibold px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(0,200,150,0.15)', color: '#00c896' }}>
              {classificados.length}
            </span>
          </div>
          <div className="flex flex-col gap-3">
            {gruposClassOrdenados.map(([catId, grupo]) => {
              const isIgnorados = catId === '__IGNORAR__'
              const cat         = isIgnorados ? null : catPorId.get(catId)
              const nomeCat     = cat?.descricao ?? (isIgnorados ? 'Ignorados' : '—')
              const totalGrupo  = grupo.reduce(
                (s, i) => s + (i.tipo === 'RECEITA' ? -Number(i.valor) : Number(i.valor)), 0,
              )
              const encolhido = gruposEncolhidos.has(catId)
              return (
                <div key={catId} className="rounded-xl border border-white/10 overflow-hidden">
                  <button
                    onClick={() => toggleGrupo(catId)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                    style={{ background: '#252d42' }}>
                    <ChevronDown size={14} className="flex-none transition-transform duration-200"
                      style={{ color: '#8b92a8', transform: encolhido ? 'rotate(-90deg)' : 'rotate(0deg)' }} />
                    <span className="text-[15px]">{isIgnorados ? '🚫' : '📂'}</span>
                    <span className="text-[15px] font-semibold" style={{ color: '#e8eaf0' }}>{nomeCat}</span>
                    <span className="text-[12px]" style={{ color: '#8b92a8' }}>
                      {grupo.length} {grupo.length === 1 ? 'item' : 'itens'}
                    </span>
                    {!isIgnorados && (
                      <span className="ml-auto text-[14px] font-semibold" style={{ color: '#e8eaf0' }}>
                        {formatBRL(totalGrupo)}
                      </span>
                    )}
                  </button>
                  {!encolhido && grupo.map((it, idx) => (
                    <div key={it.id}
                      className={`flex items-center gap-2 px-3 py-2 text-[13px] flex-wrap${idx > 0 ? ' border-t border-white/5' : ' border-t border-white/5'}`}
                      style={{ color: '#e8eaf0' }}>
                      <span className="w-20 flex-none text-[12px]" style={{ color: '#8b92a8' }}>
                        {new Date(it.data_compra + 'T00:00').toLocaleDateString('pt-BR')}
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="truncate block">{stripParcela(it.descricao)}</span>
                        {it.parcela_atual && it.parcela_total && (
                          <span className="text-[11px]" style={{ color: '#8b92a8' }}>
                            Parcela {it.parcela_atual}/{it.parcela_total}
                          </span>
                        )}
                      </span>
                      <span className="font-medium font-mono flex-none"
                        style={{ color: it.tipo === 'RECEITA' ? '#4ade80' : '#e8eaf0' }}>
                        {it.tipo === 'RECEITA' ? `−${formatBRL(Number(it.valor))}` : formatBRL(Number(it.valor))}
                      </span>
                      {emAnalise && (
                        <button onClick={() => voltar(it.id)}
                          title={isIgnorados ? 'Reclassificar' : 'Voltar para classificar'}
                          className="p-1 rounded-md hover:bg-white/5 transition-colors flex-none"
                          style={{ color: '#8b92a8' }}>
                          <RotateCcw size={13} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ══ Fase 3: Preview — REGISTRO ══════════════════════════ */}
      {fase === 'preview' && modoImportacao === 'REGISTRO' && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {emAnalise && (
              <button
                onClick={() => setModoImportacao(null)}
                className="flex items-center gap-1 text-[13px] px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: '#8b92a8' }}>
                <ArrowLeft size={13} /> Mudar modo
              </button>
            )}
            <h2 className="text-[16px] font-semibold" style={{ color: '#e8eaf0' }}>
              Lançamentos a importar
            </h2>
            <span className="text-[12px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(77,166,255,0.15)', color: '#4da6ff' }}>
              Por registro
            </span>
          </div>

          {lancamentosPreview.length === 0 ? (
            <p className="text-[14px] italic" style={{ color: '#8b92a8' }}>
              Nenhum lançamento a importar — todos os itens estão ignorados.
            </p>
          ) : (
            <div className="rounded-xl border border-white/10 overflow-x-auto">
              <table className="w-full text-[14px]" style={{ color: '#e8eaf0' }}>
                <thead style={{ background: '#252d42' }}>
                  <tr>
                    <th className="text-left px-3 py-2 w-24">Data</th>
                    <th className="text-left px-3 py-2">Lançamento</th>
                    <th className="text-right px-3 py-2 w-28">Valor</th>
                    <th className="text-left px-3 py-2 w-56">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentosPreview.map(l => {
                    const dec       = decisoesOverride.get(l.chave) ?? l.decisaoSugerida
                    const descFinal = descricoesOverride.get(l.chave) ?? l.descricao
                    const corCriar  = '#00c896'
                    const corAtual  = '#4da6ff'
                    return (
                      <Fragment key={l.chave}>
                        <tr className="border-t border-white/5">
                          <td className="px-3 py-2 text-[13px]" style={{ color: '#8b92a8' }}>
                            {l.data ? new Date(l.data + 'T00:00').toLocaleDateString('pt-BR') : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {editandoDesc === l.chave ? (
                              <input
                                autoFocus
                                value={descEditTemp}
                                onChange={e => setDescEditTemp(e.target.value)}
                                onBlur={() => confirmarEdicaoDesc(l.chave)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter')  confirmarEdicaoDesc(l.chave)
                                  if (e.key === 'Escape') cancelarEdicaoDesc()
                                }}
                                className="w-full rounded px-2 py-0.5 text-[14px] border border-av-green/50 outline-none"
                                style={{ background: '#131920', color: '#e8eaf0' }}
                              />
                            ) : (
                              <div className="flex items-center gap-1.5 group/desc">
                                <p className="leading-snug flex-1">{descFinal}</p>
                                {emAnalise && (
                                  <button
                                    onClick={() => iniciarEdicaoDesc(l.chave, descFinal)}
                                    className="opacity-0 group-hover/desc:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10 flex-none"
                                    style={{ color: '#8b92a8' }} title="Editar descrição">
                                    <Pencil size={11} />
                                  </button>
                                )}
                              </div>
                            )}
                            <p className="text-[12px] mt-0.5" style={{ color: '#8b92a8' }}>
                              📂 {l.categoria_nome}
                            </p>
                            {l.transacao_existente_id && dec === 'ATUALIZAR' && (
                              <p className="text-[11px] mt-0.5" style={{ color: '#4da6ff' }}>
                                🔗 Atualiza lançamento existente
                              </p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-medium"
                            style={{ color: l.tipo === 'RECEITA' ? '#4ade80' : '#e8eaf0' }}>
                            {l.tipo === 'RECEITA' ? `−${formatBRL(l.valor)}` : formatBRL(l.valor)}
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex flex-col gap-1">
                              {/* CRIAR / ATUALIZAR */}
                              <div className="flex gap-1">
                                {(['CRIAR', 'ATUALIZAR'] as DecisaoImport[]).map(d => {
                                  const ativo = dec === d
                                  const cor   = d === 'CRIAR' ? corCriar : corAtual
                                  const desab = d === 'ATUALIZAR' && !l.transacao_existente_id
                                  return (
                                    <button key={d}
                                      onClick={() => setDecisaoLancamento(l.chave, d)}
                                      disabled={!emAnalise || desab}
                                      title={desab ? 'Nenhum lançamento similar encontrado' : undefined}
                                      className="text-[11px] px-2 py-0.5 rounded-md border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                      style={{
                                        background:  ativo ? `${cor}22` : 'transparent',
                                        color:       ativo ? cor : '#8b92a8',
                                        borderColor: ativo ? cor : 'rgba(255,255,255,0.1)',
                                        fontWeight:  ativo ? 600 : 400,
                                      }}>
                                      {d === 'CRIAR' ? 'Criar novo' : 'Atualizar'}
                                    </button>
                                  )
                                })}
                              </div>
                              {/* Vincular manualmente */}
                              {emAnalise && (
                                <button
                                  onClick={() => abrirVincular({
                                    itemId: l.chave,
                                    desc:   stripParcela(l.descricao),
                                  })}
                                  className="text-[11px] px-2 py-0.5 rounded-md border border-white/10 hover:bg-av-green/10 hover:border-av-green/30 transition-colors text-left"
                                  style={{ color: '#8b92a8' }}>
                                  🔗 Vincular…
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ══ Fase 3: Preview — CATEGORIA (grupos) ════════════════ */}
      {fase === 'preview' && modoImportacao === 'CATEGORIA' && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {emAnalise && (
              <button
                onClick={() => setModoImportacao(null)}
                className="flex items-center gap-1 text-[13px] px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: '#8b92a8' }}>
                <ArrowLeft size={13} /> Mudar modo
              </button>
            )}
            <h2 className="text-[16px] font-semibold" style={{ color: '#e8eaf0' }}>
              Lançamentos a importar
            </h2>
            <span className="text-[12px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(77,166,255,0.15)', color: '#4da6ff' }}>
              Por categoria
            </span>
          </div>

          {grupos.length === 0 ? (
            <p className="text-[14px] italic" style={{ color: '#8b92a8' }}>
              Nenhum lançamento a importar — todos os itens estão ignorados.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {grupos.map(grupo => {
                const itensGrupo  = (sessao?.itens ?? []).filter(i => grupo.item_ids.includes(i.id))
                const totalGrupo  = itensGrupo.reduce(
                  (s, i) => s + (i.tipo === 'RECEITA' ? -Number(i.valor) : Number(i.valor)), 0,
                )
                const catNome     = catPorId.get(grupo.categoria_id)?.descricao ?? ''
                const selAtual    = selGrupo.get(grupo.id) ?? new Set<string>()
                const algumSelAt  = selAtual.size > 0
                const corCriar    = '#00c896'
                const corAtual_   = '#4da6ff'

                return (
                  <div key={grupo.id} className="rounded-xl border border-white/10 overflow-hidden">
                    {/* Cabeçalho do grupo */}
                    <div className="px-3 py-2" style={{ background: '#252d42' }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[14px] font-semibold" style={{ color: '#e8eaf0' }}>
                          📂 {catNome}
                        </span>
                        <span className="text-[12px]" style={{ color: '#8b92a8' }}>
                          {itensGrupo.length} {itensGrupo.length === 1 ? 'item' : 'itens'}
                        </span>
                        <span className="ml-auto text-[14px] font-semibold font-mono" style={{ color: '#e8eaf0' }}>
                          {formatBRL(Math.abs(totalGrupo))}
                        </span>
                      </div>
                      {/* Descrição editável */}
                      <div className="mt-1.5 flex items-center gap-1.5 group/gdesc">
                        {editandoDescGrupo === grupo.id ? (
                          <input
                            autoFocus
                            value={descEditTempGrupo}
                            onChange={e => setDescEditTempGrupo(e.target.value)}
                            onBlur={() => confirmarEdicaoDescGrupo(grupo.id)}
                            onKeyDown={e => {
                              if (e.key === 'Enter')  confirmarEdicaoDescGrupo(grupo.id)
                              if (e.key === 'Escape') cancelarEdicaoDescGrupo()
                            }}
                            className="flex-1 rounded px-2 py-0.5 text-[13px] border border-av-green/50 outline-none"
                            style={{ background: '#131920', color: '#e8eaf0' }}
                          />
                        ) : (
                          <>
                            <p className="text-[13px] flex-1" style={{ color: '#8b92a8' }}>
                              {grupo.descricao}
                            </p>
                            {emAnalise && (
                              <button
                                onClick={() => iniciarEdicaoDescGrupo(grupo.id, grupo.descricao)}
                                className="opacity-0 group-hover/gdesc:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10"
                                style={{ color: '#8b92a8' }} title="Editar descrição">
                                <Pencil size={11} />
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      {/* Botões de decisão */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        {(['CRIAR', 'ATUALIZAR'] as DecisaoImport[]).map(d => {
                          const ativo = grupo.decisao === d
                          const cor   = d === 'CRIAR' ? corCriar : corAtual_
                          const desab = d === 'ATUALIZAR' && !grupo.transacao_existente_id
                          return (
                            <button key={d}
                              onClick={() => setDecisaoGrupo(grupo.id, d)}
                              disabled={!emAnalise || desab}
                              title={desab ? 'Nenhum lançamento vinculado — use 🔗 Vincular para associar' : undefined}
                              className="text-[11px] px-2 py-0.5 rounded-md border transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                              style={{
                                background:  ativo ? `${cor}22` : 'transparent',
                                color:       ativo ? cor : '#8b92a8',
                                borderColor: ativo ? cor : 'rgba(255,255,255,0.1)',
                                fontWeight:  ativo ? 600 : 400,
                              }}>
                              {d === 'CRIAR' ? 'Criar novo' : 'Atualizar'}
                            </button>
                          )
                        })}
                        {emAnalise && (
                          <button
                            onClick={() => abrirVincular({
                              grupoId: grupo.id,
                              desc:    grupo.descricao,
                            })}
                            className="text-[11px] px-2 py-0.5 rounded-md border border-white/10 hover:bg-av-green/10 hover:border-av-green/30 transition-colors"
                            style={{ color: '#8b92a8' }}>
                            🔗 Vincular…
                          </button>
                        )}
                        {grupo.transacao_existente_id && grupo.decisao === 'ATUALIZAR' && (
                          <span className="text-[11px]" style={{ color: '#4da6ff' }}>
                            🔗 vinculado
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Itens do grupo com checkboxes (só mostra caixas se >1 item) */}
                    {itensGrupo.map((it, idx) => (
                      <div key={it.id}
                        className={`flex items-center gap-2 px-3 py-1.5 text-[13px]${idx > 0 ? ' border-t border-white/5' : ' border-t border-white/5'}`}
                        style={{ color: '#e8eaf0', background: selAtual.has(it.id) ? 'rgba(0,200,150,0.04)' : undefined }}>
                        {itensGrupo.length > 1 && (
                          <input type="checkbox"
                            checked={selAtual.has(it.id)}
                            onChange={() => toggleSelGrupo(grupo.id, it.id)}
                            disabled={!emAnalise}
                            className="w-3.5 h-3.5 accent-av-green cursor-pointer disabled:opacity-40 flex-none"
                          />
                        )}
                        <span className="w-20 flex-none text-[12px]" style={{ color: '#8b92a8' }}>
                          {new Date(it.data_compra + 'T00:00').toLocaleDateString('pt-BR')}
                        </span>
                        <span className="flex-1 min-w-0 truncate">
                          {stripParcela(it.descricao)}
                        </span>
                        {it.parcela_atual && it.parcela_total && (
                          <span className="text-[11px] flex-none" style={{ color: '#8b92a8' }}>
                            {it.parcela_atual}/{it.parcela_total}
                          </span>
                        )}
                        <span className="font-mono flex-none text-[13px]"
                          style={{ color: it.tipo === 'RECEITA' ? '#4ade80' : '#c8d0e0' }}>
                          {it.tipo === 'RECEITA'
                            ? `−${formatBRL(Number(it.valor))}`
                            : formatBRL(Number(it.valor))}
                        </span>
                      </div>
                    ))}

                    {/* Ação de separar itens selecionados */}
                    {algumSelAt && emAnalise && (
                      <div className="px-3 py-2 border-t border-white/5"
                        style={{ background: 'rgba(0,200,150,0.04)' }}>
                        <button
                          onClick={() => separarItensGrupo(grupo.id, [...selAtual])}
                          className="text-[13px] px-3 py-1.5 rounded-md border border-av-green/40 hover:bg-av-green/10 transition-colors"
                          style={{ color: '#00c896' }}>
                          ↗ Separar {selAtual.size} {selAtual.size === 1 ? 'item' : 'itens'} em lançamento próprio
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {itens.length === 0 && (
        <p className="text-[15px] italic mb-4" style={{ color: '#8b92a8' }}>
          Nenhum item encontrado nesta sessão.
        </p>
      )}

      {/* ══ Rodapé ══════════════════════════════════════════════ */}
      {emAnalise ? (
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {naoClassif.length > 0 && (
            <p className="text-[13px] mr-auto" style={{ color: '#f0b429' }}>
              ⚠ {naoClassif.length} {naoClassif.length === 1 ? 'item' : 'itens'} ainda sem classificação.
            </p>
          )}
          <button
            onClick={() => navigate('/importar-fatura')}
            className="px-3 py-2 rounded-lg border border-white/10 text-[15px] hover:border-white/30 transition-colors"
            style={{ color: '#e8eaf0' }}>
            Voltar
          </button>
          {fase === 'preview' && (
            <button
              onClick={handleConfirmar}
              disabled={!podeConfirmar || confirmando}
              className="px-4 py-2 rounded-lg bg-av-green text-[15px] font-semibold hover:bg-av-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ color: '#0a0f1a' }}>
              {confirmando ? 'Confirmando…' : 'Confirmar importação'}
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between">
          <p className="text-[14px] italic" style={{ color: '#8b92a8' }}>
            Sessão {sessao.status === 'CONFIRMADA' ? 'confirmada' : 'cancelada'} — somente leitura.
          </p>
          <button
            onClick={() => navigate('/importar-fatura')}
            className="px-3 py-2 rounded-lg border border-white/10 text-[15px] hover:border-white/30 transition-colors"
            style={{ color: '#e8eaf0' }}>
            Voltar
          </button>
        </div>
      )}

      {/* ══ Modal: nova categoria ════════════════════════════════ */}
      {novaCatCtx && (
        <ModalNovaCategoriaRapida
          categoriasPai={catsPai}
          onCriada={aoCategoriaCriada}
          onFechar={() => setNovaCatCtx(null)}
        />
      )}

      {/* ══ Modal: vincular transação existente ══════════════════ */}
      {vincularModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-xl border border-white/10 shadow-2xl"
            style={{ background: '#1a1f2e' }}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <h3 className="text-[16px] font-semibold" style={{ color: '#e8eaf0' }}>
                Vincular a lançamento existente
              </h3>
              <button onClick={() => setVincularModal(null)}
                className="p-1 rounded hover:bg-white/10 transition-colors"
                style={{ color: '#8b92a8' }}>
                <XCircle size={18} />
              </button>
            </div>

            <div className="px-4 py-3">
              <input
                type="text"
                value={filtroTxBusca}
                onChange={e => setFiltroTxBusca(e.target.value)}
                placeholder="Filtrar por descrição ou valor…"
                className="w-full rounded-lg px-3 py-2 text-[14px] border border-white/10 outline-none focus:border-av-green/50 transition-colors"
                style={{ background: '#0d1117', color: '#e8eaf0' }}
              />
            </div>

            <div className="px-4 pb-2 max-h-80 overflow-y-auto">
              {buscandoTxs ? (
                <p className="py-6 text-center text-[14px]" style={{ color: '#8b92a8' }}>Buscando…</p>
              ) : txsFiltradas.length === 0 ? (
                <p className="py-6 text-center text-[14px] italic" style={{ color: '#8b92a8' }}>
                  {txCandidatas.length === 0
                    ? 'Nenhuma transação PENDENTE/PROJEÇÃO encontrada para este cartão.'
                    : 'Nenhuma transação corresponde ao filtro.'}
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {txsFiltradas.map(tx => (
                    <button
                      key={tx.id}
                      onClick={() => confirmarVincular(tx)}
                      className="text-left w-full px-3 py-2 rounded-lg border border-transparent hover:border-av-green/30 hover:bg-av-green/5 transition-colors">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[14px] leading-snug truncate" style={{ color: '#e8eaf0' }}>
                          {tx.descricao}
                        </span>
                        <span className="text-[14px] font-mono flex-none" style={{ color: '#e8eaf0' }}>
                          {formatBRL(Number(tx.valor))}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[12px] mt-0.5" style={{ color: '#8b92a8' }}>
                        <span>{new Date(tx.data + 'T00:00').toLocaleDateString('pt-BR')}</span>
                        <span>·</span>
                        <span>{tx.status}</span>
                        {tx.categoria && <><span>·</span><span>{tx.categoria.descricao}</span></>}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end px-4 py-3 border-t border-white/10">
              <button
                onClick={() => setVincularModal(null)}
                className="px-3 py-1.5 text-[14px] rounded-lg border border-white/10 hover:border-white/30 transition-colors"
                style={{ color: '#8b92a8' }}>
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
