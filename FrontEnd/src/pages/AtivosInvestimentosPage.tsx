import { useState } from 'react'
import { Plus, Pencil, Trash2, Layers, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import {
  useInvestimentosAtivos, type CriarAtivoInput, type EditarAtivoInput,
} from '../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes, type CriarPosicaoInput } from '../hooks/useInvestimentosPosicoes'
import { useContas } from '../hooks/useContas'
import {
  Drawer, Field, Input, SelectDark, BtnSalvar, BtnCancelar, Toast, ModalExcluir,
} from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import { formatBRL, formatData } from '../lib/utils'
import { TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL, TIPO_ATIVO_COR } from '../lib/constants'
import type { InvestimentoAtivo, TipoAtivoInvestimento } from '../types'

const MUTED = '#8b92a8'

const FORM_VAZIO: CriarAtivoInput = {
  ticker: '', nome: '', tipo_ativo: 'ACOES', moeda: 'BRL', descricao: '', nota_usuario: null,
}

export default function AtivosInvestimentosPage() {
  const [tipoFiltro, setTipoFiltro] = useState<TipoAtivoInvestimento | ''>('')
  const [drawer,     setDrawer]     = useState(false)
  const [editando,   setEditando]   = useState<InvestimentoAtivo | null>(null)
  const [form,       setForm]       = useState<CriarAtivoInput>(FORM_VAZIO)
  const [salvando,   setSalvando]   = useState(false)
  const [excluindo,  setExcluindo]  = useState<InvestimentoAtivo | null>(null)
  const [toast,      setToast]      = useState<string | null>(null)
  const [posicoesDe, setPosicoesDe] = useState<InvestimentoAtivo | null>(null)

  const filtros = tipoFiltro ? { tipo: tipoFiltro } : {}
  const { ativos, loading, error, criar, editar, excluir } = useInvestimentosAtivos(filtros)

  function showToast(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3000) }

  function abrirNovo() { setEditando(null); setForm(FORM_VAZIO); setDrawer(true) }
  function abrirEditar(a: InvestimentoAtivo) {
    setEditando(a)
    setForm({
      ticker: a.ticker, nome: a.nome, tipo_ativo: a.tipo_ativo, moeda: a.moeda,
      descricao: a.descricao ?? '', nota_usuario: a.nota_usuario,
    })
    setDrawer(true)
  }

  async function salvar() {
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
              {ativos.map((a) => (
                <tr key={a.id} className="border-t border-white/5">
                  <td className="px-4 py-2.5 font-semibold text-white">{a.ticker}</td>
                  <td className="px-4 py-2.5 text-white/80">{a.nome}</td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 text-[12px] px-2 py-0.5 rounded-full"
                      style={{ background: `${TIPO_ATIVO_COR[a.tipo_ativo]}22`, color: TIPO_ATIVO_COR[a.tipo_ativo] }}>
                      {TIPO_ATIVO_LABEL[a.tipo_ativo]}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-center text-white/80">{a.nota_usuario ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setPosicoesDe(a)} title="Posições"
                        className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
                        <Layers size={13} />
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
            </tbody>
          </table>
        </div>
      )}

      {/* Drawer criar/editar ativo */}
      <Drawer open={drawer} onClose={() => setDrawer(false)}
        titulo={editando ? 'Editar ativo' : 'Novo ativo'}
        subtitulo={editando ? editando.ticker : 'Cadastre um ativo da sua carteira'}
        rodape={<><BtnCancelar onClick={() => setDrawer(false)} /><BtnSalvar editando={!!editando} onClick={salvar} salvando={salvando} /></>}>
        <Field label="Ticker">
          <Input value={form.ticker} onChange={(e) => setForm({ ...form, ticker: e.target.value })} placeholder="Ex.: VALE3" maxLength={20} />
        </Field>
        <Field label="Nome">
          <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Ex.: Vale S.A." maxLength={120} />
        </Field>
        <Field label="Tipo de ativo">
          <SelectDark value={form.tipo_ativo} onChange={(e) => setForm({ ...form, tipo_ativo: e.target.value as TipoAtivoInvestimento })}>
            {TIPOS_ATIVO_INV.map((t) => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
          </SelectDark>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Moeda">
            <Input value={form.moeda} onChange={(e) => setForm({ ...form, moeda: e.target.value.toUpperCase() })} maxLength={3} placeholder="BRL" />
          </Field>
          <Field label="Nota (0–10)">
            <Input type="number" min={0} max={10} step={0.5}
              value={form.nota_usuario ?? ''}
              onChange={(e) => setForm({ ...form, nota_usuario: e.target.value === '' ? null : Number(e.target.value) })}
              placeholder="—" />
          </Field>
        </div>
        <Field label="Descrição">
          <Input value={form.descricao ?? ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Opcional" />
        </Field>
      </Drawer>

      {/* Drawer posições */}
      {posicoesDe && (
        <DrawerPosicoes ativo={posicoesDe} onClose={() => setPosicoesDe(null)} onToast={showToast} />
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
            {contas.map((c) => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
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
