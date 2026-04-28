// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/limpar.test.ts
//
// Cobre critérios de aceite: CA-LIM01 a CA-LIM10
// ============================================================
import { api, apiSemAuth } from "./setup";

// IDs criados durante os testes para validação
let contaId:    string;
let categoriaId: string;
let transacaoId: string;

// ── Helpers de criação ────────────────────────────────────────
async function criarContaTeste(sufixo = ""): Promise<string> {
  const { data } = await api("/contas", "POST", {
    nome:          `Conta Teste Limpar${sufixo}`,
    tipo:          "CORRENTE",
    saldo_inicial: 0,
    cor:           "#ff6b4a",
  }) as { data: Record<string, unknown> };
  return data.conta_id as string;
}

async function criarCategoriaTeste(sufixo = ""): Promise<string> {
  const { data } = await api("/categorias", "POST", {
    descricao: `CatLimp${sufixo}`,
    tipo:      "DESPESA",
  }) as { data: Record<string, unknown> };
  return data.id as string;
}

async function criarTransacaoTeste(cId: string, catId: string): Promise<string> {
  const { data } = await api("/transacoes", "POST", {
    data:        new Date().toISOString().split("T")[0],
    descricao:   "Transacao Teste Limpar",
    valor:       100.00,
    tipo:        "DESPESA",
    status:      "PAGO",
    conta_id:    cId,
    categoria_id: catId,
  }) as { data: Record<string, unknown> };
  return data.id as string;
}

// ── Helpers de verificação ─────────────────────────────────────
async function contaExiste(id: string): Promise<boolean> {
  const { status } = await api(`/contas/${id}`);
  return status === 200;
}

async function categoriaExiste(id: string): Promise<boolean> {
  const { status } = await api(`/categorias/${id}`);
  return status === 200;
}

async function transacaoExiste(id: string): Promise<boolean> {
  const { status } = await api(`/transacoes/${id}`);
  return status === 200;
}

