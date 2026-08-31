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
  XCircle, RotateCcw, ChevronDown, ChevronRight, Pencil,
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

const DIAS_SEMANA_ABREV = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
// Data (dd/mm/aaaa) + dia da semana abreviado. Sábado/domingo recebem destaque
// (âmbar + negrito) para facilitar a conferência da fatura.
function DataDiaSemana({ iso }: { iso: string | null | undefined }) {
  if (!iso) return <>—</>
  const d = new Date(iso + 'T00:00')
  const dow = d.getDay()
  const fds = dow === 0 || dow === 6
  return (
    <span className="whitespace-nowrap" style={fds ? { color: '#e8b84b' } : undefined}>
      {d.toLocaleDateString('pt-BR')}{' '}
      <span style={{ fontWeight: fds ? 700 : 400, color: fds ? '#e8b84b' : '#5b6478' }}>
        {DIAS_SEMANA_ABREV[dow]}
      </span>
    </span>
  )
}

/** Inicializa grupos para o modo CATEGORIA, reconstruindo do estado
 *  persistido em fatura_import_item:
 *  - Items com `grupo_chave` setado → grupo customizado (separado).
 *  - Items sem `grupo_chave`:
 *      • Parcelas com transação vinculada → 1 grupo por item.
 *      • Demais → 1 grupo por categoria_escolhida_id.
 *  Cada grupo herda descricao/decisao/transacao_existente_id do primeiro
 *  item (no caso de grupo custom) ou do item-com-tx (no caso de grupo por
 *  categoria). descricao_override SEMPRE manda sobre o resto. */
