// src/components/relatorios/ParetoChart.tsx
import { useMemo } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatBRL } from '../../lib/utils'
import { calcularParetto, type ResumoParetto } from '../../lib/paretoAnalysis'

interface ParetoChartProps {
  receitas: Array<{ categoria_id: string | null; categoria_nome: string; total: number }>
  despesas: Array<{ categoria_id: string | null; categoria_nome: string; total: number }>
  oculto?: boolean
  onClickCategoria?: (categoriaId: string | null, categoriaNome: string) => void
}

/**
 * Renderiza tabela com os itens de uma categoria no Paretto
 */
function TabelaParetto({
  resumo,
  titulo,
  cor,
  oculto = false,
  onClickCategoria,
}: {
  resumo: ResumoParetto
  titulo: string
  cor: string
  oculto?: boolean
  onClickCategoria?: (id: string | null, nome: string) => void
}) {
  // Itens dentro dos 80% (regra clássica, incluindo o que faz cruzar):
  // `resumo.quantidadeAte80` é a contagem. Os primeiros N itens ordenados
  // são os que compõem ~80% do volume — destacados visualmente.
  const ultimoIdxAte80 = resumo.quantidadeAte80 - 1

  return (
    <div className="bg-[#1a1f2e] border border-white/10 rounded-xl overflow-hidden">
      {/* Cabeçalho */}
      <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between gap-3 flex-wrap" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: cor }}>
          {titulo}
        </p>
        {resumo.quantidadeAte80 > 0 && (
          <span
            className="text-[10px] font-bold px-2 py-0.5 rounded-full"
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
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Categoria</span>
              </th>
              <th className="px-4 py-2.5 text-right border-b border-white/5">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Valor</span>
              </th>
              <th className="px-4 py-2.5 text-right border-b border-white/5">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>%</span>
              </th>
              <th className="px-4 py-2.5 text-right border-b border-white/5">
                <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: '#8b92a8' }}>Acumulado</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {resumo.itens.map((item, idx) => {
              const dentro80    = idx <= ultimoIdxAte80
              const ultimo80    = idx === ultimoIdxAte80                              // a linha que completa os 80%
              const primeiroFora = idx === ultimoIdxAte80 + 1 && ultimoIdxAte80 >= 0   // primeira linha "abaixo do corte"

              return (
                <tr
                  key={`${item.categoria_id}-${idx}`}
                  onClick={() => onClickCategoria?.(item.categoria_id, item.categoria_nome)}
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
                      <span title="Faz parte dos 80%" style={{ color: cor }} className="text-[11px]">★</span>
                    )}
                  </td>
                  <td className="pl-2 pr-4 py-3">
                    <span className="text-[11px]" style={{ color: dentro80 ? '#e8eaf0' : '#8b92a8', fontWeight: dentro80 ? 600 : 400 }}>
                      {item.categoria_nome}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-[11px] font-semibold" style={{ color: dentro80 ? cor : '#8b92a8' }}>
                      {oculto ? '??????' : formatBRL(item.total)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-[10px] font-medium" style={{ color: '#8b92a8' }}>
                      {item.percentual.toFixed(1)}%
                    </span>
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
                      <span className="text-[10px]" style={{ color: dentro80 ? '#c5cad8' : '#8b92a8', minWidth: 30, textAlign: 'right', fontWeight: dentro80 ? 600 : 400 }}>
                        {item.percentualAcumulado.toFixed(0)}%
                      </span>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            {/* Total alinhado com a coluna "Valor" */}
            <tr style={{ background: 'rgba(255,255,255,0.02)', borderTop: '2px solid rgba(255,255,255,0.1)' }}>
              <td className="w-[28px]" />
              <td className="pl-2 pr-4 py-2.5">
                <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#c5cad8' }}>
                  Total
                </span>
              </td>
              <td className="px-4 py-2.5 text-right">
                <span className="text-[12px] font-bold" style={{ color: cor }}>
                  {oculto ? '??????' : formatBRL(resumo.total)}
                </span>
              </td>
              <td className="px-4 py-2.5 text-right">
                <span className="text-[10px] font-medium" style={{ color: '#8b92a8' }}>100%</span>
              </td>
              <td />
            </tr>
            {resumo.quantidadeAte80 > 0 && (
              <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
                <td colSpan={5} className="px-5 py-2 text-right">
                  <span className="text-[10px]" style={{ color: '#8b92a8' }}>
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
        <p className="text-[9px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>
          Categorias 80%
        </p>
        <p className="text-[16px] font-bold" style={{ color: cor }}>
          {resumo.quantidadeAte80}
          <span className="text-[11px] ml-1" style={{ color: '#8b92a8' }}>/ {resumo.quantidadeCategorias}</span>
        </p>
        <p className="text-[10px] mt-1" style={{ color: '#8b92a8' }}>
          {resumo.percentualCategorias80.toFixed(0)}% das categorias
        </p>
      </div>

      {/* Card 2: Total 80% */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-lg px-4 py-3">
        <p className="text-[9px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>
          Valor 80%
        </p>
        <p className="text-[14px] font-bold" style={{ color: cor }}>
          {oculto ? '??????' : formatBRL(resumo.itensAte80.reduce((s, i) => s + i.total, 0))}
        </p>
        <p className="text-[10px] mt-1" style={{ color: '#8b92a8' }}>
          ~80% do volume
        </p>
      </div>

      {/* Card 3: % de categorias que causam 20% */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-lg px-4 py-3">
        <p className="text-[9px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>
          Categorias 20%
        </p>
        <p className="text-[16px] font-bold" style={{ color: '#4a5168' }}>
          {resumo.quantidadeAlem80}
          <span className="text-[11px] ml-1" style={{ color: '#8b92a8' }}>/ {resumo.quantidadeCategorias}</span>
        </p>
        <p className="text-[10px] mt-1" style={{ color: '#8b92a8' }}>
          {resumo.percentualCategorias20.toFixed(0)}% das categorias
        </p>
      </div>

      {/* Card 4: Total 20% */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-lg px-4 py-3">
        <p className="text-[9px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>
          Valor 20%
        </p>
        <p className="text-[14px] font-bold" style={{ color: '#4a5168' }}>
          {oculto ? '??????' : formatBRL(resumo.itensAlem80.reduce((s, i) => s + i.total, 0))}
        </p>
        <p className="text-[10px] mt-1" style={{ color: '#8b92a8' }}>
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
}: ParetoChartProps) {
  const resumoReceitas = useMemo(() => calcularParetto(receitas, 'RECEITA'), [receitas])
  const resumoDespesas = useMemo(() => calcularParetto(despesas, 'DESPESA'), [despesas])

  return (
    <div className="space-y-6">
      {/* RECEITAS */}
      {resumoReceitas.quantidadeCategorias > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-[14px] font-bold mb-2" style={{ color: '#00c896' }}>
              📈 Receitas — Análise Paretto
            </h3>
            <p className="text-[11px]" style={{ color: '#8b92a8' }}>
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
          />
        </div>
      )}

      {/* DESPESAS */}
      {resumoDespesas.quantidadeCategorias > 0 && (
        <div className="space-y-3">
          <div>
            <h3 className="text-[14px] font-bold mb-2" style={{ color: '#f87171' }}>
              📉 Despesas — Análise Paretto
            </h3>
            <p className="text-[11px]" style={{ color: '#8b92a8' }}>
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
          />
        </div>
      )}

      {/* Estado vazio */}
      {resumoReceitas.quantidadeCategorias === 0 && resumoDespesas.quantidadeCategorias === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <p className="text-[12px]" style={{ color: '#8b92a8' }}>
            Nenhuma categoria encontrada para o período selecionado
          </p>
        </div>
      )}
    </div>
  )
}
