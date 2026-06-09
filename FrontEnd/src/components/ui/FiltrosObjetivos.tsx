import type { TipoObjetivo, StatusObjetivo } from '../../types'

const TIPO_TABS: { value: TipoObjetivo | 'TODOS'; label: string }[] = [
  { value: 'TODOS',       label: 'Todos'         },
  { value: 'SONHO',       label: '💭 Sonhos'      },
  { value: 'OBJETIVO',    label: '🎯 Objetivos'   },
  { value: 'PROJETO',     label: '📦 Projetos'    },
  { value: 'CRESCIMENTO', label: '📈 Crescimento' },
]

const STATUS_OPCOES: { value: StatusObjetivo | ''; label: string }[] = [
  { value: '',             label: 'Qualquer status' },
  { value: 'EM_PROGRESSO', label: 'Em progresso'    },
  { value: 'ATINGIDO',     label: 'Atingido'        },
  { value: 'CANCELADO',    label: 'Cancelado'       },
]

type Props = {
  tipoFiltro:    TipoObjetivo | 'TODOS'
  statusFiltro:  StatusObjetivo | ''
  onTipoChange:  (tipo: TipoObjetivo | 'TODOS') => void
  onStatusChange:(status: StatusObjetivo | '') => void
}

export function FiltrosObjetivos({ tipoFiltro, statusFiltro, onTipoChange, onStatusChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2 mb-5" data-tutorial="filtros-objetivos">
      {/* Tabs de tipo */}
      <div className="flex gap-1 bg-[#1a1f2e] rounded-lg p-1 border border-white/5">
        {TIPO_TABS.map(t => (
          <button key={t.value} onClick={() => onTipoChange(t.value)}
            className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-all ${
              tipoFiltro === t.value
                ? 'bg-av-green/15 text-av-green border border-av-green/30'
                : 'text-white/50 hover:text-white/80'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filtro de status */}
      <select
        value={statusFiltro}
        onChange={e => onStatusChange(e.target.value as StatusObjetivo | '')}
        className="bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-2 text-[13px]
          outline-none transition-colors hover:border-white/25"
        style={{ color: statusFiltro ? '#e8eaf0' : '#8b92a8', colorScheme: 'dark' }}>
        {STATUS_OPCOES.map(s => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </div>
  )
}
