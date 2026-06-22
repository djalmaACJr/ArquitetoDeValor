// src/lib/constants.ts
// Fonte única de enums do domínio. Manter sincronizado com:
//   supabase/migrations/* (CHECK constraints e ENUMs)
//   supabase/functions/_shared/utils.ts e edge functions (validações)

// ── Tipos de conta ───────────────────────────────────────────
export const TIPOS_CONTA = ['CORRENTE', 'REMUNERACAO', 'CARTAO', 'INVESTIMENTO', 'CARTEIRA'] as const
export type TipoConta = typeof TIPOS_CONTA[number]

// ── Tipos de transação ───────────────────────────────────────
export const TIPOS_TX = ['RECEITA', 'DESPESA'] as const
export type TipoTransacao = typeof TIPOS_TX[number]

// Tipo estendido usado no DrawerLancamento (transferência é UI-only;
// no banco vira par RECEITA + DESPESA)
export const TIPOS_LANCAMENTO_UI = ['RECEITA', 'DESPESA', 'TRANSFERENCIA'] as const
export type TipoLancamentoUI = typeof TIPOS_LANCAMENTO_UI[number]

// ── Status de transação ──────────────────────────────────────
export const STATUS_TX = ['PAGO', 'PENDENTE', 'PROJECAO'] as const
export type StatusTransacao = typeof STATUS_TX[number]

// ── Frequências de recorrência ───────────────────────────────
export const FREQUENCIAS = ['DIARIA', 'SEMANAL', 'MENSAL', 'ANUAL'] as const
export type Frequencia = typeof FREQUENCIAS[number]

// ── Escopos de edição/exclusão de série recorrente ───────────
export const ESCOPOS_EDICAO = ['SOMENTE_ESTE', 'ESTE_E_SEGUINTES', 'TODOS'] as const
export type EscopoEdicao = typeof ESCOPOS_EDICAO[number]

// ── Tipo de recorrência (interno do banco) ───────────────────
export const TIPOS_RECORRENCIA_BANCO = ['PARCELA', 'PROJECAO'] as const
export type TipoRecorrenciaBanco = typeof TIPOS_RECORRENCIA_BANCO[number]

// ── Objetivos Financeiros ─────────────────────────────────────
export const TIPOS_OBJETIVO = ['SONHO', 'OBJETIVO', 'PROJETO', 'CRESCIMENTO'] as const
export type TipoObjetivo = typeof TIPOS_OBJETIVO[number]

export const STATUS_OBJETIVO = ['EM_PROGRESSO', 'ATINGIDO', 'CANCELADO'] as const
export type StatusObjetivo = typeof STATUS_OBJETIVO[number]

// Rótulos de APRESENTAÇÃO dos tipos de objetivo. Os valores internos
// (banco/API) permanecem SONHO/OBJETIVO/PROJETO/CRESCIMENTO — só muda
// a exibição, mesmo padrão do mascote "sabio" → "Conselheiro".
//   SONHO       → Patrimônio       (meta de acúmulo de saldo em contas)
//   OBJETIVO    → Renda Recorrente (receitas por categoria ao longo do tempo)
//   CRESCIMENTO → Evolução Anual   (comparações YoY de receitas)
export const TIPO_OBJETIVO_LABEL: Record<TipoObjetivo, string> = {
  SONHO:       'Patrimônio',
  OBJETIVO:    'Renda Recorrente',
  PROJETO:     'Projeto',
  CRESCIMENTO: 'Evolução Anual',
}

export const TIPO_OBJETIVO_EMOJI: Record<TipoObjetivo, string> = {
  SONHO:       '💰',
  OBJETIVO:    '🎯',
  PROJETO:     '📦',
  CRESCIMENTO: '📈',
}

