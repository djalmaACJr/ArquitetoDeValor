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
      return await editarItem(c, id, itemId, await req.json());
    }

    // POST /faturas/:id/sugerir
    if (m === "POST"   &&  id && acao === "sugerir")   return await sugerir(c, id, userId);

    // POST /faturas/:id/confirmar
    if (m === "POST"   &&  id && acao === "confirmar") return await confirmar(c, req, id, userId);

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
    // MODO CATEGORIA: 1 lançamento por categoria, data = dia_pagamento da conta
    // no mês de vencimento; observacao = detalhamento dos itens.
    const grupos = new Map<string, Item[]>();
    for (const it of naoIgnorados) {
      const k = it.categoria_escolhida_id!;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k)!.push(it);
    }

    const venc = sessao.vencimento_fatura as string | null;
    const diaPagto = conta?.dia_pagamento ?? 5;
    const dataLancto = venc
      ? `${venc.slice(0, 7)}-${String(diaPagto).padStart(2, "0")}`
      : (venc ?? new Date().toISOString().slice(0, 10));

    for (const [catId, items] of grupos) {
      const decisaoFinal: "CRIAR" | "ATUALIZAR" =
        decisoesOv[catId] ??
        (items.find((i) => i.transacao_existente_id) ? "ATUALIZAR" : "CRIAR");

      // Soma respeitando tipo do item (RECEITA reduz total da despesa)
      const valorBruto = items.reduce(
        (s, i) => s + (i.tipo === "RECEITA" ? -Number(i.valor) : Number(i.valor)), 0,
      );
      const tipoTx = valorBruto >= 0 ? "DESPESA" : "RECEITA";
      const valor  = Math.abs(valorBruto);
      if (valor <= 0) continue; // categoria que se anulou (estornos totalizam zero)

      const descricaoDefault = `${conta?.nome ?? "Fatura"} - ${catNome.get(catId) ?? ""}`.trim();
      const descricao        = (descricoesOv[catId] ?? descricaoDefault).trim();

      // Detalhamento dos itens vai em observacao para auditoria
      const detalhe = items
        .map((i) => `${i.descricao.trim()} R$ ${Number(i.valor).toFixed(2).replace(".", ",")}`)
        .join(" + ");
      const observacao = `Cartão ${conta?.nome ?? ""} | ${detalhe}`.slice(0, 2000);

      let txCriadaId: string | null = null;

      if (decisaoFinal === "ATUALIZAR") {
        const txAlvo = items.find((i) => i.transacao_existente_id)?.transacao_existente_id;
        if (txAlvo) {
          const { data: tx, error } = await c.from("transacoes").update({
            descricao, valor, data: dataLancto,
            categoria_id: catId, tipo: tipoTx,
            status: "PENDENTE", observacao,
          }).eq("id", txAlvo).select("id").single();
          if (error) { logWarn("update cat", error.message); continue; }
          txCriadaId = tx?.id ?? null;
          atualizadas++;
        }
      } else {
        const { data: tx, error } = await c.from("transacoes").insert({
          user_id:      userId,
          conta_id:     sessao.conta_id,
          categoria_id: catId,
          descricao, valor, data: dataLancto,
          tipo: tipoTx, status: "PENDENTE", observacao,
        }).select("id").single();
        if (error) { logWarn("insert cat", error.message); continue; }
        txCriadaId = tx?.id ?? null;
        criadas++;
      }

      // Marca TODOS os itens do grupo com a mesma tx — assim a sandbox
      // ainda mostra que esses itens foram absorvidos por aquele lançamento.
      if (txCriadaId) {
        await c.from("fatura_import_item")
          .update({ transacao_criada_id: txCriadaId, decisao: decisaoFinal })
          .in("id", items.map((i) => i.id));
      }

      // Aprende padrão por item (não por grupo)
      for (const item of items) {
        await aprenderPadrao(c, userId, item.descricao, catId, sessao.conta_id);
      }
    }
  }

  // 4. Marca sessão como CONFIRMADA
  await c.from("fatura_import_sessao").update({ status: "CONFIRMADA" }).eq("id", sessaoId);

  logSuccess("Sessão confirmada", { sessaoId, modo, criadas, atualizadas });
  return json({ mensagem: "Importação confirmada.", criadas, atualizadas, modo });
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
//   1. Busca padrões do assistente → categoria_sugerida_id
//   2. Busca transações PENDENTE/PROJECAO na mesma conta com descrição
//      similar + valor próximo → transacao_existente_id + decisao sugerida
//      (ATUALIZAR quando há match; CRIAR quando não há)
//
// Os campos são gravados nos itens mas NÃO sobrescrevem categoria_escolhida_id
// (respeita escolha já feita pelo usuário). Idempotente: pode ser chamado
// várias vezes sem perda de dados.
async function sugerir(c: ReturnType<typeof db>, sessaoId: string, userId: string) {
  logRequest("POST", `/faturas/${sessaoId}/sugerir`);

  const { data: sessao, error: errSessao } = await c
    .from("fatura_import_sessao")
    .select("id, conta_id, status")
    .eq("id", sessaoId)
    .single();
  if (errSessao || !sessao) return erro("Sessão não encontrada", 404);
  if (sessao.status !== "EM_ANALISE") return erro("Sessão não está em análise", 422);

  // Itens pendentes de sugestão (sem categoria escolhida e sem decisão final)
  const { data: itens, error: errItens } = await c
    .from("fatura_import_item")
    .select("id, descricao, valor, parcela_atual, parcela_total")
    .eq("sessao_id", sessaoId)
    .is("categoria_escolhida_id", null)
    .in("decisao", ["PENDENTE"]);
  if (errItens) return erro(errItens.message);
  if (!itens?.length) return json({ atualizados: 0 });

  // Padrões do assistente com categoria definida
  const { data: padroes } = await c
    .from("assistente_lancamentos")
    .select("descricao, categoria_id")
    .eq("user_id", userId)
    .not("categoria_id", "is", null);

  // Transações pendentes/projeção na mesma conta (candidatos ao ATUALIZAR)
  const { data: txs } = await c
    .from("transacoes")
    .select("id, descricao, valor, categoria_id, id_recorrencia, nr_parcela, total_parcelas")
    .eq("user_id", userId)
    .eq("conta_id", sessao.conta_id)
    .in("status", ["PENDENTE", "PROJECAO"])
    .order("data_transacao", { ascending: false })
    .limit(300);

  let atualizados = 0;
  for (const item of itens) {
    const catId   = melhorCategoria(item.descricao, padroes ?? []);
    const txMatch = melhorTransacao(item, txs ?? [], catId);

    const patch: Record<string, unknown> = {};
    if (catId)    patch.categoria_sugerida_id  = catId;
    if (txMatch)  patch.transacao_existente_id = txMatch.id;
    // Fallback: se não achou categoria via assistente mas a tx tem uma → usa ela
    if (!catId && txMatch?.categoria_id) patch.categoria_sugerida_id = txMatch.categoria_id;

    if (Object.keys(patch).length === 0) continue;
    const { error } = await c.from("fatura_import_item").update(patch).eq("id", item.id);
    if (!error) atualizados++;
  }

  logSuccess("Sugestões geradas", { sessaoId, atualizados });
  return json({ atualizados });
}


// ── Helpers de similaridade ────────────────────────────────────

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
  item: { descricao: string; valor: number },
  txs: Array<{ id: string; descricao: string; valor: number; categoria_id: string | null }>,
  catSugeridaId: string | null,
): { id: string; categoria_id: string | null } | null {
  let best: { id: string; score: number; categoria_id: string | null } | null = null;

  for (const tx of txs) {
    const valDiff = Math.abs(tx.valor - item.valor) / Math.max(item.valor, 0.01);
    if (valDiff > 0.15) continue;

    const sim = simTexto(item.descricao, tx.descricao);
    if (sim < 0.35) continue;

    // Bônus se a categoria da tx coincide com a categoria sugerida
    const catBonus = catSugeridaId && tx.categoria_id === catSugeridaId ? 0.15 : 0;
    const score = sim * 0.7 + (1 - valDiff) * 0.15 + catBonus;
    if (!best || score > best.score) {
      best = { id: tx.id, score, categoria_id: tx.categoria_id };
    }
  }
  return best;
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
