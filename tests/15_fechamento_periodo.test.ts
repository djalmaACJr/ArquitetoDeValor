// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/15_fechamento_periodo.test.ts
//
// Fechamento de período (v7.5.0): o banco guarda o saldo de cada conta até
// uma data (<= hoje − 1 ano) e os saldos somam só o que veio depois. Os
// saldos expostos NUNCA podem mudar por causa do fechamento, e alterações
// em lançamentos antigos precisam refletir no saldo guardado.
//
// Cobre critérios de aceite: CA-FEC01 a CA-FEC08
// ============================================================
import { api, limparConta, limparTransacao } from "./setup";

const dia = (offsetDias = 0, offsetAnos = 0): string => {
  const d = new Date();
  d.setFullYear(d.getFullYear() + offsetAnos);
  d.setDate(d.getDate() + offsetDias);
  return d.toISOString().split("T")[0];
};

const DATA_FECHAMENTO = dia(-2, -1);   // hoje − 1 ano − 2 dias (folga p/ fuso)
const DATA_ANTIGA     = dia(0, -2);    // 2 anos atrás (dentro do período fechado)
const DATA_ANTIGA_2   = dia(-5, -1);   // 1 ano + 5 dias atrás (também fechado)
const DATA_RECENTE    = dia(0, 0);     // hoje (fora do período fechado)

let contaId: string;
let categoriaId: string;
const criadas: string[] = [];

async function saldoConta(): Promise<number> {
  const { data } = await api(`/contas/${contaId}`) as { data: { saldo_atual: number } };
  return Number(data.saldo_atual);
}

async function criarTx(data: string, tipo: "RECEITA" | "DESPESA", valor: number, status = "PAGO") {
  const res = await api("/transacoes", "POST", {
    data, descricao: "Teste Jest Fechamento", valor, tipo, status,
    conta_id: contaId, categoria_id: categoriaId,
  }) as { status: number; data: { id: string } };
  expect(res.status).toBe(201);
  criadas.push(res.data.id);
  return res.data.id;
}

