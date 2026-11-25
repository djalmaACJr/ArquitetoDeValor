// Testes das funções puras de assembleiasFii.ts — rode com:
//   deno test --node-modules-dir=auto --allow-env --allow-net=none assembleiasFii.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { escolherPorAssembleia, parsearAnaliseAssembleia } from "./assembleiasFii.ts";

Deno.test("parsearAnaliseAssembleia aceita JSON válido e limita campos", () => {
  const r = parsearAnaliseAssembleia('texto {"relevancia":"importante","resumo":"Vão decidir nova emissão.","quando":"09/12/2026 às 18h","como_participar":null,"prazo_voto":"nenhum","pauta":[{"item":"Emissão","explicacao":"Novas cotas"},{"item":"","explicacao":"x"}],"pontos_atencao":["a","b","c","d"]} fim');
  assertEquals(r?.relevancia, "IMPORTANTE");
  assertEquals(r?.quando, "09/12/2026 às 18h");
  assertEquals(r?.como_participar, null);
  assertEquals(r?.prazo_voto, null);
  assertEquals(r?.pauta.length, 1);
  assertEquals(r?.pontos_atencao.length, 3);
});

Deno.test("parsearAnaliseAssembleia rejeita relevância inválida ou resumo vazio", () => {
  assertEquals(parsearAnaliseAssembleia('{"relevancia":"X","resumo":"a"}'), null);
  assertEquals(parsearAnaliseAssembleia('{"relevancia":"ROTINA","resumo":""}'), null);
  assertEquals(parsearAnaliseAssembleia("sem json"), null);
});

Deno.test("escolherPorAssembleia fica com 1 documento por assembleia (Edital > Carta > Proposta)", () => {
  const ev = "2026-12-09T18:00:00-03:00";
  const docs = [
    { especie: "Proposta do Administrador", data_evento: ev, data_entrega: "2026-11-20T10:00:00-03:00" },
    { especie: "Edital de Convocação", data_evento: ev, data_entrega: "2026-11-19T10:00:00-03:00" },
    { especie: "Carta Consulta", data_evento: "2027-01-06T10:00:00-03:00", data_entrega: "2026-11-21T10:00:00-03:00" },
  ];
  const r = escolherPorAssembleia(docs);
  assertEquals(r.length, 2);
  assertEquals(r[0].especie, "Edital de Convocação");
  assertEquals(r[1].especie, "Carta Consulta");
});

Deno.test("prazoISO converte data/hora de Brasília e rejeita lixo", async () => {
  const { prazoISO } = await import("./assembleiasFii.ts");
  assertEquals(prazoISO("2026-12-08T23:59"), "2026-12-08T23:59:00-03:00");
  assertEquals(prazoISO("2026-12-08"), "2026-12-08T23:59:00-03:00");
  assertEquals(prazoISO("null"), null);
  assertEquals(prazoISO("2026-13-40"), null);
  assertEquals(prazoISO(undefined), null);
});

Deno.test("extrairContatos acha links e e-mails, sem pontuação final e sem repetir", async () => {
  const { extrairContatos } = await import("./assembleiasFii.ts");
  const r = extrairContatos('Veja em https://qitech.com.br/fundos-administrados/, ou https://qitech.com.br/fundos-administrados/. Dúvidas: ri@gestora.com.br; voto: Voto@Gestora.com.br.');
  assertEquals(r.filter((c) => c.tipo === "link").map((c) => c.valor), ["https://qitech.com.br/fundos-administrados/"]);
  assertEquals(r.filter((c) => c.tipo === "email").map((c) => c.valor), ["ri@gestora.com.br", "Voto@Gestora.com.br"]);
  assertEquals(extrairContatos("sem nada aqui"), []);
});
