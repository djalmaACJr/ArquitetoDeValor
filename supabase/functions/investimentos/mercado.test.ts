// supabase/functions/investimentos/mercado.test.ts
//
// AUD-09 (auditoria 06/08/2026): regressão de precisão decimal no cálculo
// de renda fixa. Roda com `deno test` de DENTRO desta pasta (mesma regra
// de `deno check` — cada função tem seu próprio deno.json/import map):
//
//   cd supabase/functions/investimentos && deno test mercado.test.ts
//
// MOTIVAÇÃO: valorRF/valorRFAcumulado usam Number (double IEEE-754) e
// Math.pow em loops de composição mensal que, para posições de longa
// duração (Tesouro IPCA+ de 20-30 anos), acumulam dezenas a centenas de
// multiplicações em sequência — o tipo de código onde erro de
// arredondamento de ponto flutuante silenciosamente se acumula. Este
// arquivo NÃO testa comportamento (isso já é responsabilidade de
// 12_investimentos.test.ts), testa PRECISÃO: compara a saída de
// double-precision do código de produção contra uma referência de
// aritmética de ponto fixo (BigInt, escala 1e18 — exata, sem
// arredondamento de ponto flutuante) para os mesmos insumos.
//
// Para tornar a referência de ponto fixo computável de forma EXATA (sem
// precisar reimplementar raiz n-ésima em BigInt), os casos abaixo evitam
// expoentes fracionários no caminho de composição:
//   • valorRF (prefixado): dataCompra/dataRef separados por N*365 dias
//     exatos → dias/365 = N inteiro → (1+taxa)^N vira exponenciação
//     inteira, exata em BigInt via multiplicação repetida.
//   • valorRFAcumulado (pós-fixado/híbrido): dataCompra/dataRef caem no
//     1º dia de meses distintos → cada mês do loop tem fracao = 1 (sem
//     proração), e a série de índice é populada com uma taxa mensal FIXA
//     conhecida para todos os meses → o fallback de raiz 12ª
//     (Math.pow(x, 1/12)) nunca entra em jogo.
//   • Para o ramo aditivo (HIBRIDO / POS_FIXADO com "+"), o spread é
//     fixado em "0%" — zera spreadMes sem depender de raiz 12ª de uma
//     base ≠ 1 (Math.pow(1, 1/12) = 1 exato), permitindo isolar e validar
//     APENAS a composição da série do indexador.

import { valorRF, valorRFAcumulado, valorRFPosicoes, primeiraTaxa, type SerieIndice } from "./mercado.ts";

// ── Referência de ponto fixo (BigInt, escala 1e18) — aritmética exata,
//    sem passar por `number`/Math.pow em nenhum momento. ──────────────
const ESCALA = 1_000_000_000_000_000_000n; // 1e18

// Converte uma taxa decimal (ex.: 0.008 = 0,8%) para ponto fixo exato,
// a partir da representação em string para não introduzir erro de
// double na própria conversão.
function taxaParaFixo(taxaDecimalStr: string): bigint {
  const neg = taxaDecimalStr.startsWith("-");
  const s = neg ? taxaDecimalStr.slice(1) : taxaDecimalStr;
  const [intPart, fracPart = ""] = s.split(".");
  const fracPad = (fracPart + "0".repeat(18)).slice(0, 18);
  const v = BigInt(intPart || "0") * ESCALA + BigInt(fracPad || "0");
  return neg ? -v : v;
}

function mulFixo(a: bigint, b: bigint): bigint {
  return (a * b) / ESCALA;
}

// custo (em centavos, BigInt) composto por N fatores (1+taxa_i) exatos.
function compostoFixo(custoCentavos: bigint, fatores: bigint[]): bigint {
  let acc = ESCALA; // 1.0 em ponto fixo
  for (const f of fatores) acc = mulFixo(acc, ESCALA + f);
  return mulFixo(custoCentavos, acc);
}

function fixoParaNumero(v: bigint): number {
  return Number(v) / 1e18;
}

function assertProximo(atual: number, esperado: number, tolAbs: number, msg: string) {
  const diff = Math.abs(atual - esperado);
  if (diff > tolAbs) {
    throw new Error(
      `${msg}: esperado≈${esperado} atual=${atual} diff=${diff} (tolerância=${tolAbs})`,
    );
  }
}

// ── valorRF (PREFIXADO): expoente inteiro via N*365 dias exatos ──────

