// Cálculo isolado (sem JSX) do quadro "Proteção do Poder de Compra" — quanto
// do provento recebido de um FII precisa ser reinvestido só pra repor a
// inflação (IPCA) sobre o valor da cota, e quanto sobra como renda real.
import type { InvestimentoDividendo, InvestimentoOperacao } from '../types'

export interface ResultadoProtecaoPoderCompra {
  valorReinvestimento: number
  rendaRealLivre: number
  /** Bruto, sem clamp — pode passar de 100% quando a inflação supera o provento. */
  percentualReinvestimento: number
  /** Bruto, sem clamp — pode ficar negativo quando a inflação supera o provento. */
  percentualRendaLivre: number
  /** Percentuais dos dois acima, já limitados a [0, 100] e somando 100 — só pra desenhar a barra. */
  percentualReinvestimentoBarra: number
  percentualRendaLivreBarra: number
  deficit: boolean
  semRendimento: boolean
  /** IPCA do período negativo (deflação) — é por isso que o reinvestimento
   *  mínimo aparece zerado, não por erro de cálculo. */
  deflacao: boolean
  /** Taxa MENSAL equivalente de fato aplicada sobre `valorPatrimonio` — quando
   *  a entrada é o IPCA acumulado 12m, este já é o valor pós-conversão
   *  (ver `calcularProtecaoPoderCompra`), útil pra exibir de volta pro
   *  usuário qual % ao mês está por trás do reinvestimento calculado. */
  taxaMensalAplicadaPct: number
  /** Cotas INTEIRAS necessárias pra cobrir `valorReinvestimento` — não dá pra
   *  comprar cota fracionada, então arredonda pra cima (quem compra menos
   *  que isso ainda perde poder de compra no mês). `null` quando não há
   *  preço de cota informado; `0` quando não há reinvestimento a cobrir. */
  cotasNecessarias: number | null
}

// IPCA acumulado nos últimos 12 meses disponíveis — composição das taxas
// mensais (juros compostos), não soma simples, mesma conta do "IPCA
// acumulado em 12 meses" divulgado oficialmente pelo IBGE. Usado como
// sugestão inicial em vez do IPCA de só o último mês: um único mês pode vir
// negativo (deflação pontual) sem refletir a tendência de inflação de
// verdade — o acumulado de 12 meses suaviza esse ruído.
export function calcularIpcaAcumulado12m(
  serieMensal: { competencia: string; valor: number }[],
): { valorPct: number; competencia: string } | null {
  if (serieMensal.length === 0) return null
  const ultimos12 = serieMensal.slice(-12)
  const fator = ultimos12.reduce((acc, p) => acc * (1 + p.valor / 100), 1)
  return { valorPct: (fator - 1) * 100, competencia: ultimos12[ultimos12.length - 1].competencia }
}

