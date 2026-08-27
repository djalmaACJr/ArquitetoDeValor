// src/components/ui/QuadroRentabilidadeIndices.tsx
// Quadro "Rentabilidade" da página Destaques — compara a rentabilidade
// mensal composta da carteira com CDI/IPCA (indicadores econômicos fixos)
// e com os indicadores custom (ETF/ETF internacional/índice B3) que o
// usuário cadastrou em Gerenciar dados (useInvIndicadores). 1 card de
// resumo (segue o MESMO período do filtro do topo da página — antes eram 3
// cards fixos, Total/12 meses/Último mês, redundantes com o próprio filtro)
// com um seletor "Comparar rentabilidade com" ACUMULATIVO (múltiplas
// referências ao mesmo tempo, não só uma) + gráfico de linha comparativo +
// tabela de retorno mensal por ano.
//
// Período/tipo de ativo NÃO são seletores próprios daqui — seguem os
// filtros já existentes no topo da página Destaques (prop `periodo`/
// `tipoAtivo`/`periodoLabel`, controlados lá). As referências escolhidas no
// "Comparar rentabilidade com" persistem em arqvalor.usuarios.ordem_quadros
// (mesmo blob JSONB de preferência já usado pra ordem dos quadros
// arrastáveis — aqui só reaproveitado pra guardar OUTRA lista, chave
// própria "rentabilidade-referencias") via usePreferenciasOrdemQuadros.
import { useMemo, useState } from 'react'
import { Check, ChevronDown, Info } from 'lucide-react'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement,
  Tooltip, Legend, Filler,
} from 'chart.js'
import { useInvestimentosHistorico } from '../../hooks/useInvestimentosHistorico'
import { useIndicesEconomicos, type PontoIndice } from '../../hooks/useIndicesEconomicos'
import { useInvIndicadores } from '../../hooks/useInvIndicadores'
import { usePreferenciasOrdemQuadros } from '../../hooks/usePreferenciasOrdemQuadros'
import { acumularGanhoInicioPorMes, retornoPorMes, comporRetornoMensal } from '../../lib/rentabilidadeComposta'
import { TIPO_ATIVO_LABEL } from '../../lib/constants'
import type { InvestimentoHistoricoMensal, TipoAtivoInvestimento, PontoIndicador, PeriodoRanking } from '../../types'

// Chave própria dentro do blob compartilhado ordem_quadros — não colide com
// "destaques-gerais"/"destaques-categorias" (já usadas por essa mesma tabela
// pra ordem dos quadros arrastáveis).
const CHAVE_PREF_REFERENCIAS = 'rentabilidade-referencias'
const REFERENCIAS_PADRAO = ['CDI']

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler)

const MUTED  = '#8b92a8'
const VERDE  = '#00c896'
const VERMELHO = '#ff5c7a'
const AZUL   = '#7c93f0'   // linha "Rentabilidade" (carteira)
const AMBAR  = '#f0b429'   // linha CDI — único benchmark em destaque no gráfico

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const MESES_ABREV = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
function fmtMesCurto(anoMes: string): string {
  const [ano, m] = anoMes.split('-')
  return `${MESES_ABREV[Number(m) - 1]}/${ano.slice(2)}`
}
function fmtPct(v: number): string { return `${v >= 0 ? '+' : ''}${v.toFixed(2).replace('.', ',')}%` }
function corPct(v: number): string { return v > 0 ? VERDE : v < 0 ? VERMELHO : MUTED }

const ANO_ATUAL = new Date().getFullYear()