Deno.test("valorRF — prefixado, composição anual exata (N=5, 12% a.a.)", () => {
  const custo = 10_000;
  const taxaAa = 0.12;
  const dataCompra = "2015-01-01";
  const N = 5;
  const ini = new Date(`${dataCompra}T12:00:00Z`).getTime();
  const dataRef = new Date(ini + N * 365 * 86_400_000);

  const atual = valorRF(custo, dataCompra, dataRef, taxaAa);

  const custoCentavosFixo = BigInt(Math.round(custo * 100)) * (ESCALA / 100n);
  const fatorAno = taxaParaFixo("0.12");
  const esperadoFixo = compostoFixo(custoCentavosFixo, Array(N).fill(fatorAno));
  const esperado = fixoParaNumero(esperadoFixo);

  // Double precision em ~20 multiplicações não deve divergir mais que
  // frações de centavo num valor da ordem de R$17.600.
  assertProximo(atual, esperado, 1e-6, "valorRF diverge da referência de ponto fixo");
});

Deno.test("valorRF — prefixado, N=20 anos (composição longa, mesmo teste de drift)", () => {
  const custo = 50_000;
  const taxaAa = 0.085;
  const dataCompra = "2005-06-01";
  const N = 20;
  const ini = new Date(`${dataCompra}T12:00:00Z`).getTime();
  const dataRef = new Date(ini + N * 365 * 86_400_000);

  const atual = valorRF(custo, dataCompra, dataRef, taxaAa);

  const custoCentavosFixo = BigInt(Math.round(custo * 100)) * (ESCALA / 100n);
  const fatorAno = taxaParaFixo("0.085");
  const esperadoFixo = compostoFixo(custoCentavosFixo, Array(N).fill(fatorAno));
  const esperado = fixoParaNumero(esperadoFixo);

  assertProximo(atual, esperado, 1e-4, "valorRF (20 anos) diverge da referência de ponto fixo");
});

Deno.test("valorRF — taxa zero ou dias=0 retorna o custo sem alteração", () => {
  const custo = 1234.56;
  if (valorRF(custo, "2024-01-01", new Date("2024-06-01T12:00:00Z"), 0) !== custo) {
    throw new Error("taxaAa=0 deveria retornar custo inalterado");
  }
  const mesmaData = new Date("2024-01-01T12:00:00Z");
  if (valorRF(custo, "2024-01-01", mesmaData, 0.1) !== custo) {
    throw new Error("dias=0 deveria retornar custo inalterado");
  }
});

// ── valorRFAcumulado (PÓS-FIXADO / HÍBRIDO): meses inteiros exatos ───

function serieFlat(meses: string[], taxaMensal: number): SerieIndice {
  const s: SerieIndice = new Map();
  for (const m of meses) s.set(m, taxaMensal);
  return s;
}

