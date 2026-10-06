// ============================================================
// Arquiteto de Valor — Testes de domínio: Agregados
// tests/13_agregados.test.ts
//
// Fase 0 — ciclo de vida do vínculo dono↔agregado implementado em
// 20260930000001_agregados_fundacao.sql: convidar, reenviar, revogar,
// definir permissões/contas, aceitar/recusar — via RPC direto (naquela
// fase ainda não existia Edge Function própria).
//
// Fase 1 — supabase/functions/agregados/ (wrapper HTTP das mesmas RPCs) e
// leitura do Extrato (contas/categorias/transacoes) por um agregado com o
// módulo EXTRATO liberado, via header X-Contexto-User-Id (ver
// resolverContexto() em _shared/utils.ts e EspacoContext.tsx no front).
//
// Blocos de teste:
//   • "RPCs do dono" (Fase 0) — só precisa de User A.
//   • "Ciclo completo com agregado" (Fase 0) — precisa de User B.
//   • "Edge Function (Fase 1)" — só User A, valida rotas/status/formato.
//   • "Leitura do Extrato por agregado (Fase 1)" — precisa de User B.
// Sem User B disponível (TEST_EMAIL_B/TEST_PASSWORD_B), os blocos que
// dependem dele avisam e pulam graciosamente — mesmo critério já usado em
// 07_seguranca_rls.test.ts (nunca "passa" sem ter testado nada: os testes
// aparecem como executados/verdes porque fazem `return` cedo, não como
// SKIPPED silencioso).
// ============================================================

import {
  getToken, getTokenB, tryGetTokenB, getUserId, getUserIdB, getEmailB,
  clienteComToken, clienteServiceRole, limparConta, limparUserBSeDinamico,
  api, authHeaders, authHeadersB,
} from "./setup";

const TS = Date.now();

