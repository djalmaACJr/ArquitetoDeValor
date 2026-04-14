// src/types/index.ts

// ── Contas ────────────────────────────────────────────────
export type TipoConta =
  | 'CORRENTE'
  | 'REMUNERACAO'
  | 'CARTAO'
  | 'INVESTIMENTO'
  | 'CARTEIRA'

export interface Conta {
  conta_id:      string
  user_id:       string
  nome:          string
  tipo:          TipoConta
  icone:         string | null
  cor:           string | null
  ativa:         boolean
  saldo_inicial: number
  movimentacao:  number
  saldo_atual:   number
}

// ── Categorias ────────────────────────────────────────────
export interface Categoria {
  id:        string
  user_id:   string
  id_pai:    string | null
  descricao: string
  icone:     string | null
  cor:       string | null
  ativa:     boolean
  protegida: boolean
  subcategorias?: Categoria[]
}

// ── Transações ────────────────────────────────────────────
export type TipoTransacao   = 'RECEITA' | 'DESPESA'
export type StatusTransacao = 'PAGO' | 'PENDENTE' | 'PROJECAO'

export interface Transacao {
  id:               string
  user_id:          string
  conta_id:         string
  categoria_id:     string | null
  data:             string
  ano_tx:           number
  mes_tx:           number
  descricao:        string
  valor:            number
  valor_projetado:  number | null
  tipo:             TipoTransacao
  status:           StatusTransacao
  id_recorrencia:   string | null
  nr_parcela:       number | null
  total_parcelas:   number | null
  tipo_recorrencia: string | null
  observacao:       string | null
  criado_em:        string
  atualizado_em:    string
  // campos da view com saldo
  categoria_nome?:     string | null
  categoria_icone?:    string | null
  categoria_cor?:      string | null
  categoria_pai_nome?: string | null
  conta_nome?:         string | null
  conta_icone?:        string | null
  conta_cor?:          string | null
  saldo_acumulado?:    number
}

// ── Transferências ────────────────────────────────────────
export interface Transferencia {
  id_par:           string
  conta_origem_id:  string
  conta_destino_id: string
  valor:            number
  data:             string
  descricao:        string | null
  status:           StatusTransacao
  recorrente:       boolean
  total_parcelas:   number | null
  parcela_atual:    number | null
  id_debito:        string
  id_credito:       string
  criado_em:        string
  atualizado_em:    string
}

// ── Resumo mensal (dashboard) ─────────────────────────────
// Nota: user_id removido — é um tipo de agregação derivada, não uma entidade.
export interface ResumoMensal {
  mes:            string
  total_entradas: number
  total_saidas:   number
}

// ── Despesas por categoria (dashboard) ───────────────────
// Nota: user_id e mes removidos — dados derivados de agregação local.
export interface DespesaCategoria {
  categoria_id:    string
  categoria_nome:  string
  categoria_icone: string
  total:           number
}

// ── Auth ──────────────────────────────────────────────────
export interface Usuario {
  id:        string
  email:     string
  nome:      string
  criado_em: string
}
