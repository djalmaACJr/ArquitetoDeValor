// ============================================================
// Arquiteto de Valor — Módulo compartilhado v6
// supabase/functions/_shared/utils.ts
// Alteração: CORS com origem configurável via ALLOWED_ORIGIN
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logError } from "./logger.ts";

// ── Data de "hoje" no fuso de Brasília — NUNCA use `new Date().toISOString()`
// pra isso ────────────────────────────────────────────────────────────────
// Achado de auditoria (AUD-01, 2026-08-06): `new Date().toISOString().split("T")[0]`
// devolve a data em UTC. Brasil é UTC-3 o ano todo (sem horário de verão
// desde 2019) — então, das 21h00 às 23h59 (horário de Brasília), o relógio
// UTC já virou o dia seguinte. Nessa janela, toda comparação "data <= hoje"
// feita com o padrão antigo comparava contra o dia ERRADO: uma parcela de
// amanhã (Brasil) virava PAGO hoje à noite; um resgate de renda fixa
// agendado pra amanhã era aplicado à posição uma noite adiantado; um
// lançamento PROJEÇÃO genuinamente futuro era rejeitado como inválido.
// Reproduzível garantidamente, todo santo dia, não é edge case raro.
//
// `hojeBR()`/`mesCorrenteBR()` são os únicos pontos que devem calcular
// "hoje"/"mês corrente" pra regra de negócio (status, corte de vencimento,
// etc.) — todo o resto do módulo delega pra cá.
const FORMATADOR_DATA_BR = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric", month: "2-digit", day: "2-digit",
});
export function hojeBR(): string {
  // Locale en-CA formata nativamente como YYYY-MM-DD — evita parsing manual.
  return FORMATADOR_DATA_BR.format(new Date());
}
export function mesCorrenteBR(): string {
  return hojeBR().slice(0, 7);
}

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

// ── Idempotency-Key — protege endpoints de criação contra duplicação ──
// Achado de auditoria AUD-06: POST /transacoes e /transferencias não
// tinham nenhuma defesa contra retry de rede (a chamada chega e cria o
// registro, a resposta se perde, o cliente reenvia — duplica). Opcional e
// opt-in: sem o header `Idempotency-Key`, o comportamento é IDÊNTICO ao de
// antes (chama `executar()` direto, sem passar pela tabela).
//
// Como funciona: reivindica a chave (INSERT) ANTES de rodar `executar()`.
// A UNIQUE (user_id, rota, chave) da tabela serializa tentativas
// concorrentes com a MESMA chave — a 2ª tentativa esbarra na constraint
// antes de conseguir criar duplicata nenhuma, não é uma checagem "olha e
// depois grava" (que teria a mesma race condition que estamos evitando).
// Se a 1ª tentativa já terminou, devolve a resposta cacheada; se ainda
// está em andamento, devolve 409 em vez de arriscar duplicar.
export async function comIdempotencia(
  c: Db, userId: string, rota: string, chave: string | null,
  executar: () => Promise<Response>,
): Promise<Response> {
  if (!chave) return await executar();

  const { error: erroClaim } = await c.from("idempotency_keys")
    .insert({ user_id: userId, rota, chave });

  if (erroClaim) {
    if (erroClaim.code === "23505") { // unique_violation — chave já reivindicada
      const { data: existente } = await c.from("idempotency_keys")
        .select("status_code, resposta")
        .eq("user_id", userId).eq("rota", rota).eq("chave", chave)
        .maybeSingle();
      if (existente?.status_code != null) {
        return json(existente.resposta, existente.status_code);
      }
      return erro("Operação já em andamento com esta chave de idempotência — aguarde, não reenvie.", 409);
    }
    // Erro inesperado gravando a chave (ex.: migration ainda não aplicada):
    // segue sem idempotência em vez de bloquear a operação real por isso.
    logError("comIdempotencia (reivindicar chave)", erroClaim);
    return await executar();
  }

  const resp = await executar();
  let corpo: unknown = null;
  try { corpo = await resp.clone().json(); } catch { /* corpo não-JSON */ }
  const { error: erroUpdate } = await c.from("idempotency_keys")
    .update({ status_code: resp.status, resposta: corpo })
    .eq("user_id", userId).eq("rota", rota).eq("chave", chave);
  if (erroUpdate) logError("comIdempotencia (gravar resposta)", erroUpdate);
  return resp;
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

// ── Registro de execução de cron job (tabela cron_execucoes) ──
// Grava sucesso/erro de UMA execução de cron — consultada pela tela admin
// /admin/crons no frontend (RLS só libera SELECT pra usuarios.admin=true).
// Nasceu da auditoria 2026-08-06: dividendos-diario falhou 19 dias direto
// sem NENHUM sinal em lugar nenhum que desse pra checar sem entrar no SQL
// Editor/Logs Explorer do Supabase.
//
// NUNCA lança — uma falha ao gravar o log não pode derrubar a resposta
// real do cron (o dado em si já foi processado ou já falhou; perder só o
// registro do log é um problema bem menor que isso virar um 500 espúrio).
export async function registrarExecucaoCron(
  jobNome: string,
  status: "sucesso" | "erro",
  resumo: unknown,
  erroMsg: string | null,
  duracaoMs: number,
): Promise<void> {
  try {
    const { error } = await dbAdmin().from("cron_execucoes").insert({
      job_nome: jobNome, status, resumo: resumo ?? null, erro: erroMsg, duracao_ms: duracaoMs,
    });
    if (error) logError("registrarExecucaoCron (insert)", error);
  } catch (e) {
    logError("registrarExecucaoCron (inesperado)", e);
  }
}

// Envolve a chamada de uma rota de cron: mede duração, grava o resultado
// (sucesso/erro) em cron_execucoes e repassa a Response original sem
// alterar o comportamento de quem chama (o handler externo em index.ts
// continua responsável por tratar exceções e responder 500).
export async function executarComLogDeCron(
  jobNome: string,
  fn: () => Promise<Response>,
): Promise<Response> {
  const inicio = Date.now();
  try {
    const resp = await fn();
    const duracaoMs = Date.now() - inicio;
    let resumo: unknown = null;
    try { const corpo = await resp.clone().json(); resumo = corpo?.dados ?? corpo; } catch { /* corpo não-JSON */ }
    const sucesso = resp.status >= 200 && resp.status < 300;
    await registrarExecucaoCron(jobNome, sucesso ? "sucesso" : "erro", resumo, sucesso ? null : JSON.stringify(resumo), duracaoMs);
    return resp;
  } catch (e) {
    const duracaoMs = Date.now() - inicio;
    await registrarExecucaoCron(jobNome, "erro", null, (e as Error)?.message ?? String(e), duracaoMs);
    throw e; // handler externo (index.ts) continua tratando e respondendo 500
  }
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
