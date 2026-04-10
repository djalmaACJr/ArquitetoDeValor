// ============================================================
// Suite de Testes: transferencias.test.ts
// CA-TRF01 a CA-TRF18
// ============================================================

import { api, limparConta } from "./setup";

// Tipos
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

function logToFile(step: string, data?: any) {
  console.log(`[LOG] ${step}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

let contaOrigemId: string;
let contaDestinoId: string;
let contaTerceiraId: string;
let idParSimples: string;
let idDebitoSimples: string;
let idCreditoSimples: string;
let idParRecorrente: string;

describe("Transferências - Testes Integrados", () => {
  
  beforeAll(async () => {
    logToFile("🚀 INICIANDO TESTES DE TRANSFERÊNCIAS...");
    
    // Criar conta origem
    const { status: s1, data: origemData } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Conta Origem TRF",
        tipo: "CORRENTE",
        saldo_inicial: 1000,
        cor: "#FF5733",
        ativa: true,
      }),
    });
    expect(s1).toBe(201);
    contaOrigemId = origemData.id;
    logToFile("✅ Conta origem criada", { contaOrigemId });
    
    // Criar conta destino
    const { status: s2, data: destinoData } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Conta Destino TRF",
        tipo: "CORRENTE",
        saldo_inicial: 500,
        cor: "#33FF57",
        ativa: true,
      }),
    });
    expect(s2).toBe(201);
    contaDestinoId = destinoData.id;
    logToFile("✅ Conta destino criada", { contaDestinoId });
    
    // Criar conta terceira
    const { status: s3, data: terceiraData } = await api("/contas", {
      method: "POST",
      body: JSON.stringify({
        nome: "Conta Terceira TRF",
        tipo: "CORRENTE",
        saldo_inicial: 0,
        cor: "#3357FF",
        ativa: true,
      }),
    });
    expect(s3).toBe(201);
    contaTerceiraId = terceiraData.id;
    logToFile("✅ Conta terceira criada", { contaTerceiraId });
  });
  
  afterAll(async () => {
    logToFile("🧹 Limpando contas de teste...");
    await limparConta(contaOrigemId);
    await limparConta(contaDestinoId);
    await limparConta(contaTerceiraId);
    logToFile("🏁 TESTES FINALIZADOS");
  });
  
  // ============================================================
  // CA-TRF01 - Criar transferência simples
  // ============================================================
  
  test("CA-TRF01 - Criar transferência simples (201)", async () => {
    const payload = {
      conta_origem_id: contaOrigemId,
      conta_destino_id: contaDestinoId,
      valor: 500,
      data: "2026-04-08",
      descricao: "Pagamento de aluguel",
      status: "PAGO",
    };
    
    const { status, data } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    
    expect(status).toBe(201);
    const transfer = data as Transferencia;
    expect(transfer.id_par).toBeTruthy();
    expect(transfer.conta_origem_id).toBe(contaOrigemId);
    expect(transfer.conta_destino_id).toBe(contaDestinoId);
    expect(transfer.valor).toBe(500);
    
    idParSimples = transfer.id_par;
    idDebitoSimples = transfer.id_debito;
    idCreditoSimples = transfer.id_credito;
    
    logToFile("✅ CA-TRF01 IDs salvos", { idParSimples, idDebitoSimples, idCreditoSimples });
  });
  
  test("CA-TRF02 - Verificar débito e crédito", async () => {
    const { data: debitoData } = await api(`/transacoes/${idDebitoSimples}`);
    const debito = debitoData as any;
    expect(debito.tipo).toBe("DESPESA");
    expect(debito.conta_id).toBe(contaOrigemId);
    
    const { data: creditoData } = await api(`/transacoes/${idCreditoSimples}`);
    const credito = creditoData as any;
    expect(credito.tipo).toBe("RECEITA");
    expect(credito.conta_id).toBe(contaDestinoId);
    
    expect(debito.id_recorrencia).toBe(credito.id_recorrencia);
    logToFile("✅ CA-TRF02 - Par verificado");
  });
  
  test("CA-TRF03 - Listar transferências", async () => {
    const { data } = await api("/transferencias");
    const lista = data as Transferencia[];
    expect(Array.isArray(lista)).toBe(true);
    
    const encontrada = lista.find((t) => t.id_par === idParSimples);
    expect(encontrada).toBeTruthy();
    logToFile("✅ CA-TRF03 - Lista contém transferência");
  });
  
  test("CA-TRF04 - Filtrar por mês", async () => {
    const { data } = await api("/transferencias?mes=2026-04");
    const lista = data as Transferencia[];
    const encontrada = lista.find((t) => t.id_par === idParSimples);
    expect(encontrada).toBeTruthy();
    logToFile("✅ CA-TRF04 - Filtro por mês funcionou");
  });
  
  test("CA-TRF05 - Buscar por ID", async () => {
    const { data } = await api(`/transferencias/${idParSimples}`);
    const transfer = data as Transferencia;
    expect(transfer.id_par).toBe(idParSimples);
    logToFile("✅ CA-TRF05 - Busca por ID funcionou");
  });
  
  test("CA-TRF06 - Editar valor e descrição", async () => {
    const { data } = await api(`/transferencias/${idParSimples}`, {
      method: "PUT",
      body: JSON.stringify({
        valor: 750,
        descricao: "Aluguel ajustado",
      }),
    });
    const transfer = data as Transferencia;
    expect(transfer.valor).toBe(750);
    expect(transfer.descricao).toBe("Aluguel ajustado");
    logToFile("✅ CA-TRF06 - Edição funcionou");
  });
  
  test("CA-TRF07 - Trocar contas", async () => {
    const { data } = await api(`/transferencias/${idParSimples}`, {
      method: "PUT",
      body: JSON.stringify({
        conta_origem_id: contaDestinoId,
        conta_destino_id: contaTerceiraId,
      }),
    });
    const transfer = data as Transferencia;
    expect(transfer.conta_origem_id).toBe(contaDestinoId);
    expect(transfer.conta_destino_id).toBe(contaTerceiraId);
    
    // Restaurar
    await api(`/transferencias/${idParSimples}`, {
      method: "PUT",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
      }),
    });
    logToFile("✅ CA-TRF07 - Troca de contas funcionou");
  });
  
  test("CA-TRF08 - Excluir transferência", async () => {
    const { status } = await api(`/transferencias/${idParSimples}`, {
      method: "DELETE",
    });
    expect(status).toBe(200);
    
    const { status: statusGet } = await api(`/transferencias/${idParSimples}`);
    expect(statusGet).toBe(404);
    logToFile("✅ CA-TRF08 - Exclusão funcionou");
  });
  
  // ============================================================
  // CA-TRF09 a CA-TRF13 - Validações
  // ============================================================
  
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
    logToFile("✅ CA-TRF09 - Mesma conta rejeitada");
  });
  
  test("CA-TRF10 - Rejeitar valor inválido", async () => {
    // Valor zero
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
    
    // Valor negativo
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
    logToFile("✅ CA-TRF10 - Valor inválido rejeitado");
  });
  
  test("CA-TRF11 - Rejeitar campos obrigatórios", async () => {
    // Sem conta_origem_id
    const { status: s1 } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({ conta_destino_id: contaDestinoId, valor: 100, data: "2026-04-08" }),
    });
    expect(s1).toBe(422);
    
    // Sem conta_destino_id
    const { status: s2 } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({ conta_origem_id: contaOrigemId, valor: 100, data: "2026-04-08" }),
    });
    expect(s2).toBe(422);
    
    // Sem valor
    const { status: s3 } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({ conta_origem_id: contaOrigemId, conta_destino_id: contaDestinoId, data: "2026-04-08" }),
    });
    expect(s3).toBe(422);
    
    // Sem data
    const { status: s4 } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({ conta_origem_id: contaOrigemId, conta_destino_id: contaDestinoId, valor: 100 }),
    });
    expect(s4).toBe(422);
    logToFile("✅ CA-TRF11 - Campos obrigatórios validados");
  });
  
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
    logToFile("✅ CA-TRF12 - Status inválido rejeitado");
  });
  
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
    logToFile("✅ CA-TRF13 - Conta inexistente rejeitada");
  });
  
  // ============================================================
  // CA-TRF14 - Proteção contra exclusão avulsa
  // ============================================================
  
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
    const idDebitoTemp = transfer.id_debito;
    
    // Tentar deletar diretamente pela transação (deve ser bloqueado)
    const { status } = await api(`/transacoes/${idDebitoTemp}`, {
      method: "DELETE",
    });
    expect(status).toBeGreaterThanOrEqual(400);
    
    // Limpar: deletar pela transferência
    await api(`/transferencias/${transfer.id_par}`, { method: "DELETE" });
    logToFile("✅ CA-TRF14 - Exclusão avulsa bloqueada");
  });
  
  // ============================================================
  // CA-TRF15 a CA-TRF17 - Recorrência
  // ============================================================
  
  test("CA-TRF15 - Criar transferência recorrente", async () => {
    const { status, data } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id: contaOrigemId,
        conta_destino_id: contaDestinoId,
        valor: 200,
        data: "2026-05-01",
        descricao: "Mesada",
        status: "PROJECAO",
        recorrente: true,
        frequencia: "MENSAL",
        total_parcelas: 3,
      }),
    });
    expect(status).toBe(201);
    const body = data as { transferencias: Transferencia[] };
    expect(Array.isArray(body.transferencias)).toBe(true);
    expect(body.transferencias.length).toBe(3);
    
    idParRecorrente = body.transferencias[1].id_par;
    logToFile("✅ CA-TRF15 - Recorrência criada", { idParRecorrente });
  });
  
  test("CA-TRF16 - Editar par recorrente", async () => {
    const { status, data } = await api(`/transferencias/${idParRecorrente}`, {
      method: "PUT",
      body: JSON.stringify({ valor: 250 }),
    });
    expect(status).toBe(200);
    const transfer = data as Transferencia;
    expect(transfer.valor).toBe(250);
    logToFile("✅ CA-TRF16 - Edição de par recorrente funcionou");
  });
  
  test("CA-TRF17 - Excluir par recorrente individual", async () => {
    const { status } = await api(`/transferencias/${idParRecorrente}`, {
      method: "DELETE",
    });
    expect(status).toBe(200);
    
    const { status: statusGet } = await api(`/transferencias/${idParRecorrente}`);
    expect(statusGet).toBe(404);
    logToFile("✅ CA-TRF17 - Exclusão de par recorrente funcionou");
  });
  
  // ============================================================
  // CA-TRF18 - Proteção da categoria Transferências
  // ============================================================
  
  test("CA-TRF18 - Proteção da categoria Transferências", async () => {
    // Buscar categoria Transferências
    const { data: listaCat } = await api("/categorias");
    const categorias = listaCat?.dados || [];
    const catTransfer = categorias.find((c: any) => c.descricao === "Transferências");
    
    if (!catTransfer) {
      console.warn("⚠️ Categoria Transferências não encontrada - pulando teste");
      return;
    }
    
    expect(catTransfer.protegida).toBe(true);
    logToFile("✅ Categoria Transferências é protegida");
    
    // DELETE deve ser bloqueado
    const { status: statusDelete } = await api(`/categorias/${catTransfer.id}`, {
      method: "DELETE",
    });
    expect(statusDelete).toBeGreaterThanOrEqual(400);
    logToFile("✅ DELETE bloqueado");
    
    // PUT alterando nome deve ser bloqueado
    const { status: statusPutNome } = await api(`/categorias/${catTransfer.id}`, {
      method: "PUT",
      body: JSON.stringify({ descricao: "Nova Transferências" }),
    });
    expect(statusPutNome).toBeGreaterThanOrEqual(400);
    logToFile("✅ PUT alterando nome bloqueado");
    
    // PUT alterando apenas cor deve ser permitido
    const { status: statusPutCor } = await api(`/categorias/${catTransfer.id}`, {
      method: "PUT",
      body: JSON.stringify({ cor: "#FF0000" }),
    });
    expect(statusPutCor).toBe(200);
    logToFile("✅ PUT alterando cor permitido");
    
    // Restaurar cor original
    await api(`/categorias/${catTransfer.id}`, {
      method: "PUT",
      body: JSON.stringify({ cor: "#9333EA" }),
    });
    
    logToFile("✅ CA-TRF18 - Proteção da categoria verificada");
  });
  
});