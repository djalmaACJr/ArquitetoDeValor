// Correção de valores pelo IPCA (série mensal de `useIndicesEconomicos`) —
// leva um valor de qualquer mês passado para "reais da última competência
// publicada", pra comparar períodos distantes sem a distorção da inflação.
// Funções puras (sem JSX/hooks).

export interface PontoIpca { competencia: string; valor: number } // valor = % no mês

export interface CorretorIpca {
  /** Há série suficiente pra corrigir algo. */
  disponivel: boolean
  /** Competência ('YYYY-MM') pra cujos preços os valores são levados. */
  refCompetencia: string | null
  /** Mês mais antigo que o corretor consegue corrigir. */
  primeiraCompetencia: string | null
  /** `true` se o mês tem cobertura de IPCA (meses anteriores à série não têm). */
  cobre: (mes: string) => boolean
  /** Fator multiplicador mês → preços de `refCompetencia` (1 se fora da série). */
  fator: (mes: string) => number
}

function proximoMes(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}

function mesAnterior(mes: string): string {
  const [y, m] = mes.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

export function criarCorretorIpca(serie: PontoIpca[]): CorretorIpca {
  if (serie.length === 0) {
    return {
      disponivel: false, refCompetencia: null, primeiraCompetencia: null,
      cobre: () => false, fator: () => 1,
    }
  }
  const ordenada = [...serie].sort((a, b) => a.competencia.localeCompare(b.competencia))
  const taxa = new Map(ordenada.map(p => [p.competencia, p.valor]))
  const primeira = ordenada[0].competencia
  const ref = ordenada[ordenada.length - 1].competencia

  // Índice acumulado: o mês anterior à 1ª competência é a base (1.0). Um valor
  // lançado no mês m só sofre a inflação de m+1 em diante, então o índice de m
  // é "o acumulado até m" e fator(m) = idx[ref] / idx[m].
  const base = mesAnterior(primeira)
  const idx = new Map<string, number>([[base, 1]])
  let mes = base
  while (mes < ref) {
    const prox = proximoMes(mes)
    idx.set(prox, idx.get(mes)! * (1 + (taxa.get(prox) ?? 0) / 100))   // mês sem dado: 0%
    mes = prox
  }
  const idxRef = idx.get(ref)!

  return {
    disponivel: true,
    refCompetencia: ref,
    primeiraCompetencia: base,
    cobre: (m) => m >= base,
    fator: (m) => {
      if (m >= ref) return 1                  // mês ainda sem IPCA publicado: não corrige
      const i = idx.get(m)
      return i === undefined ? 1 : idxRef / i
    },
  }
}
