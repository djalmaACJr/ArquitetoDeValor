// supabase/functions/limpar/index.ts
// Arquiteto de Valor — Edge Function: limpar v7
import "@supabase/functions-js/edge-runtime.d.ts";
import { json, erro, db, autenticar, corsPreFlight } from "../_shared/utils.ts";
import { logError, logInfo, logSuccess } from "../_shared/logger.ts";

// Reativa todas as contas inativas do usuário e devolve seus ids.
// Necessário porque o trigger trg_validar_isolamento_usuario rejeita
// qualquer UPDATE em transacoes cuja conta esteja inativa.
async function reativarContasInativas(c: ReturnType<typeof db>, userId: string): Promise<string[]> {
  const { data, error } = await c.from("contas")
    .select("id").eq("user_id", userId).eq("ativa", false);
  if (error) throw error;
  const ids = (data ?? []).map((r: { id: string }) => r.id);
  if (ids.length === 0) return [];
  const { error: eUp } = await c.from("contas").update({ ativa: true }).in("id", ids);
  if (eUp) throw eUp;
  return ids;
}

async function reinativarContas(c: ReturnType<typeof db>, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await c.from("contas").update({ ativa: false }).in("id", ids);
  if (error) logError("[limpar] reinativar contas", JSON.stringify(error));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  if (req.method !== "DELETE") return erro("Método não permitido", 405);

  const auth = await autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const params   = new URL(req.url).searchParams;
  const entidade = params.get("entidade");
  const c = db(req);

  try {
    if (!entidade)                      return await limparTudo(c, userId);
    if (entidade === "transacoes")      return await limparTransacoes(c, userId);
    if (entidade === "categorias")      return await limparCategorias(c, userId);
    if (entidade === "contas")          return await limparContas(c, userId);
    if (entidade === "investimentos")   return await limparInvestimentos(c, userId);
    return erro("entidade inválida: use transacoes | categorias | contas | investimentos", 422);
  } catch (e) {
    logError("[limpar] Erro inesperado", e);
    return erro("Erro interno", 500);
  }
});

async function limparTransacoes(c: ReturnType<typeof db>, userId: string) {
  logInfo("[limpar] Iniciando limpeza de transacoes", { userId });

  // Reativar contas inativas para liberar o trigger trg_validar_isolamento_usuario
  let contasReativadas: string[] = [];
  try {
    contasReativadas = await reativarContasInativas(c, userId);
  } catch (e) {
    logError("[limpar] transacoes reativar contas", JSON.stringify(e));
    return erro((e as Error).message ?? "Erro ao reativar contas");
  }

  try {
    // Desvincular transferências antes de deletar
    const { error: eDesvinc } = await c
      .from("transacoes")
      .update({ id_par_transferencia: null })
      .eq("user_id", userId)
      .not("id_par_transferencia", "is", null);
    if (eDesvinc) {
      logError("[limpar] transacoes desvincular", JSON.stringify(eDesvinc));
      return erro(eDesvinc.message);
    }

    const { count, error } = await c
      .from("transacoes")
      .delete({ count: "exact" })
      .eq("user_id", userId);
    if (error) {
      logError("[limpar] transacoes", JSON.stringify(error));
      return erro(error.message);
    }
    logSuccess("[limpar] transacoes", { excluidos: count });
    return json({ ok: true, excluidos: count ?? 0, entidade: "transacoes" });
  } finally {
    await reinativarContas(c, contasReativadas);
  }
}

async function limparCategorias(c: ReturnType<typeof db>, userId: string) {
  logInfo("[limpar] Iniciando limpeza de categorias", { userId });

  const { error: e1 } = await c.from("categorias")
    .delete()
    .eq("user_id", userId)
    .eq("protegida", false)
    .not("id_pai", "is", null);
  if (e1) {
    logError("[limpar] categorias filhas", JSON.stringify(e1));
    return erro(e1.message);
  }

  const { count, error } = await c
    .from("categorias")
    .delete({ count: "exact" })
    .eq("user_id", userId)
    .eq("protegida", false);
  if (error) {
    logError("[limpar] categorias pais", JSON.stringify(error));
    return erro(error.message);
  }
  logSuccess("[limpar] categorias", { excluidos: count });
  return json({ ok: true, excluidos: count ?? 0, entidade: "categorias" });
}

async function limparContas(c: ReturnType<typeof db>, userId: string) {
  logInfo("[limpar] Iniciando limpeza de contas", { userId });
  const { count, error } = await c
    .from("contas")
    .delete({ count: "exact" })
    .eq("user_id", userId);
  if (error) {
    logError("[limpar] contas", JSON.stringify(error));
    return erro(error.message);
  }
  logSuccess("[limpar] contas", { excluidos: count });
  return json({ ok: true, excluidos: count ?? 0, entidade: "contas" });
}

