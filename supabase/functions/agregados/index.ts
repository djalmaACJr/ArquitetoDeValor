// ============================================================
// Arquiteto de Valor — Edge Function: agregados v1
//
// Ciclo de vida de "usuários agregados" (conta conjunta): convidar,
// reenviar, revogar, aceitar, recusar, e definir permissões/contas
// liberadas para um agregado. Toda a lógica de autorização e transição de
// estado mora nas RPCs SECURITY DEFINER criadas em
// 20260930000001_agregados_fundacao.sql — este arquivo é
// deliberadamente um conjunto de wrappers finos em cima delas.
//
// Rotas:
//   GET  /agregados                     -- meus vínculos como dono
//   GET  /agregados/convites-recebidos  -- vínculos onde sou o convidado
//   GET  /agregados/:id                 -- detalhe (só o dono)
//   POST /agregados          {email}
//   POST /agregados/:id/reenviar
//   POST /agregados/:id/revogar
//   POST /agregados/:id/sair      -- o próprio agregado deixa de acessar o espaço
//   POST /agregados/aceitar  {token}
//   POST /agregados/recusar  {token}
//   PUT  /agregados/:id/permissoes {modulo, liberado, pode_escrever}
//   PUT  /agregados/:id/contas     {conta_ids: uuid[]}
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  json, erro, db, autenticar, extrairId, extrairAcao, corsPreFlight, comOrigem,
} from "../_shared/utils.ts";
import type { Db } from "../_shared/utils.ts";
import { logError, logRequest, logResponse } from "../_shared/logger.ts";

const BREVO_API_KEY      = Deno.env.get("BREVO_API_KEY");
const BREVO_SENDER_EMAIL = Deno.env.get("BREVO_SENDER_EMAIL") ?? "convites@arquitetodevalor.com.br";
const APP_URL = (Deno.env.get("ALLOWED_ORIGIN") ?? "https://arquiteto-de-valor.vercel.app")
  .split(",")[0].trim().replace(/\/$/, "");

const MODULOS = ["EXTRATO", "OBJETIVOS", "INVESTIMENTOS"] as const;
type Modulo = typeof MODULOS[number];

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Primeiro segmento do path logo após "agregados" — pode ser um UUID
// (vínculo) ou uma palavra-ação ("convites-recebidos", "aceitar",
// "recusar"). extrairId() só reconhece UUID, então usamos isto pra
// desambiguar rotas antes de chamar extrairId/extrairAcao.
function primeiroSegmento(req: Request): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf("agregados");
  if (idx === -1 || idx + 1 >= partes.length) return null;
  return partes[idx + 1];
}

// Mapeia o código no início da mensagem de exceção das RPCs (ex.:
// "CONVITE_PROPRIO: ...") para um status HTTP — mantém as mensagens
// definidas num só lugar (as funções SQL) em vez de duplicá-las aqui.
// Remove `token` de qualquer linha de `agregados` antes de devolver pro
// cliente — o token só deve existir dentro do link de e-mail (montado
// server-side em montarEmailConvite), nunca numa resposta de API lida pelo
// próprio dono logado (que poderia repassar/vazar o link sem querer).
function semToken<T extends { token?: unknown }>(v: T): Omit<T, "token"> {
  const { token: _token, ...resto } = v;
  return resto;
}

function statusDoErroRpc(mensagem: string): number {
  if (/NAO_ENCONTRADO/.test(mensagem)) return 404;
  if (/ACESSO_NEGADO/.test(mensagem)) return 403;
  // Throttling (Fase 5 — fn_convidar_agregado/fn_reenviar_convite_agregado)
  if (/LIMITE_CONVITES_EXCEDIDO|REENVIO_MUITO_RECENTE/.test(mensagem)) return 429;
  return 400;
}

async function enviarEmailBrevo(destinatario: string, assunto: string, html: string, texto: string): Promise<boolean> {
  if (!BREVO_API_KEY) { logError("agregados: Brevo não configurado", {}); return false; }
  try {
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        sender: { name: "Arquiteto de Valor", email: BREVO_SENDER_EMAIL },
        to: [{ email: destinatario }],
        subject: assunto,
        htmlContent: html,
        textContent: texto,
      }),
    });
    if (!r.ok) { logError("agregados: erro Brevo", { status: r.status, body: await r.text() }); return false; }
    return true;
  } catch (e) {
    logError("agregados: falha de rede Brevo", e);
    return false;
  }
}

