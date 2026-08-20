// supabase/functions/investimentos/dividendos.ts
// Dividendos/proventos: CRUD, cron USD (Polygon), cron BRL (B3), backfill de
// taxas e diagnóstico — extraído de index.ts.
import {
  json, erro, db, dbAdmin, extrairId, extrairAcao, buscarTodasLinhas,
  verificarExistencia, camposParaAtualizar, autenticarCron,
} from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import {
  Db, TIPOS_ATIVO, hojeISO, deslocarDias, recuarDias, maiorData, menorData,
  dataPagamentoPlausivel, contaExiste, ativoExiste, inserirEmLote,
} from "./shared.ts";
import {
  resolverMeta, precosCripto, precosBrapi, resolverNomes, ptaxAtual,
  garantirSincronizado, ultimaCotacaoPtax, nomeTesouro, tesouroSemestral, tickerTesouro,
  fetchB3, brDataISO, brNumero, B3_HEADERS,
} from "./mercado.ts";
import { recomputarPosicao, acharOuCriarPosicao } from "./posicoes.ts";

export async function rotaDividendos(c: Db, req: Request, m: string, userId: string) {
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
    if (body.tipo_dividendo_id) {
      const { data: td } = await c.from("inv_tipos_dividendo")
        .select("id").eq("id", body.tipo_dividendo_id).maybeSingle();
      if (!td) return erro("Tipo de dividendo não encontrado", 404);
    }

    const campos = camposParaAtualizar(body, ["valor", "data_pagamento", "descricao", "conta_id", "tipo_dividendo_id"]);
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
    const ativoId = params.get("ativo_id");
    const tipo    = params.get("tipo_ativo");
    const montar = (de: number, ate: number) => {
      let q = c.from("inv_dividendos")
        .select("*, inv_ativos(ticker, nome, tipo_ativo), inv_tipos_dividendo(nome), transacoes(status)")
        .order("data_pagamento", { ascending: false })
        .range(de, ate);
      if (ativoId) q = q.eq("ativo_id", ativoId);
      return q;
    };
    const { data, error } = await buscarTodasLinhas(montar);
    if (error) { logError("Listar dividendos", error); return erro(error.message); }
    // inv_dividendos.tipo_ativo é uma cópia desnormalizada que pode ficar
    // defasada (ex.: ativo reclassificado de FII p/ ETF). Para o gráfico de
    // proventos nunca errar, devolvemos SEMPRE o tipo ATUAL do ativo (join),
    // independentemente de a sincronização por trigger ter rodado.
    const dados = (data ?? []).map((d) => {
      const at = (d as { inv_ativos?: { tipo_ativo?: string } | null }).inv_ativos ?? null;
      return at?.tipo_ativo ? { ...d, tipo_ativo: at.tipo_ativo } : d;
    });
    const filtrados = tipo && TIPOS_ATIVO.includes(tipo)
      ? dados.filter((d) => (d as { tipo_ativo?: string }).tipo_ativo === tipo)
      : dados;
    return json({ dados: filtrados });
  }

  if (m === "POST" && !id) {
    const body = await req.json();
    logRequest("POST", "/investimentos/dividendos", body);

    // Associação inversa: vincula a um provento que JÁ existe no extrato
    // (não cria transação nova). Para trazer dividendos antigos, lançados
    // manualmente como receitas, para o módulo de investimentos.
    if (body.transacao_extrato_id) {
      return await associarDividendoExistente(c, body, userId);
    }

    if (!body.ativo_id || !body.conta_id || body.valor == null || !body.data_pagamento ||
        !body.tipo_ativo || !body.tipo_dividendo_id) {
      return erro("Campos obrigatórios: ativo_id, conta_id, valor, data_pagamento, tipo_ativo, tipo_dividendo_id");
    }
    if (!TIPOS_ATIVO.includes(String(body.tipo_ativo))) {
      return erro(`tipo_ativo inválido: ${TIPOS_ATIVO.join(" | ")}`);
    }
    const valorInformado = Number(body.valor);
    // A transação do extrato exige valor > 0 (CHECK valor > 0 em transacoes)
    if (!Number.isFinite(valorInformado) || valorInformado <= 0) return erro("valor deve ser > 0");
    if (!(await contaExiste(c, body.conta_id))) return erro("Conta não encontrada", 404);

    // Carrega ativo (ticker/moeda p/ descrição e conversão) e tipo de
    // dividendo (categoria mapeada)
    const [{ data: ativo }, { data: tipoDiv }] = await Promise.all([
      c.from("inv_ativos").select("ticker, nome, moeda").eq("id", body.ativo_id).maybeSingle(),
      c.from("inv_tipos_dividendo").select("id, nome, categoria_id").eq("id", body.tipo_dividendo_id).maybeSingle(),
    ]);
    if (!ativo)   return erro("Ativo não encontrado", 404);
    if (!tipoDiv) return erro("Tipo de dividendo não encontrado", 404);
    if (!tipoDiv.categoria_id) {
      return erro(`Configure a categoria do tipo de dividendo "${tipoDiv.nome}" antes de lançar`, 409);
    }

    // O extrato (arqvalor.transacoes) só tem uma moeda implícita (BRL) — para
    // ativos em moeda estrangeira, o valor digitado é o que o usuário recebeu
    // NA MOEDA DO ATIVO (ex.: USD, como no comprovante da corretora) e precisa
    // ser convertido antes de gravar, igual à busca automática de proventos
    // (provisionarProventosUsd/upsertDividendoProvisionado, que já converte
    // via PTAX). Sem isso, o valor em dólar era gravado cru como se fosse
    // reais, subestimando o extrato/saldo da conta em ~5x.
    let valor = valorInformado;
    const moedaAtivo = String(ativo.moeda ?? "BRL").toUpperCase();
    if (moedaAtivo !== "BRL") {
      const ptax = await ptaxVendaAte(c, String(body.data_pagamento));
      if (!ptax) return erro("Cotação PTAX indisponível para converter o valor em moeda estrangeira", 502);
      valor = Number((valorInformado * ptax).toFixed(2));
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
    const hoje    = hojeISO();
    const futuro  = String(body.data_pagamento) > hoje;
    const status  = futuro ? "PROJECAO" : "PAGO";
    // descricao da transação: "TICKER - Nome do ativo" (mesma convenção do
    // lançamento manual no extrato e da busca automática de proventos)
    const desc    = descricaoProvento(ativo.ticker, ativo.nome);

    const { data: tx, error: errTx } = await c.from("transacoes").insert({
      user_id:         userId,
      conta_id:        body.conta_id,
      categoria_id:    tipoDiv.categoria_id,
      data:            String(body.data_pagamento),
      descricao:       desc,
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

// Associa um provento já lançado no extrato a um ativo, criando o
// inv_dividendos vinculado SEM gerar nova transação. Idempotente: uma
// transação só pode ser associada a um dividendo.
export async function associarDividendoExistente(c: Db, body: Record<string, unknown>, userId: string) {
  if (!body.ativo_id) return erro("ativo_id é obrigatório");

  const { data: ativo } = await c.from("inv_ativos")
    .select("id, tipo_ativo").eq("id", body.ativo_id).maybeSingle();
  if (!ativo) return erro("Ativo não encontrado", 404);

  const { data: tx } = await c.from("transacoes")
    .select("id, conta_id, categoria_id, valor, data, tipo").eq("id", body.transacao_extrato_id).maybeSingle();
  if (!tx) return erro("Transação do extrato não encontrada", 404);
  if (tx.tipo !== "RECEITA") return erro("Só é possível associar transações de RECEITA", 409);
  if (Number(tx.valor) <= 0) return erro("A transação deve ter valor maior que zero", 409);

  const { data: jaVinc } = await c.from("inv_dividendos")
    .select("id").eq("transacao_extrato_id", tx.id).maybeSingle();
  if (jaVinc) return erro("Esta transação já está associada a um dividendo", 409);

  let tipoDivId: string | null = body.tipo_dividendo_id ? String(body.tipo_dividendo_id) : null;
  if (tipoDivId) {
    const { data: td } = await c.from("inv_tipos_dividendo").select("id").eq("id", tipoDivId).maybeSingle();
    if (!td) tipoDivId = null; // tipo inválido → grava sem tipo (não bloqueia)
  }
  // Sem tipo informado: infere pelo mapeamento tipo ↔ categoria do extrato
  if (!tipoDivId && tx.categoria_id) {
    const { data: td } = await c.from("inv_tipos_dividendo")
      .select("id").eq("categoria_id", tx.categoria_id).limit(1).maybeSingle();
    if (td) tipoDivId = String(td.id);
  }

  const { data, error } = await c.from("inv_dividendos").insert({
    user_id:              userId,
    ativo_id:             ativo.id,
    conta_id:             tx.conta_id,
    valor:                tx.valor,
    data_pagamento:       tx.data,
    tipo_ativo:           ativo.tipo_ativo,
    tipo_dividendo_id:    tipoDivId,
    descricao:            body.descricao ?? null,
    transacao_extrato_id: tx.id,
  }).select("*, inv_ativos(ticker, nome), inv_tipos_dividendo(nome), transacoes(status)").single();

  if (error) {
    // 23505 = já existe um dividendo com esse ativo+conta+tipo+data+valor
    // (constraint ux_inv_dividendos_dedup) — provavelmente a busca automática
    // já provisionou este mesmo provento. Mensagem específica em vez do erro
    // cru do Postgres.
    if (error.code === "23505") {
      return erro("Já existe um dividendo igual (mesmo ativo, conta, tipo, data e valor) — provavelmente já provisionado pela busca automática.", 409);
    }
    logError("Associar dividendo existente", error); return erro(error.message);
  }
  logSuccess("Dividendo associado ao extrato existente", { id: data.id, tx: tx.id });
  return json({ dados: data }, 201);
}

// ============================================================
// /investimentos/associar-extrato-massa (POST, JWT)
//
// Vincula em LOTE proventos que já estão no extrato (RECEITA em categoria de
// investimento) mas sem inv_dividendos — caso típico de projeções de FII
// lançadas/recorrentes na mão. Para cada transação não vinculada, lê o ticker
// do INÍCIO da descrição ("TICKER - Nome"), acha o ativo do usuário e cria o
// inv_dividendos ligado (sem gerar nova transação). Não toca em receitas que
// não estejam em categoria de provento (Salário, transferências etc.).
// ============================================================
export async function rotaAssociarExtratoMassa(c: Db, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/associar-extrato-massa", { userId });

  // ticker → ativo
  const { data: ativos } = await c.from("inv_ativos").select("id, ticker, tipo_ativo");
  const porTicker = new Map<string, { id: string; tipo_ativo: string }>();
  for (const a of (ativos ?? []) as { id: string; ticker: string; tipo_ativo: string }[]) {
    porTicker.set(String(a.ticker).toUpperCase(), { id: String(a.id), tipo_ativo: a.tipo_ativo });
  }

  // categoria_id → tipo_dividendo_id (só categorias mapeadas = de investimento)
  const { data: tipos } = await c.from("inv_tipos_dividendo").select("id, categoria_id");
  const tipoPorCategoria = new Map<string, string>();
  for (const t of (tipos ?? []) as { id: string; categoria_id: string | null }[]) {
    if (t.categoria_id) tipoPorCategoria.set(String(t.categoria_id), String(t.id));
  }
  const catsInv = [...tipoPorCategoria.keys()];
  if (catsInv.length === 0) return json({ dados: { associados: 0, sem_ativo: 0, ja_vinculados: 0 } });

  // RECEITAS nessas categorias (qualquer status)
  const { data: txs } = await c.from("transacoes")
    .select("id, descricao, valor, data, conta_id, categoria_id")
    .eq("tipo", "RECEITA").in("categoria_id", catsInv).gt("valor", 0);
  const lista = (txs ?? []) as {
    id: string; descricao: string | null; valor: number; data: string; conta_id: string; categoria_id: string;
  }[];
  if (lista.length === 0) return json({ dados: { associados: 0, sem_ativo: 0, ja_vinculados: 0 } });

  // transações que já têm dividendo vinculado
  const jaLinkadas = new Set<string>();
  for (let i = 0; i < lista.length; i += 200) {
    const { data: vinc } = await c.from("inv_dividendos")
      .select("transacao_extrato_id").in("transacao_extrato_id", lista.slice(i, i + 200).map((t) => t.id));
    for (const v of vinc ?? []) {
      const tid = (v as { transacao_extrato_id: string | null }).transacao_extrato_id;
      if (tid) jaLinkadas.add(String(tid));
    }
  }

  let semAtivo = 0, jaVinc = 0;
  const novos: Record<string, unknown>[] = [];
  for (const t of lista) {
    if (jaLinkadas.has(t.id)) { jaVinc++; continue; }
    const tk = String(t.descricao ?? "").trim().split(/\s+/)[0].replace(/[^A-Za-z0-9]/g, "").toUpperCase();
    const ativo = tk ? porTicker.get(tk) : undefined;
    if (!ativo) { semAtivo++; continue; }
    novos.push({
      user_id: userId, ativo_id: ativo.id, conta_id: t.conta_id, valor: t.valor,
      data_pagamento: t.data, tipo_ativo: ativo.tipo_ativo,
      tipo_dividendo_id: tipoPorCategoria.get(String(t.categoria_id)) ?? null,
      descricao: null, transacao_extrato_id: t.id,
    });
  }

  let associados = 0;
  if (novos.length > 0) {
    try { associados = (await inserirEmLote(c, "inv_dividendos", novos, "id")).length; }
    catch (e) { logError("Associar extrato em massa", e); return erro((e as Error).message); }
  }
  logSuccess("Associar extrato em massa", { associados, semAtivo, jaVinc });
  return json({ dados: { associados, sem_ativo: semAtivo, ja_vinculados: jaVinc } });
}

// ============================================================
// /investimentos/tipos-dividendo — tipos editáveis + mapeamento
// para a categoria do extrato (1 categoria por tipo, reutilizável).
// A criação da categoria em si usa a Edge Function `categorias`;
// aqui só guardamos o categoria_id escolhido.
// ============================================================

export async function rotaTiposDividendo(c: Db, req: Request, m: string, userId: string) {
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

export async function rotaDividendosCron(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const naoAutorizado = autenticarCron(req);
  if (naoAutorizado) return naoAutorizado;
  logRequest("POST", "/investimentos/dividendos-cron", {});
  try { return json({ dados: await provisionarProventosUsd(dbAdmin(), null) }); }
  catch (e) { logError("dividendos-cron", e); return erro((e as Error).message ?? "Erro interno", 500); }
}

// Disparo MANUAL pelo usuário logado (mesmo botão "Buscar proventos" da
// página). Autenticado por JWT — roda a MESMA rotina do cron USD, escopada
// só ao próprio usuário. Usa o client do PRÓPRIO usuário (RLS), não
// dbAdmin() — mesma justificativa de rotaDividendosBuscarBr acima.
export async function rotaDividendosBuscarUsd(c: Db, _req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/dividendos-buscar-usd", { userId });
  try { return json({ dados: await provisionarProventosUsd(c, userId) }); }
  catch (e) { logError("dividendos-buscar-usd", e); return erro((e as Error).message ?? "Erro interno", 500); }
}

// Resultado padronizado das rotinas de provisão de proventos. `falhas_fonte`
// conta ativos cuja FONTE externa (B3/Polygon) não respondeu — antes essa
// falha era silenciosa e parecia "nenhum provento novo".
export interface ResultadoProvisaoProventos {
  processados: number; criados: number; atualizados: number;
  pulados: number; falhas_fonte: number; fontes_falha: string[];
  // Falhas ao GRAVAR no banco (insert/update) — ex.: migration faltando.
  erros: number; erro_exemplo: string | null;
}

// Núcleo compartilhado: provisiona proventos de ativos em USD via Polygon.
// filtroUserId = null processa TODOS os usuários (cron); um id processa só
// aquele usuário (disparo manual).
export async function provisionarProventosUsd(
  admin: Db, filtroUserId: string | null,
): Promise<ResultadoProvisaoProventos> {
  const hoje      = hojeISO();
  const dataCorte = recuarDias(hoje, DIAS_RETROATIVOS_PROVENTOS);

  // Ativos em USD (Polygon cobre papéis das bolsas americanas)
  let consulta = admin.from("inv_ativos")
    .select("id, user_id, ticker, nome, tipo_ativo").eq("moeda", "USD");
  if (filtroUserId) consulta = consulta.eq("user_id", filtroUserId);
  const { data: ativos, error } = await consulta;
  if (error) { logError("dividendos-usd ativos", error); throw new Error(error.message); }
  if (!ativos || ativos.length === 0) {
    return { processados: 0, criados: 0, atualizados: 0, pulados: 0, falhas_fonte: 0, fontes_falha: [], erros: 0, erro_exemplo: null };
  }

  const apiKey = Deno.env.get("POLYGON_API_KEY") ?? "";
  if (!apiKey) { logError("dividendos-usd", "POLYGON_API_KEY ausente"); throw new Error("POLYGON_API_KEY não configurada"); }

  // PTAX recente para conversão USD→BRL (mesma fonte/convenção do resto)
  try { await garantirSincronizado(admin); } catch (e) { logError("dividendos-usd ptax", e); }
  if (!(await ptaxVendaAte(admin, hoje))) { logError("dividendos-usd", "PTAX indisponível"); throw new Error("PTAX indisponível"); }

  let processados = 0, criados = 0, atualizados = 0, pulados = 0, falhasFonte = 0, erros = 0;
  let erroExemplo: string | null = null;
  const fontesFalha: string[] = [];
  for (const ativo of ativos as { id: string; user_id: string; ticker: string; nome: string; tipo_ativo: string }[]) {
    try {
      // Posições ATIVAS desse ativo, por conta
      const { data: posicoes } = await admin.from("inv_posicoes")
        .select("conta_id, quantidade").eq("ativo_id", ativo.id).eq("status", "ATIVA");
      if (!posicoes || posicoes.length === 0) continue;

      // Tipo "Dividendos" do usuário, com categoria mapeada. Lista TODAS as
      // linhas com esse nome e prioriza a mapeada: com tipos duplicados,
      // .maybeSingle() estourava erro e o usuário era pulado inteiro.
      const { data: tiposDiv } = await admin.from("inv_tipos_dividendo")
        .select("id, categoria_id").eq("user_id", ativo.user_id).eq("nome", "Dividendos");
      const tipoDiv = ((tiposDiv ?? []) as { id: string; categoria_id: string | null }[])
        .find((t) => t.categoria_id) ?? (tiposDiv ?? [])[0];
      if (!tipoDiv?.categoria_id) { pulados++; continue; }

      // O espaçamento entre chamadas (5 req/min do plano free) é garantido
      // dentro de buscarDividendosPolygon via aguardarRateLimitPolygon().
      const divs = await buscarDividendosPolygon(ativo.ticker, apiKey);
      if (divs === null) {
        falhasFonte++;
        if (fontesFalha.length < 10) fontesFalha.push(ativo.ticker);
        continue;
      }
      processados++;

      // Soma por pay_date (mesmo tipo, mesmo dia → 1x). Janela: futuros +
      // retroativos recentes (cobre dias em que o job não rodou e corrige a
      // PTAX estimada quando a data de pagamento chega).
      // A Polygon às vezes reemite o MESMO evento (pay_date + tipo + valor
      // idênticos) em consultas diferentes — sem filtrar isso, a soma por
      // pay_date inflava o provento (viu-se ETFs internacionais com valor
      // várias vezes maior que o real). Dedup por (pay_date, tipo, valor)
      // antes de somar: descarta repetições exatas, preserva eventos
      // legitimamente distintos (ex.: dividendo + ganho de capital no mesmo dia).
      const porData = new Map<string, number>();
      const vistos = new Set<string>();
      for (const d of divs) {
        if (d.pay_date < dataCorte) continue;
        const chave = `${d.pay_date}|${d.dividend_type}|${d.cash_amount}`;
        if (vistos.has(chave)) continue;
        vistos.add(chave);
        porData.set(d.pay_date, (porData.get(d.pay_date) ?? 0) + d.cash_amount);
      }

      for (const payDate of [...porData.keys()].sort()) {
        const cashPorAcao = porData.get(payDate)!;
        const ptax = (await ptaxVendaAte(admin, payDate)) ?? 0;
        if (ptax <= 0) continue;
        for (const pos of posicoes as { conta_id: string; quantidade: number }[]) {
          const valorBRL = Number((cashPorAcao * Number(pos.quantidade) * ptax).toFixed(2));
          if (valorBRL <= 0) continue;
          const r = await upsertDividendoProvisionado(admin, {
            userId: ativo.user_id, ativoId: ativo.id, contaId: pos.conta_id,
            tipoAtivo: ativo.tipo_ativo, tipoDivId: String(tipoDiv.id),
            categoriaId: String(tipoDiv.categoria_id), ticker: ativo.ticker,
            nome: ativo.nome,
            valor: valorBRL, payDate,
            // rate por ação convertido p/ BRL (mesma moeda do valor lançado)
            valorPorCota: Number((cashPorAcao * ptax).toFixed(8)),
            contaExclusiva: posicoes.length === 1,
          });
          if (r === "criado") criados++;
          else if (r === "atualizado") atualizados++;
          else if (typeof r === "object") { erros++; erroExemplo ??= `${ativo.ticker}: ${r.erro}`; }
        }
      }
    } catch (e) { logError("dividendos-usd ativo", e); }
  }

  logSuccess("Dividendos USD", { escopo: filtroUserId ?? "todos", processados, criados, atualizados, pulados, falhasFonte, erros });
  return { processados, criados, atualizados, pulados, falhas_fonte: falhasFonte, fontes_falha: fontesFalha, erros, erro_exemplo: erroExemplo };
}

// Última PTAX (venda) com data <= alvo (último dia útil). Para datas
// futuras retorna a cotação mais recente disponível (estimativa).
export async function ptaxVendaAte(admin: Db, dataAlvo: string): Promise<number | null> {
  const { data } = await admin.from("cotacoes_ptax")
    .select("cotacao_venda").lte("data", dataAlvo)
    .order("data", { ascending: false }).limit(1).maybeSingle();
  const v = Number((data as { cotacao_venda?: number } | null)?.cotacao_venda);
  return Number.isFinite(v) && v > 0 ? v : null;
}

// Janela retroativa (dias) das rotinas de provisão: além dos proventos
// FUTUROS, reprocessa os pagos há até N dias. Cobre execuções perdidas do
// job (provento anunciado e pago no intervalo) e corrige o valor/PTAX das
// projeções quando a data de pagamento chega.
export const DIAS_RETROATIVOS_PROVENTOS = 30;

// Primeiro dia do mês seguinte a "YYYY-MM" (limite exclusivo da janela do mês).
export function primeiroDiaProximoMes(payDate: string): string {
  let [y, mo] = payDate.slice(0, 7).split("-").map(Number);
  mo++; if (mo > 12) { mo = 1; y++; }
  return `${y}-${String(mo).padStart(2, "0")}-01`;
}

// Cria ou corrige uma provisão de provento. Reconcilia pela chave
// (user, ativo, conta, tipo) dentro do MÊS do pay_date:
//   • pay_date FUTURO (>= hoje): se já houver uma PROJECAO, atualiza
//     valor/data (no dividendo e na transação); senão cria o par
//     dividendo + transação RECEITA PROJECAO vinculados.
//   • pay_date PASSADO (janela retroativa): o provento JÁ FOI pago —
//     uma PROJECAO existente é confirmada (status → PAGO, com o valor
//     final da fonte); um lançamento já PAGO/PENDENTE no mês é respeitado
//     (não sobrescreve o que o usuário registrou); sem nada no mês, cria
//     direto como PAGO.
// Descrição padrão de um provento no extrato: "TICKER - Nome do ativo"
// (mesma convenção do lançamento manual em DrawerLancamento). Se o nome
// estiver vazio ou for igual ao ticker, usa só o ticker. Garante o mínimo
// de 2 caracteres exigido pela transação.
export function descricaoProvento(ticker: string, nome?: string | null): string {
  const tk = String(ticker ?? "").trim();
  const nm = String(nome ?? "").trim();
  const base = (nm && nm.toUpperCase() !== tk.toUpperCase() ? `${tk} - ${nm}` : tk).slice(0, 200);
  return base.length >= 2 ? base : `Dividendo ${base}`.slice(0, 200);
}

export async function upsertDividendoProvisionado(admin: Db, p: {
  userId: string; ativoId: string; contaId: string; tipoAtivo: string;
  tipoDivId: string; categoriaId: string; ticker: string; valor: number; payDate: string;
  nome?: string | null; valorPorCota?: number | null; contaExclusiva?: boolean;
}): Promise<"criado" | "atualizado" | "ignorado" | { erro: string }> {
  // Dividendo por cota (rate da fonte) na moeda do lançamento; usado por DY/YoC.
  const vpc = p.valorPorCota != null && Number.isFinite(p.valorPorCota) && p.valorPorCota > 0
    ? Number(p.valorPorCota) : null;
  const pago   = p.payDate < hojeISO(); // data de pagamento já passou
  const mesIni = `${p.payDate.slice(0, 7)}-01`;
  const mesFim = primeiroDiaProximoMes(p.payDate);

  // Busca de dedup: normalmente restrita à conta da POSIÇÃO (contaId), pois um
  // mesmo ativo pode ter posições legítimas em contas diferentes (cada uma com
  // seu próprio provento). MAS `inv_dividendos.conta_id` pode divergir da conta
  // da posição — `trg_sync_transacao_dividendo` propaga pra cá qualquer edição
  // manual do lançamento no Extrato, inclusive troca de conta (ex.: usuário
  // corrige pra onde o dinheiro realmente caiu, fora da conta de custódia).
  // Quando o ativo só tem UMA posição ativa (`contaExclusiva`), não há
  // ambiguidade possível — o provento só pode ser dela, esteja o registro em
  // qual conta estiver hoje. Sem essa relaxação, mover a conta do lançamento
  // faz esta busca (filtrada por contaId = conta da posição) nunca mais achar
  // o registro já movido, e o próximo cron cria um segundo do zero com o valor
  // bruto da fonte (achado real: BBDC3/JSCP duplicado em 2026-08 desta forma).
  let consultaCandidatos = admin.from("inv_dividendos")
    .select("id, transacao_extrato_id, valor, data_pagamento, valor_por_cota, transacoes(status)")
    .eq("user_id", p.userId).eq("ativo_id", p.ativoId)
    .eq("tipo_dividendo_id", p.tipoDivId)
    .gte("data_pagamento", mesIni).lt("data_pagamento", mesFim);
  if (!p.contaExclusiva) consultaCandidatos = consultaCandidatos.eq("conta_id", p.contaId);
  const { data: candidatos } = await consultaCandidatos;

  type Cand = { id: string; transacao_extrato_id: string | null; valor: number; data_pagamento: string; valor_por_cota: number | null; transacoes?: { status?: string } | null };
  const lista = (candidatos ?? []) as Cand[];
  // Entre as projeções do mês, só reaproveita a que já tem a MESMA data do
  // evento sendo processado. NUNCA cai para "a projeção do mês, seja qual
  // for" (mesmo havendo só 1 candidata) — essa versão anterior partia do
  // pressuposto de que uma única projeção diferente no mês só podia ser o
  // MESMO evento com data corrigida pela fonte, e reaproveitava reescrevendo
  // a data. Na prática um ativo pode ter 2+ tranches do mesmo tipo em DATAS
  // diferentes dentro do mês (não só na mesma data, caso já coberto pela
  // soma em provisionarProventosBrl) — cada execução então alternava qual
  // das duas "ganhava" a única linha existente, ficando permanentemente
  // "atualizado" e o valor/data oscilando entre os dois
  // eventos a cada dia (achado real: BBDC3/JSCP setembro/2026 — payDate
  // oscilando entre 01/09 e 15/09, cada um com seu próprio valor, porque só
  // existia 1 registro em inv_dividendos pra representar os dois). Sem data
  // exata, sempre cria um registro NOVO — nunca corrompe um existente.
  const projecoesDoMes = lista.filter((d) => d.transacoes?.status === "PROJECAO");
  const existente = projecoesDoMes.find((d) => String(d.data_pagamento).slice(0, 10) === p.payDate);

  // Já existe um registro NÃO-projeção (pago/pendente pelo usuário, ou
  // dividendo sem transação) para esta MESMA data de pagamento: não mexe,
  // não duplica. Checa por data exata (não só "existe algo no mês") e
  // independe de `pago` — `pago` usa payDate < hoje, então um provento com
  // vencimento HOJE fica com pago=false mesmo que o usuário já tenha
  // confirmado o recebimento mais cedo no mesmo dia; sem esse guard, a
  // busca seguinte não achava o (agora não-PROJECAO) existente e criava um
  // segundo lançamento duplicado com a mesma data/valor.
  const mesmaData = lista.find((d) => String(d.data_pagamento).slice(0, 10) === p.payDate);
  // Provento que a FONTE já reporta como pago (payDate no passado) e que já
  // tem QUALQUER registro não-projeção neste ativo+conta+tipo dentro do MÊS:
  // nunca duplica, mesmo que a data não bata mais exatamente. A B3 costuma
  // revisar/confirmar a data de pagamento de JSCP depois do anúncio inicial
  // (comum em bancos), e o usuário pode ter corrigido manualmente o valor
  // (ex.: refletindo IR retido) e/ou a data do que realmente caiu na conta.
  // Sem esta relaxação, um lançamento já PAGO com data no passado — que o
  // usuário espera nunca mais ver tocado — ficava vulnerável a duplicação
  // assim que a data exata deixasse de bater (achado real: JSCP BBDC
  // duplicado em 2026-08 após o usuário corrigir o valor líquido recebido).
  const jaResolvidoNoMes = lista.find((d) => d.transacoes?.status && d.transacoes.status !== "PROJECAO");
  if (!existente && (mesmaData || (pago && jaResolvidoNoMes))) return "ignorado";

  if (existente) {
    // Pagamento já vencido: nunca mexe num provento que já foi provisionado
    // — a confirmação (valor real + status Pago) é sempre manual (botão
    // "Confirmar" ou editando o lançamento no extrato). Sem isso, o cron
    // reconfirmava sozinho com o valor bruto da fonte (Polygon+PTAX, sem
    // considerar retenção de IR de 30% em dividendos de ações americanas)
    // e sobrescrevia qualquer correção manual do valor real recebido.
    if (pago) return "ignorado";

    // vpc quase sempre vem preenchido pela fonte (B3) — comparar só contra o
    // valor/data anteriores fazia o cron marcar "atualizado" TODO dia para
    // proventos futuros que não mudaram nada (o valor_por_cota "novo" era
    // idêntico ao já salvo), inflando o aviso de login com os mesmos itens.
    const round8 = (n: number) => Number(n.toFixed(8));
    const vpcAtual = existente.valor_por_cota != null ? round8(Number(existente.valor_por_cota)) : null;
    const vpcMudou = vpc != null && vpcAtual !== round8(vpc);
    const valorMudou = Number(existente.valor) !== p.valor;
    const dataMudou = String(existente.data_pagamento).slice(0, 10) !== p.payDate;
    if (!valorMudou && !dataMudou && !vpcMudou) return "ignorado";
    await admin.from("inv_dividendos")
      .update({ valor: p.valor, data_pagamento: p.payDate, ...(vpc != null ? { valor_por_cota: vpc } : {}) })
      .eq("id", existente.id);
    if (existente.transacao_extrato_id && (valorMudou || dataMudou)) {
      // Ainda em projeção: acompanha o valor/data mais recentes da fonte.
      await admin.from("transacoes")
        .update({ valor: p.valor, data: p.payDate, valor_projetado: p.valor })
        .eq("id", existente.transacao_extrato_id);
    }
    // "Atualizado" (conta pro aviso de login + toca a transação) só quando algo
    // que o usuário REALMENTE VÊ mudou (valor ou data). Uma variação só no
    // valor_por_cota — a taxa bruta da fonte, usada apenas internamente pro
    // DY/YoC — ainda é persistida acima (mantém a métrica precisa), mas sozinha
    // não conta como novidade: ela nunca muda o que aparece no extrato, e
    // notificar isso todo dia (achado real: aviso repetido com valor/data/conta/
    // descrição idênticos) inflava o login sem nenhuma mudança perceptível.
    return (valorMudou || dataMudou) ? "atualizado" : "ignorado";
  }

  // Sem inv_dividendos provisionado: tenta ADOTAR um lançamento manual que o
  // usuário já tenha criado na agenda para este provento (mesma conta +
  // categoria do tipo + mês, RECEITA ainda não vinculada a nenhum dividendo).
  // Evita duplicar quando a pessoa provisiona o aluguel na mão e o dia não
  // bate com o anúncio da B3. Para proventos passados considera também
  // lançamentos já PAGOS (recebidos e registrados na mão).
  const manual = await adotarTransacaoManual(admin, {
    userId: p.userId, contaId: p.contaId, categoriaId: p.categoriaId,
    ticker: p.ticker, mesIni, mesFim,
    statusIn: pago ? ["PROJECAO", "PENDENTE", "PAGO"] : ["PROJECAO", "PENDENTE"],
  });
  if (manual) {
    // Lançamento já PAGO: só vincula — o valor/data que o usuário registrou
    // (o que de fato caiu na conta) vence os números da fonte.
    const soVinculo = manual.status === "PAGO";
    const { data: div, error: errDiv } = await admin.from("inv_dividendos").insert({
      user_id: p.userId, ativo_id: p.ativoId, conta_id: p.contaId,
      valor: soVinculo ? manual.valor : p.valor,
      data_pagamento: soVinculo ? manual.data : p.payDate,
      tipo_ativo: p.tipoAtivo,
      tipo_dividendo_id: p.tipoDivId, descricao: null, transacao_extrato_id: manual.id,
      valor_por_cota: vpc,
    }).select("id").single();
    if (errDiv || !div) {
      // Mesma corrida documentada acima na criação "do zero" — outro processo
      // concorrente já criou o dividendo para este ativo/conta/tipo/data/valor.
      if (errDiv?.code === "23505") return "ignorado";
      logError("dividendos-cron adotar div", errDiv);
      return { erro: errDiv?.message ?? "falha ao adotar lançamento" };
    }
    if (!soVinculo) {
      // Atualiza valor/data do lançamento manual com os números reais da fonte
      // (o trigger trg_sync_transacao_dividendo mantém o dividendo alinhado).
      const campos: Record<string, unknown> = { valor: p.valor, data: p.payDate };
      if (manual.status === "PROJECAO") campos.valor_projetado = p.valor;
      if (pago) campos.status = "PAGO"; // pagamento confirmado pela fonte
      await admin.from("transacoes").update(campos).eq("id", manual.id);
    }
    return "atualizado";
  }

  // Cria o dividendo (sem vínculo ainda)
  const { data: div, error: errDiv } = await admin.from("inv_dividendos").insert({
    user_id: p.userId, ativo_id: p.ativoId, conta_id: p.contaId,
    valor: p.valor, data_pagamento: p.payDate, tipo_ativo: p.tipoAtivo,
    tipo_dividendo_id: p.tipoDivId, descricao: null, valor_por_cota: vpc,
  }).select("id").single();
  if (errDiv || !div) {
    // 23505 = violação da constraint ux_inv_dividendos_dedup (user+ativo+
    // conta+tipo+data+valor). O SELECT de dedup acima não é atômico com este
    // INSERT — duas execuções concorrentes (cron duplicado pelo agendador,
    // ou cron + clique manual "Buscar proventos agora" ao mesmo tempo) podem
    // ambas passar pelo "não existe ainda" e tentar criar o mesmo provento.
    // A constraint no banco é a rede de segurança final; aqui só tratamos o
    // conflito como "outro processo já criou" em vez de propagar como erro
    // (achado real de bug: PETR4/JSCP duplicado em 2026-07-04 e 2026-07-06).
    if (errDiv?.code === "23505") return "ignorado";
    logError("dividendos-cron criar div", errDiv);
    return { erro: errDiv?.message ?? "falha ao criar dividendo" };
  }

  const desc = descricaoProvento(p.ticker, p.nome);
  const { data: tx, error: errTx } = await admin.from("transacoes").insert({
    user_id: p.userId, conta_id: p.contaId, categoria_id: p.categoriaId,
    data: p.payDate, descricao: desc,
    valor: p.valor, tipo: "RECEITA",
    // Passado = já pago (mesma convenção do lançamento manual de dividendo);
    // futuro = provisionado (PROJECAO) até o usuário confirmar.
    status: pago ? "PAGO" : "PROJECAO",
    valor_projetado: pago ? null : p.valor,
  }).select("id").single();
  if (errTx || !tx) {
    await admin.from("inv_dividendos").delete().eq("id", div.id); // rollback
    logError("dividendos-cron criar tx", errTx);
    return { erro: errTx?.message ?? "falha ao lançar no extrato" };
  }

  await admin.from("inv_dividendos").update({ transacao_extrato_id: tx.id }).eq("id", div.id);
  return "criado";
}

// Procura um lançamento de provento que o usuário criou manualmente na agenda e
// que ainda NÃO está vinculado a nenhum inv_dividendos, para reaproveitar em vez
// de duplicar. Conservador: só adota quando consegue identificar UM único
// candidato (pelo ticker na descrição, ou um único lançamento livre no mês) —
// nunca arrisca encostar em receita que possa ser de outro provento.
export async function adotarTransacaoManual(admin: Db, p: {
  userId: string; contaId: string; categoriaId: string;
  ticker: string; mesIni: string; mesFim: string; statusIn?: string[];
}): Promise<{ id: string; status: string; valor: number; data: string } | null> {
  const { data: txs } = await admin.from("transacoes")
    .select("id, descricao, status, valor, data")
    .eq("user_id", p.userId).eq("conta_id", p.contaId)
    .eq("categoria_id", p.categoriaId).eq("tipo", "RECEITA")
    .in("status", p.statusIn ?? ["PROJECAO", "PENDENTE"])
    .gte("data", p.mesIni).lt("data", p.mesFim);
  const lista = (txs ?? []) as { id: string; descricao: string | null; status: string; valor: number; data: string }[];
  if (lista.length === 0) return null;

  // Descarta os que já pertencem a algum dividendo (já reconciliados).
  const { data: vinc } = await admin.from("inv_dividendos")
    .select("transacao_extrato_id").in("transacao_extrato_id", lista.map((t) => t.id));
  const usados = new Set(
    (vinc ?? []).map((v) => (v as { transacao_extrato_id: string }).transacao_extrato_id),
  );
  const livres = lista.filter((t) => !usados.has(t.id));
  if (livres.length === 0) return null;

  // Desambigua por ticker na descrição; senão, só adota se houver um único livre.
  const alvo = p.ticker.trim().toUpperCase();
  const paraResultado = (t: typeof livres[number]) =>
    ({ id: t.id, status: t.status, valor: Number(t.valor), data: String(t.data).slice(0, 10) });
  const porTicker = livres.filter((t) => (t.descricao ?? "").toUpperCase().includes(alvo));
  if (porTicker.length === 1) return paraResultado(porTicker[0]);
  if (porTicker.length === 0 && livres.length === 1) return paraResultado(livres[0]);
  return null; // ambíguo → não arrisca; segue para criar um novo
}

// Rate limit real do plano free da Polygon.io: 5 requisições por MINUTO
// (não por segundo). O código antigo esperava só 250–1250ms entre chamadas
// (até ~240 req/min) — a partir do 6º ticker em USD a Polygon respondia 429
// e o provento simplesmente não era criado, sem erro visível ao usuário
// (achado de auditoria: rate-limit mal dimensionado). 60_000/5 = 12_000ms
// mínimo entre chamadas; usamos 12_500ms de folga. Estado em módulo:
// suficiente para serializar as chamadas dentro de uma mesma execução do
// cron/rota manual (é sempre um loop sequencial, nunca paralelo).
export const POLYGON_MIN_INTERVALO_MS = 12_500;
let ultimaChamadaPolygonEm = 0;

export async function aguardarRateLimitPolygon(): Promise<void> {
  const espera = ultimaChamadaPolygonEm + POLYGON_MIN_INTERVALO_MS - Date.now();
  if (espera > 0) await new Promise((r) => setTimeout(r, espera));
  ultimaChamadaPolygonEm = Date.now();
}

// Proventos da Polygon.io (v3 reference dividends; incluído no plano free).
// Campos usados: pay_date, cash_amount (por ação, em USD), dividend_type.
// Devolve null quando a FONTE falha (HTTP != 2xx, timeout) — o chamador
// distingue "fonte fora do ar" de "ticker sem proventos".
export async function buscarDividendosPolygon(
  ticker: string, apiKey: string,
): Promise<{ pay_date: string; cash_amount: number; dividend_type: string }[] | null> {
  const t = ticker.trim().toUpperCase();
  if (!t) return [];
  const url =
    `https://api.polygon.io/v3/reference/dividends?ticker=${encodeURIComponent(t)}` +
    `&limit=50&order=desc&sort=pay_date&apiKey=${encodeURIComponent(apiKey)}`;

  // Até 2 tentativas: se a 1ª ainda assim vier 429 (ex.: chamada concorrente
  // fora deste loop), espera uma janela inteira (65s) e tenta de novo antes
  // de desistir — em vez de marcar como "fonte fora do ar" de cara.
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    await aguardarRateLimitPolygon();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (res.status === 429 && tentativa < 2) {
        logError("Polygon dividends", `${t}: 429 (tentativa ${tentativa}), aguardando janela e tentando de novo`);
        await new Promise((r) => setTimeout(r, 65_000));
        continue;
      }
      if (!res.ok) { logError("Polygon dividends", `${t}: ${res.status}`); return null; }
      const data = await res.json() as {
        results?: { pay_date?: string; cash_amount?: number; dividend_type?: string }[];
      };
      const out: { pay_date: string; cash_amount: number; dividend_type: string }[] = [];
      for (const d of data.results ?? []) {
        const pay  = String(d.pay_date ?? "").slice(0, 10);
        const cash = Number(d.cash_amount);
        if (!dataPagamentoPlausivel(pay) || !Number.isFinite(cash) || cash <= 0) continue;
        out.push({ pay_date: pay, cash_amount: cash, dividend_type: String(d.dividend_type ?? "") });
      }
      return out;
    } catch (e) { logError("Polygon dividends", `${t}: ${e}`); return null; }
  }
  return null;
}

// ============================================================
// /investimentos/dividendos-cron-br — JOB diário: provisiona proventos
// FUTUROS de ativos em BRL (ACOES / ETF / FII) a partir dos dados
// PÚBLICOS e GRATUITOS da B3. Sem JWT — protegido pelo x-cron-secret
// (= CRON_SECRET). Agende com pg_cron + pg_net (migration própria).
//
// Regras (espelham a rotina USD, definidas com o usuário):
//   • Fonte: endpoints públicos da B3 (não precisa de API key).
//       - ACOES/ETF → listedCompaniesProxy/GetListedSupplementCompany
//       - FII       → fundsProxy/GetListedSupplementFunds
//   • 1 requisição por ativo, com pausa aleatória curta entre elas.
//   • Só proventos FUTUROS (paymentDate >= hoje) → PROJECAO
//     ("provisionado"). BRL não usa PTAX.
//   • Valor por POSIÇÃO ATIVA: rate (por ação/cota) × quantidade.
//   • Tipo do provento mapeado pelo `label` da B3 → inv_tipos_dividendo:
//       DIVIDENDO        → "Dividendos"
//       JRS CAP PROPRIO  → "JSCP"
//       RENDIMENTO + FII → "Aluguel de FII"
//       RENDIMENTO + ação→ "Rend. Trib."
//     Sem categoria mapeada no tipo → pula (não lança sem extrato).
//   • Vários eventos do MESMO tipo na MESMA data (ex.: 2 tranches de JCP)
//     são somados e lançados 1x — evita que a 2ª tranche seja tratada como
//     "atualização" da 1ª e sobrescreva o valor (a reconciliação abaixo não
//     distingue por valor, só por ativo+conta+tipo+data). Tipos diferentes
//     no mesmo dia (Dividendo + JSCP) continuam lançamentos separados.
//   • Reconciliação: reusa upsertDividendoProvisionado (mesma chave
//     user+ativo+conta+tipo dentro do mês do pay_date).
// ============================================================
// JOB (todos os usuários) — protegido pelo x-cron-secret.
export async function rotaDividendosCronBr(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const naoAutorizado = autenticarCron(req);
  if (naoAutorizado) return naoAutorizado;
  logRequest("POST", "/investimentos/dividendos-cron-br", {});
  return json({ dados: await provisionarProventosBrl(dbAdmin(), null) });
}

// Disparo MANUAL pelo usuário logado (botão "Buscar proventos agora").
// Autenticado por JWT — roda a MESMA rotina, escopada só ao próprio usuário.
// Usa o client do PRÓPRIO usuário (RLS), não dbAdmin(): todas as tabelas
// tocadas (inv_ativos/posicoes/tipos_dividendo/dividendos, transacoes,
// usuarios) são user_id-scoped e o filtroUserId aqui é sempre o dono do JWT
// — service_role só é necessário na escrita da tabela COMPARTILHADA de PTAX
// (cotacoes_ptax), que sincronizarPtax já cuida internamente com seu
// próprio dbAdmin(), independente do client recebido aqui.
export async function rotaDividendosBuscarBr(c: Db, _req: Request, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/dividendos-buscar-br", { userId });
  return json({ dados: await provisionarProventosBrl(c, userId) });
}

// Núcleo compartilhado: provisiona proventos BRL. filtroUserId = null processa
// TODOS os usuários (cron); um id processa só aquele usuário (disparo manual).
export async function provisionarProventosBrl(
  admin: Db, filtroUserId: string | null,
): Promise<ResultadoProvisaoProventos> {
  const hoje      = hojeISO();
  const dataCorte = recuarDias(hoje, DIAS_RETROATIVOS_PROVENTOS);

  // Ativos BRL cotados que a B3 cobre com proventos
  let consulta = admin.from("inv_ativos")
    .select("id, user_id, ticker, nome, tipo_ativo, acoes_subtipo")
    .eq("moeda", "BRL").in("tipo_ativo", ["ACOES", "ETF", "FII"]);
  if (filtroUserId) consulta = consulta.eq("user_id", filtroUserId);
  const { data: ativos, error } = await consulta;
  if (error) { logError("dividendos-br ativos", error); throw new Error(error.message); }

  // Cache dos tipos de dividendo por usuário (nome → {id, categoria_id})
  const tiposPorUser = new Map<string, Map<string, { id: string; categoria_id: string | null }>>();
  async function tiposDoUsuario(userId: string) {
    if (tiposPorUser.has(userId)) return tiposPorUser.get(userId)!;
    const { data } = await admin.from("inv_tipos_dividendo")
      .select("id, nome, categoria_id").eq("user_id", userId);
    const mapa = new Map<string, { id: string; categoria_id: string | null }>();
    for (const t of (data ?? []) as { id: string; nome: string; categoria_id: string | null }[]) {
      // Defesa contra tipos DUPLICADOS por nome: o mapeado (com categoria)
      // sempre vence o não-mapeado, qualquer que seja a ordem da query.
      const cur = mapa.get(t.nome);
      if (!cur || (!cur.categoria_id && t.categoria_id)) {
        mapa.set(t.nome, { id: String(t.id), categoria_id: t.categoria_id });
      }
    }
    tiposPorUser.set(userId, mapa);
    return mapa;
  }

  // Pendências de mapeamento por usuário: tipo → {motivo, tickers}. Quando
  // um provento FUTURO não pode ser lançado por falta de categoria mapeada,
  // registramos aqui para avisar o usuário (ver persistência no fim).
  const pend = new Map<string, Map<string, { motivo: string; tickers: Set<string> }>>();
  const usuariosTocados = new Set<string>();
  // Novidades por usuário (criados/atualizados) para o aviso de login.
  const nov = new Map<string, { criados: number; atualizados: number; itens: NovidadeItem[] }>();

  let processados = 0, criados = 0, atualizados = 0, pulados = 0, falhasFonte = 0, erros = 0;
  let erroExemplo: string | null = null;
  const fontesFalha: string[] = [];
  for (const ativo of (ativos ?? []) as AtivoBrl[]) {
    try {
      const { data: posicoes } = await admin.from("inv_posicoes")
        .select("conta_id, quantidade").eq("ativo_id", ativo.id).eq("status", "ATIVA");
      if (!posicoes || posicoes.length === 0) continue;
      usuariosTocados.add(ativo.user_id);

      // Pausa aleatória curta (250–1250ms) — cordialidade com a B3
      await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 1000)));
      const proventos = await coletarProventosB3(ativo);
      if (proventos === null) {
        // A B3 não respondeu para este ativo — antes isso passava como
        // "processado sem novidades" e a falha ficava invisível.
        falhasFonte++;
        if (fontesFalha.length < 10) fontesFalha.push(ativo.ticker);
        continue;
      }
      processados++;

      // Alimenta o cache do histórico do fundo (base do DY/YoC projetado)
      await upsertProventosFundo(admin, ativo.user_id, ativo.id, proventos);

      const tipos = await tiposDoUsuario(ativo.user_id);

      // Agrupa por (payDate, tipo): a B3 pode anunciar 2+ tranches do MESMO
      // tipo na MESMA data (ex.: dois JCPs) — upsertDividendoProvisionado
      // reconcilia pela chave ativo+conta+tipo+data (sem o valor), então
      // processar cada tranche com uma chamada separada faria a 2ª ser
      // tratada como "atualização" da 1ª e SOBRESCREVER o valor em vez de
      // somar — a 1ª tranche sumia silenciosamente do extrato (achado real,
      // ver auditoria 2026-08-04). Somar por (data, tipo) antes de reconciliar
      // espelha o que o path USD já faz por data (ver buscarDividendosPolygon
      // acima) — tipos DIFERENTES no mesmo dia (Dividendo + JSCP) continuam
      // registros separados, pois a chave de agrupamento inclui o tipo.
      // Dedup de repetição exata da fonte (mesma defesa do path USD).
      const vistos = new Set<string>();
      const porDataTipo = new Map<string, { payDate: string; nomeTipo: string; rate: number }>();
      for (const pv of proventos) {
        // Futuros (PROJECAO) + retroativos recentes (lançados como PAGO);
        // cobre dias em que o job não rodou.
        if (pv.payDate < dataCorte) continue;
        const nomeTipo = tipoNomePorLabelB3(pv.label, ativo.tipo_ativo);
        const chaveVista = `${pv.payDate}|${nomeTipo}|${pv.rate}`;
        if (vistos.has(chaveVista)) continue;
        vistos.add(chaveVista);
        const chave = `${pv.payDate}|${nomeTipo}`;
        const atual = porDataTipo.get(chave);
        porDataTipo.set(chave, { payDate: pv.payDate, nomeTipo, rate: (atual?.rate ?? 0) + pv.rate });
      }

      for (const { payDate, nomeTipo, rate } of porDataTipo.values()) {
        const tipo = tipos.get(nomeTipo);
        if (!tipo?.categoria_id) {
          // Sem categoria → não lança; registra pendência para avisar.
          pulados++;
          registrarPendencia(pend, ativo.user_id, nomeTipo,
            tipo ? "sem_categoria" : "tipo_inexistente", ativo.ticker);
          continue;
        }

        for (const pos of posicoes as { conta_id: string; quantidade: number }[]) {
          const valorBRL = Number((rate * Number(pos.quantidade)).toFixed(2));
          if (valorBRL <= 0) continue;
          const r = await upsertDividendoProvisionado(admin, {
            userId: ativo.user_id, ativoId: ativo.id, contaId: pos.conta_id,
            tipoAtivo: ativo.tipo_ativo, tipoDivId: tipo.id,
            categoriaId: String(tipo.categoria_id), ticker: ativo.ticker,
            valor: valorBRL, payDate, nome: ativo.nome,
            valorPorCota: rate,
            contaExclusiva: posicoes.length === 1,
          });
          if (r === "criado" || r === "atualizado") {
            if (r === "criado") criados++; else atualizados++;
            registrarNovidade(nov, ativo.user_id, {
              ticker: ativo.ticker, tipo: nomeTipo, data_pagamento: payDate,
              valor: valorBRL, acao: r,
            });
          } else if (typeof r === "object") {
            erros++; erroExemplo ??= `${ativo.ticker}: ${r.erro}`;
          }
        }
      }
    } catch (e) { logError("dividendos-cron-br ativo", e); }
  }

  // Persiste (ou limpa) o aviso por usuário processado. Sobrescreve sempre:
  // ao mapear a categoria que faltava, a próxima execução zera o aviso.
  for (const userId of usuariosTocados) {
    const m = pend.get(userId);
    const tiposAviso = m && m.size > 0
      ? [...m.entries()].map(([tipo, info]) => ({
          tipo, motivo: info.motivo, tickers: [...info.tickers].slice(0, 30),
        }))
      : [];
    const aviso = tiposAviso.length > 0 ? { atualizado_em: hoje, tipos: tiposAviso } : null;
    await admin.from("usuarios").update({ inv_dividendos_avisos: aviso }).eq("id", userId);
  }

  // Persiste novidades p/ exibir no login. Mescla com o que ainda não foi
  // visto (o frontend zera ao visualizar) para não perder avisos antigos.
  for (const [userId, info] of nov) {
    const { data: cur } = await admin.from("usuarios")
      .select("inv_dividendos_novidades").eq("id", userId).single();
    const prev = (cur?.inv_dividendos_novidades ?? null) as NovidadesPayload | null;
    // Dedup por ativo+tipo+data: se o mesmo provento mudar de novo antes do
    // usuário ver o aviso anterior, mantém só a ocorrência mais recente
    // (evita listar o mesmo item repetido a cada execução do cron).
    const itensPorChave = new Map<string, NovidadeItem>();
    for (const it of [...info.itens, ...(prev?.itens ?? [])]) {
      const chave = `${it.ticker}|${it.tipo}|${it.data_pagamento}`;
      if (!itensPorChave.has(chave)) itensPorChave.set(chave, it);
    }
    const payload: NovidadesPayload = {
      gerado_em:   new Date().toISOString(),
      criados:     info.criados + (prev?.criados ?? 0),
      atualizados: info.atualizados + (prev?.atualizados ?? 0),
      itens:       [...itensPorChave.values()].slice(0, 25),
    };
    await admin.from("usuarios").update({ inv_dividendos_novidades: payload }).eq("id", userId);

    // Registro DURÁVEL na agenda: 1 lembrete-resumo CONCLUÍDO por execução
    // (a notificação do login some ao ser vista; este fica no histórico).
    const partes: string[] = [];
    if (info.criados > 0)     partes.push(`${info.criados} provisionado(s)`);
    if (info.atualizados > 0) partes.push(`${info.atualizados} atualizado(s)`);
    if (partes.length > 0) {
      const desc = `Proventos B3 (busca automática): ${partes.join(", ")}`.slice(0, 200);
      const { error: errLem } = await admin.from("lembretes")
        .insert({ user_id: userId, data: hoje, descricao: desc, status: "CONCLUIDO" });
      if (errLem) logError("dividendos-br lembrete", errLem);
    }
  }

  logSuccess("Dividendos BR", { escopo: filtroUserId ?? "todos", processados, criados, atualizados, pulados, falhasFonte, erros });
  return { processados, criados, atualizados, pulados, falhas_fonte: falhasFonte, fontes_falha: fontesFalha, erros, erro_exemplo: erroExemplo };
}

