import { useMemo, useState } from 'react'
import { Layers, Info, ChevronDown, Layers3, Users } from 'lucide-react'
import { setorLabel, TIPO_ATIVO_LABEL, FII_CATEGORIA_INFO } from '../../lib/constants'
import { formatBRL } from '../../lib/utils'
import type { InvestimentoAtivo, InvestimentoRankingAtivo, TipoAtivoInvestimento } from '../../types'

const MUTED = '#8b92a8'

// Renda fixa/Tesouro ficam fora do cálculo: funcionam como proteção e
// diversificação da carteira, não como fonte de sobreposição de risco com a
// renda variável (regra explícita do método — ver limitações no rodapé).
const TIPOS_FORA_ESCOPO = new Set<TipoAtivoInvestimento>(['RENDA_FIXA', 'TESOURO_DIRETO'])
// Cestas cuja composição interna não é decomposta — não há fonte de holdings
// conectada (a tabela inv_etf_holdings existe no schema mas não tem
// consumidor ainda). Entram como um único bloco "opaco".
const TIPOS_CESTA = new Set<TipoAtivoInvestimento>(['ETF', 'ETF_INTERNACIONAL'])

const PALETA = [
  '#3b82f6', '#00c896', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#f97316', '#14b8a6', '#a3e635', '#ef4444',
]

type Nivel = 'BAIXA' | 'MODERADA' | 'ALTA' | 'MUITO_ALTA'
const NIVEL_LABEL: Record<Nivel, string> = { BAIXA: 'Baixa', MODERADA: 'Moderada', ALTA: 'Alta', MUITO_ALTA: 'Muito alta' }
const NIVEL_COR: Record<Nivel, string> = { BAIXA: '#00c896', MODERADA: '#f0b429', ALTA: '#f97316', MUITO_ALTA: '#ff5c7a' }

function nivelDe(pct: number, limites: readonly [number, number, number]): Nivel {
  if (pct < limites[0]) return 'BAIXA'
  if (pct < limites[1]) return 'MODERADA'
  if (pct < limites[2]) return 'ALTA'
  return 'MUITO_ALTA'
}
// Limiares (%) para classificar uma fatia isolada: área/setor, e ativo único
// (mais exigente — um único ticker acima de 20% já é concentração alta).
const LIMITES_AREA: [number, number, number] = [15, 30, 45]
const LIMITES_ATIVO: [number, number, number] = [5, 10, 20]
const LIMITES_INDICE: [number, number, number] = [25, 45, 65]
// A partir daqui uma área/setor é tratada como "concentração relevante" nos
// alertas (diversificação aparente vs. concentração direta).
const LIMIAR_ALERTA = 30

const fmtPct = (v: number) => `${v.toFixed(1).replace('.', ',')}%`

interface Item {
  ativoId: string; ticker: string; nome: string; tipo: TipoAtivoInvestimento
  valor: number; area: string; geografia: string; cesta: boolean
}
interface Grupo { chave: string; valor: number; itens: Item[] }

function agrupar(itens: Item[], chaveDe: (i: Item) => string): Grupo[] {
  const mapa = new Map<string, Grupo>()
  for (const it of itens) {
    const chave = chaveDe(it)
    const g = mapa.get(chave) ?? { chave, valor: 0, itens: [] }
    g.valor += it.valor
    g.itens.push(it)
    mapa.set(chave, g)
  }
  return [...mapa.values()]
    .map((g) => ({ ...g, itens: g.itens.sort((a, b) => b.valor - a.valor) }))
    .sort((a, b) => b.valor - a.valor)
}

// Índice de Herfindahl-Hirschman normalizado (0..100): soma dos pesos² × 100.
// Quanto mais perto de 100, mais a exposição está concentrada num só grupo —
// não conta quantidade de grupos, só o quanto o peso se acumula neles.
function hhi(valores: number[], total: number): number {
  if (total <= 0) return 0
  return valores.reduce((s, v) => s + (v / total) ** 2, 0) * 100
}