// E-mail de convite — traz os DOIS links (já tenho conta / ainda não tenho),
// porque o backend nunca verifica se o e-mail já tem cadastro usando
// service_role só pra isso (seria usar privilégio administrativo em
// código de usuário comum, contra a convenção do projeto) — mais simples
// e igualmente claro deixar a pessoa escolher o caminho certo.
function montarEmailConvite(nomeDonoRaw: string, tokenLink: string) {
  const nomeDono = escapeHtml(nomeDonoRaw);
  const linkAceitar  = `${APP_URL}/aceitar-convite?token=${tokenLink}`;
  const linkCadastro = `${APP_URL}/cadastro?convite_token=${tokenLink}`;

  const texto = [
    "Você foi convidado para uma conta compartilhada!",
    "",
    `${nomeDonoRaw} te convidou para acessar dados dela(e) no Arquiteto de Valor, como uma conta conjunta.`,
    "",
    `Já tem uma conta? Entre e aceite o convite: ${linkAceitar}`,
    `Ainda não tem conta? Crie a sua (o convite já vem vinculado): ${linkCadastro}`,
    "",
    `Se não esperava este convite, pode ignorar este e-mail com tranquilidade.`,
  ].join("\n");

  const html = `
<!doctype html>
<html lang="pt-BR">
  <head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Convite para conta compartilhada · Arquiteto de Valor</title></head>
  <body style="margin:0; padding:0; background-color:#0d1220; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0d1220; padding:32px 16px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px; background-color:#111a2e; border:1px solid rgba(255,255,255,0.08); border-radius:16px; overflow:hidden;">
          <tr><td align="center" style="padding:36px 32px 8px 32px;">
            <div style="font-size:22px; font-weight:700; color:#ffffff;">Arquiteto de Valor</div>
            <div style="font-size:12px; letter-spacing:3px; color:#00c896; margin-top:6px;">CONTROLE FINANCEIRO PESSOAL</div>
          </td></tr>
          <tr><td style="padding:20px 36px 8px 36px;">
            <h1 style="font-size:20px; font-weight:600; color:#ffffff; margin:16px 0 12px 0;">Convite para conta compartilhada 🤝</h1>
            <p style="font-size:15px; line-height:1.6; color:#c5cad8; margin:0 0 16px 0;">
              <strong style="color:#ffffff;">${nomeDono}</strong> te convidou para acessar dados dela(e) no
              Arquiteto de Valor, como uma conta conjunta — contas, objetivos e investimentos específicos que
              ela(e) escolher.
            </p>
          </td></tr>
          <tr><td align="center" style="padding:12px 36px 8px 36px;">
            <a href="${linkAceitar}" style="display:block; background-color:#00c896; color:#0a0f1a; font-size:16px; font-weight:600; text-decoration:none; padding:14px 32px; border-radius:10px; margin-bottom:12px;">
              Já tenho conta — entrar e aceitar
            </a>
            <a href="${linkCadastro}" style="display:block; background-color:transparent; border:1px solid rgba(255,255,255,0.2); color:#ffffff; font-size:16px; font-weight:600; text-decoration:none; padding:13px 32px; border-radius:10px;">
              Ainda não tenho conta — criar conta
            </a>
          </td></tr>
          <tr><td style="padding:20px 36px 32px 36px; border-top:1px solid rgba(255,255,255,0.06); margin-top:16px;">
            <p style="font-size:13px; line-height:1.6; color:#8b92a8; margin:16px 0 0 0;">
              Se não esperava este convite, pode ignorá-lo com tranquilidade — nenhum acesso foi concedido
              automaticamente.
            </p>
          </td></tr>
        </table>
        <p style="font-size:12px; color:#4a5168; margin:20px 0 0 0;">Arquiteto de Valor · BLUEPRINT</p>
      </td></tr>
    </table>
  </body>
</html>`;

  return { assunto: `${nomeDonoRaw} te convidou para uma conta compartilhada`, html, texto };
}