// ============================================================
// /investimentos/dividendos-backfill-rate (POST, JWT do usuário)
//
// Preenche inv_dividendos.valor_por_cota (rate por cota) dos proventos
// ANTIGOS que estão NULL, re-buscando da B3 e casando por (ativo + data de
// pagamento). É o que destrava o DY/YoC no padrão investidor10 para o
// histórico já existente. Só ações/ETF/FII em BRL (a B3 cobre esses).
//
// Casamento: 1 provento na data → aplica direto; vários (ex.: dividendo +
// JSCP no mesmo dia) → desambigua pelo tipo; se não der, pula (mantém NULL,
// cai na estimativa do /ranking).
// ============================================================
export async function rotaDividendosBackfillRate(c: Db, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/dividendos-backfill-rate", { userId });

  // Ativos BRL cobertos pela B3
  const { data: ativos, error: errAtv } = await c.from("inv_ativos")
    .select("id, user_id, ticker, nome, tipo_ativo, acoes_subtipo")
    .eq("moeda", "BRL").in("tipo_ativo", ["ACOES", "ETF", "FII"]);
  if (errAtv) { logError("backfill-rate ativos", errAtv); return erro(errAtv.message); }

  let processados = 0, preenchidos = 0, semFonte = 0, ambiguos = 0;
  for (const ativo of (ativos ?? []) as AtivoBrl[]) {
    try {
      // Proventos do ativo ainda sem rate
      const { data: rows } = await c.from("inv_dividendos")
        .select("id, data_pagamento, valor, inv_tipos_dividendo(nome)")
        .eq("ativo_id", ativo.id).is("valor_por_cota", null);

      // Cortesia com a B3: pausa curta antes da requisição
      await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 1000)));
      const proventos = await coletarProventosB3(ativo);
      processados++;
      if (proventos === null) { semFonte += rows?.length ?? 0; continue; }

      // Alimenta o cache do histórico do fundo mesmo sem pendência de rate:
      // é daqui que o /ranking tira o DY/YoC projetado de posses <12m.
      await upsertProventosFundo(c, userId, ativo.id, proventos);

      if (!rows || rows.length === 0) continue;
      if (proventos.length === 0) { semFonte += rows.length; continue; }

      // payDate → [{ rate, tipoNome }]
      const porData = new Map<string, { rate: number; tipoNome: string }[]>();
      for (const pv of proventos) {
        const tipoNome = tipoNomePorLabelB3(pv.label, ativo.tipo_ativo);
        const lista = porData.get(pv.payDate) ?? [];
        lista.push({ rate: pv.rate, tipoNome });
        porData.set(pv.payDate, lista);
      }

      for (const row of rows as { id: string; data_pagamento: string; inv_tipos_dividendo?: { nome?: string } | null }[]) {
        const cands = porData.get(String(row.data_pagamento).slice(0, 10));
        if (!cands || cands.length === 0) { semFonte++; continue; }
        let rate: number | null = null;
        if (cands.length === 1) {
          rate = cands[0].rate;
        } else {
          const nomeRow = row.inv_tipos_dividendo?.nome ?? "";
          const match = cands.filter((c2) => c2.tipoNome === nomeRow);
          if (match.length === 1) rate = match[0].rate;
        }
        if (rate == null || !(rate > 0)) { ambiguos++; continue; }
        const { error: errUpd } = await c.from("inv_dividendos")
          .update({ valor_por_cota: Number(rate.toFixed(8)) }).eq("id", row.id);
        if (errUpd) { logError("backfill-rate update", errUpd); continue; }
        preenchidos++;
      }
    } catch (e) { logError("backfill-rate ativo", e); }
  }

  logSuccess("Backfill rate", { processados, preenchidos, semFonte, ambiguos });
  return json({ dados: { processados, preenchidos, sem_fonte: semFonte, ambiguos } });
}

