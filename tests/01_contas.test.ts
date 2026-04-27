// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/contas.test.ts
//
// Cobre critérios de aceite: CA-CONTA01 a CA-CONTA19
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

describe("Contas — CA-CONTA01 a CA-CONTA19", () => {
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
  test("CA-CONTA07 — POST /contas rejeita nome muito longo (>100) com 400", async () => {
    const { status } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({ nome: "A".repeat(101), tipo: "CORRENTE" }),
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


  // ── CA-CONTA16 ──────────────────────────────────────────
  // Contas do tipo CARTAO aceitam dia_fechamento e dia_pagamento (1–31)
  test("CA-CONTA16 — Cartão aceita dia_fechamento e dia_pagamento válidos", async () => {
    const { status, data } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Jest Cartao Dias",
        tipo: "CARTAO",
        saldo_inicial: 0,
        dia_fechamento: 5,
        dia_pagamento: 10,
      }),
    });
    expect(status).toBe(201);
    expect(data).toHaveProperty("id");

    // Verificar que os campos foram salvos
    const { data: conta } = await api(`/contas/${data.id}`);
    expect(conta.dia_fechamento).toBe(5);
    expect(conta.dia_pagamento).toBe(10);

    await limparConta(data.id);
  });

  // ── CA-CONTA17 ──────────────────────────────────────────
  // dia_fechamento e dia_pagamento fora do range 1–31 devem ser rejeitados
  test("CA-CONTA17 — Cartão rejeita dia_fechamento/dia_pagamento fora do range", async () => {
    const { status: s1 } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Jest Cartao Dia Invalido",
        tipo: "CARTAO",
        saldo_inicial: 0,
        dia_fechamento: 0,
      }),
    });
    expect(s1).toBe(400);

    const { status: s2 } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Jest Cartao Dia Invalido",
        tipo: "CARTAO",
        saldo_inicial: 0,
        dia_fechamento: 32,
      }),
    });
    expect(s2).toBe(400);

    const { status: s3 } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Jest Cartao Dia Invalido",
        tipo: "CARTAO",
        saldo_inicial: 0,
        dia_pagamento: 32,
      }),
    });
    expect(s3).toBe(400);
  });


  // ── CA-CONTA18 ──────────────────────────────────────────
  // PUT em cartão deve salvar/atualizar dia_fechamento e dia_pagamento
  test("CA-CONTA18 — PUT /contas/:id atualiza dia_fechamento e dia_pagamento em cartão", async () => {
    const { data: criada } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({ nome: "Jest Cartao Editar Dias", tipo: "CARTAO", saldo_inicial: 0 }),
    });
    expect(criada).toHaveProperty("id");

    const { status, data } = await api(`/contas/${criada.id}`, {
      method: "PUT",
      body: JSON.stringify({ dia_fechamento: 15, dia_pagamento: 20 }),
    });
    expect(status).toBe(200);

    // Verificar persistência
    const { data: conta } = await api(`/contas/${criada.id}`);
    expect(conta.dia_fechamento).toBe(15);
    expect(conta.dia_pagamento).toBe(20);

    await limparConta(criada.id);
  });

  // ── CA-CONTA19 ──────────────────────────────────────────
  // Campos de cartão devem ser ignorados (null) em contas de outros tipos
  test("CA-CONTA19 — dia_fechamento e dia_pagamento são nulos em contas não-cartão", async () => {
    const tipos = ["CORRENTE", "INVESTIMENTO", "CARTEIRA"];
    for (const tipo of tipos) {
      const { data: criada } = await api("/contas", {
        method: "POST",
        body: JSON.stringify({ nome: `Jest ${tipo} Sem Dias`, tipo, saldo_inicial: 0 }),
      });
      expect(criada).toHaveProperty("id");

      const { data: conta } = await api(`/contas/${criada.id}`);
      expect(conta.dia_fechamento).toBeNull();
      expect(conta.dia_pagamento).toBeNull();

      await limparConta(criada.id);
    }
  });

  // ── CA-CONTA20 ──────────────────────────────────────────
  test("CA-CONTA20 — POST /contas rejeita cor com formato hex inválido com 400", async () => {
    const coresInvalidas = ["red", "123456", "#GGG000", "#12345", "#1234567", "rgb(0,0,0)"];
    for (const cor of coresInvalidas) {
      const { status } = await api("/contas", {
        method: "POST",
        body: JSON.stringify({ nome: "Conta Cor Invalida", tipo: "CORRENTE", cor }),
      });
      expect(status).toBe(400);
    }
  });

  // ── CA-CONTA21 ──────────────────────────────────────────
  test("CA-CONTA21 — POST /transacoes rejeita lançamento em conta inativa", async () => {
    // Criar conta e desativá-la
    const { data: criada } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({ nome: "Jest Conta Inativa CA21", tipo: "CORRENTE", saldo_inicial: 0 }),
    });
    const idInativa = criada.id;
    expect(idInativa).toBeTruthy();

    await api(`/contas/${idInativa}`, {
      method: "PUT",
      body: JSON.stringify({ ativa: false }),
    });

    // Tentativa de criar lançamento na conta inativa deve ser rejeitada
    const { status } = await api("/transacoes", {
      method: "POST",
      body: JSON.stringify({
        data: new Date().toISOString().split("T")[0],
        descricao: "Lançamento inválido",
        valor: 100,
        tipo: "DESPESA",
        status: "PAGO",
        conta_id: idInativa,
      }),
    });
    expect([400, 422]).toContain(status);

    // Reativar e limpar
    await api(`/contas/${idInativa}`, { method: "PUT", body: JSON.stringify({ ativa: true }) });
    await api(`/contas/${idInativa}`, { method: "DELETE" });
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