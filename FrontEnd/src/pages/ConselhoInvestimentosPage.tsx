// src/pages/ConselhoInvestimentosPage.tsx
//
// Chat livre sobre ativos específicos com o CONSELHO de mentores de IA
// configurados em Perfil → Integração com IA — todos respondem em paralelo
// à mesma pergunta e a config ativa sintetiza um consenso. Uma conversa
// 1:1 com um único mentor já é coberta pelo ícone do mascote em qualquer
// tela (as personas do ChatMascote pararam de recusar ativo nomeado — ver
// LIMITES em chat_mascote/index.ts), então esta página foca só no Conselho.
//
// Sem persistência — a conversa some ao sair da página (mesmo padrão do
// useChatMascote em modo `configId`).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Send, Trash2, Users, ChevronDown, ChevronUp, Bot, Paperclip, Check, X } from 'lucide-react'
import InvestimentosNav from '../components/ui/InvestimentosNav'
import { useIAPreferencia } from '../hooks/useIAPreferencia'
import { provedorPorId } from '../lib/iaProvedores'
import { useChatMentorAtivos, type MentorRespostaConselho } from '../hooks/useChatMentorAtivos'
import { useInvestimentosPosicoes } from '../hooks/useInvestimentosPosicoes'
import { useInvestimentosOperacoes } from '../hooks/useInvestimentosOperacoes'
import { useDividendos } from '../hooks/useDividendos'
import { serializarContexto } from '../context/ContextoIAContext'
import { TIPO_ATIVO_LABEL, TIPO_OPERACAO_LABEL, type TipoAtivoInvestimento } from '../lib/constants'
import { formatData } from '../lib/utils'

const MUTED = '#8b92a8'

function rotuloMentor(nome: string | null, provedor: string): string {
  if (nome && nome.trim()) return nome.trim()
  return provedorPorId(provedor)?.label ?? provedor
}

const SUGESTOES = [
  'RBRY11 está interessante para compra no preço atual?',
  'KNRI11 ainda vale a pena ou já está caro?',
  'Vale trocar uma ação de banco por um ETF internacional agora?',
]

// Bloco colapsável com a resposta de 1 mentor do conselho.
function CardMentorConselho({ mentor }: { mentor: MentorRespostaConselho }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className="rounded-lg border border-white/10 bg-black/20">
      <button type="button" onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left">
        <span className="flex items-center gap-2 text-[13px] font-medium text-white/85 truncate">
          <Bot size={13} style={{ color: mentor.erro ? '#f87171' : '#00c896' }} />
          {rotuloMentor(mentor.nome, mentor.provedor)}
        </span>
        {aberto ? <ChevronUp size={14} style={{ color: MUTED }} /> : <ChevronDown size={14} style={{ color: MUTED }} />}
      </button>
      {aberto && (
        <div className="px-3 pb-3 text-[13.5px] leading-relaxed whitespace-pre-wrap"
          style={{ color: mentor.erro ? '#f87171' : '#c5cad8' }}>
          {mentor.erro ?? mentor.resposta}
        </div>
      )}
    </div>
  )
}

