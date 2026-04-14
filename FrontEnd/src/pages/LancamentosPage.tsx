// src/pages/LancamentosPage.tsx
import { useState, useMemo } from 'react'
import { Plus, Pencil, Zap, ChevronDown, Check, Repeat2, ArrowLeftRight } from 'lucide-react'
import { useLancamentos, type Lancamento } from '../hooks/useLancamentos'
import { useContas } from '../hooks/useContas'
import { useCategorias } from '../hooks/useCategorias'
import { formatBRL } from '../lib/utils'
import { IconeConta } from '../components/ui/IconeConta'
import {
  Drawer, Field, Input, SelectDark, Toggle,
  BtnSalvar, BtnCancelar, Toast, ModalExcluir, Segmented,
} from '../components/ui/shared'
import { MultiSelect, type MultiSelectOption } from '../components/ui/MultiSelect'
import { MonthPicker } from '../components/ui/MonthPicker'

// ── Helpers de data ───────────────────────────────────────────
function mesAtual() {
  return new Date().toISOString().slice(0, 7)
}
function mesLabel(ym: string) {
  const [y, m] = ym.split('-')
  const nome = new Date(Number(y), Number(m) - 1).toLocaleDateString('pt-BR', { month: 'long' })
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}/${y}`
}
function fmtData(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function fmtDataLabel(iso: string) {
  const d = new Date(iso + 'T12:00:00')
  const label = d.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}
function agruparPorData<T extends { data: string }>(items: T[]): [string, T[]][] {
  const map = new Map<string, T[]>()
  for (const l of items) {
    const arr = map.get(l.data) ?? []
    arr.push(l)
    map.set(l.data, arr)
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b))
}
function hoje() {
  return new Date().toISOString().slice(0, 10)
}

// ── Badge de status ───────────────────────────────────────────
function StatusBadge({ status, onClick }: { status: string; onClick?: () => void }) {
  const cfg: Record<string, { label: string; bg: string; color: string }> = {
    PAGO:     { label: 'Pago',     bg: 'rgba(0,200,150,.12)',  color: '#00c896' },
    PENDENTE: { label: 'Pendente', bg: 'rgba(77,166,255,.12)', color: '#4da6ff' },
    PROJECAO: { label: 'Projeção', bg: 'rgba(240,180,41,.12)', color: '#f0b429' },
  }
  const c = cfg[status] ?? cfg.PENDENTE
  return (
    <span
      onClick={onClick}
      className={onClick ? 'cursor-pointer' : ''}
      style={{
        background: c.bg, color: c.color,
        fontSize: 10, fontWeight: 700, padding: '2px 7px',
        borderRadius: 20, letterSpacing: '0.4px', whiteSpace: 'nowrap',
      }}
    >{c.label}</span>
  )
}

// ── Botão de ação ─────────────────────────────────────────────
function AcaoBtn({ onClick, title, color = '#8b92a8', children }: {
  onClick: (e: React.MouseEvent) => void; title: string; color?: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={e => { e.stopPropagation(); onClick(e) }}
      title={title}
      className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center transition-all flex-shrink-0"
      style={{ color }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement
        el.style.background = 'rgba(255,255,255,0.06)'
        el.style.borderColor = 'rgba(255,255,255,0.25)'
        el.style.color = '#e8eaf0'
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement
        el.style.background = 'transparent'
        el.style.borderColor = 'rgba(255,255,255,0.1)'
        el.style.color = color
      }}
    >
      {children}
    </button>
  )
}

// ── Modal de escopo de recorrência ────────────────────────────
function ModalEscopo({ onConfirmar, onCancelar, acao, temPagasAnteriores }: {
  onConfirmar: (escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS') => void
  onCancelar: () => void
  acao: 'editar' | 'excluir'
  temPagasAnteriores: boolean
}) {
  const opcoes: ['SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS', string, string | null][] = [
    ['SOMENTE_ESTE',     'Somente este lançamento',  null],
    ['ESTE_E_SEGUINTES', 'Este e os seguintes',       null],
    ['TODOS',            'Todos da série',            temPagasAnteriores ? 'Existem parcelas anteriores já pagas' : null],
  ]
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onCancelar} />
      <div className="relative bg-[#1a1f2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">
        <p className="text-[14px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>
          {acao === 'editar' ? 'Editar' : 'Excluir'} lançamento recorrente
        </p>
        <p className="text-[12px] mb-5" style={{ color: '#8b92a8' }}>
          Este lançamento faz parte de uma série. O que deseja {acao === 'editar' ? 'editar' : 'excluir'}?
        </p>
        <div className="flex flex-col gap-2">
          {opcoes.map(([val, label, aviso]) => {
            const desabilitado = val === 'TODOS' && temPagasAnteriores
            return (
              <button key={val}
                onClick={() => !desabilitado && onConfirmar(val)}
                disabled={desabilitado}
                className={`w-full py-2.5 px-4 rounded-lg border text-[13px] text-left transition-all
                  ${desabilitado
                    ? 'border-white/5 opacity-40 cursor-not-allowed'
                    : 'border-white/10 hover:border-av-green hover:bg-av-green/5 cursor-pointer'}`}
                style={{ color: '#e8eaf0' }}>
                <span>{label}</span>
                {aviso && (
                  <span className="block text-[10px] mt-0.5" style={{ color: '#f0b429' }}>{aviso}</span>
                )}
              </button>
            )
          })}
        </div>
        <button onClick={onCancelar} className="mt-3 text-[11px] w-full text-center"
          style={{ color: '#8b92a8' }}>Cancelar</button>
      </div>
    </div>
  )
}

// ── Formulário de lançamento ──────────────────────────────────
type TipoTx = 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA'
type StatusTx = 'PAGO' | 'PENDENTE' | 'PROJECAO'
interface FormState {
  tipo: TipoTx; data: string; descricao: string; valor: string
  conta_id: string; conta_destino_id: string; categoria_id: string
  status: StatusTx; observacao: string
  recorrente: boolean; total_parcelas: string; tipo_recorrencia: string
}
const FORM_VAZIO: FormState = {
  tipo: 'DESPESA', data: hoje(), descricao: '', valor: '',
  conta_id: '', conta_destino_id: '', categoria_id: '', status: 'PAGO', observacao: '',
  recorrente: false, total_parcelas: '2', tipo_recorrencia: 'MENSAL',
}
function formDeLanc(l: Lancamento): FormState {
  // Para transferências: descricao tem formato "[Transf. saída] Descrição 1/1"
  // extraímos a descrição limpa e identificamos origem/destino pelo id_recorrencia
  const isTransf = l.descricao?.startsWith('[Transf')
  const descricaoLimpa = isTransf
    ? l.descricao.replace(/^\[Transf\. (saída|entrada)\] /, '').replace(/ \d+\/\d+$/, '')
    : l.descricao
  return {
    tipo: isTransf ? 'TRANSFERENCIA' : l.tipo,
    data: l.data, descricao: descricaoLimpa,
    valor: String(l.valor), conta_id: l.conta_id,
    conta_destino_id: '', // preenchido dinamicamente no abrirEditar para transferências
    categoria_id: l.categoria_id ?? '', status: l.status,
    observacao: l.observacao ?? '',
    recorrente: !!l.id_recorrencia, total_parcelas: String(l.total_parcelas ?? 2),
    tipo_recorrencia: l.tipo_recorrencia ?? 'MENSAL',
  }
}

// ── Página principal ──────────────────────────────────────────
export default function LancamentosPage() {
  const [mes,         setMes]         = useState(mesAtual())
  const [filtContas,  setFiltContas]  = useState<string[]>([])
  const [filtCats,    setFiltCats]    = useState<string[]>([])
  const [filtStatus,  setFiltStatus]  = useState('')
  const [comSaldo,    setComSaldo]    = useState(false)

  const { lancamentos, loading, error, carregar, criar, editar, excluir, antecipar, alterarStatus, criarTransferencia, editarTransferencia } =
    useLancamentos({ mes, conta_ids: filtContas, categoria_ids: filtCats, status: filtStatus, com_saldo: comSaldo })

  const { contas }     = useContas()
  const { categorias } = useCategorias()

  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editando,    setEditando]    = useState<Lancamento | null>(null)
  const [excluindo,   setExcluindo]   = useState<Lancamento | null>(null)
  const [escopoAcao,  setEscopoAcao]  = useState<{ lancamento: Lancamento; acao: 'editar' | 'excluir'; temPagasAnteriores: boolean } | null>(null)
  const [feedback,    setFeedback]    = useState<string | null>(null)
  const [form,        setForm]        = useState<FormState>(FORM_VAZIO)
  const [erro,        setErro]        = useState<string | null>(null)
  const [salvando,    setSalvando]    = useState(false)

  // Status dropdown aberto
  const [statusOpen,  setStatusOpen]  = useState<string | null>(null)
  // Modal de antecipação
  const [antecipando, setAntecipando] = useState<Lancamento | null>(null)

  const set   = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }))
  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3000) }

  const abrirNovo   = () => { setEditando(null); setForm(FORM_VAZIO); setErro(null); setDrawerOpen(true) }
  const abrirEditar = (l: Lancamento) => {
    const isTransf = l.descricao?.startsWith('[Transf')
    // Transferências: escopo não se aplica, abre direto
    if (!isTransf && l.id_recorrencia) {
      // Verifica se há parcelas anteriores pagas (nr_parcela > 1 com alguma paga antes)
      const temPagasAnteriores = lancamentos.some(
        x => x.id_recorrencia === l.id_recorrencia &&
             x.status === 'PAGO' &&
             (x.nr_parcela ?? 0) < (l.nr_parcela ?? 1)
      )
      setEscopoAcao({ lancamento: l, acao: 'editar', temPagasAnteriores })
      return
    }
    const f = formDeLanc(l)
    // Para transferência de saída, conta_destino_id é a outra perna (não temos diretamente — usuário informa)
    // Para facilitar, buscamos o par pelo id_recorrencia na lista de lançamentos
    if (isTransf && l.id_recorrencia) {
      const par = lancamentos.find(x => x.id_recorrencia === l.id_recorrencia && x.id !== l.id)
      if (par) {
        // Garante que estamos editando sempre pela perna de saída
        const saida   = l.descricao?.includes('saída')  ? l   : par
        const entrada = l.descricao?.includes('entrada') ? l   : par
        f.conta_id         = saida.conta_id
        f.conta_destino_id = entrada.conta_id
        setEditando(saida)
        setForm(f); setErro(null); setDrawerOpen(true)
        return
      }
    }
    setEditando(l); setForm(f); setErro(null); setDrawerOpen(true)
  }
  const fechar = () => { setDrawerOpen(false); setEditando(null); setErro(null) }

  const salvar = async () => {
    if (!form.descricao.trim()) { setErro('Descrição é obrigatória.'); return }
    if (!form.valor || isNaN(parseFloat(form.valor))) { setErro('Valor inválido.'); return }
    if (!form.conta_id) { setErro('Selecione a conta de origem.'); return }
    setSalvando(true); setErro(null)

    // ── Transferência ──────────────────────────────────────
    if (form.tipo === 'TRANSFERENCIA') {
      if (!form.conta_destino_id) { setSalvando(false); setErro('Selecione a conta de destino.'); return }
      if (form.conta_id === form.conta_destino_id) { setSalvando(false); setErro('Conta de origem e destino devem ser diferentes.'); return }
      const payload = {
        conta_origem_id:  form.conta_id,
        conta_destino_id: form.conta_destino_id,
        valor:       parseFloat(form.valor),
        data:        form.data,
        descricao:   form.descricao.trim(),
        status:      form.status,
        observacao:  form.observacao || undefined,
      }
      if (editando) {
        // A API espera o id_recorrencia (UUID do par), não o id da transação individual
        const idPar = editando.id_recorrencia ?? editando.id
        const { ok, erro: e } = await editarTransferencia(idPar, payload)
        setSalvando(false)
        if (ok) { fechar(); toast('Transferência atualizada!') } else { setErro(e ?? 'Erro ao salvar.') }
      } else {
        const { ok, erro: e } = await criarTransferencia(payload)
        setSalvando(false)
        if (ok) { fechar(); toast('Transferência criada!') } else { setErro(e ?? 'Erro ao salvar.') }
      }
      return
    }

    // ── Receita / Despesa ──────────────────────────────────
    const payload: Partial<Lancamento> = {
      tipo: form.tipo as 'RECEITA' | 'DESPESA',
      data: form.data, descricao: form.descricao.trim(),
      valor: parseFloat(form.valor), conta_id: form.conta_id,
      categoria_id: form.categoria_id || undefined,
      status: form.status,
      observacao: form.observacao || undefined,
      ...(form.recorrente && !editando ? {
        total_parcelas: parseInt(form.total_parcelas) || 2,
        tipo_recorrencia: form.tipo_recorrencia,
      } : {}),
    }

    if (editando) {
      const { ok, erro: e } = await editar(editando.id, payload)
      setSalvando(false)
      if (ok) { fechar(); toast('Lançamento atualizado!') } else { setErro(e ?? 'Erro ao salvar.') }
    } else {
      const { ok, erro: e } = await criar(payload)
      setSalvando(false)
      if (ok) { fechar(); toast('Lançamento criado!') } else { setErro(e ?? 'Erro ao salvar.') }
    }
  }

  const handleEscopoConfirmado = async (escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS') => {
    if (!escopoAcao) return
    const { lancamento, acao } = escopoAcao
    setEscopoAcao(null)
    if (acao === 'editar') {
      setEditando(lancamento); setForm(formDeLanc(lancamento)); setErro(null); setDrawerOpen(true)
    } else {
      const { ok, erro: e } = await excluir(lancamento.id, escopo)
      if (ok) { toast('Lançamento excluído.') } else { toast(e ?? 'Não foi possível excluir.') }
    }
  }

  const handleExcluir = async () => {
    if (!excluindo) return
    if (excluindo.id_recorrencia) {
      const temPagasAnteriores = lancamentos.some(
        x => x.id_recorrencia === excluindo.id_recorrencia &&
             x.status === 'PAGO' &&
             (x.nr_parcela ?? 0) < (excluindo.nr_parcela ?? 1)
      )
      setExcluindo(null); setEscopoAcao({ lancamento: excluindo, acao: 'excluir', temPagasAnteriores }); return
    }
    const { ok, erro: e } = await excluir(excluindo.id)
    setExcluindo(null)
    if (ok) { toast('Lançamento excluído.') } else { toast(e ?? 'Não foi possível excluir.') }
  }

  const handleStatus = async (l: Lancamento, status: StatusTx) => {
    setStatusOpen(null)
    const { ok, erro: e } = await alterarStatus(l.id, status)
    if (!ok) toast(e ?? 'Erro ao alterar status.')
  }

  // Totais do mês filtrado
  const totais = useMemo(() => {
    const receitas  = lancamentos.filter(l => l.tipo === 'RECEITA').reduce((s, l) => s + l.valor, 0)
    const despesas  = lancamentos.filter(l => l.tipo === 'DESPESA').reduce((s, l) => s + l.valor, 0)
    return { receitas, despesas, resultado: receitas - despesas }
  }, [lancamentos])

  // CategoriasCategorias pai para o select (exclui protegidas)
  const catsPai = categorias.filter(c => !c.id_pai && !c.protegida)
  const catsSub = categorias.filter(c => !!c.id_pai)

  return (
    <div className="p-5">
      {/* Topbar */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-[17px] font-bold" style={{ color: '#e8eaf0' }}>Lançamentos</h1>
        <button onClick={abrirNovo}
          className="flex items-center gap-1.5 bg-av-green text-[12px] font-semibold px-3 py-1.5 rounded-lg hover:bg-av-green/90 transition-colors"
          style={{ color: '#0a0f1a' }}>
          <Plus size={14} /> Novo lançamento
        </button>
      </div>

      <Toast msg={feedback} />

      {/* Filtros */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {/* Mês */}
        <MonthPicker value={mes} onChange={setMes} />

        {/* Conta — multi-select */}
        <MultiSelect
          placeholder="Todas as contas"
          className="w-44"
          values={filtContas}
          onChange={setFiltContas}
          options={contas.map(c => ({
            value: c.conta_id,
            label: c.nome,
            cor: c.cor ?? undefined,
          }))}
        />
        {/* Categoria — multi-select agrupado */}
        <MultiSelect
          placeholder="Todas as categorias"
          className="w-48"
          values={filtCats}
          onChange={setFiltCats}
          options={[
            ...catsPai.map(p => ({
              value: p.id,
              label: p.descricao,
              icone: p.icone ?? undefined,
              cor: p.cor ?? undefined,
            })),
            ...catsSub.map(s => {
              const pai = catsPai.find(p => p.id === s.id_pai)
              return {
                value: s.id,
                label: s.descricao,
                icone: s.icone ?? undefined,
                cor: s.cor ?? undefined,
                grupo: pai?.descricao ?? '',
                idPai: s.id_pai ?? undefined,
              }
            }),
          ]}
        />

        {/* Status */}
        <SelectDark value={filtStatus} onChange={e => setFiltStatus(e.target.value)} className="w-36">
          <option value="">Todos os status</option>
          <option value="PAGO"     style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Pago</option>
          <option value="PENDENTE" style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Pendente</option>
          <option value="PROJECAO" style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Projeção</option>
        </SelectDark>

        {/* Toggle saldo acumulado */}
        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[11px]" style={{ color: '#8b92a8' }}>Saldo acumulado</span>
          <button onClick={() => setComSaldo(v => !v)}
            className={`w-9 h-5 rounded-full relative transition-colors ${comSaldo ? 'bg-av-green' : 'bg-white/10'}`}>
            <span className="absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all"
              style={{ left: comSaldo ? '18px' : '2px' }} />
          </button>
        </div>
      </div>

      {/* Cards de resumo */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        {[
          { label: 'Receitas',  valor: totais.receitas,  color: '#00c896' },
          { label: 'Despesas',  valor: totais.despesas,  color: '#f87171' },
          { label: 'Resultado', valor: totais.resultado, color: totais.resultado >= 0 ? '#00c896' : '#f87171' },
        ].map(c => (
          <div key={c.label} className="bg-[#1a1f2e] border border-white/10 rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: '#8b92a8' }}>{c.label}</p>
            <p className="text-[16px] font-bold" style={{ color: c.color }}>{formatBRL(c.valor)}</p>
          </div>
        ))}
      </div>

      {loading && <p className="text-[13px] text-center py-12" style={{ color: '#8b92a8' }}>Carregando...</p>}
      {error   && <p className="text-[13px] text-center py-12" style={{ color: '#f87171' }}>{error}</p>}

      {!loading && !error && (
        <>
          {lancamentos.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-[13px] mb-3" style={{ color: '#8b92a8' }}>Nenhum lançamento em {mesLabel(mes)}.</p>
              <button onClick={abrirNovo} className="text-[12px] underline underline-offset-2" style={{ color: '#00c896' }}>
                Criar primeiro lançamento
              </button>
            </div>
          ) : (
            <>
              {/* ── Tabela desktop ── */}
              <div className="hidden md:block space-y-4">
                {agruparPorData(lancamentos).map(([data, grupo]) => (
                  <div key={data} className="bg-[#1a1f2e] border border-white/10 rounded-xl overflow-hidden">
                    {/* Cabeçalho do grupo de data */}
                    <div className="flex items-center justify-between px-4 py-2 border-b border-white/10 bg-white/[0.03]">
                      <span className="text-[11px] font-semibold" style={{ color: '#8b92a8' }}>
                        {fmtDataLabel(data)}
                      </span>
                    </div>
                    {/* Header colunas */}
                    <div className="grid gap-2 px-4 py-2 border-b border-white/5"
                      style={{ gridTemplateColumns: '28px 1fr 180px 160px 110px 80px 70px' }}>
                      {['','Descrição','Categoria','Conta','Valor','Status',''].map((h, i) => (
                        <span key={i} className="text-[10px] font-bold uppercase tracking-wide"
                          style={{ color: '#4a5168' }}>{h}</span>
                      ))}
                    </div>
                    {/* Linhas */}
                    {grupo.map(l => {
                      const isTransf  = l.categoria_nome?.includes('Transfer') || l.descricao?.startsWith('[Transf')
                      const isRecorr  = !!l.id_recorrencia && !isTransf
                      const isPago    = l.status === 'PAGO'
                      const podeEditar = !(isRecorr && isPago && l.nr_parcela !== undefined && l.total_parcelas !== undefined && l.nr_parcela < l.total_parcelas)
                      return (
                        <div key={l.id}
                          className="grid gap-2 px-4 py-2.5 border-b border-white/5 hover:bg-white/[0.02] transition-colors items-center"
                          style={{ gridTemplateColumns: '28px 1fr 180px 160px 110px 80px 70px' }}>

                          {/* Ícone tipo */}
                          <div className="flex items-center justify-center">
                            {isTransf ? (
                              <ArrowLeftRight size={13} style={{ color: '#818cf8' }} />
                            ) : isRecorr ? (
                              <Repeat2 size={13} style={{ color: '#f0b429' }} title="Recorrente" />
                            ) : (
                              <span className="w-1.5 h-1.5 rounded-full bg-white/20 inline-block" />
                            )}
                          </div>

                          {/* Descrição */}
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium truncate" style={{ color: '#e8eaf0' }}>
                              {isTransf
                                ? l.descricao?.replace(/^\[Transf\. (saída|entrada)\] /, '')
                                : l.descricao}
                              {l.nr_parcela && l.total_parcelas && (
                                <span className="ml-1 text-[10px]" style={{ color: '#8b92a8' }}>
                                  {l.nr_parcela}/{l.total_parcelas}
                                </span>
                              )}
                            </p>
                            {l.observacao && (
                              <p className="text-[10px] truncate mt-0.5" style={{ color: '#8b92a8' }}>{l.observacao}</p>
                            )}
                          </div>

                          {/* Categoria */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            {l.categoria_icone && (
                              <span className="text-[13px] flex-shrink-0">{l.categoria_icone}</span>
                            )}
                            <span className="text-[11px] truncate" style={{ color: '#c5cad8' }}>
                              {l.categoria_pai_nome
                                ? `${l.categoria_pai_nome} / ${l.categoria_nome}`
                                : (l.categoria_nome ?? '—')}
                            </span>
                          </div>

                          {/* Conta */}
                          <div className="flex items-center gap-1.5 min-w-0">
                            <IconeConta icone={l.conta_icone} cor={l.conta_cor} size="sm" />
                            <span className="text-[11px] truncate" style={{ color: '#c5cad8' }}>
                              {l.conta_nome ?? '—'}
                            </span>
                          </div>

                          {/* Valor */}
                          <div>
                            <p className="text-[13px] font-bold"
                              style={{ color: l.tipo === 'RECEITA' ? '#00c896' : '#f87171' }}>
                              {l.tipo === 'RECEITA' ? '+' : '-'}{formatBRL(l.valor)}
                            </p>
                            {comSaldo && l.saldo_acumulado !== undefined && (
                              <p className="text-[9px]" style={{ color: l.saldo_acumulado >= 0 ? '#00c896' : '#f87171' }}>
                                saldo: {formatBRL(l.saldo_acumulado)}
                              </p>
                            )}
                          </div>

                          {/* Status — clicável */}
                          <div className="relative">
                            <div onClick={() => setStatusOpen(statusOpen === l.id ? null : l.id)}
                              className="cursor-pointer">
                              <StatusBadge status={l.status} />
                            </div>
                            {statusOpen === l.id && (
                              <div className="absolute top-6 left-0 bg-[#252d42] border border-white/10 rounded-lg overflow-hidden z-10 shadow-xl">
                                {(['PAGO','PENDENTE','PROJECAO'] as StatusTx[]).map(s => (
                                  <button key={s} onClick={() => handleStatus(l, s)}
                                    className="flex items-center gap-2 px-3 py-2 w-full text-left hover:bg-white/5 transition-colors">
                                    {l.status === s && <Check size={10} style={{ color: '#00c896' }} />}
                                    <span className="text-[11px]" style={{ color: '#e8eaf0' }}>
                                      {s === 'PAGO' ? 'Pago' : s === 'PENDENTE' ? 'Pendente' : 'Projeção'}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Ações */}
                          <div className="flex items-center gap-1 justify-end">
                            {!isTransf && !isPago && (
                              isRecorr ? (
                                <AcaoBtn onClick={() => setAntecipando(l)}
                                  title="Antecipar parcelas" color="#f0b429">
                                  <Zap size={12} />
                                </AcaoBtn>
                              ) : (
                                <AcaoBtn onClick={() => setAntecipando(l)}
                                  title="Pagar" color="#00c896">
                                  <Check size={12} />
                                </AcaoBtn>
                              )
                            )}
                            {podeEditar && (
                              <AcaoBtn onClick={() => abrirEditar(l)} title="Editar">
                                <Pencil size={12} />
                              </AcaoBtn>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ))}
              </div>

              {/* ── Cards mobile ── */}
              <div className="md:hidden space-y-4">
                {agruparPorData(lancamentos).map(([data, grupo]) => (
                  <div key={data}>
                    <p className="text-[11px] font-semibold px-1 mb-2" style={{ color: '#8b92a8' }}>
                      {fmtDataLabel(data)}
                    </p>
                    <div className="space-y-2">
                      {grupo.map(l => {
                        const isTransf  = l.descricao?.startsWith('[Transf')
                        const isRecorr  = !!l.id_recorrencia && !isTransf
                        const isPago    = l.status === 'PAGO'
                        const podeEditar = !(isRecorr && isPago && l.nr_parcela !== undefined && l.total_parcelas !== undefined && l.nr_parcela < l.total_parcelas)
                        return (
                          <div key={l.id}
                            className="bg-[#1a1f2e] border border-white/10 rounded-xl p-3">
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                                {isTransf ? (
                                  <ArrowLeftRight size={12} style={{ color: '#818cf8', flexShrink: 0 }} />
                                ) : isRecorr ? (
                                  <Repeat2 size={12} style={{ color: '#f0b429', flexShrink: 0 }} />
                                ) : null}
                                <div className="min-w-0">
                                  <p className="text-[13px] font-semibold truncate" style={{ color: '#e8eaf0' }}>
                                    {isTransf
                                      ? l.descricao?.replace(/^\[Transf\. (saída|entrada)\] /, '')
                                      : l.descricao}
                                    {l.nr_parcela && l.total_parcelas && (
                                      <span className="ml-1 text-[10px]" style={{ color: '#8b92a8' }}>
                                        {l.nr_parcela}/{l.total_parcelas}
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-[10px] mt-0.5" style={{ color: '#8b92a8' }}>
                                    {l.categoria_nome ?? ''}
                                  </p>
                                </div>
                              </div>
                              <div className="text-right flex-shrink-0">
                                <p className="text-[14px] font-bold"
                                  style={{ color: l.tipo === 'RECEITA' ? '#00c896' : '#f87171' }}>
                                  {l.tipo === 'RECEITA' ? '+' : '-'}{formatBRL(l.valor)}
                                </p>
                                <StatusBadge status={l.status} />
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <IconeConta icone={l.conta_icone} cor={l.conta_cor} size="sm" />
                                <span className="text-[11px]" style={{ color: '#8b92a8' }}>{l.conta_nome}</span>
                              </div>
                              <div className="flex gap-1">
                                {!isTransf && !isPago && (
                                  isRecorr ? (
                                    <AcaoBtn onClick={() => setAntecipando(l)} title="Antecipar parcelas" color="#f0b429">
                                      <Zap size={11} />
                                    </AcaoBtn>
                                  ) : (
                                    <AcaoBtn onClick={() => setAntecipando(l)} title="Pagar" color="#00c896">
                                      <Check size={11} />
                                    </AcaoBtn>
                                  )
                                )}
                                {podeEditar && (
                                  <AcaoBtn onClick={() => abrirEditar(l)} title="Editar">
                                    <Pencil size={11} />
                                  </AcaoBtn>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* Drawer novo/editar */}
      <Drawer
        open={drawerOpen} onClose={fechar}
        titulo={editando ? 'Editar lançamento' : 'Novo lançamento'}
        subtitulo={editando?.descricao ?? 'Preencha os dados abaixo'}
        rodape={
          <>
            <BtnCancelar onClick={fechar} />
            <BtnSalvar editando={!!editando} salvando={salvando} onClick={salvar}
              labelSalvar="Salvar" labelEditar="Atualizar" />
          </>
        }
      >
        {/* Tipo */}
        <Field label="Tipo">
          <Segmented
            opcoes={[
              { value: 'DESPESA',       label: 'Despesa'       },
              { value: 'RECEITA',       label: 'Receita'       },
              { value: 'TRANSFERENCIA', label: 'Transferência' },
            ]}
            value={form.tipo} onChange={v => set({ tipo: v as TipoTx, categoria_id: '' })} />
        </Field>

        {/* Data */}
        <Field label="Data *">
          <Input type="date" value={form.data} onChange={e => set({ data: e.target.value })} />
        </Field>

        {/* Descrição */}
        <Field label="Descrição *">
          <div className="relative">
            <Input value={form.descricao} onChange={e => set({ descricao: e.target.value })}
              placeholder="Ex: Conta de luz, Salário..." maxLength={200} />
            <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px]"
              style={{ color: '#8b92a8' }}>{form.descricao.length}/200</span>
          </div>
        </Field>

        {/* Valor */}
        <Field label="Valor *">
          <Input type="number" step="0.01" min="0.01" value={form.valor}
            onChange={e => set({ valor: e.target.value })} placeholder="0,00" />
        </Field>

        {/* Conta origem */}
        <Field label={form.tipo === 'TRANSFERENCIA' ? 'Conta origem *' : 'Conta *'}>
          <SelectDark value={form.conta_id} onChange={e => set({ conta_id: e.target.value })}>
            <option value="">Selecione...</option>
            {contas.filter(c => c.ativa).map(c => (
              <option key={c.conta_id} value={c.conta_id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                {c.nome}
              </option>
            ))}
          </SelectDark>
        </Field>

        {/* Conta destino — só para transferência */}
        {form.tipo === 'TRANSFERENCIA' && (
          <Field label="Conta destino *">
            <SelectDark value={form.conta_destino_id} onChange={e => set({ conta_destino_id: e.target.value })}>
              <option value="">Selecione...</option>
              {contas.filter(c => c.ativa && c.conta_id !== form.conta_id).map(c => (
                <option key={c.conta_id} value={c.conta_id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                  {c.nome}
                </option>
              ))}
            </SelectDark>
          </Field>
        )}

        {/* Categoria — oculta em transferências */}
        {form.tipo !== 'TRANSFERENCIA' && <Field label="Categoria">
          <SelectDark value={form.categoria_id} onChange={e => set({ categoria_id: e.target.value })}>
            <option value="">Sem categoria</option>
            {catsPai.map(p => (
              <optgroup key={p.id} label={`${p.icone ?? ''} ${p.descricao}`}
                style={{ background: '#1a1f2e', color: '#8b92a8' }}>
                {catsSub.filter(s => s.id_pai === p.id).map(s => (
                  <option key={s.id} value={s.id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                    {s.icone ?? ''} {s.descricao}
                  </option>
                ))}
              </optgroup>
            ))}
          </SelectDark>
        </Field>}

        {/* Status */}
        <Field label="Status">
          <Segmented
            opcoes={[
              { value: 'PAGO',     label: 'Pago'     },
              { value: 'PENDENTE', label: 'Pendente' },
              { value: 'PROJECAO', label: 'Projeção' },
            ]}
            value={form.status} onChange={v => set({ status: v as StatusTx })} />
        </Field>

        {/* Recorrência */}
        {!editando ? (
          // Criação: toggle completo
          form.tipo !== 'TRANSFERENCIA' && (
            <Field label="Recorrência">
              <Toggle checked={form.recorrente} onChange={v => set({ recorrente: v })}
                label={form.recorrente ? 'Recorrente' : 'Lançamento único'} />
              {form.recorrente && (
                <div className="mt-2 flex gap-2">
                  <div className="flex-1">
                    <p className="text-[10px] mb-1" style={{ color: '#8b92a8' }}>Frequência</p>
                    <SelectDark value={form.tipo_recorrencia}
                      onChange={e => set({ tipo_recorrencia: e.target.value })}>
                      <option value="MENSAL"  style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Mensal</option>
                      <option value="SEMANAL" style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Semanal</option>
                      <option value="ANUAL"   style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Anual</option>
                      <option value="DIARIA"  style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Diária</option>
                    </SelectDark>
                  </div>
                  <div className="w-24">
                    <p className="text-[10px] mb-1" style={{ color: '#8b92a8' }}>Parcelas</p>
                    <Input type="number" min="2" max="999" value={form.total_parcelas}
                      onChange={e => set({ total_parcelas: e.target.value })} />
                  </div>
                </div>
              )}
            </Field>
          )
        ) : (
          // Edição: exibe info de recorrência somente leitura (se recorrente)
          editando.id_recorrencia && form.tipo !== 'TRANSFERENCIA' && (
            <Field label="Recorrência">
              <div className="flex items-center gap-2 bg-[#252d42] border border-white/10 rounded-lg px-3 py-2">
                <Repeat2 size={14} style={{ color: '#f0b429', flexShrink: 0 }} />
                <div>
                  <p className="text-[12px] font-semibold" style={{ color: '#e8eaf0' }}>
                    Parcela {editando.nr_parcela} de {editando.total_parcelas}
                  </p>
                  <p className="text-[10px]" style={{ color: '#8b92a8' }}>
                    {editando.tipo_recorrencia === 'MENSAL'  ? 'Recorrência mensal'  :
                     editando.tipo_recorrencia === 'SEMANAL' ? 'Recorrência semanal' :
                     editando.tipo_recorrencia === 'ANUAL'   ? 'Recorrência anual'   :
                     editando.tipo_recorrencia === 'DIARIA'  ? 'Recorrência diária'  : 'Recorrente'}
                  </p>
                </div>
              </div>
            </Field>
          )
        )}

        {/* Observação */}
        <Field label="Observação">
          <textarea
            value={form.observacao}
            onChange={e => set({ observacao: e.target.value })}
            placeholder="Observação opcional..."
            rows={2}
            className="w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2
              text-[13px] outline-none focus:border-av-green transition-colors
              placeholder:text-white/30 resize-none"
            style={{ color: '#e8eaf0' }}
          />
        </Field>

        {erro && (
          <p className="text-[12px] bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
            style={{ color: '#f87171' }}>{erro}</p>
        )}
      </Drawer>

      {/* Modal excluir */}
      {excluindo && (
        <ModalExcluir
          nome={excluindo.descricao}
          mensagem="Esta ação é permanente e não pode ser desfeita."
          onConfirmar={handleExcluir}
          onCancelar={() => setExcluindo(null)}
          salvando={salvando}
        />
      )}

      {/* Modal escopo recorrência */}
      {escopoAcao && (
        <ModalEscopo
          acao={escopoAcao.acao}
          temPagasAnteriores={escopoAcao.temPagasAnteriores}
          onConfirmar={handleEscopoConfirmado}
          onCancelar={() => setEscopoAcao(null)}
        />
      )}

      {/* Fechar dropdown de status ao clicar fora */}
      {statusOpen && (
        <div className="fixed inset-0 z-[5]" onClick={() => setStatusOpen(null)} />
      )}

      {/* Modal de antecipação */}
      {antecipando && (() => {
        const isRecorrModal = !!antecipando.id_recorrencia
        // Parcelas futuras não pagas da mesma série (nr_parcela > atual)
        const futuras = isRecorrModal
          ? lancamentos.filter(x =>
              x.id_recorrencia === antecipando.id_recorrencia &&
              x.id !== antecipando.id &&
              x.status !== 'PAGO' &&
              (x.nr_parcela ?? 0) > (antecipando.nr_parcela ?? 0)
            ).sort((a, b) => (a.nr_parcela ?? 0) - (b.nr_parcela ?? 0))
          : []
        const valorFuturas   = futuras.reduce((s, x) => s + x.valor, 0)
        const valorTotal     = antecipando.valor + valorFuturas
        const totalParcelas  = 1 + futuras.length
        const corValor       = antecipando.tipo === 'RECEITA' ? '#00c896' : '#f87171'
        const sinal          = antecipando.tipo === 'RECEITA' ? '+' : '-'

        return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={() => setAntecipando(null)} />
            <div className="relative bg-[#1a1f2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">

              {/* Título */}
              <div className="flex items-center gap-2 mb-4">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isRecorrModal ? 'bg-yellow-400/10' : 'bg-green-400/10'}`}>
                  {isRecorrModal
                    ? <Zap size={16} style={{ color: '#f0b429' }} />
                    : <Check size={16} style={{ color: '#00c896' }} />}
                </div>
                <p className="text-[14px] font-semibold" style={{ color: '#e8eaf0' }}>
                  {isRecorrModal ? 'Confirmar antecipação' : 'Confirmar pagamento'}
                </p>
              </div>

              {/* Resumo */}
              <div className="bg-[#252d42] rounded-xl p-3 mb-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Descrição</span>
                  <span className="text-[12px] font-medium" style={{ color: '#e8eaf0' }}>{antecipando.descricao}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Conta</span>
                  <span className="text-[12px]" style={{ color: '#e8eaf0' }}>{antecipando.conta_nome ?? '—'}</span>
                </div>
                {isRecorrModal ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-[11px]" style={{ color: '#8b92a8' }}>Parcela atual</span>
                      <span className="text-[12px]" style={{ color: '#e8eaf0' }}>
                        {antecipando.nr_parcela}/{antecipando.total_parcelas} — {formatBRL(antecipando.valor)}
                      </span>
                    </div>
                    {futuras.length > 0 && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[11px]" style={{ color: '#8b92a8' }}>Parcelas futuras a eliminar</span>
                          <span className="text-[12px]" style={{ color: '#f87171' }}>
                            {futuras.length}× — {formatBRL(valorFuturas)}
                          </span>
                        </div>
                        <div className="border-t border-white/5 pt-2 flex justify-between">
                          <span className="text-[11px] font-semibold" style={{ color: '#8b92a8' }}>
                            Total antecipado ({totalParcelas} parcelas)
                          </span>
                          <span className="text-[13px] font-bold" style={{ color: corValor }}>
                            {sinal}{formatBRL(valorTotal)}
                          </span>
                        </div>
                      </>
                    )}
                    {futuras.length === 0 && (
                      <div className="flex justify-between">
                        <span className="text-[11px]" style={{ color: '#8b92a8' }}>Valor</span>
                        <span className="text-[13px] font-bold" style={{ color: corValor }}>
                          {sinal}{formatBRL(antecipando.valor)}
                        </span>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex justify-between">
                    <span className="text-[11px]" style={{ color: '#8b92a8' }}>Valor</span>
                    <span className="text-[13px] font-bold" style={{ color: corValor }}>
                      {sinal}{formatBRL(antecipando.valor)}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-[11px] mb-4 text-center" style={{ color: '#8b92a8' }}>
                {isRecorrModal && futuras.length > 0
                  ? <>A parcela atual será marcada como <span style={{ color: '#00c896' }}>PAGA</span> com o valor acumulado e as {futuras.length} parcelas futuras serão removidas.</>
                  : <>O lançamento será marcado como <span style={{ color: '#00c896' }}>PAGO</span> com a data de hoje.</>
                }
              </p>

              <div className="flex gap-2">
                <button onClick={() => setAntecipando(null)}
                  className="flex-1 py-2.5 rounded-lg border border-white/10 text-[12px] font-semibold transition-all hover:border-white/20"
                  style={{ color: '#8b92a8' }}>
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    const l       = antecipando
                    const futs    = futuras
                    const vTotal  = valorTotal
                    setAntecipando(null)
                    if (isRecorrModal && futs.length > 0) {
                      // 1. Atualiza a parcela atual: marca paga com valor acumulado
                      const { ok: ok1, erro: e1 } = await editar(l.id, {
                        status: 'PAGO',
                        valor: vTotal,
                        total_parcelas: l.nr_parcela, // encerra série na parcela atual
                      }, 'SOMENTE_ESTE')
                      if (!ok1) { toast(e1 ?? 'Erro ao antecipar.'); return }
                      // 2. Exclui as futuras uma a uma (SOMENTE_ESTE)
                      for (const f of futs) {
                        await excluir(f.id, 'SOMENTE_ESTE')
                      }
                      toast(`Antecipado! ${futs.length} parcela${futs.length > 1 ? 's removidas' : ' removida'}.`)
                    } else {
                      // Avulso ou última parcela: só marca como pago
                      const { ok, erro: e } = await antecipar(l.id)
                      if (ok) toast('Pago!')
                      else toast(e ?? 'Erro ao pagar.')
                    }
                  }}
                  className={`flex-1 py-2.5 rounded-lg text-[12px] font-semibold transition-all ${isRecorrModal ? 'hover:bg-yellow-400/90' : 'hover:bg-green-500/90'}`}
                  style={{ background: isRecorrModal ? '#f0b429' : '#00c896', color: '#0a0f1a' }}>
                  {isRecorrModal
                    ? <><Zap size={12} className="inline mr-1" /> Antecipar</>
                    : <><Check size={12} className="inline mr-1" /> Pagar</>
                  }
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}
