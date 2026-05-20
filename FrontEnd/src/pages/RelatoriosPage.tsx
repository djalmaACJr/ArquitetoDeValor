// src/pages/RelatoriosPage.tsx
import { useState, useMemo, useCallback, useRef, useEffect, Fragment } from 'react'
import { ChevronDown, ChevronRight, Download, RefreshCw, Filter, Pencil } from 'lucide-react'
import DrawerLancamento from '../components/ui/DrawerLancamento'
import LoadingMascote from '../components/ui/LoadingMascote'
import MascoteTutorial from '../components/ui/MascoteTutorial'
import ParetoChart from '../components/relatorios/ParetoChart'

import { apiFetch } from '../lib/api'
import { formatBRL, mesLabel, STATUS_LABEL, STATUS_COR, STATUS_BG } from '../lib/utils'
import { usePageState } from '../context/PageStateContext'
import { useCategorias } from '../hooks/useCategorias'
import { useOcultarValores } from '../hooks/useOcultarValores'
import { FiltrosLancamentos } from '../components/ui/FiltrosLancamentos'
import { MonthPicker } from '../components/ui/MonthPicker'
import { BotaoOcultar } from '../components/ui/BotaoOcultar'
import BotaoExpandirTodas from '../components/relatorios/BotaoExpandirTodas'
import { useExpansaoCategoria, paiPorCategoriaId } from '../lib/agrupamentoCategoria'

// -- Tipos -----------------------------------------------------
interface Lancamento {
  id: string
  tipo: 'RECEITA' | 'DESPESA'
  status: 'PAGO' | 'PENDENTE' | 'PROJECAO'
  valor: number
  data: string
  descricao: string
  categoria_id: string | null
  categoria_nome: string | null
  categoria_pai_nome: string | null
  conta_id: string
  conta_nome?: string
  id_par_transferencia: string | null
}

interface DescricaoRow {
  descricao: string
  porMes: Record<string, number>
  total: number
}

interface CelulaCategoria {
  categoria_id: string | null
  categoria_nome: string
  categoria_pai_id: string | null
  categoria_pai_nome: string | null
  tipo: 'RECEITA' | 'DESPESA'
  porMes: Record<string, number>
  total: number
  porDescricao: DescricaoRow[]
}

interface GrupoPai {
  nome: string
  tipo: 'RECEITA' | 'DESPESA'
  subcategorias: CelulaCategoria[]
  totalPorMes: Record<string, number>
  total: number
  aberto: boolean
}

interface GrupoDescricao {
  descricao: string
  lancamentos: Lancamento[]
  total: number
  qtd: number
}

// -- Helpers ----------------------------------------------------
function gerarMeses(inicio: string, fim: string): string[] {
  const meses: string[] = []
  const [ai, mi] = inicio.split('-').map(Number)
  const [af, mf] = fim.split('-').map(Number)
  let ano = ai, mes = mi
  while (ano < af || (ano === af && mes <= mf)) {
    meses.push(`${ano}-${String(mes).padStart(2, '0')}`)
    mes++
    if (mes > 12) { mes = 1; ano++ }
  }
  return meses
}


// -- Linha expansivel -------------------------------------------
function LinhaGrupo({
  grupo, meses, oculto, onCelulaClick,
  aberto, onToggleAberto, expandidosSubs, onToggleSub,
}: {
  grupo: GrupoPai
  meses: string[]
  oculto: boolean
  onCelulaClick: (catId: string | null, catNome: string, mes: string | null, titulo: string) => void
  aberto: boolean
  onToggleAberto: () => void
  expandidosSubs: Set<string>
  onToggleSub: (key: string) => void
}) {
  const cor = grupo.tipo === 'RECEITA' ? '#00c896' : '#f87171'
  const toggleSub = onToggleSub

  return (
    <>
      {/* Linha pai — clica na linha toda para expandir/colapsar */}
      <tr
        onClick={onToggleAberto}
        className="border-b border-white/5 hover:bg-white/[0.03] transition-colors cursor-pointer"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: 'inherit', minWidth: 220 }}>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 flex items-center justify-center flex-shrink-0" style={{ color: '#8b92a8' }}>
              {aberto ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
            </span>
            <span className="text-[15px] font-bold uppercase tracking-wider" style={{ color: cor }}>
              {grupo.nome}
            </span>
          </div>
        </td>
        <td
          className="px-3 py-2.5 text-right cursor-pointer hover:bg-white/5 transition-colors"
          onClick={e => { e.stopPropagation(); onCelulaClick(null, grupo.nome, null, `${grupo.nome} - Total período`) }}
          title="Ver todos os lançamentos desta categoria no período"
        >
          <span className="text-[16px] font-bold" style={{ color: cor }}>
            {oculto ? '????' : formatBRL(grupo.total)}
          </span>
        </td>
        <td className="px-3 py-2.5 text-right border-l border-white/5">
          <span className="text-[15px] font-semibold" style={{ color: cor, opacity: 0.65 }}>
            {oculto ? '????' : formatBRL(grupo.total / meses.length)}
          </span>
        </td>
        {meses.map(m => (
          <td key={m}
            className="px-3 py-2.5 text-right cursor-pointer hover:bg-white/5 transition-colors"
            onClick={e => { e.stopPropagation(); if (grupo.totalPorMes[m]) onCelulaClick(null, grupo.nome, m, `${grupo.nome} - ${mesLabel(m)}`) }}
            title={grupo.totalPorMes[m] ? 'Ver lançamentos' : undefined}
          >
            <span className="text-[15px] font-semibold" style={{ color: grupo.totalPorMes[m] ? cor : '#4a5168' }}>
              {grupo.totalPorMes[m] ? (oculto ? '????' : formatBRL(grupo.totalPorMes[m])) : '-'}
            </span>
          </td>
        ))}
      </tr>

      {/* Subcategorias com 3º nível inline por descrição */}
      {aberto && grupo.subcategorias.map(sub => {
        const subKey = sub.categoria_id ?? sub.categoria_nome
        const subExpandido = expandidosSubs.has(subKey)
        const temDescricoes = sub.porDescricao.length > 1
        return (
          <Fragment key={subKey}>
            <tr className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
              <td className="px-4 py-2 sticky left-0 z-10" style={{ background: '#0e1320', minWidth: 220 }}>
                <div className="flex items-center gap-2 pl-3">
                  <span
                    className="w-4 h-4 flex items-center justify-center flex-shrink-0 cursor-pointer"
                    style={{ color: '#4a5168' }}
                    onClick={temDescricoes ? () => toggleSub(subKey) : undefined}
                  >
                    {temDescricoes
                      ? (subExpandido ? <ChevronDown size={11}/> : <ChevronRight size={11}/>)
                      : <span className="w-1 h-1 rounded-full block" style={{ background: cor, opacity: 0.4 }}/>
                    }
                  </span>
                  <span
                    onClick={temDescricoes ? () => toggleSub(subKey) : undefined}
                    className={`text-[15px] ${temDescricoes ? 'cursor-pointer hover:underline' : ''}`}
                    style={{ color: '#c5cad8' }}
                  >
                    {sub.categoria_nome}
                  </span>
                </div>
              </td>
              <td
                className="px-3 py-2 text-right cursor-pointer hover:bg-white/5 transition-colors"
                onClick={() => onCelulaClick(sub.categoria_id, sub.categoria_nome, null, `${sub.categoria_nome} - Total período`)}
                title="Ver todos os lançamentos desta categoria no período"
              >
                <span className="text-[15px] font-medium" style={{ color: '#e8eaf0' }}>
                  {oculto ? '????' : formatBRL(sub.total)}
                </span>
              </td>
              <td className="px-3 py-2 text-right border-l border-white/5">
                <span className="text-[15px]" style={{ color: '#8b92a8' }}>
                  {oculto ? '????' : formatBRL(sub.total / meses.length)}
                </span>
              </td>
              {meses.map(m => (
                <td key={m}
                  className="px-3 py-2 text-right cursor-pointer hover:bg-white/5 transition-colors"
                  onClick={() => { if (sub.porMes[m]) onCelulaClick(sub.categoria_id, sub.categoria_nome, m, `${sub.categoria_nome} - ${mesLabel(m)}`) }}
                  title={sub.porMes[m] ? 'Ver lançamentos' : undefined}
                >
                  <span className="text-[15px]" style={{ color: sub.porMes[m] ? '#c5cad8' : '#4a5168' }}>
                    {sub.porMes[m] ? (oculto ? '????' : formatBRL(sub.porMes[m])) : '-'}
                  </span>
                </td>
              ))}
            </tr>

            {/* 3º nível: linhas de descrição side-by-side nos meses */}
            {subExpandido && sub.porDescricao
              .slice().sort((a, b) => b.total - a.total)
              .map(d => (
                <tr key={d.descricao}
                  className="border-b border-white/[0.02] transition-colors"
                  style={{ background: 'rgba(255,255,255,0.008)' }}
                >
                  <td className="px-4 py-1.5 sticky left-0 z-10" style={{ background: 'inherit', minWidth: 220 }}>
                    <div className="flex items-center gap-2 pl-10">
                      <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: '#4a5168' }}/>
                      <span className="text-[14px] truncate" style={{ color: '#8b92a8' }}>{d.descricao}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <span className="text-[14px]" style={{ color: '#6b7280' }}>
                      {oculto ? '????' : formatBRL(d.total)}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right border-l border-white/5">
                    <span className="text-[14px]" style={{ color: '#4a5168' }}>
                      {oculto ? '????' : formatBRL(d.total / meses.length)}
                    </span>
                  </td>
                  {meses.map(m => (
                    <td key={m} className="px-3 py-1.5 text-right">
                      <span className="text-[14px]" style={{ color: d.porMes[m] ? '#8b92a8' : '#2d3348' }}>
                        {d.porMes[m] ? (oculto ? '????' : formatBRL(d.porMes[m])) : '-'}
                      </span>
                    </td>
                  ))}
                </tr>
              ))
            }
          </Fragment>
        )
      })}

      {aberto && (
        <tr className="border-b border-white/10">
          <td className="px-4 py-2 sticky left-0 z-10" style={{ background: '#0e1320', minWidth: 220 }}>
            <span className="text-[14px] font-bold uppercase tracking-widest pl-6" style={{ color: cor, opacity: 0.7 }}>
              Total - {grupo.nome}
            </span>
          </td>
          <td className="px-3 py-2 text-right">
            <span className="text-[16px] font-bold" style={{ color: cor }}>
              {oculto ? '????' : formatBRL(grupo.total)}
            </span>
          </td>
          <td className="px-3 py-2 text-right border-l border-white/5">
            <span className="text-[15px] font-bold" style={{ color: cor, opacity: 0.65 }}>
              {oculto ? '????' : formatBRL(grupo.total / meses.length)}
            </span>
          </td>
          {meses.map(m => (
            <td key={m} className="px-3 py-2 text-right">
              <span className="text-[15px] font-bold" style={{ color: grupo.totalPorMes[m] ? cor : '#4a5168' }}>
                {grupo.totalPorMes[m] ? (oculto ? '????' : formatBRL(grupo.totalPorMes[m])) : '-'}
              </span>
            </td>
          ))}
        </tr>
      )}
    </>
  )
}

