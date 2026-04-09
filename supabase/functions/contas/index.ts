// ============================================================
// Arquiteto de Valor — Edge Function: contas v6
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, extrairId,
         verificarExistencia, validarCor, camposParaAtualizar } from "../_shared/utils.ts";

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
  } catch (e) { console.error(e); return erro("Erro interno", 500); }
});

async function listar(c: ReturnType<typeof db>) {
  const { data, error } = await c.from("vw_saldo_contas").select("*").order("nome");
  if (error) return erro(error.message);
  return json({ dados: data });
}

async function buscarPorId(c: ReturnType<typeof db>, id: string) {
  const { data, error } = await c.from("vw_saldo_contas").select("*").eq("conta_id", id).single();
  if (error) return erro("Conta não encontrada", 404);
  return json(data);
}

async function criar(c: ReturnType<typeof db>, body: Record<string, unknown>, userId: string) {
  // RV-008: nome 1–50 chars
  if (!body.nome || String(body.nome).length < 1)
    return erro("nome é obrigatório (RV-008)");
  if (String(body.nome).length > 50)
    return erro("nome deve ter no máximo 50 caracteres (RV-008)");
  // RV-011: tipo válido
  if (!body.tipo)
    return erro(`tipo é obrigatório: ${TIPOS_CONTA.join(" | ")} (RV-011)`);
  if (!TIPOS_CONTA.includes(String(body.tipo)))
    return erro("tipo inválido (RV-011)");
  // RV-010: cor hex
  const corInvalida = validarCor(body.cor);
  if (corInvalida) return corInvalida;

  const { data, error } = await c.from("contas").insert({
    user_id: userId, nome: body.nome, tipo: body.tipo,
    saldo_inicial: body.saldo_inicial ?? 0,
    icone: body.icone ?? null, cor: body.cor ?? null, ativa: true,
  }).select().single();

  if (error) {
    if (error.message.includes("uq_contas_user_nome_tipo"))
      return erro("Já existe uma conta com este nome e tipo", 409);
    return erro(error.message);
  }
  return json(data, 201);
}

async function editar(c: ReturnType<typeof db>, id: string, body: Record<string, unknown>) {
  const naoEncontrada = await verificarExistencia(c, "contas", id, "Conta não encontrada");
  if (naoEncontrada) return naoEncontrada;

  if (body.nome !== undefined &&
     (String(body.nome).length < 1 || String(body.nome).length > 50))
    return erro("nome deve ter entre 1 e 50 caracteres (RV-008)");
  if (body.tipo !== undefined && !TIPOS_CONTA.includes(String(body.tipo)))
    return erro("tipo inválido (RV-011)");
  const corInvalida = validarCor(body.cor);
  if (corInvalida) return corInvalida;

  const campos = camposParaAtualizar(body, ["nome","tipo","saldo_inicial","icone","cor","ativa"]);
  const { data, error } = await c.from("contas").update(campos).eq("id", id).select().single();
  if (error) return erro(error.message);
  return json(data);
}

async function excluir(c: ReturnType<typeof db>, id: string) {
  const naoEncontrada = await verificarExistencia(c, "contas", id, "Conta não encontrada");
  if (naoEncontrada) return naoEncontrada;

  const { error } = await c.from("contas").delete().eq("id", id);
  if (error) {
    if (error.message.includes("CONTA_EM_USO"))
      return erro("Esta conta possui lançamentos vinculados e não pode ser excluída.", 409);
    return erro(error.message);
  }
  return json({ mensagem: "Conta excluída com sucesso" });
}
