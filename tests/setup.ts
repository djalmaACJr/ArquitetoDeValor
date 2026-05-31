// setup.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = process.env.SUPABASE_URL      as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const TEST_EMAIL        = process.env.TEST_EMAIL        as string;
const TEST_PASSWORD     = process.env.TEST_PASSWORD     as string;
// Segundo usuário (opcional) — usado pelos testes de segurança/RLS.
// Se não estiver no env, o setup cria um usuário descartável via signUp.
const TEST_EMAIL_B      = process.env.TEST_EMAIL_B      as string | undefined;
const TEST_PASSWORD_B   = process.env.TEST_PASSWORD_B   as string | undefined;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error("Variáveis de ambiente não configuradas. Verifique .env ou GitHub Secrets.");
}

export const BASE_URL = `${SUPABASE_URL}/functions/v1`;

// ================= AUTENTICAÇÃO =================
let cachedToken: string | null = null;
let cachedTokenB: string | null = null;
let cachedUserId: string | null = null;
let cachedUserIdB: string | null = null;

export async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;

  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  if (error || !data.session?.access_token) {
    throw new Error(`Falha na autenticação: ${error?.message}`);
  }

  cachedToken  = data.session.access_token;
  cachedUserId = data.user?.id ?? null;
  return cachedToken;
}

export async function getUserId(): Promise<string> {
  if (!cachedUserId) await getToken();
  if (!cachedUserId) throw new Error("user_id não disponível após login");
  return cachedUserId;
}

/**
 * Token do segundo usuário (usado nos testes de segurança/RLS).
 * Estratégia:
 *   1. Se TEST_EMAIL_B/PASSWORD_B existem no env → signInWithPassword.
 *   2. Senão → signUp dinâmico com email aleatório.
 *      Pré-condição: o projeto Supabase precisa estar com confirmação
 *      por email DESABILITADA, ou o signUp já retornar sessão direta.
 *      Se o seu projeto exige confirmação, defina TEST_EMAIL_B no env.
 */
