// ============================================================
// Arquiteto de Valor — Edge Function: faturas
// ============================================================
// Importação de fatura de cartão.
//
// Rotas:
//   GET    /faturas                   → lista sessões do usuário
//   GET    /faturas/:id               → sessão + itens
//   POST   /faturas                   → cria sessão a partir do upload (multipart)
//   PUT    /faturas/:id               → atualiza metadados da sessão
//   PUT    /faturas/:id/itens/:itemId → atualiza decisão/categoria do item
//   DELETE /faturas/:id               → exclui sessão (cascade nos itens)
//   POST   /faturas/:id/sugerir       → sugere categoria + decisão por item (matching)
//   POST   /faturas/:id/confirmar     → aplica decisões e marca CONFIRMADA [F3]
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, extrairId, extrairAcao, corsPreFlight,
         verificarExistencia, camposParaAtualizar, calcularDataParcela } from "../_shared/utils.ts";
import { logDebug, logError, logInfo, logRequest, logResponse, logSuccess, logWarn } from "../_shared/logger.ts";
// Usamos `npm:` (suportado no Supabase Edge Runtime) em vez de esm.sh:
// o esm.sh fazia o pdfjs-dist falhar em iniciar (worker resolver não acha
// em Deno Edge). O npm: deixa o Supabase resolver e bundlear nativamente.
import { extractText } from "npm:unpdf@1.3.0";
import { parsearFatura } from "./parsers/index.ts";
import type { ParsedLinha } from "./parsers/index.ts";

const DECISOES = ["PENDENTE", "CRIAR", "ATUALIZAR", "IGNORAR"] as const;
type Decisao = typeof DECISOES[number];

const STATUS_SESSAO = ["EM_ANALISE", "CONFIRMADA", "CANCELADA"] as const;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id     = extrairId(req, "faturas");
  const acao   = extrairAcao(req, "faturas");        // ex.: "itens" ou "confirmar"
  const m      = req.method;
  const c      = db(req);

  try {
    // GET /faturas
    if (m === "GET"    && !id) return await listar(c);
    // GET /faturas/:id
    if (m === "GET"    &&  id && !acao) return await buscarPorId(c, id);

    // POST /faturas (multipart com PDF + conta_id)
    if (m === "POST"   && !id) return await criar(c, req, userId);

    // PUT /faturas/:id (metadados da sessão)
    if (m === "PUT"    &&  id && !acao) return await editar(c, id, await req.json());

    // PUT /faturas/:id/itens/:itemId (decisão do item)
    if (m === "PUT"    &&  id && acao === "itens") {
      const itemId = extrairItemId(req);
      if (!itemId) return erro("itemId inválido", 400);
      return await editarItem(c, id, itemId, await req.json(), userId);
    }

    // POST /faturas/:id/sugerir
    if (m === "POST"   &&  id && acao === "sugerir")           return await sugerir(c, id, userId);

    // POST /faturas/:id/confirmar
    if (m === "POST"   &&  id && acao === "confirmar")         return await confirmar(c, req, id, userId);

    // POST /faturas/:id/aplicar-sugestoes — aplica categoria_sugerida→escolhida em lote
    if (m === "POST"   &&  id && acao === "aplicar-sugestoes") return await aplicarSugestoes(c, id);

    // GET /faturas/:id/transacoes — candidatas para vincular manualmente
    if (m === "GET"    &&  id && acao === "transacoes")        return await listarTransacoesCandidatas(c, req, id);

    // DELETE /faturas/:id
    if (m === "DELETE" &&  id && !acao) return await excluir(c, id);

    return erro("Rota não encontrada", 404);
  } catch (e) {
    logError("Handler faturas", e);
    return erro("Erro interno", 500);
  }
});


// ── Helpers de path ────────────────────────────────────────────
function extrairItemId(req: Request): string | null {
  const partes = new URL(req.url).pathname.split("/").filter(Boolean);
  const idx = partes.indexOf("itens");
  if (idx === -1 || idx + 1 >= partes.length) return null;
  const candidato = partes[idx + 1];
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  return UUID_REGEX.test(candidato) ? candidato : null;
}


// ── Listagem ───────────────────────────────────────────────────
async function listar(c: ReturnType<typeof db>) {
  logRequest("GET", "/faturas");
  const { data, error } = await c
    .from("fatura_import_sessao")
    .select("*, conta:contas(nome, icone, cor)")
    .order("criado_em", { ascending: false });
  if (error) {
    logError("Listar faturas", error);
    return erro(error.message);
  }
  logResponse(200, { count: data?.length });
  return json({ dados: data });
}


// ── Buscar por id (sessão + itens) ─────────────────────────────
async function buscarPorId(c: ReturnType<typeof db>, id: string) {
  logRequest("GET", `/faturas/${id}`);

  const { data: sessao, error: errSessao } = await c
    .from("fatura_import_sessao")
    .select("*, conta:contas(id, nome, tipo, icone, cor)")
    .eq("id", id)
    .single();
  if (errSessao) {
    logResponse(404);
    return erro("Sessão de importação não encontrada", 404);
  }

  const { data: itens, error: errItens } = await c
    .from("fatura_import_item")
    .select("*")
    .eq("sessao_id", id)
    .order("data_compra", { ascending: true })
    .order("criado_em",   { ascending: true });
  if (errItens) {
    logError("Listar itens da fatura", errItens);
    return erro(errItens.message);
  }

  logResponse(200, { id, itens: itens?.length });
  return json({ ...sessao, itens });
}


