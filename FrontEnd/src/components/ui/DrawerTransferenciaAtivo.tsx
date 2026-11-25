import { useMemo, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { Drawer, Field, Input, SelectDark } from './shared'
import DrawerAtivo from './DrawerAtivo'
import { useInvestimentosAtivos } from '../../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes } from '../../hooks/useInvestimentosPosicoes'
import { useTransferenciaAtivo } from '../../hooks/useTransferenciaAtivo'
import { useContas } from '../../hooks/useContas'
import { formatMoeda } from '../../lib/utils'
import type { InvestimentoAtivo } from '../../types'

const MUTED = '#8b92a8'
const NOVO = '__novo__'
const hoje = () => new Date().toISOString().split('T')[0]
const TIPOS_NAO_TRANSFERIVEIS = ['RENDA_FIXA', 'TESOURO_DIRETO']

// Transfere a posição de um ativo para outro CARREGANDO O CUSTO (sem ganho/
// perda): liquidação de fundo com entrega de cotas de outro (ex.: RBRR11 →
// PCIP11), incorporação, troca de ticker. O destino precisa já estar
// cadastrado — se ainda não for, dá para cadastrá-lo ali mesmo (opção "Cadastrar novo
// ativo…" no seletor de destino). Cria um par VENDA+COMPRA ligado.
export default function DrawerTransferenciaAtivo({ ativo, onClose, onToast }: {
  ativo: InvestimentoAtivo; onClose: () => void; onToast: (m: string) => void
}) {
  const { ativos } = useInvestimentosAtivos()
  const { posicoes } = useInvestimentosPosicoes({ ativo_id: ativo.id })
  const { posicoes: posicoesAtivas } = useInvestimentosPosicoes({ status: 'ATIVA' })
  const { criar } = useTransferenciaAtivo()
  const { contas } = useContas()

  const saldos = useMemo(
    () => posicoes.filter((p) => p.status === 'ATIVA' && Number(p.quantidade) > 0),
    [posicoes],
  )
  const [contaId, setContaId] = useState('')
  const [destinoId, setDestinoId] = useState('')
  const [contaDestinoId, setContaDestinoId] = useState('')
  const [qtdSaida, setQtdSaida] = useState('')
  const [qtdEntrada, setQtdEntrada] = useState('')
  const [custoTotal, setCustoTotal] = useState('')
  const [data, setData] = useState(hoje())
  const [salvando, setSalvando] = useState(false)
  const [cadastrando, setCadastrando] = useState(false)

  const posicao = saldos.find((p) => p.conta_id === (contaId || saldos[0]?.conta_id))
  const contaEfetiva = posicao?.conta_id ?? ''
  // Conta de destino: só contas ATIVAS do MESMO TIPO da conta de origem; padrão = a própria origem.
  const tipoContaOrigem = contas.find((c) => c.conta_id === contaEfetiva)?.tipo
  const contasDestino = useMemo(
    () => contas.filter((c) => c.ativa && c.tipo === tipoContaOrigem),
    [contas, tipoContaOrigem],
  )
  const contaDestinoEfetiva = contasDestino.some((c) => c.conta_id === contaDestinoId) ? contaDestinoId : contaEfetiva
  // Destinos: ativos do MESMO tipo e moeda que têm posição ATIVA (quantidade > 0) na conta de destino
  // — mais os cadastrados agora pelo "Cadastrar novo ativo…" (ainda sem posição, que a transferência cria).
  const [criadosAgora, setCriadosAgora] = useState<string[]>([])
  const destinos = useMemo(() => {
    const comPosicao = new Set(
      posicoesAtivas
        .filter((p) => p.conta_id === contaDestinoEfetiva && Number(p.quantidade) > 0)
        .map((p) => p.ativo_id),
    )
    return ativos.filter((a) =>
      a.id !== ativo.id && a.tipo_ativo === ativo.tipo_ativo && a.moeda === ativo.moeda &&
      !TIPOS_NAO_TRANSFERIVEIS.includes(a.tipo_ativo) && (comPosicao.has(a.id) || criadosAgora.includes(a.id)))
  }, [ativos, ativo, posicoesAtivas, contaDestinoEfetiva, criadosAgora])
  const destinoValido = destinos.some((a) => a.id === destinoId) ? destinoId : ''
  const qtdSaidaNum = qtdSaida ? Number(qtdSaida.replace(',', '.')) : Number(posicao?.quantidade ?? 0)
  const custoPadrao = posicao ? Math.round(qtdSaidaNum * Number(posicao.preco_custo) * 100) / 100 : 0
  const fmt = (v: number) => formatMoeda(v, ativo.moeda)

  async function confirmar() {
    const entrada = Number(qtdEntrada.replace(',', '.'))
    if (!posicao) { onToast('Sem posição ativa para transferir.'); return }
    if (!destinoValido) { onToast('Escolha o ativo de destino.'); return }
    if (!(entrada > 0)) { onToast('Informe a quantidade recebida.'); return }
    setSalvando(true)
    const res = await criar({
      ativo_origem_id: ativo.id, conta_origem_id: contaEfetiva, ativo_destino_id: destinoValido,
      conta_destino_id: contaDestinoEfetiva || undefined,
      quantidade_saida: qtdSaida ? qtdSaidaNum : undefined,
      quantidade_entrada: entrada,
      custo_total: custoTotal ? Number(custoTotal.replace(',', '.')) : undefined,
      data_operacao: data,
    })
    setSalvando(false)
    if (!res.ok) { onToast(res.erro ?? 'Erro ao transferir'); return }
    onToast('Posição transferida!')
    onClose()
  }

  return (
    <Drawer open onClose={onClose} titulo={`Transferir · ${ativo.ticker}`} subtitulo="Migra a posição para outro ativo, carregando o custo"
      rodape={
        <button onClick={confirmar} disabled={salvando || !posicao}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-[14px] font-semibold text-white disabled:opacity-50"
          style={{ background: '#3b82f6' }}>
          <ArrowRightLeft size={15} /> {salvando ? 'Transferindo…' : 'Transferir posição'}
        </button>
      }>
      <p className="text-[12px] rounded-lg border border-blue-400/30 bg-blue-400/[0.06] px-3 py-2" style={{ color: '#93c5fd' }}>
        Use quando um ativo deixa de existir e você recebe cotas de outro (liquidação, incorporação, troca de ticker).
        O custo da posição é transferido para o destino — não gera ganho nem perda. Proventos e histórico do ativo de origem permanecem nele.
      </p>

      {saldos.length === 0 ? (
        <p className="text-[13px] mt-3" style={{ color: MUTED }}>Este ativo não tem posição ativa para transferir.</p>
      ) : (
        <div className="space-y-4 mt-3">
          {saldos.length > 1 && (
            <Field label="Conta de origem">
              <SelectDark value={contaEfetiva} onChange={(e) => setContaId(e.target.value)}>
                {saldos.map((p) => <option key={p.id} value={p.conta_id}>{p.contas?.nome ?? '—'} · {p.quantidade} un.</option>)}
              </SelectDark>
            </Field>
          )}
          <p className="text-[13px]" style={{ color: MUTED }}>
            Posição: <span className="text-white">{posicao?.quantidade} un.</span> · PM {fmt(Number(posicao?.preco_custo ?? 0))}
          </p>

          <Field label="Ativo de destino">
            <SelectDark value={destinoValido} onChange={(e) => { if (e.target.value === NOVO) setCadastrando(true); else setDestinoId(e.target.value) }}>
              <option value="">Selecione…</option>
              {destinos.map((a) => <option key={a.id} value={a.id}>{a.ticker} — {a.nome}</option>)}
              <option value={NOVO}>➕ Cadastrar novo ativo…</option>
            </SelectDark>
            {destinos.length === 0 && (
              <p className="text-[12px] mt-1" style={{ color: MUTED }}>Nenhum ativo do mesmo tipo e moeda com posição ativa nesta conta — use “Cadastrar novo ativo…” para criar o destino aqui mesmo.</p>
            )}
          </Field>

          {contasDestino.length > 1 && (
            <Field label="Conta de destino">
              <SelectDark value={contaDestinoEfetiva} onChange={(e) => setContaDestinoId(e.target.value)}>
                {contasDestino.map((c) => <option key={c.conta_id} value={c.conta_id}>{c.nome}{c.conta_id === contaEfetiva ? ' (mesma da origem)' : ''}</option>)}
              </SelectDark>
              <p className="text-[12px] mt-1" style={{ color: MUTED }}>Só contas do mesmo tipo da conta de origem.</p>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Quantidade que sai">
              <Input inputMode="decimal" placeholder={String(posicao?.quantidade ?? '')} value={qtdSaida} onChange={(e) => setQtdSaida(e.target.value)} />
            </Field>
            <Field label="Quantidade recebida">
              <Input inputMode="decimal" value={qtdEntrada} onChange={(e) => setQtdEntrada(e.target.value)} />
            </Field>
          </div>

          <Field label="Custo transferido (opcional)">
            <Input inputMode="decimal" placeholder={String(custoPadrao)} value={custoTotal} onChange={(e) => setCustoTotal(e.target.value)} />
            <p className="text-[12px] mt-1" style={{ color: MUTED }}>
              Padrão: {fmt(custoPadrao)} (quantidade × preço médio). Reduza se parte da liquidação foi paga em dinheiro.
            </p>
          </Field>

          <Field label="Data">
            <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
          </Field>
        </div>
      )}
      {cadastrando && (
        <DrawerAtivo ativo={null} tipoInicial={ativo.tipo_ativo} onClose={() => setCadastrando(false)} onToast={onToast}
          onCriado={(novo) => {
            if (novo.tipo_ativo !== ativo.tipo_ativo) { onToast('O destino precisa ser do mesmo tipo do ativo de origem — o novo ativo foi criado, mas não pode ser usado nesta transferência.'); return }
            if (novo.moeda !== ativo.moeda) { onToast(`O novo ativo está em ${novo.moeda}, mas a posição de origem é em ${ativo.moeda} — a transferência exige a mesma moeda.`); return }
            setCriadosAgora((l) => [...l, novo.id])
            setDestinoId(novo.id)
          }} />
      )}
    </Drawer>
  )
}