// ============================================================
// /investimentos/dividendos-diagnostico (GET, JWT do usuário)
//
// DRY-RUN da busca de proventos: NÃO grava nada. Para cada ativo do
// usuário mostra o estado de cada elo da corrente — posição ativa, fonte
// coberta (B3/Polygon), status HTTP real da fonte, quantos proventos ela
// devolveu, quantos caem na janela de provisão e quais tipos ainda estão
// sem categoria mapeada. É o que responde "por que a busca voltou vazia?".
// ============================================================
export interface DiagAtivo {
  ticker: string; tipo_ativo: string; moeda: string;
  posicao_ativa: boolean;
  fonte: "B3" | "Polygon" | null;   // null = tipo/moeda sem fonte de proventos
  http: number | null;              // status HTTP da fonte (null = não consultada)
  erro: string | null;              // falha de rede/parse, se houver
  proventos_fonte: number;          // itens válidos que a fonte devolveu
  na_janela: number;                // com pagamento dentro da janela de provisão
  futuros: number;                  // com pagamento >= hoje
  tipos_pendentes: string[];        // tipos usados na janela e sem categoria
}

export async function rotaDividendosDiagnostico(c: Db, m: string, userId: string) {
  if (m !== "GET") return erro("Método não permitido", 405);
  logRequest("GET", "/investimentos/dividendos-diagnostico", { userId });

  const hoje      = hojeISO();
  const dataCorte = recuarDias(hoje, DIAS_RETROATIVOS_PROVENTOS);

  const { data: ativos, error: errAtv } = await c.from("inv_ativos")
    .select("id, ticker, tipo_ativo, acoes_subtipo, moeda");
  if (errAtv) { logError("diagnostico ativos", errAtv); return erro(errAtv.message); }

  // Tipos do usuário (nome → mapeado?), com a mesma preferência da provisão
  const { data: tiposRaw } = await c.from("inv_tipos_dividendo").select("nome, categoria_id");
  const tipos = new Map<string, boolean>();
  for (const t of (tiposRaw ?? []) as { nome: string; categoria_id: string | null }[]) {
    tipos.set(t.nome, (tipos.get(t.nome) ?? false) || !!t.categoria_id);
  }

  // PTAX e chave da Polygon (pré-requisitos do fluxo USD)
  const admin = dbAdmin();
  try { await garantirSincronizado(admin); } catch (e) { logError("diagnostico ptax", e); }
  const ptaxUltima = await ultimaCotacaoPtax(c);
  const polygonKey = !!(Deno.env.get("POLYGON_API_KEY") ?? "");

  const itens: DiagAtivo[] = [];
  for (const ativo of (ativos ?? []) as (AtivoBrl & { moeda: string })[]) {
    const { data: pos } = await c.from("inv_posicoes")
      .select("id").eq("ativo_id", ativo.id).eq("status", "ATIVA").limit(1);
    const posicaoAtiva = !!pos && pos.length > 0;

    const ehBrl = ativo.moeda === "BRL" && ["ACOES", "ETF", "FII"].includes(ativo.tipo_ativo);
    const ehUsd = ativo.moeda === "USD";
    const item: DiagAtivo = {
      ticker: ativo.ticker, tipo_ativo: ativo.tipo_ativo, moeda: ativo.moeda,
      posicao_ativa: posicaoAtiva,
      fonte: ehBrl ? "B3" : ehUsd ? "Polygon" : null,
      http: null, erro: null, proventos_fonte: 0, na_janela: 0, futuros: 0,
      tipos_pendentes: [],
    };
    itens.push(item);
    // Sem posição ativa ou sem fonte: a provisão pula — não consulta a fonte
    if (!posicaoAtiva || !item.fonte) continue;

    // Cordialidade com as fontes (mesma pausa da provisão, mais curta)
    await new Promise((r) => setTimeout(r, 150 + Math.floor(Math.random() * 350)));

    if (ehBrl) {
      const url = ativo.tipo_ativo === "FII"
        ? urlSupplementFundoB3(emissorB3(ativo.ticker))
        : urlSupplementCompanhiaB3(emissorB3(ativo.ticker));
      try {
        const res = await fetch(url, { headers: B3_HEADERS, signal: AbortSignal.timeout(8000) });
        item.http = res.status;
        const txt = await res.text();
        if (!res.ok) { item.erro = `B3 respondeu HTTP ${res.status}`; continue; }
        if (!txt || txt === '""' || txt === "null") continue; // sem dados p/ o ativo
        const data = JSON.parse(txt) as { cashDividends?: B3CashDividend[] }[] | { cashDividends?: B3CashDividend[] };
        const reg  = Array.isArray(data) ? data[0] : data;
        const brutos = mapearCashDividends(reg?.cashDividends);
        item.proventos_fonte = brutos.length;
        const pendentes = new Set<string>();
        for (const pv of brutos) {
          if (pv.payDate >= hoje) item.futuros++;
          if (pv.payDate < dataCorte) continue;
          item.na_janela++;
          const nomeTipo = tipoNomePorLabelB3(pv.label, ativo.tipo_ativo);
          if (!tipos.get(nomeTipo)) pendentes.add(nomeTipo);
        }
        item.tipos_pendentes = [...pendentes];
      } catch (e) { item.erro = String((e as Error).message ?? e); }
    } else if (ehUsd) {
      if (!polygonKey) { item.erro = "POLYGON_API_KEY não configurada"; continue; }
      const t = ativo.ticker.trim().toUpperCase();
      const url =
        `https://api.polygon.io/v3/reference/dividends?ticker=${encodeURIComponent(t)}` +
        `&limit=50&order=desc&sort=pay_date&apiKey=${encodeURIComponent(Deno.env.get("POLYGON_API_KEY") ?? "")}`;
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        item.http = res.status;
        if (!res.ok) { item.erro = `Polygon respondeu HTTP ${res.status}`; continue; }
        const data = await res.json() as { results?: { pay_date?: string; cash_amount?: number }[] };
        for (const d of data.results ?? []) {
          const pay  = String(d.pay_date ?? "").slice(0, 10);
          const cash = Number(d.cash_amount);
          if (!dataPagamentoPlausivel(pay) || !Number.isFinite(cash) || cash <= 0) continue;
          item.proventos_fonte++;
          if (pay >= hoje) item.futuros++;
          if (pay >= dataCorte) item.na_janela++;
        }
        if (item.na_janela > 0 && !tipos.get("Dividendos")) item.tipos_pendentes = ["Dividendos"];
      } catch (e) { item.erro = String((e as Error).message ?? e); }
    }
  }

  logSuccess("Diagnóstico de proventos", { userId, ativos: itens.length });
  return json({ dados: {
    hoje, janela_dias: DIAS_RETROATIVOS_PROVENTOS, data_corte: dataCorte,
    ptax_ultima: ptaxUltima, polygon_key: polygonKey,
    tipos: [...tipos.entries()].map(([nome, mapeado]) => ({ nome, mapeado })),
    ativos: itens,
  } });
}