export async function getTokenB(): Promise<string> {
  if (cachedTokenB) return cachedTokenB;
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  if (TEST_EMAIL_B && TEST_PASSWORD_B) {
    const { data, error } = await client.auth.signInWithPassword({
      email: TEST_EMAIL_B,
      password: TEST_PASSWORD_B,
    });
    if (error || !data.session?.access_token) {
      throw new Error(`Falha na autenticação do User B: ${error?.message}`);
    }
    cachedTokenB  = data.session.access_token;
    cachedUserIdB = data.user?.id ?? null;
    return cachedTokenB;
  }

  // Sem credenciais fixas → cria usuário descartável.
  // Domínio @example.com é reservado pela RFC 2606 — Supabase costuma aceitar.
  const email    = `jest-rls-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "Jest!Pass" + Math.random().toString(36).slice(2, 10);
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) {
    throw new Error(
      `Não foi possível criar User B via signUp: ${error.message}\n` +
      `→ Configure TEST_EMAIL_B/TEST_PASSWORD_B no .env apontando para uma 2ª conta de teste já criada.`,
    );
  }
  // Se confirmação por email estiver desabilitada, signUp já devolve session.
  if (data.session?.access_token) {
    cachedTokenB  = data.session.access_token;
    cachedUserIdB = data.user?.id ?? null;
    return cachedTokenB;
  }
  // Caso contrário, faz login imediato (signUp confirma na hora em dev).
  const { data: login, error: errLogin } = await client.auth.signInWithPassword({ email, password });
  if (errLogin || !login.session?.access_token) {
    throw new Error(
      `signUp do User B funcionou mas o login imediato falhou (${errLogin?.message ?? "sem sessão"}).\n` +
      `Provavelmente o projeto exige confirmação por email. Defina TEST_EMAIL_B/TEST_PASSWORD_B no .env.`,
    );
  }
  cachedTokenB  = login.session.access_token;
  cachedUserIdB = login.user?.id ?? null;
  return cachedTokenB;
}

export async function getUserIdB(): Promise<string> {
  if (!cachedUserIdB) await getTokenB();
  if (!cachedUserIdB) throw new Error("user_id do User B não disponível");
  return cachedUserIdB;
}

/**
 * Versão "soft" do getTokenB: retorna null se não conseguir obter o 2º
 * usuário (env não configurado e signUp dinâmico bloqueado pelo Supabase).
 * Usado por testes que querem PULAR graciosamente em vez de falhar.
 */
export async function tryGetTokenB(): Promise<string | null> {
  try {
    return await getTokenB();
  } catch {
    return null;
  }
}

export const obterToken = getToken;

// ================= HEADERS =================
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "apikey": SUPABASE_ANON_KEY,
  };
}

export function gerarHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "apikey": SUPABASE_ANON_KEY,
  };
}

/** Headers autenticados pelo User B (segundo usuário, RLS tests). */
export async function authHeadersB(): Promise<Record<string, string>> {
  const token = await getTokenB();
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "apikey": SUPABASE_ANON_KEY,
  };
}

/** Variante de `api()` que usa o token do User B. */
export async function apiB(
  path: string,
  methodOrOptions?: string | { method?: string; body?: string },
  body?: unknown,
): Promise<{ status: number; data: any }> {
  const headers = await authHeadersB();
  return api(path, methodOrOptions, body, headers);
}

// ================= API PRINCIPAL =================
// Aceita DOIS estilos de chamada para manter compatibilidade entre módulos:
//
// Estilo posicional (categorias.test.ts / transacoes.test.ts — formato original):
//   api("/categorias", "POST", body)
//   api("/categorias", "DELETE")
//
// Estilo objeto de opções (contas.test.ts — formato corrigido):
//   api("/contas", { method: "POST", body: JSON.stringify(body) })
//   api("/contas", { method: "DELETE" })
//
export async function api(
  path: string,
  methodOrOptions?: string | { method?: string; body?: string; headers?: Record<string, string> },
  body?: unknown,
  customHeaders?: Record<string, string>
): Promise<{ status: number; data: any }> {
  let method = "GET";
  let resolvedBody: string | undefined;
  let resolvedHeaders: Record<string, string> | undefined;

  if (typeof methodOrOptions === "string") {
    // Estilo posicional: api(path, method, body)
    method = methodOrOptions;
    resolvedBody = body !== undefined ? JSON.stringify(body) : undefined;
    resolvedHeaders = customHeaders;
  } else if (methodOrOptions && typeof methodOrOptions === "object") {
    // Estilo objeto: api(path, { method, body, headers })
    method = methodOrOptions.method ?? "GET";
    resolvedBody = methodOrOptions.body;       // já é string (JSON.stringify feito no teste)
    resolvedHeaders = methodOrOptions.headers;
  }
  // BUG fix: se nenhum branch acima rodou (api(path) puro, sem method)
  // mas o caller passou customHeaders (caso do apiB GET), precisamos
  // usá-los — caso contrário o fallback pega o token padrão (User A)
  // mesmo em chamadas que deveriam usar User B → vazamento RLS nos testes.
  if (!resolvedHeaders && customHeaders) resolvedHeaders = customHeaders;

  const headers = resolvedHeaders ?? (await authHeaders());

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: resolvedBody,
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status: res.status, data };
}

// ================= API SEM AUTENTICAÇÃO =================
export async function apiSemAuth(
  path: string,
  methodOrOptions?: string | { method?: string; body?: string },
  body?: unknown
): Promise<{ status: number; data: any }> {
  let method = "GET";
  let resolvedBody: string | undefined;

  if (typeof methodOrOptions === "string") {
    method = methodOrOptions;
    resolvedBody = body !== undefined ? JSON.stringify(body) : undefined;
  } else if (methodOrOptions && typeof methodOrOptions === "object") {
    method = methodOrOptions.method ?? "GET";
    resolvedBody = methodOrOptions.body;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: resolvedBody,
  });

  let data: any;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status: res.status, data };
}

// ================= CONTAS =================
// limparConta(id) — usa autenticação interna, sem exigir headers externos
export async function limparConta(id: string): Promise<void> {
  await api(`/contas/${id}`, "DELETE");
}

// Mantido para compatibilidade com código legado que passa headers explicitamente
export async function deletarConta(
  headers: Record<string, string>,
  id: string
): Promise<void> {
  await fetch(`${BASE_URL}/contas/${id}`, { method: "DELETE", headers });
}

export async function criarConta(
  headers: Record<string, string>,
  nome: string,
  tipo: string,
  cor: string
): Promise<string> {
  const res = await fetch(`${BASE_URL}/contas`, {
    method: "POST",
    headers,
    body: JSON.stringify({ nome, tipo, cor }),
  });
  const data: any = await res.json();
  return data.id;
}

// ================= LIMPEZA =================
export async function limparCategoria(id: string): Promise<void> {
  await api(`/categorias/${id}`, "DELETE");
}

export async function limparTransacao(id: string): Promise<void> {
  await api(`/transacoes/${id}`, "DELETE");
}