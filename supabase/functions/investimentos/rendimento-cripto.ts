// supabase/functions/investimentos/rendimento-cripto.ts
// Rendimento (yield) de criptomoedas materializado como operações
// RENDIMENTO — rota manual + cron diário. Extraído de index.ts.
import { json, erro, dbAdmin, autenticarCron } from "../_shared/utils.ts";
import { logRequest, logSuccess } from "../_shared/logger.ts";
import { Db, hojeISO, periodoDiasComposicao, addDiasISO, diasEntreISO, inserirEmLote } from "./shared.ts";
import { recomputarPosicao } from "./posicoes.ts";

export async function rotaRendimentoCripto(c: Db, m: string, userId: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  logRequest("POST", "/investimentos/rendimento-cripto", { userId });
  return json({ dados: await provisionarRendimentoCripto(c, userId) });
}

// JOB (todos os usuários) — protegido pelo x-cron-secret. Roda via service_role.
export async function rotaRendimentoCriptoCron(req: Request, m: string) {
  if (m !== "POST") return erro("Método não permitido", 405);
  const naoAutorizado = autenticarCron(req);
  if (naoAutorizado) return naoAutorizado;
  logRequest("POST", "/investimentos/rendimento-cripto-cron", {});
  return json({ dados: await provisionarRendimentoCripto(dbAdmin(), null) });
}

// Dias (UTC) entre duas datas YYYY-MM-DD.
export async function provisionarRendimentoCripto(
  c: Db, filtroUserId: string | null,
): Promise<{ posicoes: number; operacoes_criadas: number; operacoes_atualizadas: number }> {
  const hoje = hojeISO();
  let consulta = c.from("inv_ativos")
    .select("id, user_id, ticker, cripto_rendimento_aa, cripto_rendimento_inicio, cripto_rendimento_periodicidade")
    .eq("tipo_ativo", "CRIPTOMOEDAS").gt("cripto_rendimento_aa", 0);
  if (filtroUserId) consulta = consulta.eq("user_id", filtroUserId);
  const { data: ativos } = await consulta;

  let posicoesTocadas = 0, opsCriadas = 0;
  for (const ativo of (ativos ?? []) as {
    id: string; user_id: string; cripto_rendimento_aa: number;
    cripto_rendimento_inicio: string | null; cripto_rendimento_periodicidade: string | null;
  }[]) {
    const taxa = Number(ativo.cripto_rendimento_aa) / 100; // % a.a. → fração
    if (!(taxa > 0)) continue;
    const pDias = periodoDiasComposicao(ativo.cripto_rendimento_periodicidade);

    const { data: posicoes } = await c.from("inv_posicoes")
      .select("id, conta_id").eq("ativo_id", ativo.id).eq("status", "ATIVA");

    for (const pos of (posicoes ?? []) as { id: string; conta_id: string }[]) {
      // Rebuild: apaga as operações RENDIMENTO da posição e recalcula do zero.
      // Evita conflito entre esquemas (mensal antigo × semanal novo) e mantém
      // tudo consistente quando taxa/início/periodicidade mudam.
      await c.from("inv_operacoes").delete().eq("posicao_id", pos.id).eq("tipo_operacao", "RENDIMENTO");

      const { data: ops } = await c.from("inv_operacoes")
        .select("tipo_operacao, quantidade, data_operacao")
        .eq("posicao_id", pos.id).order("data_operacao", { ascending: true });
      const base = (ops ?? []) as { tipo_operacao: string; quantidade: number; data_operacao: string }[];

      // Início = 1º aporte/compra; se houver data configurada, usa a MAIOR
      // (não há cotas antes da compra; e o usuário pode ter passado a render depois).
      const primeira = base.find((o) => o.tipo_operacao === "COMPRA" || o.tipo_operacao === "APORTE");
      if (!primeira) continue;
      const compra = String(primeira.data_operacao);
      const cfg = ativo.cripto_rendimento_inicio ? String(ativo.cripto_rendimento_inicio) : null;
      const inicio = cfg && cfg > compra ? cfg : compra;
      if (inicio > hoje) continue;

      // Quantidade até uma data: ops reais + recompensas calculadas neste run.
      const rewards: { data: string; qtd: number }[] = [];
      const qtdAte = (limite: string): number => {
        let q = 0;
        for (const o of base) {
          if (String(o.data_operacao) > limite) break;
          const qq = Number(o.quantidade) || 0;
          const t = o.tipo_operacao;
          if (t === "COMPRA" || t === "APORTE") q += qq;
          else if (t === "VENDA" || t === "RESGATE") q -= Math.min(qq, q);
          if (q < 0) q = 0;
        }
        for (const r of rewards) if (r.data <= limite) q += r.qtd;
        return q;
      };

      // Materialização SEMANAL: 1 operação por bloco de 7 dias desde o início.
      // As linhas são acumuladas em memória e gravadas com UM insert em lote
      // ao final — antes, cada bloco disparava seu próprio insert (uma
      // posição com anos de histórico chegava a ~156 round-trips sequenciais
      // por execução do cron, achado de auditoria).
      const linhasRendimento: Record<string, unknown>[] = [];
      let bIni = inicio;
      while (bIni <= hoje) {
        const bUlt = addDiasISO(bIni, 6);              // último dia do bloco
        const fim  = bUlt > hoje ? hoje : bUlt;        // bloco corrente é parcial
        const dias = diasEntreISO(bIni, fim) + 1;      // inclusivo
        const qtdBase = qtdAte(bIni);                  // cotas no início do bloco
        // Composição na periodicidade escolhida (taxa por período, dias/período vezes).
        const fator  = Math.pow(1 + taxa * pDias / 365, dias / pDias);
        const tokens = qtdBase * (fator - 1);
        if (tokens > 1e-8) {
          const valor = Number(tokens.toFixed(8));
          linhasRendimento.push({
            user_id: ativo.user_id, posicao_id: pos.id, tipo_operacao: "RENDIMENTO",
            conta_id: pos.conta_id, quantidade: valor, preco_unitario: 0,
            valor_total: 0, data_operacao: fim,
          });
          rewards.push({ data: fim, qtd: valor }); // compõe nos blocos seguintes
        }
        bIni = addDiasISO(bIni, 7);
      }
      if (linhasRendimento.length > 0) {
        await inserirEmLote(c, "inv_operacoes", linhasRendimento, "id");
        opsCriadas += linhasRendimento.length;
      }

      await recomputarPosicao(c, pos.id);
      posicoesTocadas++;
    }
  }
  logSuccess("Rendimento cripto", { posicoesTocadas, opsCriadas });
  return { posicoes: posicoesTocadas, operacoes_criadas: opsCriadas, operacoes_atualizadas: 0 };
}

