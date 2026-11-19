// Testes das funções puras de textoResultados.ts — rode com:
//   deno test --node-modules-dir=auto --allow-env --allow-net=none textoResultados.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { extrairMdna, htmlParaTexto, resumirDemonstracoes, rotuloPeriodoCvm } from "./textoResultados.ts";

Deno.test("htmlParaTexto: remove tags/scripts, decodifica entidades e mantém células de tabela", () => {
  const t = htmlParaTexto(`<html><style>x{}</style><script>var a=1;</script><p>Net sales&#160;increased &amp; &#8220;grew&#8221;</p><table><tr><td>Revenue</td><td>$ 94,036</td></tr></table>`);
  assertStringIncludes(t, "Net sales increased & “grew”");
  assertStringIncludes(t, "Revenue | $ 94,036");
  assert(!t.includes("var a=1"));
});

Deno.test("extrairMdna 10-Q: ignora o sumário e pega a seção real (a mais longa)", () => {
  const corpo = "Net sales rose because of services. ".repeat(120); // ~4.3k chars
  const texto = [
    "Table of Contents", "Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations 17",
    "Item 3. Quantitative and Qualitative Disclosures About Market Risk 28",
    "Item 2. Management's Discussion and Analysis of Financial Condition and Results of Operations", corpo,
    "Item 3. Quantitative and Qualitative Disclosures About Market Risk", "Interest rate risk text",
  ].join("\n");
  const m = extrairMdna(texto, "10-Q");
  assertStringIncludes(m, "Net sales rose");
  assert(!m.includes("Interest rate risk text"));
  assert(m.length > 4000);
  // começa na seção real, não na linha do sumário (que termina com o nº da página)
  assertStringIncludes(m.slice(0, 140), "Results of Operations\nNet sales rose");
});

Deno.test("extrairMdna 10-K usa o Item 7 até o 7A", () => {
  const corpo = "Revenue grew on higher volumes. ".repeat(100);
  const texto = `Item 7. Management's Discussion and Analysis\n${corpo}\nItem 7A. Quantitative and Qualitative\nrisk`;
  const m = extrairMdna(texto, "10-K");
  assertStringIncludes(m, "Revenue grew");
  assert(!m.includes("risk"));
});

Deno.test("extrairMdna: respeita o teto de caracteres", () => {
  const texto = `Item 2. Management's Discussion and Analysis\n${"x ".repeat(50_000)}\nItem 3. Quantitative`;
  assertEquals(extrairMdna(texto, "10-Q", 1000).length, 1000);
});

type L = Record<string, string>;
const dre = (cd: string, ds: string, ordem: string, ini: string, fim: string, vl: number): L => ({
  CNPJ_CIA: "1", CD_CONTA: cd, DS_CONTA: ds, ORDEM_EXERC: ordem, DT_INI_EXERC: ini, DT_FIM_EXERC: fim,
  VL_CONTA: String(vl), ESCALA_MOEDA: "MIL", VERSAO: "1",
});
const bpp = (cd: string, ds: string, ordem: string, fim: string, vl: number): L => ({
  CNPJ_CIA: "1", CD_CONTA: cd, DS_CONTA: ds, ORDEM_EXERC: ordem, DT_INI_EXERC: "2026-01-01", DT_FIM_EXERC: fim,
  VL_CONTA: String(vl), ESCALA_MOEDA: "MIL", VERSAO: "1",
});

Deno.test("resumo CVM (ITR): trimestre e acumulado × ano anterior, em R$ milhões", () => {
  const itr = [
    dre("3.01", "Receita de Venda de Bens e/ou Serviços", "ÚLTIMO", "2026-07-01", "2026-09-30", 2_000_000),
    dre("3.01", "Receita de Venda de Bens e/ou Serviços", "ÚLTIMO", "2026-01-01", "2026-09-30", 5_500_000),
    dre("3.01", "Receita de Venda de Bens e/ou Serviços", "PENÚLTIMO", "2025-07-01", "2025-09-30", 1_800_000),
    dre("3.01", "Receita de Venda de Bens e/ou Serviços", "PENÚLTIMO", "2025-01-01", "2025-09-30", 5_000_000),
    dre("3.99", "Lucro por Ação - (Reais / Ação)", "ÚLTIMO", "2026-07-01", "2026-09-30", 1),
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2026-07-01", "2026-09-30", 300_000),
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "ÚLTIMO", "2026-01-01", "2026-09-30", 800_000),
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "PENÚLTIMO", "2025-07-01", "2025-09-30", 250_000),
    dre("3.11.01", "Atribuído a Sócios da Empresa Controladora", "PENÚLTIMO", "2025-01-01", "2025-09-30", 700_000),
  ];
  const balanco = [
    bpp("2.03", "Patrimônio Líquido Consolidado", "ÚLTIMO", "2026-09-30", 9_000_000),
    bpp("2.03", "Patrimônio Líquido Consolidado", "PENÚLTIMO", "2025-12-31", 8_500_000),
    bpp("2.01.04", "Empréstimos e Financiamentos", "ÚLTIMO", "2026-09-30", 1_000_000),
  ];
  const r = resumirDemonstracoes({ nome: "EMPRESA X", ticker: "EMPX", dfpDre: [], itrDre: itr, bppItr: balanco, bppDfp: [] })!;
  assertEquals(r.tipo, "ITR");
  assertEquals(r.fim, "2026-09-30");
  assertStringIncludes(r.texto, "Receita de Venda de Bens e/ou Serviços: trimestre 2.000 | mesmo trimestre do ano anterior 1.800 | acumulado do ano 5.500 | acumulado do ano anterior 5.000");
  assertStringIncludes(r.texto, "Atribuído a Sócios da Empresa Controladora: trimestre 300");
  assertStringIncludes(r.texto, "Patrimônio Líquido Consolidado: 9.000 (em 31/12/2025: 8.500)");
  assertStringIncludes(r.texto, "Empréstimos e Financiamentos: 1.000");
  assert(!r.texto.includes("por Ação"), "lucro por ação não entra na tabela em milhões");
  assertEquals(rotuloPeriodoCvm(r), "3º trimestre de 2026");
});

Deno.test("resumo CVM: usa a DFP quando é mais recente que o ITR; null sem demonstração", () => {
  const dfp = [
    dre("3.01", "Receita", "ÚLTIMO", "2025-01-01", "2025-12-31", 10_000_000),
    dre("3.01", "Receita", "PENÚLTIMO", "2024-01-01", "2024-12-31", 9_000_000),
  ];
  const r = resumirDemonstracoes({ nome: "Y", ticker: "YYYY", dfpDre: dfp, itrDre: [], bppItr: [], bppDfp: [] })!;
  assertEquals(r.tipo, "DFP");
  assertStringIncludes(r.texto, "Receita: exercício 10.000 | exercício anterior 9.000");
  assertEquals(rotuloPeriodoCvm(r), "exercício de 2025");
  assertEquals(resumirDemonstracoes({ nome: "Z", ticker: "Z", dfpDre: [], itrDre: [], bppItr: [], bppDfp: [] }), null);
});