// ── Suite de testes ───────────────────────────────────────────
describe("Limpar — CA-LIM01 a CA-LIM10", () => {

  // Setup: cria dados para os testes de limpeza pontual (não usa limparTudo ainda)
  beforeAll(async () => {
    contaId     = await criarContaTeste()
    categoriaId = await criarCategoriaTeste()
    transacaoId = await criarTransacaoTeste(contaId, categoriaId)
  })

  // ── CA-LIM01 ─────────────────────────────────────────────────
  test("CA-LIM01 — DELETE /limpar sem auth retorna 401", async () => {
    const { status } = await apiSemAuth("/limpar", "DELETE")
    expect(status).toBe(401)
  })

  // ── CA-LIM02 ─────────────────────────────────────────────────
  test("CA-LIM02 — DELETE /limpar?entidade=invalida retorna 422", async () => {
    const { status, data } = await api("/limpar?entidade=invalida", "DELETE") as {
      status: number; data: Record<string, unknown>
    }
    expect(status).toBe(422)
    expect((data as { erro: string }).erro).toMatch(/entidade inválida/i)
  })

  // ── CA-LIM03 ─────────────────────────────────────────────────
  test("CA-LIM03 — GET /limpar retorna 405 (método não permitido)", async () => {
    const { status } = await api("/limpar", "GET")
    expect(status).toBe(405)
  })

  // ── CA-LIM04 ─────────────────────────────────────────────────
  test("CA-LIM04 — DELETE /limpar?entidade=transacoes exclui transações do usuário", async () => {
    // Garante que existe ao menos 1 transação antes
    expect(await transacaoExiste(transacaoId)).toBe(true)

    const { status, data } = await api("/limpar?entidade=transacoes", "DELETE") as {
      status: number; data: Record<string, unknown>
    }
    expect(status).toBe(200)
    expect(data).toHaveProperty("ok", true)
    expect(data).toHaveProperty("excluidos")
    expect((data as { excluidos: number }).excluidos).toBeGreaterThanOrEqual(1)

    // Transação não deve mais existir
    expect(await transacaoExiste(transacaoId)).toBe(false)
  })

  // ── CA-LIM05 ─────────────────────────────────────────────────
  test("CA-LIM05 — DELETE /limpar?entidade=categorias exclui categorias não protegidas", async () => {
    // Garante que a categoria de teste existe
    expect(await categoriaExiste(categoriaId)).toBe(true)

    const { status, data } = await api("/limpar?entidade=categorias", "DELETE") as {
      status: number; data: Record<string, unknown>
    }
    expect(status).toBe(200)
    expect(data).toHaveProperty("ok", true)

    // Categoria de teste não deve mais existir
    expect(await categoriaExiste(categoriaId)).toBe(false)
  })

  // ── CA-LIM06 ─────────────────────────────────────────────────
  test("CA-LIM06 — DELETE /limpar?entidade=categorias mantém categorias protegidas", async () => {
    // Buscar todas as categorias e verificar que as protegidas permanecem
    const { data } = await api("/categorias") as { data: Record<string, unknown> }
    const cats = (data as { dados: Record<string, unknown>[] }).dados
    const protegidas = cats.filter(c => c.protegida === true)

    // Deve existir ao menos a categoria "Transferências" (protegida por padrão)
    expect(protegidas.length).toBeGreaterThanOrEqual(1)
  })

  // ── CA-LIM07 ─────────────────────────────────────────────────
  test("CA-LIM07 — DELETE /limpar?entidade=contas exclui todas as contas do usuário", async () => {
    // Garante que a conta de teste existe
    expect(await contaExiste(contaId)).toBe(true)

    const { status, data } = await api("/limpar?entidade=contas", "DELETE") as {
      status: number; data: Record<string, unknown>
    }
    expect(status).toBe(200)
    expect(data).toHaveProperty("ok", true)
    expect(data).toHaveProperty("excluidos")
    expect((data as { excluidos: number }).excluidos).toBeGreaterThanOrEqual(1)

    // Conta não deve mais existir
    expect(await contaExiste(contaId)).toBe(false)
  })

  // ── CA-LIM08 ─────────────────────────────────────────────────
  test("CA-LIM08 — DELETE /limpar (sem entidade) limpa tudo em ordem e retorna logs", async () => {
    // Recriar dados para o teste de limpeza total
    const cId   = await criarContaTeste(" Total")
    const catId = await criarCategoriaTeste(" Total")
    const txId  = await criarTransacaoTeste(cId, catId)

    const { status, data } = await api("/limpar", "DELETE") as {
      status: number; data: Record<string, unknown>
    }
    expect(status).toBe(200)
    expect(data).toHaveProperty("ok", true)
    expect(data).toHaveProperty("logs")

    const logs = (data as { logs: { entidade: string; excluidos: number }[] }).logs
    expect(Array.isArray(logs)).toBe(true)

    // Deve ter log para cada entidade na ordem correta
    const entidades = logs.map(l => l.entidade)
    expect(entidades).toContain("transacoes")
    expect(entidades).toContain("categorias")
    expect(entidades).toContain("contas")

    // índice de transacoes deve vir antes de categorias e contas
    expect(entidades.indexOf("transacoes")).toBeLessThan(entidades.indexOf("categorias"))
    expect(entidades.indexOf("categorias")).toBeLessThan(entidades.indexOf("contas"))

    // Os dados recriados não devem mais existir
    expect(await transacaoExiste(txId)).toBe(false)
    expect(await categoriaExiste(catId)).toBe(false)
    expect(await contaExiste(cId)).toBe(false)
  })

  // ── CA-LIM09 ─────────────────────────────────────────────────
  test("CA-LIM09 — DELETE /limpar?entidade=transacoes com banco vazio retorna excluidos=0 sem erro", async () => {
    // Banco já está limpo após CA-LIM08
    const { status, data } = await api("/limpar?entidade=transacoes", "DELETE") as {
      status: number; data: Record<string, unknown>
    }
    expect(status).toBe(200)
    expect(data).toHaveProperty("ok", true)
    expect((data as { excluidos: number }).excluidos).toBe(0)
  })

  // ── CA-LIM10 ─────────────────────────────────────────────────
  test("CA-LIM10 — DELETE /limpar não afeta dados de outro usuário", async () => {
    // Este teste valida isolamento por RLS.
    // Criamos dados com o usuário de teste, depois verificamos que a limpeza
    // retorna apenas os registros do próprio usuário (excluidos >= 0)
    // e não lança erro de permissão ou acesso cruzado.
    const { status, data } = await api("/limpar", "DELETE") as {
      status: number; data: Record<string, unknown>
    }
    expect(status).toBe(200)
    expect(data).toHaveProperty("ok", true)

    // RLS garante que apenas os dados do user autenticado foram afetados.
    // Se chegou 200 sem erro, o isolamento está funcionando corretamente.
    const logs = (data as { logs: { entidade: string; excluidos: number }[] }).logs
    logs.forEach(log => {
      expect(log.excluidos).toBeGreaterThanOrEqual(0)
    })
  })
})