// ── Investimentos ─────────────────────────────────────────────
export const TIPOS_ATIVO_INV = [
  'ACOES', 'ETF', 'FII', 'REIT', 'STOCKS',
  'ETF_INTERNACIONAL', 'RENDA_FIXA', 'CRIPTOMOEDAS', 'TESOURO_DIRETO',
] as const
export type TipoAtivoInvestimento = typeof TIPOS_ATIVO_INV[number]

export const STATUS_POSICAO_INV = ['ATIVA', 'ENCERRADA'] as const
export type StatusPosicaoInvestimento = typeof STATUS_POSICAO_INV[number]

export const TIPOS_OPERACAO_INV = ['COMPRA', 'VENDA', 'APORTE', 'RESGATE', 'DIVIDENDO'] as const
export type TipoOperacaoInvestimento = typeof TIPOS_OPERACAO_INV[number]

// Rótulos amigáveis e cor consistente por tipo de ativo
export const TIPO_ATIVO_LABEL: Record<TipoAtivoInvestimento, string> = {
  ACOES:             'Ações',
  ETF:               'ETF',
  FII:               'FIIs',
  REIT:              'REITs',
  STOCKS:            'Stocks',
  ETF_INTERNACIONAL: 'ETF Internacional',
  RENDA_FIXA:        'Renda Fixa',
  CRIPTOMOEDAS:      'Criptomoedas',
  TESOURO_DIRETO:    'Tesouro Direto',
}

export const TIPO_ATIVO_COR: Record<TipoAtivoInvestimento, string> = {
  ACOES:             '#3b82f6',
  ETF:               '#06b6d4',
  FII:               '#00c896',
  REIT:              '#14b8a6',
  STOCKS:            '#8b5cf6',
  ETF_INTERNACIONAL: '#ec4899',
  RENDA_FIXA:        '#f59e0b',
  CRIPTOMOEDAS:      '#f97316',
  TESOURO_DIRETO:    '#10b981',
}

// ── Renda Fixa / Tesouro Direto ───────────────────────────────

export const SUBTIPOS_RF = ['TESOURO', 'CDB', 'LCI', 'LCA', 'CRI', 'CRA', 'DEBENTURE', 'OUTRO'] as const
export type SubtipoRF = typeof SUBTIPOS_RF[number]

export const INDEXADORES_RF = ['PREFIXADO', 'POS_FIXADO', 'HIBRIDO'] as const
export type IndexadorRF = typeof INDEXADORES_RF[number]

// Índice de referência (benchmark) da renda fixa pós-fixada/híbrida.
export const INDICES_RF = ['CDI', 'SELIC', 'IPCA', 'IGPM'] as const
export type IndiceRF = typeof INDICES_RF[number]

export const INDICE_RF_LABEL: Record<IndiceRF, string> = {
  CDI:   'CDI',
  SELIC: 'Selic',
  IPCA:  'IPCA',
  IGPM:  'IGP-M',
}

// Quais índices fazem sentido por forma de rentabilidade: pós-fixado segue
// juros (CDI/Selic); híbrido soma uma taxa fixa a um índice de inflação.
export const INDICES_POR_INDEXADOR: Record<IndexadorRF, readonly IndiceRF[]> = {
  PREFIXADO:  [],
  POS_FIXADO: ['CDI', 'SELIC'],
  HIBRIDO:    ['IPCA', 'IGPM'],
}

export const INDEXADOR_RF_LABEL: Record<IndexadorRF, string> = {
  PREFIXADO:  'Prefixado',
  POS_FIXADO: 'Pós-fixado',
  HIBRIDO:    'Híbrido (inflação +)',
}

