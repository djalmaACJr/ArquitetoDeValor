// ============================================================
// Arquiteto de Valor — Testes de Segurança / Auth + CORS
// tests/10_seguranca_auth_cors.test.ts
//
// Verifica:
//   - Endpoints exigem Authorization (sem header → 401).
//   - JWT inválido/malformado → 401.
//   - CORS preflight inclui PATCH em Access-Control-Allow-Methods
//     (regressão do bug onde vinculações silenciosamente sumiam
//      porque o browser bloqueava o PATCH /faturas/:id/itens-bulk).
//   - CORS preflight inclui os headers necessários (Authorization, apikey).
// ============================================================

const SUPABASE_URL      = process.env.SUPABASE_URL      as string;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const BASE_URL = `${SUPABASE_URL}/functions/v1`;

describe("Segurança — Auth e CORS", () => {
  // Endpoints autenticados a sondar.
  const endpointsAutenticados = [
    { path: "/contas",       method: "GET" },
    { path: "/categorias",   method: "GET" },
    { path: "/transacoes",   method: "GET" },
    { path: "/transferencias", method: "GET" },
    { path: "/lembretes",    method: "GET" },
    { path: "/filtros",      method: "GET" },
    { path: "/faturas",      method: "GET" },
    { path: "/assistente",   method: "GET" },
  ];

  // ── SEG-AUTH01: sem Authorization → 401 ─────────────────────
  test.each(endpointsAutenticados)(
    "SEG-AUTH01 — $method $path sem Authorization → 401",
    async ({ path, method }) => {
      const res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          // Sem Authorization, mas mantemos apikey (mínimo pra passar pela borda).
          "apikey": SUPABASE_ANON_KEY,
        },
      });
      expect(res.status).toBe(401);
    },
  );

  // ── SEG-AUTH02: JWT malformado → 401 ─────────────────────────
  test("SEG-AUTH02 — JWT malformado → 401", async () => {
    const res = await fetch(`${BASE_URL}/contas`, {
      method: "GET",
      headers: {
        "Content-Type":   "application/json",
        "apikey":         SUPABASE_ANON_KEY,
        "Authorization":  "Bearer nao-eh-um-jwt-valido",
      },
    });
    expect(res.status).toBe(401);
  });

  // ── SEG-AUTH03: JWT com payload válido mas assinatura falsa → 401 ─
  test("SEG-AUTH03 — JWT com assinatura inválida → 401", async () => {
    // JWT estruturalmente válido (3 partes base64url) mas com assinatura
    // fake. O Supabase rejeita antes de processar.
    const fakeJwt =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
      "eyJzdWIiOiIxMjM0NTYiLCJyb2xlIjoiYXV0aGVudGljYXRlZCIsImlhdCI6MTUxNjIzOTAyMn0." +
      "fake-signature-aaaaaaaaaaaaaaaaaaaaaa";
    const res = await fetch(`${BASE_URL}/contas`, {
      method: "GET",
      headers: {
        "Content-Type":   "application/json",
        "apikey":         SUPABASE_ANON_KEY,
        "Authorization":  `Bearer ${fakeJwt}`,
      },
    });
    // O Supabase pode rejeitar com 401 (auth falhou) ou 400 (gateway
    // detectou JWT inválido). Qualquer 4xx caracteriza bloqueio.
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  // ── SEG-CORS01: preflight de PATCH em /faturas → PATCH listado ─
  // Regressão crítica: sem PATCH em Allow-Methods, o browser bloqueia
  // todas as edições em massa de fatura sem feedback visível.
  test("SEG-CORS01 — OPTIONS /faturas devolve PATCH em Allow-Methods", async () => {
    const res = await fetch(`${BASE_URL}/faturas`, {
      method: "OPTIONS",
      headers: {
        "Origin":                          "http://localhost:5173",
        "Access-Control-Request-Method":   "PATCH",
        "Access-Control-Request-Headers":  "authorization,content-type,apikey",
      },
    });
    expect(res.status).toBe(200);
    const allowMethods = res.headers.get("Access-Control-Allow-Methods") ?? "";
    expect(allowMethods.toUpperCase()).toContain("PATCH");
  });

  // ── SEG-CORS02: headers necessários liberados ────────────────
  test("SEG-CORS02 — OPTIONS libera Authorization, apikey, Content-Type", async () => {
    const res = await fetch(`${BASE_URL}/contas`, {
      method: "OPTIONS",
      headers: {
        "Origin":                          "http://localhost:5173",
        "Access-Control-Request-Method":   "GET",
        "Access-Control-Request-Headers":  "authorization,apikey,content-type",
      },
    });
    expect(res.status).toBe(200);
    const allowHeaders = (res.headers.get("Access-Control-Allow-Headers") ?? "").toLowerCase();
    expect(allowHeaders).toContain("authorization");
    expect(allowHeaders).toContain("apikey");
    expect(allowHeaders).toContain("content-type");
  });

  // ── SEG-CORS03: Allow-Methods também inclui GET/POST/PUT/DELETE ─
  // Garante que ninguém retirou métodos básicos numa próxima edição
  // do _shared/utils.ts.
  test("SEG-CORS03 — Allow-Methods inclui GET/POST/PUT/DELETE", async () => {
    const res = await fetch(`${BASE_URL}/contas`, { method: "OPTIONS" });
    const allow = (res.headers.get("Access-Control-Allow-Methods") ?? "").toUpperCase();
    for (const m of ["GET", "POST", "PUT", "DELETE", "OPTIONS"]) {
      expect(allow).toContain(m);
    }
  });
});
