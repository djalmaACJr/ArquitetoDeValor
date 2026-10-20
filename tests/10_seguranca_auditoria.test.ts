// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/10_seguranca_auditoria.test.ts
//
// GET /auditoria — escopo da trilha de auditoria (v7.2.1).
// A RLS deixa admin (usuarios.admin = true) ler a trilha de TODOS; o handler
// passou a devolver só a PRÓPRIA trilha por padrão e a exigir ?escopo=todos
// (enviado só por AdminAuditoriaPage) para a visão global. Estes testes usam
// usuários comuns (não admin), então provam o lado seguro: nunca aparece
// linha de outro usuário, com ou sem `escopo`. O comportamento admin em si
// depende da RLS (coberto em 07_seguranca_rls).
// ============================================================

import { api, apiB, getUserId, getUserIdB, tryGetTokenB, limparUserBSeDinamico } from "./setup";

const NOME_CONTA = "Jest Auditoria Escopo";

describe("Auditoria — escopo da trilha (própria por padrão)", () => {
  let userA: string;
  let contaId: string;
  let temB = false;

  beforeAll(async () => {
    userA = await getUserId();
    // Gera pelo menos 1 evento auditado (contas é auditada) pro usuário A.
    const { status, data } = await api("/contas", "POST", {
      nome: NOME_CONTA, tipo: "CORRENTE", saldo_inicial: 0, icone: "🏦", cor: "#123456", ativa: true,
    });
    expect(status).toBe(201);
    contaId = data.id;
    temB = (await tryGetTokenB()) !== null;
  }, 120000);

  afterAll(async () => {
    if (contaId) await api(`/contas/${contaId}`, "DELETE");
    await limparUserBSeDinamico();
  }, 120000);

  test("CA-AUD01 — padrão: todas as linhas pertencem ao próprio usuário", async () => {
    const { status, data } = await api("/auditoria?tabela=contas&limit=100");
    expect(status).toBe(200);
    const itens: any[] = data.dados;
    expect(itens.length).toBeGreaterThan(0);
    expect(itens.every(i => i.user_id === userA)).toBe(true);
  });

  test("CA-AUD02 — escopo=todos não expõe linhas de outros a um usuário comum", async () => {
    const { status, data } = await api("/auditoria?escopo=todos&tabela=contas&limit=200");
    expect(status).toBe(200);
    expect((data.dados as any[]).every(i => i.user_id === userA)).toBe(true);
  });

  test("CA-AUD03 — user_id de outro usuário não retorna nada (RLS)", async () => {
    if (!temB) return;
    const userB = await getUserIdB();
    const { status, data } = await api(`/auditoria?user_id=${userB}`);
    expect(status).toBe(200);
    expect(data.dados).toEqual([]);
  });

  test("CA-AUD04 — B nunca enxerga o evento de A", async () => {
    if (!temB) return;
    const { status, data } = await apiB("/auditoria?escopo=todos&tabela=contas&limit=200");
    expect(status).toBe(200);
    expect((data.dados as any[]).some(i => i.registro_id === contaId)).toBe(false);
  });

  test("CA-AUD05 — criado_por_nome só vem preenchido para conta compartilhada", async () => {
    const { data } = await api("/auditoria?tabela=contas&limit=100");
    // Registros do próprio usuário (criado_por = dono) nunca trazem nome.
    expect((data.dados as any[]).every(i => i.criado_por_nome === null)).toBe(true);
  });

  test("CA-AUD06 — operacao inválida devolve 400", async () => {
    const { status } = await api("/auditoria?operacao=XYZ");
    expect(status).toBe(400);
  });
});