// ============================================================
// /investimentos/migrar-conta (POST, JWT do usuário)
//
// Move os dados de investimento de uma conta para outra — caso típico:
// a importação criou uma conta provisória ("Investimentos XP") e o
// usuário quer consolidar na conta real. `ativo_ids` (opcional) restringe
// a migração a ativos específicos: sem ele, migra a conta inteira.
//   • inv_posicoes → update de conta_id; inv_operacoes acompanham as
//     posições migradas (histórico da posição segue junto);
//   • inv_dividendos → update de conta_id + as transações vinculadas no
//     extrato acompanham (o saldo sai de uma conta e entra na outra);
//   • inv_historico_mensal → tem UNIQUE (ativo, conta, mês): meses sem
//     conflito são movidos; em conflito os valores são SOMADOS no destino
//     (mesmo ativo nas duas contas) e a linha de origem removida.
// O destino precisa ser uma conta de INVESTIMENTO ativa. Tudo via RLS do
// usuário (c) — só alcança as próprias linhas.
// ============================================================
export interface NovidadeItem {
  ticker: string; tipo: string; data_pagamento: string; valor: number;
  acao: "criado" | "atualizado";
}
export interface NovidadesPayload {
  gerado_em: string; criados: number; atualizados: number; itens: NovidadeItem[];
}

