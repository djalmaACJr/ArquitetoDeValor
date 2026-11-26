// src/types/index.ts

// Enums centralizados em lib/constants.ts — importados e re-exportados aqui
// para preservar `import type { TipoConta } from '../types'` existentes.
import type { TipoConta, TipoTransacao, StatusTransacao, TipoObjetivo, StatusObjetivo, Frequencia,
  TipoAtivoInvestimento, StatusPosicaoInvestimento, TipoOperacaoInvestimento,
  SubtipoRF, IndexadorRF, IndiceRF, CategoriaFII, AcoesSubtipo,
  CriterioQuestao, PerfilInvestidorTipo } from '../lib/constants'
export type { TipoConta, TipoTransacao, StatusTransacao, TipoObjetivo, StatusObjetivo, Frequencia,
  TipoAtivoInvestimento, StatusPosicaoInvestimento, TipoOperacaoInvestimento,
  SubtipoRF, IndexadorRF, IndiceRF, CategoriaFII, AcoesSubtipo,
  CriterioQuestao, PerfilInvestidorTipo }

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
  ultima_movimentacao?: string | null
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
  /** Fora das médias de gasto (Reserva, Projeção). Na categoria pai vale para as filhas. */
  despesa_esporadica?: boolean
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
  // Caminho do PDF original no Storage; null em sessões antigas (sem PDF guardado).
  arquivo_path?:       string | null
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
  // valor_atingido do snapshot mais recente com ~25+ dias de idade — usado
  // pra destacar objetivos com tendência de piora; null sem histórico suficiente
  valor_atingido_anterior:      number | null
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
  rf_indice:            IndiceRF | null
  rf_percentual_indice: number | null
  rf_taxa_fixa:         number | null
  // Taxa escalonada por valor aplicado (ex.: CDB "até R$10.000 = 120% CDI,
  // acima = 100% CDI") — só no pós-fixado "% do índice". Tudo-ou-nada.
  rf_limite_faixa:        number | null
  rf_percentual_indice_2: number | null
  rf_taxa:         string | null
  rf_emissor:      string | null
  rf_vencimento:   string | null
  rf_garantia_fgc: boolean | null
  rf_isento_ir:    boolean | null
  // Categoria do FII (só tipo_ativo = FII)
  fii_categoria:   CategoriaFII | null
  // Valor patrimonial por cota do FII — usado para calcular o indicador P/VP
  // (preço atual ÷ VP). Preenchido pelo cron semanal da CVM quando encontra o
  // fundo (fii_vp_origem='CVM', sempre tem prioridade) ou digitado manualmente
  // como fallback (fii_vp_origem='MANUAL') — ver BUSINESS_RULES.md.
  fii_vp:                number | null
  fii_vp_origem:          'MANUAL' | 'CVM' | null
  // Mês de referência do dado da CVM (sempre dia 1); null quando manual
  fii_vp_atualizado_em:   string | null
  // Demais indicadores do mesmo Informe Mensal da CVM — só leitura, sem
  // campo de formulário (preenchidos junto com fii_vp pelo cron/cadastro)
  fii_segmento:           string | null
  fii_mandato:            string | null
  fii_num_cotistas:       number | null
  fii_dy_mes_cvm:         number | null
  // Subtipo da ação (só tipo_ativo = ACOES)
  acoes_subtipo:   AcoesSubtipo | null
  // Fundamentos da ação (só tipo_ativo = ACOES), usados no Valor Justo
  // (fórmula de Graham: raiz de 22,5 × LPA × VPA). Preenchidos pelo cron
  // mensal da CVM (DFP: Patrimônio Líquido e Lucro Líquido do último
  // exercício anual; FCA: nº de ações — ponte ticker→CNPJ) quando encontra a
  // companhia (acao_fundamentos_origem='CVM', sempre tem prioridade) ou
  // digitados manualmente como fallback ('MANUAL') — ver cvmAcoes.ts e
  // BUSINESS_RULES.md.
  acao_lpa:                     number | null
  acao_vpa:                     number | null
  // Calculado a partir de acao_lpa/acao_vpa — null se a empresa não constar
  // no dataset da CVM ou tiver LPA/VPA <= 0 (Graham não se aplica a empresa
  // no prejuízo/patrimônio líquido negativo).
  acao_valor_justo:             number | null
  acao_fundamentos_origem:      'MANUAL' | 'CVM' | null
  // Ano do exercício anual (DFP) usado no cálculo; null quando manual
  acao_fundamentos_referencia:  string | null
  // Rendimento anual em % a.a. (só CRIPTOMOEDAS) — gera operações RENDIMENTO
  cripto_rendimento_aa: number | null
  // Desde quando a cripto rende (NULL = 1º aporte)
  cripto_rendimento_inicio: string | null
  // Base de composição do yield: DIARIA | SEMANAL | MENSAL (NULL = MENSAL)
  cripto_rendimento_periodicidade: 'DIARIA' | 'SEMANAL' | 'MENSAL' | null
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
  // Rótulo do lote (ex.: "IPCA+ 8,22% a.a.") — quando a mesma posição/título
  // tem mais de um lote comprado em taxas diferentes (ver DrawerMovimentacoes).
  rf_taxa?:    string | null
  // Só vêm preenchidos quando a GET de posições foi feita com ?ativo_id=
  // (comValorMercadoPorLote no backend — distribui o valor de mercado do
  // par ativo+conta proporcionalmente por lote).
  valor_mercado?:      number | null
  rentabilidade_pct?:  number | null
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
  // Preenchido nas 2 pernas (VENDA origem + COMPRA destino) de uma transferência de ativo.
  id_par_transferencia?: string | null
  // joins opcionais (GET lista, usados no Extrato) — presentes só quando a
  // rota efetivamente os embute (GET /investimentos/operacoes sempre embute).
  inv_posicoes?: {
    ativo_id: string; rf_taxa: string | null
    inv_ativos: { ticker: string; nome: string; tipo_ativo: TipoAtivoInvestimento; moeda: string } | null
  } | null
  contas?: { nome: string } | null
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
  // Dividendo por cota (rate B3/Polygon) — NULL em lançamento manual antigo
  valor_por_cota?:      number | null
  data_pagamento:       string
  // Data COM (última data com direito ao provento) — só disponível pra
  // proventos capturados via B3 (dividendos-cron-br); NULL em lançamento
  // manual ou provento antigo sem esse dado
  data_com?:            string | null
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