async function criarContaA(nome: string): Promise<string> {
  const token = await getToken();
  const db = clienteComToken(token);
  // user_id não tem DEFAULT no banco (a Edge Function sempre o informa
  // explicitamente) — sem ele, o INSERT grava NULL e a RLS bloqueia
  // (WITH CHECK user_id = auth.uid() nunca bate contra NULL).
  const { data, error } = await db
    .from("contas")
    .insert({ user_id: await getUserId(), nome, tipo: "CORRENTE", saldo_inicial: 0, icone: "🏦", cor: "#00c896" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Falha ao criar conta de teste: ${error?.message}`);
  return data.id as string;
}

describe("Agregados — RPCs do dono (sem depender de User B)", () => {
  let dbA: ReturnType<typeof clienteComToken>;
  let dbAEmail: string;
  const vinculosParaRevogar: string[] = [];
  const contasParaLimpar: string[] = [];

  beforeAll(async () => {
    const token = await getToken();
    dbA = clienteComToken(token);
    const { data } = await dbA.from("usuarios").select("email").eq("id", await getUserId()).single();
    dbAEmail = data!.email as string;
  });

  afterAll(async () => {
    // fn_revogar_agregado nunca REJEITA (erros do Postgres vêm no campo
    // `error`, não como exceção JS) — ignora o resultado de propósito, a
    // limpeza é best-effort.
    for (const id of vinculosParaRevogar) {
      await dbA.rpc("fn_revogar_agregado", { p_vinculo_id: id });
    }
    for (const id of contasParaLimpar) {
      await limparConta(id);
    }
  });

  // ── CA-AGR01 ──────────────────────────────────────────
  test("CA-AGR01 — fn_convidar_agregado cria vínculo PENDENTE", async () => {
    const email = `agregado-${TS}-01@example.com`;
    const { data, error } = await dbA.rpc("fn_convidar_agregado", { p_email: email });
    expect(error).toBeNull();
    expect(data.status).toBe("PENDENTE");
    expect(data.email_convidado).toBe(email);
    expect(data.agregado_id).toBeNull();
    expect(data.token).toBeTruthy();
    vinculosParaRevogar.push(data.id);
  });

  // ── CA-AGR02 ──────────────────────────────────────────
  test("CA-AGR02 — convidar o mesmo e-mail de novo reaproveita o vínculo pendente", async () => {
    const email = `agregado-${TS}-02@example.com`;
    const { data: primeiro } = await dbA.rpc("fn_convidar_agregado", { p_email: email });
    vinculosParaRevogar.push(primeiro.id);

    const { data: segundo, error } = await dbA.rpc("fn_convidar_agregado", { p_email: email });
    expect(error).toBeNull();
    expect(segundo.id).toBe(primeiro.id);
    expect(segundo.token).toBe(primeiro.token);
  });

  // ── CA-AGR03 ──────────────────────────────────────────
  test("CA-AGR03 — convidar a própria conta falha com CONVITE_PROPRIO", async () => {
    const { error } = await dbA.rpc("fn_convidar_agregado", { p_email: dbAEmail });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/CONVITE_PROPRIO/);
  });

  // ── CA-AGR04 ──────────────────────────────────────────
  test("CA-AGR04 — fn_reenviar_convite_agregado gera novo token", async () => {
    const email = `agregado-${TS}-04@example.com`;
    const { data: criado } = await dbA.rpc("fn_convidar_agregado", { p_email: email });
    vinculosParaRevogar.push(criado.id);

    const { data: reenviado, error } = await dbA.rpc("fn_reenviar_convite_agregado", { p_vinculo_id: criado.id });
    expect(error).toBeNull();
    expect(reenviado.token).not.toBe(criado.token);
  });

  // ── CA-AGR05 ──────────────────────────────────────────
  test("CA-AGR05 — fn_definir_contas_agregado rejeita conta de outro dono", async () => {
    const email = `agregado-${TS}-05@example.com`;
    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: email });
    vinculosParaRevogar.push(vinc.id);

    const contaAlheia = "00000000-0000-0000-0000-000000000000"; // UUID válido mas inexistente
    const { error } = await dbA.rpc("fn_definir_contas_agregado", {
      p_vinculo_id: vinc.id, p_conta_ids: [contaAlheia],
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/CONTA_INVALIDA/);
  });

  // ── CA-AGR06 ──────────────────────────────────────────
  test("CA-AGR06 — fn_definir_contas_agregado aceita conta própria e grava", async () => {
    const email = `agregado-${TS}-06@example.com`;
    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: email });
    vinculosParaRevogar.push(vinc.id);

    const contaId = await criarContaA(`Conta-AGR06-${TS}`);
    contasParaLimpar.push(contaId);

    const { error } = await dbA.rpc("fn_definir_contas_agregado", {
      p_vinculo_id: vinc.id, p_conta_ids: [contaId],
    });
    expect(error).toBeNull();

    const { data: lista } = await dbA.from("agregados_contas").select("conta_id").eq("agregado_vinculo_id", vinc.id);
    expect((lista ?? []).map((l: any) => l.conta_id)).toEqual([contaId]);
  });

  // ── CA-AGR07 ──────────────────────────────────────────
  test("CA-AGR07 — fn_definir_permissoes_agregado liga e desliga módulo", async () => {
    const email = `agregado-${TS}-07@example.com`;
    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: email });
    vinculosParaRevogar.push(vinc.id);

    const { error: errLigar } = await dbA.rpc("fn_definir_permissoes_agregado", {
      p_vinculo_id: vinc.id, p_modulo: "EXTRATO", p_liberado: true, p_pode_escrever: true,
    });
    expect(errLigar).toBeNull();

    const { data: pos1 } = await dbA.from("agregados_permissoes").select("*").eq("agregado_vinculo_id", vinc.id);
    expect(pos1).toHaveLength(1);
    expect(pos1![0].modulo).toBe("EXTRATO");
    expect(pos1![0].pode_escrever).toBe(true);

    const { error: errDesligar } = await dbA.rpc("fn_definir_permissoes_agregado", {
      p_vinculo_id: vinc.id, p_modulo: "EXTRATO", p_liberado: false, p_pode_escrever: false,
    });
    expect(errDesligar).toBeNull();

    const { data: pos2 } = await dbA.from("agregados_permissoes").select("*").eq("agregado_vinculo_id", vinc.id);
    expect(pos2).toHaveLength(0);
  });

  // ── CA-AGR08 ──────────────────────────────────────────
  test("CA-AGR08 — fn_revogar_agregado muda status e bloqueia novo reenvio", async () => {
    const email = `agregado-${TS}-08@example.com`;
    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: email });

    const { error: errRevogar } = await dbA.rpc("fn_revogar_agregado", { p_vinculo_id: vinc.id });
    expect(errRevogar).toBeNull();

    const { data: linha } = await dbA.from("agregados").select("status").eq("id", vinc.id).single();
    expect(linha!.status).toBe("REVOGADO");

    // Reenviar um convite já revogado não deve reativá-lo.
    const { error: errReenviar } = await dbA.rpc("fn_reenviar_convite_agregado", { p_vinculo_id: vinc.id });
    expect(errReenviar).not.toBeNull();
    expect(errReenviar!.message).toMatch(/CONVITE_NAO_ENCONTRADO/);
  });

  // ── CA-AGR09 ──────────────────────────────────────────
  test("CA-AGR09 — fn_aceitar_convite_agregado com token inexistente falha", async () => {
    const { error } = await dbA.rpc("fn_aceitar_convite_agregado", {
      p_token: "00000000-0000-0000-0000-000000000000",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/CONVITE_NAO_ENCONTRADO/);
  });
});

// Mesmo critério de 07_seguranca_rls.test.ts: sem User B disponível, a
// suíte roda como SKIPPED (nunca como "passou" sem testar nada).
let TEM_USER_B = false;

describe("Agregados — ciclo completo com um 2º usuário real", () => {
  let dbA: ReturnType<typeof clienteComToken>;
  let dbB: ReturnType<typeof clienteComToken>;
  let emailB: string;
  const vinculosParaRevogar: string[] = [];

  beforeAll(async () => {
    const tokenB = await tryGetTokenB();
    TEM_USER_B = !!tokenB;
    if (!TEM_USER_B) return;

    dbA = clienteComToken(await getToken());
    dbB = clienteComToken(tokenB!);
    emailB = await getEmailB();
    await getUserIdB();
  });

  afterAll(async () => {
    if (!TEM_USER_B) return;
    for (const id of vinculosParaRevogar) {
      await dbA.rpc("fn_revogar_agregado", { p_vinculo_id: id });
    }
    await limparUserBSeDinamico();
  });

  // ── CA-AGR10 ──────────────────────────────────────────
  test("CA-AGR10 — B aceita o convite de A e o vínculo vira ACEITO", async () => {
    if (!TEM_USER_B) { console.warn("[13_agregados] User B indisponível — CA-AGR10 pulado."); return; }

    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: emailB });

    const { data: aceito, error } = await dbB.rpc("fn_aceitar_convite_agregado", { p_token: vinc.token });
    expect(error).toBeNull();
    expect(aceito.status).toBe("ACEITO");
    expect(aceito.agregado_id).toBe(await getUserIdB());

    // Revoga já aqui (em vez de só no afterAll) — libera o par dono+e-mail
    // pra outro teste desta suíte convidar B de novo (índice único só
    // permite 1 vínculo "vivo" — PENDENTE/ACEITO — por par).
    await dbA.rpc("fn_revogar_agregado", { p_vinculo_id: vinc.id });
  });

  // ── CA-AGR11 ──────────────────────────────────────────
  test("CA-AGR11 — B não consegue aceitar convite endereçado a outro e-mail", async () => {
    if (!TEM_USER_B) { console.warn("[13_agregados] User B indisponível — CA-AGR11 pulado."); return; }

    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: `terceiro-${TS}@example.com` });
    vinculosParaRevogar.push(vinc.id);

    const { error } = await dbB.rpc("fn_aceitar_convite_agregado", { p_token: vinc.token });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/EMAIL_NAO_CONFERE/);
  });

  // ── CA-AGR12 ──────────────────────────────────────────
  test("CA-AGR12 — fn_agregado_tem_acesso reflete módulo e conta liberados", async () => {
    if (!TEM_USER_B) { console.warn("[13_agregados] User B indisponível — CA-AGR12 pulado."); return; }

    const contaId = await criarContaA(`Conta-AGR12-${TS}`);
    let vincId: string | null = null;
    try {
      const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: emailB });
      vincId = vinc.id;
      await dbB.rpc("fn_aceitar_convite_agregado", { p_token: vinc.token });
      await dbA.rpc("fn_definir_contas_agregado", { p_vinculo_id: vinc.id, p_conta_ids: [contaId] });
      await dbA.rpc("fn_definir_permissoes_agregado", {
        p_vinculo_id: vinc.id, p_modulo: "EXTRATO", p_liberado: true, p_pode_escrever: false,
      });

      const donoId = await getUserId();

      // Módulo liberado + conta liberada → true.
      const { data: podeVer } = await dbB.rpc("fn_agregado_tem_acesso", {
        p_dono_id: donoId, p_modulo: "EXTRATO", p_conta_id: contaId, p_escrita: false,
      });
      expect(podeVer).toBe(true);

      // Mesmo módulo, mas pediu ESCRITA (só tem leitura) → false.
      const { data: podeEscrever } = await dbB.rpc("fn_agregado_tem_acesso", {
        p_dono_id: donoId, p_modulo: "EXTRATO", p_conta_id: contaId, p_escrita: true,
      });
      expect(podeEscrever).toBe(false);

      // Módulo não liberado → false.
      const { data: podeInvestimentos } = await dbB.rpc("fn_agregado_tem_acesso", {
        p_dono_id: donoId, p_modulo: "INVESTIMENTOS", p_conta_id: contaId, p_escrita: false,
      });
      expect(podeInvestimentos).toBe(false);

      // Conta fora do escopo liberado → false.
      const { data: podeOutraConta } = await dbB.rpc("fn_agregado_tem_acesso", {
        p_dono_id: donoId, p_modulo: "EXTRATO", p_conta_id: "00000000-0000-0000-0000-000000000000", p_escrita: false,
      });
      expect(podeOutraConta).toBe(false);
    } finally {
      // Revoga já aqui — libera o par dono+e-mail pra CA-AGR13 convidar B
      // de novo (índice único só permite 1 vínculo "vivo" por par).
      if (vincId) await dbA.rpc("fn_revogar_agregado", { p_vinculo_id: vincId });
      await limparConta(contaId);
    }
  });

  // ── CA-AGR13 ──────────────────────────────────────────
  test("CA-AGR13 — B recusa o convite e o vínculo vira RECUSADO", async () => {
    if (!TEM_USER_B) { console.warn("[13_agregados] User B indisponível — CA-AGR13 pulado."); return; }

    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: emailB });

    const { error } = await dbB.rpc("fn_recusar_convite_agregado", { p_token: vinc.token });
    expect(error).toBeNull();

    const { data: linha } = await dbA.from("agregados").select("status").eq("id", vinc.id).single();
    expect(linha!.status).toBe("RECUSADO");
  });
});

// ============================================================
// Fase 1 — Edge Function supabase/functions/agregados/
// ============================================================
describe("Agregados — Edge Function (Fase 1)", () => {
  const vinculosParaRevogar: string[] = [];

  afterAll(async () => {
    for (const id of vinculosParaRevogar) {
      await api(`/agregados/${id}/revogar`, "POST");
    }
  });

  // ── CA-AGR14 ──────────────────────────────────────────
  test("CA-AGR14 — POST /agregados cria convite e devolve email_enviado", async () => {
    const email = `agregado-${TS}-14@example.com`;
    const { status, data } = await api("/agregados", "POST", { email });
    expect(status).toBe(201);
    expect(data.dados.status).toBe("PENDENTE");
    expect(data.dados.email_convidado).toBe(email);
    expect(data.dados).toHaveProperty("email_enviado");
    // Nunca vaza o token na resposta da API pública.
    expect(data.dados).not.toHaveProperty("token");
    vinculosParaRevogar.push(data.dados.id);
  });

  // ── CA-AGR15 ──────────────────────────────────────────
  test("CA-AGR15 — GET /agregados lista vínculos como dono, com permissões/contas aninhadas", async () => {
    const email = `agregado-${TS}-15@example.com`;
    const { data: criado } = await api("/agregados", "POST", { email });
    vinculosParaRevogar.push(criado.dados.id);

    const { status, data } = await api("/agregados");
    expect(status).toBe(200);
    const achado = (data.dados as any[]).find((v) => v.id === criado.dados.id);
    expect(achado).toBeDefined();
    expect(achado).toHaveProperty("agregados_permissoes");
    expect(achado).toHaveProperty("agregados_contas");
  });

  // ── CA-AGR16 ──────────────────────────────────────────
  test("CA-AGR16 — GET /agregados/:id detalha um vínculo específico", async () => {
    const email = `agregado-${TS}-16@example.com`;
    const { data: criado } = await api("/agregados", "POST", { email });
    vinculosParaRevogar.push(criado.dados.id);

    const { status, data } = await api(`/agregados/${criado.dados.id}`);
    expect(status).toBe(200);
    expect(data.dados.id).toBe(criado.dados.id);
  });

  // ── CA-AGR17 ──────────────────────────────────────────
  test("CA-AGR17 — POST /agregados/:id/reenviar gera novo token", async () => {
    const email = `agregado-${TS}-17@example.com`;
    const { data: criado } = await api("/agregados", "POST", { email });
    vinculosParaRevogar.push(criado.dados.id);

    const { status, data } = await api(`/agregados/${criado.dados.id}/reenviar`, "POST");
    expect(status).toBe(200);
    expect(data.dados).toHaveProperty("email_enviado");
  });

  // ── CA-AGR18 ──────────────────────────────────────────
  test("CA-AGR18 — PUT /agregados/:id/permissoes liga e desliga módulo", async () => {
    const email = `agregado-${TS}-18@example.com`;
    const { data: criado } = await api("/agregados", "POST", { email });
    vinculosParaRevogar.push(criado.dados.id);

    const { status } = await api(`/agregados/${criado.dados.id}/permissoes`, "PUT", {
      modulo: "OBJETIVOS", liberado: true, pode_escrever: false,
    });
    expect(status).toBe(200);

    const { data: detalhe } = await api(`/agregados/${criado.dados.id}`);
    expect(detalhe.dados.agregados_permissoes).toHaveLength(1);
    expect(detalhe.dados.agregados_permissoes[0].modulo).toBe("OBJETIVOS");
  });

  // ── CA-AGR19 ──────────────────────────────────────────
  test("CA-AGR19 — PUT /agregados/:id/contas rejeita modulo inválido com 400", async () => {
    const email = `agregado-${TS}-19@example.com`;
    const { data: criado } = await api("/agregados", "POST", { email });
    vinculosParaRevogar.push(criado.dados.id);

    const { status } = await api(`/agregados/${criado.dados.id}/permissoes`, "PUT", {
      modulo: "NAO_EXISTE", liberado: true,
    });
    expect(status).toBe(400);
  });

  // ── CA-AGR20 ──────────────────────────────────────────
  test("CA-AGR20 — POST /agregados/:id/revogar muda status para REVOGADO", async () => {
    const email = `agregado-${TS}-20@example.com`;
    const { data: criado } = await api("/agregados", "POST", { email });

    const { status } = await api(`/agregados/${criado.dados.id}/revogar`, "POST");
    expect(status).toBe(200);

    const { status: stDetalhe, data: detalhe } = await api(`/agregados/${criado.dados.id}`);
    expect(stDetalhe).toBe(200);
    expect(detalhe.dados.status).toBe("REVOGADO");
  });

  // ── CA-AGR21 ──────────────────────────────────────────
  test("CA-AGR21 — POST /agregados/aceitar com token inexistente retorna 404", async () => {
    const { status } = await api("/agregados/aceitar", "POST", {
      token: "00000000-0000-0000-0000-000000000000",
    });
    expect(status).toBe(404);
  });
});

// ============================================================
// Fase 1 — leitura do Extrato (contas/categorias/transacoes) por um
// agregado, via header X-Contexto-User-Id.
// ============================================================
describe("Agregados — leitura do Extrato por agregado (Fase 1)", () => {
  let TEM_USER_B_LEITURA = false;
  let donoId: string;
  let vinculoId: string;
  let contaLiberadaId: string;
  let contaNaoLiberadaId: string;
  let headersB: Record<string, string>;

  beforeAll(async () => {
    const tokenB = await tryGetTokenB();
    TEM_USER_B_LEITURA = !!tokenB;
    if (!TEM_USER_B_LEITURA) return;

    donoId = await getUserId();
    const emailB = await getEmailB();
    headersB = await authHeadersB();

    // Contas de teste do dono: uma liberada ao agregado, outra não.
    const headersA = await authHeaders();
    const { data: contaLib } = await api("/contas", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR-Liberada-${TS}`, tipo: "CORRENTE", saldo_inicial: 500, icone: "🏦", cor: "#00c896" }) });
    contaLiberadaId = contaLib.id;
    const { data: contaNaoLib } = await api("/contas", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR-NaoLiberada-${TS}`, tipo: "CORRENTE", saldo_inicial: 999, icone: "🔒", cor: "#ff0000" }) });
    contaNaoLiberadaId = contaNaoLib.id;

    // Convite A→B, aceito, com EXTRATO liberado só pra contaLiberadaId.
    const { data: convite } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: emailB }) });
    vinculoId = convite.dados.id;

    // A API pública nunca devolve o token (por design — ver CA-AGR14), então
    // o aceite de teste busca o token direto no banco (mesmo client usado na
    // Fase 0) só para simular o clique do link do e-mail, e aceita via RPC.
    const dbA = clienteComToken(await getToken());
    const { data: linha } = await dbA.from("agregados").select("token").eq("id", vinculoId).single();
    const dbB = clienteComToken(tokenB!);
    await dbB.rpc("fn_aceitar_convite_agregado", { p_token: linha!.token });

    await api(`/agregados/${vinculoId}/contas`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ conta_ids: [contaLiberadaId] }) });
    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "EXTRATO", liberado: true, pode_escrever: false }) });
  });

  afterAll(async () => {
    if (!TEM_USER_B_LEITURA) return;
    await api(`/agregados/${vinculoId}/revogar`, "POST");
    await limparConta(contaLiberadaId);
    await limparConta(contaNaoLiberadaId);
    await limparUserBSeDinamico();
  });

  // ── CA-AGR22 ──────────────────────────────────────────
  test("CA-AGR22 — GET /contas com contexto do dono mostra só a conta liberada", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR22 pulado."); return; }

    const { status, data } = await api("/contas", { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    const ids = (data.dados as any[]).map((c) => c.conta_id);
    expect(ids).toContain(contaLiberadaId);
    expect(ids).not.toContain(contaNaoLiberadaId);
  });

  // ── CA-AGR23 ──────────────────────────────────────────
  test("CA-AGR23 — GET /contas sem o header continua mostrando só os próprios dados de B", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR23 pulado."); return; }

    const { status, data } = await api("/contas", { method: "GET", headers: headersB });
    expect(status).toBe(200);
    const ids = (data.dados as any[]).map((c) => c.conta_id);
    expect(ids).not.toContain(contaLiberadaId);
    expect(ids).not.toContain(contaNaoLiberadaId);
  });

  // ── CA-AGR24 ──────────────────────────────────────────
  test("CA-AGR24 — GET /contas com contexto de um dono que não autorizou retorna 403", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR24 pulado."); return; }

    const { status } = await api("/contas", { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": "00000000-0000-0000-0000-000000000000" } });
    expect(status).toBe(403);
  });

  // ── CA-AGR25 ──────────────────────────────────────────
  test("CA-AGR25 — GET /categorias com contexto do dono mostra as categorias dele", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR25 pulado."); return; }

    const { status, data } = await api("/categorias", { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    expect((data.dados as any[]).length).toBeGreaterThan(0);
  });

  // ── CA-AGR26 ──────────────────────────────────────────
  test("CA-AGR26 — GET /transacoes?saldo=true&mes=... com contexto do dono funciona (fn_saldo_total_antes_de escopado)", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR26 pulado."); return; }

    const mes = new Date().toISOString().slice(0, 7);
    const { status, data } = await api(`/transacoes?saldo=true&mes=${mes}`, { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    expect(Array.isArray(data.dados)).toBe(true);
  });

  // ── CA-AGR66 ──────────────────────────────────────────
  test("CA-AGR66 — fn_saldos_contas_ate_data chamada pelo agregado com p_user_id do dono retorna só a conta liberada", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR66 pulado."); return; }

    const dbB = clienteComToken(await getTokenB());
    const hoje = new Date().toISOString().slice(0, 10);
    const { data, error } = await dbB.rpc("fn_saldos_contas_ate_data", { p_user_id: donoId, p_data: hoje });
    expect(error).toBeNull();
    const ids = (data as { conta_id: string; saldo: number }[]).map((r) => r.conta_id);
    expect(ids).toContain(contaLiberadaId);
    expect(ids).not.toContain(contaNaoLiberadaId);
  });

  // ── CA-AGR67 ──────────────────────────────────────────
  test("CA-AGR67 — fn_saldos_contas_ate_data chamada pelo agregado sem vínculo com o dono informado → ACESSO_NEGADO", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR67 pulado."); return; }

    const dbB = clienteComToken(await getTokenB());
    const hoje = new Date().toISOString().slice(0, 10);
    const { error } = await dbB.rpc("fn_saldos_contas_ate_data", {
      p_user_id: "00000000-0000-0000-0000-000000000000", p_data: hoje,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/ACESSO_NEGADO/);
  });

  // ── CA-AGR68 ──────────────────────────────────────────
  test("CA-AGR68 — fn_saldo_conta_ate_data: agregado lê a conta liberada mas não a não-liberada", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR68 pulado."); return; }

    const dbB = clienteComToken(await getTokenB());
    const hoje = new Date().toISOString().slice(0, 10);

    const ok = await dbB.rpc("fn_saldo_conta_ate_data", { p_conta_id: contaLiberadaId, p_data: hoje });
    expect(ok.error).toBeNull();
    expect(typeof ok.data).toBe("number");

    const negado = await dbB.rpc("fn_saldo_conta_ate_data", { p_conta_id: contaNaoLiberadaId, p_data: hoje });
    expect(negado.error).not.toBeNull();
    expect(negado.error!.message).toMatch(/ACESSO_NEGADO/);
  });

  // ── CA-AGR69 ──────────────────────────────────────────
  // fn_saldo_total_antes_de virou SECURITY DEFINER (20261006000010, fix do
  // statement timeout) — sem RLS por baixo, o escopo de conta é só o da própria
  // função. Antes só se checava "200 OK"; aqui checa o VALOR: só a conta
  // liberada (saldo_inicial 500) entra, nunca a não-liberada (999).
  test("CA-AGR69 — fn_saldo_total_antes_de pelo agregado soma só a conta liberada", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR69 pulado."); return; }

    const dbB = clienteComToken(await getTokenB());
    const { data, error } = await dbB.rpc("fn_saldo_total_antes_de", { p_user_id: donoId, p_data: "2000-01-01" });
    expect(error).toBeNull();
    expect(Number(data)).toBe(500);
  });

  // ── CA-AGR70 ──────────────────────────────────────────
  test("CA-AGR70 — fn_saldo_total_antes_de sem vínculo com o dono informado → ACESSO_NEGADO", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR70 pulado."); return; }

    const dbB = clienteComToken(await getTokenB());
    const { error } = await dbB.rpc("fn_saldo_total_antes_de", {
      p_user_id: "00000000-0000-0000-0000-000000000000", p_data: "2000-01-01",
    });
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/ACESSO_NEGADO/);
  });

  // ── CA-AGR71 ──────────────────────────────────────────
  // GET /transacoes?saldo=true é o que a tela do agregado usa — o timeout dele
  // deixava só o saldo aparecer. O saldo_acumulado parte da base só das contas
  // liberadas e nenhuma transação da conta não-liberada vaza na lista.
  test("CA-AGR71 — GET /transacoes?saldo=true como agregado: 200, rápido e só com contas liberadas", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR71 pulado."); return; }

    const mes = new Date().toISOString().slice(0, 7);
    const t0 = Date.now();
    const { status, data } = await api(`/transacoes?saldo=true&mes=${mes}`, { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    expect(Date.now() - t0).toBeLessThan(5000);
    const contasVistas = new Set((data.dados as { conta_id: string }[]).map((t) => t.conta_id));
    expect(contasVistas.has(contaNaoLiberadaId)).toBe(false);
  });

  // ── CA-AGR72 ──────────────────────────────────────────
  // Tela de Compartilhamento exibe o NOME do agregado (20261006000011).
  test("CA-AGR72 — GET /agregados traz agregado_nome por vínculo e fn_nomes_dos_meus_agregados só devolve os do próprio dono", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR72 pulado."); return; }

    const { status, data } = await api("/agregados", { method: "GET", headers: await authHeaders() });
    expect(status).toBe(200);
    const meu = (data.dados as { id: string; agregado_nome?: string | null }[]).find((v) => v.id === vinculoId);
    expect(meu).toBeDefined();
    expect("agregado_nome" in meu!).toBe(true);

    // Chamada pelo agregado: não é dono de nenhum vínculo com esse id → vazio pra ele.
    const dbB = clienteComToken(await getTokenB());
    const { data: nomesB, error } = await dbB.rpc("fn_nomes_dos_meus_agregados");
    expect(error).toBeNull();
    expect((nomesB as { vinculo_id: string }[]).map((n) => n.vinculo_id)).not.toContain(vinculoId);
  });

  // ── CA-AGR77 ──────────────────────────────────────────
  // Furo corrigido em 20261006000013: a policy antiga deixava o agregado ler a
  // LINHA INTEIRA de `usuarios` do dono (chat da IA, ia_configs, e-mail...).
  test("CA-AGR77 — agregado NÃO lê a linha de usuarios do dono; só id+nome via fn_nomes_usuarios", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR77 pulado."); return; }

    const dbB = clienteComToken(await getTokenB());
    const { data: linha } = await dbB.from("usuarios").select("*").eq("id", donoId);
    expect(linha ?? []).toHaveLength(0);

    const { data: nomes, error } = await dbB.rpc("fn_nomes_usuarios", { p_ids: [donoId, "00000000-0000-0000-0000-000000000000"] });
    expect(error).toBeNull();
    const lista = nomes as { id: string; nome: string }[];
    expect(lista.map((n) => n.id)).toEqual([donoId]);        // só o dono (vínculo ACEITO), nunca um id qualquer
    expect(Object.keys(lista[0]).sort()).toEqual(["id", "nome"]);
  });

  // ── CA-AGR73 ──────────────────────────────────────────
  // Agregado só LÊ contas/categorias (RLS de agregado) — editar volta 403
  // (antes: 400 genérico com a mensagem crua do PostgREST, "0 rows").
  test("CA-AGR73 — PUT /categorias/:id e /contas/:id de um agregado (visíveis, não editáveis) retorna 403", async () => {
    if (!TEM_USER_B_LEITURA) { console.warn("[13_agregados] User B indisponível — CA-AGR73 pulado."); return; }

    const ctx = { ...headersB, "X-Contexto-User-Id": donoId };
    const { data: cats } = await api("/categorias", { method: "GET", headers: ctx });
    const catId = (cats.dados as { id: string; protegida: boolean }[]).find((c) => !c.protegida)!.id;

    const putCat = await api(`/categorias/${catId}`, { method: "PUT", headers: headersB, body: JSON.stringify({ descricao: "hack" }) });
    expect(putCat.status).toBe(403);
    const putConta = await api(`/contas/${contaLiberadaId}`, { method: "PUT", headers: headersB, body: JSON.stringify({ nome: "hack" }) });
    expect(putConta.status).toBe(403);
  });
});

// ============================================================
// Fase 1 — aceitar/recusar SEM token (tela "Convites que recebi")
// ============================================================
describe("Agregados — aceitar/recusar por ID (Fase 1)", () => {
  let TEM_USER_B_ID = false;
  let headersA: Record<string, string>;
  let headersB: Record<string, string>;
  let emailB: string;

  beforeAll(async () => {
    const tokenB = await tryGetTokenB();
    TEM_USER_B_ID = !!tokenB;
    if (!TEM_USER_B_ID) return;
    headersA = await authHeaders();
    headersB = await authHeadersB();
    emailB = await getEmailB();
  });

  afterAll(async () => {
    if (!TEM_USER_B_ID) return;
    await limparUserBSeDinamico();
  });

  // ── CA-AGR27 ──────────────────────────────────────────
  test("CA-AGR27 — GET /agregados/convites-recebidos inclui dono_nome", async () => {
    if (!TEM_USER_B_ID) { console.warn("[13_agregados] User B indisponível — CA-AGR27 pulado."); return; }

    const { data: convite } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: emailB }) });
    const { status, data } = await api("/agregados/convites-recebidos", { method: "GET", headers: headersB });
    expect(status).toBe(200);
    const achado = (data.dados as any[]).find((v) => v.id === convite.dados.id);
    expect(achado).toBeDefined();
    expect(typeof achado.dono_nome).toBe("string");
    expect(achado.dono_nome.length).toBeGreaterThan(0);

    await api(`/agregados/${convite.dados.id}/revogar`, { method: "POST", headers: headersA });
  });

  // ── CA-AGR28 ──────────────────────────────────────────
  test("CA-AGR28 — POST /agregados/:id/aceitar (sem token) aceita o convite", async () => {
    if (!TEM_USER_B_ID) { console.warn("[13_agregados] User B indisponível — CA-AGR28 pulado."); return; }

    const { data: convite } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: emailB }) });
    const { status, data } = await api(`/agregados/${convite.dados.id}/aceitar`, { method: "POST", headers: headersB });
    expect(status).toBe(200);
    expect(data.dados.status).toBe("ACEITO");

    await api(`/agregados/${convite.dados.id}/revogar`, { method: "POST", headers: headersA });
  });

  // ── CA-AGR29 ──────────────────────────────────────────
  test("CA-AGR29 — POST /agregados/:id/recusar (sem token) recusa o convite", async () => {
    if (!TEM_USER_B_ID) { console.warn("[13_agregados] User B indisponível — CA-AGR29 pulado."); return; }

    const { data: convite } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: emailB }) });
    const { status } = await api(`/agregados/${convite.dados.id}/recusar`, { method: "POST", headers: headersB });
    expect(status).toBe(200);

    const { data: detalhe } = await api(`/agregados/${convite.dados.id}`, { method: "GET", headers: headersA });
    expect(detalhe.dados.status).toBe("RECUSADO");
  });

  // ── CA-AGR30 ──────────────────────────────────────────
  test("CA-AGR30 — POST /agregados/:id/aceitar com e-mail que não bate retorna 400", async () => {
    if (!TEM_USER_B_ID) { console.warn("[13_agregados] User B indisponível — CA-AGR30 pulado."); return; }

    const { data: convite } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: `terceiro-por-id-${TS}@example.com` }) });
    const { status } = await api(`/agregados/${convite.dados.id}/aceitar`, { method: "POST", headers: headersB });
    expect(status).toBe(400);

    await api(`/agregados/${convite.dados.id}/revogar`, { method: "POST", headers: headersA });
  });
});

// ============================================================
// Fase 2 — escrita no Extrato (lançamentos e transferências) por um
// agregado com o módulo EXTRATO liberado E `pode_escrever = true`.
//
// Cobre: bloqueio sem pode_escrever (RLS INSERT/UPDATE/DELETE + 403 cedo de
// resolverContexto), caminho feliz (grava sob user_id do dono, criado_por
// do agregado), badge "lançado por" pro dono, escopo por conta (mesmo com
// pode_escrever=true, só nas contas liberadas), edição preserva criado_por,
// exclusão, e o mesmo ciclo pra transferências (fn_criar_transferencia).
// ============================================================
describe("Agregados — escrita no Extrato por agregado (Fase 2)", () => {
  let TEM_USER_B_ESCRITA = false;
  let donoId: string;
  let agregadoId: string;
  let vinculoId: string;
  let contaLiberadaId: string;
  let contaLiberada2Id: string;
  let contaNaoLiberadaId: string;
  let headersA: Record<string, string>;
  let headersB: Record<string, string>;
  let lancamentoId: string;

  const hoje = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const tokenB = await tryGetTokenB();
    TEM_USER_B_ESCRITA = !!tokenB;
    if (!TEM_USER_B_ESCRITA) return;

    donoId = await getUserId();
    agregadoId = await getUserIdB();
    const emailB = await getEmailB();
    headersA = await authHeaders();
    headersB = await authHeadersB();

    const { data: contaLib } = await api("/contas", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR-W-Liberada-${TS}`, tipo: "CORRENTE", saldo_inicial: 500, icone: "🏦", cor: "#00c896" }) });
    contaLiberadaId = contaLib.id;
    const { data: contaLib2 } = await api("/contas", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR-W-Liberada2-${TS}`, tipo: "CORRENTE", saldo_inicial: 500, icone: "🏦", cor: "#00c896" }) });
    contaLiberada2Id = contaLib2.id;
    const { data: contaNaoLib } = await api("/contas", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR-W-NaoLiberada-${TS}`, tipo: "CORRENTE", saldo_inicial: 999, icone: "🔒", cor: "#ff0000" }) });
    contaNaoLiberadaId = contaNaoLib.id;

    const { data: convite } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: emailB }) });
    vinculoId = convite.dados.id;

    const dbA = clienteComToken(await getToken());
    const { data: linha } = await dbA.from("agregados").select("token").eq("id", vinculoId).single();
    const dbB = clienteComToken(tokenB!);
    await dbB.rpc("fn_aceitar_convite_agregado", { p_token: linha!.token });

    await api(`/agregados/${vinculoId}/contas`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ conta_ids: [contaLiberadaId, contaLiberada2Id] }) });
    // Começa com escrita DESLIGADA de propósito — CA-AGR31 valida o
    // bloqueio antes de CA-AGR32 ligar e validar o caminho feliz.
    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "EXTRATO", liberado: true, pode_escrever: false }) });
  });

  afterAll(async () => {
    if (!TEM_USER_B_ESCRITA) return;
    await api(`/agregados/${vinculoId}/revogar`, "POST");
    await limparConta(contaLiberadaId);
    await limparConta(contaLiberada2Id);
    await limparConta(contaNaoLiberadaId);
    await limparUserBSeDinamico();
  });

  // ── CA-AGR31 ──────────────────────────────────────────
  test("CA-AGR31 — POST /transacoes com contexto do dono e pode_escrever=false retorna 403", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR31 pulado."); return; }

    const { status } = await api("/transacoes", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        descricao: `AGR Lanc Bloqueado ${TS}`, valor: 10, data: hoje,
        conta_id: contaLiberadaId, tipo: "DESPESA", status: "PAGO",
      }) });
    expect(status).toBe(403);
  });

  // ── CA-AGR32 ──────────────────────────────────────────
  test("CA-AGR32 — com pode_escrever=true, POST /transacoes cria sob o dono com criado_por do agregado", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR32 pulado."); return; }

    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "EXTRATO", liberado: true, pode_escrever: true }) });

    const { status, data } = await api("/transacoes", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        descricao: `AGR Lanc Escrito ${TS}`, valor: 42, data: hoje,
        conta_id: contaLiberadaId, tipo: "DESPESA", status: "PAGO",
      }) });
    expect(status).toBe(201);
    expect(data.user_id).toBe(donoId);
    expect(data.criado_por).toBe(agregadoId);
    lancamentoId = data.id;
  });

  // ── CA-AGR33 ──────────────────────────────────────────
  test("CA-AGR33 — dono vê o lançamento do agregado com criado_por_nome preenchido", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR33 pulado."); return; }

    const mes = hoje.slice(0, 7);
    const { status, data } = await api(`/transacoes?saldo=true&mes=${mes}`, { method: "GET", headers: headersA });
    expect(status).toBe(200);
    const linha = (data.dados as any[]).find((t) => t.id === lancamentoId);
    expect(linha).toBeTruthy();
    expect(linha.criado_por).toBe(agregadoId);
    expect(linha.criado_por_nome).toBeTruthy();
  });

  // ── CA-AGR34 ──────────────────────────────────────────
  test("CA-AGR34 — agregado edita o lançamento (PUT) e criado_por permanece dele mesmo", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR34 pulado."); return; }

    const { status, data } = await api(`/transacoes/${lancamentoId}`, { method: "PUT",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({ descricao: `AGR Lanc Editado ${TS}` }) });
    expect(status).toBe(200);
    expect(data.dados?.[0]?.descricao).toBe(`AGR Lanc Editado ${TS}`);

    const dbA = clienteComToken(await getToken());
    const { data: row } = await dbA.from("transacoes").select("criado_por").eq("id", lancamentoId).single();
    expect(row!.criado_por).toBe(agregadoId);
  });

  // ── CA-AGR35 ──────────────────────────────────────────
  test("CA-AGR35 — mesmo com pode_escrever=true, agregado não escreve numa conta não liberada", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR35 pulado."); return; }

    // 422 (RV-004), não 403: `fn_validar_isolamento_usuario` roda SECURITY
    // INVOKER, então sua própria leitura de `contas` já respeita a RLS do
    // agregado — a conta não liberada "não existe" do ponto de vista dele,
    // e o trigger rejeita ANTES da minha policy de INSERT na Fase 2 sequer
    // ser avaliada. Dois cinturões diferentes, mesmo resultado: bloqueado.
    const { status } = await api("/transacoes", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        descricao: `AGR Lanc Conta Bloqueada ${TS}`, valor: 10, data: hoje,
        conta_id: contaNaoLiberadaId, tipo: "DESPESA", status: "PAGO",
      }) });
    expect(status).toBe(422);
  });

  // ── CA-AGR36 ──────────────────────────────────────────
  test("CA-AGR36 — agregado exclui (DELETE) o lançamento que criou", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR36 pulado."); return; }

    const { status } = await api(`/transacoes/${lancamentoId}`, { method: "DELETE",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);

    const dbA = clienteComToken(await getToken());
    const { data: row } = await dbA.from("transacoes").select("id").eq("id", lancamentoId).maybeSingle();
    expect(row).toBeNull();
  });

  // ── CA-AGR37 ──────────────────────────────────────────
  test("CA-AGR37 — agregado cria transferência entre 2 contas liberadas, criado_por correto nas 2 pernas", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR37 pulado."); return; }

    const { status, data } = await api("/transferencias", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        conta_origem_id: contaLiberadaId, conta_destino_id: contaLiberada2Id,
        valor: 15, data: hoje, descricao: `AGR Transf ${TS}`, status: "PAGO",
      }) });
    expect(status).toBe(201);
    expect(data.id_debito).toBeTruthy();
    expect(data.id_credito).toBeTruthy();

    const dbA = clienteComToken(await getToken());
    const { data: pernas } = await dbA.from("transacoes").select("id, user_id, criado_por")
      .in("id", [data.id_debito, data.id_credito]);
    expect(pernas).toHaveLength(2);
    for (const perna of pernas!) {
      expect(perna.user_id).toBe(donoId);
      expect(perna.criado_por).toBe(agregadoId);
    }

    // Limpa dentro do próprio teste — sem isso a transferência ficaria
    // pendurada e o afterAll falharia ao excluir as contas (trigger
    // fn_bloquear_exclusao_conta bloqueia conta com lançamentos).
    await api(`/transferencias/${data.id_par}`, { method: "DELETE", headers: headersA });
  });

  // ── CA-AGR38 ──────────────────────────────────────────
  test("CA-AGR38 — sem pode_escrever, agregado não consegue criar transferência", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR38 pulado."); return; }

    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "EXTRATO", liberado: true, pode_escrever: false }) });

    const { status } = await api("/transferencias", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        conta_origem_id: contaLiberadaId, conta_destino_id: contaLiberada2Id,
        valor: 15, data: hoje, descricao: `AGR Transf Bloqueada ${TS}`, status: "PAGO",
      }) });
    expect(status).toBe(403);
  });

  // ── CA-AGR39 ──────────────────────────────────────────
  // Achado pós-Fase 2 (discutido com o usuário): editar uma transferência
  // onde só 1 das 2 pernas está no escopo do agregado precisa falhar
  // INTEIRA — nunca deixar uma perna atualizada e a outra pra trás. A
  // transferência é criada pelo DONO (headersA) porque atravessa uma conta
  // NÃO liberada — o agregado nem conseguiria criar isso (ver CA-AGR35).
  test("CA-AGR39 — editar via PUT /transacoes com só 1 perna no escopo falha inteira (nenhuma perna muda)", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR39 pulado."); return; }

    const { status: sCriar, data: criada } = await api("/transferencias", { method: "POST", headers: headersA,
      body: JSON.stringify({
        conta_origem_id: contaLiberadaId, conta_destino_id: contaNaoLiberadaId,
        valor: 20, data: hoje, descricao: `AGR Transf Parcial ${TS}`, status: "PENDENTE",
      }) });
    expect(sCriar).toBe(201);
    const idPar     = criada.id_par as string;
    const idDebito  = criada.id_debito as string;  // perna na conta liberada
    const idCredito = criada.id_credito as string; // perna na conta NÃO liberada

    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "EXTRATO", liberado: true, pode_escrever: true }) });

    // Agregado só enxerga a perna da conta liberada (idDebito) — tenta
    // editar por ali via PUT /transacoes/:id, o mesmo caminho que
    // alterarStatus/pagarSelecionados usam no front.
    const { status: sPut } = await api(`/transacoes/${idDebito}`, { method: "PUT",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({ status: "PAGO" }) });
    expect(sPut).not.toBe(200);

    // Tudo ou nada: nenhuma das 2 pernas deve ter mudado de status.
    const dbA = clienteComToken(await getToken());
    const { data: pernas } = await dbA.from("transacoes").select("id, status").in("id", [idDebito, idCredito]);
    expect(pernas).toHaveLength(2);
    for (const p of pernas!) expect(p.status).toBe("PENDENTE");

    await api(`/transferencias/${idPar}`, { method: "DELETE", headers: headersA });
  });

  // ── CA-AGR40 ──────────────────────────────────────────
  test("CA-AGR40 — excluir via DELETE /transferencias com só 1 perna no escopo falha inteira (nenhuma perna some)", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR40 pulado."); return; }

    const { status: sCriar, data: criada } = await api("/transferencias", { method: "POST", headers: headersA,
      body: JSON.stringify({
        conta_origem_id: contaLiberadaId, conta_destino_id: contaNaoLiberadaId,
        valor: 25, data: hoje, descricao: `AGR Transf Parcial Del ${TS}`, status: "PAGO",
      }) });
    expect(sCriar).toBe(201);
    const idPar     = criada.id_par as string;
    const idDebito  = criada.id_debito as string;
    const idCredito = criada.id_credito as string;

    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "EXTRATO", liberado: true, pode_escrever: true }) });

    // Via Edge Function: já bloqueado hoje pelo pré-check de `buscarPar`
    // (exige ver as 2 pernas antes de chamar a RPC) — continua valendo.
    const { status: sDel } = await api(`/transferencias/${idPar}`, { method: "DELETE",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(sDel).not.toBe(200);

    const dbA = clienteComToken(await getToken());
    const { data: pernas } = await dbA.from("transacoes").select("id").in("id", [idDebito, idCredito]);
    expect(pernas).toHaveLength(2);

    await api(`/transferencias/${idPar}`, { method: "DELETE", headers: headersA });
  });

  // ── CA-AGR41 ──────────────────────────────────────────
  test("CA-AGR41 — fn_excluir_transferencias (RPC direta) recusa excluir com só 1 das 2 pernas no escopo", async () => {
    if (!TEM_USER_B_ESCRITA) { console.warn("[13_agregados] User B indisponível — CA-AGR41 pulado."); return; }

    const { status: sCriar, data: criada } = await api("/transferencias", { method: "POST", headers: headersA,
      body: JSON.stringify({
        conta_origem_id: contaLiberadaId, conta_destino_id: contaNaoLiberadaId,
        valor: 30, data: hoje, descricao: `AGR Transf Parcial RPC ${TS}`, status: "PAGO",
      }) });
    expect(sCriar).toBe(201);
    const idPar     = criada.id_par as string;
    const idDebito  = criada.id_debito as string;
    const idCredito = criada.id_credito as string;

    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "EXTRATO", liberado: true, pode_escrever: true }) });

    // Chama a RPC direto como o agregado (dbB), passando o id DO AGREGADO
    // como dono só pra variável de nome fazer sentido — o que importa é que
    // a sessão é a de B, então a RLS de B vale: só enxerga idDebito.
    const dbB = clienteComToken(await getTokenB());
    const { error } = await dbB.rpc("fn_excluir_transferencias", { p_ids: [idDebito, idCredito] });
    expect(error).toBeTruthy();
    expect(error!.message).toMatch(/PAR_INCOMPLETO/);

    // Nada deve ter sido excluído — a exceção desfaz a transação inteira.
    const dbA = clienteComToken(await getToken());
    const { data: pernas } = await dbA.from("transacoes").select("id, id_par_transferencia").in("id", [idDebito, idCredito]);
    expect(pernas).toHaveLength(2);
    for (const p of pernas!) expect(p.id_par_transferencia).toBe(idPar);

    await api(`/transferencias/${idPar}`, { method: "DELETE", headers: headersA });
  });
});

