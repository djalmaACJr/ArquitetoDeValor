// src/hooks/useChatMascote.ts
//
// Cliente do Edge Function `chat_mascote`. Gerencia a conversa com o
// mascote escolhido: histórico em memória, envio com loading, erros.
// O histórico não persiste entre sessões — cada vez que o drawer é
// aberto, começa do zero (filosofia "perguntas pontuais", não chat longo).

import { useCallback, useState } from 'react'
import { apiMutate } from '../lib/api'
import type { MascoteNome } from '../components/ui/Mascote'

export interface Mensagem {
  role:    'user' | 'assistant'
  content: string
  /** Timestamp em ms (epoch) — pra ordenação e exibição */
  ts:      number
}

export function useChatMascote(mascote: MascoteNome, apelido?: string) {
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const enviar = useCallback(async (texto: string) => {
    const limpo = texto.trim()
    if (!limpo || carregando) return
    setErro(null)
    const minhaMsg: Mensagem = { role: 'user', content: limpo, ts: Date.now() }
    setMensagens(m => [...m, minhaMsg])
    setCarregando(true)

    // Reaproveita apiMutate (POST + auth automática) — só interpreta o
    // payload de resposta { resposta } da edge function.
    interface RespIA { resposta?: string }
    const res = await apiMutate<RespIA>('/chat_mascote', 'POST', {
      mascote,
      apelido:  apelido || undefined,  // edge function injeta no system prompt
      mensagem: limpo,
      historico: [...mensagens, minhaMsg].slice(0, -1).map(m => ({
        role:    m.role,
        content: m.content,
      })),
    })

    setCarregando(false)
    if (!res.ok || !res.dados?.resposta) {
      setErro(res.erro || 'Falha ao falar com o mascote. Tente de novo em instantes.')
      return
    }
    setMensagens(m => [...m, {
      role:    'assistant',
      content: res.dados!.resposta!,
      ts:      Date.now(),
    }])
  }, [mascote, apelido, mensagens, carregando])

  const limpar = useCallback(() => {
    setMensagens([])
    setErro(null)
  }, [])

  return { mensagens, carregando, erro, enviar, limpar }
}
