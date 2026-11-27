// ============================================================
// Arquiteto de Valor — Edge Function: entrada_email (v8.0.0, fase 2)
// POST /entrada_email  — webhook do Resend (evento `email.received`), sem JWT.
//
// Segurança:
//  • assinatura Svix verificada sobre o corpo BRUTO (segredo RESEND_WEBHOOK_SECRET) — sem ela, 401;
//  • usuário resolvido pelo código secreto do destinatário (`apelido-codigo@entrada.…`);
//  • remetente fora da lista → QUARENTENA; remetente permitido SEM autenticação DKIM/DMARC válida
//    também vai para QUARENTENA (o campo From é falsificável);
//  • o corpo NÃO é guardado por padrão (só assunto/classificação; trecho curto apenas em quarentena).
//    Opt-in `guardar_corpo` (v8.2.0): guarda o texto higienizado só de remetentes PERMITIDOS, nunca em quarentena;
//  • service_role aqui é legítimo: não é rota de usuário, é webhook de sistema.
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { dbAdmin } from "../_shared/utils.ts";
import { logError } from "../_shared/logger.ts";
import { chamarProvedorIA, lerConfigIAAtiva } from "../_shared/ia.ts";
import {
  classificarMensagem, decidirRemetente, extrairEmail, higienizarTexto, MAX_RESUMOS_POR_DIA,
  montarPerguntaEmail, parsearDestinatario, parsearResumoEmail, PERSONA_RESUMO_EMAIL,
  verificarAssinaturaSvix, type RegraRemetente,
} from "./emailEntrada.ts";

const DOMINIO = (Deno.env.get("ENTRADA_EMAIL_DOMINIO") ?? "entrada.arquitetodevalor.com.br").toLowerCase();

interface PayloadRecebido {
  type?: string;
  data?: {
    email_id?: string; from?: string; to?: string[]; received_for?: string[];
    message_id?: string; subject?: string; created_at?: string;
  };
}
interface EmailCompleto {
  text?: string | null; html?: string | null;
  authentication?: { spf?: string; dkim?: string; dmarc?: string } | null;
}

const resp = (status: number, corpo: unknown = { ok: true }) =>
  new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