// Acumula um provento criado/atualizado para o aviso de login.
export function registrarNovidade(
  nov: Map<string, { criados: number; atualizados: number; itens: NovidadeItem[] }>,
  userId: string, item: NovidadeItem,
) {
  let n = nov.get(userId);
  if (!n) { n = { criados: 0, atualizados: 0, itens: [] }; nov.set(userId, n); }
  if (item.acao === "criado") n.criados++; else n.atualizados++;
  if (n.itens.length < 25) n.itens.push(item);
}

// Acumula uma pendência de mapeamento (tipo sem categoria / inexistente).
export function registrarPendencia(
  pend: Map<string, Map<string, { motivo: string; tickers: Set<string> }>>,
  userId: string, tipo: string, motivo: string, ticker: string,
) {
  let m = pend.get(userId);
  if (!m) { m = new Map(); pend.set(userId, m); }
  const cur = m.get(tipo);
  if (cur) cur.tickers.add(ticker);
  else m.set(tipo, { motivo, tickers: new Set([ticker]) });
}

export interface AtivoBrl {
  id: string; user_id: string; ticker: string; nome: string;
  tipo_ativo: string; acoes_subtipo: string | null;
}
export interface ProventoB3 { payDate: string; rate: number; label: string }

// Identificador B3 = ticker sem os dígitos finais (PETR4→PETR, HGLG11→HGLG).
export function emissorB3(ticker: string): string {
  return ticker.trim().toUpperCase().replace(/\d+$/, "");
}

