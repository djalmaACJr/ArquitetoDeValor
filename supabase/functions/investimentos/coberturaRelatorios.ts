// supabase/functions/investimentos/coberturaRelatorios.ts
//
// Qual relatório se espera de cada tipo de ativo num dado mês — cada tipo tem a sua
// periodicidade (funções puras, sem rede/banco):
//   FII          MENSAL      relatório gerencial da competência M, divulgado até ~dia 15 de M+1;
//   ACOES        TRIMESTRAL  ITR (3T) / DFP (anual): prazo de ~45 dias após o trimestre, ~90 no ano;
//   STOCKS/REIT  TRIMESTRAL  10-Q (Q1–Q3) / 10-K (Q4): ~45 dias após o trimestre, ~75 no ano.
// Tipos sem relatório periódico (renda fixa, tesouro, cripto…) nem entram: `periodoEsperado` → null.

export type Periodicidade = "MENSAL" | "TRIMESTRAL";

export interface PeriodoEsperado {
  periodicidade: Periodicidade;
  /** Janela [de, ate) em que a data de referência do relatório deve cair. */
  de: string;
  ate: string;
  /** "10/2026" (FII) ou "3T26" (trimestral). */
  rotulo: string;
  /** false = o prazo de divulgação ainda não venceu (não conta como "faltando"). */
  devido: boolean;
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dia = (a: number, m: number, d: number) => new Date(Date.UTC(a, m - 1, d));
const somarDias = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

const FIM_TRIMESTRE: [number, number][] = [[3, 31], [6, 30], [9, 30], [12, 31]];

/** `mes` = "AAAA-MM"; `hoje` = "AAAA-MM-DD" (fuso de São Paulo, vindo de hojeISO()). */
export function periodoEsperado(tipo: string, mes: string, hoje: string): PeriodoEsperado | null {
  const [ano, mm] = mes.split("-").map(Number);
  const inicioMes = dia(ano, mm, 1);
  const fimMes = dia(ano, mm + 1, 1); // exclusivo

  if (tipo === "FII") {
    return {
      periodicidade: "MENSAL", de: iso(inicioMes), ate: iso(fimMes), rotulo: `${pad(mm)}/${ano}`,
      devido: hoje >= iso(dia(ano, mm + 1, 15)),
    };
  }
  if (tipo === "ACOES" || tipo === "STOCKS" || tipo === "REIT") {
    const prazoAnual = tipo === "ACOES" ? 90 : 75;
    // referência: o fim do mês pedido, ou hoje se o mês ainda não acabou
    const ref = iso(somarDias(fimMes, -1)) < hoje ? iso(somarDias(fimMes, -1)) : hoje;
    let escolhido: { q: Date; n: number } | null = null;
    for (let a = ano; a >= ano - 2 && !escolhido; a--) {
      for (let i = 3; i >= 0; i--) {
        const q = dia(a, FIM_TRIMESTRE[i][0], FIM_TRIMESTRE[i][1]);
        const prazo = iso(somarDias(q, i === 3 ? prazoAnual : 45));
        if (prazo <= ref) { escolhido = { q, n: i + 1 }; break; }
      }
    }
    if (!escolhido) return null;
    return {
      periodicidade: "TRIMESTRAL", de: iso(somarDias(escolhido.q, -7)), ate: iso(fimMes),
      rotulo: `${escolhido.n}T${String(escolhido.q.getUTCFullYear()).slice(2)}`, devido: true,
    };
  }
  return null;
}