describe("Fechamento de período — CA-FEC01 a CA-FEC08", () => {
  beforeAll(async () => {
    const { data: cats } = await api("/categorias?apenas_pai=true") as { data: { dados: Record<string, unknown>[] } };
    categoriaId = (cats.dados.find(c => !c.protegida) ?? cats.dados[0]).id as string;

    const { data } = await api("/contas", "POST", {
      nome: `Conta Fechamento ${Date.now()}`, tipo: "CORRENTE", saldo_inicial: 100, cor: "#00c896",
    }) as { data: { conta_id: string } };
    contaId = data.conta_id;

    await criarTx(DATA_ANTIGA,   "RECEITA", 50);
    await criarTx(DATA_RECENTE,  "DESPESA", 10);
  }, 60_000);

  afterAll(async () => {
    await api("/contas/fechamento", "DELETE");
    for (const id of criadas) await limparTransacao(id);
    await limparConta(contaId);
  }, 60_000);

  test("CA-FEC01 — sem fechamento, GET /contas/fechamento devolve data nula", async () => {
    await api("/contas/fechamento", "DELETE");
    const { status, data } = await api("/contas/fechamento") as { status: number; data: { dados: { data_fechamento: string | null } } };
    expect(status).toBe(200);
    expect(data.dados.data_fechamento).toBeNull();
    expect(await saldoConta()).toBe(140);   // 100 + 50 − 10
  });

  test("CA-FEC02 — rejeita data posterior a hoje − 1 ano e formato inválido", async () => {
    const hoje = await api("/contas/fechamento", "PUT", { data_fechamento: DATA_RECENTE });
    expect(hoje.status).toBe(400);
    const quaseUmAno = await api("/contas/fechamento", "PUT", { data_fechamento: dia(5, -1) });
    expect(quaseUmAno.status).toBe(400);
    const lixo = await api("/contas/fechamento", "PUT", { data_fechamento: "ontem" });
    expect(lixo.status).toBe(400);
  });

  test("CA-FEC03 — fechar o período não altera o saldo da conta nem o do Extrato", async () => {
    const mes = DATA_RECENTE.slice(0, 7);
    const antes = await api(`/transacoes?saldo=true&mes=${mes}`) as { data: { dados: { saldo_acumulado: number }[] } };
    const ultimoAntes = antes.data.dados[antes.data.dados.length - 1]?.saldo_acumulado;

    const { status, data } = await api("/contas/fechamento", "PUT", { data_fechamento: DATA_FECHAMENTO }) as { status: number; data: { dados: { data_fechamento: string } } };
    expect(status).toBe(200);
    expect(data.dados.data_fechamento).toBe(DATA_FECHAMENTO);

    const lido = await api("/contas/fechamento") as { data: { dados: { data_fechamento: string } } };
    expect(lido.data.dados.data_fechamento).toBe(DATA_FECHAMENTO);

    expect(await saldoConta()).toBe(140);
    const depois = await api(`/transacoes?saldo=true&mes=${mes}`) as { data: { dados: { saldo_acumulado: number }[] } };
    expect(depois.data.dados[depois.data.dados.length - 1]?.saldo_acumulado).toBe(ultimoAntes);
  });

  test("CA-FEC04 — lançamento criado dentro do período fechado atualiza o saldo", async () => {
    const id = await criarTx(DATA_ANTIGA_2, "RECEITA", 25);
    expect(await saldoConta()).toBe(165);
    await limparTransacao(id);
    criadas.splice(criadas.indexOf(id), 1);
    expect(await saldoConta()).toBe(140);
  });

  test("CA-FEC05 — editar valor e mover data de um lançamento antigo atualiza o saldo", async () => {
    const id = await criarTx(DATA_ANTIGA_2, "RECEITA", 25);          // 165
    const r1 = await api(`/transacoes/${id}`, "PUT", { valor: 40 });
    expect(r1.status).toBe(200);
    expect(await saldoConta()).toBe(180);                              // +15
    // sai do período fechado: continua somando (agora pelo caminho "após o fechamento")
    const r2 = await api(`/transacoes/${id}`, "PUT", { data: DATA_RECENTE });
    expect(r2.status).toBe(200);
    expect(await saldoConta()).toBe(180);
    // volta para dentro
    const r3 = await api(`/transacoes/${id}`, "PUT", { data: DATA_ANTIGA_2 });
    expect(r3.status).toBe(200);
    expect(await saldoConta()).toBe(180);
    await limparTransacao(id);
    criadas.splice(criadas.indexOf(id), 1);
    expect(await saldoConta()).toBe(140);
  });

  test("CA-FEC06 — alterar o saldo inicial da conta atualiza o saldo guardado", async () => {
    const r = await api(`/contas/${contaId}`, "PUT", { saldo_inicial: 300 });
    expect(r.status).toBe(200);
    expect(await saldoConta()).toBe(340);
    await api(`/contas/${contaId}`, "PUT", { saldo_inicial: 100 });
    expect(await saldoConta()).toBe(140);
  });

  test("CA-FEC07 — 'Recalcular' (PUT com a mesma data) preserva o saldo", async () => {
    const r = await api("/contas/fechamento", "PUT", { data_fechamento: DATA_FECHAMENTO });
    expect(r.status).toBe(200);
    expect(await saldoConta()).toBe(140);
  });

  test("CA-FEC08 — remover o fechamento volta ao cálculo completo com o mesmo saldo", async () => {
    const { status } = await api("/contas/fechamento", "DELETE");
    expect(status).toBe(200);
    const { data } = await api("/contas/fechamento") as { data: { dados: { data_fechamento: string | null } } };
    expect(data.dados.data_fechamento).toBeNull();
    expect(await saldoConta()).toBe(140);
  });
});
