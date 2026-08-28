// src/hooks/useChatMentorAtivos.ts
//
// Cliente da rota /investimentos/chat-mentor — o "Conselho": todos os
// mentores de IA configurados em Perfil → Integração com IA respondem em
// paralelo à mesma pergunta sobre um ativo, e a config ativa sintetiza um
// consenso. Uma conversa 1:1 com um único mentor já é coberta pelo ícone
// do mascote em qualquer tela (useChatMascote) — sem as restrições de
// persona que ele tinha antes.
//
// Sem persistência (mesmo padrão do useChatMascote em modo `configId`):
// histórico fica só em memória, some ao recarregar/fechar.
import { useCallback, useState } from 'react'
import { apiMutate } from '../lib/api'

export interface MentorRespostaConselho {
  configId: string
  nome:     string | null
  provedor: string
  modelo:   string | null
  resposta: string | null
  erro:     string | null
}

export interface ConselhoInfo {
  mentores:   MentorRespostaConselho[]
  consenso:   string | null
  consensoDe: { configId: string | null; nome: string | null } | null
}

export interface MensagemMentorChat {
  role:    'user' | 'assistant'
  content: string
  ts:      number
  /** Detalhe por mentor da resposta do conselho. */
  conselho?: ConselhoInfo
}

// Teto de segurança do histórico reenviado a cada mensagem (payload/tokens).
const MAX_HISTORICO = 20

interface RespConselho {
  mentores: Array<{
    config_id: string; nome: string | null; provedor: string; modelo: string | null;
    resposta: string | null; erro: string | null;
  }>
  consenso: string | null
  consenso_de: { config_id: string | null; nome: string | null } | null
}

export function useChatMentorAtivos() {
  const [mensagens, setMensagens] = useState<MensagemMentorChat[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const enviar = useCallback(async (
    texto: string,
    extras?: {
      /** Snapshot da carteira/extrato (ou recorte deles) já formatado — anexado só nesta mensagem. */
      contextoTexto?: string
      /** IDs das configs de IA a consultar — vazio/ausente consulta TODOS os mentores configurados. */
      mentorIds?: string[]
    },
  ) => {
    const limpo = texto.trim()
    if (!limpo || carregando) return
    setErro(null)
    const minhaMsg: MensagemMentorChat = { role: 'user', content: limpo, ts: Date.now() }
    const historico = mensagens.slice(-MAX_HISTORICO).map(m => ({ role: m.role, content: m.content }))
    setMensagens(m => [...m, minhaMsg])
    setCarregando(true)

    const res = await apiMutate<RespConselho>('/investimentos/chat-mentor', 'POST', {
      mensagem: limpo,
      historico,
      contexto: extras?.contextoTexto || undefined,
      mentores_ids: extras?.mentorIds?.length ? extras.mentorIds : undefined,
    })
    setCarregando(false)
    if (!res.ok || !res.dados) {
      setErro(res.erro || 'Falha ao consultar o conselho. Tente de novo em instantes.')
      return
    }
    const mentores = res.dados.mentores.map(mt => ({
      configId: mt.config_id, nome: mt.nome, provedor: mt.provedor, modelo: mt.modelo,
      resposta: mt.resposta, erro: mt.erro,
    }))
    // Conteúdo principal da bolha: o consenso sintetizado; se a síntese
    // falhou (provedor da config ativa fora do ar, por ex.), cai para a
    // 1ª resposta individual que deu certo — nunca deixa a bolha vazia.
    const conteudoPrincipal = res.dados.consenso ?? mentores.find(mt => mt.resposta)?.resposta ?? ''
    setMensagens(m => [...m, {
      role: 'assistant',
      content: conteudoPrincipal,
      ts: Date.now(),
      conselho: {
        mentores,
        consenso: res.dados!.consenso,
        consensoDe: res.dados!.consenso_de
          ? { configId: res.dados!.consenso_de.config_id, nome: res.dados!.consenso_de.nome }
          : null,
      },
    }])
  }, [mensagens, carregando])

  const limpar = useCallback(() => {
    setMensagens([])
    setErro(null)
  }, [])

  return { mensagens, carregando, erro, enviar, limpar }
}