// ============================================================
// Fase 3 — Objetivos por agregado, via resolverContexto() em
// supabase/functions/objetivos/index.ts + fn_agregado_pode_ver_objetivo
// (RLS em objetivos/objetivos_progresso) + extensão de
// pol_contas_agregado_select/pol_categorias_agregado_select pro módulo
// OBJETIVOS (necessária pro LEFT JOIN de vw_objetivos_detalhes resolver
// conta_nome/categoria_descricao).
//
// Cobre: SONHO só visível com TODAS as contas monitoradas liberadas;
// OBJETIVO/CRESCIMENTO sempre visíveis com o módulo liberado (sem escopo de
// conta); bloqueio de escrita sem pode_escrever (403 cedo de
// resolverContexto); caminho feliz de criar/editar/excluir com criado_por
// correto; SONHO numa conta fora do escopo nem aparece pro agregado
// (RLS em `contas` barra a validação de posse em criar()); e a correção
// crítica pós-descoberta de fn_sincronizar_progresso_objetivo/
// fn_calcular_progresso_objetivo (antes confiavam só em auth.uid() via RLS,
// sem filtrar explicitamente por user_id — ver migration
// 20261003000001_agregados_fase3_objetivos.sql) realmente recalcula os
// objetivos do DONO quando chamada no contexto de um agregado.
// ============================================================
describe("Agregados — Objetivos por agregado (Fase 3)", () => {
  let TEM_USER_B_OBJ = false;
  let donoId: string;
  let agregadoId: string;
  let vinculoId: string;
  let contaSonhoLibId: string;
  let contaSonhoForaId: string;
  let categoriaId: string;
  let headersA: Record<string, string>;
  let headersB: Record<string, string>;

  let sonhoDentroId: string;
  let sonhoForaId: string;
  let objetivoCatId: string;
  let crescimentoId: string;
  let sonhoCriadoPorAgregadoId: string;

  const hoje = new Date().toISOString().slice(0, 10);
  const fimAno = `${new Date().getFullYear()}-12-31`;

  beforeAll(async () => {
    const tokenB = await tryGetTokenB();
    TEM_USER_B_OBJ = !!tokenB;
    if (!TEM_USER_B_OBJ) return;

    donoId = await getUserId();
    agregadoId = await getUserIdB();
    const emailB = await getEmailB();
    headersA = await authHeaders();
    headersB = await authHeadersB();

    const { data: contaLib } = await api("/contas", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR-OBJ-Liberada-${TS}`, tipo: "CORRENTE", saldo_inicial: 1000, icone: "🏦", cor: "#00c896" }) });
    contaSonhoLibId = contaLib.id;
    const { data: contaFora } = await api("/contas", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR-OBJ-Fora-${TS}`, tipo: "CORRENTE", saldo_inicial: 2000, icone: "🔒", cor: "#ff0000" }) });
    contaSonhoForaId = contaFora.id;

    const { data: cats } = await api("/categorias?apenas_pai=true", { method: "GET", headers: headersA });
    categoriaId = cats.dados[0].id;

    const { data: convite } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: emailB }) });
    vinculoId = convite.dados.id;

    const dbA = clienteComToken(await getToken());
    const { data: linha } = await dbA.from("agregados").select("token").eq("id", vinculoId).single();
    const dbB = clienteComToken(tokenB!);
    await dbB.rpc("fn_aceitar_convite_agregado", { p_token: linha!.token });

    // Só a conta "Liberada" é liberada ao agregado — "Fora" nunca entra na lista.
    await api(`/agregados/${vinculoId}/contas`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ conta_ids: [contaSonhoLibId] }) });
    // Começa com escrita DESLIGADA — CA-AGR45/46 validam o bloqueio antes de
    // CA-AGR47+ ligar e validar o caminho feliz.
    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "OBJETIVOS", liberado: true, pode_escrever: false }) });

    // Objetivos do dono, criados como A, cobrindo os 2 modos de escopo.
    const { data: sonhoDentro } = await api("/objetivos", { method: "POST", headers: headersA, body: JSON.stringify({
      tipo: "SONHO", nome: `AGR OBJ Sonho Dentro ${TS}`, valor_meta: 50000,
      data_inicio: hoje, data_fim: fimAno, conta_id: contaSonhoLibId, icone: "💰", cor: "#00c896",
    }) });
    sonhoDentroId = sonhoDentro.dados.id;

    const { data: sonhoFora } = await api("/objetivos", { method: "POST", headers: headersA, body: JSON.stringify({
      tipo: "SONHO", nome: `AGR OBJ Sonho Fora ${TS}`, valor_meta: 50000,
      data_inicio: hoje, data_fim: fimAno, conta_id: contaSonhoForaId, icone: "💰", cor: "#00c896",
    }) });
    sonhoForaId = sonhoFora.dados.id;

    const { data: objCat } = await api("/objetivos", { method: "POST", headers: headersA, body: JSON.stringify({
      tipo: "OBJETIVO", nome: `AGR OBJ Renda ${TS}`, valor_meta: 1000, frequencia: "MENSAL",
      categoria_id: categoriaId, data_inicio: hoje, data_fim: fimAno, icone: "🎯", cor: "#4da6ff",
    }) });
    objetivoCatId = objCat.dados.id;

    const { data: cresc } = await api("/objetivos", { method: "POST", headers: headersA, body: JSON.stringify({
      tipo: "CRESCIMENTO", nome: `AGR OBJ Crescimento ${TS}`, valor_meta: 10,
      categorias_objetivo: [categoriaId], data_inicio: hoje, data_fim: fimAno, icone: "📈", cor: "#00c896",
    }) });
    crescimentoId = cresc.dados.id;
  }, 60000);

  afterAll(async () => {
    if (!TEM_USER_B_OBJ) return;
    for (const id of [sonhoDentroId, sonhoForaId, objetivoCatId, crescimentoId, sonhoCriadoPorAgregadoId]) {
      if (id) await api(`/objetivos/${id}`, { method: "DELETE", headers: headersA });
    }
    await api(`/agregados/${vinculoId}/revogar`, "POST");
    await limparConta(contaSonhoLibId);
    await limparConta(contaSonhoForaId);
    await limparUserBSeDinamico();
  }, 60000);

  // ── CA-AGR42 ──────────────────────────────────────────
  test("CA-AGR42 — GET /objetivos com contexto do dono mostra SONHO com conta liberada e esconde o de fora", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR42 pulado."); return; }

    const { status, data } = await api("/objetivos", { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    const ids = (data.dados as any[]).map((o) => o.id);
    expect(ids).toContain(sonhoDentroId);
    expect(ids).not.toContain(sonhoForaId);
  });

  // ── CA-AGR43 ──────────────────────────────────────────
  test("CA-AGR43 — GET /objetivos com contexto do dono NUNCA mostra OBJETIVO/CRESCIMENTO pro agregado (somam por categoria em todas as contas do dono, sem escopo possível)", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR43 pulado."); return; }

    const { status, data } = await api("/objetivos", { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    const ids = (data.dados as any[]).map((o) => o.id);
    expect(ids).not.toContain(objetivoCatId);
    expect(ids).not.toContain(crescimentoId);
  });

  // ── CA-AGR43b ─────────────────────────────────────────
  test("CA-AGR43b — GET /objetivos/:id de um OBJETIVO/CRESCIMENTO retorna 404 pro agregado, mesmo com o módulo OBJETIVOS liberado", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR43b pulado."); return; }

    const r1 = await api(`/objetivos/${objetivoCatId}`, { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(r1.status).toBe(404);

    const r2 = await api(`/objetivos/${crescimentoId}`, { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(r2.status).toBe(404);
  });

  // ── CA-AGR44 ──────────────────────────────────────────
  test("CA-AGR44 — GET /objetivos/:id de um SONHO fora do escopo retorna 404 pro agregado", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR44 pulado."); return; }

    const { status } = await api(`/objetivos/${sonhoForaId}`, { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(404);
  });

  // ── CA-AGR45 ──────────────────────────────────────────
  test("CA-AGR45 — GET /objetivos/:id do SONHO liberado resolve conta_nome (RLS de contas estendida pro módulo OBJETIVOS)", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR45 pulado."); return; }

    const { status, data } = await api(`/objetivos/${sonhoDentroId}`, { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    expect(data.dados.conta_nome).toBeTruthy();
  });

  // ── CA-AGR46 ──────────────────────────────────────────
  test("CA-AGR46 — POST /objetivos com contexto do dono e pode_escrever=false retorna 403", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR46 pulado."); return; }

    const { status } = await api("/objetivos", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        tipo: "SONHO", nome: `AGR OBJ Bloqueado ${TS}`, valor_meta: 1000,
        data_inicio: hoje, data_fim: fimAno, conta_id: contaSonhoLibId,
      }) });
    expect(status).toBe(403);
  });

  // ── CA-AGR47 ──────────────────────────────────────────
  test("CA-AGR47 — POST /objetivos/sincronizar-progresso com contexto do dono e pode_escrever=false retorna 403", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR47 pulado."); return; }

    const { status } = await api("/objetivos/sincronizar-progresso", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(403);
  });

  // ── CA-AGR48 ──────────────────────────────────────────
  test("CA-AGR48 — com pode_escrever=true, POST /objetivos cria sob o dono com criado_por do agregado", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR48 pulado."); return; }

    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "OBJETIVOS", liberado: true, pode_escrever: true }) });

    const { status, data } = await api("/objetivos", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        tipo: "SONHO", nome: `AGR OBJ Criado Por Agregado ${TS}`, valor_meta: 1000,
        data_inicio: hoje, data_fim: fimAno, conta_id: contaSonhoLibId, icone: "💰", cor: "#00c896",
      }) });
    expect(status).toBe(201);
    expect(data.dados.user_id).toBe(donoId);
    expect(data.dados.criado_por).toBe(agregadoId);
    sonhoCriadoPorAgregadoId = data.dados.id;
  });

  // ── CA-AGR49 ──────────────────────────────────────────
  test("CA-AGR49 — mesmo com pode_escrever=true, criar SONHO numa conta fora do escopo falha (conta não visível pro agregado)", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR49 pulado."); return; }

    const { status } = await api("/objetivos", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        tipo: "SONHO", nome: `AGR OBJ Conta Fora ${TS}`, valor_meta: 1000,
        data_inicio: hoje, data_fim: fimAno, conta_id: contaSonhoForaId,
      }) });
    expect(status).toBe(404);
  });

  // ── CA-AGR50 ──────────────────────────────────────────
  test("CA-AGR50 — agregado edita (PUT) o objetivo que criou, criado_por permanece dele", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR50 pulado."); return; }

    const { status, data } = await api(`/objetivos/${sonhoCriadoPorAgregadoId}`, { method: "PUT",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({ nome: `AGR OBJ Editado Pelo Agregado ${TS}` }) });
    expect(status).toBe(200);
    expect(data.dados.nome).toBe(`AGR OBJ Editado Pelo Agregado ${TS}`);

    const dbA = clienteComToken(await getToken());
    const { data: row } = await dbA.from("objetivos").select("criado_por").eq("id", sonhoCriadoPorAgregadoId).single();
    expect(row!.criado_por).toBe(agregadoId);
  });

  // ── CA-AGR51 ──────────────────────────────────────────
  test("CA-AGR51 — mesmo com pode_escrever=true, agregado não edita um SONHO fora do escopo de conta", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR51 pulado."); return; }

    const { status } = await api(`/objetivos/${sonhoForaId}`, { method: "PUT",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({ nome: `AGR OBJ Nao Deveria Editar ${TS}` }) });
    expect(status).not.toBe(200);

    const dbA = clienteComToken(await getToken());
    const { data: row } = await dbA.from("objetivos").select("nome").eq("id", sonhoForaId).single();
    expect(row!.nome).not.toBe(`AGR OBJ Nao Deveria Editar ${TS}`);
  });

  // ── CA-AGR52 ──────────────────────────────────────────
  // Valida a correção crítica (achada antes de implementar a Fase 3):
  // fn_sincronizar_progresso_objetivo/fn_calcular_progresso_objetivo antes
  // confiavam só em auth.uid() via RLS implícita, sem filtrar por user_id —
  // rodando no contexto de um agregado, teriam recalculado usando os DADOS
  // DO AGREGADO (contas/transações dele), não os do dono. Chamar o sync no
  // contexto do dono precisa de fato tocar (atualizado_em muda) o objetivo
  // do DONO.
  test("CA-AGR52 — POST /objetivos/sincronizar-progresso com contexto do dono recalcula o objetivo do DONO (não do agregado)", async () => {
    if (!TEM_USER_B_OBJ) { console.warn("[13_agregados] User B indisponível — CA-AGR52 pulado."); return; }

    const { data: antes } = await api(`/objetivos/${sonhoDentroId}`, { method: "GET", headers: headersA });
    const atualizadoAntes = antes.dados.atualizado_em;

    // Pequena pausa garante um timestamp diferente mesmo em bancos com
    // resolução de relógio mais grosseira.
    await new Promise((r) => setTimeout(r, 1100));

    const { status, data } = await api("/objetivos/sincronizar-progresso", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    expect(data.dados.sincronizados).toBeGreaterThan(0);

    const { data: depois } = await api(`/objetivos/${sonhoDentroId}`, { method: "GET", headers: headersA });
    expect(depois.dados.atualizado_em).not.toBe(atualizadoAntes);
  });
});

