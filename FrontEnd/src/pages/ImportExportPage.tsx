// src/pages/ImportExportPage.tsx
import { useState, useRef } from 'react'
import {
  Trash2, Download, Upload, AlertTriangle, CheckCircle2,
  FileSpreadsheet, ChevronDown, ChevronUp, X, Loader2, RefreshCw,
  DatabaseBackup, RotateCcw, Save,
} from 'lucide-react'
import { apiFetch, apiMutate, extrairLista } from '../lib/api'
import { useContas } from '../hooks/useContas'
import { useCategorias } from '../hooks/useCategorias'
import { MonthPicker } from '../components/ui/MonthPicker'
import type { Conta } from '../types'

// ── Tipos internos ──────────────────────────────────────────────
interface CategoriaRaw {
  id: string
  descricao: string
  tipo: string
  protegida?: boolean
  id_pai?: string | null
  icone?: string | null
  cor?: string | null
}

interface TransacaoRaw {
  id?: string
  id_par?: string
  id_par_transferencia?: string
  data: string
  descricao?: string
  valor: number
  tipo: string
  status?: string
  conta_id?: string
  categoria_id?: string
  [key: string]: unknown
}

interface ContaBackup {
  nome: string
  tipo: string
  saldo_inicial?: number
  icone?: string
  cor?: string
  [key: string]: unknown
}

interface CategoriaBackup {
  descricao: string
  protegida?: boolean
  id_pai?: string | null
  icone?: string
  cor?: string
  [key: string]: unknown
}

type XlsxRow = Record<string, unknown>

interface BackupPayload {
  gerado_em: string
  contas: ContaBackup[]
  categorias: CategoriaBackup[]
  transacoes: TransacaoRaw[]
  transferencias?: TransacaoRaw[]
}

interface LinhaExportCategoria {
  Categoria: string
  Subcategoria: string
  Ícone: string
  Cor: string
}

interface LinhaImport {
  idx: number
  data: string
  descricao: string
  valor: number
  tipo: 'RECEITA' | 'DESPESA'
  conta_nome: string
  categoria_nome: string
  status: string
  observacao: string
  // resolvidos
  conta_id?: string
  categoria_id?: string
  erro?: string
  aviso?: string
}

interface ResolucaoConta {
  nome: string
  acao: 'criar' | 'mapear'
  mapear_para?: string
}

interface ResolucaoCategoria {
  nome: string
  tipo: 'RECEITA' | 'DESPESA'
  acao: 'criar' | 'mapear'
  mapear_para?: string
}

// ── Helpers ──────────────────────────────────────────────────────
function mesAtual() { return new Date().toISOString().slice(0, 7) }

function mesMenos(m: string, n: number) {
  const [a, mo] = m.split('-').map(Number)
  let a2 = a, m2 = mo - n
  while (m2 <= 0) { m2 += 12; a2-- }
  return `${a2}-${String(m2).padStart(2, '0')}`
}

function normalizarNome(s: string) {
  return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Parse de número BR ou EN
function parseValor(s: string): number {
  const limpo = String(s).replace(/[^\d,.-]/g, '')
  // BR: 1.234,56
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$/.test(limpo)) return parseFloat(limpo.replace(/\./g, '').replace(',', '.'))
  return parseFloat(limpo.replace(',', '.'))
}

// ── Componentes auxiliares ──────────────────────────────────────
function Section({ titulo, subtitulo, icon: Icon, cor, children, defaultOpen = true }: {
  titulo: string; subtitulo: string; icon: React.ElementType; cor: string
  children: React.ReactNode; defaultOpen?: boolean
}) {
  const [aberto, setAberto] = useState(defaultOpen)
  return (
    <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setAberto(a => !a)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${cor}20` }}>
            <Icon size={16} style={{ color: cor }} />
          </div>
          <div className="text-left">
            <p className="text-[14px] font-bold text-gray-800 dark:text-gray-100">{titulo}</p>
            <p className="text-[11px] text-gray-400">{subtitulo}</p>
          </div>
        </div>
        {aberto ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {aberto && <div className="px-5 pb-5 border-t border-gray-100 dark:border-gray-700 pt-4">{children}</div>}
    </div>
  )
}

function Btn({ onClick, disabled, loading, cor = '#00c896', children }: {
  onClick: () => void; disabled?: boolean; loading?: boolean; cor?: string; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-[13px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ background: `${cor}20`, color: cor, border: `1px solid ${cor}40` }}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

function Tag({ cor, children }: { cor: string; children: React.ReactNode }) {
  return (
    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: `${cor}20`, color: cor }}>{children}</span>
  )
}

// ── Modal de confirmação genérico ────────────────────────────────
function ModalConfirmacao({ titulo, mensagem, onConfirmar, onCancelar, corBtn = '#ff6b4a', labelBtn = 'Confirmar' }: {
  titulo: string; mensagem: React.ReactNode
  onConfirmar: () => void; onCancelar: () => void
  corBtn?: string; labelBtn?: string
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-red-400/10 flex-shrink-0">
            <AlertTriangle size={18} className="text-red-400" />
          </div>
          <div>
            <p className="text-[15px] font-bold text-gray-800 dark:text-gray-100">{titulo}</p>
            <div className="text-[13px] text-gray-500 dark:text-gray-400 mt-1">{mensagem}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancelar}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirmar}
            className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-colors"
            style={{ background: corBtn }}>
            {labelBtn}
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════
// SEÇÃO 1 — LIMPEZA
// ══════════════════════════════════════════════════════════════════
function SecaoLimpeza() {
  const [confirmando, setConfirmando] = useState(false)
  const [modo, setModo] = useState<'transacoes' | 'tudo'>('tudo')
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState<{ tipo: 'ok' | 'erro'; msg: string }[]>([])

  const executarLimpeza = async () => {
    setConfirmando(false)
    setLoading(true)
    setLog([])
    const addLog = (tipo: 'ok' | 'erro', msg: string) =>
      setLog(l => [...l, { tipo, msg }])

    try {
      if (modo === 'transacoes') {
        const res = await apiMutate('/limpar?entidade=transacoes', 'DELETE')
        if (res.ok) addLog('ok', `Transações excluídas: ${res.excluidos ?? 0}`)
        else addLog('erro', `Erro: ${res.erro}`)
      } else {
        const res = await apiMutate('/limpar', 'DELETE')
        if (res.ok) {
          const dados = res.dados as { logs?: { entidade: string; excluidos: number }[] } | { entidade: string; excluidos: number }[]
          const logs = (dados && 'logs' in dados ? dados.logs : dados) as { entidade: string; excluidos: number }[]
          if (Array.isArray(logs)) {
            logs.forEach(l => addLog('ok', `${l.entidade}: ${l.excluidos} excluídos`))
          } else {
            addLog('ok', 'Limpeza concluída')
          }
        } else {
          addLog('erro', `Erro: ${res.erro}`)
        }
      }
    } catch (e) {
      addLog('erro', `Erro inesperado: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const opcoes = [
    {
      valor: 'transacoes' as const,
      titulo: 'Somente transações',
      descricao: 'Remove todos os lançamentos e transferências. Contas e categorias são mantidas.',
    },
    {
      valor: 'tudo' as const,
      titulo: 'Limpar tudo',
      descricao: 'Remove transações, categorias não protegidas e todas as contas.',
    },
  ]

  return (
    <Section titulo="Limpar dados" subtitulo="Remove transações, categorias e contas do banco" icon={Trash2} cor="#ff6b4a">
      <div className="space-y-3">

        {/* Seleção do modo */}
        <div className="grid grid-cols-2 gap-2">
          {opcoes.map(op => (
            <button
              key={op.valor}
              onClick={() => setModo(op.valor)}
              className="text-left p-3 rounded-lg border transition-all"
              style={{
                background: modo === op.valor ? '#ff6b4a15' : 'transparent',
                borderColor: modo === op.valor ? '#ff6b4a60' : 'rgba(255,255,255,0.08)',
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <div
                  className="w-3 h-3 rounded-full border-2 flex-shrink-0"
                  style={{
                    borderColor: '#ff6b4a',
                    background: modo === op.valor ? '#ff6b4a' : 'transparent',
                  }}
                />
                <span
                  className="text-[13px] font-semibold"
                  style={{ color: modo === op.valor ? '#ff6b4a' : '#8b92a8' }}
                >
                  {op.titulo}
                </span>
              </div>
              <p className="text-[11px] text-gray-400 pl-5">{op.descricao}</p>
            </button>
          ))}
        </div>

        {/* Aviso */}
        <p className="text-[11px] text-red-400/70">⚠️ Esta ação é irreversível.</p>

        {/* Log */}
        {log.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-1.5">
            {log.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                {l.tipo === 'ok'
                  ? <CheckCircle2 size={13} className="text-av-green flex-shrink-0" />
                  : <X size={13} className="text-red-400 flex-shrink-0" />}
                <span style={{ color: l.tipo === 'ok' ? '#00c896' : '#f87171' }}>{l.msg}</span>
              </div>
            ))}
          </div>
        )}

        <Btn onClick={() => setConfirmando(true)} loading={loading} cor="#ff6b4a">
          <Trash2 size={14} /> {modo === 'transacoes' ? 'Limpar transações' : 'Limpar tudo'}
        </Btn>
      </div>

      {confirmando && (
        <ModalConfirmacao
          titulo={modo === 'transacoes' ? 'Confirmar limpeza de transações' : 'Confirmar limpeza total'}
          mensagem={
            <span>
              {modo === 'transacoes'
                ? 'Todos os lançamentos e transferências serão excluídos.'
                : 'Transações, categorias e contas serão excluídos permanentemente.'}
              <br />
              <strong className="text-red-400">Esta ação não pode ser desfeita.</strong>
            </span>
          }
          labelBtn={modo === 'transacoes' ? 'Sim, limpar transações' : 'Sim, limpar tudo'}
          onConfirmar={executarLimpeza}
          onCancelar={() => setConfirmando(false)}
        />
      )}
    </Section>
  )
}