function mesesEntreYYYYMM(inicio: string, qtd: number): string[] {
  const [anoI, mesI] = inicio.split("-").map(Number);
  const out: string[] = [];
  let y = anoI, m = mesI;
  for (let i = 0; i < qtd; i++) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

Deno.test("valorRFAcumulado — POS_FIXADO sem spread (100% do CDI), 24 meses flat", () => {
  const custo = 20_000;
  const taxaMensal = 0.008; // 0,8% a.m. flat, valor exato na série (sem fallback de raiz 12ª)
  const meses = mesesEntreYYYYMM("2022-01", 25); // 24 meses completos + o mês de referência
  const cdiSerie = serieFlat(meses, taxaMensal);
  const ipcaSerie: SerieIndice = new Map();

  const dataCompra = "2022-01-01";
  const dataRef = new Date("2024-01-01T00:00:00Z"); // exatamente 24 meses depois, dia 1

  const atual = valorRFAcumulado(
    custo, dataCompra, dataRef,
    "POS_FIXADO", "100%",
    cdiSerie, ipcaSerie,
    /* cdiAtualAa */ 0.12, /* ipcaAtualAa */ 0.04,
  );

  const custoCentavosFixo = BigInt(Math.round(custo * 100)) * (ESCALA / 100n);
  const fatorMes = taxaParaFixo("0.008");
  const esperadoFixo = compostoFixo(custoCentavosFixo, Array(24).fill(fatorMes));
  const esperado = fixoParaNumero(esperadoFixo);

  assertProximo(atual, esperado, 1e-4, "valorRFAcumulado (POS_FIXADO 100%) diverge da referência");
});

Deno.test("valorRFAcumulado — POS_FIXADO com spread zerado (CDI + 0%), 12 meses flat", () => {
  const custo = 15_000;
  const taxaMensal = 0.007;
  const meses = mesesEntreYYYYMM("2023-03", 13);
  const cdiSerie = serieFlat(meses, taxaMensal);
  const ipcaSerie: SerieIndice = new Map();

  const dataCompra = "2023-03-01";
  const dataRef = new Date("2024-03-01T00:00:00Z"); // 12 meses depois, dia 1

  const atual = valorRFAcumulado(
    custo, dataCompra, dataRef,
    "POS_FIXADO", "CDI + 0%",
    cdiSerie, ipcaSerie,
    0.12, 0.04,
  );

  const custoCentavosFixo = BigInt(Math.round(custo * 100)) * (ESCALA / 100n);
  const fatorMes = taxaParaFixo("0.007"); // spread=0 → fatorMes = (1+r)*(1+0) = (1+r)
  const esperadoFixo = compostoFixo(custoCentavosFixo, Array(12).fill(fatorMes));
  const esperado = fixoParaNumero(esperadoFixo);

  assertProximo(atual, esperado, 1e-4, "valorRFAcumulado (POS_FIXADO com spread 0) diverge da referência");
});

Deno.test("valorRFAcumulado — HIBRIDO (IPCA) com spread zerado, 18 meses flat", () => {
  const custo = 8_000;
  const taxaMensal = 0.004;
  const meses = mesesEntreYYYYMM("2021-05", 19);
  const ipcaSerie = serieFlat(meses, taxaMensal);
  const cdiSerie: SerieIndice = new Map();

  const dataCompra = "2021-05-01";
  const dataRef = new Date("2022-11-01T00:00:00Z"); // 18 meses depois, dia 1

  const atual = valorRFAcumulado(
    custo, dataCompra, dataRef,
    "HIBRIDO", "0%", // spreadAa = 0 → spreadMes = Math.pow(1,1/12)-1 = 0 exato
    cdiSerie, ipcaSerie,
    0.12, 0.04,
  );

  const custoCentavosFixo = BigInt(Math.round(custo * 100)) * (ESCALA / 100n);
  const fatorMes = taxaParaFixo("0.004");
  const esperadoFixo = compostoFixo(custoCentavosFixo, Array(18).fill(fatorMes));
  const esperado = fixoParaNumero(esperadoFixo);

  assertProximo(atual, esperado, 1e-4, "valorRFAcumulado (HIBRIDO) diverge da referência de ponto fixo");
});

Deno.test("valorRFAcumulado — série vazia usa fallback anual convertido para taxa mensal", () => {
  const custo = 10_000;
  // Série vazia: taxaMes() cai no fallbackMes derivado de cdiAtualAa via
  // Math.pow(x, 1/12) — aqui só garantimos que o caminho de fallback
  // continua consistente com a fórmula anual (não é o foco de precisão
  // exata deste arquivo, que é a composição a partir da série real).
  const cdiSerie: SerieIndice = new Map();
  const ipcaSerie: SerieIndice = new Map();

  const atual = valorRFAcumulado(
    custo, "2023-01-01", new Date("2024-01-01T00:00:00Z"),
    "POS_FIXADO", "100%",
    cdiSerie, ipcaSerie,
    0.12, 0.04,
  );

  const fallbackMensal = Math.pow(1.12, 1 / 12) - 1;
  const esperadoAprox = custo * Math.pow(1 + fallbackMensal, 12);
  assertProximo(atual, esperadoAprox, 1e-2, "fallback de taxa anual não bate com a série mensal derivada");
});

// ── valorRFPosicoes — taxa escalonada por faixa de valor (CDB "até
//    R$10.000 = 120% CDI, acima = 100% CDI") ─────────────────────────

Deno.test("valorRFPosicoes — faixa: 1 lote de R$14.000 divide 10.000@120% + 4.000@100%", () => {
  const taxaMensal = 0.008; // 0,8% a.m. flat (mesma série exata dos testes acima)
  const meses = mesesEntreYYYYMM("2022-01", 25);
  const cdiSerie = serieFlat(meses, taxaMensal);
  const ipcaSerie: SerieIndice = new Map();
  const dataCompra = "2022-01-01";
  const dataRef = new Date("2024-01-01T00:00:00Z"); // 24 meses exatos

  const atual = valorRFPosicoes(
    [{ valor_custo: 14_000, data_compra: dataCompra }],
    "RENDA_FIXA", "POS_FIXADO", null, "CDB Faixa",
    "2024-01", dataRef,
    "120%", cdiSerie, ipcaSerie, 0.12, 0.04, new Map(),
    undefined,
    { limite: 10_000, percentual2: 100 },
  );

  const centavos = (v: number) => BigInt(Math.round(v * 100)) * (ESCALA / 100n);
  const fator120 = taxaParaFixo("0.0096"); // 0,8% × 120%
  const fator100 = taxaParaFixo("0.008");  // 0,8% × 100%
  const esperado =
    fixoParaNumero(compostoFixo(centavos(10_000), Array(24).fill(fator120))) +
    fixoParaNumero(compostoFixo(centavos(4_000), Array(24).fill(fator100)));

  assertProximo(atual, esperado, 1e-3, "valorRFPosicoes (faixa, 1 lote) diverge da referência");
});

Deno.test("valorRFPosicoes — faixa: 2º aporte que cruza o limite só rende a taxa menor no excedente", () => {
  const taxaMensal = 0.008;
  const meses = mesesEntreYYYYMM("2022-01", 25);
  const cdiSerie = serieFlat(meses, taxaMensal);
  const ipcaSerie: SerieIndice = new Map();
  const dataRef = new Date("2024-01-01T00:00:00Z");

  // 1º aporte (R$6.000, 24 meses até a referência) fica inteiro na 1ª faixa
  // (0 → 6.000 ⊂ [0, 10.000]). 2º aporte (R$8.000, só 12 meses até a
  // referência) soma 6.000 → 14.000: R$4.000 ainda cabem na 1ª faixa
  // (6.000 → 10.000) e R$4.000 ficam no excedente (10.000 → 14.000).
  // Passados fora de ordem cronológica de propósito — a função deve ordenar
  // por data_compra antes de acumular, não depender da ordem do array.
  const atual = valorRFPosicoes(
    [
      { valor_custo: 8_000, data_compra: "2023-01-01" },
      { valor_custo: 6_000, data_compra: "2022-01-01" },
    ],
    "RENDA_FIXA", "POS_FIXADO", null, "CDB Faixa 2 aportes",
    "2024-01", dataRef,
    "120%", cdiSerie, ipcaSerie, 0.12, 0.04, new Map(),
    undefined,
    { limite: 10_000, percentual2: 100 },
  );

  const centavos = (v: number) => BigInt(Math.round(v * 100)) * (ESCALA / 100n);
  const fator120 = taxaParaFixo("0.0096");
  const fator100 = taxaParaFixo("0.008");
  const esperado =
    fixoParaNumero(compostoFixo(centavos(6_000), Array(24).fill(fator120))) +  // 1º aporte, 24m, 120%
    fixoParaNumero(compostoFixo(centavos(4_000), Array(12).fill(fator120))) +  // 2º aporte, parte na 1ª faixa, 12m, 120%
    fixoParaNumero(compostoFixo(centavos(4_000), Array(12).fill(fator100)));   // 2º aporte, excedente, 12m, 100%

  assertProximo(atual, esperado, 1e-3, "valorRFPosicoes (faixa, 2 aportes cruzando o limite) diverge da referência");
});

Deno.test("valorRFPosicoes — sem faixa (undefined) mantém o comportamento de taxa única", () => {
  const taxaMensal = 0.008;
  const meses = mesesEntreYYYYMM("2022-01", 25);
  const cdiSerie = serieFlat(meses, taxaMensal);
  const ipcaSerie: SerieIndice = new Map();
  const dataCompra = "2022-01-01";
  const dataRef = new Date("2024-01-01T00:00:00Z");

  const atual = valorRFPosicoes(
    [{ valor_custo: 14_000, data_compra: dataCompra }],
    "RENDA_FIXA", "POS_FIXADO", null, "CDB Sem Faixa",
    "2024-01", dataRef,
    "120%", cdiSerie, ipcaSerie, 0.12, 0.04, new Map(),
  );

  const esperado = fixoParaNumero(compostoFixo(
    BigInt(Math.round(14_000 * 100)) * (ESCALA / 100n), Array(24).fill(taxaParaFixo("0.0096")),
  ));

  assertProximo(atual, esperado, 1e-3, "valorRFPosicoes sem faixa deveria manter a taxa única de 120% sobre tudo");
});

// ── primeiraTaxa: parsing de texto livre ("13,5% a.a." → 0.135) ──────

Deno.test("primeiraTaxa — parsing de percentuais em texto livre", () => {
  const casos: [string, number][] = [
    ["13,5% a.a.", 0.135],
    ["100%", 1],
    ["CDI + 2%", 0.02], // primeira ocorrência numérica é 2 (do "2%"), não do "CDI"
    ["", 0],
    ["-1,5%", -0.015],
  ];
  for (const [txt, esperado] of casos) {
    const atual = primeiraTaxa(txt);
    if (Math.abs(atual - esperado) > 1e-9) {
      throw new Error(`primeiraTaxa("${txt}") = ${atual}, esperado ${esperado}`);
    }
  }
});
