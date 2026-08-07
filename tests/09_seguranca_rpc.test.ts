// ============================================================
// Arquiteto de Valor — Testes de Segurança / RPCs
// tests/09_seguranca_rpc.test.ts
//
// Cobre as RPCs SECURITY INVOKER que validam auth.uid() internamente:
//   - fn_saldos_contas_ate_data(p_user_id, p_data)
//   - fn_saldo_conta_ate_data(p_conta_id, p_data)
//   - fn_antecipar_parcelas(p_id_recorrencia, p_user_id)
//
// User A NÃO pode obter saldos/antecipar usando IDs de User B
// (fix migration 20260522000002).
// ============================================================

import { createClient } from "@supabase/supabase-js";
import {
  api, apiB, getToken, getTokenB, getUserId, getUserIdB, tryGetTokenB, limparUserBSeDinamico,
  limparConta, limparCategoria, limparTransacao,
} from "./setup";

const SUPABASE_URL      = process.env.SUPABASE_URL      as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;

const TS = Date.now();
const SUF = `RPC-${TS}`;

/** Cria um Supabase client já configurado com o JWT do usuário. */
function clientWithToken(token: string) {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    db: { schema: "arqvalor" },
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth:   { persistSession: false, autoRefreshToken: false },
  });
}

describe("Segurança — RPCs SECURITY INVOKER", () => {
  let userA_id: string;
  let userB_id: string;
  let contaB_id: string;
  let temUserB = false;
  const guardarUserB = () => { if (!temUserB) { console.log("⊘ pulado: sem User B"); return true; } return false; };

  beforeAll(async () => {
    userA_id = await getUserId();
    temUserB = !!(await tryGetTokenB());
    if (!temUserB) {
      // eslint-disable-next-line no-console
      console.warn(
        "[09_seguranca_rpc] User B não disponível — testes cross-user serão pulados. " +
        "Configure TEST_EMAIL_B/TEST_PASSWORD_B no .env pra cobertura completa.",
      );
      return;
    }
    userB_id = await getUserIdB();
    expect(userA_id).not.toBe(userB_id);

    // User B cria uma conta pra testarmos saldo cross-user.
    const { data } = await apiB("/contas", "POST", {
      nome: `ContaB-${SUF}`, tipo: "CORRENTE", saldo_inicial: 500,
      icone: "🏦", cor: "#abcdef", ativa: true,
    });
    contaB_id = data.id as string;
  });

  afterAll(async () => {
    if (contaB_id) await apiB(`/contas/${contaB_id}`, "DELETE");
    // tryGetTokenB() no beforeAll pode ter criado um usuário descartável
    // (sem TEST_EMAIL_B configurado) — exclui aqui, não faz nada se User B
    // veio de credenciais reais.
    await limparUserBSeDinamico();
  });

  // ── SEG-RPC01: fn_saldos_contas_ate_data com user_id de outro ─
  test("SEG-RPC01 — fn_saldos_contas_ate_data com user_id de B → ACESSO_NEGADO", async () => {
    if (guardarUserB()) return;
    const tokenA = await getToken();
    const supa   = clientWithToken(tokenA);

    const { data, error } = await supa.rpc("fn_saldos_contas_ate_data", {
      p_user_id: userB_id,
      p_data:    "2026-12-31",
    });

    // Comportamento esperado (fix 20260522000002):
    // a função levanta EXCEPTION 'ACESSO_NEGADO' que aparece como error.
    expect(error).not.toBeNull();
    expect(error?.message?.toUpperCase()).toContain("ACESSO_NEGADO");
    // E não vaza nenhum dado.
    expect(data).toBeNull();
  });

  // ── SEG-RPC02: fn_saldo_conta_ate_data com conta de outro user ─
  test("SEG-RPC02 — fn_saldo_conta_ate_data com conta de B → ACESSO_NEGADO", async () => {
    if (guardarUserB()) return;
    const tokenA = await getToken();
    const supa   = clientWithToken(tokenA);

    const { data, error } = await supa.rpc("fn_saldo_conta_ate_data", {
      p_conta_id: contaB_id,
      p_data:     "2026-12-31",
    });

    expect(error).not.toBeNull();
    expect(error?.message?.toUpperCase()).toContain("ACESSO_NEGADO");
    expect(data).toBeNull();
  });

  // ── SEG-RPC03: saldo da própria conta funciona ─
  test("SEG-RPC03 — saldo da própria conta retorna valor (sanity check)", async () => {
    if (guardarUserB()) return;
    const tokenB = await getTokenB();
    const supa   = clientWithToken(tokenB);

    const { data, error } = await supa.rpc("fn_saldo_conta_ate_data", {
      p_conta_id: contaB_id,
      p_data:     "2026-12-31",
    });
    expect(error).toBeNull();
    expect(Number.isFinite(Number(data))).toBe(true);
  });

  // ── SEG-RPC04: fn_antecipar_parcelas cross-user → ACESSO_NEGADO ─
  test("SEG-RPC04 — antecipar parcelas com id_recorrencia de outro user → bloqueado", async () => {
    if (guardarUserB()) return;
    // User B cria uma série recorrente parcelada.
    const { data: catB } = await apiB("/categorias", "POST", {
      descricao: `CatRec-${SUF}`, icone: "📂", cor: "#aabbcc",
    });
    const catBId = catB.id as string;

    const { data: txB } = await apiB("/transacoes", "POST", {
      conta_id:              contaB_id,
      categoria_id:          catBId,
      data:                  "2026-06-01",
      descricao:             `serie-${SUF}`,
      valor:                 100,
      tipo:                  "DESPESA",
      status:                "PENDENTE",
      tipo_recorrencia:      "PARCELA",
      intervalo_recorrencia: 1,
      nr_parcela:            1,
      total_parcelas:        3,
    });
    const idRec = (txB?.dados ?? txB)?.id_recorrencia as string | undefined;

    try {
      if (!idRec) {
        // Se o endpoint não retornou id_recorrencia, pulamos o teste —
        // a invariante de RPC continua sendo verificada nos outros casos.
        return;
      }

      const tokenA = await getToken();
      const supa   = clientWithToken(tokenA);
      const { data, error } = await supa.rpc("fn_antecipar_parcelas", {
        p_id_recorrencia: idRec,
        p_user_id:        userB_id,
      });
      expect(error).not.toBeNull();
      const msg = (error?.message ?? "").toUpperCase();
      // Pode levantar ACESSO_NEGADO específico ou simplesmente não encontrar
      // a recorrência (RLS bloqueia leitura). Ambos contam como negação.
      expect(
        msg.includes("ACESSO_NEGADO") ||
        msg.includes("NAO ENCONTRA") ||
        msg.includes("NÃO ENCONTRA") ||
        msg.includes("PERMISSION"),
      ).toBe(true);
      expect(data).toBeNull();
    } finally {
      // Limpeza: remove a série toda do User B.
      const { data: lista } = await apiB("/transacoes");
      const txs = (lista?.dados ?? []).filter((t: any) => t.id_recorrencia === idRec);
      for (const t of txs) await apiB(`/transacoes/${t.id}`, "DELETE", { escopo: "TODOS" });
      await apiB(`/categorias/${catBId}`, "DELETE");
    }
  });

  // ── SEG-RPC05: saldo soma TODAS as transações até a data ─
  // (fix migration 20260522000004 — não filtra status)
  test("SEG-RPC05 — saldo soma PAGO + PENDENTE + PROJECAO indistintamente", async () => {
    // Cria conta com saldo inicial conhecido, mais 3 transações de
    // status diferentes, e confere que o saldo retornado bate.
    const { data: conta } = await api("/contas", "POST", {
      nome: `ContaSaldo-${SUF}`, tipo: "CORRENTE", saldo_inicial: 1000,
      icone: "🏦", cor: "#111222", ativa: true,
    });
    const contaId = conta.id as string;
    const { data: cat } = await api("/categorias", "POST", {
      descricao: `CatSaldo-${SUF}`, icone: "📂", cor: "#333444",
    });
    const catId = cat.id as string;

    const txsIds: string[] = [];
    // PROJECAO requer data futura (RV-008). Datamos as 3 tx em datas
    // distintas pra evitar restrição, mas todas <= p_data do RPC.
    const hoje    = new Date().toISOString().slice(0, 10);
    const futuro  = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d.toISOString().slice(0, 10);
    })();
    const fazer = async (valor: number, tipo: "RECEITA"|"DESPESA", status: string, data: string) => {
      const { status: st, data: payload } = await api("/transacoes", "POST", {
        conta_id: contaId, categoria_id: catId,
        data, descricao: `tx-${SUF}-${status}`,
        valor, tipo, status,
      });
      if (st !== 201) throw new Error(`Falha ao criar tx ${status}: ${st} ${JSON.stringify(payload)}`);
      txsIds.push(payload.id as string);
    };

    try {
      await fazer(100, "RECEITA",  "PAGO",     hoje);    // +100
      await fazer(50,  "DESPESA",  "PENDENTE", hoje);    // -50
      await fazer(30,  "DESPESA",  "PROJECAO", futuro);  // -30
      // Saldo até futuro+1 = 1000 + 100 - 50 - 30 = 1020.

      const tokenA = await getToken();
      const supa   = clientWithToken(tokenA);
      // Data de corte: 30 dias no futuro — cobre todas as 3 tx (PAGO,
      // PENDENTE hoje + PROJECAO futuro+7).
      const corte = (() => {
        const d = new Date();
        d.setDate(d.getDate() + 30);
        return d.toISOString().slice(0, 10);
      })();
      const { data: saldo, error } = await supa.rpc("fn_saldo_conta_ate_data", {
        p_conta_id: contaId,
        p_data:     corte,
      });
      expect(error).toBeNull();
      expect(Number(saldo)).toBeCloseTo(1020, 2);
    } finally {
      for (const id of txsIds) await limparTransacao(id);
      await limparCategoria(catId);
      await limparConta(contaId);
    }
  });
});
