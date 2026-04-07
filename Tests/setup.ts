// ============================================================
// Arquiteto de Valor — Testes automatizados
// tests/setup.ts — configuração compartilhada
// ============================================================
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL      = process.env.SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY!;
const TEST_EMAIL        = process.env.TEST_EMAIL!;
const TEST_PASSWORD     = process.env.TEST_PASSWORD!;
const BASE_URL          = `${SUPABASE_URL}/functions/v1`;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !TEST_EMAIL || !TEST_PASSWORD) {
  throw new Error("Variáveis de ambiente não configuradas. Verifique .env ou GitHub Secrets.");
}

export { BASE_URL, SUPABASE_ANON_KEY };

// ── Autenticação ──────────────────────────────────────────────
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

// ── Headers padrão ────────────────────────────────────────────
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getToken();
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${token}`,
    "apikey": SUPABASE_ANON_KEY,
  };
}

// ── Helper: requisição à Edge Function ───────────────────────
export async function api(
  path: string,
  method: string = "GET",
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const headers = await authHeaders();
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status: res.status, data };
}

// ── Helper: requisição sem autenticação ───────────────────────
export async function apiSemAuth(
  path: string,
  method: string = "GET",
  body?: unknown
): Promise<{ status: number; data: unknown }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_ANON_KEY,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  return { status: res.status, data };
}

// ── Limpeza: remove registros criados nos testes ──────────────
export async function limparConta(id: string): Promise<void> {
  await api(`/contas/${id}`, "DELETE");
}

export async function limparCategoria(id: string): Promise<void> {
  await api(`/categorias/${id}`, "DELETE");
}

export async function limparTransacao(id: string): Promise<void> {
  await api(`/transacoes/${id}`, "DELETE");
}
