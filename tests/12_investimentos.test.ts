// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/12_investimentos.test.ts
//
// Cobre critérios de aceite: CA-INV01 a CA-INV18
// (ativos, posições, alocações, dividendos + extrato,
//  histórico mensal e dashboard)
// ============================================================

import { api } from "./setup";

let contaId:      string;
let categoriaId:  string;
let ativoId:      string;
let posicaoId:    string;
let tipoDivId:    string;       // tipo mapeado em categoria
let tipoDivSemCatId: string;    // tipo SEM categoria (CA-INV10)
let dividendoPagoId:  string;
let dividendoProjId:  string;
let txPagaId:    string;
let txProjId:    string;

const TICKER = "JESTINV1";

function hoje(): string {
  return new Date().toISOString().split("T")[0];
}

function dataFutura(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().split("T")[0];
}

function mesOffset(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toISOString().slice(0, 7);
}

// Remove resíduos de execuções anteriores (idempotência da suíte)
async function limparResiduosJest(): Promise<void> {
  const { data: divs } = await api("/investimentos/dividendos");
  for (const d of (divs?.dados ?? []).filter((d: any) => d.inv_ativos?.ticker?.startsWith("JESTINV"))) {
    await api(`/investimentos/dividendos/${d.id}`, "DELETE");
  }
  const { data: ativos } = await api("/investimentos/ativos");
  for (const a of (ativos?.dados ?? []).filter((a: any) => (a.ticker as string).startsWith("JESTINV"))) {
    const { data: pos } = await api(`/investimentos/posicoes?ativo_id=${a.id}`);
    for (const p of pos?.dados ?? []) {
      const { data: hist } = await api(`/investimentos/historico-mensal?ativo_id=${a.id}`);
      for (const h of hist?.dados ?? []) await api(`/investimentos/historico-mensal/${h.id}`, "DELETE");
      await api(`/investimentos/posicoes/${p.id}`, "DELETE");
    }
    await api(`/investimentos/ativos/${a.id}`, "DELETE");
  }
  const { data: tipos } = await api("/investimentos/tipos-dividendo");
  for (const t of (tipos?.dados ?? []).filter((t: any) => (t.nome as string).startsWith("Jest"))) {
    await api(`/investimentos/tipos-dividendo/${t.id}`, "DELETE");
  }
}

