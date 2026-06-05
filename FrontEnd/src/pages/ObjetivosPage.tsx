import { useState } from 'react'
import { Plus, RefreshCw } from 'lucide-react'
import { useObjetivos } from '../hooks/useObjetivos'
import { CardObjetivo } from '../components/ui/CardObjetivo'
import { DrawerObjetivo } from '../components/ui/DrawerObjetivo'
import { Toast, ModalExcluir } from '../components/ui/shared'
import LoadingMascote from '../components/ui/LoadingMascote'
import type { Objetivo, TipoObjetivo, StatusObjetivo } from '../types'
import type { CriarObjetivoInput, EditarObjetivoInput } from '../hooks/useObjetivos'

const TIPO_TABS: { value: TipoObjetivo | 'TODOS'; label: string }[] = [
  { value: 'TODOS',       label: 'Todos'         },
  { value: 'SONHO',       label: '💭 Sonhos'      },
  { value: 'OBJETIVO',    label: '🎯 Objetivos'   },
  { value: 'PROJETO',     label: '📦 Projetos'    },
  { value: 'CRESCIMENTO', label: '📈 Crescimento' },
]

const TEMAS: { tipo: TipoObjetivo; emoji: string; label: string }[] = [
  { tipo: 'SONHO',       emoji: '💭', label: 'Sonhos'       },
  { tipo: 'OBJETIVO',    emoji: '🎯', label: 'Objetivos'    },
  { tipo: 'PROJETO',     emoji: '📦', label: 'Projetos'     },
  { tipo: 'CRESCIMENTO', emoji: '📈', label: 'Crescimento'  },
]

const STATUS_OPCOES: { value: StatusObjetivo | ''; label: string }[] = [
  { value: '',             label: 'Qualquer status' },
  { value: 'EM_PROGRESSO', label: 'Em progresso'    },
  { value: 'ATINGIDO',     label: 'Atingido'         },
  { value: 'CANCELADO',    label: 'Cancelado'        },
]