// Mapeia o label da B3 + tipo do ativo para o nome do inv_tipos_dividendo.
export function tipoNomePorLabelB3(label: string, tipoAtivo: string): string {
  const l = label.trim().toUpperCase();
  if (l.includes("JRS") || l.includes("JCP") || l.includes("JURO")) return "JSCP";
  if (l.includes("DIVIDENDO")) return "Dividendos";
  // RENDIMENTO (e demais): FII = aluguel; ação/ETF = rendimento tributável
  return tipoAtivo === "FII" ? "Aluguel de FII" : "Rend. Trib.";
}

// Coleta proventos FUTUROS-inclusos da B3 e deduplica. Para ações filtra
// a classe (ON/PN/UNIT) do papel; para FII junta as séries de mesma data.
// Devolve null quando a FONTE falha (HTTP != 2xx, timeout, resposta
// inválida) — o chamador distingue de "ativo sem proventos anunciados".
export async function coletarProventosB3(ativo: AtivoBrl): Promise<ProventoB3[] | null> {
  const brutos = ativo.tipo_ativo === "FII"
    ? await buscarProventosFundoB3(emissorB3(ativo.ticker))
    : await buscarProventosCompanhiaB3(emissorB3(ativo.ticker));
  if (brutos === null) return null;
  if (brutos.length === 0) return [];

  const classeAlvo = classeDoTicker(ativo.ticker, ativo.acoes_subtipo);
  // Dedup por (payDate|label|rate) — o rate entra na chave de propósito.
  // O objetivo aqui é só juntar o MESMO pagamento reportado sob classes
  // diferentes (ON/PN) do mesmo emissor (a busca é por emissor, sem o
  // sufixo do papel, então a B3 devolve os cashDividends de TODAS as
  // classes misturados) — nunca colapsar tranches genuinamente distintas
  // anunciadas na mesma data com o mesmo label. Sem o rate na chave, 2
  // JCPs legítimos no mesmo dia (mesmo label "JRS CAP PROPRIO", valores por
  // ação diferentes) caíam na mesma chave e o 2º sobrescrevia o 1º — a
  // soma por (data, tipo) em provisionarProventosBrl nunca via as duas
  // tranches, só a que sobrou (achado real: BBDC3/JSCP setembro/2026, dois
  // JCPs de R$0,27 e R$0,32/ação no mesmo payDate — o app só provisionava
  // R$62,76, nunca a soma R$116,55 que a B3 realmente paga).
  const escolhido = new Map<string, ProventoB3 & { classe: "ON" | "PN" | null }>();
  for (const b of brutos) {
    const chave = `${b.payDate}|${b.label}|${b.rate}`;
    const atual = escolhido.get(chave);
    if (!atual) { escolhido.set(chave, b); continue; }
    if (ativo.tipo_ativo !== "FII" && classeAlvo) {
      // Substitui se o novo casa com a classe e o atual não
      if (b.classe === classeAlvo && atual.classe !== classeAlvo) escolhido.set(chave, b);
    }
  }
  return [...escolhido.values()].map(({ payDate, rate, label }) => ({ payDate, rate, label }));
}

