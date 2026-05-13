// src/components/ui/FiltrosLancamentos.tsx
// Componente unificado: Conta + Categoria + Status + Filtros salvos.
// Usado em DashboardPage, LancamentosPage (extrato) e RelatoriosPage.
//
// Os campos extras (comSaldo, incluirTransf, etc.) ficam fora — cada página
// renderiza separadamente — mas são serializados junto no FiltroSalvo via
// prop `extras`.
import type { ReactNode } from 'react'
import { useContas } from '../../hooks/useContas'
import { useCategorias } from '../../hooks/useCategorias'
import { MultiSelect } from './MultiSelect'
import { FiltrosSalvosBtn } from './FiltrosSalvosBtn'
import { STATUS_OPCOES } from '../../lib/utils'

interface Props {
  pagina: 'dashboard' | 'extrato' | 'relatorios'
  filtContas: string[]
  filtCats:   string[]
  filtStatus: string[]
  setFiltContas: (v: string[]) => void
  setFiltCats:   (v: string[]) => void
  setFiltStatus: (v: string[]) => void
  /** Campos extras a salvar/restaurar no FiltroSalvo (ex.: comSaldo, incluirTransf). */
  extras?: Record<string, unknown>
  /** Callback quando um filtro salvo é aplicado — recebe o objeto `dados` inteiro. */
  onAplicarExtras?: (dados: Record<string, unknown>) => void
  /** Callback de "Limpar filtros" — para zerar os campos extras. */
  onLimparExtras?: () => void
  /** Sinalizador adicional para "tem filtro ativo" (ex.: !comSaldo, incluirTransf). */
  extrasFiltroAtivo?: boolean
  classNameContas?: string
  classNameCats?:   string
  classNameStatus?: string
  /** Nó renderizado entre o filtro de status e o botão de filtros salvos. */
  slotAposStatus?: ReactNode
}

export function FiltrosLancamentos({
  pagina,
  filtContas, filtCats, filtStatus,
  setFiltContas, setFiltCats, setFiltStatus,
  extras, onAplicarExtras, onLimparExtras, extrasFiltroAtivo,
  classNameContas = 'w-40',
  classNameCats   = 'w-44',
  classNameStatus = 'w-36',
  slotAposStatus,
}: Props) {
  const { contas }     = useContas()
  const { categorias } = useCategorias()

  const catsPai = categorias.filter(c => !c.id_pai && !c.protegida && c.ativa)
  const catsSub = categorias.filter(c => !!c.id_pai && c.ativa)

  return (
    <>
      <MultiSelect
        placeholder="Todas as contas"
        className={classNameContas}
        values={filtContas}
        onChange={setFiltContas}
        options={contas.filter(c => c.ativa).map(c => ({
          value: c.conta_id,
          label: c.nome,
          cor:   c.cor ?? undefined,
        }))}
      />

      <MultiSelect
        placeholder="Categorias"
        className={classNameCats}
        values={filtCats}
        onChange={setFiltCats}
        options={[
          ...catsPai.map(p => ({
            value: p.id,
            label: p.descricao,
            icone: p.icone ?? undefined,
            cor:   p.cor   ?? undefined,
          })),
          ...catsSub.map(s => {
            const pai = catsPai.find(p => p.id === s.id_pai)
            return {
              value: s.id,
              label: s.descricao,
              icone: s.icone ?? undefined,
              cor:   s.cor   ?? undefined,
              grupo: pai?.descricao ?? '',
              idPai: s.id_pai ?? undefined,
            }
          }),
        ]}
      />

      <MultiSelect
        placeholder="Todos status"
        className={classNameStatus}
        values={filtStatus}
        onChange={setFiltStatus}
        options={STATUS_OPCOES}
      />

      {slotAposStatus}

      <FiltrosSalvosBtn
        pagina={pagina}
        filtAtual={{ filtContas, filtCats, filtStatus, ...(extras ?? {}) }}
        temFiltroAtivo={
          filtContas.length > 0 ||
          filtCats.length   > 0 ||
          filtStatus.length > 0 ||
          !!extrasFiltroAtivo
        }
        onAplicar={d => {
          setFiltContas((d.filtContas as string[]) ?? [])
          setFiltCats((d.filtCats   as string[]) ?? [])
          setFiltStatus((d.filtStatus as string[]) ?? [])
          onAplicarExtras?.(d)
        }}
        onLimpar={() => {
          setFiltContas([])
          setFiltCats([])
          setFiltStatus([])
          onLimparExtras?.()
        }}
      />
    </>
  )
}
