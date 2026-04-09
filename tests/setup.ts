// setup.ts (VERSÃO CORRIGIDA COM AUTENTICAÇÃO)
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const TEST_EMAIL = process.env.TEST_EMAIL as string;
const TEST_PASSWORD = process.env.TEST_PASSWORD as string;

// Validação das variáveis de ambiente
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
export async function api(
  path: string,
  method: string = "GET",
  body?: unknown,
  customHeaders?: Record<string, string>
): Promise<{ status: number; data: unknown }> {
  const headers = customHeaders ?? (await authHeaders());
  
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

// ================= API SEM AUTENTICAÇÃO (para testes específicos) =================
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

// ================= CONTAS =================
export async function criarConta(
  headers: Record<string, string>,
  nome: string,
  tipo: string,
  cor: string
): Promise<string> {
  const res = await fetch(`${BASE_URL}/contas`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      nome: nome,
      tipo,
      cor,
    }),
  });

  const data: any = await res.json();
  return data.id;
}

export async function deletarConta(
  headers: Record<string, string>,
  id: string
): Promise<void> {
  await fetch(`${BASE_URL}/contas/${id}`, {
    method: "DELETE",
    headers,
  });
}

export const limparConta = deletarConta;

// ================= LIMPEZA =================
export async function limparCategoria(id: string): Promise<void> {
  await api(`/categorias/${id}`, "DELETE");
}

export async function limparTransacao(id: string): Promise<void> {
  await api(`/transacoes/${id}`, "DELETE");
}