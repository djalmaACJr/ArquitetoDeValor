// ============================================================
// Arquiteto de Valor — Edge Function: contas
// GET / POST / PUT / DELETE
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      db: { schema: "arqvalor" },          // ← define schema padrão
      global: {
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    }
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const id = url.pathname.replace(/^\/functions\/v1\/contas\/?/, "").split("/")[0] || null;
  const metodo = req.method;
  const db = supabaseCliente(req);

  try {
    if (metodo === "GET" && !id)   return await listar(db);
    if (metodo === "GET" && id)    return await buscarPorId(db, id);
    if (metodo === "POST")         return await criar(db, await req.json());
    if (metodo === "PUT" && id)    return await editar(db, id, await req.json());
    if (metodo === "DELETE" && id) return await excluir(db, id);
    return erro("Rota não encontrada", 404);
  } catch (e) {
    console.error(e);
    return erro("Erro interno do servidor", 500);
  }
});

async function listar(db: ReturnType<typeof createClient>) {
  const { data, error } = await db
    .from("vw_saldo_contas")             // ← sem prefixo arqvalor.
    .select("*")
    .order("nome", { ascending: true });

  if (error) return erro(error.message);
  return json({ dados: data });
}

async function buscarPorId(db: ReturnType<typeof createClient>, id: string) {
  const { data, error } = await db
    .from("vw_saldo_contas")
    .select("*")
    .eq("conta_id", id)
    .single();

  if (error) return erro("Conta não encontrada", 404);
  return json(data);
}

async function criar(db: ReturnType<typeof createClient>, body: Record<string, unknown>) {
  if (!body.nome || String(body.nome).length < 1) {
    return erro("nome é obrigatório");
  }
  if (String(body.nome).length > 100) {
    return erro("nome deve ter no máximo 100 caracteres");
  }
  if (!body.tipo) {
    return erro("tipo é obrigatório: CORRENTE | REMUNERACAO | CARTAO | INVESTIMENTO | CARTEIRA");
  }
  if (!["CORRENTE", "REMUNERACAO", "CARTAO", "INVESTIMENTO", "CARTEIRA"].includes(String(body.tipo))) {
    return erro("tipo inválido. Use: CORRENTE | REMUNERACAO | CARTAO | INVESTIMENTO | CARTEIRA");
  }
  if (body.cor && !/^#[0-9A-Fa-f]{6}$/.test(String(body.cor))) {
    return erro("cor deve estar no formato hex: #RRGGBB");
  }

  const { data, error } = await db
    .from("contas")
    .insert({
      nome:          body.nome,
      tipo:          body.tipo,
      saldo_inicial: body.saldo_inicial ?? 0,
      icone:         body.icone ?? null,
      cor:           body.cor ?? null,
      ativa:         true,
    })
    .select()
    .single();

  if (error) return erro(error.message);
  return json(data, 201);
}

async function editar(
  db: ReturnType<typeof createClient>,
  id: string,
  body: Record<string, unknown>
) {
  const { error: erroBusca } = await db
    .from("contas")
    .select("id")
    .eq("id", id)
    .single();

  if (erroBusca) return erro("Conta não encontrada", 404);

  if (body.nome !== undefined) {
    if (String(body.nome).length < 1 || String(body.nome).length > 100) {
      return erro("nome deve ter entre 1 e 100 caracteres");
    }
  }
  if (body.tipo !== undefined) {
    if (!["CORRENTE", "REMUNERACAO", "CARTAO", "INVESTIMENTO", "CARTEIRA"].includes(String(body.tipo))) {
      return erro("tipo inválido. Use: CORRENTE | REMUNERACAO | CARTAO | INVESTIMENTO | CARTEIRA");
    }
  }
  if (body.cor !== undefined && body.cor !== null) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(String(body.cor))) {
      return erro("cor deve estar no formato hex: #RRGGBB");
    }
  }

  const campos: Record<string, unknown> = {};
  if (body.nome          !== undefined) campos.nome          = body.nome;
  if (body.tipo          !== undefined) campos.tipo          = body.tipo;
  if (body.saldo_inicial !== undefined) campos.saldo_inicial = body.saldo_inicial;
  if (body.icone         !== undefined) campos.icone         = body.icone;
  if (body.cor           !== undefined) campos.cor           = body.cor;
  if (body.ativa         !== undefined) campos.ativa         = body.ativa;

  const { data, error } = await db
    .from("contas")
    .update(campos)
    .eq("id", id)
    .select()
    .single();

  if (error) return erro(error.message);
  return json(data);
}

async function excluir(db: ReturnType<typeof createClient>, id: string) {
  const { error } = await db
    .from("contas")
    .delete()
    .eq("id", id);

  if (error) {
    if (error.message.includes("CONTA_EM_USO")) {
      return erro(error.message, 409);
    }
    return erro(error.message);
  }

  return json({ mensagem: "Conta excluída com sucesso" });
}