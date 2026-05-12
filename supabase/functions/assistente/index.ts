// supabase/functions/assistente/index.ts
// Assistente de Lançamentos — sugestões automáticas baseadas em descrição.
//
// GET  /assistente?termo=<texto>  → retorna o registro com descrição mais
//   semelhante (ILIKE %termo%) e atualizado_em mais recente, ou null.
// POST /assistente                → upsert por (user_id, lower(descricao)).
// DELETE /assistente/:id          → remove um padrão salvo.

import {
  autenticar,
  corsPreFlight,
  db,
  erro,
  extrairId,
  json,
} from "../_shared/utils.ts";
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();

  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id     = extrairId(req, "assistente");
  const m      = req.method;
  const c      = db(req);
  const params = new URL(req.url).searchParams;

  if (m === "GET"    && !id) return buscar(c, params, userId);
  if (m === "POST"   && !id) return upsert(c, req, userId);
  if (m === "DELETE" &&  id) return excluir(c, id, userId);

  return erro("Método não suportado", 405);
});

// ── GET /assistente?termo=...&limit=N ─────────────────────────
// Retorna a lista de candidatos:
//   1. casam via ILIKE %termo% no escopo do usuário (RLS),
//   2. ordenados por atualizado_em DESC (mais recente primeiro),
//   3. limite default 10 (máx 50).
async function buscar(
  c: SupabaseClient,
  params: URLSearchParams,
  userId: string,
): Promise<Response> {
  const termo = (params.get("termo") ?? "").trim();
  if (termo.length < 2) return json({ dados: [] });

  // Escapa wildcards LIKE no termo do usuário.
  const safe = termo.replace(/([%_\\])/g, "\\$1");

  const limitParam = parseInt(params.get("limit") ?? "10", 10);
  const limit = Math.min(
    Number.isFinite(limitParam) && limitParam > 0 ? limitParam : 10,
    50,
  );

  const { data, error } = await c
    .from("assistente_lancamentos")
    .select("*")
    .eq("user_id", userId)
    .ilike("descricao", `%${safe}%`)
    .order("atualizado_em", { ascending: false })
    .limit(limit);

  if (error) return erro(error.message, 500);
  return json({ dados: data ?? [] });
}

// ── POST /assistente — upsert ─────────────────────────────────
// Body:
//   {
//     descricao:        string  (2..200, obrigatório)
//     categoria_id?:    uuid
//     conta_origem_id?: uuid
//     conta_destino_id?:uuid
//     is_transferencia: boolean
//   }
// Conflito: (user_id, lower(descricao)) — UPDATE em vez de INSERT.
async function upsert(
  c: SupabaseClient,
  req: Request,
  userId: string,
): Promise<Response> {
  const body = await req.json().catch(() => ({}));
  const descricao = String(body.descricao ?? "").trim();
  if (descricao.length < 2 || descricao.length > 200) {
    return erro("descricao deve ter entre 2 e 200 caracteres", 400);
  }

  const isTransf = body.is_transferencia === true;
  const origem   = (body.conta_origem_id  as string | null | undefined) || null;
  const destino  = (body.conta_destino_id as string | null | undefined) || null;
  const categoria = (body.categoria_id    as string | null | undefined) || null;

  if (isTransf) {
    if (!origem || !destino) {
      return erro("Transferência exige conta_origem_id e conta_destino_id", 400);
    }
    if (origem === destino) {
      return erro("conta_origem_id e conta_destino_id devem ser diferentes", 400);
    }
  }

  // Procura registro existente do mesmo usuário com descrição igual
  // (case-insensitive) — base do upsert manual já que o UNIQUE é em
  // lower(descricao) e o cliente PostgREST não consegue usar a expressão
  // diretamente no on_conflict.
  const { data: existente, error: errBusca } = await c
    .from("assistente_lancamentos")
    .select("id")
    .eq("user_id", userId)
    .ilike("descricao", descricao)   // case-insensitive exata (sem %)
    .limit(1)
    .maybeSingle();

  if (errBusca) return erro(errBusca.message, 500);

  const payload = {
    descricao,
    categoria_id:     categoria,
    conta_origem_id:  origem,
    conta_destino_id: isTransf ? destino : null,
    is_transferencia: isTransf,
  };

  if (existente?.id) {
    const { data: atualizado, error } = await c
      .from("assistente_lancamentos")
      .update(payload)
      .eq("id", existente.id)
      .eq("user_id", userId)
      .select()
      .single();
    if (error) return erro(error.message, 500);
    return json(atualizado);
  }

  const { data: criado, error } = await c
    .from("assistente_lancamentos")
    .insert({ ...payload, user_id: userId })
    .select()
    .single();
  if (error) return erro(error.message, 500);
  return json(criado, 201);
}

// ── DELETE /assistente/:id ────────────────────────────────────
async function excluir(
  c: SupabaseClient,
  id: string,
  userId: string,
): Promise<Response> {
  const { error } = await c
    .from("assistente_lancamentos")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) return erro(error.message, 500);
  return json({ ok: true });
}
