// ============================================================
// Arquiteto de Valor — Módulo compartilhado v5
// supabase/functions/_shared/utils.ts
// ============================================================
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Headers CORS — obrigatórios para chamadas do browser ──────
export const CORS_HEADERS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
};

// ── Resposta para preflight OPTIONS ──────────────────────────
export function corsPreFlight(): Response {
  return new Response(null, { status: 200, headers: CORS_HEADERS });
}

// ── Resposta JSON padronizada ─────────────────────────────────
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

// ── Resposta de erro padronizada ──────────────────────────────
export function erro(mensagem: string, status = 400): Response {
  return json({ erro: mensagem }, status);
}

// ── Cliente Supabase com schema arqvalor (anon key + JWT do usuário) ──
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

// ── Cliente Supabase com service_role (bypassa RLS) ───────────
export function dbAdmin(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "arqvalor" } }
  );
}

// ── Extrai user_id do JWT com suporte a base64url ─────────────
export function getUserId(req: Request): string | null {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return null;
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload)).sub ?? null;
  } catch { return null; }
}

// ── Valida autenticação — retorna userId ou Response 401 ──────
export function autenticar(req: Request): string | Response {
  const userId = getUserId(req);
  if (!userId) return erro("Usuário não autenticado", 401);
  return userId;
}

// ── Extrai UUID do path ───────────────────────────────────────
export function extrairId(req: Request, recurso: string): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf(recurso);
  if (idx === -1 || idx + 1 >= partes.length) return null;
  const candidato = partes[idx + 1];
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_REGEX.test(candidato) ? candidato : null;
}

// ── Extrai ação do path ───────────────────────────────────────
export function extrairAcao(req: Request, recurso: string): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf(recurso);
  if (idx === -1 || idx + 2 >= partes.length) return null;
  return partes[idx + 2];
}

// ── Verifica existência e posse do registro ───────────────────
export async function verificarExistencia(
  c: SupabaseClient,
  tabela: string,
  id: string,
  mensagem: string,
  userId?: string
): Promise<Response | null> {
  let q = c.from(tabela).select("id").eq("id", id);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q.single();
  if (error || !data) return erro(mensagem, 404);
  return null;
}

// ── Valida formato de cor hex ─────────────────────────────────
export function validarCor(cor: unknown): Response | null {
  if (cor != null && !/^#[0-9A-Fa-f]{6}$/.test(String(cor)))
    return erro("cor deve estar no formato hex: #RRGGBB");
  return null;
}

// ── Valida status de transação/transferência ──────────────────
export function validarStatus(status: unknown): string | null {
  if (status !== undefined && !["PAGO", "PENDENTE", "PROJECAO"].includes(status as string))
    return "status inválido: use PAGO | PENDENTE | PROJECAO";
  return null;
}

// ── Valida frequência de recorrência ──────────────────────────
export function validarFrequencia(frequencia: unknown): string | null {
  if (!["DIARIA", "SEMANAL", "MENSAL", "ANUAL"].includes(frequencia as string))
    return "frequencia inválida: use DIARIA | SEMANAL | MENSAL | ANUAL";
  return null;
}

// ── Calcula data de parcela com base na frequência e offset ───
export function calcularDataParcela(base: string, frequencia: string, offset: number): string {
  const d = new Date(base + "T12:00:00Z");
  switch (frequencia) {
    case "DIARIA":  d.setDate(d.getDate() + offset); break;
    case "SEMANAL": d.setDate(d.getDate() + offset * 7); break;
    case "MENSAL":  d.setMonth(d.getMonth() + offset); break;
    case "ANUAL":   d.setFullYear(d.getFullYear() + offset); break;
  }
  return d.toISOString().split("T")[0];
}

// ── Monta objeto de atualização com campos presentes no body ───
export function camposParaAtualizar(
  body: Record<string, unknown>,
  campos: string[]
): Record<string, unknown> {
  const resultado: Record<string, unknown> = {};
  campos.forEach(k => {
    if (body[k] !== undefined) resultado[k] = body[k];
  });
  return resultado;
}
