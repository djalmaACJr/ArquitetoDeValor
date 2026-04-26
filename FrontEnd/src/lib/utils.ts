// src/lib/utils.ts

// ── Formatação de moeda — instância singleton (performance) ───────────────────
const _BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  minimumFractionDigits: 2,
})
export function formatBRL(value: number): string {
  return _BRL.format(value)
}

// ── Datas ─────────────────────────────────────────────────────────────────────
export function formatData(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

/**
 * Formata "YYYY-MM" como label de mês.
 * @param formato 'curto'  → "Abr/26"  (padrão, para gráficos/selects)
 *                'longo'  → "Abril/2026" (para cabeçalhos)
 *                'label'  → "Terça-feira, 14/04/2026" (para agrupamento de lista)
 */
export function mesLabel(
  mes: string,
  formato: 'curto' | 'longo' | 'label' = 'curto'
): string {
  const [yStr, mStr] = mes.split('-')
  const y = parseInt(yStr, 10)
  const m = parseInt(mStr, 10)

  if (Number.isNaN(y) || Number.isNaN(m)) return mes  // fallback seguro

  const date = new Date(y, m - 1, 1)

  if (formato === 'curto') {
    const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
    return `${nomes[m - 1]}/${String(y).slice(2)}`
  }
  if (formato === 'longo') {
    const nome = date.toLocaleDateString('pt-BR', { month: 'long' })
    return `${nome.charAt(0).toUpperCase()}${nome.slice(1)}/${y}`
  }
  // 'label' — para cabeçalho de grupo de data na lista de lançamentos
  const label = date.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

export function mesAtual(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function mesesDisponiveis(qtd = 12): string[] {
  const meses: string[] = []
  const d = new Date()
  for (let i = 0; i < qtd; i++) {
    meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    d.setMonth(d.getMonth() - 1)
  }
  return meses
}

export function clsx(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

// ── Grupos de conta ───────────────────────────────────────────────────────────
export type GrupoConta = {
  label: string
  tipos: string[]
  cor: string
}

export const GRUPOS_CONTA: GrupoConta[] = [
  { label: 'Corrente / Remunerada',     tipos: ['CORRENTE', 'REMUNERACAO'],  cor: '#00c896' },
  { label: 'Cartão de crédito',         tipos: ['CARTAO'],                   cor: '#ff6b4a' },
  { label: 'Investimento / Carteira',   tipos: ['INVESTIMENTO', 'CARTEIRA'], cor: '#00c896' },
]

export const CORES_CATEGORIA = [
  '#7F77DD', '#00c896', '#ff6b4a', '#f0b429', '#4da6ff', '#888780', '#D85A30', '#1D9E75',
]
