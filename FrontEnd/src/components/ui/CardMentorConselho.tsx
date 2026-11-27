// Bloco colapsável com a resposta de 1 mentor do conselho — compartilhado
// entre a página Conselho e o quadro "Conselho" da página do ativo.
import { useState } from 'react'
import { Bot, ChevronDown, ChevronUp } from 'lucide-react'
import { rotuloMentor } from '../../lib/iaProvedores'
import type { MentorRespostaConselho } from '../../hooks/useChatMentorAtivos'

const MUTED = '#8b92a8'

export default function CardMentorConselho({ mentor }: { mentor: MentorRespostaConselho }) {
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
