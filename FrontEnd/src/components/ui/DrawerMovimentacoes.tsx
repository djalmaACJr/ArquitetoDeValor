import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, X, CircleSlash } from 'lucide-react'
import { Drawer, Field, Input, SelectDark } from './shared'
import { useInvestimentosPosicoes } from '../../hooks/useInvestimentosPosicoes'
import { useInvestimentosOperacoes, type CriarOperacaoInput } from '../../hooks/useInvestimentosOperacoes'
import { useBackfillHistorico } from '../../hooks/useInvestimentosHistorico'
import { useContas } from '../../hooks/useContas'
import { formatMoeda, formatData } from '../../lib/utils'
import { TIPO_OPERACAO_LABEL, tiposOperacaoPara, tipoEntradaPara, tipoSaidaPara } from '../../lib/constants'
import type { InvestimentoAtivo, InvestimentoOperacao, InvestimentoPosicao, TipoOperacaoInvestimento } from '../../types'

const MUTED = '#8b92a8'
const hoje = () => new Date().toISOString().split('T')[0]

// Tela única de movimentações de um ativo. Registrar uma movimentação
// (Compra/Venda/Aporte/Resgate) mantém a posição automaticamente no backend
// (posição = soma das operações). O saldo atual é exibido no topo, só leitura.
export default function DrawerMovimentacoes({ ativo, onClose, onToast, onRegistrarNova }: {
  ativo: InvestimentoAtivo; onClose: () => void; onToast: (m: string) => void
  // Presente só quando o drawer foi aberto pelo atalho "Nova movimentação" do
  // header (não pela ação "Posições" de uma linha): ao registrar uma
  // movimentação nova (não edição), pergunta se o usuário quer lançar outra
  // — "sim" reinicia a tela (volta pro seletor de ativo); "não" fecha.
  onRegistrarNova?: () => void
}) {
  const { posicoes } = useInvestimentosPosicoes({ ativo_id: ativo.id })
  const { operacoes, loading, criar, editar, excluir } = useInvestimentosOperacoes({ ativo_id: ativo.id })
  const { contas } = useContas()
  const { preencher } = useBackfillHistorico()
  // Movimentações aplicáveis ao tipo do ativo (bolsa → Compra/Venda; RF/Tesouro → Aplicação/Resgate).
  const tiposDisp = tiposOperacaoPara(ativo.tipo_ativo)
  // Renda fixa privada (CDB/LCI/LCA/CRI/CRA/Debênture) não tem preço unitário
  // real — é sempre um valor aplicado (convenção: quantidade = valor, preço = 1).
  // Tesouro Direto fica de fora: tem título com PU marcado a mercado de verdade.
  const rfSemQtde = ativo.tipo_ativo === 'RENDA_FIXA'
  const vazio = () => ({
    conta_id: '', tipo_operacao: tipoEntradaPara(ativo.tipo_ativo),
    quantidade: '', preco_unitario: '', data_operacao: hoje(),
  })
  const [form, setForm] = useState(vazio)
  const [editId, setEditId] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)
  // Lote separado: só faz sentido pra RF/Tesouro, numa compra/aporte novo
  // (não em edição) quando a conta escolhida já tem posição ATIVA — permite
  // registrar a mesma "posição = soma das operações" de sempre OU, se
  // marcado, forçar uma posição nova (ex.: mesmo título comprado depois a
  // uma taxa diferente da 1ª compra).
  const ehRFouTesouro = ativo.tipo_ativo === 'RENDA_FIXA' || ativo.tipo_ativo === 'TESOURO_DIRETO'
  const [novoLote, setNovoLote] = useState(false)
  const [rfTaxaLote, setRfTaxaLote] = useState('')
  // RF sem PU real: no resgate, "valor resgatado" (reduz a posição, nominal)
  // e "valor recebido" (dinheiro de fato, pode incluir juros acumulados) são
  // números diferentes — mesma separação já usada no encerramento de posição.
  const [valorRecebido, setValorRecebido] = useState('')
  const opSaida = rfSemQtde && form.tipo_operacao === tipoSaidaPara(ativo.tipo_ativo)
  // Encerramento de posição: zera o saldo via uma saída (venda/resgate) total.
  const [encerrar, setEncerrar] = useState<InvestimentoPosicao | null>(null)
  const [encData, setEncData] = useState(hoje())
  const [encValor, setEncValor] = useState('')
  // Pergunta pós-registro (só no atalho "Nova movimentação" — ver onRegistrarNova).
  const [perguntarNova, setPerguntarNova] = useState(false)
  const ehSaida = TIPO_OPERACAO_LABEL[tipoSaidaPara(ativo.tipo_ativo)].toLowerCase()
  // Posições/operações ficam na moeda do ativo → exibe com o símbolo certo (US$/R$).
  const fmt = (v: number) => formatMoeda(v, ativo.moeda)

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

  // Ativo que já tem posição: pré-seleciona a conta atual (poupa o clique
  // mais comum — mais uma movimentação de um ativo que já está na carteira).
  // Só age com o campo vazio — não sobrescreve escolha do usuário nem mexe
  // numa edição em andamento. Reaplica sozinho após "cancelarEdicao()" (ex.:
  // logo depois de salvar), então a conta some só se o usuário limpar/trocar.
  useEffect(() => {
    if (!editId && !form.conta_id && saldos.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm((f) => ({ ...f, conta_id: saldos[0].conta_id }))
    }
  }, [editId, form.conta_id, saldos])

  function cancelarEdicao() {
    setEditId(null); setForm(vazio()); setValorRecebido(''); setNovoLote(false); setRfTaxaLote('')
  }

  // Toggle "novo lote" só aparece numa entrada (compra/aporte) nova quando a
  // conta escolhida já tem posição ATIVA — senão essa própria seria o 1º lote.
  const mostrarNovoLote = ehRFouTesouro && !editId &&
    form.tipo_operacao === tipoEntradaPara(ativo.tipo_ativo) &&
    saldos.some((p) => p.conta_id === form.conta_id)

  function iniciarEdicao(o: InvestimentoOperacao) {
    setEditId(o.id)
    const ehSaidaOp = rfSemQtde && o.tipo_operacao === tipoSaidaPara(ativo.tipo_ativo)
    setForm({
      conta_id: o.conta_id,
      tipo_operacao: o.tipo_operacao,
      // Aporte RF sem PU real: usa o valor_total (nominal) — não a quantidade
      // bruta, que pode vir de um lançamento antigo com unidades arbitrárias.
      // Resgate: quantidade já é o valor nominal retirado da posição (é o que
      // o backend usa para abater o saldo) — mantém como está.
      quantidade: String(rfSemQtde && !ehSaidaOp ? o.valor_total : o.quantidade),
      preco_unitario: String(o.preco_unitario),
      data_operacao: o.data_operacao,
    })
    // Resgate RF: valor_total é o dinheiro de fato recebido (pode diferir do
    // nominal por juros acumulados) — só mostra o campo quando fizer diferença.
    setValorRecebido(ehSaidaOp && Number(o.valor_total) !== Number(o.quantidade) ? String(o.valor_total) : '')
  }

  async function salvar() {
    if (!form.conta_id) { onToast('Selecione a conta'); return }
    const qtd = Number(form.quantidade)
    if (!(qtd > 0)) {
      onToast(rfSemQtde ? (opSaida ? 'Valor resgatado inválido' : 'Valor aplicado inválido') : 'Quantidade inválida')
      return
    }
    let preco: number
    if (rfSemQtde) {
      if (opSaida) {
        const recebidoStr = valorRecebido.trim()
        const recebido = recebidoStr !== '' ? Number(recebidoStr) : qtd
        if (!(recebido >= 0)) { onToast('Valor recebido inválido'); return }
        preco = recebido / qtd
      } else {
        preco = 1
      }
    } else {
      preco = Number(form.preco_unitario)
      if (!(preco >= 0)) { onToast('Preço inválido'); return }
    }
    const eraEdicao = !!editId
    setSalvando(true)
    const payload: CriarOperacaoInput = {
      ativo_id: ativo.id,
      conta_id: form.conta_id,
      tipo_operacao: form.tipo_operacao,
      quantidade: qtd,
      preco_unitario: preco,
      valor_total: qtd * preco,
      data_operacao: form.data_operacao,
      ...(mostrarNovoLote && novoLote
        ? { novo_lote: true, ...(rfTaxaLote.trim() ? { rf_taxa: rfTaxaLote.trim() } : {}) }
        : {}),
    }
    const res = eraEdicao ? await editar(editId!, payload) : await criar(payload)
    setSalvando(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao salvar movimentação'); return }
    onToast(eraEdicao ? 'Movimentação atualizada!' : 'Movimentação registrada!')
    cancelarEdicao()
    // Renda fixa: reconstrói o histórico de cotação a partir da posição atual.
    preencher({ ativo_id: ativo.id }).then((bf) => {
      if (bf.ok && (bf.dados?.meses_gravados ?? 0) > 0) onToast(`Histórico reconstruído: ${bf.dados!.meses_gravados} mês(es).`)
    })
    if (!eraEdicao && onRegistrarNova) setPerguntarNova(true)
  }

  function abrirEncerramento(p: InvestimentoPosicao) {
    setEncerrar(p); setEncData(hoje()); setEncValor('')
  }

  // Encerra a posição: registra uma saída total (venda/resgate) na data informada.
  // O valor recebido é opcional — sem ele, usa o valor de custo. Como a posição é a
  // soma das operações, abater a quantidade total a leva a ENCERRADA.
  async function confirmarEncerramento() {
    if (!encerrar) return
    const qtd = Number(encerrar.quantidade)
    if (!(qtd > 0)) { onToast('Posição sem saldo a encerrar'); return }
    const usaValor = encValor.trim() !== '' && Number(encValor) >= 0
    const total = usaValor ? Number(encValor) : qtd * Number(encerrar.preco_custo)
    setSalvando(true)
    const res = await criar({
      ativo_id: ativo.id,
      conta_id: encerrar.conta_id,
      tipo_operacao: tipoSaidaPara(ativo.tipo_ativo),
      quantidade: qtd,
      preco_unitario: qtd > 0 ? total / qtd : 0,
      valor_total: total,
      data_operacao: encData,
    })
    setSalvando(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao encerrar posição'); return }
    onToast('Posição encerrada!')
    setEncerrar(null)
    preencher({ ativo_id: ativo.id })
  }

  async function remover(id: string) {
    const res = await excluir(id)
    if (editId === id) cancelarEdicao()
    if (res.ok) preencher({ ativo_id: ativo.id })
    onToast(res.ok ? 'Movimentação removida.' : (res.erro ?? 'Erro ao remover'))
  }

  return (
    <>
    <Drawer open onClose={onClose} titulo={`Movimentações · ${ativo.ticker}`} subtitulo={ativo.nome}>
      {/* Saldo atual (derivado das operações) */}
      <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
        <p className="text-[12px] mb-2" style={{ color: MUTED }}>Saldo atual</p>
        {saldos.length === 0 ? (
          <p className="text-[13px]" style={{ color: MUTED }}>Sem posição ativa — registre uma compra abaixo.</p>
        ) : (
          <div className="space-y-1.5">
            {saldos.map((p) => (
              <div key={p.id} className="space-y-2">
                <div className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="text-white font-medium">
                    {p.contas?.nome ?? nomeConta(p.conta_id)}
                    {/* Rótulo do lote: só aparece quando o ativo tem mais de 1 posição
                        ATIVA na mesma conta (lotes com taxa diferente) — evita ruído
                        no caso comum de posição única. */}
                    {p.rf_taxa && saldos.filter((s) => s.conta_id === p.conta_id).length > 1 && (
                      <span className="ml-1.5 text-[11px] font-normal" style={{ color: MUTED }}>· {p.rf_taxa}</span>
                    )}
                  </span>
                  <div className="flex items-center gap-2">
                    <span style={{ color: MUTED }}>
                      {rfSemQtde
                        ? <>Valor aplicado · <span className="text-white">{fmt(p.valor_custo)}</span></>
                        : <>{p.quantidade} un. · PM {fmt(p.preco_custo)} · <span className="text-white">{fmt(p.valor_custo)}</span></>}
                      {p.rentabilidade_pct != null && (
                        <span className="ml-1.5 font-semibold" style={{ color: p.rentabilidade_pct >= 0 ? '#22c55e' : '#ff5c7a' }}>
                          ({p.rentabilidade_pct >= 0 ? '+' : ''}{p.rentabilidade_pct.toFixed(2)}%)
                        </span>
                      )}
                    </span>
                    <button onClick={() => abrirEncerramento(p)} title="Encerrar posição"
                      className="flex items-center gap-1 text-[12px] px-2 py-0.5 rounded-md border border-white/10 hover:border-red-400/40"
                      style={{ color: '#ff5c7a' }}>
                      <CircleSlash size={12} /> Encerrar
                    </button>
                  </div>
                </div>
                {encerrar?.id === p.id && (
                  <div className="rounded-lg border border-red-400/30 bg-red-400/[0.04] p-3 space-y-3">
                    <p className="text-[12px]" style={{ color: MUTED }}>
                      Encerra a posição registrando um(a) <span className="text-white">{ehSaida}</span> de{' '}
                      <span className="text-white">{rfSemQtde ? fmt(p.valor_custo) : `${p.quantidade} un.`}</span> na data informada.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Data do encerramento">
                        <Input type="date" value={encData} onChange={(e) => setEncData(e.target.value)} />
                      </Field>
                      <Field label="Valor recebido (opcional)">
                        <Input type="number" min={0} step="any" value={encValor}
                          onChange={(e) => setEncValor(e.target.value)} placeholder={fmt(p.valor_custo)} />
                      </Field>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={confirmarEncerramento} disabled={salvando}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[14px] font-semibold text-white disabled:opacity-50"
                        style={{ background: '#ef4444' }}>
                        <CircleSlash size={14} /> Encerrar posição
                      </button>
                      <button onClick={() => setEncerrar(null)}
                        className="px-3 py-2 rounded-lg text-[13px] border border-white/10 hover:border-white/25" style={{ color: MUTED }}>
                        Cancelar
                      </button>
                    </div>
                  </div>
                )}
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
        {mostrarNovoLote && (
          <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
            <label className="flex items-center gap-2 text-[12px] cursor-pointer" style={{ color: MUTED }}>
              <input type="checkbox" checked={novoLote}
                onChange={(e) => { setNovoLote(e.target.checked); if (e.target.checked && !rfTaxaLote) setRfTaxaLote(ativo.rf_taxa ?? '') }} />
              Registrar como novo lote (taxa diferente da posição existente)
            </label>
            {novoLote && (
              <Field label="Taxa deste lote (opcional)">
                <Input value={rfTaxaLote} onChange={(e) => setRfTaxaLote(e.target.value)}
                  placeholder="Ex.: IPCA+ 8,00% a.a." maxLength={60} />
              </Field>
            )}
          </div>
        )}
        {rfSemQtde ? opSaida ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valor resgatado">
              <Input type="number" min={0} step="any" value={form.quantidade}
                onChange={(e) => setForm({ ...form, quantidade: e.target.value })} placeholder="0,00" />
            </Field>
            <Field label="Valor recebido (opcional)">
              <Input type="number" min={0} step="any" value={valorRecebido}
                onChange={(e) => setValorRecebido(e.target.value)} placeholder={form.quantidade || '0,00'} />
            </Field>
          </div>
        ) : (
          <Field label="Valor aplicado">
            <Input type="number" min={0} step="any" value={form.quantidade}
              onChange={(e) => setForm({ ...form, quantidade: e.target.value })} placeholder="0,00" />
          </Field>
        ) : (
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
        )}
        <Field label="Data">
          <Input type="date" value={form.data_operacao}
            onChange={(e) => setForm({ ...form, data_operacao: e.target.value })} />
        </Field>
        {!rfSemQtde && (
          <div className="flex items-center justify-between text-[12px]" style={{ color: MUTED }}>
            <span>Valor total</span>
            <span className="text-white font-medium">
              {fmt((Number(form.quantidade) || 0) * (Number(form.preco_unitario) || 0))}
            </span>
          </div>
        )}
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
          {movimentos.map((o) => {
            const programado = o.data_operacao > hoje()
            return (
            <div key={o.id} className={`rounded-lg border p-3 flex items-center justify-between gap-2 ${editId === o.id ? 'border-blue-400/50' : programado ? 'border-amber-400/25' : 'border-white/10'}`}>
              <div>
                <p className="text-white text-[14px] font-medium flex items-center gap-1.5">
                  {TIPO_OPERACAO_LABEL[o.tipo_operacao]} · {nomeConta(o.conta_id)}
                  {programado && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: '#f0b429', background: 'rgba(240,180,41,0.12)' }}>
                      PROGRAMADO
                    </span>
                  )}
                </p>
                <p className="text-[12px]" style={{ color: MUTED }}>
                  {rfSemQtde
                    ? programado
                      ? `${fmt(o.valor_total)} · vencimento ${formatData(o.data_operacao)}`
                      : `${fmt(o.valor_total)} · ${formatData(o.data_operacao)}`
                    : programado
                      ? `${o.quantidade} un. · vencimento ${formatData(o.data_operacao)}`
                      : `${o.quantidade} × ${fmt(o.preco_unitario)} = ${fmt(o.valor_total)} · ${formatData(o.data_operacao)}`}
                </p>
              </div>
              {!programado && (
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
              )}
            </div>
            )
          })}
        </div>
      )}
    </Drawer>

    {/* Pós-registro (só no atalho "Nova movimentação"): oferece lançar outra
        movimentação sem fechar o fluxo, ou encerrar por aqui mesmo. */}
    {perguntarNova && (
      <div role="dialog" aria-modal="true" aria-label="Nova movimentação?"
        className="fixed inset-0 z-[200] flex items-center justify-center">
        <div className="absolute inset-0 bg-black/60" onClick={onClose} />
        <div className="relative bg-[#1a1f2e] border border-white/10 rounded-2xl shadow-xl w-full max-w-sm mx-4 p-5">
          <p className="text-[18px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>Movimentação registrada!</p>
          <p className="text-[16px] mb-5" style={{ color: MUTED }}>Deseja registrar uma nova movimentação?</p>
          <div className="flex gap-2 justify-end">
            <button onClick={onClose}
              className="px-4 py-2 text-[16px] border border-white/10 rounded-lg transition-all hover:border-white/20"
              style={{ color: MUTED }}>
              Não, fechar
            </button>
            <button onClick={() => { setPerguntarNova(false); onRegistrarNova?.() }}
              className="px-4 py-2 text-[16px] font-semibold text-white rounded-lg transition-colors"
              style={{ background: '#3b82f6' }}>
              Sim, nova movimentação
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}
