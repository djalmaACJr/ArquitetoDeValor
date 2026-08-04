// supabase/functions/investimentos/posicoes.ts
// Rotas /investimentos/posicoes e /investimentos/operacoes (extraído de index.ts).
import {
  json, erro, extrairId, verificarExistencia, camposParaAtualizar,
} from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import { Db, STATUS_POSICAO, TIPOS_OPERACAO, contaExiste, ativoExiste, hojeISO } from "./shared.ts";

export async function rotaPosicoes(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "posicoes");

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/posicoes", { params: Object.fromEntries(params) });
    let q = c.from("inv_posicoes")
      .select("*, inv_ativos(ticker, nome, tipo_ativo), contas(nome)")
      .order("data_compra", { ascending: false });
    const ativoId = params.get("ativo_id");
    const contaId = params.get("conta_id");
    const status  = params.get("status");
    if (ativoId) q = q.eq("ativo_id", ativoId);
    if (contaId) q = q.eq("conta_id", contaId);
    if (status && STATUS_POSICAO.includes(status)) q = q.eq("status", status);
    const { data, error } = await q;
    if (error) { logError("Listar posicoes", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/posicoes", body);

    if (!body.ativo_id || !body.conta_id || body.quantidade == null || body.preco_custo == null || !body.data_compra) {
      return erro("Campos obrigatórios: ativo_id, conta_id, quantidade, preco_custo, data_compra");
    }
    if (!(await ativoExiste(c, body.ativo_id))) return erro("Ativo não encontrado", 404);
    if (!(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);

    const qtd   = Number(body.quantidade);
    const preco = Number(body.preco_custo);
    if (!Number.isFinite(qtd) || qtd < 0)   return erro("quantidade deve ser >= 0");
    if (!Number.isFinite(preco) || preco < 0) return erro("preco_custo deve ser >= 0");
    if (body.status && !STATUS_POSICAO.includes(String(body.status))) {
      return erro(`status inválido: ${STATUS_POSICAO.join(" | ")}`);
    }

    // valor_custo é recalculado pelo trigger fn_inv_posicao_valor_custo
    const { data, error } = await c.from("inv_posicoes").insert({
      user_id:     userId,
      ativo_id:    body.ativo_id,
      conta_id:    body.conta_id,
      quantidade:  qtd,
      preco_custo: preco,
      data_compra: String(body.data_compra),
      status:      body.status ?? "ATIVA",
    }).select().single();
    if (error) { logError("Criar posicao", error); return erro(error.message); }
    logSuccess("Posição criada", { id: data.id });
    return json({ dados: data }, 201);
  }

  if (m === "PUT" && id) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/posicoes/${id}`, body);
    const naoEncontrado = await verificarExistencia(c, "inv_posicoes", id, "Posição não encontrada");
    if (naoEncontrado) return naoEncontrado;

    if (body.conta_id && !(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);
    if (body.ativo_id && !(await ativoExiste(c, body.ativo_id))) return erro("Ativo não encontrado", 404);
    if (body.status && !STATUS_POSICAO.includes(String(body.status))) {
      return erro(`status inválido: ${STATUS_POSICAO.join(" | ")}`);
    }

    const campos = camposParaAtualizar(body, [
      "ativo_id", "conta_id", "quantidade", "preco_custo", "data_compra", "status",
    ]);
    const { data, error } = await c.from("inv_posicoes").update(campos).eq("id", id).select().single();
    if (error) { logError("Editar posicao", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/posicoes/${id}`);
    const naoEncontrado = await verificarExistencia(c, "inv_posicoes", id, "Posição não encontrada");
    if (naoEncontrado) return naoEncontrado;
    // inv_operacoes referencia posicao com ON DELETE CASCADE — operações somem junto.
    const { error } = await c.from("inv_posicoes").delete().eq("id", id);
    if (error) { logError("Excluir posicao", error); return erro(error.message); }
    return json({ mensagem: "Posição excluída com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

// ============================================================
// /investimentos/operacoes
// ============================================================

export async function rotaOperacoes(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "operacoes");

  if (m === "GET") {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/operacoes", { params: Object.fromEntries(params) });
    let q = c.from("inv_operacoes").select("*").order("data_operacao", { ascending: false });
    const posicaoId = params.get("posicao_id");
    const ativoId   = params.get("ativo_id");
    if (posicaoId) q = q.eq("posicao_id", posicaoId);
    if (ativoId) {
      // inv_operacoes não tem ativo_id direto — resolve via posições do
      // ativo (RLS de inv_posicoes já escopa por user_id). Evita trazer as
      // operações de TODOS os ativos só para filtrar no cliente.
      const { data: pos, error: errPos } = await c.from("inv_posicoes")
        .select("id").eq("ativo_id", ativoId);
      if (errPos) { logError("Listar operacoes (posicoes do ativo)", errPos); return erro(errPos.message); }
      const posIds = (pos ?? []).map((p) => p.id);
      if (posIds.length === 0) return json({ dados: [] });
      q = q.in("posicao_id", posIds);
    }
    const { data, error } = await q;
    if (error) { logError("Listar operacoes", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST") {
    const body = await req.json();
    logRequest("POST", "/investimentos/operacoes", body);

    if (!body.tipo_operacao || body.quantidade == null || !body.data_operacao) {
      return erro("Campos obrigatórios: tipo_operacao, quantidade, data_operacao");
    }
    if (!TIPOS_OPERACAO.includes(String(body.tipo_operacao))) {
      return erro(`tipo_operacao inválido: ${TIPOS_OPERACAO.join(" | ")}`);
    }
    const qtd   = Number(body.quantidade);
    const preco = body.preco_unitario != null ? Number(body.preco_unitario) : 0;
    if (!Number.isFinite(qtd) || qtd < 0)     return erro("quantidade deve ser >= 0");
    if (!Number.isFinite(preco) || preco < 0) return erro("preco_unitario deve ser >= 0");
    const valorTotal = body.valor_total != null ? Number(body.valor_total) : qtd * preco;

    // A operação mantém a posição. Resolve a posição por posicao_id (compat) ou
    // find-or-create pelo par (ativo, conta) — a posição é a soma das operações.
    let posicaoId: string;
    let contaId: string;
    if (body.posicao_id) {
      const { data: pos } = await c.from("inv_posicoes").select("id, conta_id").eq("id", String(body.posicao_id)).maybeSingle();
      if (!pos) return erro("Posição não encontrada", 404);
      posicaoId = String(pos.id); contaId = String(pos.conta_id);
    } else {
      if (!body.ativo_id || !body.conta_id) return erro("Informe posicao_id ou (ativo_id e conta_id)");
      if (!(await ativoExiste(c, String(body.ativo_id)))) return erro("Ativo não encontrado", 404);
      if (!(await contaExiste(c, String(body.conta_id)))) return erro("Conta não encontrada", 404);
      contaId = String(body.conta_id);
      const resolved = await acharOuCriarPosicao(c, userId, String(body.ativo_id), contaId, String(body.data_operacao));
      if (resolved instanceof Response) return resolved;
      posicaoId = resolved;
    }

    const { data, error } = await c.from("inv_operacoes").insert({
      user_id:        userId,
      posicao_id:     posicaoId,
      tipo_operacao:  body.tipo_operacao,
      conta_id:       contaId,
      quantidade:     qtd,
      preco_unitario: preco,
      valor_total:    valorTotal,
      data_operacao:  String(body.data_operacao),
    }).select().single();
    if (error) { logError("Criar operacao", error); return erro(error.message); }
    await recomputarPosicao(c, posicaoId);
    logSuccess("Operação criada", { id: data.id });
    return json({ dados: data }, 201);
  }

  if (m === "PUT" && id) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/operacoes/${id}`, body);
    const naoEncontrado = await verificarExistencia(c, "inv_operacoes", id, "Operação não encontrada");
    if (naoEncontrado) return naoEncontrado;

    if (body.tipo_operacao && !TIPOS_OPERACAO.includes(String(body.tipo_operacao))) {
      return erro(`tipo_operacao inválido: ${TIPOS_OPERACAO.join(" | ")}`);
    }
    if (body.posicao_id) {
      const posExiste = await verificarExistencia(c, "inv_posicoes", String(body.posicao_id), "Posição não encontrada");
      if (posExiste) return posExiste;
    }
    if (body.conta_id && !(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);
    if (body.quantidade != null) {
      const qtd = Number(body.quantidade);
      if (!Number.isFinite(qtd) || qtd < 0) return erro("quantidade deve ser >= 0");
    }
    if (body.preco_unitario != null) {
      const preco = Number(body.preco_unitario);
      if (!Number.isFinite(preco) || preco < 0) return erro("preco_unitario deve ser >= 0");
    }

    // Estado anterior: posição dona (pode mudar) e qtd/preço (p/ recompor valor_total)
    const { data: antes } = await c.from("inv_operacoes")
      .select("posicao_id, quantidade, preco_unitario").eq("id", id).maybeSingle();

    const campos = camposParaAtualizar(body, [
      "posicao_id", "tipo_operacao", "conta_id", "quantidade", "preco_unitario", "valor_total", "data_operacao",
    ]);
    // valor_total derivado quando qtd/preço mudaram e não foi enviado explicitamente.
    if (campos.valor_total == null && (campos.quantidade != null || campos.preco_unitario != null)) {
      const q = campos.quantidade     != null ? Number(campos.quantidade)     : Number(antes?.quantidade)     || 0;
      const p = campos.preco_unitario != null ? Number(campos.preco_unitario) : Number(antes?.preco_unitario) || 0;
      campos.valor_total = q * p;
    }

    const { data, error } = await c.from("inv_operacoes").update(campos).eq("id", id).select().single();
    if (error) { logError("Editar operacao", error); return erro(error.message); }

    const posAfetadas = new Set<string>();
    if (antes?.posicao_id) posAfetadas.add(String(antes.posicao_id));
    if (data?.posicao_id)  posAfetadas.add(String(data.posicao_id));
    for (const pid of posAfetadas) await recomputarPosicao(c, pid);
    return json({ dados: data });
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/operacoes/${id}`);
    const { data: op } = await c.from("inv_operacoes").select("posicao_id").eq("id", id).maybeSingle();
    if (!op) return erro("Operação não encontrada", 404);
    const { error } = await c.from("inv_operacoes").delete().eq("id", id);
    if (error) { logError("Excluir operacao", error); return erro(error.message); }
    await recomputarPosicao(c, String(op.posicao_id));
    return json({ mensagem: "Operação excluída com sucesso" });
  }

  return erro("Método não permitido", 405);
}

// Posição ATIVA do par (ativo, conta) — reusa a existente (ATIVA ou ENCERRADA)
// ou cria uma vazia (qtd 0) que será preenchida por recomputarPosicao.
export async function acharOuCriarPosicao(
  c: Db, userId: string, ativoId: string, contaId: string, dataOp: string,
): Promise<string | Response> {
  const { data: existentes } = await c.from("inv_posicoes")
    .select("id, status").eq("ativo_id", ativoId).eq("conta_id", contaId);
  const ativa = (existentes ?? []).find((p) => p.status === "ATIVA");
  if (ativa) return String(ativa.id);
  const qualquer = (existentes ?? [])[0];
  if (qualquer) return String(qualquer.id);
  const { data, error } = await c.from("inv_posicoes").insert({
    user_id: userId, ativo_id: ativoId, conta_id: contaId,
    quantidade: 0, preco_custo: 0, data_compra: dataOp, status: "ATIVA",
  }).select("id").single();
  if (error) { logError("Criar posição (operação)", error); return erro(error.message); }
  return String(data.id);
}

// Recalcula a posição como a SOMA das suas operações (custo médio ponderado).
// Compra/Aporte somam; Venda/Resgate abatem mantendo o preço médio; ao zerar a
// quantidade a posição vira ENCERRADA. valor_custo é recalculado pelo trigger.
//
// Operações com data FUTURA (data_operacao > hoje) NÃO afetam o saldo atual —
// ficam "programadas" (ex.: resgate agendado no vencimento da renda fixa) e só
// passam a valer quando a data chega (um recompute futuro as aplica).
export async function recomputarPosicao(c: Db, posicaoId: string): Promise<void> {
  const { data: ops, error } = await c.from("inv_operacoes")
    .select("tipo_operacao, quantidade, preco_unitario, data_operacao, created_at")
    .eq("posicao_id", posicaoId)
    .order("data_operacao", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) { logError("Recomputar posição (ler operações)", error); return; }

  const hoje = hojeISO();
  let qtd = 0, custo = 0, precoMedio = 0;
  let dataCompra: string | null = null;
  let ultimaDataAplicada: string | null = null;
  for (const o of ops ?? []) {
    if (String(o.data_operacao) > hoje) continue; // operação programada (futura)
    const q = Number(o.quantidade) || 0;
    const p = Number(o.preco_unitario) || 0;
    const tipo = String(o.tipo_operacao);
    if (tipo === "COMPRA" || tipo === "APORTE") {
      qtd += q; custo += q * p;
      if (!dataCompra) dataCompra = String(o.data_operacao);
    } else if (tipo === "VENDA" || tipo === "RESGATE") {
      const media = qtd > 0 ? custo / qtd : 0;
      const remover = qtd > 0 ? Math.min(q, qtd) : 0;
      custo -= remover * media; qtd -= remover;
      if (qtd < 0) qtd = 0;
    } else if (tipo === "RENDIMENTO") {
      // Yield em tokens: aumenta a quantidade sem custo (token grátis) →
      // derruba o preço médio. O ganho vira valorização (qtd × preço).
      qtd += q;
    }
    // DIVIDENDO: não altera a posição
    if (qtd > 0) precoMedio = custo / qtd;
    ultimaDataAplicada = String(o.data_operacao);
  }

  const { data: pos } = await c.from("inv_posicoes").select("data_compra, ativo_id, conta_id").eq("id", posicaoId).maybeSingle();
  const campos = {
    quantidade:  qtd,
    preco_custo: precoMedio,
    data_compra: dataCompra ?? (pos?.data_compra ? String(pos.data_compra) : new Date().toISOString().split("T")[0]),
    status:      qtd > 0 ? "ATIVA" : "ENCERRADA",
  };
  const { error: errUpd } = await c.from("inv_posicoes").update(campos).eq("id", posicaoId);
  if (errUpd) { logError("Recomputar posição (update)", errUpd); return; }
  if (pos?.ativo_id && pos?.conta_id) {
    await recalcularProjecoesDividendos(c, String(pos.ativo_id), String(pos.conta_id), qtd);
    // Posição zerada (ex.: resgate/venda lançado retroativamente pelo robô
    // investidor10) — os snapshots mensais gravados DEPOIS do fechamento real
    // ficam órfãos (o ativo+conta segue sendo "marcado a mercado" todo mês
    // mesmo sem posição), inflando o ganho de capital agregado. Remove os
    // meses posteriores ao do último evento aplicado.
    if (qtd === 0 && ultimaDataAplicada) {
      const mesFechamento = ultimaDataAplicada.slice(0, 7);
      const { error: errDel } = await c.from("inv_historico_mensal").delete()
        .eq("ativo_id", pos.ativo_id).eq("conta_id", pos.conta_id).gt("mes_ano", mesFechamento);
      if (errDel) logError("Limpar snapshots órfãos (posição encerrada)", errDel);
    }
  }
}

// Uma operação retroativa (compra/venda lançada com data passada) muda a
// quantidade da posição — e com ela, o valor dos dividendos ainda PROJETADOS
// (futuros, calculados como valor_por_cota × quantidade). Sem isso, a projeção
// ficava presa na quantidade de quando foi provisionada até o próximo cron/
// clique manual em "buscar dividendos". Dividendos PAGO/PENDENTE (dinheiro que
// a pessoa já recebeu ou lançou na mão) nunca são tocados aqui — mesma regra
// de upsertDividendoProvisionado.
export async function recalcularProjecoesDividendos(c: Db, ativoId: string, contaId: string, quantidade: number): Promise<void> {
  const { data: divs, error } = await c.from("inv_dividendos")
    .select("id, valor, valor_por_cota, transacao_extrato_id, transacoes(status)")
    .eq("ativo_id", ativoId).eq("conta_id", contaId)
    .not("valor_por_cota", "is", null);
  if (error) { logError("Recalcular projeções de dividendos", error); return; }

  for (const d of (divs ?? []) as {
    id: string; valor: number; valor_por_cota: number; transacao_extrato_id: string | null;
    transacoes?: { status?: string } | { status?: string }[] | null;
  }[]) {
    const rawTx = d.transacoes;
    const tx = Array.isArray(rawTx) ? rawTx[0] : rawTx;
    if (tx?.status && tx.status !== "PROJECAO") continue; // pago/pendente: valor real recebido, não mexe
    const novoValor = Number((Number(d.valor_por_cota) * quantidade).toFixed(2));
    if (novoValor === Number(d.valor)) continue;
    await c.from("inv_dividendos").update({ valor: novoValor }).eq("id", d.id);
    if (d.transacao_extrato_id) {
      await c.from("transacoes").update({ valor: novoValor, valor_projetado: novoValor }).eq("id", d.transacao_extrato_id);
    }
  }
}

// Encerra posições de renda fixa/Tesouro cujo vencimento já passou e que ainda
// estão ATIVA: cria o RESGATE na data de vencimento (com a quantidade/preço de
// custo vigentes NAQUELE momento) e recomputa — o resgate, já no passado, zera
// o saldo → ENCERRADA. É a ÚNICA via de fechamento automático: roda a cada
// snapshot-auto/snapshot-cron (diário), então cobre o dia em que o vencimento
// chega sem precisar de nenhuma operação manual do usuário. Idempotente
// (ignora as já encerradas e as que já têm o resgate daquela data).
//
// Antes havia também um mecanismo que pré-criava esse RESGATE com ANTECEDÊNCIA
// (no momento de qualquer compra/edição), só que "programado" para o futuro.
// Isso poluía a lista de operações do usuário com um lançamento de resgate
// datado no vencimento (ex.: 2032) aparecendo hoje, e distorcia totais que não
// filtram por data. Removido — o saldo/valor até o vencimento já pode ser
// acompanhado pela marcação a mercado (cotação atual) sem precisar de uma
// operação fictícia no banco.
export async function fecharPosicoesVencidas(c: Db, userId: string): Promise<void> {
  const hoje = hojeISO();
  const { data: posicoes } = await c.from("inv_posicoes")
    .select("id, quantidade, preco_custo, conta_id, user_id, inv_ativos!inner(tipo_ativo, rf_vencimento)")
    .eq("user_id", userId).eq("status", "ATIVA");
  for (const p of posicoes ?? []) {
    const rawA  = (p as { inv_ativos?: Record<string, unknown> | Record<string, unknown>[] }).inv_ativos;
    const ativo = (Array.isArray(rawA) ? rawA[0] : rawA) ?? {};
    const tipo  = String(ativo.tipo_ativo ?? "");
    const venc  = (ativo.rf_vencimento as string | null) ?? null;
    if ((tipo !== "RENDA_FIXA" && tipo !== "TESOURO_DIRETO") || !venc || venc > hoje) continue;

    const { data: existentes } = await c.from("inv_operacoes")
      .select("id").eq("posicao_id", String(p.id)).eq("tipo_operacao", "RESGATE").eq("data_operacao", venc);
    if (!(existentes ?? []).length) {
      const qtd = Number(p.quantidade) || 0, preco = Number(p.preco_custo) || 0;
      if (qtd > 0) {
        await c.from("inv_operacoes").insert({
          user_id: p.user_id, posicao_id: String(p.id), tipo_operacao: "RESGATE",
          conta_id: p.conta_id, data_operacao: venc, quantidade: qtd, preco_unitario: preco, valor_total: qtd * preco,
        });
      }
    }
    await recomputarPosicao(c, String(p.id));
  }
}

// ============================================================
// /investimentos/dividendos
// Cada dividendo gera uma transação RECEITA no extrato, na categoria
// mapeada pelo seu tipo_dividendo. Pagamento futuro → status PROJECAO;
// passado/hoje → PAGO. O vínculo fica em inv_dividendos.transacao_extrato_id.
// ============================================================