// Setor (ações/stocks) > segmento/categoria de FII (CVM) > tipo do ativo
// (cestas diversificadas como ETF/cripto não têm um único setor).
function areaDe(meta: InvestimentoAtivo | undefined, tipo: TipoAtivoInvestimento): string {
  const s = setorLabel(meta?.setor)
  if (s) return s
  if (tipo === 'FII') {
    if (meta?.fii_segmento) return `FII · ${meta.fii_segmento}`
    if (meta?.fii_categoria) return `FII · ${FII_CATEGORIA_INFO[meta.fii_categoria].label}`
    return 'FII · Sem segmento'
  }
  return TIPO_ATIVO_LABEL[tipo]
}

// Geografia estimada por proxy (tipo do ativo / moeda) — não pela
// nacionalidade real das empresas subjacentes (ver limitações).
function geografiaDe(tipo: TipoAtivoInvestimento, moeda: string | null | undefined): string {
  if (tipo === 'CRIPTOMOEDAS') return 'Cripto (global)'
  if (tipo === 'STOCKS' || tipo === 'ETF_INTERNACIONAL' || tipo === 'REIT') return 'Internacional'
  if (moeda && moeda !== 'BRL') return 'Internacional'
  return 'Brasil'
}

function BarraGrupo({ rotulo, valor, total, cor, tag, sub }: {
  rotulo: string; valor: number; total: number; cor: string; tag?: string; sub?: string
}) {
  const pct = total > 0 ? (valor / total) * 100 : 0
  return (
    <li className="rounded-lg border border-white/10 px-3 py-2">
      <div className="flex items-center justify-between gap-2 text-[12.5px]">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cor }} />
          <span className="text-white/90 font-medium truncate">{rotulo}</span>
          {tag && <span className="shrink-0 rounded px-1 py-px text-[10px] font-semibold"
            style={{ color: NIVEL_COR[nivelDe(pct, LIMITES_AREA)], background: `${NIVEL_COR[nivelDe(pct, LIMITES_AREA)]}1f` }}>{tag}</span>}
        </span>
        <span className="text-white shrink-0">{formatBRL(valor)} · {fmtPct(pct)}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full overflow-hidden bg-white/10">
        <div className="h-full" style={{ width: `${pct}%`, background: cor }} />
      </div>
      {sub && <p className="mt-1 text-[11px] truncate" style={{ color: MUTED }}>{sub}</p>}
    </li>
  )
}

function FatorIndice({ label, valor, peso }: { label: string; valor: number; peso: number }) {
  const nivel = nivelDe(valor, LIMITES_INDICE)
  return (
    <div>
      <div className="flex items-center justify-between text-[11.5px] mb-0.5">
        <span style={{ color: MUTED }}>{label} <span className="opacity-70">(peso {peso}%)</span></span>
        <span className="font-semibold" style={{ color: NIVEL_COR[nivel] }}>{valor.toFixed(0)}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden bg-white/10">
        <div className="h-full" style={{ width: `${Math.min(100, valor)}%`, background: NIVEL_COR[nivel] }} />
      </div>
    </div>
  )
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/10 px-3 py-2">
      <p className="text-[10.5px] uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
      <p className="text-[16px] font-semibold text-white mt-0.5">{value}</p>
      {sub && <p className="text-[10.5px] mt-0.5" style={{ color: MUTED }}>{sub}</p>}
    </div>
  )
}

