// src/hooks/useIAPreferencia.ts
//
// Gerencia múltiplas configurações de IA do usuário, com UMA marcada
// como ativa. Persistido em `arqvalor.usuarios.ia_configs` (JSONB)
// pela edge function `ia_configs`, que criptografa a `api_key` com
// AES-256-GCM antes de gravar.
//
// IMPORTANTE: o frontend NÃO tem acesso à chave bruta. Só recebe a
// `mascara` (ex.: "sk-ant-...f4a2") suficiente para identificar visual.
// Para editar, basta digitar uma nova chave; deixar em branco mantém
// a chave atual.

import { useCallback, useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { apiFetch, apiMutate } from '../lib/api'
import { provedorPorId } from '../lib/iaProvedores'
import type { IAProvedor } from '../lib/iaProvedores'

export interface IAConfig {
  id:       string
  provedor: string
  mascara:  string         // ex.: "sk-ant-...f4a2"
  nome?:    string | null
}

interface IAConfigsCol {
  ativa:   string | null
  configs: IAConfig[]
}

export interface EstadoIA {
  ativa:        IAConfig | null
  provedorAtivo: IAProvedor | null
  configs:      IAConfig[]
  carregando:   boolean
}

export function useIAPreferencia() {
  const { session } = useAuth()
  const userId = session?.user?.id
  const [col, setCol] = useState<IAConfigsCol>({ ativa: null, configs: [] })
  const [carregando, setCarregando] = useState(true)
  const [salvando, setSalvando] = useState(false)

  useEffect(() => {
    if (!userId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCol({ ativa: null, configs: [] })
      setCarregando(false)
      return
    }
    let cancelado = false
    apiFetch<IAConfigsCol>('/ia_configs').then(r => {
      if (cancelado) return
      if (r.ok && r.dados) {
        setCol({ ativa: r.dados.ativa ?? null, configs: r.dados.configs ?? [] })
      }
      setCarregando(false)
    })
    return () => { cancelado = true }
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
    setSalvando(true)
    const r = await apiMutate<IAConfigsCol>('/ia_configs', 'POST', {
      provedor: p.id,
      api_key:  api_key.trim(),
      nome:     nome?.trim() || null,
    })
    setSalvando(false)
    if (!r.ok || !r.dados) return { ok: false, erro: r.erro ?? 'Falha ao salvar.' }
    setCol({ ativa: r.dados.ativa ?? null, configs: r.dados.configs ?? [] })
    return { ok: true }
  }, [])

  /** Atualiza uma config existente. `api_key` vazia mantém a anterior. */
  const atualizar = useCallback(async (
    configId: string,
    patch: { provedor?: string; api_key?: string; nome?: string | null },
  ): Promise<{ ok: boolean; erro?: string }> => {
    if (patch.provedor) {
      const p = provedorPorId(patch.provedor)
      if (!p) return { ok: false, erro: 'Provedor inválido.' }
      if (patch.api_key && patch.api_key.trim() && !p.formato.test(patch.api_key.trim())) {
        return { ok: false, erro: `Formato da chave parece incorreto. Esperado: ${p.formatoDica}` }
      }
    }
    setSalvando(true)
    const r = await apiMutate<IAConfigsCol>(`/ia_configs/${configId}`, 'PUT', {
      provedor: patch.provedor,
      api_key:  patch.api_key?.trim() || undefined,
      nome:     patch.nome === undefined ? undefined : (patch.nome ?? null),
    })
    setSalvando(false)
    if (!r.ok || !r.dados) return { ok: false, erro: r.erro ?? 'Falha ao salvar.' }
    setCol({ ativa: r.dados.ativa ?? null, configs: r.dados.configs ?? [] })
    return { ok: true }
  }, [])

  /** Define qual config é a ativa. */
  const ativar = useCallback(async (configId: string): Promise<{ ok: boolean; erro?: string }> => {
    setSalvando(true)
    const r = await apiMutate<IAConfigsCol>(`/ia_configs/${configId}/ativar`, 'PUT', {})
    setSalvando(false)
    if (!r.ok || !r.dados) return { ok: false, erro: r.erro ?? 'Falha ao ativar.' }
    setCol({ ativa: r.dados.ativa ?? null, configs: r.dados.configs ?? [] })
    return { ok: true }
  }, [])

  /** Testa uma config fazendo uma chamada mínima ao provedor. */
  const testar = useCallback(async (configId: string): Promise<{ ok: boolean; mensagem: string }> => {
    const r = await apiMutate<{ ok: boolean; mensagem: string }>(`/ia_configs/${configId}/testar`, 'PUT', {})
    if (!r.ok || !r.dados) {
      return { ok: false, mensagem: r.erro ?? 'Falha ao testar configuração.' }
    }
    return r.dados
  }, [])

  /** Remove uma config. Se era a ativa, ativa a primeira restante (ou null). */
  const remover = useCallback(async (configId: string): Promise<{ ok: boolean; erro?: string }> => {
    setSalvando(true)
    const r = await apiMutate<IAConfigsCol>(`/ia_configs/${configId}`, 'DELETE')
    setSalvando(false)
    if (!r.ok || !r.dados) return { ok: false, erro: r.erro ?? 'Falha ao remover.' }
    setCol({ ativa: r.dados.ativa ?? null, configs: r.dados.configs ?? [] })
    return { ok: true }
  }, [])

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
    testar,
  }
}