// ── Questionário de avaliação (configurável por tipo) ─────────
// Pergunta com critério (Fundamentos/Crescimento/Dividendos) e 5 opções
// ordenadas (pior → melhor). Usado tanto no default estático quanto no
// questionário custom salvo em inv_questionarios.
export interface PerguntaAvaliacao {
  id:       string
  texto:    string
  criterio: CriterioQuestao
  opcoes:   [string, string, string, string, string]
}

// Pesos por critério (somam 100). Nota final = média ponderada.
export type PesosCriterio = Record<CriterioQuestao, number>

// Questionário custom por tipo de ativo (linha de inv_questionarios).
// fii_categoria: só relevante quando tipo_ativo='FII' — '' é o custom
// GENÉRICO de FII (vale para qualquer categoria sem override mais
// específico); uma CategoriaFII concreta sobrepõe só ativos daquela
// categoria (Tijolo/Papel/FoF/Desenvolvimento/FIAGRO/Outro têm riscos
// bem diferentes entre si — ver questionarioAtivos.ts).
export interface InvQuestionario {
  id?:           string
  tipo_ativo:    TipoAtivoInvestimento
  fii_categoria: CategoriaFII | ''
  perguntas:     PerguntaAvaliacao[]
  pesos:         PesosCriterio
  origem:       'MANUAL' | 'IA'
  ia_provedor:  string | null
  ia_modelo:    string | null
  ia_gerou_em:  string | null
  created_at?:  string
  updated_at?:  string
}

