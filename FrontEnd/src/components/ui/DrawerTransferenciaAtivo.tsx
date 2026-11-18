import { useMemo, useState } from 'react'
import { ArrowRightLeft } from 'lucide-react'
import { Drawer, Field, Input, SelectDark } from './shared'
import { useInvestimentosAtivos } from '../../hooks/useInvestimentosAtivos'
import { useInvestimentosPosicoes } from '../../hooks/useInvestimentosPosicoes'
import { useTransferenciaAtivo } from '../../hooks/useTransferenciaAtivo'
import { formatMoeda } from '../../lib/utils'
import type { InvestimentoAtivo } from '../../types'

const MUTED = '#8b92a8'
const hoje = () => new Date().toISOString().split('T')[0]
const TIPOS_NAO_TRANSFERIVEIS = ['RENDA_FIXA', 'TESOURO_DIRETO']

// Transfere a posição de um ativo para outro CARREGANDO O CUSTO (sem ganho/
// perda): liquidação de fundo com entrega de cotas de outro (ex.: RBRR11 →
// PCIP11), incorporação, troca de ticker. O destino precisa já estar
// cadastrado (cadastre-o em Ativos antes). Cria um par VENDA+COMPRA ligado.
export default function DrawerTransferenciaAtivo({ ativo, onClose, onToast }: {
  ativo: InvestimentoAtivo; onClose: () => void; onToast: (m: string) => void
}) {
  const { ativos } = useInvestimentosAtivos()
  const { posicoes } = useInvestimentosPosicoes({ ativo_id: ativo.id })
  const { criar } = useTransferenciaAtivo()

  const saldos = useMemo(
    () => posicoes.filter((p) => p.status === 'ATIVA' && Number(p.quantidade) > 0),
    [posicoes],
  )
  const destinos = useMemo(
    () => ativos.filter((a) => a.id !== ativo.id && a.moeda === ativo.moeda && !TIPOS_NAO_TRANSFERIVEIS.includes(a.tipo_ativo)),
    [ativos, ativo],
  )

  const [contaId, setContaId] = useState('')
  const [destinoId, setDestinoId] = useState('')
  const [qtdSaida, setQtdSaida] = useState('')
  const [qtdEntrada, setQtdEntrada] = useState('')
  const [custoTotal, setCustoTotal] = useState('')
  const [data, setData] = useState(hoje())
  const [salvando, setSalvando] = useState(false)

  const posicao = saldos.find((p) => p.conta_id === (contaId || saldos[0]?.conta_id))
  const contaEfetiva = posicao?.conta_id ?? ''
  const qtdSaidaNum = qtdSaida ? Number(qtdSaida.replace(',', '.')) : Number(posicao?.quantidade ?? 0)
  const custoPadrao = posicao ? Math.round(qtdSaidaNum * Number(posicao.preco_custo) * 100) / 100 : 0
  const fmt = (v: number) => formatMoeda(v, ativo.moeda)

  async function confirmar() {
    const entrada = Number(qtdEntrada.replace(',', '.'))
    if (!posicao) { onToast('Sem posição ativa para transferir.'); return }
    if (!destinoId) { onToast('Escolha o ativo de destino.'); return }
    if (!(entrada > 0)) { onToast('Informe a quantidade recebida.'); return }
    setSalvando(true)
    const res = await criar({
      ativo_origem_id: ativo.id, conta_origem_id: contaEfetiva, ativo_destino_id: destinoId,
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
            <SelectDark value={destinoId} onChange={(e) => setDestinoId(e.target.value)}>
              <option value="">Selecione…</option>
              {destinos.map((a) => <option key={a.id} value={a.id}>{a.ticker} — {a.nome}</option>)}
            </SelectDark>
            {destinos.length === 0 && (
              <p className="text-[12px] mt-1" style={{ color: MUTED }}>Nenhum ativo de destino na mesma moeda — cadastre o novo ativo primeiro.</p>
            )}
          </Field>

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
    </Drawer>
  )
}
