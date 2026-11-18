// supabase/functions/investimentos/textoResultados.ts
//
// Funções PURAS (sem rede/banco) que preparam o texto que a IA vai analisar (v7.8.0):
//   • EDGAR (stocks/REITs dos EUA): HTML do 10-Q/10-K → texto limpo → seção MD&A;
//   • CVM (ações BR): linhas de DRE/BPP do ITR/DFP → resumo numérico comparativo.
import type { LinhaCsv } from "./cvm.ts";
import { valorReais } from "./fundamentosAcao.ts";

// ── EDGAR ──────────────────────────────────────────────────────────────

const ENTIDADES: Record<string, string> = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"', mdash: "—", ndash: "–", hellip: "…", bull: "•",
};

export function htmlParaTexto(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|tr|li|h[1-6]|table)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/[ \t ]+/g, " ")
    .replace(/(\s*\|\s*)+\n/g, "\n")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Seção "Management's Discussion and Analysis" (onde a empresa explica o resultado).
// O título aparece também no índice do documento: escolhemos a ocorrência com a
// MAIOR distância até o próximo item (a seção real, não a linha do sumário).
export function extrairMdna(texto: string, form: string, max = 45_000): string {
  const dez = /^10-K/i.test(form);
  const inicio = dez
    ? /Item\s*7\s*[.:–-]?[\s|]*Management.s\s+Discussion\s+and\s+Analysis/gi
    : /Item\s*2\s*[.:–-]?[\s|]*Management.s\s+Discussion\s+and\s+Analysis/gi;
  const fim = dez ? /Item\s*7A\s*[.:–-]?[\s|]*Quantitative/gi : /Item\s*3\s*[.:–-]?[\s|]*Quantitative/gi;
  const fins = [...texto.matchAll(fim)].map((m) => m.index!);
  let melhor: { ini: number; tam: number } | null = null;
  for (const m of texto.matchAll(inicio)) {
    const ini = m.index!;
    const prox = fins.find((f) => f > ini + 30) ?? Math.min(texto.length, ini + max);
    if (!melhor || prox - ini > melhor.tam) melhor = { ini, tam: prox - ini };
  }
  if (melhor && melhor.tam > 1500) return texto.slice(melhor.ini, melhor.ini + Math.min(melhor.tam, max));
  // Fallback: última ocorrência genérica do título; senão, o começo do documento.
  const gen = [...texto.matchAll(/Management.s\s+Discussion\s+and\s+Analysis/gi)].map((m) => m.index!);
  const i = gen.length > 0 ? gen[gen.length - 1] : 0;
  return texto.slice(i, i + max);
}

// ── CVM ────────────────────────────────────────────────────────────────

export interface ResumoCvm { tipo: "ITR" | "DFP"; fim: string; texto: string }

const fmtMilhoes = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return "n/d";
  const m = Math.round(v / 1e6);
  return String(m).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
};

const ehControladora = (ds: string) => /controlador/i.test(ds) && !/n[ãa]o\s*controlador/i.test(ds);

function dataBr(iso: string): string { return iso.split("-").reverse().join("/"); }

interface Periodo { ini: string; fim: string }

// Conjunto de linhas de uma demonstração em um período: ordem + (fim) + (início).
function colunas(linhas: LinhaCsv[], ordem: "ÚLTIMO" | "PENÚLTIMO", fim: string): { ytd: Periodo | null; tri: Periodo | null } {
  const d = linhas.filter((l) => (l.ORDEM_EXERC ?? "").trim() === ordem && l.DT_FIM_EXERC === fim);
  if (d.length === 0) return { ytd: null, tri: null };
  const inis = [...new Set(d.map((l) => l.DT_INI_EXERC))].sort();
  const ytd = { ini: inis[0], fim };
  const tri = inis.length > 1 ? { ini: inis[inis.length - 1], fim } : null;
  return { ytd, tri };
}

function valorDe(linhas: LinhaCsv[], cd: string, ordem: "ÚLTIMO" | "PENÚLTIMO", fim: string, ini?: string): number | null {
  let best: LinhaCsv | null = null;
  for (const l of linhas) {
    if (l.CD_CONTA !== cd || (l.ORDEM_EXERC ?? "").trim() !== ordem || l.DT_FIM_EXERC !== fim || (ini !== undefined && l.DT_INI_EXERC !== ini)) continue;
    if (!best || (Number(l.VERSAO) || 0) > (Number(best.VERSAO) || 0)) best = l;
  }
  if (!best) return null;
  const v = valorReais(best);
  return Number.isFinite(v) ? v : null;
}

const maxFim = (linhas: LinhaCsv[]): string =>
  linhas.filter((l) => (l.ORDEM_EXERC ?? "").trim() === "ÚLTIMO").reduce((m, l) => (l.DT_FIM_EXERC > m ? l.DT_FIM_EXERC : m), "");

