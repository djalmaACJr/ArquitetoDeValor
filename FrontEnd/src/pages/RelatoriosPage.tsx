// src/pages/RelatoriosPage.tsx
import { useState, useMemo, useCallback, useRef, useEffect } from 'react'
import { ChevronDown, ChevronRight, Download, RefreshCw, Filter, Pencil } from 'lucide-react'
import DrawerLancamento from '../components/ui/DrawerLancamento'

import { apiFetch } from '../lib/api'
import { formatBRL, mesLabel } from '../lib/utils'
import { usePageState } from '../context/PageStateContext'
import { useContas } from '../hooks/useContas'
import { useCategorias } from '../hooks/useCategorias'
import { MultiSelect } from '../components/ui/MultiSelect'
import { MonthPicker } from '../components/ui/MonthPicker'

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

interface CelulaCategoria {
  categoria_id: string | null
  categoria_nome: string
  categoria_pai_id: string | null
  categoria_pai_nome: string | null
  tipo: 'RECEITA' | 'DESPESA'
  porMes: Record<string, number>
  total: number
}

interface GrupoPai {
  nome: string
  tipo: 'RECEITA' | 'DESPESA'
  subcategorias: CelulaCategoria[]
  totalPorMes: Record<string, number>
  total: number
  aberto: boolean
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
function LinhaGrupo({ grupo, meses, oculto, onCelulaClick }: {
  grupo: GrupoPai
  meses: string[]
  oculto: boolean
  onCelulaClick: (catId: string | null, catNome: string, mes: string | null, titulo: string) => void
}) {
  const [aberto, setAberto] = useState(true)
  const cor = grupo.tipo === 'RECEITA' ? '#00c896' : '#f87171'

  return (
    <>
      {/* Linha pai */}
      <tr
        onClick={() => setAberto(a => !a)}
        className="cursor-pointer border-b border-white/5 hover:bg-white/[0.03] transition-colors"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: 'inherit', minWidth: 220 }}>
          <div className="flex items-center gap-2">
            <span className="w-4 h-4 flex items-center justify-center flex-shrink-0" style={{ color: '#8b92a8' }}>
              {aberto ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
            </span>
            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: cor }}>
              {grupo.nome}
            </span>
          </div>
        </td>
        <td
          className="px-3 py-2.5 text-right cursor-pointer hover:bg-white/5 transition-colors"
          onClick={e => { e.stopPropagation(); onCelulaClick(null, grupo.nome, null, `${grupo.nome} - Total período`) }}
          title="Ver todos os lançamentos desta categoria no período"
        >
          <span className="text-[12px] font-bold" style={{ color: cor }}>
            {oculto ? '????' : formatBRL(grupo.total)}
          </span>
        </td>
        {meses.map(m => (
          <td key={m}
            className="px-3 py-2.5 text-right cursor-pointer hover:bg-white/5 transition-colors"
            onClick={e => { e.stopPropagation(); if (grupo.totalPorMes[m]) onCelulaClick(null, grupo.nome, m, `${grupo.nome} - ${mesLabel(m)}`) }}
            title={grupo.totalPorMes[m] ? 'Ver lançamentos' : undefined}
          >
            <span className="text-[11px] font-semibold" style={{ color: grupo.totalPorMes[m] ? cor : '#4a5168' }}>
              {grupo.totalPorMes[m] ? (oculto ? '????' : formatBRL(grupo.totalPorMes[m])) : '-'}
            </span>
          </td>
        ))}
      </tr>

      {/* Subcategorias */}
      {aberto && grupo.subcategorias.map(sub => (
        <tr key={sub.categoria_id ?? sub.categoria_nome}
          className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
          <td className="px-4 py-2 sticky left-0 z-10" style={{ background: '#0e1320', minWidth: 220 }}>
            <div className="flex items-center gap-2 pl-5">
              <span className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: cor, opacity: 0.5 }}/>
              <span className="text-[11px]" style={{ color: '#c5cad8' }}>{sub.categoria_nome}</span>
            </div>
          </td>
          <td
            className="px-3 py-2 text-right cursor-pointer hover:bg-white/5 transition-colors"
            onClick={() => onCelulaClick(sub.categoria_id, sub.categoria_nome, null, `${sub.categoria_nome} - Total período`)}
            title="Ver todos os lançamentos desta categoria no período"
          >
            <span className="text-[11px] font-medium" style={{ color: '#e8eaf0' }}>
              {oculto ? '????' : formatBRL(sub.total)}
            </span>
          </td>
          {meses.map(m => (
            <td key={m}
              className="px-3 py-2 text-right cursor-pointer hover:bg-white/5 transition-colors"
              onClick={() => { if (sub.porMes[m]) onCelulaClick(sub.categoria_id, sub.categoria_nome, m, `${sub.categoria_nome} - ${mesLabel(m)}`) }}
              title={sub.porMes[m] ? 'Ver lançamentos' : undefined}
            >
              <span className="text-[11px]" style={{ color: sub.porMes[m] ? '#c5cad8' : '#4a5168' }}>
                {sub.porMes[m] ? (oculto ? '????' : formatBRL(sub.porMes[m])) : '-'}
              </span>
            </td>
          ))}
        </tr>
      ))}

      {aberto && (
        <tr className="border-b border-white/10">
          <td className="px-4 py-2 sticky left-0 z-10" style={{ background: '#0e1320', minWidth: 220 }}>
            <span className="text-[10px] font-bold uppercase tracking-widest pl-6" style={{ color: cor, opacity: 0.7 }}>
              Total - {grupo.nome}
            </span>
          </td>
          <td className="px-3 py-2 text-right">
            <span className="text-[12px] font-bold" style={{ color: cor }}>
              {oculto ? '????' : formatBRL(grupo.total)}
            </span>
          </td>
          {meses.map(m => (
            <td key={m} className="px-3 py-2 text-right">
              <span className="text-[11px] font-bold" style={{ color: grupo.totalPorMes[m] ? cor : '#4a5168' }}>
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
  const filtStatus   = pgState.filtStatus
  const filtContas   = pgState.filtContas
  const incluirTransf = pgState.incluirTransf
  const setInicio        = (v: string)   => setPgState({ inicio: v })
  const setFim           = (v: string)   => setPgState({ fim: v })
  const setFiltStatus    = (v: string[]) => setPgState({ filtStatus: v })
  const setFiltContas    = (v: string[]) => setPgState({ filtContas: v })
  const setIncluirTransf = (v: boolean)  => setPgState({ incluirTransf: v })
  const [loading,     setLoading]     = useState(false)
  const lancamentos    = pgState.lancamentos as Lancamento[]
  const buscado        = pgState.buscado
  const [oculto,      setOculto]      = useState(false)
  const [credAberto,  setCredAberto]  = useState(true)
  const [debAberto,   setDebAberto]   = useState(true)
  const drillRef    = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [lancamentoEditando, setLancamentoEditando] = useState<any | null>(null)
  const [drillDown,   setDrillDown]   = useState<{
    titulo: string
    categoria_id: string | null
    categoria_nome: string
    mes: string | null  // null = todos os meses
  } | null>(null)

  const { contas }     = useContas()
  void useCategorias() // mantido para futuro uso de filtro por categoria

  const meses = useMemo(() => gerarMeses(inicio, fim), [inicio, fim])

  // -- Buscar dados ---------------------------------------------
  const buscar = useCallback(async () => {
    setLoading(true)
    try {
      const todos: Lancamento[] = []
      await Promise.all(meses.map(async m => {
        const params = new URLSearchParams({ mes: m, per_page: '1000', saldo: 'true' })
        if (filtContas.length === 1) params.set('conta_id', filtContas[0])
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

    // Filtros
    let lista = lancamentos
    if (!incluirTransf) lista = lista.filter(l => !isTransf(l))
    if (filtStatus.length > 0) lista = lista.filter(l => filtStatus.includes(l.status))
    if (filtContas.length > 1) lista = lista.filter(l => filtContas.includes(l.conta_id))

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
        })
      }
      const cel = mapa.get(key)!
      cel.porMes[mesLanc] = (cel.porMes[mesLanc] ?? 0) + l.valor
      cel.total           += l.valor
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
  }, [lancamentos, buscado, filtStatus, filtContas, incluirTransf, meses])

  const exportarExcel = useCallback(async () => {
    if (!buscado || grupos.length === 0) return

    // Monta linhas da planilha
    const header = ['Categoria', 'Total', ...meses.map(m => mesLabel(m))]
    const rows: (string | number)[][] = [header]

    for (const grupo of grupos) {
      // Linha do grupo pai
      rows.push([
        grupo.nome,
        grupo.total,
        ...meses.map(m => grupo.totalPorMes[m] ?? 0),
      ])
      if (grupo.aberto !== false) {
        for (const sub of grupo.subcategorias) {
          rows.push([
            `  ${sub.categoria_nome}`,
            sub.total,
            ...meses.map(m => sub.porMes[m] ?? 0),
          ])
        }
        // Linha de total do grupo
        rows.push([
          `Total - ${grupo.nome}`,
          grupo.total,
          ...meses.map(m => grupo.totalPorMes[m] ?? 0),
        ])
      }
      rows.push([]) // linha em branco entre grupos
    }

    // Linha de totais gerais
    rows.push(['TOTAL RECEITAS', grandTotalEntradas, ...meses.map(m => totaisMes[m]?.entradas ?? 0)])
    rows.push(['TOTAL DESPESAS', grandTotalDespesas, ...meses.map(m => totaisMes[m]?.despesas ?? 0)])
    rows.push(['RESULTADO', grandTotalEntradas - grandTotalDespesas, ...meses.map(m => (totaisMes[m]?.entradas ?? 0) - (totaisMes[m]?.despesas ?? 0))])

    // Gerar xlsx via SheetJS (mesmo CDN usado em Ferramentas)
    // @ts-expect-error dynamic CDN import
    const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [
      { wch: 35 },
      { wch: 16 },
      ...meses.map(() => ({ wch: 14 })),
    ]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Relatório')
    XLSX.writeFile(wb, `relatorio_${inicio}_${fim}.xlsx`)
    }, [buscado, grupos, meses, totaisMes, grandTotalEntradas, grandTotalDespesas, inicio, fim])


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
    if (filtContas.length > 1) lista = lista.filter(l => filtContas.includes(l.conta_id))
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
  }, [drillDown, lancamentos, buscado, filtStatus, filtContas, incluirTransf, meses])

  return (
    <div className="p-5 min-h-screen" style={{ background: '#0e1320' }}>
      {/* Topbar */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-[18px] font-bold" style={{ color: '#e8eaf0' }}>Relatório por categoria</h1>
          <p className="text-[11px] mt-0.5" style={{ color: '#8b92a8' }}>Receitas e despesas agrupadas por categoria</p>
        </div>
        <button
          onClick={() => setOculto(v => !v)}
          className="text-[11px] px-3 py-1.5 rounded-lg border transition-all"
          style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#8b92a8' }}
        >
          {oculto ? '👁 Mostrar' : '🙈 Ocultar'}
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl p-4 mb-5">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Periodo */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>De</p>
            <MonthPicker value={inicio} onChange={setInicio} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>Até</p>
            <MonthPicker value={fim} onChange={setFim} />
          </div>

          {/* Contas */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>Contas</p>
            <MultiSelect
              placeholder="Todas as contas"
              className="w-44"
              values={filtContas}
              onChange={setFiltContas}
              options={contas.map(c => ({ value: c.conta_id, label: c.nome, cor: c.cor ?? undefined }))}
            />
          </div>

          {/* Status */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>Status</p>
            <MultiSelect
              placeholder="Todos status"
              className="w-40"
              values={filtStatus}
              onChange={setFiltStatus}
              options={[
                { value: 'PAGO',     label: 'Pago',     cor: '#00c896' },
                { value: 'PENDENTE', label: 'Pendente', cor: '#4da6ff' },
                { value: 'PROJECAO', label: 'Projeção', cor: '#f0b429' },
              ]}
            />
          </div>

          {/* Transferencias toggle */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: '#8b92a8' }}>Transferências</p>
            <button
              onClick={() => setIncluirTransf(!incluirTransf)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[11px] transition-all"
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
          <div className="flex items-center gap-2 ml-auto">
            {buscado && (
              <button
                onClick={exportarExcel}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-semibold transition-all hover:opacity-90 border border-white/10"
                style={{ color: '#4da6ff', background: 'rgba(77,166,255,0.08)' }}
                title="Exportar para Excel (.xlsx)"
              >
                <Download size={13} /> Exportar
              </button>
            )}
            <button
              onClick={buscar}
              disabled={loading || meses.length === 0}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-[12px] font-semibold transition-all hover:opacity-90"
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
          <p className="text-[10px] mt-3" style={{ color: '#4a5168' }}>
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
                <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: '#8b92a8' }}>{c.label}</p>
                <p className="text-[18px] font-bold" style={{ color: c.cor }}>{oculto ? '??????' : formatBRL(c.valor)}</p>
              </div>
            ))}
          </div>

          {/* Tabela principal */}
          <div className="bg-[#1a1f2e] border border-white/10 rounded-2xl overflow-hidden">
            <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 280px)' }}>
              <table className="w-full border-collapse" style={{ minWidth: 600 }}>
                {/* Cabecalho */}
                <thead className="sticky top-0 z-30">
                  <tr style={{ background: '#1a1f2e' }}>
                    <th className="px-4 py-3 text-left sticky left-0 z-40 border-b border-white/10"
                      style={{ background: '#1a1f2e', minWidth: 220 }}>
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#4a5168' }}>Categoria</span>
                    </th>
                    <th className="px-3 py-3 text-right border-b border-white/10 border-l border-white/5"
                      style={{ background: '#1a1f2e' }}>
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#4a5168' }}>Total</span>
                    </th>
                    {meses.map(m => (
                      <th key={m} className="px-3 py-3 text-right border-b border-white/10 border-l border-white/5"
                        style={{ minWidth: 100, background: '#1a1f2e' }}>
                        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#4a5168' }}>
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
                    <td colSpan={2 + meses.length} className="px-4 pt-4 pb-2 sticky left-0">
                      <div className="flex items-center gap-2">
                        <span style={{ color: '#00c896' }}>
                          {credAberto ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-[3px]" style={{ color: '#00c896' }}>Créditos</span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(0,200,150,0.2)' }}/>
                      </div>
                    </td>
                  </tr>
                  {credAberto && grupos.filter(g => g.tipo === 'RECEITA').map((g, i) => (
                    <LinhaGrupo key={i} grupo={g} meses={meses} oculto={oculto}
                      onCelulaClick={(catId, catNome, mes, titulo) => setDrillDown({ titulo, categoria_id: catId, categoria_nome: catNome, mes })} />
                  ))}
                  {/* Total Creditos */}
                  {credAberto && <tr style={{ background: 'rgba(0,200,150,0.06)' }}>
                    <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: 'rgba(0,200,150,0.06)', minWidth: 220 }}>
                      <span className="text-[10px] font-bold uppercase tracking-widest pl-1" style={{ color: '#00c896' }}>Total Créditos</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-[12px] font-bold" style={{ color: '#00c896' }}>
                        {oculto ? '????' : formatBRL(grandTotalEntradas)}
                      </span>
                    </td>
                    {meses.map(m => (
                      <td key={m} className="px-3 py-2.5 text-right">
                        <span className="text-[11px] font-bold" style={{ color: totaisMes[m]?.entradas ? '#00c896' : '#4a5168' }}>
                          {totaisMes[m]?.entradas ? (oculto ? '????' : formatBRL(totaisMes[m].entradas)) : '-'}
                        </span>
                      </td>
                    ))}
                  </tr>}

                  {/* -- DEBITOS -- */}
                  <tr
                    className="cursor-pointer hover:bg-white/[0.02] transition-colors"
                    onClick={() => setDebAberto(a => !a)}
                  >
                    <td colSpan={2 + meses.length} className="px-4 pt-5 pb-2 sticky left-0">
                      <div className="flex items-center gap-2">
                        <span style={{ color: '#f87171' }}>
                          {debAberto ? <ChevronDown size={12}/> : <ChevronRight size={12}/>}
                        </span>
                        <span className="text-[10px] font-bold uppercase tracking-[3px]" style={{ color: '#f87171' }}>Débitos</span>
                        <div className="flex-1 h-px" style={{ background: 'rgba(248,113,113,0.2)' }}/>
                      </div>
                    </td>
                  </tr>
                  {debAberto && grupos.filter(g => g.tipo === 'DESPESA').map((g, i) => (
                    <LinhaGrupo key={i} grupo={g} meses={meses} oculto={oculto}
                      onCelulaClick={(catId, catNome, mes, titulo) => setDrillDown({ titulo, categoria_id: catId, categoria_nome: catNome, mes })} />
                  ))}
                  {/* Total Debitos */}
                  {debAberto && <tr style={{ background: 'rgba(248,113,113,0.06)' }}>
                    <td className="px-4 py-2.5 sticky left-0 z-10" style={{ background: 'rgba(248,113,113,0.06)', minWidth: 220 }}>
                      <span className="text-[10px] font-bold uppercase tracking-widest pl-1" style={{ color: '#f87171' }}>Total Débitos</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-[12px] font-bold" style={{ color: '#f87171' }}>
                        {oculto ? '????' : formatBRL(grandTotalDespesas)}
                      </span>
                    </td>
                    {meses.map(m => (
                      <td key={m} className="px-3 py-2.5 text-right">
                        <span className="text-[11px] font-bold" style={{ color: totaisMes[m]?.despesas ? '#f87171' : '#4a5168' }}>
                          {totaisMes[m]?.despesas ? (oculto ? '????' : formatBRL(totaisMes[m].despesas)) : '-'}
                        </span>
                      </td>
                    ))}
                  </tr>}

                  {/* -- RESULTADO -- */}
                  <tr style={{ background: 'rgba(0,200,150,0.04)' }}>
                    <td className="px-4 py-3 sticky left-0 z-10 border-t-2"
                      style={{ background: 'rgba(0,200,150,0.04)', borderColor: 'rgba(0,200,150,0.2)', minWidth: 220 }}>
                      <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: '#00c896' }}>Resultado</span>
                    </td>
                    <td className="px-3 py-3 text-right border-t-2" style={{ borderColor: 'rgba(0,200,150,0.2)' }}>
                      <span className="text-[13px] font-bold" style={{ color: resultado >= 0 ? '#00c896' : '#f87171' }}>
                        {oculto ? '????' : formatBRL(resultado)}
                      </span>
                    </td>
                    {meses.map(m => {
                      const res = (totaisMes[m]?.entradas ?? 0) - (totaisMes[m]?.despesas ?? 0)
                      return (
                        <td key={m} className="px-3 py-3 text-right border-t-2" style={{ borderColor: 'rgba(0,200,150,0.2)' }}>
                          <span className="text-[12px] font-bold" style={{ color: res >= 0 ? '#00c896' : '#f87171' }}>
                            {oculto ? '????' : formatBRL(res)}
                          </span>
                        </td>
                      )
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* -- Painel Drill-down -- */}
      {drillDown && (
        <div ref={drillRef} className="mt-5 bg-[#1a1f2e] border border-white/10 rounded-2xl overflow-hidden">
          {/* Cabecalho do painel */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-white/10">
            <div>
              <p className="text-[13px] font-bold" style={{ color: '#e8eaf0' }}>{drillDown.titulo}</p>
              <p className="text-[10px] mt-0.5" style={{ color: '#8b92a8' }}>
                {lancamentosDrill.length} lançamento(s)
              </p>
            </div>
            <button
              onClick={() => setDrillDown(null)}
              className="text-[11px] px-3 py-1.5 rounded-lg border transition-all hover:bg-white/5"
              style={{ borderColor: 'rgba(255,255,255,0.1)', color: '#8b92a8' }}
            >
              x Fechar
            </button>
          </div>

          {/* Grid de lancamentos */}
          {lancamentosDrill.length === 0 ? (
            <p className="text-[12px] text-center py-8" style={{ color: '#8b92a8' }}>Nenhum lançamento encontrado</p>
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
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Data</span></th>
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Descrição</span></th>
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Categoria</span></th>
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Conta</span></th>
                    <th className="px-4 py-2.5 text-left border-b border-white/5"><span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Status</span></th>
                    <th className="px-4 py-2.5 text-right border-b border-white/5"><span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#4a5168' }}>Valor</span></th>
                    <th className="px-2 py-2.5 border-b border-white/5"/>
                  </tr>
                </thead>
                <tbody>
                  {lancamentosDrill.map(l => (
                    <tr key={l.id} className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-2.5">
                        <span className="text-[11px]" style={{ color: '#8b92a8' }}>
                          {l.data.split('-').reverse().join('/')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[12px] truncate block" style={{ color: '#e8eaf0' }}>{l.descricao}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[11px] truncate block" style={{ color: '#c5cad8' }}>
                          {l.categoria_pai_nome ? `${l.categoria_pai_nome} / ${l.categoria_nome}` : (l.categoria_nome ?? '-')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[11px]" style={{ color: '#c5cad8' }}>{l.conta_nome ?? '-'}</span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap"
                          style={{
                            background: l.status === 'PAGO' ? 'rgba(0,200,150,0.12)' : l.status === 'PENDENTE' ? 'rgba(77,166,255,0.12)' : 'rgba(240,180,41,0.12)',
                            color:      l.status === 'PAGO' ? '#00c896'              : l.status === 'PENDENTE' ? '#4da6ff'              : '#f0b429',
                          }}>
                          {l.status === 'PAGO' ? 'Pago' : l.status === 'PENDENTE' ? 'Pendente' : 'Projeção'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className="text-[12px] font-bold whitespace-nowrap"
                          style={{ color: l.tipo === 'RECEITA' ? '#00c896' : '#f87171' }}>
                          {l.tipo === 'RECEITA' ? '+' : '-'}{formatBRL(l.valor)}
                        </span>
                      </td>
                      <td className="px-2 py-2.5 text-center">
                        <button
                          onClick={() => setLancamentoEditando(l)}
                          className="w-7 h-7 rounded-md border border-white/10 flex items-center justify-center transition-all hover:bg-white/10 mx-auto"
                          style={{ color: '#8b92a8' }}
                          title="Editar lançamento"
                        >
                          <Pencil size={12} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Total do drill-down */}
                <tfoot>
                  <tr style={{ background: 'rgba(255,255,255,0.02)' }}>
                    <td colSpan={5} className="px-4 py-2.5 border-t border-white/10">
                      <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: '#4a5168' }}>Total</span>
                    </td>
                    <td className="px-4 py-2.5 text-right border-t border-white/10">
                      {(() => {
                        const tot = lancamentosDrill.reduce((s, l) => s + (l.tipo === 'RECEITA' ? l.valor : -l.valor), 0)
                        return (
                          <span className="text-[13px] font-bold" style={{ color: tot >= 0 ? '#00c896' : '#f87171' }}>
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

      {/* Estado vazio */}
      {!buscado && !loading && (
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'rgba(0,200,150,0.08)', border: '1px solid rgba(0,200,150,0.15)' }}>
            <Filter size={24} style={{ color: '#00c896' }} />
          </div>
          <p className="text-[14px] font-semibold mb-1" style={{ color: '#e8eaf0' }}>Configure os filtros</p>
          <p className="text-[12px]" style={{ color: '#8b92a8' }}>Selecione o período e clique em Gerar relatório</p>
        </div>
      )}
    </div>
  )
}
