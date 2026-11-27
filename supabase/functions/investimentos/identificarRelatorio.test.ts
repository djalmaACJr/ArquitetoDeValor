import { assertEquals } from "jsr:@std/assert@1";
import { detectarCompetencia, identificarAtivo, validarAtivo, type AtivoCandidato } from "./identificarRelatorio.ts";

const snag: AtivoCandidato = { id: "1", ticker: "SNAG11", nome: "Suno Agro FIAGRO Imobiliário" };
const xpml: AtivoCandidato = { id: "2", ticker: "XPML11", nome: "XP Malls FII" };
const petr: AtivoCandidato = { id: "3", ticker: "PETR4", nome: "Petróleo Brasileiro S.A. - Petrobras" };
const todos = [snag, xpml, petr];

const relSnag = "Relatório Gerencial Outubro 2026\nSuno Agro (SNAG11) — o fundo SNAG11 distribuiu... SNAG11 ... Suno Agro FIAGRO";

Deno.test("identifica o ativo pelo ticker no texto", () => {
  assertEquals(identificarAtivo(relSnag, todos), { tipo: "ok", ativo: snag });
});
Deno.test("sem nenhum ativo do usuário no texto → nenhum", () => {
  assertEquals(identificarAtivo("Relatório de outro fundo qualquer HGLG11 HGLG11", todos), { tipo: "nenhum" });
});
Deno.test("ações: casa pelo nome da empresa (ticker ausente)", () => {
  assertEquals(identificarAtivo("Resultado do 3T26 da Petróleo Brasileiro S.A. — Petrobras lucro", todos).tipo, "ok");
});
Deno.test("dois fundos igualmente citados → ambíguo", () => {
  assertEquals(identificarAtivo("SNAG11 XPML11 SNAG11 XPML11", todos).tipo, "ambiguo");
});
Deno.test("validação: PDF do ativo escolhido passa; de outro é rejeitado", () => {
  assertEquals(validarAtivo(relSnag, snag, todos), { ok: true });
  assertEquals(validarAtivo(relSnag, xpml, todos), { ok: false, motivo: "ausente" });
  const rel = "Relatório XPML11 XPML11 XPML11 XP Malls, cita SNAG11 uma vez";
  assertEquals(validarAtivo(rel, snag, todos).ok, false);
});
Deno.test("competência: mês por extenso, mm/aaaa e dd/mm/aaaa", () => {
  assertEquals(detectarCompetencia("Relatório Gerencial Outubro 2026", 2027), "2026-10-01");
  assertEquals(detectarCompetencia("Competência: 09/2026", 2027), "2026-09-01");
  assertEquals(detectarCompetencia("Data-base 30/09/2026", 2027), "2026-09-01");
  assertEquals(detectarCompetencia("sem data nenhuma", 2027), null);
});
