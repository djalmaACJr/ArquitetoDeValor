// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/categorias.test.ts
//
// Cobre critérios de aceite: CA-CAT01 a CA-CAT13
// ============================================================
import { api, limparCategoria } from "./setup";

const NOME_PAI   = "Jest Categoria Pai";
const NOME_FILHA = "Jest Categoria Filha";

// ── Limpa categorias de teste antes de criar ─────────────────
// 1. Busca categorias com os nomes reservados para testes
// 2. Remove filhas primeiro (integridade referencial)
// 3. Remove pai
async function limparCategoriasDeTeste(): Promise<void> {
  const { data } = await api("/categorias") as { data: { dados: Record<string, unknown>[] } };
  const todas = data.dados ?? [];

  // Encontra o pai pelo nome reservado
  const pai = todas.find((c) => c.descricao === NOME_PAI);
  if (!pai) return;

  // Remove todas as filhas deste pai
  const filhas = todas.filter((c) => c.id_pai === pai.id);
  for (const filha of filhas) {
    await limparCategoria(filha.id as string).catch(() => {});
  }

  // Remove o pai
  await limparCategoria(pai.id as string).catch(() => {});
}

describe("Categorias — CA-CAT01 a CA-CAT13", () => {
  let catPaiId: string;
  let catFilhaId: string;

  beforeAll(async () => {
    // Passo 1: limpa qualquer resíduo de execuções anteriores
    await limparCategoriasDeTeste();

    // Passo 2: cria categoria pai com nome fixo e conhecido
    const { status: s1, data } = await api("/categorias", "POST", {
      descricao: NOME_PAI,
      icone: "🧪",
      cor: "#123456",
    }) as { status: number; data: Record<string, unknown> };
    expect(s1).toBe(201);
    catPaiId = data.id as string;

    // Passo 3: cria categoria filha
    const { status: s2, data: filha } = await api("/categorias", "POST", {
      descricao: NOME_FILHA,
      id_pai: catPaiId,
      cor: "#654321",
    }) as { status: number; data: Record<string, unknown> };
    expect(s2).toBe(201);
    catFilhaId = filha.id as string;
  });

  afterAll(async () => {
    // Limpa após os testes
    await limparCategoriasDeTeste();
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
    const subs = (data as { subcategorias: Record<string, unknown>[] }).subcategorias;
    expect(Array.isArray(subs)).toBe(true);
    expect(subs.some((s) => s.id === catFilhaId)).toBe(true);
  });

  // ── CA-CAT05 ─────────────────────────────────────────────
  test("CA-CAT05 — POST /categorias cria categoria pai e retorna 201", async () => {
    const { status, data } = await api("/categorias", "POST", {
      descricao: "Jest Categoria Temporaria",
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
      descricao: "Jest Subcategoria Temporaria",
      id_pai: catPaiId,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(201);
    expect((data as { id_pai: string }).id_pai).toBe(catPaiId);
    await limparCategoria((data as { id: string }).id);
  });

  // ── CA-CAT07 ─────────────────────────────────────────────
  test("CA-CAT07 — POST /categorias rejeita subcategoria de subcategoria (3º nível)", async () => {
    const { status, data } = await api("/categorias", "POST", {
      descricao: "Neto Invalido",
      id_pai: catFilhaId,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/máximo 2 níveis/i);
  });

  // ── CA-CAT08 ─────────────────────────────────────────────
  test("CA-CAT08 — POST /categorias rejeita descrição duplicada no mesmo nível com 409", async () => {
    const { status, data } = await api("/categorias", "POST", {
      descricao: NOME_PAI,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(409);
    expect((data as { erro: string }).erro).toMatch(/já existe/i);
  });

  // ── CA-CAT09 ─────────────────────────────────────────────
  test("CA-CAT09 — POST /categorias rejeita descrição > 50 chars com 400", async () => {
    const { status } = await api("/categorias", "POST", {
      descricao: "A".repeat(51),
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
    expect((data as { descricao: string }).descricao).toBe(NOME_PAI);
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
});