function initGrupos(
  itens:            FaturaImportItem[],
  catPorId:         Map<string, { descricao: string }>,
  contaNome:        string,
  separarPorCartao: boolean,
): GrupoImport[] {
  const naoIgnorados = itens.filter(i => i.decisao !== 'IGNORAR' && !!i.categoria_escolhida_id)

  const result: GrupoImport[] = []

  // 1) Grupos customizados persistidos (separados manualmente).
  const porChave = new Map<string, FaturaImportItem[]>()
  const semChave: FaturaImportItem[] = []
  for (const it of naoIgnorados) {
    if (it.grupo_chave) {
      if (!porChave.has(it.grupo_chave)) porChave.set(it.grupo_chave, [])
      porChave.get(it.grupo_chave)!.push(it)
    } else {
      semChave.push(it)
    }
  }
  for (const [chave, items] of porChave) {
    const first = items[0]
    const descOv  = first.descricao_override?.trim()
    const descTx  = first.transacao_existente?.descricao?.trim()
    const txEx    = first.transacao_existente_id
    result.push({
      id:                     chave,
      categoria_id:           first.categoria_escolhida_id!,
      item_ids:               items.map(i => i.id),
      decisao:                txEx ? 'ATUALIZAR' : 'CRIAR',
      transacao_existente_id: txEx,
      descricao:              descOv || descTx || stripParcela(first.descricao),
    })
  }

  // 2) Items sem grupo_chave → 1 grupo por CATEGORIA escolhida pelo usuário.
  //    NÃO quebramos por transacao_existente_id: no modo CATEGORIA o objetivo
  //    é UM lançamento por categoria. Quebrar por vínculo fazia a MESMA
  //    categoria virar 2 grupos (os itens que o /sugerir casou com um
  //    lançamento existente iam pra um grupo "Atualiza existente" e o resto
  //    pra um "Novo lançamento") — confuso e contra o que o usuário pediu.
  //    Um item vinculado a uma tx apenas define o ALVO de atualização do grupo.
  //    Separação extra só acontece:
  //      • manualmente, via grupo_chave (passo 1 acima);
  //      • por cartão, quando `separarPorCartao` está ligado — aí a chave
  //        inclui o cartão do item (observacao = "Cartão final 1234").
  type Bucket = { chave: string; items: FaturaImportItem[]; txId: string | null; catId: string; card: string }
  const buckets = new Map<string, Bucket>()
  for (const it of semChave) {
    const cat  = it.categoria_escolhida_id!
    const card = separarPorCartao ? (it.observacao ?? '').trim() : ''
    const k    = card ? `cat:${cat}|${card}` : `cat:${cat}`
    if (!buckets.has(k)) buckets.set(k, { chave: k, items: [], txId: null, catId: cat, card })
    const b = buckets.get(k)!
    b.items.push(it)
    // Primeiro item vinculado a uma tx define o alvo de ATUALIZAR do grupo.
    if (!b.txId && it.transacao_existente_id) b.txId = it.transacao_existente_id
  }
  for (const { chave, items, txId, catId, card } of buckets.values()) {
    const itComOv    = items.find(i => i.descricao_override?.trim())
    const descOv     = itComOv?.descricao_override?.trim()
    const itComTx    = items.find(i => i.transacao_existente_id) ?? items[0]
    const descTxVinc = itComTx.transacao_existente?.descricao?.trim()
    // Decisão: respeita escolha persistida do item (CRIAR/ATUALIZAR);
    // só usa o default baseado em txId quando o item ainda está PENDENTE.
    const itDec    = items.find(i => i.decisao === 'CRIAR' || i.decisao === 'ATUALIZAR')?.decisao
    const decisao  = (itDec as 'CRIAR' | 'ATUALIZAR' | undefined) ?? (txId ? 'ATUALIZAR' : 'CRIAR')
    // ID estável e único por bucket (categoria [+ cartão quando separado]).
    const groupId = card ? `cat-${catId}-${card}` : `cat-${catId}`
    // Descrição default quando não há override nem tx vinculada:
    const descDefault = separarPorCartao
      ? `${contaNome} - ${catPorId.get(catId)?.descricao ?? ''}`.trim()
      : (catPorId.get(catId)?.descricao ?? '').trim()
    result.push({
      id:                     groupId,
      categoria_id:           catId,
      item_ids:               items.map(i => i.id),
      decisao,
      transacao_existente_id: txId,
      descricao:              descOv || descTxVinc || descDefault,
    })
    void chave
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

  // Senha de PDFs protegidos.
  //   precisaSenha === null  → PDF não precisa (caso normal).
  //   precisaSenha === 'NOVA'      → 1ª vez pedindo; o usuário ainda não informou.
  //   precisaSenha === 'INCORRETA' → usuário informou, mas estava errada.
  // A senha vive APENAS neste state — não vai pra localStorage, não é salva
  // em nenhum lugar persistente. Ao sucesso ou cancelamento, é descartada.
  const [precisaSenha, setPrecisaSenha] = useState<null | 'NOVA' | 'INCORRETA'>(null)
  const [senhaInput,   setSenhaInput]   = useState('')

  const enviarComSenha = async (senha?: string) => {
    if (!contaId)  { setErro('Escolha um cartão.'); return }
    if (!arquivo)  { setErro('Selecione o PDF da fatura.'); return }
    setErro(null)
    setEnviando(true)
    const r = await importar({ conta_id: contaId, arquivo, senha })
    setEnviando(false)

    // PDF protegido — pede senha ao usuário em vez de mostrar erro genérico.
    // Se já enviamos uma senha e o backend ainda retorna SENHA_OBRIGATORIA,
    // tratamos como INCORRETA — pdfjs pode classificar errado a mensagem,
    // mas se o usuário mandou senha e o servidor ainda diz "protegido",
    // a senha não funcionou.
    if (!r.ok && (r.codigo === 'SENHA_OBRIGATORIA' || r.codigo === 'SENHA_INCORRETA')) {
      const senhaTentada = !!senha
      const estado: 'NOVA' | 'INCORRETA' =
        r.codigo === 'SENHA_INCORRETA' || senhaTentada ? 'INCORRETA' : 'NOVA'
      setPrecisaSenha(estado)
      return
    }

    if (r.ok && r.dados) {
      // Sucesso: zera estado da senha pra não vazar entre uploads.
      setSenhaInput('')
      setPrecisaSenha(null)
      setArquivo(null)
      toast('Fatura recebida — abra a sandbox para revisar.')
      navigate(`/importar-fatura/${r.dados.id}`)
      return
    }

    setErro(r.erro ?? 'Falha ao enviar a fatura.')
  }

  const enviar = () => enviarComSenha(undefined)

  const cancelarSenha = () => {
    setPrecisaSenha(null)
    setSenhaInput('')
  }

  const reenviarComSenha = () => enviarComSenha(senhaInput)

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
                onChange={e => {
                  // Novo arquivo: reseta qualquer estado anterior de senha
                  // — a senha do PDF anterior não vale pro novo upload.
                  setArquivo(e.target.files?.[0] ?? null)
                  setPrecisaSenha(null)
                  setSenhaInput('')
                  setErro(null)
                }}
              />
            </label>
          </Field>

          {erro && (
            <p className="text-[14px] bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
              style={{ color: '#f87171' }}>{erro}</p>
          )}

          {/* Caixa de senha — aparece quando o backend reporta PDF protegido.
              A senha vai SÓ no FormData desta request e some no setSenhaInput('')
              após sucesso ou cancelamento. Não vai pra localStorage nem pro banco. */}
          {precisaSenha && (
            <div className="rounded-lg border px-3 py-3 flex flex-col gap-2"
              style={{
                background:  precisaSenha === 'INCORRETA' ? 'rgba(248,113,113,0.08)' : 'rgba(240,180,41,0.08)',
                borderColor: precisaSenha === 'INCORRETA' ? 'rgba(248,113,113,0.30)' : 'rgba(240,180,41,0.30)',
              }}>
              <p className="text-[14px]" style={{ color: precisaSenha === 'INCORRETA' ? '#f87171' : '#f0b429' }}>
                🔒 {precisaSenha === 'INCORRETA'
                  ? 'Senha incorreta. Tente novamente.'
                  : 'Este PDF está protegido por senha. Informe a senha para analisarmos a fatura.'}
              </p>
              <p className="text-[12px]" style={{ color: '#8b92a8' }}>
                A senha é usada apenas para abrir este PDF agora.
                Ela <strong>não é armazenada</strong> em nenhum lugar.
              </p>
              <div className="flex flex-wrap items-center gap-2 mt-1">
                <input
                  type="password"
                  autoFocus
                  value={senhaInput}
                  onChange={e => setSenhaInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && senhaInput.length > 0 && !enviando) reenviarComSenha()
                    if (e.key === 'Escape') cancelarSenha()
                  }}
                  placeholder="Senha do PDF"
                  className="flex-1 min-w-[160px] rounded px-2 py-1.5 text-[14px] border outline-none"
                  style={{ background: '#0d1117', color: '#e8eaf0', borderColor: 'rgba(255,255,255,0.15)' }}
                  autoComplete="off"
                />
                <button
                  onClick={reenviarComSenha}
                  disabled={enviando || senhaInput.length === 0}
                  className="px-3 py-1.5 rounded-md text-[14px] font-semibold bg-av-green hover:bg-av-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  style={{ color: '#0a0f1a' }}>
                  {enviando ? 'Lendo…' : 'Abrir PDF'}
                </button>
                <button
                  onClick={cancelarSenha}
                  disabled={enviando}
                  className="px-3 py-1.5 rounded-md text-[14px] border border-white/10 hover:border-white/30 transition-colors disabled:opacity-50"
                  style={{ color: '#8b92a8' }}>
                  Cancelar
                </button>
              </div>
            </div>
          )}

          <button
            onClick={enviar}
            disabled={enviando || cartoes.length === 0 || !!precisaSenha}
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
    sessao, loading, error,
    editarSessao, editarItem, patchItensBulk,
    sugerir, confirmar, aplicarSugestoes, buscarTransacoes,
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
  const [separarPorCartao,    setSepararPorCartao]    = useState<boolean | null>(null)
  const [grupos,              setGrupos]              = useState<GrupoImport[]>([])
  const [selGrupo,            setSelGrupo]            = useState<Map<string, Set<string>>>(new Map())
  // grupoId → set de itemIds selecionados para separar
  const [editandoDescGrupo,   setEditandoDescGrupo]   = useState<string | null>(null)
  const [descEditTempGrupo,   setDescEditTempGrupo]   = useState('')
  // grupoId → nome (string) que o usuário digitou pra "Separar X itens em
  // novo lançamento". Vazio cai num fallback (descrição do primeiro item).
  const [nomeSeparacao,       setNomeSeparacao]       = useState<Map<string, string>>(new Map())

  // ── Estado – edição inline do valor total da fatura ─────────
  const [editandoValorTotal, setEditandoValorTotal] = useState(false)
  const [valorTotalTemp,     setValorTotalTemp]     = useState('')

  // ── Estado – tx do cartão no mês de vencimento ──────────────
  // Lista TODAS as transações PENDENTE/PROJEÇÃO do cartão no mês de
  // vencimento. Usado pra mostrar quais delas NÃO foram vinculadas a
  // nenhum item importado (provavelmente esquecidas pelo usuário).
  const [txTodasCartao, setTxTodasCartao] = useState<TxCandidata[]>([])

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

  // ── Efeito: hidrata modo + separar_por_cartao do banco ──────
  // Disparado uma vez por sessão. Permite que o usuário volte à tela e
  // pegue exatamente de onde parou (mesmo modo, mesma decisão de
  // agrupar por cartão).
  const hidratadoRef = useRef(false)
  useEffect(() => {
    if (hidratadoRef.current || !sessao) return
    hidratadoRef.current = true
    if (sessao.modo_importacao) setModoImportacao(sessao.modo_importacao)
    if (sessao.separar_por_cartao != null) setSepararPorCartao(sessao.separar_por_cartao)
  }, [sessao?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Efeito: limpa overrides ao trocar de modo ───────────────
  // separarPorCartao NÃO é resetada aqui — ela é persistida na sessão
  // e gerenciada explicitamente em chooseSepararPorCartao().
  useEffect(() => {
    setDecisaoOverride(new Map())
    setDescricaoOverride(new Map())
    setEditandoDesc(null)
    setGrupos([])
    setSelGrupo(new Map())
    setEditandoDescGrupo(null)
  }, [modoImportacao])

  // ── Wrappers que persistem decisões de fluxo no banco ───────
  const chooseModo = (m: null | 'REGISTRO' | 'CATEGORIA') => {
    setModoImportacao(m)
    editarSessao({ modo_importacao: m })
    if (m !== 'CATEGORIA') {
      // Sair de CATEGORIA descarta a flag de separar_por_cartao (faz
      // sentido só naquele modo). Persiste null pra próxima visita.
      setSepararPorCartao(null)
      editarSessao({ separar_por_cartao: null })
    }
  }
  const chooseSepararPorCartao = (b: boolean) => {
    setSepararPorCartao(b)
    editarSessao({ separar_por_cartao: b })
  }

  // ── Efeito: lista tx do cartão no mês de venc ──────────────
  // Só durante a revisão; serve para o painel "lançamentos não vinculados"
  // da fase de validação final. Refaz quando a sessão muda OU quando os
  // itens mudam (vincular/desvincular altera o conjunto coberto).
  useEffect(() => {
    if (!sessao || sessao.status !== 'EM_ANALISE') return
    let cancelled = false
    ;(async () => {
      const r = await buscarTransacoes(undefined, 'CATEGORIA')
      if (!cancelled && r.ok) setTxTodasCartao(r.dados ?? [])
    })()
    return () => { cancelled = true }
  }, [sessao?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Efeito: inicializa grupos ao entrar no modo CATEGORIA ───
  useEffect(() => {
    if (modoImportacao !== 'CATEGORIA' || !sessao || separarPorCartao === null) return
    const conta = contas.find(c => c.conta_id === sessao.conta_id)
    setGrupos(initGrupos(sessao.itens ?? [], catPorId, conta?.nome ?? 'Fatura', separarPorCartao))
    setSelGrupo(new Map())
  }, [modoImportacao, separarPorCartao]) // eslint-disable-line react-hooks/exhaustive-deps

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
      // Persisted override (de edições anteriores) vence o texto cru do PDF.
      descricao:              it.descricao_override?.trim() || it.descricao,
      valor:                  Number(it.valor),
      data:                   (it.parcela_atual != null && vencMes) ? `${vencMes}-01` : it.data_compra,
      categoria_id:           it.categoria_escolhida_id!,
      categoria_nome:         catPorId.get(it.categoria_escolhida_id!)?.descricao ?? '',
      tipo:                   it.tipo,
      decisaoSugerida:        (
        (it.decisao === 'CRIAR' || it.decisao === 'ATUALIZAR')
          ? it.decisao
          : (it.transacao_existente_id ? 'ATUALIZAR' : 'CRIAR')
      ) as DecisaoImport,
      transacao_existente_id: it.transacao_existente_id,
      item_ids:               [it.id],
    }))
  }, [modoImportacao, sessao, catPorId])

  const totalFatura = itens.reduce(
    (s, i) => s + (i.tipo === 'RECEITA' ? -Number(i.valor) : Number(i.valor)), 0,
  )

  // ── Validação: total esperado do CARTÃO no mês após a importação ──
  // A regra correta NÃO é "soma dos itens da fatura == valor_total". É
  // "total dos lançamentos no mês após o import == valor_total da fatura".
  //
  // Por que? Vincular um item a uma PROJEÇÃO substitui o valor da projeção
  // pelo valor real do item (o valor projetado vira referência via trigger
  // fn_preservar_valor_projetado). Então o que cai no mês = (itens novos
  // ou vinculados) + (projeções/pendências do mês que NÃO foram tocadas).
  //
  //   Total esperado mês = Σ itens não-ignorados (valor da fatura)
  //                     + Σ tx pendente/projeção do mês não-vinculadas
  //
  // No caso do usuário (Inter 33,40 vinculando a projeção 33,89, com mais
  // uma projeção residual 0,49 não tocada): 33,40 + 0,49 = 33,89 ✓
  //
  // IMPORTANTE: além das tx vinculadas (transacao_existente_id), também
  // filtramos as tx CRIADAS por confirmar anterior (transacao_criada_id).
  // Sem isso, depois de "Reabrir análise" o tx criado aparece em
  // txTodasCartao E na soma de itens — dobrando o valor.
  const txIdsRepresentadas = new Set<string>()
  for (const i of itens) {
    if (i.decisao === 'IGNORAR') continue
    if (i.transacao_existente_id) txIdsRepresentadas.add(i.transacao_existente_id)
    if (i.transacao_criada_id)    txIdsRepresentadas.add(i.transacao_criada_id)
  }
  const totalItensImport = itens.reduce(
    (s, i) => i.decisao === 'IGNORAR'
      ? s
      : s + (i.tipo === 'RECEITA' ? -Number(i.valor) : Number(i.valor)),
    0,
  )
  // Tx do cartão no mês de venc que NÃO são representadas por nenhum item
  // — nem vinculadas, nem criadas por confirmar anterior. Provavelmente
  // projeções recorrentes que ficaram de fora — ou que não pertencem a
  // esta fatura (cancelamento, etc.).
  const txNaoVinculadas = txTodasCartao.filter(tx => !txIdsRepresentadas.has(tx.id))
  const totalUntouchedMes = txNaoVinculadas.reduce(
    (s, tx) => s + (tx.tipo === 'RECEITA' ? -Number(tx.valor) : Number(tx.valor)),
    0,
  )
  const totalEsperadoMes = Math.round((totalItensImport + totalUntouchedMes) * 100) / 100

  const valorFaturaInformado = sessao?.valor_total ?? null
  const diferencaFatura = valorFaturaInformado != null
    ? Math.round((totalEsperadoMes - valorFaturaInformado) * 100) / 100
    : null
  // 1 centavo de tolerância pra arredondamento de parcelas / câmbio.
  const conferiu = diferencaFatura == null || Math.abs(diferencaFatura) <= 0.01

  const fase: 'classificar' | 'modo' | 'preview' =
    naoClassif.length > 0 ? 'classificar'
    : modoImportacao === null ? 'modo'
    : 'preview'

  const podeConfirmar =
    sessao?.status === 'EM_ANALISE' &&
    itens.length > 0 &&
    fase === 'preview' &&
    (modoImportacao !== 'CATEGORIA' || separarPorCartao !== null) &&
    conferiu

  // ── Handlers – Fase 1 ───────────────────────────────────────
  const emAnalise = sessao?.status === 'EM_ANALISE'

  const classificar = (it: FaturaImportItem, catId: string | null) =>
    editarItem(it.id, { categoria_escolhida_id: catId || null, decisao: 'PENDENTE' })

  const aplicarSugestao = (it: FaturaImportItem) => {
    if (it.categoria_sugerida_id) classificar(it, it.categoria_sugerida_id)
  }

  const ignorar = (itemId: string) =>
    editarItem(itemId, { decisao: 'IGNORAR', categoria_escolhida_id: null })

  // "Voltar" desfaz a classificação pra reclassificar do zero. Além da
  // categoria, precisa limpar TAMBÉM grupo_chave/descricao_override/
  // transacao_existente_id — resquícios de uma separação/vínculo manual
  // anterior (modo CATEGORIA). Sem isso, ao reclassificar o item na
  // categoria certa ele volta pro modo CATEGORIA ainda "preso" ao grupo
  // customizado antigo (initGrupos reconstrói grupos a partir desses
  // campos persistidos) — aparecendo separado dos demais itens da mesma
  // categoria, formando um 2º cabeçalho "📂 <mesma categoria>" duplicado
  // em vez de se juntar ao grupo compartilhado.
  const voltar = (itemId: string) =>
    editarItem(itemId, {
      categoria_escolhida_id: null,
      decisao:                'PENDENTE',
      grupo_chave:            null,
      descricao_override:     null,
      transacao_existente_id: null,
    })

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
  // Em REGISTRO, `chave` é o id do item. Persistimos no banco ao mesmo tempo
  // que atualizamos a UI — assim o usuário pode pausar e voltar sem perder
  // as edições.
  const setDecisaoLancamento = (chave: string, d: DecisaoImport) => {
    setDecisaoOverride(prev => new Map(prev).set(chave, d))
    if (d === 'CRIAR' || d === 'ATUALIZAR') {
      editarItem(chave, { decisao: d })
    }
  }

  const iniciarEdicaoDesc = (chave: string, descAtual: string) => {
    setEditandoDesc(chave)
    setDescEditTemp(descAtual)
  }
  const confirmarEdicaoDesc = (chave: string) => {
    const desc = descEditTemp.trim()
    if (desc) {
      setDescricaoOverride(prev => new Map(prev).set(chave, desc))
      editarItem(chave, { descricao_override: desc })
    }
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

  /** Cria um grupo NOVO a partir de itens selecionados de um grupo existente.
   *  `descricaoCustom` é o nome do lançamento informado pelo usuário; se vazio,
   *  usa a descrição do primeiro item como fallback.
   *  Retorna o id do grupo recém-criado (ou null se a separação não aconteceu),
   *  para que o caller possa, p.ex., abrir o modal de vincular já apontando
   *  para o novo grupo. */
  const separarItensGrupo = (grupoId: string, idsParaSeparar: string[], descricaoCustom?: string): string | null => {
    const grupoAtual = grupos.find(g => g.id === grupoId)
    if (!grupoAtual) return null
    const restantes = grupoAtual.item_ids.filter(id => !idsParaSeparar.includes(id))
    if (restantes.length === 0) return null  // não deixa grupo ficar vazio

    const priItem = (sessao?.itens ?? []).find(i => i.id === idsParaSeparar[0])
    const descNovo = (descricaoCustom ?? '').trim()
      || (priItem ? stripParcela(priItem.descricao) : grupoAtual.descricao)
    // `sep-${uuid}` é estável (não depende de Date.now()) — necessário pra
    // que o grupo persistido seja recuperável depois do reload da sessão.
    const novoId = `sep-${crypto.randomUUID()}`

    setGrupos(prev => {
      const idx = prev.findIndex(g => g.id === grupoId)
      if (idx === -1) return prev
      const grupo     = prev[idx]
      const restantesR = grupo.item_ids.filter(id => !idsParaSeparar.includes(id))
      if (restantesR.length === 0) return prev
      const next    = [...prev]
      next[idx] = { ...grupo, item_ids: restantesR }
      next.push({
        id:                     novoId,
        categoria_id:           grupo.categoria_id,
        item_ids:               idsParaSeparar,
        decisao:                'CRIAR',
        transacao_existente_id: null,
        descricao:              descNovo,
      })
      return next
    })
    setSelGrupo(prev => { const n = new Map(prev); n.delete(grupoId); return n })
    setNomeSeparacao(prev => { const n = new Map(prev); n.delete(grupoId); return n })

    // Persistir: marca os itens com grupo_chave + descricao_override.
    // Decisao=CRIAR e transacao_existente_id=null (resetando se vieram
    // herdados do grupo anterior).
    patchItensBulk(idsParaSeparar, {
      grupo_chave:            novoId,
      descricao_override:     descNovo,
      decisao:                'CRIAR',
      transacao_existente_id: null,
    })

    return novoId
  }

  /** Separa os itens em um grupo novo e, na sequência, abre o modal de
   *  vincular já apontando para esse novo grupo — fluxo "Shopee*Goldenmoon
   *  Come → POCO X7 PRO" em uma única ação. */
  const separarEAbrirVincular = (grupoId: string, idsParaSeparar: string[], descricaoCustom?: string) => {
    const novoId = separarItensGrupo(grupoId, idsParaSeparar, descricaoCustom)
    if (!novoId) return
    abrirVincular({ grupoId: novoId })
  }

  const setDecisaoGrupo = (grupoId: string, d: DecisaoImport) => {
    const g = grupos.find(g => g.id === grupoId)
    setGrupos(prev => prev.map(g => g.id === grupoId ? { ...g, decisao: d } : g))
    if (g && (d === 'CRIAR' || d === 'ATUALIZAR')) {
      patchItensBulk(g.item_ids, { decisao: d })
    }
  }

  /** Encolhe/expande o quadro de um grupo (esconde a lista de itens e o
   *  toolbar de decisão; mantém o cabeçalho clicável). */
  const toggleGrupoEncolhido = (grupoId: string) =>
    setGruposEncolhidos(prev => {
      const next = new Set(prev)
      if (next.has(grupoId)) next.delete(grupoId); else next.add(grupoId)
      return next
    })

  const iniciarEdicaoDescGrupo = (grupoId: string, desc: string) => {
    setEditandoDescGrupo(grupoId)
    setDescEditTempGrupo(desc)
  }
  const confirmarEdicaoDescGrupo = (grupoId: string) => {
    const desc = descEditTempGrupo.trim()
    if (desc) {
      const g = grupos.find(g => g.id === grupoId)
      setGrupos(prev => prev.map(g => g.id === grupoId ? { ...g, descricao: desc } : g))
      if (g) patchItensBulk(g.item_ids, { descricao_override: desc })
    }
    setEditandoDescGrupo(null)
  }
  const cancelarEdicaoDescGrupo = () => setEditandoDescGrupo(null)

  // ── Handlers – Vincular modal ────────────────────────────────
  const abrirVincular = async (params: { grupoId?: string; itemId?: string; desc?: string }) => {
    setVincularModal({ grupoId: params.grupoId, itemId: params.itemId })
    // Abre com filtro vazio — usuário busca se quiser. Pré-filtrar pela
    // descrição do grupo (ex.: "Shopee*Goldenmoon") esconde candidatas
    // legítimas com nomes que já foram cuidados (ex.: "POCO X7 PRO").
    setFiltroTxBusca('')
    setBuscandoTxs(true)
    setTxCandidatas([])
    // grupoId → CATEGORIA (lançamento agrupado, datado no venc.)
    // itemId  → REGISTRO  (lançamento por item, compra real costuma ser
    //                      em mês anterior ao venc.)
    const modoBusca = params.grupoId ? 'CATEGORIA' : 'REGISTRO'
    const r = await buscarTransacoes(undefined, modoBusca)
    setBuscandoTxs(false)
    if (r.ok) setTxCandidatas(r.dados ?? [])
  }

  const confirmarVincular = async (tx: TxCandidata) => {
    if (!vincularModal) return
    if (vincularModal.grupoId) {
      // Ao vincular manualmente, adota a descrição da transação escolhida
      // (a "Optical Plus" etc.) — o nome que o usuário já cuidou na projeção
      // sempre prevalece sobre o texto cru da fatura. Usuário pode reescrever
      // depois pelo botão de editar descrição se quiser.
      const descAdotada = tx.descricao?.trim()
      const grupoId = vincularModal.grupoId
      const g = grupos.find(g => g.id === grupoId)
      setGrupos(prev => prev.map(g =>
        g.id === grupoId
          ? {
              ...g,
              transacao_existente_id: tx.id,
              decisao:                'ATUALIZAR',
              descricao:              descAdotada || g.descricao,
            }
          : g,
      ))
      if (g) {
        // Persiste vínculo + decisao + descricao no grupo inteiro.
        await patchItensBulk(g.item_ids, {
          transacao_existente_id: tx.id,
          decisao:                'ATUALIZAR',
          descricao_override:     descAdotada || g.descricao,
        })
      }
    } else if (vincularModal.itemId) {
      setDecisaoOverride(prev => new Map(prev).set(vincularModal.itemId!, 'ATUALIZAR'))
      await editarItem(vincularModal.itemId, {
        transacao_existente_id: tx.id,
        decisao:                'ATUALIZAR',
      })
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

  // ── Filtro + ordenação do modal vincular ─────────────────────
  // Descobre a categoria-alvo do que está sendo vinculado (grupo ou item)
  // pra priorizar candidatas da mesma categoria no topo. Depois ordena
  // alfabeticamente.
  // contextoVincular: snapshot do que está sendo vinculado (grupo ou item
  // individual) — exibido no topo do modal pra o usuário ter certeza sobre
  // qual registro vai receber o vínculo.
  type ContextoVincular = {
    tipo:           'GRUPO' | 'ITEM'
    categoriaNome:  string
    descricao:      string
    valorTotal:     number
    itens:          Array<{ descricao: string; valor: number; data: string; tipo: 'RECEITA' | 'DESPESA' }>
  }
  const contextoVincular: ContextoVincular | null = (() => {
    if (!vincularModal) return null
    const itensSessao = sessao?.itens ?? []
    if (vincularModal.grupoId) {
      const g = grupos.find(gr => gr.id === vincularModal.grupoId)
      if (!g) return null
      const itens = itensSessao.filter(i => g.item_ids.includes(i.id))
      const total = itens.reduce(
        (s, i) => s + (i.tipo === 'RECEITA' ? -Number(i.valor) : Number(i.valor)), 0,
      )
      return {
        tipo:           'GRUPO',
        categoriaNome:  catPorId.get(g.categoria_id)?.descricao ?? '',
        descricao:      g.descricao,
        valorTotal:     Math.abs(total),
        itens:          itens.map(i => ({
          descricao: stripParcela(i.descricao),
          valor:     Number(i.valor),
          data:      i.data_compra,
          tipo:      i.tipo,
        })),
      }
    }
    const it = itensSessao.find(i => i.id === vincularModal.itemId)
    if (!it) return null
    return {
      tipo:           'ITEM',
      categoriaNome:  it.categoria_escolhida_id
        ? (catPorId.get(it.categoria_escolhida_id)?.descricao ?? '')
        : '',
      descricao:      it.descricao_override?.trim() || stripParcela(it.descricao),
      valorTotal:     Number(it.valor),
      itens:          [{
        descricao: stripParcela(it.descricao),
        valor:     Number(it.valor),
        data:      it.data_compra,
        tipo:      it.tipo,
      }],
    }
  })()
  const categoriaAlvoVincular = (() => {
    if (!vincularModal) return null
    if (vincularModal.grupoId) {
      return grupos.find(g => g.id === vincularModal.grupoId)?.categoria_id ?? null
    }
    if (vincularModal.itemId) {
      return (sessao?.itens ?? []).find(i => i.id === vincularModal.itemId)?.categoria_escolhida_id ?? null
    }
    return null
  })()

  const txsFiltradas = (() => {
    const filtrado = filtroTxBusca.trim()
      ? txCandidatas.filter(tx =>
          tx.descricao.toLowerCase().includes(filtroTxBusca.toLowerCase()) ||
          formatBRL(Number(tx.valor)).includes(filtroTxBusca),
        )
      : txCandidatas
    // Ordena: mesma categoria primeiro, depois alfabético (pt-BR, case-insensitive).
    return [...filtrado].sort((a, b) => {
      const ma = categoriaAlvoVincular && a.categoria_id === categoriaAlvoVincular ? 0 : 1
      const mb = categoriaAlvoVincular && b.categoria_id === categoriaAlvoVincular ? 0 : 1
      if (ma !== mb) return ma - mb
      return a.descricao.localeCompare(b.descricao, 'pt-BR', { sensitivity: 'base' })
    })
  })()

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
      {/* Notificação flutuante — visível independente do scroll */}
      {feedback && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg border border-av-green/40 text-[15px] font-semibold"
          style={{ background: '#1a1f2e', color: '#00c896', maxWidth: '90vw' }}>
          {feedback}
        </div>
      )}

      <div className="flex items-center gap-2 mb-1">
        <Link to="/importar-fatura" className="flex items-center gap-1 text-[14px]"
          style={{ color: '#8b92a8' }}>
          <ArrowLeft size={14} /> Importações
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h1 className="text-[21px] font-bold flex items-center gap-2" style={{ color: '#e8eaf0' }}>
          <Receipt size={22} /> Revisão — {sessao.conta?.nome ?? 'Cartão'}
        </h1>
        {sessao.status === 'CONFIRMADA' && (
          <button
            onClick={async () => {
              const ok = confirm(
                'Reabrir a análise vai voltar a sessão para EM_ANÁLISE. ' +
                'As transações já criadas/atualizadas permanecem no extrato — ' +
                'se você confirmar novamente, pode duplicar lançamentos. Continuar?',
              )
              if (!ok) return
              const r = await editarSessao({ status: 'EM_ANALISE' })
              if (!r.ok) toast(r.erro ?? 'Falha ao reabrir.')
            }}
            className="px-3 py-1.5 rounded-lg border text-[14px] hover:bg-av-yellow/10 transition-colors"
            style={{ color: '#f0b429', borderColor: 'rgba(240,180,41,0.40)' }}
            title="Voltar a sessão pra EM_ANÁLISE pra verificar/editar">
            ↺ Reabrir análise
          </button>
        )}
      </div>
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
        <div className="text-[13px] mb-4 px-3 py-2 rounded-lg border whitespace-pre-wrap"
          style={{ background: 'rgba(240,180,41,0.08)', borderColor: 'rgba(240,180,41,0.25)', color: '#f0b429' }}>
          <AlertCircle size={13} className="inline mr-1 -mt-0.5" />
          {sessao.observacao}
        </div>
      )}

      {/* ══ Validação: soma dos lançamentos vs valor da fatura ════
          O total que o sistema vai criar como lançamentos precisa bater
          com o valor da fatura. Diferença bloqueia o "Confirmar". O
          usuário pode ignorar itens extras ou corrigir o valor da fatura. */}
      {fase === 'preview' && emAnalise && (
        <div className="mb-4 px-3 py-3 rounded-lg border"
          style={{
            background:  conferiu ? 'rgba(74,222,128,0.08)' : 'rgba(248,113,113,0.08)',
            borderColor: conferiu ? 'rgba(74,222,128,0.30)' : 'rgba(248,113,113,0.40)',
          }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <span style={{ color: conferiu ? '#4ade80' : '#f87171' }}>
              {conferiu ? '✓ Total do mês confere com a fatura' : '⚠ Total esperado do mês diferente do valor da fatura'}
            </span>
            <span style={{ color: '#8b92a8' }}
              title={
                `Itens da fatura: ${formatBRL(totalItensImport)}` +
                (Math.abs(totalUntouchedMes) > 0.01
                  ? ` + Pendências/projeções do mês não-vinculadas: ${formatBRL(totalUntouchedMes)}`
                  : '')
              }>
              Total esperado no mês: <strong style={{ color: '#e8eaf0' }}>{formatBRL(totalEsperadoMes)}</strong>
            </span>
            <span style={{ color: '#8b92a8' }}>
              Valor da fatura:{' '}
              {editandoValorTotal ? (
                <input
                  autoFocus
                  type="text"
                  inputMode="decimal"
                  value={valorTotalTemp}
                  onChange={e => setValorTotalTemp(e.target.value)}
                  onBlur={async () => {
                    const limpo = valorTotalTemp.replace(/\./g, '').replace(',', '.').trim()
                    const n = Number(limpo)
                    if (Number.isFinite(n) && n > 0) {
                      await editarSessao({ valor_total: n })
                    }
                    setEditandoValorTotal(false)
                  }}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditandoValorTotal(false)
                  }}
                  className="inline-block w-24 rounded px-2 py-0.5 text-[13px] border border-av-green/50 outline-none"
                  style={{ background: '#131920', color: '#e8eaf0' }}
                />
              ) : (
                <>
                  <strong style={{ color: '#e8eaf0' }}>
                    {valorFaturaInformado != null ? formatBRL(valorFaturaInformado) : '—'}
                  </strong>
                  <button
                    onClick={() => {
                      setValorTotalTemp(
                        valorFaturaInformado != null
                          ? String(valorFaturaInformado).replace('.', ',')
                          : '',
                      )
                      setEditandoValorTotal(true)
                    }}
                    className="ml-1 p-0.5 rounded hover:bg-white/10 transition-colors align-middle"
                    style={{ color: '#4da6ff' }}
                    title="Editar valor da fatura">
                    <Pencil size={11} />
                  </button>
                </>
              )}
            </span>
            {diferencaFatura != null && !conferiu && (
              <span style={{ color: '#f87171' }}>
                Diferença: <strong>{diferencaFatura > 0 ? '+' : ''}{formatBRL(diferencaFatura)}</strong>
              </span>
            )}
          </div>
          {!conferiu && (
            <p className="text-[12px] mt-1.5" style={{ color: '#f87171' }}>
              {diferencaFatura != null && diferencaFatura > 0
                ? 'O total esperado supera a fatura. Ignore itens extras, vincule a projeções existentes ou ajuste valores.'
                : 'O total esperado é menor que a fatura. Pode faltar item — confira se há projeções pendentes a vincular, ou ajuste o valor da fatura acima.'}
              {' '}A importação fica bloqueada até bater.
            </p>
          )}
        </div>
      )}

      {/* ══ Lançamentos do cartão NÃO vinculados a itens importados ═
          Projeções/pendências do cartão no mês de venc que ficaram de
          fora — possivelmente esquecidas pelo usuário, ou que de fato
          não vieram nesta fatura (cancelamento de subscription, etc.). */}
      {fase === 'preview' && emAnalise && txNaoVinculadas.length > 0 && (
        <div className="mb-4 px-3 py-3 rounded-lg border"
          style={{ background: 'rgba(240,180,41,0.06)', borderColor: 'rgba(240,180,41,0.25)' }}>
          <p className="text-[13px] font-semibold mb-2" style={{ color: '#f0b429' }}>
            ⚠ {txNaoVinculadas.length} {txNaoVinculadas.length === 1 ? 'lançamento' : 'lançamentos'} no extrato deste cartão sem vínculo com a fatura
          </p>
          <p className="text-[12px] mb-2" style={{ color: '#8b92a8' }}>
            Estes lançamentos (PENDENTE/PROJEÇÃO) existem no extrato deste cartão para o mês do vencimento mas não foram vinculados a nenhum item desta fatura.
            Confira se eles deveriam ter sido vinculados — ou se cancelou/saiu da fatura.
          </p>
          <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {txNaoVinculadas.map(tx => (
              <li key={tx.id}>
                <button
                  type="button"
                  onClick={() => navigate('/lancamentos', {
                    state: {
                      editarId:          tx.id,
                      mes:               tx.data.slice(0, 7),
                      contaId:           tx.conta_id,
                      limparOutrosFiltros: true,
                    },
                  })}
                  className="w-full flex items-center gap-2 text-[12px] py-0.5 text-left rounded hover:bg-white/5 transition-colors"
                  title="Abrir este lançamento no Extrato">
                  <span className="flex-1 truncate underline decoration-dotted" style={{ color: '#4da6ff' }}>
                    {tx.descricao}
                  </span>
                  <span style={{ color: '#8b92a8' }}>
                    {new Date(tx.data + 'T00:00').toLocaleDateString('pt-BR')}
                  </span>
                  <span style={{ color: '#8b92a8' }}>· {tx.status}</span>
                  {tx.categoria?.descricao && (
                    <span style={{ color: '#8b92a8' }}>· {tx.categoria.descricao}</span>
                  )}
                  <span className="font-mono flex-none" style={{ color: '#e8eaf0' }}>
                    {formatBRL(Number(tx.valor))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
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
                  <th className="text-left px-3 py-2 w-32">Data</th>
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
                      <DataDiaSemana iso={it.data_compra} />
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
              onClick={() => chooseModo('REGISTRO')}
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
              onClick={() => chooseModo('CATEGORIA')}
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
                  {!encolhido && [...grupo].sort((a, b) => {
                      const d = stripParcela(a.descricao).localeCompare(stripParcela(b.descricao), 'pt-BR')
                      return d !== 0 ? d : a.data_compra.localeCompare(b.data_compra)
                    }).map((it, idx) => (
                    <div key={it.id}
                      className={`flex items-center gap-2 px-3 py-2 text-[13px] flex-wrap${idx > 0 ? ' border-t border-white/5' : ' border-t border-white/5'}`}
                      style={{ color: '#e8eaf0' }}>
                      <span className="w-28 flex-none text-[12px]" style={{ color: '#8b92a8' }}>
                        <DataDiaSemana iso={it.data_compra} />
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
                onClick={() => chooseModo(null)}
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
                    <th className="text-left px-3 py-2 w-32">Data</th>
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
                            <DataDiaSemana iso={l.data} />
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
                                {emAnalise && (
                                  <button
                                    onClick={() => iniciarEdicaoDesc(l.chave, descFinal)}
                                    className="opacity-0 group-hover/desc:opacity-100 transition-opacity p-0.5 rounded hover:bg-white/10 flex-none"
                                    style={{ color: '#8b92a8' }} title="Editar descrição">
                                    <Pencil size={11} />
                                  </button>
                                )}
                                <p className="leading-snug flex-1">{descFinal}</p>
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
                onClick={() => chooseModo(null)}
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

          {separarPorCartao === null ? (
            <div className="rounded-xl border border-white/10 p-5" style={{ background: '#1a1f2e' }}>
              <p className="text-[15px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>
                Deseja separar os grupos por cartão?
              </p>
              <p className="text-[13px] mb-4" style={{ color: '#8b92a8' }}>
                Se sim, o nome do cartão será incluído no título de cada grupo.
                Se não, os grupos terão apenas o nome da categoria.
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  onClick={() => chooseSepararPorCartao(true)}
                  className="px-4 py-2 rounded-lg border border-white/10 hover:border-av-green/50 hover:bg-av-green/5 transition-all text-[14px]"
                  style={{ color: '#e8eaf0' }}>
                  Sim, incluir nome do cartão
                </button>
                <button
                  onClick={() => chooseSepararPorCartao(false)}
                  className="px-4 py-2 rounded-lg border border-white/10 hover:border-av-green/50 hover:bg-av-green/5 transition-all text-[14px]"
                  style={{ color: '#e8eaf0' }}>
                  Não, só por categoria
                </button>
              </div>
            </div>
          ) : grupos.length === 0 ? (
            <p className="text-[14px] italic" style={{ color: '#8b92a8' }}>
              Nenhum lançamento a importar — todos os itens estão ignorados.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {grupos.map(grupo => {
                const itensGrupo  = (sessao?.itens ?? [])
                  .filter(i => grupo.item_ids.includes(i.id))
                  // (3) ordena por descrição (case/acento-insensitive)
                  .slice()
                  .sort((a, b) => stripParcela(a.descricao).localeCompare(stripParcela(b.descricao), 'pt-BR'))
                const totalGrupo  = itensGrupo.reduce(
                  (s, i) => s + (i.tipo === 'RECEITA' ? -Number(i.valor) : Number(i.valor)), 0,
                )
                const catNome     = catPorId.get(grupo.categoria_id)?.descricao ?? ''
                const selAtual    = selGrupo.get(grupo.id) ?? new Set<string>()
                const algumSelAt  = selAtual.size > 0
                const corCriar    = '#00c896'
                const corAtual_   = '#4da6ff'
                const encolhido   = gruposEncolhidos.has(grupo.id)
                // (1) Vinculação: se há tx vinculada, o grupo VAI atualizar
                // uma transação existente. Mostramos isso de forma proeminente,
                // com cor de borda diferente e badge no header.
                const ehVinculado = !!grupo.transacao_existente_id
                const nomeSep     = nomeSeparacao.get(grupo.id) ?? ''

                return (
                  <div key={grupo.id} className="rounded-xl border overflow-hidden"
                    style={{
                      borderColor: ehVinculado ? 'rgba(77,166,255,0.40)' : 'rgba(255,255,255,0.10)',
                    }}>
                    {/* Cabeçalho do grupo */}
                    <div className="px-3 py-2"
                      style={{ background: ehVinculado ? 'rgba(77,166,255,0.10)' : '#252d42' }}>
                      <div className="flex flex-wrap items-center gap-2">
                        {/* Toggle encolher/expandir */}
                        <button
                          onClick={() => toggleGrupoEncolhido(grupo.id)}
                          title={encolhido ? 'Expandir' : 'Encolher'}
                          className="flex-none flex items-center justify-center rounded transition-colors hover:bg-white/10"
                          style={{ width: 18, height: 18, color: '#8b92a8' }}
                        >
                          {encolhido ? <ChevronRight size={12}/> : <ChevronDown size={12}/>}
                        </button>
                        <span className="text-[14px] font-semibold" style={{ color: '#e8eaf0' }}>
                          📂 {catNome}
                        </span>
                        <span className="text-[12px]" style={{ color: '#8b92a8' }}>
                          {itensGrupo.length} {itensGrupo.length === 1 ? 'item' : 'itens'}
                        </span>
                        {/* (1) Badge bem visível: vinculado vs novo */}
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full"
                          style={
                            ehVinculado
                              ? { background: 'rgba(77,166,255,0.20)', color: '#4da6ff', border: '1px solid rgba(77,166,255,0.40)' }
                              : { background: 'rgba(0,200,150,0.15)', color: '#00c896', border: '1px solid rgba(0,200,150,0.35)' }
                          }>
                          {ehVinculado ? '🔗 Atualiza existente' : '🆕 Novo lançamento'}
                        </span>
                        <span className="ml-auto text-[14px] font-semibold font-mono" style={{ color: '#e8eaf0' }}>
                          {formatBRL(Math.abs(totalGrupo))}
                        </span>
                      </div>
                      {/* Descrição editável — sempre com pencil visível */}
                      <div className="mt-1.5 flex items-center gap-1.5">
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
                            {emAnalise && (
                              <button
                                onClick={() => iniciarEdicaoDescGrupo(grupo.id, grupo.descricao)}
                                className="p-0.5 rounded transition-colors hover:bg-white/10 flex-none"
                                style={{ color: '#4da6ff' }} title="Editar descrição do lançamento">
                                <Pencil size={12} />
                              </button>
                            )}
                            <p className="text-[13px] flex-1" style={{ color: '#c8d0e0' }}>
                              <span style={{ color: '#8b92a8' }}>Descrição:</span> {grupo.descricao || <em style={{ color: '#8b92a8' }}>(vazio)</em>}
                            </p>
                          </>
                        )}
                      </div>
                      {/* Botões de decisão (escondidos quando encolhido) */}
                      {!encolhido && (
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
                        </div>
                      )}
                    </div>

                    {/* Itens do grupo — escondidos quando encolhido. Ordenados por descrição. */}
                    {!encolhido && itensGrupo.map((it, idx) => (
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

                    {/* (4) Caixa pra nomear o lançamento ao separar itens.
                        Aparece quando há checkbox marcado em algum item do grupo. */}
                    {!encolhido && algumSelAt && emAnalise && (
                      <div className="px-3 py-2 border-t border-white/5 flex flex-wrap items-center gap-2"
                        style={{ background: 'rgba(0,200,150,0.04)' }}>
                        <span className="text-[12px] font-semibold" style={{ color: '#00c896' }}>
                          {selAtual.size} {selAtual.size === 1 ? 'item' : 'itens'} para separar
                        </span>
                        <input
                          type="text"
                          value={nomeSep}
                          onChange={e =>
                            setNomeSeparacao(prev => {
                              const n = new Map(prev)
                              n.set(grupo.id, e.target.value)
                              return n
                            })
                          }
                          onKeyDown={e => {
                            if (e.key === 'Enter') {
                              separarItensGrupo(grupo.id, [...selAtual], nomeSep)
                            }
                          }}
                          placeholder="Nome do novo lançamento (opcional)"
                          className="flex-1 min-w-[180px] rounded px-2 py-1 text-[13px] border outline-none"
                          style={{ background: '#131920', color: '#e8eaf0', borderColor: 'rgba(0,200,150,0.30)' }}
                        />
                        <button
                          onClick={() => separarItensGrupo(grupo.id, [...selAtual], nomeSep)}
                          className="text-[13px] px-3 py-1 rounded-md border border-av-green/40 hover:bg-av-green/10 transition-colors"
                          style={{ color: '#00c896' }}>
                          ↗ Separar
                        </button>
                        <button
                          onClick={() => separarEAbrirVincular(grupo.id, [...selAtual], nomeSep)}
                          className="text-[13px] px-3 py-1 rounded-md border border-av-blue/40 hover:bg-av-blue/10 transition-colors"
                          style={{ color: '#4da6ff', borderColor: 'rgba(77,166,255,0.40)' }}
                          title="Separar em novo grupo e já abrir o modal de vincular">
                          ↗🔗 Separar e vincular
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

            {/* Contexto: o que está sendo vinculado.
                Pra grupos com vários itens, lista os primeiros 5 (com botão
                "ver mais" se houver mais). Pra item único, só os dados dele. */}
            {contextoVincular && (
              <div className="px-4 py-3 border-b border-white/10"
                style={{ background: 'rgba(77,166,255,0.06)' }}>
                <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: '#8b92a8' }}>
                  Vinculando {contextoVincular.tipo === 'GRUPO'
                    ? `${contextoVincular.itens.length} ${contextoVincular.itens.length === 1 ? 'item' : 'itens'}`
                    : '1 item'}
                </p>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[14px] font-semibold leading-snug" style={{ color: '#e8eaf0' }}>
                      {contextoVincular.descricao || <em style={{ color: '#8b92a8' }}>(sem descrição)</em>}
                    </p>
                    <p className="text-[12px] mt-0.5" style={{ color: '#8b92a8' }}>
                      📂 {contextoVincular.categoriaNome || '—'}
                    </p>
                  </div>
                  <span className="text-[14px] font-mono flex-none font-semibold" style={{ color: '#e8eaf0' }}>
                    {formatBRL(contextoVincular.valorTotal)}
                  </span>
                </div>
                {contextoVincular.tipo === 'GRUPO' && contextoVincular.itens.length > 1 && (
                  <ul className="mt-2 space-y-0.5 max-h-32 overflow-y-auto pr-1">
                    {contextoVincular.itens.map((it, i) => (
                      <li key={i} className="flex items-center gap-2 text-[12px]" style={{ color: '#8b92a8' }}>
                        <span className="flex-none">·</span>
                        <span className="flex-1 truncate">{it.descricao}</span>
                        <span className="font-mono flex-none">
                          {it.tipo === 'RECEITA' ? `−${formatBRL(it.valor)}` : formatBRL(it.valor)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="px-4 py-3">
              <input
                type="text"
                autoFocus
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
                    ? 'Nenhum lançamento PENDENTE/PROJEÇÃO neste cartão dentro do período da fatura.'
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
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] mt-0.5" style={{ color: '#8b92a8' }}>
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
