// supabase/functions/transferencias/index.ts
// Correção principal: função listar() reescrita para eliminar N+1 queries.
// Antes: 1 SELECT para débitos + N SELECTs individuais para créditos.
// Depois: 1 SELECT para débitos + 1 SELECT com .in() para todos os créditos.

import "@supabase/functions-js/edge-runtime.d.ts";
import {
  json,
  erro,
  db,
  autenticar,
  extrairId,
  validarStatus,
  corsPreFlight
} from "../_shared/utils.ts";

// ── Tipos internos ────────────────────────────────────────────────────────────
interface Transacao {
  id: string
  user_id: string
  conta_id: string
  categoria_id: string
  tipo: 'RECEITA' | 'DESPESA'
  valor: number
  data: string
  descricao: string
  status: string
  id_recorrencia: string | null
  nr_parcela: number | null
  total_parcelas: number | null
  tipo_recorrencia: string | null
  criado_em: string
  atualizado_em: string
  [key: string]: unknown
}

/** Busca o id da categoria protegida de Transferências do usuário */
async function idCategoriaTransferencias(
  c: ReturnType<typeof db>,
  userId: string
): Promise<string | null> {
  const { data } = await c
    .from("categorias")
    .select("id")
    .eq("user_id", userId)
    .eq("descricao", "Transferências")
    .eq("protegida", true)
    .is("id_pai", null)
    .single();
  return data?.id ?? null;
}

/** Retorna o par de transações (débito + crédito) pelo id_recorrencia */
async function buscarPar(
  c: ReturnType<typeof db>,
  idRecorrencia: string,
  userId: string
): Promise<{ debito: Transacao; credito: Transacao } | null> {
  const { data, error } = await c
    .from("transacoes")
    .select("*")
    .eq("id_recorrencia", idRecorrencia)
    .eq("user_id", userId)
    .order("tipo");

  if (error || !data || data.length !== 2) return null;
  const debito  = data.find((t: Transacao) => t.tipo === "DESPESA") as Transacao | undefined;
  const credito = data.find((t: Transacao) => t.tipo === "RECEITA") as Transacao | undefined;
  if (!debito || !credito) return null;
  return { debito, credito };
}

/** Monta o objeto de resposta consolidado do par */
function montarTransferencia(debito: Transacao, credito: Transacao) {
  return {
    id_par:           debito.id_recorrencia,
    conta_origem_id:  debito.conta_id,
    conta_destino_id: credito.conta_id,
    valor:            debito.valor,
    data:             debito.data,
    descricao:        debito.descricao?.replace(/^\[Transf\. saída\] ?/, "") || null,
    status:           debito.status,
    total_parcelas:   debito.total_parcelas ?? null,
    parcela_atual:    debito.nr_parcela ?? null,
    id_debito:        debito.id,
    id_credito:       credito.id,
    criado_em:        debito.criado_em,
    atualizado_em:    debito.atualizado_em,
  };
}

async function verificarContaAtiva(
  c: ReturnType<typeof db>,
  contaId: string,
  label: string
): Promise<Response | null> {
  const { data, error } = await c
    .from("contas")
    .select("id, ativa")
    .eq("id", contaId)
    .maybeSingle();

  if (error) return erro(`Erro ao verificar ${label.toLowerCase()}: ` + error.message, 500);
  if (!data)       return erro(`${label} não encontrada`, 404);
  if (!data.ativa) return erro(`${label} está inativa`, 422);
  return null;
}

function validarPayload(body: Record<string, unknown>, modoEdicao = false): string | null {
  if (!modoEdicao) {
    if (!body.conta_origem_id)  return "conta_origem_id é obrigatório";
    if (!body.conta_destino_id) return "conta_destino_id é obrigatório";
    if (!body.valor)            return "valor é obrigatório";
    if (!body.data)             return "data é obrigatória";
  }

  if (body.conta_origem_id && body.conta_destino_id &&
      body.conta_origem_id === body.conta_destino_id)
    return "conta_origem_id e conta_destino_id devem ser diferentes";

  if (body.valor !== undefined) {
    const v = Number(body.valor);
    if (isNaN(v) || v <= 0) return "valor deve ser maior que zero";
  }

  const erroStatus = validarStatus(body.status);
  if (erroStatus) return erroStatus;

  const descricao = body.descricao as string | undefined;
  if (descricao != null && (descricao.length < 2 || descricao.length > 200))
    return "descricao deve ter entre 2 e 200 caracteres";

  return null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id  = extrairId(req, "transferencias");
  const m   = req.method;
  const c   = db(req);
  const url = new URL(req.url);

  try {
    if (m === "GET"    && id)  return await buscarPorId(c, id, userId);
    if (m === "GET"    && !id) return await listar(c, userId, url.searchParams);
    if (m === "POST"   && !id) return await criar(c, await req.json(), userId);
    if (m === "PUT"    && id)  return await editar(c, id, await req.json(), userId);
    if (m === "DELETE" && id)  return await excluir(c, id, userId);
    return erro("Rota não encontrada", 404);
  } catch (e) {
    console.error("Erro no handler:", e);
    return erro("Erro interno: " + (e as Error).message, 500);
  }
});