// ── Criar sessão (multipart com PDF) ──────────────────────────
//
// Fluxo F2:
//   1. Valida arquivo (multipart, magic bytes %PDF).
//   2. Extrai texto via unpdf.
//   3. Despacha para o parser do emissor (Nubank/genérico).
//   4. Cria a sessão + insere os lançamentos extraídos.
//   5. Avisos do parser ficam em `sessao.observacao` pra o front exibir.
async function criar(c: ReturnType<typeof db>, req: Request, userId: string) {
  logRequest("POST", "/faturas");

  // Aceita multipart/form-data com campos:
  //   conta_id            (string, UUID da conta CARTAO)
  //   arquivo             (File, PDF)
  //   vencimento_fatura?  (string YYYY-MM-DD, opcional — override do parser)
  //   valor_total?        (string numérico,     opcional — override do parser)
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return erro("Content-Type deve ser multipart/form-data", 415);
  }
  const form = await req.formData();
  const contaId   = String(form.get("conta_id") ?? "").trim();
  const arquivo   = form.get("arquivo") as File | null;
  const vencForm  = String(form.get("vencimento_fatura") ?? "").trim() || null;
  const totalRaw  = String(form.get("valor_total") ?? "").trim();
  const totalForm = totalRaw ? Number(totalRaw.replace(",", ".")) : null;

  if (!contaId) return erro("conta_id é obrigatório", 422);
  if (!arquivo) return erro("arquivo PDF é obrigatório", 422);
  if (arquivo.type !== "application/pdf" && !arquivo.name.toLowerCase().endsWith(".pdf")) {
    return erro("arquivo deve ser PDF", 415);
  }
  if (totalForm !== null && (!Number.isFinite(totalForm) || totalForm < 0)) {
    return erro("valor_total inválido", 422);
  }

  // Magic bytes %PDF (0x25 0x50 0x44 0x46)
  const ab = await arquivo.arrayBuffer();
  const head = new Uint8Array(ab.slice(0, 4));
  if (head[0] !== 0x25 || head[1] !== 0x50 || head[2] !== 0x44 || head[3] !== 0x46) {
    return erro("conteúdo não parece ser PDF válido (assinatura %PDF ausente)", 415);
  }

  // ── Extração de texto via unpdf ─────────────────────────────
  // API nova do unpdf >= 1.x aceita Uint8Array direto, sem precisar de
  // getDocumentProxy separado. Retorna { totalPages, text } com text já
  // mesclado quando passamos mergePages: true.
  let textoCompleto = "";
  let totalPaginas  = 0;
  try {
    const bytes = new Uint8Array(ab);
    const r = await extractText(bytes, { mergePages: true });
    totalPaginas  = r.totalPages;
    textoCompleto = Array.isArray(r.text) ? r.text.join("\n") : String(r.text);
    logDebug("PDF extraído", { paginas: totalPaginas, bytes: textoCompleto.length });
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e);
    logError("unpdf extractText", { msg, stack: (e as Error)?.stack });
    // Devolve a mensagem real do unpdf pra o front mostrar — assim o
    // usuário pode reportar o motivo exato se for diferente de "PDF imagem".
    return erro(`Falha ao ler o PDF: ${msg}`, 422);
  }

  if (!textoCompleto.trim()) {
    return erro(
      `PDF não contém texto extraível (${totalPaginas} página(s) lidas). ` +
      "Provavelmente é PDF escaneado/imagem — OCR não está habilitado.",
      422
    );
  }

  // ── Parser dispatch (Nubank → … → genérico) ─────────────────
  const resultado = parsearFatura(textoCompleto);
  logInfo("Parser despachado", {
    emissor:     resultado.emissor,
    lancamentos: resultado.lancamentos.length,
    avisos:      resultado.avisos.length,
  });
  if (resultado.avisos.length > 0) {
    for (const a of resultado.avisos) logWarn(`parser:${resultado.emissor}`, a);
  }

  // O usuário pode sobrescrever vencimento e total via form (útil se o
  // parser não detectou).
  const vencFinal  = vencForm  ?? resultado.vencimento_fatura;
  const totalFinal = totalForm ?? resultado.valor_total;

  // ── Persistência: sessão + itens ────────────────────────────
  // Trigger trg_validar_conta_cartao_fatura bloqueia se conta não for CARTAO.
  // Quando parser não extrai nada, guarda uma amostra do texto pra debug do
  // formato — facilita ajustar a regex sem precisar reupar o PDF.
  let observacao = resultado.avisos.length > 0
    ? `Emissor: ${resultado.emissor}. ${resultado.avisos.join(" | ")}`
    : `Emissor: ${resultado.emissor}`;

  const { data: sessao, error: errSessao } = await c
    .from("fatura_import_sessao")
    .insert({
      user_id:           userId,
      conta_id:          contaId,
      arquivo_nome:      arquivo.name,
      vencimento_fatura: vencFinal,
      valor_total:       totalFinal,
      status:            "EM_ANALISE",
      observacao,
    })
    .select()
    .single();

  if (errSessao) {
    logError("Criar sessão fatura", errSessao);
    return erro(errSessao.message);
  }

  if (resultado.lancamentos.length > 0) {
    const itens = resultado.lancamentos.map((l: ParsedLinha) => ({
      sessao_id:       sessao.id,
      user_id:         userId,
      data_compra:     l.data_compra,
      descricao:       l.descricao,
      estabelecimento: l.estabelecimento ?? null,
      valor:           l.valor,
      tipo:            l.tipo ?? "DESPESA",
      parcela_atual:   l.parcela_atual ?? null,
      parcela_total:   l.parcela_total ?? null,
      observacao:      l.observacao ?? null,
      hash_match:      `${contaId}|${l.data_compra}|${l.valor.toFixed(2)}|${l.descricao.toLowerCase().replace(/\s+/g, " ").trim()}`,
    }));
    const { error: errItens } = await c.from("fatura_import_item").insert(itens);
    if (errItens) {
      logError("Inserir itens da fatura", errItens);
      // Mantém a sessão criada com observação adicional pra usuário entender.
      await c.from("fatura_import_sessao")
        .update({ observacao: `${observacao} | Falha ao gravar itens: ${errItens.message}` })
        .eq("id", sessao.id);
      return erro("Sessão criada mas falhou ao gravar lançamentos: " + errItens.message, 500);
    }
  }

  logSuccess("Sessão de importação criada", {
    id: sessao.id, emissor: resultado.emissor, itens: resultado.lancamentos.length,
  });
  logResponse(201, sessao);
  return json(sessao, 201);
}


