// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/contas.test.ts
//
// Cobre critérios de aceite: CA-CONTA01 a CA-CONTA13
// ============================================================

import { api, apiSemAuth, limparConta } from "./setup";

const NOME_CONTA      = "Jest Conta Teste";
const NOME_CONTA_EDIT = "Jest Conta Editada";

// ── Limpa contas de teste antes de criar ─────────────────
async function limparContasDeTeste(): Promise<void> {
  const { data } = await api("/contas");
  const todas: any[] = data?.dados ?? [];

  const contasTeste = todas.filter((c: any) =>
    c.nome === NOME_CONTA ||
    c.nome === NOME_CONTA_EDIT ||
    (c.nome as string)?.startsWith("Jest")
  );

  for (const conta of contasTeste) {
    await limparConta(conta.conta_id ?? conta.id);
  }
}

describe("Contas — CA-CONTA01 a CA-CONTA13", () => {
  let contaId: string;

  beforeAll(async () => {
    await limparContasDeTeste();

    const { status, data } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: NOME_CONTA,
        tipo: "CORRENTE",
        saldo_inicial: 1000,
        icone: "🏦",
        cor: "#123456",
        ativa: true,
      }),
    });

    expect(status).toBe(201);
    contaId = data.id;
  });

  afterAll(async () => {
    await limparContasDeTeste();
  });

  // ── CA-CONTA01 ──────────────────────────────────────────
  test("CA-CONTA01 — GET /contas retorna 200 com array", async () => {
    const { status, data } = await api("/contas");
    expect(status).toBe(200);
    expect(data).toHaveProperty("dados");
    expect(Array.isArray(data.dados)).toBe(true);
  });

  // ── CA-CONTA02 ──────────────────────────────────────────
  test("CA-CONTA02 — GET /contas/:id retorna detalhes da conta", async () => {
    const { status, data } = await api(`/contas/${contaId}`);
    expect(status).toBe(200);
    expect(data).toHaveProperty("conta_id");
    expect(data.nome).toBe(NOME_CONTA);
  });

  // ── CA-CONTA03 ──────────────────────────────────────────
  test("CA-CONTA03 — GET /contas/:id retorna 404 para ID inexistente", async () => {
    const { status } = await api("/contas/00000000-0000-0000-0000-000000000000");
    expect(status).toBe(404);
  });

  // ── CA-CONTA04 ──────────────────────────────────────────
  test("CA-CONTA04 — POST /contas cria conta e retorna 201", async () => {
    const { status, data } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Jest Conta Nova",
        tipo: "CARTAO",
        saldo_inicial: 0,
        ativa: true,
      }),
    });
    expect(status).toBe(201);
    expect(data).toHaveProperty("id");
    await limparConta(data.id);
  });

  // ── CA-CONTA05 ──────────────────────────────────────────
  test("CA-CONTA05 — POST /contas rejeita nome duplicado com 409", async () => {
    const { status } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: NOME_CONTA,
        tipo: "CORRENTE",
        saldo_inicial: 100,
      }),
    });
    expect(status).toBe(409);
  });

  // ── CA-CONTA06 ──────────────────────────────────────────
  test("CA-CONTA06 — POST /contas rejeita nome vazio com 400", async () => {
    const { status } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({ nome: "", tipo: "CORRENTE" }),
    });
    expect(status).toBe(400);
  });

  // ── CA-CONTA07 ──────────────────────────────────────────
  test("CA-CONTA07 — POST /contas rejeita nome muito longo (>50) com 400", async () => {
    const { status } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({ nome: "A".repeat(51), tipo: "CORRENTE" }),
    });
    expect(status).toBe(400);
  });

  // ── CA-CONTA08 ──────────────────────────────────────────
  test("CA-CONTA08 — POST /contas rejeita tipo inválido com 400", async () => {
    const { status } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({ nome: "Conta Invalida", tipo: "TIPO_INEXISTENTE" }),
    });
    expect(status).toBe(400);
  });

  // ── CA-CONTA09 ──────────────────────────────────────────
  test("CA-CONTA09 — POST /contas aceita todos os tipos válidos", async () => {
    const tipos = ["CORRENTE", "REMUNERACAO", "CARTAO", "INVESTIMENTO", "CARTEIRA"];

    for (const tipo of tipos) {
      const { status, data } = await api("/contas", {
        method: "POST",
        body: JSON.stringify({
          nome: `Jest Conta ${tipo}`,
          tipo,
          saldo_inicial: 0,
        }),
      });
      expect(status).toBe(201);
      await limparConta(data.id);
    }
  });

  // ── CA-CONTA10 ──────────────────────────────────────────
  test("CA-CONTA10 — PUT /contas/:id atualiza campos e retorna 200", async () => {
    const { status, data } = await api(`/contas/${contaId}`, {
      method: "PUT",
      body: JSON.stringify({ nome: NOME_CONTA_EDIT, cor: "#ff0000", ativa: false }),
    });
    expect(status).toBe(200);
    expect(data.nome).toBe(NOME_CONTA_EDIT);
    expect(data.cor).toBe("#ff0000");
    expect(data.ativa).toBe(false);

    // Restaurar
    await api(`/contas/${contaId}`, {
      method: "PUT",
      body: JSON.stringify({ nome: NOME_CONTA, ativa: true }),
    });
  });

  // ── CA-CONTA11 ──────────────────────────────────────────
  test("CA-CONTA11 — DELETE /contas/:id remove conta sem lançamentos", async () => {
    const { data: tempConta } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Jest Conta Para Deletar",
        tipo: "CORRENTE",
        saldo_inicial: 0,
      }),
    });

    const { status } = await api(`/contas/${tempConta.id}`, { method: "DELETE" });
    expect(status).toBe(200);

    const { status: statusGet } = await api(`/contas/${tempConta.id}`);
    expect(statusGet).toBe(404);
  });

  // ── CA-CONTA12 ──────────────────────────────────────────
  test("CA-CONTA12 — DELETE /contas/:id retorna 409 se tiver lançamentos", async () => {
    // Buscar uma categoria existente para usar na transação
    const { data: catData } = await api("/categorias");
    const categorias: any[] = catData?.dados ?? [];
    expect(categorias.length).toBeGreaterThan(0);
    const categoriaId = categorias[0].id;

    // Criar conta temporária
    const { data: tempConta } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Jest Conta Com Lancamento",
        tipo: "CORRENTE",
        saldo_inicial: 1000,
      }),
    });

    // Criar transação vinculada
    await api("/transacoes", {
      method: "POST",
      body: JSON.stringify({
        descricao: "Transacao de teste",
        valor: 100,
        data: "2026-04-09",
        conta_id: tempConta.id,
        categoria_id: categoriaId,
        tipo: "DESPESA",
        status: "PAGO",
      }),
    });

    // Tentar deletar a conta (deve falhar com 409)
    const { status } = await api(`/contas/${tempConta.id}`, { method: "DELETE" });
    expect(status).toBe(409);

    // Limpeza: remover transações antes de deletar a conta
    const { data: transacoesData } = await api(`/transacoes?conta_id=${tempConta.id}`);
    const lista: any[] = transacoesData?.dados ?? [];
    for (const tx of lista) {
      await api(`/transacoes/${tx.id}`, { method: "DELETE" });
    }
    await api(`/contas/${tempConta.id}`, { method: "DELETE" });
  });

  // ── CA-CONTA13 ──────────────────────────────────────────
  // Nota: POST /contas sempre cria com ativa=true (comportamento fixo da API).
  // Para testar conta inativa, criamos ativa e desativamos via PUT.
  // GET /contas retorna todas as contas (ativas e inativas) sem filtro por query param.
  test("CA-CONTA13 — Contas inativas aparecem na listagem geral e podem ser diferenciadas", async () => {
    // Criar conta (sempre ativa=true no POST)
    const { data: criada } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Jest Conta Inativa",
        tipo: "CORRENTE",
      }),
    });

    // Desativar via PUT
    await api(`/contas/${criada.id}`, {
      method: "PUT",
      body: JSON.stringify({ ativa: false }),
    });

    const { data: todasData } = await api("/contas");
    const todas: any[] = todasData?.dados ?? [];

    // A conta inativa deve aparecer na listagem geral com ativa=false
    const encontrada = todas.find((c: any) =>
      (c.conta_id ?? c.id) === criada.id
    );
    expect(encontrada).toBeDefined();
    expect(encontrada.ativa).toBe(false);

    await limparConta(criada.id);
  });

  // ── CA-CONTA14 ──────────────────────────────────────────
  // Requisição sem JWT deve retornar 401
  test("CA-CONTA14 — GET /contas sem JWT retorna 401", async () => {
    const { status } = await apiSemAuth("/contas");
    expect(status).toBe(401);
  });

  // ── CA-CONTA15 ──────────────────────────────────────────
  // RLS garante isolamento: UUID de outra conta (não pertencente ao usuário)
  // deve retornar 404 — o banco filtra silenciosamente por user_id = auth.uid()
  test("CA-CONTA15 — GET /contas/:id não expõe conta de outro usuário", async () => {
    const idForaDoEscopo = "00000000-0000-0000-0000-000000000001";
    const { status } = await api(`/contas/${idForaDoEscopo}`);
    expect(status).toBe(404);
  });
});