async function buscarPorId(c: ReturnType<typeof db>, idPar: string, userId: string) {
  const par = await buscarPar(c, idPar, userId);
  if (!par) return erro("Transferência não encontrada", 404);
  return json(montarTransferencia(par.debito, par.credito));
}

// ── LISTAR — corrigido: de N+1 para 2 queries ────────────────────────────────
async function listar(
  c: ReturnType<typeof db>,
  userId: string,
  params: URLSearchParams
) {
  const catId = await idCategoriaTransferencias(c, userId);
  if (!catId) return erro("Categoria Transferências não encontrada", 500);

  // Query 1: busca todos os débitos (perna de saída) do período
  let query = c
    .from("transacoes")
    .select("*")
    .eq("user_id", userId)
    .eq("categoria_id", catId)
    .eq("tipo", "DESPESA")
    .not("id_recorrencia", "is", null)
    .order("data", { ascending: false });

  const mes = params.get("mes");
  if (mes) {
    const [anoStr, mesNumStr] = mes.split("-");
    const ano    = parseInt(anoStr, 10);
    const mesNum = parseInt(mesNumStr, 10);
    if (!isNaN(ano) && !isNaN(mesNum)) {
      query = query.eq("ano_tx", ano).eq("mes_tx", mesNum);
    }
  }
  const statusParam = params.get("status");
  if (statusParam) query = query.eq("status", statusParam);

  const { data: debitos, error: err } = await query;
  if (err) return erro(err.message, 500);
  if (!debitos || debitos.length === 0) return json([]);

  // Query 2: busca TODOS os créditos de uma vez com .in()
  const idsRecorrencia = debitos.map((d: Transacao) => d.id_recorrencia).filter(Boolean);
  const { data: creditos, error: errCred } = await c
    .from("transacoes")
    .select("*")
    .in("id_recorrencia", idsRecorrencia)
    .eq("tipo", "RECEITA");

  if (errCred) return erro(errCred.message, 500);

  // Monta um Map para lookup O(1)
  const creditoMap = new Map<string, Transacao>();
  (creditos ?? []).forEach((cr: Transacao) => {
    if (cr.id_recorrencia) creditoMap.set(cr.id_recorrencia, cr);
  });

  // Monta os pares sem queries adicionais
  const transferencias = debitos
    .map((debito: Transacao) => {
      const credito = creditoMap.get(debito.id_recorrencia!);
      if (!credito) return null;
      return montarTransferencia(debito, credito);
    })
    .filter(Boolean);

  return json(transferencias);
}

