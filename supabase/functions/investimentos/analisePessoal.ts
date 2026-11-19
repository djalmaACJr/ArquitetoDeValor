// supabase/functions/investimentos/analisePessoal.ts
//
// Análise de resultados — ETAPA 2: "o que isso significa para mim" (v7.9.0).
//
// A etapa 1 (relatoriosFii.ts / resultadosEmpresas.ts) é genérica e reaproveitável:
// responde "a empresa/fundo vai bem?". A etapa 2 parte da análise da etapa 1 JÁ
// PRONTA (não relê o relatório, então é barata) e cruza com o contexto do dono:
//   • perfil de investidor (usuarios.inv_perfil) + horizonte até a aposentadoria;
//   • posição no ativo (quantidade, preço médio, rentabilidade);
//   • peso do ativo e do tipo na carteira vs. a meta de alocação;
//   • quando o ativo entrou na carteira (1ª compra) e há quanto tempo é mantido.
//
// Privacidade: só vão ao provedor de IA (a chave do próprio usuário) percentuais e
// datas — nunca o patrimônio total em reais. Não é recomendação de compra/venda.
import { chamarProvedorIA, ErroIA, type ConfigIAAtiva } from "../_shared/ia.ts";
import { logError } from "../_shared/logger.ts";
import { Db, hojeISO } from "./shared.ts";
import { conversorCustoBRL, type PosicaoCusto } from "./mercado.ts";
import { mapaUltimoMercado } from "./dashboard.ts";

export type AlinhamentoPessoal = "ADEQUADO" | "ATENCAO" | "REVISAR";
export interface AnalisePessoal {
  alinhamento: AlinhamentoPessoal;
  resumo: string;
  pontos: string[];
}
/** Gravado em `inv_analises_relatorio.analise_pessoal` (JSONB). */
export interface AnalisePessoalSalva extends AnalisePessoal {
  gerada_em: string;
  provedor: string;
  modelo: string | null;
  mentor_nome: string | null;
}

export interface ContextoPessoal {
  ticker: string;
  tipo: string;
  perfil: string | null;
  idade: number | null;
  idadeAposentadoria: number | null;
  quantidade: number;
  precoMedio: number | null;       // na moeda do ativo
  rentabilidadePct: number | null; // sobre o custo, em BRL
  pesoAtivoPct: number | null;     // do ativo na carteira (valor de mercado)
  pesoTipoPct: number | null;      // do tipo do ativo na carteira
  metaTipoPct: number | null;      // alocação ideal do tipo (Configurações)
  entradaEm: string | null;        // AAAA-MM-DD da 1ª compra
  mesesNaCarteira: number | null;
}

// Meses cheios entre duas datas AAAA-MM-DD (sem passar por Date → sem virada de fuso).
export function mesesEntre(inicio: string, fim: string): number | null {
  const a = /^(\d{4})-(\d{2})-(\d{2})/.exec(inicio), b = /^(\d{4})-(\d{2})-(\d{2})/.exec(fim);
  if (!a || !b) return null;
  let m = (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
  if (Number(b[3]) < Number(a[3])) m--;
  return Math.max(m, 0);
}

export function tempoDeCasa(meses: number | null): string {
  if (meses == null) return "não informado";
  if (meses < 1) return "menos de 1 mês";
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12), resto = meses % 12;
  return `${anos} ${anos === 1 ? "ano" : "anos"}${resto ? ` e ${resto} ${resto === 1 ? "mês" : "meses"}` : ""}`;
}

const pct = (v: number | null, casas = 1) => (v == null ? "não informado" : `${v.toFixed(casas).replace(".", ",")}%`);

export function textoContextoPessoal(c: ContextoPessoal): string {
  const horizonte = c.idade != null && c.idadeAposentadoria != null ? Math.max(c.idadeAposentadoria - c.idade, 0) : null;
  return [
    `Perfil de investidor: ${c.perfil ?? "não informado"}${horizonte != null ? ` (faltam cerca de ${horizonte} anos para a aposentadoria pretendida)` : ""}.`,
    `Ativo: ${c.ticker} (${c.tipo}). Quantidade que a pessoa tem: ${c.quantidade}${c.precoMedio != null ? `; preço médio pago: ${c.precoMedio.toFixed(2).replace(".", ",")}` : ""}.`,
    `Resultado da posição até hoje (sobre o que foi investido): ${pct(c.rentabilidadePct)}.`,
    `Peso deste ativo na carteira: ${pct(c.pesoAtivoPct)}. Peso do tipo "${c.tipo}" na carteira: ${pct(c.pesoTipoPct)}${c.metaTipoPct != null ? ` (meta definida pela pessoa: ${pct(c.metaTipoPct, 0)})` : ""}.`,
    `Entrou na carteira em: ${c.entradaEm ?? "data não informada"} — há ${tempoDeCasa(c.mesesNaCarteira)}.`,
  ].join("\n");
}

