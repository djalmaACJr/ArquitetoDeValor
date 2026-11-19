import { assertEquals, assertAlmostEquals } from "jsr:@std/assert@1";
import { calcularContexto, mesesEntre, parsearAnalisePessoal, tempoDeCasa, textoContextoPessoal } from "./analisePessoal.ts";

const pos = (ativo: string, conta: string, qtd: number, custo: number, data: string, tipo: string) =>
  ({ ativo_id: ativo, conta_id: conta, quantidade: qtd, valor_custo: custo, data_compra: data, inv_ativos: { tipo_ativo: tipo, moeda: "BRL" } });
const custoBRL = (p: { valor_custo?: unknown }) => Number(p.valor_custo);

Deno.test("mesesEntre conta meses cheios", () => {
  assertEquals(mesesEntre("2024-01-15", "2026-01-14"), 23);
  assertEquals(mesesEntre("2024-01-15", "2026-01-15"), 24);
  assertEquals(mesesEntre("2026-11-01", "2026-11-19"), 0);
  assertEquals(mesesEntre("lixo", "2026-11-19"), null);
});

Deno.test("tempoDeCasa em português", () => {
  assertEquals(tempoDeCasa(0), "menos de 1 mês");
  assertEquals(tempoDeCasa(1), "1 mês");
  assertEquals(tempoDeCasa(8), "8 meses");
  assertEquals(tempoDeCasa(12), "1 ano");
  assertEquals(tempoDeCasa(30), "2 anos e 6 meses");
  assertEquals(tempoDeCasa(null), "não informado");
});

Deno.test("calcularContexto: pesos, rentabilidade, entrada e meta", () => {
  const posicoes = [
    pos("A", "c1", 10, 1000, "2025-03-10", "ACOES"),
    pos("A", "c1", 10, 1200, "2024-06-01", "ACOES"),   // mesma conta: soma, não conta 2×
    pos("B", "c1", 5, 3000, "2026-01-05", "FII"),
  ];
  const mercado = new Map([["A|c1", 3300], ["B|c1", 3300]]);   // A: custo 2200 → 3300 (+50%)
  const ctx = calcularContexto(
    { id: "A", ticker: "PETR4", tipo_ativo: "ACOES" }, posicoes as never, custoBRL, mercado,
    new Map([["ACOES", 40]]), { perfil: "MODERADO", idade: 40, idade_aposentadoria: 60 }, "2026-11-19", null,
  );
  assertEquals(ctx.quantidade, 20);
  assertAlmostEquals(ctx.rentabilidadePct!, 50, 1e-9);
  assertAlmostEquals(ctx.pesoAtivoPct!, 50, 1e-9);
  assertAlmostEquals(ctx.pesoTipoPct!, 50, 1e-9);
  assertEquals(ctx.metaTipoPct, 40);
  assertAlmostEquals(ctx.precoMedio!, 110, 1e-9);
  assertEquals(ctx.entradaEm, "2024-06-01");           // a 1ª compra, não a mais recente
  assertEquals(ctx.mesesNaCarteira, 29);
  assertEquals(ctx.perfil, "MODERADO");
});

Deno.test("calcularContexto: a entrada vinda das operações vence a data da posição", () => {
  const ctx = calcularContexto(
    { id: "A", ticker: "X", tipo_ativo: "ACOES" }, [pos("A", "c1", 1, 10, "2026-05-01", "ACOES")] as never,
    custoBRL, new Map(), new Map(), null, "2026-11-19", "2023-02-02",
  );
  assertEquals(ctx.entradaEm, "2023-02-02");
  assertEquals(ctx.pesoAtivoPct, 100);   // sem mercado: usa o custo
  assertEquals(ctx.perfil, null);
});

Deno.test("textoContextoPessoal não expõe patrimônio em reais", () => {
  const t = textoContextoPessoal({
    ticker: "PETR4", tipo: "ACOES", perfil: "ARROJADO", idade: 30, idadeAposentadoria: 60, quantidade: 100, precoMedio: 30,
    rentabilidadePct: 12.5, pesoAtivoPct: 8, pesoTipoPct: 35, metaTipoPct: 30, entradaEm: "2024-01-02", mesesNaCarteira: 34,
  });
  assertEquals(t.includes("30 anos"), true);
  assertEquals(t.includes("12,5%"), true);
  assertEquals(t.includes("2 anos e 10 meses"), true);
  assertEquals(/R\$/.test(t), false);
});

Deno.test("parsearAnalisePessoal valida o formato", () => {
  assertEquals(parsearAnalisePessoal('xx {"alinhamento":"atencao","resumo":" Ok ","pontos":["a","b","c","d"]} yy'),
    { alinhamento: "ATENCAO", resumo: "Ok", pontos: ["a", "b", "c"] });
  assertEquals(parsearAnalisePessoal('{"alinhamento":"TALVEZ","resumo":"x"}'), null);
  assertEquals(parsearAnalisePessoal('{"alinhamento":"ADEQUADO","resumo":""}'), null);
  assertEquals(parsearAnalisePessoal("sem json"), null);
});
