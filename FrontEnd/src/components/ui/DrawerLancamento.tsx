// src/components/ui/DrawerLancamento.tsx
// Componente único de criação/edição de lançamento
// Usado em: LancamentosPage, DashboardPage, RelatoriosPage

import { useState, useEffect, useRef } from 'react'
import { Repeat2, Trash2 } from 'lucide-react'
import { useContas } from '../../hooks/useContas'
import { useCategorias } from '../../hooks/useCategorias'
import { apiMutate } from '../../lib/api'
import {
  Drawer, Field, Input, SearchableSelect, Toggle,
  BtnSalvar, BtnCancelar, Segmented, ModalExcluir,
} from './shared'
import type { Lancamento } from '../../hooks/useLancamentos'

type TipoTx   = 'RECEITA' | 'DESPESA' | 'TRANSFERENCIA'
type StatusTx = 'PAGO' | 'PENDENTE' | 'PROJECAO'
type Escopo   = 'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES'

interface FormState {
  tipo: TipoTx; data: string; descricao: string; valor: string
  conta_id: string; conta_destino_id: string; categoria_id: string
  status: StatusTx; observacao: string
  recorrente: boolean; total_parcelas: string; tipo_recorrencia: string; intervalo_recorrencia: string
}

// ── Máscara BR ─────────────────────────────────────────────────
function formatarValorBR(input: string): string {
  const nums = input.replace(/\D/g, '')
  if (!nums) return ''
  return (parseInt(nums, 10) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function parsearValorBR(v: string): number {
  return parseFloat(v.replace(/\./g, '').replace(',', '.')) || 0
}
function valorParaMascara(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// ── Form ───────────────────────────────────────────────────────
const FORM_VAZIO: FormState = {
  tipo: 'DESPESA', data: new Date().toISOString().slice(0, 10), descricao: '', valor: '',
  conta_id: '', conta_destino_id: '', categoria_id: '', status: 'PAGO', observacao: '',
  recorrente: false, total_parcelas: '2', tipo_recorrencia: 'MENSAL', intervalo_recorrencia: '1',
}

function formDeLanc(l: Lancamento): FormState {
  const isTransf = !!l.id_par_transferencia
  const descricaoLimpa = isTransf
    ? l.descricao.replace(/^\[Transf\. (saída|entrada)\] /, '').replace(/ \d+\/\d+$/, '')
    : l.descricao
  return {
    tipo: isTransf ? 'TRANSFERENCIA' : l.tipo,
    data: l.data, descricao: descricaoLimpa,
    valor: valorParaMascara(l.valor), conta_id: l.conta_id,
    conta_destino_id: '',
    categoria_id: l.categoria_id ?? '', status: l.status,
    observacao: l.observacao ?? '',
    recorrente: !!l.id_recorrencia, total_parcelas: String(l.total_parcelas ?? 2),
    tipo_recorrencia: l.tipo_recorrencia ?? 'MENSAL',
    intervalo_recorrencia: String((l as any).intervalo_recorrencia ?? 1),
  }
}

// ── Props ──────────────────────────────────────────────────────
interface DrawerLancamentoProps {
  lancamentoId?:   string | null
  lancamento?:     Lancamento | null
  novoLancamento?: boolean
  onFechar:        () => void
  onSalvo?:        () => void
  onExcluido?:     () => void
}

// ── Componente ─────────────────────────────────────────────────
export default function DrawerLancamento({
  lancamentoId, lancamento: lancamentoProp, novoLancamento,
  onFechar, onSalvo, onExcluido,
}: DrawerLancamentoProps) {
  const { contas }     = useContas()
  const { categorias } = useCategorias()

  const [editando,            setEditando]            = useState<Lancamento | null>(null)
  const [form,                setForm]                = useState<FormState>(FORM_VAZIO)
  const [erro,                setErro]                = useState<string | null>(null)
  const [salvando,            setSalvando]            = useState(false)
  const [carregando,          setCarregando]          = useState(false)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState(false)
  const [excluindo,           setExcluindo]           = useState(false)
  const [escopo,              setEscopo]              = useState<'SOMENTE_ESTE' | 'ESTE_E_SEGUINTES'>('SOMENTE_ESTE')

  const set = (p: Partial<FormState>) => setForm(f => ({ ...f, ...p }))
  const tipoRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (novoLancamento) { setEditando(null); setForm(FORM_VAZIO); setEscopo('SOMENTE_ESTE'); return }
    if (lancamentoProp) { setEditando(lancamentoProp); setForm(formDeLanc(lancamentoProp)); setEscopo('SOMENTE_ESTE'); return }
    if (lancamentoId) {
      setCarregando(true)
      fetch(`/functions/v1/transacoes/${lancamentoId}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('sb-token') ?? ''}` }
      }).then(r => r.json()).catch(() => null).finally(() => setCarregando(false))
    }
  }, [lancamentoId, lancamentoProp, novoLancamento])

  // ── Opções para SearchableSelect ───────────────────────────
  const opcoesContas = contas
    .filter(c => c.ativa)
    .map(c => ({ id: c.conta_id, label: c.nome, icone: '' }))

  const catsPai = categorias.filter(c => !c.id_pai && !c.protegida)
  const catsSub = categorias.filter(c => !!c.id_pai)
  const opcoesCategorias = [
    { id: '', label: 'Sem categoria', icone: '' },
    ...catsPai.flatMap(p => [
      { id: p.id, label: p.descricao, icone: p.icone ?? '' },
      ...catsSub.filter(s => s.id_pai === p.id).map(s => ({
        id: s.id,
        label: s.descricao,
        sublabel: p.descricao,
        icone: s.icone ?? '',
      }))
    ])
  ]

  // ── Salvar ─────────────────────────────────────────────────
  const salvar = async () => {
    if (!form.descricao.trim()) { setErro('Descrição é obrigatória.'); return }
    if (!form.valor || parsearValorBR(form.valor) <= 0) { setErro('Valor inválido.'); return }
    if (!form.conta_id) { setErro('Selecione a conta de origem.'); return }
    setSalvando(true); setErro(null)

    const valorNumerico = parsearValorBR(form.valor)

    if (form.tipo === 'TRANSFERENCIA') {
      if (!form.conta_destino_id) { setSalvando(false); setErro('Selecione a conta de destino.'); return }
      if (form.conta_id === form.conta_destino_id) { setSalvando(false); setErro('Contas devem ser diferentes.'); return }
      const payload = {
        conta_origem_id: form.conta_id, conta_destino_id: form.conta_destino_id,
        valor: valorNumerico, data: form.data, descricao: form.descricao.trim(),
        status: form.status, observacao: form.observacao || undefined,
      }
      const url = editando ? `/transferencias/${editando.id_par_transferencia ?? editando.id}` : '/transferencias'
      const res = await apiMutate(url, editando ? 'PUT' : 'POST', payload)
      setSalvando(false)
      if (res.ok) { onSalvo?.(); onFechar() } else setErro(res.erro ?? 'Erro ao salvar.')
      return
    }

    const payload: Partial<Lancamento> = {
      tipo: form.tipo as 'RECEITA' | 'DESPESA',
      data: form.data, descricao: form.descricao.trim(),
      valor: valorNumerico, conta_id: form.conta_id,
      categoria_id: form.categoria_id || undefined,
      status: form.status,
      observacao: form.observacao || undefined,
      ...(form.recorrente && !editando ? {
        total_parcelas:        parseInt(form.total_parcelas) || 2,
        tipo_recorrencia:      form.tipo_recorrencia,
        intervalo_recorrencia: parseInt(form.intervalo_recorrencia) || 1,
      } : {}),
    }

    const url    = editando ? `/transacoes/${editando.id}?escopo=${escopo}` : '/transacoes'
    const method = editando ? 'PUT' : 'POST'
    const res    = await apiMutate(url, method, payload)
    setSalvando(false)
    if (res.ok) { onSalvo?.(); onFechar() } else setErro(res.erro ?? 'Erro ao salvar.')
  }

  // ── Excluir ────────────────────────────────────────────────
  const confirmarExcluir = async () => {
    if (!editando) return
    setExcluindo(true)
    const isTransf = !!editando.id_par_transferencia
    const url = isTransf
      ? `/transferencias/${editando.id_par_transferencia}`
      : `/transacoes/${editando.id}?escopo=${escopo}`
    const res = await apiMutate(url, 'DELETE', {})
    setExcluindo(false)
    setConfirmandoExclusao(false)
    if (res.ok) { onExcluido?.(); onFechar() } else setErro(res.erro ?? 'Erro ao excluir.')
  }

  const aberto = !!(novoLancamento || lancamentoProp || lancamentoId)

  // Foco no campo Tipo ao abrir o drawer (após animação)
  useEffect(() => {
    if (aberto) {
      const timer = setTimeout(() => tipoRef.current?.focus(), 150)
      return () => clearTimeout(timer)
    }
  }, [aberto])
  if (carregando) return null

  return (
    <>
      <Drawer
        open={aberto}
        onClose={onFechar}
        titulo={editando ? 'Editar lançamento' : 'Novo lançamento'}
        subtitulo={editando?.descricao ?? 'Preencha os dados abaixo'}
        rodape={
          <>
            {editando && (
              <button
                onClick={() => setConfirmandoExclusao(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[12px] font-semibold transition-colors mr-auto"
                style={{ background: 'rgba(255,107,74,0.1)', color: '#ff6b4a', border: '1px solid rgba(255,107,74,0.3)' }}
              >
                <Trash2 size={13} /> Excluir
              </button>
            )}
            <BtnCancelar onClick={onFechar} />
            <BtnSalvar editando={!!editando} salvando={salvando} onClick={salvar}
              labelSalvar="Salvar" labelEditar="Atualizar" />
          </>
        }
      >
        {/* Tipo */}
        <Field label="Tipo">
          <div ref={tipoRef} tabIndex={-1} className="outline-none">
          <Segmented
            opcoes={[
              { value: 'DESPESA',       label: 'Despesa'       },
              { value: 'RECEITA',       label: 'Receita'       },
              { value: 'TRANSFERENCIA', label: 'Transferência' },
            ]}
            value={form.tipo} onChange={v => set({ tipo: v as TipoTx })} />
          </div>
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
          <Input
            value={form.valor}
            onChange={e => set({ valor: formatarValorBR(e.target.value) })}
            placeholder="0,00"
            inputMode="numeric"
          />
        </Field>

        {/* Conta origem */}
        <Field label={form.tipo === 'TRANSFERENCIA' ? 'Conta origem *' : 'Conta *'}>
          <SearchableSelect
            opcoes={opcoesContas}
            value={form.conta_id}
            onChange={id => set({ conta_id: id })}
            placeholder="Selecione a conta..."
          />
        </Field>

        {/* Conta destino — só transferência */}
        {form.tipo === 'TRANSFERENCIA' && (
          <Field label="Conta destino *">
            <SearchableSelect
              opcoes={opcoesContas.filter(c => c.id !== form.conta_id)}
              value={form.conta_destino_id}
              onChange={id => set({ conta_destino_id: id })}
              placeholder="Selecione a conta destino..."
            />
          </Field>
        )}

        {/* Categoria */}
        {form.tipo !== 'TRANSFERENCIA' && (
          <Field label="Categoria">
            <SearchableSelect
              opcoes={opcoesCategorias}
              value={form.categoria_id}
              onChange={id => set({ categoria_id: id })}
              placeholder="Sem categoria"
            />
          </Field>
        )}

        {/* Status */}
        <Field label="Status">
          <Segmented
            opcoes={[
              { value: 'PAGO',     label: 'Pago'     },
              { value: 'PENDENTE', label: 'Pendente' },
              ...(!editando ? [{ value: 'PROJECAO', label: 'Projeção' }] : []),
            ]}
            value={form.status} onChange={v => set({ status: v as StatusTx })} />
        </Field>

        {/* Recorrência */}
        {!editando ? (
          form.tipo !== 'TRANSFERENCIA' && (
            <Field label="Recorrência">
              <Toggle checked={form.recorrente} onChange={v => set({ recorrente: v })}
                label={form.recorrente ? 'Recorrente' : 'Lançamento único'} />
              {form.recorrente && (
                <div className="mt-2 flex gap-2">
                  <div className="w-20">
                    <p className="text-[10px] mb-1" style={{ color: '#8b92a8' }}>A cada</p>
                    <Input type="number" min="1" max="99" value={form.intervalo_recorrencia}
                      onChange={e => set({ intervalo_recorrencia: e.target.value })} />
                  </div>
                  <div className="flex-1">
                    <p className="text-[10px] mb-1" style={{ color: '#8b92a8' }}>
                      {parseInt(form.intervalo_recorrencia) > 1
                        ? ({ MENSAL: 'meses', SEMANAL: 'semanas', ANUAL: 'anos', DIARIA: 'dias' } as any)[form.tipo_recorrencia] ?? 'períodos'
                        : 'Frequência'}
                    </p>
                    <select
                      value={form.tipo_recorrencia}
                      onChange={e => set({ tipo_recorrencia: e.target.value })}
                      className="w-full bg-[#252d42] border border-white/10 rounded-lg px-3 py-2 text-[13px] outline-none focus:border-av-green transition-colors"
                      style={{ color: '#e8eaf0' }}
                    >
                      <option value="MENSAL">Mensal</option>
                      <option value="SEMANAL">Semanal</option>
                      <option value="ANUAL">Anual</option>
                      <option value="DIARIA">Diária</option>
                    </select>
                  </div>
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
          editando.id_recorrencia && form.tipo !== 'TRANSFERENCIA' && (
            <Field label="Recorrência">
              <div className="flex items-center gap-2 bg-[#252d42] border border-white/10 rounded-lg px-3 py-2 mb-2">
                <Repeat2 size={14} style={{ color: '#f0b429', flexShrink: 0 }} />
                <div>
                  <p className="text-[12px] font-semibold" style={{ color: '#e8eaf0' }}>
                    Parcela {editando.nr_parcela} de {editando.total_parcelas}
                  </p>
                  <p className="text-[10px]" style={{ color: '#8b92a8' }}>
                    {editando.tipo_recorrencia === 'PARCELA' ? 'Parcelado' :
                     editando.tipo_recorrencia === 'PROJECAO' ? 'Projeção recorrente' : 'Recorrente'}
                  </p>
                </div>
              </div>
              {editando.status !== 'PAGO' && (
                <>
                  <p className="text-[10px] mb-1.5" style={{ color: '#8b92a8' }}>Alterar</p>
                  <div className="flex flex-col gap-1">
                    {([
                      { value: 'SOMENTE_ESTE',    label: 'Somente este lançamento' },
                      { value: 'ESTE_E_SEGUINTES', label: 'Este e os próximos'      },
                    ] as const).map(op => (
                      <label
                        key={op.value}
                        className="flex items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border transition-colors"
                        style={{
                          background:  escopo === op.value ? 'rgba(0,200,150,0.08)' : 'transparent',
                          borderColor: escopo === op.value ? 'rgba(0,200,150,0.4)'  : 'rgba(255,255,255,0.08)',
                        }}
                      >
                        <input type="radio" name="escopo" value={op.value}
                          checked={escopo === op.value} onChange={() => setEscopo(op.value)}
                          className="accent-av-green" />
                        <span className="text-[12px]" style={{ color: escopo === op.value ? '#e8eaf0' : '#8b92a8' }}>
                          {op.label}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
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

      {/* Modal confirmação exclusão */}
      {confirmandoExclusao && editando && (
        <ModalExcluir
          nome={editando.descricao}
          mensagem="Esta ação é permanente e não pode ser desfeita."
          onConfirmar={confirmarExcluir}
          onCancelar={() => setConfirmandoExclusao(false)}
          salvando={excluindo}
        />
      )}
    </>
  )
}
