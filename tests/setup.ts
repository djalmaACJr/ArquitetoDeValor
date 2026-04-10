// setup.ts
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = process.env.SUPABASE_URL      as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const TEST_EMAIL        = process.env.TEST_EMAIL        as string;
const TEST_PASSWORD     = process.env.TEST_PASSWORD     as string;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error("Variáveis de ambiente não configuradas. Verifique .env ou GitHub Secrets.");
}

export const BASE_URL = `${SUPABASE_URL}/functions/v1`;

// ================= AUTENTICAÇÃO =================
let cachedToken: string | null = null;

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

  cachedToken = data.session.access_token;
  return cachedToken;
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