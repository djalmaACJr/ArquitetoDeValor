// src/types/index.ts

// Enums centralizados em lib/constants.ts — importados e re-exportados aqui
// para preservar `import type { TipoConta } from '../types'` existentes.
import type { TipoConta, TipoTransacao, StatusTransacao, TipoObjetivo, StatusObjetivo, Frequencia,
  TipoAtivoInvestimento, StatusPosicaoInvestimento, TipoOperacaoInvestimento,
  SubtipoRF, IndexadorRF, CategoriaFII, AcoesSubtipo } from '../lib/constants'
export type { TipoConta, TipoTransacao, StatusTransacao, TipoObjetivo, StatusObjetivo, Frequencia,
  TipoAtivoInvestimento, StatusPosicaoInvestimento, TipoOperacaoInvestimento,
  SubtipoRF, IndexadorRF, CategoriaFII, AcoesSubtipo }

export interface CartaoVirtual {
  id:      string   // uuid local, gerado no front via crypto.randomUUID()
  sufixo:  string   // últimos dígitos do cartão (2 a 8 dígitos)
  apelido: string   // até 40 chars, ex.: "Principal", "Compras online"
}

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
  limite_credito?: number | null
  cartoes_virtuais?: CartaoVirtual[]
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

// ── Lembretes ─────────────────────────────────────────────
export interface Lembrete {
  id:            string
  user_id:       string
  data:          string
  descricao:     string
  status:        'PENDENTE' | 'CONCLUIDO'
  lancamento_id: string | null
  criado_em:     string
  atualizado_em: string
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

// ── Importação de Fatura de Cartão ───────────────────────
export type StatusFaturaImport = 'EM_ANALISE' | 'CONFIRMADA' | 'CANCELADA'
export type DecisaoFaturaImport = 'PENDENTE' | 'CRIAR' | 'ATUALIZAR' | 'IGNORAR'

export interface FaturaImportSessao {
  id:                  string
  user_id:             string
  conta_id:            string
  arquivo_nome:        string
  vencimento_fatura:   string | null
  valor_total:         number | null
  status:              StatusFaturaImport
  observacao:          string | null
  // Decisões de fluxo persistidas — o usuário pode pausar a revisão e
  // voltar de onde parou sem refazer os "menus iniciais".
  modo_importacao:     'REGISTRO' | 'CATEGORIA' | null
  separar_por_cartao:  boolean | null
  criado_em:           string
  atualizado_em:       string
  // Vindo do JOIN no GET
  conta?: { id?: string; nome: string; tipo?: TipoConta; icone: string | null; cor: string | null }
  itens?: FaturaImportItem[]
}

export interface FaturaImportItem {
  id:                     string
  sessao_id:              string
  user_id:                string
  data_compra:            string
  descricao:              string
  estabelecimento:        string | null
  valor:                  number
  tipo:                   'RECEITA' | 'DESPESA'
  parcela_atual:          number | null
  parcela_total:          number | null
  decisao:                DecisaoFaturaImport
  categoria_sugerida_id:  string | null
  categoria_escolhida_id: string | null
  transacao_existente_id: string | null
  transacao_criada_id:    string | null
  hash_match:             string | null
  observacao:             string | null
  // Persistência do estado de edição (modo CATEGORIA + descrição custom):
  // grupo_chave        — identifica grupos separados manualmente. NULL = item
  //                      pertence ao grupo "default" da categoria.
  // descricao_override — descrição customizada (modo REGISTRO por item,
  //                      modo CATEGORIA replicada nos itens do grupo).
  grupo_chave:            string | null
  descricao_override:     string | null
  criado_em:              string
  atualizado_em:          string
  // Join: snapshot da transação vinculada (apenas quando transacao_existente_id != null).
  // Usado pra mostrar a descrição/status atuais da projeção/pendência em vez
  // do texto cru do PDF, evitando confusão na tela de Revisão.
  transacao_existente?:   { descricao: string; status: string; data: string } | null
}

// ── Objetivos Financeiros ─────────────────────────────────────
export interface Revisao {
  data:                string
  valor_meta_anterior: number
  motivo:              string
}

export interface SnapshotProgresso {
  data_snapshot:  string
  valor_atingido: number
  percentual:     number
}

export interface Objetivo {
  id:             string
  user_id:        string
  tipo:           TipoObjetivo
  nome:           string
  descricao:      string | null
  icone:          string
  cor:            string
  ativo:          boolean
  valor_meta:     number
  data_inicio:    string
  data_fim:       string
  conta_id:       string | null
  categoria_id:   string | null
  frequencia:     Frequencia | null
  contas_projeto:      string[]
  contas_sonho:        string[]
  categorias_objetivo: string[]
  valor_atingido: number
  percentual:     number
  status:         StatusObjetivo
  revisoes:       Revisao[]
  criado_em:      string
  atualizado_em:  string
  // campos extras da vw_objetivos_detalhes
  saldo_base:                   number
  dias_restantes:               number
  conta_nome:                   string | null
  categoria_descricao:          string | null
  crescimento_mensal_necessario: number | null
  // campo extra do GET /:id
  progresso?:     SnapshotProgresso[]
}

// ── Investimentos ─────────────────────────────────────────────
// Respostas do questionário de avaliação ({pergunta_id: indice 0..4})
export type QuestionarioRespostas = Record<string, number>

export interface InvestimentoAtivo {
  id:           string
  user_id:      string
  ticker:       string
  nome:         string
  tipo_ativo:   TipoAtivoInvestimento
  moeda:        string
  descricao:    string | null
  nota_usuario: number | null
  questionario_respostas: QuestionarioRespostas | null
  ativo_pai:    string | null
  // Características de renda fixa (só RENDA_FIXA / TESOURO_DIRETO)
  rf_subtipo:      SubtipoRF | null
  rf_indexador:    IndexadorRF | null
  rf_taxa:         string | null
  rf_emissor:      string | null
  rf_vencimento:   string | null
  rf_garantia_fgc: boolean | null
  rf_isento_ir:    boolean | null
  // Categoria do FII (só tipo_ativo = FII)
  fii_categoria:   CategoriaFII | null
  // Subtipo da ação (só tipo_ativo = ACOES)
  acoes_subtipo:   AcoesSubtipo | null
  // Quando false, o ativo é pulado pela busca automática de cotação
  cotacao_automatica: boolean
  // URL do logo/ícone oficial (brapi); null quando a fonte não fornece
  logo_url:     string | null
  // Setor econômico cru (inglês, ex.: "Finance"); null quando sem fonte
  setor:        string | null
  created_at:   string
  updated_at:   string
}

export interface InvestimentoPosicao {
  id:          string
  user_id:     string
  ativo_id:    string
  conta_id:    string
  quantidade:  number
  preco_custo: number
  valor_custo: number
  data_compra: string
  status:      StatusPosicaoInvestimento
  created_at:  string
  updated_at:  string
  // joins opcionais (GET lista)
  inv_ativos?: { ticker: string; nome: string; tipo_ativo: TipoAtivoInvestimento } | null
  contas?:     { nome: string } | null
}

export interface InvestimentoOperacao {
  id:             string
  user_id:        string
  posicao_id:     string
  tipo_operacao:  TipoOperacaoInvestimento
  conta_id:       string
  quantidade:     number
  preco_unitario: number
  valor_total:    number
  data_operacao:  string
  created_at:     string
}

export interface InvestimentoTipoDividendo {
  id:           string
  user_id:      string
  nome:         string
  categoria_id: string | null
  ativo:        boolean
  created_at:   string
  updated_at:   string
  // join opcional (GET lista)
  categorias?:  { descricao: string; icone: string | null; cor: string | null } | null
}

export interface InvestimentoDividendo {
  id:                   string
  user_id:              string
  ativo_id:             string
  conta_id:             string
  valor:                number
  data_pagamento:       string
  tipo_ativo:           TipoAtivoInvestimento
  tipo_dividendo_id:    string | null
  descricao:            string | null
  transacao_extrato_id: string | null
  created_at:           string
  inv_ativos?:          { ticker: string; nome: string } | null
  inv_tipos_dividendo?: { nome: string } | null
  // Status da transação vinculada no extrato (PROJECAO = aguardando confirmação)
  transacoes?:          { status: StatusTransacao } | null
}

export interface InvestimentoAlocacaoTipo {
  id:               string
  user_id:          string
  tipo_ativo:       TipoAtivoInvestimento
  percentual_ideal: number
  created_at:       string
  updated_at:       string
}

export interface InvestimentoHistoricoMensal {
  id:                  string
  user_id:             string
  ativo_id:            string
  conta_id:            string
  mes_ano:             string
  valor_mercado:       number
  quantidade:          number
  preco_medio:         number
  variacao_percentual: number
  rentabilidade_mes:   number
  created_at:          string
  // Join devolvido por GET /investimentos/historico-mensal
  inv_ativos?:         { ticker: string; nome: string; tipo_ativo: TipoAtivoInvestimento } | null
}

// Linha agregada por tipo de ativo, devolvida por GET /investimentos/dashboard
export interface InvestimentoDashboardTipo {
  tipo_ativo:        TipoAtivoInvestimento
  valor_custo:       number
  valor_mercado:     number
  ganho_perda:       number
  rentabilidade_pct: number
  dividendos:        number
  percentual_atual:  number
  percentual_ideal:  number
  desvio_pct:        number
}

export interface InvestimentoDashboard {
  total_custo:      number
  total_mercado:    number
  ganho_perda:      number
  total_dividendos: number
  tipos:            InvestimentoDashboardTipo[]
}

// Resultado de GET /investimentos/busca-externa (autocomplete de ticker)
export interface ResultadoBuscaAtivo {
  ticker: string
  nome:   string
  preco:  number | null
  moeda:  string
  // Preenchidos apenas pelo Tesouro Direto
  emissor?:    string
  taxa?:       string
  vencimento?: string
  indexador?:  IndexadorRF
}

// Linha por ativo, devolvida por GET /investimentos/ranking
export interface InvestimentoRankingAtivo {
  ativo_id:           string
  ticker:             string
  nome:               string
  tipo_ativo:         TipoAtivoInvestimento
  quantidade:         number
  nota_usuario:       number | null
  valor_custo:        number
  valor_mercado:      number
  ganho_perda:        number
  rentabilidade_pct:  number
  dividendos_12m:     number
  dividend_yield_pct: number
  yield_on_cost_pct:  number
  participacao_pct:   number
}

export interface InvestimentoRanking {
  total_mercado: number
  ativos:        InvestimentoRankingAtivo[]
}

// Transação candidata para vincular manualmente em importação de fatura
export interface TxCandidata {
  id:           string
  descricao:    string
  valor:        number
  data:         string
  tipo:         'RECEITA' | 'DESPESA'
  status:       string
  categoria_id: string | null
  categoria?:   { descricao: string } | null
  // Conta onde a transação existe — útil pra mostrar na UI quando a busca
  // retorna transações de contas diferentes do cartão da fatura (ex.: uma
  // projeção lançada na conta corrente).
  conta_id?:    string
  conta?:       { nome: string; tipo: string } | null
}
