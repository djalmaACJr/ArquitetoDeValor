// ============================================================
// Arquiteto de Valor — Edge Function: faturas (F1)
// ============================================================
// Importação de fatura de cartão. F1 (esta versão) implementa o ciclo de
// vida da sessão e dos itens em sandbox; o parser real de PDF entra em F2.
//
// Rotas:
//   GET    /faturas                   → lista sessões do usuário
//   GET    /faturas/:id               → sessão + itens
//   POST   /faturas                   → cria sessão a partir do upload (multipart)
//                                       Em F1: cria 1 item placeholder.
//                                       Em F2: parser PDF preenche os itens.
//   PUT    /faturas/:id               → atualiza metadados da sessão (status, observação)
//   PUT    /faturas/:id/itens/:itemId → atualiza decisão/categoria do item
//   DELETE /faturas/:id               → exclui sessão (cascade nos itens)
//   POST   /faturas/:id/confirmar     → aplica decisões e marca CONFIRMADA [F3]
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, extrairId, extrairAcao, corsPreFlight,
         verificarExistencia, camposParaAtualizar } from "../_shared/utils.ts";
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
      return await editarItem(c, id, itemId, await req.json());
    }

    // POST /faturas/:id/confirmar (placeholder em F1)
    if (m === "POST"   &&  id && acao === "confirmar") return await confirmar(c, id);

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
  if (resultado.lancamentos.length === 0) {
    const totalChars = textoCompleto.length;
    // Conta quantas vezes cada padrão aparece — ajuda a entender o formato.
    const matchesData = textoCompleto.match(
      /\d{1,2}\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+/gi
    ) ?? [];
    const matchesBarra = textoCompleto.match(/\b\d{1,2}\/\d{1,2}\b/g) ?? [];
    const idxTx = textoCompleto.search(/transa[cç][õo]es/i);

    // Pula o cabeçalho (primeiros ~3500 chars geralmente são opções de
    // pagamento) e mostra um pedaço gordo do meio onde transações ficam.
    const inicio = Math.min(3500, Math.max(0, totalChars - 6000));
    const amostra = textoCompleto.slice(inicio, inicio + 5500).replace(/\s+/g, " ").trim();
    observacao += ` || DEBUG total=${totalChars}c, ${totalPaginas}p, datasDDMMM=${matchesData.length}, datasDDMM=${matchesBarra.length}, idxTx=${idxTx} || AMOSTRA[${inicio}..${inicio + 5500}]: ${amostra}`;
  }

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
async function editarItem(c: ReturnType<typeof db>, sessaoId: string, itemId: string, body: Record<string, unknown>) {
  logRequest("PUT", `/faturas/${sessaoId}/itens/${itemId}`, body);

  // Confirma posse via cascade — o item precisa pertencer à sessão
  const { data: item, error: errBusca } = await c
    .from("fatura_import_item")
    .select("id")
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
    "descricao", "valor", "data_compra", "estabelecimento",
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
  return json(data);
}


// ── Confirmar (placeholder em F1) ──────────────────────────────
// Em F3 essa função vai:
//   • Iterar os itens com decisao = CRIAR → INSERT em arqvalor.transacoes
//   • Itens com decisao = ATUALIZAR → UPDATE da transação existente
//     (preservando valor antigo em valor_projetado se status era PROJECAO)
//   • Itens com decisao = IGNORAR → no-op
//   • Marcar sessão como CONFIRMADA
//   • Aprender padrões: upsert em assistente_lancamentos pra descrição→categoria
async function confirmar(c: ReturnType<typeof db>, id: string) {
  logRequest("POST", `/faturas/${id}/confirmar`);

  const naoEncontrada = await verificarExistencia(c, "fatura_import_sessao", id, "Sessão não encontrada");
  if (naoEncontrada) return naoEncontrada;

  // F1: ainda não persiste em transacoes. Só marca como CONFIRMADA pra exercitar o fluxo.
  const { error } = await c
    .from("fatura_import_sessao")
    .update({ status: "CONFIRMADA" })
    .eq("id", id);
  if (error) { logError("Confirmar fatura", error); return erro(error.message); }

  logSuccess("Sessão confirmada (F1 placeholder — não aplica em transacoes ainda)", { id });
  return json({ mensagem: "Sessão marcada como CONFIRMADA (F1 placeholder; aplicação real em F3)" });
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