// ── Atualizar sessão (metadados) ───────────────────────────────
async function editar(c: ReturnType<typeof db>, id: string, body: Record<string, unknown>) {
  logRequest("PUT", `/faturas/${id}`, body);

  const naoEncontrada = await verificarExistencia(c, "fatura_import_sessao", id, "Sessão não encontrada");
  if (naoEncontrada) return naoEncontrada;

  if (body.status !== undefined && !STATUS_SESSAO.includes(body.status as typeof STATUS_SESSAO[number])) {
    return erro(`status inválido: use ${STATUS_SESSAO.join(" | ")}`, 422);
  }

  const campos = camposParaAtualizar(body, [
    "status", "vencimento_fatura", "valor_total", "observacao",
  ]);
  const { data, error } = await c
    .from("fatura_import_sessao")
    .update(campos)
    .eq("id", id)
    .select()
    .single();

  if (error) { logError("Editar fatura", error); return erro(error.message); }
  logSuccess("Sessão atualizada", { id });
  return json(data);
}


// ── Atualizar item da sessão (decisão do usuário) ──────────────
async function editarItem(
  c: ReturnType<typeof db>,
  sessaoId: string,
  itemId: string,
  body: Record<string, unknown>,
  userId: string,
) {
  logRequest("PUT", `/faturas/${sessaoId}/itens/${itemId}`, body);

  // Confirma posse via cascade — o item precisa pertencer à sessão
  const { data: item, error: errBusca } = await c
    .from("fatura_import_item")
    .select("id, descricao")
    .eq("id", itemId)
    .eq("sessao_id", sessaoId)
    .maybeSingle();
  if (errBusca || !item) {
    logResponse(404);
    return erro("Item não encontrado", 404);
  }

  if (body.decisao !== undefined && !DECISOES.includes(body.decisao as Decisao)) {
    return erro(`decisao inválida: use ${DECISOES.join(" | ")}`, 422);
  }
  if (body.parcela_atual !== undefined && body.parcela_total !== undefined) {
    const a = Number(body.parcela_atual), t = Number(body.parcela_total);
    if (a > t) return erro("parcela_atual não pode ser maior que parcela_total", 422);
  }

  const campos = camposParaAtualizar(body, [
    "decisao", "categoria_escolhida_id", "transacao_existente_id",
    "descricao", "valor", "tipo", "data_compra", "estabelecimento",
    "parcela_atual", "parcela_total", "observacao",
  ]);
  const { data, error } = await c
    .from("fatura_import_item")
    .update(campos)
    .eq("id", itemId)
    .select()
    .single();

  if (error) { logError("Editar item fatura", error); return erro(error.message); }
  logDebug("Item atualizado", { id: itemId, decisao: data.decisao });

  // Modo híbrido: registra novo padrão se o usuário classificou manualmente.
  // Não sobrescreve padrão existente — o upsert definitivo fica no confirmar().
  const catEscolhida = (body.categoria_escolhida_id ?? null) as string | null;
  if (catEscolhida) {
    const { data: sessao } = await c
      .from("fatura_import_sessao")
      .select("conta_id")
      .eq("id", sessaoId)
      .single();
    await aprenderPadraoSeNovo(
      c, userId,
      (data.descricao ?? item.descricao) as string,
      catEscolhida,
      (sessao?.conta_id ?? null) as string | null,
    );
  }

  return json(data);
}


