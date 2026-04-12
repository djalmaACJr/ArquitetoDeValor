// src/pages/LancamentosPage.tsx
import { useState, useMemo } from 'react'
import { Plus, Pencil, Zap, ChevronDown, Check, X as XIcon } from 'lucide-react'
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

// ── Helpers de data ───────────────────────────────────────────
function mesAtual() {
  return new Date().toISOString().slice(0, 7)
}
function mesLabel(ym: string) {
  const [y, m] = ym.split('-')
  return new Date(Number(y), Number(m) - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
}
function mesesOpcoes() {
  const opts = []
  const hoje = new Date()
  for (let i = -3; i <= 6; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1)
    const ym = d.toISOString().slice(0, 7)
    opts.push({ value: ym, label: mesLabel(ym) })
  }
  return opts
}
function fmtData(iso: string) {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
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
function ModalEscopo({ onConfirmar, onCancelar, acao }: {
  onConfirmar: (escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS') => void
  onCancelar: () => void
  acao: 'editar' | 'excluir'
}) {
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
          {([
            ['SOMENTE_ESTE',       'Somente este lançamento'],
            ['ESTE_E_SEGUINTES',   'Este e os seguintes'],
            ['TODOS',              'Todos da série'],
          ] as const).map(([val, label]) => (
            <button key={val} onClick={() => onConfirmar(val)}
              className="w-full py-2.5 px-4 rounded-lg border border-white/10 text-[13px] text-left
                transition-all hover:border-av-green hover:bg-av-green/5"
              style={{ color: '#e8eaf0' }}>
              {label}
            </button>
          ))}
        </div>
        <button onClick={onCancelar} className="mt-3 text-[11px] w-full text-center"
          style={{ color: '#8b92a8' }}>Cancelar</button>
      </div>
    </div>
  )
}

// ── Formulário de lançamento ──────────────────────────────────
type TipoTx = 'RECEITA' | 'DESPESA'
type StatusTx = 'PAGO' | 'PENDENTE' | 'PROJECAO'
interface FormState {
  tipo: TipoTx; data: string; descricao: string; valor: string
  conta_id: string; categoria_id: string; status: StatusTx; observacao: string
  recorrente: boolean; total_parcelas: string; tipo_recorrencia: string
}
const FORM_VAZIO: FormState = {
  tipo: 'DESPESA', data: hoje(), descricao: '', valor: '',
  conta_id: '', categoria_id: '', status: 'PAGO', observacao: '',
  recorrente: false, total_parcelas: '2', tipo_recorrencia: 'MENSAL',
}
function formDeLanc(l: Lancamento): FormState {
  return {
    tipo: l.tipo, data: l.data, descricao: l.descricao,
    valor: String(l.valor), conta_id: l.conta_id,
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

  const { lancamentos, loading, error, carregar, criar, editar, excluir, antecipar, alterarStatus } =
    useLancamentos({ mes, conta_ids: filtContas, categoria_ids: filtCats, status: filtStatus, com_saldo: comSaldo })

  const { contas }     = useContas()
  const { categorias } = useCategorias()

  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editando,    setEditando]    = useState<Lancamento | null>(null)
  const [excluindo,   setExcluindo]   = useState<Lancamento | null>(null)
  const [escopoAcao,  setEscopoAcao]  = useState<{ lancamento: Lancamento; acao: 'editar' | 'excluir' } | null>(null)
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
    if (l.id_recorrencia) { setEscopoAcao({ lancamento: l, acao: 'editar' }); return }
    setEditando(l); setForm(formDeLanc(l)); setErro(null); setDrawerOpen(true)
  }
  const fechar = () => { setDrawerOpen(false); setEditando(null); setErro(null) }

  const salvar = async () => {
    if (!form.descricao.trim()) { setErro('Descrição é obrigatória.'); return }
    if (!form.valor || isNaN(parseFloat(form.valor))) { setErro('Valor inválido.'); return }
    if (!form.conta_id) { setErro('Selecione a conta.'); return }
    setSalvando(true); setErro(null)

    const payload: Partial<Lancamento> = {
      tipo: form.tipo, data: form.data, descricao: form.descricao.trim(),
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
      setExcluindo(null); setEscopoAcao({ lancamento: excluindo, acao: 'excluir' }); return
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

  // Categorias pai para o select (exclui protegidas)
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
        <SelectDark value={mes} onChange={e => setMes(e.target.value)} className="w-44">
          {mesesOpcoes().map(o => (
            <option key={o.value} value={o.value} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
              {o.label}
            </option>
          ))}
        </SelectDark>

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
              <div className="hidden md:block">
                <div className="bg-[#1a1f2e] border border-white/10 rounded-xl overflow-hidden">
                  {/* Header */}
                  <div className="grid gap-2 px-4 py-2.5 border-b border-white/10"
                    style={{ gridTemplateColumns: '80px 1fr 1fr 1fr 90px auto 110px' }}>
                    {['Data','Descrição','Categoria','Conta','Valor','Status',''].map(h => (
                      <span key={h} className="text-[10px] font-bold uppercase tracking-wide"
                        style={{ color: '#8b92a8' }}>{h}</span>
                    ))}
                  </div>
                  {/* Linhas */}
                  {lancamentos.map(l => {
                    const isTransf = l.categoria_nome?.includes('Transfer') || l.descricao?.startsWith('[Transf')
                    return (
                      <div key={l.id}
                        className="grid gap-2 px-4 py-2.5 border-b border-white/5 hover:bg-white/[0.02] transition-colors items-center"
                        style={{ gridTemplateColumns: '80px 1fr 1fr 1fr 90px auto 110px' }}>

                        {/* Data */}
                        <span className="text-[12px]" style={{ color: '#8b92a8' }}>{fmtData(l.data)}</span>

                        {/* Descrição */}
                        <div className="min-w-0">
                          <p className="text-[12px] font-medium truncate" style={{ color: '#e8eaf0' }}>
                            {l.descricao}
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
                          {l.valor_projetado && (
                            <p className="text-[9px]" style={{ color: '#f0b429' }}>
                              proj: {formatBRL(l.valor_projetado)}
                            </p>
                          )}
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
                          {!isTransf && l.status !== 'PAGO' && (
                            <AcaoBtn onClick={() => setAntecipando(l)}
                              title="Antecipar — ver detalhes e confirmar" color="#f0b429">
                              <Zap size={12} />
                            </AcaoBtn>
                          )}
                          {!isTransf && (
                            <AcaoBtn onClick={() => abrirEditar(l)} title="Editar">
                              <Pencil size={12} />
                            </AcaoBtn>
                          )}
                          <div className="w-1" />
                          {!isTransf && (
                            <AcaoBtn onClick={() => setExcluindo(l)} title="Excluir" color="#f87171">
                              <XIcon size={12} />
                            </AcaoBtn>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* ── Cards mobile ── */}
              <div className="md:hidden space-y-2">
                {lancamentos.map(l => {
                  const isTransf = l.descricao?.startsWith('[Transf')
                  return (
                    <div key={l.id}
                      className="bg-[#1a1f2e] border border-white/10 rounded-xl p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-semibold truncate" style={{ color: '#e8eaf0' }}>
                            {l.descricao}
                            {l.nr_parcela && l.total_parcelas && (
                              <span className="ml-1 text-[10px]" style={{ color: '#8b92a8' }}>
                                {l.nr_parcela}/{l.total_parcelas}
                              </span>
                            )}
                          </p>
                          <p className="text-[10px] mt-0.5" style={{ color: '#8b92a8' }}>
                            {fmtData(l.data)}
                            {l.categoria_nome ? ` · ${l.categoria_nome}` : ''}
                          </p>
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
                        {!isTransf && (
                          <div className="flex gap-1">
                            {l.status !== 'PAGO' && (
                              <AcaoBtn onClick={() => setAntecipando(l)}
                                title="Antecipar" color="#f0b429">
                                <Zap size={11} />
                              </AcaoBtn>
                            )}
                            <AcaoBtn onClick={() => abrirEditar(l)} title="Editar">
                              <Pencil size={11} />
                            </AcaoBtn>
                            <AcaoBtn onClick={() => setExcluindo(l)} title="Excluir" color="#f87171">
                              <XIcon size={11} />
                            </AcaoBtn>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
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
            opcoes={[{ value: 'DESPESA', label: 'Despesa' }, { value: 'RECEITA', label: 'Receita' }]}
            value={form.tipo} onChange={v => set({ tipo: v as TipoTx })} />
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

        {/* Conta */}
        <Field label="Conta *">
          <SelectDark value={form.conta_id} onChange={e => set({ conta_id: e.target.value })}>
            <option value="">Selecione...</option>
            {contas.filter(c => c.ativa).map(c => (
              <option key={c.conta_id} value={c.conta_id} style={{ background: '#1a1f2e', color: '#e8eaf0' }}>
                {c.nome}
              </option>
            ))}
          </SelectDark>
        </Field>

        {/* Categoria */}
        <Field label="Categoria">
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
        </Field>

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

        {/* Recorrência — só na criação */}
        {!editando && (
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
          onConfirmar={handleEscopoConfirmado}
          onCancelar={() => setEscopoAcao(null)}
        />
      )}

      {/* Fechar dropdown de status ao clicar fora */}
      {statusOpen && (
        <div className="fixed inset-0 z-[5]" onClick={() => setStatusOpen(null)} />
      )}

      {/* Modal de antecipação */}
      {antecipando && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/60" onClick={() => setAntecipando(null)} />
          <div className="relative bg-[#1a1f2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-lg bg-yellow-400/10 flex items-center justify-center">
                <Zap size={16} style={{ color: '#f0b429' }} />
              </div>
              <p className="text-[14px] font-semibold" style={{ color: '#e8eaf0' }}>Confirmar antecipação</p>
            </div>

            {/* Dados do lançamento */}
            <div className="bg-[#252d42] rounded-xl p-3 mb-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-[11px]" style={{ color: '#8b92a8' }}>Descrição</span>
                <span className="text-[12px] font-medium" style={{ color: '#e8eaf0' }}>{antecipando.descricao}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px]" style={{ color: '#8b92a8' }}>Data</span>
                <span className="text-[12px]" style={{ color: '#e8eaf0' }}>{fmtData(antecipando.data)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[11px]" style={{ color: '#8b92a8' }}>Valor</span>
                <span className="text-[13px] font-bold"
                  style={{ color: antecipando.tipo === 'RECEITA' ? '#00c896' : '#f87171' }}>
                  {antecipando.tipo === 'RECEITA' ? '+' : '-'}{formatBRL(antecipando.valor)}
                </span>
              </div>
              {antecipando.valor_projetado && (
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Valor projetado original</span>
                  <span className="text-[12px]" style={{ color: '#f0b429' }}>{formatBRL(antecipando.valor_projetado)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-[11px]" style={{ color: '#8b92a8' }}>Status atual</span>
                <StatusBadge status={antecipando.status} />
              </div>
              {antecipando.conta_nome && (
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Conta</span>
                  <span className="text-[12px]" style={{ color: '#e8eaf0' }}>{antecipando.conta_nome}</span>
                </div>
              )}
              {antecipando.nr_parcela && antecipando.total_parcelas && (
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Parcela</span>
                  <span className="text-[12px]" style={{ color: '#e8eaf0' }}>{antecipando.nr_parcela}/{antecipando.total_parcelas}</span>
                </div>
              )}
            </div>

            <p className="text-[11px] mb-4 text-center" style={{ color: '#8b92a8' }}>
              O lançamento será marcado como <span style={{ color: '#00c896' }}>PAGO</span> com a data de hoje.
            </p>

            <div className="flex gap-2">
              <button onClick={() => setAntecipando(null)}
                className="flex-1 py-2.5 rounded-lg border border-white/10 text-[12px] font-semibold transition-all hover:border-white/20"
                style={{ color: '#8b92a8' }}>
                Cancelar
              </button>
              <button
                onClick={async () => {
                  const l = antecipando
                  setAntecipando(null)
                  const { ok, erro: e } = await antecipar(l.id)
                  if (ok) toast('Lançamento antecipado!')
                  else toast(e ?? 'Erro ao antecipar.')
                }}
                className="flex-1 py-2.5 rounded-lg text-[12px] font-semibold transition-all hover:bg-yellow-400/90"
                style={{ background: '#f0b429', color: '#0a0f1a' }}>
                <Zap size={12} className="inline mr-1" /> Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
