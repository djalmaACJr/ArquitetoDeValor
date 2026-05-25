// src/pages/ImportarFaturaPage.tsx
//
// Submenu "Importação de Fatura de Cartão" — F1.
//
// Esta entrega faz o ciclo end-to-end com o parser de PDF stubado:
//   • Upload: usuário escolhe uma conta tipo CARTAO e envia o PDF.
//   • Sessão é criada em arqvalor.fatura_import_sessao com status EM_ANALISE
//     e 1 item placeholder.
//   • Listagem de sessões anteriores (com badge de status).
//   • Sandbox: rota /importar-fatura/:id mostra os itens da sessão e permite
//     escolher decisão (CRIAR | ATUALIZAR | IGNORAR) por item.
//
// O parser real de PDF entra em F2 — o edge function `faturas` (POST) hoje
// só valida o PDF e descarta os bytes.

import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { FileUp, Receipt, Trash2, ArrowLeft, AlertCircle, XCircle, RotateCcw, ChevronDown } from 'lucide-react'
import { useContas } from '../hooks/useContas'
import { useCategorias } from '../hooks/useCategorias'
import { useFaturasImport, useFaturaImportSessao } from '../hooks/useFaturasImport'
import { formatBRL } from '../lib/utils'
import { Field, SelectDark, Toast, ModalExcluir } from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import type {
  FaturaImportSessao, FaturaImportItem, StatusFaturaImport,
} from '../types'

// ───────────────────────────────────────────────────────────────────
// Mapas de cor/ícone por status — ficam aqui (não em shared)
// porque são específicos deste fluxo.
// ───────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<StatusFaturaImport, string> = {
  EM_ANALISE: 'Em análise',
  CONFIRMADA: 'Confirmada',
  CANCELADA:  'Cancelada',
}
const STATUS_COR: Record<StatusFaturaImport, string> = {
  EM_ANALISE: '#f0b429',  // âmbar
  CONFIRMADA: '#00c896',  // verde
  CANCELADA:  '#8b92a8',  // cinza
}

// ───────────────────────────────────────────────────────────────────
// Tipos internos do fluxo de importação (fases 2 e 3)
// ───────────────────────────────────────────────────────────────────
type DecisaoImport = 'CRIAR' | 'ATUALIZAR'