async function buscarEmail(emailId: string): Promise<EmailCompleto | null> {
  const chave = Deno.env.get("RESEND_API_KEY");
  if (!chave) return null;
  const r = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`, {
    headers: { Authorization: `Bearer ${chave}` },
  });
  return r.ok ? await r.json() as EmailCompleto : null;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return resp(405, { erro: "Método não permitido" });

  const segredo = Deno.env.get("RESEND_WEBHOOK_SECRET") ?? "";
  const corpo = await req.text();   // BRUTO: reserializar JSON quebraria a assinatura
  const valido = await verificarAssinaturaSvix(corpo, {
    id: req.headers.get("svix-id"), timestamp: req.headers.get("svix-timestamp"), signature: req.headers.get("svix-signature"),
  }, segredo);
  if (!valido) return resp(401, { erro: "Assinatura inválida" });

  let p: PayloadRecebido;
  try { p = JSON.parse(corpo); } catch { return resp(400, { erro: "JSON inválido" }); }
  const emailId = p.data?.email_id;
  if (p.type !== "email.received" || !p.data || !emailId) return resp(200, { ignorado: true });

  const d = p.data;
  const db = dbAdmin();

  // Destinatário → usuário. Respostas sempre 200 para não revelar se um código existe.
  let dono: { user_id: string; resumo_ia: boolean; guardar_corpo: boolean } | null = null;
  for (const para of [...(d.to ?? []), ...(d.received_for ?? [])]) {
    const dest = parsearDestinatario(para, DOMINIO);
    if (!dest) continue;
    const { data } = await db.from("inv_email_enderecos").select("user_id, resumo_ia, guardar_corpo")
      .eq("apelido", dest.apelido).eq("codigo", dest.codigo).eq("ativo", true).maybeSingle();
    if (data) { dono = data as { user_id: string; resumo_ia: boolean; guardar_corpo: boolean }; break; }
  }
  if (!dono) return resp(200, { ignorado: true });

  const remetente = extrairEmail(d.from ?? "") ?? "desconhecido";
  const messageId = (d.message_id ?? emailId).slice(0, 300);
  const assunto = higienizarTexto(d.subject ?? "", 300);

  const { data: regras } = await db.from("inv_email_remetentes").select("padrao,status").eq("user_id", dono.user_id);
  let decisao = remetente === "desconhecido" ? "QUARENTENA" : decidirRemetente(remetente, (regras ?? []) as RegraRemetente[]);

  if (decisao === "BLOQUEADO") {
    await db.from("inv_email_mensagens").upsert(
      { user_id: dono.user_id, message_id: messageId, remetente, assunto, recebido_em: d.created_at ?? new Date().toISOString(), status: "IGNORADO" },
      { onConflict: "user_id,message_id", ignoreDuplicates: true });
    return resp(200);
  }

  // Corpo: buscado na API (o webhook só traz metadados) e usado só em memória.
  const completo = await buscarEmail(emailId);
  const texto = higienizarTexto(completo?.text ?? completo?.html ?? "");
  const aut = completo?.authentication;
  // Remetente "permitido" só vale se o e-mail passou DKIM ou DMARC (anti-falsificação do From).
  if (decisao === "PERMITIDO" && !(aut?.dkim === "pass" || aut?.dmarc === "pass")) decisao = "QUARENTENA";

  const quarentena = decisao === "QUARENTENA";
  const { data: criadas } = await db.from("inv_email_mensagens").upsert({
    user_id: dono.user_id, message_id: messageId, remetente, assunto,
    recebido_em: d.created_at ?? new Date().toISOString(),
    status: quarentena ? "QUARENTENA" : "PROCESSADO",
    classificacao: classificarMensagem(assunto, texto),
    trecho: quarentena ? texto.slice(0, 600) : null,
    // Texto completo só se o usuário optou (guardar_corpo) e o remetente é permitido — nunca em quarentena.
    corpo: !quarentena && dono.guardar_corpo && texto ? texto : null,
  }, { onConflict: "user_id,message_id", ignoreDuplicates: true }).select("id");

  // Resumo por IA: só remetente PERMITIDO, só se a linha é nova (reenvio do webhook não gasta IA de novo),
  // só se o usuário não desligou e dentro do teto diário. Qualquer falha deixa a mensagem sem resumo.
  const novaId = (criadas as { id: string }[] | null)?.[0]?.id;
  if (novaId && !quarentena && dono.resumo_ia && texto) {
    try { await resumirComIA(db, dono.user_id, novaId, remetente, assunto, texto); }
    catch (e) { logError("Resumo por IA do e-mail de entrada", e); }
  }

  return resp(200);
});

async function resumirComIA(db: ReturnType<typeof dbAdmin>, userId: string, mensagemId: string, remetente: string, assunto: string, texto: string) {
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await db.from("inv_email_mensagens").select("id", { count: "exact", head: true })
    .eq("user_id", userId).not("resumo", "is", null).gte("created_at", desde);
  if ((count ?? 0) >= MAX_RESUMOS_POR_DIA) return;

  const cfg = await lerConfigIAAtiva(db, userId);
  if (!cfg.ok) return;   // sem IA configurada: segue só com a classificação por palavras-chave
  const bruto = await chamarProvedorIA(cfg.config.provedor, {
    apiKey: cfg.config.apiKey, persona: PERSONA_RESUMO_EMAIL, modelo: cfg.config.modelo ?? undefined,
    mensagens: [{ role: "user", content: montarPerguntaEmail(remetente, assunto, texto) }], maxTokens: 600, buscaWeb: false,
  });
  const r = parsearResumoEmail(bruto);
  if (!r) return;

  // Ticker citado que seja ativo do próprio usuário → liga a mensagem ao ativo.
  let ativoId: string | null = null;
  if (r.tickers.length > 0) {
    const { data: ativos } = await db.from("inv_ativos").select("id").eq("user_id", userId).in("ticker", r.tickers).limit(1);
    ativoId = (ativos as { id: string }[] | null)?.[0]?.id ?? null;
  }
  await db.from("inv_email_mensagens")
    .update({ resumo: r.resumo, classificacao: r.classificacao, ativo_id: ativoId })
    .eq("id", mensagemId).eq("user_id", userId);
}