// ============================================================
// Cache do histórico do FUNDO (inv_proventos_fundo)
//
// Grava os rates que a B3 devolveu para o ativo (janela ~13 meses),
// independente de o usuário ter posição na data — inv_dividendos só
// cobre o período de posse. É daqui que o /ranking tira o DY/YoC
// projetado (padrão investidor10) de posições com <12m de posse.
// Falha aqui não interrompe a rotina chamadora (cache é best-effort).
// ============================================================
export async function upsertProventosFundo(c: Db, userId: string, ativoId: string, proventos: ProventoB3[]) {
  const corte = new Date();
  corte.setMonth(corte.getMonth() - 13);
  const corteISO = corte.toISOString().split("T")[0];
  const rows = proventos
    .filter((p) => p.payDate >= corteISO && p.rate > 0)
    .map((p) => ({
      user_id: userId, ativo_id: ativoId, data_pagamento: p.payDate,
      label: p.label ?? "", valor_por_cota: Number(p.rate.toFixed(8)),
      atualizado_em: new Date().toISOString(),
    }));
  if (rows.length === 0) return;
  const { error } = await c.from("inv_proventos_fundo")
    .upsert(rows, { onConflict: "ativo_id,data_pagamento,label" });
  if (error) logError("upsertProventosFundo", error);
}