// ── Confirmar (persistência real em arqvalor.transacoes) ──────
//
// Payload (JSON):
//   {
//     modo: 'REGISTRO' | 'CATEGORIA',
//     decisoes?:   Record<chave, 'CRIAR' | 'ATUALIZAR'>,
//     descricoes?: Record<chave, string>,
//   }
// onde `chave` = item.id no modo REGISTRO ou categoria_id no modo CATEGORIA.
//
// Regras (decidido com o usuário em 2026-05-27):
//   • REGISTRO + item parcelado com decisao=CRIAR → cria a SÉRIE completa
//     (parcela atual como PENDENTE + restantes como PROJECAO, mesmo
//     id_recorrencia, tipo_recorrencia=PARCELA).
//   • REGISTRO + item parcelado com decisao=ATUALIZAR → atualiza só a tx
//     existente (não cria as outras parcelas — assume que o usuário já
//     tem a série lançada e está só ajustando esta parcela).
//   • CATEGORIA → 1 lançamento por categoria, valor = soma (DESPESA −
//     RECEITA), data = dia_pagamento do cartão no mês de vencimento,
//     status=PENDENTE. Detalhamento dos itens vai em `observacao`.
//   • Sessão fica CONFIRMADA + itens mantidos com transacao_criada_id
//     populado para rastreabilidade.
//   • Aprende padrões: upsert em assistente_lancamentos (descricao →
//     categoria) por item (mesmo no modo CATEGORIA, cada item ensina).
async function confirmar(c: ReturnType<typeof db>, req: Request, sessaoId: string, userId: string) {
  logRequest("POST", `/faturas/${sessaoId}/confirmar`);

  const body = await req.json().catch(() => ({}));
  const modo: "REGISTRO" | "CATEGORIA" = body.modo === "CATEGORIA" ? "CATEGORIA" : "REGISTRO";
  const decisoesOv:   Record<string, "CRIAR" | "ATUALIZAR"> = body.decisoes   ?? {};
  const descricoesOv: Record<string, string>                = body.descricoes ?? {};

  // 1. Sessão + dados do cartão (precisamos do dia_pagamento)
  const { data: sessao, error: errSessao } = await c
    .from("fatura_import_sessao")
    .select("id, conta_id, vencimento_fatura, status, conta:contas(nome, dia_pagamento)")
    .eq("id", sessaoId)
    .single();
  if (errSessao || !sessao) return erro("Sessão não encontrada", 404);
  if (sessao.status !== "EM_ANALISE") return erro("Sessão não está em análise", 422);
  const conta = sessao.conta as { nome?: string; dia_pagamento?: number | null } | null;

  // 2. Itens da sessão (apenas classificados não-ignorados)
  const { data: itens, error: errItens } = await c
    .from("fatura_import_item")
    .select("*")
    .eq("sessao_id", sessaoId);
  if (errItens) return erro(errItens.message);

  type Item = {
    id: string; descricao: string; valor: number;
    data_compra: string; tipo: "RECEITA" | "DESPESA" | null;
    categoria_escolhida_id: string | null;
    transacao_existente_id: string | null;
    parcela_atual: number | null;
    parcela_total: number | null;
    observacao: string | null;
    decisao: string;
  };
  const naoIgnorados = (itens as Item[] | null)?.filter(
    (i) => i.decisao !== "IGNORAR" && !!i.categoria_escolhida_id,
  ) ?? [];

  if (naoIgnorados.length === 0) {
    await c.from("fatura_import_sessao").update({ status: "CONFIRMADA" }).eq("id", sessaoId);
    return json({ mensagem: "Sessão confirmada (nenhum item importado)." });
  }

  // 3. Nomes de categoria (para descrição default no modo CATEGORIA)
  const catIds = [...new Set(naoIgnorados.map((i) => i.categoria_escolhida_id!))];
  const { data: cats } = await c.from("categorias").select("id, descricao").in("id", catIds);
  const catNome = new Map((cats ?? []).map((c) => [c.id as string, c.descricao as string]));

  let criadas = 0, atualizadas = 0;

  if (modo === "REGISTRO") {
    for (const item of naoIgnorados) {
      const decisaoFinal: "CRIAR" | "ATUALIZAR" =
        decisoesOv[item.id] ??
        (item.transacao_existente_id ? "ATUALIZAR" : "CRIAR");
      const descricao = (descricoesOv[item.id] ?? item.descricao).trim();
      const tipoTx    = item.tipo ?? "DESPESA";

      let txCriadaId: string | null = null;

      if (decisaoFinal === "ATUALIZAR" && item.transacao_existente_id) {
        // Atualiza tx existente. Trigger fn_preservar_valor_projetado preserva
        // valor_projetado se status atual era PROJECAO.
        const { data: txAtual, error } = await c
          .from("transacoes")
          .update({
            descricao,
            valor:        item.valor,
            categoria_id: item.categoria_escolhida_id,
            data:         item.data_compra,
            tipo:         tipoTx,
            status:       "PENDENTE",
            observacao:   item.observacao,
          })
          .eq("id", item.transacao_existente_id)
          .select("id")
          .single();
        if (error) { logWarn("update tx", error.message); continue; }
        txCriadaId = txAtual?.id ?? null;
        atualizadas++;
      } else if (item.parcela_total && item.parcela_total > 1 && item.parcela_atual) {
        // CRIAR série de parcelas (mesma id_recorrencia, MENSAL, intervalo 1).
        // Parcela atual = PENDENTE; as restantes = PROJECAO.
        const idRec   = crypto.randomUUID();
        const inserts = [];
        for (let i = item.parcela_atual; i <= item.parcela_total; i++) {
          const offset = i - item.parcela_atual;
          const data   = offset === 0
            ? item.data_compra
            : calcularDataParcela(item.data_compra, "MENSAL", offset);
          inserts.push({
            user_id:               userId,
            conta_id:              sessao.conta_id,
            categoria_id:          item.categoria_escolhida_id,
            descricao,
            valor:                 item.valor,
            data,
            tipo:                  tipoTx,
            status:                offset === 0 ? "PENDENTE" : "PROJECAO",
            id_recorrencia:        idRec,
            nr_parcela:            i,
            total_parcelas:        item.parcela_total,
            tipo_recorrencia:      "PARCELA",
            intervalo_recorrencia: 1,
            observacao:            item.observacao,
          });
        }
        const { data: txs, error } = await c.from("transacoes").insert(inserts)
          .select("id, nr_parcela");
        if (error) { logWarn("insert serie", error.message); continue; }
        txCriadaId = (txs ?? []).find((t) => t.nr_parcela === item.parcela_atual)?.id ?? null;
        criadas += (txs?.length ?? 0);
      } else {
        // CRIAR avulso
        const { data: tx, error } = await c.from("transacoes").insert({
          user_id:      userId,
          conta_id:     sessao.conta_id,
          categoria_id: item.categoria_escolhida_id,
          descricao,
          valor:        item.valor,
          data:         item.data_compra,
          tipo:         tipoTx,
          status:       "PENDENTE",
          observacao:   item.observacao,
        }).select("id").single();
        if (error) { logWarn("insert avulso", error.message); continue; }
        txCriadaId = tx?.id ?? null;
        criadas++;
      }

      // Rastreabilidade: item → transação gerada
      if (txCriadaId) {
        await c.from("fatura_import_item")
          .update({ transacao_criada_id: txCriadaId, decisao: decisaoFinal })
          .eq("id", item.id);
      }

      // Aprende: descricao_normalizada → categoria. Conta_origem = a conta CARTAO.
      await aprenderPadrao(c, userId, item.descricao, item.categoria_escolhida_id!, sessao.conta_id);
    }
  } else {
    // MODO CATEGORIA
    const venc     = sessao.vencimento_fatura as string | null;
    const diaPagto = conta?.dia_pagamento ?? 5;
    const dataLancto = venc
      ? `${venc.slice(0, 7)}-${String(diaPagto).padStart(2, "0")}`
      : new Date().toISOString().slice(0, 10);

    // Função interna: cria/atualiza 1 transação para um grupo de itens.
    const processarGrupo = async (
      catId:        string,
      items:        Item[],
      decisaoFinal: "CRIAR" | "ATUALIZAR",
      descricao:    string,
      txAlvo:       string | null,
    ): Promise<void> => {
      const valorBruto = items.reduce(
        (s, i) => s + (i.tipo === "RECEITA" ? -Number(i.valor) : Number(i.valor)), 0,
      );
      const tipoTx = valorBruto >= 0 ? "DESPESA" : "RECEITA";
      const valor  = Math.abs(valorBruto);
      if (valor <= 0) return;

      const detalhe = items
        .map((i) => `${i.descricao.trim()} R$ ${Number(i.valor).toFixed(2).replace(".", ",")}`)
        .join(" + ");
      const observacao = `Cartão ${conta?.nome ?? ""} | ${detalhe}`.slice(0, 2000);

      let txCriadaId: string | null = null;

      if (decisaoFinal === "ATUALIZAR" && txAlvo) {
        const { data: tx, error } = await c.from("transacoes").update({
          descricao, valor, data: dataLancto,
          categoria_id: catId, tipo: tipoTx, status: "PENDENTE", observacao,
        }).eq("id", txAlvo).select("id").single();
        if (error) { logWarn("update grupo cat", error.message); return; }
        txCriadaId = tx?.id ?? null;
        atualizadas++;
      } else {
        const { data: tx, error } = await c.from("transacoes").insert({
          user_id: userId, conta_id: sessao.conta_id,
          categoria_id: catId, descricao, valor,
          data: dataLancto, tipo: tipoTx, status: "PENDENTE", observacao,
        }).select("id").single();
        if (error) { logWarn("insert grupo cat", error.message); return; }
        txCriadaId = tx?.id ?? null;
        criadas++;
      }

      if (txCriadaId) {
        await c.from("fatura_import_item")
          .update({ transacao_criada_id: txCriadaId, decisao: decisaoFinal })
          .in("id", items.map((i) => i.id));
      }
      for (const item of items) {
        await aprenderPadrao(c, userId, item.descricao, catId, sessao.conta_id);
      }
    };

    if (body.grupos && Array.isArray(body.grupos) && (body.grupos as unknown[]).length > 0) {
      // ── Novo: front enviou grupos explícitos (parcelas separadas, etc.) ──
      type GrupoP = {
        chave: string; categoria_id: string; item_ids: string[];
        decisao: "CRIAR" | "ATUALIZAR"; descricao?: string;
        transacao_existente_id?: string | null;
      };
      for (const g of body.grupos as GrupoP[]) {
        const gItems = naoIgnorados.filter((i) => (g.item_ids as string[]).includes(i.id));
        if (gItems.length === 0) continue;
        const defDesc = `${conta?.nome ?? "Fatura"} - ${catNome.get(g.categoria_id) ?? ""}`.trim();
        const descricao = (g.descricao ?? descricoesOv[g.chave] ?? defDesc).trim();
        const txAlvo = (g.transacao_existente_id as string | null) ??
          gItems.find((i) => i.transacao_existente_id)?.transacao_existente_id ?? null;
        await processarGrupo(g.categoria_id, gItems, g.decisao, descricao, txAlvo);
      }
    } else {
      // ── Legado: 1 lançamento por categoria_id ──────────────────────────
      const catGrupos = new Map<string, Item[]>();
      for (const it of naoIgnorados) {
        const k = it.categoria_escolhida_id!;
        if (!catGrupos.has(k)) catGrupos.set(k, []);
        catGrupos.get(k)!.push(it);
      }
      for (const [catId, items] of catGrupos) {
        const decisaoFinal: "CRIAR" | "ATUALIZAR" =
          decisoesOv[catId] ??
          (items.find((i) => i.transacao_existente_id) ? "ATUALIZAR" : "CRIAR");
        const defDesc = `${conta?.nome ?? "Fatura"} - ${catNome.get(catId) ?? ""}`.trim();
        const descricao = (descricoesOv[catId] ?? defDesc).trim();
        const txAlvo = items.find((i) => i.transacao_existente_id)?.transacao_existente_id ?? null;
        await processarGrupo(catId, items, decisaoFinal, descricao, txAlvo);
      }
    }
  }

  // 4. Marca sessão como CONFIRMADA
  await c.from("fatura_import_sessao").update({ status: "CONFIRMADA" }).eq("id", sessaoId);

  logSuccess("Sessão confirmada", { sessaoId, modo, criadas, atualizadas });
  return json({ mensagem: "Importação confirmada.", criadas, atualizadas, modo });
}