interface LancamentoPreview {
  chave:                  string                // id do item (REGISTRO) ou catId (CATEGORIA)
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


// ───────────────────────────────────────────────────────────────────
// Tela principal: roteia entre listagem (sem :id) e sandbox (com :id)
// ───────────────────────────────────────────────────────────────────
export default function ImportarFaturaPage() {
  const { id } = useParams()
  if (id) return <Sandbox id={id} />
  return <ListagemEUpload />
}


// ───────────────────────────────────────────────────────────────────
// Listagem + Upload (rota /importar-fatura)
// ───────────────────────────────────────────────────────────────────
function ListagemEUpload() {
  const navigate = useNavigate()
  const { contas, loading: loadingContas } = useContas()
  const { sessoes, loading: loadingSessoes, importar, excluir } = useFaturasImport()

  const cartoes = contas.filter(c => c.tipo === 'CARTAO' && c.ativa)

  const [contaId,  setContaId]  = useState<string>('')
  const [arquivo,  setArquivo]  = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [erro,     setErro]     = useState<string | null>(null)
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

      {/* ── Bloco de upload ─────────────────────────────────────────── */}
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
                Você ainda não tem contas do tipo Cartão.
                {' '}
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
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed cursor-pointer
                hover:bg-white/5 transition-colors"
              style={{ borderColor: '#8b92a8', color: '#e8eaf0' }}
            >
              <FileUp size={16} style={{ color: '#4da6ff' }} />
              <span className="text-[15px]">
                {arquivo ? arquivo.name : 'Escolher PDF…'}
              </span>
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
            className="w-full md:w-auto md:self-end px-4 py-2 rounded-lg bg-av-green text-[16px] font-semibold
              hover:bg-av-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ color: '#0a0f1a' }}
          >
            {enviando ? 'Enviando…' : 'Enviar fatura'}
          </button>
        </div>
      </div>

      {/* ── Histórico de sessões ────────────────────────────────────── */}
      <h2 className="text-[17px] font-semibold mb-2" style={{ color: '#e8eaf0' }}>
        Importações anteriores
      </h2>

      {loadingSessoes && (
        <div className="py-8"><LoadingMascote texto="Carregando sessões…" size={120}/></div>
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
                  style={{
                    background: `${STATUS_COR[s.status]}22`,
                    color: STATUS_COR[s.status],
                  }}>
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
                  className="flex-1 text-[14px] px-2.5 py-1.5 rounded-md border border-white/10
                    hover:border-av-green hover:text-av-green transition-colors"
                  style={{ color: '#e8eaf0' }}>
                  {s.status === 'EM_ANALISE' ? 'Revisar' : 'Ver detalhes'}
                </button>
                <button
                  onClick={() => setSessaoExcluir(s)}
                  title="Excluir sessão"
                  className="w-8 h-8 rounded-md border border-white/10 flex items-center justify-center
                    hover:bg-red-400/10 hover:border-red-400/30 transition-colors"
                  style={{ color: '#f87171' }}>
                  <Trash2 size={14}/>
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


// ───────────────────────────────────────────────────────────────────
// Sandbox de uma sessão (rota /importar-fatura/:id)
//
// Fluxo em 3 fases:
//   1. "A classificar" — atribuir categoria a cada item (ou ignorar).
//      Multi-seleção, filtro por descrição e bulk-action disponíveis.
//   2. Escolha do modo de importação (após todos classificados):
//      • "Um lançamento por registro" — um lançamento por item;
//        parcelas recebem data = 1º do mês de vencimento.
//      • "Agrupar por categoria" — soma itens da mesma categoria em
//        um único lançamento datado no dia de pagamento do cartão.
//   3. Preview dos lançamentos resultantes com CRIAR / ATUALIZAR
//      sugerido pelo sugerir() + possibilidade de troca manual.
//      Botão "Confirmar importação" fecha o ciclo.
// ───────────────────────────────────────────────────────────────────
function Sandbox({ id }: { id: string }) {
  const navigate = useNavigate()
  const { sessao, loading, error, editarItem, sugerir, confirmar } = useFaturaImportSessao(id)
  const { categorias } = useCategorias()
  const { contas } = useContas()

  const [confirmando,      setConfirmando]      = useState(false)
  const [feedback,         setFeedback]         = useState<string | null>(null)
  const [filtroDesc,       setFiltroDesc]       = useState('')
  const [selecionados,     setSelecionados]     = useState<Set<string>>(new Set())
  const [emLote,           setEmLote]           = useState(false)
  const [modoImportacao,   setModoImportacao]   = useState<null | 'REGISTRO' | 'CATEGORIA'>(null)
  const [decisoesOverride, setDecisaoOverride]  = useState<Map<string, DecisaoImport>>(new Map())
  const [gruposEncolhidos, setGruposEncolhidos] = useState<Set<string>>(new Set())
  const sugeridoRef = useRef(false)

  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3000) }

  // Dispara sugestão automática uma vez ao carregar
  useEffect(() => {
    if (sugeridoRef.current || !sessao || sessao.status !== 'EM_ANALISE') return
    sugeridoRef.current = true
    sugerir()
  }, [sessao?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Limpa overrides de decisão ao trocar de modo
  useEffect(() => { setDecisaoOverride(new Map()) }, [modoImportacao])

  // ── Dados derivados ──────────────────────────────────────────
  const catPorId = useMemo(() => new Map(categorias.map(c => [c.id, c])), [categorias])
  const catsPai  = useMemo(() => categorias.filter(c => !c.id_pai && !c.protegida && c.ativa), [categorias])
  const catsSub  = useMemo(() => categorias.filter(c => !!c.id_pai && c.ativa), [categorias])

  const itens         = sessao?.itens ?? []
  const naoClassif    = itens.filter(i => !i.categoria_escolhida_id && i.decisao !== 'IGNORAR')
  const classificados = itens.filter(i =>  i.categoria_escolhida_id || i.decisao === 'IGNORAR')

  const nd = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const naoClassifFiltrados = filtroDesc.trim()
    ? naoClassif.filter(i => nd(i.descricao).includes(nd(filtroDesc.trim())))
    : naoClassif
  const selAtivos  = naoClassifFiltrados.filter(i => selecionados.has(i.id))
  const todosSelec = naoClassifFiltrados.length > 0 && selAtivos.length === naoClassifFiltrados.length
  const algumSelec = selAtivos.length > 0

  const gruposOrdenados = (() => {
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

  // Lançamentos do preview (fase 3) — recomputa ao trocar modo
  const lancamentosPreview = useMemo((): LancamentoPreview[] => {
    if (!modoImportacao || !sessao) return []
    const itensAll       = sessao.itens ?? []
    const classAll       = itensAll.filter(i => i.categoria_escolhida_id || i.decisao === 'IGNORAR')
    const naoIgnoradosL  = classAll.filter(i => i.decisao !== 'IGNORAR' && i.categoria_escolhida_id)

    if (modoImportacao === 'REGISTRO') {
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
    }

    // CATEGORIA — agrupa por categoria, data = dia_pagamento do cartão no mês de vencimento
    const conta     = contas.find(c => c.conta_id === sessao.conta_id)
    const diaPagto  = conta?.dia_pagamento ?? 5
    const [anoV, mesV] = (sessao.vencimento_fatura ?? '').split('-')
    const dataLancto = (anoV && mesV)
      ? `${anoV}-${mesV}-${String(diaPagto).padStart(2, '0')}`
      : ''

    const grupos = new Map<string, FaturaImportItem[]>()
    for (const it of naoIgnoradosL) {
      const key = it.categoria_escolhida_id!
      if (!grupos.has(key)) grupos.set(key, [])
      grupos.get(key)!.push(it)
    }

    return [...grupos.entries()].map(([catId, items]) => {
      const catNome    = catPorId.get(catId)?.descricao ?? ''
      const valorBruto = items.reduce(
        (s, i) => s + (i.tipo === 'RECEITA' ? -Number(i.valor) : Number(i.valor)), 0,
      )
      const tipo  = valorBruto >= 0 ? 'DESPESA' as const : 'RECEITA' as const
      const valor = Math.abs(valorBruto)
      const txExistente = items.find(i => i.transacao_existente_id)?.transacao_existente_id ?? null
      return {
        chave:                  catId,
        descricao:              `${conta?.nome ?? 'Fatura'} - ${catNome}`,
        valor,
        data:                   dataLancto,
        categoria_id:           catId,
        categoria_nome:         catNome,
        tipo,
        decisaoSugerida:        (txExistente ? 'ATUALIZAR' : 'CRIAR') as DecisaoImport,
        transacao_existente_id: txExistente,
        item_ids:               items.map(i => i.id),
      }
    })
  }, [modoImportacao, sessao, catPorId, contas])

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

  // ── Handlers ─────────────────────────────────────────────────
  const classificar = (it: FaturaImportItem, catId: string | null) =>
    editarItem(it.id, { categoria_escolhida_id: catId || null, decisao: 'PENDENTE' })

  const aplicarSugestao = (it: FaturaImportItem) => {
    if (it.categoria_sugerida_id) classificar(it, it.categoria_sugerida_id)
  }
  const ignorar = (itemId: string) =>
    editarItem(itemId, { decisao: 'IGNORAR', categoria_escolhida_id: null })
  const voltar  = (itemId: string) =>
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

  const setDecisaoLancamento = (chave: string, d: DecisaoImport) =>
    setDecisaoOverride(prev => new Map(prev).set(chave, d))

  const toggleGrupo = (key: string) =>
    setGruposEncolhidos(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })

  const handleConfirmar = async () => {
    setConfirmando(true)
    const r = await confirmar()
    setConfirmando(false)
    if (r.ok) { toast('Importação confirmada.'); setTimeout(() => navigate('/importar-fatura'), 800) }
    else toast(r.erro ?? 'Falha ao confirmar.')
  }

  // Select de categoria reutilizado em item e bulk
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
    </>
  )

  // ── Early returns ─────────────────────────────────────────────
  if (loading) return <div className="py-8"><LoadingMascote texto="Carregando sessão…" size={130}/></div>
  if (error || !sessao) return (
    <div className="p-5">
      <p className="text-[15px]" style={{ color: '#f87171' }}>{error ?? 'Sessão não encontrada.'}</p>
      <Link to="/importar-fatura" className="text-[15px] underline mt-2 inline-block"
        style={{ color: '#4da6ff' }}>← Voltar</Link>
    </div>
  )

  const emAnalise = sessao.status === 'EM_ANALISE'

  return (
    <div className="p-5">
      <Toast msg={feedback} />

      <div className="flex items-center gap-2 mb-1">
        <Link to="/importar-fatura" className="flex items-center gap-1 text-[14px]"
          style={{ color: '#8b92a8' }}>
          <ArrowLeft size={14}/> Importações
        </Link>
      </div>
      <h1 className="text-[21px] font-bold flex items-center gap-2 mb-1" style={{ color: '#e8eaf0' }}>
        <Receipt size={22}/> Revisão — {sessao.conta?.nome ?? 'Cartão'}
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
          <AlertCircle size={13} className="inline mr-1 -mt-0.5"/>
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
                onChange={e => { if (e.target.value) classificarSelecionados(e.target.value) }}
                className="flex-1 min-w-[160px] rounded-md px-2 py-1 text-[13px] border border-white/10 disabled:opacity-50"
                style={{ background: '#0d1117', color: '#8b92a8' }}
              >
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
              </select>
              <button
                onClick={ignorarSelecionados}
                disabled={!emAnalise || emLote}
                className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border border-white/10 hover:bg-red-400/10 hover:border-red-400/30 transition-colors disabled:opacity-40 flex-none"
                style={{ color: '#8b92a8' }}>
                <XCircle size={13}/> Ignorar selecionados
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
                  <th className="text-left px-3 py-2">Descrição</th>
                  <th className="text-right px-3 py-2 w-28">Valor</th>
                  <th className="text-left px-3 py-2 w-48">Categoria</th>
                  <th className="px-3 py-2 w-20"></th>
                </tr>
              </thead>
              <tbody>
                {naoClassifFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-4 text-[13px] italic"
                      style={{ color: '#8b92a8' }}>
                      Nenhum item encontrado para "{filtroDesc}".
                    </td>
                  </tr>
                )}
                {naoClassifFiltrados.map(it => (
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
                      <p className="leading-snug">{it.descricao}</p>
                      {it.estabelecimento && (
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
                        onChange={e => classificar(it, e.target.value || null)}
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
                        <XCircle size={13}/> Ignorar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ══ Fase 2: Escolha do modo de importação ════════════════ */}
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
                Itens da mesma categoria viram um único lançamento, datado no dia de
                pagamento do cartão
                {(() => {
                  const conta = contas.find(c => c.conta_id === sessao.conta_id)
                  return conta?.dia_pagamento ? ` (dia ${conta.dia_pagamento})` : ''
                })()}.
              </p>
              <p className="mt-3 text-[13px] font-semibold opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ color: '#00c896' }}>
                Selecionar →
              </p>
            </button>
          </div>
        </div>
      )}

      {/* ══ Classificados (fases 1 e 2 — grupos encolhíveis) ════ */}
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
            {gruposOrdenados.map(([catId, grupo]) => {
              const isIgnorados = catId === '__IGNORAR__'
              const cat         = isIgnorados ? null : catPorId.get(catId)
              const nomeCat     = cat?.descricao ?? (isIgnorados ? 'Ignorados' : '—')
              const totalGrupo  = grupo.reduce(
                (s, i) => s + (i.tipo === 'RECEITA' ? -Number(i.valor) : Number(i.valor)), 0,
              )
              const encolhido = gruposEncolhidos.has(catId)
              return (
                <div key={catId} className="rounded-xl border border-white/10 overflow-hidden">
                  {/* Cabeçalho clicável — encolhe/expande */}
                  <button
                    onClick={() => toggleGrupo(catId)}
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
                    style={{ background: '#252d42' }}>
                    <ChevronDown
                      size={14}
                      className="flex-none transition-transform duration-200"
                      style={{
                        color: '#8b92a8',
                        transform: encolhido ? 'rotate(-90deg)' : 'rotate(0deg)',
                      }}
                    />
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
                        <span className="truncate block">{it.descricao}</span>
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
                          <RotateCcw size={13}/>
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

      {/* ══ Fase 3: Preview e confirmação ════════════════════════ */}
      {fase === 'preview' && (
        <div className="mb-6">
          <div className="flex flex-wrap items-center gap-2 mb-3">
            {emAnalise && (
              <button
                onClick={() => setModoImportacao(null)}
                className="flex items-center gap-1 text-[13px] px-2 py-1 rounded-md border border-white/10 hover:bg-white/5 transition-colors"
                style={{ color: '#8b92a8' }}>
                <ArrowLeft size={13}/> Mudar modo
              </button>
            )}
            <h2 className="text-[16px] font-semibold" style={{ color: '#e8eaf0' }}>
              Lançamentos a importar
            </h2>
            <span className="text-[12px] font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(77,166,255,0.15)', color: '#4da6ff' }}>
              {modoImportacao === 'REGISTRO' ? 'Por registro' : 'Por categoria'}
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
                    <th className="text-left px-3 py-2 w-52">Ação</th>
                  </tr>
                </thead>
                <tbody>
                  {lancamentosPreview.map(l => {
                    const dec    = decisoesOverride.get(l.chave) ?? l.decisaoSugerida
                    const corCriar = '#00c896'
                    const corAtual = '#4da6ff'
                    return (
                      <tr key={l.chave} className="border-t border-white/5">
                        <td className="px-3 py-2 text-[13px]" style={{ color: '#8b92a8' }}>
                          {l.data ? new Date(l.data + 'T00:00').toLocaleDateString('pt-BR') : '—'}
                        </td>
                        <td className="px-3 py-2">
                          <p className="leading-snug">{l.descricao}</p>
                          <p className="text-[12px]" style={{ color: '#8b92a8' }}>
                            📂 {l.categoria_nome}
                            {modoImportacao === 'CATEGORIA' && l.item_ids.length > 1 && (
                              <> · {l.item_ids.length} itens agrupados</>
                            )}
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
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {itens.length === 0 && (
        <p className="text-[15px] italic mb-4" style={{ color: '#8b92a8' }}>
          Nenhum item encontrado nesta sessão.
        </p>
      )}

      {/* ══ Rodapé ═══════════════════════════════════════════════ */}
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
    </div>
  )
}
