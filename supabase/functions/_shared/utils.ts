// ============================================================
// Arquiteto de Valor — Módulo compartilhado v6
// supabase/functions/_shared/utils.ts
// Alteração: CORS com origem configurável via ALLOWED_ORIGIN
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS — origem restrita em produção ────────────────────────────────────────
// ALLOWED_ORIGIN aceita uma lista separada por vírgulas (ex.: produção +
// domínio próprio + localhost do mesmo projeto Supabase, já que dev e prod
// compartilham o mesmo projeto aqui). Quando quem chama passa `req`, a
// origem da requisição é refletida de volta SE estiver na lista; senão cai
// no primeiro item (comportamento antigo, single-origin, para quem não
// passa `req`). Em desenvolvimento local sem o secret definido, usa "*".
//   supabase secrets set ALLOWED_ORIGIN="https://seu-dominio.com,http://localhost:5173"
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGIN") ?? "*")
  .split(",")
  .map(o => o.trim())
  .filter(Boolean);

function origemPermitida(req?: Request): string {
  if (ALLOWED_ORIGINS.includes("*")) return "*";
  const origem = req?.headers.get("Origin") ?? "";
  return ALLOWED_ORIGINS.includes(origem) ? origem : ALLOWED_ORIGINS[0];
}

export function corsHeaders(req?: Request): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":  origemPermitida(req),
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
  };
}

// Mantido para as funções que ainda não passam `req` — mesmo valor de antes.
export const CORS_HEADERS = corsHeaders();

// ── Resposta para preflight OPTIONS ──────────────────────────
export function corsPreFlight(req?: Request): Response {
  return new Response(null, { status: 200, headers: corsHeaders(req) });
}

// ── Resposta JSON padronizada ─────────────────────────────────
export function json(data: unknown, status = 200, req?: Request): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(req) },
  });
}

// ── Resposta de erro padronizada ──────────────────────────────
export function erro(mensagem: string, status = 400, req?: Request): Response {
  return json({ erro: mensagem }, status, req);
}

// ── Cliente Supabase com schema arqvalor (anon key + JWT do usuário) ──
// Sem anotação de retorno explícita: createClient() com { schema: "arqvalor" }
// devolve SupabaseClient<..., "arqvalor", ...>, incompatível com o genérico
// default "public" de SupabaseClient — deixar o TS inferir evita o mismatch.
export function db(req: Request) {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    {
      db: { schema: "arqvalor" },
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    }
  );
}

// Tipo do cliente no schema arqvalor — use este (não o SupabaseClient bare,
// que tem schema default "public") em qualquer função compartilhada que
// receba o cliente de db()/dbAdmin() como parâmetro.
export type Db = ReturnType<typeof db>;

// ── Cliente Supabase com service_role (bypassa RLS) ───────────
export function dbAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { db: { schema: "arqvalor" } }
  );
}

// ── Verificador de JWT (singleton do módulo) ──────────────────
// Cliente dedicado só para validar tokens. Singleton para o cache de JWKS
// do supabase-js persistir entre requests do mesmo isolate — a verificação
// ES256 roda local (Web Crypto), sem chamada de rede por request.
let _verificador: ReturnType<typeof createClient> | null = null;
function verificador() {
  _verificador ??= createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return _verificador;
}

// ── Valida autenticação — retorna userId ou Response 401 ──────
// Verifica ASSINATURA e EXPIRAÇÃO do JWT (não só decodifica): o payload de
// um token forjado/expirado não pode virar userId — rotas que usam dbAdmin()
// (service_role, sem RLS) confiam neste valor. getClaims valida via JWKS
// local; se a lib em runtime não o tiver, cai no getUser (validação no Auth).
export async function autenticar(req: Request): Promise<string | Response> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return erro("Usuário não autenticado", 401, req);
  try {
    const auth = verificador().auth;
    if (typeof auth.getClaims === "function") {
      const { data, error } = await auth.getClaims(token);
      const sub = data?.claims?.sub;
      if (error || !sub) return erro("Usuário não autenticado", 401, req);
      return String(sub);
    }
    const { data, error } = await auth.getUser(token);
    if (error || !data?.user?.id) return erro("Usuário não autenticado", 401, req);
    return data.user.id;
  } catch {
    return erro("Usuário não autenticado", 401, req);
  }
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
  c: Db,
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
