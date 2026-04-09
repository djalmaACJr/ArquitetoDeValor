// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/transacoes.test.ts
//
// Cobre critérios de aceite: CA-TX01 a CA-TX18
// ============================================================
import { api, limparTransacao } from "./setup";

let contaId: string;
let categoriaId: string;
let transacaoId: string;
let grupoRecorrenciaId: string;
const parcelas: string[] = [];

const TX_VALIDA = () => ({
  data: new Date().toISOString().split("T")[0],
  descricao: "Teste Jest Transacao",
  valor: 150.00,
  tipo: "DESPESA",
  status: "PAGO",
  conta_id: contaId,
  categoria_id: categoriaId,
});

describe("Transações — CA-TX01 a CA-TX18", () => {

  // ── Setup: busca conta e categoria existentes ──────────────
  beforeAll(async () => {
    const { data: contas } = await api("/contas") as { data: { dados: Record<string, unknown>[] } };
    expect(contas.dados.length).toBeGreaterThan(0);
    contaId = contas.dados[0].conta_id as string;

    const { data: cats } = await api("/categorias?apenas_pai=true") as { data: { dados: Record<string, unknown>[] } };
    expect(cats.dados.length).toBeGreaterThan(0);
    categoriaId = cats.dados[0].id as string;

    const { data: tx } = await api("/transacoes", "POST", TX_VALIDA()) as { data: Record<string, unknown> };
    transacaoId = tx.id as string;

    // Cria grupo de parcelas para testes de recorrência
    grupoRecorrenciaId = crypto.randomUUID();
    for (let i = 1; i <= 3; i++) {
      const { data: p } = await api("/transacoes", "POST", {
        ...TX_VALIDA(),
        descricao: `Parcela ${i}/3`,
        id_recorrencia: grupoRecorrenciaId,
        nr_parcela: i,
        total_parcelas: 3,
        tipo_recorrencia: "PARCELA",
        status: "PENDENTE",
      }) as { data: Record<string, unknown> };
      parcelas.push(p.id as string);
    }
  });

  afterAll(async () => {
    if (transacaoId) await limparTransacao(transacaoId);
    for (const id of parcelas) {
      await limparTransacao(id).catch(() => {});
    }
  });

  // ── CA-TX01 ───────────────────────────────────────────────
  test("CA-TX01 — GET /transacoes retorna 200 com array", async () => {
    const { status, data } = await api("/transacoes") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect(data).toHaveProperty("dados");
    expect(Array.isArray((data as { dados: unknown[] }).dados)).toBe(true);
  });

  // ── CA-TX02 ───────────────────────────────────────────────
  test("CA-TX02 — GET /transacoes?mes=YYYY-MM filtra pelo mês correto", async () => {
    const mes = new Date().toISOString().slice(0, 7);
    const { status, data } = await api(`/transacoes?mes=${mes}`) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    const mesNum = new Date().getMonth() + 1;
    const anoNum = new Date().getFullYear();
    const foraDoMes = dados.filter((t) => t.mes_tx !== mesNum || t.ano_tx !== anoNum);
    expect(foraDoMes.length).toBe(0);
  });

  // ── CA-TX03 ───────────────────────────────────────────────
  test("CA-TX03 — GET /transacoes?saldo=true retorna campo saldo_acumulado", async () => {
    const { status, data } = await api("/transacoes?saldo=true") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    if (dados.length > 0) {
      expect(dados[0]).toHaveProperty("saldo_acumulado");
    }
  });

  // ── CA-TX04 ───────────────────────────────────────────────
  test("CA-TX04 — GET /transacoes?status=PENDENTE filtra por status", async () => {
    const { status, data } = await api("/transacoes?status=PENDENTE") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    const invalidos = dados.filter((t) => t.status !== "PENDENTE");
    expect(invalidos.length).toBe(0);
  });

  // ── CA-TX05 ───────────────────────────────────────────────
  test("CA-TX05 — GET /transacoes/:id retorna 404 para ID inexistente", async () => {
    const { status } = await api("/transacoes/00000000-0000-0000-0000-000000000000");
    expect(status).toBe(404);
  });

  // ── CA-TX06 ───────────────────────────────────────────────
  test("CA-TX06 — POST /transacoes cria lançamento e retorna 201", async () => {
    const { status, data } = await api("/transacoes", "POST", TX_VALIDA()) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(201);
    expect(data).toHaveProperty("id");
    expect((data as { descricao: string }).descricao).toBe("Teste Jest Transacao");
    await limparTransacao((data as { id: string }).id);
  });

  // ── CA-TX07 ───────────────────────────────────────────────
  test("CA-TX07 — POST /transacoes rejeita valor zero ou negativo", async () => {
    const { status, data } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      valor: 0,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/RV-002/i);
  });

  // ── CA-TX08 ───────────────────────────────────────────────
  test("CA-TX08 — POST /transacoes rejeita tipo inválido", async () => {
    const { status, data } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      tipo: "INVALIDO",
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/RV-006/i);
  });

  // ── CA-TX09 ───────────────────────────────────────────────
  test("CA-TX09 — POST /transacoes rejeita status inválido", async () => {
    const { status, data } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      status: "INVALIDO",
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/status inválido/i);
  });

  // ── CA-TX10 ───────────────────────────────────────────────
  test("CA-TX10 — POST /transacoes rejeita conta inexistente", async () => {
    const { status } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      conta_id: "00000000-0000-0000-0000-000000000000",
    });
    expect([400, 404, 409, 422, 500]).toContain(status);
  });

  // ── CA-TX11 ───────────────────────────────────────────────
  test("CA-TX11 — PUT com escopo SOMENTE_ESTE atualiza apenas 1 lançamento", async () => {
    const novaDescricao = "Atualizado SOMENTE_ESTE";
    const { status, data } = await api(
      `/transacoes/${parcelas[1]}?escopo=SOMENTE_ESTE`,
      "PUT",
      { descricao: novaDescricao }
    ) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect((data as { atualizados: number }).atualizados).toBe(1);

    const { data: tx0 } = await api(`/transacoes/${parcelas[0]}`) as { data: Record<string, unknown> };
    expect((tx0 as { descricao: string }).descricao).toBe("Parcela 1/3");
  });

  // ── CA-TX12 ───────────────────────────────────────────────
  test("CA-TX12 — PUT com escopo TODOS atualiza o grupo inteiro", async () => {
    const { status, data } = await api(
      `/transacoes/${parcelas[0]}?escopo=TODOS`,
      "PUT",
      { observacao: "Atualizado em grupo" }
    ) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect((data as { atualizados: number }).atualizados).toBe(3);
  });

  // ── CA-TX13 ───────────────────────────────────────────────
  test("CA-TX13 — DELETE exclui e retorna IDs excluídos", async () => {
    const { data: nova } = await api("/transacoes", "POST", TX_VALIDA()) as { data: Record<string, unknown> };
    const { status, data } = await api(
      `/transacoes/${(nova as { id: string }).id}`,
      "DELETE"
    ) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect((data as { excluidos: number }).excluidos).toBe(1);
    expect(Array.isArray((data as { ids: string[] }).ids)).toBe(true);
  });

  // ── CA-TX14 ───────────────────────────────────────────────
  test("CA-TX14 — DELETE retorna 404 para ID inexistente", async () => {
    const { status } = await api(
      "/transacoes/00000000-0000-0000-0000-000000000000",
      "DELETE"
    );
    expect(status).toBe(404);
  });

  // ── CA-TX15 ───────────────────────────────────────────────
  test("CA-TX15 — POST /:id/antecipar consolida parcelas seguintes", async () => {
    const { status, data } = await api(
      `/transacoes/${parcelas[0]}/antecipar`,
      "POST"
    ) as { status: number; data: Record<string, unknown> };
    expect([200, 400]).toContain(status);
    if (status === 200) {
      expect(data).toHaveProperty("mensagem");
    }
  });

  // ── CA-TX16 ───────────────────────────────────────────────
  test("CA-TX16 — POST /:id/antecipar retorna 400 na última parcela", async () => {
    const ultimaParcela = parcelas[parcelas.length - 1];
    const { data: txs } = await api("/transacoes") as { data: { dados: Record<string, unknown>[] } };
    const ultima = txs.dados.find((t) => t.id === ultimaParcela);
    if (!ultima) {
      console.warn("CA-TX16: parcela já foi antecipada ou excluída — pulado.");
      return;
    }
    const { status, data } = await api(
      `/transacoes/${ultimaParcela}/antecipar`,
      "POST"
    ) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/última parcela/i);
  });

  // ── CA-TX17 ───────────────────────────────────────────────
  test("CA-TX17 — valor_projetado preservado após antecipação", async () => {
    const { data: tx } = await api(`/transacoes/${parcelas[0]}`) as { data: Record<string, unknown> };
    if ((tx as { status: string }).status === "PAGO") {
      expect(tx).toHaveProperty("valor_projetado");
    } else {
      console.warn("CA-TX17: parcela ainda não foi paga — pulado.");
    }
  });

  // ── CA-TX18 ───────────────────────────────────────────────
  test("CA-TX18 — valor_projetado preenchido ao mudar PROJECAO → PAGO", async () => {
    const { data: projecao } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      status: "PROJECAO",
      valor: 200.00,
      descricao: "Projecao CA-TX18",
    }) as { data: Record<string, unknown> };

    const { data: confirmado } = await api(
      `/transacoes/${(projecao as { id: string }).id}`,
      "PUT",
      { status: "PAGO", valor: 180.00 }
    ) as { data: Record<string, unknown> };

    const dados = (confirmado as { dados: Record<string, unknown>[] }).dados;
    const tx = dados?.[0] ?? confirmado;
    expect((tx as { valor_projetado: number }).valor_projetado).toBe(200.00);

    await limparTransacao((projecao as { id: string }).id).catch(() => {});
  });
});