// ══════════════════════════════════════════════════════════════════
// SEÇÃO 2 — EXPORTAÇÃO
// ══════════════════════════════════════════════════════════════════
function SecaoExport() {
  const { contas } = useContas()
  const { categorias } = useCategorias()

  const [mesInicio, setMesInicio] = useState(mesMenos(mesAtual(), 2))
  const [mesFim, setMesFim]       = useState(mesAtual())
  const [exportarContas, setExportarContas]         = useState(true)
  const [exportarCategorias, setExportarCategorias] = useState(true)
  const [exportarTransacoes, setExportarTransacoes] = useState(true)
  const [loading, setLoading] = useState(false)

  const exportar = async () => {
    setLoading(true)
    try {
      // Importar SheetJS dinamicamente
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const wb = XLSX.utils.book_new()

      // Aba: Contas
      if (exportarContas) {
        const linhas = contas.map(c => ({
          Nome: c.nome,
          Tipo: c.tipo,
          'Saldo Inicial': c.saldo_inicial ?? 0,
          'Saldo Atual': c.saldo_atual ?? 0,
          Ativa: c.ativa ? 'Sim' : 'Não',
          Ícone: c.icone ?? '',
          Cor: c.cor ?? '',
        }))
        const ws = XLSX.utils.json_to_sheet(linhas)
        ws['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 10 }, { wch: 10 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Contas')
      }

      // Aba: Categorias (com hierarquia)
      if (exportarCategorias) {
        const pais = categorias.filter(c => !c.id_pai)
        const linhas: LinhaExportCategoria[] = []
        pais.forEach(p => {
          linhas.push({
            Categoria: p.descricao,
            Subcategoria: '',
            Ícone: p.icone ?? '',
            Cor: p.cor ?? '',
          })
          categorias.filter(s => s.id_pai === p.id).forEach(s => {
            linhas.push({
              Categoria: p.descricao,
              Subcategoria: s.descricao,
              Ícone: s.icone ?? '',
              Cor: s.cor ?? '',
            })
          })
        })
        const ws = XLSX.utils.json_to_sheet(linhas)
        ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 10 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Categorias')
      }

      // Aba: Transações
      if (exportarTransacoes) {
        // Busca mês a mês no intervalo selecionado (edge function suporta ?mes=YYYY-MM)
        const gerarMeses = (ini: string, fim: string) => {
          const meses: string[] = []
          let [a, m] = ini.split('-').map(Number)
          const [af, mf] = fim.split('-').map(Number)
          while (a < af || (a === af && m <= mf)) {
            meses.push(`${a}-${String(m).padStart(2, '0')}`)
            m++; if (m > 12) { m = 1; a++ }
          }
          return meses
        }
        const meses = gerarMeses(mesInicio, mesFim)
        const resArr = await Promise.all(
          meses.map(mes => apiFetch(`/transacoes?mes=${mes}&per_page=1000&saldo=true`))
        )
        const txs = resArr.flatMap(r => extrairLista<TransacaoRaw>(r.dados))
        const contaMap = Object.fromEntries(contas.map(c => [c.conta_id, c.nome]))
        const linhas = txs
          .filter((t: TransacaoRaw) => !t.id_par_transferencia && !t.descricao?.startsWith('[Transf.'))
          .map((t: TransacaoRaw) => {
            const [a, m, d] = t.data.split('-')
            return {
              Data: `${d}/${m}/${a}`,
              Descrição: t.descricao,
              Valor: t.tipo === 'DESPESA' ? -Math.abs(t.valor) : Math.abs(t.valor),
              Conta: contaMap[t.conta_id] ?? t.conta_id,
              Categoria: t.categoria_nome ?? t.categoria_pai_nome ?? '',
              Observação: t.observacao ?? '',
            }
          })
        const ws = XLSX.utils.json_to_sheet(linhas)
        ws['!cols'] = [{ wch: 12 }, { wch: 35 }, { wch: 14 }, { wch: 20 }, { wch: 22 }, { wch: 10 }, { wch: 30 }]
        XLSX.utils.book_append_sheet(wb, ws, 'Transações')
      }

      const nomeArq = `arqvalor_export_${mesInicio}_${mesFim}.xlsx`
      XLSX.writeFile(wb, nomeArq)
    } catch (e) {
      alert(`Erro ao exportar: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const algumSelecionado = exportarContas || exportarCategorias || exportarTransacoes

  return (
    <Section titulo="Exportar dados" subtitulo="Gera um arquivo XLSX com abas separadas" icon={Download} cor="#00c896">
      <div className="space-y-4">
        {/* Período */}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Período das transações
          </p>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[10px] text-gray-400 mb-1">De</p>
              <MonthPicker value={mesInicio} onChange={setMesInicio} />
            </div>
            <span className="text-gray-400 mt-4">→</span>
            <div>
              <p className="text-[10px] text-gray-400 mb-1">Até</p>
              <MonthPicker value={mesFim} onChange={setMesFim} />
            </div>
          </div>
        </div>

        {/* O que exportar */}
        <div>
          <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            O que exportar
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Contas', sub: 'Todas as contas', checked: exportarContas, set: setExportarContas, cor: '#4da6ff' },
              { label: 'Categorias', sub: 'Com hierarquia', checked: exportarCategorias, set: setExportarCategorias, cor: '#a78bfa' },
              { label: 'Transações', sub: `${mesInicio} → ${mesFim}`, checked: exportarTransacoes, set: setExportarTransacoes, cor: '#00c896' },
            ].map(item => (
              <label key={item.label}
                className="flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-all"
                style={{
                  background: item.checked ? `${item.cor}10` : 'transparent',
                  borderColor: item.checked ? `${item.cor}50` : 'rgba(255,255,255,0.08)',
                }}>
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold" style={{ color: item.checked ? item.cor : '#8b92a8' }}>
                    {item.label}
                  </span>
                  <input type="checkbox" checked={item.checked} onChange={e => item.set(e.target.checked)}
                    className="accent-av-green" />
                </div>
                <span className="text-[10px] text-gray-400">{item.sub}</span>
              </label>
            ))}
          </div>
          <p className="text-[10px] text-gray-400 mt-2">
            * O arquivo sempre incluirá a aba "Modelo Importação" para referência
          </p>
        </div>

        <Btn onClick={exportar} loading={loading} disabled={!algumSelecionado} cor="#00c896">
          <Download size={14} /> Exportar XLSX
        </Btn>
      </div>
    </Section>
  )
}

// ══════════════════════════════════════════════════════════════════
// SEÇÃO 3 — IMPORTAÇÃO
// ══════════════════════════════════════════════════════════════════

// Linha editável no grid de revisão
interface LinhaGrid extends LinhaImport {
  importar: boolean
  duplicada: boolean
  problema: string
}

interface ContaImport {
  idx: number
  nome: string
  tipo: string
  saldo_inicial: number
  icone: string
  cor: string
  importar: boolean
  problema: string
}

interface CategoriaImport {
  idx: number
  categoria: string     // nome do pai
  subcategoria: string  // nome do filho (vazio = é pai)
  icone: string
  cor: string
  importar: boolean
  problema: string
}

type ModoImport = 'transacoes' | 'contas' | 'categorias'

function SecaoImport() {
  const { contas } = useContas()
  const { categorias } = useCategorias()

  const inputRef = useRef<HTMLInputElement>(null)
  const [modo, setModo] = useState<ModoImport>('transacoes')
  const [etapa, setEtapa] = useState<'idle' | 'revisando' | 'importando' | 'concluido'>('idle')
  const [dragOver, setDragOver] = useState(false)
  const [grid, setGrid] = useState<LinhaGrid[]>([])
  const [gridContas, setGridContas] = useState<ContaImport[]>([])
  const [gridCats, setGridCats] = useState<CategoriaImport[]>([])
  const [resolucaoContas, setResolucaoContas] = useState<Record<string, ResolucaoConta>>({})
  const [resolucaoCats, setResolucaoCats] = useState<Record<string, ResolucaoCategoria>>({})
  const [log, setLog] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; msg: string }[]>([])
  const [progresso,      setProgresso]      = useState(0)
  const [progressoInfo,  setProgressoInfo]  = useState({ atual: 0, total: 0, ok: 0, erros: 0, eta: '', velocidade: '' })
  const [logTempoReal,   setLogTempoReal]   = useState<typeof log>([])
  const [carregandoDedup, setCarregandoDedup] = useState(false)

  // ── Helpers de edição do grid ──────────────────────────────────
  const setLinha = (idx: number, patch: Partial<LinhaGrid>) =>
    setGrid(g => g.map(l => l.idx === idx ? { ...l, ...patch } : l))

  const toggleTodos = (val: boolean) =>
    setGrid(g => g.map(l => l.problema ? l : { ...l, importar: val }))

  const setContaLinha = (idx: number, patch: Partial<ContaImport>) =>
    setGridContas(g => g.map(l => l.idx === idx ? { ...l, ...patch } : l))

  const setCatLinha = (idx: number, patch: Partial<CategoriaImport>) =>
    setGridCats(g => g.map(l => l.idx === idx ? { ...l, ...patch } : l))

  // ── Parse do arquivo ───────────────────────────────────────────
  const processarArquivo = async (file: File) => {
    try {
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf, { type: 'array', cellDates: true })

      const normalizar = (obj: XlsxRow): XlsxRow => {
        const n: XlsxRow = {}
        Object.keys(obj).forEach(k => { n[k.toLowerCase().trim()] = obj[k] })
        return n
      }

      // ── MODO CONTAS ─────────────────────────────────────────────
      if (modo === 'contas') {
        const abaNome = wb.SheetNames.find((n: string) => n.toLowerCase() === 'contas') ?? wb.SheetNames[0]
        const ws   = wb.Sheets[abaNome]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as XlsxRow[]
        const tiposValidos = ['CORRENTE','REMUNERACAO','CARTAO','INVESTIMENTO','CARTEIRA']
        const contasExist  = new Set(contas.map((x: Conta) => normalizarNome(x.nome)))

        const parsed: ContaImport[] = rows.map((row, idx) => {
          const r    = normalizar(row)
          const nome = String(r['nome'] ?? r['name'] ?? '').trim()
          const tipo = String(r['tipo'] ?? r['type'] ?? 'CORRENTE').toUpperCase().trim()
          const saldo = parseFloat(String(r['saldo inicial'] ?? r['saldo_inicial'] ?? r['saldo'] ?? '0').replace(',','.')) || 0
          let problema = ''
          if (!nome) problema = 'Nome obrigatório'
          else if (!tiposValidos.includes(tipo)) problema = `Tipo inválido: ${tipo}`
          else if (contasExist.has(normalizarNome(nome))) problema = 'Já existe'
          return {
            idx, nome, tipo: tiposValidos.includes(tipo) ? tipo : 'CORRENTE',
            saldo_inicial: saldo,
            icone: String(r['ícone'] ?? r['icone'] ?? '').trim(),
            cor:   String(r['cor'] ?? '').trim(),
            importar: !problema, problema,
          }
        }).filter(l => l.nome)

        parsed.sort((a, b) => (a.problema && !b.problema) ? -1 : (!a.problema && b.problema) ? 1 : 0)
        setGridContas(parsed)
        setEtapa('revisando')
        return
      }

      // ── MODO CATEGORIAS ─────────────────────────────────────────
      if (modo === 'categorias') {
        const abaNome = wb.SheetNames.find((n: string) => n.toLowerCase() === 'categorias') ?? wb.SheetNames[0]
        const ws   = wb.Sheets[abaNome]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as XlsxRow[]
        const catsExist = new Set(categorias.map((x: CategoriaRaw) => normalizarNome(x.descricao)))

        const parsed: CategoriaImport[] = rows.map((row, idx) => {
          const r    = normalizar(row)
          const cat  = String(r['categoria'] ?? '').trim()
          const sub  = String(r['subcategoria'] ?? '').trim()
          const nome = sub || cat
          let problema = ''
          if (!cat) problema = 'Categoria obrigatória'
          else if (catsExist.has(normalizarNome(nome))) problema = 'Já existe'
          return {
            idx, categoria: cat, subcategoria: sub,
            icone: String(r['ícone'] ?? r['icone'] ?? '').trim(),
            cor:   String(r['cor'] ?? '').trim(),
            importar: !problema, problema,
          }
        }).filter(l => l.categoria)

        parsed.sort((a, b) => (a.problema && !b.problema) ? -1 : (!a.problema && b.problema) ? 1 : 0)
        setGridCats(parsed)
        setEtapa('revisando')
        return
      }

      // ── MODO TRANSAÇÕES (padrão) ────────────────────────────────
      // Prioridade: aba "Transações" > primeira aba que não seja contas/categorias/modelo
      const abaNome = wb.SheetNames.find((n: string) =>
        n.toLowerCase() === 'transações' || n.toLowerCase() === 'transacoes'
      ) ?? wb.SheetNames.find((n: string) =>
        !['modelo importação', 'modelo importacao', 'contas', 'categorias'].includes(n.toLowerCase())
      ) ?? wb.SheetNames[0]

      const ws   = wb.Sheets[abaNome]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' }) as XlsxRow[]

      console.log('[Import] Abas disponíveis:', wb.SheetNames)
      console.log('[Import] Aba selecionada:', abaNome)
      console.log('[Import] Total de linhas lidas:', rows.length)
      if (rows.length > 0) console.log('[Import] Primeira linha (keys):', Object.keys(rows[0]))

      const parsed: LinhaImport[] = rows.map((row, idx) => {
        const r = normalizar(row)
        const dataRaw = r['data'] ?? r['date'] ?? ''
        let dataFmt = ''
        if (dataRaw instanceof Date) {
          dataFmt = dataRaw.toISOString().slice(0, 10)
        } else {
          const s = String(dataRaw).trim()
          if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) {
            const [d, m, a] = s.split('/')
            dataFmt = `${a}-${m}-${d}`
          } else {
            dataFmt = s.slice(0, 10)
          }
        }

        const valorRaw  = r['valor'] ?? r['value'] ?? 0
        const valorNum  = parseValor(String(valorRaw))
        const valor     = Math.abs(valorNum)
        const tipoRaw   = String(r['tipo'] ?? r['type'] ?? '').toUpperCase()
        const tipo: 'RECEITA' | 'DESPESA' = tipoRaw === 'RECEITA' ? 'RECEITA'
          : tipoRaw === 'DESPESA' ? 'DESPESA'
          : valorNum < 0 ? 'DESPESA' : 'RECEITA'
        const statusRaw = String(r['status'] ?? '').toUpperCase()
        const hoje = new Date().toISOString().slice(0, 10)
        const statusAuto = dataFmt && dataFmt < hoje ? 'PAGO' : 'PENDENTE'
        const status = ['PAGO', 'PENDENTE', 'PROJECAO'].includes(statusRaw) ? statusRaw : statusAuto

        return {
          idx,
          data:           dataFmt,
          descricao:      String(r['descrição'] ?? r['descricao'] ?? r['description'] ?? '').trim(),
          valor,
          tipo,
          conta_nome:     String(r['conta'] ?? r['account'] ?? '').trim(),
          categoria_nome: String(r['categoria'] ?? r['category'] ?? '').trim(),
          status,
          observacao:     String(r['observação'] ?? r['observacao'] ?? r['observation'] ?? '').trim(),
        }
      }).filter(l => l.descricao && l.valor > 0 && l.conta_nome && l.categoria_nome)

      console.log('[Import] Linhas após filtro:', parsed.length)
      if (parsed.length === 0 && rows.length > 0) {
        console.log('[Import] DEBUG primeira linha normalizada:', Object.fromEntries(
          Object.keys(rows[0]).map(k => [k.toLowerCase().trim(), rows[0][k]])
        ))
      }

      // ── Detectar contas e categorias desconhecidas ──────────────
      const contaMap = Object.fromEntries(contas.map((c: Conta) => [normalizarNome(c.nome), c.conta_id]))
      const catMap   = Object.fromEntries(categorias.map((c: CategoriaRaw) => [normalizarNome(c.descricao), c.id]))

      const contasDesc = new Set<string>()
      const catsDesc   = new Map<string, 'RECEITA' | 'DESPESA'>()
      parsed.forEach(l => {
        if (!contaMap[normalizarNome(l.conta_nome)]) contasDesc.add(l.conta_nome)
        if (!catMap[normalizarNome(l.categoria_nome)]) catsDesc.set(l.categoria_nome, l.tipo)
      })

      const rc: Record<string, ResolucaoConta> = {}
      contasDesc.forEach(nome => { rc[nome] = { nome, acao: 'criar' } })
      const rcat: Record<string, ResolucaoCategoria> = {}
      catsDesc.forEach((tipo, nome) => { rcat[nome] = { nome, tipo, acao: 'criar' } })

      setResolucaoContas(rc)
      setResolucaoCats(rcat)

      // ── Verificar duplicatas no banco ───────────────────────────
      setCarregandoDedup(true)
      let txExistentes: TransacaoRaw[] = []
      try {
        const { apiFetch: apiFetchDyn, extrairLista: extrairListaDyn } = await import('../lib/api')
        // Buscar transações dos meses do arquivo para comparar
        const datasUnicas = [...new Set(parsed.map(l => l.data.slice(0, 7)).filter(Boolean))]
        const resArr = await Promise.all(
          datasUnicas.map(mes => apiFetchDyn(`/transacoes?mes=${mes}&per_page=1000&saldo=true`))
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        txExistentes = resArr.flatMap(r => extrairListaDyn<any>(r.dados))
      } catch { /* se falhar, segue sem checar duplicatas */ }
      setCarregandoDedup(false)

      // Chave de duplicata: data + descricao normalizada + categoria_nome normalizada
      const chaveExistente = new Set(
        txExistentes.map(t =>
          `${t.data}|${normalizarNome(t.descricao)}|${normalizarNome(t.categoria_nome ?? '')}`
        )
      )

      // ── Montar grid com status de cada linha ────────────────────
      const linhasGrid: LinhaGrid[] = parsed.map(l => {
        const chave = `${l.data}|${normalizarNome(l.descricao)}|${normalizarNome(l.categoria_nome)}`
        const duplicada = chaveExistente.has(chave)

        // Determinar problemas
        let problema = ''
        if (!l.data || l.data.length < 8) problema = 'Data inválida'
        else if (duplicada) problema = 'Já existe no banco'

        return { ...l, importar: !problema, duplicada, problema }
      })

      // Ordenar: com problema primeiro, depois ok
      linhasGrid.sort((a, b) => {
        if (a.problema && !b.problema) return -1
        if (!a.problema && b.problema) return 1
        return 0
      })

      setGrid(linhasGrid)
      setEtapa('revisando')

    } catch (e) {
      alert(`Erro ao ler arquivo: ${(e as Error).message}`)
    }
  }

  const onArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processarArquivo(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processarArquivo(file)
  }

  // ── Importar ───────────────────────────────────────────────────
  const importar = async () => {
    setEtapa('importando')
    setProgresso(0)
    setProgressoInfo({ atual: 0, total: 0, ok: 0, erros: 0, eta: '', velocidade: '' })
    setLogTempoReal([])
    const logs: typeof log = []
    const addLog = (tipo: 'ok' | 'erro' | 'aviso', msg: string) => {
      logs.push({ tipo, msg })
      setLogTempoReal(prev => [...prev.slice(-49), { tipo, msg }])
    }

    // ── MODO CONTAS ────────────────────────────────────────────────
    if (modo === 'contas') {
      const paraImportar = gridContas.filter(l => l.importar)
      let ok = 0, erros = 0
      for (let i = 0; i < paraImportar.length; i++) {
        const l = paraImportar[i]
        const r = await apiMutate('/contas', 'POST', {
          nome: l.nome, tipo: l.tipo, saldo_inicial: l.saldo_inicial,
          icone: l.icone || undefined, cor: l.cor || undefined,
        })
        if (r.ok) ok++
        else { addLog('erro', `"${l.nome}": ${r.erro}`); erros++ }
        setProgresso(Math.round(((i + 1) / paraImportar.length) * 100))
      }
      addLog('ok', `Contas: ${ok} importadas, ${erros} erros`)
      setLog(logs)
      setEtapa('concluido')
      return
    }

    // ── MODO CATEGORIAS ─────────────────────────────────────────────
    if (modo === 'categorias') {
      const paraImportar = gridCats.filter(l => l.importar)
      // Pais primeiro, depois filhos
      const pais   = paraImportar.filter(l => !l.subcategoria)
      const filhos = paraImportar.filter(l =>  l.subcategoria)
      const mapaIdPai: Record<string, string> = {}
      // Mapear categorias pai já existentes
      categorias.forEach((c: CategoriaRaw) => { if (!c.id_pai) mapaIdPai[normalizarNome(c.descricao)] = c.id })

      let ok = 0, erros = 0
      const total = pais.length + filhos.length
      for (let i = 0; i < pais.length; i++) {
        const l = pais[i]
        const r = await apiMutate('/categorias', 'POST', {
          descricao: l.categoria, icone: l.icone || undefined, cor: l.cor || undefined,
        })
        if (r.ok && r.dados?.id) { mapaIdPai[normalizarNome(l.categoria)] = r.dados.id; ok++ }
        else { addLog('erro', `"${l.categoria}": ${r.erro}`); erros++ }
        setProgresso(Math.round(((i + 1) / total) * 100))
      }
      for (let i = 0; i < filhos.length; i++) {
        const l = filhos[i]
        const idPai = mapaIdPai[normalizarNome(l.categoria)]
        if (!idPai) { addLog('aviso', `"${l.subcategoria}": categoria pai "${l.categoria}" não encontrada`); erros++; continue }
        const r = await apiMutate('/categorias', 'POST', {
          descricao: l.subcategoria, id_pai: idPai,
          icone: l.icone || undefined, cor: l.cor || undefined,
        })
        if (r.ok) ok++
        else { addLog('erro', `"${l.subcategoria}": ${r.erro}`); erros++ }
        setProgresso(Math.round(((pais.length + i + 1) / total) * 100))
      }
      addLog('ok', `Categorias: ${ok} importadas, ${erros} erros`)
      setLog(logs)
      setEtapa('concluido')
      return
    }

    try {
      const contaMap = Object.fromEntries(contas.map((c: Conta) => [normalizarNome(c.nome), c.conta_id]))
      const catMap   = Object.fromEntries(categorias.map((c: CategoriaRaw) => [normalizarNome(c.descricao), c.id]))

      // 1. Criar/mapear contas desconhecidas
      for (const [nome, res] of Object.entries(resolucaoContas)) {
        if (res.acao === 'criar') {
          const r = await apiMutate('/contas', 'POST', { nome, tipo: 'CORRENTE', saldo_inicial: 0 })
          if (r.ok && r.dados?.conta_id) {
            contaMap[normalizarNome(nome)] = r.dados.conta_id
            addLog('ok', `Conta criada: ${nome}`)
          } else addLog('erro', `Falha ao criar conta "${nome}": ${r.erro}`)
        } else if (res.acao === 'mapear' && res.mapear_para) {
          contaMap[normalizarNome(nome)] = res.mapear_para
        }
      }

      // 2. Criar/mapear categorias desconhecidas
      for (const [nome, res] of Object.entries(resolucaoCats)) {
        if (res.acao === 'criar') {
          const r = await apiMutate('/categorias', 'POST', { descricao: nome, tipo: res.tipo })
          if (r.ok && r.dados?.id) {
            catMap[normalizarNome(nome)] = r.dados.id
            addLog('ok', `Categoria criada: ${nome} (${res.tipo})`)
          } else addLog('erro', `Falha ao criar categoria "${nome}": ${r.erro}`)
        } else if (res.acao === 'mapear' && res.mapear_para) {
          catMap[normalizarNome(nome)] = res.mapear_para
        }
      }

      // 3. Importar apenas linhas marcadas para importar
      const linhasParaImportar = grid.filter(l => l.importar)
      const total = linhasParaImportar.length
      let ok = 0, erros = 0
      const tInicio = Date.now()

      for (let i = 0; i < total; i++) {
        const l = linhasParaImportar[i]
        const conta_id     = contaMap[normalizarNome(l.conta_nome)]
        const categoria_id = catMap[normalizarNome(l.categoria_nome)]

        if (!conta_id || !categoria_id) {
          addLog('erro', `"${l.descricao}" ignorada: conta ou categoria não resolvida`)
          erros++
        } else {
          const r = await apiMutate('/transacoes', 'POST', {
            tipo: l.tipo, data: l.data, descricao: l.descricao,
            valor: l.valor, conta_id, categoria_id,
            status: l.status,
            observacao: l.observacao || undefined,
          })
          if (r.ok) ok++
          else { addLog('erro', `"${l.descricao}" (${l.data}): ${r.erro}`); erros++ }
        }

        // Atualizar progresso e liberar event loop a cada 5 registros
        if (i % 5 === 0 || i === total - 1) {
          const pct      = Math.round(((i + 1) / total) * 100)
          const elapsed  = (Date.now() - tInicio) / 1000
          const velocidade = elapsed > 0 ? ((i + 1) / elapsed).toFixed(1) : '...'
          const restantes = total - (i + 1)
          const etaSeg   = elapsed > 0 && i > 0 ? Math.round(restantes / ((i + 1) / elapsed)) : null
          const eta      = etaSeg !== null
            ? etaSeg > 60
              ? `${Math.floor(etaSeg / 60)}m ${etaSeg % 60}s`
              : `${etaSeg}s`
            : '...'
          setProgresso(pct)
          setProgressoInfo({ atual: i + 1, total, ok, erros, eta, velocidade: `${velocidade}/s` })
          // Yield para o React atualizar o DOM
          await new Promise(r => setTimeout(r, 0))
        }
      }

      const ignoradas = grid.filter(l => !l.importar).length
      addLog('ok', `Concluído: ${ok} importadas, ${erros} erros, ${ignoradas} ignoradas`)
    } catch (e) {
      addLog('erro', `Erro inesperado: ${(e as Error).message}`)
    } finally {
      setLog(logs)
      setEtapa('concluido')
    }
  }

  const resetar = () => {
    setEtapa('idle')
    setGrid([])
    setGridContas([])
    setGridCats([])
    setResolucaoContas({})
    setResolucaoCats({})
    setLog([])
    setProgresso(0)
  }

  const contasDesconhecidas = Object.keys(resolucaoContas)
  const catsDesconhecidas   = Object.keys(resolucaoCats)
  const linhasComProblema   = grid.filter(l => l.problema)
  const linhasSelecionadas  = grid.filter(l => l.importar)
  const temPendenciaMapear  =
    contasDesconhecidas.some(n => resolucaoContas[n]?.acao === 'mapear' && !resolucaoContas[n]?.mapear_para) ||
    catsDesconhecidas.some(n => resolucaoCats[n]?.acao === 'mapear' && !resolucaoCats[n]?.mapear_para)

  return (
    <Section titulo="Importar dados" subtitulo="Importa transações de CSV ou XLSX" icon={Upload} cor="#a78bfa">
      <div className="space-y-4">

        {/* ── IDLE ── */}
        {etapa === 'idle' && (
          <div className="space-y-3">
            {/* Seletor de modo */}
            <div className="flex rounded-lg overflow-hidden border border-white/10 text-[12px] font-semibold">
              {([
                { value: 'transacoes', label: 'Transações' },
                { value: 'contas',     label: 'Contas'     },
                { value: 'categorias', label: 'Categorias' },
              ] as { value: ModoImport; label: string }[]).map((op, i) => (
                <button
                  key={op.value}
                  onClick={() => setModo(op.value)}
                  className="flex-1 px-3 py-2 transition-colors"
                  style={{
                    background: modo === op.value ? 'rgba(167,139,250,0.15)' : 'transparent',
                    color: modo === op.value ? '#a78bfa' : '#8b92a8',
                    borderRight: i < 2 ? '1px solid rgba(255,255,255,0.1)' : 'none',
                  }}
                >
                  {op.label}
                </button>
              ))}
            </div>

            <div
              className="rounded-xl p-8 text-center cursor-pointer transition-all duration-200"
              style={{
                border: `2px dashed ${dragOver ? '#a78bfa' : '#374151'}`,
                background: dragOver ? 'rgba(167,139,250,0.06)' : 'transparent',
              }}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <FileSpreadsheet size={32} className="mx-auto mb-3" style={{ color: dragOver ? '#a78bfa' : '#4b5563' }} />
              <p className="text-[14px] font-semibold mb-1" style={{ color: dragOver ? '#a78bfa' : '#d1d5db' }}>
                {dragOver ? 'Solte o arquivo aqui' : 'Arraste um arquivo ou clique para selecionar'}
              </p>
              <p className="text-[11px] text-gray-400 mb-4">
                {modo === 'transacoes' && 'CSV ou XLSX — use a aba "Modelo Importação" como referência'}
                {modo === 'contas' && 'XLSX com colunas: Nome | Tipo | Saldo Inicial (opcional: Ícone, Cor)'}
                {modo === 'categorias' && 'XLSX com colunas: Categoria | Subcategoria (opcional: Ícone, Cor)'}
              </p>
              <button
                onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
                className="px-5 py-2 rounded-lg text-[13px] font-semibold transition-colors"
                style={{ background: '#a78bfa20', color: '#a78bfa', border: '1px solid #a78bfa40' }}
              >
                Escolher arquivo
              </button>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onArquivo} />
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              {modo === 'transacoes' && <>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-2">Colunas esperadas:</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { col: 'data', obrig: true },
                    { col: 'descricao', obrig: true },
                    { col: 'valor', obrig: true },
                    { col: 'conta', obrig: true },
                    { col: 'categoria', obrig: true },
                    { col: 'tipo', obrig: false },
                    { col: 'observacao', obrig: false },
                  ].map(col => (
                    <div key={col.col} className="flex items-center gap-1">
                      <code className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: col.obrig ? '#a78bfa20' : '#ffffff10', color: col.obrig ? '#a78bfa' : '#8b92a8' }}>
                        {col.col}
                      </code>
                      {col.obrig && <span className="text-[9px] text-red-400">*</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400">* obrigatório — valor negativo = DESPESA, positivo = RECEITA | datas no formato DD/MM/AAAA</p>
              </>}
              {modo === 'contas' && <>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-2">Colunas esperadas:</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { col: 'nome', obrig: true },
                    { col: 'tipo', obrig: true },
                    { col: 'saldo inicial', obrig: false },
                    { col: 'icone', obrig: false },
                    { col: 'cor', obrig: false },
                  ].map(col => (
                    <div key={col.col} className="flex items-center gap-1">
                      <code className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: col.obrig ? '#a78bfa20' : '#ffffff10', color: col.obrig ? '#a78bfa' : '#8b92a8' }}>
                        {col.col}
                      </code>
                      {col.obrig && <span className="text-[9px] text-red-400">*</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400">Tipos válidos: CORRENTE | REMUNERACAO | CARTAO | INVESTIMENTO | CARTEIRA</p>
              </>}
              {modo === 'categorias' && <>
                <p className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 mb-2">Colunas esperadas:</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { col: 'categoria', obrig: true },
                    { col: 'subcategoria', obrig: false },
                    { col: 'icone', obrig: false },
                    { col: 'cor', obrig: false },
                  ].map(col => (
                    <div key={col.col} className="flex items-center gap-1">
                      <code className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: col.obrig ? '#a78bfa20' : '#ffffff10', color: col.obrig ? '#a78bfa' : '#8b92a8' }}>
                        {col.col}
                      </code>
                      {col.obrig && <span className="text-[9px] text-red-400">*</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-gray-400">Subcategoria vazia = categoria pai | com valor = subcategoria filha</p>
              </>}
            </div>

            {/* Botão baixar modelo */}
            <button
              onClick={async () => {
                const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
                const wb = XLSX.utils.book_new()
                if (modo === 'transacoes') {
                  const ws = XLSX.utils.json_to_sheet([
                    { data: '15/01/2024', descricao: 'Conta de luz', valor: -150.00, conta: 'Conta Corrente', categoria: 'Moradia', observacao: '' },
                    { data: '20/01/2024', descricao: 'Salário', valor: 5000.00, conta: 'Conta Corrente', categoria: 'Salário', observacao: 'Pagamento mensal' },
                  ])
                  ws['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 30 }]
                  XLSX.utils.book_append_sheet(wb, ws, 'Transações')
                } else if (modo === 'contas') {
                  const ws = XLSX.utils.json_to_sheet([
                    { nome: 'Conta Corrente', tipo: 'CORRENTE', 'saldo inicial': 1000.00, icone: '🏦', cor: '#4da6ff' },
                    { nome: 'Cartão Nubank', tipo: 'CARTAO', 'saldo inicial': 0, icone: '💳', cor: '#8b5cf6' },
                    { nome: 'Carteira', tipo: 'CARTEIRA', 'saldo inicial': 200.00, icone: '👛', cor: '#f0b429' },
                  ])
                  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 10 }]
                  XLSX.utils.book_append_sheet(wb, ws, 'Contas')
                } else {
                  const ws = XLSX.utils.json_to_sheet([
                    { categoria: 'Moradia', subcategoria: '', icone: '🏠', cor: '' },
                    { categoria: 'Moradia', subcategoria: 'Aluguel', icone: '', cor: '' },
                    { categoria: 'Moradia', subcategoria: 'Condomínio', icone: '', cor: '' },
                    { categoria: 'Alimentação', subcategoria: '', icone: '🍽️', cor: '' },
                    { categoria: 'Alimentação', subcategoria: 'Supermercado', icone: '', cor: '' },
                  ])
                  ws['!cols'] = [{ wch: 22 }, { wch: 22 }, { wch: 8 }, { wch: 10 }]
                  XLSX.utils.book_append_sheet(wb, ws, 'Categorias')
                }
                const nomeArq = `modelo_importacao_${modo}.xlsx`
                XLSX.writeFile(wb, nomeArq)
              }}
              className="flex items-center gap-2 text-[12px] font-semibold px-3 py-2 rounded-lg transition-colors"
              style={{ background: 'rgba(167,139,250,0.08)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.2)' }}
            >
              <Download size={13} /> Baixar modelo de importação
            </button>
          </div>
        )}

        {/* ── REVISANDO ── */}
        {etapa === 'revisando' && (
          <div className="space-y-4">

            {/* Tags de resumo */}
            <div className="flex items-center gap-2 flex-wrap">
              {modo === 'transacoes' && <>
                <Tag cor="#00c896">{grid.length} lidas</Tag>
                <Tag cor="#a78bfa">{linhasSelecionadas.length} para importar</Tag>
                {linhasComProblema.length > 0 && <Tag cor="#ff6b4a">{linhasComProblema.length} com problema</Tag>}
                {contasDesconhecidas.length > 0 && <Tag cor="#f0b429">{contasDesconhecidas.length} conta(s) nova(s)</Tag>}
                {catsDesconhecidas.length > 0 && <Tag cor="#a78bfa">{catsDesconhecidas.length} categoria(s) nova(s)</Tag>}
                {carregandoDedup && <span className="text-[11px] text-gray-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin"/> verificando duplicatas...</span>}
              </>}
              {modo === 'contas' && <>
                <Tag cor="#00c896">{gridContas.length} lidas</Tag>
                <Tag cor="#a78bfa">{gridContas.filter(l => l.importar).length} para importar</Tag>
                {gridContas.filter(l => l.problema).length > 0 && <Tag cor="#ff6b4a">{gridContas.filter(l => l.problema).length} com problema</Tag>}
              </>}
              {modo === 'categorias' && <>
                <Tag cor="#00c896">{gridCats.length} lidas</Tag>
                <Tag cor="#a78bfa">{gridCats.filter(l => l.importar).length} para importar</Tag>
                {gridCats.filter(l => l.problema).length > 0 && <Tag cor="#ff6b4a">{gridCats.filter(l => l.problema).length} com problema</Tag>}
              </>}
            </div>

            {/* ── Grid de Contas ── */}
            {modo === 'contas' && (
              <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 max-h-[350px]">
                <table className="w-full text-[11px]">
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 w-8 text-center">✓</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500">Situação</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500">Nome</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500">Tipo</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-500">Saldo Inicial</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridContas.map(l => (
                      <tr key={l.idx} className="border-t border-gray-700/50"
                        style={{ background: l.problema ? 'rgba(255,107,74,0.06)' : 'transparent', opacity: l.importar ? 1 : 0.45 }}>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={l.importar}
                            onChange={e => setContaLinha(l.idx, { importar: e.target.checked })}
                            className="accent-av-green" />
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {l.problema
                            ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-400/10 text-red-400">{l.problema}</span>
                            : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400">OK</span>}
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={l.nome}
                            onChange={e => setContaLinha(l.idx, { nome: e.target.value })}
                            className="w-full min-w-[140px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[11px] text-gray-300 outline-none" />
                        </td>
                        <td className="px-1 py-1">
                          <select value={l.tipo}
                            onChange={e => setContaLinha(l.idx, { tipo: e.target.value })}
                            className="bg-transparent border border-transparent hover:border-white/10 rounded px-1 py-0.5 text-[11px] text-gray-300 outline-none"
                            style={{ background: '#1a1f2e' }}>
                            {['CORRENTE','REMUNERACAO','CARTAO','INVESTIMENTO','CARTEIRA'].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1 text-right">
                          <input type="number" step="0.01" value={l.saldo_inicial}
                            onChange={e => setContaLinha(l.idx, { saldo_inicial: parseFloat(e.target.value) || 0 })}
                            className="w-[90px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[11px] text-right text-gray-300 outline-none" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Grid de Categorias ── */}
            {modo === 'categorias' && (
              <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 max-h-[350px]">
                <table className="w-full text-[11px]">
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 w-8 text-center">✓</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500">Situação</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500">Categoria (pai)</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500">Subcategoria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridCats.map(l => (
                      <tr key={l.idx} className="border-t border-gray-700/50"
                        style={{ background: l.problema ? 'rgba(255,107,74,0.06)' : 'transparent', opacity: l.importar ? 1 : 0.45 }}>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={l.importar}
                            onChange={e => setCatLinha(l.idx, { importar: e.target.checked })}
                            className="accent-av-green" />
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {l.problema
                            ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-400/10 text-red-400">{l.problema}</span>
                            : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400">{l.subcategoria ? 'Subcategoria' : 'Pai'}</span>}
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={l.categoria}
                            onChange={e => setCatLinha(l.idx, { categoria: e.target.value })}
                            className="w-full min-w-[130px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[11px] text-gray-300 outline-none" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={l.subcategoria}
                            onChange={e => setCatLinha(l.idx, { subcategoria: e.target.value })}
                            className="w-full min-w-[130px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[11px] text-gray-300 outline-none"
                            placeholder="(vazio = categoria pai)" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Resolver contas */}
            {modo === 'transacoes' && contasDesconhecidas.length > 0 && (
              <div>
                <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-300 mb-2">Contas não encontradas — como proceder?</p>
                <div className="space-y-2">
                  {contasDesconhecidas.map(nome => (
                    <div key={nome} className="bg-amber-400/5 border border-amber-400/20 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[12px] font-semibold text-amber-400">"{nome}"</span>
                        <div className="flex gap-1">
                          {(['criar', 'mapear'] as const).map(acao => (
                            <button key={acao} onClick={() => setResolucaoContas(r => ({ ...r, [nome]: { ...r[nome], acao } }))}
                              className="px-2.5 py-1 rounded text-[11px] font-semibold transition-colors"
                              style={{
                                background: resolucaoContas[nome]?.acao === acao ? '#f0b42920' : 'transparent',
                                color: resolucaoContas[nome]?.acao === acao ? '#f0b429' : '#8b92a8',
                                border: `1px solid ${resolucaoContas[nome]?.acao === acao ? '#f0b42940' : '#ffffff10'}`,
                              }}>
                              {acao === 'criar' ? 'Criar nova' : 'Usar existente'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {resolucaoContas[nome]?.acao === 'mapear' && (
                        <select value={resolucaoContas[nome]?.mapear_para ?? ''}
                          onChange={e => setResolucaoContas(r => ({ ...r, [nome]: { ...r[nome], mapear_para: e.target.value } }))}
                          className="w-full bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-1.5 text-[12px] text-gray-200">
                          <option value="">Selecionar conta...</option>
                          {contas.map((c: Conta) => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Resolver categorias */}
            {modo === 'transacoes' && catsDesconhecidas.length > 0 && (
              <div>
                <p className="text-[12px] font-semibold text-gray-700 dark:text-gray-300 mb-2">Categorias não encontradas — como proceder?</p>
                <div className="space-y-2">
                  {catsDesconhecidas.map(nome => (
                    <div key={nome} className="bg-purple-400/5 border border-purple-400/20 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-purple-400">"{nome}"</span>
                          <Tag cor={resolucaoCats[nome]?.tipo === 'RECEITA' ? '#00c896' : '#ff6b4a'}>{resolucaoCats[nome]?.tipo}</Tag>
                        </div>
                        <div className="flex gap-1">
                          {(['criar', 'mapear'] as const).map(acao => (
                            <button key={acao} onClick={() => setResolucaoCats(r => ({ ...r, [nome]: { ...r[nome], acao } }))}
                              className="px-2.5 py-1 rounded text-[11px] font-semibold transition-colors"
                              style={{
                                background: resolucaoCats[nome]?.acao === acao ? '#a78bfa20' : 'transparent',
                                color: resolucaoCats[nome]?.acao === acao ? '#a78bfa' : '#8b92a8',
                                border: `1px solid ${resolucaoCats[nome]?.acao === acao ? '#a78bfa40' : '#ffffff10'}`,
                              }}>
                              {acao === 'criar' ? 'Criar nova' : 'Usar existente'}
                            </button>
                          ))}
                        </div>
                      </div>
                      {resolucaoCats[nome]?.acao === 'mapear' && (
                        <select value={resolucaoCats[nome]?.mapear_para ?? ''}
                          onChange={e => setResolucaoCats(r => ({ ...r, [nome]: { ...r[nome], mapear_para: e.target.value } }))}
                          className="w-full bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-1.5 text-[12px] text-gray-200">
                          <option value="">Selecionar categoria...</option>
                          {categorias.filter((c: CategoriaRaw) => c.tipo === resolucaoCats[nome]?.tipo).map((c: CategoriaRaw) => (
                            <option key={c.id} value={c.id}>{c.descricao}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Grid editável — transações */}
            {modo === 'transacoes' && <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">
                  Grid de revisão — edite os dados antes de importar
                </p>
                <div className="flex gap-2">
                  <button onClick={() => toggleTodos(true)}
                    className="text-[10px] px-2 py-1 rounded text-av-green bg-av-green/10 hover:bg-av-green/20 transition-colors">
                    Marcar todos
                  </button>
                  <button onClick={() => toggleTodos(false)}
                    className="text-[10px] px-2 py-1 rounded text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    Desmarcar todos
                  </button>
                </div>
              </div>

              <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 max-h-[400px]">
                <table className="w-full text-[11px]" style={{ minWidth: 900 }}>
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-center w-8">✓</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Situação</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Data</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Descrição</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-500 dark:text-gray-400">Valor</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Conta</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Categoria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map(l => {
                      const temProblema = !!l.problema
                      const bgRow = temProblema
                        ? 'rgba(255,107,74,0.06)'
                        : l.importar ? 'transparent' : 'rgba(255,255,255,0.02)'
                      return (
                        <tr key={l.idx}
                          className="border-t border-gray-100 dark:border-gray-700/50"
                          style={{ background: bgRow, opacity: l.importar ? 1 : 0.45 }}>

                          {/* Checkbox */}
                          <td className="px-2 py-1 text-center">
                            <input type="checkbox" checked={l.importar}
                              onChange={e => setLinha(l.idx, { importar: e.target.checked })}
                              className="accent-av-green" />
                          </td>

                          {/* Situação */}
                          <td className="px-2 py-1 whitespace-nowrap">
                            {temProblema
                              ? <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-red-400/10 text-red-400">{l.problema}</span>
                              : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400">OK</span>
                            }
                          </td>

                          {/* Data — editável */}
                          <td className="px-1 py-1">
                            <input
                              type="text"
                              value={l.data}
                              onChange={e => setLinha(l.idx, { data: e.target.value })}
                              className="w-[90px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[11px] text-gray-300 outline-none"
                            />
                          </td>

                          {/* Descrição — editável */}
                          <td className="px-1 py-1">
                            <input
                              type="text"
                              value={l.descricao}
                              onChange={e => setLinha(l.idx, { descricao: e.target.value })}
                              className="w-full min-w-[160px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[11px] text-gray-300 outline-none"
                            />
                          </td>

                          {/* Valor — editável */}
                          <td className="px-1 py-1 text-right">
                            <input
                              type="number"
                              step="0.01"
                              value={l.valor}
                              onChange={e => {
                                const v = Math.abs(parseFloat(e.target.value) || 0)
                                setLinha(l.idx, { valor: v })
                              }}
                              className="w-[90px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[11px] text-right outline-none"
                              style={{ color: l.tipo === 'RECEITA' ? '#00c896' : '#ff6b4a' }}
                            />
                          </td>

                          {/* Conta — editável via select */}
                          <td className="px-1 py-1">
                            <select
                              value={contas.find((c: Conta) => normalizarNome(c.nome) === normalizarNome(l.conta_nome))?.conta_id ?? ''}
                              onChange={e => {
                                const conta = contas.find((c: Conta) => c.conta_id === e.target.value)
                                if (conta) setLinha(l.idx, { conta_nome: conta.nome })
                              }}
                              className="bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1 py-0.5 text-[11px] text-gray-300 outline-none max-w-[130px]"
                              style={{ background: '#1a1f2e' }}
                            >
                              <option value="">— selecionar —</option>
                              {contas.map((c: Conta) => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
                            </select>
                          </td>

                          {/* Categoria — editável via select */}
                          <td className="px-1 py-1">
                            <select
                              value={categorias.find((c: CategoriaRaw) => normalizarNome(c.descricao) === normalizarNome(l.categoria_nome))?.id ?? ''}
                              onChange={e => {
                                const cat = categorias.find((c: CategoriaRaw) => c.id === e.target.value)
                                if (cat) setLinha(l.idx, { categoria_nome: cat.descricao })
                              }}
                              className="bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1 py-0.5 text-[11px] text-gray-300 outline-none max-w-[140px]"
                              style={{ background: '#1a1f2e' }}
                            >
                              <option value="">— selecionar —</option>
                              {categorias.map((c: CategoriaRaw) => <option key={c.id} value={c.id}>{c.descricao}</option>)}
                            </select>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>}

            {/* Aviso de pendências */}
            {modo === 'transacoes' && temPendenciaMapear && (
              <p className="text-[11px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                ⚠️ Selecione o destino para todas as entidades marcadas como "Usar existente"
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={resetar}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                Cancelar
              </button>
              <Btn onClick={importar} cor="#a78bfa"
                disabled={
                  (modo === 'transacoes' && (temPendenciaMapear || linhasSelecionadas.length === 0)) ||
                  (modo === 'contas' && gridContas.filter(l => l.importar).length === 0) ||
                  (modo === 'categorias' && gridCats.filter(l => l.importar).length === 0)
                }>
                <Upload size={14} />
                {modo === 'transacoes' && `Importar ${linhasSelecionadas.length} transações`}
                {modo === 'contas' && `Importar ${gridContas.filter(l => l.importar).length} contas`}
                {modo === 'categorias' && `Importar ${gridCats.filter(l => l.importar).length} categorias`}
              </Btn>
            </div>
          </div>
        )}

        {/* ── IMPORTANDO ── */}
        {etapa === 'importando' && (
          <div className="space-y-4">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-purple-400" />
                <span className="text-[13px] font-semibold" style={{ color: '#a78bfa' }}>
                  Importando lançamentos...
                </span>
              </div>
              <span className="text-[12px] font-bold" style={{ color: '#a78bfa' }}>
                {progresso}%
              </span>
            </div>

            {/* Barra de progresso */}
            <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-200"
                style={{
                  width: `${progresso}%`,
                  background: progresso < 30
                    ? '#a78bfa'
                    : progresso < 70
                    ? '#8b5cf6'
                    : '#7c3aed',
                }}
              />
            </div>

            {/* Métricas */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Processados', value: `${progressoInfo.atual} / ${progressoInfo.total}`, color: '#e8eaf0' },
                { label: 'Importados', value: progressoInfo.ok, color: '#00c896' },
                { label: 'Erros', value: progressoInfo.erros, color: progressoInfo.erros > 0 ? '#f87171' : '#8b92a8' },
                { label: 'Velocidade', value: progressoInfo.velocidade || '...', color: '#4da6ff' },
              ].map((m, i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2 text-center">
                  <p className="text-[10px] uppercase tracking-wide mb-0.5" style={{ color: '#8b92a8' }}>{m.label}</p>
                  <p className="text-[13px] font-bold" style={{ color: m.color }}>{m.value}</p>
                </div>
              ))}
            </div>

            {/* ETA */}
            {progressoInfo.eta && progressoInfo.eta !== '...' && (
              <p className="text-[11px] text-center" style={{ color: '#8b92a8' }}>
                Tempo restante estimado: <span style={{ color: '#e8eaf0' }}>{progressoInfo.eta}</span>
              </p>
            )}

            {/* Log em tempo real */}
            {logTempoReal.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 max-h-[140px] overflow-y-auto space-y-1">
                {logTempoReal.slice().reverse().map((l, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[11px]">
                    <span style={{ color: l.tipo === 'ok' ? '#00c896' : l.tipo === 'aviso' ? '#f0b429' : '#f87171', flexShrink: 0 }}>
                      {l.tipo === 'ok' ? '✓' : l.tipo === 'aviso' ? '⚠' : '✗'}
                    </span>
                    <span style={{ color: l.tipo === 'ok' ? '#8b92a8' : l.tipo === 'aviso' ? '#f0b429' : '#f87171' }}>
                      {l.msg}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── CONCLUÍDO ── */}
        {etapa === 'concluido' && (
          <div className="space-y-3">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-1.5">
              {log.map((l, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px]">
                  {l.tipo === 'ok'
                    ? <CheckCircle2 size={13} className="text-av-green flex-shrink-0 mt-0.5" />
                    : l.tipo === 'aviso'
                    ? <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    : <X size={13} className="text-red-400 flex-shrink-0 mt-0.5" />}
                  <span style={{ color: l.tipo === 'ok' ? '#00c896' : l.tipo === 'aviso' ? '#f0b429' : '#f87171' }}>
                    {l.msg}
                  </span>
                </div>
              ))}
            </div>
            <Btn onClick={resetar} cor="#a78bfa">
              <RefreshCw size={14} /> Nova importação
            </Btn>
          </div>
        )}
      </div>
    </Section>
  )
}


// ══════════════════════════════════════════════════════════════════
// SEÇÃO 4 — BACKUP COMPLETO
// ══════════════════════════════════════════════════════════════════
function SecaoBackup() {
  const { contas } = useContas()
  const { categorias } = useCategorias()
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState<{ tipo: 'ok' | 'erro'; msg: string }[]>([])

  const fazerBackup = async () => {
    setLoading(true)
    setLog([])
    const addLog = (tipo: 'ok' | 'erro', msg: string) => setLog(l => [...l, { tipo, msg }])

    try {
      // 1. Contas
      addLog('ok', `Contas: ${contas.length} registros`)

      // 2. Categorias
      addLog('ok', `Categorias: ${categorias.length} registros`)

      // 3. Transações — 60 meses passados + 24 meses futuros (cobre projeções e parcelas)
      addLog('ok', 'Buscando transações...')
      const hoje = new Date()
      const meses: string[] = []
      for (let i = 60; i >= -24; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
        meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      }
      const resArr = await Promise.all(
        meses.map(mes => apiFetch(`/transacoes?mes=${mes}&per_page=1000`))
      )
      const todasTx = resArr.flatMap(r => extrairLista<TransacaoRaw>(r.dados))
      // Deduplica por id (meses podem ter sobreposição nos limites)
      const txMap = new Map(todasTx.map((t: TransacaoRaw) => [t.id, t]))
      const transacoes = [...txMap.values()].filter(
        (t: TransacaoRaw) => !t.id_par_transferencia && !t.descricao?.startsWith('[Transf.')
      )
      addLog('ok', `Transações: ${transacoes.length} registros`)

      // 4. Transferências — busca mês a mês também (sem filtro de período no endpoint)
      addLog('ok', 'Buscando transferências...')
      const resTrfArr = await Promise.all(
        meses.map(mes => apiFetch(`/transferencias?mes=${mes}`))
      )
      const todasTrf = resTrfArr.flatMap(r => extrairLista<TransacaoRaw>(r))
      // Deduplica por id_par
      const trfMap = new Map(todasTrf.map((t: TransacaoRaw) => [t.id_par, t]))
      const transferencias = [...trfMap.values()]
      addLog('ok', `Transferências: ${transferencias.length} registros`)

      // Montar payload
      const payload = {
        gerado_em: new Date().toISOString(),
        versao: '1.0',
        contas,
        categorias,
        transacoes,
        transferencias,
      }

      // Download do JSON
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `arqvalor_backup_${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)

      addLog('ok', 'Backup gerado e download iniciado!')
    } catch (e) {
      addLog('erro', `Erro: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Section titulo="Backup completo" subtitulo="Salva todos os dados em um arquivo JSON" icon={Save} cor="#4da6ff">
      <div className="space-y-3">
        <div className="bg-blue-400/5 border border-blue-400/20 rounded-lg p-4">
          <p className="text-[12px] font-semibold text-blue-400 mb-2">O backup inclui:</p>
          <ul className="space-y-1">
            {[
              'Todas as contas (ativas e inativas)',
              'Todas as categorias (com hierarquia)',
              'Transações: 60 meses passados + 24 meses futuros',
              'Todas as transferências',
            ].map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-[12px] text-gray-400">
                <CheckCircle2 size={12} className="text-blue-400 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-blue-400/60 mt-3">O arquivo JSON gerado pode ser usado para restaurar os dados via Restore.</p>
        </div>

        {log.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-1.5">
            {log.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px]">
                {l.tipo === 'ok'
                  ? <CheckCircle2 size={13} className="text-av-green flex-shrink-0" />
                  : <X size={13} className="text-red-400 flex-shrink-0" />}
                <span style={{ color: l.tipo === 'ok' ? '#00c896' : '#f87171' }}>{l.msg}</span>
              </div>
            ))}
          </div>
        )}

        <Btn onClick={fazerBackup} loading={loading} cor="#4da6ff">
          <Save size={14} /> Gerar backup JSON
        </Btn>
      </div>
    </Section>
  )
}


// ══════════════════════════════════════════════════════════════════
// SEÇÃO 5 — RESTORE COMPLETO
// ══════════════════════════════════════════════════════════════════
function SecaoRestore() {
  const { contas } = useContas()
  const { categorias } = useCategorias()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [etapa, setEtapa] = useState<'idle' | 'confirmando' | 'restaurando' | 'concluido'>('idle')
  const [payload, setPayload] = useState<BackupPayload | null>(null)
  const [progresso, setProgresso] = useState(0)
  const [progressoLabel, setProgressoLabel] = useState('')
  const [log, setLog] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; msg: string }[]>([])

  const lerArquivo = (file: File) => {
    const reader = new FileReader()
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target?.result as string)
        if (!data.contas || !data.transacoes) {
          alert('Arquivo inválido. Use um backup gerado pelo Arquiteto de Valor.')
          return
        }
        setPayload(data)
        setEtapa('confirmando')
      } catch {
        alert('Erro ao ler o arquivo JSON.')
      }
    }
    reader.readAsText(file)
  }

  const onArquivo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) lerArquivo(file)
    e.target.value = ''
  }

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) lerArquivo(file)
  }

  const executarRestore = async () => {
    setEtapa('restaurando')
    setProgresso(0)
    const logs: typeof log = []
    const addLog = (tipo: 'ok' | 'erro' | 'aviso', msg: string) => {
      logs.push({ tipo, msg })
      setLog([...logs])
    }

    const mapaContas:     Record<string, string> = {}
    const mapaCategorias: Record<string, string> = {}

    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

    const normNome = (s: string) => s?.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') ?? ''

    try {
      const { contas: cntBackup, categorias: catBackup, transacoes: txBackup, transferencias: trfBackup } = payload

      const totalPassos = cntBackup.length + catBackup.filter((c: CategoriaBackup) => !c.protegida).length + txBackup.length + (trfBackup?.length ?? 0)
      let passo = 0
      const avanco = () => { passo++; setProgresso(Math.round((passo / totalPassos) * 100)) }

      // ── 1. Contas ────────────────────────────────────────────────
      setProgressoLabel('Recriando contas...')
      let okCnt = 0
      for (const c of cntBackup) {
        // Verificar se já existe
        const existente = contas.find((x: ContaBackup) => normNome(String(x.nome)) === normNome(c.nome) && x.tipo === c.tipo)
        if (existente) {
          mapaContas[c.conta_id] = existente.conta_id
        } else {
          const r = await apiMutate('/contas', 'POST', {
            nome: c.nome, tipo: c.tipo,
            saldo_inicial: c.saldo_inicial ?? 0,
            icone: c.icone, cor: c.cor, ativa: c.ativa,
          })
          if (r.ok && r.dados?.conta_id) {
            mapaContas[c.conta_id] = r.dados.conta_id
            okCnt++
          } else if (r.erro?.includes('409') || r.erro?.includes('duplicat')) {
            const lista = await apiFetch('/contas')
            const ex = extrairLista<ContaBackup>(lista.dados).find(
              (x: ContaBackup) => normNome(String(x.nome)) === normNome(c.nome) && x.tipo === c.tipo
            )
            if (ex) mapaContas[c.conta_id] = ex.conta_id
          } else {
            addLog('erro', `Conta "${c.nome}": ${r.erro}`)
          }
        }
        avanco(); await sleep(80)
      }
      addLog('ok', `Contas: ${okCnt} criadas, ${cntBackup.length - okCnt} já existiam`)

      // ── 2. Categorias (protegidas: só mapear) ───────────────────
      setProgressoLabel('Recriando categorias...')
      // Mapear protegidas
      for (const c of catBackup.filter((x: CategoriaBackup) => x.protegida)) {
        const ex = categorias.find((x: CategoriaRaw) => normNome(x.descricao) === normNome(c.descricao) && x.protegida)
        if (ex) mapaCategorias[c.id] = ex.id
      }
      // Pais não protegidos
      let okCat = 0
      const pais   = catBackup.filter((c: CategoriaBackup) => !c.id_pai && !c.protegida)
      const filhos = catBackup.filter((c: CategoriaBackup) => !!c.id_pai && !c.protegida)
      for (const c of pais) {
        const ex = categorias.find((x: CategoriaRaw) => normNome(x.descricao) === normNome(c.descricao) && !x.id_pai)
        if (ex) { mapaCategorias[c.id] = ex.id }
        else {
          const r = await apiMutate('/categorias', 'POST', { descricao: c.descricao, tipo: c.tipo, icone: c.icone, cor: c.cor })
          if (r.ok && r.dados?.id) { mapaCategorias[c.id] = r.dados.id; okCat++ }
          else addLog('erro', `Categoria "${c.descricao}": ${r.erro}`)
        }
        avanco(); await sleep(80)
      }
      // Filhos
      for (const c of filhos) {
        const novoIdPai = mapaCategorias[c.id_pai]
        if (!novoIdPai) { addLog('aviso', `Subcategoria "${c.descricao}": pai não encontrado`); avanco(); continue }
        const ex = categorias.find((x: CategoriaRaw) => normNome(x.descricao) === normNome(c.descricao) && x.id_pai === novoIdPai)
        if (ex) { mapaCategorias[c.id] = ex.id }
        else {
          const r = await apiMutate('/categorias', 'POST', { descricao: c.descricao, tipo: c.tipo, icone: c.icone, cor: c.cor, id_pai: novoIdPai })
          if (r.ok && r.dados?.id) { mapaCategorias[c.id] = r.dados.id; okCat++ }
          else addLog('erro', `Subcategoria "${c.descricao}": ${r.erro}`)
        }
        avanco(); await sleep(80)
      }
      addLog('ok', `Categorias: ${okCat} criadas`)

      // ── 3. Transações ────────────────────────────────────────────
      setProgressoLabel('Recriando transações...')
      let okTx = 0, errTx = 0
      const txOrdenadas = [...txBackup].sort((a: TransacaoRaw, b: TransacaoRaw) => a.data.localeCompare(b.data))
      for (const t of txOrdenadas) {
        const conta_id    = mapaContas[t.conta_id]
        const categoria_id = t.categoria_id ? mapaCategorias[t.categoria_id] : undefined
        if (!conta_id) { addLog('aviso', `"${t.descricao}" ignorada: conta não mapeada`); errTx++; avanco(); continue }
        const r = await apiMutate('/transacoes', 'POST', {
          tipo: t.tipo, data: t.data, descricao: t.descricao,
          valor: t.valor, conta_id, categoria_id,
          status: t.status, observacao: t.observacao,
        })
        if (r.ok) okTx++
        else { addLog('erro', `"${t.descricao}" (${t.data}): ${r.erro}`); errTx++ }
        avanco(); await sleep(60)
      }
      addLog('ok', `Transações: ${okTx} criadas, ${errTx} erros`)

      // ── 4. Transferências ────────────────────────────────────────
      if (trfBackup?.length > 0) {
        setProgressoLabel('Recriando transferências...')
        let okTrf = 0, errTrf = 0
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsUnicos = new Map<string, any>()
        for (const t of trfBackup) {
          const parId = t.id_par ?? t.id_recorrencia
          if (parId && !parsUnicos.has(parId)) parsUnicos.set(parId, t)
        }
        for (const t of parsUnicos.values()) {
          const origem  = mapaContas[t.conta_origem_id ?? t.conta_id]
          const destino = mapaContas[t.conta_destino_id]
          if (!origem || !destino) { addLog('aviso', `Transferência "${t.descricao ?? ''}" ignorada: contas não mapeadas`); errTrf++; avanco(); continue }
          const r = await apiMutate('/transferencias', 'POST', {
            conta_origem_id: origem, conta_destino_id: destino,
            valor: t.valor, data: t.data, descricao: t.descricao, status: t.status,
          })
          if (r.ok) okTrf++
          else { addLog('erro', `Transferência "${t.descricao}" (${t.data}): ${r.erro}`); errTrf++ }
          avanco(); await sleep(80)
        }
        addLog('ok', `Transferências: ${okTrf} criadas, ${errTrf} erros`)
      }

      setProgressoLabel('Concluído!')
    } catch (e) {
      addLog('erro', `Erro inesperado: ${(e as Error).message}`)
    } finally {
      setEtapa('concluido')
    }
  }

  const resetar = () => { setEtapa('idle'); setPayload(null); setLog([]); setProgresso(0); setProgressoLabel('') }

  return (
    <Section titulo="Restore completo" subtitulo="Restaura dados a partir de um arquivo de backup JSON" icon={RotateCcw} cor="#f0b429" defaultOpen={false}>
      <div className="space-y-4">

        {/* IDLE */}
        {etapa === 'idle' && (
          <div
            className="rounded-xl p-8 text-center cursor-pointer transition-all duration-200"
            style={{
              border: `2px dashed ${dragOver ? '#f0b429' : '#374151'}`,
              background: dragOver ? 'rgba(240,180,41,0.06)' : 'transparent',
            }}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <DatabaseBackup size={32} className="mx-auto mb-3" style={{ color: dragOver ? '#f0b429' : '#4b5563' }} />
            <p className="text-[14px] font-semibold mb-1" style={{ color: dragOver ? '#f0b429' : '#d1d5db' }}>
              {dragOver ? 'Solte o arquivo aqui' : 'Arraste o arquivo de backup ou clique para selecionar'}
            </p>
            <p className="text-[11px] text-gray-400 mb-4">Somente arquivos .json gerados pelo Arquiteto de Valor</p>
            <button
              onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
              className="px-5 py-2 rounded-lg text-[13px] font-semibold transition-colors"
              style={{ background: '#f0b42920', color: '#f0b429', border: '1px solid #f0b42940' }}
            >
              Escolher arquivo
            </button>
            <input ref={inputRef} type="file" accept=".json" className="hidden" onChange={onArquivo} />
          </div>
        )}

        {/* CONFIRMANDO */}
        {etapa === 'confirmando' && payload && (
          <div className="space-y-3">
            <div className="bg-amber-400/5 border border-amber-400/20 rounded-lg p-4">
              <p className="text-[12px] font-semibold text-amber-400 mb-3">Arquivo de backup carregado</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Gerado em', new Date(payload.gerado_em).toLocaleString('pt-BR')],
                  ['Contas', payload.contas?.length ?? 0],
                  ['Categorias', payload.categorias?.length ?? 0],
                  ['Transações', payload.transacoes?.length ?? 0],
                  ['Transferências', payload.transferencias?.length ?? 0],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                    <span className="text-[11px] text-gray-400">{k}</span>
                    <span className="text-[12px] font-semibold text-amber-400">{String(v)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-amber-400/70 mt-3">
                ⚠️ Dados já existentes não serão duplicados — o restore verifica antes de criar.
              </p>
            </div>
            <div className="flex gap-2">
              <button onClick={resetar}
                className="px-4 py-2 rounded-lg text-[13px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-700 transition-colors">
                Cancelar
              </button>
              <Btn onClick={executarRestore} cor="#f0b429">
                <RotateCcw size={14} /> Iniciar restore
              </Btn>
            </div>
          </div>
        )}

        {/* RESTAURANDO */}
        {etapa === 'restaurando' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-amber-400" />
                <p className="text-[13px] text-gray-300">{progressoLabel}</p>
              </div>
              <span className="text-[12px] font-semibold text-amber-400">{progresso}%</span>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full transition-all duration-300" style={{ width: `${progresso}%` }} />
            </div>
            {log.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-[160px] overflow-y-auto space-y-1">
                {log.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    {l.tipo === 'ok' ? <CheckCircle2 size={11} className="text-av-green flex-shrink-0" />
                      : l.tipo === 'aviso' ? <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />
                      : <X size={11} className="text-red-400 flex-shrink-0" />}
                    <span style={{ color: l.tipo === 'ok' ? '#00c896' : l.tipo === 'aviso' ? '#f0b429' : '#f87171' }}>{l.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CONCLUÍDO */}
        {etapa === 'concluido' && (
          <div className="space-y-3">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-1.5">
              {log.map((l, i) => (
                <div key={i} className="flex items-start gap-2 text-[12px]">
                  {l.tipo === 'ok' ? <CheckCircle2 size={13} className="text-av-green flex-shrink-0 mt-0.5" />
                    : l.tipo === 'aviso' ? <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                    : <X size={13} className="text-red-400 flex-shrink-0 mt-0.5" />}
                  <span style={{ color: l.tipo === 'ok' ? '#00c896' : l.tipo === 'aviso' ? '#f0b429' : '#f87171' }}>{l.msg}</span>
                </div>
              ))}
            </div>
            <Btn onClick={resetar} cor="#f0b429">
              <RefreshCw size={14} /> Novo restore
            </Btn>
          </div>
        )}
      </div>
    </Section>
  )
}

// ══════════════════════════════════════════════════════════════════
// PAGE PRINCIPAL
// ══════════════════════════════════════════════════════════════════
export default function ImportExportPage() {
  return (
    <div className="p-5 max-w-[860px]">
      <div className="mb-5">
        <h1 className="text-[17px] font-bold text-gray-800 dark:text-gray-100">Ferramentas</h1>
        <p className="text-[12px] text-gray-400 mt-0.5">Backup, restore, exportação, importação e limpeza de dados</p>
      </div>

      <div className="space-y-3">
        <SecaoBackup />
        <SecaoRestore />
        <SecaoExport />
        <SecaoImport />
        <SecaoLimpeza />
      </div>
    </div>
  )
}
