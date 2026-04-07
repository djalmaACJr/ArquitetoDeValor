// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/contas.test.ts
//
// Cobre critérios de aceite: CA-C01 a CA-C15
// ============================================================
import { api, apiSemAuth, limparConta } from "./setup";

const CONTA_VALIDA = {
  nome: "Teste Automatizado Jest",
  tipo: "CORRENTE",
  saldo_inicial: 1000,
  cor: "#123456",
};

describe("Contas — CA-C01 a CA-C15", () => {
  let contaId: string;

  // ── Criação para uso nos testes de leitura/edição ──────────
  beforeAll(async () => {
    const { data } = await api("/contas", "POST", CONTA_VALIDA) as { data: Record<string, unknown> };
    contaId = data.id as string;
  });

  afterAll(async () => {
    if (contaId) await limparConta(contaId);
  });

  // ── CA-C01: GET /contas retorna 200 com array ──────────────
  test("CA-C01 — GET /contas retorna 200 com array de contas", async () => {
    const { status, data } = await api("/contas") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect(data).toHaveProperty("dados");
    expect(Array.isArray((data as { dados: unknown[] }).dados)).toBe(true);
  });

  // ── CA-C02: GET /contas/:id retorna a conta correta ─────────
  test("CA-C02 — GET /contas/:id retorna 200 com a conta correta", async () => {
    const { status, data } = await api(`/contas/${contaId}`) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect((data as { conta_id: string }).conta_id).toBe(contaId);
  });

  // ── CA-C03: GET /contas/:id retorna 404 para ID inexistente ─
  test("CA-C03 — GET /contas/:id retorna 404 para ID inexistente", async () => {
    const { status } = await api("/contas/00000000-0000-0000-0000-000000000000");
    expect(status).toBe(404);
  });

  // ── CA-C04: POST /contas cria e retorna 201 ─────────────────
  test("CA-C04 — POST /contas cria conta e retorna 201", async () => {
    const conta = { nome: "Conta CA-C04", tipo: "CARTEIRA", saldo_inicial: 0 };
    const { status, data } = await api("/contas", "POST", conta) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(201);
    expect(data).toHaveProperty("id");
    expect((data as { nome: string }).nome).toBe("Conta CA-C04");
    await limparConta((data as { id: string }).id);
  });

  // ── CA-C05: POST rejeita nome vazio com 400 ─────────────────
  test("CA-C05 — POST /contas rejeita nome vazio com 400", async () => {
    const { status } = await api("/contas", "POST", { nome: "", tipo: "CORRENTE" });
    expect(status).toBe(400);
  });

  // ── CA-C06: POST rejeita tipo inválido com 400 ──────────────
  test("CA-C06 — POST /contas rejeita tipo inválido com 400", async () => {
    const { status, data } = await api("/contas", "POST", {
      nome: "Conta Inválida",
      tipo: "TIPO_INEXISTENTE",
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/tipo inválido/i);
  });

  // ── CA-C07: POST rejeita cor inválida com 400 ───────────────
  test("CA-C07 — POST /contas rejeita cor inválida com 400", async () => {
    const { status, data } = await api("/contas", "POST", {
      nome: "Conta Cor Inválida",
      tipo: "CORRENTE",
      cor: "vermelho",
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/cor/i);
  });

  // ── CA-C08: POST rejeita duplicata (nome+tipo) com 409 ──────
  test("CA-C08 — POST /contas rejeita duplicata com 409", async () => {
    const { status, data } = await api("/contas", "POST", CONTA_VALIDA) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(409);
    expect((data as { erro: string }).erro).toMatch(/já existe/i);
  });

  // ── CA-C09: PUT atualiza apenas os campos enviados ──────────
  test("CA-C09 — PUT /contas/:id atualiza apenas os campos enviados", async () => {
    const { status, data } = await api(`/contas/${contaId}`, "PUT", {
      cor: "#aabbcc",
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect((data as { cor: string }).cor).toBe("#aabbcc");
    expect((data as { nome: string }).nome).toBe(CONTA_VALIDA.nome);
  });

  // ── CA-C10: PUT retorna 404 para ID inexistente ─────────────
  test("CA-C10 — PUT /contas/:id retorna 404 para ID inexistente", async () => {
    const { status } = await api(
      "/contas/00000000-0000-0000-0000-000000000000",
      "PUT",
      { nome: "Qualquer" }
    );
    expect(status).toBe(404);
  });

  // ── CA-C11: DELETE exclui e retorna 200 ─────────────────────
  test("CA-C11 — DELETE /contas/:id exclui e retorna 200", async () => {
    const { data: nova } = await api("/contas", "POST", {
      nome: "Conta Para Excluir",
      tipo: "CARTEIRA",
    }) as { data: Record<string, unknown> };

    const { status, data } = await api(
      `/contas/${(nova as { id: string }).id}`, "DELETE"
    ) as { status: number; data: Record<string, unknown> };

    expect(status).toBe(200);
    expect((data as { mensagem: string }).mensagem).toMatch(/excluída com sucesso/i);
  });

  // ── CA-C12: DELETE retorna 404 para ID inexistente ──────────
  test("CA-C12 — DELETE /contas/:id retorna 404 para ID inexistente", async () => {
    const { status } = await api(
      "/contas/00000000-0000-0000-0000-000000000000",
      "DELETE"
    );
    expect(status).toBe(404);
  });

  // ── CA-C13: DELETE retorna 409 quando há lançamentos ────────
  // Nota: este teste requer uma conta que já tenha lançamentos.
  // Se o usuário de teste não tiver lançamentos, o teste é pulado.
  test("CA-C13 — DELETE /contas/:id retorna 409 quando há lançamentos", async () => {
    const { data: lista } = await api("/contas") as { data: { dados: Record<string, unknown>[] } };
    const comLancamentos = lista.dados.find(
      (c: Record<string, unknown>) => Number(c.movimentacao ?? 0) > 0
    );

    if (!comLancamentos) {
      console.warn("CA-C13: pulado — nenhuma conta com lançamentos encontrada.");
      return;
    }

    const { status, data } = await api(
      `/contas/${comLancamentos.conta_id}`, "DELETE"
    ) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(409);
    expect((data as { erro: string }).erro).toBeTruthy();
  });

  // ── CA-C14: Sem JWT retorna 401 ─────────────────────────────
  test("CA-C14 — sem JWT retorna 401", async () => {
    const { status } = await apiSemAuth("/contas");
    expect(status).toBe(401);
  });

  // ── CA-C15: Isolamento — usuário não acessa contas de outro ─
  // Verifica que todas as contas retornadas pertencem ao usuário autenticado.
  test("CA-C15 — todas as contas retornadas pertencem ao usuário autenticado", async () => {
    const { data } = await api("/contas") as { data: { dados: Record<string, unknown>[] } };
    const userIds = [...new Set(data.dados.map((c: Record<string, unknown>) => c.user_id))];
    expect(userIds.length).toBeLessThanOrEqual(1);
  });
});
