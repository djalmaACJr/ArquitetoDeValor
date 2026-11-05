// Conferência da importação de fatura: quais transações do cartão ficam
// "cobertas" (atualizadas) pela confirmação. Espelha a escolha de alvo de
// supabase/functions/faturas/index.ts::confirmar — manter os dois em sincronia.

interface ItemTx {
  id: string
  decisao: string
  transacao_existente_id: string | null
  transacao_criada_id: string | null
}
interface GrupoTx { item_ids: string[]; transacao_existente_id: string | null }

/**
 * Modo CATEGORIA: cada grupo vira UM lançamento, atualizando no máximo UMA
 * transação existente (a explícita do grupo, senão a do primeiro item
 * vinculado, senão a criada numa confirmação anterior). Grupos maiores têm
 * prioridade e uma transação só é alvo de um grupo.
 *
 * Qualquer OUTRA transação vinculada a itens do grupo não é tocada: continua
 * na conta do cartão somando ao total (ex.: "Netflix" absorve o Crunchyroll,
 * mas o lançamento próprio do Crunchyroll permanece e duplica 24,90). Por isso
 * só os alvos retornados aqui contam como representados na conferência.
 */
export function alvosDosGrupos(grupos: GrupoTx[], itens: ItemTx[]): Set<string> {
  const porId = new Map(itens.map((i) => [i.id, i]))
  const usados = new Set<string>()
  const ordenados = [...grupos].sort((a, b) => (b.item_ids?.length ?? 0) - (a.item_ids?.length ?? 0))
  for (const g of ordenados) {
    const gItens = g.item_ids.map((id) => porId.get(id)).filter((i): i is ItemTx => !!i && i.decisao !== 'IGNORAR')
    if (gItens.length === 0) continue
    const alvo =
      g.transacao_existente_id ??
      gItens.find((i) => i.transacao_existente_id)?.transacao_existente_id ??
      gItens.find((i) => i.transacao_criada_id)?.transacao_criada_id ?? null
    if (alvo && !usados.has(alvo)) usados.add(alvo)
  }
  return usados
}