// ── Cálculo do contexto (a partir do banco) ────────────────────────────

type PosRow = {
  ativo_id: string; conta_id: string; quantidade: number | string; valor_custo: number | string;
  data_compra: string | null; inv_ativos: { tipo_ativo?: string; moeda?: string } | null;
};

/** Puro: pesos e rentabilidade a partir das posições ATIVAS do usuário. */
export function calcularContexto(
  alvo: { id: string; ticker: string; tipo_ativo: string },
  posicoes: PosRow[],
  custoBRL: (p: PosicaoCusto) => number,
  ultimoMercado: Map<string, number>,
  metas: Map<string, number>,
  perfil: { perfil?: string; idade?: number; idade_aposentadoria?: number } | null,
  hoje: string,
  entradaMaisAntiga: string | null,
): ContextoPessoal {
  // Por par ativo+conta (o snapshot cobre todas as posições do par — não somar 2×).
  const pares = new Map<string, { ativo: string; tipo: string; custo: number; qtd: number }>();
  for (const p of posicoes) {
    const tipo = p.inv_ativos?.tipo_ativo;
    if (!tipo) continue;
    const k = `${p.ativo_id}|${p.conta_id}`;
    const x = pares.get(k) ?? { ativo: p.ativo_id, tipo, custo: 0, qtd: 0 };
    x.custo += custoBRL(p as unknown as PosicaoCusto);
    x.qtd += Number(p.quantidade) || 0;
    pares.set(k, x);
  }
  let total = 0, doTipo = 0, doAtivo = 0, custoAtivo = 0, qtdAtivo = 0;
  for (const [k, x] of pares) {
    const v = ultimoMercado.get(k) ?? x.custo;
    total += v;
    if (x.tipo === alvo.tipo_ativo) doTipo += v;
    if (x.ativo === alvo.id) { doAtivo += v; custoAtivo += x.custo; qtdAtivo += x.qtd; }
  }
  // Preço médio ponderado na moeda do ativo (custo nativo ÷ quantidade).
  const nativo = posicoes.filter((p) => p.ativo_id === alvo.id);
  const qtdN = nativo.reduce((s, p) => s + (Number(p.quantidade) || 0), 0);
  const custoN = nativo.reduce((s, p) => s + (Number(p.valor_custo) || 0), 0);

  const entrada = entradaMaisAntiga ?? nativo.map((p) => p.data_compra).filter((d): d is string => !!d).sort()[0] ?? null;
  return {
    ticker: alvo.ticker, tipo: alvo.tipo_ativo,
    perfil: perfil?.perfil ?? null, idade: perfil?.idade ?? null, idadeAposentadoria: perfil?.idade_aposentadoria ?? null,
    quantidade: Number(qtdAtivo.toFixed(8)),
    precoMedio: qtdN > 0 ? custoN / qtdN : null,
    rentabilidadePct: custoAtivo > 0 ? ((doAtivo - custoAtivo) / custoAtivo) * 100 : null,
    pesoAtivoPct: total > 0 ? (doAtivo / total) * 100 : null,
    pesoTipoPct: total > 0 ? (doTipo / total) * 100 : null,
    metaTipoPct: metas.get(alvo.tipo_ativo) ?? null,
    entradaEm: entrada ? entrada.slice(0, 10) : null,
    mesesNaCarteira: entrada ? mesesEntre(entrada, hoje) : null,
  };
}

export async function carregarContextoPessoal(
  c: Db, userId: string, alvo: { id: string; ticker: string; tipo_ativo: string },
): Promise<ContextoPessoal | null> {
  const [posRes, histRes, metaRes, perfRes, opRes] = await Promise.all([
    c.from("inv_posicoes").select("ativo_id, conta_id, quantidade, valor_custo, data_compra, inv_ativos(tipo_ativo, moeda)")
      .eq("user_id", userId).eq("status", "ATIVA"),
    c.from("vw_inv_ultimo_mercado").select("ativo_id, conta_id, valor_mercado").eq("user_id", userId),
    c.from("inv_alocacoes_tipo").select("tipo_ativo, percentual_ideal").eq("user_id", userId),
    c.from("usuarios").select("inv_perfil").eq("id", userId).maybeSingle(),
    // 1ª compra do ativo (inclui posições já encerradas e reinvestimentos): a entrada real.
    c.from("inv_operacoes").select("data_operacao, inv_posicoes!inner(ativo_id)")
      .eq("user_id", userId).eq("inv_posicoes.ativo_id", alvo.id).in("tipo_operacao", ["COMPRA", "APORTE"])
      .order("data_operacao", { ascending: true }).limit(1),
  ]);
  if (posRes.error) { logError("Contexto pessoal: posições", posRes.error); return null; }
  const posicoes = (posRes.data ?? []) as unknown as PosRow[];
  if (!posicoes.some((p) => p.ativo_id === alvo.id)) return null; // sem posição ativa: nada a personalizar

  const custoBRL = await conversorCustoBRL(c, posicoes as unknown as PosicaoCusto[]);
  const metas = new Map<string, number>((metaRes.data ?? []).map((m) => [String(m.tipo_ativo), Number(m.percentual_ideal)]));
  const entradaOp = (opRes.data?.[0] as { data_operacao?: string } | undefined)?.data_operacao ?? null;
  return calcularContexto(
    alvo, posicoes, custoBRL, mapaUltimoMercado(histRes.data ?? []), metas,
    (perfRes.data?.inv_perfil ?? null) as never, hojeISO(), entradaOp,
  );
}