export default function ObjetivosPage() {
  const [tipoFiltro,   setTipoFiltro]   = useState<TipoObjetivo | 'TODOS'>('TODOS')
  const [statusFiltro, setStatusFiltro] = useState<StatusObjetivo | ''>('')
  const [drawerAberto, setDrawerAberto] = useState(false)
  const [editando,     setEditando]     = useState<Objetivo | null>(null)
  const [excluindo,    setExcluindo]    = useState<Objetivo | null>(null)
  const [toast,        setToast]        = useState<string | null>(null)
  const [sincronizando, setSincronizando] = useState(false)

  const filtros = {
    ...(tipoFiltro !== 'TODOS' ? { tipo: tipoFiltro } : {}),
    ...(statusFiltro           ? { status: statusFiltro } : {}),
  }

  const { objetivos, loading, error, criar, editar, excluir, sincronizar } = useObjetivos(filtros)

  function showToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  function abrirNovo() { setEditando(null); setDrawerAberto(true) }

  function abrirEditar(o: Objetivo) { setEditando(o); setDrawerAberto(true) }

  async function onSalvar(
    payload: CriarObjetivoInput | EditarObjetivoInput,
    id?: string,
  ): Promise<{ ok: boolean; erro: string | null }> {
    const res = id
      ? await editar(id, payload as EditarObjetivoInput)
      : await criar(payload as CriarObjetivoInput)
    if (res.ok) showToast(id ? 'Objetivo atualizado!' : 'Objetivo criado!')
    return { ok: res.ok, erro: res.erro }
  }

  async function confirmarExclusao() {
    if (!excluindo) return
    const res = await excluir(excluindo.id)
    if (res.ok) showToast('Objetivo cancelado.')
    else showToast(res.erro ?? 'Erro ao cancelar')
    setExcluindo(null)
  }

  async function onSincronizar() {
    setSincronizando(true)
    const res = await sincronizar()
    setSincronizando(false)
    if (res.ok) showToast(`${res.dados?.sincronizados ?? 0} objetivo(s) sincronizado(s).`)
    else showToast(res.erro ?? 'Erro ao sincronizar')
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-[22px] font-bold text-white">Objetivos Financeiros</h1>
          <p className="text-[14px] mt-0.5" style={{ color: '#8b92a8' }}>
            Sonhos, metas recorrentes e orçamentos de projeto
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onSincronizar} disabled={sincronizando}
            title="Sincronizar progresso"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-white/10
              text-[13px] transition-all hover:border-white/25 disabled:opacity-50"
            style={{ color: '#8b92a8' }}>
            <RefreshCw size={13} className={sincronizando ? 'animate-spin' : ''} />
            Sincronizar
          </button>
          <button onClick={abrirNovo}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-[14px] font-medium
              bg-av-green/15 border border-av-green/30 text-av-green hover:bg-av-green/25 transition-all">
            <Plus size={15} />
            Novo objetivo
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {/* Tabs de tipo */}
        <div className="flex gap-1 bg-[#1a1f2e] rounded-lg p-1 border border-white/5">
          {TIPO_TABS.map(t => (
            <button key={t.value} onClick={() => setTipoFiltro(t.value)}
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
        <select value={statusFiltro} onChange={e => setStatusFiltro(e.target.value as StatusObjetivo | '')}
          className="bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-2 text-[13px]
            outline-none transition-colors hover:border-white/25"
          style={{ color: statusFiltro ? '#e8eaf0' : '#8b92a8', colorScheme: 'dark' }}>
          {STATUS_OPCOES.map(s => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Conteúdo */}
      {loading ? (
        <div className="flex justify-center py-20">
          <LoadingMascote texto="Carregando objetivos…" size={120} />
        </div>
      ) : error ? (
        <p className="text-center py-16 text-red-400 text-[14px]">{error}</p>
      ) : objetivos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <span className="text-[48px]">🎯</span>
          <p className="text-[16px] font-medium text-white/70">Nenhum objetivo encontrado</p>
          <p className="text-[13px]" style={{ color: '#8b92a8' }}>
            Crie sonhos, metas de renda ou orçamentos de projeto.
          </p>
          <button onClick={abrirNovo}
            className="mt-2 flex items-center gap-1.5 px-4 py-2 rounded-lg text-[14px] font-medium
              bg-av-green/15 border border-av-green/30 text-av-green hover:bg-av-green/25 transition-all">
            <Plus size={15} />
            Criar primeiro objetivo
          </button>
        </div>
      ) : tipoFiltro !== 'TODOS' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {objetivos.map(o => (
            <CardObjetivo key={o.id} objetivo={o}
              onEditar={abrirEditar}
              onExcluir={setExcluindo} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {TEMAS.map(tema => {
            const lista = objetivos.filter(o => o.tipo === tema.tipo)
            if (lista.length === 0) return null
            return (
              <section key={tema.tipo}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-[18px]">{tema.emoji}</span>
                  <h2 className="text-[15px] font-semibold text-white/80">{tema.label}</h2>
                  <span className="text-[12px] px-1.5 py-0.5 rounded-full bg-white/5 text-white/40">
                    {lista.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                  {lista.map(o => (
                    <CardObjetivo key={o.id} objetivo={o}
                      onEditar={abrirEditar}
                      onExcluir={setExcluindo} />
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {/* Drawer criar/editar */}
      <DrawerObjetivo
        open={drawerAberto}
        objetivo={editando}
        onClose={() => setDrawerAberto(false)}
        onSalvar={onSalvar}
      />

      {/* Modal de exclusão (cancelamento lógico) */}
      {excluindo && (
        <ModalExcluir
          nome={excluindo.nome}
          mensagem="O objetivo será marcado como cancelado."
          onConfirmar={confirmarExclusao}
          onCancelar={() => setExcluindo(null)}
          salvando={false}
        />
      )}

      <Toast msg={toast} />
    </div>
  )
}
