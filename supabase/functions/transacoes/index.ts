// ============================================================
// Arquiteto de Valor — Edge Function: transacoes
// Endpoints: GET / POST / PUT / DELETE / antecipar
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Helpers ──────────────────────────────────────────────────

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function erro(mensagem: string, status = 400) {
  return json({ erro: mensagem }, status);
}

function supabaseCliente(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      global: {
        // Repassa o JWT do usuário — ativa o RLS automaticamente
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    }
  );
}

// ── Roteador principal ────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const partes = url.pathname.replace(/^\/functions\/v1\/transacoes\/?/, "").split("/").filter(Boolean);
  const id = partes[0] ?? null;
  const acao = partes[1] ?? null;
  const metodo = req.method;

  const db = supabaseCliente(req);

  try {
    // GET /transacoes — listar com filtros
    if (metodo === "GET" && !id) {
      return await listar(db, url.searchParams);
    }

    // GET /transacoes/:id — buscar por ID
    if (metodo === "GET" && id) {
      return await buscarPorId(db, id);
    }

    // POST /transacoes — criar lançamento
    if (metodo === "POST" && !id) {
      const body = await req.json();
      return await criar(db, body);
    }

    // POST /transacoes/:id/antecipar — antecipar parcelas
    if (metodo === "POST" && id && acao === "antecipar") {
      return await antecipar(db, id);
    }

    // PUT /transacoes/:id — editar lançamento
    if (metodo === "PUT" && id) {
      const body = await req.json();
      const escopo = url.searchParams.get("escopo") ?? "SOMENTE_ESTE";
      return await editar(db, id, body, escopo);
    }

    // DELETE /transacoes/:id — excluir lançamento
    if (metodo === "DELETE" && id) {
      const escopo = url.searchParams.get("escopo") ?? "SOMENTE_ESTE";
      return await excluir(db, id, escopo);
    }

    return erro("Rota não encontrada", 404);
  } catch (e) {
    console.error(e);
    return erro("Erro interno do servidor", 500);
  }
});

// ── GET /transacoes ───────────────────────────────────────────
// Filtros: mes (YYYY-MM), conta_id, categoria_id, status, saldo, page, per_page

async function listar(db: ReturnType<typeof createClient>, params: URLSearchParams) {
  const mes       = params.get("mes");
  const contaId   = params.get("conta_id");
  const catId     = params.get("categoria_id");
  const status    = params.get("status");
  const comSaldo  = params.get("saldo") === "true";
  const page      = parseInt(params.get("page") ?? "1");
  const perPage   = Math.min(parseInt(params.get("per_page") ?? "50"), 200);
  const offset    = (page - 1) * perPage;

  // Usa a view com saldo acumulado se solicitado, tabela simples caso contrário
  const fonte = comSaldo ? "vw_transacoes_com_saldo" : "transacoes";

  let query = db.schema("arqvalor").from(fonte).select("*").order("data", { ascending: true }).order("criado_em", { ascending: true }).range(offset, offset + perPage - 1);

  // Filtro por mês usando as colunas geradas ano_tx e mes_tx
  if (mes) {
    const [ano, mesNum] = mes.split("-").map(Number);
    query = query.eq("ano_tx", ano).eq("mes_tx", mesNum);
  }

  if (contaId)  query = query.eq("conta_id", contaId);
  if (catId)    query = query.eq("categoria_id", catId);
  if (status)   query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return erro(error.message);

  return json({ dados: data, pagina: page, por_pagina: perPage });
}

// ── GET /transacoes/:id ───────────────────────────────────────

async function buscarPorId(db: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await db.schema("arqvalor").from("vw_transacoes_com_saldo").select("*").eq("id", id).single();
  if (error) return erro(error.message, 404);
  return json(data);
}

// ── POST /transacoes ──────────────────────────────────────────

