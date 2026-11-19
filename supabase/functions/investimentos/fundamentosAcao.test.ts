// Testes do cálculo puro de fundamentos de ações (fundamentosAcao.ts) — rode com:
//   deno test --node-modules-dir=auto --allow-env --allow-net=none fundamentosAcao.test.ts
import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1";
import {
  acoesLiquidas, calcularFundamentos, calcularValorJustoGraham, ehUnit, lucroAtribuivel, lucroLtm,
  patrimonioControladores, valorReais,
} from "./fundamentosAcao.ts";

type L = Record<string, string>;
const dre = (cd: string, ds: string, ordem: string, ini: string, fim: string, vl: number, escala = "MIL", versao = "1"): L => ({
  CNPJ_CIA: "11.111.111/0001-11", CD_CONTA: cd, DS_CONTA: ds, ORDEM_EXERC: ordem,
  DT_INI_EXERC: ini, DT_FIM_EXERC: fim, VL_CONTA: String(vl), ESCALA_MOEDA: escala, VERSAO: versao,
});
const bpp = (cd: string, ds: string, fim: string, vl: number, escala = "MIL"): L => ({
  CNPJ_CIA: "11.111.111/0001-11", CD_CONTA: cd, DS_CONTA: ds, ORDEM_EXERC: "ÚLTIMO",
  DT_INI_EXERC: "", DT_FIM_EXERC: fim, VL_CONTA: String(vl), ESCALA_MOEDA: escala, VERSAO: "1",
});

Deno.test("escala MIL é multiplicada por 1000; UNIDADE não", () => {
  assertEquals(valorReais({ VL_CONTA: "110605000", ESCALA_MOEDA: "MIL" }), 110_605_000_000);
  assertEquals(valorReais({ VL_CONTA: "500", ESCALA_MOEDA: "UNIDADE" }), 500);
});

Deno.test("Graham: raiz(22,5·LPA·VPA); null se LPA ou VPA não positivos", () => {
  assertAlmostEquals(calcularValorJustoGraham(2, 10)!, Math.sqrt(22.5 * 2 * 10), 1e-9);
  assertEquals(calcularValorJustoGraham(-1, 10), null);
  assertEquals(calcularValorJustoGraham(2, 0), null);
  assertEquals(calcularValorJustoGraham(null, 10), null);
});

Deno.test("units (…11) não são calculadas", () => {
  assertEquals(ehUnit("TAEE11"), true);
  assertEquals(ehUnit("petr4"), false);
  assertEquals(ehUnit("BPAC11"), true);
});

Deno.test("lucro: usa o atribuído aos controladores (3.11.01), não o consolidado", () => {
  const linhas = [
    dre("3.11", "Lucro/Prejuízo Consolidado do Período", "ÚLTIMO", "2025-01-01", "2025-12-31", 100),
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2025-01-01", "2025-12-31", 80),
    dre("3.11.02", "Atribuído a Sócios Não Controladores", "ÚLTIMO", "2025-01-01", "2025-12-31", 20),
  ];
  assertEquals(lucroAtribuivel(linhas, "ÚLTIMO")?.valor, 80_000);
});

Deno.test("banco: lucro em 3.09.01 (plano de contas diferente)", () => {
  const linhas = [
    dre("3.09", "Lucro/Prejuízo Consolidado do Período", "ÚLTIMO", "2025-01-01", "2025-12-31", 50),
    dre("3.09.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2025-01-01", "2025-12-31", 48),
  ];
  assertEquals(lucroAtribuivel(linhas, "ÚLTIMO")?.valor, 48_000);
});

Deno.test("sem a conta dos controladores, cai no lucro consolidado", () => {
  const linhas = [dre("3.11", "Lucro/Prejuízo Consolidado do Período", "ÚLTIMO", "2025-01-01", "2025-12-31", 7)];
  assertEquals(lucroAtribuivel(linhas, "ÚLTIMO")?.valor, 7_000);
});

Deno.test("ITR: pega o acumulado do ano (menor DT_INI), não o trimestre isolado", () => {
  const linhas = [
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2026-07-01", "2026-09-30", 10),
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2026-01-01", "2026-09-30", 30),
  ];
  assertEquals(lucroAtribuivel(linhas, "ÚLTIMO")?.valor, 30_000);
});

