// src/hooks/useChatMascote.ts
//
// Cliente do Edge Function `chat_mascote`. Gerencia a conversa com o
// mascote escolhido: histórico, envio com loading, erros.
//
// Histórico persiste em arqvalor.usuarios.chat_mascote_historico — leitura/
// escrita direta pelo client (mesma exceção de tema/mascote/ordem_quadros),
// sobrevive a trocar de página, recarregar E de aparelho (achado real do
// usuário: clicar no ícone do mentor sempre começava uma conversa nova ao
// navegar). Decisão consciente: já guardamos antes em localStorage, mas o
// usuário pediu pra mover pro banco depois de entender o trade-off (menos
// exposto a acesso físico/malware no aparelho; mais uma coisa exposta se
// houver bug de RLS/service_role — mesma categoria de risco de qualquer
// outra tabela). Só a conversa "normal" (sem `configId`) persiste — o
// fluxo de "testar uma config específica" do Perfil é efêmero de
// propósito, não é "sua conversa com o mentor".
import { useCallback, useEffect, useRef, useState } from 'react'
import { apiMutate } from '../lib/api'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import type { MascoteNome } from '../components/ui/Mascote'

export interface Mensagem {
  role:    'user' | 'assistant'
  content: string
  /** Timestamp em ms (epoch) — pra ordenação e exibição */
  ts:      number
}

// Teto de segurança: sem isso, uma conversa persistida por meses cresceria
// sem limite (linha no banco e o payload/tokens mandados a cada mensagem).
const MAX_MENSAGENS = 60
// O histórico ainda não é criptografado em repouso — expira sozinho depois
// de um tempo parado, pra limitar a janela de exposição em caso de acesso
// indevido ao banco, sem abrir mão de sobreviver a F5/navegação/troca de
// aparelho enquanto está em uso ativo.
const EXPIRACAO_MS = 24 * 60 * 60 * 1000 // 24h sem nenhuma mensagem nova

// Chave antiga (versão em localStorage, substituída por esta) — limpa uma
// vez pra não deixar resquício no navegador de quem já tinha usado.
const LS_KEY_LEGADO = 'arqvalor:chat-mascote-historico'

function podarSeExpirado(lista: Mensagem[]): Mensagem[] {
  if (lista.length === 0) return lista
  const ultima = lista[lista.length - 1]?.ts ?? 0
  return Date.now() - ultima > EXPIRACAO_MS ? [] : lista
}

export function useChatMascote(mascote: MascoteNome, apelido?: string, configId?: string) {
  const { session } = useAuth()
  const userId = session?.user?.id
  const persistir = !configId

  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  // Se o usuário já mandou mensagem antes do fetch inicial responder, o
  // fetch NÃO pode sobrescrever (mesma proteção de useOcultarValores).
  const tocadoLocal = useRef(false)

  useEffect(() => {
    try { localStorage.removeItem(LS_KEY_LEGADO) } catch { /* nada a limpar */ }
  }, [])

  // Busca do banco ao logar/montar.
  useEffect(() => {
    if (!persistir || !userId) return
    let cancelado = false
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('chat_mascote_historico')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (cancelado || tocadoLocal.current) return
        const remoto = (data?.chat_mascote_historico as Mensagem[] | null) ?? []
        const podada = podarSeExpirado(remoto)
        setMensagens(podada)
        // Achou expirada → limpa a linha também no banco (não só localmente),
        // pra não deixar conteúdo velho parado ali indefinidamente.
        if (podada.length === 0 && remoto.length > 0) {
          supabase.schema('arqvalor').from('usuarios')
            .update({ chat_mascote_historico: [] }).eq('id', userId)
            .then(() => { /* fire-and-forget */ })
        }
      })
    return () => { cancelado = true }
  }, [persistir, userId])

  // Persiste no banco a cada mudança de verdade (nova mensagem/limpar).
  useEffect(() => {
    if (!persistir || !userId) return
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ chat_mascote_historico: mensagens.slice(-MAX_MENSAGENS) })
      .eq('id', userId)
      .then(({ error }) => { if (error) console.error('Erro ao salvar histórico do chat:', error) })
  }, [mensagens, persistir, userId])

  const enviar = useCallback(async (
    texto: string,
    extras?: {
      /** Texto adicional injetado antes da mensagem do usuário — ex.: snapshot dos dados da página */
      contextoTexto?: string
      /** Screenshot em base64 (data URL ou só base64) — só processado por modelos com visão */
      screenshotBase64?: string
    },
  ) => {
    const limpo = texto.trim()
    if (!limpo || carregando) return
    setErro(null)
    tocadoLocal.current = true
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
      configId: configId || undefined,  // conversa com config específica sem trocar a ativa
      contexto: extras?.contextoTexto || undefined,
      screenshot: extras?.screenshotBase64 || undefined,
      // Mesmo teto do que é persistido — sem isso, uma conversa antiga
      // recuperada do banco mandaria um histórico cada vez maior (payload
      // e tokens) a cada nova mensagem.
      historico: [...mensagens, minhaMsg].slice(-MAX_MENSAGENS).slice(0, -1).map(m => ({
        role:    m.role,
        content: m.content,
      })),
    })

    setCarregando(false)
    if (!res.ok || !res.dados?.resposta) {
      setErro(res.erro || 'Falha ao falar com o mentor. Tente de novo em instantes.')
      return
    }
    setMensagens(m => [...m, {
      role:    'assistant',
      content: res.dados!.resposta!,
      ts:      Date.now(),
    }])
  }, [mascote, apelido, configId, mensagens, carregando])

  const limpar = useCallback(() => {
    tocadoLocal.current = true
    setMensagens([])
    setErro(null)
  }, [])

  return { mensagens, carregando, erro, enviar, limpar }
}