// Como funciona cada dinâmica de rendimento — exibido como ajuda no
// formulário e no detalhe do ativo
export const INDEXADOR_RF_DESCRICAO: Record<IndexadorRF, string> = {
  PREFIXADO:
    'Taxa exata conhecida na compra (ex.: 11,5% a.a.). Rendimento linear, ' +
    'mas pode perder poder de compra se a inflação subir demais.',
  POS_FIXADO:
    'Acompanha um indicador que varia no tempo, geralmente CDI ou Selic. Pode ser ' +
    'um percentual do índice (ex.: 110% do CDI) ou o índice mais um spread (ex.: CDI + 2%) ' +
    '— formas diferentes! Juros do país sobem → rendimento sobe; caem → acompanha a queda.',
  HIBRIDO:
    'Taxa fixa + indexador de inflação (ex.: IPCA + 6% a.a.). Excelente para o ' +
    'longo prazo: garante ganho real acima do aumento do custo de vida.',
}

// Características padrão por subtipo (tabela de referência). Tudo é
// editável no formulário — ex.: debênture incentivada é isenta de IR.
export interface SubtipoRFInfo {
  label:      string
  emissor:    string   // emissor típico (placeholder do campo)
  fgc:        boolean  // coberto pelo FGC (até R$ 250 mil)
  isentoIR:   boolean  // isento de Imposto de Renda
  obsIR:      string   // texto exibido sobre IR
}

export const SUBTIPO_RF_INFO: Record<SubtipoRF, SubtipoRFInfo> = {
  TESOURO:   { label: 'Tesouro Direto', emissor: 'Governo Federal', fgc: false, isentoIR: false, obsIR: 'Tabela regressiva (22,5% → 15%)' },
  CDB:       { label: 'CDB',            emissor: 'Banco',           fgc: true,  isentoIR: false, obsIR: 'Tabela regressiva (22,5% → 15%)' },
  LCI:       { label: 'LCI',            emissor: 'Banco',           fgc: true,  isentoIR: true,  obsIR: 'Isento de IR' },
  LCA:       { label: 'LCA',            emissor: 'Banco',           fgc: true,  isentoIR: true,  obsIR: 'Isento de IR' },
  CRI:       { label: 'CRI',            emissor: 'Securitizadora',  fgc: false, isentoIR: true,  obsIR: 'Isento de IR' },
  CRA:       { label: 'CRA',            emissor: 'Securitizadora',  fgc: false, isentoIR: true,  obsIR: 'Isento de IR' },
  DEBENTURE: { label: 'Debênture',      emissor: 'Empresa',         fgc: false, isentoIR: false, obsIR: 'Regressiva — ou isenta, se incentivada' },
  OUTRO:     { label: 'Outro',          emissor: '',                fgc: false, isentoIR: false, obsIR: 'Verifique as condições do título' },
}

// Subtipos oferecidos no formulário conforme o tipo do ativo
export function subtiposParaTipo(tipo: TipoAtivoInvestimento): SubtipoRF[] {
  if (tipo === 'TESOURO_DIRETO') return ['TESOURO']
  if (tipo === 'RENDA_FIXA')     return ['CDB', 'LCI', 'LCA', 'CRI', 'CRA', 'DEBENTURE', 'OUTRO']
  return []
}

// ── Fundos Imobiliários (FII) ─────────────────────────────────

export const CATEGORIAS_FII = ['TIJOLO', 'PAPEL', 'FOF', 'DESENVOLVIMENTO', 'OUTRO'] as const
export type CategoriaFII = typeof CATEGORIAS_FII[number]

export interface CategoriaFIIInfo {
  label:      string
  compra:     string   // o que o fundo compra
  fonteLucro: string   // principal fonte de lucro
  risco:      string   // nível de risco
  vantagem:   string   // principal vantagem
}