// PeriodoRanking (do topo da página) → recorte de meses. Granularidade
// mensal (snapshot do histórico) não distingue SEMANA/MÊS_ATUAL/MÊS —
// os 3 colapsam pro mês mais recente disponível.
function aplicarPeriodo(meses: string[], periodo: PeriodoRanking): string[] {
  if (meses.length === 0) return meses
  if (periodo === 'ANO_ATUAL') return meses.filter((m) => m.startsWith(String(ANO_ATUAL)))
  if (periodo === 'TUDO') return meses
  const n = periodo === 'CINCO_ANOS' ? 60 : periodo === 'DOIS_ANOS' ? 24
    : periodo === 'ANO' ? 12 : periodo === 'SEMESTRE' ? 6 : 1
  return meses.slice(-n)
}

// ── Cálculo ──────────────────────────────────────────────────────────
// Retorno MENSAL da carteira (%) = Σganho ÷ Σvalor_início do mês — mesma
// convenção "grupo" já usada em totalRetorno() (DestaquesInvestimentosPage).
// Método (nunca a média simples dos % por ativo) centralizado em
// lib/rentabilidadeComposta.ts — ver comentário lá sobre o achado ago/2026
// que motivou extrair esse cálculo pra um único lugar.
function retornoMensalCarteira(
  historico: InvestimentoHistoricoMensal[], tipo: TipoAtivoInvestimento | '',
): Map<string, number> {
  const filtrado = tipo ? historico.filter((h) => h.inv_ativos?.tipo_ativo === tipo) : historico
  return retornoPorMes(acumularGanhoInicioPorMes(filtrado))
}

// Índices econômicos (CDI/IPCA) já vêm como taxa MENSAL (%) — usa direto.
function retornoMensalIndice(serie: PontoIndice[]): Map<string, number> {
  return new Map(serie.map((p) => [p.competencia, p.valor]))
}
// Indicadores custom (ETF/ETF internacional/índice B3) vêm como PREÇO por
// mês — retorno mensal é a variação de preço mês a mês.
function retornoMensalPreco(serie: PontoIndicador[]): Map<string, number> {
  const ord = [...serie].sort((a, b) => a.competencia.localeCompare(b.competencia))
  const out = new Map<string, number>()
  for (let i = 1; i < ord.length; i++) {
    if (ord[i - 1].valor > 0) out.set(ord[i].competencia, (ord[i].valor / ord[i - 1].valor - 1) * 100)
  }
  return out
}
// Compõe os retornos mensais de uma janela num único % — reusa
// comporRetornoMensal de lib/rentabilidadeComposta.ts (mesma fórmula usada
// pra carteira/índices/indicadores aqui, sem reimplementar por referência).
const compor = comporRetornoMensal
// Mesma composição, mas a partir de valores já resolvidos (não de chaves de
// mês) — usado pela coluna "Retorno anual" da tabela, que já tem os % do
// ano em mãos.
function comporValores(retornos: number[]): number {
  return (retornos.reduce((acc, r) => acc * (1 + r / 100), 1) - 1) * 100
}
// Retorno de CADA MÊS, quebrado por tipo de ativo — usado no hint por célula
// da tabela ("qualquer mês, a contribuição de cada tipo naquele mês").
// SEMPRE olha todos os tipos, independente do filtro de tipo da página (senão
// o hint ficaria trivial/vazio quando um tipo já está selecionado).
function retornoPorTipoEMes(historico: InvestimentoHistoricoMensal[]): Map<TipoAtivoInvestimento, Map<string, number>> {
  const tipos = new Set<TipoAtivoInvestimento>()
  for (const h of historico) if (h.inv_ativos?.tipo_ativo) tipos.add(h.inv_ativos.tipo_ativo)
  const out = new Map<TipoAtivoInvestimento, Map<string, number>>()
  for (const tipo of tipos) out.set(tipo, retornoMensalCarteira(historico, tipo))
  return out
}
// Texto do hover de UM mês: retorno de cada tipo NAQUELE mês, do maior pro
// menor — só tipos com dado nesse mês específico (ex.: um ativo comprado
// depois não aparece nos meses anteriores à compra).
function tituloContribuicaoMes(mes: string, porTipoEMes: Map<TipoAtivoInvestimento, Map<string, number>>): string {
  const linhas = [...porTipoEMes.entries()]
    .map(([tipo, porMes]) => ({ tipo, v: porMes.get(mes) }))
    .filter((x): x is { tipo: TipoAtivoInvestimento; v: number } => x.v != null)
    .sort((a, b) => b.v - a.v)
    .map((x) => `${TIPO_ATIVO_LABEL[x.tipo]}: ${fmtPct(x.v)}`)
  return linhas.join('\n')
}
// Curva acumulada (juros compostos mês a mês) pra plotar no gráfico,
// ancorada em 0% no 1º mês da lista.
function curvaAcumulada(meses: string[], retornoPorMes: Map<string, number>): number[] {
  let acc = 1
  return meses.map((m) => { acc *= 1 + (retornoPorMes.get(m) ?? 0) / 100; return (acc - 1) * 100 })
}
// Idem, mas ancorada no 1º mês em que O PRÓPRIO benchmark tem dado — pode
// começar depois da carteira (ex.: ETF listado há pouco tempo). Meses
// anteriores ficam `null` (Chart.js não desenha ali; `spanGaps` liga o
// resto normalmente).
function curvaBenchmark(meses: string[], retornoPorMes: Map<string, number>): (number | null)[] {
  let acc = 1, comecou = false
  return meses.map((m) => {
    const r = retornoPorMes.get(m)
    if (!comecou) { if (r == null) return null; comecou = true; return 0 }
    acc *= 1 + (r ?? 0) / 100
    return (acc - 1) * 100
  })
}
// "X% acima/abaixo do <referência>" — gap RELATIVO à própria referência
// (não ponto percentual): quanto da rentabilidade dela ficou pra trás/na
// frente.
function gapRelativo(minha: number, ref: number, nome: string): string {
  if (ref === 0) return '—'
  const gap = ((minha - ref) / Math.abs(ref)) * 100
  return `${Math.abs(gap).toFixed(2).replace('.', ',')}% ${gap >= 0 ? 'acima' : 'abaixo'} do ${nome}`
}