/** Insere novo padrão no assistente SE não existir um para a mesma descrição.
 *  Usado durante a classificação manual (modo híbrido) — não sobrescreve. */
async function aprenderPadraoSeNovo(
  c: ReturnType<typeof db>,
  userId: string,
  descricao: string,
  categoriaId: string,
  contaId: string | null,
) {
  const desc = normDescParaMatch(descricao).trim();
  if (desc.length < 2 || desc.length > 200 || !categoriaId) return;

  const { data: existente } = await c
    .from("assistente_lancamentos")
    .select("id")
    .eq("user_id", userId)
    .ilike("descricao", desc)
    .limit(1)
    .maybeSingle();

  if (existente?.id) return; // padrão já existe → não sobrescreve

  const { error } = await c.from("assistente_lancamentos").insert({
    descricao:        desc,
    categoria_id:     categoriaId,
    conta_origem_id:  contaId,
    conta_destino_id: null,
    is_transferencia: false,
    user_id:          userId,
  });
  if (error) logError("aprenderPadraoSeNovo", error);
}


/** Upsert no assistente_lancamentos: descrição (case-insensitive) → categoria.
 *  Replica o padrão de upsert manual do edge function /assistente. */
async function aprenderPadrao(
  c: ReturnType<typeof db>,
  userId: string,
  descricao: string,
  categoriaId: string,
  contaId: string,
) {
  const desc = descricao.trim();
  if (desc.length < 2 || desc.length > 200 || !categoriaId) return;

  const { data: existente } = await c
    .from("assistente_lancamentos")
    .select("id")
    .eq("user_id", userId)
    .ilike("descricao", desc)
    .limit(1)
    .maybeSingle();

  const payload = {
    descricao:        desc,
    categoria_id:     categoriaId,
    conta_origem_id:  contaId,
    conta_destino_id: null,
    is_transferencia: false,
  };

  if (existente?.id) {
    await c.from("assistente_lancamentos").update(payload).eq("id", existente.id);
  } else {
    await c.from("assistente_lancamentos").insert({ ...payload, user_id: userId });
  }
}


