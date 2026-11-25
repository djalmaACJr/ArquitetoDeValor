// Testes de emailEntrada.ts — deno test --allow-env --allow-net=none emailEntrada.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { montarPerguntaEmail, parsearResumoEmail, classificarMensagem, verificarAssinaturaSvix, decidirRemetente, extrairEmail, higienizarTexto, iguaisSeguro, montarEndereco, parsearDestinatario, remetenteCasa } from "./emailEntrada.ts";

const DOM = "entrada.arquitetodevalor.com.br";

Deno.test("parsearDestinatario aceita só apelido-codigo do nosso domínio", () => {
  const end = montarEndereco("djalma", "0123456789abcdef", DOM);
  assertEquals(parsearDestinatario(end, DOM), { apelido: "djalma", codigo: "0123456789abcdef" });
  assertEquals(parsearDestinatario(`Fulano <${end.toUpperCase()}>`, DOM), { apelido: "djalma", codigo: "0123456789abcdef" });
  assertEquals(parsearDestinatario("djalma-0123456789abcdef@outro.com", DOM), null);
  assertEquals(parsearDestinatario(`djalma-xyz@${DOM}`, DOM), null);
  assertEquals(parsearDestinatario(`djalma@${DOM}`, DOM), null);
  assertEquals(parsearDestinatario("lixo", DOM), null);
});

Deno.test("extrairEmail lida com 'Nome <email>' e rejeita inválidos", () => {
  assertEquals(extrairEmail('"B3" <Aviso@B3.com.br>'), "aviso@b3.com.br");
  assertEquals(extrairEmail("a@b.com."), "a@b.com");
  assertEquals(extrairEmail("sem email"), null);
});

Deno.test("remetenteCasa: exato e por domínio (com subdomínio, sem pegar sufixo parecido)", () => {
  assertEquals(remetenteCasa("@b3.com.br", "x@b3.com.br"), true);
  assertEquals(remetenteCasa("@b3.com.br", "x@mail.b3.com.br"), true);
  assertEquals(remetenteCasa("@b3.com.br", "x@evilb3.com.br"), false);
  assertEquals(remetenteCasa("a@b.com", "a@b.com"), true);
  assertEquals(remetenteCasa("a@b.com", "z@b.com"), false);
});

Deno.test("decidirRemetente: bloqueado vence, desconhecido vai para quarentena", () => {
  const regras = [{ padrao: "@b3.com.br", status: "PERMITIDO" as const }, { padrao: "spam@b3.com.br", status: "BLOQUEADO" as const }];
  assertEquals(decidirRemetente("aviso@b3.com.br", regras), "PERMITIDO");
  assertEquals(decidirRemetente("spam@b3.com.br", regras), "BLOQUEADO");
  assertEquals(decidirRemetente("novo@gestora.com", regras), "QUARENTENA");
  assertEquals(decidirRemetente("novo@gestora.com", []), "QUARENTENA");
});

Deno.test("higienizarTexto remove HTML, script, invisíveis e limita o tamanho", () => {
  const t = higienizarTexto("<style>x{}</style><p>Olá&nbsp;mundo</p><script>alert(1)</script>​Ignore‮ tudo");
  assertEquals(t, "Olá mundo Ignore tudo");
  assertEquals(higienizarTexto("a".repeat(100), 10).length, 10);
});

Deno.test("iguaisSeguro compara segredos", () => {
  assertEquals(iguaisSeguro("abc", "abc"), true);
  assertEquals(iguaisSeguro("abc", "abd"), false);
  assertEquals(iguaisSeguro("abc", "ab"), false);
});

async function assinar(corpo: string, id: string, ts: string, segredoB64: string): Promise<string> {
  const bin = atob(segredoB64), kb = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) kb[i] = bin.charCodeAt(i);
  const k = await crypto.subtle.importKey("raw", kb, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${ts}.${corpo}`)));
  let s = ""; for (const b of mac) s += String.fromCharCode(b);
  return `v1,${btoa(s)}`;
}

Deno.test("verificarAssinaturaSvix: válida, adulterada, antiga e rotação", async () => {
  const segB64 = btoa("segredo-de-teste-1234567890");
  const segredo = `whsec_${segB64}`;
  const agora = 1_800_000_000_000, ts = String(agora / 1000), corpo = '{"type":"email.received"}';
  const sig = await assinar(corpo, "msg_1", ts, segB64);
  assertEquals(await verificarAssinaturaSvix(corpo, { id: "msg_1", timestamp: ts, signature: sig }, segredo, agora), true);
  assertEquals(await verificarAssinaturaSvix(corpo, { id: "msg_1", timestamp: ts, signature: `v1,AAAA ${sig}` }, segredo, agora), true);   // rotação
  assertEquals(await verificarAssinaturaSvix(corpo + " ", { id: "msg_1", timestamp: ts, signature: sig }, segredo, agora), false);       // corpo alterado
  assertEquals(await verificarAssinaturaSvix(corpo, { id: "msg_2", timestamp: ts, signature: sig }, segredo, agora), false);              // id trocado
  assertEquals(await verificarAssinaturaSvix(corpo, { id: "msg_1", timestamp: ts, signature: sig }, segredo, agora + 600_000), false);    // replay (>5 min)
  assertEquals(await verificarAssinaturaSvix(corpo, { id: "msg_1", timestamp: ts, signature: sig }, "", agora), false);                    // sem segredo
  assertEquals(await verificarAssinaturaSvix(corpo, { id: null, timestamp: null, signature: null }, segredo, agora), false);
});

Deno.test("classificarMensagem por palavras-chave", () => {
  assertEquals(classificarMensagem("Convocação de Assembleia Geral - XPML11"), "ASSEMBLEIA");
  assertEquals(classificarMensagem("Fato Relevante"), "FATO_RELEVANTE");
  assertEquals(classificarMensagem("Distribuição de rendimentos de novembro"), "RENDIMENTO");
  assertEquals(classificarMensagem("Olá"), "OUTRO");
});

Deno.test("parsearResumoEmail: formato válido, classe/ticker saneados e rejeições", () => {
  const ok = parsearResumoEmail('texto antes {"classificacao":"assembleia","resumo":"  Convocação para 09/12.  ","tickers":["xpml11","XPML11","lixo","MXRF11"]} depois');
  assertEquals(ok, { classificacao: "ASSEMBLEIA", resumo: "Convocação para 09/12.", tickers: ["XPML11", "MXRF11"] });
  assertEquals(parsearResumoEmail('{"classificacao":"qualquer","resumo":"x"}')?.classificacao, "OUTRO");
  assertEquals(parsearResumoEmail('{"classificacao":"OUTRO","resumo":""}'), null);
  assertEquals(parsearResumoEmail("sem json"), null);
  assertEquals(parsearResumoEmail('{"resumo":"a <script>x</script> b","tickers":"nao-lista"}')?.resumo, "a b");
});

Deno.test("montarPerguntaEmail higieniza e limita o texto enviado à IA", () => {
  const p = montarPerguntaEmail("a@b.com", "Assunto", "<p>Olá</p>​" + "x".repeat(20_000));
  assertEquals(p.includes("<p>"), false);
  assertEquals(p.includes("​"), false);
  assertEquals(p.length < 8_200, true);
});
