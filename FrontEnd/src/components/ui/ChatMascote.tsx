// src/components/ui/ChatMascote.tsx
//
// Drawer lateral de chat com o mascote. Aberto ao clicar no avatar/dica.
// O mascote responde "encarnado" via Edge Function chat_mascote +
// Anthropic Claude. Histórico em memória — não persiste entre aberturas.

import { useEffect, useRef, useState } from 'react'
import { X, Send, Trash2 } from 'lucide-react'
import Mascote, { type MascoteNome, type MascotePose } from './Mascote'
import { useChatMascote } from '../../hooks/useChatMascote'
import { useMascotePreferido } from '../../hooks/useMascotePreferido'

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
}: {
  nome:     MascoteNome
  aberto:   boolean
  onFechar: () => void
}) {
  const { apelidoDe } = useMascotePreferido()
  const apelido = apelidoDe(nome)
  const { mensagens, carregando, erro, enviar, limpar } = useChatMascote(nome, apelido)
  const [input, setInput] = useState('')
  const finalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll para o final ao receber mensagem nova
  useEffect(() => {
    finalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [mensagens.length, carregando])

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
    setInput('')
    enviar(t)
  }

  // Pose do mascote no avatar: feliz no início (vazio), curioso quando
  // pensando, sentado em repouso.
  const poseAvatar: MascotePose =
    carregando         ? 'curioso'
    : mensagens.length === 0 ? 'feliz'
    : 'sentado'

  if (!aberto) return null

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
        onClick={onFechar}
        aria-hidden="true"
      />
      {/* Drawer lateral direito */}
      <aside
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
          {mensagens.length > 0 && (
            <button
              onClick={limpar}
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
              <div className="mb-3">
                <Mascote nome={nome} pose="feliz" size={120} />
              </div>
              <p className="text-[16px] font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                Olá! Sou o {apelido}.
              </p>
              <p className="text-[14px] mb-4 max-w-[280px]" style={{ color: 'var(--text-muted)' }}>
                Me pergunte qualquer coisa sobre finanças pessoais. Vou responder do meu jeito.
              </p>
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
            className="flex-1 resize-none rounded-xl border px-3 py-2 text-[15px] focus:outline-none transition-colors"
            style={{
              background:  'var(--bg-input)',
              borderColor: 'var(--border-subtle)',
              color:       'var(--text-primary)',
              maxHeight:   140,
            }}
          />
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
    </>
  )
}
