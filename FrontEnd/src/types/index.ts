// src/types/index.ts

// Enums centralizados em lib/constants.ts — importados e re-exportados aqui
// para preservar `import type { TipoConta } from '../types'` existentes.
import type { TipoConta, TipoTransacao, StatusTransacao } from '../lib/constants'
export type { TipoConta, TipoTransacao, StatusTransacao }

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
  dia_fechamento?: number | null
  dia_pagamento?:  number | null
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
  id_recorrencia:       string | null
  id_par_transferencia: string | null   // identifica o par débito+crédito de uma transferência
  nr_parcela:           number | null
  total_parcelas:   number | null
  tipo_recorrencia:      string | null
  intervalo_recorrencia: number | null
  observacao:            string | null
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
  id_par:               string       // = id_par_transferencia nas transacoes
  conta_origem_id:      string
  conta_destino_id:     string
  valor:                number
  data:                 string
  descricao:            string | null
  status:               StatusTransacao
  id_recorrencia:       string | null  // recorrência independente (futuro)
  tipo_recorrencia:     string | null
  total_parcelas:       number | null
  parcela_atual:        number | null
  id_debito:            string
  id_credito:           string
  criado_em:            string
  atualizado_em:        string
}

// ── Resumo mensal (dashboard) ─────────────────────────────
// Nota: user_id removido — é um tipo de agregação derivada, não uma entidade.
export interface ResumoMensal {
  mes:            string
  total_entradas: number
  total_saidas:   number
  saldo_mes?:     number  // saldo acumulado ao final do mês
}

// ── Despesas por categoria (dashboard) ───────────────────
// Nota: user_id e mes removidos — dados derivados de agregação local.
export interface DespesaCategoria {
  categoria_id:    string
  categoria_nome:  string
  categoria_icone: string
  total:           number
}

// ── Filtros Salvos ────────────────────────────────────────
export interface FiltroSalvo {
  id:        string
  user_id:   string
  pagina:    string
  nome:      string
  dados:     Record<string, unknown>
  criado_em: string
}

// ── Auth ──────────────────────────────────────────────────
export interface Usuario {
  id:        string
  email:     string
  nome:      string
  criado_em: string
}