// Resumo para a IA: DRE (trimestre e acumulado do ano × mesmos períodos do ano
// anterior) e balanço (data-base × 31/12 anterior), em R$ milhões. Usa o ITR mais
// recente; se a DFP for mais nova, resume o exercício anual.
export function resumirDemonstracoes(
  p: { nome: string; ticker: string; dfpDre: LinhaCsv[]; itrDre: LinhaCsv[]; bppItr: LinhaCsv[]; bppDfp: LinhaCsv[] },
): ResumoCvm | null {
  const fimItr = maxFim(p.itrDre), fimDfp = maxFim(p.dfpDre);
  const usaItr = fimItr !== "" && fimItr > fimDfp;
  const dre = usaItr ? p.itrDre : p.dfpDre;
  const bpp = usaItr ? p.bppItr : p.bppDfp;
  const fim = usaItr ? fimItr : fimDfp;
  if (!fim || dre.length === 0) return null;

  const atual = colunas(dre, "ÚLTIMO", fim);
  const anterior = colunas(dre, "PENÚLTIMO", dre.filter((l) => l.ORDEM_EXERC === "PENÚLTIMO").reduce((m, l) => (l.DT_FIM_EXERC > m ? l.DT_FIM_EXERC : m), ""));
  if (!atual.ytd) return null;

  // Contas: nível 2 (3.01, 3.03, 3.05…) + a linha do lucro atribuído aos controladores.
  const contas = new Map<string, string>();
  for (const l of dre) {
    if ((l.ORDEM_EXERC ?? "").trim() !== "ÚLTIMO" || l.DT_FIM_EXERC !== fim) continue;
    const cd = l.CD_CONTA ?? "";
    if (/por\s+A[çc][ãa]o/i.test(l.DS_CONTA ?? "")) continue; // lucro por ação não é valor em milhões
    if (/^3\.\d{2}$/.test(cd) || (/^3\.\d{2}\.01$/.test(cd) && ehControladora(l.DS_CONTA ?? ""))) contas.set(cd, (l.DS_CONTA ?? "").trim());
  }
  const ordenadas = [...contas.entries()].sort(([a], [b]) => a.localeCompare(b));

  const cab = usaItr
    ? `Demonstração do Resultado (ITR) — ${atual.tri ? `trimestre ${dataBr(atual.tri.ini)} a ${dataBr(fim)}; ` : ""}acumulado do ano ${dataBr(atual.ytd.ini)} a ${dataBr(fim)}`
    : `Demonstração do Resultado do exercício (DFP) ${dataBr(atual.ytd.ini)} a ${dataBr(fim)}`;
  const linhasDre = ordenadas.map(([cd, ds]) => {
    const partes: string[] = [];
    if (usaItr && atual.tri) {
      partes.push(`trimestre ${fmtMilhoes(valorDe(dre, cd, "ÚLTIMO", fim, atual.tri.ini))}`);
      if (anterior.tri) partes.push(`mesmo trimestre do ano anterior ${fmtMilhoes(valorDe(dre, cd, "PENÚLTIMO", anterior.tri.fim, anterior.tri.ini))}`);
    }
    partes.push(`${usaItr ? "acumulado do ano" : "exercício"} ${fmtMilhoes(valorDe(dre, cd, "ÚLTIMO", fim, atual.ytd!.ini))}`);
    if (anterior.ytd) partes.push(`${usaItr ? "acumulado do ano anterior" : "exercício anterior"} ${fmtMilhoes(valorDe(dre, cd, "PENÚLTIMO", anterior.ytd.fim, anterior.ytd.ini))}`);
    return `- ${ds}: ${partes.join(" | ")}`;
  });

  // Balanço: contas de nível 2 + empréstimos/financiamentos (nível 3), data-base × data anterior.
  const fimBpp = maxFim(bpp);
  const penBpp = bpp.filter((l) => l.ORDEM_EXERC === "PENÚLTIMO").reduce((m, l) => (l.DT_FIM_EXERC > m ? l.DT_FIM_EXERC : m), "");
  const linhasBpp: string[] = [];
  if (fimBpp) {
    const vistos = new Set<string>();
    for (const l of bpp) {
      if ((l.ORDEM_EXERC ?? "").trim() !== "ÚLTIMO" || l.DT_FIM_EXERC !== fimBpp) continue;
      const cd = l.CD_CONTA ?? "", ds = (l.DS_CONTA ?? "").trim();
      const relevante = /^2\.\d{2}$/.test(cd) || (/^2\.\d{2}\.\d{2}$/.test(cd) && /Empr[ée]stimos|Financiamentos|Deb[êe]ntures/i.test(ds));
      if (!relevante || vistos.has(cd)) continue;
      vistos.add(cd);
      const vA = valorDe(bpp, cd, "ÚLTIMO", fimBpp), vP = penBpp ? valorDe(bpp, cd, "PENÚLTIMO", penBpp) : null;
      linhasBpp.push(`- ${ds}: ${fmtMilhoes(vA)}${vP != null ? ` (em ${dataBr(penBpp)}: ${fmtMilhoes(vP)})` : ""}`);
    }
  }

  const texto = [
    `Empresa: ${p.nome} (${p.ticker}). Valores em R$ milhões. Fonte: ${usaItr ? "ITR" : "DFP"} (dados abertos da CVM).`,
    "", cab, ...linhasDre,
    ...(linhasBpp.length > 0 ? ["", `Balanço patrimonial (passivo e patrimônio líquido) em ${dataBr(fimBpp)}`, ...linhasBpp] : []),
  ].join("\n").slice(0, 9000);
  return { tipo: usaItr ? "ITR" : "DFP", fim, texto };
}

export function rotuloPeriodoCvm(r: ResumoCvm): string {
  const [a, m] = r.fim.split("-");
  return r.tipo === "DFP" ? `exercício de ${a}` : `${Math.ceil(Number(m) / 3)}º trimestre de ${a}`;
}
