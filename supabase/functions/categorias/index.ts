// ============================================================
// Arquiteto de Valor — Edge Function: categorias
// GET / POST / PUT / DELETE
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
        headers: { Authorization: req.headers.get("Authorization")! },
      },
    }
  );
}

// ── Roteador ─────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const id = url.pathname
    .replace(/^\/functions\/v1\/categorias\/?/, "")
    .split("/")[0] || null;
  const metodo = req.method;
  const db = supabaseCliente(req);

  try {
    if (metodo === "GET" && !id)   return await listar(db, url.searchParams);
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

// ── GET /categorias ───────────────────────────────────────────
// Parâmetros opcionais:
//   ?hierarquia=true  → retorna estrutura pai/filho agrupada
//   ?apenas_pai=true  → retorna apenas categorias raiz (sem pai)
//   ?ativa=true/false → filtra por status ativo

async function listar(
  db: ReturnType<typeof createClient>,
  params: URLSearchParams
) {
  const hierarquia = params.get("hierarquia") === "true";
  const apenasRaiz = params.get("apenas_pai") === "true";
  const ativa      = params.get("ativa");

  let query = db
    .schema("arqvalor")
    .from("categorias")
    .select("*")
    .order("descricao", { ascending: true });

  if (apenasRaiz) query = query.is("id_pai", null);
  if (ativa !== null) query = query.eq("ativa", ativa === "true");

  const { data, error } = await query;
  if (error) return erro(error.message);

  // Se hierarquia=true, monta estrutura pai/filho
  if (hierarquia) {
    const pais = (data ?? []).filter((c: Record<string, unknown>) => !c.id_pai);
    const filhos = (data ?? []).filter((c: Record<string, unknown>) => c.id_pai);

    const estrutura = pais.map((pai: Record<string, unknown>) => ({
      ...pai,
      subcategorias: filhos.filter(
        (f: Record<string, unknown>) => f.id_pai === pai.id
      ),
    }));

    return json({ dados: estrutura });
  }

  return json({ dados: data });
}

// ── GET /categorias/:id ───────────────────────────────────────

async function buscarPorId(
  db: ReturnType<typeof createClient>,
  id: string
) {
  const { data, error } = await db
    .schema("arqvalor")
    .from("categorias")
    .select("*")
    .eq("id", id)
    .single();

  if (error) return erro("Categoria não encontrada", 404);

  // Busca subcategorias se for categoria pai
  if (!data.id_pai) {
    const { data: subs } = await db
      .schema("arqvalor")
      .from("categorias")
      .select("*")
      .eq("id_pai", id)
      .order("descricao", { ascending: true });

    return json({ ...data, subcategorias: subs ?? [] });
  }

  return json(data);
}

// ── POST /categorias ──────────────────────────────────────────

async function criar(
  db: ReturnType<typeof createClient>,
  body: Record<string, unknown>
) {
  // Validações
  if (!body.descricao || String(body.descricao).length < 1) {
    return erro("descricao é obrigatória");
  }
  if (String(body.descricao).length > 20) {
    return erro("descricao deve ter no máximo 20 caracteres");
  }
  if (body.cor && !/^#[0-9A-Fa-f]{6}$/.test(String(body.cor))) {
    return erro("cor deve estar no formato hex: #RRGGBB");
  }

  // Se informou id_pai, verifica se existe e pertence ao usuário
  if (body.id_pai) {
    const { data: pai, error: erroPai } = await db
      .schema("arqvalor")
      .from("categorias")
      .select("id, id_pai")
      .eq("id", body.id_pai)
      .single();

    if (erroPai) return erro("Categoria pai não encontrada", 404);

    // Impede criar neto (máximo 2 níveis)
    if (pai.id_pai) {
      return erro("Não é possível criar subcategoria de uma subcategoria. Máximo 2 níveis.");
    }
  }

  const { data, error } = await db
    .schema("arqvalor")
    .from("categorias")
    .insert({
      descricao: body.descricao,
      id_pai:    body.id_pai ?? null,
      icone:     body.icone  ?? null,
      cor:       body.cor    ?? null,
      ativa:     true,
    })
    .select()
    .single();

  if (error) return erro(error.message);
  return json(data, 201);
}

// ── PUT /categorias/:id ───────────────────────────────────────

async function editar(
  db: ReturnType<typeof createClient>,
  id: string,
  body: Record<string, unknown>
) {
  // Verifica se existe e pertence ao usuário
  const { error: erroBusca } = await db
    .schema("arqvalor")
    .from("categorias")
    .select("id")
    .eq("id", id)
    .single();

  if (erroBusca) return erro("Categoria não encontrada", 404);

  // Validações dos campos enviados
  if (body.descricao !== undefined) {
    if (String(body.descricao).length < 1 || String(body.descricao).length > 20) {
      return erro("descricao deve ter entre 1 e 20 caracteres");
    }
  }
  if (body.cor !== undefined && body.cor !== null) {
    if (!/^#[0-9A-Fa-f]{6}$/.test(String(body.cor))) {
      return erro("cor deve estar no formato hex: #RRGGBB");
    }
  }

  // Monta apenas os campos enviados
  const campos: Record<string, unknown> = {};
  if (body.descricao !== undefined) campos.descricao = body.descricao;
  if (body.icone     !== undefined) campos.icone     = body.icone;
  if (body.cor       !== undefined) campos.cor       = body.cor;
  if (body.ativa     !== undefined) campos.ativa     = body.ativa;

  // id_pai não pode ser alterado após criação — hierarquia é imutável

  const { data, error } = await db
    .schema("arqvalor")
    .from("categorias")
    .update(campos)
    .eq("id", id)
    .select()
    .single();

  if (error) return erro(error.message);
  return json(data);
}

// ── DELETE /categorias/:id ────────────────────────────────────
// Bloqueado pelo trigger se tiver subcategorias ou lançamentos

async function excluir(db: ReturnType<typeof createClient>, id: string) {
  const { error } = await db
    .schema("arqvalor")
    .from("categorias")
    .delete()
    .eq("id", id);

  if (error) {
    if (error.message.includes("CATEGORIA_COM_FILHOS")) {
      return erro(error.message, 409);
    }
    if (error.message.includes("CATEGORIA_EM_USO")) {
      return erro(error.message, 409);
    }
    return erro(error.message);
  }

  return json({ mensagem: "Categoria excluída com sucesso" });
}