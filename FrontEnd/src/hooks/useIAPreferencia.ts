// src/hooks/useIAPreferencia.ts
//
// Gerencia múltiplas configurações de IA do usuário, com UMA marcada
// como ativa. Persistido em `arqvalor.usuarios.ia_configs` (JSONB).
//
// Forma da coluna:
//   { ativa: '<id>' | null,
//     configs: [{ id, provedor, api_key, nome? }] }
//
// A edge function `chat_mascote` lê a config ativa e usa para chamar
// o provedor escolhido.

import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { provedorPorId } from '../lib/iaProvedores'
import type { IAProvedor } from '../lib/iaProvedores'

export interface IAConfig {
  id:       string   // uuid simples gerado no client
  provedor: string   // id do provedor (claude/gpt/gemini/deepseek)
  api_key:  string   // chave bruta da API
  nome?:    string   // rótulo opcional (ex.: "Trabalho", "Pessoal")
}

interface IAConfigsCol {
  ativa:   string | null
  configs: IAConfig[]
}

export interface EstadoIA {
  ativa:     IAConfig | null
  provedorAtivo: IAProvedor | null
  configs:   IAConfig[]
  carregando: boolean
}

function id(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function useIAPreferencia() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [col, setCol] = useState<IAConfigsCol>({ ativa: null, configs: [] })
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!userId) {
      setCol({ ativa: null, configs: [] })
      setCarregando(false)
      return
    }
    let cancelado = false
    supabase
      .schema('arqvalor')
      .from('usuarios')
      .select('ia_configs')
      .eq('id', userId)
      .single()
      .then(({ data }) => {
        if (cancelado) return
        const raw = data?.ia_configs as IAConfigsCol | null | undefined
        if (raw && Array.isArray(raw.configs)) {
          setCol({ ativa: raw.ativa ?? null, configs: raw.configs })
        }
        setCarregando(false)
      })
    return () => { cancelado = true }
  }, [userId])

  const persistir = useCallback(async (novo: IAConfigsCol): Promise<{ ok: boolean; erro?: string }> => {
    if (!userId) return { ok: false, erro: 'Sessão expirada.' }
    setSalvando(true)
    const { error } = await supabase
      .schema('arqvalor')
      .from('usuarios')
      .update({ ia_configs: novo })
      .eq('id', userId)
    setSalvando(false)
    if (error) return { ok: false, erro: error.message }
    setCol(novo)
    return { ok: true }
  }, [userId])

  /** Adiciona nova config. Se for a primeira, vira ativa automaticamente. */
  const adicionar = useCallback(async (
    provedor: string,
    api_key:  string,
    nome?:    string,
  ): Promise<{ ok: boolean; erro?: string }> => {
    const p = provedorPorId(provedor)
    if (!p) return { ok: false, erro: 'Provedor inválido.' }
    if (!api_key.trim()) return { ok: false, erro: 'Informe a chave da API.' }
    if (!p.formato.test(api_key.trim())) {
      return { ok: false, erro: `Formato da chave parece incorreto. Esperado: ${p.formatoDica}` }
    }
    const nova: IAConfig = {
      id: id(),
      provedor: p.id,
      api_key: api_key.trim(),
      nome: nome?.trim() || undefined,
    }
    const novo: IAConfigsCol = {
      configs: [...col.configs, nova],
      ativa:   col.ativa ?? nova.id,
    }
    return persistir(novo)
  }, [col, persistir])

  /** Atualiza uma config existente. `api_key` vazia mantém a anterior. */
  const atualizar = useCallback(async (
    configId: string,
    patch: { provedor?: string; api_key?: string; nome?: string },
  ): Promise<{ ok: boolean; erro?: string }> => {
    const idx = col.configs.findIndex(c => c.id === configId)
    if (idx < 0) return { ok: false, erro: 'Configuração não encontrada.' }
    const atual = col.configs[idx]
    const proxProv = patch.provedor ?? atual.provedor
    const p = provedorPorId(proxProv)
    if (!p) return { ok: false, erro: 'Provedor inválido.' }
    const proxKey = (patch.api_key && patch.api_key.trim()) || atual.api_key
    if (patch.api_key && patch.api_key.trim() && !p.formato.test(patch.api_key.trim())) {
      return { ok: false, erro: `Formato da chave parece incorreto. Esperado: ${p.formatoDica}` }
    }
    const proxNome = patch.nome !== undefined ? (patch.nome.trim() || undefined) : atual.nome
    const novos = [...col.configs]
    novos[idx] = { ...atual, provedor: p.id, api_key: proxKey, nome: proxNome }
    return persistir({ ...col, configs: novos })
  }, [col, persistir])

  /** Define qual config é a ativa. */
  const ativar = useCallback(async (configId: string): Promise<{ ok: boolean; erro?: string }> => {
    if (!col.configs.find(c => c.id === configId)) {
      return { ok: false, erro: 'Configuração não encontrada.' }
    }
    return persistir({ ...col, ativa: configId })
  }, [col, persistir])

  /** Remove uma config. Se era a ativa, ativa a primeira restante (ou null). */
  const remover = useCallback(async (configId: string): Promise<{ ok: boolean; erro?: string }> => {
    const novos = col.configs.filter(c => c.id !== configId)
    const novaAtiva = col.ativa === configId
      ? (novos[0]?.id ?? null)
      : col.ativa
    return persistir({ ativa: novaAtiva, configs: novos })
  }, [col, persistir])

  const ativa = col.configs.find(c => c.id === col.ativa) ?? null
  const provedorAtivo = ativa ? provedorPorId(ativa.provedor) : null

  return {
    ativa,
    provedorAtivo,
    configs: col.configs,
    carregando,
    salvando,
    adicionar,
    atualizar,
    ativar,
    remover,
  }
}
