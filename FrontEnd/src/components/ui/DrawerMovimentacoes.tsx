import { useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, X } from 'lucide-react'
import { Drawer, Field, Input, SelectDark } from './shared'
import { useInvestimentosPosicoes } from '../../hooks/useInvestimentosPosicoes'
import { useInvestimentosOperacoes, type CriarOperacaoInput } from '../../hooks/useInvestimentosOperacoes'
import { useBackfillHistorico } from '../../hooks/useInvestimentosHistorico'
import { useContas } from '../../hooks/useContas'
import { formatBRL, formatData } from '../../lib/utils'
import { TIPO_OPERACAO_LABEL, tiposOperacaoPara, tipoEntradaPara } from '../../lib/constants'
import type { InvestimentoAtivo, InvestimentoOperacao, TipoOperacaoInvestimento } from '../../types'

const MUTED = '#8b92a8'
const hoje = () => new Date().toISOString().split('T')[0]

// Tela única de movimentações de um ativo. Registrar uma movimentação
// (Compra/Venda/Aporte/Resgate) mantém a posição automaticamente no backend
// (posição = soma das operações). O saldo atual é exibido no topo, só leitura.
export default function DrawerMovimentacoes({ ativo, onClose, onToast }: {
  ativo: InvestimentoAtivo; onClose: () => void; onToast: (m: string) => void
}) {
  const { posicoes } = useInvestimentosPosicoes({ ativo_id: ativo.id })
  const { operacoes, loading, criar, editar, excluir } = useInvestimentosOperacoes()
  const { contas } = useContas()
  const { preencher } = useBackfillHistorico()
  // Movimentações aplicáveis ao tipo do ativo (bolsa → Compra/Venda; RF/Tesouro → Aplicação/Resgate).
  const tiposDisp = tiposOperacaoPara(ativo.tipo_ativo)
  const vazio = () => ({
    conta_id: '', tipo_operacao: tipoEntradaPara(ativo.tipo_ativo),
    quantidade: '', preco_unitario: '', data_operacao: hoje(),
  })
  const [form, setForm] = useState(vazio)
  const [editId, setEditId] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  // Opções de conta: contas de investimento ativas + contas onde o ativo já tem posição.
  const contasOpcoes = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of contas) if (c.tipo === 'INVESTIMENTO' && c.ativa) m.set(c.conta_id, c.nome)
    for (const p of posicoes) if (p.conta_id && !m.has(p.conta_id)) m.set(p.conta_id, p.contas?.nome ?? '—')
    return [...m.entries()]
  }, [contas, posicoes])

  const nomeConta = (contaId: string) =>
    contasOpcoes.find(([id]) => id === contaId)?.[1] ?? posicoes.find((p) => p.conta_id === contaId)?.contas?.nome ?? '—'

  // Saldo atual por conta (posições ATIVA com quantidade).
  const saldos = useMemo(
    () => posicoes.filter((p) => p.status === 'ATIVA' && Number(p.quantidade) > 0),
    [posicoes],
  )

  // Movimentações deste ativo (operações de qualquer posição do ativo).
  const posIds = useMemo(() => new Set(posicoes.map((p) => p.id)), [posicoes])
  const movimentos = useMemo(
    () => operacoes.filter((o) => posIds.has(o.posicao_id)),
    [operacoes, posIds],
  )

  function cancelarEdicao() { setEditId(null); setForm(vazio()) }

  function iniciarEdicao(o: InvestimentoOperacao) {
    setEditId(o.id)
    setForm({
      conta_id: o.conta_id,
      tipo_operacao: o.tipo_operacao,
      quantidade: String(o.quantidade),
      preco_unitario: String(o.preco_unitario),
      data_operacao: o.data_operacao,
    })
  }

  async function salvar() {
    if (!form.conta_id) { onToast('Selecione a conta'); return }
    const qtd = Number(form.quantidade), preco = Number(form.preco_unitario)
    if (!(qtd > 0)) { onToast('Quantidade inválida'); return }
    if (!(preco >= 0)) { onToast('Preço inválido'); return }
    setSalvando(true)
    const payload: CriarOperacaoInput = {
      ativo_id: ativo.id,
      conta_id: form.conta_id,
      tipo_operacao: form.tipo_operacao,
      quantidade: qtd,
      preco_unitario: preco,
      valor_total: qtd * preco,
      data_operacao: form.data_operacao,
    }
    const res = editId ? await editar(editId, payload) : await criar(payload)
    setSalvando(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao salvar movimentação'); return }
    onToast(editId ? 'Movimentação atualizada!' : 'Movimentação registrada!')
    cancelarEdicao()
    // Renda fixa: reconstrói o histórico de cotação a partir da posição atual.
    preencher({ ativo_id: ativo.id }).then((bf) => {
      if (bf.ok && (bf.dados?.meses_gravados ?? 0) > 0) onToast(`Histórico reconstruído: ${bf.dados!.meses_gravados} mês(es).`)
    })
  }

  async function remover(id: string) {
    const res = await excluir(id)
    if (editId === id) cancelarEdicao()
    if (res.ok) preencher({ ativo_id: ativo.id })
    onToast(res.ok ? 'Movimentação removida.' : (res.erro ?? 'Erro ao remover'))
  }

  return (
    <Drawer open onClose={onClose} titulo={`Movimentações · ${ativo.ticker}`} subtitulo={ativo.nome}>
      {/* Saldo atual (derivado das operações) */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[12px] mb-2" style={{ color: MUTED }}>Saldo atual</p>
        {saldos.length === 0 ? (
          <p className="text-[13px]" style={{ color: MUTED }}>Sem posição ativa — registre uma compra abaixo.</p>
        ) : (
          <div className="space-y-1.5">
            {saldos.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
                <span className="text-white font-medium">{p.contas?.nome ?? nomeConta(p.conta_id)}</span>
                <span style={{ color: MUTED }}>
                  {p.quantidade} un. · PM {formatBRL(p.preco_custo)} · <span className="text-white">{formatBRL(p.valor_custo)}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Form registrar / editar movimentação */}
      <div className="rounded-lg border border-white/10 p-3 space-y-3">
        {editId && (
          <div className="flex items-center justify-between text-[12px]" style={{ color: '#f0b429' }}>
            <span>Editando movimentação</span>
            <button onClick={cancelarEdicao} className="flex items-center gap-1 hover:text-white">
              <X size={12} /> Cancelar
            </button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tipo">
            <SelectDark value={form.tipo_operacao}
              onChange={(e) => setForm({ ...form, tipo_operacao: e.target.value as TipoOperacaoInvestimento })}>
              {tiposDisp.map((t) => (
                <option key={t} value={t}>{TIPO_OPERACAO_LABEL[t]}</option>
              ))}
            </SelectDark>
          </Field>
          <Field label="Conta">
            <SelectDark value={form.conta_id} disabled={!!editId}
              onChange={(e) => setForm({ ...form, conta_id: e.target.value })}>
              <option value="">Selecione...</option>
              {contasOpcoes.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
            </SelectDark>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantidade">
            <Input type="number" min={0} step="any" value={form.quantidade}
              onChange={(e) => setForm({ ...form, quantidade: e.target.value })} placeholder="0" />
          </Field>
          <Field label="Preço unitário">
            <Input type="number" min={0} step="any" value={form.preco_unitario}
              onChange={(e) => setForm({ ...form, preco_unitario: e.target.value })} placeholder="0,00" />
          </Field>
        </div>
        <Field label="Data">
          <Input type="date" value={form.data_operacao}
            onChange={(e) => setForm({ ...form, data_operacao: e.target.value })} />
        </Field>
        <div className="flex items-center justify-between text-[12px]" style={{ color: MUTED }}>
          <span>Valor total</span>
          <span className="text-white font-medium">
            {formatBRL((Number(form.quantidade) || 0) * (Number(form.preco_unitario) || 0))}
          </span>
        </div>
        <button onClick={salvar} disabled={salvando}
          className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: '#3b82f6' }}>
          <Plus size={14} /> {editId ? 'Salvar alterações' : 'Registrar movimentação'}
        </button>
      </div>

      {/* Histórico de movimentações */}
      {loading ? (
        <p className="text-[13px]" style={{ color: MUTED }}>Carregando...</p>
      ) : movimentos.length === 0 ? (
        <p className="text-[13px] text-center py-4" style={{ color: MUTED }}>Nenhuma movimentação registrada.</p>
      ) : (
        <div className="space-y-2">
          {movimentos.map((o) => (
            <div key={o.id} className={`rounded-lg border p-3 flex items-center justify-between gap-2 ${editId === o.id ? 'border-blue-400/50' : 'border-white/10'}`}>
              <div>
                <p className="text-white text-[14px] font-medium">
                  {TIPO_OPERACAO_LABEL[o.tipo_operacao]} · {nomeConta(o.conta_id)}
                </p>
                <p className="text-[12px]" style={{ color: MUTED }}>
                  {o.quantidade} × {formatBRL(o.preco_unitario)} = {formatBRL(o.valor_total)} · {formatData(o.data_operacao)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button onClick={() => iniciarEdicao(o)} title="Editar"
                  className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-white/25" style={{ color: MUTED }}>
                  <Pencil size={13} />
                </button>
                <button onClick={() => remover(o.id)} title="Excluir"
                  className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center hover:border-red-400/40" style={{ color: '#ff5c7a' }}>
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Drawer>
  )
}
