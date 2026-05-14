// src/components/relatorios/ParetoChart.tsx
import { useMemo } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { formatBRL } from '../../lib/utils'
import { calcularParetto, getCorParetto, type ResumoParetto } from '../../lib/paretoAnalysis'

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
  return (
    <div className="bg-[#1a1f2e] border border-white/10 rounded-xl overflow-hidden">
      {/* Cabeçalho */}
      <div className="px-5 py-3 border-b border-white/10" style={{ background: 'rgba(255,255,255,0.02)' }}>
        <p className="text-[12px] font-bold uppercase tracking-wider" style={{ color: cor }}>
          {titulo}
        </p>
      </div>

      {/* Corpo da tabela */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ background: 'rgba(255,255,255,0.01)' }}>
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
            {resumo.itens.map((item, idx) => (
              <tr
                key={`${item.categoria_id}-${idx}`}
                onClick={() => onClickCategoria?.(item.categoria_id, item.categoria_nome)}
                className="border-b border-white/5 hover:bg-white/[0.04] transition-colors cursor-pointer"
              >
                <td className="px-4 py-3">
                  <span className="text-[11px]" style={{ color: '#e8eaf0' }}>
                    {item.categoria_nome}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="text-[11px] font-semibold" style={{ color: cor }}>
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
                        opacity: 0.6,
                      }}
                    />
                    <span className="text-[10px]" style={{ color: '#8b92a8', minWidth: 30, textAlign: 'right' }}>
                      {item.percentualAcumulado.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Resumo no footer */}
      <div className="px-5 py-3 border-t border-white/5" style={{ background: 'rgba(255,255,255,0.01)' }}>
        <p className="text-[10px]" style={{ color: '#8b92a8' }}>
          <span className="font-semibold">Total:</span> {oculto ? '??????' : formatBRL(resumo.total)}
        </p>
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
