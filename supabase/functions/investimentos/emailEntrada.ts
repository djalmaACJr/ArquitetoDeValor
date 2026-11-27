// ============================================================
// /investimentos/email-entrada — caixa de entrada por e-mail (v8.0.0, fase 2). Rotas do PRÓPRIO usuário (RLS).
// A entrada de mensagens é feita pela Edge Function `entrada_email` (webhook do Resend); aqui o usuário
// só gerencia o endereço, a retenção, os remetentes e as mensagens.
//   GET    /email-entrada                      endereço + remetentes + mensagens
//   POST   /email-entrada/endereco {apelido}   cria o endereço (uma vez)
//   POST   /email-entrada/renovar              novo código (o endereço antigo deixa de funcionar)
//   PUT    /email-entrada/config {ativo?, retencao_dias?, resumo_ia?, guardar_corpo?, abrir_no_gmail?}
//   GET    /email-entrada/mensagens/:id/corpo  texto completo (só existe com guardar_corpo ligado — v8.2.0)
//   POST   /email-entrada/remetentes {padrao, status?}
//   DELETE /email-entrada/remetentes/:id
//   PUT    /email-entrada/mensagens/:id {acao: 'aprovar'|'bloquear'|'visto'}
//   DELETE /email-entrada/mensagens/:id
// ============================================================
import { json, erro } from "../_shared/utils.ts";
import { logError } from "../_shared/logger.ts";
import type { Db } from "./shared.ts";

const DOMINIO = (Deno.env.get("ENTRADA_EMAIL_DOMINIO") ?? "entrada.arquitetodevalor.com.br").toLowerCase();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PADRAO = /^[a-z0-9._%+-]*@[a-z0-9.-]+\.[a-z]{2,}$/;
const RETENCAO_MIN = 7, RETENCAO_MAX = 365;

const COLS_ENDERECO = "apelido, codigo, ativo, retencao_dias, resumo_ia, guardar_corpo, abrir_no_gmail";
interface Endereco { apelido: string; codigo: string; ativo: boolean; retencao_dias: number; resumo_ia: boolean; guardar_corpo: boolean; abrir_no_gmail: boolean }
const comEmail = (e: Endereco) => ({ ...e, email: `${e.apelido}-${e.codigo}@${DOMINIO}` });

