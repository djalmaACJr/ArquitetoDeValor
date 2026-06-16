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

  // Objetivos financeiros
  objetivos:       (uid: Uid, f?: unknown)   => ['objetivos', uid, f ?? null] as const,
  objetivoDetalhe: (uid: Uid, id: string)    => ['objetivos', uid, id]        as const,

  // Investimentos
  invAtivos:     (uid: Uid, f?: unknown) => ['inv-ativos', uid, f ?? null]     as const,
  invAtivo:      (uid: Uid, id: string)  => ['inv-ativos', uid, id]            as const,
  invPosicoes:   (uid: Uid, f?: unknown) => ['inv-posicoes', uid, f ?? null]   as const,
  invOperacoes:  (uid: Uid, f?: unknown) => ['inv-operacoes', uid, f ?? null]  as const,
  invDividendos: (uid: Uid, f?: unknown) => ['inv-dividendos', uid, f ?? null] as const,
  invTiposDividendo: (uid: Uid)          => ['inv-tipos-dividendo', uid]       as const,
  invAvisosDividendos: (uid: Uid)        => ['inv-avisos-dividendos', uid]     as const,
  invNovidadesProventos: (uid: Uid)      => ['inv-novidades-proventos', uid]   as const,
  invAlocacoes:  (uid: Uid)              => ['inv-alocacoes', uid]             as const,
  invHistorico:  (uid: Uid, f?: unknown) => ['inv-historico', uid, f ?? null]  as const,
  invDashboard:  (uid: Uid, contaId?: string | null) => ['inv-dashboard', uid, contaId ?? null] as const,
  invRanking:    (uid: Uid, contaId?: string | null) => ['inv-ranking', uid, contaId ?? null]   as const,

  // Prefixos para INVALIDAÇÃO — chave de 2 elementos que casa (por prefixo)
  // todas as variações de parâmetro da mesma família, sem repetir strings
  // cruas nos hooks. (As famílias sem parâmetro acima já servem de prefixo.)
  invAtivosPref:     (uid: Uid) => ['inv-ativos', uid]     as const,
  invPosicoesPref:   (uid: Uid) => ['inv-posicoes', uid]   as const,
  invOperacoesPref:  (uid: Uid) => ['inv-operacoes', uid]  as const,
  invDividendosPref: (uid: Uid) => ['inv-dividendos', uid] as const,
  invHistoricoPref:  (uid: Uid) => ['inv-historico', uid]  as const,
  invDashboardPref:  (uid: Uid) => ['inv-dashboard', uid]  as const,
  invRankingPref:    (uid: Uid) => ['inv-ranking', uid]    as const,
  transacoesMesPref: (uid: Uid) => ['transacoes-mes', uid] as const,
}
