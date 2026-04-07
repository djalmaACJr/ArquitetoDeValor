// ============================================================
// Arquiteto de Valor — Módulo compartilhado v3
// supabase/functions/_shared/utils.ts
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

// ── Cliente Supabase com schema arqvalor ──────────────────────
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
// extrairId(req, "contas") em /functions/v1/contas/uuid → "uuid"
export function extrairId(req: Request, recurso: string): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf(recurso);
  if (idx === -1 || idx + 1 >= partes.length) return null;
  const candidato = partes[idx + 1];
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_REGEX.test(candidato) ? candidato : null;
}

// ── Extrai ação do path ───────────────────────────────────────
// extrairAcao(req, "transacoes") em /transacoes/uuid/antecipar → "antecipar"
export function extrairAcao(req: Request, recurso: string): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf(recurso);
  if (idx === -1 || idx + 2 >= partes.length) return null;
  return partes[idx + 2];
}

// ── Verifica existência do registro — retorna Response ou null ─
// Uso: const naoEncontrado = await verificarExistencia(c, "contas", id, "Conta não encontrada");
//      if (naoEncontrado) return naoEncontrado;
export async function verificarExistencia(
  c: SupabaseClient,
  tabela: string,
  id: string,
  mensagem: string
): Promise<Response | null> {
  const { data, error } = await c.from(tabela).select("id").eq("id", id).single();
  if (error || !data) return erro(mensagem, 404);
  return null;
}

// ── Valida formato de cor hex — retorna Response ou null ───────
// Uso: const corInvalida = validarCor(body.cor);
//      if (corInvalida) return corInvalida;
export function validarCor(cor: unknown): Response | null {
  if (cor != null && !/^#[0-9A-Fa-f]{6}$/.test(String(cor)))
    return erro("cor deve estar no formato hex: #RRGGBB");
  return null;
}

// ── Monta objeto de atualização com campos presentes no body ───
// Uso: const campos = camposParaAtualizar(body, ["nome","tipo","cor"]);
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