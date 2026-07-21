// Plugin e helpers compartilhados pelas roscas de composição da carteira
// (Ativos na Carteira, Ações por segmento, FIIs por categoria, Resumo por
// instituição) — mesmo visual em todas: rótulo + % dentro da fatia (ou fora,
// com linha-guia, quando não cabe) e total no buraco central.
import type { Plugin, ChartData } from 'chart.js'

export const MUTED_ROSCA = '#8b92a8'

export const PALETA_ROSCA = [
  '#3b82f6', '#00c896', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#f97316', '#14b8a6', '#a3e635', '#ef4444',
]

// Mistura uma cor hex com branco para um tom pastel mais suave (mix=0..1)
export function suavizar(hex: string, mix = 0.35): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  const m = (c: number) => Math.round(c + (255 - c) * mix)
  return `rgb(${m(r)}, ${m(g)}, ${m(b)})`
}

// Campos custom que o plugin lê do dataset (texto do buraco central). Ficam
// no dataset porque o react-chartjs-2 reaplica o `data` a cada update — assim
// o plugin nunca usa valores presos num closure antigo (causa de legendas
// erradas ao voltar à página, quando o cache do React Query reaplica dados).
export type DatasetRosca = { data: number[]; backgroundColor: string[]; centroLabel?: string; centroValor?: string }

export function roscaData(
  fatias: { label: string; valor: number }[], centro: string, centroValorTxt: string,
): ChartData<'doughnut', number[], string> {
  const cores = fatias.map((_, i) => suavizar(PALETA_ROSCA[i % PALETA_ROSCA.length]))
  return {
    labels: fatias.map((f) => f.label),
    datasets: [{
      data: fatias.map((f) => f.valor),
      backgroundColor: cores,
      borderColor: 'rgba(14,21,37,0.55)',
      borderWidth: 2,
      borderRadius: 8,
      hoverOffset: 6,
      centroLabel: centro,
      centroValor: centroValorTxt,
    }],
  } as unknown as ChartData<'doughnut', number[], string>
}

// Rótulos (nome + %) dentro de cada fatia + total no centro. Quando o rótulo
// não cabe dentro do arco, é desenhado fora com uma linha apontando a fatia.
// Lê tudo do `chart` (sempre atual); por isso é estável em escopo de módulo.
export const rotulosRosca: Plugin<'doughnut'> = {
  id: 'rotulosRosca',
  afterDatasetsDraw(chart) {
    const { ctx } = chart
    const meta = chart.getDatasetMeta(0)
    const ds = chart.data.datasets[0] as unknown as DatasetRosca
    const labels = (chart.data.labels ?? []) as string[]
    const soma = ds.data.reduce((s, v) => s + Number(v), 0)
    ctx.save()
    ctx.textBaseline = 'middle'
    meta.data.forEach((arc, i) => {
      const pct = soma > 0 ? (Number(ds.data[i]) / soma) * 100 : 0
      if (pct <= 0) return
      const a = arc as unknown as {
        x: number; y: number; startAngle: number; endAngle: number
        innerRadius: number; outerRadius: number
        tooltipPosition: () => { x: number; y: number }
      }
      const label = String(labels[i] ?? '')
      const pctTxt = `${pct.toFixed(1).replace('.', ',')}%`

      // Cabe dentro? compara a largura do texto com o comprimento do arco
      // na faixa central onde o rótulo seria desenhado.
      const labelRadius = (a.innerRadius + a.outerRadius) / 2
      const arcLen = (a.endAngle - a.startAngle) * labelRadius
      ctx.font = '600 10px system-ui, sans-serif'
      const cabe = ctx.measureText(label).width <= arcLen - 4

      if (cabe) {
        const pos = a.tooltipPosition()
        ctx.textAlign = 'center'
        ctx.fillStyle = '#0e1525'
        ctx.font = '600 10px system-ui, sans-serif'
        ctx.fillText(label, pos.x, pos.y - 6)
        ctx.font = '700 12px system-ui, sans-serif'
        ctx.fillText(pctTxt, pos.x, pos.y + 8)
        return
      }

      // Não cabe: rótulo fora, com linha-guia (cotovelo) apontando a fatia.
      const ang = (a.startAngle + a.endAngle) / 2
      const cos = Math.cos(ang), sin = Math.sin(ang)
      const dir = cos >= 0 ? 1 : -1
      const x0 = a.x + cos * a.outerRadius
      const y0 = a.y + sin * a.outerRadius
      const xb = a.x + cos * (a.outerRadius + 10)
      const yb = a.y + sin * (a.outerRadius + 10)
      const xt = xb + dir * 12
      ctx.strokeStyle = ds.backgroundColor[i]
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(xb, yb)
      ctx.lineTo(xt, yb)
      ctx.stroke()
      const tx = xt + dir * 4
      ctx.textAlign = dir > 0 ? 'left' : 'right'
      ctx.fillStyle = '#c5cad8'
      ctx.font = '600 10px system-ui, sans-serif'
      ctx.fillText(label, tx, yb - 5)
      ctx.fillStyle = MUTED_ROSCA
      ctx.font = '700 10px system-ui, sans-serif'
      ctx.fillText(pctTxt, tx, yb + 6)
    })
    // total no buraco central
    const arc0 = meta.data[0] as unknown as { x: number; y: number } | undefined
    if (arc0) {
      ctx.textAlign = 'center'
      ctx.fillStyle = MUTED_ROSCA
      ctx.font = '500 11px system-ui, sans-serif'
      ctx.fillText(ds.centroLabel ?? '', arc0.x, arc0.y - 11)
      ctx.fillStyle = '#fff'
      ctx.font = '700 16px system-ui, sans-serif'
      ctx.fillText(ds.centroValor ?? '', arc0.x, arc0.y + 9)
    }
    ctx.restore()
  },
}