// Dropdown compacto (checkboxes) pra restringir o recorte da carteira
// anexada — mesmo padrão do SeletorEscopo do ChatMascote (carteira inteira
// × um ou mais tipos de ativo).
function SeletorTiposCarteira({ tipos, selecionados, onChange, desabilitado }: {
  tipos:        TipoAtivoInvestimento[]
  selecionados: TipoAtivoInvestimento[]
  onChange:     (valores: TipoAtivoInvestimento[]) => void
  desabilitado: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const label = selecionados.length === 0 ? 'Carteira inteira'
    : selecionados.length === 1 ? TIPO_ATIVO_LABEL[selecionados[0]]
    : `${selecionados.length} tipos`

  const toggle = (t: TipoAtivoInvestimento) =>
    onChange(selecionados.includes(t) ? selecionados.filter(v => v !== t) : [...selecionados, t])

  return (
    <div ref={ref} className="relative">
      <button type="button" disabled={desabilitado} onClick={() => setOpen(o => !o)}
        title={desabilitado ? 'Marque "Anexar carteira" para escolher o recorte' : 'O que enviar ao conselho'}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-white/10 bg-black/20 text-white/70">
        {label}
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
      {open && !desabilitado && (
        <div className="absolute z-10 bottom-full mb-1 left-0 w-[190px] rounded-lg border border-white/10 shadow-xl overflow-hidden bg-[#12172a]">
          <div className="max-h-[220px] overflow-y-auto">
            <button type="button" onClick={() => { onChange([]); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-white/5 text-white">
              <span className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0"
                style={{ borderColor: selecionados.length === 0 ? '#00c896' : 'rgba(255,255,255,0.15)', background: selecionados.length === 0 ? '#00c896' : 'transparent' }}>
                {selecionados.length === 0 && <Check size={9} style={{ color: '#0a0f1a' }} />}
              </span>
              Carteira inteira
            </button>
            <div className="border-t border-white/10" />
            {tipos.map(t => {
              const sel = selecionados.includes(t)
              return (
                <button key={t} type="button" onClick={() => toggle(t)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-white/5 text-white">
                  <span className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0"
                    style={{ borderColor: sel ? '#00c896' : 'rgba(255,255,255,0.15)', background: sel ? '#00c896' : 'transparent' }}>
                    {sel && <Check size={9} style={{ color: '#0a0f1a' }} />}
                  </span>
                  {TIPO_ATIVO_LABEL[t]}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Dropdown compacto (checkboxes) pra escolher quais mentores configurados
// participam da pergunta — vazio = todos. Mesmo padrão visual do
// SeletorTiposCarteira acima.
function SeletorMentoresConselho({ mentores, selecionados, onChange }: {
  mentores:     { id: string; label: string }[]
  selecionados: string[]
  onChange:     (valores: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const label = selecionados.length === 0 ? 'Todos os mentores'
    : selecionados.length === 1 ? (mentores.find(m => m.id === selecionados[0])?.label ?? '1 mentor')
    : `${selecionados.length} mentores`

  const toggle = (id: string) =>
    onChange(selecionados.includes(id) ? selecionados.filter(v => v !== id) : [...selecionados, id])

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen(o => !o)}
        title="Quais mentores participam desta pergunta"
        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[13px] font-medium border transition-colors border-white/10 bg-black/20 text-white/80 hover:border-white/25">
        {label}
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>
      {open && (
        <div className="absolute z-10 top-full mt-1 left-0 w-[220px] rounded-lg border border-white/10 shadow-xl overflow-hidden bg-[#12172a]">
          <div className="max-h-[240px] overflow-y-auto">
            <button type="button" onClick={() => { onChange([]); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-white/5 text-white">
              <span className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0"
                style={{ borderColor: selecionados.length === 0 ? '#00c896' : 'rgba(255,255,255,0.15)', background: selecionados.length === 0 ? '#00c896' : 'transparent' }}>
                {selecionados.length === 0 && <Check size={9} style={{ color: '#0a0f1a' }} />}
              </span>
              Todos os mentores
            </button>
            <div className="border-t border-white/10" />
            {mentores.map(mt => {
              const sel = selecionados.includes(mt.id)
              return (
                <button key={mt.id} type="button" onClick={() => toggle(mt.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-white/5 text-white">
                  <span className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0"
                    style={{ borderColor: sel ? '#00c896' : 'rgba(255,255,255,0.15)', background: sel ? '#00c896' : 'transparent' }}>
                    {sel && <Check size={9} style={{ color: '#0a0f1a' }} />}
                  </span>
                  <span className="truncate">{mt.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function ConselhoInvestimentosPage() {
  const { configs } = useIAPreferencia()
  const { mensagens, carregando, erro, enviar, limpar } = useChatMentorAtivos()
  const [input, setInput] = useState('')
  const finalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Quais mentores configurados participam da pergunta — vazio = todos.
  const [mentorIdsSelecionados, setMentorIdsSelecionados] = useState<string[]>([])

  // ── Anexar carteira (ou parte dela) à pergunta ──────────────────────
  // Mesma política de privacidade do ChatMascote: OFF por padrão, enviada
  // só 1x (a IA já guarda na memória da conversa via `historico`), some
  // sozinho depois do 1º envio — o usuário pode religar se quiser reenviar.
  const { posicoes } = useInvestimentosPosicoes({ status: 'ATIVA' })
  const resumoCarteira = useMemo(() => {
    const porAtivo = new Map<string, { ticker: string; nome: string; tipo: TipoAtivoInvestimento; quantidade: number; valor_custo: number }>()
    for (const p of posicoes) {
      if (!p.inv_ativos) continue
      const atual = porAtivo.get(p.ativo_id)
      if (atual) { atual.quantidade += p.quantidade; atual.valor_custo += p.valor_custo }
      else porAtivo.set(p.ativo_id, {
        ticker: p.inv_ativos.ticker, nome: p.inv_ativos.nome, tipo: p.inv_ativos.tipo_ativo,
        quantidade: p.quantidade, valor_custo: p.valor_custo,
      })
    }
    return [...porAtivo.values()]
  }, [posicoes])
  const tiposNaCarteira = useMemo(
    () => Array.from(new Set(resumoCarteira.map(a => a.tipo))) as TipoAtivoInvestimento[],
    [resumoCarteira],
  )
  const [anexarCarteira, setAnexarCarteira] = useState(false)
  const [escopoTipos, setEscopoTipos] = useState<TipoAtivoInvestimento[]>([])
  const [carteiraJaEnviada, setCarteiraJaEnviada] = useState(false)

  // ── Anexar extrato (operações + proventos, últimos 12 meses) ────────
  // Mesma política de envio único do anexo de carteira acima.
  const DATA_INICIO_EXTRATO = useMemo(() => {
    const d = new Date()
    d.setMonth(d.getMonth() - 12)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])
  const MAX_ITENS_EXTRATO = 60
  const { operacoes } = useInvestimentosOperacoes({ de: DATA_INICIO_EXTRATO })
  const { dividendos } = useDividendos()
  const resumoExtrato = useMemo(() => {
    interface ItemExtrato { data: string; tipo: string; ticker: string | null; quantidade: number | null; valor: number }
    const itens: ItemExtrato[] = [
      ...operacoes.map((o): ItemExtrato => ({
        data: o.data_operacao, tipo: TIPO_OPERACAO_LABEL[o.tipo_operacao],
        ticker: o.inv_posicoes?.inv_ativos?.ticker ?? null, quantidade: o.quantidade, valor: o.valor_total,
      })),
      ...dividendos
        .filter(d => d.data_pagamento >= DATA_INICIO_EXTRATO)
        .map((d): ItemExtrato => ({
          data: d.data_pagamento, tipo: d.inv_tipos_dividendo?.nome ?? 'Provento',
          ticker: d.inv_ativos?.ticker ?? null, quantidade: null, valor: d.valor,
        })),
    ]
    return itens.sort((a, b) => b.data.localeCompare(a.data)).slice(0, MAX_ITENS_EXTRATO)
  }, [operacoes, dividendos, DATA_INICIO_EXTRATO])
  const [anexarExtrato, setAnexarExtrato] = useState(false)
  const [extratoJaEnviado, setExtratoJaEnviado] = useState(false)

  useEffect(() => {
    finalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensagens.length, carregando])

  const MAX_ALTURA_INPUT = 200
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, MAX_ALTURA_INPUT) + 'px'
  }, [input])

  const submit = (texto?: string) => {
    const t = (texto ?? input).trim()
    if (!t || carregando) return
    const pecas: string[] = []

    const itensCarteira = escopoTipos.length > 0 ? resumoCarteira.filter(a => escopoTipos.includes(a.tipo)) : resumoCarteira
    const enviaCarteira = anexarCarteira && itensCarteira.length > 0
    if (enviaCarteira) {
      pecas.push(serializarContexto({
        titulo: escopoTipos.length > 0
          ? `Minha carteira · ${escopoTipos.map(tp => TIPO_ATIVO_LABEL[tp]).join(', ')}`
          : 'Minha carteira (todos os tipos)',
        descricao: 'Ativos e posições ativas do usuário (ticker, quantidade e valor aplicado)',
        dados: itensCarteira.map(a => ({
          ticker: a.ticker, nome: a.nome, tipo: TIPO_ATIVO_LABEL[a.tipo],
          quantidade: a.quantidade, valor_aplicado: a.valor_custo,
        })),
      }))
    }

    const enviaExtrato = anexarExtrato && resumoExtrato.length > 0
    if (enviaExtrato) {
      pecas.push(serializarContexto({
        titulo: `Meu extrato de investimentos (últimos ${resumoExtrato.length} registros, 12 meses)`,
        descricao: 'Operações (compra/venda/aplicação/resgate) e proventos recebidos, mais recentes primeiro',
        dados: resumoExtrato.map(i => ({
          data: formatData(i.data), tipo: i.tipo, ticker: i.ticker, quantidade: i.quantidade, valor: i.valor,
        })),
      }))
    }

    const contextoTexto = pecas.length > 0 ? pecas.join('\n\n---\n\n') : undefined
    setInput('')
    if (enviaCarteira) { setAnexarCarteira(false); setCarteiraJaEnviada(true) }
    if (enviaExtrato) { setAnexarExtrato(false); setExtratoJaEnviado(true) }
    enviar(t, { contextoTexto, mentorIds: mentorIdsSelecionados })
  }

  return (
    <div className="p-5">
      <InvestimentosNav />

      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white">Conselho</h1>
          <p className="text-[14px] mt-0.5" style={{ color: MUTED }}>
            Pergunte sobre um ativo específico — todos os mentores configurados opinam e um consenso é sintetizado
          </p>
        </div>
        {mensagens.length > 0 && (
          <button onClick={() => {
              limpar()
              setAnexarCarteira(false); setCarteiraJaEnviada(false); setEscopoTipos([])
              setAnexarExtrato(false); setExtratoJaEnviado(false)
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10 text-[13px] text-white hover:border-white/25">
            <Trash2 size={14} /> Limpar conversa
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 bg-av-green/10 text-av-green text-[13px] font-medium">
          <Users size={14} /> Conselho de mentores
        </span>
        {configs.length > 0 && (
          <SeletorMentoresConselho
            mentores={configs.map(c => ({ id: c.id, label: rotuloMentor(c.nome ?? null, c.provedor) }))}
            selecionados={mentorIdsSelecionados}
            onChange={setMentorIdsSelecionados}
          />
        )}
        <span className="text-[12.5px]" style={{ color: MUTED }}>
          {configs.length > 0
            ? 'Quer conversar com só 1? Use o ícone do mascote em qualquer tela.'
            : 'Nenhum mentor configurado ainda.'}
        </span>
      </div>

      {configs.length === 0 && (
        <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center text-[13.5px]" style={{ color: MUTED }}>
          Cadastre ao menos uma IA em Perfil → Integração com IA para consultar o conselho.
        </div>
      )}

      {configs.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.02] flex flex-col" style={{ minHeight: '55vh' }}>
          {/* Mensagens */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3" style={{ maxHeight: '60vh' }}>
            {mensagens.length === 0 && (
              <div className="flex flex-col items-center text-center py-8">
                <p className="text-[15px] font-semibold text-white mb-1">Pergunte sobre um ativo</p>
                <p className="text-[13.5px] mb-4 max-w-[360px]" style={{ color: MUTED }}>
                  Digite o ticker direto na pergunta — ex.: "RBRY11 está interessante para compra?"
                </p>
                <div className="w-full max-w-[420px] space-y-1.5">
                  {SUGESTOES.map((s, i) => (
                    <button key={i} onClick={() => submit(s)}
                      className="w-full text-left px-3 py-2 rounded-lg text-[13.5px] border border-white/10 bg-black/20 text-white/80 hover:border-white/25 transition-colors">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {mensagens.map((msg, i) => (
              <div key={`${msg.ts}-${i}`} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className="max-w-[80%] flex flex-col gap-2">
                  <div className="rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words"
                    style={msg.role === 'user'
                      ? { background: 'rgba(0,200,150,0.12)', border: '1px solid rgba(0,200,150,0.30)', color: '#fff' }
                      : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.10)', color: '#e2e5ec' }}>
                    {msg.role === 'assistant' && msg.conselho?.consensoDe?.nome && (
                      <div className="text-[11.5px] font-semibold mb-1" style={{ color: '#00c896' }}>
                        Consenso · síntese de {msg.conselho.consensoDe.nome}
                      </div>
                    )}
                    {msg.content || (msg.conselho ? '(nenhum mentor conseguiu responder)' : '')}
                  </div>
                  {msg.role === 'assistant' && msg.conselho && msg.conselho.mentores.length > 0 && (
                    <div className="space-y-1.5">
                      {msg.conselho.mentores.map(mt => <CardMentorConselho key={mt.configId} mentor={mt} />)}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {carregando && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3.5 py-2.5 text-[14px] border border-white/10 bg-white/[0.04]" style={{ color: MUTED }}>
                  consultando o conselho…
                </div>
              </div>
            )}

            {erro && (
              <div className="rounded-lg px-3 py-2 text-[14px] border" style={{ background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.3)', color: '#f87171' }}>
                {erro}
              </div>
            )}
            <div ref={finalRef} />
          </div>

          {/* Anexos: carteira (ou recorte dela) e/ou extrato de investimentos */}
          {(resumoCarteira.length > 0 || resumoExtrato.length > 0) && (
            <div className="px-3 pt-2 pb-1 flex flex-wrap items-center gap-1.5 border-t border-white/10">
              {resumoCarteira.length > 0 && (
                <>
                  <button type="button" onClick={() => setAnexarCarteira(v => !v)}
                    title={
                      carteiraJaEnviada && !anexarCarteira
                        ? 'Sua carteira já foi anexada nesta conversa. Clique para reenviar (ou um recorte diferente).'
                        : anexarCarteira
                          ? 'Clique para NÃO anexar a carteira'
                          : 'Clique para anexar sua carteira (ou parte dela) à próxima pergunta — só uma vez'
                    }
                    className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[12px] font-medium transition-colors"
                    style={anexarCarteira
                      ? { background: 'rgba(0,200,150,0.12)', color: '#00c896', border: '1px solid rgba(0,200,150,0.35)' }
                      : carteiraJaEnviada
                        ? { background: 'rgba(139,146,168,0.10)', color: MUTED, border: '1px solid rgba(255,255,255,0.10)' }
                        : { background: 'rgba(255,255,255,0.03)', color: MUTED, border: '1px dashed rgba(255,255,255,0.15)' }}>
                    <Paperclip size={11} />
                    {anexarCarteira ? 'Anexar carteira' : carteiraJaEnviada ? 'Já anexei a carteira' : 'Anexar carteira'}
                    {anexarCarteira && <X size={10} />}
                  </button>
                  <SeletorTiposCarteira tipos={tiposNaCarteira} selecionados={escopoTipos} onChange={setEscopoTipos} desabilitado={!anexarCarteira} />
                </>
              )}
              {resumoExtrato.length > 0 && (
                <button type="button" onClick={() => setAnexarExtrato(v => !v)}
                  title={
                    extratoJaEnviado && !anexarExtrato
                      ? 'Seu extrato já foi anexado nesta conversa. Clique para reenviar.'
                      : anexarExtrato
                        ? 'Clique para NÃO anexar o extrato'
                        : `Clique para anexar seu extrato de investimentos (últimos ${resumoExtrato.length} registros, 12 meses) à próxima pergunta — só uma vez`
                  }
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[12px] font-medium transition-colors"
                  style={anexarExtrato
                    ? { background: 'rgba(0,200,150,0.12)', color: '#00c896', border: '1px solid rgba(0,200,150,0.35)' }
                    : extratoJaEnviado
                      ? { background: 'rgba(139,146,168,0.10)', color: MUTED, border: '1px solid rgba(255,255,255,0.10)' }
                      : { background: 'rgba(255,255,255,0.03)', color: MUTED, border: '1px dashed rgba(255,255,255,0.15)' }}>
                  <Paperclip size={11} />
                  {anexarExtrato ? 'Anexar extrato' : extratoJaEnviado ? 'Já anexei o extrato' : 'Anexar extrato'}
                  {anexarExtrato && <X size={10} />}
                </button>
              )}
            </div>
          )}

          {/* Input */}
          <div className="p-3 border-t border-white/10 flex gap-2 items-end">
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() } }}
              placeholder="Pergunte sobre um ativo (ex.: RBRY11 vale a compra?)"
              rows={1} maxLength={2000}
              className="flex-1 resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-[15px] leading-relaxed text-white focus:outline-none"
              style={{ maxHeight: MAX_ALTURA_INPUT, overflowY: 'auto' }} />
            <button onClick={() => submit()} disabled={!input.trim() || carregando}
              className="px-3 py-2 rounded-xl text-[15px] font-semibold transition-all disabled:opacity-40"
              style={{ background: '#00c896', color: '#0a0f1a' }}>
              <Send size={14} />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
