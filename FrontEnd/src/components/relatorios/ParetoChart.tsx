// src/components/relatorios/ParetoChart.tsx
import { useMemo, useState, Fragment } from 'react'
import { TrendingUp, TrendingDown, Minus, ChevronDown, ChevronRight } from 'lucide-react'
import { formatBRL } from '../../lib/utils'
import { calcularParetto, type ResumoParetto } from '../../lib/paretoAnalysis'

type CategoriaItem = { categoria_id: string | null; categoria_nome: string; total: number }
type SubItem      = { categoria_id: string;        categoria_nome: string; total: number }

interface ParetoChartProps {
  receitas: CategoriaItem[]
  despesas: CategoriaItem[]
  oculto?: boolean
  onClickCategoria?: (categoriaId: string | null, categoriaNome: string) => void
  // ── Modo comparativo (opcional) ────────────────────────────────────────────
  // Quando informados, a tabela ganha colunas "Período inicial" e "Variação"
  // ao lado dos valores atuais. A análise 80/20 continua usando o período atual
  // (receitas/despesas em primeiro plano), já que é o que motiva a decisão.
  receitasAnteriores?: CategoriaItem[]
  despesasAnteriores?: CategoriaItem[]
  labelAtual?:    string  // ex.: "Período final"
  labelAnterior?: string  // ex.: "Período inicial"
  // ── Subcategorias (opcional) ───────────────────────────────────────────────
  // Quando informado, transforma cada categoria pai em uma linha clicável que
  // expande/colapsa para revelar suas subcategorias. As subs NÃO entram na
  // análise 80/20 — são apenas decomposição informativa.
  subsDe?: (categoriaId: string | null) => SubItem[] | undefined
}

/**
 * Renderiza tabela com os itens de uma categoria no Paretto.
 * Quando `anteriores` é informado, ativa o modo COMPARATIVO: colunas extras
 * de Período inicial e Variação.
 * Quando `subsDe` é informado, cada linha vira clicável para expandir as
 * subcategorias daquela categoria pai.
 */