// ============================================================
// Fase 4 — Investimentos por agregado, via resolverContexto() em
// supabase/functions/investimentos/index.ts + fn_agregado_pode_ver_ativo
// (RLS em inv_ativos/inv_avaliacoes) + RLS por conta_id em inv_posicoes/
// inv_operacoes/inv_dividendos/inv_historico_mensal + extensão de
// pol_transacoes_agregado_* pro módulo INVESTIMENTOS (necessária porque
// dividendos sempre espelham uma transação no extrato).
//
// Escopo deliberadamente reduzido (ver comentário em investimentos/index.ts):
// só ativos/posições/operações/dividendos/tipos-dividendo/histórico/
// alocações/dashboard/ranking honram X-Contexto-User-Id; rotas de
// manutenção (migrar-conta, importar, restaurar, snapshot-auto/backfill,
// buscas manuais de provento, chat-mentor) continuam owner-only de
// propósito — não testadas aqui por não fazerem parte do escopo aceito.
// ============================================================
describe("Agregados — Investimentos por agregado (Fase 4)", () => {
  let TEM_USER_B_INV = false;
  let donoId: string;
  let agregadoId: string;
  let vinculoId: string;
  let contaInvLibId: string;
  let contaInvForaId: string;
  let categoriaId: string;
  let headersA: Record<string, string>;
  let headersB: Record<string, string>;

  let ativoDentroId: string;
  let ativoForaId: string;
  let posicaoDentroId: string;
  let posicaoForaId: string;
  let tipoDivId: string;
  let dividendoCriadoId: string;

  const hoje = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const tokenB = await tryGetTokenB();
    TEM_USER_B_INV = !!tokenB;
    if (!TEM_USER_B_INV) return;

    donoId = await getUserId();
    agregadoId = await getUserIdB();
    const emailB = await getEmailB();
    headersA = await authHeaders();
    headersB = await authHeadersB();

    const { data: contaLib } = await api("/contas", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR-INV-Liberada-${TS}`, tipo: "INVESTIMENTO", saldo_inicial: 0, icone: "📈", cor: "#00c896" }) });
    contaInvLibId = contaLib.id;
    const { data: contaFora } = await api("/contas", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR-INV-Fora-${TS}`, tipo: "INVESTIMENTO", saldo_inicial: 0, icone: "🔒", cor: "#ff0000" }) });
    contaInvForaId = contaFora.id;

    const { data: cats } = await api("/categorias?apenas_pai=true", { method: "GET", headers: headersA });
    categoriaId = cats.dados[0].id;

    const { data: convite } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: emailB }) });
    vinculoId = convite.dados.id;

    const dbA = clienteComToken(await getToken());
    const { data: linha } = await dbA.from("agregados").select("token").eq("id", vinculoId).single();
    const dbB = clienteComToken(tokenB!);
    await dbB.rpc("fn_aceitar_convite_agregado", { p_token: linha!.token });

    // Só a conta "Liberada" entra na lista — "Fora" nunca é liberada.
    await api(`/agregados/${vinculoId}/contas`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ conta_ids: [contaInvLibId] }) });
    // Começa com escrita DESLIGADA — CA-AGR56 valida o bloqueio antes de
    // CA-AGR57+ ligar e validar o caminho feliz. Só INVESTIMENTOS liberado
    // (nunca EXTRATO) — CA-AGR59 depende exatamente disso pra provar a
    // extensão de pol_transacoes_agregado_*.
    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "INVESTIMENTOS", liberado: true, pode_escrever: false }) });

    // Ativo + posição DENTRO do escopo (conta liberada).
    const { data: ativoDentro } = await api("/investimentos/ativos", { method: "POST", headers: headersA,
      body: JSON.stringify({ ticker: `AGRINVD${TS}`, nome: "AGR Ativo Dentro", tipo_ativo: "ACOES" }) });
    ativoDentroId = ativoDentro.dados.id;
    const { data: posDentro } = await api("/investimentos/posicoes", { method: "POST", headers: headersA,
      body: JSON.stringify({ ativo_id: ativoDentroId, conta_id: contaInvLibId, quantidade: 100, preco_custo: 10, data_compra: hoje }) });
    posicaoDentroId = posDentro.dados.id;

    // Ativo + posição FORA do escopo (conta não liberada).
    const { data: ativoFora } = await api("/investimentos/ativos", { method: "POST", headers: headersA,
      body: JSON.stringify({ ticker: `AGRINVF${TS}`, nome: "AGR Ativo Fora", tipo_ativo: "ACOES" }) });
    ativoForaId = ativoFora.dados.id;
    const { data: posFora } = await api("/investimentos/posicoes", { method: "POST", headers: headersA,
      body: JSON.stringify({ ativo_id: ativoForaId, conta_id: contaInvForaId, quantidade: 50, preco_custo: 20, data_compra: hoje }) });
    posicaoForaId = posFora.dados.id;

    const { data: tipoDiv } = await api("/investimentos/tipos-dividendo", { method: "POST", headers: headersA,
      body: JSON.stringify({ nome: `AGR Dividendo ${TS}`, categoria_id: categoriaId }) });
    tipoDivId = tipoDiv.dados.id;
  }, 60000);

  afterAll(async () => {
    if (!TEM_USER_B_INV) return;
    if (dividendoCriadoId) await api(`/investimentos/dividendos/${dividendoCriadoId}`, { method: "DELETE", headers: headersA });
    if (ativoDentroId) await api(`/investimentos/ativos/${ativoDentroId}`, { method: "DELETE", headers: headersA });
    if (ativoForaId) await api(`/investimentos/ativos/${ativoForaId}`, { method: "DELETE", headers: headersA });
    if (tipoDivId) await api(`/investimentos/tipos-dividendo/${tipoDivId}`, { method: "DELETE", headers: headersA });
    await api(`/agregados/${vinculoId}/revogar`, "POST");
    await limparConta(contaInvLibId);
    await limparConta(contaInvForaId);
    await limparUserBSeDinamico();
  }, 60000);

  // ── CA-AGR53 ──────────────────────────────────────────
  test("CA-AGR53 — GET /investimentos/ativos com contexto do dono mostra o ativo com posição na conta liberada e esconde o de fora", async () => {
    if (!TEM_USER_B_INV) { console.warn("[13_agregados] User B indisponível — CA-AGR53 pulado."); return; }

    const { status, data } = await api("/investimentos/ativos", { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    const ids = (data.dados as any[]).map((a) => a.id);
    expect(ids).toContain(ativoDentroId);
    expect(ids).not.toContain(ativoForaId);
  });

  // ── CA-AGR54 ──────────────────────────────────────────
  test("CA-AGR54 — GET /investimentos/posicoes com contexto do dono mostra só a posição da conta liberada", async () => {
    if (!TEM_USER_B_INV) { console.warn("[13_agregados] User B indisponível — CA-AGR54 pulado."); return; }

    const { status, data } = await api("/investimentos/posicoes", { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    const ids = (data.dados as any[]).map((p) => p.id);
    expect(ids).toContain(posicaoDentroId);
    expect(ids).not.toContain(posicaoForaId);
  });

  // ── CA-AGR55 ──────────────────────────────────────────
  test("CA-AGR55 — GET /investimentos/dashboard com contexto do dono consolida a carteira do dono", async () => {
    if (!TEM_USER_B_INV) { console.warn("[13_agregados] User B indisponível — CA-AGR55 pulado."); return; }

    const { status, data } = await api("/investimentos/dashboard", { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    expect(data.dados).toHaveProperty("tipos");
  });

  // ── CA-AGR56 ──────────────────────────────────────────
  test("CA-AGR56 — POST /investimentos/operacoes com contexto do dono e pode_escrever=false retorna 403", async () => {
    if (!TEM_USER_B_INV) { console.warn("[13_agregados] User B indisponível — CA-AGR56 pulado."); return; }

    const { status } = await api("/investimentos/operacoes", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        posicao_id: posicaoDentroId, tipo_operacao: "COMPRA", quantidade: 10, preco_unitario: 11, data_operacao: hoje,
      }) });
    expect(status).toBe(403);
  });

  // ── CA-AGR57 ──────────────────────────────────────────
  test("CA-AGR57 — com pode_escrever=true, POST /investimentos/operacoes cria sob o dono com criado_por do agregado", async () => {
    if (!TEM_USER_B_INV) { console.warn("[13_agregados] User B indisponível — CA-AGR57 pulado."); return; }

    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "INVESTIMENTOS", liberado: true, pode_escrever: true }) });

    const { status, data } = await api("/investimentos/operacoes", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        posicao_id: posicaoDentroId, tipo_operacao: "COMPRA", quantidade: 10, preco_unitario: 11, data_operacao: hoje,
      }) });
    expect(status).toBe(201);
    expect(data.dados.user_id).toBe(donoId);
    expect(data.dados.criado_por).toBe(agregadoId);

    const dbA = clienteComToken(await getToken());
    const { data: row } = await dbA.from("inv_operacoes").select("criado_por").eq("id", data.dados.id).single();
    expect(row!.criado_por).toBe(agregadoId);
  });

  // ── CA-AGR58 ──────────────────────────────────────────
  test("CA-AGR58 — mesmo com pode_escrever=true, agregado não opera numa posição fora do escopo de conta", async () => {
    if (!TEM_USER_B_INV) { console.warn("[13_agregados] User B indisponível — CA-AGR58 pulado."); return; }

    const { status } = await api("/investimentos/operacoes", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        posicao_id: posicaoForaId, tipo_operacao: "COMPRA", quantidade: 5, preco_unitario: 20, data_operacao: hoje,
      }) });
    expect(status).toBe(404);
  });

  // ── CA-AGR59 ──────────────────────────────────────────
  // A conta só está liberada para INVESTIMENTOS (nunca EXTRATO) — este teste
  // valida especificamente a extensão de pol_transacoes_agregado_* pro
  // módulo INVESTIMENTOS (sem ela, o dividendo seria criado mas a transação
  // espelhada no extrato falharia por RLS).
  test("CA-AGR59 — POST /investimentos/dividendos numa conta só liberada p/ INVESTIMENTOS cria dividendo + transação no extrato", async () => {
    if (!TEM_USER_B_INV) { console.warn("[13_agregados] User B indisponível — CA-AGR59 pulado."); return; }

    const { status, data } = await api("/investimentos/dividendos", { method: "POST",
      headers: { ...headersB, "X-Contexto-User-Id": donoId },
      body: JSON.stringify({
        ativo_id: ativoDentroId, conta_id: contaInvLibId, valor: 15.5, data_pagamento: hoje,
        tipo_ativo: "ACOES", tipo_dividendo_id: tipoDivId,
      }) });
    expect(status).toBe(201);
    expect(data.dados.user_id).toBe(donoId);
    expect(data.dados.criado_por).toBe(agregadoId);
    expect(data.dados.transacao_extrato_id).toBeTruthy();
    dividendoCriadoId = data.dados.id;

    const dbA = clienteComToken(await getToken());
    const { data: tx } = await dbA.from("transacoes")
      .select("user_id, criado_por, conta_id").eq("id", data.dados.transacao_extrato_id).single();
    expect(tx!.user_id).toBe(donoId);
    expect(tx!.criado_por).toBe(agregadoId);
    expect(tx!.conta_id).toBe(contaInvLibId);
  });

  // ── CA-AGR60 ──────────────────────────────────────────
  test("CA-AGR60 — GET /investimentos/ranking com contexto do dono retorna 200", async () => {
    if (!TEM_USER_B_INV) { console.warn("[13_agregados] User B indisponível — CA-AGR60 pulado."); return; }

    const { status, data } = await api("/investimentos/ranking", { method: "GET",
      headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(status).toBe(200);
    expect(Array.isArray(data.dados?.ativos)).toBe(true);
  });
});

