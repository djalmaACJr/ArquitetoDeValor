// ============================================================
// Arquiteto de Valor — Testes de Segurança / RLS
// tests/07_seguranca_rls.test.ts
//
// Verifica isolamento entre usuários: User A cria registros, User B
// (com token próprio) não consegue ler/editar/excluir.
//
// Cobre: contas, categorias, transações, lembretes, filtros salvos,
// assistente_lancamentos e fatura_import_sessao.
// ============================================================

import { api, apiB, getUserId, getUserIdB, tryGetTokenB, limparConta, limparCategoria, limparTransacao } from "./setup";

const TS = Date.now();

// Sufixo único pra cada teste evitar colisão entre runs.
const SUF = `RLS-${TS}`;

describe("Segurança — RLS (isolamento entre usuários)", () => {
  let userA_id: string;
  let userB_id: string;
  // Toda a suíte depende do User B. Se ausente, marca skip global.
  let temUserB = false;

  beforeAll(async () => {
    userA_id = await getUserId();
    temUserB = !!(await tryGetTokenB());
    if (!temUserB) {
      // eslint-disable-next-line no-console
      console.warn(
        "[07_seguranca_rls] User B não disponível — TODOS os testes desta suíte serão pulados. " +
        "Configure TEST_EMAIL_B/TEST_PASSWORD_B no .env pra rodar.",
      );
      return;
    }
    userB_id = await getUserIdB();
    expect(userA_id).not.toBe(userB_id);
  });
  const guardarUserB = () => { if (!temUserB) { console.log("⊘ pulado: sem User B"); return true; } return false; };

  // ── SEG-RLS01: contas ──────────────────────────────────────
  test("SEG-RLS01 — contas: User B não vê conta criada por A", async () => {
    if (guardarUserB()) return;
    const { status, data } = await api("/contas", "POST", {
      nome: `Conta-${SUF}`,
      tipo: "CORRENTE",
      saldo_inicial: 1000,
      icone: "🏦",
      cor: "#abcdef",
      ativa: true,
    });
    expect(status).toBe(201);
    const contaAId = data.id as string;

    try {
      // User B lista suas contas; a conta de A não pode aparecer.
      const { data: listaB } = await apiB("/contas");
      const idsB = (listaB?.dados ?? []).map((c: any) => c.conta_id ?? c.id);
      expect(idsB).not.toContain(contaAId);

      // User B tenta acessar diretamente pelo id de A.
      // O endpoint /contas/:id pode não existir como GET único; testamos via PUT/DELETE.
      const { status: stPut } = await apiB(`/contas/${contaAId}`, "PUT", { nome: "hack" });
      expect([403, 404]).toContain(stPut);

      const { status: stDel } = await apiB(`/contas/${contaAId}`, "DELETE");
      expect([403, 404]).toContain(stDel);
    } finally {
      await limparConta(contaAId);
    }
  });

  // ── SEG-RLS02: categorias ──────────────────────────────────
  test("SEG-RLS02 — categorias: User B não vê/edita categoria criada por A", async () => {
    if (guardarUserB()) return;
    const { status, data } = await api("/categorias", "POST", {
      descricao: `Cat-${SUF}`,
      icone: "🧪",
      cor: "#112233",
    });
    expect(status).toBe(201);
    const catAId = data.id as string;

    try {
      const { data: listaB } = await apiB("/categorias");
      const idsB = (listaB?.dados ?? []).map((c: any) => c.id);
      expect(idsB).not.toContain(catAId);

      const { status: stPut } = await apiB(`/categorias/${catAId}`, "PUT", { descricao: "hack" });
      expect([403, 404]).toContain(stPut);
    } finally {
      await limparCategoria(catAId);
    }
  });

  // ── SEG-RLS03: transações ──────────────────────────────────
  test("SEG-RLS03 — transações: User B não vê transação criada por A", async () => {
    if (guardarUserB()) return;
    // Cria pré-requisitos
    const { data: contaResp } = await api("/contas", "POST", {
      nome: `ContaTx-${SUF}`, tipo: "CORRENTE", saldo_inicial: 0,
      icone: "💼", cor: "#445566", ativa: true,
    });
    const contaId = contaResp.id as string;
    const { data: catResp } = await api("/categorias", "POST", {
      descricao: `CatTx-${SUF}`, icone: "📦", cor: "#778899",
    });
    const catId = catResp.id as string;

    const { status, data } = await api("/transacoes", "POST", {
      conta_id: contaId,
      categoria_id: catId,
      data: "2026-05-31",
      descricao: `tx-${SUF}`,
      valor: 99.99,
      tipo: "DESPESA",
      status: "PENDENTE",
    });
    expect(status).toBe(201);
    const txAId = data.id as string;

    try {
      const { data: listaB } = await apiB("/transacoes");
      const idsB = (listaB?.dados ?? []).map((t: any) => t.id);
      expect(idsB).not.toContain(txAId);

      const { status: stPut } = await apiB(`/transacoes/${txAId}`, "PUT", { descricao: "hack" });
      expect([403, 404]).toContain(stPut);
    } finally {
      await limparTransacao(txAId);
      await limparCategoria(catId);
      await limparConta(contaId);
    }
  });

  // ── SEG-RLS04: lembretes ───────────────────────────────────
  test("SEG-RLS04 — lembretes: User B não vê lembrete criado por A", async () => {
    if (guardarUserB()) return;
    const { status, data } = await api("/lembretes", "POST", {
      data: "2026-12-31",
      descricao: `lemb-${SUF}`,
    });
    expect(status).toBe(201);
    const lembAId = data.id as string;

    try {
      const { data: listaB } = await apiB("/lembretes?mes=2026-12");
      const idsB = (listaB?.dados ?? []).map((l: any) => l.id);
      expect(idsB).not.toContain(lembAId);

      const { status: stDel } = await apiB(`/lembretes/${lembAId}`, "DELETE");
      expect([403, 404]).toContain(stDel);
    } finally {
      await api(`/lembretes/${lembAId}`, "DELETE");
    }
  });

  // ── SEG-RLS05: filtros salvos ──────────────────────────────
  test("SEG-RLS05 — filtros salvos: User B não vê filtro criado por A", async () => {
    if (guardarUserB()) return;
    const { status, data } = await api("/filtros", "POST", {
      pagina: "extrato",
      nome:   `filtro-${SUF}`,
      dados:  { conta_id: null, mes: "2026-01" },
    });
    // O endpoint pode retornar 200 ou 201; aceitamos qualquer 2xx.
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    const filtroAId = data.id ?? data.dados?.id;

    try {
      const { data: listaB } = await apiB("/filtros?pagina=extrato");
      const idsB = (listaB?.dados ?? []).map((f: any) => f.id);
      if (filtroAId) expect(idsB).not.toContain(filtroAId);
    } finally {
      if (filtroAId) await api(`/filtros/${filtroAId}`, "DELETE");
    }
  });

  // ── SEG-RLS06: assistente_lancamentos ──────────────────────
  test("SEG-RLS06 — assistente: padrão de A não sugere para B", async () => {
    if (guardarUserB()) return;
    const desc = `lancamento-${SUF}-unico`;
    // User A cria padrão via POST direto.
    const { data: contaResp } = await api("/contas", "POST", {
      nome: `ContaAss-${SUF}`, tipo: "CORRENTE", saldo_inicial: 0,
      icone: "💼", cor: "#abcdef", ativa: true,
    });
    const contaA = contaResp.id as string;
    const { data: catResp } = await api("/categorias", "POST", {
      descricao: `CatAss-${SUF}`, icone: "📦", cor: "#112233",
    });
    const catA = catResp.id as string;

    const { status } = await api("/assistente", "POST", {
      descricao: desc,
      categoria_id: catA,
      conta_origem_id: contaA,
    });
    expect([200, 201]).toContain(status);

    try {
      // User B busca o mesmo termo: não deve achar a sugestão de A.
      const { data: sugB } = await apiB(`/assistente?q=${encodeURIComponent(desc)}`);
      const itensB = sugB?.dados ?? [];
      expect(itensB.length).toBe(0);
    } finally {
      await api(`/assistente?descricao=${encodeURIComponent(desc)}`, "DELETE");
      await limparCategoria(catA);
      await limparConta(contaA);
    }
  });

  // ── SEG-RLS07/08: fatura_import_sessao + itens (bulk) ──────
  // Sem criar um PDF real, podemos validar apenas a parte de leitura:
  // se A não tem fatura, B também não vê — e se B tentar PATCH /itens-bulk
  // com itens forjados deve receber 404. (Cobertura completa de fatura
  // entra no 07_faturas.test.ts quando ele existir.)
  test("SEG-RLS07 — faturas: lista de B não contém faturas de A", async () => {
    if (guardarUserB()) return;
    const { data: listaA } = await api("/faturas");
    const { data: listaB } = await apiB("/faturas");
    const idsA = (listaA?.dados ?? []).map((s: any) => s.id);
    const idsB = (listaB?.dados ?? []).map((s: any) => s.id);
    for (const id of idsA) expect(idsB).not.toContain(id);
  });

  test("SEG-RLS08 — itens-bulk: User B com item_id inexistente → 404", async () => {
    if (guardarUserB()) return;
    // Endpoint requer um sessaoId válido. Como B não tem sessões,
    // mandamos um UUID aleatório e esperamos 404 (sessão não encontrada).
    const sessaoFake = "00000000-0000-0000-0000-000000000000";
    const itemFake   = "00000000-0000-0000-0000-000000000001";
    const { status } = await apiB(`/faturas/${sessaoFake}/itens-bulk`, {
      method: "PATCH",
      body: JSON.stringify({ item_ids: [itemFake], patch: { decisao: "IGNORAR" } }),
    });
    expect([403, 404, 422]).toContain(status);
  });
});
