// Testes das funções puras de relatoriosFii.ts — rode com:
//   deno test --node-modules-dir=auto --allow-env --allow-net=none relatoriosFii.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { filtrarRelatoriosDoAtivo, parseDataReferencia, parsearAnaliseIA, relatorioCasaComAtivo } from "./relatoriosFii.ts";

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

Deno.test("relatorioCasaComAtivo: MANA11 não casa com outros fundos Manatí (núcleo é palavra inteira)", () => {
  const ativo = { ticker: "MANA11", nome: "Manati Capital Hedge Fund Fundo de Investimento Imobiliario" };
  assertEquals(relatorioCasaComAtivo(ativo, { fundo_nome: "MANATÍ CAPITAL HEDGE FUND FUNDO DE INVESTIMENTO IMOBILIÁRIO DE RESPONSABILIDADE LIMITADA", fundo_pregao: "FII MANATI" }), true);
  assertEquals(relatorioCasaComAtivo(ativo, { fundo_nome: "MANATÍ RENDA CDI PLUS FUNDO DE INVESTIMENTO IMOBILIÁRIO RESPONSABILIDADE LIMITADA", fundo_pregao: null }), false);
  assertEquals(relatorioCasaComAtivo(ativo, { fundo_nome: "MANATÍ RECEBÍVEIS ESTRUTURADOS FUNDO DE INVESTIMENTO IMOBILIÁRIO DE RESPONSABILIDADE LIMITADA", fundo_pregao: null }), false);
});

Deno.test("filtrarRelatoriosDoAtivo: sigla (nome = ticker) só vale quando as regras fortes não acham nada", () => {
  const xpml = { ticker: "XPML11", nome: "XPML11" };
  const malls = { fundo_nome: "XP MALLS FUNDO DE INVESTIMENTO IMOBILIÁRIO FII", fundo_pregao: "FII XP MALLS" };
  const xplog = { fundo_nome: "XP LOG FUNDO DE INVESTIMENTO IMOBILIÁRIO RESPONSABILIDADE LIMITADA - FII", fundo_pregao: "FII XP LOG" };
  assertEquals(filtrarRelatoriosDoAtivo(xpml, [malls, xplog]), [malls]);
  assertEquals(filtrarRelatoriosDoAtivo({ ticker: "XPLG11", nome: "XPLG11" }, [malls, xplog, { fundo_nome: "XP LOGÍSTICO PRIME YIELD FUNDO", fundo_pregao: null }]), [xplog]);
  // RBRR11: o relatório "RBRR PAX" (regra forte) vence os falsos positivos de sigla
  const rbrr = { ticker: "RBRR11", nome: "RBRR11" };
  const pax = { fundo_nome: "RBRR", fundo_pregao: "FII RBRR PAX" };
  assertEquals(filtrarRelatoriosDoAtivo(rbrr, [pax, { fundo_nome: "RBR PRIME", fundo_pregao: "FII RBR PR" }, { fundo_nome: "RIO BRAVO", fundo_pregao: "FII RIOB RR" }]), [pax]);
  // MANA11 nome = ticker não casa com pregão longo de outro fundo
  assertEquals(filtrarRelatoriosDoAtivo({ ticker: "MANA11", nome: "MANA11" }, [{ fundo_nome: "MANATÍ RENDA CDI", fundo_pregao: "FII MANATI RENDA CDI" }]), []);
});

Deno.test("filtrarRelatoriosDoAtivo: pregão exato da B3 resolve GARE11/GGRC11/TGAR11 e vence falsos positivos", () => {
  const guardian = { fundo_nome: "GUARDIAN REAL ESTATE FUNDO DE INVESTIMENTO IMOBILIÁRIO", fundo_pregao: "FII GUARDIAN" };
  const guard = { fundo_nome: "GUARDIAN MULTIESTRATÉGIA", fundo_pregao: "FII GUARD MU" };
  assertEquals(filtrarRelatoriosDoAtivo({ ticker: "GARE11", nome: "GARE11", pregao: "FII GUARDIAN" }, [guard, guardian]), [guardian]);
  const ggr = { fundo_nome: "ZAGROS RENDA IMOBILIÁRIA", fundo_pregao: "FII GGR ZAG" };
  assertEquals(filtrarRelatoriosDoAtivo({ ticker: "GGRC11", nome: "ZAGROS RENDA IMOBILIRIA FII RESP LTDA", pregao: "FII GGR ZAG " }, [ggr]), [ggr]);
  const tg = { fundo_nome: "FUNDO DE INVESTIMENTO IMOBILIÁRIO TG ATIVO REAL", fundo_pregao: "FII TG ATIVO" };
  assertEquals(filtrarRelatoriosDoAtivo({ ticker: "TGAR11", nome: "FDO INV IMOB TG ATIVO REAL RESP LIM", pregao: "FII TG ATIVO" }, [tg]), [tg]);
  // pregão sem relatório correspondente: cai nas regras por texto (não zera)
  assertEquals(filtrarRelatoriosDoAtivo({ ticker: "XPML11", nome: "XPML11", pregao: "FII XP MALLS" }, [{ fundo_nome: "X", fundo_pregao: "FII OUTRO" }]), []);
});