// Classe-alvo do papel: prioriza acoes_subtipo; senão deduz do sufixo
// numérico (3=ON, 4/5/6=PN, 11=UNIT). null = indeterminado (ex.: ETF/FII).
export function classeDoTicker(ticker: string, subtipo: string | null): "ON" | "PN" | "UNIT" | null {
  if (subtipo === "ON" || subtipo === "PN" || subtipo === "UNIT") return subtipo;
  const m = ticker.trim().match(/(\d+)$/);
  if (!m) return null;
  const suf = m[1];
  if (suf === "3") return "ON";
  if (suf === "4" || suf === "5" || suf === "6") return "PN";
  if (suf === "11") return "UNIT";
  return null;
}

// Classe a partir do ISIN da B3 (…OR<dig> = ON, …PR<dig> = PN).
export function classeDoIsin(isin: string): "ON" | "PN" | null {
  const s = (isin ?? "").toUpperCase();
  if (/OR\d$/.test(s)) return "ON";
  if (/PR\d$/.test(s)) return "PN";
  return null;
}

// URLs dos endpoints públicos da B3 (supplement = inclui cashDividends).
export function urlSupplementCompanhiaB3(issuer: string): string {
  const params = btoa(JSON.stringify({ issuingCompany: issuer, language: "pt-br" }));
  return `https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetListedSupplementCompany/${params}`;
}
export function urlSupplementFundoB3(identifier: string): string {
  const params = btoa(JSON.stringify({ typeFund: 7, identifierFund: identifier }));
  return `https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedSupplementFunds/${params}`;
}

// Proventos de COMPANHIA (ações/ETF) — GetListedSupplementCompany.
// null = a B3 não respondeu (difere de "sem proventos anunciados").
export async function buscarProventosCompanhiaB3(issuer: string): Promise<(ProventoB3 & { classe: "ON" | "PN" | null })[] | null> {
  if (!issuer) return [];
  const data = await fetchB3<{ cashDividends?: B3CashDividend[] }[]>(urlSupplementCompanhiaB3(issuer), issuer);
  if (data === "falha") return null;
  const reg = Array.isArray(data) ? data[0] : data;
  return mapearCashDividends(reg?.cashDividends);
}

// Proventos de FUNDO (FII) — GetListedSupplementFunds.
// null = a B3 não respondeu (difere de "sem proventos anunciados").
export async function buscarProventosFundoB3(identifier: string): Promise<(ProventoB3 & { classe: "ON" | "PN" | null })[] | null> {
  if (!identifier) return [];
  const data = await fetchB3<{ cashDividends?: B3CashDividend[] }>(urlSupplementFundoB3(identifier), identifier);
  if (data === "falha") return null;
  const reg = Array.isArray(data) ? data[0] : data;
  return mapearCashDividends(reg?.cashDividends);
}

export interface B3CashDividend {
  paymentDate?: string; rate?: string; label?: string; isinCode?: string; assetIssued?: string;
}

export function mapearCashDividends(lista?: B3CashDividend[]): (ProventoB3 & { classe: "ON" | "PN" | null })[] {
  const out: (ProventoB3 & { classe: "ON" | "PN" | null })[] = [];
  for (const d of lista ?? []) {
    const payDate = brDataISO(String(d.paymentDate ?? ""));
    const rate    = brNumero(String(d.rate ?? ""));
    if (!dataPagamentoPlausivel(payDate) || !Number.isFinite(rate) || rate <= 0) continue;
    out.push({
      payDate, rate, label: String(d.label ?? ""),
      classe: classeDoIsin(String(d.isinCode ?? d.assetIssued ?? "")),
    });
  }
  return out;
}

// Headers de navegador: o WAF da B3 (Akamai) recusa clients "crus".