// ── Sugerir categorias + decisão ──────────────────────────────
//
// Para cada item sem categoria escolhida:
//   1. Normaliza descrição removendo "- Parcela X/Y" antes do match.
//   2. Busca padrões do assistente → categoria_sugerida_id.
//   3. Busca transações PENDENTE/PROJECAO na mesma conta, dentro de
//      ±90 dias do vencimento. melhorTransacao aplica critérios mais
//      rígidos (sim ≥ 0.55, val ±5%, número de parcela deve bater).
//
// Idempotente — pode ser chamado várias vezes sem perda de dados.
async function sugerir(c: ReturnType<typeof db>, sessaoId: string, userId: string) {
  logRequest("POST", `/faturas/${sessaoId}/sugerir`);

  const { data: sessao, error: errSessao } = await c
    .from("fatura_import_sessao")
    .select("id, conta_id, status, vencimento_fatura")
    .eq("id", sessaoId)
    .single();
  if (errSessao || !sessao) return erro("Sessão não encontrada", 404);
  if (sessao.status !== "EM_ANALISE") return erro("Sessão não está em análise", 422);

  const { data: itens, error: errItens } = await c
    .from("fatura_import_item")
    .select("id, descricao, valor, parcela_atual, parcela_total")
    .eq("sessao_id", sessaoId)
    .is("categoria_escolhida_id", null)
    .in("decisao", ["PENDENTE"]);
  if (errItens) return erro(errItens.message);
  if (!itens?.length) return json({ atualizados: 0 });

  const { data: padroes } = await c
    .from("assistente_lancamentos")
    .select("descricao, categoria_id")
    .eq("user_id", userId)
    .not("categoria_id", "is", null);

  // Candidatos ao ATUALIZAR: mesma conta, dentro de ±90 dias do vencimento.
  const venc = sessao.vencimento_fatura as string | null;
  let txQuery = c
    .from("transacoes")
    .select("id, descricao, valor, categoria_id, nr_parcela, total_parcelas, data")
    .eq("user_id", userId)
    .eq("conta_id", sessao.conta_id as string)
    .in("status", ["PENDENTE", "PROJECAO"])
    .order("data", { ascending: false })
    .limit(300);
  if (venc) {
    const vd = new Date(venc + "T12:00:00Z");
    const from = new Date(vd); from.setDate(from.getDate() - 90);
    const to   = new Date(vd); to.setDate(to.getDate()   + 30);
    txQuery = txQuery.gte("data", from.toISOString().slice(0, 10));
    txQuery = txQuery.lte("data", to.toISOString().slice(0, 10));
  }
  const { data: txs } = await txQuery;

  let atualizados = 0;
  for (const item of itens) {
    // Descrição normalizada (sem sufixo de parcela) para matching
    const descNorm = normDescParaMatch(item.descricao as string);
    const catId    = melhorCategoria(descNorm, padroes ?? []);
    const txMatch  = melhorTransacao(
      {
        descricao:    item.descricao as string,
        valor:        item.valor as number,
        parcela_atual: item.parcela_atual as number | null,
      },
      (txs ?? []) as Array<{
        id: string; descricao: string; valor: number;
        categoria_id: string | null; nr_parcela: number | null; data: string;
      }>,
      catId,
      venc,
    );

    const patch: Record<string, unknown> = {};
    if (catId)   patch.categoria_sugerida_id  = catId;
    if (txMatch) patch.transacao_existente_id = txMatch.id;
    if (!catId && txMatch?.categoria_id) patch.categoria_sugerida_id = txMatch.categoria_id;

    if (Object.keys(patch).length === 0) continue;
    const { error } = await c.from("fatura_import_item").update(patch).eq("id", item.id);
    if (!error) atualizados++;
  }

  logSuccess("Sugestões geradas", { sessaoId, atualizados });
  return json({ atualizados });
}


