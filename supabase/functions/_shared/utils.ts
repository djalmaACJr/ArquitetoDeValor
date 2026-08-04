// ============================================================
// Arquiteto de Valor — Módulo compartilhado v6
// supabase/functions/_shared/utils.ts
// Alteração: CORS com origem configurável via ALLOWED_ORIGIN
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS — allowlist de origens ───────────────────────────────────────────────
// ALLOWED_ORIGIN aceita uma LISTA separada por vírgula (produção):
//   supabase secrets set ALLOWED_ORIGIN=https://app1.com,https://app2.com
// Além dela, qualquer localhost / 127.0.0.1 (em qualquer porta) é SEMPRE
// aceito — facilita rodar o front local contra este mesmo backend sem afrouxar
// a produção. Um site atacante não consegue forjar Origin: localhost no
// navegador da vítima, então isso não abre brecha. Sem ALLOWED_ORIGIN → "*".
const ORIGENS_CONFIG = (Deno.env.get("ALLOWED_ORIGIN") ?? "*")
  .split(",").map((s) => s.trim()).filter(Boolean);
const CORS_CURINGA  = ORIGENS_CONFIG.includes("*");
const ORIGEM_PADRAO = CORS_CURINGA ? "*" : (ORIGENS_CONFIG[0] ?? "*");

function resolverOrigem(origin: string): string {
  if (CORS_CURINGA) return "*";
  if (origin && ORIGENS_CONFIG.includes(origin)) return origin;
  if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
  return ORIGEM_PADRAO; // origem não permitida → devolve a primária (o navegador bloqueia)
}

// Origem resolvida da requisição atual. App de usuário único: não há
// concorrência de origens distintas no mesmo isolate, então guardar a origem
// por requisição num módulo é seguro na prática. É um trade-off consciente — a
// alternativa sem estado exigiria envolver o handler de todas as funções.
let _origemAtual = ORIGEM_PADRAO;

// ── Registra a origem da requisição (chame como 1ª linha do handler) ──
export function registrarOrigem(req: Request): void {
  _origemAtual = resolverOrigem(req.headers.get("Origin") ?? "");
}

// ── Headers CORS com a origem resolvida da requisição atual ───
export function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin":  _origemAtual,
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, apikey, Content-Type",
    "Vary":                         "Origin",
  };
}

// ── Resposta para preflight OPTIONS ──────────────────────────
export function corsPreFlight(): Response {
  return new Response(null, { status: 200, headers: corsHeaders() });
}

// ── Resposta JSON padronizada ─────────────────────────────────
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

// ── Resposta de erro padronizada ──────────────────────────────
export function erro(mensagem: string, status = 400): Response {
  return json({ erro: mensagem }, status);
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

// ── Comparação de strings em tempo constante (evita timing attack) ──
// Usada para comparar secrets (ex.: x-cron-secret) — nunca usar `!==`/`===`
// direto nesses casos: o early-exit char-a-char do JS vaza, por timing,
// quantos caracteres iniciais bateram com o valor esperado.
function compararSeguro(a: string, b: string): boolean {
  const bufA = new TextEncoder().encode(a);
  const bufB = new TextEncoder().encode(b);
  // Web Crypto (SubtleCrypto) não expõe comparação em tempo constante —
  // isso só existe em node:crypto (timingSafeEqual), que exigiria import
  // extra. XOR byte-a-byte sobre um buffer de tamanho fixo (o maior dos
  // dois) tem custo indistinguível do conteúdo e não usa early-exit —
  // evita vazar por timing tanto o conteúdo quanto o tamanho do secret.
  const tam = Math.max(bufA.length, bufB.length, 1);
  const x = new Uint8Array(tam), y = new Uint8Array(tam);
  x.set(bufA); y.set(bufB);
  let diff = bufA.length ^ bufB.length;
  for (let i = 0; i < tam; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// ── Valida um job de cron pelo header x-cron-secret (sem JWT) ────────
// `nomeSecretEnv` é o nome da env var (ex.: "CRON_SECRET") — cada Edge
// Function pode usar a mesma ou secrets próprios. Devolve Response 401 se
// o secret não estiver configurado ou não bater (comparação timing-safe).
export function autenticarCron(req: Request, nomeSecretEnv = "CRON_SECRET"): Response | null {
  const esperado = Deno.env.get(nomeSecretEnv) ?? "";
  const recebido = req.headers.get("x-cron-secret") ?? "";
  if (!esperado || !compararSeguro(recebido, esperado)) return erro("Não autorizado", 401);
  return null;
}

// ── Valida autenticação — retorna userId ou Response 401 ──────
// Verifica ASSINATURA e EXPIRAÇÃO do JWT (não só decodifica): o payload de
// um token forjado/expirado não pode virar userId — rotas que usam dbAdmin()
// (service_role, sem RLS) confiam neste valor. getClaims valida via JWKS
// local; se a lib em runtime não o tiver, cai no getUser (validação no Auth).
export async function autenticar(req: Request): Promise<string | Response> {
  const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (!token) return erro("Usuário não autenticado", 401);
  try {
    const auth = verificador().auth;
    if (typeof auth.getClaims === "function") {
      const { data, error } = await auth.getClaims(token);
      const sub = data?.claims?.sub;
      if (error || !sub) return erro("Usuário não autenticado", 401);
      return String(sub);
    }
    const { data, error } = await auth.getUser(token);
    if (error || !data?.user?.id) return erro("Usuário não autenticado", 401);
    return data.user.id;
  } catch {
    return erro("Usuário não autenticado", 401);
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

// ── Busca TODAS as linhas de uma query, ignorando o limite padrão do
// PostgREST (max_rows=1000 — ver supabase/config.toml). Sem isso, tabelas
// que crescem além de 1000 linhas (histórico mensal, dividendos de usuários
// antigos) são silenciosamente truncadas — o front nunca vê o erro, só
// recebe menos dados do que existe. Pagina em blocos de 1000 até esgotar.
// `montar` deve devolver um builder NOVO a cada chamada (não reaproveitar
// a mesma instância com .range() repetido).
export async function buscarTodasLinhas<T>(
  montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const PAGINA = 1000;
  let offset = 0;
  const tudo: T[] = [];
  for (;;) {
    const { data, error } = await montar(offset, offset + PAGINA - 1);
    if (error) return { data: tudo, error };
    const linhas = data ?? [];
    tudo.push(...linhas);
    if (linhas.length < PAGINA) break;
    offset += PAGINA;
  }
  return { data: tudo, error: null };
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
