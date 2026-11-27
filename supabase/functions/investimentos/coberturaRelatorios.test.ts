import { assertEquals } from "jsr:@std/assert@1";
import { periodoEsperado } from "./coberturaRelatorios.ts";

Deno.test("FII: mensal; só 'devido' a partir do dia 15 do mês seguinte", () => {
  const p = periodoEsperado("FII", "2026-10", "2026-11-27")!;
  assertEquals([p.periodicidade, p.de, p.ate, p.rotulo, p.devido], ["MENSAL", "2026-10-01", "2026-11-01", "10/2026", true]);
  assertEquals(periodoEsperado("FII", "2026-10", "2026-11-10")!.devido, false);
  assertEquals(periodoEsperado("FII", "2026-11", "2026-11-27")!.devido, false);
});
Deno.test("Ações: trimestral — em out/2026 o esperado é o 2T26 (3T só vence em meados de nov)", () => {
  const p = periodoEsperado("ACOES", "2026-10", "2026-11-27")!;
  assertEquals([p.periodicidade, p.rotulo, p.devido], ["TRIMESTRAL", "2T26", true]);
  assertEquals(periodoEsperado("ACOES", "2026-11", "2026-11-27")!.rotulo, "3T26");
});
Deno.test("Ações: o anual (DFP) tem prazo de 90 dias; stocks 75", () => {
  assertEquals(periodoEsperado("ACOES", "2027-02", "2027-12-31")!.rotulo, "3T26");
  assertEquals(periodoEsperado("ACOES", "2027-04", "2027-12-31")!.rotulo, "4T26");
  assertEquals(periodoEsperado("STOCKS", "2027-02", "2027-12-31")!.rotulo, "3T26");
  assertEquals(periodoEsperado("STOCKS", "2027-03", "2027-12-31")!.rotulo, "4T26");  // 10-K: 31/12 + 75d = 16/03
});
Deno.test("mês ainda em andamento usa 'hoje' como referência", () => {
  assertEquals(periodoEsperado("REIT", "2026-12", "2026-11-27")!.rotulo, "3T26");
  assertEquals(periodoEsperado("REIT", "2026-12", "2026-11-10")!.rotulo, "2T26");
});
Deno.test("tipos sem relatório periódico não têm período", () => {
  assertEquals(periodoEsperado("RENDA_FIXA", "2026-10", "2026-11-27"), null);
  assertEquals(periodoEsperado("CRIPTOMOEDAS", "2026-10", "2026-11-27"), null);
});