function TabelaParetto({
  resumo,
  titulo,
  cor,
  oculto = false,
  onClickCategoria,
  anteriores,
  totalAnterior,
  labelAtual,
  labelAnterior,
  subsDe,
}: {
  resumo: ResumoParetto
  titulo: string
  cor: string
  oculto?: boolean
  onClickCategoria?: (id: string | null, nome: string) => void
  anteriores?: Map<string, number>   // categoria_id (ou '__sem__') -> total no período anterior
  totalAnterior?: number             // soma de `anteriores` (já calculada)
  labelAtual?:    string
  labelAnterior?: string
  subsDe?:        (categoriaId: string | null) => SubItem[] | undefined
}) {
  // Itens dentro dos 80% (regra clássica, incluindo o que faz cruzar):
  // `resumo.quantidadeAte80` é a contagem. Os primeiros N itens ordenados
  // são os que compõem ~80% do volume — destacados visualmente.
  const ultimoIdxAte80 = resumo.quantidadeAte80 - 1
  const modoComparativo = !!anteriores
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set())
  const toggleExp = (id: string) => setExpandidos(prev => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  return (
    <div className="bg-[#1a1f2e] border border-white/10 rounded-xl overflow-hidden">
      {/* Cabeçalho */}
      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <p className="text-[16px] font-bold uppercase tracking-wider" style={{ color: cor }}>
          {titulo}
        </p>
        {resumo.quantidadeAte80 > 0 && (
          <span
            className="text-[14px] font-bold px-2 py-0.5 rounded-full"
            style={{ background: `${cor}1A`, color: cor, border: `1px solid ${cor}40` }}
            title="Itens em destaque compõem ~80% do volume"
          >
            ★ {resumo.quantidadeAte80} item{resumo.quantidadeAte80 !== 1 ? 's' : ''} = 80%
          </span>
        )}
      </div>

      {/* Corpo da tabela */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
              <th className="px-4 py-2.5 text-left border-b border-white/5 w-[28px]" />
              <th className="px-4 py-2.5 text-left border-b border-white/5">
                <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Categoria</span>
              </th>
              {modoComparativo && (
                <th className="px-4 py-2.5 text-right border-b border-white/5">
                  <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
                    {labelAnterior ?? 'Anterior'}
                  </span>
                </th>
              )}
              <th className="px-4 py-2.5 text-right border-b border-white/5">
                <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
                  {modoComparativo ? (labelAtual ?? 'Atual') : 'Valor'}
                </span>
              </th>
              {modoComparativo && (
                <th className="px-4 py-2.5 text-right border-b border-white/5">
                  <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Variação</span>
                </th>
              )}
              <th className="px-4 py-2.5 text-right border-b border-white/5">
                <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>
                  {modoComparativo ? '% do total (antes → agora)' : '%'}
                </span>
              </th>
              <th className="px-4 py-2.5 text-right border-b border-white/5">
                <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Acumulado</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {resumo.itens.map((item, idx) => {
              const dentro80    = idx <= ultimoIdxAte80
              const ultimo80    = idx === ultimoIdxAte80                              // a linha que completa os 80%
              const primeiroFora = idx === ultimoIdxAte80 + 1 && ultimoIdxAte80 >= 0   // primeira linha "abaixo do corte"

              // Modo comparativo: busca o valor no período anterior pela chave
              // (categoria_id ou fallback '__sem__' para Sem categoria)
              const keyAnt   = item.categoria_id ?? '__sem__'
              const valorAnt = anteriores?.get(keyAnt) ?? 0
              const dif      = item.total - valorAnt
              const variacao = valorAnt > 0 ? (dif / valorAnt) * 100 : null
              const novoNoB  = modoComparativo && valorAnt === 0 && item.total > 0
              const corDif   = dif > 0 ? '#00c896' : dif < 0 ? '#f87171' : '#8b92a8'
              const TendIcon = dif > 0 ? TrendingUp : dif < 0 ? TrendingDown : Minus

              const subs = subsDe?.(item.categoria_id) ?? []
              const podeExpandir = subs.length > 0
              const expanded     = !!(item.categoria_id && expandidos.has(item.categoria_id))

              return (
              <Fragment key={`${item.categoria_id}-${idx}`}>
                <tr
                  onClick={() => {
                    if (podeExpandir && item.categoria_id) toggleExp(item.categoria_id)
                    else onClickCategoria?.(item.categoria_id, item.categoria_nome)
                  }}
                  className="hover:bg-white/[0.04] transition-colors cursor-pointer"
                  style={{
                    background:  dentro80 ? `${cor}10` : 'transparent',
                    boxShadow:   dentro80 ? `inset 3px 0 0 ${cor}` : 'none',
                    borderBottom: ultimo80
                      ? `2px solid ${cor}40`            // separador grosso entre 80% e 20%
                      : '1px solid rgba(255,255,255,0.05)',
                    ...(primeiroFora ? { borderTop: 'none' } : {}),
                  }}
                >
                  <td className="px-2 py-3 text-center">
                    {dentro80 && (
                      <span title="Faz parte dos 80%" style={{ color: cor }} className="text-[15px]">★</span>
                    )}
                  </td>
                  <td className="pl-2 pr-4 py-3">
                    <div className="flex items-center gap-1.5">
                      {podeExpandir && (
                        expanded
                          ? <ChevronDown  size={12} style={{ color: '#8b92a8', flexShrink: 0 }} />
                          : <ChevronRight size={12} style={{ color: '#8b92a8', flexShrink: 0 }} />
                      )}
                      <span className="text-[15px]" style={{ color: dentro80 ? '#e8eaf0' : '#8b92a8', fontWeight: dentro80 ? 600 : 400 }}>
                        {item.categoria_nome}
                      </span>
                      {podeExpandir && (
                        <span className="text-[12px] ml-1" style={{ color: '#4a5168' }}>
                          ({subs.length})
                        </span>
                      )}
                    </div>
                  </td>
                  {modoComparativo && (
                    <td className="px-4 py-3 text-right">
                      <span className="text-[15px]" style={{ color: '#8b92a8' }}>
                        {oculto ? '??????' : (valorAnt > 0 ? formatBRL(valorAnt) : '—')}
                      </span>
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    <span className="text-[15px] font-semibold" style={{ color: dentro80 ? cor : '#8b92a8' }}>
                      {oculto ? '??????' : formatBRL(item.total)}
                    </span>
                  </td>
                  {modoComparativo && (
                    <td className="px-4 py-3 text-right">
                      {novoNoB ? (
                        <span className="text-[14px] px-1.5 py-0.5 rounded-full font-semibold"
                          style={{ background: 'rgba(240,180,41,0.12)', color: '#f0b429' }}>
                          Novo
                        </span>
                      ) : variacao === null ? (
                        <span className="text-[14px]" style={{ color: '#4a5168' }}>—</span>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="text-[14px] font-semibold" style={{ color: corDif }}>
                            {variacao >= 0 ? '+' : ''}{variacao.toFixed(1)}%
                          </span>
                          <TendIcon size={11} style={{ color: corDif }} />
                        </div>
                      )}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right">
                    {(() => {
                      // Modo simples: só o % atual
                      if (!modoComparativo || !totalAnterior || totalAnterior <= 0) {
                        return (
                          <span className="text-[14px] font-medium" style={{ color: '#8b92a8' }}>
                            {item.percentual.toFixed(1)}%
                          </span>
                        )
                      }
                      // Modo comparativo: % antes → % agora + Δpp
                      const percAnt = (valorAnt / totalAnterior) * 100
                      const pp      = item.percentual - percAnt
                      const corPp   = pp > 0.1 ? '#00c896' : pp < -0.1 ? '#f87171' : '#8b92a8'
                      return (
                        <div className="leading-tight whitespace-nowrap">
                          <span className="text-[13px]" style={{ color: '#8b92a8' }}>
                            {percAnt.toFixed(1)}%
                          </span>
                          <span className="text-[13px] mx-0.5" style={{ color: '#4a5168' }}>→</span>
                          <span className="text-[14px] font-semibold" style={{ color: dentro80 ? '#c5cad8' : '#8b92a8' }}>
                            {item.percentual.toFixed(1)}%
                          </span>
                          <div className="text-[13px] font-semibold" style={{ color: corPp }}>
                            {pp >= 0 ? '+' : ''}{pp.toFixed(1)}pp
                          </div>
                        </div>
                      )
                    })()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div
                        className="h-1.5 rounded-full"
                        style={{
                          width: `${Math.min(item.percentualAcumulado, 100)}px`,
                          background: cor,
                          opacity: dentro80 ? 0.8 : 0.35,
                        }}
                      />
                      <span className="text-[14px]" style={{ color: dentro80 ? '#c5cad8' : '#8b92a8', minWidth: 30, textAlign: 'right', fontWeight: dentro80 ? 600 : 400 }}>
                        {item.percentualAcumulado.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Linhas das subcategorias quando expandido */}
                {expanded && subs
                  .slice()
                  .sort((a, b) => b.total - a.total)
                  .map(s => {
                    const pctSub = item.total > 0 ? (s.total / item.total) * 100 : 0
                    return (
                      <tr key={`sub-${s.categoria_id}`}
                        onClick={() => onClickCategoria?.(s.categoria_id, s.categoria_nome)}
                        className="hover:bg-white/[0.03] transition-colors cursor-pointer"
                        style={{ background: 'rgba(255,255,255,0.015)' }}
                      >
                        <td />
                        <td colSpan={modoComparativo ? 2 : 1} className="pl-8 pr-4 py-2">
                          <span className="text-[14px]" style={{ color: '#8b92a8' }}>
                            └ {s.categoria_nome}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right">
                          <span className="text-[14px]" style={{ color: '#8b92a8' }}>
                            {oculto ? '??????' : formatBRL(s.total)}
                          </span>
                        </td>
                        {modoComparativo && <td />}
                        <td className="px-4 py-2 text-right">
                          <span className="text-[13px]" style={{ color: '#4a5168' }}>
                            {pctSub.toFixed(1)}% da pai
                          </span>
                        </td>
                        <td />
                      </tr>
                    )
                  })}
              </Fragment>
              )
            })}
          </tbody>
          <tfoot>
            {/* Total alinhado com a coluna "Valor" (e período inicial, se houver) */}
            <tr style={{ background: 'rgba(255,255,255,0.02)', borderTop: '2px solid rgba(255,255,255,0.1)' }}>
              <td className="w-[28px]" />
              <td className="pl-2 pr-4 py-2.5">
                <span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#c5cad8' }}>
                  Total
                </span>
              </td>
              {modoComparativo && (
                <td className="px-4 py-2.5 text-right">
                  <span className="text-[15px] font-bold" style={{ color: '#8b92a8' }}>
                    {oculto ? '??????' : formatBRL(totalAnterior ?? 0)}
                  </span>
                </td>
              )}
              <td className="px-4 py-2.5 text-right">
                <span className="text-[16px] font-bold" style={{ color: cor }}>
                  {oculto ? '??????' : formatBRL(resumo.total)}
                </span>
              </td>
              {modoComparativo && (() => {
                const tA = totalAnterior ?? 0
                const dif = resumo.total - tA
                const varTot = tA > 0 ? (dif / tA) * 100 : null
                const corDif = dif > 0 ? '#00c896' : dif < 0 ? '#f87171' : '#8b92a8'
                const TendIcon = dif > 0 ? TrendingUp : dif < 0 ? TrendingDown : Minus
                return (
                  <td className="px-4 py-2.5 text-right">
                    {varTot === null ? (
                      <span className="text-[14px]" style={{ color: '#4a5168' }}>—</span>
                    ) : (
                      <div className="flex items-center justify-end gap-1.5">
                        <span className="text-[14px] font-bold" style={{ color: corDif }}>
                          {varTot >= 0 ? '+' : ''}{varTot.toFixed(1)}%
                        </span>
                        <TendIcon size={11} style={{ color: corDif }} />
                      </div>
                    )}
                  </td>
                )
              })()}
              <td className="px-4 py-2.5 text-right">
                <span className="text-[14px] font-medium" style={{ color: '#8b92a8' }}>100%</span>
              </td>
              <td />
            </tr>
            {resumo.quantidadeAte80 > 0 && (
              <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                <td colSpan={modoComparativo ? 7 : 5} className="px-5 py-2 text-right">
                  <span className="text-[14px]" style={{ color: '#8b92a8' }}>
                    ★ <span className="font-semibold" style={{ color: cor }}>
                      {resumo.quantidadeAte80} de {resumo.quantidadeCategorias}
                    </span>{' '}
                    categorias respondem por <span className="font-semibold" style={{ color: cor }}>~80%</span>
                  </span>
                </td>
              </tr>
            )}
          </tfoot>
        </table>
      </div>
    </div>
  )
}

/**
 * Cards de resumo do Paretto
 */
function CardResumoParetto({
  resumo,
  tipo,
  cor,
  oculto = false,
}: {
  resumo: ResumoParetto
  tipo: 'RECEITA' | 'DESPESA'
  cor: string
  oculto?: boolean
}) {
  if (resumo.quantidadeCategorias === 0) return null

  const Icon = tipo === 'RECEITA' ? TrendingUp : TrendingDown

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {/* ícone de tendência usado no card de tipo */}
      <span className="sr-only"><Icon size={0}/></span>
      {/* Card 1: % de categorias que causam 80% */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-lg px-4 py-3">
        <p className="text-[13px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>
          Categorias 80%
        </p>
        <p className="text-[20px] font-bold" style={{ color: cor }}>
          {resumo.quantidadeAte80}
          <span className="text-[15px] ml-1" style={{ color: '#8b92a8' }}>/ {resumo.quantidadeCategorias}</span>
        </p>
        <p className="text-[14px] mt-1" style={{ color: '#8b92a8' }}>
          {resumo.percentualCategorias80.toFixed(0)}% das categorias
        </p>
      </div>

      {/* Card 2: Total 80% */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-lg px-4 py-3">
        <p className="text-[13px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>
          Valor 80%
        </p>
        <p className="text-[18px] font-bold" style={{ color: cor }}>
          {oculto ? '??????' : formatBRL(resumo.itensAte80.reduce((s, i) => s + i.total, 0))}
        </p>
        <p className="text-[14px] mt-1" style={{ color: '#8b92a8' }}>
          ~80% do volume
        </p>
      </div>

      {/* Card 3: % de categorias que causam 20% */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-lg px-4 py-3">
        <p className="text-[13px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>
          Categorias 20%
        </p>
        <p className="text-[20px] font-bold" style={{ color: '#4a5168' }}>
          {resumo.quantidadeAlem80}
          <span className="text-[15px] ml-1" style={{ color: '#8b92a8' }}>/ {resumo.quantidadeCategorias}</span>
        </p>
        <p className="text-[14px] mt-1" style={{ color: '#8b92a8' }}>
          {resumo.percentualCategorias20.toFixed(0)}% das categorias
        </p>
      </div>

      {/* Card 4: Total 20% */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-lg px-4 py-3">
        <p className="text-[13px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>
          Valor 20%
        </p>
        <p className="text-[18px] font-bold" style={{ color: '#4a5168' }}>
          {oculto ? '??????' : formatBRL(resumo.itensAlem80.reduce((s, i) => s + i.total, 0))}
        </p>
        <p className="text-[14px] mt-1" style={{ color: '#8b92a8' }}>
          ~20% do volume
        </p>
      </div>
    </div>
  )
}

export default function ParetoChart({
  receitas,
  despesas,
  oculto = false,
  onClickCategoria,
  receitasAnteriores,
  despesasAnteriores,
  labelAtual,
  labelAnterior,
}: ParetoChartProps) {
  const resumoReceitas = useMemo(() => calcularParetto(receitas, 'RECEITA'), [receitas])
  const resumoDespesas = useMemo(() => calcularParetto(despesas, 'DESPESA'), [despesas])

  // Maps de comparação: chave (categoria_id ?? '__sem__') → total no período anterior
  const mapRecAnt = useMemo(() => {
    if (!receitasAnteriores) return undefined
    const m = new Map<string, number>()
    receitasAnteriores.forEach(c => m.set(c.categoria_id ?? '__sem__', (m.get(c.categoria_id ?? '__sem__') ?? 0) + c.total))
    return m
  }, [receitasAnteriores])
  const mapDespAnt = useMemo(() => {
    if (!despesasAnteriores) return undefined
    const m = new Map<string, number>()
    despesasAnteriores.forEach(c => m.set(c.categoria_id ?? '__sem__', (m.get(c.categoria_id ?? '__sem__') ?? 0) + c.total))
    return m
  }, [despesasAnteriores])
  const totalRecAnt  = useMemo(() => receitasAnteriores?.reduce((s, c) => s + c.total, 0) ?? 0, [receitasAnteriores])
  const totalDespAnt = useMemo(() => despesasAnteriores?.reduce((s, c) => s + c.total, 0) ?? 0, [despesasAnteriores])

  return (
    <div className="space-y-6">
      {/* RECEITAS */}
      {resumoReceitas.quantidadeCategorias > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-[18px] font-bold mb-2" style={{ color: '#00c896' }}>
              📈 Receitas — Análise Paretto
            </h3>
            <p className="text-[15px]" style={{ color: '#8b92a8' }}>
              {resumoReceitas.quantidadeAte80} categorias (~ {resumoReceitas.percentualCategorias80.toFixed(0)}%) causam ~80% das receitas
            </p>
          </div>
          <CardResumoParetto resumo={resumoReceitas} tipo="RECEITA" cor="#00c896" oculto={oculto} />
          <TabelaParetto
            resumo={resumoReceitas}
            titulo="Receitas por Impacto"
            cor="#00c896"
            oculto={oculto}
            onClickCategoria={onClickCategoria}
            anteriores={mapRecAnt}
            totalAnterior={totalRecAnt}
            labelAtual={labelAtual}
            labelAnterior={labelAnterior}
          />
        </div>
      )}

      {/* DESPESAS */}
      {resumoDespesas.quantidadeCategorias > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-[18px] font-bold mb-2" style={{ color: '#f87171' }}>
              📉 Despesas — Análise Paretto
            </h3>
            <p className="text-[15px]" style={{ color: '#8b92a8' }}>
              {resumoDespesas.quantidadeAte80} categorias (~ {resumoDespesas.percentualCategorias80.toFixed(0)}%) causam ~80% das despesas
            </p>
          </div>
          <CardResumoParetto resumo={resumoDespesas} tipo="DESPESA" cor="#f87171" oculto={oculto} />
          <TabelaParetto
            resumo={resumoDespesas}
            titulo="Despesas por Impacto"
            cor="#f87171"
            oculto={oculto}
            onClickCategoria={onClickCategoria}
            anteriores={mapDespAnt}
            totalAnterior={totalDespAnt}
            labelAtual={labelAtual}
            labelAnterior={labelAnterior}
          />
        </div>
      )}

      {/* Estado vazio */}
      {resumoReceitas.quantidadeCategorias === 0 && resumoDespesas.quantidadeCategorias === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[16px]" style={{ color: '#8b92a8' }}>
            Nenhuma categoria encontrada para o período selecionado
          </p>
        </div>
      )}
    </div>
  )
}
