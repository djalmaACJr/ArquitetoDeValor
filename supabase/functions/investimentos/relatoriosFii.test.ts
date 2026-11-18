// Testes das funções puras de relatoriosFii.ts — rode com:
//   deno test --node-modules-dir=auto --allow-env --allow-net=none relatoriosFii.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { parseDataReferencia, parsearAnaliseIA, relatorioCasaComAtivo } from "./relatoriosFii.ts";

Deno.test("parseDataReferencia aceita dd/MM/yyyy e MM/yyyy", () => {
  assertEquals(parseDataReferencia("31/10/2026"), "2026-10-31");
  assertEquals(parseDataReferencia("10/2026"), "2026-10-01");
  assertEquals(parseDataReferencia(""), null);
});

Deno.test("relatorioCasaComAtivo: núcleo do ticker no pregão/nome", () => {
  assertEquals(relatorioCasaComAtivo({ ticker: "KNRI11", nome: null }, { fundo_nome: "KINEA RENDA IMOBILIARIA KNRI FII", fundo_pregao: null }), true);
  assertEquals(relatorioCasaComAtivo({ ticker: "HGLG11", nome: null }, { fundo_nome: "OUTRO FUNDO", fundo_pregao: "FII KINEA RI" }), false);
});

Deno.test("relatorioCasaComAtivo: palavras distintivas do nome do ativo", () => {
  const ativo = { ticker: "RBRR11", nome: "Fundo Investimento Imobiliario - FII RBR Rendimento High Grade" };
  assertEquals(relatorioCasaComAtivo(ativo, { fundo_nome: "RBR RENDIMENTO HIGH GRADE FUNDO DE INVESTIMENTO IMOBILIARIO - FII", fundo_pregao: null }), true);
  // nome parecido mas fundo diferente: falta "high"/"grade"
  assertEquals(relatorioCasaComAtivo(ativo, { fundo_nome: "RBR ALPHA MULTIESTRATEGIA REAL ESTATE FII", fundo_pregao: "FII RBR ALPHA" }), false);
});

Deno.test("parsearAnaliseIA extrai JSON mesmo com texto em volta e valida veredito", () => {
  const ok = parsearAnaliseIA('Aqui vai:\n```json\n{"veredito":"atencao","resumo":"Vacância subiu.","pontos_fortes":["a"],"pontos_atencao":["b","c"],"inconsistencias":[],"mudancas":"null"}\n```');
  assertEquals(ok?.veredito, "ATENCAO");
  assertEquals(ok?.pontos_atencao.length, 2);
  assertEquals(ok?.mudancas, null);
  assertEquals(parsearAnaliseIA('{"veredito":"TALVEZ","resumo":"x"}'), null);
  assertEquals(parsearAnaliseIA("sem json"), null);
});
