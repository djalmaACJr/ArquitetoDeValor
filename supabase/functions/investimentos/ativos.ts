// supabase/functions/investimentos/ativos.ts
// Rotas /investimentos/ativos e /investimentos/alocacoes (extraído de index.ts).
import {
  json, erro, extrairId, verificarExistencia, camposParaAtualizar,
} from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import {
  Db, TIPOS_ATIVO, SUBTIPOS_RF, INDEXADORES_RF, INDICES_RF, CATEGORIAS_FII, SUBTIPOS_ACOES,
  ativoExiste,
} from "./shared.ts";
import { resolverNomes, rebuildHistoricoRF } from "./mercado.ts";

export async function rotaAtivos(c: Db, req: Request, m: string, userId: string) {
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

    if (!body.ticker || !body.tipo_ativo) {
      return erro("Campos obrigatórios: ticker, tipo_ativo");
    }
    if (!TIPOS_ATIVO.includes(String(body.tipo_ativo))) {
      return erro(`tipo_ativo inválido: ${TIPOS_ATIVO.join(" | ")}`);
    }
    const ticker = String(body.ticker).trim().toUpperCase();
    if (ticker.length < 1 || ticker.length > 20) return erro("ticker deve ter 1..20 caracteres");

    // Nome: usa o informado; se vazio ou igual ao ticker, busca o oficial
    // na fonte externa (a menos que não ache → cai no ticker).
    let nome = String(body.nome ?? "").trim();
    if (!nome || nome.toUpperCase() === ticker) {
      const m = await resolverNomes([{ ticker, tipo_ativo: String(body.tipo_ativo) }]);
      nome = m.get(ticker) ?? nome;
    }
    nome = (nome || ticker).slice(0, 120);

    const erroNota = validarNota(body.nota_usuario);
    if (erroNota) return erro(erroNota);
    const erroResp = validarRespostas(body.questionario_respostas);
    if (erroResp) return erro(erroResp);
    const erroRF = validarCamposRF(body);
    if (erroRF) return erro(erroRF);

    if (body.ativo_pai && !(await ativoExiste(c, body.ativo_pai))) {
      return erro("ativo_pai não encontrado", 404);
    }

    const { data, error } = await c.from("inv_ativos").insert({
      user_id:      userId,
      ticker,
      nome,
      tipo_ativo:   body.tipo_ativo,
      moeda:        body.moeda ? String(body.moeda).toUpperCase().slice(0, 3) : "BRL",
      descricao:    body.descricao ?? null,
      nota_usuario: body.nota_usuario ?? null,
      questionario_respostas: body.questionario_respostas ?? null,
      ativo_pai:    body.ativo_pai ?? null,
      rf_subtipo:      body.rf_subtipo ?? null,
      rf_indexador:    body.rf_indexador ?? null,
      rf_indice:            body.rf_indice ?? null,
      rf_percentual_indice: body.rf_percentual_indice ?? null,
      rf_taxa_fixa:         body.rf_taxa_fixa ?? null,
      rf_taxa:         body.rf_taxa ?? null,
      rf_emissor:      body.rf_emissor ?? null,
      rf_vencimento:   body.rf_vencimento ?? null,
      rf_garantia_fgc: body.rf_garantia_fgc ?? null,
      rf_isento_ir:    body.rf_isento_ir ?? null,
      fii_categoria:   body.fii_categoria ?? null,
      acoes_subtipo:   body.acoes_subtipo ?? null,
      cripto_rendimento_aa: body.cripto_rendimento_aa ?? null,
      cripto_rendimento_inicio: body.cripto_rendimento_inicio ?? null,
      cripto_rendimento_periodicidade: body.cripto_rendimento_periodicidade ?? null,
      cotacao_automatica: body.cotacao_automatica ?? true,
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

    // Estado dos campos que DEFINEM o valor de mercado da renda fixa, antes do
    // update — para detectar, depois, se a forma de rentabilidade mudou.
    const { data: antesRF } = await c.from("inv_ativos")
      .select("tipo_ativo, rf_indexador, rf_taxa, rf_vencimento")
      .eq("id", id).maybeSingle();

    if (body.tipo_ativo !== undefined && !TIPOS_ATIVO.includes(String(body.tipo_ativo))) {
      return erro(`tipo_ativo inválido: ${TIPOS_ATIVO.join(" | ")}`);
    }
    const erroNota = validarNota(body.nota_usuario);
    if (erroNota) return erro(erroNota);
    const erroResp = validarRespostas(body.questionario_respostas);
    if (erroResp) return erro(erroResp);
    const erroRF = validarCamposRF(body);
    if (erroRF) return erro(erroRF);
    if (body.ativo_pai && (body.ativo_pai === id)) return erro("ativo_pai não pode ser o próprio ativo");
    if (body.ativo_pai && !(await ativoExiste(c, body.ativo_pai))) return erro("ativo_pai não encontrado", 404);

    const campos = camposParaAtualizar(body, [
      "ticker", "nome", "tipo_ativo", "moeda", "descricao", "nota_usuario",
      "questionario_respostas", "ativo_pai",
      "rf_subtipo", "rf_indexador", "rf_indice", "rf_percentual_indice",
      "rf_taxa_fixa", "rf_taxa", "rf_emissor",
      "rf_vencimento", "rf_garantia_fgc", "rf_isento_ir", "fii_categoria",
      "acoes_subtipo", "cripto_rendimento_aa", "cripto_rendimento_inicio",
      "cripto_rendimento_periodicidade", "cotacao_automatica",
    ]);
    if (typeof campos.ticker === "string") campos.ticker = campos.ticker.trim().toUpperCase();

    const { data, error } = await c.from("inv_ativos").update(campos).eq("id", id).select().single();
    if (error) {
      if (error.code === "23505") return erro("Já existe um ativo com este ticker", 409);
      logError("Editar ativo", error); return erro(error.message);
    }
    // Propaga tipo_ativo para a cópia desnormalizada em inv_dividendos. Existe
    // também um trigger no banco (trg_sync_dividendo_tipo_ativo); repetimos aqui
    // de forma idempotente para garantir a sincronização mesmo que a migration
    // do trigger não esteja aplicada — evitando dados divergentes (backup,
    // dedup de importação, etc. leem a coluna armazenada).
    if (campos.tipo_ativo !== undefined) {
      const { error: errSync } = await c.from("inv_dividendos")
        .update({ tipo_ativo: campos.tipo_ativo })
        .eq("ativo_id", id)
        .neq("tipo_ativo", campos.tipo_ativo);
      if (errSync) logError("Sincronizar tipo_ativo dos dividendos", errSync);
    }

    // Renda fixa: o valor de mercado é DERIVADO do indexador/taxa (não vem de
    // cotação externa). Se a forma de rentabilidade mudou, os snapshots mensais
    // já gravados ficam defasados — ex.: ativo importado SEM indexador teve o
    // histórico achatado no custo; ao marcar "110% CDI" depois, os meses antigos
    // continuariam parados e todo o rendimento se acumularia num único mês.
    // Apaga a série defasada e a reconstrói do 1º aporte até o mês corrente.
    const ehRFTipo = (t: unknown) => t === "RENDA_FIXA" || t === "TESOURO_DIRETO";
    const mudouRF = !!antesRF && (
      antesRF.tipo_ativo    !== data.tipo_ativo    ||
      antesRF.rf_indexador  !== data.rf_indexador  ||
      antesRF.rf_taxa       !== data.rf_taxa       ||
      antesRF.rf_vencimento !== data.rf_vencimento
    );
    if (mudouRF && (ehRFTipo(data.tipo_ativo) || ehRFTipo(antesRF?.tipo_ativo))) {
      try {
        await c.from("inv_historico_mensal").delete().eq("ativo_id", id);
        // Só reconstrói se CONTINUA renda fixa. Se virou um tipo cotado, o
        // histórico será preenchido pelo backfill/snapshot a partir da cotação.
        if (ehRFTipo(data.tipo_ativo)) await rebuildHistoricoRF(c, userId, id);
      } catch (e) {
        logError("Recalcular histórico de renda fixa", e);
      }
    }
    return json({ dados: data });
  }

  if (m === "DELETE" && id) {
    logRequest("DELETE", `/investimentos/ativos/${id}`);
    const naoEncontrado = await verificarExistencia(c, "inv_ativos", id, "Ativo não encontrado");
    if (naoEncontrado) return naoEncontrado;

    // As FKs de posições, operações, dividendos e histórico têm ON DELETE
    // CASCADE → excluir o ativo remove tudo junto. As transações de extrato
    // de proventos permanecem (transacao_extrato_id é ON DELETE SET NULL).
    const { error } = await c.from("inv_ativos").delete().eq("id", id);
    if (error) { logError("Excluir ativo", error); return erro(error.message); }
    return json({ mensagem: "Ativo e dados vinculados excluídos com sucesso" });
  }

  return erro("Rota não encontrada", 404);
}

export function validarNota(nota: unknown): string | null {
  if (nota == null) return null;
  const n = Number(nota);
  if (!Number.isFinite(n) || n < 0 || n > 10) return "nota_usuario deve estar entre 0 e 10";
  return null;
}

// Respostas do questionário: objeto { pergunta_id: indice 0..4 }
export function validarRespostas(respostas: unknown): string | null {
  if (respostas == null) return null;
  if (typeof respostas !== "object" || Array.isArray(respostas)) {
    return "questionario_respostas deve ser um objeto { pergunta: indice }";
  }
  for (const [k, v] of Object.entries(respostas as Record<string, unknown>)) {
    const n = Number(v);
    if (!k || !Number.isInteger(n) || n < 0 || n > 4) {
      return "questionario_respostas: cada resposta deve ser um índice inteiro entre 0 e 4";
    }
  }
  return null;
}

// Características de renda fixa (rf_*) — válidas para RENDA_FIXA/TESOURO_DIRETO
// — e categoria de FII (fii_categoria) — válida para tipo FII.
export function validarCamposRF(body: Record<string, unknown>): string | null {
  if (body.rf_subtipo != null && !SUBTIPOS_RF.includes(String(body.rf_subtipo))) {
    return `rf_subtipo inválido: ${SUBTIPOS_RF.join(" | ")}`;
  }
  if (body.rf_indexador != null && !INDEXADORES_RF.includes(String(body.rf_indexador))) {
    return `rf_indexador inválido: ${INDEXADORES_RF.join(" | ")}`;
  }
  if (body.rf_indice != null && !INDICES_RF.includes(String(body.rf_indice))) {
    return `rf_indice inválido: ${INDICES_RF.join(" | ")}`;
  }
  for (const campo of ["rf_percentual_indice", "rf_taxa_fixa"]) {
    const v = body[campo];
    if (v != null && (typeof v !== "number" || !Number.isFinite(v) || v < 0)) {
      return `${campo} deve ser um número ≥ 0`;
    }
  }
  if (body.rf_taxa != null && String(body.rf_taxa).length > 40) {
    return "rf_taxa deve ter no máximo 40 caracteres";
  }
  if (body.rf_emissor != null && String(body.rf_emissor).length > 80) {
    return "rf_emissor deve ter no máximo 80 caracteres";
  }
  if (body.rf_vencimento != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.rf_vencimento))) {
    return "rf_vencimento deve estar no formato YYYY-MM-DD";
  }
  if (body.fii_categoria != null && !CATEGORIAS_FII.includes(String(body.fii_categoria))) {
    return `fii_categoria inválida: ${CATEGORIAS_FII.join(" | ")}`;
  }
  if (body.acoes_subtipo != null && !SUBTIPOS_ACOES.includes(String(body.acoes_subtipo))) {
    return `acoes_subtipo inválido: ${SUBTIPOS_ACOES.join(" | ")}`;
  }
  if (body.cripto_rendimento_aa != null) {
    const v = Number(body.cripto_rendimento_aa);
    if (!Number.isFinite(v) || v < 0 || v > 1000) {
      return "cripto_rendimento_aa deve ser um número entre 0 e 1000 (% a.a.)";
    }
  }
  if (body.cripto_rendimento_inicio != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.cripto_rendimento_inicio))) {
    return "cripto_rendimento_inicio deve estar no formato YYYY-MM-DD";
  }
  if (body.cripto_rendimento_periodicidade != null
      && !["DIARIA", "SEMANAL", "MENSAL"].includes(String(body.cripto_rendimento_periodicidade))) {
    return "cripto_rendimento_periodicidade inválida: DIARIA | SEMANAL | MENSAL";
  }
  return null;
}

// ============================================================
// /investimentos/alocacoes — alocação ideal por tipo
// GET lista; PUT faz upsert do conjunto (soma deve ser 100%)
// ============================================================

export async function rotaAlocacoes(c: Db, req: Request, m: string, userId: string) {
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
