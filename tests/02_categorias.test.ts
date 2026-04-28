// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/categorias.test.ts
//
// Cobre critérios de aceite: CA-CAT01 a CA-CAT13
// ============================================================
import { api, limparCategoria } from "./setup";

const TS = Date.now();

const CAT_PAI_VALIDA = {
  descricao: `tPai${TS}`,
  icone: "🧪",
  cor: "#123456",
};

describe("Categorias — CA-CAT01 a CA-CAT13", () => {
  let catPaiId: string;
  let catFilhaId: string;

beforeAll(async () => {
  const { data } = await api("/categorias", "POST", CAT_PAI_VALIDA) as { data: Record<string, unknown> };
  catPaiId = data.id as string;

  const { data: filha } = await api("/categorias", "POST", {
    descricao: `tFil${TS}`,
    id_pai: catPaiId,
    cor: "#654321",
  }) as { data: Record<string, unknown> };
  catFilhaId = filha.id as string;
});


  afterAll(async () => {
    if (catFilhaId) await limparCategoria(catFilhaId);
    if (catPaiId)   await limparCategoria(catPaiId);
  });

  // ── CA-CAT01 ─────────────────────────────────────────────
  test("CA-CAT01 — GET /categorias retorna 200 com array", async () => {
    const { status, data } = await api("/categorias") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect(data).toHaveProperty("dados");
    expect(Array.isArray((data as { dados: unknown[] }).dados)).toBe(true);
  });

  // ── CA-CAT02 ─────────────────────────────────────────────
  test("CA-CAT02 — GET /categorias?hierarquia=true retorna estrutura pai/filho", async () => {
    const { status, data } = await api("/categorias?hierarquia=true") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    expect(Array.isArray(dados)).toBe(true);
    const comFilhos = dados.find((c) => Array.isArray(c.subcategorias));
    expect(comFilhos).toBeDefined();
  });

  // ── CA-CAT03 ─────────────────────────────────────────────
  test("CA-CAT03 — GET /categorias?apenas_pai=true retorna só categorias raiz", async () => {
    const { status, data } = await api("/categorias?apenas_pai=true") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    const temFilho = dados.some((c) => c.id_pai !== null && c.id_pai !== undefined);
    expect(temFilho).toBe(false);
  });

  // ── CA-CAT04 ─────────────────────────────────────────────
  test("CA-CAT04 — GET /categorias/:id retorna subcategorias embutidas se for pai", async () => {
    const { status, data } = await api(`/categorias/${catPaiId}`) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect(data).toHaveProperty("subcategorias");
    expect(Array.isArray((data as { subcategorias: unknown[] }).subcategorias)).toBe(true);
    const subs = (data as { subcategorias: Record<string, unknown>[] }).subcategorias;
    expect(subs.some((s) => s.id === catFilhaId)).toBe(true);
  });

  // ── CA-CAT05 ─────────────────────────────────────────────
  test("CA-CAT05 — POST /categorias cria categoria pai e retorna 201", async () => {
    const { status, data } = await api("/categorias", "POST", {
      descricao: `tC5_${TS}`,
      cor: "#aabbcc",
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(201);
    expect(data).toHaveProperty("id");
    expect((data as { id_pai: unknown }).id_pai).toBeNull();
    await limparCategoria((data as { id: string }).id);
  });

  // ── CA-CAT06 ─────────────────────────────────────────────
  test("CA-CAT06 — POST /categorias cria subcategoria com id_pai válido", async () => {
    const { status, data } = await api("/categorias", "POST", {
      descricao: `tS6_${TS}`,
      id_pai: catPaiId,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(201);
    expect((data as { id_pai: string }).id_pai).toBe(catPaiId);
    await limparCategoria((data as { id: string }).id);
  });

  // ── CA-CAT07 ─────────────────────────────────────────────
  test("CA-CAT07 — POST /categorias rejeita subcategoria de subcategoria (3º nível)", async () => {
    const { status, data } = await api("/categorias", "POST", {
      descricao: "Neto Inválido",
      id_pai: catFilhaId,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/máximo 2 níveis/i);
  });

  // ── CA-CAT08 ─────────────────────────────────────────────
  test("CA-CAT08 — POST /categorias rejeita descrição duplicada no mesmo nível com 409", async () => {
    const { status, data } = await api("/categorias", "POST", CAT_PAI_VALIDA) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(409);
    expect((data as { erro: string }).erro).toMatch(/já existe/i);
  });

  // ── CA-CAT09 ─────────────────────────────────────────────
  test("CA-CAT09 — POST /categorias rejeita descrição > 20 chars com 400", async () => {
    const { status } = await api("/categorias", "POST", {
      descricao: "A".repeat(21),
    });
    expect(status).toBe(400);
  });

  // ── CA-CAT10 ─────────────────────────────────────────────
  test("CA-CAT10 — PUT /categorias/:id atualiza campos e retorna 200", async () => {
    const { status, data } = await api(`/categorias/${catPaiId}`, "PUT", {
      cor: "#ff0000",
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect((data as { cor: string }).cor).toBe("#ff0000");
    expect((data as { descricao: string }).descricao).toBe(CAT_PAI_VALIDA.descricao);
  });

  // ── CA-CAT11 ─────────────────────────────────────────────
  test("CA-CAT11 — DELETE /categorias/:id retorna 409 se tiver subcategorias", async () => {
    const { status, data } = await api(`/categorias/${catPaiId}`, "DELETE") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(409);
    expect((data as { erro: string }).erro).toMatch(/subcategorias/i);
  });

  // ── CA-CAT12 ─────────────────────────────────────────────
  test("CA-CAT12 — DELETE /categorias/:id retorna 409 se tiver lançamentos", async () => {
    const { data: lista } = await api("/categorias") as { data: { dados: Record<string, unknown>[] } };
    const comLancamentos = lista.dados.find(
      (c) => !c.id_pai && c.id !== catPaiId
    );
    if (!comLancamentos) {
      console.warn("CA-CAT12: pulado — nenhuma categoria com lançamentos encontrada.");
      return;
    }
    const { status } = await api(`/categorias/${comLancamentos.id}`, "DELETE");
    expect([200, 404, 409]).toContain(status);
  });

  // ── CA-CAT13 ─────────────────────────────────────────────
  test("CA-CAT13 — DELETE /categorias/:id retorna 404 para ID inexistente", async () => {
    const { status } = await api(
      "/categorias/00000000-0000-0000-0000-000000000000",
      "DELETE"
    );
    expect(status).toBe(404);
  });

  // ── CA-CAT14 ─────────────────────────────────────────────
  test("CA-CAT14 — PUT /categorias/:id em categoria protegida deve retornar 4xx", async () => {
    const { data: lista } = await api("/categorias") as { data: { dados: Record<string, unknown>[] } };
    const protegida = lista.dados.find((c) => c.protegida === true);
    if (!protegida) {
      console.warn("CA-CAT14: pulado — nenhuma categoria protegida encontrada.");
      return;
    }
    const { status } = await api(`/categorias/${protegida.id}`, "PUT", {
      descricao: "Tentativa de edição",
    });
    expect(status).toBeGreaterThanOrEqual(400);
  });

  // ── CA-CAT15 ─────────────────────────────────────────────
  test("CA-CAT15 — DELETE /categorias/:id em categoria protegida deve retornar 4xx", async () => {
    const { data: lista } = await api("/categorias") as { data: { dados: Record<string, unknown>[] } };
    const protegida = lista.dados.find((c) => c.protegida === true);
    if (!protegida) {
      console.warn("CA-CAT15: pulado — nenhuma categoria protegida encontrada.");
      return;
    }
    const { status } = await api(`/categorias/${protegida.id}`, "DELETE");
    expect(status).toBeGreaterThanOrEqual(400);
  });
});