// ── Helpers de similaridade ────────────────────────────────────

// Remove sufixo de parcela da descrição para matching no assistente.
// "Netflix - Parcela 6/12" → "Netflix"
// "UBER EATS (2/3)"        → "UBER EATS"
function normDescParaMatch(s: string): string {
  return s
    .replace(/\s*[-–—]\s*(?:parc(?:ela)?\.?\s*)?\d+\s*\/\s*\d+\s*$/i, "")
    .replace(/\s*\(?\s*\d+\s*\/\s*\d+\s*\)?\s*$/i, "")
    .replace(/\s+parc(?:ela)?\.?\s*\d+\s*\/\s*\d+\s*$/i, "")
    .trim();
}

function normTxt(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ").trim();
}

const STOP = new Set([
  "de","da","do","das","dos","a","o","e","em","com","para","por","um","uma",
  "no","na","nos","nas","ao","aos","as","se","que","its","brl","usd",
]);

function tokens(s: string): Set<string> {
  return new Set(normTxt(s).split(" ").filter(w => w.length > 2 && !STOP.has(w)));
}

function simTexto(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const w of ta) if (tb.has(w)) hit++;
  return hit / Math.max(ta.size, tb.size);
}

function melhorCategoria(
  desc: string,
  padroes: Array<{ descricao: string; categoria_id: string | null }>,
): string | null {
  const dn = normTxt(desc);
  let best: { id: string; score: number } | null = null;

  for (const p of padroes) {
    if (!p.categoria_id) continue;
    const pn = normTxt(p.descricao);
    let score = 0;
    if (dn.includes(pn)) {
      // Substring match: mais longo = mais específico
      score = 0.5 + (pn.length / Math.max(dn.length, 1)) * 0.5;
    } else {
      score = simTexto(desc, p.descricao) * 0.8;
    }
    if (score >= 0.3 && (!best || score > best.score)) {
      best = { id: p.categoria_id, score };
    }
  }
  return best?.id ?? null;
}

function melhorTransacao(
  item: { descricao: string; valor: number; parcela_atual: number | null },
  txs: Array<{
    id: string; descricao: string; valor: number;
    categoria_id: string | null; nr_parcela: number | null; data: string;
  }>,
  catSugeridaId: string | null,
  vencimento: string | null,
): { id: string; categoria_id: string | null } | null {
  const temParcela = item.parcela_atual != null;
  // Critérios mais rígidos que v1 — evita falsos positivos
  const threshSim  = temParcela ? 0.40 : 0.55;  // era 0.35 para tudo
  const threshVal  = temParcela ? 0.02 : 0.05;  // era 0.15 para tudo
  const janelaDias = temParcela ? 60   : 45;

  let best: { id: string; score: number; categoria_id: string | null } | null = null;

  for (const tx of txs) {
    // 1. Filtro de data — tx deve estar dentro da janela do vencimento
    if (vencimento && tx.data) {
      const diffMs = Math.abs(
        new Date(vencimento + "T12:00:00Z").getTime() -
        new Date(tx.data    + "T12:00:00Z").getTime(),
      );
      if (diffMs > janelaDias * 86_400_000) continue;
    }

    // 2. Filtro de valor
    const valDiff = Math.abs(tx.valor - item.valor) / Math.max(item.valor, 0.01);
    if (valDiff > threshVal) continue;

    // 3. Para parcelas: pula se nr_parcela não bate (evita casar parc 2 com parc 5)
    if (temParcela && tx.nr_parcela != null && tx.nr_parcela !== item.parcela_atual) {
      continue;
    }

    // 4. Similaridade de texto com descrição normalizada (sem "- Parcela X/Y")
    const descNorm = normDescParaMatch(item.descricao);
    const sim = simTexto(descNorm, tx.descricao);
    if (sim < threshSim) continue;

    // 5. Score final
    const catBonus   = catSugeridaId && tx.categoria_id === catSugeridaId ? 0.10 : 0;
    const parcBonus  = temParcela && tx.nr_parcela === item.parcela_atual  ? 0.20 : 0;
    const score = sim * 0.65 + (1 - valDiff) * 0.15 + catBonus + parcBonus;
    if (!best || score > best.score) {
      best = { id: tx.id, score, categoria_id: tx.categoria_id };
    }
  }
  return best;
}