Deno.serve((req: Request) => comOrigem(req, async () => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = await autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const m = req.method;
  const c = db(req);
  const seg1 = primeiroSegmento(req);
  const id = extrairId(req, "agregados");
  const acao = extrairAcao(req, "agregados");

  try {
    if (m === "GET"  && !seg1)                         return await listarComoDonos(c, userId);
    if (m === "GET"  && seg1 === "convites-recebidos")  return await listarComoAgregado(c);
    if (m === "GET"  && id)                             return await detalhar(c, userId, id);
    if (m === "POST" && !seg1)                          return await convidar(c, userId, await req.json());
    if (m === "POST" && seg1 === "aceitar")             return await aceitar(c, await req.json());
    if (m === "POST" && seg1 === "recusar")             return await recusar(c, await req.json());
    if (m === "POST" && id && acao === "reenviar")      return await reenviar(c, id);
    if (m === "POST" && id && acao === "revogar")       return await revogar(c, id);
    if (m === "POST" && id && acao === "sair")          return await sair(c, id);
    if (m === "POST" && id && acao === "aceitar")       return await aceitarPorId(c, id);
    if (m === "POST" && id && acao === "recusar")       return await recusarPorId(c, id);
    if (m === "PUT"  && id && acao === "permissoes")    return await definirPermissoes(c, id, await req.json());
    if (m === "PUT"  && id && acao === "contas")        return await definirContas(c, id, await req.json());
    return erro("Rota não encontrada", 404);
  } catch (e) {
    logError("agregados: handler principal", e);
    return erro("Erro interno", 500);
  }
}));

async function listarComoDonos(c: Db, userId: string) {
  logRequest("GET", "/agregados");
  const { data, error } = await c
    .from("agregados")
    .select("*, agregados_permissoes(*), agregados_contas(*)")
    .eq("dono_id", userId)
    .order("criado_em", { ascending: false });
  if (error) { logError("listarComoDonos", error); return erro(error.message); }
  // Nome de cada agregado (RPC SECURITY DEFINER — só o nome, ver migration
  // 20261006000011). Falha aqui não derruba a listagem: a tela cai pro e-mail.
  const { data: nomes, error: erroNomes } = await c.rpc("fn_nomes_dos_meus_agregados");
  if (erroNomes) logError("listarComoDonos (nomes)", erroNomes);
  const nomePorVinculo = new Map<string, string | null>(
    ((nomes ?? []) as { vinculo_id: string; nome: string | null }[]).map((n) => [n.vinculo_id, n.nome]),
  );
  logResponse(200, { count: data?.length });
  return json({
    dados: (data ?? []).map((v) => ({ ...semToken(v), agregado_nome: nomePorVinculo.get(v.id) ?? null })),
  });
}

async function listarComoAgregado(c: Db) {
  logRequest("GET", "/agregados/convites-recebidos");
  const { data, error } = await c.rpc("fn_meus_vinculos_como_agregado");
  if (error) { logError("listarComoAgregado", error); return erro(error.message); }
  logResponse(200, { count: data?.length });
  return json({ dados: (data ?? []).map(semToken) });
}

async function detalhar(c: Db, userId: string, id: string) {
  logRequest("GET", `/agregados/${id}`);
  const { data, error } = await c
    .from("agregados")
    .select("*, agregados_permissoes(*), agregados_contas(*)")
    .eq("id", id).eq("dono_id", userId)
    .single();
  if (error || !data) { logResponse(404); return erro("Vínculo não encontrado", 404); }
  logResponse(200);
  return json({ dados: semToken(data) });
}

async function convidar(c: Db, userId: string, body: { email?: string }) {
  logRequest("POST", "/agregados", body);
  const email = (body?.email ?? "").trim().toLowerCase();
  if (!email) return erro("email é obrigatório");

  const { data: vinc, error } = await c.rpc("fn_convidar_agregado", { p_email: email });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }

  const { data: dono } = await c.from("usuarios").select("nome").eq("id", userId).single();
  const nomeDono = dono?.nome?.trim() || "Alguém";
  const { assunto, html, texto } = montarEmailConvite(nomeDono, vinc.token);
  const enviado = await enviarEmailBrevo(email, assunto, html, texto);

  logResponse(201, { id: vinc.id, enviado });
  return json({ dados: { ...semToken(vinc), email_enviado: enviado } }, 201);
}

