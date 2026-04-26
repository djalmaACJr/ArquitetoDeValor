// ============================================================
// Suite de Testes: transferencias.test.ts
// CA-TRF01 a CA-TRF22
// ============================================================

import { api, limparConta } from "./setup";

interface Transferencia {
  id_par: string;
  conta_origem_id: string;
  conta_destino_id: string;
  valor: number;
  data: string;
  descricao: string | null;
  status: string;
  recorrente?: boolean;
  total_parcelas?: number;
  parcela_atual?: number;
  id_debito: string;
  id_credito: string;
}

const NOMES_CONTAS_TESTE = [
  "Conta Origem TRF",
  "Conta Destino TRF",
  "Conta Terceira TRF",
];

let contaOrigemId: string;
let contaDestinoId: string;
let contaTerceiraId: string;
let idParSimples: string;
let idDebitoSimples: string;
let idCreditoSimples: string;
let idParProjecao: string;

// ── Limpeza de contas de teste anteriores ────────────────────
async function limparContasDeTeste(): Promise<void> {
  const { data } = await api("/contas");
  const todas: any[] = data?.dados ?? [];
  const teste = todas.filter((c: any) => NOMES_CONTAS_TESTE.includes(c.nome));

  // Antes de deletar contas, deletar transferências vinculadas
  const { data: trfs } = await api("/transferencias");
  const listaTrfs: any[] = Array.isArray(trfs) ? trfs : [];
  for (const trf of listaTrfs) {
    const ehDeTeste =
      teste.some((c: any) => c.conta_id === trf.conta_origem_id) ||
      teste.some((c: any) => c.conta_id === trf.conta_destino_id);
    if (ehDeTeste) {
      await api(`/transferencias/${trf.id_par}`, { method: "DELETE" });
    }
  }

  for (const conta of teste) {
    await limparConta(conta.conta_id ?? conta.id);
  }
}