async function criar(
  c: ReturnType<typeof db>,
  body: Record<string, unknown>,
  userId: string
) {
  const erroVal = validarPayload(body);
  if (erroVal) return erro(erroVal, 422);

  const semOrigem  = await verificarContaAtiva(c, body.conta_origem_id  as string, "Conta de origem");
  const semDestino = await verificarContaAtiva(c, body.conta_destino_id as string, "Conta de destino");
  if (semOrigem)  return semOrigem;
  if (semDestino) return semDestino;

  const catId = await idCategoriaTransferencias(c, userId);
  if (!catId) return erro("Categoria Transferências não encontrada", 500);

  const status = (body.status as string) ?? "PAGO";
  const valor  = Number(body.valor);
  const desc   = (body.descricao as string) ?? "";
  const idGrupoPar = crypto.randomUUID();

  const { data: debito, error: e1 } = await c
    .from("transacoes")
    .insert({
      user_id: userId,
      conta_id: body.conta_origem_id,
      categoria_id: catId,
      tipo: "DESPESA",
      valor,
      data: body.data,
      descricao: `[Transf. saída] ${desc}`.trim(),
      status,
      id_recorrencia: idGrupoPar,
      nr_parcela: 1,
      total_parcelas: 1,
      tipo_recorrencia: null,
    })
    .select().single();

  if (e1 || !debito) {
    console.error("Erro débito:", e1);
    return erro("Erro ao criar lançamento de saída: " + (e1?.message || "erro desconhecido"), 500);
  }

  const { data: credito, error: e2 } = await c
    .from("transacoes")
    .insert({
      user_id: userId,
      conta_id: body.conta_destino_id,
      categoria_id: catId,
      tipo: "RECEITA",
      valor,
      data: body.data,
      descricao: `[Transf. entrada] ${desc}`.trim(),
      status,
      id_recorrencia: idGrupoPar,
      nr_parcela: 1,
      total_parcelas: 1,
      tipo_recorrencia: null,
    })
    .select().single();

  if (e2 || !credito) {
    await c.from("transacoes").delete().eq("id", debito.id);
    console.error("Erro crédito:", e2);
    return erro("Erro ao criar lançamento de entrada: " + (e2?.message || "erro desconhecido"), 500);
  }

  return json(montarTransferencia(debito as Transacao, credito as Transacao), 201);
}

async function editar(
  c: ReturnType<typeof db>,
  idPar: string,
  body: Record<string, unknown>,
  userId: string
) {
  const erroVal = validarPayload(body, true);
  if (erroVal) return erro(erroVal, 422);

  const par = await buscarPar(c, idPar, userId);
  if (!par) return erro("Transferência não encontrada", 404);

  if (body.conta_origem_id && body.conta_origem_id !== par.debito.conta_id) {
    const r = await verificarContaAtiva(c, body.conta_origem_id as string, "Conta de origem");
    if (r) return r;
  }
  if (body.conta_destino_id && body.conta_destino_id !== par.credito.conta_id) {
    const r = await verificarContaAtiva(c, body.conta_destino_id as string, "Conta de destino");
    if (r) return r;
  }

  const novaOrigem  = body.conta_origem_id  ?? par.debito.conta_id;
  const novaDestino = body.conta_destino_id ?? par.credito.conta_id;
  if (novaOrigem === novaDestino)
    return erro("conta_origem_id e conta_destino_id devem ser diferentes", 422);

  const desc = body.descricao !== undefined ? (body.descricao as string) : null;
  const camposComuns: Record<string, unknown> = {};
  if (body.valor  !== undefined) camposComuns.valor  = Number(body.valor);
  if (body.data   !== undefined) camposComuns.data   = body.data;
  if (body.status !== undefined) camposComuns.status = body.status;

  const { error: eu1 } = await c.from("transacoes").update({
    ...camposComuns,
    conta_id: novaOrigem,
    ...(desc !== null ? { descricao: `[Transf. saída] ${desc}`.trim() } : {}),
  }).eq("id", par.debito.id);
  if (eu1) return erro("Erro ao atualizar débito: " + eu1.message, 500);

  const { error: eu2 } = await c.from("transacoes").update({
    ...camposComuns,
    conta_id: novaDestino,
    ...(desc !== null ? { descricao: `[Transf. entrada] ${desc}`.trim() } : {}),
  }).eq("id", par.credito.id);
  if (eu2) return erro("Erro ao atualizar crédito: " + eu2.message, 500);

  const parAtualizado = await buscarPar(c, idPar, userId);
  if (!parAtualizado) return erro("Erro ao recuperar transferência atualizada", 500);

  return json(montarTransferencia(parAtualizado.debito, parAtualizado.credito));
}

async function excluir(
  c: ReturnType<typeof db>,
  idPar: string,
  userId: string
) {
  const par = await buscarPar(c, idPar, userId);
  if (!par) return erro("Transferência não encontrada", 404);

  const { error: eu1 } = await c.from("transacoes")
    .update({ id_recorrencia: null })
    .in("id", [par.debito.id, par.credito.id]);
  if (eu1) return erro("Erro ao preparar exclusão: " + eu1.message, 500);

  const { error: eu2 } = await c.from("transacoes")
    .delete()
    .in("id", [par.debito.id, par.credito.id]);
  if (eu2) return erro("Erro ao excluir: " + eu2.message, 500);

  return json({ mensagem: "Transferência excluída com sucesso" });
}
