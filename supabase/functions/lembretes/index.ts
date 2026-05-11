import {
  autenticar,
  corsPreFlight,
  db,
  erro,
  extrairId,
  json,
  verificarExistencia,
} from "../_shared/utils.ts";
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();

  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id     = extrairId(req, "lembretes");
  const m      = req.method;
  const c      = db(req);
  const params = new URL(req.url).searchParams;

  if (m === "GET"    && !id) return listar(c, params, userId);
  if (m === "POST"   && !id) return criar(c, req, userId);
  if (m === "PUT"    &&  id) return editar(c, req, id, userId);
  if (m === "DELETE" &&  id) return excluir(c, id, userId);

  return erro("Método não suportado", 405);
});

// ── GET /lembretes?mes=YYYY-MM ────────────────────────────────
async function listar(
  c: SupabaseClient,
  params: URLSearchParams,
  userId: string
): Promise<Response> {
  const mes = params.get("mes"); // "YYYY-MM"

  let q = c
    .from("lembretes")
    .select("*")
    .eq("user_id", userId)
    .order("data", { ascending: true })
    .order("criado_em", { ascending: true });

  if (mes) {
    const [ano, m] = mes.split("-").map(Number);
    const inicio = `${ano}-${String(m).padStart(2, "0")}-01`;
    const fimDate = new Date(ano, m, 0);
    const fim = `${ano}-${String(m).padStart(2, "0")}-${String(fimDate.getDate()).padStart(2, "0")}`;
    q = q.gte("data", inicio).lte("data", fim);
  }

  const { data, error } = await q;
  if (error) return erro(error.message, 500);
  return json(data ?? []);
}

// ── POST /lembretes ───────────────────────────────────────────
async function criar(
  c: SupabaseClient,
  req: Request,
  userId: string
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const { data, descricao, lancamento_id } = body;

  if (!data)      return erro("Campo 'data' é obrigatório");
  if (!descricao) return erro("Campo 'descricao' é obrigatório");
  if (descricao.length > 200) return erro("descricao deve ter no máximo 200 caracteres");

  const { data: criado, error } = await c
    .from("lembretes")
    .insert({
      user_id:       userId,
      data,
      descricao:     descricao.trim(),
      lancamento_id: lancamento_id ?? null,
      status:        "PENDENTE",
    })
    .select()
    .single();

  if (error) return erro(error.message, 500);
  return json(criado, 201);
}

// ── PUT /lembretes/:id ────────────────────────────────────────
async function editar(
  c: SupabaseClient,
  req: Request,
  id: string,
  userId: string
): Promise<Response> {
  const existe = await verificarExistencia(c, "lembretes", id, "Lembrete não encontrado", userId);
  if (existe) return existe;

  const body = await req.json().catch(() => ({}));
  const campos: Record<string, unknown> = {};

  if (body.data      !== undefined) campos.data      = body.data;
  if (body.descricao !== undefined) {
    if (body.descricao.length > 200) return erro("descricao deve ter no máximo 200 caracteres");
    campos.descricao = body.descricao.trim();
  }
  if (body.status !== undefined) {
    if (!["PENDENTE", "CONCLUIDO"].includes(body.status))
      return erro("status inválido: use PENDENTE | CONCLUIDO");
    campos.status = body.status;
  }

  if (Object.keys(campos).length === 0) return erro("Nenhum campo enviado para atualização");

  const { data: atualizado, error } = await c
    .from("lembretes")
    .update(campos)
    .eq("id", id)
    .eq("user_id", userId)
    .select()
    .single();

  if (error) return erro(error.message, 500);
  return json(atualizado);
}

// ── DELETE /lembretes/:id ─────────────────────────────────────
async function excluir(
  c: SupabaseClient,
  id: string,
  userId: string
): Promise<Response> {
  const existe = await verificarExistencia(c, "lembretes", id, "Lembrete não encontrado", userId);
  if (existe) return existe;

  const { error } = await c
    .from("lembretes")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return erro(error.message, 500);
  return json({ ok: true });
}