export function calcularProtecaoPoderCompra(
  valorPatrimonio: number, rendimentoTotal: number, ipca12mPct: number,
  // Reduz o reinvestimento necessário quando aportes recentes (últimos 12m)
  // já cobriram parte/toda a perda de inflação acumulada sobre o patrimônio
  // MAIS ANTIGO — ver calcularCoberturaAportes12m. 1 = sem cobertura nenhuma
  // (comportamento de antes, sem histórico de compras); 0 = totalmente
  // coberto (nada a reinvestir neste mês).
  fatorCobertura: number = 1,
  // Preço de UMA cota — só pra traduzir `valorReinvestimento` (R$) em
  // `cotasNecessarias` (nº inteiro de cotas). Opcional: sem ele, essa
  // tradução simplesmente não é calculada (fica null).
  precoCota: number | null = null,
): ResultadoProtecaoPoderCompra {
  // `ipca12mPct` chega como IPCA ACUMULADO de 12 meses (ver
  // calcularIpcaAcumulado12m). Aplicar essa taxa ANUAL direto sobre o
  // patrimônio pra comparar contra o provento de só 1 MÊS é uma
  // incompatibilidade de escala de tempo — achado real: um IPCA 12m de
  // 4,22% aplicado cru dava um "reinvestimento necessário" várias vezes
  // maior que o próprio provento mensal (>400%). Converte pro equivalente
  // MENSAL (juros compostos, raiz 12) ANTES de aplicar, pra ficar na mesma
  // unidade de tempo do provento que estamos comparando.
  const taxaMensalPct = (Math.pow(1 + ipca12mPct / 100, 1 / 12) - 1) * 100
  const fator = Math.min(1, Math.max(0, fatorCobertura))
  // Com deflação (taxa mensal negativa) não existe "reinvestimento
  // negativo" — o patrimônio já ganha poder de compra sozinho, então o
  // mínimo necessário pra proteger a cota é zero, nunca menos. Sem esse
  // piso, "renda real livre" passava de 100% do provento recebido
  // (matematicamente "correto" pela fórmula crua, mas sem sentido prático —
  // não existe mais dinheiro entrando do que o provento realmente pago).
  const valorReinvestimento = Math.max(0, valorPatrimonio * (taxaMensalPct / 100) * fator)
  const rendaRealLivre = rendimentoTotal - valorReinvestimento
  const semRendimento = rendimentoTotal <= 0
  const percentualReinvestimento = semRendimento ? 0 : (valorReinvestimento / rendimentoTotal) * 100
  const percentualRendaLivre = 100 - percentualReinvestimento
  // Clampado só pra desenhar a barra (nunca deixa o layout quebrar mesmo em
  // cenários extremos) — os percentuais "crus" acima continuam disponíveis
  // pro texto, sem esconder um eventual >100%/negativo de verdade.
  const reinvestimentoClampado = Math.min(100, Math.max(0, percentualReinvestimento))
  const cotasNecessarias = valorReinvestimento <= 0
    ? 0
    : (precoCota && precoCota > 0 ? Math.ceil(valorReinvestimento / precoCota) : null)
  return {
    valorReinvestimento,
    rendaRealLivre,
    percentualReinvestimento,
    percentualRendaLivre,
    percentualReinvestimentoBarra: reinvestimentoClampado,
    percentualRendaLivreBarra: 100 - reinvestimentoClampado,
    deficit: !semRendimento && rendaRealLivre < 0,
    semRendimento,
    deflacao: taxaMensalPct < 0,
    taxaMensalAplicadaPct: taxaMensalPct,
    cotasNecessarias,
  }
}

// ── Cobertura da inflação por novas compras/aportes ─────────────
// Se o usuário comprou mais cotas nos últimos 12 meses, esse capital novo
// pode já ter coberto (total ou parcialmente) a perda de poder de compra que
// a inflação causou sobre o patrimônio MAIS ANTIGO (comprado há mais de 12
// meses) — nesse caso, não faz sentido continuar pedindo reinvestimento
// todo mês como se nada tivesse entrado.
export interface OperacaoCompraSimples {
  data: string | Date
  quantidade: number
  preco: number
  tipo: 'COMPRA' | 'VENDA'
}

export interface ResultadoCoberturaAportes12m {
  /** Soma (quantidade × preço) das COMPRAS feitas nos últimos 12 meses. */
  totalAportes12m: number
  /** Soma (quantidade × preço) das COMPRAS feitas há mais de 12 meses — a
   *  base de patrimônio que a inflação do ano corroeu. */
  patrimonioBaseAnterior: number
  /** Quanto a inflação acumulada do ano corroeu essa base anterior, em R$. */
  perdaInflacaoAnual: number
  /** > 0: ainda falta cobrir esse tanto; <= 0: aportes já cobriram (e sobrou). */
  defasagemPendente: number
  isDefasagemCoberta: boolean
}

// Só considera operações de COMPRA (ignora VENDA) — mesmo critério pedido:
// "a entrada desse novo capital" é sempre uma compra. `agora` é parametrizável
// pra facilitar teste; por padrão é a data real.
export function calcularCoberturaAportes12m(
  historicoCompras: OperacaoCompraSimples[], ipca12mPct: number, agora: Date = new Date(),
): ResultadoCoberturaAportes12m {
  const dataLimite12m = new Date(agora)
  dataLimite12m.setMonth(dataLimite12m.getMonth() - 12)

  let totalAportes12m = 0
  let patrimonioBaseAnterior = 0
  for (const op of historicoCompras) {
    if (op.tipo !== 'COMPRA') continue
    const data = typeof op.data === 'string' ? new Date(op.data) : op.data
    const valor = op.quantidade * op.preco
    if (data >= dataLimite12m) totalAportes12m += valor
    else patrimonioBaseAnterior += valor
  }

  const perdaInflacaoAnual = patrimonioBaseAnterior * (ipca12mPct / 100)
  const defasagemPendente = perdaInflacaoAnual - totalAportes12m
  return {
    totalAportes12m,
    patrimonioBaseAnterior,
    perdaInflacaoAnual,
    defasagemPendente,
    isDefasagemCoberta: totalAportes12m >= perdaInflacaoAnual,
  }
}

