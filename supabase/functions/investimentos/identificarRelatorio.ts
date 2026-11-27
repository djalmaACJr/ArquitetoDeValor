// supabase/functions/investimentos/identificarRelatorio.ts
//
// Descobre DE QUEM é um PDF enviado à mão: procura nos ativos do usuário o ticker
// (ex.: "SNAG11") e o nome do fundo/empresa no texto extraído. Funções puras (sem
// rede/banco) — a rota só as chama e traduz o resultado em mensagens.

export interface AtivoCandidato { id: string; ticker: string; nome: string | null }

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const GENERICAS = new Set([
  "fundo", "investimento", "imobiliario", "fii", "fiagro", "responsabilidade", "limitada", "classe",
  "cotas", "unica", "de", "do", "da", "dos", "das", "e", "em", "ltda", "sa", "holding", "participacoes",
  "the", "inc", "corp", "corporation", "company", "group", "trust", "etf", "reit",
]);
const tokens = (s: string) => semAcento(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !GENERICAS.has(t));

const contar = (haystack: string, palavra: string): number => {
  let n = 0, i = 0;
  const ehAlnum = (ch: string | undefined) => !!ch && /[a-z0-9]/.test(ch);
  while ((i = haystack.indexOf(palavra, i)) !== -1) {
    if (!ehAlnum(haystack[i - 1]) && !ehAlnum(haystack[i + palavra.length])) n++;
    i += palavra.length;
  }
  return n;
};

/** Pontuação do ativo no texto: ticker (peso maior, bônus no início do documento) + nome. */
export function pontuarAtivo(texto: string, ativo: AtivoCandidato): number {
  const t = semAcento(texto);
  const inicio = t.slice(0, 3000);
  const ticker = semAcento(ativo.ticker).replace(/[^a-z0-9]/g, "");
  let pontos = 0;
  if (ticker.length >= 3) {
    pontos += Math.min(contar(t.replace(/[.\-]/g, ""), ticker), 10) * 3;
    if (contar(inicio.replace(/[.\-]/g, ""), ticker) > 0) pontos += 3;
  }
  const toks = ativo.nome ? tokens(ativo.nome) : [];
  const nomeCasa = toks.length >= 2 ? toks.every((k) => contar(t, k) > 0) : (toks[0]?.length ?? 0) >= 5 && contar(t, toks[0]) >= 2;
  if (nomeCasa) pontos += 5;
  return pontos;
}

export type ResultadoIdentificacao =
  | { tipo: "ok"; ativo: AtivoCandidato }
  | { tipo: "nenhum" }
  | { tipo: "ambiguo"; candidatos: AtivoCandidato[] };

/** Sem ativo escolhido: o vencedor tem de ter pontuação ≥ 2× a do segundo. */
export function identificarAtivo(texto: string, ativos: AtivoCandidato[]): ResultadoIdentificacao {
  const ranking = ativos.map((a) => ({ a, p: pontuarAtivo(texto, a) })).filter((x) => x.p > 0).sort((x, y) => y.p - x.p);
  if (ranking.length === 0) return { tipo: "nenhum" };
  if (ranking.length === 1 || ranking[0].p >= ranking[1].p * 2) return { tipo: "ok", ativo: ranking[0].a };
  return { tipo: "ambiguo", candidatos: ranking.slice(0, 4).map((x) => x.a) };
}

/** Com ativo escolhido: confere que o PDF é dele (aparece e não é claramente de outro). */
export function validarAtivo(texto: string, escolhido: AtivoCandidato, ativos: AtivoCandidato[]):
  | { ok: true } | { ok: false; motivo: "ausente" } | { ok: false; motivo: "outro"; outro: AtivoCandidato } {
  const p = pontuarAtivo(texto, escolhido);
  if (p === 0) return { ok: false, motivo: "ausente" };
  const melhor = ativos.filter((a) => a.id !== escolhido.id)
    .map((a) => ({ a, p: pontuarAtivo(texto, a) })).sort((x, y) => y.p - x.p)[0];
  if (melhor && melhor.p >= p * 2) return { ok: false, motivo: "outro", outro: melhor.a };
  return { ok: true };
}

const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Competência (YYYY-MM-01) pela 1ª data/mês que aparece no início do PDF; null se não achar. */
export function detectarCompetencia(texto: string, anoMax = new Date().getFullYear() + 1): string | null {
  const t = semAcento(texto).slice(0, 2500);
  const valido = (ano: number, mes: number) => ano >= 2015 && ano <= anoMax && mes >= 1 && mes <= 12;
  const achados: { pos: number; ano: number; mes: number }[] = [];
  for (const m of t.matchAll(/\b(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s*(?:de|\/|-)?\s*(20\d{2})\b/g)) {
    achados.push({ pos: m.index ?? 0, ano: Number(m[2]), mes: MESES.indexOf(m[1]) + 1 });
  }
  for (const m of t.matchAll(/(?<![\d/])(?:\d{1,2}\/)?(0?[1-9]|1[0-2])\/(20\d{2})\b/g)) {
    achados.push({ pos: m.index ?? 0, ano: Number(m[2]), mes: Number(m[1]) });
  }
  const a = achados.filter((x) => valido(x.ano, x.mes)).sort((x, y) => x.pos - y.pos)[0];
  return a ? `${a.ano}-${String(a.mes).padStart(2, "0")}-01` : null;
}