export const FII_CATEGORIA_INFO: Record<CategoriaFII, CategoriaFIIInfo> = {
  TIJOLO: {
    label:      'Tijolo',
    compra:     'Imóveis físicos (prédios, shoppings, galpões)',
    fonteLucro: 'Aluguéis mensais e valorização do imóvel',
    risco:      'Moderado',
    vantagem:   'Proteção real do patrimônio contra a inflação',
  },
  PAPEL: {
    label:      'Papel',
    compra:     'Títulos de dívida imobiliária (CRIs, LCIs)',
    fonteLucro: 'Juros recebidos desses títulos',
    risco:      'Moderado',
    vantagem:   'Dividendos mais altos quando juros/inflação sobem',
  },
  FOF: {
    label:      'FoF (Fundo de Fundos)',
    compra:     'Cotas de outros fundos imobiliários',
    fonteLucro: 'Dividendos e venda de cotas com lucro',
    risco:      'Baixo a Moderado',
    vantagem:   'Alta diversificação com investimento inicial baixo',
  },
  DESENVOLVIMENTO: {
    label:      'Desenvolvimento',
    compra:     'Projetos na planta ou terrenos em obras',
    fonteLucro: 'Venda ou aluguel do imóvel após concluído',
    risco:      'Alto',
    vantagem:   'Potencial de ganho financeiro muito acima da média',
  },
  OUTRO: {
    label:      'Outro / Misto',
    compra:     'Estratégia mista ou específica do fundo',
    fonteLucro: 'Depende da estratégia',
    risco:      'Variável',
    vantagem:   'Verifique o regulamento do fundo',
  },
}

// ── Ações: subtipo (ON/PN/UNIT/BDR) ───────────────────────────
export const ACOES_SUBTIPOS = ['ON', 'PN', 'UNIT', 'BDR'] as const
export type AcoesSubtipo = typeof ACOES_SUBTIPOS[number]

export const ACOES_SUBTIPO_LABEL: Record<AcoesSubtipo, string> = {
  ON:   'Ordinária (ON)',
  PN:   'Preferencial (PN)',
  UNIT: 'Unit',
  BDR:  'BDR',
}

export const ACOES_SUBTIPO_DESCRICAO: Record<AcoesSubtipo, string> = {
  ON:   'Ação ordinária — dá direito a voto nas assembleias.',
  PN:   'Ação preferencial — prioridade no recebimento de dividendos, em geral sem voto.',
  UNIT: 'Pacote de ações (ON + PN) negociado como uma única unidade.',
  BDR:  'Brazilian Depositary Receipt — recibo de ação estrangeira negociada na B3.',
}

// Tradução do setor econômico cru da brapi (campo `sector`, em inglês) para
// rótulo em PT-BR. Fallback: devolve o valor cru se não houver tradução.
const SETOR_LABEL: Record<string, string> = {
  'Finance':                'Financeiro',
  'Energy Minerals':        'Petróleo e Gás',
  'Non-Energy Minerals':    'Mineração',
  'Utilities':              'Utilidade Pública',
  'Retail Trade':           'Varejo',
  'Health Technology':      'Saúde',
  'Health Services':        'Serviços de Saúde',
  'Consumer Non-Durables':  'Consumo não Durável',
  'Consumer Durables':      'Consumo Durável',
  'Consumer Services':      'Serviços ao Consumidor',
  'Process Industries':     'Indústria de Processo',
  'Producer Manufacturing': 'Bens Industriais',
  'Industrial Services':    'Serviços Industriais',
  'Transportation':         'Transporte',
  'Communications':         'Comunicações',
  'Technology Services':    'Tecnologia',
  'Electronic Technology':  'Tecnologia Eletrônica',
  'Distribution Services':  'Distribuição',
  'Commercial Services':    'Serviços Comerciais',
  'Miscellaneous':          'Diversos',
}

export function setorLabel(setor: string | null | undefined): string | null {
  if (!setor) return null
  return SETOR_LABEL[setor] ?? setor
}