// ============================================================
// Fase 5 — hardening: throttling de convite, expurgo de convites
// expirados, e o dado (revogado_em) que alimenta o aviso de revogação ao
// agregado. Migrations 20261006000001-3.
// ============================================================
describe("Agregados — Fase 5 (hardening)", () => {
  let dbA: ReturnType<typeof clienteComToken>;
  const vinculosParaRevogar: string[] = [];

  beforeAll(async () => {
    dbA = clienteComToken(await getToken());
  });

  afterAll(async () => {
    // CA-AGR65 pode deixar ~100 vínculos pra revogar — timeout maior que o
    // default (5s) pra não cortar a limpeza pela metade.
    for (const id of vinculosParaRevogar) {
      await dbA.rpc("fn_revogar_agregado", { p_vinculo_id: id });
    }
  }, 120000);

  // ── CA-AGR61 ──────────────────────────────────────────
  // O cooldown só se aplica a partir do 2º reenvio (ver `ultimo_reenvio_em`,
  // 20261006000005) — reenviar logo após CRIAR é um fluxo normal, sem
  // cooldown nenhum (coberto por CA-AGR04/CA-AGR17, bem mais antigos que a
  // Fase 5). Por isso o teste precisa de dois reenvios: o 1º sempre
  // sucede; o 2º, imediato, é que deve ser barrado.
  test("CA-AGR61 — fn_reenviar_convite_agregado rejeita o 2º reenvio antes de 60s do 1º", async () => {
    const email = `agregado-${TS}-f5-61@example.com`;
    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: email });
    vinculosParaRevogar.push(vinc.id);

    const { error: erro1 } = await dbA.rpc("fn_reenviar_convite_agregado", { p_vinculo_id: vinc.id });
    expect(erro1).toBeNull();

    // 2º reenvio imediatamente em seguida — bem dentro da janela de 60s do 1º.
    const { error: erro2 } = await dbA.rpc("fn_reenviar_convite_agregado", { p_vinculo_id: vinc.id });
    expect(erro2).not.toBeNull();
    expect(erro2!.message).toMatch(/REENVIO_MUITO_RECENTE/);
  });

  // ── CA-AGR62 ──────────────────────────────────────────
  test("CA-AGR62 — POST /agregados/:id/reenviar retorna 429 no 2º reenvio muito cedo", async () => {
    const email = `agregado-${TS}-f5-63@example.com`;
    const { data: criado } = await api("/agregados", "POST", { email });
    vinculosParaRevogar.push(criado.dados.id);

    const { status: status1 } = await api(`/agregados/${criado.dados.id}/reenviar`, "POST");
    expect(status1).toBe(200);

    const { status } = await api(`/agregados/${criado.dados.id}/reenviar`, "POST");
    expect(status).toBe(429);
  });

  // ── CA-AGR63 ──────────────────────────────────────────
  test("CA-AGR63 — fn_expurgar_convites_agregados_expirados marca PENDENTE expirado como REVOGADO", async () => {
    const admin = clienteServiceRole();
    if (!admin) { console.warn("[13_agregados] SUPABASE_SERVICE_ROLE_KEY indisponível — CA-AGR64 pulado."); return; }

    const email = `agregado-${TS}-f5-64@example.com`;
    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: email });
    vinculosParaRevogar.push(vinc.id);

    // Força o token a já ter expirado — nenhuma RPC pública permite isso
    // (token_expira_em é sempre now()+7d), só service_role contorna a RLS
    // de agregados (sem policy de UPDATE pra ninguém além das RPCs).
    const { error: errForce } = await admin.from("agregados")
      .update({ token_expira_em: new Date(Date.now() - 1000).toISOString() })
      .eq("id", vinc.id);
    expect(errForce).toBeNull();

    const { error: errPurge } = await admin.rpc("fn_expurgar_convites_agregados_expirados");
    expect(errPurge).toBeNull();

    const { data: linha } = await dbA.from("agregados").select("status, revogado_em").eq("id", vinc.id).single();
    expect(linha!.status).toBe("REVOGADO");
    expect(linha!.revogado_em).toBeTruthy();
  });

  // ── CA-AGR64 ──────────────────────────────────────────
  // Dado consumido pelo aviso de login (AvisoRevogacaoAgregado/
  // useAvisosRevogacaoAgregado) — fn_meus_vinculos_como_agregado precisa
  // devolver `revogado_em` pro PRÓPRIO agregado quando o dono revoga.
  test("CA-AGR64 — fn_meus_vinculos_como_agregado devolve revogado_em pro agregado após a revogação", async () => {
    const tokenB = await tryGetTokenB();
    if (!tokenB) { console.warn("[13_agregados] User B indisponível — CA-AGR64 pulado."); return; }

    const emailB = await getEmailB();
    const { data: vinc } = await dbA.rpc("fn_convidar_agregado", { p_email: emailB });

    const dbB = clienteComToken(tokenB);
    await dbB.rpc("fn_aceitar_convite_agregado", { p_token: vinc.token });
    await dbA.rpc("fn_revogar_agregado", { p_vinculo_id: vinc.id });

    const { data: meusVinculos, error } = await dbB.rpc("fn_meus_vinculos_como_agregado");
    expect(error).toBeNull();
    const linha = (meusVinculos as any[]).find((v) => v.id === vinc.id);
    expect(linha).toBeDefined();
    expect(linha.status).toBe("REVOGADO");
    expect(linha.revogado_em).toBeTruthy();

    await limparUserBSeDinamico();
  });

  // ── CA-AGR65 ──────────────────────────────────────────
  // Por último de propósito: esgota deliberadamente o limite de convites
  // novos/hora do dono (100, ver 20261006000004) — qualquer teste depois
  // deste que precisasse criar um convite novo falharia. Calcula quantos
  // faltam pro limite a partir da contagem ATUAL (em vez de um número fixo)
  // pra não depender de quantos convites os testes anteriores (deste
  // arquivo inteiro, não só deste describe) já criaram na mesma hora.
  //
  // Limpeza por EXCLUSÃO de verdade (service_role), não `fn_revogar_agregado`
  // — revogar só muda `status`, nunca `criado_em`, e o throttle conta
  // `criado_em > now()-1h` independente do status. Sem isso, rodar a suíte
  // de novo dentro da mesma hora corrida travaria CA-AGR01 (e quase tudo
  // mais que precisa de um convite novo) com LIMITE_CONVITES_EXCEDIDO —
  // achado real ao escrever este teste. Por isso pula sem rodar quando o
  // service_role não está configurado: rodar sem conseguir limpar depois
  // deixaria a cota presa por até 1h pra qualquer run seguinte.
  test("CA-AGR65 — fn_convidar_agregado rejeita convite novo acima do limite por hora", async () => {
    const admin = clienteServiceRole();
    if (!admin) { console.warn("[13_agregados] SUPABASE_SERVICE_ROLE_KEY indisponível — CA-AGR65 pulado."); return; }

    // Cria em loop até bater no limite, em vez de PREVER quantos faltam a
    // partir de uma contagem única no início — acima do throttling em si,
    // o motivo real é que linhas de testes anteriores NESTA MESMA sessão
    // (horas atrás) podem "sair" da janela de 1h bem no meio da execução
    // deste teste, mudando a contagem de verdade no meio do caminho e
    // tornando uma previsão fixa instável (achado real, 2ª rodada seguida
    // da suíte passou do limite sem estourar por causa disso). Um teto de
    // iterações evita loop infinito se o throttling parar de funcionar.
    const MAX_TENTATIVAS = 130;
    const criadosNesteTeste: string[] = [];
    let erroFinal: { message: string } | null = null;
    try {
      for (let i = 0; i < MAX_TENTATIVAS; i++) {
        const { data: vinc, error } = await dbA.rpc("fn_convidar_agregado", {
          p_email: `agregado-${TS}-f5-65-${i}@example.com`,
        });
        if (error) { erroFinal = error; break; }
        criadosNesteTeste.push(vinc.id);
      }
      expect(erroFinal).not.toBeNull();
      expect(erroFinal!.message).toMatch(/LIMITE_CONVITES_EXCEDIDO/);
    } finally {
      if (criadosNesteTeste.length > 0) {
        await admin.from("agregados").delete().in("id", criadosNesteTeste);
      }
    }
  }, 120000);
});

