// supabase/functions/investimentos/shared.ts
// Tipos, constantes e helpers pequenos e puros compartilhados entre os
// módulos de investimentos (extraído de index.ts — ver ARCHITECTURE.md).
import { db, hojeBR } from "../_shared/utils.ts";

export type Db = ReturnType<typeof db>;

export const TIPOS_ATIVO = [
  "ACOES", "ETF", "FII", "REIT", "STOCKS",
  "ETF_INTERNACIONAL", "RENDA_FIXA", "CRIPTOMOEDAS", "TESOURO_DIRETO",
];
// Critérios das perguntas do questionário de avaliação. DIVIDENDOS é o id
// interno do critério "Geração de renda" (mantido por compatibilidade).
export const CRITERIOS_QUESTAO = ["FUNDAMENTOS", "CRESCIMENTO", "DIVIDENDOS", "VALUATION"];
// Pesos sugeridos por perfil (somam 100) — espelham FrontEnd/src/lib/constants.ts.
// Usados no prompt da IA quando o usuário não tem pesos globais salvos.
export const PESOS_SUGERIDOS_POR_PERFIL: Record<string, Record<string, number>> = {
  CONSERVADOR: { FUNDAMENTOS: 35, CRESCIMENTO: 10, DIVIDENDOS: 35, VALUATION: 20 },
  MODERADO:    { FUNDAMENTOS: 30, CRESCIMENTO: 25, DIVIDENDOS: 25, VALUATION: 20 },
  ARROJADO:    { FUNDAMENTOS: 25, CRESCIMENTO: 40, DIVIDENDOS: 10, VALUATION: 25 },
};
export const PESOS_PADRAO_CRITERIO = PESOS_SUGERIDOS_POR_PERFIL.MODERADO;
export const TIPO_ATIVO_LABEL_BR: Record<string, string> = {
  ACOES: "Ações (Brasil)", ETF: "ETF (Brasil)", FII: "Fundos Imobiliários (FII)",
  REIT: "REITs (fundos imobiliários dos EUA)", STOCKS: "Ações internacionais (Stocks)",
  ETF_INTERNACIONAL: "ETF Internacional", RENDA_FIXA: "Renda Fixa (CDB/LCI/LCA/CRI/CRA/Debênture)",
  CRIPTOMOEDAS: "Criptomoedas", TESOURO_DIRETO: "Tesouro Direto",
};
export const STATUS_POSICAO = ["ATIVA", "ENCERRADA"];
export const TIPOS_OPERACAO = ["COMPRA", "VENDA", "APORTE", "RESGATE", "DIVIDENDO", "RENDIMENTO"];
// Renda fixa / Tesouro Direto
export const SUBTIPOS_RF    = ["TESOURO", "CDB", "LCI", "LCA", "CRI", "CRA", "DEBENTURE", "OUTRO"];
export const INDEXADORES_RF = ["PREFIXADO", "POS_FIXADO", "HIBRIDO"];
export const INDICES_RF     = ["CDI", "SELIC", "IPCA", "IGPM"];
// Fundos imobiliários
export const CATEGORIAS_FII = ["TIJOLO", "PAPEL", "FOF", "DESENVOLVIMENTO", "OUTRO"];
// Ações
export const SUBTIPOS_ACOES = ["ON", "PN", "UNIT", "BDR"];

export async function contaExiste(c: Db, contaId: unknown): Promise<boolean> {
  if (!contaId) return false;
  const { data } = await c.from("contas").select("id").eq("id", contaId).maybeSingle();
  return !!data;
}

export async function ativoExiste(c: Db, ativoId: unknown): Promise<boolean> {
  if (!ativoId) return false;
  const { data } = await c.from("inv_ativos").select("id").eq("id", ativoId).maybeSingle();
  return !!data;
}

export const RE_MES_ANO = /^\d{4}-(0[1-9]|1[0-2])$/;

export const CDI_FALLBACK  = 0.105;  // % a.a. caso o BCB não responda
export const IPCA_FALLBACK = 0.045;

export function diasEntreISO(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
}
// Soma n dias a uma data YYYY-MM-DD.
export function addDiasISO(iso: string, n: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
}
// Periodicidade → dias do período de composição (default MENSAL=30).
export function periodoDiasComposicao(p: string | null | undefined): number {
  if (p === "DIARIA") return 1;
  if (p === "SEMANAL") return 7;
  return 30; // MENSAL / null
}

export function mesesEntre(ini: string, fim: string): string[] {
  const out: string[] = [];
  let [y, mo] = ini.split("-").map(Number);
  const [yf, mf] = fim.split("-").map(Number);
  let guard = 0;
  while ((y < yf || (y === yf && mo <= mf)) && guard++ < 1200) {
    out.push(`${y}-${String(mo).padStart(2, "0")}`);
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

// Usado por dataPagamentoPlausivel abaixo; também existe (duplicada, mesmo
// literal) em mercado.ts para as validações de data ali — mantido simples
// em vez de criar uma dependência cruzada por causa de uma regex de 1 linha.
const RE_DATA = /^\d{4}-\d{2}-\d{2}$/;

// Data plausível de pagamento/pagamento de provento: usada tanto pelo cron
// de dividendos (Polygon/B3) quanto pela importação de backup.
export function dataPagamentoPlausivel(iso: string): boolean {
  if (!RE_DATA.test(iso)) return false;
  const ano = Number(iso.slice(0, 4));
  return ano >= 2000 && ano <= new Date().getUTCFullYear() + 3;
}

// Delega pro helper canônico (achado de auditoria AUD-01) — mantém o nome
// `hojeISO` porque é usado em ~10 pontos do módulo de investimentos; só a
// implementação mudou, de UTC pra fuso de Brasília.
export function hojeISO(): string { return hojeBR(); }
export function deslocarDias(dataISO: string, n: number): string {
  const dt = new Date(`${dataISO}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export const recuarDias = (d: string, n: number) => deslocarDias(d, -n);
export const maiorData  = (a: string, b: string) => (a > b ? a : b);
export const menorData  = (a: string, b: string) => (a < b ? a : b);

// Insert em lote (chunk de 500) — usado por importação/restore de backup e
// pela reconciliação de dividendos, para não estourar limites do PostgREST.
export async function inserirEmLote(
  c: Db, tabela: string, rows: Record<string, unknown>[], retorno = "*", chunk = 500,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += chunk) {
    const fatia = rows.slice(i, i + chunk);
    // deno-lint-ignore no-explicit-any
    const { data, error } = await c.from(tabela).insert(fatia as any).select(retorno);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    if (data) out.push(...(data as unknown as Record<string, unknown>[]));
  }
  return out;
}
