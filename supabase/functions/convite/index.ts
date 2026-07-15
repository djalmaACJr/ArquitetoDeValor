// ============================================================
// Arquiteto de Valor — Edge Function: convite v1
//
// Envia um convite por e-mail (via Brevo) para um amigo se cadastrar no
// app. Sem rastreamento: apenas dispara o e-mail com um link fixo de
// cadastro — não há tabela de convites nem status pendente/aceito.
//
// POST /convite
//   body: { email: string }
//   resp: { dados: { enviado: true } }
// ============================================================

import { autenticar, corsPreFlight, db, erro, json } from "../_shared/utils.ts";

const BREVO_API_KEY      = Deno.env.get("BREVO_API_KEY");
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "convites@arquitetodevalor.com.br";
// ALLOWED_ORIGIN pode ser uma lista separada por vírgulas (CORS multi-origem
// em _shared/utils.ts) — pega só o primeiro (produção) como base do link de
// cadastro, nunca a string toda.
const APP_URL = (Deno.env.get("ALLOWED_ORIGIN") ?? "https://arquiteto-de-valor.vercel.app")
  .split(",")[0]
  .trim()
  .replace(/\/$/, "");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight(req);
  const auth = await autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  if (req.method !== "POST") return erro("Use POST", 405, req);
  if (!BREVO_API_KEY) return erro("Envio de e-mail não configurado.", 500, req);

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return erro("JSON inválido", 400, req);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return erro("E-mail inválido.", 400, req);

  const cliente = db(req);
  const { data: usuario } = await cliente.from("usuarios").select("nome").eq("id", userId).single();
  const nomeConvidante = usuario?.nome?.trim() || "Um amigo";

  const linkCadastro = `${APP_URL}/cadastro`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
      <h2 style="color:#00c896;">Você foi convidado para o Arquiteto de Valor!</h2>
      <p><strong>${nomeConvidante}</strong> usa o Arquiteto de Valor para organizar as finanças e quer te convidar também.</p>
      <p style="margin: 24px 0;">
        <a href="${linkCadastro}" style="background:#00c896;color:#0a0f1a;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
          Criar minha conta grátis
        </a>
      </p>
      <p style="color:#888;font-size:13px;">Se você não esperava este e-mail, pode ignorá-lo.</p>
    </div>
  `;

  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender:      { name: "Arquiteto de Valor", email: BREVO_SENDER_EMAIL },
        to:          [{ email }],
        subject:     `${nomeConvidante} te convidou para o Arquiteto de Valor`,
        htmlContent: html,
      }),
    });
    if (!r.ok) {
      console.error("Erro Brevo:", r.status, await r.text());
      return erro("Não foi possível enviar o convite agora. Tente novamente.", 502, req);
    }
  } catch (e) {
    console.error("Falha de rede Brevo:", e);
    return erro("Não foi possível enviar o convite agora. Tente novamente.", 502, req);
  }

  return json({ dados: { enviado: true } }, 200, req);
});
