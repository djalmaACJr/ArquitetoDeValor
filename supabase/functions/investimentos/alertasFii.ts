// supabase/functions/investimentos/alertasFii.ts
//
// Alerta especial de "FII em vias de mudar de forma": liquidação/dissolução,
// incorporação/fusão/cisão, transformação e troca de código de negociação —
// o caso que motivou isto foi o RBRR11 (em liquidação, cotas do PCIP11 sendo
// entregues no lugar). Nesses casos a cotação pode zerar, o ticker some e o
// usuário precisa agir (ver "Transferência de ativo" em BUSINESS_RULES.md).
//
// Fonte: o cache compartilhado `inv_fatos_relevantes` (Fatos Relevantes e
// Comunicados ao Mercado, Fundos.NET) que o cron `fatos-relevantes-diario` já
// mantém — NADA novo é baixado aqui e não há tabela nova: a classificação é
// feita na leitura, por palavras-chave sobre o resumo do documento.
//
// Limite conhecido: o Fundos.NET devolve só um resumo curto
// (`informacoesAdicionais`); se o fundo publicou o aviso sem descrição, não há
// o que classificar (o link pro documento ainda aparece nos fatos do ativo).
import { json, erro } from "../_shared/utils.ts";
import { logError } from "../_shared/logger.ts";
import { Db, hojeISO, recuarDias } from "./shared.ts";
import { normaliza, nucleoTicker } from "./fatosRelevantes.ts";

export type TipoAlertaFii = "LIQUIDACAO" | "INCORPORACAO" | "TRANSFORMACAO" | "TROCA_CODIGO";

export const ROTULO_ALERTA: Record<TipoAlertaFii, string> = {
  LIQUIDACAO:    "Fundo em liquidação",
  INCORPORACAO:  "Fusão / incorporação do fundo",
  TRANSFORMACAO: "Transformação do fundo",
  TROCA_CODIGO:  "Troca de código ou de cotas",
};

const JANELA_DIAS_ALERTA = 180;

// Liquidação "financeira" de oferta/emissão é rotina de captação, não fim do
// fundo — sai do texto antes de procurar por "liquidação".
const RUIDO = /liquidacao (financeira|da oferta|da emissao|das cotas (da emissao|subscritas)|do direito|das sobras|do lote|dos recibos)|liquidacao de (oferta|emissao|ativos)/g;

// Pura (testável): devolve o tipo de alerta que o texto sugere, ou null.
export function classificarAlertaFii(texto: string | null | undefined): TipoAlertaFii | null {
  if (!texto) return null;
  const t = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(RUIDO, " ");
  if (/\b(liquidacao|dissolucao|extincao|encerramento) (do |da |de )?(fundo|classe|fii)\b|\bliquidac|\bdissolucao\b|amortizacao total|desinvestimento total/.test(t)) return "LIQUIDACAO";
  if (/\b(incorporac|fusao|cisao|incorporad[oa] )/.test(t)) return "INCORPORACAO";
  if (/\btransformac|conversao (do fundo )?em|migrac(ao)? (para|de) (fiagro|fii|fundo|classe)|reorganizac|alteracao (da |de )?(classificac|tipo)/.test(t)) return "TRANSFORMACAO";
  if (/novo codigo (de negociacao)?|alteracao (do )?codigo|troca de (cotas|codigo|ticker)|migrac/.test(t)) return "TROCA_CODIGO";
  return null;
}

export interface AlertaFii {
  id: number;               // id do documento no Fundos.NET
  ativo_id: string;
  ticker: string;
  tipo: TipoAlertaFii;
  rotulo: string;
  categoria: string;        // "Fato Relevante" | "Comunicado ao Mercado"
  data_entrega: string;
  resumo: string | null;
  url_documento: string;
}

// GET /investimentos/alertas-fii — FIIs com posição ativa que têm, nos
// últimos ~6 meses, um fato relevante/comunicado sugerindo liquidação,
// fusão, transformação ou troca de código. `userId` = dono dos dados já
// resolvido pelo chamador (espaço de agregado incluso).
export async function rotaAlertasFii(c: Db, m: string, userId: string): Promise<Response> {
  if (m !== "GET") return erro("Método não permitido", 405);

  const { data: pos, error: errPos } = await c.from("inv_posicoes")
    .select("ativo_id, quantidade, inv_ativos!inner(id, ticker, nome, tipo_ativo)")
    .eq("user_id", userId).eq("status", "ATIVA").eq("inv_ativos.tipo_ativo", "FII");
  if (errPos) { logError("Alertas FII (posições)", errPos); return erro(errPos.message); }

  const ativos = new Map<string, { id: string; ticker: string; nome: string | null }>();
  for (const p of pos ?? []) {
    const a = p.inv_ativos as unknown as { id: string; ticker: string; nome: string | null } | null;
    if (a && Number(p.quantidade) > 0) ativos.set(String(a.id), { id: String(a.id), ticker: a.ticker, nome: a.nome });
  }
  if (ativos.size === 0) return json({ dados: [] });

  const { data: fatos, error: errFatos } = await c.from("inv_fatos_relevantes")
    .select("id, categoria, fundo_nome, fundo_pregao, resumo, data_entrega, url_documento")
    .gte("data_entrega", recuarDias(hojeISO(), JANELA_DIAS_ALERTA))
    .order("data_entrega", { ascending: false }).limit(3000);
  if (errFatos) { logError("Alertas FII (fatos)", errFatos); return erro(errFatos.message); }

  const alertas: AlertaFii[] = [];
  const jaVisto = new Set<string>(); // um alerta por (ativo, tipo): o mais recente
  for (const f of fatos ?? []) {
    const tipo = classificarAlertaFii(f.resumo as string | null);
    if (!tipo) continue;
    const pregao = normaliza(String(f.fundo_pregao ?? ""));
    const nomeFundo = normaliza(String(f.fundo_nome ?? ""));
    for (const a of ativos.values()) {
      const nucleo = nucleoTicker(a.ticker);
      if (!nucleo || !(pregao.includes(nucleo) || nomeFundo.includes(nucleo))) continue;
      const chave = `${a.id}:${tipo}`;
      if (jaVisto.has(chave)) continue;
      jaVisto.add(chave);
      alertas.push({
        id: Number(f.id), ativo_id: a.id, ticker: a.ticker, tipo, rotulo: ROTULO_ALERTA[tipo],
        categoria: String(f.categoria), data_entrega: String(f.data_entrega),
        resumo: (f.resumo as string | null) ?? null, url_documento: String(f.url_documento),
      });
    }
  }
  return json({ dados: alertas });
}
