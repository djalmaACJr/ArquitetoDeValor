// supabase/functions/investimentos/fundamentosAcao.ts
//
// Cálculo PURO (sem rede, sem banco) dos fundamentos de uma ação a partir das
// linhas dos CSVs da CVM (DFP/ITR/composição de capital) — v7.8.0.
//
// Corrige o cálculo anterior de LPA/VPA/Valor Justo, que errava por ordens de
// grandeza (auditoria nov/2026, dados reais da CVM):
//   1) `VL_CONTA` vem em MIL em ~98% das linhas (coluna ESCALA_MOEDA) e era
//      usado sem multiplicar por 1000 → LPA/VPA/Graham ~1000× menores
//      (PETR4 dava R$ 0,08);
//   2) usava o lucro/PL CONSOLIDADOS (inclui minoritários) em vez do atribuído
//      aos controladores — distorce quem tem muito minoritário (Vale, bancos);
//   3) o plano de contas dos BANCOS é outro (lucro = 3.09, PL ≠ 2.03; a 2.03
//      deles é "Passivos Financeiros") — código fixo zerava ITUB4 etc.;
//   4) usava só o exercício anual fechado (até ~9 meses defasado); agora usa os
//      últimos 12 meses (DFP − ITR do ano anterior + ITR atual) quando há ITR;
//   5) as ações não descontavam a tesouraria.
// As contas são localizadas pela DESCRIÇÃO (DS_CONTA) + profundidade do código,
// não por um código fixo.
import type { LinhaCsv } from "./cvm.ts";

export interface ValorPeriodo { valor: number; ini: string; fim: string }

export interface FundamentosCalculados {
  lpa: number; vpa: number; valorJusto: number | null;
  referencia: string;        // data-base (fim do último trimestre/exercício usado)
  ltm: boolean;              // true = lucro dos últimos 12 meses; false = exercício anual
}

// ── Utilidades ─────────────────────────────────────────────────────────

// Valor da conta em reais (a CVM declara a escala por linha).
export function valorReais(l: LinhaCsv): number {
  const v = Number(l.VL_CONTA);
  if (!Number.isFinite(v)) return NaN;
  return (l.ESCALA_MOEDA ?? "").trim().toUpperCase() === "MIL" ? v * 1000 : v;
}

// Fórmula de Graham: raiz(22,5 × LPA × VPA). null se LPA/VPA <= 0.
export function calcularValorJustoGraham(lpa: number | null | undefined, vpa: number | null | undefined): number | null {
  if (typeof lpa !== "number" || typeof vpa !== "number" || !(lpa > 0) || !(vpa > 0)) return null;
  return Math.sqrt(22.5 * lpa * vpa);
}

// Units (TAEE11, KLBN11, SANB11…) são cestas de ações de classes diferentes
// (ex.: 1 ON + 2 PN); LPA/VPA "por ação" não vale por unit e a proporção varia
// por papel. Não calculamos (o usuário pode informar LPA/VPA à mão).
export function ehUnit(ticker: string, subtipo?: string | null): boolean {
  return subtipo === "UNIT" || /11$/.test(ticker.trim().toUpperCase());
}

const ehControladora = (ds: string) => /controlador/i.test(ds) && !/n[ãa]o\s*controlador/i.test(ds);
const ehNaoControladora = (ds: string) => /n[ãa]o\s*controlador/i.test(ds);

// Escolhe, entre linhas candidatas da MESMA conta, a de data-base mais recente
// (empate: maior VERSAO = retificação) e, nela, o período mais longo (menor
// DT_INI_EXERC) — o acumulado do ano, não o trimestre isolado.
function melhorLinha(c: LinhaCsv[]): LinhaCsv | null {
  let best: LinhaCsv | null = null;
  for (const l of c) {
    if (!best) { best = l; continue; }
    const fim = l.DT_FIM_EXERC ?? "", bFim = best.DT_FIM_EXERC ?? "";
    if (fim > bFim) { best = l; continue; }
    if (fim < bFim) continue;
    const ini = l.DT_INI_EXERC ?? "", bIni = best.DT_INI_EXERC ?? "";
    if (ini < bIni) { best = l; continue; }
    if (ini === bIni && (Number(l.VERSAO) || 0) > (Number(best.VERSAO) || 0)) best = l;
  }
  return best;
}

function comoPeriodo(l: LinhaCsv | null): ValorPeriodo | null {
  if (!l) return null;
  const valor = valorReais(l);
  return Number.isFinite(valor) ? { valor, ini: l.DT_INI_EXERC ?? "", fim: l.DT_FIM_EXERC ?? "" } : null;
}

// ── Lucro atribuído aos controladores (DRE) ────────────────────────────
// Conta de 3º nível 3.xx.01 "Atribuído a Sócios da Empresa Controladora".
// Empresas: 3.11.01; bancos: 3.09.01. `ordem` = "ÚLTIMO" | "PENÚLTIMO".
export function lucroControladores(dre: LinhaCsv[], ordem: "ÚLTIMO" | "PENÚLTIMO"): ValorPeriodo | null {
  const cand = dre.filter((l) =>
    (l.ORDEM_EXERC ?? "").trim() === ordem && /^3\.\d{2}\.\d{2}$/.test(l.CD_CONTA ?? "") &&
    ehControladora(l.DS_CONTA ?? "") && /\.01$/.test(l.CD_CONTA));
  return comoPeriodo(melhorLinha(cand));
}

