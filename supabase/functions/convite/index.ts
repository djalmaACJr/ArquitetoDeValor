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

import { autenticar, corsPreFlight, db, erro, json, registrarOrigem } from "../_shared/utils.ts";

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

// nomeConvidante vem de arqvalor.usuarios.nome (texto livre do usuário) —
// escapa antes de injetar no HTML do e-mail.
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Vitrine curta de recursos — mesmo conteúdo/tom de FrontEnd/src/pages/SobrePage.tsx,
// condensado para caber num e-mail.
const RECURSOS_EMAIL = [
  { emoji: "📊", titulo: "Dashboard",     texto: "Visão geral do mês: saldo, calendário e evolução." },
  { emoji: "🎯", titulo: "Objetivos",     texto: "Patrimônio e renda recorrente com progresso mês a mês." },
  { emoji: "📈", titulo: "Relatórios",    texto: "Receitas e despesas por categoria, em qualquer período." },
  { emoji: "💹", titulo: "Investimentos", texto: "Ativos, dividendos e evolução da carteira num só lugar." },
  { emoji: "🤖", titulo: "Mentor com IA", texto: "Converse com um mentor financeiro escolhido por você." },
];

Deno.serve(async (req: Request) => {
  registrarOrigem(req);
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = await autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  if (req.method !== "POST") return erro("Use POST", 405);
  if (!BREVO_API_KEY) return erro("Envio de e-mail não configurado.", 500);

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return erro("JSON inválido", 400);
  }

  const email = (body.email ?? "").trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) return erro("E-mail inválido.", 400);

  const cliente = db(req);
  const { data: usuario } = await cliente.from("usuarios").select("nome").eq("id", userId).single();
  const nomeConvidanteRaw = usuario?.nome?.trim() || "Um amigo";
  const nomeConvidante = escapeHtml(nomeConvidanteRaw);

  const linkCadastro = `${APP_URL}/cadastro`;

  const recursosHtml = RECURSOS_EMAIL.map(r => `
                <tr>
                  <td style="padding:8px 0; vertical-align:top; width:32px;">
                    <span style="font-size:18px;">${r.emoji}</span>
                  </td>
                  <td style="padding:8px 0 8px 8px; vertical-align:top;">
                    <p style="font-size:14px; font-weight:600; color:#ffffff; margin:0 0 2px 0;">${r.titulo}</p>
                    <p style="font-size:13px; line-height:1.5; color:#8b92a8; margin:0;">${r.texto}</p>
                  </td>
                </tr>`).join("");

  const html = `
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Você foi convidado · Arquiteto de Valor</title>
  </head>
  <body style="margin:0; padding:0; background-color:#0d1220; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0d1220; padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#111a2e; border:1px solid rgba(255,255,255,0.08); border-radius:16px; overflow:hidden;">
            <!-- Cabeçalho -->
            <tr>
              <td align="center" style="padding:36px 32px 8px 32px;">
                <div style="font-size:22px; font-weight:700; color:#ffffff;">Arquiteto de Valor</div>
                <div style="font-size:12px; letter-spacing:3px; color:#00c896; margin-top:6px;">CONTROLE FINANCEIRO PESSOAL</div>
              </td>
            </tr>

            <!-- Corpo -->
            <tr>
              <td style="padding:20px 36px 8px 36px;">
                <h1 style="font-size:20px; font-weight:600; color:#ffffff; margin:16px 0 12px 0;">Você foi convidado! 🎉</h1>
                <p style="font-size:15px; line-height:1.6; color:#c5cad8; margin:0 0 16px 0;">
                  <strong style="color:#ffffff;">${nomeConvidante}</strong> usa o Arquiteto de Valor para organizar
                  as finanças e achou que você também ia gostar.
                </p>
              </td>
            </tr>

            <!-- Vitrine de recursos -->
            <tr>
              <td style="padding:4px 36px 8px 36px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0d1220; border:1px solid rgba(255,255,255,0.06); border-radius:12px; padding:8px 16px;">
                  ${recursosHtml}
                </table>
              </td>
            </tr>

            <!-- Botão -->
            <tr>
              <td align="center" style="padding:24px 36px 28px 36px;">
                <a href="${linkCadastro}"
                   style="display:inline-block; background-color:#00c896; color:#0a0f1a; font-size:16px; font-weight:600; text-decoration:none; padding:14px 32px; border-radius:10px;">
                  Criar minha conta grátis
                </a>
              </td>
            </tr>

            <!-- Rodapé -->
            <tr>
              <td style="padding:20px 36px 32px 36px; border-top:1px solid rgba(255,255,255,0.06);">
                <p style="font-size:13px; line-height:1.6; color:#8b92a8; margin:0;">
                  Se você não esperava este e-mail, pode ignorá-lo com tranquilidade.
                </p>
              </td>
            </tr>
          </table>

          <p style="font-size:12px; color:#4a5168; margin:20px 0 0 0;">
            Arquiteto de Valor · BLUEPRINT
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

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
        subject:     `${nomeConvidanteRaw} te convidou para o Arquiteto de Valor`,
        htmlContent: html,
      }),
    });
    if (!r.ok) {
      console.error("Erro Brevo:", r.status, await r.text());
      return erro("Não foi possível enviar o convite agora. Tente novamente.", 502);
    }
  } catch (e) {
    console.error("Falha de rede Brevo:", e);
    return erro("Não foi possível enviar o convite agora. Tente novamente.", 502);
  }

  return json({ dados: { enviado: true } }, 200);
});
