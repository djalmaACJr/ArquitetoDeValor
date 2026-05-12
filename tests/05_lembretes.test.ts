// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/05_lembretes.test.ts
//
// Cobre critérios de aceite: CA-LEM01 a CA-LEM11
// ============================================================

import { api, apiSemAuth } from "./setup";

let contaId:     string;
let categoriaId: string;
let lembreteId:  string;
let txVinculadaId: string;

function dataFutura(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  return d.toISOString().split("T")[0];
}

function mesAtual(): string {
  return new Date().toISOString().slice(0, 7);
}

async function limparLembretesJest(): Promise<void> {
  const mes = mesAtual();
  const { data } = await api(`/lembretes?mes=${mes}`);
  const todos: any[] = data?.dados ?? [];
  for (const l of todos.filter((l: any) => (l.descricao as string)?.startsWith("Jest Lembrete"))) {
    await api(`/lembretes/${l.id}`, "DELETE");
  }
}

describe("Lembretes — CA-LEM01 a CA-LEM11", () => {

  beforeAll(async () => {
    // Reutiliza primeira conta ativa existente
    const { data: contas } = await api("/contas") as { data: { dados: Record<string, unknown>[] } };
    expect(contas.dados.length).toBeGreaterThan(0);
    contaId = (contas.dados[0].conta_id ?? contas.dados[0].id) as string;

    // Reutiliza primeira categoria existente
    const { data: cats } = await api("/categorias?apenas_pai=true") as { data: { dados: Record<string, unknown>[] } };
    expect(cats.dados.length).toBeGreaterThan(0);
    categoriaId = cats.dados[0].id as string;

    // Cria transação futura para os testes de cascade (CA-LEM10/11)
    const { data: tx } = await api("/transacoes", "POST", {
      data:         dataFutura(10),
      descricao:    "Jest TX Vinculada Lembrete",
      valor:        50.00,
      tipo:         "DESPESA",
      status:       "PENDENTE",
      conta_id:     contaId,
      categoria_id: categoriaId,
    }) as { data: Record<string, unknown> };
    txVinculadaId = tx.id as string;

    await limparLembretesJest();
  });

  afterAll(async () => {
    await limparLembretesJest();
    // Remove transação vinculada se ainda existir
    if (txVinculadaId) {
      await api(`/transacoes/${txVinculadaId}`, "DELETE");
    }
  });

  // ── CA-LEM01 ────────────────────────────────────────────────
  test("CA-LEM01 — GET /lembretes?mes=YYYY-MM retorna 200 com array", async () => {
    const mes = mesAtual();
    const { status, data } = await api(`/lembretes?mes=${mes}`);
    expect(status).toBe(200);
    expect(data).toHaveProperty("dados");
    expect(Array.isArray(data.dados)).toBe(true);
  });

  // ── CA-LEM02 ────────────────────────────────────────────────
  test("CA-LEM02 — POST /lembretes cria lembrete e retorna 201 com campos corretos", async () => {
    const { status, data } = await api("/lembretes", "POST", {
      data:      dataFutura(5),
      descricao: "Jest Lembrete Principal",
    });
    expect(status).toBe(201);
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("descricao", "Jest Lembrete Principal");
    expect(data).toHaveProperty("status", "PENDENTE");
    expect(data.lancamento_id).toBeNull();
    lembreteId = data.id as string;
  });

  // ── CA-LEM03 ────────────────────────────────────────────────
  test("CA-LEM03 — GET /lembretes?mes= lista o lembrete criado", async () => {
    const mes = dataFutura(5).slice(0, 7);
    const { status, data } = await api(`/lembretes?mes=${mes}`);
    expect(status).toBe(200);
    const lista: any[] = data.dados ?? [];
    const encontrado = lista.find((l: any) => l.id === lembreteId);
    expect(encontrado).toBeDefined();
    expect(encontrado.descricao).toBe("Jest Lembrete Principal");
  });

  // ── CA-LEM04 ────────────────────────────────────────────────
  test("CA-LEM04 — PUT /lembretes/:id atualiza descricao e retorna 200", async () => {
    const { status, data } = await api(`/lembretes/${lembreteId}`, "PUT", {
      descricao: "Jest Lembrete Editado",
    });
    expect(status).toBe(200);
    expect(data.descricao).toBe("Jest Lembrete Editado");
  });

  // ── CA-LEM05 ────────────────────────────────────────────────
  test("CA-LEM05 — PUT /lembretes/:id status PENDENTE→CONCLUIDO retorna 200", async () => {
    const { status, data } = await api(`/lembretes/${lembreteId}`, "PUT", {
      status: "CONCLUIDO",
    });
    expect(status).toBe(200);
    expect(data.status).toBe("CONCLUIDO");
  });

  // ── CA-LEM06 ────────────────────────────────────────────────
  test("CA-LEM06 — PUT /lembretes/:id ID inexistente retorna 404", async () => {
    const { status } = await api(
      "/lembretes/00000000-0000-0000-0000-000000000000",
      "PUT",
      { descricao: "nao existe" }
    );
    expect(status).toBe(404);
  });

  // ── CA-LEM07 ────────────────────────────────────────────────
  test("CA-LEM07 — DELETE /lembretes/:id retorna 200 e lembrete some do GET", async () => {
    const { status } = await api(`/lembretes/${lembreteId}`, "DELETE");
    expect(status).toBe(200);

    // Confirma que sumiu
    const mes = dataFutura(5).slice(0, 7);
    const { data } = await api(`/lembretes?mes=${mes}`);
    const lista: any[] = data.dados ?? [];
    expect(lista.find((l: any) => l.id === lembreteId)).toBeUndefined();
  });

  // ── CA-LEM08 ────────────────────────────────────────────────
  test("CA-LEM08 — POST /lembretes com descricao vazia retorna 422 ou 400", async () => {
    const { status } = await api("/lembretes", "POST", {
      data:      dataFutura(3),
      descricao: "",
    });
    expect([400, 422]).toContain(status);
  });

  // ── CA-LEM09 ────────────────────────────────────────────────
  test("CA-LEM09 — POST /lembretes sem autenticação retorna 401", async () => {
    const { status } = await apiSemAuth("/lembretes", "POST", {
      data:      dataFutura(3),
      descricao: "Sem auth",
    });
    expect(status).toBe(401);
  });

  // ── CA-LEM10 ────────────────────────────────────────────────
  test("CA-LEM10 — POST /lembretes com lancamento_id válido associa corretamente", async () => {
    const { status, data } = await api("/lembretes", "POST", {
      data:          dataFutura(10),
      descricao:     "Jest Lembrete Vinculado",
      lancamento_id: txVinculadaId,
    });
    expect(status).toBe(201);
    expect(data.lancamento_id).toBe(txVinculadaId);

    // Verifica que aparece no GET com lancamento_id preenchido
    const mes = dataFutura(10).slice(0, 7);
    const { data: lista } = await api(`/lembretes?mes=${mes}`);
    const encontrado = (lista.dados ?? []).find((l: any) => l.id === data.id);
    expect(encontrado?.lancamento_id).toBe(txVinculadaId);

    // Guarda id para CA-LEM11
    (global as any).__lembreteVinculadoId = data.id;
  });

  // ── CA-LEM11 ────────────────────────────────────────────────
  test("CA-LEM11 — DELETE transação vinculada remove lembrete em cascata", async () => {
    const lembreteVinculadoId = (global as any).__lembreteVinculadoId as string;
    expect(lembreteVinculadoId).toBeDefined();

    // Exclui a transação (CASCADE deve remover o lembrete)
    const { status: sDelete } = await api(
      `/transacoes/${txVinculadaId}?escopo=SOMENTE_ESTE`,
      "DELETE"
    );
    expect(sDelete).toBe(200);
    txVinculadaId = ""; // evita double-delete no afterAll

    // Lembrete não deve mais existir (GET retorna 404 ou lembrete ausente da lista)
    const mes = dataFutura(10).slice(0, 7);
    const { data: lista } = await api(`/lembretes?mes=${mes}`);
    const encontrado = (lista.dados ?? []).find((l: any) => l.id === lembreteVinculadoId);
    expect(encontrado).toBeUndefined();
  });
});
