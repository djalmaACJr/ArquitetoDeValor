// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/11_objetivos.test.ts
//
// Cobre critérios de aceite: CA-OBJ01 a CA-OBJ13
// ============================================================

import { api, apiSemAuth, tryGetTokenB, limparUserBSeDinamico, gerarHeaders } from "./setup";

// ── IDs gerados durante os testes ────────────────────────────
let contaId:        string;   // conta reutilizada de /contas
let contaCalculoId: string;   // conta exclusiva para testes de cálculo
let categoriaId:    string;   // categoria reutilizada de /categorias
let sonhoId:        string;
let objetivoId:     string;
let projetoId:      string;
let crescimentoId:  string;   // CRESCIMENTO criado em CA-OBJ14

// ── Helpers ───────────────────────────────────────────────────
const hoje = new Date().toISOString().split("T")[0];
const fimAno = `${new Date().getFullYear()}-12-31`;

async function limparObjetivosJest(): Promise<void> {
  const { data } = await api("/objetivos");
  const lista: any[] = data?.dados ?? [];
  for (const o of lista.filter((o: any) =>
    typeof o.nome === "string" && o.nome.startsWith("Jest OBJ")
  )) {
    await api(`/objetivos/${o.id}`, "DELETE");
  }
}

// ── Suite ─────────────────────────────────────────────────────
describe("Objetivos — CA-OBJ01 a CA-OBJ13", () => {

  beforeAll(async () => {
    // Reutiliza primeira conta ativa
    const { data: contas } = await api("/contas") as { data: { dados: Record<string, unknown>[] } };
    expect(contas.dados.length).toBeGreaterThan(0);
    contaId = (contas.dados[0].conta_id ?? contas.dados[0].id) as string;

    // Reutiliza primeira categoria pai
    const { data: cats } = await api("/categorias?apenas_pai=true") as { data: { dados: Record<string, unknown>[] } };
    expect(cats.dados.length).toBeGreaterThan(0);
    categoriaId = cats.dados[0].id as string;

    // Cria conta dedicada para testes de cálculo (saldo_inicial controlado)
    const { data: novaConta } = await api("/contas", "POST", {
      nome:          "Jest OBJ Conta Cálculo",
      tipo:          "CARTEIRA",
      cor:           "#4da6ff",
      saldo_inicial: 0,
    });
    contaCalculoId = novaConta.conta_id ?? novaConta.id;

    await limparObjetivosJest();
  }, 150000); // margem extra: hook depende de auth+edge function, sujeito a cold start esporádico —
  // 60s não bastava mais (achado real, ago/2026): o projeto Supabase está no
  // plano Pro mas SEM Compute Instance pago selecionado, rodando no compute
  // compartilhado/burstable padrão — sob carga sustentada (as 3 suítes mais
  // pesadas rodando logo antes desta, ~6min contínuos) o crédito de burst de
  // CPU esgota e um GET /contas trivial pode levar bem mais que 60s pra
  // responder. 150s dá margem sem mascarar uma regressão de verdade.

  afterAll(async () => {
    await limparObjetivosJest();
    // Remove transações de cálculo remanescentes e a conta de teste
    // (só funciona se não houver outras transações na conta)
    if (contaCalculoId) {
      const { data: txs } = await api(`/transacoes?conta_id=${contaCalculoId}&per_page=200`);
      for (const tx of (txs?.dados ?? []) as any[]) {
        await api(`/transacoes/${tx.id}?escopo=SOMENTE_ESTE`, "DELETE");
      }
      await api(`/contas/${contaCalculoId}`, "DELETE");
    }
    // CA-OBJ12 pode ter criado um User B descartável via tryGetTokenB()
    // (sem TEST_EMAIL_B configurado) — exclui aqui, não faz nada se User B
    // veio de credenciais reais do .env.
    await limparUserBSeDinamico();
  }, 150000); // mesmo motivo do beforeAll acima

  // ── CA-OBJ01 ────────────────────────────────────────────────
  test("CA-OBJ01 — POST /objetivos cria SONHO e retorna 201 com campos corretos", async () => {
    const { status, data } = await api("/objetivos", "POST", {
      tipo:        "SONHO",
      nome:        "Jest OBJ Sonho Fundo Emergência",
      descricao:   "Meta para atingir R$50k",
      valor_meta:  50000,
      data_inicio: hoje,
      data_fim:    fimAno,
      conta_id:    contaId,
      icone:       "💰",
      cor:         "#00c896",
    });

    expect(status).toBe(201);
    expect(data.dados).toBeDefined();
    expect(data.dados.id).toBeDefined();
    expect(data.dados.tipo).toBe("SONHO");
    expect(data.dados.nome).toBe("Jest OBJ Sonho Fundo Emergência");
    expect(data.dados.status).toBe("EM_PROGRESSO");
    expect(data.dados.percentual).toBeGreaterThanOrEqual(0);
    expect(data.dados.percentual).toBeLessThanOrEqual(100);
    expect(data.dados.ativo).toBe(true);
    expect(data.dados.criado_em).toBeDefined();
    sonhoId = data.dados.id as string;
  });

  // ── CA-OBJ02 ────────────────────────────────────────────────
  test("CA-OBJ02 — POST /objetivos cria OBJETIVO com categoria e retorna 201", async () => {
    const { status, data } = await api("/objetivos", "POST", {
      tipo:         "OBJETIVO",
      nome:         "Jest OBJ Renda Aluguel",
      valor_meta:   2000,
      frequencia:   "MENSAL",
      categoria_id: categoriaId,
      data_inicio:  hoje,
      data_fim:     fimAno,
      icone:        "🏠",
      cor:          "#4da6ff",
    });

    expect(status).toBe(201);
    expect(data.dados.tipo).toBe("OBJETIVO");
    expect(data.dados.categoria_id).toBe(categoriaId);
    expect(data.dados.frequencia).toBe("MENSAL");
    objetivoId = data.dados.id as string;
  });

  // ── CA-OBJ03 ────────────────────────────────────────────────
  test("CA-OBJ03 — POST /objetivos cria PROJETO com múltiplas contas e retorna 201", async () => {
    const { status, data } = await api("/objetivos", "POST", {
      tipo:           "PROJETO",
      nome:           "Jest OBJ Reforma Cozinha",
      valor_meta:     15000,
      data_inicio:    hoje,
      data_fim:       fimAno,
      contas_projeto: [contaId, contaCalculoId],
      icone:          "🔧",
      cor:            "#f0b429",
    });

    expect(status).toBe(201);
    expect(data.dados.tipo).toBe("PROJETO");
    expect(Array.isArray(data.dados.contas_projeto)).toBe(true);
    expect(data.dados.contas_projeto.length).toBe(2);
    projetoId = data.dados.id as string;
  });

  // ── CA-OBJ04 ────────────────────────────────────────────────
  test("CA-OBJ04 — GET /objetivos?tipo=SONHO retorna apenas SONHOs", async () => {
    const { status, data } = await api("/objetivos?tipo=SONHO");
    expect(status).toBe(200);
    expect(Array.isArray(data.dados)).toBe(true);
    expect(data.dados.length).toBeGreaterThan(0);
    for (const o of data.dados) {
      expect(o.tipo).toBe("SONHO");
    }
  });

  // ── CA-OBJ05 ────────────────────────────────────────────────
  test("CA-OBJ05 — GET /objetivos?status=EM_PROGRESSO retorna apenas EM_PROGRESSO", async () => {
    const { status, data } = await api("/objetivos?status=EM_PROGRESSO");
    expect(status).toBe(200);
    expect(Array.isArray(data.dados)).toBe(true);
    for (const o of data.dados) {
      expect(o.status).toBe("EM_PROGRESSO");
    }
  });

  // ── CA-OBJ06 ────────────────────────────────────────────────
  test("CA-OBJ06 — GET /objetivos/:id retorna detalhe com campo progresso", async () => {
    const { status, data } = await api(`/objetivos/${sonhoId}`);
    expect(status).toBe(200);
    expect(data.dados.id).toBe(sonhoId);
    expect(data.dados.tipo).toBe("SONHO");
    expect(typeof data.dados.dias_restantes).toBe("number");
    expect(data.dados.dias_restantes).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(data.dados.progresso)).toBe(true);
    // revisoes deve ser array (pode estar vazio)
    expect(Array.isArray(data.dados.revisoes)).toBe(true);
  });

  // ── CA-OBJ07 ────────────────────────────────────────────────
  test("CA-OBJ07 — PUT /objetivos/:id edita valor_meta e registra revisão histórica", async () => {
    const { status, data } = await api(`/objetivos/${sonhoId}`, "PUT", {
      valor_meta:     60000,
      motivo_revisao: "Aumentei o orçamento",
    });

    expect(status).toBe(200);
    expect(data.dados.valor_meta).toBe(60000);
    expect(Array.isArray(data.dados.revisoes)).toBe(true);
    expect(data.dados.revisoes.length).toBeGreaterThanOrEqual(1);

    const rev = data.dados.revisoes[data.dados.revisoes.length - 1] as any;
    expect(rev.valor_meta_anterior).toBe(50000);
    expect(rev.motivo).toBe("Aumentei o orçamento");
    expect(rev.data).toBeDefined();
  });

  // ── CA-OBJ08 ────────────────────────────────────────────────
  test("CA-OBJ08 — DELETE /objetivos/:id realiza soft-delete (ativo=false, status=CANCELADO)", async () => {
    // Cria objetivo descartável para não afetar os testes seguintes
    const { data: novo } = await api("/objetivos", "POST", {
      tipo:        "SONHO",
      nome:        "Jest OBJ Para Cancelar",
      valor_meta:  100,
      data_inicio: hoje,
      data_fim:    fimAno,
      conta_id:    contaId,
      icone:       "🗑️",
      cor:         "#636e72",
    });
    const idCancelar = novo.dados.id as string;

    const { status, data } = await api(`/objetivos/${idCancelar}`, "DELETE");
    expect(status).toBe(200);
    expect(data.mensagem).toBeDefined();

    // Verifica que agora está cancelado
    const { data: detail } = await api(`/objetivos/${idCancelar}`);
    expect(detail.dados.ativo).toBe(false);
    expect(detail.dados.status).toBe("CANCELADO");
  });

  // ── CA-OBJ09 ────────────────────────────────────────────────
  test("CA-OBJ09 — POST /objetivos/sincronizar-progresso recalcula e retorna total sincronizado", async () => {
    const { status, data } = await api("/objetivos/sincronizar-progresso", "POST");
    expect(status).toBe(200);
    expect(data.dados).toBeDefined();
    expect(typeof data.dados.sincronizados).toBe("number");
    expect(data.dados.sincronizados).toBeGreaterThanOrEqual(0);
  });

  // ── CA-OBJ10 ────────────────────────────────────────────────
  test("CA-OBJ10 — cálculo SONHO: valor_atingido = saldo_inicial + receitas − despesas da conta", async () => {
    // Cria SONHO vinculado à conta de cálculo (saldo_inicial=0)
    const { data: novoSonho } = await api("/objetivos", "POST", {
      tipo:        "SONHO",
      nome:        "Jest OBJ Sonho Cálculo",
      valor_meta:  10000,
      data_inicio: hoje,
      data_fim:    fimAno,
      conta_id:    contaCalculoId,
      icone:       "🧮",
      cor:         "#00c896",
    });
    const idSonhoCalculo = novoSonho.dados.id as string;

    // Lança RECEITA R$5000 e DESPESA R$2000 na conta de cálculo
    await api("/transacoes", "POST", {
      descricao:    "Jest OBJ Receita Calculo",
      data:         hoje,
      valor:        5000,
      tipo:         "RECEITA",
      status:       "PAGO",
      conta_id:     contaCalculoId,
      categoria_id: categoriaId,
    });
    await api("/transacoes", "POST", {
      descricao:    "Jest OBJ Despesa Calculo",
      data:         hoje,
      valor:        2000,
      tipo:         "DESPESA",
      status:       "PAGO",
      conta_id:     contaCalculoId,
      categoria_id: categoriaId,
    });

    // Sync dispara recálculo
    await api("/objetivos/sincronizar-progresso", "POST");

    const { data: detail } = await api(`/objetivos/${idSonhoCalculo}`);
    // saldo_inicial(0) + receita(5000) − despesa(2000) = 3000
    expect(detail.dados.valor_atingido).toBeCloseTo(3000, 0);
    expect(detail.dados.percentual).toBe(30); // 3000/10000 = 30%
    expect(detail.dados.status).toBe("EM_PROGRESSO");
  });

  // ── CA-OBJ11 ────────────────────────────────────────────────
  test("CA-OBJ11 — cálculo OBJETIVO: soma de RECEITA da categoria no período", async () => {
    // OBJETIVO já criado em CA-OBJ02 com categoriaId e meta=2000
    // Lança 3 RECEITAs na categoria dentro do período
    await api("/transacoes", "POST", {
      descricao: "Jest OBJ Cat Receita 1",
      data: hoje, valor: 1000, tipo: "RECEITA",
      status: "PAGO", conta_id: contaId, categoria_id: categoriaId,
    });
    await api("/transacoes", "POST", {
      descricao: "Jest OBJ Cat Receita 2",
      data: hoje, valor: 800, tipo: "RECEITA",
      status: "PAGO", conta_id: contaId, categoria_id: categoriaId,
    });
    await api("/transacoes", "POST", {
      descricao: "Jest OBJ Cat Receita 3",
      data: hoje, valor: 500, tipo: "RECEITA",
      status: "PAGO", conta_id: contaId, categoria_id: categoriaId,
    });

    await api("/objetivos/sincronizar-progresso", "POST");

    const { data: detail } = await api(`/objetivos/${objetivoId}`);
    // Pode ter outras receitas na categoria de outros testes; verificar >= 2300
    expect(detail.dados.valor_atingido).toBeGreaterThanOrEqual(2300);
    // Se >= meta(2000), status = ATINGIDO e percentual = 100
    if (detail.dados.valor_atingido >= 2000) {
      expect(detail.dados.percentual).toBe(100);
      expect(detail.dados.status).toBe("ATINGIDO");
    }
  });

  // ── CA-OBJ12 ────────────────────────────────────────────────
  test("CA-OBJ12 — RLS: usuário B não consegue ler/editar/excluir objetivos de A", async () => {
    const tokenB = await tryGetTokenB();
    if (!tokenB) {
      console.warn("CA-OBJ12: TEST_EMAIL_B não configurado — teste pulado.");
      return;
    }
    const headersB = gerarHeaders(tokenB);
    const apiComB  = (path: string, method = "GET", body?: unknown) =>
      api(path, method, body, headersB);

    // GET do objetivo de A via B → 404
    const { status: sGet } = await apiComB(`/objetivos/${sonhoId}`);
    expect(sGet).toBe(404);

    // PUT do objetivo de A via B → 404
    const { status: sPut } = await apiComB(`/objetivos/${sonhoId}`, "PUT", {
      nome: "Tentativa de invasão",
    });
    expect(sPut).toBe(404);

    // DELETE do objetivo de A via B → 404
    const { status: sDel } = await apiComB(`/objetivos/${sonhoId}`, "DELETE");
    expect(sDel).toBe(404);
  });

  // ── CA-OBJ13 ────────────────────────────────────────────────
  test("CA-OBJ13a — data_fim < data_inicio retorna 400", async () => {
    const { status } = await api("/objetivos", "POST", {
      tipo:        "SONHO",
      nome:        "Jest OBJ Inválido Data",
      valor_meta:  1000,
      data_inicio: fimAno,
      data_fim:    hoje, // fim anterior ao início
      conta_id:    contaId,
    });
    expect(status).toBe(400);
  });

  test("CA-OBJ13b — valor_meta <= 0 retorna 400", async () => {
    const { status } = await api("/objetivos", "POST", {
      tipo:        "SONHO",
      nome:        "Jest OBJ Inválido Meta",
      valor_meta:  -500,
      data_inicio: hoje,
      data_fim:    fimAno,
      conta_id:    contaId,
    });
    expect(status).toBe(400);
  });

  test("CA-OBJ13c — campos obrigatórios faltando retorna 400", async () => {
    const { status } = await api("/objetivos", "POST", {
      tipo: "SONHO",
      // faltam: nome, valor_meta, datas, conta_id
    });
    expect(status).toBe(400);
  });

  test("CA-OBJ13d — SONHO sem conta_id retorna 400", async () => {
    const { status } = await api("/objetivos", "POST", {
      tipo:        "SONHO",
      nome:        "Jest OBJ Sonho Sem Conta",
      valor_meta:  1000,
      data_inicio: hoje,
      data_fim:    fimAno,
      // conta_id ausente
    });
    expect(status).toBe(400);
  });

  test("CA-OBJ13e — OBJETIVO sem categoria_id retorna 400", async () => {
    const { status } = await api("/objetivos", "POST", {
      tipo:        "OBJETIVO",
      nome:        "Jest OBJ Objetivo Sem Cat",
      valor_meta:  1000,
      data_inicio: hoje,
      data_fim:    fimAno,
      // categoria_id ausente
    });
    expect(status).toBe(400);
  });

  test("CA-OBJ13f — PROJETO sem contas_projeto retorna 400", async () => {
    const { status } = await api("/objetivos", "POST", {
      tipo:           "PROJETO",
      nome:           "Jest OBJ Projeto Sem Contas",
      valor_meta:     1000,
      data_inicio:    hoje,
      data_fim:       fimAno,
      contas_projeto: [], // array vazio
    });
    expect(status).toBe(400);
  });

  test("CA-OBJ13g — sem autenticação retorna 401", async () => {
    const { status } = await apiSemAuth("/objetivos");
    expect(status).toBe(401);
  });

  // ── CA-OBJ14: CRESCIMENTO — criação ─────────────────────────
  test("CA-OBJ14 — POST /objetivos cria CRESCIMENTO com categorias_objetivo e retorna 201", async () => {
    const anoPassado = `${new Date().getFullYear() - 1}-01-01`;
    const { status, data } = await api("/objetivos", "POST", {
      tipo:                 "CRESCIMENTO",
      nome:                 "Jest OBJ Crescimento Receitas",
      descricao:            "Meta de crescimento YoY de 20%",
      valor_meta:           20,        // % alvo de crescimento ano a ano
      data_inicio:          anoPassado,
      data_fim:             fimAno,
      categorias_objetivo:  [categoriaId],
      icone:                "📈",
      cor:                  "#00c896",
    });

    expect(status).toBe(201);
    expect(data.dados).toBeDefined();
    expect(data.dados.id).toBeDefined();
    expect(data.dados.tipo).toBe("CRESCIMENTO");
    expect(data.dados.nome).toBe("Jest OBJ Crescimento Receitas");
    expect(data.dados.valor_meta).toBe(20);
    expect(Array.isArray(data.dados.categorias_objetivo)).toBe(true);
    expect(data.dados.categorias_objetivo).toContain(categoriaId);
    expect(data.dados.status).toBe("EM_PROGRESSO");
    expect(data.dados.ativo).toBe(true);
    crescimentoId = data.dados.id as string;
  });

  // ── CA-OBJ15: CRESCIMENTO — filtro por tipo ─────────────────
  test("CA-OBJ15 — GET /objetivos?tipo=CRESCIMENTO retorna apenas CRESCIMENTOs", async () => {
    const { status, data } = await api("/objetivos?tipo=CRESCIMENTO");
    expect(status).toBe(200);
    expect(Array.isArray(data.dados)).toBe(true);
    expect(data.dados.length).toBeGreaterThan(0);
    for (const o of data.dados) {
      expect(o.tipo).toBe("CRESCIMENTO");
    }
  });

  // ── CA-OBJ16: CRESCIMENTO — validação de campos ─────────────
  test("CA-OBJ16a — CRESCIMENTO sem categorias_objetivo retorna 400", async () => {
    const anoPassado = `${new Date().getFullYear() - 1}-01-01`;
    const { status } = await api("/objetivos", "POST", {
      tipo:        "CRESCIMENTO",
      nome:        "Jest OBJ Crescimento Sem Cat",
      valor_meta:  15,
      data_inicio: anoPassado,
      data_fim:    fimAno,
      // categorias_objetivo ausente
    });
    expect(status).toBe(400);
  });

  test("CA-OBJ16b — CRESCIMENTO com categorias_objetivo vazio retorna 400", async () => {
    const anoPassado = `${new Date().getFullYear() - 1}-01-01`;
    const { status } = await api("/objetivos", "POST", {
      tipo:                "CRESCIMENTO",
      nome:                "Jest OBJ Crescimento Cat Vazia",
      valor_meta:          15,
      data_inicio:         anoPassado,
      data_fim:            fimAno,
      categorias_objetivo: [],  // vazio deve ser rejeitado
    });
    expect(status).toBe(400);
  });

  // ── CA-OBJ17: CRESCIMENTO — detalhe e progresso ─────────────
  test("CA-OBJ17 — GET /objetivos/:id de CRESCIMENTO retorna detalhe com progresso", async () => {
    const { status, data } = await api(`/objetivos/${crescimentoId}`);
    expect(status).toBe(200);
    expect(data.dados.id).toBe(crescimentoId);
    expect(data.dados.tipo).toBe("CRESCIMENTO");
    expect(Array.isArray(data.dados.categorias_objetivo)).toBe(true);
    // dias_restantes calculado
    expect(typeof data.dados.dias_restantes).toBe("number");
    expect(data.dados.dias_restantes).toBeGreaterThanOrEqual(0);
    // progresso: array de snapshots (pode estar vazio antes de sincronizar)
    expect(Array.isArray(data.dados.progresso)).toBe(true);
    // valor_atingido: % YoY calculado (numérico)
    expect(typeof data.dados.valor_atingido).toBe("number");
    // percentual: relativo à meta (valor_meta = % alvo)
    expect(typeof data.dados.percentual).toBe("number");
  });
});