export default function QuadroSobreposicao({ ativosCarteira, ativoPorId }: {
  /** Ativos com saldo > 0 (traz valor de mercado e ativo_id). */
  ativosCarteira: InvestimentoRankingAtivo[]
  /** Metadado por ativo_id (setor, categoria/segmento de FII, moeda…). */
  ativoPorId: Map<string, InvestimentoAtivo>
}) {
  const [aberto, setAberto] = useState(true)

  const d = useMemo(() => {
    let totalCarteira = 0
    const itens: Item[] = []
    let semSetor = 0
    for (const a of ativosCarteira) {
      totalCarteira += a.valor_mercado
      if (TIPOS_FORA_ESCOPO.has(a.tipo_ativo)) continue
      const meta = ativoPorId.get(a.ativo_id)
      const area = areaDe(meta, a.tipo_ativo)
      if ((a.tipo_ativo === 'ACOES' || a.tipo_ativo === 'STOCKS') && !setorLabel(meta?.setor)) semSetor++
      itens.push({
        ativoId: a.ativo_id, ticker: a.ticker, nome: a.nome, tipo: a.tipo_ativo, valor: a.valor_mercado,
        area, geografia: geografiaDe(a.tipo_ativo, meta?.moeda), cesta: TIPOS_CESTA.has(a.tipo_ativo),
      })
    }
    const totalAnalisado = itens.reduce((s, i) => s + i.valor, 0)
    const areas = agrupar(itens, (i) => i.area)
    const geos = agrupar(itens, (i) => i.geografia)
    const veiculos = agrupar(itens, (i) => TIPO_ATIVO_LABEL[i.tipo])
    const cestaValor = itens.filter((i) => i.cesta).reduce((s, i) => s + i.valor, 0)

    // "Diversificação aparente": área relevante (≥30%) sustentada por 3+
    // ativos diferentes — parece pulverizado, mas é a mesma exposição
    // econômica. "Concentração direta": mesmo patamar, mas puxado por 1-2
    // ativos só (o problema ali é outro: aposta grande num nome/fundo).
    const aparentes = areas.filter((g) => totalAnalisado > 0 && (g.valor / totalAnalisado) * 100 >= LIMIAR_ALERTA && g.itens.length >= 3)
    const concentradas = areas.filter((g) => totalAnalisado > 0 && (g.valor / totalAnalisado) * 100 >= LIMIAR_ALERTA && g.itens.length < 3)

    const fSetor = hhi(areas.map((g) => g.valor), totalAnalisado)
    const fGeo = hhi(geos.map((g) => g.valor), totalAnalisado)
    const fAtivo = hhi(itens.map((i) => i.valor), totalAnalisado)
    const fVeiculo = hhi(veiculos.map((g) => g.valor), totalAnalisado)
    // Pesos: setorial é o fator mais informativo com os dados disponíveis;
    // veículo (tipo de ativo) é um proxy fraco para "sobreposição entre
    // fundos/ETFs" de verdade (item 4 do índice pedido) — ver limitações.
    const indice = Math.round(fSetor * 0.35 + fGeo * 0.20 + fAtivo * 0.25 + fVeiculo * 0.20)
    const nivelGeral = nivelDe(indice, LIMITES_INDICE)

    const topAtivos = [...itens].sort((a, b) => b.valor - a.valor).slice(0, 8)

    return {
      itens, totalCarteira, totalAnalisado, areas, geos, cestaValor, semSetor,
      aparentes, concentradas, fSetor, fGeo, fAtivo, fVeiculo, indice, nivelGeral, topAtivos,
    }
  }, [ativosCarteira, ativoPorId])

  const pctAnalisada = d.totalCarteira > 0 ? (d.totalAnalisado / d.totalCarteira) * 100 : 0
  const pctCesta = d.totalAnalisado > 0 ? (d.cestaValor / d.totalAnalisado) * 100 : 0

  if (d.totalCarteira === 0) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
        <h2 className="text-[13px] font-semibold text-white mb-1 flex items-center gap-1.5">
          <Layers size={15} style={{ color: '#8b5cf6' }} /> Sobreposição por área
        </h2>
        <p className="text-[12.5px] py-6 text-center" style={{ color: MUTED }}>
          Nenhum ativo com valor de mercado na carteira.
        </p>
      </section>
    )
  }

  if (d.totalAnalisado === 0) {
    return (
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
        <h2 className="text-[13px] font-semibold text-white mb-1 flex items-center gap-1.5">
          <Layers size={15} style={{ color: '#8b5cf6' }} /> Sobreposição por área
        </h2>
        <p className="text-[12.5px] py-6 text-center" style={{ color: MUTED }}>
          Toda a carteira está em renda fixa/Tesouro Direto — fica fora desta análise por definição
          (funciona como proteção e diversificação, não como fonte de sobreposição de risco).
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-white/10 bg-white/[0.02] p-4 mb-4">
      <button onClick={() => setAberto((v) => !v)} className="w-full flex items-center justify-between gap-2 text-left">
        <h2 className="text-[13px] font-semibold text-white flex items-center gap-1.5">
          <Layers size={15} style={{ color: '#8b5cf6' }} /> Sobreposição por área
          <span className="font-normal text-[11.5px]" style={{ color: NIVEL_COR[d.nivelGeral] }}>
            · {NIVEL_LABEL[d.nivelGeral]} sobreposição
          </span>
        </h2>
        <ChevronDown size={16} style={{ color: MUTED }} className={`transition-transform shrink-0 ${aberto ? '' : '-rotate-90'}`} />
      </button>
      <p className="text-[12px] mt-1 mb-3" style={{ color: MUTED }}>
        Quanto da carteira está de fato exposta às mesmas empresas, setores e regiões — mesmo quando os
        ativos parecem diferentes. Renda fixa e Tesouro Direto ficam fora (proteção, não sobreposição).
      </p>

      {/* Visão geral — sempre visível */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
        <StatCard label="Carteira analisada" value={fmtPct(pctAnalisada)} sub="renda variável, sem RF/Tesouro" />
        <StatCard label="Ativos analisados" value={String(d.itens.length)} />
        <StatCard label="Exposições identificadas" value={String(d.areas.length)} sub="setor / segmento / tipo" />
        <StatCard label="Em cestas não decompostas" value={fmtPct(pctCesta)} sub="ETF / ETF internacional" />
      </div>

      {aberto && (
        <div className="space-y-4">
          {/* Índice de sobreposição */}
          <div className="rounded-lg border border-white/10 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[12.5px] font-semibold text-white/90 flex items-center gap-1.5">
                <Layers3 size={13} style={{ color: '#8b5cf6' }} /> Índice de sobreposição da carteira
              </span>
              <span className="text-[15px] font-bold" style={{ color: NIVEL_COR[d.nivelGeral] }}>
                {d.indice} <span className="text-[11px] font-normal" style={{ color: MUTED }}>/100</span>
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              <FatorIndice label="Setorial" valor={d.fSetor} peso={35} />
              <FatorIndice label="Geográfica" valor={d.fGeo} peso={20} />
              <FatorIndice label="Ativos individuais" valor={d.fAtivo} peso={25} />
              <FatorIndice label="Tipo de veículo (proxy)" valor={d.fVeiculo} peso={20} />
            </div>
            <p className="text-[11px] mt-2" style={{ color: MUTED }}>
              Não é um veredito de "boa" ou "ruim" — mostra onde a carteira concentra risco. Não inclui
              sobreposição real de empresas dentro de ETFs/fundos (sem dado de composição conectado hoje).
            </p>
          </div>

          {/* Alertas: diversificação aparente vs. concentração direta */}
          {d.aparentes.length > 0 && (
            <div className="rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: '#ff5c7a55', background: '#ff5c7a14' }}>
              <span className="font-semibold" style={{ color: '#ff5c7a' }}>Diversificação aparente.</span>{' '}
              <span className="text-white/85">
                {d.aparentes.map((g) => `${g.chave} (${fmtPct((g.valor / d.totalAnalisado) * 100)}, ${g.itens.length} ativos)`).join('; ')}.
                {' '}Vários ativos diferentes, mas puxando para a mesma exposição econômica.
              </span>
            </div>
          )}
          {d.concentradas.length > 0 && (
            <div className="rounded-lg border px-3 py-2 text-[12.5px]" style={{ borderColor: '#f59e0b55', background: '#f59e0b14' }}>
              <span className="font-semibold" style={{ color: '#f59e0b' }}>Concentração direta.</span>{' '}
              <span className="text-white/85">
                {d.concentradas.map((g) => `${g.chave} (${fmtPct((g.valor / d.totalAnalisado) * 100)}, ${g.itens.length} ativo${g.itens.length === 1 ? '' : 's'})`).join('; ')}.
                {' '}Poucos ativos carregando uma fatia grande da mesma exposição.
              </span>
            </div>
          )}

          {/* Concentração setorial/por área */}
          <div>
            <h3 className="text-[12px] font-semibold text-white/85 mb-1.5">Concentração por setor / área</h3>
            <ul className="space-y-2">
              {d.areas.map((g, i) => (
                <BarraGrupo key={g.chave} rotulo={g.chave} valor={g.valor} total={d.totalAnalisado} cor={PALETA[i % PALETA.length]}
                  tag={NIVEL_LABEL[nivelDe((g.valor / d.totalAnalisado) * 100, LIMITES_AREA)]}
                  sub={g.itens.map((it) => it.ticker + (it.cesta ? ' (cesta)' : '')).join(' · ')} />
              ))}
            </ul>
          </div>

          {/* Concentração geográfica */}
          <div>
            <h3 className="text-[12px] font-semibold text-white/85 mb-1.5">Concentração geográfica (estimada)</h3>
            <ul className="space-y-2">
              {d.geos.map((g, i) => (
                <BarraGrupo key={g.chave} rotulo={g.chave} valor={g.valor} total={d.totalAnalisado} cor={PALETA[(i + 3) % PALETA.length]}
                  sub={g.itens.map((it) => it.ticker).join(' · ')} />
              ))}
            </ul>
          </div>

          {/* Maiores exposições individuais */}
          <div>
            <h3 className="text-[12px] font-semibold text-white/85 mb-1.5 flex items-center gap-1.5">
              <Users size={12} style={{ color: MUTED }} /> Maiores exposições em ativos individuais
            </h3>
            <ul className="space-y-1">
              {d.topAtivos.map((it) => {
                const pct = (it.valor / d.totalAnalisado) * 100
                const nivel = nivelDe(pct, LIMITES_ATIVO)
                return (
                  <li key={it.ativoId} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-[12.5px]">
                    <span className="flex items-center gap-1.5 min-w-0">
                      <span className="text-white/90 font-medium truncate">{it.ticker}</span>
                      <span className="truncate" style={{ color: MUTED }}>{it.nome}</span>
                    </span>
                    <span className="shrink-0 flex items-center gap-2">
                      <span className="text-[10.5px] font-semibold" style={{ color: NIVEL_COR[nivel] }}>{NIVEL_LABEL[nivel]}</span>
                      <span className="text-white">{fmtPct(pct)}</span>
                    </span>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Limitações — transparência sobre o que não é calculado */}
          <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-[11px] space-y-1" style={{ color: MUTED }}>
            <p className="flex items-start gap-1">
              <Info size={11} className="mt-0.5 shrink-0" />
              <span className="font-semibold text-white/75">Limitações desta análise:</span>
            </p>
            <ul className="list-disc pl-5 space-y-0.5">
              <li>ETFs e ETFs internacionais entram como cesta única (não decompostos por dentro) — a sobreposição de empresas entre eles e suas posições diretas não é calculada.</li>
              <li>Geografia é estimada pelo tipo do ativo/moeda de cotação, não pela nacionalidade real das empresas subjacentes (relevante para ETFs internacionais e BDRs).</li>
              <li>FIIs usam o segmento informado pela CVM no Informe Mensal — não há dado de imóveis, inquilinos ou devedores individuais.</li>
              <li>Renda fixa e Tesouro Direto ficam fora do cálculo de propósito.</li>
              {d.semSetor > 0 && <li>{d.semSetor} ação/stock sem setor cadastrado — caem no tipo do ativo; atualize o ticker para classificar melhor.</li>}
            </ul>
          </div>
        </div>
      )}
    </section>
  )
}
