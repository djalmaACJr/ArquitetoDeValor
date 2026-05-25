// src/pages/ImportarFaturaPage.tsx
//
// Submenu "Importação de Fatura de Cartão" — F1.
//
// Esta entrega faz o ciclo end-to-end com o parser de PDF stubado:
//   • Upload: usuário escolhe uma conta tipo CARTAO e envia o PDF.
//   • Sessão é criada em arqvalor.fatura_import_sessao com status EM_ANALISE
//     e 1 item placeholder.
//   • Listagem de sessões anteriores (com badge de status).
//   • Sandbox: rota /importar-fatura/:id mostra os itens da sessão e permite
//     escolher decisão (CRIAR | ATUALIZAR | IGNORAR) por item.
//
// O parser real de PDF entra em F2 — o edge function `faturas` (POST) hoje
// só valida o PDF e descarta os bytes.

import { useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { FileUp, Receipt, Trash2, ArrowLeft, AlertCircle, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { useContas } from '../hooks/useContas'
import { useFaturasImport, useFaturaImportSessao } from '../hooks/useFaturasImport'
import { formatBRL } from '../lib/utils'
import { Field, SelectDark, Toast, ModalExcluir } from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import type {
  FaturaImportSessao, StatusFaturaImport, DecisaoFaturaImport,
} from '../types'

// ───────────────────────────────────────────────────────────────────
// Mapas de cor/ícone por status e decisão — ficam aqui (não em shared)
// porque são específicos deste fluxo.
// ───────────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<StatusFaturaImport, string> = {
  EM_ANALISE: 'Em análise',
  CONFIRMADA: 'Confirmada',
  CANCELADA:  'Cancelada',
}
const STATUS_COR: Record<StatusFaturaImport, string> = {
  EM_ANALISE: '#f0b429',  // âmbar
  CONFIRMADA: '#00c896',  // verde
  CANCELADA:  '#8b92a8',  // cinza
}

const DECISAO_LABEL: Record<DecisaoFaturaImport, string> = {
  PENDENTE:   'Pendente',
  CRIAR:      'Criar novo',
  ATUALIZAR:  'Atualizar existente',
  IGNORAR:    'Ignorar',
}
const DECISAO_COR: Record<DecisaoFaturaImport, string> = {
  PENDENTE:   '#8b92a8',
  CRIAR:      '#00c896',
  ATUALIZAR:  '#4da6ff',
  IGNORAR:    '#8b92a8',
}
const DECISAO_ICON: Record<DecisaoFaturaImport, React.ReactNode> = {
  PENDENTE:   <Clock size={14}/>,
  CRIAR:      <CheckCircle2 size={14}/>,
  ATUALIZAR:  <AlertCircle size={14}/>,
  IGNORAR:    <XCircle size={14}/>,
}


// ───────────────────────────────────────────────────────────────────
// Tela principal: roteia entre listagem (sem :id) e sandbox (com :id)
// ───────────────────────────────────────────────────────────────────
export default function ImportarFaturaPage() {
  const { id } = useParams()
  if (id) return <Sandbox id={id} />
  return <ListagemEUpload />
}


// ───────────────────────────────────────────────────────────────────
// Listagem + Upload (rota /importar-fatura)
// ───────────────────────────────────────────────────────────────────
function ListagemEUpload() {
  const navigate = useNavigate()
  const { contas, loading: loadingContas } = useContas()
  const { sessoes, loading: loadingSessoes, importar, excluir } = useFaturasImport()

  const cartoes = contas.filter(c => c.tipo === 'CARTAO' && c.ativa)

  const [contaId,  setContaId]  = useState<string>('')
  const [arquivo,  setArquivo]  = useState<File | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [erro,     setErro]     = useState<string | null>(null)
  const [sessaoExcluir, setSessaoExcluir] = useState<FaturaImportSessao | null>(null)

  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3000) }

  const enviar = async () => {
    setErro(null)
    if (!contaId)  { setErro('Escolha um cartão.'); return }
    if (!arquivo)  { setErro('Selecione o PDF da fatura.'); return }
    setEnviando(true)
    const r = await importar({ conta_id: contaId, arquivo })
    setEnviando(false)
    if (r.ok && r.dados) {
      setArquivo(null)
      toast('Fatura recebida — abra a sandbox para revisar.')
      navigate(`/importar-fatura/${r.dados.id}`)
    } else {
      setErro(r.erro ?? 'Falha ao enviar a fatura.')
    }
  }

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

      {/* ── Bloco de upload ─────────────────────────────────────────── */}
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
                Você ainda não tem contas do tipo Cartão.
                {' '}
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
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed cursor-pointer
                hover:bg-white/5 transition-colors"
              style={{ borderColor: '#8b92a8', color: '#e8eaf0' }}
            >
              <FileUp size={16} style={{ color: '#4da6ff' }} />
              <span className="text-[15px]">
                {arquivo ? arquivo.name : 'Escolher PDF…'}
              </span>
              <input
                type="file"
                accept="application/pdf,.pdf"
                className="hidden"
                onChange={e => setArquivo(e.target.files?.[0] ?? null)}
              />
            </label>
          </Field>

          {erro && (
            <p className="text-[14px] bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2"
              style={{ color: '#f87171' }}>{erro}</p>
          )}

          <button
            onClick={enviar}
            disabled={enviando || cartoes.length === 0}
            className="w-full md:w-auto md:self-end px-4 py-2 rounded-lg bg-av-green text-[16px] font-semibold
              hover:bg-av-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ color: '#0a0f1a' }}
          >
            {enviando ? 'Enviando…' : 'Enviar fatura'}
          </button>
        </div>
      </div>

      {/* ── Histórico de sessões ────────────────────────────────────── */}
      <h2 className="text-[17px] font-semibold mb-2" style={{ color: '#e8eaf0' }}>
        Importações anteriores
      </h2>

      {loadingSessoes && (
        <div className="py-8"><LoadingMascote texto="Carregando sessões…" size={120}/></div>
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
                  style={{
                    background: `${STATUS_COR[s.status]}22`,
                    color: STATUS_COR[s.status],
                  }}>
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
                  className="flex-1 text-[14px] px-2.5 py-1.5 rounded-md border border-white/10
                    hover:border-av-green hover:text-av-green transition-colors"
                  style={{ color: '#e8eaf0' }}>
                  {s.status === 'EM_ANALISE' ? 'Revisar' : 'Ver detalhes'}
                </button>
                <button
                  onClick={() => setSessaoExcluir(s)}
                  title="Excluir sessão"
                  className="w-8 h-8 rounded-md border border-white/10 flex items-center justify-center
                    hover:bg-red-400/10 hover:border-red-400/30 transition-colors"
                  style={{ color: '#f87171' }}>
                  <Trash2 size={14}/>
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


// ───────────────────────────────────────────────────────────────────
// Sandbox de uma sessão (rota /importar-fatura/:id)
// F1: lista itens, permite escolher decisão por item, confirmar a sessão.
// F3 vai estender com matching, indicadores avançados e aplicação real.
// ───────────────────────────────────────────────────────────────────
function Sandbox({ id }: { id: string }) {
  const navigate = useNavigate()
  const { sessao, loading, error, setDecisao, confirmar } = useFaturaImportSessao(id)
  const [confirmando, setConfirmando] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const toast = (msg: string) => { setFeedback(msg); setTimeout(() => setFeedback(null), 3000) }

  if (loading) {
    return <div className="py-8"><LoadingMascote texto="Carregando sessão…" size={130}/></div>
  }
  if (error || !sessao) {
    return (
      <div className="p-5">
        <p className="text-[15px]" style={{ color: '#f87171' }}>{error ?? 'Sessão não encontrada.'}</p>
        <Link to="/importar-fatura" className="text-[15px] underline mt-2 inline-block"
          style={{ color: '#4da6ff' }}>← Voltar</Link>
      </div>
    )
  }

  const itens = sessao.itens ?? []
  const total = itens.reduce((s, i) => s + Number(i.valor), 0)
  const podeConfirmar =
    sessao.status === 'EM_ANALISE' &&
    itens.length > 0 &&
    itens.every(i => i.decisao !== 'PENDENTE')

  const handleConfirmar = async () => {
    setConfirmando(true)
    const r = await confirmar()
    setConfirmando(false)
    if (r.ok) {
      toast('Sessão confirmada.')
      setTimeout(() => navigate('/importar-fatura'), 800)
    } else {
      toast(r.erro ?? 'Falha ao confirmar.')
    }
  }

  return (
    <div className="p-5">
      <Toast msg={feedback} />

      <div className="flex items-center gap-2 mb-1">
        <Link to="/importar-fatura"
          className="flex items-center gap-1 text-[14px]"
          style={{ color: '#8b92a8' }}>
          <ArrowLeft size={14}/> Importações
        </Link>
      </div>
      <h1 className="text-[21px] font-bold flex items-center gap-2 mb-1" style={{ color: '#e8eaf0' }}>
        <Receipt size={22}/> Revisão — {sessao.conta?.nome ?? 'Cartão'}
      </h1>
      <p className="text-[14px] mb-2" style={{ color: '#8b92a8' }}>
        Arquivo: <span style={{ color: '#e8eaf0' }}>{sessao.arquivo_nome}</span> · Status:{' '}
        <span style={{ color: STATUS_COR[sessao.status] }}>{STATUS_LABEL[sessao.status]}</span>
        {sessao.vencimento_fatura && (
          <> · Vencimento: <span style={{ color: '#e8eaf0' }}>
            {new Date(sessao.vencimento_fatura + 'T00:00').toLocaleDateString('pt-BR')}
          </span></>
        )}
        {sessao.valor_total != null && (
          <> · Total: <span style={{ color: '#e8eaf0' }}>{formatBRL(Number(sessao.valor_total))}</span></>
        )}
      </p>
      {sessao.observacao && (
        <div className="text-[13px] mb-4 px-3 py-2 rounded-lg border"
          style={{
            background:  'rgba(240,180,41,0.08)',
            borderColor: 'rgba(240,180,41,0.25)',
            color:       '#f0b429',
          }}>
          <AlertCircle size={13} className="inline mr-1 -mt-0.5"/>
          {sessao.observacao}
        </div>
      )}

      {/* Tabela de itens */}
      <div className="rounded-xl border border-white/10 overflow-hidden mb-4">
        <table className="w-full text-[14px]" style={{ color: '#e8eaf0' }}>
          <thead style={{ background: '#252d42' }}>
            <tr>
              <th className="text-left px-3 py-2">Data</th>
              <th className="text-left px-3 py-2">Descrição</th>
              <th className="text-right px-3 py-2">Valor</th>
              <th className="text-center px-3 py-2">Parcela</th>
              <th className="text-center px-3 py-2">Decisão</th>
            </tr>
          </thead>
          <tbody>
            {itens.length === 0 && (
              <tr><td colSpan={5} className="text-center py-6" style={{ color: '#8b92a8' }}>
                Nenhum item.
              </td></tr>
            )}
            {itens.map(it => (
              <tr key={it.id} className="border-t border-white/5">
                <td className="px-3 py-2">{new Date(it.data_compra + 'T00:00').toLocaleDateString('pt-BR')}</td>
                <td className="px-3 py-2">
                  <p>{it.descricao}</p>
                  {it.estabelecimento && (
                    <p className="text-[12px]" style={{ color: '#8b92a8' }}>{it.estabelecimento}</p>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{formatBRL(Number(it.valor))}</td>
                <td className="px-3 py-2 text-center" style={{ color: '#8b92a8' }}>
                  {it.parcela_atual && it.parcela_total
                    ? `${it.parcela_atual}/${it.parcela_total}`
                    : '—'}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-center gap-1.5">
                    {(['CRIAR','ATUALIZAR','IGNORAR'] as DecisaoFaturaImport[]).map(d => {
                      const ativo = it.decisao === d
                      return (
                        <button key={d}
                          onClick={() => setDecisao(it.id, d)}
                          disabled={sessao.status !== 'EM_ANALISE'}
                          title={DECISAO_LABEL[d]}
                          className="flex items-center gap-1 text-[12px] px-2 py-1 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          style={{
                            background: ativo ? `${DECISAO_COR[d]}22` : 'transparent',
                            color:      ativo ? DECISAO_COR[d] : '#8b92a8',
                            borderColor: ativo ? DECISAO_COR[d] : 'rgba(255,255,255,0.1)',
                          }}
                        >
                          {DECISAO_ICON[d]}
                          {DECISAO_LABEL[d]}
                        </button>
                      )
                    })}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          {itens.length > 0 && (
            <tfoot>
              <tr className="border-t border-white/10" style={{ background: '#1a1f2e' }}>
                <td colSpan={2} className="px-3 py-2 text-right font-semibold">Total</td>
                <td className="px-3 py-2 text-right font-semibold">{formatBRL(total)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Rodapé com ações */}
      {sessao.status === 'EM_ANALISE' && (
        <div className="flex flex-wrap items-center gap-2 justify-end">
          {!podeConfirmar && itens.length > 0 && (
            <p className="text-[13px] mr-auto" style={{ color: '#f0b429' }}>
              ⚠ Defina a decisão de todos os itens para poder confirmar.
            </p>
          )}
          <button
            onClick={() => navigate('/importar-fatura')}
            className="px-3 py-2 rounded-lg border border-white/10 text-[15px] hover:border-white/30 transition-colors"
            style={{ color: '#e8eaf0' }}>
            Voltar
          </button>
          <button
            onClick={handleConfirmar}
            disabled={!podeConfirmar || confirmando}
            className="px-4 py-2 rounded-lg bg-av-green text-[15px] font-semibold
              hover:bg-av-green/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{ color: '#0a0f1a' }}>
            {confirmando ? 'Confirmando…' : 'Confirmar sessão'}
          </button>
        </div>
      )}

      {sessao.status !== 'EM_ANALISE' && (
        <p className="text-[14px] italic mt-2" style={{ color: '#8b92a8' }}>
          Sessão já {sessao.status === 'CONFIRMADA' ? 'confirmada' : 'cancelada'} — somente leitura.
        </p>
      )}
    </div>
  )
}
