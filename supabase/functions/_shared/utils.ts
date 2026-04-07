// ============================================================
// Arquiteto de Valor — Módulo compartilhado
// supabase/functions/_shared/utils.ts
//
// Importe nas Edge Functions com:
// import { json, erro, db, getUserId } from "../_shared/utils.ts";
// ============================================================
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Resposta JSON padronizada ─────────────────────────────────
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ── Resposta de erro padronizada ──────────────────────────────
export function erro(mensagem: string, status = 400): Response {
  return json({ erro: mensagem }, status);
}

// ── Cliente Supabase com schema arqvalor e JWT do usuário ─────
export function db(req: Request): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      db: { schema: "arqvalor" },
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    }
  );
}

// ── Extrai user_id do JWT (suporta base64url) ─────────────────
export function getUserId(req: Request): string | null {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return null;
  try {
    const payload = token.split(".")[1]
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    return JSON.parse(atob(payload)).sub ?? null;
  } catch { return null; }
}