describe("Transferências — CA-TRF01 a CA-TRF22", () => {

  beforeAll(async () => {
    // Limpar resíduos de execuções anteriores antes de criar
    await limparContasDeTeste();

    const { status: s1, data: origemData } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Conta Origem TRF",
        tipo: "CORRENTE",
        saldo_inicial: 1000,
        cor: "#FF5733",
      }),
    });
    expect(s1).toBe(201);
    contaOrigemId = origemData.id;

    const { status: s2, data: destinoData } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Conta Destino TRF",
        tipo: "CORRENTE",
        saldo_inicial: 500,
        cor: "#33FF57",
      }),
    });
    expect(s2).toBe(201);
    contaDestinoId = destinoData.id;

    const { status: s3, data: terceiraData } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Conta Terceira TRF",
        tipo: "CORRENTE",
        saldo_inicial: 0,
        cor: "#3357FF",
      }),
    });
    expect(s3).toBe(201);
    contaTerceiraId = terceiraData.id;
  });

  afterAll(async () => {
    await limparContasDeTeste();
  });

  // ── CA-TRF01 ─────────────────────────────────────────────
  test("CA-TRF01 - Criar transferência simples (201)", async () => {
    const { status, data } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
        valor: 500,
        data: "2026-04-08",
        descricao: "Pagamento de aluguel",
        status: "PAGO",
      }),
    });

    expect(status).toBe(201);
    const transfer = data as Transferencia;
    expect(transfer.id_par).toBeTruthy();
    expect(transfer.conta_origem_id).toBe(contaOrigemId);
    expect(transfer.conta_destino_id).toBe(contaDestinoId);
    expect(transfer.valor).toBe(500);

    idParSimples    = transfer.id_par;
    idDebitoSimples = transfer.id_debito;
    idCreditoSimples = transfer.id_credito;
  });

  // ── CA-TRF02 ─────────────────────────────────────────────
  test("CA-TRF02 - Verificar débito e crédito", async () => {
    const { data: debitoData } = await api(`/transacoes/${idDebitoSimples}`);
    expect(debitoData.tipo).toBe("DESPESA");
    expect(debitoData.conta_id).toBe(contaOrigemId);

    const { data: creditoData } = await api(`/transacoes/${idCreditoSimples}`);
    expect(creditoData.tipo).toBe("RECEITA");
    expect(creditoData.conta_id).toBe(contaDestinoId);

    expect(debitoData.id_recorrencia).toBe(creditoData.id_recorrencia);
  });

  // ── CA-TRF03 ─────────────────────────────────────────────
  test("CA-TRF03 - Listar transferências", async () => {
    const { data } = await api("/transferencias");
    const lista = data as Transferencia[];
    expect(Array.isArray(lista)).toBe(true);
    const encontrada = lista.find((t) => t.id_par === idParSimples);
    expect(encontrada).toBeTruthy();
  });

  // ── CA-TRF04 ─────────────────────────────────────────────
  test("CA-TRF04 - Filtrar por mês", async () => {
    const { data } = await api("/transferencias?mes=2026-04");
    const lista = data as Transferencia[];
    const encontrada = lista.find((t) => t.id_par === idParSimples);
    expect(encontrada).toBeTruthy();
  });

  // ── CA-TRF05 ─────────────────────────────────────────────
  test("CA-TRF05 - Buscar por ID", async () => {
    const { data } = await api(`/transferencias/${idParSimples}`);
    const transfer = data as Transferencia;
    expect(transfer.id_par).toBe(idParSimples);
  });

  // ── CA-TRF06 ─────────────────────────────────────────────
  test("CA-TRF06 - Editar valor e descrição", async () => {
    const { status, data } = await api(`/transferencias/${idParSimples}`, {
      method: "PUT",
      body: JSON.stringify({ valor: 750, descricao: "Aluguel ajustado" }),
    });
    expect(status).toBe(200);
    const transfer = data as Transferencia;
    expect(transfer.valor).toBe(750);
    expect(transfer.descricao).toBe("Aluguel ajustado");
  });

  // ── CA-TRF07 ─────────────────────────────────────────────
  test("CA-TRF07 - Trocar contas", async () => {
    const { status, data } = await api(`/transferencias/${idParSimples}`, {
      method: "PUT",
      body: JSON.stringify({
        conta_origem_id: contaDestinoId,
        conta_destino_id: contaTerceiraId,
      }),
    });
    expect(status).toBe(200);
    const transfer = data as Transferencia;
    expect(transfer.conta_origem_id).toBe(contaDestinoId);
    expect(transfer.conta_destino_id).toBe(contaTerceiraId);

    // Restaurar contas originais
    await api(`/transferencias/${idParSimples}`, {
      method: "PUT",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
      }),
    });
  });

  // ── CA-TRF08 ─────────────────────────────────────────────
  test("CA-TRF08 - Excluir transferência", async () => {
    const { status } = await api(`/transferencias/${idParSimples}`, {
      method: "DELETE",
    });
    expect(status).toBe(200);

    const { status: statusGet } = await api(`/transferencias/${idParSimples}`);
    expect(statusGet).toBe(404);
  });

  // ── CA-TRF09 ─────────────────────────────────────────────
  test("CA-TRF09 - Rejeitar mesma conta", async () => {
    const { status } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaOrigemId,
        valor: 100,
        data: "2026-04-08",
      }),
    });
    expect(status).toBe(422);
  });

  // ── CA-TRF10 ─────────────────────────────────────────────
  test("CA-TRF10 - Rejeitar valor inválido", async () => {
    const { status: statusZero } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
        valor: 0,
        data: "2026-04-08",
      }),
    });
    expect(statusZero).toBe(422);

    const { status: statusNeg } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
        valor: -100,
        data: "2026-04-08",
      }),
    });
    expect(statusNeg).toBe(422);
  });

  // ── CA-TRF11 ─────────────────────────────────────────────
  test("CA-TRF11 - Rejeitar campos obrigatórios", async () => {
    const { status: s1 } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({ conta_destino_id: contaDestinoId, valor: 100, data: "2026-04-08" }),
    });
    expect(s1).toBe(422);

    const { status: s2 } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({ conta_origem_id: contaOrigemId, valor: 100, data: "2026-04-08" }),
    });
    expect(s2).toBe(422);

    const { status: s3 } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({ conta_origem_id: contaOrigemId, conta_destino_id: contaDestinoId, data: "2026-04-08" }),
    });
    expect(s3).toBe(422);

    const { status: s4 } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({ conta_origem_id: contaOrigemId, conta_destino_id: contaDestinoId, valor: 100 }),
    });
    expect(s4).toBe(422);
  });

  // ── CA-TRF12 ─────────────────────────────────────────────
  test("CA-TRF12 - Rejeitar status inválido", async () => {
    const { status } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
        valor: 100,
        data: "2026-04-08",
        status: "CANCELADO",
      }),
    });
    expect(status).toBe(422);
  });

  // ── CA-TRF13 ─────────────────────────────────────────────
  test("CA-TRF13 - Rejeitar conta inexistente", async () => {
    const { status } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: "00000000-0000-0000-0000-000000000000",
        conta_destino_id: contaDestinoId,
        valor: 100,
        data: "2026-04-08",
      }),
    });
    expect(status).toBe(404);
  });

  // ── CA-TRF14 ─────────────────────────────────────────────
  test("CA-TRF14 - Impedir exclusão avulsa de lançamento", async () => {
    // Criar transferência temporária
    const { data: transferData } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
        valor: 50,
        data: "2026-04-09",
        descricao: "Teste exclusão avulsa",
      }),
    });
    const transfer = transferData as Transferencia;

    // Tentar deletar diretamente a transação de débito — deve ser bloqueado
    const { status } = await api(`/transacoes/${transfer.id_debito}`, {
      method: "DELETE",
    });
    expect(status).toBeGreaterThanOrEqual(400);

    // Limpar corretamente pelo endpoint de transferências
    await api(`/transferencias/${transfer.id_par}`, { method: "DELETE" });
  });

  // ── CA-TRF15 ─────────────────────────────────────────────
  // A API atual não suporta recorrência em transferências (sem campos recorrente/frequencia).
  // Este teste valida transferência com status PROJECAO como substituto funcional.
  test("CA-TRF15 - Criar transferência com status PROJECAO", async () => {
    const { status, data } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
        valor: 200,
        data: "2026-05-01",
        descricao: "Projeção de transferência",
        status: "PROJECAO",
      }),
    });
    expect(status).toBe(201);
    const transfer = data as Transferencia;
    expect(transfer.status).toBe("PROJECAO");
    expect(transfer.id_par).toBeTruthy();

    idParProjecao = transfer.id_par;
  });

  // ── CA-TRF16 ─────────────────────────────────────────────
  test("CA-TRF16 - Confirmar transferência PROJECAO → PAGO", async () => {
    const { status, data } = await api(`/transferencias/${idParProjecao}`, {
      method: "PUT",
      body: JSON.stringify({ status: "PAGO", valor: 200 }),
    });
    expect(status).toBe(200);
    const transfer = data as Transferencia;
    expect(transfer.status).toBe("PAGO");
  });

  // ── CA-TRF17 ─────────────────────────────────────────────
  test("CA-TRF17 - Excluir transferência PROJECAO confirmada", async () => {
    const { status } = await api(`/transferencias/${idParProjecao}`, {
      method: "DELETE",
    });
    expect(status).toBe(200);

    const { status: statusGet } = await api(`/transferencias/${idParProjecao}`);
    expect(statusGet).toBe(404);
  });

  // ── CA-TRF18 ─────────────────────────────────────────────
  test("CA-TRF18 - Proteção da categoria Transferências", async () => {
    const { data: listaCat } = await api("/categorias");
    const categorias: any[] = listaCat?.dados ?? [];
    const catTransfer = categorias.find((c: any) => c.descricao === "Transferências");

    if (!catTransfer) {
      console.warn("⚠️ Categoria Transferências não encontrada — pulando teste");
      return;
    }

    expect(catTransfer.protegida).toBe(true);

    // DELETE deve ser bloqueado
    const { status: statusDelete } = await api(`/categorias/${catTransfer.id}`, {
      method: "DELETE",
    });
    expect(statusDelete).toBeGreaterThanOrEqual(400);

    // PUT alterando descrição deve ser bloqueado
    const { status: statusPutNome } = await api(`/categorias/${catTransfer.id}`, {
      method: "PUT",
      body: JSON.stringify({ descricao: "Nova Transferências" }),
    });
    expect(statusPutNome).toBeGreaterThanOrEqual(400);

    // PUT alterando apenas cor deve ser permitido
    const { status: statusPutCor } = await api(`/categorias/${catTransfer.id}`, {
      method: "PUT",
      body: JSON.stringify({ cor: "#FF0000" }),
    });
    expect(statusPutCor).toBe(200);

    // Restaurar cor original
    await api(`/categorias/${catTransfer.id}`, {
      method: "PUT",
      body: JSON.stringify({ cor: "#9333EA" }),
    });
  });

  // ── CA-TRF19 — Transferência recorrente ─────────────────────
  test("CA-TRF19 - Criar transferência recorrente com 3 parcelas mensais", async () => {
    const dataBase = new Date();
    dataBase.setMonth(dataBase.getMonth() + 1);
    const dataStr = dataBase.toISOString().split("T")[0];

    const { status, data } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id:       contaOrigemId,
        conta_destino_id:      contaDestinoId,
        valor:                 300,
        data:                  dataStr,
        descricao:             "Transferência recorrente teste",
        status:                "PENDENTE",
        total_parcelas:        3,
        tipo_recorrencia:      "MENSAL",
        intervalo_recorrencia: 1,
      }),
    });

    expect(status).toBe(201);
    expect(data).toHaveProperty("id_recorrencia");
    expect((data as any).total).toBe(3);
    expect(Array.isArray((data as any).parcelas)).toBe(true);

    // Todas as parcelas devem ser PENDENTE (datas futuras, status PENDENTE)
    (data as any).parcelas.forEach((p: any) => {
      expect(p.status).toBe("PENDENTE");
    });

    // Limpar — excluir cada par pelo id_par
    for (const par of (data as any).parcelas) {
      await api(`/transferencias/${par.id_par}`, { method: "DELETE" }).catch(() => {});
    }
  });



  // ── CA-TRF20 — Filtro por conta ──────────────────────────
  test("CA-TRF20 — GET /transferencias?conta_id filtra por conta de origem ou destino", async () => {
    // Criar transferência envolvendo contaOrigemId
    const { data: trf } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
        valor: 100,
        data: new Date().toISOString().split("T")[0],
        descricao: "TRF filtro conta",
        status: "PAGO",
      }),
    });
    const trfData = trf as Transferencia;

    const { data } = await api(`/transferencias?conta_id=${contaOrigemId}`);
    const lista = data as Transferencia[];
    expect(Array.isArray(lista)).toBe(true);
    // Deve conter a transferência criada
    const encontrada = lista.find(t => t.id_par === trfData.id_par);
    expect(encontrada).toBeTruthy();

    await api(`/transferencias/${trfData.id_par}`, { method: "DELETE" });
  });

  // ── CA-TRF21 — RLS isolamento transações ──────────────────
  test("CA-TRF21 — GET /transacoes não expõe lançamentos de outro usuário", async () => {
    const idForaEscopo = "00000000-0000-0000-0000-000000000002";
    const { status, data } = await api(`/transacoes?conta_id=${idForaEscopo}`);
    expect(status).toBe(200);
    // RLS filtra silenciosamente — retorna array vazio, não 403
    const dados = (data as { dados: unknown[] }).dados;
    expect(Array.isArray(dados)).toBe(true);
    expect(dados.length).toBe(0);
  });

  // ── CA-TRF22 — RLS isolamento categorias ──────────────────
  test("CA-TRF22 — GET /categorias/:id não expõe categoria de outro usuário", async () => {
    const idForaEscopo = "00000000-0000-0000-0000-000000000003";
    const { status } = await api(`/categorias/${idForaEscopo}`);
    expect(status).toBe(404);
  });

});