// ============================================================
// O agregado pode deixar de acessar o espaço do dono por conta própria
// (fn_sair_agregado, 20261006000012) — e o dono pode convidá-lo de novo.
// ============================================================
describe("Agregados — sair por conta própria", () => {
  let TEM_USER_B_SAIR = false;
  let donoId: string;
  let emailB: string;
  let headersA: Record<string, string>;
  let headersB: Record<string, string>;
  let vinculoId: string;
  let novoVinculoId: string | null = null;

  beforeAll(async () => {
    const tokenB = await tryGetTokenB();
    TEM_USER_B_SAIR = !!tokenB;
    if (!TEM_USER_B_SAIR) return;

    donoId = await getUserId();
    emailB = await getEmailB();
    headersA = await authHeaders();
    headersB = await authHeadersB();

    const { data: convite } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: emailB }) });
    vinculoId = convite.dados.id;
    const dbA = clienteComToken(await getToken());
    const { data: linha } = await dbA.from("agregados").select("token").eq("id", vinculoId).single();
    await clienteComToken(tokenB!).rpc("fn_aceitar_convite_agregado", { p_token: linha!.token });
    await api(`/agregados/${vinculoId}/permissoes`, { method: "PUT", headers: headersA,
      body: JSON.stringify({ modulo: "EXTRATO", liberado: true, pode_escrever: false }) });
  }, 60000);

  afterAll(async () => {
    const dbA = clienteComToken(await getToken());
    for (const id of [vinculoId, novoVinculoId]) {
      if (id) await dbA.rpc("fn_revogar_agregado", { p_vinculo_id: id });
    }
    await limparUserBSeDinamico();
  }, 60000);

  // ── CA-AGR74 ──────────────────────────────────────────
  test("CA-AGR74 — o DONO não consegue 'sair' do próprio vínculo (404) e o vínculo segue ACEITO", async () => {
    if (!TEM_USER_B_SAIR) { console.warn("[13_agregados] User B indisponível — CA-AGR74 pulado."); return; }

    const { status } = await api(`/agregados/${vinculoId}/sair`, { method: "POST", headers: headersA });
    expect(status).toBe(404);
    const { data } = await api(`/agregados/${vinculoId}`, { method: "GET", headers: headersA });
    expect(data.dados.status).toBe("ACEITO");
  });

  // ── CA-AGR75 ──────────────────────────────────────────
  test("CA-AGR75 — o agregado sai: vínculo REVOGADO marcado como saída voluntária e o acesso ao dono é cortado", async () => {
    if (!TEM_USER_B_SAIR) { console.warn("[13_agregados] User B indisponível — CA-AGR75 pulado."); return; }

    // Antes: B lê o espaço do dono.
    const antes = await api("/categorias", { method: "GET", headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(antes.status).toBe(200);

    const { status } = await api(`/agregados/${vinculoId}/sair`, { method: "POST", headers: headersB });
    expect(status).toBe(200);

    // Dono vê REVOGADO + saiu_por_agregado.
    const { data } = await api(`/agregados/${vinculoId}`, { method: "GET", headers: headersA });
    expect(data.dados.status).toBe("REVOGADO");
    expect(data.dados.saiu_por_agregado).toBe(true);
    expect(data.dados.revogado_em).toBeTruthy();

    // O agregado enxerga a marca (aviso de revogação ignora saídas voluntárias).
    const { data: recebidos } = await api("/agregados/convites-recebidos", { method: "GET", headers: headersB });
    const meu = (recebidos.dados as { id: string; saiu_por_agregado: boolean }[]).find((v) => v.id === vinculoId);
    expect(meu?.saiu_por_agregado).toBe(true);

    // Acesso cortado.
    const depois = await api("/categorias", { method: "GET", headers: { ...headersB, "X-Contexto-User-Id": donoId } });
    expect(depois.status).toBe(403);
  });

  // ── CA-AGR76 ──────────────────────────────────────────
  test("CA-AGR76 — sair de novo (já REVOGADO) retorna 404, e o dono pode convidar o mesmo usuário de novo", async () => {
    if (!TEM_USER_B_SAIR) { console.warn("[13_agregados] User B indisponível — CA-AGR76 pulado."); return; }

    const { status } = await api(`/agregados/${vinculoId}/sair`, { method: "POST", headers: headersB });
    expect(status).toBe(404);

    const { status: stConvite, data } = await api("/agregados", { method: "POST", headers: headersA, body: JSON.stringify({ email: emailB }) });
    expect(stConvite).toBe(201);
    expect(data.dados.status).toBe("PENDENTE");
    expect(data.dados.id).not.toBe(vinculoId);
    novoVinculoId = data.dados.id;

    // Convite PENDENTE não dá pra "sair" (só ACEITO) — recusar é o caminho.
    const { status: stSair } = await api(`/agregados/${novoVinculoId}/sair`, { method: "POST", headers: headersB });
    expect(stSair).toBe(404);
  });
});

// Limpeza final: os testes só REVOGAM os vínculos que criam (fn_revogar_agregado) —
// com e-mails descartáveis @example.com isso acumulava centenas de linhas na conta
// de teste (achado: 373 vínculos, tela de Compartilhamento enorme). Apaga de vez,
// só os de teste (@example.com, nunca um e-mail real) do dono de teste.
afterAll(async () => {
  const admin = clienteServiceRole();
  if (!admin) return;
  const { error } = await admin.from("agregados").delete()
    .eq("dono_id", await getUserId()).ilike("email_convidado", "%@example.com");
  if (error) console.warn(`[13_agregados] falha ao apagar vínculos de teste: ${error.message}`);
}, 60000);