async function criar(db: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  // Validações básicas (RV-001 a RV-007)
  if (!body.descricao || String(body.descricao).length < 2) {
    return erro("RV-001: descricao deve ter entre 2 e 200 caracteres");
  }
  if (!body.valor || Number(body.valor) <= 0) {
    return erro("RV-002: valor deve ser maior que zero");
  }
  if (!body.data) {
    return erro("RV-003: data é obrigatória");
  }
  if (!body.conta_id) {
    return erro("RV-004: conta_id é obrigatório");
  }
  if (!body.tipo || !["RECEITA", "DESPESA"].includes(String(body.tipo))) {
    return erro("RV-006: tipo deve ser RECEITA ou DESPESA");
  }
  if (!body.status || !["PAGO", "PENDENTE", "PROJECAO"].includes(String(body.status))) {
    return erro("RV-007: status deve ser PAGO, PENDENTE ou PROJECAO");
  }

  // valor_projetado nunca vem do usuário
  const { valor_projetado, ...dadosLimpos } = body;

  const { data, error } = await db.schema("arqvalor").from("transacoes").insert(dadosLimpos).select().single();
  if (error) return erro(error.message);

  return json(data, 201);
}

// ── PUT /transacoes/:id ───────────────────────────────────────

async function editar(
  db: ReturnType<typeof createClient>,
  id: string,
  body: Record<string, unknown>,
  escopo: string
) {
  // Busca o lançamento atual para verificar recorrência
  const { data: atual, error: erroBusca } = await db.schema("arqvalor").from("transacoes").select("*").eq("id", id).single();
  if (erroBusca) return erro("Lançamento não encontrado", 404);

  // valor_projetado nunca vem do usuário — o trigger cuida disso
  const { valor_projetado, ...dadosLimpos } = body;

  // Define quais IDs serão afetados pelo escopo
  let ids: string[] = [id];

  if (atual.id_recorrencia && escopo !== "SOMENTE_ESTE") {
    let queryIds = db.schema("arqvalor").from("transacoes").select("id").eq("id_recorrencia", atual.id_recorrencia);

    if (escopo === "ESTE_E_SEGUINTES") {
      queryIds = queryIds.gte("nr_parcela", atual.nr_parcela);
    }
    // escopo === "TODOS" → não filtra nr_parcela

    const { data: recorrentes } = await queryIds;
    ids = (recorrentes ?? []).map((r: { id: string }) => r.id);
  }

  const { data, error } = await db.schema("arqvalor").from("transacoes").update(dadosLimpos).in("id", ids).select();
  if (error) return erro(error.message);

  return json({ atualizados: data?.length ?? 0, dados: data });
}

// ── DELETE /transacoes/:id ────────────────────────────────────

async function excluir(
  db: ReturnType<typeof createClient>,
  id: string,
  escopo: string
) {
  const { data: atual, error: erroBusca } = await db.schema("arqvalor").from("transacoes").select("id, id_recorrencia, nr_parcela").eq("id", id).single();
  if (erroBusca) return erro("Lançamento não encontrado", 404);

  let ids: string[] = [id];

  if (atual.id_recorrencia && escopo !== "SOMENTE_ESTE") {
    let queryIds = db.schema("arqvalor").from("transacoes").select("id").eq("id_recorrencia", atual.id_recorrencia);

    if (escopo === "ESTE_E_SEGUINTES") {
      queryIds = queryIds.gte("nr_parcela", atual.nr_parcela);
    }

    const { data: recorrentes } = await queryIds;
    ids = (recorrentes ?? []).map((r: { id: string }) => r.id);
  }

  const { error } = await db.schema("arqvalor").from("transacoes").delete().in("id", ids);
  if (error) return erro(error.message);

  return json({ excluidos: ids.length, ids });
}

// ── POST /transacoes/:id/antecipar ────────────────────────────

async function antecipar(db: ReturnType<typeof createClient>, id: string) {
  // Chama a função fn_antecipar_parcelas criada no schema
  const { data, error } = await db.schema("arqvalor").rpc("fn_antecipar_parcelas", {
    p_transacao_id: id,
    p_user_id: (await db.auth.getUser()).data.user?.id,
  });

  if (error) {
    // Traduz os códigos de erro da função SQL para mensagens amigáveis
    if (error.message.includes("LAST_INSTALLMENT")) {
      return erro("Não é possível antecipar a última parcela do grupo", 400);
    }
    if (error.message.includes("NOT_INSTALLMENT")) {
      return erro("Antecipação disponível apenas para lançamentos do tipo PARCELA", 400);
    }
    if (error.message.includes("TRANSACAO_NAO_ENCONTRADA")) {
      return erro("Lançamento não encontrado", 404);
    }
    return erro(error.message);
  }

  return json({
    mensagem: "Antecipação realizada com sucesso",
    resultado: data?.[0] ?? data,
  });
}