// ── Avaliação da carteira pelos MENTORES (linha de inv_avaliacoes) ──
// Cada mentor é uma IA configurada (usuarios.ia_configs). A pedido do
// usuário, todos avaliam cada ativo; a nota final é a média das notas.
export interface InvAvaliacaoMentor {
  config_id: string
  nome:      string | null
  provedor:  string
  modelo:    string | null
  nota:      number | null
  respostas: QuestionarioRespostas      // { pergunta_id: indice 0..4 }
  erro:      string | null
}

export type NivelConsenso = 'ALTO' | 'MEDIO' | 'BAIXO'

export interface InvAvaliacaoConsenso {
  pesos:     PesosCriterio
  // criterio/texto: ausentes em avaliações salvas antes desse campo existir
  // (fallback: casar por id contra o questionário atual, com risco de não
  // achar se o questionário mudou desde então).
  perguntas: { id: string; criterio?: CriterioQuestao; texto?: string; media_indice: number | null; media_nota: number | null }[]
  mentores:  InvAvaliacaoMentor[]
  /** Nota consolidada de cada critério (média ponderada → nota final). */
  criterios?:      Record<CriterioQuestao, number | null>
  /** Nível de concordância entre as IAs, pela dispersão das notas. */
  nivel_consenso?: NivelConsenso
  /** Desvio-padrão das notas dos mentores (base do nível de consenso). */
  dispersao?:      number
}

// Item do histórico de avaliações de um ativo (cronológico; último = atual).
export interface InvAvaliacaoHist {
  gerado_em:  string
  nota_final: number | null
  criterios?: Record<CriterioQuestao, number | null> | null
}

export interface InvAvaliacao {
  id?:         string
  ativo_id:    string
  nota_final:  number | null
  consenso:    InvAvaliacaoConsenso
  historico?:  InvAvaliacaoHist[] | null
  gerado_em:   string
  created_at?: string
  updated_at?: string
}

// Agenda de reavaliação da carteira (usuarios.inv_avaliacao_agenda).
export type FrequenciaAgenda =
  | 'NENHUMA' | 'SEMANAL' | 'QUINZENAL' | 'MENSAL' | 'TRIMESTRAL' | 'SEMESTRAL' | 'ANUAL'

export interface InvAvaliacaoAgenda {
  frequencia: FrequenciaAgenda
}

// Perfil de investidor (usuarios.inv_perfil — JSONB inline).
export interface PerfilInvestidor {
  perfil:              PerfilInvestidorTipo
  idade:               number | null  // null quando a data de nascimento não foi informada no Perfil
  idade_aposentadoria: number | null  // opcional — melhora a estimativa de horizonte
  suitability:         Record<string, number>
  renda_substituir?:   number | null   // renda-alvo a substituir (regra dos 4%); null = usar a média das receitas
  atualizado_em:       string
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
  atualizado_em?:      string | null  // última cotação gravada neste snapshot
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

// Indicador de mercado (benchmark) que o usuário escolhe acompanhar na
// página "Gerenciar dados" — ver GET/POST/DELETE /investimentos/indicadores.
export type TipoIndicador = 'ETF' | 'ETF_INTERNACIONAL' | 'INDICE'

export interface InvIndicador {
  id:        string
  ticker:    string
  tipo:      TipoIndicador
  nome:      string
  moeda:     string
  cor:       string | null
  criado_em: string
}

export interface PontoIndicador { competencia: string; valor: number } // valor: preço no mês

// Lista curada de índices B3 puros (não negociáveis, sem busca externa —
// ver indicadores.ts) oferecida pelo backend em GET /investimentos/indicadores.
export interface OpcaoIndiceB3 { ticker: string; nome: string }

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
  // Projetado (padrão investidor10): rate 12m do FUNDO × qtd atual ÷ mercado/custo
  dividend_yield_pct: number
  yield_on_cost_pct:  number
  // Real: proventos efetivamente recebidos nos 12m ÷ mercado/custo
  dy_real_pct:        number
  yoc_real_pct:       number
  // false = posse < 12 meses (real e projetado divergem; UI mostra os dois)
  posse_12m:          boolean
  participacao_pct:   number
  // ── Página "Destaques" (filtro de período: Semana/Mês/Semestre/Ano/Tudo) ──
  // Com periodo=TUDO (default) estes campos replicam os "desde a compra"
  // acima (valor_mercado_inicio_periodo = valor_custo).
  valor_mercado_inicio_periodo: number
  rentabilidade_periodo_pct:    number
  dividendos_periodo:           number
  dy_periodo_pct:                number
  // true = a posse começou DEPOIS do início nominal do período (ou a fonte
  // não tinha preço histórico pra data) — o retorno mostrado é "desde a
  // compra", não o período inteiro selecionado.
  periodo_desde_compra: boolean
}