export async function rotaEmailEntrada(c: Db, req: Request, m: string, userId: string): Promise<Response> {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const i = partes.indexOf("email-entrada");
  const sub = partes[i + 1] ?? "";
  const id = partes[i + 2] ?? "";

  if (m === "GET" && sub === "") {
    const [end, rem, msg] = await Promise.all([
      c.from("inv_email_enderecos").select(COLS_ENDERECO).eq("user_id", userId).maybeSingle(),
      c.from("inv_email_remetentes").select("id, padrao, status, origem, created_at").eq("user_id", userId).order("padrao"),
      c.from("inv_email_mensagens").select("id, message_id, remetente, assunto, recebido_em, status, classificacao, resumo, trecho, tem_corpo, visto_em, ativo_id, inv_ativos(ticker)")
        .eq("user_id", userId).order("recebido_em", { ascending: false }).limit(100),
    ]);
    const falha = end.error ?? rem.error ?? msg.error;
    if (falha) { logError("Listar caixa de entrada", falha); return erro(falha.message); }
    return json({ dados: { endereco: end.data ? comEmail(end.data as Endereco) : null, remetentes: rem.data ?? [], mensagens: msg.data ?? [] } });
  }

  if (m === "POST" && sub === "endereco") {
    const body = await req.json().catch(() => ({}));
    const { error } = await c.rpc("fn_email_criar_endereco", { p_apelido: String(body.apelido ?? "") });
    if (error) return erro(error.message.includes("APELIDO_INVALIDO") ? "Use de 3 a 20 letras minúsculas e números." : error.message);
    const { data } = await c.from("inv_email_enderecos").select(COLS_ENDERECO).eq("user_id", userId).maybeSingle();
    return json({ dados: data ? comEmail(data as Endereco) : null }, 201);
  }

  if (m === "POST" && sub === "renovar") {
    const { error } = await c.rpc("fn_email_renovar_codigo");
    if (error) return erro(error.message);
    const { data } = await c.from("inv_email_enderecos").select(COLS_ENDERECO).eq("user_id", userId).maybeSingle();
    return json({ dados: data ? comEmail(data as Endereco) : null });
  }

  if (m === "PUT" && sub === "config") {
    const body = await req.json().catch(() => ({}));
    const upd: Record<string, unknown> = {};
    if (body.ativo !== undefined) upd.ativo = body.ativo === true;
    if (body.resumo_ia !== undefined) upd.resumo_ia = body.resumo_ia === true;
    if (body.guardar_corpo !== undefined) upd.guardar_corpo = body.guardar_corpo === true;
    if (body.abrir_no_gmail !== undefined) upd.abrir_no_gmail = body.abrir_no_gmail === true;
    if (body.retencao_dias !== undefined) {
      const d = Number(body.retencao_dias);
      if (!Number.isInteger(d) || d < RETENCAO_MIN || d > RETENCAO_MAX) return erro(`Retenção deve ser de ${RETENCAO_MIN} a ${RETENCAO_MAX} dias.`);
      upd.retencao_dias = d;
    }
    if (Object.keys(upd).length === 0) return erro("Nada para alterar");
    const { data, error } = await c.from("inv_email_enderecos").update(upd).eq("user_id", userId)
      .select(COLS_ENDERECO).maybeSingle();
    if (error) return erro(error.message);
    if (!data) return erro("Crie o endereço de e-mail primeiro", 404);
    // Desligar "guardar o texto" apaga os corpos já guardados (a promessa de privacidade vale retroativamente).
    if (upd.guardar_corpo === false) {
      const { error: eLimpa } = await c.from("inv_email_mensagens").update({ corpo: null }).eq("user_id", userId).not("corpo", "is", null);
      if (eLimpa) return erro(eLimpa.message);
    }
    return json({ dados: comEmail(data as Endereco) });
  }

  if (m === "POST" && sub === "remetentes") {
    const body = await req.json().catch(() => ({}));
    const padrao = String(body.padrao ?? "").trim().toLowerCase();
    if (!PADRAO.test(padrao)) return erro("Informe um e-mail (a@b.com) ou um domínio (@b.com.br).");
    const status = body.status === "BLOQUEADO" ? "BLOQUEADO" : "PERMITIDO";
    const { data, error } = await c.from("inv_email_remetentes")
      .upsert({ user_id: userId, padrao, status, origem: "USUARIO" }, { onConflict: "user_id,padrao" }).select().maybeSingle();
    if (error) return erro(error.message);
    return json({ dados: data }, 201);
  }

  if (m === "DELETE" && sub === "remetentes" && UUID.test(id)) {
    const { error } = await c.from("inv_email_remetentes").delete().eq("id", id).eq("user_id", userId);
    if (error) return erro(error.message);
    return json({ mensagem: "Remetente removido" });
  }

  if (m === "GET" && sub === "mensagens" && UUID.test(id) && partes[i + 3] === "corpo") {
    const { data, error } = await c.from("inv_email_mensagens").select("corpo").eq("id", id).eq("user_id", userId).maybeSingle();
    if (error) return erro(error.message);
    if (!data) return erro("Mensagem não encontrada", 404);
    return json({ dados: { corpo: (data as { corpo: string | null }).corpo } });
  }

  if (m === "PUT" && sub === "mensagens" && UUID.test(id)) {
    const body = await req.json().catch(() => ({}));
    const agora = new Date().toISOString();
    if (body.acao === "visto") {
      const { error } = await c.from("inv_email_mensagens").update({ visto_em: agora }).eq("id", id).eq("user_id", userId);
      return error ? erro(error.message) : json({ mensagem: "ok" });
    }
    if (body.acao !== "aprovar" && body.acao !== "bloquear") return erro("Ação inválida");
    const { data: msg } = await c.from("inv_email_mensagens").select("id, remetente").eq("id", id).eq("user_id", userId).maybeSingle();
    if (!msg) return erro("Mensagem não encontrada", 404);
    const padrao = String(msg.remetente).toLowerCase();
    if (!PADRAO.test(padrao)) return erro("Remetente desconhecido: não é possível criar regra.");
    const aprovar = body.acao === "aprovar";
    const { error: e1 } = await c.from("inv_email_remetentes")
      .upsert({ user_id: userId, padrao, status: aprovar ? "PERMITIDO" : "BLOQUEADO", origem: "APROVADO" }, { onConflict: "user_id,padrao" });
    if (e1) return erro(e1.message);
    // Aprovada: sai da quarentena (o trecho curto deixa de ser necessário). Bloqueada: ignorada.
    const { error: e2 } = await c.from("inv_email_mensagens")
      .update({ status: aprovar ? "PROCESSADO" : "IGNORADO", trecho: null, visto_em: agora }).eq("id", id).eq("user_id", userId);
    return e2 ? erro(e2.message) : json({ mensagem: aprovar ? "Remetente aprovado" : "Remetente bloqueado" });
  }

  if (m === "DELETE" && sub === "mensagens" && UUID.test(id)) {
    const { error } = await c.from("inv_email_mensagens").delete().eq("id", id).eq("user_id", userId);
    if (error) return erro(error.message);
    return json({ mensagem: "Mensagem excluída" });
  }

  return erro("Rota não encontrada", 404);
}