describe("Investimentos — CA-INV01 a CA-INV18", () => {

  beforeAll(async () => {
    // Conta e categoria existentes do usuário de teste
    const { data: contas } = await api("/contas") as { data: { dados: Record<string, unknown>[] } };
    expect(contas.dados.length).toBeGreaterThan(0);
    contaId = (contas.dados[0].conta_id ?? contas.dados[0].id) as string;

    const { data: cats } = await api("/categorias?apenas_pai=true") as { data: { dados: Record<string, unknown>[] } };
    expect(cats.dados.length).toBeGreaterThan(0);
    categoriaId = cats.dados[0].id as string;

    await limparResiduosJest();

    // Tipos de dividendo: um mapeado em categoria, outro sem
    const { data: t1 } = await api("/investimentos/tipos-dividendo", "POST", {
      nome: "Jest Dividendo", categoria_id: categoriaId,
    });
    tipoDivId = t1.dados.id as string;

    const { data: t2 } = await api("/investimentos/tipos-dividendo", "POST", {
      nome: "Jest Sem Categoria",
    });
    tipoDivSemCatId = t2.dados.id as string;
  }, 30000);

  afterAll(async () => {
    await limparResiduosJest();
  }, 30000);

  // ── Ativos ──────────────────────────────────────────────────

  test("CA-INV01 — POST /investimentos/ativos cria ativo com ticker normalizado", async () => {
    const { status, data } = await api("/investimentos/ativos", "POST", {
      ticker: "jestinv1", nome: "Jest Ativo Cripto", tipo_ativo: "CRIPTOMOEDAS", nota_usuario: 7.5,
    });
    expect(status).toBe(201);
    expect(data.dados.ticker).toBe(TICKER);
    expect(data.dados.tipo_ativo).toBe("CRIPTOMOEDAS");
    expect(Number(data.dados.nota_usuario)).toBe(7.5);
    ativoId = data.dados.id;
  });

  test("CA-INV02 — POST /investimentos/ativos com tipo_ativo inválido retorna 400", async () => {
    const { status } = await api("/investimentos/ativos", "POST", {
      ticker: "JESTINV9", nome: "Tipo inválido", tipo_ativo: "BITCOIN",
    });
    expect(status).toBe(400);
  });

  test("CA-INV03 — POST /investimentos/ativos com ticker duplicado retorna 409", async () => {
    const { status } = await api("/investimentos/ativos", "POST", {
      ticker: TICKER, nome: "Duplicado", tipo_ativo: "ACOES",
    });
    expect(status).toBe(409);
  });

  test("CA-INV04 — GET /investimentos/ativos filtra por tipo", async () => {
    const { status, data } = await api("/investimentos/ativos?tipo=CRIPTOMOEDAS");
    expect(status).toBe(200);
    const tickers = data.dados.map((a: any) => a.ticker);
    expect(tickers).toContain(TICKER);
    for (const a of data.dados) expect(a.tipo_ativo).toBe("CRIPTOMOEDAS");
  });

  test("CA-INV05 — PUT /investimentos/ativos/:id valida nota_usuario (0..10)", async () => {
    const { status: sErr } = await api(`/investimentos/ativos/${ativoId}`, "PUT", { nota_usuario: 11 });
    expect(sErr).toBe(400);

    const { status, data } = await api(`/investimentos/ativos/${ativoId}`, "PUT", { nota_usuario: 9 });
    expect(status).toBe(200);
    expect(Number(data.dados.nota_usuario)).toBe(9);
  });

  test("CA-INV19 — características de renda fixa e categoria de FII são validadas e persistidas", async () => {
    // rf_indexador inválido → 400
    const { status: sErr } = await api("/investimentos/ativos", "POST", {
      ticker: "JESTINV8", nome: "RF inválida", tipo_ativo: "RENDA_FIXA", rf_indexador: "FLUTUANTE",
    });
    expect(sErr).toBe(400);

    // fii_categoria inválida → 400
    const { status: sErr2 } = await api("/investimentos/ativos", "POST", {
      ticker: "JESTINV8", nome: "FII inválido", tipo_ativo: "FII", fii_categoria: "HIBRIDO",
    });
    expect(sErr2).toBe(400);

    // CDB pós-fixado com FGC e tabela regressiva (características da tabela de referência)
    const { status, data } = await api("/investimentos/ativos", "POST", {
      ticker: "JESTINV8", nome: "Jest CDB 110% CDI", tipo_ativo: "RENDA_FIXA",
      rf_subtipo: "CDB", rf_indexador: "POS_FIXADO", rf_taxa: "110% CDI",
      rf_emissor: "Banco Jest", rf_vencimento: "2028-01-15",
      rf_garantia_fgc: true, rf_isento_ir: false,
    });
    expect(status).toBe(201);
    expect(data.dados.rf_subtipo).toBe("CDB");
    expect(data.dados.rf_indexador).toBe("POS_FIXADO");
    expect(data.dados.rf_garantia_fgc).toBe(true);
    expect(data.dados.rf_isento_ir).toBe(false);

    // PUT muda para LCI isenta de IR
    const { status: sPut, data: dPut } = await api(`/investimentos/ativos/${data.dados.id}`, "PUT", {
      rf_subtipo: "LCI", rf_isento_ir: true,
    });
    expect(sPut).toBe(200);
    expect(dPut.dados.rf_subtipo).toBe("LCI");
    expect(dPut.dados.rf_isento_ir).toBe(true);

    await api(`/investimentos/ativos/${data.dados.id}`, "DELETE");
  });

  test("CA-INV20 — GET /investimentos/busca-externa valida tipo e tamanho mínimo da query", async () => {
    const { status: s1 } = await api("/investimentos/busca-externa?tipo=BITCOIN&q=petr");
    expect(s1).toBe(400); // tipo inválido

    const { status: s2 } = await api("/investimentos/busca-externa?tipo=ACOES&q=p");
    expect(s2).toBe(400); // q < 2 caracteres
  });

  // ── Posições ────────────────────────────────────────────────

  test("CA-INV06 — POST /investimentos/posicoes exige conta válida", async () => {
    const { status: s1 } = await api("/investimentos/posicoes", "POST", {
      ativo_id: ativoId, quantidade: 1, preco_custo: 10, data_compra: hoje(),
    });
    expect(s1).toBe(400); // sem conta_id

    const { status: s2 } = await api("/investimentos/posicoes", "POST", {
      ativo_id: ativoId, conta_id: "00000000-0000-0000-0000-000000000000",
      quantidade: 1, preco_custo: 10, data_compra: hoje(),
    });
    expect(s2).toBe(404); // conta inexistente
  });

  test("CA-INV07 — POST /investimentos/posicoes calcula valor_custo = qtd × preço", async () => {
    const { status, data } = await api("/investimentos/posicoes", "POST", {
      ativo_id: ativoId, conta_id: contaId, quantidade: 10, preco_custo: 25.5, data_compra: hoje(),
    });
    expect(status).toBe(201);
    expect(Number(data.dados.valor_custo)).toBe(255.0);
    posicaoId = data.dados.id;
  });

  test("CA-INV18 — DELETE /investimentos/ativos/:id com posições vinculadas retorna 409", async () => {
    const { status } = await api(`/investimentos/ativos/${ativoId}`, "DELETE");
    expect(status).toBe(409);
  });

  // ── Alocação ideal ──────────────────────────────────────────

  test("CA-INV08 — PUT /investimentos/alocacoes com soma ≠ 100% retorna 400", async () => {
    const { status, data } = await api("/investimentos/alocacoes", "PUT", {
      alocacoes: [
        { tipo_ativo: "ACOES", percentual_ideal: 50 },
        { tipo_ativo: "CRIPTOMOEDAS", percentual_ideal: 30 },
      ],
    });
    expect(status).toBe(400);
    expect(String(data.erro)).toMatch(/100/);
  });

  test("CA-INV09 — PUT /investimentos/alocacoes com soma 100% persiste e GET reflete", async () => {
    const { status } = await api("/investimentos/alocacoes", "PUT", {
      alocacoes: [
        { tipo_ativo: "ACOES", percentual_ideal: 60 },
        { tipo_ativo: "CRIPTOMOEDAS", percentual_ideal: 40 },
      ],
    });
    expect(status).toBe(200);

    const { data } = await api("/investimentos/alocacoes");
    const cripto = data.dados.find((a: any) => a.tipo_ativo === "CRIPTOMOEDAS");
    expect(Number(cripto?.percentual_ideal)).toBe(40);
  });

  // ── Dividendos + extrato ────────────────────────────────────

  test("CA-INV10 — POST /investimentos/dividendos com tipo sem categoria retorna 409", async () => {
    const { status, data } = await api("/investimentos/dividendos", "POST", {
      ativo_id: ativoId, conta_id: contaId, valor: 10, data_pagamento: hoje(),
      tipo_ativo: "CRIPTOMOEDAS", tipo_dividendo_id: tipoDivSemCatId,
    });
    expect(status).toBe(409);
    expect(String(data.erro)).toMatch(/categoria/i);
  });

  test("CA-INV11 — POST /investimentos/dividendos (data ≤ hoje) gera transação PAGO no extrato", async () => {
    const { status, data } = await api("/investimentos/dividendos", "POST", {
      ativo_id: ativoId, conta_id: contaId, valor: 12.34, data_pagamento: hoje(),
      tipo_ativo: "CRIPTOMOEDAS", tipo_dividendo_id: tipoDivId, descricao: "Jest div pago",
    });
    expect(status).toBe(201);
    dividendoPagoId = data.dados.id;
    txPagaId = data.dados.transacao_extrato_id;
    expect(txPagaId).toBeTruthy();
    expect(data.dados.transacoes?.status).toBe("PAGO");

    // Transação visível no extrato com descrição "TICKER - Tipo" e RECEITA
    const { status: sTx, data: tx } = await api(`/transacoes/${txPagaId}`);
    expect(sTx).toBe(200);
    expect(tx.status).toBe("PAGO");
    expect(tx.tipo).toBe("RECEITA");
    expect(tx.descricao).toContain(TICKER);
    expect(Number(tx.valor)).toBe(12.34);
  });

  test("CA-INV12 — POST /investimentos/dividendos com data futura gera PROJECAO", async () => {
    const { status, data } = await api("/investimentos/dividendos", "POST", {
      ativo_id: ativoId, conta_id: contaId, valor: 50, data_pagamento: dataFutura(15),
      tipo_ativo: "CRIPTOMOEDAS", tipo_dividendo_id: tipoDivId,
    });
    expect(status).toBe(201);
    dividendoProjId = data.dados.id;
    txProjId = data.dados.transacao_extrato_id;
    expect(data.dados.transacoes?.status).toBe("PROJECAO");

    const { data: tx } = await api(`/transacoes/${txProjId}`);
    expect(tx.status).toBe("PROJECAO");
    expect(Number(tx.valor_projetado)).toBe(50);
  });

  test("CA-INV14 — PUT /investimentos/dividendos/:id sincroniza valor na transação", async () => {
    const { status, data } = await api(`/investimentos/dividendos/${dividendoProjId}`, "PUT", { valor: 55 });
    expect(status).toBe(200);
    expect(Number(data.dados.valor)).toBe(55);

    const { data: tx } = await api(`/transacoes/${txProjId}`);
    expect(Number(tx.valor)).toBe(55);
    expect(Number(tx.valor_projetado)).toBe(55); // projeção acompanha
  });

  test("CA-INV13 — POST /investimentos/dividendos/:id/confirmar converte PROJECAO em PAGO", async () => {
    const { status, data } = await api(`/investimentos/dividendos/${dividendoProjId}/confirmar`, "POST", {
      valor: 52.5, data_pagamento: hoje(),
    });
    expect(status).toBe(200);
    expect(data.dados.transacoes?.status).toBe("PAGO");
    expect(Number(data.dados.valor)).toBe(52.5);

    const { data: tx } = await api(`/transacoes/${txProjId}`);
    expect(tx.status).toBe("PAGO");
    expect(Number(tx.valor)).toBe(52.5);

    // Confirmar de novo → 409
    const { status: s2 } = await api(`/investimentos/dividendos/${dividendoProjId}/confirmar`, "POST");
    expect(s2).toBe(409);
  });

  test("CA-INV15 — DELETE /investimentos/dividendos/:id remove a transação do extrato", async () => {
    const { status } = await api(`/investimentos/dividendos/${dividendoPagoId}`, "DELETE");
    expect(status).toBe(200);
    dividendoPagoId = "";

    const { status: sTx } = await api(`/transacoes/${txPagaId}`);
    expect(sTx).toBe(404);
  });

  // ── Histórico mensal ────────────────────────────────────────

  test("CA-INV16 — POST /investimentos/historico-mensal calcula variação contra o mês anterior", async () => {
    // Mês passado: 255 (= custo). Quantidade derivada das posições (10)
    const { status: s1, data: d1 } = await api("/investimentos/historico-mensal", "POST", {
      ativo_id: ativoId, conta_id: contaId, mes_ano: mesOffset(-1), valor_mercado: 255,
    });
    expect(s1).toBe(201);
    expect(Number(d1.dados.quantidade)).toBe(10);
    expect(Number(d1.dados.variacao_percentual)).toBe(0); // sem mês anterior

    // Mês atual: 280 → +25 sobre 255 = +9.8039%
    const { status: s2, data: d2 } = await api("/investimentos/historico-mensal", "POST", {
      ativo_id: ativoId, conta_id: contaId, mes_ano: mesOffset(0), valor_mercado: 280,
    });
    expect(s2).toBe(201);
    expect(Number(d2.dados.rentabilidade_mes)).toBe(25);
    expect(Number(d2.dados.variacao_percentual)).toBeCloseTo(9.8039, 3);

    // mes_ano inválido → 400
    const { status: s3 } = await api("/investimentos/historico-mensal", "POST", {
      ativo_id: ativoId, conta_id: contaId, mes_ano: "2026/06", valor_mercado: 100,
    });
    expect(s3).toBe(400);
  });

  test("CA-INV17 — GET /investimentos/dashboard consolida por tipo com snapshot e alocação", async () => {
    const { status, data } = await api("/investimentos/dashboard");
    expect(status).toBe(200);
    expect(data.dados).toHaveProperty("tipos");

    const cripto = data.dados.tipos.find((t: any) => t.tipo_ativo === "CRIPTOMOEDAS");
    expect(cripto).toBeTruthy();
    // Snapshot mais recente (280) prevalece sobre o custo (255)
    expect(Number(cripto.valor_mercado)).toBeGreaterThanOrEqual(280);
    expect(Number(cripto.percentual_ideal)).toBe(40);
    expect(cripto).toHaveProperty("desvio_pct");
  });

  // Limpeza encadeada do que sobrou (projeção confirmada vira PAGO no extrato)
  test("CA-INV — limpeza: excluir dividendo confirmado, snapshots, posição e ativo", async () => {
    const { status: sDiv } = await api(`/investimentos/dividendos/${dividendoProjId}`, "DELETE");
    expect(sDiv).toBe(200);

    const { data: hist } = await api(`/investimentos/historico-mensal?ativo_id=${ativoId}`);
    for (const h of hist?.dados ?? []) {
      const { status } = await api(`/investimentos/historico-mensal/${h.id}`, "DELETE");
      expect(status).toBe(200);
    }

    const { status: sPos } = await api(`/investimentos/posicoes/${posicaoId}`, "DELETE");
    expect(sPos).toBe(200);

    const { status: sAtv } = await api(`/investimentos/ativos/${ativoId}`, "DELETE");
    expect(sAtv).toBe(200);
  });
});