// ── Aplicar todas as sugestões de categoria em lote ──────────
//
// Copia categoria_sugerida_id → categoria_escolhida_id para todos os
// itens pendentes que ainda não foram classificados manualmente.
// Agrupa por categoria para minimizar roundtrips.
async function aplicarSugestoes(c: ReturnType<typeof db>, sessaoId: string) {
  logRequest("POST", `/faturas/${sessaoId}/aplicar-sugestoes`);

  const { data: itens, error } = await c
    .from("fatura_import_item")
    .select("id, categoria_sugerida_id")
    .eq("sessao_id", sessaoId)
    .is("categoria_escolhida_id", null)
    .not("categoria_sugerida_id", "is", null)
    .neq("decisao", "IGNORAR");

  if (error) return erro(error.message);
  if (!itens?.length) return json({ aplicados: 0 });

  // 1 UPDATE por categoria sugerida (minimiza roundtrips)
  const porCat = new Map<string, string[]>();
  for (const it of itens) {
    const catId = it.categoria_sugerida_id as string;
    if (!porCat.has(catId)) porCat.set(catId, []);
    porCat.get(catId)!.push(it.id as string);
  }

  let aplicados = 0;
  for (const [catId, ids] of porCat) {
    const { error: err } = await c
      .from("fatura_import_item")
      .update({ categoria_escolhida_id: catId })
      .in("id", ids);
    if (err) {
      logError("Aplicar sugestão categoria", { catId, ids, err });
    } else {
      aplicados += ids.length;
    }
  }

  if (aplicados === 0 && porCat.size > 0) {
    logWarn("Nenhum item atualizado — possível problema de permissão", { sessaoId });
    return erro("Nenhum item foi atualizado. Verifique permissões da sessão.", 422);
  }

  logSuccess("Sugestões aplicadas", { sessaoId, aplicados });
  return json({ aplicados });
}


// ── Listar transações candidatas para vincular manualmente ────
//
// GET /faturas/:id/transacoes?q=<texto>
// Retorna PENDENTE/PROJECAO da conta do cartão, filtradas por ±90 dias
// do vencimento. Filtragem por texto via `q` é feita em memória.
async function listarTransacoesCandidatas(
  c: ReturnType<typeof db>,
  req: Request,
  sessaoId: string,
) {
  logRequest("GET", `/faturas/${sessaoId}/transacoes`);
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const { data: sessao, error: errSessao } = await c
    .from("fatura_import_sessao")
    .select("conta_id, vencimento_fatura")
    .eq("id", sessaoId)
    .single();
  if (errSessao || !sessao) return erro("Sessão não encontrada", 404);

  let query = c
    .from("transacoes")
    .select("id, descricao, valor, data, tipo, status, categoria_id, categoria:categorias(descricao)")
    .eq("conta_id", sessao.conta_id as string)
    .in("status", ["PENDENTE", "PROJECAO"])
    .order("data", { ascending: false })
    .limit(100);

  if (sessao.vencimento_fatura) {
    const vd   = new Date((sessao.vencimento_fatura as string) + "T12:00:00Z");
    const from = new Date(vd); from.setDate(from.getDate() - 90);
    const to   = new Date(vd); to.setDate(to.getDate()   + 30);
    query = query.gte("data", from.toISOString().slice(0, 10));
    query = query.lte("data", to.toISOString().slice(0, 10));
  }

  const { data, error } = await query;
  if (error) return erro(error.message);

  let result = (data ?? []) as Array<{
    id: string; descricao: string; valor: number; data: string;
    tipo: string; status: string; categoria_id: string | null;
    categoria: { descricao: string } | null;
  }>;

  if (q) {
    const qn = normTxt(q);
    result = result.filter(
      (tx) => normTxt(tx.descricao).includes(qn) || simTexto(q, tx.descricao) >= 0.20,
    );
  }

  logResponse(200, { count: result.length });
  return json({ dados: result.slice(0, 50) });
}


// ── Excluir ────────────────────────────────────────────────────
async function excluir(c: ReturnType<typeof db>, id: string) {
  logRequest("DELETE", `/faturas/${id}`);
  const naoEncontrada = await verificarExistencia(c, "fatura_import_sessao", id, "Sessão não encontrada");
  if (naoEncontrada) return naoEncontrada;

  const { error } = await c.from("fatura_import_sessao").delete().eq("id", id);
  if (error) { logError("Excluir fatura", error); return erro(error.message); }
  logSuccess("Sessão excluída", { id });
  return json({ mensagem: "Sessão excluída" });
}