// Limpa o módulo de investimentos (filhos → pais). NÃO toca no EXTRATO:
// as transações de proventos (lançadas ou associadas) permanecem como
// receitas normais — `inv_dividendos.transacao_extrato_id` tem ON DELETE
// SET NULL, então apagar os dividendos não remove nem altera as transações.
// Também NÃO apaga configuração reutilizável (inv_tipos_dividendo /
// inv_alocacoes_tipo), seeds/ajustes recriados só no cadastro.
// (A exclusão de CONTA, via fn_excluir_dados_usuario, sim remove tudo.)
// Retorna o total de registros excluídos por tabela.
async function excluirDadosInvestimentos(
  c: ReturnType<typeof db>, userId: string,
): Promise<{ entidade: string; excluidos: number }[]> {
  const logs: { entidade: string; excluidos: number }[] = [];

  const tabelas = [
    "inv_historico_mensal", "inv_dividendos", "inv_operacoes",
    "inv_posicoes", "inv_avaliacoes", "inv_ativos",
  ];
  for (const t of tabelas) {
    const { count, error } = await c.from(t).delete({ count: "exact" }).eq("user_id", userId);
    if (error) throw new Error(`${t}: ${error.message}`);
    logs.push({ entidade: t, excluidos: count ?? 0 });
  }
  return logs;
}

async function limparInvestimentos(c: ReturnType<typeof db>, userId: string) {
  logInfo("[limpar] Iniciando limpeza de investimentos", { userId });
  try {
    const logs = await excluirDadosInvestimentos(c, userId);
    const total = logs.reduce((s, l) => s + l.excluidos, 0);
    logSuccess("[limpar] investimentos", { logs });
    return json({ ok: true, excluidos: total, entidade: "investimentos", logs });
  } catch (e) {
    logError("[limpar] investimentos", JSON.stringify(e));
    return erro((e as Error).message ?? "Erro ao limpar investimentos");
  }
}

async function limparTudo(c: ReturnType<typeof db>, userId: string) {
  logInfo("[limpar] Iniciando limpeza total", { userId });
  const logs: { entidade: string; excluidos: number }[] = [];

  // Reativar contas inativas (necessário para o UPDATE em transacoes passar pelo trigger)
  // Não há reinativação posterior — as contas serão deletadas no passo 3.
  try {
    await reativarContasInativas(c, userId);
  } catch (e) {
    logError("[limpar] tudo — reativar contas", JSON.stringify(e));
    return erro((e as Error).message ?? "Erro ao reativar contas");
  }

  // 0. Investimentos — antes das contas (inv_posicoes referencia contas
  //    com ON DELETE RESTRICT; sem isso o passo 3 falha)
  try {
    const logsInv = await excluirDadosInvestimentos(c, userId);
    logs.push({ entidade: "investimentos", excluidos: logsInv.reduce((s, l) => s + l.excluidos, 0) });
  } catch (e) {
    logError("[limpar] tudo — investimentos", JSON.stringify(e));
    return erro((e as Error).message ?? "Erro ao limpar investimentos");
  }

  // 1. Transações — desvincular transferências antes de deletar
  const { error: eDesvinc } = await c.from("transacoes")
    .update({ id_par_transferencia: null })
    .eq("user_id", userId)
    .not("id_par_transferencia", "is", null);
  if (eDesvinc) { logError("[limpar] tudo — desvincular", JSON.stringify(eDesvinc)); return erro(eDesvinc.message); }

  const { count: cntTx, error: eTx } = await c
    .from("transacoes").delete({ count: "exact" }).eq("user_id", userId);
  if (eTx) { logError("[limpar] tudo — transacoes", JSON.stringify(eTx)); return erro(eTx.message); }
  logs.push({ entidade: "transacoes", excluidos: cntTx ?? 0 });

  // 2. Categorias: filhas primeiro, depois pais
  const { error: eFilhas } = await c.from("categorias").delete()
    .eq("user_id", userId).eq("protegida", false).not("id_pai", "is", null);
  if (eFilhas) { logError("[limpar] tudo — categorias filhas", JSON.stringify(eFilhas)); return erro(eFilhas.message); }

  const { count: cntCat, error: eCat } = await c
    .from("categorias").delete({ count: "exact" })
    .eq("user_id", userId).eq("protegida", false);
  if (eCat) { logError("[limpar] tudo — categorias pais", JSON.stringify(eCat)); return erro(eCat.message); }
  logs.push({ entidade: "categorias", excluidos: cntCat ?? 0 });

  // 3. Contas
  const { count: cntConta, error: eConta } = await c
    .from("contas").delete({ count: "exact" }).eq("user_id", userId);
  if (eConta) { logError("[limpar] tudo — contas", JSON.stringify(eConta)); return erro(eConta.message); }
  logs.push({ entidade: "contas", excluidos: cntConta ?? 0 });

  logSuccess("[limpar] tudo concluído", { logs });
  return json({ ok: true, logs });
}
