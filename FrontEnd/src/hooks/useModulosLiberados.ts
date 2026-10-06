// src/hooks/useModulosLiberados.ts
//
// Módulos que o dono liberou ao agregado no espaço ativo — `null` em "Meus
// dados" (sem restrição). Usa as permissões ATUAIS do vínculo
// (useConvitesRecebidos) e cai no snapshot do store enquanto carrega, que pode
// estar velho se o dono mudou as permissões depois da escolha do espaço.
// Só UX (ocultar menu/tela): quem barra de verdade é o backend/RLS.

import { useEspacoAtivo } from './useEspacoAtivo'
import { useConvitesRecebidos } from './useAgregados'
import type { ModuloAgregado } from './useAgregados'

export function useModulosLiberados(): Set<ModuloAgregado> | null {
  const { vinculo } = useEspacoAtivo()
  const { aceitos } = useConvitesRecebidos()
  if (!vinculo) return null
  const atual = aceitos.find(v => v.id === vinculo.id)
  return new Set((atual?.permissoes ?? vinculo.permissoes).map(p => p.modulo))
}