// -- Pagina principal -------------------------------------------
export default function RelatoriosPage() {
  const { relatorios: pgState, setRelatorios: setPgState } = usePageState()
  const inicio       = pgState.inicio
  const fim          = pgState.fim
  const filtStatus    = pgState.filtStatus
  const filtContas    = pgState.filtContas
  const filtCats      = pgState.filtCats
  const incluirTransf = pgState.incluirTransf
  const setInicio        = (v: string)   => setPgState({ inicio: v })
  const setFim           = (v: string)   => setPgState({ fim: v })
  const setFiltStatus    = (v: string[]) => setPgState({ filtStatus: v })
  const setFiltContas    = (v: string[]) => setPgState({ filtContas: v })
  const setFiltCats      = (v: string[]) => setPgState({ filtCats: v })
  const setIncluirTransf = (v: boolean)  => setPgState({ incluirTransf: v })
  const [loading,     setLoading]     = useState(false)
  const lancamentos    = pgState.lancamentos as Lancamento[]
  const buscado        = pgState.buscado
  const { oculto, toggle: toggleOculto } = useOcultarValores()
  const [credAberto,  setCredAberto]  = useState(true)
  const [debAberto,   setDebAberto]   = useState(true)
  const [nivel,       setNivel]       = useState<1|2|3>(3)
  const [vistaPareto, setVistaPareto] = useState(false)
  // Granularidade do Pareto: 'cat' = todas categorias (incl. subs);
  // 'pai' = consolida subs no pai.
  const [paretoAgrup, setParetoAgrup] = useState<'cat' | 'pai'>('cat')
  // Estado de expansão (compartilhado via hook) — mantido fora do componente
  // do Pareto para que a exportação reflita exatamente o que está na tela.
  const expPareto = useExpansaoCategoria()
  const expandidosPareto = expPareto.expandidos
  const drillRef    = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [lancamentoEditando, setLancamentoEditando] = useState<any | null>(null)
  const [expandidosDrill,   setExpandidosDrill]    = useState<Set<string>>(new Set())

  // Estado de expansão da tabela — mantido aqui (não nos componentes filhos)
  // para que a exportação possa refletir exatamente o que está na tela.
  const [gruposAbertos,  setGruposAbertos]  = useState<Set<string>>(new Set())
  const [subsExpandidos, setSubsExpandidos] = useState<Set<string>>(new Set())
  const toggleGrupo = useCallback((nome: string) => setGruposAbertos(prev => {
    const n = new Set(prev); if (n.has(nome)) n.delete(nome); else n.add(nome); return n
  }), [])
  const toggleSub = useCallback((key: string) => setSubsExpandidos(prev => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n
  }), [])
  const [drillDown,   setDrillDown]   = useState<{
    titulo: string
    categoria_id: string | null
    categoria_nome: string
    mes: string | null  // null = todos os meses
  } | null>(null)

  const { categorias }   = useCategorias()

  const meses = useMemo(() => gerarMeses(inicio, fim), [inicio, fim])

  // -- Buscar dados ---------------------------------------------
  const buscar = useCallback(async (contasOverride?: string[]) => {
    const contas = contasOverride ?? filtContas
    setLoading(true)
    try {
      const todos: Lancamento[] = []
      await Promise.all(meses.map(async m => {
        const params = new URLSearchParams({ mes: m, per_page: '1000', saldo: 'true' })
        if (contas.length === 1) params.set('conta_id', contas[0])
        const res = await apiFetch<{ dados: Lancamento[] }>(`/transacoes?${params}`)
        const lista = (res.dados?.dados ?? res.dados ?? []) as Lancamento[]
        todos.push(...lista)
      }))
      setPgState({ lancamentos: todos, buscado: true })
      // Debug: ver estrutura dos dados
      if (todos.length > 0) {
        const ex = todos.find(l => l.categoria_id)
        console.log('[Relatório] Exemplo lançamento com categoria:', ex)
        console.log('[Relatório] Total lançamentos:', todos.length)
        const semCat = todos.filter(l => !l.categoria_id).length
        console.log('[Relatório] Sem categoria:', semCat)
      }
    } finally {
      setLoading(false)
    }
  }, [meses, filtContas, setPgState])

  // -- Processar dados ------------------------------------------
  const { grupos, totaisMes, grandTotalEntradas, grandTotalDespesas } = useMemo(() => {
    if (!buscado || lancamentos.length === 0) return {
      grupos: [], totaisMes: {} as Record<string, { entradas: number; despesas: number }>,
      grandTotalEntradas: 0, grandTotalDespesas: 0,
    }

    const isTransf = (l: Lancamento) =>
      !!l.id_par_transferencia ||
      l.descricao?.startsWith('[Transf.') ||
      l.categoria_nome === 'Transferências'

    // Helper filtro de categoria (pai ou sub)
    const catsSelecionadas = filtCats.length > 0
      ? new Set(filtCats.flatMap(id => {
          const cat = categorias.find(c => c.id === id)
          if (!cat) return [id]
          // se for pai, incluir todas as subs filhas
          if (!cat.id_pai) {
            const subs = categorias.filter(c => c.id_pai === cat.id).map(c => c.id)
            return [cat.id, ...subs]
          }
          return [cat.id]
        }))
      : null

    // Filtros
    let lista = lancamentos
    if (!incluirTransf) lista = lista.filter(l => !isTransf(l))
    if (filtStatus.length > 0) lista = lista.filter(l => filtStatus.includes(l.status))
    if (filtContas.length > 0) lista = lista.filter(l => filtContas.includes(l.conta_id))
    if (catsSelecionadas)       lista = lista.filter(l => catsSelecionadas.has(l.categoria_id ?? ''))

    // Agrupar por categoria pai -> categoria -> mes
    const mapa = new Map<string, CelulaCategoria>()

    for (const l of lista) {
      const mesLanc = l.data.slice(0, 7)
      if (!meses.includes(mesLanc)) continue

      // Chave unica por categoria - agrupamos por categoria_id para evitar colises de nome
      const key = `${l.tipo}::${l.categoria_id ?? '__sem__'}`
      if (!mapa.has(key)) {
        mapa.set(key, {
          categoria_id:      l.categoria_id,
          categoria_nome:    l.categoria_nome ?? 'Sem categoria',
          categoria_pai_id:  null,
          categoria_pai_nome: l.categoria_pai_nome,
          tipo:              l.tipo,
          porMes:            {},
          total:             0,
          porDescricao:      [],
        })
      }
      const cel = mapa.get(key)!
      cel.porMes[mesLanc] = (cel.porMes[mesLanc] ?? 0) + l.valor
      cel.total           += l.valor

      // 3º nível inline: agregar por descrição
      const desc = l.descricao || '—'
      let dRow = cel.porDescricao.find(d => d.descricao === desc)
      if (!dRow) {
        dRow = { descricao: desc, porMes: {}, total: 0 }
        cel.porDescricao.push(dRow)
      }
      dRow.porMes[mesLanc] = (dRow.porMes[mesLanc] ?? 0) + l.valor
      dRow.total           += l.valor
    }

    // Agrupar em pais
    // Regra: se tem categoria_pai_nome, o pai e categoria_pai_nome
    //        se nao tem pai, a propria categoria e o grupo pai
    //        se nao tem categoria, vai para grupo "Sem categoria" por tipo
    const paiMap = new Map<string, GrupoPai>()
    for (const cel of mapa.values()) {
      const paiNome = cel.categoria_pai_nome ?? cel.categoria_nome
      const key     = `${cel.tipo}::${paiNome}`
      if (!paiMap.has(key)) {
        paiMap.set(key, {
          nome: paiNome,
          tipo: cel.tipo,
          subcategorias: [],
          totalPorMes: {},
          total: 0,
          aberto: true,
        })
      }
      const pai = paiMap.get(key)!
      // So adiciona como subcategoria se for realmente uma sub (tem pai diferente)
      // Categorias raiz que sao o proprio grupo nao aparecem como sub duplicada
      if (cel.categoria_pai_nome) {
        // E subcategoria real
        pai.subcategorias.push(cel)
      } else {
        // E categoria raiz - aparece como sub do proprio grupo (para mostrar o valor)
        // Mas so adiciona se ainda nao esta la
        if (!pai.subcategorias.find(s => s.categoria_id === cel.categoria_id)) {
          pai.subcategorias.push(cel)
        }
      }
      for (const [m, v] of Object.entries(cel.porMes)) {
        pai.totalPorMes[m] = (pai.totalPorMes[m] ?? 0) + v
      }
      pai.total += cel.total
    }

    const grupos = [...paiMap.values()].sort((a, b) => {
      if (a.tipo !== b.tipo) return a.tipo === 'RECEITA' ? -1 : 1
      return a.nome.localeCompare(b.nome)
    })

    // Totais por mes
    const totaisMes: Record<string, { entradas: number; despesas: number }> = {}
    for (const m of meses) {
      totaisMes[m] = { entradas: 0, despesas: 0 }
      for (const g of grupos) {
        if (g.tipo === 'RECEITA') totaisMes[m].entradas += g.totalPorMes[m] ?? 0
        else totaisMes[m].despesas += g.totalPorMes[m] ?? 0
      }
    }

    const grandTotalEntradas = grupos.filter(g => g.tipo === 'RECEITA').reduce((s, g) => s + g.total, 0)
    const grandTotalDespesas = grupos.filter(g => g.tipo === 'DESPESA').reduce((s, g) => s + g.total, 0)

    return { grupos, totaisMes, grandTotalEntradas, grandTotalDespesas }
  }, [lancamentos, buscado, filtStatus, filtContas, filtCats, incluirTransf, meses, categorias])

  // Funções de exportação declaradas após `dadosPareto` para evitar
  // referência forward — ver mais adiante no arquivo.


  const resultado = grandTotalEntradas - grandTotalDespesas

  // Scroll para o painel ao abrir drill-down
  useEffect(() => {
    if (drillDown && drillRef.current) {
      setTimeout(() => {
        drillRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }, [drillDown])

  // Lancamentos do drill-down
  const lancamentosDrill = useMemo(() => {
    if (!drillDown || !buscado) return []
    let lista = lancamentos
    if (filtStatus.length > 0) lista = lista.filter(l => filtStatus.includes(l.status))
    if (filtContas.length > 0) lista = lista.filter(l => filtContas.includes(l.conta_id))
    if (filtCats.length > 0) {
      const ids = new Set(filtCats.flatMap(id => {
        const cat = categorias.find(c => c.id === id)
        if (!cat) return [id]
        if (!cat.id_pai) return [cat.id, ...categorias.filter(c => c.id_pai === cat.id).map(c => c.id)]
        return [cat.id]
      }))
      lista = lista.filter(l => ids.has(l.categoria_id ?? ''))
    }
    const isTransf = (l: Lancamento) =>
      !!l.id_par_transferencia ||
      l.descricao?.startsWith('[Transf.') ||
      l.categoria_nome === 'Transferências'
    if (!incluirTransf) lista = lista.filter(l => !isTransf(l))

    // Filtrar por categoria
    if (drillDown.categoria_id !== null) {
      lista = lista.filter(l => l.categoria_id === drillDown.categoria_id)
    } else if (drillDown.categoria_nome !== '__todos__') {
      // grupo pai - filtrar por categoria_pai_nome ou categoria_nome
      lista = lista.filter(l =>
        l.categoria_pai_nome === drillDown.categoria_nome ||
        (!l.categoria_pai_nome && l.categoria_nome === drillDown.categoria_nome)
      )
    }

    // Filtrar por mes
    if (drillDown.mes) {
      lista = lista.filter(l => l.data.startsWith(drillDown.mes!))
    } else {
      lista = lista.filter(l => meses.includes(l.data.slice(0, 7)))
    }

    return lista.sort((a, b) => a.data.localeCompare(b.data))
  }, [drillDown, lancamentos, buscado, filtStatus, filtContas, filtCats, incluirTransf, meses, categorias])

  // Grupos por descrição dentro do drill-down
  const gruposDescricao = useMemo((): GrupoDescricao[] => {
    if (!lancamentosDrill.length) return []
    const map = new Map<string, GrupoDescricao>()
    for (const l of lancamentosDrill) {
      const desc = l.descricao || '—'
      if (!map.has(desc)) map.set(desc, { descricao: desc, lancamentos: [], total: 0, qtd: 0 })
      const g = map.get(desc)!
      g.lancamentos.push(l)
      g.total += l.valor
      g.qtd++
    }
    return [...map.values()].sort((a, b) => b.total - a.total)
  }, [lancamentosDrill])

  // Dados para a análise Pareto (totais por subcategoria, mesmos filtros do relatório)
  const dadosPareto = useMemo(() => {
    if (!buscado || lancamentos.length === 0) return { receitas: [], despesas: [] }

    const isTransfP = (l: Lancamento) =>
      !!l.id_par_transferencia ||
      l.descricao?.startsWith('[Transf.') ||
      l.categoria_nome === 'Transferências'

    const catsSel = filtCats.length > 0
      ? new Set(filtCats.flatMap(id => {
          const cat = categorias.find(c => c.id === id)
          if (!cat) return [id]
          if (!cat.id_pai) return [cat.id, ...categorias.filter(c => c.id_pai === cat.id).map(c => c.id)]
          return [cat.id]
        }))
      : null

    let lista = lancamentos
    if (!incluirTransf) lista = lista.filter(l => !isTransfP(l))
    if (filtStatus.length > 0) lista = lista.filter(l => filtStatus.includes(l.status))
    if (filtContas.length > 0) lista = lista.filter(l => filtContas.includes(l.conta_id))
    if (catsSel)               lista = lista.filter(l => catsSel.has(l.categoria_id ?? ''))
    lista = lista.filter(l => meses.includes(l.data.slice(0, 7)))

    const recMap  = new Map<string, { categoria_id: string | null; categoria_nome: string; total: number }>()
    const despMap = new Map<string, { categoria_id: string | null; categoria_nome: string; total: number }>()

    // Mapa categoria_id -> { id raiz, nome raiz } usado quando paretoAgrup === 'pai'.
    // Resolve subcategoria até o pai (1 nível na hierarquia do projeto).
    const raizPorId = paiPorCategoriaId(categorias)

    for (const l of lista) {
      let key:  string
      let nome: string
      if (paretoAgrup === 'pai' && l.categoria_id) {
        const raiz = raizPorId.get(l.categoria_id)
        key  = raiz?.id   ?? l.categoria_id
        nome = raiz?.nome ?? l.categoria_nome ?? 'Sem categoria'
      } else {
        key  = l.categoria_id ?? '__sem__'
        nome = l.categoria_nome ?? 'Sem categoria'
      }
      const map = l.tipo === 'RECEITA' ? recMap : despMap
      if (!map.has(key)) map.set(key, { categoria_id: key === '__sem__' ? null : key, categoria_nome: nome, total: 0 })
      map.get(key)!.total += l.valor
    }

    return { receitas: [...recMap.values()], despesas: [...despMap.values()] }
  }, [lancamentos, buscado, filtStatus, filtContas, filtCats, incluirTransf, meses, categorias, paretoAgrup])

  /**
   * Submaps usados quando o Paretto está agrupado por categoria pai ('Resumo').
   * Para cada pai presente em `dadosPareto`, lista as subcategorias com seus
   * totais (consolidados nos mesmos filtros/período).
   *
   * IMPORTANTE: os totais são separados por tipo (RECEITA vs DESPESA) — uma
   * mesma subcategoria pode ter movimentos dos dois tipos, e o pai pode
   * aparecer em ambas as tabelas; sem essa separação as subs vazariam entre
   * Receitas e Despesas.
   *
   * Em modo 'cat' retorna mapas vazios — não há nada para expandir, pois cada
   * linha já é uma categoria.
   */
  const submapPareto = useMemo<{
    receitas: Map<string, { categoria_id: string; categoria_nome: string; total: number }[]>
    despesas: Map<string, { categoria_id: string; categoria_nome: string; total: number }[]>
    pais:     Set<string>
  }>(() => {
    const rec  = new Map<string, { categoria_id: string; categoria_nome: string; total: number }[]>()
    const desp = new Map<string, { categoria_id: string; categoria_nome: string; total: number }[]>()
    const pais = new Set<string>()
    if (paretoAgrup !== 'pai' || !buscado || lancamentos.length === 0) {
      return { receitas: rec, despesas: desp, pais }
    }

    const isTransfP = (l: Lancamento) =>
      !!l.id_par_transferencia ||
      l.descricao?.startsWith('[Transf.') ||
      l.categoria_nome === 'Transferências'

    const catsSel = filtCats.length > 0
      ? new Set(filtCats.flatMap(id => {
          const cat = categorias.find(c => c.id === id)
          if (!cat) return [id]
          if (!cat.id_pai) return [cat.id, ...categorias.filter(c => c.id_pai === cat.id).map(c => c.id)]
          return [cat.id]
        }))
      : null

    let lista = lancamentos
    if (!incluirTransf) lista = lista.filter(l => !isTransfP(l))
    if (filtStatus.length > 0) lista = lista.filter(l => filtStatus.includes(l.status))
    if (filtContas.length > 0) lista = lista.filter(l => filtContas.includes(l.conta_id))
    if (catsSel)               lista = lista.filter(l => catsSel.has(l.categoria_id ?? ''))
    lista = lista.filter(l => meses.includes(l.data.slice(0, 7)))

    // Lookup de categoria por id — usado para descobrir id_pai/descricao da sub.
    const catById = new Map<string, { id: string; nome: string; idPai: string | null }>()
    for (const c of categorias) catById.set(c.id, { id: c.id, nome: c.descricao, idPai: c.id_pai })

    // Acumula por (tipo, paiId, subId)
    const buckets = {
      RECEITA: new Map<string, Map<string, { categoria_id: string; categoria_nome: string; total: number }>>(),
      DESPESA: new Map<string, Map<string, { categoria_id: string; categoria_nome: string; total: number }>>(),
    }
    for (const l of lista) {
      if (!l.categoria_id) continue
      const cat = catById.get(l.categoria_id)
      if (!cat?.idPai) continue            // já é raiz: nada a expandir
      const paiId = cat.idPai
      const tipoBucket = buckets[l.tipo]
      if (!tipoBucket.has(paiId)) tipoBucket.set(paiId, new Map())
      const subMap = tipoBucket.get(paiId)!
      if (!subMap.has(cat.id)) subMap.set(cat.id, { categoria_id: cat.id, categoria_nome: cat.nome, total: 0 })
      subMap.get(cat.id)!.total += l.valor
      pais.add(paiId)
    }

    for (const [paiId, subMap] of buckets.RECEITA) rec.set(paiId, [...subMap.values()])
    for (const [paiId, subMap] of buckets.DESPESA) desp.set(paiId, [...subMap.values()])
    return { receitas: rec, despesas: desp, pais }
  }, [paretoAgrup, lancamentos, buscado, filtStatus, filtContas, filtCats, incluirTransf, meses, categorias])

  /**
   * Exporta a TABELA conforme está visível na tela:
   *  - Nível 1 (Resumo): só Total Receitas/Despesas/Resultado
   *  - Nível 2 (Categorias): apenas grupos pai
   *  - Nível 3 (Completo): grupos pai abertos (gruposAbertos) com subcategorias.
   *    Subs expandidas (subsExpandidos) levam junto suas descrições.
   */
  const exportarTabela = useCallback(async () => {
    if (!buscado || grupos.length === 0) return
    const { exportToExcel } = await import('../lib/exportUtils')

    const nMeses = Math.max(meses.length, 1)
    const media = (n: number) => n / nMeses

    // Colunas dinâmicas: Categoria + Total + Média + 1 por mês (todos currency)
    const columns: import('../lib/exportUtils').ExportColumn[] = [
      { key: 'cat',   label: 'Categoria',  type: 'text',     width: 38 },
      { key: 'total', label: 'Total',      type: 'currency', width: 16 },
      { key: 'media', label: 'Média/mês',  type: 'currency', width: 14 },
      ...meses.map(m => ({ key: `m_${m}`, label: mesLabel(m), type: 'currency' as const, width: 14 })),
    ]

    const linhaMes = (extra: Record<string, number>) =>
      Object.fromEntries(meses.map(m => [`m_${m}`, extra[m] ?? 0]))

    const rows: import('../lib/exportUtils').ExportRow[] = []

    if (nivel === 1) {
      rows.push({ cat: 'TOTAL RECEITAS', total: grandTotalEntradas,  media: media(grandTotalEntradas),
        ...linhaMes(Object.fromEntries(meses.map(m => [m, totaisMes[m]?.entradas ?? 0]))), _style: 'subtotal' })
      rows.push({ cat: 'TOTAL DESPESAS', total: grandTotalDespesas,  media: media(grandTotalDespesas),
        ...linhaMes(Object.fromEntries(meses.map(m => [m, totaisMes[m]?.despesas ?? 0]))), _style: 'subtotal' })
      const resultado = grandTotalEntradas - grandTotalDespesas
      rows.push({ cat: 'RESULTADO', total: resultado, media: media(resultado),
        ...linhaMes(Object.fromEntries(meses.map(m => [m, (totaisMes[m]?.entradas ?? 0) - (totaisMes[m]?.despesas ?? 0)]))), _style: 'total' })
    } else {
      for (const grupo of grupos) {
        const grupoAberto = gruposAbertos.has(grupo.nome)
        rows.push({ cat: grupo.nome, total: grupo.total, media: media(grupo.total),
          ...linhaMes(grupo.totalPorMes), _style: 'group' })

        if (nivel === 3 && grupoAberto) {
          for (const sub of grupo.subcategorias) {
            rows.push({ cat: `  ${sub.categoria_nome}`, total: sub.total, media: media(sub.total),
              ...linhaMes(sub.porMes) })

            const subKey = sub.categoria_id ?? sub.categoria_nome
            if (subsExpandidos.has(subKey)) {
              for (const d of [...sub.porDescricao].sort((a, b) => b.total - a.total)) {
                rows.push({ cat: `    ${d.descricao}`, total: d.total, media: media(d.total),
                  ...linhaMes(d.porMes) })
              }
            }
          }
          rows.push({ cat: `Total — ${grupo.nome}`, total: grupo.total, media: media(grupo.total),
            ...linhaMes(grupo.totalPorMes), _style: 'subtotal' })
        }
      }
      // Totais gerais
      rows.push({ cat: 'TOTAL RECEITAS', total: grandTotalEntradas, media: media(grandTotalEntradas),
        ...linhaMes(Object.fromEntries(meses.map(m => [m, totaisMes[m]?.entradas ?? 0]))), _style: 'subtotal' })
      rows.push({ cat: 'TOTAL DESPESAS', total: grandTotalDespesas, media: media(grandTotalDespesas),
        ...linhaMes(Object.fromEntries(meses.map(m => [m, totaisMes[m]?.despesas ?? 0]))), _style: 'subtotal' })
      const resultado = grandTotalEntradas - grandTotalDespesas
      rows.push({ cat: 'RESULTADO', total: resultado, media: media(resultado),
        ...linhaMes(Object.fromEntries(meses.map(m => [m, (totaisMes[m]?.entradas ?? 0) - (totaisMes[m]?.despesas ?? 0)]))), _style: 'total' })
    }

    const sufixoNivel = nivel === 1 ? 'resumo' : nivel === 2 ? 'categorias' : 'completo'
    await exportToExcel({
      filename: `relatorio_${sufixoNivel}_${inicio}_${fim}`,
      sheets: [{
        name:     'Relatório',
        title:    'Relatório por Categoria',
        subtitle: `${mesLabel(meses[0])} – ${mesLabel(meses[meses.length - 1])} · ${nivel === 1 ? 'Resumo' : nivel === 2 ? 'Categorias' : 'Completo'}`,
        columns,
        rows,
      }],
    })
  }, [buscado, grupos, meses, totaisMes, grandTotalEntradas, grandTotalDespesas, inicio, fim, nivel, gruposAbertos, subsExpandidos])

  /**
   * Exporta os dados da análise PARETO em 2 abas (Receitas / Despesas),
   * com %, acumulado e marcação dos itens que compõem ~80%.
   */
  const exportarPareto = useCallback(async () => {
    if (!buscado) return
    const { calcularParetto } = await import('../lib/paretoAnalysis')
    const { exportToExcel } = await import('../lib/exportUtils')

    type Col = import('../lib/exportUtils').ExportColumn
    type Row = import('../lib/exportUtils').ExportRow
    type Sheet = import('../lib/exportUtils').ExportSheet

    const sheets: Sheet[] = []
    const columns: Col[] = [
      { key: 'n',    label: '#',           type: 'integer',  width: 5  },
      { key: 'cat',  label: 'Categoria',   type: 'text',     width: 40 },
      { key: 'val',  label: 'Valor',       type: 'currency', width: 16 },
      { key: 'pct',  label: '%',           type: 'percent',  width: 10 },
      { key: 'acu',  label: '% Acumulado', type: 'percent',  width: 14 },
      { key: 'd80',  label: 'Dentro 80%',  type: 'text',     width: 12, align: 'center' },
    ]

    const montarAba = (
      lista: { categoria_id: string | null; categoria_nome: string; total: number }[],
      tipo: 'RECEITA' | 'DESPESA',
      nomeAba: string,
    ) => {
      const resumo = calcularParetto(lista, tipo)
      if (resumo.quantidadeCategorias === 0) return

      const ultimoIdxAte80 = resumo.quantidadeAte80 - 1
      const rows: Row[] = []
      resumo.itens.forEach((item, idx) => {
        rows.push({
          n:   idx + 1,
          cat: item.categoria_nome,
          val: item.total,
          pct: item.percentual          / 100,  // exceljs espera decimal 0-1 para `0.0%`
          acu: item.percentualAcumulado / 100,
          d80: idx <= ultimoIdxAte80 ? 'Sim' : 'Não',
          _style: idx <= ultimoIdxAte80 ? 'highlight' : 'normal',
        })
        // Subcategorias só entram no export se o pai estiver expandido em tela
        // (reflete exatamente o que o usuário vê). Usa o submap do MESMO tipo
        // da aba sendo montada — senão receitas/despesas vazariam entre si.
        if (paretoAgrup === 'pai' && item.categoria_id && expandidosPareto.has(item.categoria_id)) {
          const mapaSub = tipo === 'RECEITA' ? submapPareto.receitas : submapPareto.despesas
          const subs = mapaSub.get(item.categoria_id) ?? []
          subs.slice().sort((a, b) => b.total - a.total).forEach(s => {
            const pctPai = item.total > 0 ? (s.total / item.total) * 100 : 0
            rows.push({
              n:   '',
              cat: `   └ ${s.categoria_nome} (${pctPai.toFixed(1)}% da pai)`,
              val: s.total,
              pct: '', acu: '', d80: '',
              _style: 'normal',
            })
          })
        }
      })

      rows.push({
        n: '', cat: 'Total', val: resumo.total, pct: 1, acu: '', d80: '',
        _style: 'total',
      })
      rows.push({
        n: '',
        cat: `${resumo.quantidadeAte80} de ${resumo.quantidadeCategorias} categorias respondem por ~80%`,
        val: '', pct: '', acu: '', d80: '',
      })

      sheets.push({
        name:     nomeAba,
        title:    nomeAba,
        subtitle: `${mesLabel(meses[0])} – ${mesLabel(meses[meses.length - 1])}`,
        columns,
        rows,
      })
    }

    montarAba(dadosPareto.receitas, 'RECEITA', 'Pareto Receitas')
    montarAba(dadosPareto.despesas, 'DESPESA', 'Pareto Despesas')

    if (sheets.length === 0) return
    await exportToExcel({
      filename: `relatorio_pareto_${inicio}_${fim}`,
      sheets,
    })
  }, [buscado, dadosPareto, inicio, fim, meses, paretoAgrup, expandidosPareto, submapPareto])

  /** Roteador: exporta a vista atualmente visível. */
  const exportar = useCallback(() => {
    if (vistaPareto) exportarPareto()
    else             exportarTabela()
  }, [vistaPareto, exportarPareto, exportarTabela])

  // Reset expansão ao trocar de drill-down
  useEffect(() => { setExpandidosDrill(new Set()) }, [drillDown])

  // Sincroniza expansão dos grupos com o nível selecionado:
  //  - Nível 3 (Completo): todos os grupos abertos por padrão
  //  - Nível 2 (Categorias): todos fechados (subs nem aparecem)
  //  - Nível 1 (Resumo): irrelevante (tabela não mostra grupos)
  // Também limpa subs expandidas ao mudar nível ou ao re-buscar.
  useEffect(() => {
    if (nivel === 3) {
      setGruposAbertos(new Set(grupos.map(g => g.nome)))
    } else {
      setGruposAbertos(new Set())
    }
    setSubsExpandidos(new Set())
  }, [nivel, grupos])

  return (
    <div className="p-5 min-h-screen" style={{ background: '#0e1320' }}>
      {/* Topbar */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[22px] font-bold" style={{ color: '#e8eaf0' }}>Relatório por categoria</h1>
          <p className="text-[15px] mt-0.5" style={{ color: '#8b92a8' }}>Receitas e despesas agrupadas por categoria</p>
        </div>
        <BotaoOcultar oculto={oculto} onToggle={toggleOculto} />
      </div>

      <div className="mb-5">
        <MascoteTutorial pagina="relatorios" />
      </div>

      {/* Filtros */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-4 mb-5">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Periodo */}
          <div>
            <p className="text-[14px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>De</p>
            <MonthPicker value={inicio} onChange={setInicio} />
          </div>
          <div>
            <p className="text-[14px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>Até</p>
            <MonthPicker value={fim} onChange={setFim} />
          </div>

          {/* Contas + Categorias + Status + Filtros salvos (componente unificado) */}
          <div>
            <p className="text-[14px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>Filtros</p>
            <div className="flex gap-2">
              <FiltrosLancamentos
                pagina="relatorios"
                filtContas={filtContas} filtCats={filtCats} filtStatus={filtStatus}
                setFiltContas={setFiltContas} setFiltCats={setFiltCats} setFiltStatus={setFiltStatus}
                classNameContas="w-44" classNameCats="w-48" classNameStatus="w-40"
                extras={{ incluirTransf }}
                extrasFiltroAtivo={incluirTransf}
                onAplicarExtras={d => {
                  const novo = (d.incluirTransf as boolean) ?? false
                  setIncluirTransf(novo)
                  if (buscado) buscar((d.filtContas as string[]) ?? [])
                }}
                onLimparExtras={() => setIncluirTransf(false)}
              />
            </div>
          </div>

          {/* Transferencias toggle */}
          <div>
            <p className="text-[14px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>Transferências</p>
            <button
              onClick={() => setIncluirTransf(!incluirTransf)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[15px] transition-all"
              style={{
                borderColor: incluirTransf ? 'rgba(0,200,150,0.4)' : 'rgba(255,255,255,0.1)',
                background:  incluirTransf ? 'rgba(0,200,150,0.08)' : 'transparent',
                color:       incluirTransf ? '#00c896' : '#8b92a8',
              }}
            >
              <span
                className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0 transition-all"
                style={{
                  background:  incluirTransf ? '#00c896' : 'transparent',
                  borderColor: incluirTransf ? '#00c896' : 'rgba(255,255,255,0.3)',
                }}
              >
                {incluirTransf && <svg width="9" height="9" viewBox="0 0 9 9" fill="none"><path d="M1 4.5L3.5 7L8 2" stroke="#0a0f1a" strokeWidth="1.5" strokeLinecap="round"/></svg>}
              </span>
              Incluir
            </button>
          </div>

          {/* Botoes */}
          <div className="flex items-center gap-2 ml-auto flex-wrap">
            {buscado && (
              <button
                onClick={exportar}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[16px] font-semibold transition-all hover:opacity-90 border border-white/10"
                style={{ color: '#4da6ff', background: 'rgba(77,166,255,0.08)' }}
                title={
                  vistaPareto
                    ? 'Exportar análise Pareto (Receitas + Despesas) para Excel'
                    : `Exportar tabela (${nivel === 1 ? 'Resumo' : nivel === 2 ? 'Categorias' : 'Completo'}) para Excel`
                }
              >
                <Download size={13} />
                {vistaPareto ? 'Exportar Pareto' : 'Exportar tabela'}
              </button>
            )}
            <button
              onClick={() => buscar()}
              disabled={loading || meses.length === 0}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-[16px] font-semibold transition-all hover:opacity-90"
              style={{ background: '#00c896', color: '#0a0f1a', opacity: loading ? 0.7 : 1 }}
            >
              {loading
                ? <><RefreshCw size={13} className="animate-spin" /> Carregando...</>
                : <><Filter size={13} /> Gerar relatório</>
              }
            </button>
          </div>
        </div>

        {/* Info periodo */}
        {meses.length > 0 && (
          <p className="text-[14px] mt-3" style={{ color: '#4a5168' }}>
            {meses.length} {meses.length === 1 ? 'mês' : 'meses'}: {mesLabel(meses[0])} {">"} {mesLabel(meses[meses.length - 1])}
          </p>
        )}
      </div>

      {/* Tabela */}
      {buscado && !loading && (
        <>
          {/* Cards resumo */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            {[
              { label: 'Total Receitas',  valor: grandTotalEntradas, cor: '#00c896' },
              { label: 'Total Despesas',  valor: grandTotalDespesas, cor: '#f87171' },
              { label: 'Resultado',       valor: resultado,          cor: resultado >= 0 ? '#00c896' : '#f87171' },
            ].map(c => (
              <div key={c.label} className="bg-[#1a1f2e] border border-white/10 rounded-xl px-4 py-3">
                <p className="text-[14px] font-semibold uppercase tracking-wide mb-1" style={{ color: '#8b92a8' }}>{c.label}</p>
                <p className="text-[22px] font-bold" style={{ color: c.cor }}>{oculto ? '??????' : formatBRL(c.valor)}</p>
              </div>
            ))}
          </div>

          {/* Seletor de visualização */}
          <div className="flex items-center gap-4 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#4a5168' }}>Visualização</span>
              {([
                { id: false, label: 'Tabela' },
                { id: true,  label: 'Pareto' },
              ] as const).map(({ id, label }) => (
                <button
                  key={String(id)}
                  onClick={() => setVistaPareto(id)}
                  className="px-3 py-1 rounded-lg text-[15px] font-semibold transition-all border"
                  style={{
                    background:  vistaPareto === id ? 'rgba(0,200,150,0.12)' : 'transparent',
                    borderColor: vistaPareto === id ? 'rgba(0,200,150,0.4)'  : 'rgba(255,255,255,0.08)',
                    color:       vistaPareto === id ? '#00c896'               : '#8b92a8',
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Controle de detalhamento — visível apenas na vista Tabela */}
            {!vistaPareto && (
              <div className="flex items-center gap-2">
                <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#4a5168' }}>Detalhamento</span>
                {([
                  { n: 1 as const, label: 'Resumo',     title: 'Só Crédito / Débito / Resultado' },
                  { n: 2 as const, label: 'Categorias', title: 'Categorias pai sem subcategorias' },
                  { n: 3 as const, label: 'Completo',   title: 'Tudo, incluindo subcategorias'    },
                ]).map(({ n, label, title }) => (
                  <button
                    key={n}
                    title={title}
                    onClick={() => { setNivel(n); setCredAberto(n > 1); setDebAberto(n > 1) }}
                    className="px-3 py-1 rounded-lg text-[15px] font-semibold transition-all border"
                    style={{
                      background:   nivel === n ? 'rgba(0,200,150,0.12)' : 'transparent',
                      borderColor:  nivel === n ? 'rgba(0,200,150,0.4)'  : 'rgba(255,255,255,0.08)',
                      color:        nivel === n ? '#00c896'               : '#8b92a8',
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            {/* Agrupamento — visível apenas na vista Pareto */}
            {vistaPareto && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-[14px] font-semibold uppercase tracking-wider" style={{ color: '#4a5168' }}>Agrupar por</span>
                {([
                  { id: 'cat' as const, label: 'Categoria', title: 'Cada categoria (incluindo subcategorias) entra como linha separada' },
                  { id: 'pai' as const, label: 'Resumo',    title: 'Consolida as subcategorias na categoria pai · clique numa categoria para ver as subs' },
                ]).map(({ id, label, title }) => (
                  <button
                    key={id}
                    title={title}
                    onClick={() => setParetoAgrup(id)}
                    className="px-3 py-1 rounded-lg text-[15px] font-semibold transition-all border"
                    style={{
                      background:   paretoAgrup === id ? 'rgba(0,200,150,0.12)' : 'transparent',
                      borderColor:  paretoAgrup === id ? 'rgba(0,200,150,0.4)'  : 'rgba(255,255,255,0.08)',
                      color:        paretoAgrup === id ? '#00c896'               : '#8b92a8',
                    }}
                  >
                    {label}
                  </button>
                ))}
                {paretoAgrup === 'pai' && submapPareto.pais.size > 0 && (
                  <BotaoExpandirTodas
                    todasExpandidas={expPareto.todasExpandidas(submapPareto.pais)}
                    onClick={() => expPareto.todasExpandidas(submapPareto.pais)
                      ? expPareto.colapsar()
                      : expPareto.expandirTodas(submapPareto.pais)}
                  />
                )}
              </div>
            )}
          </div>

          {/* Vista Pareto */}
          {vistaPareto && (
            <ParetoChart
              receitas={dadosPareto.receitas}
              despesas={dadosPareto.despesas}
              oculto={oculto}
              onClickCategoria={(catId, catNome) =>
                setDrillDown({ titulo: `${catNome} — Pareto`, categoria_id: catId, categoria_nome: catNome, mes: null })
              }
              subsDe={paretoAgrup === 'pai'
                ? ((catId, tipo) => {
                    if (!catId) return undefined
                    const m = tipo === 'RECEITA' ? submapPareto.receitas : submapPareto.despesas
                    return m.get(catId)
                  })
                : undefined}
              expandidos={expandidosPareto}
              onToggleExp={expPareto.toggle}
            />
          )}

          {/* Tabela principal */}
          {!vistaPareto && <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              <table className="w-full border-collapse" style={{ minWidth: 600 }}>
                {/* Cabecalho */}
                <thead className="sticky top-0 z-30">
                  <tr style={{ background: '#1a1f2e' }}>
                    <th className="px-4 py-3 text-left sticky left-0 z-40 border-b border-white/10"
                      style={{ background: '#1a1f2e', minWidth: 220 }}>
                      <span className="text-[14px] font-bold uppercase tracking-widest" style={{ color: '#4a5168' }}>Categoria</span>
                    </th>
                    <th className="px-3 py-3 text-right border-b border-white/10 border-l border-white/5"
                      style={{ background: '#1a1f2e' }}>
                      <span className="text-[14px] font-bold uppercase tracking-widest" style={{ color: '#4a5168' }}>Total</span>
                    </th>
                    <th className="px-3 py-3 text-right border-b border-white/10 border-l border-white/5"
                      style={{ background: '#1a1f2e', minWidth: 96 }}>
                      <span className="text-[14px] font-bold uppercase tracking-widest" style={{ color: '#4a5168' }}>Média/mês</span>
                    </th>
                    {meses.map(m => (
                      <th key={m} className="px-3 py-3 text-right border-b border-white/10 border-l border-white/5"
                        style={{ minWidth: 100, background: '#1a1f2e' }}>
                        <span className="text-[14px] font-bold uppercase tracking-widest" style={{ color: '#4a5168' }}>
                          {mesLabel(m)}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody>
                  {/* -- CREDITOS -- */}
                  <tr
                    className="cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => setCredAberto(a => !a)}
                  >
                    <td colSpan={3 + meses.length} className="px-4 pt-4 pb-2 sticky left-0">
                      <div className="flex items-center gap-2">
                        <span style={{ color: '#00c896' }}>
                          {credAberto ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                        </span>
                        <span className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: '#00c896' }}>Créditos</span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(0,200,150,0.2)' }}/>
                      </div>
                    </td>
                  </tr>
                  {credAberto && grupos.filter(g => g.tipo === 'RECEITA').map((g, i) => (
                    <LinhaGrupo
                      key={`${i}-${nivel}`}
                      grupo={g} meses={meses} oculto={oculto}
                      aberto={gruposAbertos.has(g.nome)}
                      onToggleAberto={() => toggleGrupo(g.nome)}
                      expandidosSubs={subsExpandidos}
                      onToggleSub={toggleSub}
                      onCelulaClick={(catId, catNome, mes, titulo) => setDrillDown({ titulo, categoria_id: catId, categoria_nome: catNome, mes })} />
                  ))}
                  {/* Total Créditos — sempre visível */}
                  <tr style={{ background: nivel === 1 ? 'rgba(0,200,150,0.1)' : 'rgba(0,200,150,0.06)' }}>
                    <td className="px-4 sticky left-0 z-10"
                      style={{ background: nivel === 1 ? 'rgba(0,200,150,0.1)' : 'rgba(0,200,150,0.06)', minWidth: 220,
                               paddingTop: nivel === 1 ? '12px' : '10px', paddingBottom: nivel === 1 ? '12px' : '10px' }}>
                      <span className={`font-bold uppercase tracking-widest pl-1 ${nivel === 1 ? 'text-[16px]' : 'text-[14px]'}`}
                        style={{ color: '#00c896' }}>
                        {nivel === 1 ? 'Créditos' : 'Total Créditos'}
                      </span>
                    </td>
                    <td className="px-3 text-right"
                      style={{ paddingTop: nivel === 1 ? '12px' : '10px', paddingBottom: nivel === 1 ? '12px' : '10px' }}>
                      <span className={`font-bold ${nivel === 1 ? 'text-[18px]' : 'text-[16px]'}`} style={{ color: '#00c896' }}>
                        {oculto ? '????' : formatBRL(grandTotalEntradas)}
                      </span>
                    </td>
                    <td className="px-3 text-right border-l border-white/5"
                      style={{ paddingTop: nivel === 1 ? '12px' : '10px', paddingBottom: nivel === 1 ? '12px' : '10px' }}>
                      <span className={`font-bold ${nivel === 1 ? 'text-[16px]' : 'text-[15px]'}`} style={{ color: '#00c896', opacity: 0.65 }}>
                        {oculto ? '????' : formatBRL(grandTotalEntradas / meses.length)}
                      </span>
                    </td>
                    {meses.map(m => (
                      <td key={m} className="px-3 text-right"
                        style={{ paddingTop: nivel === 1 ? '12px' : '10px', paddingBottom: nivel === 1 ? '12px' : '10px' }}>
                        <span className={`font-bold ${nivel === 1 ? 'text-[16px]' : 'text-[15px]'}`}
                          style={{ color: totaisMes[m]?.entradas ? '#00c896' : '#4a5168' }}>
                          {totaisMes[m]?.entradas ? (oculto ? '????' : formatBRL(totaisMes[m].entradas)) : '-'}
                        </span>
                      </td>
                    ))}
                  </tr>

                  {/* -- DEBITOS -- */}
                  <tr
                    className="cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => setDebAberto(a => !a)}
                  >
                    <td colSpan={3 + meses.length} className="px-4 pt-5 pb-2 sticky left-0">
                      <div className="flex items-center gap-2">
                        <span style={{ color: '#f87171' }}>
                          {debAberto ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                        </span>
                        <span className="text-[14px] font-bold uppercase tracking-[3px]" style={{ color: '#f87171' }}>Débitos</span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(248,113,113,0.2)' }}/>
                      </div>
                    </td>
                  </tr>
                  {debAberto && grupos.filter(g => g.tipo === 'DESPESA').map((g, i) => (
                    <LinhaGrupo
                      key={`${i}-${nivel}`}
                      grupo={g} meses={meses} oculto={oculto}
                      aberto={gruposAbertos.has(g.nome)}
                      onToggleAberto={() => toggleGrupo(g.nome)}
                      expandidosSubs={subsExpandidos}
                      onToggleSub={toggleSub}
                      onCelulaClick={(catId, catNome, mes, titulo) => setDrillDown({ titulo, categoria_id: catId, categoria_nome: catNome, mes })} />
                  ))}
                  {/* Total Débitos — sempre visível */}
                  <tr style={{ background: nivel === 1 ? 'rgba(248,113,113,0.1)' : 'rgba(248,113,113,0.06)' }}>
                    <td className="px-4 sticky left-0 z-10"
                      style={{ background: nivel === 1 ? 'rgba(248,113,113,0.1)' : 'rgba(248,113,113,0.06)', minWidth: 220,
                               paddingTop: nivel === 1 ? '12px' : '10px', paddingBottom: nivel === 1 ? '12px' : '10px' }}>
                      <span className={`font-bold uppercase tracking-widest pl-1 ${nivel === 1 ? 'text-[16px]' : 'text-[14px]'}`}
                        style={{ color: '#f87171' }}>
                        {nivel === 1 ? 'Débitos' : 'Total Débitos'}
                      </span>
                    </td>
                    <td className="px-3 text-right"
                      style={{ paddingTop: nivel === 1 ? '12px' : '10px', paddingBottom: nivel === 1 ? '12px' : '10px' }}>
                      <span className={`font-bold ${nivel === 1 ? 'text-[18px]' : 'text-[16px]'}`} style={{ color: '#f87171' }}>
                        {oculto ? '????' : formatBRL(grandTotalDespesas)}
                      </span>
                    </td>
                    <td className="px-3 text-right border-l border-white/5"
                      style={{ paddingTop: nivel === 1 ? '12px' : '10px', paddingBottom: nivel === 1 ? '12px' : '10px' }}>
                      <span className={`font-bold ${nivel === 1 ? 'text-[16px]' : 'text-[15px]'}`} style={{ color: '#f87171', opacity: 0.65 }}>
                        {oculto ? '????' : formatBRL(grandTotalDespesas / meses.length)}
                      </span>
                    </td>
                    {meses.map(m => (
                      <td key={m} className="px-3 text-right"
                        style={{ paddingTop: nivel === 1 ? '12px' : '10px', paddingBottom: nivel === 1 ? '12px' : '10px' }}>
                        <span className={`font-bold ${nivel === 1 ? 'text-[16px]' : 'text-[15px]'}`}
                          style={{ color: totaisMes[m]?.despesas ? '#f87171' : '#4a5168' }}>
                          {totaisMes[m]?.despesas ? (oculto ? '????' : formatBRL(totaisMes[m].despesas)) : '-'}
                        </span>
                      </td>
                    ))}
                  </tr>

                  {/* -- RESULTADO -- */}
                  <tr style={{ background: 'rgba(0,200,150,0.04)' }}>
                    <td className="px-4 py-3 sticky left-0 z-10 border-t-2"
                      style={{ background: 'rgba(0,200,150,0.04)', borderColor: 'rgba(0,200,150,0.2)', minWidth: 220 }}>
                      <span className="text-[15px] font-bold uppercase tracking-widest" style={{ color: '#00c896' }}>Resultado</span>
                    </td>
                    <td className="px-3 py-3 text-right border-t-2" style={{ borderColor: 'rgba(0,200,150,0.2)' }}>
                      <span className="text-[17px] font-bold" style={{ color: resultado >= 0 ? '#00c896' : '#f87171' }}>
                        {oculto ? '????' : formatBRL(resultado)}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-right border-t-2 border-l border-white/5" style={{ borderColor: 'rgba(0,200,150,0.2)' }}>
                      <span className="text-[16px] font-bold" style={{ color: resultado >= 0 ? '#00c896' : '#f87171', opacity: 0.65 }}>
                        {oculto ? '????' : formatBRL(resultado / meses.length)}
                      </span>
                    </td>
                    {meses.map(m => {
                      const res = (totaisMes[m]?.entradas ?? 0) - (totaisMes[m]?.despesas ?? 0)
                      return (
                        <td key={m} className="px-3 py-3 text-right border-t-2" style={{ borderColor: 'rgba(0,200,150,0.2)' }}>
                          <span className="text-[16px] font-bold" style={{ color: res >= 0 ? '#00c896' : '#f87171' }}>
                            {oculto ? '????' : formatBRL(res)}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>}
        </>
      )}

      {/* -- Painel Drill-down -- */}
      {drillDown && (
        <div ref={drillRef} className="mt-5 bg-[#1a1f2e] border border-white/10 rounded-2xl overflow-hidden">
          {/* Cabecalho do painel */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
            <div>
              <p className="text-[17px] font-bold" style={{ color: '#e8eaf0' }}>{drillDown.titulo}</p>
              <p className="text-[14px] mt-0.5" style={{ color: '#8b92a8' }}>
                {gruposDescricao.length} descrição(ões) · {lancamentosDrill.length} lançamento(s)
              </p>
            </div>
            <button
              onClick={() => setDrillDown(null)}
              className="text-[15px] px-3 py-1.5 rounded-lg border transition-all hover:bg-white/5"
              style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#8b92a8' }}
            >
              x Fechar
            </button>
          </div>

          {/* Grid de lancamentos */}
          {lancamentosDrill.length === 0 ? (
            <p className="text-[16px] text-center py-8" style={{ color: '#8b92a8' }}>Nenhum lançamento encontrado</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: 100 }}/>
                  <col style={{ width: '1fr', minWidth: 180 }}/>
                  <col style={{ width: 180 }}/>
                  <col style={{ width: 140 }}/>
                  <col style={{ width: 90 }}/>
                  <col style={{ width: 110 }}/>
                  <col style={{ width: 44 }}/>
                </colgroup>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Data</span></th>
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Descrição</span></th>
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Categoria</span></th>
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Conta</span></th>
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Status</span></th>
                    <th className="px-4 py-2.5 text-right border-b border-white/5"><span className="text-[14px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Valor</span></th>
                    <th className="px-2 py-2.5 border-b border-white/5"/>
                  </tr>
                </thead>
                <tbody>
                  {gruposDescricao.map(g => {
                    const expandido = expandidosDrill.has(g.descricao)
                    const tipoGrupo = g.lancamentos[0]?.tipo ?? 'DESPESA'
                    const cor = tipoGrupo === 'RECEITA' ? '#00c896' : '#f87171'
                    return (
                      <Fragment key={g.descricao}>
                        {/* Linha do grupo (descrição) */}
                        <tr
                          onClick={() => setExpandidosDrill(prev => {
                            const n = new Set(prev)
                            if (n.has(g.descricao)) { n.delete(g.descricao) } else { n.add(g.descricao) }
                            return n
                          })}
                          className="cursor-pointer border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors"
                          style={{ background: expandido ? 'rgba(255,255,255,0.02)' : undefined }}
                        >
                          <td colSpan={5} className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              {expandido
                                ? <ChevronDown size={12} style={{ color: '#4a5168', flexShrink: 0 }}/>
                                : <ChevronRight size={12} style={{ color: '#4a5168', flexShrink: 0 }}/>}
                              <span className="text-[16px] font-medium truncate" style={{ color: '#e8eaf0' }}>{g.descricao}</span>
                              <span className="text-[13px] px-1.5 py-0.5 rounded-full font-semibold flex-shrink-0"
                                style={{ background: 'rgba(255,255,255,0.06)', color: '#8b92a8' }}>
                                {g.qtd}×
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span className="text-[16px] font-bold whitespace-nowrap" style={{ color: cor }}>
                              {formatBRL(g.total)}
                            </span>
                          </td>
                          <td/>
                        </tr>
                        {/* Lançamentos individuais (expandido) — 4º nível: clicar exibe detalhes */}
                        {expandido && g.lancamentos.map(l => (
                          <tr key={l.id}
                            onClick={() => setLancamentoEditando(l)}
                            className="cursor-pointer border-b border-white/[0.02] hover:bg-white/[0.04] transition-colors"
                            style={{ background: 'rgba(255,255,255,0.015)' }}>
                            <td className="px-4 py-2 pl-10">
                              <span className="text-[14px]" style={{ color: '#8b92a8' }}>
                                {l.data.split('-').reverse().join('/')}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className="text-[15px] truncate block" style={{ color: '#c5cad8' }}>{l.descricao}</span>
                            </td>
                            <td className="px-4 py-2">
                              <span className="text-[14px] truncate block" style={{ color: '#c5cad8' }}>
                                {l.categoria_pai_nome ? `${l.categoria_pai_nome} / ${l.categoria_nome}` : (l.categoria_nome ?? '-')}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className="text-[14px]" style={{ color: '#c5cad8' }}>{l.conta_nome ?? '-'}</span>
                            </td>
                            <td className="px-4 py-2">
                              <span className="text-[13px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap"
                                style={{
                                  background: STATUS_BG[l.status]  ?? STATUS_BG.PENDENTE,
                                  color:      STATUS_COR[l.status] ?? STATUS_COR.PENDENTE,
                                }}>
                                {STATUS_LABEL[l.status] ?? l.status}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right">
                              <span className="text-[15px] font-bold whitespace-nowrap" style={{ color: cor }}>
                                {l.tipo === 'RECEITA' ? '+' : '-'}{formatBRL(l.valor)}
                              </span>
                            </td>
                            <td className="px-2 py-2 text-center">
                              <button
                                onClick={e => e.stopPropagation()}
                                className="w-6 h-6 rounded-md flex items-center justify-center"
                                style={{ color: '#4a5168' }}
                                title="Clique na linha para ver detalhes"
                              >
                                <Pencil size={10} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    )
                  })}
                </tbody>
                {/* Total do drill-down */}
                <tfoot>
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <td colSpan={5} className="px-4 py-2.5 border-t border-white/10">
                      <span className="text-[14px] font-bold uppercase tracking-widest" style={{ color: '#4a5168' }}>Total</span>
                    </td>
                    <td className="px-4 py-2.5 text-right border-t border-white/10">
                      {(() => {
                        const tot = lancamentosDrill.reduce((s, l) => s + (l.tipo === 'RECEITA' ? l.valor : -l.valor), 0)
                        return (
                          <span className="text-[17px] font-bold" style={{ color: tot >= 0 ? '#00c896' : '#f87171' }}>
                            {formatBRL(Math.abs(tot))}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="border-t border-white/10"/>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

        </div>
      )}

      {/* Drawer de edicao - reutilizavel */}
      {lancamentoEditando && (
        <DrawerLancamento
          lancamento={lancamentoEditando}
          onFechar={() => setLancamentoEditando(null)}
          onSalvo={() => { setLancamentoEditando(null); buscar() }}
        />
      )}

      {/* Loading enquanto busca */}
      {loading && (
        <div className="py-12">
          <LoadingMascote texto="Gerando relatório…" size={150} />
        </div>
      )}

      {/* Estado vazio */}
      {!buscado && !loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(0,200,150,0.08)', border: '1px solid rgba(0,200,150,0.15)' }}>
            <Filter size={24} style={{ color: '#00c896' }} />
          </div>
          <p className="text-[18px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>Configure os filtros</p>
          <p className="text-[16px]" style={{ color: '#8b92a8' }}>Selecione o período e clique em Gerar relatório</p>
        </div>
      )}
    </div>
  )
}