// ============================================================
// Importação em lote — POST /investimentos/importar
// CA-INV-IMP01 a CA-INV-IMP05
// ============================================================
describe("Investimentos — importação em lote (CA-INV-IMP)", () => {
  const TICKER_IMP = "JESTINVIMP";
  let contaImpId: string;
  let categoriaImpId: string;

  const ontem = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toISOString().split("T")[0]; })();

  async function limparImp(): Promise<void> {
    const { data: divs } = await api("/investimentos/dividendos");
    for (const d of (divs?.dados ?? []).filter((d: any) => d.inv_ativos?.ticker === TICKER_IMP)) {
      await api(`/investimentos/dividendos/${d.id}`, "DELETE");
    }
    const { data: ativos } = await api("/investimentos/ativos");
    for (const a of (ativos?.dados ?? []).filter((a: any) => a.ticker === TICKER_IMP)) {
      const { data: hist } = await api(`/investimentos/historico-mensal?ativo_id=${a.id}`);
      for (const h of hist?.dados ?? []) await api(`/investimentos/historico-mensal/${h.id}`, "DELETE");
      const { data: pos } = await api(`/investimentos/posicoes?ativo_id=${a.id}`);
      for (const p of pos?.dados ?? []) await api(`/investimentos/posicoes/${p.id}`, "DELETE");
      await api(`/investimentos/ativos/${a.id}`, "DELETE");
    }
    const { data: tipos } = await api("/investimentos/tipos-dividendo");
    for (const t of (tipos?.dados ?? []).filter((t: any) => (t.nome as string) === "Jest Imp Provento")) {
      await api(`/investimentos/tipos-dividendo/${t.id}`, "DELETE");
    }
  }

  beforeAll(async () => {
    const { data: contas } = await api("/contas") as { data: { dados: any[] } };
    contaImpId = (contas.dados[0].conta_id ?? contas.dados[0].id) as string;
    const { data: cats } = await api("/categorias?apenas_pai=true") as { data: { dados: any[] } };
    categoriaImpId = cats.dados[0].id as string;
    await limparImp();
    await api("/investimentos/tipos-dividendo", "POST", {
      nome: "Jest Imp Provento", categoria_id: categoriaImpId,
    });
  }, 30000);

  afterAll(async () => { await limparImp(); }, 30000);

  test("CA-INV-IMP01 — importa ativo + posição (custo do extrato) + operações", async () => {
    const { status, data } = await api("/investimentos/importar", "POST", {
      ativos: [{ ticker: TICKER_IMP, nome: "Jest Import Ação", tipo_ativo: "ACOES", moeda: "BRL" }],
      // custo médio = (100*10 + 100*12) / 200 = 11
      posicoes: [{ ticker: TICKER_IMP, conta_id: contaImpId, quantidade: 200, preco_custo: 11,
        data_compra: ontem, valor_mercado: 2600, mes_ano: mesOffset(0) }],
      operacoes: [
        { ticker: TICKER_IMP, conta_id: contaImpId, tipo_operacao: "COMPRA", quantidade: 100, preco_unitario: 10, valor_total: 1000, data_operacao: ontem },
        { ticker: TICKER_IMP, conta_id: contaImpId, tipo_operacao: "COMPRA", quantidade: 100, preco_unitario: 12, valor_total: 1200, data_operacao: ontem },
      ],
      dividendos: [],
      gerar_extrato_proventos: false,
    });
    expect(status).toBe(201);
    expect(data.dados.ativos_criados).toBeGreaterThanOrEqual(1);
    expect(data.dados.posicoes).toBeGreaterThanOrEqual(1);
    expect(data.dados.operacoes).toBe(2);

    // Posição persistida com o custo enviado e valor de mercado no histórico
    const { data: ativos } = await api("/investimentos/ativos");
    const ativo = (ativos.dados as any[]).find(a => a.ticker === TICKER_IMP);
    expect(ativo).toBeTruthy();
    const { data: pos } = await api(`/investimentos/posicoes?ativo_id=${ativo.id}`);
    expect(pos.dados.length).toBe(1);
    expect(Number(pos.dados[0].preco_custo)).toBeCloseTo(11, 2);
    expect(Number(pos.dados[0].quantidade)).toBe(200);
  });

  test("CA-INV-IMP02 — idempotência: reimportar não duplica operações", async () => {
    const { data: ativos } = await api("/investimentos/ativos");
    const ativo = (ativos.dados as any[]).find(a => a.ticker === TICKER_IMP);
    const { data: pos } = await api(`/investimentos/posicoes?ativo_id=${ativo.id}`);
    const posId = pos.dados[0].id;

    const { status, data } = await api("/investimentos/importar", "POST", {
      ativos: [{ ticker: TICKER_IMP, nome: "Jest Import Ação", tipo_ativo: "ACOES" }],
      posicoes: [{ ticker: TICKER_IMP, conta_id: contaImpId, quantidade: 200, preco_custo: 11,
        data_compra: ontem, valor_mercado: 2600, mes_ano: mesOffset(0) }],
      operacoes: [
        { ticker: TICKER_IMP, conta_id: contaImpId, tipo_operacao: "COMPRA", quantidade: 100, preco_unitario: 10, valor_total: 1000, data_operacao: ontem },
        { ticker: TICKER_IMP, conta_id: contaImpId, tipo_operacao: "COMPRA", quantidade: 100, preco_unitario: 12, valor_total: 1200, data_operacao: ontem },
      ],
      dividendos: [],
      gerar_extrato_proventos: false,
    });
    expect(status).toBe(201);
    expect(data.dados.ativos_criados).toBe(0);
    expect(data.dados.operacoes).toBe(0);   // dedup

    const { data: ops } = await api(`/investimentos/operacoes?posicao_id=${posId}`);
    expect(ops.dados.length).toBe(2);        // continua 2, não 4
  });

  test("CA-INV-IMP03 — provento sem extrato não cria transação", async () => {
    const { status, data } = await api("/investimentos/importar", "POST", {
      ativos: [{ ticker: TICKER_IMP, nome: "Jest Import Ação", tipo_ativo: "ACOES" }],
      posicoes: [],
      operacoes: [],
      dividendos: [{ ticker: TICKER_IMP, conta_id: contaImpId, valor: 5.5, data_pagamento: ontem,
        tipo_ativo: "ACOES", tipo_dividendo_nome: "Jest Imp Provento" }],
      gerar_extrato_proventos: false,
    });
    expect(status).toBe(201);
    expect(data.dados.dividendos).toBe(1);
    expect(data.dados.dividendos_no_extrato).toBe(0);

    const { data: divs } = await api("/investimentos/dividendos");
    const div = (divs.dados as any[]).find(d => d.inv_ativos?.ticker === TICKER_IMP && Number(d.valor) === 5.5);
    expect(div).toBeTruthy();
    expect(div.transacao_extrato_id).toBeNull();
  });

  test("CA-INV-IMP04 — provento com extrato cria transação RECEITA", async () => {
    const { status, data } = await api("/investimentos/importar", "POST", {
      ativos: [{ ticker: TICKER_IMP, nome: "Jest Import Ação", tipo_ativo: "ACOES" }],
      posicoes: [],
      operacoes: [],
      dividendos: [{ ticker: TICKER_IMP, conta_id: contaImpId, valor: 9.9, data_pagamento: ontem,
        tipo_ativo: "ACOES", tipo_dividendo_nome: "Jest Imp Provento" }],
      gerar_extrato_proventos: true,
    });
    expect(status).toBe(201);
    expect(data.dados.dividendos).toBe(1);
    expect(data.dados.dividendos_no_extrato).toBe(1);

    const { data: divs } = await api("/investimentos/dividendos");
    const div = (divs.dados as any[]).find(d => d.inv_ativos?.ticker === TICKER_IMP && Number(d.valor) === 9.9);
    expect(div).toBeTruthy();
    expect(div.transacao_extrato_id).toBeTruthy();
  });

  test("CA-INV-IMP05 — payload vazio retorna 400", async () => {
    const { status } = await api("/investimentos/importar", "POST", {
      ativos: [], posicoes: [], operacoes: [], dividendos: [],
    });
    expect(status).toBe(400);
  });
});
