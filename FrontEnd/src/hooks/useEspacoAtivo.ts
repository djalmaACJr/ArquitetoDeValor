// src/hooks/useEspacoAtivo.ts
//
// Ponte React para lib/espacoAtivo.ts (store fora do React, lido também por
// lib/api.ts). `useContextoUserId()` é o substituto direto do
// `session?.user?.id` usado hoje como uid nas query keys (ver
// lib/queryKeys.ts) — ao estar num espaço de agregado, as chaves passam a
// usar o dono_id automaticamente, sem precisar tocar em cada chave.

import { useSyncExternalStore } from 'react'
import { useAuth } from './useAuth'
import {
  subscribeEspacoAtivo, getEspacoAtivoSnapshot, setEspacoAtivo,
  type VinculoAgregado, type ModuloPermissao,
} from '../lib/espacoAtivo'

export function useEspacoAtivo() {
  const { vinculo } = useSyncExternalStore(subscribeEspacoAtivo, getEspacoAtivoSnapshot)
  return { vinculo, setEspacoAtivo }
}

/** uid "efetivo" para query keys e fetches — o próprio usuário, ou o dono
 *  cujo espaço está ativo. Substitui `session?.user?.id` nos hooks de
 *  domínio que precisam respeitar o seletor de espaço (Extrato por
 *  enquanto — Objetivos/Investimentos entram nas fases seguintes). */
export function useContextoUserId(): string | null {
  const { session } = useAuth()
  const { vinculo } = useEspacoAtivo()
  return vinculo?.dono_id ?? session?.user?.id ?? null
}

/** true quando o usuário está vendo o espaço de outra pessoa (qualquer
 *  vínculo ativo) — Fase 1 é só leitura, então qualquer tela que crie/edite/
 *  exclua deve se esconder quando isto for true, independente do módulo. */
export function useEmEspacoDeAgregado(): boolean {
  const { vinculo } = useEspacoAtivo()
  return !!vinculo
}

export function usePermissaoModulo(modulo: ModuloPermissao['modulo']): ModuloPermissao | null {
  const { vinculo } = useEspacoAtivo()
  return vinculo?.permissoes.find(p => p.modulo === modulo) ?? null
}

export type { VinculoAgregado, ModuloPermissao }
