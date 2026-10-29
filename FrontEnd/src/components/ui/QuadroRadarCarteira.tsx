import { Radar } from 'react-chartjs-2'
import {
  Chart as ChartJS, RadialLinearScale, PointElement, LineElement, Filler, Tooltip,
} from 'chart.js'
import { Radar as RadarIcon, Info } from 'lucide-react'
import {
  CRITERIOS_CARTEIRA, CRITERIO_CARTEIRA_LABEL, CRITERIO_CARTEIRA_REGRA, REGRA_DIVERSIFICACAO_TIPO,
  type NotasCarteira, type NotasCriteriosAtivos,
} from '../../lib/radarCarteira'
import { CRITERIOS_QUESTAO, CRITERIO_LABEL, CRITERIO_DESCRICAO, type CriterioQuestao } from '../../lib/constants'
import { MIN_EIXOS_RADAR, type CriterioCarteira } from '../../lib/radarCarteira'

ChartJS.register(RadialLinearScale, PointElement, LineElement, Filler, Tooltip)

const MUTED = '#8b92a8'

function corNota(n: number): string {
  return n >= 7 ? '#00c896' : n < 5 ? '#ff5c7a' : '#f0b429'
}

interface Eixo { rotulo: string; nota: number | null; dica: string }

function CartaoRadar({ titulo, subtitulo, cor, eixos, vazio, altura }: {
  titulo: string; subtitulo: string; cor: string; eixos: Eixo[]; vazio: string; altura: number
}) {
  const temDados = eixos.some((e) => e.nota != null)
  const data = {
    labels: eixos.map((e) => e.rotulo),
    datasets: [{
      label: titulo,
      data: eixos.map((e) => e.nota ?? 0),
      backgroundColor: `${cor}33`,
      borderColor: cor,
      borderWidth: 2,
      pointBackgroundColor: cor,
      pointRadius: 3,
    }],
  }
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      r: {
        min: 0, max: 10,
        ticks: { stepSize: 2, color: MUTED, backdropColor: 'transparent', font: { size: 10 } },
        grid: { color: 'rgba(255,255,255,0.08)' },
        angleLines: { color: 'rgba(255,255,255,0.08)' },
        pointLabels: { color: '#e5e7eb', font: { size: 11 } },
      },
    },
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (c: { parsed: { r: number } }) => ` Nota ${c.parsed.r.toFixed(1)}` } },
    },
  }

  return (
    <div className="rounded-lg border border-white/10 p-3 flex flex-col">
      <h3 className="text-[13px] font-semibold text-white">{titulo}</h3>
      <p className="text-[11px] mb-2" style={{ color: MUTED }}>{subtitulo}</p>
      {temDados ? (
        <>
          <div style={{ height: altura }}><Radar data={data} options={options} /></div>
          <ul className="mt-2 space-y-1">
            {eixos.map((e) => (
              <li key={e.rotulo} className="flex items-center justify-between gap-2 text-[12px]" title={e.dica}>
                <span className="text-white/80 flex items-center gap-1 min-w-0">
                  <span className="truncate">{e.rotulo}</span>
                  <Info size={11} className="shrink-0" style={{ color: MUTED }} />
                </span>
                <span className="font-semibold shrink-0" style={{ color: e.nota != null ? corNota(e.nota) : MUTED }}>
                  {e.nota != null ? e.nota.toFixed(1) : '—'}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-[12px] py-10 text-center" style={{ color: MUTED }}>{vazio}</p>
      )}
    </div>
  )
}

/** Par de radares (saúde + qualidade dos ativos), sem moldura — reusado no topo da página e em cada tipo. */
export function RadarDuplo({ carteira, ativos, escopo = 'carteira', altura = 260, criteriosCarteira, criteriosAtivos }: {
  carteira: NotasCarteira | null
  ativos: NotasCriteriosAtivos | null
  escopo?: 'carteira' | 'tipo'
  altura?: number
  /** Restringe os eixos exibidos (padrão: todos). Radar com < 3 eixos some. */
  criteriosCarteira?: CriterioCarteira[]
  criteriosAtivos?: CriterioQuestao[]
}) {
  const eixosCarteira: Eixo[] = CRITERIOS_CARTEIRA.filter((c) => !criteriosCarteira || criteriosCarteira.includes(c)).map((c) => ({
    rotulo: CRITERIO_CARTEIRA_LABEL[c],
    nota: carteira ? carteira[c] : null,
    dica: escopo === 'tipo' && c === 'DIVERSIFICACAO' ? REGRA_DIVERSIFICACAO_TIPO : CRITERIO_CARTEIRA_REGRA[c],
  }))
  const eixosAtivos: Eixo[] = CRITERIOS_QUESTAO.filter((c) => !criteriosAtivos || criteriosAtivos.includes(c)).map((c) => ({
    rotulo: CRITERIO_LABEL[c],
    nota: ativos ? ativos[c] : null,
    dica: CRITERIO_DESCRICAO[c],
  }))
  const dequeTipo = escopo === 'tipo'
  const mostraCarteira = eixosCarteira.length >= MIN_EIXOS_RADAR
  const mostraAtivos = eixosAtivos.length >= MIN_EIXOS_RADAR
  if (!mostraCarteira && !mostraAtivos) return null

  return (
    <div className={`grid grid-cols-1 gap-3 ${mostraCarteira && mostraAtivos ? 'lg:grid-cols-2' : ''}`}>
      {mostraCarteira && <CartaoRadar
        titulo={dequeTipo ? 'Saúde do tipo' : 'Saúde da carteira'}
        subtitulo={dequeTipo
          ? 'Calculada das posições deste tipo (passe o mouse nos critérios para ver a regra)'
          : 'Calculada das suas posições atuais (passe o mouse nos critérios para ver a regra)'}
        cor="#3b82f6"
        eixos={eixosCarteira}
        altura={altura}
        vazio="Sem posições com valor de mercado." />}
      {mostraAtivos && <CartaoRadar
        titulo="Qualidade dos ativos"
        subtitulo="Média dos critérios dos questionários, ponderada pelo valor de cada ativo"
        cor="#00c896"
        eixos={eixosAtivos}
        altura={altura}
        vazio="Nenhum ativo avaliado ainda." />}
    </div>
  )
}

export default function QuadroRadarCarteira({ carteira, ativos }: {
  carteira: NotasCarteira | null
  ativos: NotasCriteriosAtivos | null
}) {
  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
      <h2 className="text-[13px] font-semibold text-white mb-3 flex items-center gap-1.5">
        <RadarIcon size={15} style={{ color: '#8b5cf6' }} /> Radar da carteira
      </h2>
      <RadarDuplo carteira={carteira} ativos={ativos} />
    </section>
  )
}
