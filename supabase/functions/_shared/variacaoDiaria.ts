// supabase/functions/_shared/variacaoDiaria.ts
//
// Variação diária (fechamento vs. fechamento anterior) de ativos cotados, para
// injetar como contexto nas chamadas de IA. A IA não consulta o mercado:
// perguntas como "quais tiveram as maiores quedas ontem?" só têm resposta se o
// backend entregar os fechamentos recentes. Fonte: Yahoo (sem chave).
// Vale só para cotados (B3/BDR/stocks); RF/Tesouro/cripto ficam de fora.
import { logError } from "./logger.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export const RE_PERGUNTA_VARIACAO = /\b(quedas?|caiu|cairam|caíram|cair|subiu|subiram|altas?|baixas?|varia[cç]|oscil|desvaloriz|valoriz)/i;
const TIPOS_SEM_FECHAMENTO = ["RENDA_FIXA", "TESOURO_DIRETO", "CRIPTOMOEDAS"];
const MAX_TICKERS_VARIACAO = 60;

const fmtDataBR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

type Candidatos = (ticker: string) => string[];
const candidatosPadrao: Candidatos = (t) => (/\d/.test(t) ? [`${t}.SA`, t] : [t, `${t}.SA`]);

export interface PontoDiario { data: string; fechamento: number; varPct: number | null }

export async function fechamentosRecentes(
  ticker: string, candidatos: Candidatos = candidatosPadrao,
): Promise<PontoDiario[] | null> {
  for (const sym of candidatos(ticker.toUpperCase())) {
    try {
      const res = await fetch(
        `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?range=7d&interval=1d`,
        { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(8000) },
      );
      if (!res.ok) continue;
      const data = await res.json() as { chart?: { result?: { timestamp?: number[]; indicators?: { quote?: { close?: (number | null)[] }[] } }[] } };
      const r = data.chart?.result?.[0];
      const ts = r?.timestamp ?? [];
      const closes = r?.indicators?.quote?.[0]?.close ?? [];
      const pontos = ts
        .map((t, i) => ({ data: fmtDataBR.format(new Date(t * 1000)), fechamento: closes[i] }))
        .filter((p): p is { data: string; fechamento: number } => p.fechamento != null);
      if (pontos.length < 2) continue;
      return pontos.slice(1).map((p, i) => ({
        data: p.data,
        fechamento: Number(p.fechamento.toFixed(2)),
        varPct: pontos[i].fechamento > 0 ? Number((((p.fechamento / pontos[i].fechamento) - 1) * 100).toFixed(2)) : null,
      }));
    } catch (e) { logError("yahoo variação diária", e); }
  }
  return null;
}

export function descreverPontos(pontos: PontoDiario[]): string {
  return pontos.map((p) =>
    `${p.data} ${p.varPct == null ? "s/ var." : `${p.varPct > 0 ? "+" : ""}${p.varPct}%`} (fech. ${p.fechamento})`
  ).join(" | ");
}

// Bloco de contexto com a variação diária (últimos pregões) dos ativos
// cotados da carteira do usuário — só quando a pergunta fala de queda/alta/
// variação. Se há `contextoAnexo` (carteira/página), restringe aos tickers que
// aparecem nele. Filtra por user_id explicitamente: a RLS de agregados também
// liberaria as posições do dono. Nunca lança — falha vira "sem bloco".
export async function contextoVariacaoDiaria(
  c: Db, userId: string, mensagem: string, contextoAnexo: string, candidatos?: Candidatos,
): Promise<string> {
  if (!RE_PERGUNTA_VARIACAO.test(mensagem)) return "";
  try {
    const { data } = await c.from("inv_posicoes")
      .select("inv_ativos(ticker, tipo_ativo)").eq("user_id", userId).eq("status", "ATIVA");
    const anexo = contextoAnexo.toUpperCase();
    const tickers = [...new Set(
      ((data ?? []) as { inv_ativos: { ticker: string; tipo_ativo: string } | null }[])
        .map((p) => p.inv_ativos)
        .filter((a): a is { ticker: string; tipo_ativo: string } => !!a && !TIPOS_SEM_FECHAMENTO.includes(a.tipo_ativo))
        .map((a) => a.ticker.toUpperCase())
        .filter((t) => !anexo || anexo.includes(t)),
    )].slice(0, MAX_TICKERS_VARIACAO);
    if (tickers.length === 0) return "";

    const linhas: string[] = [];
    for (let i = 0; i < tickers.length; i += 8) {
      const lote = tickers.slice(i, i + 8);
      const res = await Promise.all(lote.map((t) => fechamentosRecentes(t, candidatos)));
      res.forEach((pontos, j) => { if (pontos) linhas.push(`${lote[j]}: ${descreverPontos(pontos)}`); });
    }
    if (linhas.length === 0) return "";
    return "Variação diária dos ativos da carteira nos últimos pregões (fechamento vs. fechamento anterior; " +
      "datas em horário de Brasília; o pregão de hoje pode estar em andamento; ativos de renda fixa, tesouro e " +
      "cripto não incluídos). Use estes dados para responder sobre quedas/altas por dia:\n" + linhas.join("\n");
  } catch (e) {
    logError("Variação diária p/ IA", e);
    return "";
  }
}
