// src/lib/queryKeys.ts
// Chaves centralizadas do TanStack Query — usadas para cache e invalidação.
//
// Convenção: a query key é um array com:
//   [recurso, userId, ...parâmetros]
//
// Por que userId na chave?
//   Defesa em profundidade contra vazamento entre usuários. Mesmo que o
//   `queryClient.clear()` da troca de sessão tenha uma janela com cache
//   residual, queries do user B nunca enxergam dados gravados sob a chave
//   do user A — as chaves são literalmente distintas.
//   Em 2026-05 o user reportou ver dados de outro usuário no Dashboard
//   logo após rodar E2E; com userId na chave isso fica impossível por
//   construção.
//
// Convém usar `null` como uid antes do login resolver — gates `enabled`
// nos hooks evitam executar o fetch nesse caso.

import type { FiltrosLancamento } from '../hooks/useLancamentos'

type Uid = string | null

export const qk = {
  contas:      (uid: Uid) => ['contas', uid]      as const,
  categorias:  (uid: Uid) => ['categorias', uid]  as const,
  filtros:     (uid: Uid) => ['filtros', uid]     as const,

  // Lançamentos por filtro — chave inclui uid + filtros para cache por consulta
  lancamentos: (uid: Uid, f: FiltrosLancamento) => ['lancamentos', uid, f] as const,

  // Lembretes — chave inclui uid + mês para cache por período
  lembretes: (uid: Uid, f: { mes?: string }) => ['lembretes', uid, f] as const,

  // Assistente — lista completa de padrões do usuário
  assistente: (uid: Uid) => ['assistente', uid] as const,

  // Dashboard fase 1 (saldos + alertas) — chave por mês
  dashboardFase1: (uid: Uid, mes: string) => ['dashboard-fase1', uid, mes] as const,

  // Transações de UM mês — chave compartilhada entre Dashboard e Lançamentos
  transacoesMes: (uid: Uid, mes: string) => ['transacoes-mes', uid, mes] as const,

  // Perfil do usuário (nome + email da tabela arqvalor.usuarios — não do JWT,
  // que pode estar desincronizado se um dos dois espelhos foi atualizado
  // diretamente via Studio/SQL)
  usuarioPerfil: (uid: Uid) => ['usuario-perfil', uid] as const,

  // Importação de fatura de cartão
  faturasImport:        (uid: Uid)               => ['faturas-import', uid] as const,
  faturaImportSessao:   (uid: Uid, id: string)   => ['faturas-import', uid, id] as const,
}