async function reenviar(c: Db, id: string) {
  logRequest("POST", `/agregados/${id}/reenviar`);
  const { data: vinc, error } = await c.rpc("fn_reenviar_convite_agregado", { p_vinculo_id: id });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }

  const { data: dono } = await c.from("usuarios").select("nome").eq("id", vinc.dono_id).single();
  const nomeDono = dono?.nome?.trim() || "Alguém";
  const { assunto, html, texto } = montarEmailConvite(nomeDono, vinc.token);
  const enviado = await enviarEmailBrevo(vinc.email_convidado, assunto, html, texto);

  logResponse(200, { id: vinc.id, enviado });
  return json({ dados: { ...semToken(vinc), email_enviado: enviado } });
}

async function revogar(c: Db, id: string) {
  logRequest("POST", `/agregados/${id}/revogar`);
  const { error } = await c.rpc("fn_revogar_agregado", { p_vinculo_id: id });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }
  logResponse(200);
  return json({ dados: { revogado: true } });
}

async function sair(c: Db, id: string) {
  logRequest("POST", `/agregados/${id}/sair`);
  const { error } = await c.rpc("fn_sair_agregado", { p_vinculo_id: id });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }
  logResponse(200);
  return json({ dados: { saiu: true } });
}

async function aceitar(c: Db, body: { token?: string }) {
  logRequest("POST", "/agregados/aceitar");
  if (!body?.token) return erro("token é obrigatório");
  const { data, error } = await c.rpc("fn_aceitar_convite_agregado", { p_token: body.token });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }
  logResponse(200, { id: data?.id });
  return json({ dados: semToken(data) });
}

async function recusar(c: Db, body: { token?: string }) {
  logRequest("POST", "/agregados/recusar");
  if (!body?.token) return erro("token é obrigatório");
  const { error } = await c.rpc("fn_recusar_convite_agregado", { p_token: body.token });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }
  logResponse(200);
  return json({ dados: { recusado: true } });
}

// Variantes por ID (sem token) — usadas pela tela "Convites que recebi"
// (CompartilhamentoPage), que lista vínculos via fn_meus_vinculos_como_agregado()
// e por isso nunca tem o token em mãos (só existe dentro do link de e-mail).
async function aceitarPorId(c: Db, id: string) {
  logRequest("POST", `/agregados/${id}/aceitar`);
  const { data, error } = await c.rpc("fn_aceitar_convite_agregado_por_id", { p_vinculo_id: id });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }
  logResponse(200, { id: data?.id });
  return json({ dados: semToken(data) });
}

async function recusarPorId(c: Db, id: string) {
  logRequest("POST", `/agregados/${id}/recusar`);
  const { error } = await c.rpc("fn_recusar_convite_agregado_por_id", { p_vinculo_id: id });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }
  logResponse(200);
  return json({ dados: { recusado: true } });
}

async function definirPermissoes(
  c: Db, id: string, body: { modulo?: string; liberado?: boolean; pode_escrever?: boolean },
) {
  logRequest("PUT", `/agregados/${id}/permissoes`, body);
  const modulo = body?.modulo as Modulo;
  if (!MODULOS.includes(modulo)) return erro(`modulo deve ser um de: ${MODULOS.join(" | ")}`);
  if (typeof body?.liberado !== "boolean") return erro("liberado (boolean) é obrigatório");

  const { error } = await c.rpc("fn_definir_permissoes_agregado", {
    p_vinculo_id: id, p_modulo: modulo, p_liberado: body.liberado, p_pode_escrever: !!body.pode_escrever,
  });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }
  logResponse(200);
  return json({ dados: { atualizado: true } });
}

async function definirContas(c: Db, id: string, body: { conta_ids?: string[] }) {
  logRequest("PUT", `/agregados/${id}/contas`, body);
  if (!Array.isArray(body?.conta_ids)) return erro("conta_ids deve ser um array");

  const { error } = await c.rpc("fn_definir_contas_agregado", {
    p_vinculo_id: id, p_conta_ids: body.conta_ids,
  });
  if (error) { logResponse(statusDoErroRpc(error.message)); return erro(error.message, statusDoErroRpc(error.message)); }
  logResponse(200);
  return json({ dados: { atualizado: true } });
}