// Fallback: lucro consolidado total (linha "Lucro/Prejuízo Consolidado do Período"),
// quando a companhia não abre a conta dos controladores.
export function lucroConsolidado(dre: LinhaCsv[], ordem: "ÚLTIMO" | "PENÚLTIMO"): ValorPeriodo | null {
  const cand = dre.filter((l) =>
    (l.ORDEM_EXERC ?? "").trim() === ordem && /^3\.\d{2}$/.test(l.CD_CONTA ?? "") &&
    /Lucro\/?\s*Preju[íi]zo\s+(Consolidado\s+)?do\s+Per[íi]odo/i.test(l.DS_CONTA ?? ""));
  return comoPeriodo(melhorLinha(cand));
}

export function lucroAtribuivel(dre: LinhaCsv[], ordem: "ÚLTIMO" | "PENÚLTIMO"): ValorPeriodo | null {
  return lucroControladores(dre, ordem) ?? lucroConsolidado(dre, ordem);
}

// ── Patrimônio líquido dos controladores (BPP) ─────────────────────────
// PL total: conta de 2º nível cuja descrição começa com "Patrimônio Líquido"
// (2.03 nas empresas; 2.07/2.08 nos bancos). Menos a participação de não
// controladores (conta filha, 3º nível). Usa sempre a data-base mais recente.
export function patrimonioControladores(bpp: LinhaCsv[]): ValorPeriodo | null {
  const ultimo = bpp.filter((l) => (l.ORDEM_EXERC ?? "").trim() === "ÚLTIMO");
  const totais = ultimo.filter((l) => /^2\.\d{2}$/.test(l.CD_CONTA ?? "") && /^Patrim[ôo]nio\s+L[íi]quido/i.test(l.DS_CONTA ?? ""));
  const total = melhorLinha(totais);
  if (!total) return null;
  const vTotal = valorReais(total);
  if (!Number.isFinite(vTotal)) return null;
  const nc = melhorLinha(ultimo.filter((l) =>
    (l.CD_CONTA ?? "").startsWith(`${total.CD_CONTA}.`) && /^2\.\d{2}\.\d{2}$/.test(l.CD_CONTA) &&
    ehNaoControladora(l.DS_CONTA ?? "") && l.DT_FIM_EXERC === total.DT_FIM_EXERC));
  const vNc = nc ? valorReais(nc) : 0;
  return { valor: vTotal - (Number.isFinite(vNc) ? vNc : 0), ini: total.DT_INI_EXERC ?? "", fim: total.DT_FIM_EXERC ?? "" };
}

// ── Ações líquidas de tesouraria ───────────────────────────────────────
// `QT_ACAO_*` da composição de capital vem em MILHARES para várias empresas
// (Vale 4.255.762; Itaú 11.026.869) e em unidades para outras (BB 5.730.834.040)
// — sem coluna de escala. Por isso só usamos a FRAÇÃO em tesouraria (invariante
// à escala) sobre o total de ações do FRE (sempre em unidades).
export function acoesLiquidas(totalFre: number | undefined, comp: LinhaCsv | undefined): number | null {
  if (!totalFre || !(totalFre > 0)) return null;
  const integr = Number(comp?.QT_ACAO_TOTAL_CAP_INTEGR), teso = Number(comp?.QT_ACAO_TOTAL_TESOURO);
  const fracao = Number.isFinite(integr) && integr > 0 && Number.isFinite(teso) && teso >= 0 && teso < integr ? teso / integr : 0;
  return totalFre * (1 - fracao);
}

// ── Composição final ───────────────────────────────────────────────────
// Lucro dos últimos 12 meses = DFP (último exercício) − ITR (mesmo acumulado do
// ano anterior) + ITR (acumulado do ano corrente). Só vale quando o ITR começa
// logo depois do exercício da DFP; senão usa o exercício anual.
export function lucroLtm(dfpDre: LinhaCsv[], itrDre: LinhaCsv[]): { valor: number; fim: string; ltm: boolean } | null {
  const anual = lucroAtribuivel(dfpDre, "ÚLTIMO");
  const atual = lucroAtribuivel(itrDre, "ÚLTIMO");
  const anterior = lucroAtribuivel(itrDre, "PENÚLTIMO");
  if (anual && atual && anterior && proximoDia(anual.fim) === atual.ini && atual.fim > anual.fim) {
    return { valor: anual.valor - anterior.valor + atual.valor, fim: atual.fim, ltm: true };
  }
  if (anual) return { valor: anual.valor, fim: anual.fim, ltm: false };
  return null;
}

function proximoDia(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function calcularFundamentos(
  p: { dfpDre: LinhaCsv[]; itrDre: LinhaCsv[]; bppItr: LinhaCsv[]; bppDfp: LinhaCsv[]; acoes: number | null },
): FundamentosCalculados | null {
  if (!p.acoes || !(p.acoes > 0)) return null;
  const lucro = lucroLtm(p.dfpDre, p.itrDre);
  const pl = patrimonioControladores(p.bppItr) ?? patrimonioControladores(p.bppDfp);
  if (!lucro || !pl) return null;
  const lpa = lucro.valor / p.acoes, vpa = pl.valor / p.acoes;
  if (!Number.isFinite(lpa) || !Number.isFinite(vpa)) return null;
  return {
    lpa, vpa, valorJusto: calcularValorJustoGraham(lpa, vpa),
    referencia: pl.fim > lucro.fim ? pl.fim : lucro.fim, ltm: lucro.ltm,
  };
}
