// ============================================================
// Arquiteto de Valor — Edge Function: investimentos v1
// ============================================================
// Roteia por recurso sob /investimentos/<recurso>:
//   ativos | alocacoes | posicoes | operacoes | dividendos | dashboard
// Mantém o padrão do projeto: uma função por diretório top-level,
// roteamento interno por método/rota, RLS por user_id = auth.uid().
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import {
  json, erro, db, autenticar, extrairId, extrairAcao,
  verificarExistencia, camposParaAtualizar, corsPreFlight,
} from "../_shared/utils.ts";
import { logError, logRequest, logResponse, logSuccess } from "../_shared/logger.ts";

type Db = ReturnType<typeof db>;

const TIPOS_ATIVO = [
  "ACOES", "ETF", "FII", "STOCKS",
  "ETF_INTERNACIONAL", "RENDA_FIXA", "CRIPTOMOEDAS", "TESOURO_DIRETO",
];
const STATUS_POSICAO = ["ATIVA", "ENCERRADA"];
const TIPOS_OPERACAO = ["COMPRA", "VENDA", "APORTE", "RESGATE", "DIVIDENDO"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();

  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const url     = new URL(req.url);
  const partes  = url.pathname.split("/").filter(Boolean);
  const idxBase = partes.indexOf("investimentos");
  const recurso = idxBase >= 0 ? (partes[idxBase + 1] ?? "") : "";
  const m       = req.method;
  const c       = db(req);

  try {
    switch (recurso) {
      case "ativos":          return await rotaAtivos(c, req, m, userId);
      case "alocacoes":       return await rotaAlocacoes(c, req, m, userId);
      case "posicoes":        return await rotaPosicoes(c, req, m, userId);
      case "operacoes":       return await rotaOperacoes(c, req, m, userId);
      case "dividendos":      return await rotaDividendos(c, req, m, userId);
      case "tipos-dividendo": return await rotaTiposDividendo(c, req, m, userId);
      case "historico-mensal": return await rotaHistorico(c, req, m, userId);
      case "dashboard":       return m === "GET" ? await dashboard(c, url.searchParams) : erro("Método não permitido", 405);
      case "ranking":         return m === "GET" ? await ranking(c, url.searchParams) : erro("Método não permitido", 405);
      default:                return erro("Rota não encontrada", 404);
    }
  } catch (e) {
    logError("Handler investimentos", e);
    return erro("Erro interno", 500);
  }
});

// ============================================================
// Helpers de validação de posse (RLS já filtra; estes dão 404)
// ============================================================

async function contaExiste(c: Db, contaId: unknown): Promise<boolean> {
  if (!contaId) return false;
  const { data } = await c.from("contas").select("id").eq("id", contaId).maybeSingle();
  return !!data;
}

async function ativoExiste(c: Db, ativoId: unknown): Promise<boolean> {
  if (!ativoId) return false;
  const { data } = await c.from("inv_ativos").select("id").eq("id", ativoId).maybeSingle();
  return !!data;
}

// ============================================================
// /investimentos/ativos
// ============================================================