// ── IA ─────────────────────────────────────────────────────────────────

export const PERSONA_PESSOAL = `Você é um amigo que entende de dinheiro e fala com uma pessoa comum, que NUNCA estudou finanças. Você recebe (1) a análise do resultado de uma empresa ou fundo, que já foi feita, e (2) a situação PESSOAL dessa pessoa com esse investimento: perfil, quanto ela tem, há quanto tempo, e que peso isso tem na carteira dela. Explique, como no WhatsApp, o que a análise significa PARA ELA.
Regras:
- Use SOMENTE a análise e os dados pessoais fornecidos. Não invente números nem notícias.
- PROIBIDO jargão sem tradução. Frases curtas (até 15 palavras), voz ativa, sem siglas.
- Considere o perfil: para quem é conservador, um risco pesa mais; para quem é arrojado e está longe da aposentadoria, oscilações pesam menos. Considere o peso do ativo (concentração) e o tempo de casa (quem entrou há pouco ainda não viu um ciclo completo; quem está há anos já acumulou histórico).
- NUNCA recomende comprar, vender ou manter. Diga o que olhar e que pergunta a pessoa deve se fazer.
- "alinhamento": ADEQUADO = a situação combina com o perfil e não pede atenção especial; ATENCAO = há um ponto para acompanhar; REVISAR = vale a pessoa reavaliar com calma (ex.: peso alto num ativo com sinais ruins, ou risco incompatível com o perfil).
- Responda APENAS com um objeto JSON, sem texto fora dele:
{"alinhamento":"ADEQUADO|ATENCAO|REVISAR","resumo":"1 a 2 frases simples sobre o que isso significa para ela","pontos":["..."]}
- "pontos": NO MÁXIMO 3 itens de até 20 palavras (o que observar / que pergunta se fazer). Lista vazia é aceitável.`;

export function parsearAnalisePessoal(bruto: string): AnalisePessoal | null {
  const m = /\{[\s\S]*\}/.exec(String(bruto ?? ""));
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as Record<string, unknown>;
    const alinhamento = String(j.alinhamento ?? "").toUpperCase().replace("Ã", "A").replace("Ç", "C") as AlinhamentoPessoal;
    if (!["ADEQUADO", "ATENCAO", "REVISAR"].includes(alinhamento)) return null;
    const resumo = String(j.resumo ?? "").trim();
    if (!resumo) return null;
    const pontos = Array.isArray(j.pontos) ? j.pontos.map((x) => String(x).trim()).filter(Boolean).slice(0, 3) : [];
    return { alinhamento, resumo, pontos };
  } catch { return null; }
}

export interface AnaliseBase {
  veredito: string; resumo: string; pontos_fortes: unknown; pontos_atencao: unknown; inconsistencias: unknown; mudancas: string | null;
}

export async function gerarAnalisePessoal(
  cfg: ConfigIAAtiva, ctx: ContextoPessoal, base: AnaliseBase,
): Promise<AnalisePessoalSalva> {
  const pergunta =
    `--- ANÁLISE DO RESULTADO (já feita) ---\nVeredito: ${base.veredito}\nResumo: ${base.resumo}\n` +
    `Pontos fortes: ${JSON.stringify(base.pontos_fortes)}\nPontos de atenção: ${JSON.stringify(base.pontos_atencao)}\n` +
    `Inconsistências: ${JSON.stringify(base.inconsistencias)}\nO que mudou: ${base.mudancas ?? "—"}\n\n` +
    `--- SITUAÇÃO PESSOAL ---\n${textoContextoPessoal(ctx)}`;
  const bruto = await chamarProvedorIA(cfg.provedor, {
    apiKey: cfg.apiKey, persona: PERSONA_PESSOAL, modelo: cfg.modelo ?? undefined,
    mensagens: [{ role: "user", content: pergunta }], maxTokens: 700, buscaWeb: false,
  });
  const a = parsearAnalisePessoal(bruto);
  if (!a) throw new ErroIA("A IA devolveu uma resposta fora do formato esperado. Tente novamente.", 502);
  return { ...a, gerada_em: new Date().toISOString(), provedor: cfg.provedor, modelo: cfg.modelo ?? null, mentor_nome: cfg.nome ?? null };
}
