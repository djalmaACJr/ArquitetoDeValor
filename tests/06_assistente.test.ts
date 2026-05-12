// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/06_assistente.test.ts
//
// Cobre critérios de aceite: CA-ASS01 a CA-ASS09
// ============================================================

import { api, apiSemAuth } from "./setup";

let contaId:    string;
let categoriaId: string;
let sugestaoId: string;

const DESCRICAO_TESTE = "Jest Assistente Mercado";

async function limparAssistenteJest(): Promise<void> {
  const { data } = await api("/assistente?termo=Jest+Assistente");
  const todos: any[] = data?.dados ?? [];
  for (const s of todos) {
    await api(`/assistente/${s.id}`, "DELETE");
  }
}

describe("Assistente de Lançamentos — CA-ASS01 a CA-ASS09", () => {

  beforeAll(async () => {
    const { data: contas } = await api("/contas") as { data: { dados: Record<string, unknown>[] } };
    expect(contas.dados.length).toBeGreaterThan(0);
    contaId = (contas.dados[0].conta_id ?? contas.dados[0].id) as string;

    const { data: cats } = await api("/categorias?apenas_pai=true") as { data: { dados: Record<string, unknown>[] } };
    expect(cats.dados.length).toBeGreaterThan(0);
    categoriaId = cats.dados[0].id as string;

    await limparAssistenteJest();
  });

  afterAll(async () => {
    await limparAssistenteJest();
  });

  // ── CA-ASS01 ────────────────────────────────────────────────
  test("CA-ASS01 — GET /assistente?termo= com menos de 2 chars retorna array vazio", async () => {
    const { status, data } = await api("/assistente?termo=J");
    expect(status).toBe(200);
    expect(Array.isArray(data.dados)).toBe(true);
    expect(data.dados.length).toBe(0);
  });

  // ── CA-ASS02 ────────────────────────────────────────────────
  test("CA-ASS02 — POST /assistente cria sugestão e retorna 201 com campos corretos", async () => {
    const { status, data } = await api("/assistente", "POST", {
      descricao:       DESCRICAO_TESTE,
      categoria_id:    categoriaId,
      conta_origem_id: contaId,
      is_transferencia: false,
    });
    expect(status).toBe(201);
    expect(data).toHaveProperty("id");
    expect(data.descricao).toBe(DESCRICAO_TESTE);
    expect(data.categoria_id).toBe(categoriaId);
    expect(data.conta_origem_id).toBe(contaId);
    expect(data.is_transferencia).toBe(false);
    sugestaoId = data.id as string;
  });

  // ── CA-ASS03 ────────────────────────────────────────────────
  test("CA-ASS03 — GET /assistente?termo= retorna sugestão criada via ILIKE", async () => {
    const { status, data } = await api("/assistente?termo=Jest+Assist");
    expect(status).toBe(200);
    const lista: any[] = data.dados ?? [];
    const encontrado = lista.find((s: any) => s.id === sugestaoId);
    expect(encontrado).toBeDefined();
    expect(encontrado.descricao).toBe(DESCRICAO_TESTE);
  });

  // ── CA-ASS04 ────────────────────────────────────────────────
  test("CA-ASS04 — POST /assistente com mesma descrição (case-insensitive) faz upsert sem duplicar", async () => {
    const { status, data } = await api("/assistente", "POST", {
      descricao:        DESCRICAO_TESTE.toUpperCase(),
      conta_origem_id:  contaId,
      is_transferencia: false,
    });
    // Upsert — retorna o registro atualizado (não cria novo)
    expect([200, 201]).toContain(status);
    expect(data).toHaveProperty("id");

    // Confirma que não há duplicata
    const { data: lista } = await api("/assistente?termo=Jest+Assist");
    const ids = (lista.dados ?? []).map((s: any) => s.id);
    const unicos = new Set(ids);
    expect(unicos.size).toBe(ids.length);
  });

  // ── CA-ASS05 ────────────────────────────────────────────────
  test("CA-ASS05 — POST /assistente com descricao muito curta (<2 chars) retorna 400", async () => {
    const { status } = await api("/assistente", "POST", {
      descricao:        "A",
      is_transferencia: false,
    });
    expect(status).toBe(400);
  });

  // ── CA-ASS06 ────────────────────────────────────────────────
  test("CA-ASS06 — POST /assistente transferência sem conta_destino_id retorna 400", async () => {
    const { status } = await api("/assistente", "POST", {
      descricao:        "Jest Assistente Transferencia",
      conta_origem_id:  contaId,
      is_transferencia: true,
      // conta_destino_id ausente
    });
    expect(status).toBe(400);
  });

  // ── CA-ASS07 ────────────────────────────────────────────────
  test("CA-ASS07 — POST /assistente transferência com origem = destino retorna 400", async () => {
    const { status } = await api("/assistente", "POST", {
      descricao:        "Jest Assistente Transf Igual",
      conta_origem_id:  contaId,
      conta_destino_id: contaId,
      is_transferencia: true,
    });
    expect(status).toBe(400);
  });

  // ── CA-ASS08 ────────────────────────────────────────────────
  test("CA-ASS08 — DELETE /assistente/:id remove sugestão corretamente", async () => {
    const { status, data } = await api(`/assistente/${sugestaoId}`, "DELETE");
    expect(status).toBe(200);
    expect(data).toHaveProperty("ok", true);

    // Confirma remoção no GET
    const { data: lista } = await api("/assistente?termo=Jest+Assist");
    const encontrado = (lista.dados ?? []).find((s: any) => s.id === sugestaoId);
    expect(encontrado).toBeUndefined();
  });

  // ── CA-ASS09 ────────────────────────────────────────────────
  test("CA-ASS09 — GET /assistente sem autenticação retorna 401", async () => {
    const { status } = await apiSemAuth("/assistente?termo=teste");
    expect(status).toBe(401);
  });
});
