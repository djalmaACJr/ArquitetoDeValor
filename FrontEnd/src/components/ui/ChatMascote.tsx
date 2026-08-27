// src/components/ui/ChatMascote.tsx
//
// Drawer lateral de chat com o mascote. Aberto ao clicar no avatar/dica.
// O mascote responde "encarnado" via Edge Function chat_mascote +
// Anthropic Claude. Histórico em memória — não persiste entre aberturas.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { X, Send, Trash2, Paperclip, Camera, Users, Info, Bot, ChevronDown, Check } from 'lucide-react'
import Mascote, { type MascoteNome, type MascotePose } from './Mascote'
import { useChatMascote } from '../../hooks/useChatMascote'
import { useMascotePreferido } from '../../hooks/useMascotePreferido'
import { useContextoIA, serializarContexto, type ContextoIAEscopo } from '../../context/ContextoIAContext'
import { useIAPreferencia } from '../../hooks/useIAPreferencia'
import { provedorPorId, rotuloModelo } from '../../lib/iaProvedores'
import { capturarTela } from '../../lib/screenshot'

// Seletor compacto (dropdown com checkboxes) do recorte enviado à IA — ex.:
// carteira inteira (nada marcado) × um ou mais tipos de ativo. Só faz
// sentido quando o usuário de fato vai enviar os dados da tela: enquanto
// `desabilitado`, fica visível mas travado (não adianta escolher um recorte
// pra um envio que não vai acontecer).
function SeletorEscopo({ opcoes, selecionados, onChange, desabilitado }: {
  opcoes:       ContextoIAEscopo[]
  selecionados: string[]
  onChange:     (valores: string[]) => void
  desabilitado: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Fecha o dropdown quando o campo é desabilitado (usuário desmarcou
  // "Enviar dados desta tela") — mesmo padrão "derived state on prop
  // change" usado no reset de `tituloAnterior` mais abaixo neste arquivo,
  // evita o anti-pattern de setState síncrono dentro de um useEffect.
  const [desabilitadoAnterior, setDesabilitadoAnterior] = useState(desabilitado)
  if (desabilitado !== desabilitadoAnterior) {
    setDesabilitadoAnterior(desabilitado)
    if (desabilitado) setOpen(false)
  }

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', fn)
    return () => document.removeEventListener('mousedown', fn)
  }, [])

  const label =
    selecionados.length === 0 ? 'Carteira inteira'
    : selecionados.length === 1 ? (opcoes.find((o) => o.valor === selecionados[0])?.label ?? selecionados[0])
    : `${selecionados.length} tipos`

  const toggle = (valor: string) =>
    onChange(selecionados.includes(valor) ? selecionados.filter((v) => v !== valor) : [...selecionados, valor])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={desabilitado}
        onClick={() => setOpen((o) => !o)}
        title={desabilitado ? 'Marque “Enviar dados desta tela” para escolher o recorte' : 'O que enviar para a IA'}
        className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[12px] font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
      >
        {label}
        <ChevronDown size={11} style={{ transform: open ? 'rotate(180deg)' : undefined, transition: 'transform 0.15s' }} />
      </button>

      {open && !desabilitado && (
        <div
          className="absolute z-10 bottom-full mb-1 left-0 w-[200px] rounded-lg border shadow-xl overflow-hidden"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-subtle)' }}
        >
          {/* Lista com scroll próprio — abre pra CIMA (perto do fim do
              drawer) e tem altura travada, então sem isso as opções de mais
              embaixo ficavam fora da tela e sem jeito de rolar até elas. */}
          <div className="max-h-[220px] overflow-y-auto">
            <button
              type="button"
              onClick={() => { onChange([]); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-white/5 transition-colors"
              style={{ color: 'var(--text-primary)' }}
            >
              <span className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0"
                style={{ borderColor: selecionados.length === 0 ? '#00c896' : 'var(--border-subtle)', background: selecionados.length === 0 ? '#00c896' : 'transparent' }}>
                {selecionados.length === 0 && <Check size={9} style={{ color: '#0a0f1a' }} />}
              </span>
              Carteira inteira
            </button>
            <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }} />
            {opcoes.map((o) => {
              const sel = selecionados.includes(o.valor)
              return (
                <button
                  key={o.valor}
                  type="button"
                  onClick={() => toggle(o.valor)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left text-[12.5px] hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                >
                  <span className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0"
                    style={{ borderColor: sel ? '#00c896' : 'var(--border-subtle)', background: sel ? '#00c896' : 'transparent' }}>
                    {sel && <Check size={9} style={{ color: '#0a0f1a' }} />}
                  </span>
                  {o.label}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// Artigo definido por personagem (gênero do mascote, NÃO do apelido).
// Arquiteta e Raposa são femininas — usam "a"; demais usam "o".
const ARTIGO: Record<MascoteNome, 'o' | 'a'> = {
  sabio: 'o', gato: 'o', arquiteta: 'a', raposa: 'a',
}

// Sugestões iniciais por mascote — incentiva a primeira pergunta.
const SUGESTOES: Record<MascoteNome, string[]> = {
  sabio: [
    'Como começar a investir com pouco dinheiro?',
    'Vale a pena pagar dívida ou investir primeiro?',
    'Como manter disciplina financeira no longo prazo?',
  ],
  arquiteta: [
    'Como montar um orçamento mensal?',
    'Qual o tamanho ideal da reserva de emergência?',
    'Como categorizar minhas despesas corretamente?',
  ],
  gato: [
    'Como funcionam os juros compostos?',
    'R$ 100 por mês fazem diferença mesmo?',
    'Reinvestir dividendos vale a pena?',
  ],
  raposa: [
    'Como pensar em risco vs. retorno?',
    'O que é custo de oportunidade?',
    'Quando NÃO agir é a melhor decisão?',
  ],
}

export default function ChatMascote({
  nome,
  aberto,
  onFechar,
  configId,
}: {
  nome:     MascoteNome
  aberto:   boolean
  onFechar: () => void
  /** Config de IA específica a usar (sem trocar a ativa). Vazio → usa a ativa. */
  configId?: string
}) {
  const { apelidoDe } = useMascotePreferido()
  const apelido = apelidoDe(nome)
  const navigate = useNavigate()
  const { mensagens, carregando, erro, enviar, limpar } = useChatMascote(nome, apelido, configId)
  const [input, setInput] = useState('')
  const finalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Contexto da página atual (se registrado) — anexável à mensagem.
  //
  // Política de privacidade da conversa:
  //   • OFF por padrão. O usuário precisa marcar explicitamente que quer
  //     mandar os dados da tela junto com a pergunta.
  //   • Envia APENAS UMA VEZ por contexto: depois do 1º envio com o toggle
  //     ligado, ele volta a OFF automaticamente. A IA mantém o que recebeu
  //     na memória da conversa, não precisa reenviar a cada mensagem.
  //   • Quando o usuário muda de tela (titulo do contexto muda) ou limpa a
  //     conversa, o "já enviei" reseta e o usuário pode marcar de novo se
  //     quiser passar o contexto novo.
  const contextoPagina = useContextoIA()
  const [anexarContexto, setAnexarContexto] = useState(false)
  const [contextoJaEnviado, setContextoJaEnviado] = useState(false)

  // Reset quando o conteúdo da tela muda (mudou de página/seção).
  // Padrão React 19 "derived state on prop change": compara o último
  // título visto e atualiza state inline, evitando o anti-pattern
  // "setState dentro de useEffect" que causa render em cascata.
  const [tituloAnterior, setTituloAnterior] = useState(contextoPagina?.titulo)
  if (tituloAnterior !== contextoPagina?.titulo) {
    setTituloAnterior(contextoPagina?.titulo)
    setAnexarContexto(false)
    setContextoJaEnviado(false)
  }

  // Screenshot — só relevante se o provedor da config em uso aceitar visão.
  // Com `configId`, vale o provedor daquela config; senão, o da ativa.
  const { ativa, provedorAtivo, configs } = useIAPreferencia()
  const configEmUso = configId ? configs.find(c => c.id === configId) : ativa
  const provedorEmUso = configId
    ? provedorPorId(configEmUso?.provedor ?? '')
    : provedorAtivo
  const suportaVisao = !!provedorEmUso?.visao
  const [screenshot, setScreenshot] = useState<string | null>(null)
  const [capturando, setCapturando] = useState(false)

  const tirarScreenshot = async () => {
    setCapturando(true)
    // Fecha visualmente pra captar a tela embaixo, depois reabre.
    // Truque: rendera off-screen captura — mais simples, esconder o aside temporariamente.
    const el = asideRef.current
    if (el) el.style.visibility = 'hidden'
    const dataUrl = await capturarTela()
    if (el) el.style.visibility = ''
    setCapturando(false)
    if (dataUrl) setScreenshot(dataUrl)
  }
  const asideRef = useRef<HTMLElement>(null)

  // Auto-scroll para o final ao receber mensagem nova
  useEffect(() => {
    finalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensagens.length, carregando])

  // Auto-grow do textarea conforme o usuário digita. Cresce até `MAX_ALTURA_INPUT`
  // (~10 linhas); a partir daí passa a fazer scroll interno.
  const MAX_ALTURA_INPUT = 220
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, MAX_ALTURA_INPUT) + 'px'
  }, [input, aberto])

  // Foco no input ao abrir
  useEffect(() => {
    if (aberto) {
      const t = setTimeout(() => inputRef.current?.focus(), 150)
      return () => clearTimeout(t)
    }
  }, [aberto])

  // ESC fecha
  useEffect(() => {
    if (!aberto) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onFechar() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [aberto, onFechar])

  const submit = () => {
    const t = input.trim()
    if (!t || carregando) return
    const contextoTexto = (anexarContexto && contextoPagina) ? serializarContexto(contextoPagina) : undefined
    const screenshotBase64 = (suportaVisao && screenshot) ? screenshot : undefined
    setInput('')
    setScreenshot(null)  // limpa screenshot após enviar — usa-se uma vez
    // Mesma regra para o contexto da tela: depois de enviado, desliga o
    // toggle (e marca como já enviado nesta conversa). O usuário pode
    // religar manualmente se quiser passar de novo — mas a IA já tem.
    if (contextoTexto) {
      setAnexarContexto(false)
      setContextoJaEnviado(true)
    }
    enviar(t, { contextoTexto, screenshotBase64 })
  }

  // Wrapper de limpar conversa: zera também o "já enviei" pra o usuário
  // poder reenviar o contexto na conversa nova se quiser.
  const limparTudo = () => {
    setContextoJaEnviado(false)
    setAnexarContexto(false)
    limpar()
  }

  // Pose do mascote no avatar: feliz no início (vazio), curioso quando
  // pensando, sentado em repouso.
  const poseAvatar: MascotePose =
    carregando         ? 'curioso'
    : mensagens.length === 0 ? 'feliz'
    : 'sentado'

  if (!aberto) return null

  // Renderiza via portal direto no <body>. Sem isso, o drawer fica preso ao
  // stacking context da página (ex.: tabela com `thead sticky z-30` na
  // página de Relatórios passa por cima da conversa). Portal escapa
  // qualquer ancestral com transform/overflow/z-index esquisito.
  return createPortal(
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
        onClick={onFechar}
        aria-hidden="true"
      />
      {/* Drawer lateral direito */}
      <aside
        ref={asideRef}
        role="dialog"
        aria-label={`Conversa com ${apelido}`}
        className="fixed right-0 top-0 bottom-0 z-[101] w-full sm:w-[460px] flex flex-col shadow-2xl"
        style={{ background: 'var(--bg-card)', borderLeft: '1px solid var(--border-subtle)' }}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-4 py-3 border-b"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center">
            <Mascote nome={nome} pose={poseAvatar} size={48} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>
              Converse com {apelido}
            </p>
            <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>
              {carregando ? 'pensando…' : 'pergunte qualquer coisa sobre finanças'}
            </p>
          </div>
          <button
            onClick={() => { onFechar(); navigate('/apresentacao') }}
            title="Trocar de mentor"
            aria-label="Reapresentar mentores"
            className="p-2 rounded-lg transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
          >
            <Users size={14} />
          </button>
          {mensagens.length > 0 && (
            <button
              onClick={limparTudo}
              title="Limpar conversa"
              className="p-2 rounded-lg transition-colors hover:bg-white/10"
              style={{ color: 'var(--text-muted)' }}
            >
              <Trash2 size={14} />
            </button>
          )}
          <button
            onClick={onFechar}
            title="Fechar"
            className="p-2 rounded-lg transition-colors hover:bg-white/10"
            style={{ color: 'var(--text-muted)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Mensagens */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {mensagens.length === 0 && (
            <div className="flex flex-col items-center text-center py-6">
              <div className="mb-2">
                <Mascote nome={nome} pose="feliz" size={120} />
              </div>
              {provedorEmUso && (
                <span
                  title={`Este mentor está respondendo com ${provedorEmUso.label} · ${rotuloModelo(provedorEmUso, configEmUso?.modelo)}`}
                  className="mb-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12.5px] font-semibold border cursor-help"
                  style={{ background: 'rgba(139,92,246,0.14)', borderColor: 'rgba(139,92,246,0.5)', color: '#a78bfa' }}
                >
                  <Bot size={14} />
                  {provedorEmUso.label}
                </span>
              )}
              <p className="text-[16px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                Olá! Sou {ARTIGO[nome]} {apelido}.
              </p>
              <p className="text-[14px] mb-3 max-w-[280px]" style={{ color: 'var(--text-muted)' }}>
                Me pergunte qualquer coisa sobre finanças pessoais. Vou responder do meu jeito.
              </p>
              {contextoPagina && (
                <div
                  className="text-[12px] mb-4 max-w-[300px] px-3 py-2 rounded-lg border text-left flex gap-2"
                  style={{
                    background:  'rgba(77,166,255,0.08)',
                    borderColor: 'rgba(77,166,255,0.25)',
                    color:       'var(--text-secondary)',
                  }}
                >
                  <Info size={13} className="flex-shrink-0 mt-0.5" style={{ color: '#4da6ff' }}/>
                  <span>
                    Quer falar sobre o que está vendo em <strong>{contextoPagina.titulo}</strong>?
                    Marque <strong>“Enviar dados desta tela”</strong> nos anexos da pergunta.
                  </span>
                </div>
              )}
              <div className="w-full space-y-1.5">
                {SUGESTOES[nome].map((s, i) => (
                  <button
                    key={i}
                    onClick={() => enviar(s)}
                    className="w-full text-left px-3 py-2 rounded-lg text-[14px] border transition-all hover:scale-[1.01]"
                    style={{
                      borderColor: 'var(--border-subtle)',
                      background:  'var(--bg-elevated)',
                      color:       'var(--text-secondary)',
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mensagens.map((m, i) => (
            <div
              key={`${m.ts}-${i}`}
              className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} gap-2`}
            >
              {m.role === 'assistant' && (
                <div className="flex-shrink-0 mt-1">
                  <Mascote nome={nome} pose="sentado" size={36} />
                </div>
              )}
              <div
                className="rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed max-w-[78%] whitespace-pre-wrap break-words"
                style={
                  m.role === 'user'
                    ? { background: 'rgba(0, 200, 150, 0.12)', color: 'var(--text-primary)',  border: '1px solid rgba(0, 200, 150, 0.30)' }
                    : { background: 'var(--bg-elevated)',       color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }
                }
              >
                {m.content}
              </div>
            </div>
          ))}

          {carregando && (
            <div className="flex gap-2 items-center">
              <div className="flex-shrink-0">
                <Mascote nome={nome} pose="curioso" size={36} />
              </div>
              <div
                className="rounded-2xl px-3.5 py-2.5 text-[14px] border flex items-center gap-1"
                style={{ background: 'var(--bg-elevated)', borderColor: 'var(--border-subtle)' }}
              >
                <span className="dot-pulse" style={{ color: 'var(--text-muted)' }}>● ● ●</span>
              </div>
            </div>
          )}

          {erro && (
            <div
              className="rounded-lg px-3 py-2 text-[14px] border"
              style={{ background: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.3)', color: '#f87171' }}
            >
              {erro}
            </div>
          )}

          <div ref={finalRef} />
        </div>

        {/* Chips de anexos (contexto da página + screenshot) */}
        {(contextoPagina || screenshot) && (
          <div
            className="px-3 pt-2 pb-1 flex flex-wrap items-center gap-1.5 border-t"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            {contextoPagina && (
              <button
                type="button"
                onClick={() => setAnexarContexto(v => !v)}
                title={
                  contextoJaEnviado && !anexarContexto
                    ? `Os dados de "${contextoPagina.titulo}" já foram enviados nesta conversa. Clique para reenviar.`
                    : anexarContexto
                      ? `Clique para NÃO enviar os dados de "${contextoPagina.titulo}" para a IA`
                      : `Clique para enviar os dados de "${contextoPagina.titulo}" para a IA — só uma vez por conversa`
                }
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[12px] font-medium transition-colors"
                style={
                  anexarContexto
                    ? { background: 'rgba(0,200,150,0.12)', color: '#00c896', border: '1px solid rgba(0,200,150,0.35)' }
                    : contextoJaEnviado
                      ? { background: 'rgba(139,146,168,0.10)', color: 'var(--text-faint)', border: '1px solid var(--border-subtle)' }
                      : { background: 'var(--tint-1)',        color: 'var(--text-faint)', border: '1px dashed var(--border-subtle)' }
                }
              >
                <Paperclip size={11}/>
                <span className="truncate max-w-[240px]">
                  {anexarContexto
                    ? 'Enviar dados desta tela: '
                    : contextoJaEnviado
                      ? 'Já enviei dados de '
                      : 'Enviar dados desta tela: '}
                  <strong>{contextoPagina.titulo}</strong>
                </span>
                {anexarContexto && <X size={10}/>}
              </button>
            )}
            {/* Escopo do snapshot (ex.: carteira inteira × um ou mais tipos de
                ativo) — vem logo depois do chip "Enviar dados desta tela",
                só aparece quando a página oferece recortes alternativos, e
                fica travado até esse chip ser ligado: escolher recorte pra
                um envio que não vai acontecer só confunde. */}
            {contextoPagina?.escopos && contextoPagina.escopos.length > 0 && (
              <SeletorEscopo
                opcoes={contextoPagina.escopos}
                selecionados={contextoPagina.escopoSelecionado ?? []}
                onChange={(v) => contextoPagina.aoMudarEscopo?.(v)}
                desabilitado={!anexarContexto}
              />
            )}
            {screenshot && (
              <button
                type="button"
                onClick={() => setScreenshot(null)}
                title="Remover screenshot"
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[12px] font-medium transition-colors"
                style={{ background: 'rgba(77,166,255,0.10)', color: '#4da6ff', border: '1px solid rgba(77,166,255,0.35)' }}
              >
                <Camera size={11}/>
                Print da tela
                <X size={10}/>
              </button>
            )}
          </div>
        )}

        {/* Input */}
        <div
          className="p-3 border-t flex gap-2 items-end"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
            }}
            placeholder={`Pergunte ao ${apelido}...`}
            rows={1}
            maxLength={2000}
            className="flex-1 resize-none rounded-xl border px-3 py-2 text-[15px] leading-relaxed focus:outline-none transition-colors"
            style={{
              background:  'var(--bg-input)',
              borderColor: 'var(--border-subtle)',
              color:       'var(--text-primary)',
              maxHeight:   MAX_ALTURA_INPUT,
              overflowY:   'auto',
            }}
          />
          {suportaVisao && !screenshot && (
            <button
              type="button"
              onClick={tirarScreenshot}
              disabled={capturando || carregando}
              title="Capturar screenshot desta tela e anexar"
              className="px-3 py-2 rounded-xl text-[14px] font-medium transition-all disabled:opacity-40"
              style={{ color: '#4da6ff', border: '1px solid rgba(77,166,255,0.3)', background: 'rgba(77,166,255,0.06)' }}
            >
              <Camera size={14} />
            </button>
          )}
          <button
            onClick={submit}
            disabled={!input.trim() || carregando}
            title="Enviar (Enter)"
            className="px-3 py-2 rounded-xl text-[15px] font-semibold transition-all disabled:opacity-40"
            style={{ background: '#00c896', color: '#0a0f1a' }}
          >
            <Send size={14} />
          </button>
        </div>
      </aside>

      <style>{`
        @keyframes dot-pulse {
          0%, 100% { opacity: 0.3; }
          50%      { opacity: 1.0; }
        }
        .dot-pulse {
          animation: dot-pulse 1.2s ease-in-out infinite;
          letter-spacing: 0.2em;
        }
      `}</style>
    </>,
    document.body,
  )
}
