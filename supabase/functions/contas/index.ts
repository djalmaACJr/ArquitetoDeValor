// ============================================================
// Arquiteto de Valor — Edge Function: contas v7
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, extrairId,
         verificarExistencia, validarCor, camposParaAtualizar } from "../_shared/utils.ts";
import { logDebug, logError, logInfo, logRequest, logResponse, logSuccess, logWarn } from "../_shared/logger.ts";

const TIPOS_CONTA = ["CORRENTE","REMUNERACAO","CARTAO","INVESTIMENTO","CARTEIRA"];

Deno.serve(async (req: Request) => {
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id = extrairId(req, "contas");
  const m  = req.method;
  const c  = db(req);

  try {
    if (m === "GET"    && !id) return await listar(c);
    if (m === "GET"    &&  id) return await buscarPorId(c, id);
    if (m === "POST")          return await criar(c, await req.json(), userId);
    if (m === "PUT"    &&  id) return await editar(c, id, await req.json());
    if (m === "DELETE" &&  id) return await excluir(c, id);
    return erro("Rota não encontrada", 404);
  } catch (e) { 
    logError("Handler principal", e);
    return erro("Erro interno", 500); 
  }
});

async function listar(c: ReturnType<typeof db>) {
  logRequest("GET", "/contas");
  
  const { data, error } = await c.from("vw_saldo_contas").select("*").order("nome");
  if (error) {
    logError("Listar contas", error);
    return erro(error.message);
  }
  
  logResponse(200, { count: data?.length });
  return json({ dados: data });
}

async function buscarPorId(c: ReturnType<typeof db>, id: string) {
  logRequest("GET", `/contas/${id}`);
  
  const { data, error } = await c.from("vw_saldo_contas").select("*").eq("conta_id", id).single();
  if (error) {
    logResponse(404);
    return erro("Conta não encontrada", 404);
  }
  
  logResponse(200, { id, nome: data.nome });
  return json(data);
}

async function criar(c: ReturnType<typeof db>, body: Record<string, unknown>, userId: string) {
  logRequest("POST", "/contas", body);
  
  // RV-008: nome 1–50 chars
  if (!body.nome || String(body.nome).length < 1) {
    logResponse(422, { erro: "nome é obrigatório (RV-008)" });
    return erro("nome é obrigatório (RV-008)");
  }
  if (String(body.nome).length > 50) {
    logResponse(422, { erro: "nome deve ter no máximo 50 caracteres (RV-008)" });
    return erro("nome deve ter no máximo 50 caracteres (RV-008)");
  }
  
  // RV-011: tipo válido
  if (!body.tipo) {
    logResponse(422, { erro: `tipo é obrigatório: ${TIPOS_CONTA.join(" | ")} (RV-011)` });
    return erro(`tipo é obrigatório: ${TIPOS_CONTA.join(" | ")} (RV-011)`);
  }
  if (!TIPOS_CONTA.includes(String(body.tipo))) {
    logResponse(422, { erro: "tipo inválido (RV-011)" });
    return erro("tipo inválido (RV-011)");
  }
  
  // RV-010: cor hex
  const corInvalida = validarCor(body.cor);
  if (corInvalida) return corInvalida;

  const { data, error } = await c.from("contas").insert({
    user_id: userId, nome: body.nome, tipo: body.tipo,
    saldo_inicial: body.saldo_inicial ?? 0,
    icone: body.icone ?? null, cor: body.cor ?? null, ativa: true,
  }).select().single();

  if (error) {
    logError("Criar conta", error);
    if (error.message.includes("uq_contas_user_nome_tipo")) {
      logResponse(409, { erro: "Já existe uma conta com este nome e tipo" });
      return erro("Já existe uma conta com este nome e tipo", 409);
    }
    return erro(error.message);
  }
  
  logSuccess("Conta criada", { id: data.id, nome: data.nome });
  logResponse(201, data);
  return json(data, 201);
}

async function editar(c: ReturnType<typeof db>, id: string, body: Record<string, unknown>) {
  logRequest("PUT", `/contas/${id}`, body);
  
  const naoEncontrada = await verificarExistencia(c, "contas", id, "Conta não encontrada");
  if (naoEncontrada) return naoEncontrada;

  if (body.nome !== undefined &&
     (String(body.nome).length < 1 || String(body.nome).length > 50)) {
    logResponse(422, { erro: "nome deve ter entre 1 e 50 caracteres (RV-008)" });
    return erro("nome deve ter entre 1 e 50 caracteres (RV-008)");
  }
  if (body.tipo !== undefined && !TIPOS_CONTA.includes(String(body.tipo))) {
    logResponse(422, { erro: "tipo inválido (RV-011)" });
    return erro("tipo inválido (RV-011)");
  }
  
  const corInvalida = validarCor(body.cor);
  if (corInvalida) return corInvalida;

  const campos = camposParaAtualizar(body, ["nome","tipo","saldo_inicial","icone","cor","ativa"]);
  const { data, error } = await c.from("contas").update(campos).eq("id", id).select().single();
  
  if (error) {
    logError("Editar conta", error);
    return erro(error.message);
  }
  
  logSuccess("Conta atualizada", { id });
  logResponse(200, data);
  return json(data);
}

async function excluir(c: ReturnType<typeof db>, id: string) {
  logRequest("DELETE", `/contas/${id}`);
  
  const naoEncontrada = await verificarExistencia(c, "contas", id, "Conta não encontrada");
  if (naoEncontrada) return naoEncontrada;

  const { error } = await c.from("contas").delete().eq("id", id);
  if (error) {
    logError("Excluir conta", error);
    if (error.message.includes("CONTA_EM_USO")) {
      logResponse(409, { erro: "Conta possui lançamentos vinculados" });
      return erro("Esta conta possui lançamentos vinculados e não pode ser excluída.", 409);
    }
    return erro(error.message);
  }
  
  logSuccess("Conta excluída", { id });
  logResponse(200, { mensagem: "Excluída com sucesso" });
  return json({ mensagem: "Conta excluída com sucesso" });
}