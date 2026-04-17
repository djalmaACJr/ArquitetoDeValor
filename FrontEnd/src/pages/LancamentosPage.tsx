// src/pages/LancamentosPage.tsx
import { useState, useMemo, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus, Pencil, Zap, ChevronDown, Check, Repeat2, ArrowLeftRight } from 'lucide-react'
import { useLancamentos, type Lancamento } from '../hooks/useLancamentos'
import { useContas } from '../hooks/useContas'
import { useCategorias } from '../hooks/useCategorias'
import { formatBRL, mesLabel } from '../lib/utils'
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
function ModalEscopo({ onConfirmar, onCancelar, acao, opcoes }: {
  onConfirmar: (escopo: 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS') => void
  onCancelar: () => void
  acao: 'editar' | 'excluir'
  opcoes: ('SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS')[]
}) {
  const labels: Record<string, string> = {
    SOMENTE_ESTE:     'Somente este lançamento',
    ESTE_E_SEGUINTES: 'Este e os seguintes',
    TODOS:            'Todos da série',
  }
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
          {opcoes.map(val => (
            <button key={val}
              onClick={() => onConfirmar(val)}
              className="w-full py-2.5 px-4 rounded-lg border text-[13px] text-left transition-all border-white/10 hover:border-av-green hover:bg-av-green/5 cursor-pointer"
              style={{ color: '#e8eaf0' }}>
              {labels[val]}
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
type TipoTx = 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA'
type StatusTx = 'PAGO' | 'PENDENTE' | 'PROJECAO'
interface FormState {
  tipo: TipoTx; data: string; descricao: string; valor: string
  conta_id: string; conta_destino_id: string; categoria_id: string
  status: StatusTx; observacao: string
  recorrente: boolean; total_parcelas: string; tipo_recorrencia: string; intervalo_recorrencia: string
}
const FORM_VAZIO: FormState = {
  tipo: 'DESPESA', data: hoje(), descricao: '', valor: '',
  conta_id: '', conta_destino_id: '', categoria_id: '', status: 'PAGO', observacao: '',
  recorrente: false, total_parcelas: '2', tipo_recorrencia: 'MENSAL', intervalo_recorrencia: '1',
}
function formDeLanc(l: Lancamento): FormState {
  // Identificação de transferência pelo campo dedicado id_par_transferencia
  const isTransf = !!l.id_par_transferencia
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
    intervalo_recorrencia: String((l as any).intervalo_recorrencia ?? 1),
  }
}

// ── Página principal ──────────────────────────────────────────
export default function LancamentosPage() {
  const location = useLocation()
  const [mes,         setMes]         = useState(mesAtual())
  const [filtContas,  setFiltContas]  = useState<string[]>([])
  const [filtCats,    setFiltCats]    = useState<string[]>([])
  const [filtStatus,  setFiltStatus]  = useState<string[]>([])
  const [comSaldo,    setComSaldo]    = useState(true)

  const { lancamentos, loading, error, carregar, criar, editar, excluir, antecipar, alterarStatus, criarTransferencia, editarTransferencia, excluirTransferencia } =
    useLancamentos({ mes, conta_ids: filtContas, categoria_ids: filtCats, status_ids: filtStatus, com_saldo: comSaldo })

  const { contas }     = useContas()
  const { categorias } = useCategorias()

  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [editando,    setEditando]    = useState<Lancamento | null>(null)
  const [excluindo,   setExcluindo]   = useState<Lancamento | null>(null)
  const [escopoAcao,  setEscopoAcao]  = useState<{ lancamento: Lancamento; acao: 'editar' | 'excluir'; opcoes: ('SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS')[] } | null>(null)
  const [feedback,    setFeedback]    = useState<string | null>(null)
  const [form,        setForm]        = useState<FormState>(FORM_VAZIO)
  const [erro,        setErro]        = useState<string | null>(null)
  const [salvando,    setSalvando]    = useState(false)

  // Status dropdown aberto
  const [statusOpen,  setStatusOpen]  = useState<string | null>(null)
  // Modal de antecipação
  const [antecipando,        setAntecipando]        = useState<Lancamento | null>(null)
  const [confirmandoProjecao, setConfirmandoProjecao] = useState<Lancamento | null>(null)
  const [valorConfirmado,     setValorConfirmado]     = useState<string>('')
  // Seleção múltipla
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
  const toggleSelecionado = (id: string) => setSelecionados(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const set   = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }))
  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3000) }

  // Ler state da navegação (vindo do Dashboard)
  useEffect(() => {
    const state = location.state as any
    if (!state) return
    if (state.novoLancamento) {
      setEditando(null); setForm(FORM_VAZIO); setErro(null); setDrawerOpen(true)
    }
    if (state.filtroStatus) {
      setFiltStatus(state.filtroStatus)
    }
    if (state.mes) {
      setMes(state.mes)
    }
    if (state.editarId && lancamentos.length > 0) {
      const tx = lancamentos.find(l => l.id === state.editarId)
      if (tx) abrirEditar(tx)
    }
    // Limpar state para não reabrir ao recarregar
    window.history.replaceState({}, '')
  }, [location.state, lancamentos])

  const abrirNovo   = () => { setEditando(null); setForm(FORM_VAZIO); setErro(null); setDrawerOpen(true) }
  const calcularOpcoesEscopo = (l: Lancamento, acao: 'editar' | 'excluir'): ('SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS')[] => {
    const opcoes: ('SOMENTE_ESTE' | 'ESTE_E_SEGUINTES' | 'TODOS')[] = []
    const nrAtual   = l.nr_parcela ?? 1
    const total     = l.total_parcelas ?? 1
    const ePrimeira = nrAtual === 1
    const isPago    = l.status === 'PAGO'

    // "Este e os seguintes" — só se houver parcelas futuras
    const temFuturas = lancamentos.some(
      x => x.id_recorrencia === l.id_recorrencia &&
           (x.nr_parcela ?? 0) > nrAtual
    ) || nrAtual < total

    // "Todos da série" — só se for a 1ª parcela E não estiver paga
    const podeTodos = ePrimeira && !isPago

    if (temFuturas) opcoes.push('ESTE_E_SEGUINTES')
    if (podeTodos)  opcoes.push('TODOS')

    // "Somente este" — sempre disponível
    opcoes.push('SOMENTE_ESTE')

    return opcoes
  }

  const abrirEditar = (l: Lancamento) => {
    const isTransf = l.descricao?.startsWith('[Transf')
    // Recorrente não-transferência: calcular opções disponíveis
    if (!isTransf && l.id_recorrencia) {
      const opcoes = calcularOpcoesEscopo(l, 'editar')
      // Se só restar "Somente este", abre direto sem modal
      if (opcoes.length === 1 && opcoes[0] === 'SOMENTE_ESTE') {
        const f = formDeLanc(l)
        setEditando(l); setForm(f); setErro(null); setDrawerOpen(true)
        return
      }
      setEscopoAcao({ lancamento: l, acao: 'editar', opcoes })
      return
    }
    const f = formDeLanc(l)
    // Para transferência de saída, conta_destino_id é a outra perna (não temos diretamente — usuário informa)
    // Para facilitar, buscamos o par pelo id_recorrencia na lista de lançamentos
    if (isTransf && l.id_par_transferencia) {
      const par = lancamentos.find(x => x.id_par_transferencia === l.id_par_transferencia && x.id !== l.id)
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
        // A API espera o id_par_transferencia (campo dedicado)
        const idPar = editando.id_par_transferencia ?? editando.id
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
        intervalo_recorrencia: parseInt(form.intervalo_recorrencia) || 1,
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
      const opcoes = calcularOpcoesEscopo(excluindo, 'excluir')
      if (opcoes.length === 1 && opcoes[0] === 'SOMENTE_ESTE') {
        // Só uma opção, excluir direto
        const { ok, erro: e } = await excluir(excluindo.id)
        setExcluindo(null)
        if (ok) { toast('Lançamento excluído.') } else { toast(e ?? 'Não foi possível excluir.') }
        return
      }
      setExcluindo(null); setEscopoAcao({ lancamento: excluindo, acao: 'excluir', opcoes }); return
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

  // Pagar em lote — só o status, sem modal
  const pagarSelecionados = async () => {
    const ids = [...selecionados]
    await Promise.all(ids.map(id => alterarStatus(id, 'PAGO')))
    setSelecionados(new Set())
    toast(`${ids.length} lançamento(s) pagos!`)
  }

  // Cancelar pgto em lote — volta para PENDENTE
  const cancelarPgtoSelecionados = async () => {
    const ids = [...selecionados]
    await Promise.all(ids.map(id => alterarStatus(id, 'PENDENTE')))
    setSelecionados(new Set())
    toast(`${ids.length} lançamento(s) revertidos para pendente!`)
  }

  // Totais do mês filtrado — exclui transferências
  const totais = useMemo(() => {
    const isTransf = (l: Lancamento) =>
      !!l.id_par_transferencia ||
      l.descricao?.startsWith('[Transf.') ||
      l.categoria_nome === 'Transferências'
    const receitas = lancamentos.filter(l => l.tipo === 'RECEITA' && !isTransf(l)).reduce((s, l) => s + l.valor, 0)
    const despesas = lancamentos.filter(l => l.tipo === 'DESPESA' && !isTransf(l)).reduce((s, l) => s + l.valor, 0)
    return { receitas, despesas, resultado: receitas - despesas }
  }, [lancamentos])

  // Saldo por data calculado no frontend — 2 modos:
  // comSaldo=false → acumula só movimentações do mês (sem saldo inicial)
  //                  dia 01: soma dos lançamentos do dia 01
  //                  dia 03: soma dia01 + dia03, etc.
  // comSaldo=true  → usa saldo_acumulado da API (inclui saldo histórico real de meses anteriores)
  const saldoPorData = useMemo(() => {
    const grupos = agruparPorData(lancamentos)
    const map = new Map<string, number>()

    if (comSaldo) {
      // Usa saldo_acumulado que vem da API — inclui saldo histórico
      for (const [data, grupo] of grupos) {
        const ultimo = grupo[grupo.length - 1]
        if (ultimo?.saldo_acumulado !== undefined) map.set(data, ultimo.saldo_acumulado)
      }
    } else {
      // Calcula acumulado só das movimentações do mês atual, sem saldo inicial
      let acumulado = 0
      for (const [data, grupo] of grupos) {
        for (const l of grupo) {
          if (l.tipo === 'RECEITA') acumulado += l.valor
          else if (l.tipo === 'DESPESA') acumulado -= l.valor
          // transferências: as duas pernas (RECEITA+DESPESA) já se anulam
        }
        map.set(data, acumulado)
      }
    }
    return map
  }, [lancamentos, comSaldo])

  // Saldo anterior ao mês — exibido só no 1º grupo quando check ativo
  // Usa saldo_acumulado do 1º lançamento menos o impacto desse lançamento
  const saldoAnterior = useMemo(() => {
    if (!comSaldo || lancamentos.length === 0) return null
    const grupos = agruparPorData(lancamentos)
    if (grupos.length === 0) return null
    const primeiro = grupos[0][1][0]
    if (primeiro?.saldo_acumulado === undefined) return null
    const delta = primeiro.tipo === 'RECEITA' ? primeiro.valor : -primeiro.valor
    return primeiro.saldo_acumulado - delta
  }, [lancamentos, comSaldo])

  // Primeira data do mês para exibir o badge de saldo anterior
  const primeiraData = useMemo(() => {
    const grupos = agruparPorData(lancamentos)
    return grupos.length > 0 ? grupos[0][0] : null
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

      {/* Filtros — tudo em uma linha */}
      <div className="flex flex-wrap gap-2 mb-4 items-center">
        {/* Mês */}
        <MonthPicker value={mes} onChange={setMes} />

        {/* Conta — multi-select */}
        <MultiSelect
          placeholder="Todas as contas"
          className="w-40"
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
          placeholder="Categorias"
          className="w-44"
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

        {/* Status — multi-select */}
        <MultiSelect
          placeholder="Todos status"
          className="w-36"
          values={filtStatus}
          onChange={setFiltStatus}
          options={[
            { value: 'PAGO',     label: 'Pago',     cor: '#00c896' },
            { value: 'PENDENTE', label: 'Pendente', cor: '#4da6ff' },
            { value: 'PROJECAO', label: 'Projeção', cor: '#f0b429' },
          ]}
        />

        {/* Toggle moderno — incluir saldo anterior */}
        <button
          onClick={() => setComSaldo(v => !v)}
          className="flex items-center gap-2 flex-shrink-0 px-3 py-1.5 rounded-lg border transition-all"
          style={{
            background: comSaldo ? 'rgba(0,200,150,0.1)' : 'transparent',
            borderColor: comSaldo ? 'rgba(0,200,150,0.4)' : 'rgba(255,255,255,0.1)',
          }}
        >
          {/* mini toggle pill */}
          <span
            className="relative flex-shrink-0"
            style={{ width: 28, height: 16 }}
          >
            <span
              className="absolute inset-0 rounded-full transition-colors"
              style={{ background: comSaldo ? '#00c896' : 'rgba(255,255,255,0.12)' }}
            />
            <span
              className="absolute top-[2px] w-3 h-3 bg-white rounded-full shadow transition-all"
              style={{ left: comSaldo ? '13px' : '2px' }}
            />
          </span>
          <span
            className="text-[11px] font-medium whitespace-nowrap transition-colors"
            style={{ color: comSaldo ? '#00c896' : '#8b92a8' }}
          >
            Saldo anterior
          </span>
        </button>
      </div>

      {/* Barra de ações em lote — sempre visível, fixa no topo quando há selecionados */}
      <div
        className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl border transition-all"
        style={{
          background: selecionados.size > 0 ? 'rgba(0,200,150,0.06)' : 'rgba(255,255,255,0.02)',
          borderColor: selecionados.size > 0 ? 'rgba(0,200,150,0.2)' : 'rgba(255,255,255,0.06)',
        }}
      >
        <span className="text-[11px] font-medium flex-1" style={{ color: '#8b92a8' }}>
          {selecionados.size > 0
            ? `${selecionados.size} selecionado(s)`
            : <span style={{ color: '#4a5168' }}>Selecione registros para ações em lote</span>
          }
        </span>
        <button
          onClick={pagarSelecionados}
          disabled={selecionados.size === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
          style={{
            background: selecionados.size > 0 ? '#00c896' : 'rgba(255,255,255,0.05)',
            color: selecionados.size > 0 ? '#0a0f1a' : '#4a5168',
            cursor: selecionados.size > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          <Check size={12} /> Pagar
        </button>
        <button
          onClick={cancelarPgtoSelecionados}
          disabled={selecionados.size === 0}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all"
          style={{
            borderColor: selecionados.size > 0 ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.06)',
            color: selecionados.size > 0 ? '#8b92a8' : '#4a5168',
            cursor: selecionados.size > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          Cancelar pgto
        </button>
        <button
          onClick={() => setSelecionados(new Set())}
          disabled={selecionados.size === 0}
          className="text-[11px] px-2 py-1 rounded-lg transition-all"
          style={{
            color: selecionados.size > 0 ? '#8b92a8' : '#4a5168',
            cursor: selecionados.size > 0 ? 'pointer' : 'not-allowed',
          }}
        >
          Limpar
        </button>
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
                    <div className="flex items-center gap-3 px-4 py-2 border-b border-white/10 bg-white/[0.03]">
                      {/* Check selecionar todos do dia */}
                      {(() => {
                        const idsGrupo = grupo.map(l => l.id)
                        const todosMarcados = idsGrupo.every(id => selecionados.has(id))
                        const algumMarcado  = idsGrupo.some(id => selecionados.has(id))
                        return (
                          <span
                            onClick={() => {
                              setSelecionados(prev => {
                                const next = new Set(prev)
                                if (todosMarcados) idsGrupo.forEach(id => next.delete(id))
                                else idsGrupo.forEach(id => next.add(id))
                                return next
                              })
                            }}
                            className="w-4 h-4 rounded flex items-center justify-center border cursor-pointer transition-all flex-shrink-0"
                            style={{
                              background: todosMarcados ? '#00c896' : algumMarcado ? 'rgba(0,200,150,0.3)' : 'transparent',
                              borderColor: todosMarcados || algumMarcado ? '#00c896' : 'rgba(255,255,255,0.2)',
                            }}
                          >
                            {todosMarcados && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#0a0f1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                            )}
                            {!todosMarcados && algumMarcado && (
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M2 5h6" stroke="#0a0f1a" strokeWidth="1.8" strokeLinecap="round"/>
                              </svg>
                            )}
                          </span>
                        )
                      })()}
                      <span className="text-[11px] font-semibold" style={{ color: '#8b92a8' }}>
                        {fmtDataLabel(data)}
                      </span>
                      {comSaldo && data === primeiraData && saldoAnterior !== null && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border"
                          style={{
                            color: saldoAnterior >= 0 ? '#00c896' : '#f87171',
                            borderColor: saldoAnterior >= 0 ? 'rgba(0,200,150,0.25)' : 'rgba(248,113,113,0.25)',
                            background: saldoAnterior >= 0 ? 'rgba(0,200,150,0.08)' : 'rgba(248,113,113,0.08)',
                          }}>
                          saldo anterior: {formatBRL(saldoAnterior)}
                        </span>
                      )}
                    </div>
                    {/* Header colunas */}
                    <div className="grid gap-2 px-4 py-2 border-b border-white/5"
                      style={{ gridTemplateColumns: '20px 28px 1fr 180px 160px 110px 80px 90px' }}>
                      {['','','Descrição','Categoria','Conta','Valor','Status',''].map((h, i) => (
                        <span key={i} className="text-[10px] font-bold uppercase tracking-wide"
                          style={{ color: '#4a5168' }}>{h}</span>
                      ))}
                    </div>
                    {/* Linhas */}
                    {grupo.map(l => {
                      const isTransf  = !!l.id_par_transferencia
                      const isRecorr  = !!l.id_recorrencia && !isTransf
                      const isPago    = l.status === 'PAGO'
                      const podeEditar = !(isRecorr && isPago && l.nr_parcela !== undefined && l.total_parcelas !== undefined && l.nr_parcela < l.total_parcelas)
                      return (
                        <div key={l.id}
                          className="grid gap-2 px-4 py-2.5 border-b border-white/5 hover:bg-white/[0.02] transition-colors items-center"
                          style={{ gridTemplateColumns: '20px 28px 1fr 180px 160px 110px 80px 90px' }}>

                          {/* Checkbox seleção */}
                          <div className="flex items-center justify-center">
                            <span
                              onClick={() => toggleSelecionado(l.id)}
                              className="w-4 h-4 rounded flex items-center justify-center border cursor-pointer transition-all flex-shrink-0"
                              style={{
                                background: selecionados.has(l.id) ? '#00c896' : 'transparent',
                                borderColor: selecionados.has(l.id) ? '#00c896' : 'rgba(255,255,255,0.2)',
                              }}
                            >
                              {selecionados.has(l.id) && (
                                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                  <path d="M1.5 5L4 7.5L8.5 2.5" stroke="#0a0f1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                              )}
                            </span>
                          </div>

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
                          <div className="text-right">
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
                            {/* Botão pagar — para qualquer não-PAGO */}
                            {!isTransf && !isPago && (() => {
                              // Antecipar só aparece se NÃO for a última parcela
                              const isUltimaParcela = isRecorr &&
                                l.nr_parcela !== undefined &&
                                l.total_parcelas !== undefined &&
                                l.nr_parcela >= l.total_parcelas
                              const deveAntecipar = isRecorr && !isUltimaParcela
                              return (
                                <AcaoBtn onClick={async (e) => {
                                  e.stopPropagation()
                                  if (deveAntecipar) {
                                    setAntecipando(l)
                                  } else {
                                    const { ok, erro: e2 } = await alterarStatus(l.id, 'PAGO')
                                    if (!ok) toast(e2 ?? 'Erro ao pagar.')
                                    else toast('Pago!')
                                  }
                                }} title={deveAntecipar ? "Antecipar parcelas" : "Pagar"} color={deveAntecipar ? "#f0b429" : "#00c896"}>
                                  {deveAntecipar ? <Zap size={12} /> : <Check size={12} />}
                                </AcaoBtn>
                              )
                            })()}
                            <AcaoBtn onClick={() => abrirEditar(l)} title="Editar">
                              <Pencil size={12} />
                            </AcaoBtn>
                          </div>
                        </div>
                      )
                    })}
                    {/* Rodapé do grupo com saldo do dia — alinhado com coluna Valor */}
                    {saldoPorData.has(data) && (
                      <div className="grid gap-2 px-4 py-2 border-t border-white/5 items-center"
                        style={{ gridTemplateColumns: '20px 28px 1fr 180px 160px 110px 80px 90px', background: 'rgba(255,255,255,0.015)' }}>
                        <span/><span/>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-right" style={{ color: '#4a5168' }}>Saldo do dia</span>
                        <span/><span/>
                        <span className="text-[12px] font-bold text-right"
                          style={{ color: (saldoPorData.get(data) ?? 0) >= 0 ? '#00c896' : '#f87171' }}>
                          {formatBRL(saldoPorData.get(data) ?? 0)}
                        </span>
                        <span/><span/>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── Cards mobile ── */}
              <div className="md:hidden space-y-4">
                {agruparPorData(lancamentos).map(([data, grupo]) => (
                  <div key={data}>
                    <div className="flex items-center gap-2 px-1 mb-2">
                      <p className="text-[11px] font-semibold" style={{ color: '#8b92a8' }}>
                        {fmtDataLabel(data)}
                      </p>
                      {comSaldo && data === primeiraData && saldoAnterior !== null && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full border"
                          style={{
                            color: saldoAnterior >= 0 ? '#00c896' : '#f87171',
                            borderColor: saldoAnterior >= 0 ? 'rgba(0,200,150,0.25)' : 'rgba(248,113,113,0.25)',
                            background: saldoAnterior >= 0 ? 'rgba(0,200,150,0.08)' : 'rgba(248,113,113,0.08)',
                          }}>
                          anterior: {formatBRL(saldoAnterior)}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2">
                      {grupo.map(l => {
                        const isTransf  = !!l.id_par_transferencia
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
                    {/* Rodapé mobile com saldo do dia */}
                    {saldoPorData.has(data) && (
                      <div className="flex items-center gap-2 px-2 pt-2 mt-1 border-t border-white/5">
                        <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: '#4a5168' }}>
                          Saldo do dia
                        </span>
                        <span className="text-[11px] font-bold"
                          style={{ color: (saldoPorData.get(data) ?? 0) >= 0 ? '#00c896' : '#f87171' }}>
                          {formatBRL(saldoPorData.get(data) ?? 0)}
                        </span>
                      </div>
                    )}
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
                  {/* A cada N */}
                  <div className="w-20">
                    <p className="text-[10px] mb-1" style={{ color: '#8b92a8' }}>A cada</p>
                    <Input type="number" min="1" max="99" value={form.intervalo_recorrencia}
                      onChange={e => set({ intervalo_recorrencia: e.target.value })} />
                  </div>
                  {/* Frequência */}
                  <div className="flex-1">
                    <p className="text-[10px] mb-1" style={{ color: '#8b92a8' }}>
                      {parseInt(form.intervalo_recorrencia) > 1
                        ? { MENSAL: 'meses', SEMANAL: 'semanas', ANUAL: 'anos', DIARIA: 'dias' }[form.tipo_recorrencia] ?? 'períodos'
                        : 'Frequência'}
                    </p>
                    <SelectDark value={form.tipo_recorrencia}
                      onChange={e => set({ tipo_recorrencia: e.target.value })}>
                      <option value="MENSAL"  style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Mensal</option>
                      <option value="SEMANAL" style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Semanal</option>
                      <option value="ANUAL"   style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Anual</option>
                      <option value="DIARIA"  style={{ background: '#1a1f2e', color: '#e8eaf0' }}>Diária</option>
                    </SelectDark>
                  </div>
                  {/* Parcelas */}
                  <div className="w-20">
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
          opcoes={escopoAcao.opcoes}
          onConfirmar={handleEscopoConfirmado}
          onCancelar={() => setEscopoAcao(null)}
        />
      )}

      {/* Fechar dropdown de status ao clicar fora */}
      {statusOpen && (
        <div className="fixed inset-0 z-[5]" onClick={() => setStatusOpen(null)} />
      )}

      {/* Modal de antecipação */}
      {/* ── Modal confirmar projeção → pago ─────────────────── */}
      {confirmandoProjecao && (() => {
        const l      = confirmandoProjecao
        const corVal = l.tipo === 'RECEITA' ? '#00c896' : '#f87171'
        const sinal  = l.tipo === 'RECEITA' ? '+' : '-'
        const vOrig  = l.valor
        const vConf  = parseFloat(valorConfirmado.replace(',', '.')) || 0
        const diff   = vConf - vOrig
        const hasDiff = Math.abs(diff) > 0.01
        return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmandoProjecao(null)} />
            <div className="relative bg-[#1a1f2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-400/10">
                  <Check size={16} style={{ color: '#00c896' }} />
                </div>
                <p className="text-[14px] font-semibold" style={{ color: '#e8eaf0' }}>Confirmar valor real</p>
              </div>

              <div className="bg-[#252d42] rounded-xl p-3 mb-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Descrição</span>
                  <span className="text-[12px] font-medium" style={{ color: '#e8eaf0' }}>{l.descricao}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Conta</span>
                  <span className="text-[12px]" style={{ color: '#e8eaf0' }}>{l.conta_nome ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Valor projetado</span>
                  <span className="text-[12px]" style={{ color: '#8b92a8' }}>{sinal}{formatBRL(vOrig)}</span>
                </div>
                <div className="flex justify-between items-center gap-3">
                  <span className="text-[11px] whitespace-nowrap" style={{ color: '#8b92a8' }}>Valor real</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[12px]" style={{ color: corVal }}>{sinal}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={valorConfirmado}
                      onChange={e => setValorConfirmado(e.target.value)}
                      className="w-32 text-right text-[13px] font-bold bg-[#1a1f2e] border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:border-white/30"
                      style={{ color: corVal }}
                      autoFocus
                    />
                  </div>
                </div>
                {hasDiff && (
                  <div className="flex justify-between border-t border-white/5 pt-2">
                    <span className="text-[11px]" style={{ color: '#8b92a8' }}>Diferença</span>
                    <span className="text-[12px]" style={{ color: diff > 0 ? '#00c896' : '#f87171' }}>
                      {diff > 0 ? '+' : ''}{formatBRL(diff)}
                    </span>
                  </div>
                )}
              </div>

              <p className="text-[11px] mb-4 text-center" style={{ color: '#8b92a8' }}>
                O valor projetado será preservado e o lançamento marcado como{' '}
                <span style={{ color: '#00c896' }}>PAGO</span>.
              </p>

              <div className="flex gap-2">
                <button onClick={() => setConfirmandoProjecao(null)}
                  className="flex-1 py-2.5 rounded-lg border border-white/10 text-[12px] font-semibold transition-all hover:border-white/20"
                  style={{ color: '#8b92a8' }}>
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    const valorReal = parseFloat(valorConfirmado.replace(',', '.'))
                    if (isNaN(valorReal) || valorReal <= 0) { toast('Valor inválido.'); return }
                    setConfirmandoProjecao(null)
                    const { ok, erro: e } = await editar(l.id, {
                      status: 'PAGO',
                      valor: valorReal,
                      valor_projetado: vOrig,  // preserva o valor original como projetado
                    }, 'SOMENTE_ESTE')
                    if (ok) toast('Lançamento confirmado como pago!')
                    else toast(e ?? 'Erro ao confirmar.')
                  }}
                  className="flex-1 py-2.5 rounded-lg text-[12px] font-semibold transition-all hover:bg-green-500/90"
                  style={{ background: '#00c896', color: '#0a0f1a' }}>
                  <Check size={12} className="inline mr-1" /> Confirmar pago
                </button>
              </div>
            </div>
          </div>
        )
      })()}

       {/* ── Modal confirmar projeção → pago ─────────────────── */}
      {confirmandoProjecao && (() => {
        const l      = confirmandoProjecao
        const corVal = l.tipo === 'RECEITA' ? '#00c896' : '#f87171'
        const sinal  = l.tipo === 'RECEITA' ? '+' : '-'
        const vOrig  = l.valor
        const vConf  = parseFloat(valorConfirmado.replace(',', '.')) || 0
        const diff   = vConf - vOrig
        const hasDiff = Math.abs(diff) > 0.01
        return (
          <div className="fixed inset-0 z-[200] flex items-center justify-center">
            <div className="absolute inset-0 bg-black/60" onClick={() => setConfirmandoProjecao(null)} />
            <div className="relative bg-[#1a1f2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-green-400/10">
                  <Check size={16} style={{ color: '#00c896' }} />
                </div>
                <p className="text-[14px] font-semibold" style={{ color: '#e8eaf0' }}>Confirmar valor real</p>
              </div>
              <div className="bg-[#252d42] rounded-xl p-3 mb-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Descrição</span>
                  <span className="text-[12px] font-medium" style={{ color: '#e8eaf0' }}>{l.descricao}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Conta</span>
                  <span className="text-[12px]" style={{ color: '#e8eaf0' }}>{l.conta_nome ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[11px]" style={{ color: '#8b92a8' }}>Valor projetado</span>
                  <span className="text-[12px]" style={{ color: '#8b92a8' }}>{sinal}{formatBRL(vOrig)}</span>
                </div>
                <div className="flex justify-between items-center gap-3">
                  <span className="text-[11px] whitespace-nowrap" style={{ color: '#8b92a8' }}>Valor real</span>
                  <div className="flex items-center gap-1">
                    <span className="text-[12px]" style={{ color: corVal }}>{sinal}</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={valorConfirmado}
                      onChange={e => setValorConfirmado(e.target.value)}
                      className="w-32 text-right text-[13px] font-bold bg-[#1a1f2e] border border-white/10 rounded-lg px-2 py-1 focus:outline-none focus:border-white/30"
                      style={{ color: corVal }}
                      autoFocus
                    />
                  </div>
                </div>
                {hasDiff && (
                  <div className="flex justify-between border-t border-white/5 pt-2">
                    <span className="text-[11px]" style={{ color: '#8b92a8' }}>Diferença</span>
                    <span className="text-[12px]" style={{ color: diff > 0 ? '#00c896' : '#f87171' }}>
                      {diff > 0 ? '+' : ''}{formatBRL(diff)}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-[11px] mb-4 text-center" style={{ color: '#8b92a8' }}>
                O valor projetado será preservado e o lançamento marcado como{' '}
                <span style={{ color: '#00c896' }}>PAGO</span>.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmandoProjecao(null)}
                  className="flex-1 py-2.5 rounded-lg border border-white/10 text-[12px] font-semibold transition-all hover:border-white/20"
                  style={{ color: '#8b92a8' }}>
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    const valorReal = parseFloat(valorConfirmado.replace(',', '.'))
                    if (isNaN(valorReal) || valorReal <= 0) { toast('Valor inválido.'); return }
                    setConfirmandoProjecao(null)
                    const { ok, erro: e } = await editar(l.id, {
                      status: 'PAGO',
                      valor: valorReal,
                      valor_projetado: vOrig,
                    }, 'SOMENTE_ESTE')
                    if (ok) toast('Lançamento confirmado como pago!')
                    else toast(e ?? 'Erro ao confirmar.')
                  }}
                  className="flex-1 py-2.5 rounded-lg text-[12px] font-semibold transition-all hover:bg-green-500/90"
                  style={{ background: '#00c896', color: '#0a0f1a' }}>
                  <Check size={12} className="inline mr-1" /> Confirmar pago
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* Barra de ações flutuante — fixa no topo quando há selecionados */}
      {selecionados.size > 0 && (
        <div
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl border shadow-xl"
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            background: '#1a1f2e',
            borderColor: 'rgba(0,200,150,0.35)',
            boxShadow: '0 4px 24px rgba(0,200,150,0.15)',
            minWidth: 360,
          }}
        >
          <span className="text-[11px] font-medium flex-1" style={{ color: '#8b92a8' }}>
            {selecionados.size} selecionado(s)
          </span>
          <button onClick={pagarSelecionados}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all hover:opacity-90"
            style={{ background: '#00c896', color: '#0a0f1a' }}>
            <Check size={12} /> Pagar
          </button>
          <button onClick={cancelarPgtoSelecionados}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-all hover:bg-white/5"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#8b92a8' }}>
            Cancelar pgto
          </button>
          <button onClick={() => setSelecionados(new Set())}
            className="text-[11px] px-2 py-1 rounded-lg hover:bg-white/5 transition-all"
            style={{ color: '#8b92a8' }}>
            ✕ Limpar
          </button>
        </div>
      )}

     {antecipando && (() => {
        const isRecorrModal  = !!antecipando.id_recorrencia && antecipando.tipo_recorrencia === 'PARCELA'
        const corValor       = antecipando.tipo === 'RECEITA' ? '#00c896' : '#f87171'
        const sinal          = antecipando.tipo === 'RECEITA' ? '+' : '-'

        // Calcula parcelas futuras pelos metadados da transação (não depende do mês carregado)
        const nrAtual        = antecipando.nr_parcela ?? 0
        const totalParc      = antecipando.total_parcelas ?? 0
        const nFuturas       = Math.max(0, totalParc - nrAtual)
        const temFuturas     = isRecorrModal && nFuturas > 0

        // Parcelas visíveis no mês atual (para exibir valor estimado se disponível)
        const futurasVisiveis = isRecorrModal
          ? lancamentos.filter(x =>
              x.id_recorrencia === antecipando.id_recorrencia &&
              x.id !== antecipando.id &&
              x.status !== 'PAGO' &&
              (x.nr_parcela ?? 0) > nrAtual
            )
          : []
        // Valor estimado: usa as visíveis * valor unitário para as demais
        const valorUnitario  = antecipando.valor
        const valorFutEst    = nFuturas * valorUnitario
        const valorTotal     = antecipando.valor + valorFutEst

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
                        {nrAtual}/{totalParc} — {formatBRL(valorUnitario)}
                      </span>
                    </div>
                    {temFuturas && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-[11px]" style={{ color: '#8b92a8' }}>Parcelas a eliminar</span>
                          <span className="text-[12px]" style={{ color: '#f87171' }}>
                            {nFuturas}× — {formatBRL(valorFutEst)}
                          </span>
                        </div>
                        <div className="border-t border-white/5 pt-2 flex justify-between">
                          <span className="text-[11px] font-semibold" style={{ color: '#8b92a8' }}>
                            Total antecipado ({nFuturas + 1} parcelas)
                          </span>
                          <span className="text-[13px] font-bold" style={{ color: corValor }}>
                            {sinal}{formatBRL(valorTotal)}
                          </span>
                        </div>
                      </>
                    )}
                    {!temFuturas && (
                      <div className="flex justify-between">
                        <span className="text-[11px]" style={{ color: '#8b92a8' }}>Valor</span>
                        <span className="text-[13px] font-bold" style={{ color: corValor }}>
                          {sinal}{formatBRL(valorUnitario)}
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
                {temFuturas
                  ? <>A parcela atual será marcada como <span style={{ color: '#00c896' }}>PAGA</span> com o valor consolidado e as {nFuturas} parcelas seguintes serão removidas.</>
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
                    const l = antecipando
                    setAntecipando(null)
                    if (isRecorrModal) {
                      // Sempre usa o endpoint do banco — consolida parcelas futuras
                      // independente de estarem ou não visíveis no mês atual
                      const { ok, erro: e } = await antecipar(l.id)
                      if (ok) toast('Antecipado! Parcelas futuras consolidadas.')
                      else toast(e ?? 'Erro ao antecipar.')
                    } else {
                      // Avulso: se for projeção, abre modal de confirmação de valor
                      if (l.status === 'PROJECAO') {
                        setValorConfirmado(String(l.valor))
                        setConfirmandoProjecao(l)
                      } else {
                        const { ok, erro: e } = await alterarStatus(l.id, 'PAGO')
                        if (ok) toast('Pago!')
                        else toast(e ?? 'Erro ao pagar.')
                      }
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