export interface ResultadoProtecaoPoderCompraCompleto extends ResultadoProtecaoPoderCompra {
  cobertura: ResultadoCoberturaAportes12m
}

// Junta as duas contas: calcula a cobertura por aportes e usa a fração AINDA
// NÃO coberta da perda anual (`defasagemPendente ÷ perdaInflacaoAnual`) como
// fator de redução do reinvestimento mensal — sem aportes, o fator é 1 (nada
// muda); com a defasagem 100% coberta, o fator é 0 (nada a reinvestir).
export function calcularProtecaoPoderCompraCompleta(
  valorPatrimonio: number, rendimentoTotal: number, ipca12mPct: number,
  historicoCompras: OperacaoCompraSimples[], precoCota: number | null = null,
  agora: Date = new Date(),
): ResultadoProtecaoPoderCompraCompleto {
  const cobertura = calcularCoberturaAportes12m(historicoCompras, ipca12mPct, agora)
  const fatorCobertura = cobertura.perdaInflacaoAnual > 0
    ? Math.min(1, Math.max(0, cobertura.defasagemPendente / cobertura.perdaInflacaoAnual))
    : 1
  const base = calcularProtecaoPoderCompra(valorPatrimonio, rendimentoTotal, ipca12mPct, fatorCobertura, precoCota)
  return { ...base, cobertura }
}

export interface EntradaProtecaoPoderCompra {
  valorPatrimonio: number
  rendimentoTotal: number
  historicoCompras: OperacaoCompraSimples[]
  /** Preço de UMA cota — repassado pra calcularProtecaoPoderCompra(Completa)
   *  traduzir o reinvestimento em nº de cotas (ver cotasNecessarias). */
  precoCota: number
}

// FONTE ÚNICA dos 3 inputs de calcularProtecaoPoderCompraCompleta a partir
// dos dados brutos de UM ativo (dividendos + operações) — usada tanto pela
// página de detalhe do ativo (dados buscados por ativo_id) quanto pelo grid
// de FIIs (dados buscados em lote por tipo_ativo e depois agrupados por
// ativo), pra nunca haver DOIS jeitos de calcular a mesma coisa divergindo
// entre si — só uma fonte, alimentada por dados iguais nos dois lugares.
//
// Mesmo critério de "último dividendo" do Magic Number
// (DetalheInvestimentoPage): `dividendosDoAtivo` precisa vir ordenado do
// mais novo pro mais antigo (garantido pelo endpoint,
// `order("data_pagamento", { ascending: false })`) — pega o primeiro com
// `valor_por_cota` válido, seja uma projeção futura ou já pago, sem filtrar
// por status.
export function montarEntradaProtecaoPoderCompra(
  dividendosDoAtivo: InvestimentoDividendo[],
  operacoesDoAtivo: InvestimentoOperacao[],
  quantidadeAtual: number,
  precoCotaAtual: number,
): EntradaProtecaoPoderCompra | null {
  if (quantidadeAtual <= 0 || precoCotaAtual <= 0) return null
  const ultimoDiv = dividendosDoAtivo.find((d) => d.valor_por_cota != null && Number(d.valor_por_cota) > 0)
  const valorPorCota = ultimoDiv ? Number(ultimoDiv.valor_por_cota) : null
  if (!valorPorCota || valorPorCota <= 0) return null
  const historicoCompras: OperacaoCompraSimples[] = operacoesDoAtivo
    .filter((o) => o.tipo_operacao === 'COMPRA')
    .map((o) => ({
      data: o.data_operacao, quantidade: Number(o.quantidade), preco: Number(o.preco_unitario),
      tipo: 'COMPRA' as const,
    }))
  return {
    valorPatrimonio: precoCotaAtual * quantidadeAtual,
    rendimentoTotal: valorPorCota * quantidadeAtual,
    historicoCompras,
    precoCota: precoCotaAtual,
  }
}