interface Referencia { key: string; nome: string; retorno: Map<string, number> }

// ── Card de resumo (rentabilidade no período do filtro do topo) ──────────
// Compara com QUALQUER NÚMERO de referências ao mesmo tempo (acumulativo —
// marcar/desmarcar no seletor "Comparar rentabilidade com", sem substituir a
// escolha anterior), uma linha de gap por referência marcada.
function CardResumo({ titulo, janela, retornoCarteira, referencias, refsSelecionadas, onToggleRef }: {
  titulo: string; janela: string[]; retornoCarteira: Map<string, number>
  referencias: Referencia[]; refsSelecionadas: string[]; onToggleRef: (key: string) => void
}) {
  const [aberto, setAberto] = useState(false)
  const valor = useMemo(() => compor(janela, retornoCarteira), [janela, retornoCarteira])
  const gaps = useMemo(
    () => referencias
      .filter((r) => refsSelecionadas.includes(r.key))
      .map((r) => ({ key: r.key, texto: gapRelativo(valor, compor(janela, r.retorno), r.nome) })),
    [referencias, refsSelecionadas, valor, janela],
  )

  return (
    <div className="relative rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <p className="text-[13px]" style={{ color: MUTED }}>{titulo}</p>
      <p className="text-[12px] mt-2 mb-0.5" style={{ color: MUTED }}>Rentabilidade</p>
      <p className="text-[26px] font-bold" style={{ color: corPct(valor) }}>{fmtPct(valor)}</p>

      {gaps.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {gaps.map((g) => <p key={g.key} className="text-[12px]" style={{ color: MUTED }}>{g.texto}</p>)}
        </div>
      )}

      <button onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between gap-2 mt-2.5 pt-2 border-t border-white/5 text-left">
        <span className="text-[12px]" style={{ color: MUTED }}>Comparar rentabilidade com</span>
        <ChevronDown size={13} style={{ color: MUTED }} className={`transition-transform ${aberto ? 'rotate-180' : ''}`} />
      </button>

      {aberto && (
        <>
          {/* Backdrop invisível — fecha o popover ao clicar fora, sem
              precisar de listener de clique-fora via ref/useEffect. */}
          <div className="fixed inset-0 z-30" onClick={() => setAberto(false)} />
          <div className="absolute left-0 right-0 top-full mt-1 z-40 rounded-xl border border-white/10 bg-av-dark shadow-2xl overflow-hidden">
            <p className="px-3 pt-2.5 pb-1.5 text-[13px] font-semibold text-white border-b border-white/10">
              Comparar rentabilidade com
            </p>
            <div className="max-h-52 overflow-y-auto py-1">
              {referencias.map((r) => {
                const marcado = refsSelecionadas.includes(r.key)
                return (
                  <button key={r.key} type="button" onClick={() => onToggleRef(r.key)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-[13px] text-white/85 hover:bg-white/5 transition-colors">
                    {r.nome}
                    {marcado && <Check size={14} className="text-av-green" />}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default function QuadroRentabilidadeIndices({ contaId, periodo, tipoAtivo, periodoLabel }: {
  contaId: string | null; periodo: PeriodoRanking; tipoAtivo: TipoAtivoInvestimento | ''; periodoLabel: string
}) {
  // Referências marcadas no "Comparar rentabilidade com" — persistidas em
  // arqvalor.usuarios.ordem_quadros (ver comentário no topo do arquivo),
  // pra continuarem marcadas numa próxima visita. Acumulativo: marcar não
  // substitui a escolha anterior, só adiciona/remove dessa lista.
  const { blob: prefsBlob, salvar: salvarPrefs } = usePreferenciasOrdemQuadros()
  const refsSelecionadas = prefsBlob[CHAVE_PREF_REFERENCIAS] ?? REFERENCIAS_PADRAO
  const toggleRef = (key: string) => {
    const nova = refsSelecionadas.includes(key)
      ? refsSelecionadas.filter((k) => k !== key)
      : [...refsSelecionadas, key]
    salvarPrefs(CHAVE_PREF_REFERENCIAS, nova)
  }

  const { historico, loading: loadingHist } = useInvestimentosHistorico(contaId ? { conta_id: contaId } : {})

  const retornoCarteira = useMemo(() => retornoMensalCarteira(historico, tipoAtivo), [historico, tipoAtivo])
  const mesesOrdenados  = useMemo(() => [...retornoCarteira.keys()].sort(), [retornoCarteira])
  const desde = mesesOrdenados[0] ?? '2020-01'
  const porTipoEMes = useMemo(() => retornoPorTipoEMes(historico), [historico])

  const { serie: serieIndices, loading: loadingIndices } = useIndicesEconomicos(['IPCA', 'CDI'], desde)
  const { indicadores, series: seriesIndicadores, loading: loadingIndic } = useInvIndicadores(desde)

  const retornoCDI  = useMemo(() => retornoMensalIndice(serieIndices('CDI')),  [serieIndices])
  const retornoIPCA = useMemo(() => retornoMensalIndice(serieIndices('IPCA')), [serieIndices])

  // Todas as referências disponíveis pro seletor "Comparar rentabilidade
  // com": CDI/IPCA fixos + cada indicador cadastrado em Gerenciar dados.
  const referencias = useMemo<Referencia[]>(() => [
    { key: 'CDI', nome: 'CDI', retorno: retornoCDI },
    { key: 'IPCA', nome: 'IPCA', retorno: retornoIPCA },
    ...indicadores.map((ind) => ({
      key: ind.ticker, nome: ind.ticker, retorno: retornoMensalPreco(seriesIndicadores[ind.ticker] ?? []),
    })),
  ], [retornoCDI, retornoIPCA, indicadores, seriesIndicadores])

  // ── Janela ÚNICA (card + gráfico) — segue o filtro de período do topo da
  // página; antes eram 3 janelas fixas (desde o início/12m/último mês), mas
  // isso duplicava o que o próprio filtro já mostra no gráfico logo ao lado.
  const mesesJanela = useMemo(() => aplicarPeriodo(mesesOrdenados, periodo), [mesesOrdenados, periodo])
  const labels = useMemo(() => mesesJanela.map(fmtMesCurto), [mesesJanela])
  const curvaCarteira = useMemo(() => curvaAcumulada(mesesJanela, retornoCarteira), [mesesJanela, retornoCarteira])
  const curvaCDIGrafico  = useMemo(() => curvaBenchmark(mesesJanela, retornoCDI),  [mesesJanela, retornoCDI])
  const curvaIPCAGrafico = useMemo(() => curvaBenchmark(mesesJanela, retornoIPCA), [mesesJanela, retornoIPCA])
  const curvasIndicadores = useMemo(
    () => indicadores.map((ind) => ({
      ticker: ind.ticker,
      dados: curvaBenchmark(mesesJanela, retornoMensalPreco(seriesIndicadores[ind.ticker] ?? [])),
    })),
    [indicadores, seriesIndicadores, mesesJanela],
  )

  // ── Tabela: retorno mensal por ano (mais recente primeiro) — sempre o
  // histórico INTEIRO (a tabela é o "extrato completo"; o período do topo
  // só recorta o gráfico, senão anos inteiros somem da tabela). ─────────
  const linhasTabela = useMemo(() => {
    const porAno = new Map<string, Map<number, number>>()
    for (const m of mesesOrdenados) {
      const [ano, mesStr] = m.split('-')
      if (!porAno.has(ano)) porAno.set(ano, new Map())
      porAno.get(ano)!.set(Number(mesStr), retornoCarteira.get(m) ?? 0)
    }
    const curvaCompleta = curvaAcumulada(mesesOrdenados, retornoCarteira)
    const acumuladoPorMes = new Map(mesesOrdenados.map((m, i) => [m, curvaCompleta[i]]))
    return [...porAno.keys()].sort((a, b) => b.localeCompare(a)).map((ano) => {
      const meses = porAno.get(ano)!
      const ultimoMesDoAno = `${ano}-${String(Math.max(...meses.keys())).padStart(2, '0')}`
      return {
        ano,
        porMes: Array.from({ length: 12 }, (_, i) => meses.get(i + 1) ?? null),
        anual: comporValores([...meses.values()]),
        acumulado: acumuladoPorMes.get(ultimoMesDoAno) ?? 0,
      }
    })
  }, [mesesOrdenados, retornoCarteira])

  const carregando = loadingHist || loadingIndices || loadingIndic
  const semDados = !carregando && mesesOrdenados.length === 0

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
        {/* Card de resumo — 1 só, no MESMO período do filtro do topo */}
        <div>
          <CardResumo titulo={periodoLabel} janela={mesesJanela} retornoCarteira={retornoCarteira}
            referencias={referencias} refsSelecionadas={refsSelecionadas} onToggleRef={toggleRef} />
        </div>

        {/* Gráfico — sem seletores próprios: segue período/tipo do topo */}
        <div>
          <h2 className="text-[15px] font-semibold text-white mb-3">Rentabilidade comparada com índices</h2>

          {carregando ? (
            <div className="h-[300px] flex items-center justify-center text-[13px]" style={{ color: MUTED }}>Carregando…</div>
          ) : semDados ? (
            <div className="h-[300px] flex items-center justify-center text-[13px]" style={{ color: MUTED }}>
              Sem histórico suficiente pra comparar rentabilidade ainda.
            </div>
          ) : (
            <div style={{ height: 300 }}>
              <Line
                data={{
                  labels,
                  datasets: [
                    {
                      label: 'Rentabilidade', data: curvaCarteira, borderColor: AZUL, backgroundColor: `${AZUL}22`,
                      fill: true, tension: 0.3, pointRadius: 0, pointHoverRadius: 3, borderWidth: 2, order: 0,
                    },
                    {
                      label: 'CDI', data: curvaCDIGrafico, borderColor: AMBAR, backgroundColor: 'transparent',
                      tension: 0.3, pointRadius: 0, pointHoverRadius: 3, borderWidth: 2, spanGaps: true, order: 1,
                    },
                    {
                      label: 'IPCA', data: curvaIPCAGrafico, borderColor: MUTED, backgroundColor: 'transparent',
                      tension: 0.3, pointRadius: 0, pointHoverRadius: 3, borderWidth: 1.5, spanGaps: true, order: 2,
                    },
                    // Indicadores custom começam OCULTOS na legenda — por
                    // padrão só Rentabilidade/CDI/IPCA aparecem; o usuário
                    // clica no nome na legenda pra ligar o que quiser (mesmo
                    // toggle nativo do Chart.js, só muda o estado inicial).
                    ...curvasIndicadores.map((b) => ({
                      label: b.ticker, data: b.dados, borderColor: MUTED, backgroundColor: 'transparent',
                      tension: 0.3, pointRadius: 0, pointHoverRadius: 3, borderWidth: 1.5, spanGaps: true, order: 2,
                      hidden: true,
                    })),
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { intersect: false, mode: 'index' },
                  plugins: {
                    legend: {
                      position: 'top' as const,
                      labels: { color: '#e8eaf0', usePointStyle: true, boxWidth: 8, font: { size: 11 } },
                    },
                    tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${fmtPct(Number(ctx.parsed.y))}` } },
                  },
                  scales: {
                    x: { ticks: { color: MUTED, maxTicksLimit: 10, font: { size: 10 } }, grid: { display: false } },
                    y: { ticks: { color: MUTED, font: { size: 10 }, callback: (v) => `${v}` }, grid: { color: 'rgba(255,255,255,0.06)' } },
                  },
                }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Tabela de retorno mensal */}
      {!carregando && !semDados && (
        <div className="mt-5 pt-4 border-t border-white/10">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h2 className="text-[15px] font-semibold text-white">Rentabilidade</h2>
            {porTipoEMes.size > 1 && (
              <span className="flex items-center gap-1 text-[11px]" style={{ color: MUTED }}>
                <Info size={12} /> passe o mouse sobre um mês pra ver a contribuição por tipo de ativo
              </span>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left" style={{ color: MUTED }}>
                  <th className="font-medium pb-2 pr-3">Ano</th>
                  {MESES_PT.map((m) => <th key={m} className="font-medium pb-2 pr-3 text-right">{m}</th>)}
                  <th className="font-medium pb-2 pr-3 text-right">Retorno anual</th>
                  <th className="font-medium pb-2 text-right">Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {linhasTabela.map((l) => (
                  <tr key={l.ano} className="border-t border-white/5">
                    <td className="py-1.5 pr-3 text-white font-medium">{l.ano}</td>
                    {l.porMes.map((v, i) => {
                      const mesChave = `${l.ano}-${String(i + 1).padStart(2, '0')}`
                      const titulo = v != null ? tituloContribuicaoMes(mesChave, porTipoEMes) : ''
                      return (
                        <td key={i}
                          className={`py-1.5 pr-3 text-right whitespace-nowrap ${titulo ? 'cursor-help' : ''}`}
                          style={{ color: v == null ? MUTED : corPct(v) }}
                          title={titulo || undefined}>
                          {v == null ? '-' : fmtPct(v)}
                        </td>
                      )
                    })}
                    <td className="py-1.5 pr-3 text-right font-semibold whitespace-nowrap" style={{ color: corPct(l.anual) }}>{fmtPct(l.anual)}</td>
                    <td className="py-1.5 text-right font-semibold whitespace-nowrap text-white">{fmtPct(l.acumulado)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}
