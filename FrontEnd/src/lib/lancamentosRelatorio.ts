// Lançamento no formato de `/transacoes?mes=…&saldo=true` e helpers comuns aos
// relatórios que cruzam períodos (Comparativo Períodos, Progressão Anual).

export interface Lancamento {
  id: string
  tipo: 'RECEITA' | 'DESPESA'
  status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
  valor: number
  data: string
  descricao: string
  categoria_id: string | null
  categoria_nome: string | null
  categoria_pai_nome: string | null
  id_par_transferencia: string | null
}

/** Transferência entre contas — não é receita nem despesa de verdade. */
export function isTransf(l: Lancamento): boolean {
  return (
    !!l.id_par_transferencia ||
    !!l.descricao?.startsWith('[Transf.') ||
    l.categoria_nome === 'Transferências'
  )
}

/** Extrai a lista de lançamentos de uma resposta de `apiFetch` (formatos `{dados}` e `{dados:{dados}}`). */
export function parseApiRes(r: unknown): Lancamento[] {
  const res = r as { dados?: unknown }
  const d = res?.dados
  if (Array.isArray(d)) return d as Lancamento[]
  const inner = (d as { dados?: unknown })?.dados
  if (Array.isArray(inner)) return inner as Lancamento[]
  return []
}
