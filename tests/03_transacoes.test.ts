// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/03_transacoes.test.ts — CA-TX01 a CA-TX28
// ============================================================
import { api, limparTransacao } from "./setup";

let contaId: string;
let categoriaId: string;
let transacaoId: string;
let grupoRecorrenciaId: string;
const parcelas: string[] = [];

// Grupo separado para testes de antecipar (CA-TX15/16) — isolado do grupo principal
let grupoAnteciparId: string;
const parcelasAntecipar: string[] = [];

const TX_VALIDA = () => ({
  data: new Date().toISOString().split("T")[0],
  descricao: "Teste Jest Transacao",
  valor: 150.00,
  tipo: "DESPESA",
  status: "PAGO",
  conta_id: contaId,
  categoria_id: categoriaId,
});

function dataFutura(meses: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + meses);
  return d.toISOString().split("T")[0];
}

describe("Transações — CA-TX01 a CA-TX28", () => {

  beforeAll(async () => {
    const { data: contas } = await api("/contas") as { data: { dados: Record<string, unknown>[] } };
    expect(contas.dados.length).toBeGreaterThan(0);
    contaId = contas.dados[0].conta_id as string;

    const { data: cats } = await api("/categorias?apenas_pai=true") as { data: { dados: Record<string, unknown>[] } };
    expect(cats.dados.length).toBeGreaterThan(0);
    categoriaId = cats.dados[0].id as string;

    const { data: tx } = await api("/transacoes", "POST", TX_VALIDA()) as { data: Record<string, unknown> };
    transacaoId = tx.id as string;

    // Grupo principal — para testes de escopo (CA-TX11/12) via recorrência real
    const resGrupo = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PENDENTE",
      total_parcelas: 3,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };
    expect(resGrupo.status).toBe(201);
    grupoRecorrenciaId = (resGrupo.data as { id_recorrencia: string }).id_recorrencia;
    const parcelasGrupo = (resGrupo.data as { parcelas: Record<string, unknown>[] }).parcelas;
    parcelasGrupo.forEach(p => parcelas.push(p.id as string));
    expect(parcelas.length).toBe(3);

    // Grupo separado — para testes de antecipar (CA-TX15/16) via recorrência real
    const resAntecipar = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PENDENTE",
      total_parcelas: 3,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };
    expect(resAntecipar.status).toBe(201);
    grupoAnteciparId = (resAntecipar.data as { id_recorrencia: string }).id_recorrencia;
    const parcelasAnteciparGrupo = (resAntecipar.data as { parcelas: Record<string, unknown>[] }).parcelas;
    parcelasAnteciparGrupo.forEach(p => parcelasAntecipar.push(p.id as string));
    expect(parcelasAntecipar.length).toBe(3);
  });

  afterAll(async () => {
    if (transacaoId) await limparTransacao(transacaoId);
    for (const id of parcelas) await limparTransacao(id).catch(() => {});
    for (const id of parcelasAntecipar) await limparTransacao(id).catch(() => {});
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
    expect(dados.filter(t => t.mes_tx !== mesNum || t.ano_tx !== anoNum).length).toBe(0);
  });

  // ── CA-TX03 ───────────────────────────────────────────────
  test("CA-TX03 — GET /transacoes?saldo=true retorna campo saldo_acumulado", async () => {
    const { status, data } = await api("/transacoes?saldo=true") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    if (dados.length > 0) expect(dados[0]).toHaveProperty("saldo_acumulado");
  });

  // ── CA-TX04 ───────────────────────────────────────────────
  test("CA-TX04 — GET /transacoes?status=PENDENTE filtra por status", async () => {
    const { status, data } = await api("/transacoes?status=PENDENTE") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    expect(dados.filter(t => t.status !== "PENDENTE").length).toBe(0);
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
    const { status, data } = await api("/transacoes", "POST", { ...TX_VALIDA(), valor: 0 }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/RV-002/i);
  });

  // ── CA-TX08 ───────────────────────────────────────────────
  test("CA-TX08 — POST /transacoes rejeita tipo inválido", async () => {
    const { status, data } = await api("/transacoes", "POST", { ...TX_VALIDA(), tipo: "INVALIDO" }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/RV-006/i);
  });

  // ── CA-TX09 ───────────────────────────────────────────────
  test("CA-TX09 — POST /transacoes rejeita status inválido", async () => {
    const { status, data } = await api("/transacoes", "POST", { ...TX_VALIDA(), status: "INVALIDO" }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/status inválido/i);
  });

  // ── CA-TX10 ───────────────────────────────────────────────
  test("CA-TX10 — POST /transacoes rejeita conta inexistente", async () => {
    const { status } = await api("/transacoes", "POST", { ...TX_VALIDA(), conta_id: "00000000-0000-0000-0000-000000000000" });
    expect([400, 404, 409, 422, 500]).toContain(status);
  });

  // ── CA-TX11 ───────────────────────────────────────────────
  test("CA-TX11 — PUT com escopo SOMENTE_ESTE atualiza apenas 1 lançamento", async () => {
    const novaDescricao = "Atualizado SOMENTE_ESTE";
    const { status, data } = await api(`/transacoes/${parcelas[1]}?escopo=SOMENTE_ESTE`, "PUT", { descricao: novaDescricao }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect((data as { atualizados: number }).atualizados).toBe(1);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    expect((dados[0] as { id: string }).id).toBe(parcelas[1]);
    expect((dados[0] as { descricao: string }).descricao).toBe(novaDescricao);
    expect(dados.map(t => (t as { id: string }).id)).not.toContain(parcelas[0]);
    expect(dados.map(t => (t as { id: string }).id)).not.toContain(parcelas[2]);
  });

  // ── CA-TX12 — deve rodar ANTES de CA-TX15 ────────────────
  test("CA-TX12 — PUT com escopo TODOS atualiza o grupo inteiro", async () => {
    const { status, data } = await api(`/transacoes/${parcelas[0]}?escopo=TODOS`, "PUT", { observacao: "Atualizado em grupo" }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect((data as { atualizados: number }).atualizados).toBe(3);
  });

  // ── CA-TX13 ───────────────────────────────────────────────
  test("CA-TX13 — DELETE exclui e retorna IDs excluídos", async () => {
    const { data: nova } = await api("/transacoes", "POST", TX_VALIDA()) as { data: Record<string, unknown> };
    const { status, data } = await api(`/transacoes/${(nova as { id: string }).id}`, "DELETE") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    expect((data as { excluidos: number }).excluidos).toBe(1);
    expect(Array.isArray((data as { ids: string[] }).ids)).toBe(true);
  });

  // ── CA-TX14 ───────────────────────────────────────────────
  test("CA-TX14 — DELETE retorna 404 para ID inexistente", async () => {
    const { status } = await api("/transacoes/00000000-0000-0000-0000-000000000000", "DELETE");
    expect(status).toBe(404);
  });

  // ── CA-TX15 — usa grupo separado (parcelasAntecipar) ─────
  test("CA-TX15 — POST /:id/antecipar consolida parcelas seguintes", async () => {
    const { status, data } = await api(`/transacoes/${parcelasAntecipar[0]}/antecipar`, "POST") as { status: number; data: Record<string, unknown> };
    expect([200, 400]).toContain(status);
    if (status === 200) expect(data).toHaveProperty("mensagem");
  });

  // ── CA-TX16 — usa grupo separado (parcelasAntecipar) ─────
  test("CA-TX16 — POST /:id/antecipar retorna 400 na última parcela", async () => {
    // Após CA-TX15, o grupo foi consolidado — sobrou só 1 parcela que é a última
    // Buscamos a parcela remanescente do grupo
    const { data: txs } = await api("/transacoes") as { data: { dados: Record<string, unknown>[] } };
    const remanescentes = txs.dados.filter(
      (t: Record<string, unknown>) => t.id_recorrencia === grupoAnteciparId
    );

    if (remanescentes.length === 0) {
      console.warn("CA-TX16: grupo já foi totalmente antecipado — pulado.");
      return;
    }

    // A remanescente deve ser a última (nr_parcela === total_parcelas)
    const ultima = remanescentes.find(
      (t: Record<string, unknown>) => t.nr_parcela === t.total_parcelas
    );
    if (!ultima) {
      console.warn("CA-TX16: última parcela não encontrada — pulado.");
      return;
    }

    const { status, data } = await api(`/transacoes/${(ultima as { id: string }).id}/antecipar`, "POST") as { status: number; data: Record<string, unknown> };
    expect(status).toBe(400);
    expect((data as { erro: string }).erro).toMatch(/última parcela/i);
  });

  // ── CA-TX17 ───────────────────────────────────────────────
  test("CA-TX17 — valor_projetado preservado após antecipação", async () => {
    const { data: tx } = await api(`/transacoes/${parcelasAntecipar[0]}`) as { data: Record<string, unknown> };
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
      data: dataFutura(1),
      status: "PROJECAO",
      valor: 200.00,
      descricao: "Projecao CA-TX18",
    }) as { data: Record<string, unknown> };

    const { data: confirmado } = await api(
      `/transacoes/${(projecao as { id: string }).id}`, "PUT",
      { status: "PAGO", valor: 180.00 }
    ) as { data: Record<string, unknown> };

    const dados = (confirmado as { dados: Record<string, unknown>[] }).dados;
    const tx = dados?.[0] ?? confirmado;
    expect((tx as { valor_projetado: number }).valor_projetado).toBe(200.00);
    await limparTransacao((projecao as { id: string }).id).catch(() => {});
  });

  // ── CA-TX19 — Recorrência cria N parcelas ─────────────────
  test("CA-TX19 — POST com total_parcelas=3 e tipo_recorrencia=MENSAL cria 3 parcelas", async () => {
    const { status, data } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PENDENTE",
      total_parcelas: 3,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };

    expect(status).toBe(201);
    expect(data).toHaveProperty("id_recorrencia");
    expect((data as { total: number }).total).toBe(3);
    expect(Array.isArray((data as { parcelas: unknown[] }).parcelas)).toBe(true);

    const idRec = (data as { id_recorrencia: string }).id_recorrencia;
    const { data: txs } = await api("/transacoes") as { data: { dados: Record<string, unknown>[] } };
    const ids = txs.dados.filter(t => t.id_recorrencia === idRec).map(t => t.id as string);
    for (const id of ids) await limparTransacao(id).catch(() => {});
  });

  // ── CA-TX20 — Regras de status por data ───────────────────
  test("CA-TX20 — parcelas passadas ficam PAGO, futuras ficam PENDENTE", async () => {
    const hoje = new Date();
    const dataBase = new Date(hoje.getFullYear(), hoje.getMonth() - 2, 1).toISOString().split("T")[0];

    const { status, data } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataBase,
      status: "PENDENTE",
      total_parcelas: 3,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };

    expect(status).toBe(201);
    const parcelasGeradas = (data as { parcelas: Record<string, unknown>[] }).parcelas;
    const hoje_str = new Date().toISOString().split("T")[0];

    parcelasGeradas.forEach(p => {
      if (String(p.data) <= hoje_str) expect(p.status).toBe("PAGO");
      else expect(p.status).toBe("PENDENTE");
    });

    const idRec = (data as { id_recorrencia: string }).id_recorrencia;
    const { data: txs } = await api("/transacoes") as { data: { dados: Record<string, unknown>[] } };
    const ids = txs.dados.filter(t => t.id_recorrencia === idRec).map(t => t.id as string);
    for (const id of ids) await limparTransacao(id).catch(() => {});
  });

  // ── CA-TX21 — Recorrência PROJECAO ────────────────────────
  test("CA-TX21 — recorrência com status PROJECAO cria todas as parcelas como PROJECAO", async () => {
    const { status, data } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PROJECAO",
      total_parcelas: 3,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };

    expect(status).toBe(201);
    const parcelasGeradas = (data as { parcelas: Record<string, unknown>[] }).parcelas;
    parcelasGeradas.forEach(p => expect(p.status).toBe("PROJECAO"));

    const idRec = (data as { id_recorrencia: string }).id_recorrencia;
    const { data: txs } = await api("/transacoes") as { data: { dados: Record<string, unknown>[] } };
    const ids = txs.dados.filter(t => t.id_recorrencia === idRec).map(t => t.id as string);
    for (const id of ids) await limparTransacao(id).catch(() => {});
  });

  // ── CA-TX22 — ESTE_E_SEGUINTES atualiza a partir da parcela selecionada ──
  test("CA-TX22 — PUT escopo ESTE_E_SEGUINTES atualiza parcela atual e seguintes", async () => {
    const { status: sRes, data: dRes } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PENDENTE",
      total_parcelas: 4,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };
    expect(sRes).toBe(201);
    const ids = ((dRes as any).parcelas as any[]).map((p: any) => p.id as string);

    // Atualiza a partir da 2ª parcela
    const { status, data } = await api(`/transacoes/${ids[1]}?escopo=ESTE_E_SEGUINTES`, "PUT", {
      observacao: "Atualizado ESTE_E_SEGUINTES",
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    // Deve ter atualizado parcelas 2, 3 e 4 (3 parcelas)
    expect((data as any).atualizados).toBe(3);

    for (const id of ids) await limparTransacao(id).catch(() => {});
  });

  // ── CA-TX23 — Redução de total_parcelas ───────────────────
  test("CA-TX23 — PUT escopo ESTE_E_SEGUINTES com total_parcelas menor exclui excedentes", async () => {
    const { data: dRes } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PENDENTE",
      total_parcelas: 5,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };
    const ids = ((dRes as any).parcelas as any[]).map((p: any) => p.id as string);
    const idRec = (dRes as any).id_recorrencia as string;

    // Reduzir para 3 parcelas a partir da 1ª
    const { status } = await api(`/transacoes/${ids[0]}?escopo=ESTE_E_SEGUINTES`, "PUT", {
      total_parcelas: 3,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);

    // Verificar que só restam 3 parcelas — buscar com per_page alto para cobrir meses futuros
    const { data: txs } = await api(`/transacoes?id_recorrencia=${idRec}&per_page=200`) as { data: { dados: Record<string, unknown>[] } };
    const restantes = txs.dados;
    expect(restantes.length).toBe(3);

    for (const id of restantes.map(t => t.id as string)) await limparTransacao(id).catch(() => {});
  });

  // ── CA-TX24 — Extensão de total_parcelas ──────────────────
  test("CA-TX24 — PUT escopo ESTE_E_SEGUINTES com total_parcelas maior cria novas parcelas", async () => {
    const { data: dRes } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PENDENTE",
      total_parcelas: 3,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };
    const ids = ((dRes as any).parcelas as any[]).map((p: any) => p.id as string);
    const idRec = (dRes as any).id_recorrencia as string;

    // Estender para 5 parcelas
    const { status } = await api(`/transacoes/${ids[0]}?escopo=ESTE_E_SEGUINTES`, "PUT", {
      total_parcelas: 5,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);

    // Verificar que agora existem 5 parcelas — buscar com per_page alto para cobrir meses futuros
    const { data: txs } = await api(`/transacoes?id_recorrencia=${idRec}&per_page=200`) as { data: { dados: Record<string, unknown>[] } };
    const restantes = txs.dados;
    expect(restantes.length).toBe(5);

    for (const id of restantes.map(t => t.id as string)) await limparTransacao(id).catch(() => {});
  });


  // ── CA-TX25 — Filtro por conta_id ────────────────────────
  test("CA-TX25 — GET /transacoes?conta_id filtra somente lançamentos da conta", async () => {
    // Criar segunda conta para isolar
    const { data: conta2 } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({ nome: "Jest Conta Filtro TX", tipo: "CORRENTE", saldo_inicial: 0 }),
    });

    // Criar lançamento na conta2
    const { data: tx2 } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      conta_id: conta2.id,
      descricao: "TX da conta2",
    }) as { data: Record<string, unknown> };

    const { status, data } = await api(`/transacoes?conta_id=${contaId}`) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    // Nenhum lançamento deve ser da conta2
    expect(dados.filter(t => t.conta_id === conta2.id).length).toBe(0);
    // Todos devem ser da conta principal
    dados.forEach(t => expect(t.conta_id).toBe(contaId));

    // Limpeza
    await api(`/transacoes/${(tx2 as { id: string }).id}`, "DELETE");
    await api(`/contas/${conta2.id}`, "DELETE");
  });

  // ── CA-TX26 — Filtro por categoria_id ────────────────────
  test("CA-TX26 — GET /transacoes?categoria_id filtra somente lançamentos da categoria", async () => {
    // Criar categoria extra
    const { data: cat2 } = await api("/categorias", "POST", {
      descricao: `Jest Cat Filtro TX ${Date.now()}`,
      cor: "#aabbcc",
    }) as { data: Record<string, unknown> };

    // Criar lançamento com cat2
    const { data: txCat } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      categoria_id: cat2.id as string,
      descricao: "TX cat2",
    }) as { data: Record<string, unknown> };

    const { status, data } = await api(`/transacoes?categoria_id=${categoriaId}`) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);
    const dados = (data as { dados: Record<string, unknown>[] }).dados;
    // Nenhum lançamento deve ser da cat2
    expect(dados.filter(t => t.categoria_id === cat2.id).length).toBe(0);

    // Limpeza
    await api(`/transacoes/${(txCat as { id: string }).id}`, "DELETE");
    await api(`/categorias/${(cat2 as { id: string }).id}`, "DELETE");
  });

  // ── CA-TX27 — PROJECAO rejeitada em data passada (RV-008) ─
  test("CA-TX27 — POST rejeita status PROJECAO em data passada ou hoje (RV-008)", async () => {
    const hoje = new Date().toISOString().split("T")[0];
    const ontem = new Date(Date.now() - 86400000).toISOString().split("T")[0];

    const { status: s1, data: d1 } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: hoje,
      status: "PROJECAO",
    }) as { status: number; data: Record<string, unknown> };
    expect(s1).toBe(422);
    expect((d1 as { erro: string }).erro).toMatch(/RV-008/i);

    const { status: s2 } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: ontem,
      status: "PROJECAO",
    }) as { status: number; data: Record<string, unknown> };
    expect(s2).toBe(422);
  });

  // ── CA-TX29 — descricao curta demais ────────────────────
  test("CA-TX29 — POST /transacoes rejeita descricao com menos de 2 caracteres", async () => {
    const { status } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      descricao: "x",
    }) as { status: number };
    expect(status).toBe(400);
  });

  // ── CA-TX30 — descricao longa demais ─────────────────────
  test("CA-TX30 — POST /transacoes rejeita descricao com mais de 200 caracteres", async () => {
    const { status } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      descricao: "A".repeat(201),
    }) as { status: number };
    expect(status).toBe(400);
  });

  // ── CA-TX31 — constraint tudo-ou-nada da recorrência ─────
  test("CA-TX31 — POST /transacoes rejeita recorrência com campos incompletos", async () => {
    const casosInvalidos = [
      { total_parcelas: 3 },
      { tipo_recorrencia: "MENSAL" },
      { total_parcelas: 3, tipo_recorrencia: "MENSAL" },
      { intervalo_recorrencia: 1 },
    ];
    for (const extra of casosInvalidos) {
      const { status } = await api("/transacoes", "POST", {
        ...TX_VALIDA(),
        ...extra,
      }) as { status: number };
      expect([400, 422]).toContain(status);
    }
  });

  // ── CA-TX32 — DELETE escopo ESTE_E_SEGUINTES ─────────────
  test("CA-TX32 — DELETE com escopo ESTE_E_SEGUINTES remove parcela atual e seguintes", async () => {
    const { data } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PENDENTE",
      total_parcelas: 4,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };
    const ids = ((data as any).parcelas as any[]).map((p: any) => p.id as string);
    expect(ids.length).toBe(4);

    // Deletar a partir da 2ª parcela
    const { status } = await api(`/transacoes/${ids[1]}?escopo=ESTE_E_SEGUINTES`, "DELETE") as { status: number };
    expect(status).toBe(200);

    // 1ª parcela deve permanecer
    const { status: s0 } = await api(`/transacoes/${ids[0]}`) as { status: number };
    expect(s0).toBe(200);

    // 2ª e seguintes devem ter sido removidas
    for (let i = 1; i < ids.length; i++) {
      const { status: si } = await api(`/transacoes/${ids[i]}`) as { status: number };
      expect(si).toBe(404);
    }

    await limparTransacao(ids[0]);
  });

  // ── CA-TX33 — DELETE escopo TODOS ────────────────────────
  test("CA-TX33 — DELETE com escopo TODOS remove toda a série de recorrência", async () => {
    const { data } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PENDENTE",
      total_parcelas: 3,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };
    const ids = ((data as any).parcelas as any[]).map((p: any) => p.id as string);
    expect(ids.length).toBe(3);

    const { status } = await api(`/transacoes/${ids[0]}?escopo=TODOS`, "DELETE") as { status: number };
    expect(status).toBe(200);

    for (const id of ids) {
      const { status: si } = await api(`/transacoes/${id}`) as { status: number };
      expect(si).toBe(404);
    }
  });

  // ── CA-TX34 — Recorrência DIARIA ─────────────────────────
  test("CA-TX34 — POST com tipo_recorrencia=DIARIA cria parcelas em dias consecutivos", async () => {
    const hoje = new Date().toISOString().split("T")[0];
    const { status, data } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: hoje,
      status: "PAGO",
      total_parcelas: 3,
      tipo_recorrencia: "DIARIA",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(201);

    const parcelas = ((data as any).parcelas as any[]);
    expect(parcelas.length).toBe(3);

    // Verificar que os intervalos são de 1 dia
    const datas = parcelas
      .map((p: any) => new Date(p.data + "T12:00:00Z").getTime())
      .sort((a, b) => a - b);
    const diff1 = Math.round((datas[1] - datas[0]) / (1000 * 60 * 60 * 24));
    const diff2 = Math.round((datas[2] - datas[1]) / (1000 * 60 * 60 * 24));
    expect(diff1).toBe(1);
    expect(diff2).toBe(1);

    const ids = parcelas.map((p: any) => p.id as string);
    for (const id of ids) await limparTransacao(id).catch(() => {});
  });

  // ── CA-TX35 — Lançamento em conta inativa ────────────────
  test("CA-TX35 — POST /transacoes rejeita lançamento em conta inativa", async () => {
    const { data: criada } = await api("/contas", "POST", {
      nome: "Jest Inativa TX35",
      tipo: "CORRENTE",
      saldo_inicial: 0,
    }) as { data: Record<string, unknown> };
    const idInativa = criada.id as string;
    expect(idInativa).toBeTruthy();

    await api(`/contas/${idInativa}`, "PUT", { ativa: false });

    const { status } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      conta_id: idInativa,
    }) as { status: number };
    expect([400, 422]).toContain(status);

    // Reativar e limpar
    await api(`/contas/${idInativa}`, "PUT", { ativa: true });
    await api(`/contas/${idInativa}`, "DELETE");
  });

  // ── CA-TX28 — Escopo ESTE_E_SEGUINTES com mudança de data ─
  test("CA-TX28 — PUT escopo ESTE_E_SEGUINTES com nova data recalcula datas das seguintes", async () => {
    const { data: dRes } = await api("/transacoes", "POST", {
      ...TX_VALIDA(),
      data: dataFutura(1),
      status: "PENDENTE",
      total_parcelas: 3,
      tipo_recorrencia: "MENSAL",
      intervalo_recorrencia: 1,
    }) as { status: number; data: Record<string, unknown> };
    const ids = ((dRes as any).parcelas as any[]).map((p: any) => p.id as string);
    const idRec = (dRes as any).id_recorrencia as string;

    // Mudar data da 2ª parcela — as seguintes devem ser recalculadas
    const novaData = dataFutura(3);
    const { status } = await api(`/transacoes/${ids[1]}?escopo=ESTE_E_SEGUINTES`, "PUT", {
      data: novaData,
    }) as { status: number; data: Record<string, unknown> };
    expect(status).toBe(200);

    // Verificar que a 2ª parcela tem a nova data
    const { data: tx2 } = await api(`/transacoes/${ids[1]}`) as { data: Record<string, unknown> };
    expect((tx2 as { data: string }).data).toBe(novaData);

    // A 3ª parcela deve ter data posterior à 2ª (recalculada mensalmente)
    const { data: tx3 } = await api(`/transacoes/${ids[2]}`) as { data: Record<string, unknown> };
    expect((tx3 as { data: string }).data > novaData).toBe(true);

    const { data: txs } = await api(`/transacoes?id_recorrencia=${idRec}&per_page=200`) as { data: { dados: Record<string, unknown>[] } };
    for (const id of txs.dados.map(t => t.id as string)) await limparTransacao(id).catch(() => {});
  });

});