async function rotaAtivos(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "ativos");

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/ativos", { params: Object.fromEntries(params) });
    let q = c.from("inv_ativos").select("*").order("ticker", { ascending: true });
    const tipo = params.get("tipo");
    if (tipo && TIPOS_ATIVO.includes(tipo)) q = q.eq("tipo_ativo", tipo);
    const { data, error } = await q;
    if (error) { logError("Listar ativos", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "GET" && id) {
    const { data, error } = await c.from("inv_ativos").select("*").eq("id", id).maybeSingle();
    if (error) { logError("Buscar ativo", error); return erro(error.message); }
    if (!data) return erro("Ativo não encontrado", 404);
    return json({ dados: data });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/ativos", body);

    if (!body.ticker || !body.nome || !body.tipo_ativo) {
      return erro("Campos obrigatórios: ticker, nome, tipo_ativo");
    }
    if (!TIPOS_ATIVO.includes(String(body.tipo_ativo))) {
      return erro(`tipo_ativo inválido: ${TIPOS_ATIVO.join(" | ")}`);
    }
    const ticker = String(body.ticker).trim().toUpperCase();
    if (ticker.length < 1 || ticker.length > 20) return erro("ticker deve ter 1..20 caracteres");

    const erroNota = validarNota(body.nota_usuario);
    if (erroNota) return erro(erroNota);

    if (body.ativo_pai && !(await ativoExiste(c, body.ativo_pai))) {
      return erro("ativo_pai não encontrado", 404);
    }

    const { data, error } = await c.from("inv_ativos").insert({
      user_id:      userId,
      ticker,
      nome:         String(body.nome).trim(),
      tipo_ativo:   body.tipo_ativo,
      moeda:        body.moeda ? String(body.moeda).toUpperCase().slice(0, 3) : "BRL",
      descricao:    body.descricao ?? null,
      nota_usuario: body.nota_usuario ?? null,
      ativo_pai:    body.ativo_pai ?? null,
    }).select().single();

    if (error) {
      if (error.code === "23505") return erro("Já existe um ativo com este ticker", 409);
      logError("Criar ativo", error); return erro(error.message);
    }
    logSuccess("Ativo criado", { id: data.id });
    return json({ dados: data }, 201);
  }

  if (m === "PUT" && id) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/ativos/${id}`, body);

    const naoEncontrado = await verificarExistencia(c, "inv_ativos", id, "Ativo não encontrado");
    if (naoEncontrado) return naoEncontrado;

    if (body.tipo_ativo !== undefined && !TIPOS_ATIVO.includes(String(body.tipo_ativo))) {
      return erro(`tipo_ativo inválido: ${TIPOS_ATIVO.join(" | ")}`);
    }
    const erroNota = validarNota(body.nota_usuario);
    if (erroNota) return erro(erroNota);
    if (body.ativo_pai && (body.ativo_pai === id)) return erro("ativo_pai não pode ser o próprio ativo");
    if (body.ativo_pai && !(await ativoExiste(c, body.ativo_pai))) return erro("ativo_pai não encontrado", 404);

    const campos = camposParaAtualizar(body, [
      "ticker", "nome", "tipo_ativo", "moeda", "descricao", "nota_usuario", "ativo_pai",
    ]);
    if (typeof campos.ticker === "string") campos.ticker = campos.ticker.trim().toUpperCase();

    const { data, error } = await c.from("inv_ativos").update(campos).eq("id", id).select().single();
    if (error) {
      if (error.code === "23505") return erro("Já existe um ativo com este ticker", 409);
      logError("Editar ativo", error); return erro(error.message);
    }
    return json({ dados: data });
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/ativos/${id}`);
    const naoEncontrado = await verificarExistencia(c, "inv_ativos", id, "Ativo não encontrado");
    if (naoEncontrado) return naoEncontrado;

    // Bloqueia exclusão se houver posições vinculadas (evita órfãos de operações)
    const { count } = await c.from("inv_posicoes").select("id", { count: "exact", head: true }).eq("ativo_id", id);
    if ((count ?? 0) > 0) return erro("Não é possível excluir: o ativo possui posições vinculadas", 409);

    const { error } = await c.from("inv_ativos").delete().eq("id", id);
    if (error) { logError("Excluir ativo", error); return erro(error.message); }
    return json({ mensagem: "Ativo excluído com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

function validarNota(nota: unknown): string | null {
  if (nota == null) return null;
  const n = Number(nota);
  if (!Number.isFinite(n) || n < 0 || n > 10) return "nota_usuario deve estar entre 0 e 10";
  return null;
}

// ============================================================
// /investimentos/alocacoes — alocação ideal por tipo
// GET lista; PUT faz upsert do conjunto (soma deve ser 100%)
// ============================================================

async function rotaAlocacoes(c: Db, req: Request, m: string, userId: string) {
  if (m === "GET") {
    logRequest("GET", "/investimentos/alocacoes");
    const { data, error } = await c.from("inv_alocacoes_tipo").select("*").order("tipo_ativo");
    if (error) { logError("Listar alocacoes", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "PUT") {
    const body = await req.json();
    logRequest("PUT", "/investimentos/alocacoes", body);

    const itens = Array.isArray(body.alocacoes) ? body.alocacoes : null;
    if (!itens || itens.length === 0) {
      return erro("alocacoes (array de { tipo_ativo, percentual_ideal }) é obrigatório");
    }

    let soma = 0;
    const linhas = [];
    for (const item of itens) {
      const tipo = String(item?.tipo_ativo ?? "");
      if (!TIPOS_ATIVO.includes(tipo)) return erro(`tipo_ativo inválido: ${tipo}`);
      const pct = Number(item?.percentual_ideal);
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) return erro(`percentual_ideal inválido para ${tipo}`);
      soma += pct;
      linhas.push({ user_id: userId, tipo_ativo: tipo, percentual_ideal: pct, updated_at: new Date().toISOString() });
    }

    // Tolerância para arredondamento de ponto flutuante
    if (Math.abs(soma - 100) > 0.01) {
      return erro(`a soma dos percentuais deve ser 100% (atual: ${soma.toFixed(2)}%)`);
    }

    const { data, error } = await c
      .from("inv_alocacoes_tipo")
      .upsert(linhas, { onConflict: "user_id,tipo_ativo" })
      .select();
    if (error) { logError("Upsert alocacoes", error); return erro(error.message); }
    logSuccess("Alocações atualizadas", { count: data?.length });
    return json({ dados: data });
  }

  return erro("Método não permitido", 405);
}

// ============================================================
// /investimentos/posicoes
// ============================================================

async function rotaPosicoes(c: Db, req: Request, m: string, userId: string) {
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

async function rotaOperacoes(c: Db, req: Request, m: string, userId: string) {
  if (m === "GET") {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/operacoes", { params: Object.fromEntries(params) });
    let q = c.from("inv_operacoes").select("*").order("data_operacao", { ascending: false });
    const posicaoId = params.get("posicao_id");
    if (posicaoId) q = q.eq("posicao_id", posicaoId);
    const { data, error } = await q;
    if (error) { logError("Listar operacoes", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST") {
    const body = await req.json();
    logRequest("POST", "/investimentos/operacoes", body);

    if (!body.posicao_id || !body.tipo_operacao || !body.conta_id || body.quantidade == null || !body.data_operacao) {
      return erro("Campos obrigatórios: posicao_id, tipo_operacao, conta_id, quantidade, data_operacao");
    }
    if (!TIPOS_OPERACAO.includes(String(body.tipo_operacao))) {
      return erro(`tipo_operacao inválido: ${TIPOS_OPERACAO.join(" | ")}`);
    }
    const posExiste = await verificarExistencia(c, "inv_posicoes", String(body.posicao_id), "Posição não encontrada");
    if (posExiste) return posExiste;
    if (!(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);

    const qtd   = Number(body.quantidade);
    const preco = body.preco_unitario != null ? Number(body.preco_unitario) : 0;
    if (!Number.isFinite(qtd) || qtd < 0)     return erro("quantidade deve ser >= 0");
    if (!Number.isFinite(preco) || preco < 0) return erro("preco_unitario deve ser >= 0");
    const valorTotal = body.valor_total != null ? Number(body.valor_total) : qtd * preco;

    const { data, error } = await c.from("inv_operacoes").insert({
      user_id:        userId,
      posicao_id:     body.posicao_id,
      tipo_operacao:  body.tipo_operacao,
      conta_id:       body.conta_id,
      quantidade:     qtd,
      preco_unitario: preco,
      valor_total:    valorTotal,
      data_operacao:  String(body.data_operacao),
    }).select().single();
    if (error) { logError("Criar operacao", error); return erro(error.message); }
    logSuccess("Operação criada", { id: data.id });
    return json({ dados: data }, 201);
  }

  return erro("Método não permitido", 405);
}

// ============================================================
// /investimentos/dividendos
// Cada dividendo gera uma transação RECEITA no extrato, na categoria
// mapeada pelo seu tipo_dividendo. Pagamento futuro → status PROJECAO;
// passado/hoje → PAGO. O vínculo fica em inv_dividendos.transacao_extrato_id.
// ============================================================

async function rotaDividendos(c: Db, req: Request, m: string, userId: string) {
  const id   = extrairId(req, "dividendos");
  const acao = extrairAcao(req, "dividendos");

  // POST /dividendos/:id/confirmar — reconcilia projeção: PROJECAO → PAGO
  // com valor/data reais. Mantém valor_projetado original na transação.
  if (m === "POST" && id && acao === "confirmar") {
    const body = await req.json().catch(() => ({}));
    logRequest("POST", `/investimentos/dividendos/${id}/confirmar`, body);

    const { data: div } = await c.from("inv_dividendos")
      .select("id, valor, data_pagamento, transacao_extrato_id").eq("id", id).maybeSingle();
    if (!div) return erro("Dividendo não encontrado", 404);
    if (!div.transacao_extrato_id) return erro("Dividendo sem transação vinculada no extrato", 409);

    const { data: tx } = await c.from("transacoes")
      .select("id, status").eq("id", div.transacao_extrato_id).maybeSingle();
    if (!tx) return erro("Transação do extrato não encontrada", 404);
    if (tx.status === "PAGO") return erro("Dividendo já confirmado", 409);

    const valor = body.valor != null ? Number(body.valor) : Number(div.valor);
    if (!Number.isFinite(valor) || valor <= 0) return erro("valor deve ser > 0");
    const dataPag = body.data_pagamento ? String(body.data_pagamento) : String(div.data_pagamento);

    const { error: errTx } = await c.from("transacoes")
      .update({ status: "PAGO", valor, data: dataPag })
      .eq("id", tx.id);
    if (errTx) { logError("Confirmar transação de dividendo", errTx); return erro(errTx.message); }

    const { data: divFinal, error: errDiv } = await c.from("inv_dividendos")
      .update({ valor, data_pagamento: dataPag })
      .eq("id", id)
      .select("*, inv_ativos(ticker, nome), inv_tipos_dividendo(nome), transacoes(status)")
      .single();
    if (errDiv) { logError("Confirmar dividendo", errDiv); return erro(errDiv.message); }

    logSuccess("Dividendo confirmado", { id, valor, data: dataPag });
    return json({ dados: divFinal });
  }

  // PUT /dividendos/:id — edita valor/data/conta/descrição e sincroniza
  // a transação vinculada no extrato (sem mudar o status dela).
  if (m === "PUT" && id && !acao) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/dividendos/${id}`, body);

    const { data: div } = await c.from("inv_dividendos")
      .select("id, transacao_extrato_id").eq("id", id).maybeSingle();
    if (!div) return erro("Dividendo não encontrado", 404);

    if (body.valor != null) {
      const v = Number(body.valor);
      if (!Number.isFinite(v) || v <= 0) return erro("valor deve ser > 0");
    }
    if (body.conta_id && !(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);

    const campos = camposParaAtualizar(body, ["valor", "data_pagamento", "descricao", "conta_id"]);
    if (Object.keys(campos).length === 0) return erro("Nenhum campo para atualizar");

    const { data: divFinal, error } = await c.from("inv_dividendos")
      .update(campos).eq("id", id)
      .select("*, inv_ativos(ticker, nome), inv_tipos_dividendo(nome), transacoes(status)")
      .single();
    if (error) { logError("Editar dividendo", error); return erro(error.message); }

    // Sincroniza a transação do extrato (valor / data / conta)
    if (div.transacao_extrato_id) {
      const txCampos: Record<string, unknown> = {};
      if (campos.valor          !== undefined) txCampos.valor    = campos.valor;
      if (campos.data_pagamento !== undefined) txCampos.data     = campos.data_pagamento;
      if (campos.conta_id       !== undefined) txCampos.conta_id = campos.conta_id;
      if (Object.keys(txCampos).length > 0) {
        // Em projeções o valor projetado acompanha o valor editado
        const { data: tx } = await c.from("transacoes")
          .select("status").eq("id", div.transacao_extrato_id).maybeSingle();
        if (tx?.status === "PROJECAO" && txCampos.valor !== undefined) {
          txCampos.valor_projetado = txCampos.valor;
        }
        const { error: errTx } = await c.from("transacoes")
          .update(txCampos).eq("id", div.transacao_extrato_id);
        if (errTx) logError("Sincronizar transação de dividendo", errTx);
      }
    }

    return json({ dados: divFinal });
  }

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/dividendos", { params: Object.fromEntries(params) });
    let q = c.from("inv_dividendos")
      .select("*, inv_ativos(ticker, nome), inv_tipos_dividendo(nome), transacoes(status)")
      .order("data_pagamento", { ascending: false });
    const ativoId = params.get("ativo_id");
    const tipo    = params.get("tipo_ativo");
    if (ativoId) q = q.eq("ativo_id", ativoId);
    if (tipo && TIPOS_ATIVO.includes(tipo)) q = q.eq("tipo_ativo", tipo);
    const { data, error } = await q;
    if (error) { logError("Listar dividendos", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/dividendos", body);

    if (!body.ativo_id || !body.conta_id || body.valor == null || !body.data_pagamento ||
        !body.tipo_ativo || !body.tipo_dividendo_id) {
      return erro("Campos obrigatórios: ativo_id, conta_id, valor, data_pagamento, tipo_ativo, tipo_dividendo_id");
    }
    if (!TIPOS_ATIVO.includes(String(body.tipo_ativo))) {
      return erro(`tipo_ativo inválido: ${TIPOS_ATIVO.join(" | ")}`);
    }
    const valor = Number(body.valor);
    // A transação do extrato exige valor > 0 (CHECK valor > 0 em transacoes)
    if (!Number.isFinite(valor) || valor <= 0) return erro("valor deve ser > 0");
    if (!(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);

    // Carrega ativo (ticker p/ descrição) e tipo de dividendo (categoria mapeada)
    const [{ data: ativo }, { data: tipoDiv }] = await Promise.all([
      c.from("inv_ativos").select("ticker").eq("id", body.ativo_id).maybeSingle(),
      c.from("inv_tipos_dividendo").select("id, nome, categoria_id").eq("id", body.tipo_dividendo_id).maybeSingle(),
    ]);
    if (!ativo)   return erro("Ativo não encontrado", 404);
    if (!tipoDiv) return erro("Tipo de dividendo não encontrado", 404);
    if (!tipoDiv.categoria_id) {
      return erro(`Configure a categoria do tipo de dividendo "${tipoDiv.nome}" antes de lançar`, 409);
    }

    // 1) Cria o dividendo (sem vínculo ainda)
    const { data: div, error: errDiv } = await c.from("inv_dividendos").insert({
      user_id:           userId,
      ativo_id:          body.ativo_id,
      conta_id:          body.conta_id,
      valor,
      data_pagamento:    String(body.data_pagamento),
      tipo_ativo:        body.tipo_ativo,
      tipo_dividendo_id: tipoDiv.id,
      descricao:         body.descricao ?? null,
    }).select().single();
    if (errDiv) { logError("Criar dividendo", errDiv); return erro(errDiv.message); }

    // 2) Cria a transação no extrato
    const hoje    = new Date().toISOString().split("T")[0];
    const futuro  = String(body.data_pagamento) > hoje;
    const status  = futuro ? "PROJECAO" : "PAGO";
    // descricao da transação: "TICKER - Nome do tipo" (2..200 chars)
    const desc    = `${ativo.ticker} - ${tipoDiv.nome}`.slice(0, 200);

    const { data: tx, error: errTx } = await c.from("transacoes").insert({
      user_id:         userId,
      conta_id:        body.conta_id,
      categoria_id:    tipoDiv.categoria_id,
      data:            String(body.data_pagamento),
      descricao:       desc.length >= 2 ? desc : `Dividendo ${desc}`.slice(0, 200),
      valor,
      tipo:            "RECEITA",
      status,
      valor_projetado: futuro ? valor : null,
    }).select("id").single();

    if (errTx) {
      // rollback manual: remove o dividendo órfão para não ficar sem extrato
      await c.from("inv_dividendos").delete().eq("id", div.id);
      logError("Criar transação de dividendo", errTx);
      return erro(`Falha ao lançar no extrato: ${errTx.message}`);
    }

    // 3) Vincula
    const { data: divFinal } = await c.from("inv_dividendos")
      .update({ transacao_extrato_id: tx.id })
      .eq("id", div.id)
      .select("*, inv_ativos(ticker, nome), inv_tipos_dividendo(nome), transacoes(status)")
      .single();

    logSuccess("Dividendo criado e lançado no extrato", { id: div.id, tx: tx.id, status });
    return json({ dados: divFinal ?? div }, 201);
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/dividendos/${id}`);
    const { data: div } = await c.from("inv_dividendos")
      .select("id, transacao_extrato_id").eq("id", id).maybeSingle();
    if (!div) return erro("Dividendo não encontrado", 404);

    const { error } = await c.from("inv_dividendos").delete().eq("id", id);
    if (error) { logError("Excluir dividendo", error); return erro(error.message); }

    // Remove também a transação vinculada do extrato
    if (div.transacao_extrato_id) {
      const { error: errTx } = await c.from("transacoes").delete().eq("id", div.transacao_extrato_id);
      if (errTx) logError("Excluir transação de dividendo", errTx);
    }
    return json({ mensagem: "Dividendo excluído com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

// ============================================================
// /investimentos/tipos-dividendo — tipos editáveis + mapeamento
// para a categoria do extrato (1 categoria por tipo, reutilizável).
// A criação da categoria em si usa a Edge Function `categorias`;
// aqui só guardamos o categoria_id escolhido.
// ============================================================

async function rotaTiposDividendo(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "tipos-dividendo");

  if (m === "GET" && !id) {
    logRequest("GET", "/investimentos/tipos-dividendo");
    const { data, error } = await c.from("inv_tipos_dividendo")
      .select("*, categorias(descricao, icone, cor)")
      .order("nome", { ascending: true });
    if (error) { logError("Listar tipos-dividendo", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/tipos-dividendo", body);
    if (!body.nome) return erro("Campo obrigatório: nome");
    const nome = String(body.nome).trim();
    if (nome.length < 1 || nome.length > 40) return erro("nome deve ter entre 1 e 40 caracteres");
    if (body.categoria_id) {
      const { data: cat } = await c.from("categorias").select("id").eq("id", body.categoria_id).maybeSingle();
      if (!cat) return erro("Categoria não encontrada", 404);
    }
    const { data, error } = await c.from("inv_tipos_dividendo").insert({
      user_id:      userId,
      nome,
      categoria_id: body.categoria_id ?? null,
    }).select().single();
    if (error) {
      if (error.code === "23505") return erro("Já existe um tipo de dividendo com este nome", 409);
      logError("Criar tipo-dividendo", error); return erro(error.message);
    }
    return json({ dados: data }, 201);
  }

  if (m === "PUT" && id) {
    const body = await req.json();
    logRequest("PUT", `/investimentos/tipos-dividendo/${id}`, body);
    const naoEncontrado = await verificarExistencia(c, "inv_tipos_dividendo", id, "Tipo de dividendo não encontrado");
    if (naoEncontrado) return naoEncontrado;
    if (body.nome !== undefined) {
      const nome = String(body.nome).trim();
      if (nome.length < 1 || nome.length > 40) return erro("nome deve ter entre 1 e 40 caracteres");
    }
    if (body.categoria_id) {
      const { data: cat } = await c.from("categorias").select("id").eq("id", body.categoria_id).maybeSingle();
      if (!cat) return erro("Categoria não encontrada", 404);
    }
    const campos = camposParaAtualizar(body, ["nome", "categoria_id", "ativo"]);
    if (typeof campos.nome === "string") campos.nome = campos.nome.trim();
    campos.updated_at = new Date().toISOString();
    const { data, error } = await c.from("inv_tipos_dividendo").update(campos).eq("id", id).select().single();
    if (error) {
      if (error.code === "23505") return erro("Já existe um tipo de dividendo com este nome", 409);
      logError("Editar tipo-dividendo", error); return erro(error.message);
    }
    return json({ dados: data });
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/tipos-dividendo/${id}`);
    const naoEncontrado = await verificarExistencia(c, "inv_tipos_dividendo", id, "Tipo de dividendo não encontrado");
    if (naoEncontrado) return naoEncontrado;
    const { count } = await c.from("inv_dividendos").select("id", { count: "exact", head: true }).eq("tipo_dividendo_id", id);
    if ((count ?? 0) > 0) return erro("Não é possível excluir: há dividendos lançados com este tipo", 409);
    const { error } = await c.from("inv_tipos_dividendo").delete().eq("id", id);
    if (error) { logError("Excluir tipo-dividendo", error); return erro(error.message); }
    return json({ mensagem: "Tipo de dividendo excluído com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

// ============================================================
// /investimentos/historico-mensal — snapshot de valor por mês
// POST faz upsert por (ativo_id, conta_id, mes_ano) e calcula
// variacao_percentual e rentabilidade_mes contra o mês anterior,
// descontando aportes/resgates (mudança de quantidade avaliada ao
// preco_medio informado). Backfill recalcula o snapshot seguinte.
// ============================================================

const RE_MES_ANO = /^\d{4}-(0[1-9]|1[0-2])$/;

interface SnapshotMes {
  id?: string;
  mes_ano: string;
  valor_mercado: number;
  quantidade: number;
}

function calcularDesempenho(
  valorMercado: number, quantidade: number, precoMedio: number, prev: SnapshotMes | null,
): { variacao_percentual: number; rentabilidade_mes: number } {
  if (!prev || prev.valor_mercado <= 0) return { variacao_percentual: 0, rentabilidade_mes: 0 };
  const fluxo  = (quantidade - prev.quantidade) * precoMedio;
  const rentab = valorMercado - prev.valor_mercado - fluxo;
  return {
    variacao_percentual: Number(((rentab / prev.valor_mercado) * 100).toFixed(4)),
    rentabilidade_mes:   Number(rentab.toFixed(2)),
  };
}

async function snapshotVizinho(
  c: Db, ativoId: string, contaId: string, mesAno: string, direcao: "anterior" | "seguinte",
): Promise<(SnapshotMes & { id: string; preco_medio: number }) | null> {
  let q = c.from("inv_historico_mensal")
    .select("id, mes_ano, valor_mercado, quantidade, preco_medio")
    .eq("ativo_id", ativoId).eq("conta_id", contaId);
  q = direcao === "anterior"
    ? q.lt("mes_ano", mesAno).order("mes_ano", { ascending: false })
    : q.gt("mes_ano", mesAno).order("mes_ano", { ascending: true });
  const { data } = await q.limit(1).maybeSingle();
  return data as (SnapshotMes & { id: string; preco_medio: number }) | null;
}

// Após upsert/delete, o snapshot do mês seguinte (se houver) fica com a
// variação desatualizada — recalcula contra o novo "mês anterior" dele.
async function recalcularSeguinte(c: Db, ativoId: string, contaId: string, mesAno: string) {
  const seguinte = await snapshotVizinho(c, ativoId, contaId, mesAno, "seguinte");
  if (!seguinte) return;
  const prevDoSeguinte = await snapshotVizinho(c, ativoId, contaId, seguinte.mes_ano, "anterior");
  const desempenho = calcularDesempenho(
    Number(seguinte.valor_mercado), Number(seguinte.quantidade), Number(seguinte.preco_medio), prevDoSeguinte,
  );
  await c.from("inv_historico_mensal").update(desempenho).eq("id", seguinte.id);
}

async function rotaHistorico(c: Db, req: Request, m: string, userId: string) {
  const id = extrairId(req, "historico-mensal");

  if (m === "GET" && !id) {
    const params = new URL(req.url).searchParams;
    logRequest("GET", "/investimentos/historico-mensal", { params: Object.fromEntries(params) });
    let q = c.from("inv_historico_mensal")
      .select("*, inv_ativos(ticker, nome, tipo_ativo)")
      .order("mes_ano", { ascending: false });
    const ativoId = params.get("ativo_id");
    const contaId = params.get("conta_id");
    const mesAno  = params.get("mes_ano");
    const de      = params.get("de");
    const ate     = params.get("ate");
    if (ativoId) q = q.eq("ativo_id", ativoId);
    if (contaId) q = q.eq("conta_id", contaId);
    if (mesAno && RE_MES_ANO.test(mesAno)) q = q.eq("mes_ano", mesAno);
    if (de  && RE_MES_ANO.test(de))  q = q.gte("mes_ano", de);
    if (ate && RE_MES_ANO.test(ate)) q = q.lte("mes_ano", ate);
    const { data, error } = await q;
    if (error) { logError("Listar historico", error); return erro(error.message); }
    return json({ dados: data });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/historico-mensal", body);

    if (!body.ativo_id || !body.conta_id || !body.mes_ano || body.valor_mercado == null) {
      return erro("Campos obrigatórios: ativo_id, conta_id, mes_ano, valor_mercado");
    }
    const mesAno = String(body.mes_ano);
    if (!RE_MES_ANO.test(mesAno)) return erro("mes_ano deve estar no formato YYYY-MM");
    const valorMercado = Number(body.valor_mercado);
    if (!Number.isFinite(valorMercado) || valorMercado < 0) return erro("valor_mercado deve ser >= 0");
    if (!(await ativoExiste(c, body.ativo_id))) return erro("Ativo não encontrado", 404);
    if (!(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);

    // quantidade/preco_medio omitidos → derivados das posições ATIVAS do ativo+conta
    let quantidade = body.quantidade != null ? Number(body.quantidade) : null;
    let precoMedio = body.preco_medio != null ? Number(body.preco_medio) : null;
    if (quantidade == null || precoMedio == null) {
      const { data: pos } = await c.from("inv_posicoes")
        .select("quantidade, valor_custo")
        .eq("ativo_id", body.ativo_id).eq("conta_id", body.conta_id).eq("status", "ATIVA");
      const qtdTotal   = (pos ?? []).reduce((s, p) => s + Number(p.quantidade), 0);
      const custoTotal = (pos ?? []).reduce((s, p) => s + Number(p.valor_custo), 0);
      if (quantidade == null) quantidade = qtdTotal;
      if (precoMedio == null) precoMedio = qtdTotal > 0 ? custoTotal / qtdTotal : 0;
    }
    if (!Number.isFinite(quantidade) || quantidade < 0) return erro("quantidade deve ser >= 0");
    if (!Number.isFinite(precoMedio) || precoMedio < 0) return erro("preco_medio deve ser >= 0");

    const prev = await snapshotVizinho(c, String(body.ativo_id), String(body.conta_id), mesAno, "anterior");
    const desempenho = calcularDesempenho(valorMercado, quantidade, precoMedio, prev);

    const { data, error } = await c.from("inv_historico_mensal").upsert({
      user_id:       userId,
      ativo_id:      body.ativo_id,
      conta_id:      body.conta_id,
      mes_ano:       mesAno,
      valor_mercado: valorMercado,
      quantidade,
      preco_medio:   precoMedio,
      ...desempenho,
    }, { onConflict: "ativo_id,conta_id,mes_ano" }).select().single();
    if (error) { logError("Upsert historico", error); return erro(error.message); }

    await recalcularSeguinte(c, String(body.ativo_id), String(body.conta_id), mesAno);
    logSuccess("Histórico mensal registrado", { id: data.id, mes_ano: mesAno });
    return json({ dados: data }, 201);
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/historico-mensal/${id}`);
    const { data: snap } = await c.from("inv_historico_mensal")
      .select("id, ativo_id, conta_id, mes_ano").eq("id", id).maybeSingle();
    if (!snap) return erro("Registro não encontrado", 404);

    const { error } = await c.from("inv_historico_mensal").delete().eq("id", id);
    if (error) { logError("Excluir historico", error); return erro(error.message); }

    await recalcularSeguinte(c, String(snap.ativo_id), String(snap.conta_id), String(snap.mes_ano));
    return json({ mensagem: "Registro excluído com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

// ============================================================
// /investimentos/dashboard — consolidação por tipo de ativo
// Agrega em JS (volume pequeno por usuário). Valor de mercado usa
// o snapshot mensal mais recente por ativo+conta; se não houver,
// cai para o valor de custo.
// ============================================================

async function dashboard(c: Db, params: URLSearchParams) {
  logRequest("GET", "/investimentos/dashboard", { params: Object.fromEntries(params) });
  const contaFiltro = params.get("conta_id");

  const [posRes, alocRes, histRes, divRes] = await Promise.all([
    (() => {
      let q = c.from("inv_posicoes")
        .select("id, ativo_id, conta_id, quantidade, valor_custo, status, inv_ativos(tipo_ativo)")
        .eq("status", "ATIVA");
      if (contaFiltro) q = q.eq("conta_id", contaFiltro);
      return q;
    })(),
    c.from("inv_alocacoes_tipo").select("tipo_ativo, percentual_ideal"),
    c.from("inv_historico_mensal").select("ativo_id, conta_id, mes_ano, valor_mercado"),
    c.from("inv_dividendos").select("tipo_ativo, valor"),
  ]);

  if (posRes.error)  { logError("Dashboard posicoes", posRes.error);  return erro(posRes.error.message); }
  if (alocRes.error) { logError("Dashboard alocacoes", alocRes.error); return erro(alocRes.error.message); }
  if (histRes.error) { logError("Dashboard historico", histRes.error); return erro(histRes.error.message); }
  if (divRes.error)  { logError("Dashboard dividendos", divRes.error); return erro(divRes.error.message); }

  // Último valor_mercado por ativo+conta (compara mes_ano lexicograficamente)
  const ultimoMercado = new Map<string, number>();
  const ultimoMes     = new Map<string, string>();
  for (const h of histRes.data ?? []) {
    const k   = `${h.ativo_id}|${h.conta_id}`;
    const mes = String(h.mes_ano);
    if (!ultimoMes.has(k) || mes > ultimoMes.get(k)!) {
      ultimoMes.set(k, mes);
      ultimoMercado.set(k, Number(h.valor_mercado));
    }
  }

  // Acumula por tipo
  type Agg = { tipo_ativo: string; valor_custo: number; valor_mercado: number; dividendos: number };
  const porTipo = new Map<string, Agg>();
  const garante = (tipo: string): Agg => {
    if (!porTipo.has(tipo)) porTipo.set(tipo, { tipo_ativo: tipo, valor_custo: 0, valor_mercado: 0, dividendos: 0 });
    return porTipo.get(tipo)!;
  };

  // Agrupa posições por ativo+conta antes de aplicar o snapshot — o
  // snapshot mensal cobre TODAS as posições do par; somar por posição
  // contaria o mesmo valor de mercado mais de uma vez.
  const porAtivoConta = new Map<string, { tipo: string; custo: number }>();
  for (const p of posRes.data ?? []) {
    const tipo = (p.inv_ativos as { tipo_ativo?: string } | null)?.tipo_ativo;
    if (!tipo) continue;
    const k = `${p.ativo_id}|${p.conta_id}`;
    const atual = porAtivoConta.get(k) ?? { tipo, custo: 0 };
    atual.custo += Number(p.valor_custo) || 0;
    porAtivoConta.set(k, atual);
  }
  for (const [k, ac] of porAtivoConta) {
    const agg = garante(ac.tipo);
    agg.valor_custo   += ac.custo;
    agg.valor_mercado += ultimoMercado.get(k) ?? ac.custo;
  }

  for (const d of divRes.data ?? []) {
    garante(String(d.tipo_ativo)).dividendos += Number(d.valor) || 0;
  }

  const alocMap = new Map<string, number>();
  for (const a of alocRes.data ?? []) alocMap.set(String(a.tipo_ativo), Number(a.percentual_ideal) || 0);

  const totalMercado = [...porTipo.values()].reduce((s, a) => s + a.valor_mercado, 0);

  const tipos = [...porTipo.values()].map((a) => {
    const percentualAtual = totalMercado > 0 ? (a.valor_mercado / totalMercado) * 100 : 0;
    const percentualIdeal = alocMap.get(a.tipo_ativo) ?? 0;
    return {
      tipo_ativo:        a.tipo_ativo,
      valor_custo:       Number(a.valor_custo.toFixed(2)),
      valor_mercado:     Number(a.valor_mercado.toFixed(2)),
      ganho_perda:       Number((a.valor_mercado - a.valor_custo).toFixed(2)),
      rentabilidade_pct: a.valor_custo > 0 ? Number((((a.valor_mercado - a.valor_custo) / a.valor_custo) * 100).toFixed(2)) : 0,
      dividendos:        Number(a.dividendos.toFixed(2)),
      percentual_atual:  Number(percentualAtual.toFixed(2)),
      percentual_ideal:  percentualIdeal,
      desvio_pct:        Number((percentualAtual - percentualIdeal).toFixed(2)),
    };
  }).sort((x, y) => y.valor_mercado - x.valor_mercado);

  const totalCusto = tipos.reduce((s, t) => s + t.valor_custo, 0);
  const totalDiv   = tipos.reduce((s, t) => s + t.dividendos, 0);

  return json({
    dados: {
      total_custo:    Number(totalCusto.toFixed(2)),
      total_mercado:  Number(totalMercado.toFixed(2)),
      ganho_perda:    Number((totalMercado - totalCusto).toFixed(2)),
      total_dividendos: Number(totalDiv.toFixed(2)),
      tipos,
    },
  });
}

// ============================================================
// /investimentos/ranking — métricas por ATIVO para classificação
// de performance: em alta / em prejuízo, dividend yield (12 meses)
// e participação na carteira. Devolve a lista completa ordenada
// por rentabilidade; o frontend fatia os destaques.
// ============================================================

async function ranking(c: Db, params: URLSearchParams) {
  logRequest("GET", "/investimentos/ranking", { params: Object.fromEntries(params) });
  const contaFiltro = params.get("conta_id");
  const tipoFiltro  = params.get("tipo_ativo");

  const corte12m = new Date();
  corte12m.setMonth(corte12m.getMonth() - 12);
  const corteISO = corte12m.toISOString().split("T")[0];

  const [posRes, histRes, divRes] = await Promise.all([
    (() => {
      let q = c.from("inv_posicoes")
        .select("ativo_id, conta_id, quantidade, valor_custo, inv_ativos(ticker, nome, tipo_ativo)")
        .eq("status", "ATIVA");
      if (contaFiltro) q = q.eq("conta_id", contaFiltro);
      return q;
    })(),
    c.from("inv_historico_mensal").select("ativo_id, conta_id, mes_ano, valor_mercado"),
    c.from("inv_dividendos").select("ativo_id, valor").gte("data_pagamento", corteISO),
  ]);

  if (posRes.error)  { logError("Ranking posicoes", posRes.error);   return erro(posRes.error.message); }
  if (histRes.error) { logError("Ranking historico", histRes.error); return erro(histRes.error.message); }
  if (divRes.error)  { logError("Ranking dividendos", divRes.error); return erro(divRes.error.message); }

  // Último valor_mercado por ativo+conta
  const ultimoMercado = new Map<string, number>();
  const ultimoMes     = new Map<string, string>();
  for (const h of histRes.data ?? []) {
    const k   = `${h.ativo_id}|${h.conta_id}`;
    const mes = String(h.mes_ano);
    if (!ultimoMes.has(k) || mes > ultimoMes.get(k)!) {
      ultimoMes.set(k, mes);
      ultimoMercado.set(k, Number(h.valor_mercado));
    }
  }

  type AggAtivo = {
    ativo_id: string; ticker: string; nome: string; tipo_ativo: string;
    valor_custo: number; valor_mercado: number; dividendos_12m: number;
  };
  const porAtivo = new Map<string, AggAtivo>();

  // Custo agrupado por ativo+conta (snapshot cobre o par inteiro)
  const custoPorPar = new Map<string, { ativo: AggAtivo; custo: number }>();
  for (const p of posRes.data ?? []) {
    const meta = p.inv_ativos as { ticker?: string; nome?: string; tipo_ativo?: string } | null;
    if (!meta?.tipo_ativo) continue;
    if (tipoFiltro && meta.tipo_ativo !== tipoFiltro) continue;
    const aid = String(p.ativo_id);
    if (!porAtivo.has(aid)) {
      porAtivo.set(aid, {
        ativo_id: aid, ticker: meta.ticker ?? "", nome: meta.nome ?? "",
        tipo_ativo: meta.tipo_ativo, valor_custo: 0, valor_mercado: 0, dividendos_12m: 0,
      });
    }
    const k = `${aid}|${p.conta_id}`;
    const par = custoPorPar.get(k) ?? { ativo: porAtivo.get(aid)!, custo: 0 };
    par.custo += Number(p.valor_custo) || 0;
    custoPorPar.set(k, par);
  }
  for (const [k, par] of custoPorPar) {
    par.ativo.valor_custo   += par.custo;
    par.ativo.valor_mercado += ultimoMercado.get(k) ?? par.custo;
  }

  for (const d of divRes.data ?? []) {
    const agg = porAtivo.get(String(d.ativo_id));
    if (agg) agg.dividendos_12m += Number(d.valor) || 0;
  }

  const totalMercado = [...porAtivo.values()].reduce((s, a) => s + a.valor_mercado, 0);

  const ativos = [...porAtivo.values()].map((a) => ({
    ativo_id:           a.ativo_id,
    ticker:             a.ticker,
    nome:               a.nome,
    tipo_ativo:         a.tipo_ativo,
    valor_custo:        Number(a.valor_custo.toFixed(2)),
    valor_mercado:      Number(a.valor_mercado.toFixed(2)),
    ganho_perda:        Number((a.valor_mercado - a.valor_custo).toFixed(2)),
    rentabilidade_pct:  a.valor_custo > 0 ? Number((((a.valor_mercado - a.valor_custo) / a.valor_custo) * 100).toFixed(2)) : 0,
    dividendos_12m:     Number(a.dividendos_12m.toFixed(2)),
    dividend_yield_pct: a.valor_mercado > 0 ? Number(((a.dividendos_12m / a.valor_mercado) * 100).toFixed(2)) : 0,
    participacao_pct:   totalMercado > 0 ? Number(((a.valor_mercado / totalMercado) * 100).toFixed(2)) : 0,
  })).sort((x, y) => y.rentabilidade_pct - x.rentabilidade_pct);

  return json({ dados: { total_mercado: Number(totalMercado.toFixed(2)), ativos } });
}