// Área (setor/categoria) de um ativo com a melhor informação disponível:
//   • setor econômico (ações/stocks com setor preenchido pela brapi/Yahoo)
//   • categoria do FII (Tijolo/Papel/FoF…)
//   • senão, cai no tipo do ativo (ETF, Cripto, Renda Fixa…) — cestas
//     diversificadas não têm um único setor.
// Usada nos quadros de Sobreposição e Correlação da tela Avaliações.
export function areaAtivoLabel(opts: {
  setor?: string | null
  tipo: TipoAtivoInvestimento
  fii_categoria?: CategoriaFII | null
}): string {
  const s = setorLabel(opts.setor)
  if (s) return s
  if (opts.tipo === 'FII' && opts.fii_categoria) return `FII · ${FII_CATEGORIA_INFO[opts.fii_categoria].label}`
  return TIPO_ATIVO_LABEL[opts.tipo]
}

// ── Avaliação de ativos: critérios das questões ───────────────
// Cada pergunta do questionário pertence a um destes 4 critérios.
// A nota final é a média ponderada pelas notas de cada critério.
// (O id interno DIVIDENDOS é mantido por compatibilidade com questionários
// e pesos já salvos — o rótulo é "Geração de renda".)
export const CRITERIOS_QUESTAO = ['FUNDAMENTOS', 'CRESCIMENTO', 'DIVIDENDOS', 'VALUATION'] as const
export type CriterioQuestao = typeof CRITERIOS_QUESTAO[number]

export const CRITERIO_LABEL: Record<CriterioQuestao, string> = {
  FUNDAMENTOS: 'Fundamentos e governança',
  CRESCIMENTO: 'Crescimento e resiliência',
  DIVIDENDOS:  'Geração de renda',
  VALUATION:   'Margem de segurança e valuation',
}

export const CRITERIO_DESCRICAO: Record<CriterioQuestao, string> = {
  FUNDAMENTOS: 'Solidez estrutural: lucro, dívida/alavancagem, barreiras de entrada, perenidade e governança.',
  CRESCIMENTO: 'Capacidade de expansão, eficiência, escalabilidade e resiliência a ciclos e inflação.',
  DIVIDENDOS:  'Geração de renda e fluxo de caixa: regularidade e sustentabilidade do retorno em caixa.',
  VALUATION:   'Margem de segurança: múltiplos atuais, preço caro/barato no histórico e risco embutido no preço.',
}

// ── Perfil de investidor ──────────────────────────────────────
export const PERFIS_INVESTIDOR = ['CONSERVADOR', 'MODERADO', 'ARROJADO'] as const
export type PerfilInvestidorTipo = typeof PERFIS_INVESTIDOR[number]

export const PERFIL_INVESTIDOR_LABEL: Record<PerfilInvestidorTipo, string> = {
  CONSERVADOR: 'Conservador',
  MODERADO:    'Moderado',
  ARROJADO:    'Arrojado',
}

export const PERFIL_INVESTIDOR_DESCRICAO: Record<PerfilInvestidorTipo, string> = {
  CONSERVADOR: 'Prioriza segurança e renda. Baixa tolerância a oscilações; foco em preservar capital.',
  MODERADO:    'Equilibra segurança e crescimento. Aceita alguma volatilidade por retorno maior.',
  ARROJADO:    'Busca crescimento e aceita volatilidade alta em troca de maior potencial de retorno.',
}

// Pesos por critério (somam 100) sugeridos para cada perfil. São apenas
// sugestões — o usuário pode ajustar na tela de Configurações.
//   Conservador → valoriza fundamentos, renda e margem de segurança.
//   Moderado    → equilibrado.
//   Arrojado    → valoriza crescimento.
export const PESOS_SUGERIDOS_POR_PERFIL: Record<PerfilInvestidorTipo, Record<CriterioQuestao, number>> = {
  CONSERVADOR: { FUNDAMENTOS: 35, CRESCIMENTO: 10, DIVIDENDOS: 35, VALUATION: 20 },
  MODERADO:    { FUNDAMENTOS: 30, CRESCIMENTO: 25, DIVIDENDOS: 25, VALUATION: 20 },
  ARROJADO:    { FUNDAMENTOS: 25, CRESCIMENTO: 40, DIVIDENDOS: 10, VALUATION: 25 },
}
