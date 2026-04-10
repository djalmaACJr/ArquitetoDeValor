export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(value)
}

export function formatData(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y.slice(2)}`
}

export function mesLabel(mes: string): string {
  const [y, m] = mes.split('-')
  const nomes = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']
  return `${nomes[parseInt(m) - 1]}/${y.slice(2)}`
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

// Agrupar contas por tipo
export type GrupoConta = {
  label: string
  tipos: string[]
  cor: string
}

export const GRUPOS_CONTA: GrupoConta[] = [
  { label: 'Corrente / Remunerada', tipos: ['CORRENTE', 'REMUNERACAO'], cor: '#00c896' },
  { label: 'Cartão de crédito',     tipos: ['CARTAO'],                  cor: '#ff6b4a' },
  { label: 'Investimento / Carteira', tipos: ['INVESTIMENTO', 'CARTEIRA'], cor: '#00c896' },
]

export const CORES_CATEGORIA = [
  '#7F77DD', '#00c896', '#ff6b4a', '#f0b429', '#4da6ff', '#888780', '#D85A30', '#1D9E75',
]