// Período do filtro de "Destaques" — ver GET /investimentos/ranking?periodo=
// 'MES' = últimos 30 dias corridos (rótulo na UI é "Últimos 30 dias", não
// "mês calendário" — esse é o 'MES_ATUAL').
export type PeriodoRanking =
  'SEMANA' | 'MES_ATUAL' | 'MES' | 'SEMESTRE' | 'ANO_ATUAL' | 'ANO' | 'DOIS_ANOS' | 'CINCO_ANOS' | 'TUDO'

// Ranking por categoria (Tipo de Ativo) — topo da página de Destaques
export interface InvestimentoRankingCategoria {
  tipo_ativo:                    TipoAtivoInvestimento
  valor_mercado:                 number
  valor_mercado_inicio_periodo:  number
  rentabilidade_periodo_pct:     number
  dividendos_periodo:            number
  dy_periodo_pct:                number
  participacao_pct:              number
}

export interface InvestimentoRanking {
  total_mercado: number
  periodo?:      PeriodoRanking
  ativos:        InvestimentoRankingAtivo[]
  categorias?:   InvestimentoRankingCategoria[]
  // % do período composto mês a mês (líquido de fluxo) pro total geral —
  // null quando indisponível (ex.: periodo=TUDO), aí o frontend cai pro
  // cálculo simples a partir das categorias (ver RankingCategorias).
  rentabilidade_periodo_pct_total?: number | null
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

// ── Análise de Relatórios Gerenciais de FIIs (v7.7.0) ──────────────────────
export type VereditoRelatorio = 'POSITIVO' | 'NEUTRO' | 'ATENCAO' | 'NEGATIVO'

// Etapa 2 da análise (v7.9.0): "o que isso significa para mim" — perfil, posição, peso na carteira e tempo de casa.
export type AlinhamentoPessoal = 'ADEQUADO' | 'ATENCAO' | 'REVISAR'
export interface AnalisePessoalRelatorio {
  alinhamento: AlinhamentoPessoal
  resumo:      string
  pontos:      string[]
  gerada_em:   string
  provedor:    string | null
  modelo:      string | null
  mentor_nome: string | null
}

export interface AnaliseRelatorioFii {
  id:              string
  ativo_id:        string
  relatorio_id:    number | null   // relatório de FII (Fundos.NET)
  documento_id?:   string | null   // OU documento de resultado (CVM/EDGAR) de ações e stocks
  data_referencia: string | null
  veredito:        VereditoRelatorio
  resumo:          string
  pontos_fortes:   string[]
  pontos_atencao:  string[]
  inconsistencias: string[]
  mudancas:        string | null
  provedor:        string | null
  modelo:          string | null
  mentor_nome?:    string | null   // apelido do mentor (config de IA) que fez a análise
  analise_pessoal?: AnalisePessoalRelatorio | null   // etapa 2 (sob demanda); null = ainda não gerada
  origem:          'CRON' | 'MANUAL'
  visto_em:        string | null
  created_at:      string
  inv_ativos?:          { ticker: string; nome: string } | null
  inv_relatorios_fii?:  { url_documento: string; fundo_nome: string; data_entrega: string } | null
  inv_documentos_resultado?: { url_documento: string | null; emissor_nome: string; data_entrega: string; tipo_doc: string; fonte: 'EDGAR' | 'CVM' } | null
}

// Alerta de FII "em vias de mudar de forma" (liquidação, fusão, transformação,
// troca de código) — GET /investimentos/alertas-fii.
export type TipoAlertaFii = 'LIQUIDACAO' | 'INCORPORACAO' | 'TRANSFORMACAO' | 'TROCA_CODIGO'
export interface AlertaFii {
  id:            number
  ativo_id:      string
  ticker:        string
  tipo:          TipoAlertaFii
  rotulo:        string
  categoria:     string
  data_entrega:  string
  resumo:        string | null
  url_documento: string
}

export interface RelatorioFiiDisponivel {
  id:              number | string   // FII: id numérico do Fundos.NET; ações/stocks: id textual do documento
  fundo_nome:      string
  data_referencia: string | null
  data_entrega:    string
  url_documento:   string | null
  tipo_doc?:       string            // 10-Q | 10-K | ITR | DFP (ações/stocks)
  fonte?:          'EDGAR' | 'CVM'
  analisado:       boolean
}

// Assembleias de FIIs (Fundos.NET, categoria Assembleia) — GET /investimentos/assembleias-fii (v8.0.0).
// E-mail de entrada (v8.0.0, fase 2)
export interface EmailEntradaEndereco { apelido: string; codigo: string; ativo: boolean; retencao_dias: number; resumo_ia: boolean; guardar_corpo: boolean; abrir_no_gmail: boolean; email: string }
export interface EmailEntradaRemetente { id: string; padrao: string; status: 'PERMITIDO' | 'BLOQUEADO'; origem: 'PADRAO' | 'USUARIO' | 'APROVADO'; created_at: string }
export interface EmailEntradaMensagem {
  id: string; message_id: string; remetente: string; assunto: string; recebido_em: string
  tem_corpo: boolean
  status: 'PENDENTE' | 'PROCESSADO' | 'QUARENTENA' | 'IGNORADO' | 'ERRO'
  classificacao: 'ASSEMBLEIA' | 'RENDIMENTO' | 'FATO_RELEVANTE' | 'OUTRO' | null
  resumo: string | null; trecho: string | null; visto_em: string | null
  ativo_id: string | null; inv_ativos?: { ticker: string } | null
}
export interface EmailEntrada { endereco: EmailEntradaEndereco | null; remetentes: EmailEntradaRemetente[]; mensagens: EmailEntradaMensagem[] }

export interface AnaliseAssembleiaFii {
  id:              string
  ativo_id:        string
  assembleia_id:   number
  data_evento:     string | null
  relevancia:      'ROTINA' | 'IMPORTANTE'
  resumo:          string
  quando:          string | null
  como_participar: string | null
  prazo_voto:      string | null
  prazo_voto_em:   string | null   // prazo do voto à distância, estruturado (calendário)
  pauta:           { item: string; explicacao: string }[]
  pontos_atencao:  string[]
  provedor:        string | null
  modelo:          string | null
  mentor_nome?:    string | null
  origem:          'CRON' | 'MANUAL'
  visto_em:        string | null
  created_at:      string
  inv_ativos?:          { ticker: string; nome: string } | null
  inv_assembleias_fii?: { url_documento: string; tipo: string; especie: string; fundo_nome: string; links?: { tipo: 'link' | 'email'; valor: string }[] | null } | null
}