Deno.test("LTM = DFP − ITR do ano anterior + ITR atual (e só se os períodos emendam)", () => {
  const dfp = [dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2025-01-01", "2025-12-31", 100)];
  const itr = [
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2026-01-01", "2026-09-30", 90),
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "PENÚLTIMO", "2025-01-01", "2025-09-30", 60),
  ];
  const r = lucroLtm(dfp, itr)!;
  assertEquals(r.valor, (100 - 60 + 90) * 1000);
  assertEquals(r.ltm, true);
  assertEquals(r.fim, "2026-09-30");
  // ITR de outro ano (não emenda com o exercício da DFP) → usa o anual.
  const itrAntigo = [
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2024-01-01", "2024-09-30", 90),
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "PENÚLTIMO", "2023-01-01", "2023-09-30", 60),
  ];
  const r2 = lucroLtm(dfp, itrAntigo)!;
  assertEquals(r2.ltm, false);
  assertEquals(r2.valor, 100_000);
});

Deno.test("PL dos controladores = PL total − não controladores; banco usa outro código", () => {
  const empresa = [
    bpp("2.03", "Patrimônio Líquido Consolidado", "2026-09-30", 1000),
    bpp("2.03.09", "Participação dos Acionistas Não Controladores", "2026-09-30", 100),
  ];
  assertEquals(patrimonioControladores(empresa)?.valor, 900_000);
  const banco = [
    bpp("2.03", "Passivos Financeiros ao Custo Amortizado", "2026-09-30", 99999),
    bpp("2.07", "Patrimônio Líquido Consolidado", "2026-09-30", 500),
    bpp("2.07.05", "Participação dos Acionistas Não Controladores", "2026-09-30", 20),
  ];
  assertEquals(patrimonioControladores(banco)?.valor, 480_000);
});

Deno.test("ações líquidas: usa a fração em tesouraria (invariante à escala) sobre o total do FRE", () => {
  // composição em MILHARES (como Vale) ou em unidades dá a mesma fração
  const emMilhares = { QT_ACAO_TOTAL_CAP_INTEGR: "4255762", QT_ACAO_TOTAL_TESOURO: "183396" } as L;
  const emUnidades = { QT_ACAO_TOTAL_CAP_INTEGR: "4255762000", QT_ACAO_TOTAL_TESOURO: "183396000" } as L;
  const a = acoesLiquidas(4_440_000_000, emMilhares)!, b = acoesLiquidas(4_440_000_000, emUnidades)!;
  assertAlmostEquals(a, b, 1);
  assertAlmostEquals(a, 4_440_000_000 * (1 - 183396 / 4255762), 1);
  assertEquals(acoesLiquidas(undefined, emMilhares), null);
  assertEquals(acoesLiquidas(1000, undefined), 1000); // sem composição: não desconta nada
});

Deno.test("calcularFundamentos: ponta a ponta (valores em MIL viram reais por ação)", () => {
  const f = calcularFundamentos({
    dfpDre: [dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2025-01-01", "2025-12-31", 100_000)],
    itrDre: [],
    bppItr: [],
    bppDfp: [bpp("2.03", "Patrimônio Líquido Consolidado", "2025-12-31", 400_000)],
    acoes: 10_000_000, // 10 milhões
  })!;
  // lucro R$ 100 milhões (100.000 MIL) / 10 mi ações = R$ 10 ; PL R$ 400 mi / 10 mi = R$ 40
  assertAlmostEquals(f.lpa, 10, 1e-9);
  assertAlmostEquals(f.vpa, 40, 1e-9);
  assertAlmostEquals(f.valorJusto!, Math.sqrt(22.5 * 10 * 40), 1e-9);
  assertEquals(f.ltm, false);
  assertEquals(f.referencia, "2025-12-31");
});

Deno.test("calcularFundamentos: sem ações ou sem demonstração → null", () => {
  assertEquals(calcularFundamentos({ dfpDre: [], itrDre: [], bppItr: [], bppDfp: [], acoes: 100 }), null);
  assertEquals(calcularFundamentos({ dfpDre: [], itrDre: [], bppItr: [], bppDfp: [], acoes: null }), null);
});
