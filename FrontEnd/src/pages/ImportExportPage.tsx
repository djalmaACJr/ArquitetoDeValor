// src/pages/ImportExportPage.tsx
import { useState, useRef, useMemo, useEffect } from 'react'
import {
  Trash2, Download, Upload, AlertTriangle, CheckCircle2,
  FileSpreadsheet, ChevronDown, ChevronUp, X, Loader2, RefreshCw,
  DatabaseBackup, RotateCcw, Save, DollarSign,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { apiFetch, apiMutate, extrairLista } from '../lib/api'
import MascoteTutorial from '../components/ui/MascoteTutorial'
import { log as logDev } from '../lib/logger'
import { mesAtual as mesAtualLocal, hojeLocal, dataParaYMD } from '../lib/utils'
import { useContas } from '../hooks/useContas'
import { useCategorias } from '../hooks/useCategorias'
import { useAuth } from '../hooks/useAuth'
import { usePtax } from '../hooks/usePtax'
import { useBackfillHistorico } from '../hooks/useInvestimentosHistorico'
import { MonthPicker } from '../components/ui/MonthPicker'
import type { Conta, CartaoVirtual } from '../types'
import {
  TIPOS_ATIVO_INV, TIPO_ATIVO_LABEL, type TipoAtivoInvestimento,
} from '../lib/constants'
import {
  detectarTipoArquivo, parsePosicao, parseMovimentacao, parseStatusInvest,
  tiposMovimentacao, calcularCustoMedio, quantidadeLiquida, rotuloInstituicao,
  nomeProventoPadrao, derivarPosicoes, tipoPadraoTicker, acoesSubtipoPorTicker,
  fiiCategoriaPorTicker,
  type PosicaoB3, type MovB3, type AcaoMov, type AtivoB3, type XlsxLike,
} from '../lib/importB3'

// ── Tipos internos ──────────────────────────────────────────────

interface TransacaoRaw {
  id?: string
  id_par?: string
  id_par_transferencia?: string
  id_recorrencia?: string
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
  conta_id: string
  nome: string
  tipo: string
  saldo_inicial?: number
  icone?: string
  cor?: string
  ativa?: boolean
  [key: string]: unknown
}

interface CategoriaBackup {
  id: string
  descricao: string
  tipo?: string
  protegida?: boolean
  id_pai?: string | null
  icone?: string
  cor?: string
  [key: string]: unknown
}

type XlsxRow = Record<string, unknown>

interface InvestimentosBackup {
  ativos:          Record<string, unknown>[]
  posicoes:        Record<string, unknown>[]
  operacoes:       Record<string, unknown>[]
  dividendos:      Record<string, unknown>[]
  historico:       Record<string, unknown>[]
  tipos_dividendo: Record<string, unknown>[]
  alocacoes:       Record<string, unknown>[]
}

interface LembreteBackup {
  id?: string
  data: string
  descricao: string
  status?: string
  lancamento_id?: string | null
  [key: string]: unknown
}

interface ObjetivoBackup {
  id?: string
  tipo: string
  nome: string
  descricao?: string | null
  icone?: string
  cor?: string
  ativo?: boolean
  valor_meta: number
  data_inicio: string
  data_fim: string
  conta_id?: string | null
  categoria_id?: string | null
  frequencia?: string | null
  contas_sonho?: string[]
  contas_projeto?: string[]
  categorias_objetivo?: string[]
  [key: string]: unknown
}

interface BackupPayload {
  gerado_em: string
  contas: ContaBackup[]
  categorias: CategoriaBackup[]
  transacoes: TransacaoRaw[]
  transferencias?: TransacaoRaw[]
  investimentos?: InvestimentosBackup
  lembretes?: LembreteBackup[]
  objetivos?: ObjetivoBackup[]
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

const _sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function dividirEmChunks<T>(itens: T[], maxWorkers: number): T[][] {
  if (itens.length === 0) return []
  const n = Math.min(maxWorkers, itens.length)
  const tamanho = Math.ceil(itens.length / n)
  return Array.from({ length: n }, (_, i) => itens.slice(i * tamanho, (i + 1) * tamanho)).filter(c => c.length > 0)
}

async function apiComRetry(
  path: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
  tentativas = 3,
): Promise<Awaited<ReturnType<typeof apiMutate>>> {
  for (let t = 0; t < tentativas; t++) {
    const r = await apiMutate(path, method, body)
    if (r.ok || !(r.erro ?? '').includes('NetworkError')) return r
    if (t < tentativas - 1) await _sleep(2000)
  }
  return apiMutate(path, method, body)
}

const mesAtual = mesAtualLocal

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

/** Lê um valor de dia (1..31). Aceita number, string com decimais ou nada. */
function parseDiaCartao(raw: unknown): number | null {
  if (raw === '' || raw == null) return null
  const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10)
  if (!Number.isInteger(n) || n < 1 || n > 31) return null
  return n
}

/** Parser do formato exportado de cartões virtuais:
 *    "1234 Principal, 5678 Compras online"
 *  Cada item: primeiro pedaço = sufixo (2-8 dígitos); resto = apelido.
 *  Aceita também separador ";" pra robustez. */
function parseCartoesVirtuais(raw: unknown): CartaoVirtual[] {
  if (!raw) return []
  const s = String(raw).trim()
  if (!s) return []
  return s.split(/[,;]\s*/).flatMap(item => {
    const m = item.trim().match(/^(\d{2,8})\s*(.*)$/)
    if (!m) return []
    const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    return [{ id, sufixo: m[1], apelido: m[2].trim().slice(0, 40) }]
  })
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
            <p className="text-[18px] font-bold text-gray-800 dark:text-gray-100">{titulo}</p>
            <p className="text-[15px] text-gray-400">{subtitulo}</p>
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
      className="flex items-center gap-2 px-4 py-2 rounded-lg text-[17px] font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
      style={{ background: `${cor}20`, color: cor, border: `1px solid ${cor}40` }}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  )
}

function Tag({ cor, children }: { cor: string; children: React.ReactNode }) {
  return (
    <span className="text-[14px] font-semibold px-2 py-0.5 rounded-full"
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
            <p className="text-[19px] font-bold text-gray-800 dark:text-gray-100">{titulo}</p>
            <div className="text-[17px] text-gray-500 dark:text-gray-400 mt-1">{mensagem}</div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button onClick={onCancelar}
            className="px-4 py-2 rounded-lg text-[17px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            Cancelar
          </button>
          <button onClick={onConfirmar}
            className="px-4 py-2 rounded-lg text-[17px] font-semibold text-white transition-colors"
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

// Rótulos amigáveis para o log de limpeza (a API devolve nomes de tabela).
const ROTULO_ENTIDADE: Record<string, string> = {
  inv_historico_mensal:  'Histórico de investimentos',
  inv_dividendos:        'Dividendos',
  inv_operacoes:         'Operações',
  inv_posicoes:          'Posições',
  inv_ativos:            'Ativos',
  inv_alocacoes_tipo:    'Alocações',
  inv_tipos_dividendo:   'Tipos de provento',
  transacoes_dividendos: 'Dividendos no extrato',
  transacoes:            'Transações',
  categorias:            'Categorias',
  contas:                'Contas',
  investimentos:         'Investimentos',
}
function linhaLimpeza(entidade: string, n: number): string {
  const rotulo = ROTULO_ENTIDADE[entidade] ?? entidade
  return `${rotulo}: ${n} ${n === 1 ? 'item removido' : 'itens removidos'}`
}

function SecaoLimpeza() {
  const qc = useQueryClient()
  const [confirmando, setConfirmando] = useState(false)
  // 'transacoes' por padrão — é a opção menos destrutiva. "Limpar tudo"
  // apaga também contas e categorias, então exige opt-in explícito.
  const [modo, setModo] = useState<'transacoes' | 'investimentos' | 'tudo'>('transacoes')
  const [loading, setLoading] = useState(false)
  const [log, setLog] = useState<{ tipo: 'ok' | 'erro'; msg: string }[]>([])

  const executarLimpeza = async () => {
    setConfirmando(false)
    setLoading(true)
    setLog([])
    const addLog = (tipo: 'ok' | 'erro', msg: string) =>
      setLog(l => [...l, { tipo, msg }])

    const logarLogs = (res: Awaited<ReturnType<typeof apiMutate>>, fallbackEntidade: string) => {
      const dados = res.dados as { logs?: { entidade: string; excluidos: number }[]; excluidos?: number } | null
      if (Array.isArray(dados?.logs)) dados!.logs!.forEach(l => addLog('ok', linhaLimpeza(l.entidade, l.excluidos)))
      else addLog('ok', linhaLimpeza(fallbackEntidade, dados?.excluidos ?? 0))
    }

    try {
      if (modo === 'transacoes') {
        const res = await apiMutate('/limpar?entidade=transacoes', 'DELETE')
        if (res.ok) addLog('ok', linhaLimpeza('transacoes', (res.dados as { excluidos?: number } | null)?.excluidos ?? 0))
        else addLog('erro', `Erro: ${res.erro}`)
      } else if (modo === 'investimentos') {
        const res = await apiMutate('/limpar?entidade=investimentos', 'DELETE')
        if (res.ok) logarLogs(res, 'investimentos')
        else addLog('erro', `Erro: ${res.erro}`)
      } else {
        const res = await apiMutate('/limpar', 'DELETE')
        if (res.ok) {
          const dados = res.dados as { logs?: { entidade: string; excluidos: number }[] } | { entidade: string; excluidos: number }[]
          const logs = (dados && 'logs' in dados ? dados.logs : dados) as { entidade: string; excluidos: number }[]
          if (Array.isArray(logs)) {
            logs.forEach(l => addLog('ok', linhaLimpeza(l.entidade, l.excluidos)))
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
      // Atualiza os caches afetados para a UI refletir a limpeza na hora.
      if (modo !== 'transacoes') {
        for (const k of [['inv-ativos'], ['inv-posicoes'], ['inv-operacoes'], ['inv-dividendos'], ['inv-historico'], ['inv-dashboard'], ['inv-ranking'], ['inv-tipos-dividendo']]) {
          qc.invalidateQueries({ queryKey: k })
        }
      }
      if (modo === 'tudo') {
        for (const k of [['contas'], ['categorias'], ['dashboard-fase1']]) qc.invalidateQueries({ queryKey: k })
      }
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
      valor: 'investimentos' as const,
      titulo: 'Somente investimentos',
      descricao: 'Remove ativos, posições, operações, dividendos e histórico. Contas e transações do extrato são mantidas.',
    },
    {
      valor: 'tudo' as const,
      titulo: 'Limpar tudo',
      descricao: 'Remove transações, investimentos, categorias não protegidas e todas as contas.',
    },
  ]

  // Rótulo curto do alvo, para botão e modal de confirmação.
  const rotuloModo = modo === 'transacoes' ? 'transações' : modo === 'investimentos' ? 'investimentos' : 'tudo'

  return (
    <Section titulo="Limpar dados" subtitulo="Remove transações, categorias e contas do banco" icon={Trash2} cor="#ff6b4a" defaultOpen={false}>
      <div className="space-y-3">

        {/* Seleção do modo */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
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
                  className="text-[17px] font-semibold"
                  style={{ color: modo === op.valor ? '#ff6b4a' : '#8b92a8' }}
                >
                  {op.titulo}
                </span>
              </div>
              <p className="text-[15px] text-gray-400 pl-5">{op.descricao}</p>
            </button>
          ))}
        </div>

        {/* Aviso */}
        <p className="text-[15px] text-red-400/70">⚠️ Esta ação é irreversível.</p>

        {/* Log */}
        {log.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-1.5">
            {log.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[16px]">
                {l.tipo === 'ok'
                  ? <CheckCircle2 size={13} className="text-av-green flex-shrink-0" />
                  : <X size={13} className="text-red-400 flex-shrink-0" />}
                <span style={{ color: l.tipo === 'ok' ? '#00c896' : '#f87171' }}>{l.msg}</span>
              </div>
            ))}
          </div>
        )}

        <Btn onClick={() => setConfirmando(true)} loading={loading} cor="#ff6b4a">
          <Trash2 size={14} /> Limpar {rotuloModo}
        </Btn>
      </div>

      {confirmando && (
        <ModalConfirmacao
          titulo={modo === 'tudo' ? 'Confirmar limpeza total' : `Confirmar limpeza de ${rotuloModo}`}
          mensagem={
            <span>
              {modo === 'transacoes'
                ? 'Todos os lançamentos e transferências serão excluídos.'
                : modo === 'investimentos'
                  ? 'Ativos, posições, operações, dividendos e histórico de investimentos serão excluídos.'
                  : 'Transações, investimentos, categorias e contas serão excluídos permanentemente.'}
              <br />
              <strong className="text-red-400">Esta ação não pode ser desfeita.</strong>
            </span>
          }
          labelBtn={`Sim, limpar ${rotuloModo}`}
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
  // Transferências NÃO são opção separada — quando "Transações" está
  // marcado, elas vão automaticamente em uma aba dedicada (cada par
  // origem→destino vira uma linha). Sem isso, o usuário leigo poderia
  // exportar transações sem perceber que transferências estão de fora.
  const [exportarTransacoes, setExportarTransacoes] = useState(true)
  const [exportarInvestimentos, setExportarInvestimentos] = useState(false)
  const [loading, setLoading] = useState(false)

  const exportar = async () => {
    setLoading(true)
    try {
      const { exportToExcel } = await import('../lib/exportUtils')
      type Sheet = import('../lib/exportUtils').ExportSheet
      const sheets: Sheet[] = []

      // Aba: Contas
      // Ícone/Cor são metadados visuais do app — não interessam num
      // export pra leitura humana. Em contrapartida, contas tipo CARTAO
      // têm campos próprios (fechamento/pagamento/limite/cartões virtuais)
      // que faltavam aqui.
      if (exportarContas) {
        sheets.push({
          name: 'Contas',
          title: 'Contas',
          columns: [
            { key: 'nome',         label: 'Nome',              type: 'text',     width: 25 },
            { key: 'tipo',         label: 'Tipo',              type: 'text',     width: 15 },
            { key: 'sIni',         label: 'Saldo Inicial',     type: 'currency', width: 16 },
            { key: 'sAtu',         label: 'Saldo Atual',       type: 'currency', width: 16 },
            { key: 'ativa',        label: 'Ativa',             type: 'text',     width: 8,  align: 'center' },
            // Campos exclusivos de CARTAO — ficam vazios nos demais tipos
            { key: 'diaFech',      label: 'Dia fechamento',    type: 'text',     width: 14, align: 'center' },
            { key: 'diaPag',       label: 'Dia pagamento',     type: 'text',     width: 14, align: 'center' },
            { key: 'limCred',      label: 'Limite de crédito', type: 'currency', width: 16 },
            { key: 'cartoesVirt',  label: 'Cartões virtuais',  type: 'text',     width: 40 },
          ],
          rows: contas.map(c => ({
            nome:    c.nome,
            tipo:    c.tipo,
            sIni:    c.saldo_inicial ?? 0,
            sAtu:    c.saldo_atual ?? 0,
            ativa:   c.ativa ? 'Sim' : 'Não',
            // CARTAO: mostra os campos; outros tipos: célula vazia
            diaFech: c.tipo === 'CARTAO' && c.dia_fechamento != null ? String(c.dia_fechamento) : '',
            diaPag:  c.tipo === 'CARTAO' && c.dia_pagamento  != null ? String(c.dia_pagamento)  : '',
            // Para limite, deixar vazio (não 0) em não-cartões pra não
            // confundir leitura — a coluna é currency, célula vazia fica em branco.
            limCred: c.tipo === 'CARTAO' ? (c.limite_credito ?? 0) : '',
            // Cartões virtuais: "sufixo apelido" separados por vírgula. Ex:
            //   "1234 Principal, 5678 Compras online"
            cartoesVirt: c.tipo === 'CARTAO' && c.cartoes_virtuais?.length
              ? c.cartoes_virtuais
                  .map(cv => `${cv.sufixo}${cv.apelido ? ' ' + cv.apelido : ''}`)
                  .join(', ')
              : '',
          })),
        })
      }

      // Aba: Categorias (com hierarquia).
      // Cor é metadado visual do app — não interessa no export.
      // Ícone mantido por ser parte do uso prático (emoji informativo).
      if (exportarCategorias) {
        // Só categorias ATIVAS: inativadas representam histórico que o
        // usuário decidiu esconder e não fazem sentido carregar pra outro
        // ambiente / importar de volta.
        const catsAtivas = categorias.filter(c => c.ativa)
        const pais = catsAtivas.filter(c => !c.id_pai)
        type Row = import('../lib/exportUtils').ExportRow
        const rows: Row[] = []
        pais.forEach(p => {
          rows.push({
            categoria: p.descricao,
            sub:       '',
            icone:     p.icone ?? '',
            _style:    'group',
          })
          catsAtivas.filter(s => s.id_pai === p.id).forEach(s => {
            rows.push({
              categoria: p.descricao,
              sub:       s.descricao,
              icone:     s.icone ?? '',
            })
          })
        })
        sheets.push({
          name: 'Categorias',
          title: 'Categorias',
          columns: [
            { key: 'categoria', label: 'Categoria',    type: 'text', width: 22 },
            { key: 'sub',       label: 'Subcategoria', type: 'text', width: 22 },
            { key: 'icone',     label: 'Ícone',        type: 'text', width: 10 },
          ],
          rows,
        })
      }

      // Lista de meses do período — usada pelas abas Transações e Transferências
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
      const meses    = exportarTransacoes ? gerarMeses(mesInicio, mesFim) : []
      const contaMap = Object.fromEntries(contas.map(c => [c.conta_id, c.nome]))

      // Aba: Transações — INCLUI também as transferências como linhas
      // unificadas no mesmo lugar (uma linha por par origem→destino, na
      // coluna "Conta destino"). Assim o usuário tem o registro COMPLETO
      // do período numa única aba.
      if (exportarTransacoes) {
        // 1) Transações normais (despesas/receitas que NÃO são transferência)
        const resArr = await Promise.all(
          meses.map(mes => apiFetch(`/transacoes?mes=${mes}&per_page=1000&saldo=true`))
        )
        const txs = resArr.flatMap(r => extrairLista<TransacaoRaw>(r.dados))
          // Mesmo filtro do Backup: descarta os dois lados das transferências
          // (têm id_par_transferencia OU prefixo [Transf.] na descrição) —
          // as transferências entram abaixo como UMA linha por par.
          .filter((t: TransacaoRaw) =>
            !t.id_par_transferencia &&
            !(t.descricao ?? '').startsWith('[Transf.')
          )
        const linhasTx = txs.map((t: TransacaoRaw) => ({
          data:        new Date(t.data + 'T12:00:00'),
          descricao:   t.descricao ?? '',
          valor:       t.tipo === 'DESPESA' ? -Math.abs(t.valor) : Math.abs(t.valor),
          conta:       String(contaMap[t.conta_id ?? ''] ?? t.conta_id ?? ''),
          contaDest:   '',
          categoria:   String(t.categoria_nome ?? t.categoria_pai_nome ?? ''),
          observacao:  String(t.observacao ?? ''),
        }))

        // 2) Transferências (origem→destino) — uma linha por par
        const resTrf = await Promise.all(
          meses.map(mes => apiFetch(`/transferencias?mes=${mes}`))
        )
        // Endpoint pode devolver { dados: [...] } OU [...] direto
        const trfsAll = resTrf.flatMap(r => extrairLista<TransacaoRaw>(r.dados ?? r))
        // Dedup por id_par (mesmo par pode aparecer em mais de um mês na borda)
        const trfMap  = new Map(trfsAll.map(t => [t.id_par as string | undefined ?? t.id, t]))
        const linhasTrf = [...trfMap.values()].map((t: TransacaoRaw) => {
          const origemId  = (t.conta_origem_id  ?? t.conta_id) as string | undefined
          const destinoId = t.conta_destino_id as string | undefined
          return {
            data:       new Date(t.data + 'T12:00:00'),
            descricao:  (t.descricao ?? '').replace(/^\[Transf\. (saída|entrada)\] ?/, ''),
            valor:      Math.abs(t.valor),
            conta:      String(contaMap[origemId  ?? ''] ?? origemId  ?? ''),
            contaDest:  String(contaMap[destinoId ?? ''] ?? destinoId ?? ''),
            categoria:  'Transferências',
            observacao: String(t.observacao ?? ''),
          }
        })

        // 3) Junta tudo e ordena por data (asc) — usuário vê o período
        //    em ordem cronológica, mesclando transações e transferências.
        const rows = [...linhasTx, ...linhasTrf].sort(
          (a, b) => a.data.getTime() - b.data.getTime(),
        )

        sheets.push({
          name: 'Transações',
          title: 'Transações',
          subtitle: `${mesInicio} – ${mesFim}`,
          columns: [
            { key: 'data',       label: 'Data',          type: 'date',     width: 12 },
            { key: 'descricao',  label: 'Descrição',     type: 'text',     width: 35 },
            { key: 'valor',      label: 'Valor',         type: 'currency', width: 14 },
            { key: 'conta',      label: 'Conta',         type: 'text',     width: 20 },
            { key: 'contaDest',  label: 'Conta destino', type: 'text',     width: 20 },
            { key: 'categoria',  label: 'Categoria',     type: 'text',     width: 22 },
            { key: 'observacao', label: 'Observação',    type: 'text',     width: 30 },
          ],
          rows,
        })
      }

      // Abas: Investimentos (ativos, posições, operações, dividendos)
      if (exportarInvestimentos) {
        const [rAtivos, rPos, rOps, rDiv] = await Promise.all([
          apiFetch('/investimentos/ativos'),
          apiFetch('/investimentos/posicoes'),
          apiFetch('/investimentos/operacoes'),
          apiFetch('/investimentos/dividendos'),
        ])
        type InvRow = Record<string, unknown> & { id?: string; inv_ativos?: { ticker?: string }; contas?: { nome?: string }; inv_tipos_dividendo?: { nome?: string } }
        const ativosInv = extrairLista<InvRow>(rAtivos.dados)
        const posInv    = extrairLista<InvRow>(rPos.dados)
        const opsInv    = extrairLista<InvRow>(rOps.dados)
        const divInv    = extrairLista<InvRow>(rDiv.dados)
        const labelTipo = (t: unknown) => TIPO_ATIVO_LABEL[t as TipoAtivoInvestimento] ?? String(t ?? '')
        const tickerPorPos = Object.fromEntries(posInv.map(p => [String(p.id), p.inv_ativos?.ticker ?? '']))
        const dataLocal = (d: unknown) => new Date(String(d) + 'T12:00:00')

        // Ativos + Posições mesclados: uma linha por posição com os dados
        // do ativo; ativos sem posição entram no fim com as células vazias.
        if (ativosInv.length || posInv.length) {
          const ativoPorId = new Map(ativosInv.map(a => [String(a.id), a]))
          type LinhaCarteira = {
            ticker: string; nome: string; tipo: string; moeda: string; conta: string
            qtd: number | ''; precoCusto: number | ''; valorCusto: number | ''
            data: Date | null; status: string; nota: number | ''
          }
          const rows: LinhaCarteira[] = posInv.map(p => {
            const a = ativoPorId.get(String(p.ativo_id))
            return {
              ticker: String(p.inv_ativos?.ticker ?? a?.ticker ?? ''), nome: String(a?.nome ?? ''),
              tipo: labelTipo(a?.tipo_ativo), moeda: String(a?.moeda ?? ''),
              conta: String(p.contas?.nome ?? ''),
              qtd: Number(p.quantidade), precoCusto: Number(p.preco_custo), valorCusto: Number(p.valor_custo),
              data: dataLocal(p.data_compra), status: String(p.status ?? ''),
              nota: a?.nota_usuario != null ? Number(a.nota_usuario) : '',
            }
          })
          const comPosicao = new Set(posInv.map(p => String(p.ativo_id)))
          for (const a of ativosInv) {
            if (comPosicao.has(String(a.id))) continue
            rows.push({
              ticker: String(a.ticker ?? ''), nome: String(a.nome ?? ''),
              tipo: labelTipo(a.tipo_ativo), moeda: String(a.moeda ?? ''),
              conta: '', qtd: '', precoCusto: '', valorCusto: '', data: null, status: '',
              nota: a.nota_usuario != null ? Number(a.nota_usuario) : '',
            })
          }
          rows.sort((x, y) => x.ticker.localeCompare(y.ticker, 'pt-BR') || x.conta.localeCompare(y.conta, 'pt-BR'))
          sheets.push({
            name: 'Inv. Ativos e Posições', title: 'Investimentos — Ativos e Posições',
            columns: [
              { key: 'ticker',     label: 'Ticker',      type: 'text',     width: 14 },
              { key: 'nome',       label: 'Nome',        type: 'text',     width: 30 },
              { key: 'tipo',       label: 'Tipo',        type: 'text',     width: 18 },
              { key: 'moeda',      label: 'Moeda',       type: 'text',     width: 8, align: 'center' },
              { key: 'conta',      label: 'Conta',       type: 'text',     width: 22 },
              { key: 'qtd',        label: 'Quantidade',  type: 'number',   width: 16 },
              { key: 'precoCusto', label: 'Preço custo', type: 'currency', width: 16 },
              { key: 'valorCusto', label: 'Valor custo', type: 'currency', width: 16 },
              { key: 'data',       label: 'Data compra', type: 'date',     width: 13 },
              { key: 'status',     label: 'Status',      type: 'text',     width: 12 },
              { key: 'nota',       label: 'Nota',        type: 'text',     width: 8, align: 'center' },
            ],
            rows,
          })
        }

        if (opsInv.length) sheets.push({
          name: 'Inv. Operações', title: 'Investimentos — Operações',
          columns: [
            { key: 'data',   label: 'Data',     type: 'date',     width: 13 },
            { key: 'ticker', label: 'Ticker',   type: 'text',     width: 14 },
            { key: 'tipo',   label: 'Operação', type: 'text',     width: 14 },
            { key: 'qtd',    label: 'Quantidade', type: 'number', width: 16 },
            { key: 'preco',  label: 'Preço',    type: 'currency', width: 16 },
            { key: 'valor',  label: 'Valor',    type: 'currency', width: 16 },
          ],
          rows: opsInv.map(o => ({
            data: dataLocal(o.data_operacao), ticker: String(tickerPorPos[String(o.posicao_id)] ?? ''),
            tipo: String(o.tipo_operacao ?? ''), qtd: Number(o.quantidade), preco: Number(o.preco_unitario), valor: Number(o.valor_total),
          })),
        })

        if (divInv.length) sheets.push({
          name: 'Inv. Dividendos', title: 'Investimentos — Dividendos',
          columns: [
            { key: 'data',   label: 'Pagamento', type: 'date',     width: 13 },
            { key: 'ticker', label: 'Ticker',    type: 'text',     width: 14 },
            { key: 'tipo',   label: 'Tipo',      type: 'text',     width: 20 },
            { key: 'valor',  label: 'Valor',     type: 'currency', width: 16 },
          ],
          rows: divInv.map(d => ({
            data: dataLocal(d.data_pagamento), ticker: d.inv_ativos?.ticker ?? '',
            tipo: d.inv_tipos_dividendo?.nome ?? '', valor: Number(d.valor),
          })),
        })
      }

      if (sheets.length === 0) {
        alert('Nada selecionado para exportar.')
        return
      }
      await exportToExcel({
        filename: `arqvalor_export_${mesInicio}_${mesFim}`,
        sheets,
      })
    } catch (e) {
      alert(`Erro ao exportar: ${(e as Error).message}`)
    } finally {
      setLoading(false)
    }
  }

  const algumSelecionado = exportarContas || exportarCategorias || exportarTransacoes || exportarInvestimentos

  return (
    <Section titulo="Exportar dados" subtitulo="Gera um arquivo XLSX com abas separadas" icon={Download} cor="#00c896">
      <div className="space-y-4">
        {/* Período */}
        <div>
          <p className="text-[15px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            Período das transações
          </p>
          <div className="flex items-center gap-3">
            <div>
              <p className="text-[14px] text-gray-400 mb-1">De</p>
              <MonthPicker value={mesInicio} onChange={setMesInicio} />
            </div>
            <span className="text-gray-400 mt-4">→</span>
            <div>
              <p className="text-[14px] text-gray-400 mb-1">Até</p>
              <MonthPicker value={mesFim} onChange={setMesFim} />
            </div>
          </div>
        </div>

        {/* O que exportar */}
        <div>
          <p className="text-[15px] font-semibold text-gray-400 uppercase tracking-wide mb-2">
            O que exportar
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {[
              { label: 'Contas',        sub: 'Todas as contas',         checked: exportarContas,        set: setExportarContas,        cor: '#4da6ff' },
              { label: 'Categorias',    sub: 'Com hierarquia',          checked: exportarCategorias,    set: setExportarCategorias,    cor: '#a78bfa' },
              { label: 'Transações',    sub: `${mesInicio} → ${mesFim}`, checked: exportarTransacoes,   set: setExportarTransacoes,    cor: '#00c896' },
              { label: 'Investimentos', sub: 'Ativos, posições, etc.',  checked: exportarInvestimentos, set: setExportarInvestimentos, cor: '#3b82f6' },
            ].map(item => (
              <label key={item.label}
                className="flex flex-col gap-1 p-3 rounded-lg border cursor-pointer transition-all"
                style={{
                  background: item.checked ? `${item.cor}10` : 'transparent',
                  borderColor: item.checked ? `${item.cor}50` : 'rgba(255,255,255,0.08)',
                }}>
                <div className="flex items-center justify-between">
                  <span className="text-[17px] font-semibold" style={{ color: item.checked ? item.cor : '#8b92a8' }}>
                    {item.label}
                  </span>
                  <input type="checkbox" checked={item.checked} onChange={e => item.set(e.target.checked)}
                    className="accent-av-green" />
                </div>
                <span className="text-[14px] text-gray-400">{item.sub}</span>
              </label>
            ))}
          </div>
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
  // Campos exclusivos de CARTAO — null em outros tipos
  dia_fechamento:  number | null
  dia_pagamento:   number | null
  limite_credito:  number | null
  cartoes_virtuais: CartaoVirtual[]
  importar: boolean
  problema: string
}

interface CategoriaImport {
  idx: number
  categoria: string     // nome do pai
  subcategoria: string  // nome do filho (vazio = é pai)
  icone: string
  importar: boolean
  problema: string
}

type ModoImport = 'transacoes' | 'contas' | 'categorias' | 'investimentos'

// Seletor de modo de importação — compartilhado entre o fluxo padrão e o
// de investimentos (que tem UI própria).
function SeletorModoImport({ modo, setModo }: { modo: ModoImport; setModo: (m: ModoImport) => void }) {
  const opts: { value: ModoImport; label: string }[] = [
    { value: 'transacoes',    label: 'Transações' },
    { value: 'contas',        label: 'Contas' },
    { value: 'categorias',    label: 'Categorias' },
    { value: 'investimentos', label: 'Investimentos' },
  ]
  return (
    <div className="flex rounded-lg overflow-hidden border border-white/10 text-[16px] font-semibold">
      {opts.map((op, i) => (
        <button
          key={op.value}
          onClick={() => setModo(op.value)}
          className="flex-1 px-3 py-2 transition-colors"
          style={{
            background: modo === op.value ? 'rgba(167,139,250,0.15)' : 'transparent',
            color: modo === op.value ? '#a78bfa' : '#8b92a8',
            borderRight: i < opts.length - 1 ? '1px solid rgba(255,255,255,0.1)' : 'none',
          }}
        >
          {op.label}
        </button>
      ))}
    </div>
  )
}

// ── Componente de importação de investimentos (B3) ──────────────
interface ResultadoImportInv {
  ativos_criados: number; posicoes: number; operacoes: number
  dividendos: number; dividendos_no_extrato: number; historico: number
  avisos: string[]
}

// Persistência do mapeamento "tipo de movimentação → ação" entre
// importações (localStorage por usuário). Assim a próxima importação já
// vem com as classificações que o usuário ajustou antes.
const LS_MOV_MAP = 'av-import-mov-map'
function carregarMapaMov(userId: string | null): Record<string, AcaoMov> {
  try {
    const raw = localStorage.getItem(`${LS_MOV_MAP}:${userId ?? 'anon'}`)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch { return {} }
}
function salvarMapaMov(userId: string | null, mapa: Record<string, AcaoMov>): void {
  try { localStorage.setItem(`${LS_MOV_MAP}:${userId ?? 'anon'}`, JSON.stringify(mapa)) } catch { /* quota/SSR */ }
}

// Persistência da associação "instituição → conta" entre importações.
// Guardada após uma importação bem-sucedida, normalizada para a conta
// efetivamente usada/criada (evita recriar conta a cada importação).
const LS_CONTA_MAP = 'av-import-conta-map'
type ResolInst = { acao: 'criar' | 'mapear'; mapear_para?: string }
function carregarMapaConta(userId: string | null): Record<string, ResolInst> {
  try {
    const raw = localStorage.getItem(`${LS_CONTA_MAP}:${userId ?? 'anon'}`)
    const obj = raw ? JSON.parse(raw) : {}
    return obj && typeof obj === 'object' ? obj : {}
  } catch { return {} }
}
function salvarMapaConta(userId: string | null, mapa: Record<string, ResolInst>): void {
  try { localStorage.setItem(`${LS_CONTA_MAP}:${userId ?? 'anon'}`, JSON.stringify(mapa)) } catch { /* quota/SSR */ }
}

const ACOES_MOV: { value: AcaoMov; label: string }[] = [
  { value: 'COMPRA',   label: 'Compra' },
  { value: 'VENDA',    label: 'Venda' },
  { value: 'DIVIDENDO', label: 'Provento' },
  { value: 'APORTE',   label: 'Aporte (qtd)' },
  { value: 'RESGATE',  label: 'Resgate (qtd)' },
  { value: 'IGNORAR',  label: 'Ignorar' },
]

function ImportInvestimentos({ contas }: { contas: Conta[] }) {
  const qc = useQueryClient()
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  const { preencherTodos } = useBackfillHistorico()
  const inputRef = useRef<HTMLInputElement>(null)
  const [etapa, setEtapa] = useState<'idle' | 'revisando' | 'importando' | 'concluido'>('idle')
  const [carregando, setCarregando] = useState(false)
  const [erroArq, setErroArq] = useState('')
  const [posicoes, setPosicoes] = useState<PosicaoB3[]>([])
  const [movsRaw, setMovsRaw] = useState<MovB3[]>([])
  const [arq, setArq] = useState<{ posicao?: string; extrato?: string }>({})
  const [mapaTipoMov, setMapaTipoMov] = useState<Record<string, AcaoMov>>({})
  const [tipoOverride, setTipoOverride] = useState<Record<string, TipoAtivoInvestimento>>({})
  const [resolucao, setResolucao] = useState<Record<string, { acao: 'criar' | 'mapear'; mapear_para?: string }>>({})
  const [gerarExtrato, setGerarExtrato] = useState(false)
  const [log, setLog] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; msg: string }[]>([])
  const [resultado, setResultado] = useState<ResultadoImportInv | null>(null)

  const contasInvest = contas.filter(c => c.tipo === 'INVESTIMENTO' && c.ativa)

  // Hidrata o mapeamento salvo quando o usuário é conhecido (sem
  // sobrescrever ajustes feitos nesta sessão).
  useEffect(() => {
    setMapaTipoMov(prev => Object.keys(prev).length ? prev : carregarMapaMov(userId))
  }, [userId])
  // Persiste cada ajuste do mapeamento para a próxima importação.
  useEffect(() => {
    if (Object.keys(mapaTipoMov).length) salvarMapaMov(userId, mapaTipoMov)
  }, [userId, mapaTipoMov])

  // ── Leitura de arquivo (detecta posição vs movimentação) ──────
  const lerArquivo = async (file: File) => {
    setErroArq(''); setCarregando(true)
    try {
      // @ts-expect-error dynamic CDN import
      const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
      const buf = await file.arrayBuffer()
      const wb = XLSX.read(buf, { type: 'array', cellDates: true }) as XlsxLike
      const tipo = detectarTipoArquivo(XLSX.utils, wb)
      if (tipo === 'posicao') {
        setPosicoes(parsePosicao(XLSX.utils, wb))
        setArq(a => ({ ...a, posicao: file.name }))
      } else if (tipo === 'movimentacao') {
        setMovsRaw(parseMovimentacao(XLSX.utils, wb))
        setArq(a => ({ ...a, extrato: file.name }))
      } else if (tipo === 'statusinvest') {
        setMovsRaw(parseStatusInvest(XLSX.utils, wb))
        setArq(a => ({ ...a, extrato: `${file.name} (Status Invest)` }))
      } else {
        setErroArq('Arquivo não reconhecido. Use os relatórios da B3 (posição/movimentação) ou a carteira do Status Invest.')
      }
    } catch (e) {
      setErroArq(`Erro ao ler arquivo: ${(e as Error).message}`)
    } finally {
      setCarregando(false)
    }
  }
  const onArquivo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (files) for (const f of Array.from(files)) await lerArquivo(f)
    e.target.value = ''
  }

  // Movs com ação efetiva (override por tipo de movimentação)
  const movs = useMemo<MovB3[]>(() =>
    movsRaw.map(m => {
      const acao = mapaTipoMov[m.movimentacao] ?? m.acao
      return { ...m, acao, tipoProvento: acao === 'DIVIDENDO' ? nomeProventoPadrao(m.movimentacao) : undefined }
    }), [movsRaw, mapaTipoMov])

  const tiposMov = useMemo(() => tiposMovimentacao(movsRaw), [movsRaw])
  const custoMap = useMemo(() => calcularCustoMedio(movs), [movs])
  const qtdLiq   = useMemo(() => quantidadeLiquida(movs), [movs])

  // Posições efetivas: arquivo de posição (B3) quando houver; caso contrário
  // (ex.: Status Invest, só operações) derivamos das compras/vendas.
  const posicoesEfetivas = useMemo<PosicaoB3[]>(
    () => posicoes.length > 0 ? posicoes : derivarPosicoes(movs, custoMap),
    [posicoes, movs, custoMap],
  )

  // Ativos = união posição + extrato
  const ativos = useMemo(() => {
    const mapa = new Map<string, AtivoB3 & { temPosicao: boolean }>()
    for (const p of posicoesEfetivas) {
      mapa.set(p.ticker, {
        ticker: p.ticker, nome: p.nome, tipo_ativo: p.tipo_ativo, moeda: p.moeda,
        rf_subtipo: p.rf_subtipo, rf_indexador: p.rf_indexador, rf_emissor: p.rf_emissor,
        rf_vencimento: p.rf_vencimento, fii_categoria: p.fii_categoria,
        acoes_subtipo: p.acoes_subtipo ?? null, temPosicao: true,
      })
    }
    for (const m of movs) {
      if (mapa.has(m.ticker)) continue
      mapa.set(m.ticker, {
        ticker: m.ticker, nome: m.nome || m.ticker,
        tipo_ativo: tipoPadraoTicker(m.ticker), moeda: 'BRL', temPosicao: false,
        acoes_subtipo: m.acoesSubtipo ?? acoesSubtipoPorTicker(m.ticker),
      })
    }
    return [...mapa.values()].sort((a, b) =>
      a.temPosicao === b.temPosicao ? a.ticker.localeCompare(b.ticker) : a.temPosicao ? -1 : 1)
  }, [posicoesEfetivas, movs])

  const tipoDe = (ticker: string, fallback: TipoAtivoInvestimento) => tipoOverride[ticker] ?? fallback

  // Grupos de instituição
  const grupos = useMemo(() => {
    const s = new Set<string>()
    for (const p of posicoesEfetivas) s.add(rotuloInstituicao(p.instituicao))
    for (const m of movs) s.add(rotuloInstituicao(m.instituicao))
    return [...s].filter(Boolean).sort()
  }, [posicoesEfetivas, movs])

  // Default de resolução: usa a associação salva (instituição → conta) se a
  // conta ainda existir; senão mapear (se há contas) ou criar.
  useEffect(() => {
    const salvos = carregarMapaConta(userId)
    const idsValidos = new Set(contasInvest.map(c => c.conta_id))
    setResolucao(prev => {
      const next = { ...prev }
      for (const g of grupos) {
        if (next[g]) continue
        const s = salvos[g]
        if (s && s.mapear_para && idsValidos.has(s.mapear_para)) {
          next[g] = { acao: 'mapear', mapear_para: s.mapear_para }
        } else {
          next[g] = { acao: contasInvest.length ? 'mapear' : 'criar' }
        }
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupos, userId])

  const pendencia  = grupos.some(g => resolucao[g]?.acao === 'mapear' && !resolucao[g]?.mapear_para)
  const podeRevisar = posicoes.length > 0 || movs.length > 0
  const totalOps = movs.filter(m => ['COMPRA', 'VENDA', 'APORTE', 'RESGATE'].includes(m.acao) && m.quantidade > 0).length
  const totalDiv = movs.filter(m => m.acao === 'DIVIDENDO' && m.valor > 0).length

  // ── Importação ────────────────────────────────────────────────
  const importar = async () => {
    setEtapa('importando'); setResultado(null)
    const logs: { tipo: 'ok' | 'erro' | 'aviso'; msg: string }[] = []
    const addLog = (tipo: 'ok' | 'erro' | 'aviso', msg: string) => { logs.push({ tipo, msg }); setLog([...logs]) }
    try {
      // 1) Resolver/criar contas por grupo de instituição
      const contaDoGrupo: Record<string, string> = {}
      for (const g of grupos) {
        const r = resolucao[g]
        if (!r) continue
        if (r.acao === 'mapear' && r.mapear_para) {
          contaDoGrupo[g] = r.mapear_para
        } else if (r.acao === 'criar') {
          const res = await apiComRetry('/contas', 'POST', { nome: `Investimentos ${g}`.slice(0, 60), tipo: 'INVESTIMENTO', saldo_inicial: 0 })
          const cid = (res.dados as { conta_id?: string } | null)?.conta_id
          if (res.ok && cid) { contaDoGrupo[g] = cid; addLog('ok', `Conta criada: Investimentos ${g}`) }
          else addLog('erro', `Falha ao criar conta para ${g}: ${res.erro}`)
        }
      }
      const contaDe = (inst: string) => contaDoGrupo[rotuloInstituicao(inst)]
      const tipoAtivoDe = (ticker: string) => {
        const a = ativos.find(x => x.ticker === ticker)
        return tipoDe(ticker, a?.tipo_ativo ?? 'ACOES')
      }

      // 2) Ativos
      const ativosPayload = ativos.map(a => {
        const tipo = tipoDe(a.ticker, a.tipo_ativo)
        return {
          ticker: a.ticker, nome: a.nome, tipo_ativo: tipo, moeda: a.moeda || 'BRL',
          rf_subtipo: a.rf_subtipo ?? null, rf_indexador: a.rf_indexador ?? null,
          rf_emissor: a.rf_emissor ?? null, rf_vencimento: a.rf_vencimento ?? null,
          fii_categoria: tipo === 'FII' ? (a.fii_categoria ?? fiiCategoriaPorTicker(a.ticker)) : null,
          acoes_subtipo: tipo === 'ACOES' ? (a.acoes_subtipo ?? null) : null,
        }
      })

      const mesAno = mesAtualLocal()
      // 3) Posições
      const posicoesPayload = posicoesEfetivas.flatMap(p => {
        const conta_id = contaDe(p.instituicao)
        if (!conta_id) return []
        const custo = custoMap.get(`${p.ticker}|${p.instituicao}`)
        return [{
          ticker: p.ticker, conta_id, quantidade: p.quantidade,
          preco_custo: custo?.preco_custo ?? p.custo_fallback,
          data_compra: custo?.data_compra || hojeLocal(),
          valor_mercado: p.valor_mercado, mes_ano: mesAno,
        }]
      })

      // 4) Operações
      const operacoesPayload = movs.flatMap(m => {
        if (!['COMPRA', 'VENDA', 'APORTE', 'RESGATE'].includes(m.acao) || !(m.quantidade > 0) || !m.data) return []
        const conta_id = contaDe(m.instituicao)
        if (!conta_id) return []
        return [{
          ticker: m.ticker, conta_id, tipo_operacao: m.acao, quantidade: m.quantidade,
          preco_unitario: m.preco, valor_total: m.valor, data_operacao: m.data,
        }]
      })

      // 5) Dividendos
      const dividendosPayload = movs.flatMap(m => {
        if (m.acao !== 'DIVIDENDO' || !(m.valor > 0) || !m.data) return []
        const conta_id = contaDe(m.instituicao)
        if (!conta_id) return []
        return [{
          ticker: m.ticker, conta_id, valor: m.valor, data_pagamento: m.data,
          tipo_ativo: tipoAtivoDe(m.ticker),
          tipo_dividendo_nome: m.tipoProvento ?? nomeProventoPadrao(m.movimentacao),
        }]
      })

      addLog('ok', `Enviando ${ativosPayload.length} ativos · ${posicoesPayload.length} posições · ${operacoesPayload.length} operações · ${dividendosPayload.length} proventos…`)
      const res = await apiMutate('/investimentos/importar', 'POST', {
        ativos: ativosPayload, posicoes: posicoesPayload, operacoes: operacoesPayload,
        dividendos: dividendosPayload, gerar_extrato_proventos: gerarExtrato,
      })
      if (!res.ok) { addLog('erro', `Falha na importação: ${res.erro}`); return }
      const dados = res.dados as ResultadoImportInv
      setResultado(dados)
      for (const a of dados.avisos ?? []) addLog('aviso', a)
      addLog('ok', 'Importação concluída!')

      // Reconstrói automaticamente o histórico de valor de mercado dos itens
      // importados (séries de cotação por mês desde a data de compra).
      addLog('ok', 'Reconstruindo o histórico de cotações dos itens importados…')
      // Um ativo por chamada: cobrir a carteira inteira numa única invocação
      // estoura o limite de recursos da Edge Function (HTTP 546).
      const bf = await preencherTodos({
        onProgress: (feito, total, ticker) =>
          addLog('ok', `Histórico ${feito}/${total}${ticker ? ` (${ticker})` : ''}…`),
      })
      if (bf.ok) {
        const d = bf.dados
        addLog('ok', `Histórico preenchido: ${d?.meses_gravados ?? 0} mês(es) em ${d?.ativos_processados ?? 0} ativo(s).`)
      } else {
        addLog('aviso', `Histórico não pôde ser preenchido agora (${bf.erro ?? 'erro'}). Use "Preencher histórico" na tela de Investimentos.`)
      }

      // Lembra a associação instituição → conta para as próximas
      // importações (normalizada para a conta usada/criada — não recria).
      const mapaConta = carregarMapaConta(userId)
      for (const g of grupos) if (contaDoGrupo[g]) mapaConta[g] = { acao: 'mapear', mapear_para: contaDoGrupo[g] }
      salvarMapaConta(userId, mapaConta)
      for (const k of [['inv-ativos'], ['inv-posicoes'], ['inv-operacoes'], ['inv-dividendos'], ['inv-historico'], ['inv-dashboard'], ['inv-ranking'], ['inv-tipos-dividendo'], ['contas'], ['dashboard-fase1']]) {
        qc.invalidateQueries({ queryKey: k })
      }
    } catch (e) {
      addLog('erro', `Erro inesperado: ${(e as Error).message}`)
    } finally {
      setLog([...logs])
      setEtapa('concluido')
    }
  }

  const resetar = () => {
    setEtapa('idle'); setPosicoes([]); setMovsRaw([]); setArq({})
    // Mantém o mapeamento salvo (re-hidrata) para a próxima importação.
    setMapaTipoMov(carregarMapaMov(userId)); setTipoOverride({}); setResolucao({})
    setResultado(null); setLog([]); setErroArq('')
  }

  // ── Render ─────────────────────────────────────────────────────
  if (etapa === 'idle') {
    const Tile = ({ titulo, nome, cor }: { titulo: string; nome?: string; cor: string }) => (
      <div className="flex-1 rounded-lg border p-3" style={{ borderColor: nome ? `${cor}50` : 'rgba(255,255,255,0.1)', background: nome ? `${cor}10` : 'transparent' }}>
        <div className="flex items-center gap-2">
          {nome ? <CheckCircle2 size={15} style={{ color: cor }} /> : <FileSpreadsheet size={15} className="text-gray-500" />}
          <div>
            <p className="text-[15px] font-semibold" style={{ color: nome ? cor : '#8b92a8' }}>{titulo}</p>
            <p className="text-[13px] text-gray-400 truncate max-w-[180px]">{nome ?? 'não carregado'}</p>
          </div>
        </div>
      </div>
    )
    return (
      <div className="space-y-3">
        <p className="text-[15px] text-gray-400">
          Importe os relatórios da <strong>área do investidor da B3</strong> — a
          <strong> posição</strong> (quantidade e valor de mercado) e a <strong>movimentação</strong>
          {' '}(extrato: compras, vendas e proventos) — ou a <strong>carteira do Status Invest</strong>
          {' '}(compras e vendas; as posições são derivadas das operações). Pode soltar mais de um — a ordem não importa.
        </p>
        <div className="flex gap-2">
          <Tile titulo="Posição" nome={arq.posicao} cor="#3b82f6" />
          <Tile titulo="Movimentação (extrato)" nome={arq.extrato} cor="#00c896" />
        </div>
        <div
          className="rounded-xl p-6 text-center cursor-pointer transition-all"
          style={{ border: '2px dashed #374151' }}
          onClick={() => inputRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={async e => { e.preventDefault(); const fs = e.dataTransfer.files; if (fs) for (const f of Array.from(fs)) await lerArquivo(f) }}
        >
          {carregando
            ? <Loader2 size={28} className="mx-auto mb-2 animate-spin text-av-green" />
            : <FileSpreadsheet size={28} className="mx-auto mb-2 text-gray-500" />}
          <p className="text-[16px] font-semibold text-gray-300 mb-1">Arraste os arquivos .xlsx ou clique para selecionar</p>
          <p className="text-[14px] text-gray-400">posicao-*.xlsx e movimentacao-*.xlsx</p>
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" multiple className="hidden" onChange={onArquivo} />
        </div>
        {erroArq && <p className="text-[15px] text-red-400">{erroArq}</p>}
        <Btn onClick={() => setEtapa('revisando')} disabled={!podeRevisar || carregando} cor="#a78bfa">
          Revisar importação
        </Btn>
      </div>
    )
  }

  if (etapa === 'revisando') {
    return (
      <div className="space-y-4">
        {/* Resumo */}
        <div className="flex flex-wrap items-center gap-2">
          <Tag cor="#3b82f6">{ativos.length} ativos</Tag>
          <Tag cor="#00c896">{posicoesEfetivas.length} posições</Tag>
          <Tag cor="#a78bfa">{totalOps} operações</Tag>
          <Tag cor="#f0b429">{totalDiv} proventos</Tag>
        </div>

        {/* 1) Instituições → contas */}
        {grupos.length > 0 && (
          <div>
            <p className="text-[16px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Instituições → contas de investimento</p>
            <p className="text-[13px] text-gray-400 mb-2">A associação fica salva após importar e é reaplicada nas próximas importações.</p>
            <div className="space-y-2">
              {grupos.map(g => (
                <div key={g} className="bg-blue-400/5 border border-blue-400/20 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[16px] font-semibold text-blue-400">{g}</span>
                    <div className="flex gap-1">
                      {(['criar', 'mapear'] as const).map(acao => (
                        <button key={acao} onClick={() => setResolucao(r => ({ ...r, [g]: { ...r[g], acao } }))}
                          className="px-2.5 py-1 rounded text-[15px] font-semibold transition-colors"
                          style={{
                            background: resolucao[g]?.acao === acao ? '#3b82f620' : 'transparent',
                            color: resolucao[g]?.acao === acao ? '#3b82f6' : '#8b92a8',
                            border: `1px solid ${resolucao[g]?.acao === acao ? '#3b82f640' : '#ffffff10'}`,
                          }}>
                          {acao === 'criar' ? 'Criar nova' : 'Usar existente'}
                        </button>
                      ))}
                    </div>
                  </div>
                  {resolucao[g]?.acao === 'mapear' && (
                    <select value={resolucao[g]?.mapear_para ?? ''}
                      onChange={e => setResolucao(r => ({ ...r, [g]: { ...r[g], mapear_para: e.target.value } }))}
                      className="w-full bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-1.5 text-[16px] text-gray-200">
                      <option value="">Selecionar conta de investimento…</option>
                      {contasInvest.map(c => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
                    </select>
                  )}
                  {resolucao[g]?.acao === 'criar' && (
                    <p className="text-[14px] text-gray-400">Será criada a conta <strong>Investimentos {g}</strong> (tipo INVESTIMENTO).</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2) Tipos de movimentação */}
        {tiposMov.length > 0 && (
          <div>
            <p className="text-[16px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Tipos de movimentação detectados</p>
            <p className="text-[13px] text-gray-400 mb-2">As escolhas ficam salvas e são reaplicadas automaticamente nas próximas importações.</p>
            <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 max-h-[260px]">
              <table className="w-full text-[15px]">
                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-gray-500">Movimentação</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-500">Linhas</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-500">Tratar como</th>
                  </tr>
                </thead>
                <tbody>
                  {tiposMov.map(t => (
                    <tr key={t.tipo} className="border-t border-gray-700/50">
                      <td className="px-2 py-1 text-gray-300">{t.tipo}</td>
                      <td className="px-2 py-1 text-right text-gray-400">{t.total}</td>
                      <td className="px-1 py-1">
                        <select value={mapaTipoMov[t.tipo] ?? t.acao}
                          onChange={e => setMapaTipoMov(m => ({ ...m, [t.tipo]: e.target.value as AcaoMov }))}
                          className="bg-[#1a1f2e] border border-white/10 rounded px-2 py-0.5 text-[15px] text-gray-200 outline-none">
                          {ACOES_MOV.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 3) Ativos & posições */}
        {posicoesEfetivas.length > 0 && (
          <div>
            <p className="text-[16px] font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Posições{posicoes.length === 0 && <span className="text-[13px] font-normal text-gray-400"> (derivadas das operações)</span>}
            </p>
            <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 max-h-[340px]">
              <table className="w-full min-w-[760px] text-[15px]">
                <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-2 text-left font-semibold text-gray-500">Ticker</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-500">Tipo</th>
                    <th className="px-2 py-2 text-left font-semibold text-gray-500">Instituição</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-500">Qtd</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-500" title="Custo médio das compras do extrato">Custo médio</th>
                    <th className="px-2 py-2 text-right font-semibold text-gray-500">Valor mercado</th>
                    <th className="px-2 py-2 text-center font-semibold text-gray-500" title="Qtd da posição × qtd líquida do extrato">Reconcil.</th>
                  </tr>
                </thead>
                <tbody>
                  {posicoesEfetivas.map((p, i) => {
                    const key = `${p.ticker}|${p.instituicao}`
                    const custo = custoMap.get(key)
                    const precoCusto = custo?.preco_custo ?? p.custo_fallback
                    const liq = qtdLiq.get(key)
                    const diff = liq != null ? liq - p.quantidade : null
                    const ok = diff == null || Math.abs(diff) < 0.01
                    return (
                      <tr key={`${key}-${i}`} className="border-t border-gray-700/50">
                        <td className="px-2 py-1 font-semibold text-gray-200">{p.ticker}</td>
                        <td className="px-1 py-1">
                          <select value={tipoDe(p.ticker, p.tipo_ativo)}
                            onChange={e => setTipoOverride(o => ({ ...o, [p.ticker]: e.target.value as TipoAtivoInvestimento }))}
                            className="bg-[#1a1f2e] border border-white/10 rounded px-1 py-0.5 text-[14px] text-gray-200 outline-none">
                            {TIPOS_ATIVO_INV.map(t => <option key={t} value={t}>{TIPO_ATIVO_LABEL[t]}</option>)}
                          </select>
                        </td>
                        <td className="px-2 py-1 text-gray-400 truncate max-w-[120px]" title={p.instituicao}>{rotuloInstituicao(p.instituicao)}</td>
                        <td className="px-2 py-1 text-right text-gray-300">{p.quantidade}</td>
                        <td className="px-2 py-1 text-right text-gray-300" title={custo ? 'média das compras' : 'estimado (sem compras no extrato)'}>
                          {precoCusto.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                          {!custo && <span className="text-amber-400 ml-1">*</span>}
                        </td>
                        <td className="px-2 py-1 text-right text-gray-300">{p.valor_mercado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                        <td className="px-2 py-1 text-center">
                          {diff == null
                            ? <span className="text-gray-500">—</span>
                            : ok
                              ? <CheckCircle2 size={14} className="inline text-green-400" />
                              : <span className="text-amber-400 text-[13px]" title="quantidade do extrato difere da posição">{diff > 0 ? '+' : ''}{diff.toLocaleString('pt-BR')}</span>}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-gray-400 mt-1"><span className="text-amber-400">*</span> custo estimado (sem compras correspondentes no extrato). A quantidade final vem sempre da posição.</p>
          </div>
        )}

        {/* Proventos no extrato */}
        {totalDiv > 0 && (
          <label className="flex items-start gap-2 p-3 rounded-lg border cursor-pointer"
            style={{ borderColor: gerarExtrato ? '#00c89650' : 'rgba(255,255,255,0.1)', background: gerarExtrato ? '#00c89610' : 'transparent' }}>
            <input type="checkbox" checked={gerarExtrato} onChange={e => setGerarExtrato(e.target.checked)} className="accent-av-green mt-0.5" />
            <span>
              <span className="text-[16px] font-semibold text-gray-200">Gerar lançamentos no extrato para os proventos</span>
              <span className="block text-[14px] text-gray-400">Cada provento vira uma RECEITA no extrato, na categoria mapeada ao seu tipo (Investimentos › Tipos de provento). Tipos sem categoria são gravados só como dividendo.</span>
            </span>
          </label>
        )}

        {pendencia && (
          <p className="text-[15px] text-amber-400 flex items-center gap-1"><AlertTriangle size={14} /> Selecione uma conta para cada instituição marcada como "Usar existente".</p>
        )}

        <div className="flex gap-2">
          <Btn onClick={importar} disabled={pendencia || (posicoesEfetivas.length === 0 && totalOps === 0 && totalDiv === 0)} cor="#00c896">
            <Upload size={14} /> Importar
          </Btn>
          <button onClick={() => setEtapa('idle')} className="px-4 py-2 rounded-lg text-[17px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
            Voltar
          </button>
        </div>
      </div>
    )
  }

  if (etapa === 'importando') {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-[17px] font-semibold text-gray-300">
          <Loader2 size={18} className="animate-spin text-av-green" /> Importando investimentos…
        </div>
        {log.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-1 max-h-[200px] overflow-auto">
            {log.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[15px]"
                style={{ color: l.tipo === 'ok' ? '#00c896' : l.tipo === 'aviso' ? '#f0b429' : '#f87171' }}>
                {l.msg}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  // concluido
  return (
    <div className="space-y-3">
      {resultado && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {[
            { label: 'Ativos criados', valor: resultado.ativos_criados, cor: '#3b82f6' },
            { label: 'Posições', valor: resultado.posicoes, cor: '#00c896' },
            { label: 'Operações', valor: resultado.operacoes, cor: '#a78bfa' },
            { label: 'Proventos', valor: resultado.dividendos, cor: '#f0b429' },
            { label: 'No extrato', valor: resultado.dividendos_no_extrato, cor: '#06b6d4' },
            { label: 'Histórico', valor: resultado.historico, cor: '#10b981' },
          ].map(c => (
            <div key={c.label} className="rounded-lg p-3 text-center" style={{ background: `${c.cor}12`, border: `1px solid ${c.cor}30` }}>
              <p className="text-[22px] font-bold" style={{ color: c.cor }}>{c.valor}</p>
              <p className="text-[13px] text-gray-400">{c.label}</p>
            </div>
          ))}
        </div>
      )}
      {log.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-1 max-h-[220px] overflow-auto">
          {log.map((l, i) => (
            <div key={i} className="flex items-start gap-2 text-[15px]">
              {l.tipo === 'ok' ? <CheckCircle2 size={13} className="text-av-green flex-shrink-0 mt-0.5" />
                : l.tipo === 'aviso' ? <AlertTriangle size={13} className="text-amber-400 flex-shrink-0 mt-0.5" />
                : <X size={13} className="text-red-400 flex-shrink-0 mt-0.5" />}
              <span style={{ color: l.tipo === 'ok' ? '#00c896' : l.tipo === 'aviso' ? '#f0b429' : '#f87171' }}>{l.msg}</span>
            </div>
          ))}
        </div>
      )}
      <Btn onClick={resetar} cor="#a78bfa"><RefreshCw size={14} /> Nova importação</Btn>
    </div>
  )
}

function SecaoImport({ modo, setModo }: { modo: ModoImport; setModo: (m: ModoImport) => void }) {
  const { contas } = useContas()
  const { categorias } = useCategorias()

  const inputRef = useRef<HTMLInputElement>(null)
  const [etapa, setEtapa] = useState<'idle' | 'analisando' | 'revisando' | 'importando' | 'concluido'>('idle')
  const [dragOver, setDragOver] = useState(false)
  const [grid, setGrid] = useState<LinhaGrid[]>([])
  const [paginaAtual, setPaginaAtual] = useState(0)
  const [gridContas, setGridContas] = useState<ContaImport[]>([])
  const [gridCats, setGridCats] = useState<CategoriaImport[]>([])
  const [resolucaoContas, setResolucaoContas] = useState<Record<string, ResolucaoConta>>({})
  const [resolucaoCats, setResolucaoCats] = useState<Record<string, ResolucaoCategoria>>({})
  const [log, setLog] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; msg: string }[]>([])
  const [progresso,      setProgresso]      = useState(0)
  const [progressoInfo,  setProgressoInfo]  = useState({ atual: 0, total: 0, ok: 0, erros: 0, eta: '', velocidade: '' })
  const [logTempoReal,   setLogTempoReal]   = useState<typeof log>([])
  const [carregandoDedup, setCarregandoDedup] = useState(false)
  const canceladoRef = useRef(false)
  const cancelar = () => { canceladoRef.current = true }

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
      setEtapa('analisando')
      setProgresso(0)
      setProgressoInfo({ atual: 0, total: 0, ok: 0, erros: 0, eta: '', velocidade: '' })
      canceladoRef.current = false
      
      // @ts-expect-error dynamic CDN import
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
          // Campos exclusivos de CARTAO — aceitamos múltiplas variações de
          // header para casar com o exportado e com possíveis edições.
          const ehCartao = tipo === 'CARTAO'
          const diaFech = ehCartao ? parseDiaCartao(r['dia fechamento']  ?? r['dia_fechamento']) : null
          const diaPag  = ehCartao ? parseDiaCartao(r['dia pagamento']   ?? r['dia_pagamento'])  : null
          const limRaw  = ehCartao ? (r['limite de crédito'] ?? r['limite de credito'] ?? r['limite_credito'] ?? r['limite']) : ''
          const limCred = ehCartao && String(limRaw).trim() !== ''
            ? Math.max(0, parseValor(String(limRaw)) || 0)
            : null
          const cartoesVirt = ehCartao
            ? parseCartoesVirtuais(r['cartões virtuais'] ?? r['cartoes virtuais'] ?? r['cartoes_virtuais'])
            : []
          let problema = ''
          if (!nome) problema = 'Nome obrigatório'
          else if (!tiposValidos.includes(tipo)) problema = `Tipo inválido: ${tipo}`
          else if (contasExist.has(normalizarNome(nome))) problema = 'Já existe'
          return {
            idx, nome, tipo: tiposValidos.includes(tipo) ? tipo : 'CORRENTE',
            saldo_inicial:   saldo,
            dia_fechamento:  diaFech,
            dia_pagamento:   diaPag,
            limite_credito:  limCred,
            cartoes_virtuais: cartoesVirt,
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
        const catsExist = new Set(categorias.map(x => normalizarNome(x.descricao)))

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

      logDev('[Import] Abas disponíveis:', wb.SheetNames)
      logDev('[Import] Aba selecionada:', abaNome)
      logDev('[Import] Total de linhas lidas:', rows.length)
      if (rows.length > 0) logDev('[Import] Primeira linha (keys):', Object.keys(rows[0]))

      setProgressoInfo({ 
        atual: 0, 
        total: rows.length, 
        ok: 0, 
        erros: 0, 
        eta: '', 
        velocidade: 'Iniciando análise...' 
      })

      const parsed: LinhaImport[] = []
      const chunkSize = 500 // Reduzir para 500 linhas para melhor feedback
      const tInicioAnalise = Date.now()
      
      const getLineNum = () => { const e = new Error(); return e.stack?.split('\n')[1]?.trim() || '???' }
      
      logDev(`[Import:${getLineNum()}] Iniciando processamento de`, rows.length, 'linhas em chunks de', chunkSize)
      
      // Limpar estado anterior para evitar memory leaks
      if (parsed.length > 10000) {
        console.warn(`[Import:${getLineNum()}] Grande volume de dados detectado, otimizando memória`)
      }
      
      for (let chunkStart = 0; chunkStart < rows.length; chunkStart += chunkSize) {
        if (canceladoRef.current) {
          setEtapa('idle')
          setProgresso(0)
          setProgressoInfo({ atual: 0, total: 0, ok: 0, erros: 0, eta: '', velocidade: '' })
          return
        }
        const chunkEnd = Math.min(chunkStart + chunkSize, rows.length)
        const chunk = rows.slice(chunkStart, chunkEnd)
        
        logDev(`[Import:${getLineNum()}] Processando chunk ${Math.floor(chunkStart/chunkSize)+1}: linhas ${chunkStart}-${chunkEnd}`)
        
        try {
          // Processar chunk de forma síncrona para evitar travar
          const chunkParsed: LinhaImport[] = chunk.map((row, idx) => {
            const globalIdx = chunkStart + idx
            const r = normalizar(row)
            const dataRaw = r['data'] ?? r['date'] ?? ''
            let dataFmt = ''
            if (dataRaw instanceof Date) {
              dataFmt = dataParaYMD(dataRaw)
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
            // status: aceita apenas PENDENTE ou PROJECAO — PAGO não é importável
            const statusNorm = String(r['status'] ?? '').toUpperCase()
              .normalize('NFD').replace(/[̀-ͯ]/g, '') // PROJEÇÃO → PROJECAO
            const status = ['PENDENTE', 'PROJECAO'].includes(statusNorm) ? statusNorm : 'PENDENTE'

            return {
              idx: globalIdx,
              data:           dataFmt,
              descricao:      String(r['descrição'] ?? r['descricao'] ?? r['description'] ?? '').trim(),
              valor,
              tipo,
              conta_nome:     String(r['conta'] ?? r['account'] ?? '').trim(),
              categoria_nome: String(r['categoria'] ?? r['category'] ?? '').trim(),
              status,
              observacao:     String(r['observação'] ?? r['observacao'] ?? r['observation'] ?? '').trim(),
            }
          })
          
          parsed.push(...chunkParsed)
          
          // Forçar garbage collection periódico para grandes arquivos
          if (chunkStart % 5000 === 0 && chunkStart > 0) {
            if (typeof window !== 'undefined' && (window as Window & { gc?: () => void }).gc) {
              (window as Window & { gc?: () => void }).gc!()
            }
          }
          
        } catch (error) {
          console.error(`[Import:${getLineNum()}] Erro processando chunk ${chunkStart}-${chunkEnd}:`, error)
          // Continuar processamento mesmo com erro no chunk
          continue
        }
        
        // Atualizar progresso imediatamente após processar cada chunk
        const progresso = Math.round((chunkEnd / rows.length) * 100)
        const elapsed = (Date.now() - tInicioAnalise) / 1000
        const velocidade = elapsed > 0 ? (chunkEnd / elapsed).toFixed(0) : '0'
        const restantes = rows.length - chunkEnd
        const etaSeg = elapsed > 0 && chunkEnd > 0 ? Math.round(restantes / (chunkEnd / elapsed)) : null
        const eta = etaSeg !== null
          ? etaSeg > 60
            ? `${Math.floor(etaSeg / 60)}m ${etaSeg % 60}s`
            : `${etaSeg}s`
          : 'calculando...'
        
        logDev(`[Import:${getLineNum()}] Progresso: ${progresso}% (${chunkEnd}/${rows.length}) - ${velocidade} linhas/s`)
        
        // Forçar atualização do React
        setProgresso(progresso)
        setProgressoInfo({ 
          atual: chunkEnd, 
          total: rows.length, 
          ok: 0, 
          erros: 0, 
          eta, 
          velocidade: `${velocidade} linhas/s` 
        })
        
        // Pequena pausa apenas se não for o último chunk - aumentar para melhor UI
        if (chunkEnd < rows.length) {
          await new Promise(r => setTimeout(r, 50)) // 50ms para UI respirar
        }
      }
      
      // Filtrar linhas válidas
      const filtered = parsed.filter(l => l.descricao && l.valor > 0 && l.conta_nome && l.categoria_nome)

      logDev(`[Import:${getLineNum()}] Linhas após filtro:`, filtered.length)
      if (filtered.length === 0 && rows.length > 0) {
        logDev(`[Import:${getLineNum()}] DEBUG primeira linha normalizada:`, Object.fromEntries(
          Object.keys(rows[0]).map(k => [k.toLowerCase().trim(), rows[0][k]])
        ))
      }

      // ── Detectar contas e categorias desconhecidas ──────────────
      const contaMap = Object.fromEntries(contas.map((c: Conta) => [normalizarNome(c.nome), c.conta_id]))
      const catMap   = Object.fromEntries(categorias.map(c => [normalizarNome(c.descricao), c.id]))

      const contasDesc = new Set<string>()
      const catsDesc   = new Map<string, 'RECEITA' | 'DESPESA'>()
      filtered.forEach(l => {
        if (!contaMap[normalizarNome(l.conta_nome)]) contasDesc.add(l.conta_nome)
        if (!catMap[normalizarNome(l.categoria_nome)]) catsDesc.set(l.categoria_nome, l.tipo)
      })

      const rc: Record<string, ResolucaoConta> = {}
      contasDesc.forEach(nome => { rc[nome] = { nome, acao: 'criar' } })
      const rcat: Record<string, ResolucaoCategoria> = {}
      catsDesc.forEach((tipo, nome) => { rcat[nome] = { nome, tipo, acao: 'criar' } })

      setResolucaoContas(rc)
      setResolucaoCats(rcat)

      // ── Verificar duplicatas no banco (OTIMIZADO) ───────────────────────────
      setCarregandoDedup(true)
      let txExistentes: TransacaoRaw[] = []
      try {
        const { apiFetch: apiFetchDyn, extrairLista: extrairListaDyn } = await import('../lib/api')
        
        // Para arquivos grandes, limitar verificação aos últimos 6 meses para performance
        const datasUnicas = [...new Set(filtered.map(l => l.data.slice(0, 7)).filter(Boolean))]
        const mesesParaVerificar = datasUnicas.length > 6 
          ? datasUnicas.slice(-6) // últimos 6 meses
          : datasUnicas
        
        logDev(`[Import:${getLineNum()}] Verificando duplicatas em ${mesesParaVerificar.length} meses de ${datasUnicas.length} totais`)
        
        // Buscar em batch com limite maior para reduzir chamadas
        const resArr = await Promise.all(
          mesesParaVerificar.map(mes => apiFetchDyn(`/transacoes?mes=${mes}&per_page=5000&saldo=true`))
        )
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        txExistentes = resArr.flatMap(r => extrairListaDyn<any>(r.dados))
        
        logDev(`[Import:${getLineNum()}] Encontradas ${txExistentes.length} transações existentes para verificação`)
      } catch (error) { 
        console.warn(`[Import:${getLineNum()}] Erro ao verificar duplicatas, continuando sem verificação:`, error)
      }
      setCarregandoDedup(false)

      // Chave de duplicata: data + descricao normalizada + categoria_nome normalizada
      const chaveExistente = new Set(
        txExistentes.map(t =>
          `${t.data}|${normalizarNome(t.descricao ?? '')}|${normalizarNome((t.categoria_nome as string | undefined) ?? '')}`
        )
      )

      // ── Montar grid com status de cada linha ────────────────────
      const linhasGrid: LinhaGrid[] = filtered.map(l => {
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
      setPaginaAtual(0) // Resetar página para início
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
    canceladoRef.current = false
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
        if (canceladoRef.current) { addLog('aviso', `Cancelado. ${ok} contas importadas.`); break }
        const l = paraImportar[i]
        // Payload base: backend força saldo_inicial=0 em CARTAO; pra outros tipos
        // o saldo informado vale. Campos de cartão só vão quando tipo=CARTAO
        // (a edge function ignora silenciosamente em outros tipos, mas
        // evitamos sujeira no payload).
        const payload: Record<string, unknown> = {
          nome: l.nome, tipo: l.tipo, saldo_inicial: l.saldo_inicial,
        }
        if (l.tipo === 'CARTAO') {
          if (l.dia_fechamento  != null) payload.dia_fechamento  = l.dia_fechamento
          if (l.dia_pagamento   != null) payload.dia_pagamento   = l.dia_pagamento
          if (l.limite_credito  != null) payload.limite_credito  = l.limite_credito
          if (l.cartoes_virtuais.length) payload.cartoes_virtuais = l.cartoes_virtuais
        }
        const r = await apiComRetry('/contas', 'POST', payload)
        if (r.ok) ok++
        else { addLog('erro', `"${l.nome}": ${r.erro}`); erros++ }
        setProgresso(Math.round(((i + 1) / paraImportar.length) * 100))
      }
      if (!canceladoRef.current) addLog('ok', `Contas: ${ok} importadas, ${erros} erros`)
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
      categorias.forEach(c => { if (!c.id_pai) mapaIdPai[normalizarNome(c.descricao)] = c.id })

      let ok = 0, erros = 0
      const total = pais.length + filhos.length
      for (let i = 0; i < pais.length; i++) {
        if (canceladoRef.current) { addLog('aviso', `Cancelado. ${ok} categorias importadas.`); break }
        const l = pais[i]
        const r = await apiComRetry('/categorias', 'POST', {
          descricao: l.categoria, icone: l.icone || undefined,
        })
        if (r.ok && (r.dados as { id?: string } | null)?.id) { mapaIdPai[normalizarNome(l.categoria)] = (r.dados as { id: string }).id; ok++ }
        else { addLog('erro', `"${l.categoria}": ${r.erro}`); erros++ }
        setProgresso(Math.round(((i + 1) / total) * 100))
      }
      for (let i = 0; i < filhos.length && !canceladoRef.current; i++) {
        const l = filhos[i]
        const idPai = mapaIdPai[normalizarNome(l.categoria)]
        if (!idPai) { addLog('aviso', `"${l.subcategoria}": categoria pai "${l.categoria}" não encontrada`); erros++; continue }
        const r = await apiComRetry('/categorias', 'POST', {
          descricao: l.subcategoria, id_pai: idPai,
          icone: l.icone || undefined,
        })
        if (r.ok) ok++
        else { addLog('erro', `"${l.subcategoria}": ${r.erro}`); erros++ }
        setProgresso(Math.round(((pais.length + i + 1) / total) * 100))
      }
      if (!canceladoRef.current) addLog('ok', `Categorias: ${ok} importadas, ${erros} erros`)
      setLog(logs)
      setEtapa('concluido')
      return
    }

    const contasReativadas: string[] = []
    try {
      const contaMap = Object.fromEntries(contas.map((c: Conta) => [normalizarNome(c.nome), c.conta_id]))
      const catMap   = Object.fromEntries(categorias.map(c => [normalizarNome(c.descricao), c.id]))

      // 1. Criar/mapear contas desconhecidas
      for (const [nome, res] of Object.entries(resolucaoContas)) {
        if (res.acao === 'criar') {
          const r = await apiComRetry('/contas', 'POST', { nome, tipo: 'CORRENTE', saldo_inicial: 0 })
          if (r.ok && (r.dados as { conta_id?: string } | null)?.conta_id) {
            contaMap[normalizarNome(nome)] = (r.dados as { conta_id: string }).conta_id
            addLog('ok', `Conta criada: ${nome}`)
          } else addLog('erro', `Falha ao criar conta "${nome}": ${r.erro}`)
        } else if (res.acao === 'mapear' && res.mapear_para) {
          contaMap[normalizarNome(nome)] = res.mapear_para
        }
      }

      // 2. Criar/mapear categorias desconhecidas
      for (const [nome, res] of Object.entries(resolucaoCats)) {
        if (res.acao === 'criar') {
          const r = await apiComRetry('/categorias', 'POST', { descricao: nome, tipo: res.tipo })
          if (r.ok && (r.dados as { id?: string } | null)?.id) {
            catMap[normalizarNome(nome)] = (r.dados as { id: string }).id
            addLog('ok', `Categoria criada: ${nome} (${res.tipo})`)
          } else addLog('erro', `Falha ao criar categoria "${nome}": ${r.erro}`)
        } else if (res.acao === 'mapear' && res.mapear_para) {
          catMap[normalizarNome(nome)] = res.mapear_para
        }
      }

      // 3. Detectar pares de transferência
      // Critério: categoria == "transferencias", pareamento por data + valor + tipos opostos + contas diferentes.
      const linhasParaImportar = grid.filter(l => l.importar)
      const isCandidatoTransf = (l: LinhaGrid) =>
        normalizarNome(l.categoria_nome) === 'transferencias'

      const pares: Array<{ debito: LinhaGrid; credito: LinhaGrid }> = []
      const idsPareados = new Set<number>()
      for (const a of linhasParaImportar) {
        if (idsPareados.has(a.idx) || !isCandidatoTransf(a)) continue
        const par = linhasParaImportar.find(b =>
          b.idx !== a.idx &&
          !idsPareados.has(b.idx) &&
          isCandidatoTransf(b) &&
          b.data === a.data &&
          Math.abs(b.valor - a.valor) < 0.005 &&
          b.tipo !== a.tipo &&
          normalizarNome(b.conta_nome) !== normalizarNome(a.conta_nome)
        )
        if (par) {
          idsPareados.add(a.idx); idsPareados.add(par.idx)
          const debito  = a.tipo === 'DESPESA' ? a : par
          const credito = a.tipo === 'RECEITA' ? a : par
          pares.push({ debito, credito })
        }
      }
      const linhasNormais = linhasParaImportar.filter(l => !idsPareados.has(l.idx))
      if (pares.length > 0) addLog('ok', `${pares.length} par(es) de transferência detectado(s)`)

      // 4. Reativar contas inativas envolvidas na importação
      const contasUsadas = new Set<string>()
      for (const l of linhasParaImportar) {
        const cid = contaMap[normalizarNome(l.conta_nome)]
        if (cid) contasUsadas.add(cid)
      }
      for (const cid of contasUsadas) {
        const c = contas.find((x: Conta) => x.conta_id === cid)
        if (c && !c.ativa) {
          const r = await apiComRetry(`/contas/${cid}`, 'PUT', { ativa: true })
          if (r.ok) {
            contasReativadas.push(cid)
            addLog('ok', `Conta "${c.nome}" reativada temporariamente`)
          } else addLog('erro', `Falha ao reativar conta "${c.nome}": ${r.erro}`)
        }
      }

      // 5. Importar — pares via /transferencias, restante via /transacoes em até 4 workers
      const totalRows = pares.length * 2 + linhasNormais.length
      let ok = 0, erros = 0, processados = 0
      const tInicio = Date.now()

      const reportarProgresso = () => {
        const pct = totalRows > 0 ? Math.round((processados / totalRows) * 100) : 100
        const elapsed = (Date.now() - tInicio) / 1000
        const velocidade = elapsed > 0 ? (processados / elapsed).toFixed(1) : '...'
        const restantes  = totalRows - processados
        const etaSeg   = elapsed > 0 && processados > 0 ? Math.round(restantes / (processados / elapsed)) : null
        const eta      = etaSeg !== null
          ? etaSeg > 60 ? `${Math.floor(etaSeg / 60)}m ${etaSeg % 60}s` : `${etaSeg}s`
          : '...'
        setProgresso(pct)
        setProgressoInfo({ atual: processados, total: totalRows, ok, erros, eta, velocidade: `${velocidade}/s` })
      }

      // 5a. Pares de transferência em até 8 workers paralelos
      // (POST /transferencias cria os 2 lançamentos atomicamente — paralelizar entre pares é seguro)
      const chunksPares = dividirEmChunks(pares, 8)
      if (pares.length > 0)
        addLog('ok', `Importando ${pares.length} transferência(s) em ${chunksPares.length} worker(s) paralelos...`)

      const processarPar = async (chunk: typeof pares) => {
        for (const par of chunk) {
          if (canceladoRef.current) break
          const origemId  = contaMap[normalizarNome(par.debito.conta_nome)]
          const destinoId = contaMap[normalizarNome(par.credito.conta_nome)]
          if (!origemId || !destinoId) {
            addLog('erro', `Transferência "${par.debito.descricao}" (${par.debito.data}) ignorada: conta(s) não resolvida(s)`)
            erros += 2
          } else {
            const r = await apiComRetry('/transferencias', 'POST', {
              conta_origem_id:  origemId,
              conta_destino_id: destinoId,
              valor:            par.debito.valor,
              data:             par.debito.data,
              descricao:        par.debito.descricao,
              status:           par.debito.status,
            })
            if (r.ok) ok += 2
            else { addLog('erro', `Transferência "${par.debito.descricao}" (${par.debito.data}): ${r.erro}`); erros += 2 }
          }
          processados += 2
          if (processados % 10 < 2 || processados === totalRows) reportarProgresso()
        }
      }
      await Promise.all(chunksPares.map(processarPar))

      // 5b. Lançamentos normais em até 8 workers paralelos
      const chunks = dividirEmChunks(linhasNormais, 8)
      if (linhasNormais.length > 0)
        addLog('ok', `Iniciando com ${chunks.length} workers paralelos (${linhasNormais.length} registros)...`)

      const processarChunk = async (chunk: LinhaGrid[]) => {
        for (const l of chunk) {
          if (canceladoRef.current) break
          const conta_id     = contaMap[normalizarNome(l.conta_nome)]
          const categoria_id = catMap[normalizarNome(l.categoria_nome)]

          if (!conta_id || !categoria_id) {
            addLog('erro', `"${l.descricao}" ignorada: conta ou categoria não resolvida`)
            erros++
          } else {
            const r = await apiComRetry('/transacoes', 'POST', {
              tipo: l.tipo, data: l.data, descricao: l.descricao,
              valor: l.valor, conta_id, categoria_id,
              status: l.status, observacao: l.observacao || undefined,
            })
            if (r.ok) ok++
            else { addLog('erro', `"${l.descricao}" (${l.data}): ${r.erro}`); erros++ }
          }

          processados++
          if (processados % 10 === 0 || processados === totalRows) reportarProgresso()
        }
      }

      await Promise.all(chunks.map(processarChunk))

      const ignoradas = grid.filter(l => !l.importar).length
      if (canceladoRef.current) addLog('aviso', `Cancelado. ${ok} lançamento(s) importado(s) de ${totalRows}.`)
      else addLog('ok', `Concluído: ${ok} importado(s), ${erros} erro(s), ${ignoradas} ignorada(s)`)
    } catch (e) {
      addLog('erro', `Erro inesperado: ${(e as Error).message}`)
    } finally {
      // Reinativar contas que foram reativadas para a importação
      for (const cid of contasReativadas) {
        const c = contas.find((x: Conta) => x.conta_id === cid)
        const r = await apiComRetry(`/contas/${cid}`, 'PUT', { ativa: false })
        if (r.ok) addLog('ok', `Conta "${c?.nome ?? cid}" reinativada`)
        else addLog('erro', `Falha ao reinativar "${c?.nome ?? cid}": ${r.erro}`)
      }
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

  // Modo investimentos tem fluxo próprio (dois arquivos da B3, mapeamento de
  // instituições e tipos de movimentação) — componente autocontido.
  if (modo === 'investimentos') {
    return (
      <Section titulo="Importar investimentos" subtitulo="Extrato e posição exportados da B3" icon={Upload} cor="#a78bfa">
        <div className="space-y-4">
          <SeletorModoImport modo={modo} setModo={setModo} />
          <ImportInvestimentos contas={contas} />
        </div>
      </Section>
    )
  }

  return (
    <Section titulo="Importar dados" subtitulo="Importa transações de CSV ou XLSX" icon={Upload} cor="#a78bfa">
      <div className="space-y-4">

        {/* ── IDLE ── */}
        {etapa === 'idle' && (
          <div className="space-y-3">
            {/* Seletor de modo */}
            <SeletorModoImport modo={modo} setModo={setModo} />

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
              <p className="text-[18px] font-semibold mb-1" style={{ color: dragOver ? '#a78bfa' : '#d1d5db' }}>
                {dragOver ? 'Solte o arquivo aqui' : 'Arraste um arquivo ou clique para selecionar'}
              </p>
              <p className="text-[15px] text-gray-400 mb-4">
                {modo === 'transacoes' && 'CSV ou XLSX — use a aba "Modelo Importação" como referência'}
                {modo === 'contas' && 'XLSX com colunas: Nome | Tipo | Saldo Inicial (opcional: Ícone, Cor)'}
                {modo === 'categorias' && 'XLSX com colunas: Categoria | Subcategoria (opcional: Ícone, Cor)'}
              </p>
              <button
                onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
                className="px-5 py-2 rounded-lg text-[17px] font-semibold transition-colors"
                style={{ background: '#a78bfa20', color: '#a78bfa', border: '1px solid #a78bfa40' }}
              >
                Escolher arquivo
              </button>
              <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={onArquivo} />
            </div>
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3">
              {modo === 'transacoes' && <>
                <p className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 mb-2">Colunas esperadas:</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { col: 'data', obrig: true },
                    { col: 'descricao', obrig: true },
                    { col: 'valor', obrig: true },
                    { col: 'conta', obrig: true },
                    { col: 'categoria', obrig: true },
                    { col: 'tipo', obrig: false },
                    { col: 'status', obrig: false },
                    { col: 'observacao', obrig: false },
                  ].map(col => (
                    <div key={col.col} className="flex items-center gap-1">
                      <code className="text-[14px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: col.obrig ? '#a78bfa20' : '#ffffff10', color: col.obrig ? '#a78bfa' : '#8b92a8' }}>
                        {col.col}
                      </code>
                      {col.obrig && <span className="text-[13px] text-red-400">*</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[14px] text-gray-400">* obrigatório — valor negativo = DESPESA, positivo = RECEITA | datas no formato DD/MM/AAAA | status: PENDENTE ou PROJECAO (padrão: PENDENTE)</p>
              </>}
              {modo === 'contas' && <>
                <p className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 mb-2">Colunas esperadas:</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { col: 'nome', obrig: true },
                    { col: 'tipo', obrig: true },
                    { col: 'saldo inicial', obrig: false },
                    { col: 'icone', obrig: false },
                    { col: 'cor', obrig: false },
                  ].map(col => (
                    <div key={col.col} className="flex items-center gap-1">
                      <code className="text-[14px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: col.obrig ? '#a78bfa20' : '#ffffff10', color: col.obrig ? '#a78bfa' : '#8b92a8' }}>
                        {col.col}
                      </code>
                      {col.obrig && <span className="text-[13px] text-red-400">*</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[14px] text-gray-400">Tipos válidos: CORRENTE | REMUNERACAO | CARTAO | INVESTIMENTO | CARTEIRA</p>
              </>}
              {modo === 'categorias' && <>
                <p className="text-[15px] font-semibold text-gray-500 dark:text-gray-400 mb-2">Colunas esperadas:</p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {[
                    { col: 'categoria', obrig: true },
                    { col: 'subcategoria', obrig: false },
                    { col: 'icone', obrig: false },
                    { col: 'cor', obrig: false },
                  ].map(col => (
                    <div key={col.col} className="flex items-center gap-1">
                      <code className="text-[14px] px-1.5 py-0.5 rounded font-mono"
                        style={{ background: col.obrig ? '#a78bfa20' : '#ffffff10', color: col.obrig ? '#a78bfa' : '#8b92a8' }}>
                        {col.col}
                      </code>
                      {col.obrig && <span className="text-[13px] text-red-400">*</span>}
                    </div>
                  ))}
                </div>
                <p className="text-[14px] text-gray-400">Subcategoria vazia = categoria pai | com valor = subcategoria filha</p>
              </>}
            </div>

            {/* Botão baixar modelo */}
            <button
              onClick={async () => {
                // @ts-expect-error dynamic CDN import
                const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs')
                const wb = XLSX.utils.book_new()
                if (modo === 'transacoes') {
                  const ws = XLSX.utils.json_to_sheet([
                    { data: '15/01/2024', descricao: 'Conta de luz', valor: -150.00, conta: 'Conta Corrente', categoria: 'Moradia', status: 'PENDENTE', observacao: '' },
                    { data: '20/01/2024', descricao: 'Salário', valor: 5000.00, conta: 'Conta Corrente', categoria: 'Salário', status: 'PENDENTE', observacao: 'Pagamento mensal' },
                    { data: '01/02/2024', descricao: 'Aluguel previsto', valor: -1200.00, conta: 'Conta Corrente', categoria: 'Moradia', status: 'PROJECAO', observacao: 'Projeção futura' },
                  ])
                  ws['!cols'] = [{ wch: 14 }, { wch: 30 }, { wch: 12 }, { wch: 20 }, { wch: 22 }, { wch: 12 }, { wch: 30 }]
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
              className="flex items-center gap-2 text-[16px] font-semibold px-3 py-2 rounded-lg transition-colors"
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
                {carregandoDedup && <span className="text-[15px] text-gray-400 flex items-center gap-1"><Loader2 size={11} className="animate-spin"/> verificando duplicatas...</span>}
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
                <table className="w-full text-[15px]">
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 w-8 text-center">✓</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500">Situação</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500">Nome</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500">Tipo</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-500">Saldo inicial</th>
                      <th className="px-2 py-2 text-center font-semibold text-gray-500" title="Só CARTAO">Fech.</th>
                      <th className="px-2 py-2 text-center font-semibold text-gray-500" title="Só CARTAO">Pag.</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-500" title="Só CARTAO">Limite</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500" title="Só CARTAO — formato: '1234 Apelido, 5678 Outro'">Cartões virtuais</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gridContas.map(l => {
                      const ehCartao = l.tipo === 'CARTAO'
                      const cellCartao = (vazio: boolean) =>
                        !ehCartao || vazio
                          ? { color: '#6b7280', opacity: 0.6 } as const
                          : { color: '#d1d5db' } as const
                      return (
                      <tr key={l.idx} className="border-t border-gray-700/50"
                        style={{ background: l.problema ? 'rgba(255,107,74,0.06)' : 'transparent', opacity: l.importar ? 1 : 0.45 }}>
                        <td className="px-2 py-1 text-center">
                          <input type="checkbox" checked={l.importar}
                            onChange={e => setContaLinha(l.idx, { importar: e.target.checked })}
                            className="accent-av-green" />
                        </td>
                        <td className="px-2 py-1 whitespace-nowrap">
                          {l.problema
                            ? <span className="text-[14px] font-semibold px-1.5 py-0.5 rounded-full bg-red-400/10 text-red-400">{l.problema}</span>
                            : <span className="text-[14px] font-semibold px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400">OK</span>}
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={l.nome}
                            onChange={e => setContaLinha(l.idx, { nome: e.target.value })}
                            className="w-full min-w-[140px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[15px] text-gray-300 outline-none" />
                        </td>
                        <td className="px-1 py-1">
                          <select value={l.tipo}
                            onChange={e => setContaLinha(l.idx, { tipo: e.target.value })}
                            className="bg-transparent border border-transparent hover:border-white/10 rounded px-1 py-0.5 text-[15px] text-gray-300 outline-none"
                            style={{ background: '#1a1f2e' }}>
                            {['CORRENTE','REMUNERACAO','CARTAO','INVESTIMENTO','CARTEIRA'].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-1 py-1 text-right">
                          <input type="number" step="0.01" value={l.saldo_inicial}
                            disabled={ehCartao}
                            title={ehCartao ? 'CARTAO sempre tem saldo inicial = 0' : ''}
                            onChange={e => setContaLinha(l.idx, { saldo_inicial: parseFloat(e.target.value) || 0 })}
                            className="w-[90px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[15px] text-right text-gray-300 outline-none disabled:opacity-40" />
                        </td>
                        {/* Dia fechamento */}
                        <td className="px-1 py-1 text-center">
                          <input type="number" min={1} max={31}
                            value={l.dia_fechamento ?? ''}
                            disabled={!ehCartao}
                            onChange={e => setContaLinha(l.idx, { dia_fechamento: parseDiaCartao(e.target.value) })}
                            className="w-[50px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1 py-0.5 text-[15px] text-center outline-none disabled:opacity-30"
                            style={cellCartao(l.dia_fechamento == null)} />
                        </td>
                        {/* Dia pagamento */}
                        <td className="px-1 py-1 text-center">
                          <input type="number" min={1} max={31}
                            value={l.dia_pagamento ?? ''}
                            disabled={!ehCartao}
                            onChange={e => setContaLinha(l.idx, { dia_pagamento: parseDiaCartao(e.target.value) })}
                            className="w-[50px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1 py-0.5 text-[15px] text-center outline-none disabled:opacity-30"
                            style={cellCartao(l.dia_pagamento == null)} />
                        </td>
                        {/* Limite de crédito */}
                        <td className="px-1 py-1 text-right">
                          <input type="number" step="0.01" min={0}
                            value={l.limite_credito ?? ''}
                            disabled={!ehCartao}
                            onChange={e => {
                              const v = e.target.value
                              setContaLinha(l.idx, { limite_credito: v === '' ? null : Math.max(0, parseFloat(v) || 0) })
                            }}
                            className="w-[110px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[15px] text-right outline-none disabled:opacity-30"
                            style={cellCartao(l.limite_credito == null)} />
                        </td>
                        {/* Cartões virtuais (read-only nesta tela — edição rica fica na ContasPage) */}
                        <td className="px-1 py-1">
                          <span className="text-[14px]" style={cellCartao(l.cartoes_virtuais.length === 0)}>
                            {ehCartao && l.cartoes_virtuais.length > 0
                              ? l.cartoes_virtuais.map(cv => `${cv.sufixo}${cv.apelido ? ` ${cv.apelido}` : ''}`).join(', ')
                              : ehCartao ? '—' : ''}
                          </span>
                        </td>
                      </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* ── Grid de Categorias ── */}
            {modo === 'categorias' && (
              <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 max-h-[350px]">
                <table className="w-full text-[15px]">
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
                            ? <span className="text-[14px] font-semibold px-1.5 py-0.5 rounded-full bg-red-400/10 text-red-400">{l.problema}</span>
                            : <span className="text-[14px] font-semibold px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400">{l.subcategoria ? 'Subcategoria' : 'Pai'}</span>}
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={l.categoria}
                            onChange={e => setCatLinha(l.idx, { categoria: e.target.value })}
                            className="w-full min-w-[130px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[15px] text-gray-300 outline-none" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="text" value={l.subcategoria}
                            onChange={e => setCatLinha(l.idx, { subcategoria: e.target.value })}
                            className="w-full min-w-[130px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[15px] text-gray-300 outline-none"
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
                <p className="text-[16px] font-semibold text-gray-700 dark:text-gray-300 mb-2">Contas não encontradas — como proceder?</p>
                <div className="space-y-2">
                  {contasDesconhecidas.map(nome => (
                    <div key={nome} className="bg-amber-400/5 border border-amber-400/20 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[16px] font-semibold text-amber-400">"{nome}"</span>
                        <div className="flex gap-1">
                          {(['criar', 'mapear'] as const).map(acao => (
                            <button key={acao} onClick={() => setResolucaoContas(r => ({ ...r, [nome]: { ...r[nome], acao } }))}
                              className="px-2.5 py-1 rounded text-[15px] font-semibold transition-colors"
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
                          className="w-full bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-1.5 text-[16px] text-gray-200">
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
                <p className="text-[16px] font-semibold text-gray-700 dark:text-gray-300 mb-2">Categorias não encontradas — como proceder?</p>
                <div className="space-y-2">
                  {catsDesconhecidas.map(nome => (
                    <div key={nome} className="bg-purple-400/5 border border-purple-400/20 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[16px] font-semibold text-purple-400">"{nome}"</span>
                          <Tag cor={resolucaoCats[nome]?.tipo === 'RECEITA' ? '#00c896' : '#ff6b4a'}>{resolucaoCats[nome]?.tipo}</Tag>
                        </div>
                        <div className="flex gap-1">
                          {(['criar', 'mapear'] as const).map(acao => (
                            <button key={acao} onClick={() => setResolucaoCats(r => ({ ...r, [nome]: { ...r[nome], acao } }))}
                              className="px-2.5 py-1 rounded text-[15px] font-semibold transition-colors"
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
                          className="w-full bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-1.5 text-[16px] text-gray-200">
                          <option value="">Selecionar categoria...</option>
                          {categorias.map(c => (
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
                <p className="text-[15px] font-semibold text-gray-400 uppercase tracking-wide">
                  Grid de revisão — edite os dados antes de importar
                </p>
                <div className="flex gap-2">
                  <button onClick={() => toggleTodos(true)}
                    className="text-[14px] px-2 py-1 rounded text-av-green bg-av-green/10 hover:bg-av-green/20 transition-colors">
                    Marcar todos
                  </button>
                  <button onClick={() => toggleTodos(false)}
                    className="text-[14px] px-2 py-1 rounded text-gray-400 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
                    Desmarcar todos
                  </button>
                </div>
              </div>

              {/* Paginação para grandes arquivos */}
              {grid.length > 100 && (
                <div className="bg-blue-400/5 border border-blue-400/20 rounded-lg p-3 mb-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[15px] font-semibold text-blue-400">
                        📊 Arquivo grande detectado ({grid.length} registros)
                      </p>
                      <p className="text-[14px] text-blue-400/70">
                        Exibindo {paginaAtual * 100 + 1}-{Math.min((paginaAtual + 1) * 100, grid.length)} de {grid.length}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => setPaginaAtual(Math.max(0, paginaAtual - 1))}
                        disabled={paginaAtual === 0}
                        className="px-2 py-1 rounded text-[14px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: paginaAtual === 0 ? 'transparent' : '#4da6ff20',
                          color: paginaAtual === 0 ? '#8b92a8' : '#4da6ff',
                          border: `1px solid ${paginaAtual === 0 ? '#ffffff10' : '#4da6ff40'}`,
                        }}
                      >
                        ← Anterior
                      </button>
                      <span className="px-2 py-1 text-[14px] font-semibold text-gray-400">
                        Página {paginaAtual + 1} de {Math.ceil(grid.length / 100)}
                      </span>
                      <button
                        onClick={() => setPaginaAtual(Math.min(Math.ceil(grid.length / 100) - 1, paginaAtual + 1))}
                        disabled={paginaAtual >= Math.ceil(grid.length / 100) - 1}
                        className="px-2 py-1 rounded text-[14px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        style={{
                          background: paginaAtual >= Math.ceil(grid.length / 100) - 1 ? 'transparent' : '#4da6ff20',
                          color: paginaAtual >= Math.ceil(grid.length / 100) - 1 ? '#8b92a8' : '#4da6ff',
                          border: `1px solid ${paginaAtual >= Math.ceil(grid.length / 100) - 1 ? '#ffffff10' : '#4da6ff40'}`,
                        }}
                      >
                        Próximo →
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="overflow-auto rounded-lg border border-gray-200 dark:border-gray-700 max-h-[400px]">
                <table className="w-full text-[15px]" style={{ minWidth: 900 }}>
                  <thead className="bg-gray-50 dark:bg-gray-700 sticky top-0 z-10">
                    <tr>
                      <th className="px-2 py-2 text-center w-8">✓</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Situação</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Data</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400">Descrição</th>
                      <th className="px-2 py-2 text-right font-semibold text-gray-500 dark:text-gray-400">Valor</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Status</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Conta</th>
                      <th className="px-2 py-2 text-left font-semibold text-gray-500 dark:text-gray-400 whitespace-nowrap">Categoria</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(grid.length > 100 ? grid.slice(paginaAtual * 100, (paginaAtual + 1) * 100) : grid).map(l => {
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
                              ? <span className="text-[14px] font-semibold px-1.5 py-0.5 rounded-full bg-red-400/10 text-red-400">{l.problema}</span>
                              : <span className="text-[14px] font-semibold px-1.5 py-0.5 rounded-full bg-green-400/10 text-green-400">OK</span>
                            }
                          </td>

                          {/* Data — editável */}
                          <td className="px-1 py-1">
                            <input
                              type="text"
                              value={l.data}
                              onChange={e => setLinha(l.idx, { data: e.target.value })}
                              className="w-[90px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[15px] text-gray-300 outline-none"
                            />
                          </td>

                          {/* Descrição — editável */}
                          <td className="px-1 py-1">
                            <input
                              type="text"
                              value={l.descricao}
                              onChange={e => setLinha(l.idx, { descricao: e.target.value })}
                              className="w-full min-w-[160px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[15px] text-gray-300 outline-none"
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
                              className="w-[90px] bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1.5 py-0.5 text-[15px] text-right outline-none"
                              style={{ color: l.tipo === 'RECEITA' ? '#00c896' : '#ff6b4a' }}
                            />
                          </td>

                          {/* Status — editável via select */}
                          <td className="px-1 py-1">
                            <select
                              value={l.status}
                              onChange={e => setLinha(l.idx, { status: e.target.value })}
                              className="bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1 py-0.5 text-[15px] outline-none"
                              style={{
                                background: '#1a1f2e',
                                color: l.status === 'PROJECAO' ? '#a78bfa' : '#f0b429',
                              }}
                            >
                              <option value="PENDENTE">Pendente</option>
                              <option value="PROJECAO">Projeção</option>
                            </select>
                          </td>

                          {/* Conta — editável via select */}
                          <td className="px-1 py-1">
                            <select
                              value={contas.find((c: Conta) => normalizarNome(c.nome) === normalizarNome(l.conta_nome))?.conta_id ?? ''}
                              onChange={e => {
                                const conta = contas.find((c: Conta) => c.conta_id === e.target.value)
                                if (conta) setLinha(l.idx, { conta_nome: conta.nome })
                              }}
                              className="bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1 py-0.5 text-[15px] text-gray-300 outline-none max-w-[130px]"
                              style={{ background: '#1a1f2e' }}
                            >
                              <option value="">— selecionar —</option>
                              {contas.map((c: Conta) => <option key={c.conta_id} value={c.conta_id}>{c.nome}</option>)}
                            </select>
                          </td>

                          {/* Categoria — editável via select */}
                          <td className="px-1 py-1">
                            <select
                              value={categorias.find(c => normalizarNome(c.descricao) === normalizarNome(l.categoria_nome))?.id ?? ''}
                              onChange={e => {
                                const cat = categorias.find(c => c.id === e.target.value)
                                if (cat) setLinha(l.idx, { categoria_nome: cat.descricao })
                              }}
                              className="bg-transparent border border-transparent hover:border-white/10 focus:border-white/20 rounded px-1 py-0.5 text-[15px] text-gray-300 outline-none max-w-[140px]"
                              style={{ background: '#1a1f2e' }}
                            >
                              <option value="">— selecionar —</option>
                              {categorias.map(c => <option key={c.id} value={c.id}>{c.descricao}</option>)}
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
              <p className="text-[15px] text-amber-400 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2">
                ⚠️ Selecione o destino para todas as entidades marcadas como "Usar existente"
              </p>
            )}

            <div className="flex gap-2">
              <button onClick={resetar}
                className="px-4 py-2 rounded-lg text-[17px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
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

        {/* ── ANALISANDO ── */}
        {etapa === 'analisando' && (
          <div className="space-y-4">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-blue-400" />
                <span className="text-[17px] font-semibold" style={{ color: '#4da6ff' }}>
                  Analisando arquivo...
                </span>
              </div>
              <span className="text-[16px] font-bold" style={{ color: '#4da6ff' }}>
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
                    ? '#4da6ff'
                    : progresso < 70
                    ? '#3b82f6'
                    : '#2563eb',
                }}
              />
            </div>

            {/* Métricas */}
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Linhas', value: `${progressoInfo.atual} / ${progressoInfo.total}`, color: '#e8eaf0' },
                { label: 'Status', value: 'Analisando...', color: '#4da6ff' },
                { label: 'Velocidade', value: progressoInfo.velocidade || '...', color: '#4da6ff' },
                { label: 'ETA', value: progressoInfo.eta || '...', color: '#8b92a8' },
              ].map((m, i) => (
                <div key={i} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2 text-center">
                  <p className="text-[14px] uppercase tracking-wide mb-0.5" style={{ color: '#8b92a8' }}>{m.label}</p>
                  <p className="text-[17px] font-bold" style={{ color: m.color }}>{m.value}</p>
                </div>
              ))}
            </div>

            {/* Mensagem informativa */}
            <div className="bg-blue-400/5 border border-blue-400/20 rounded-lg p-3">
              <p className="text-[15px] text-blue-400">
                📊 Processando arquivo em blocos para melhor performance. A interface permanecerá responsiva.
              </p>
            </div>

            <button
              onClick={cancelar}
              className="w-full py-2 rounded-lg text-[16px] font-semibold transition-colors"
              style={{ background: 'rgba(255,107,74,0.1)', color: '#ff6b4a', border: '1px solid rgba(255,107,74,0.3)' }}
            >
              <X size={12} className="inline mr-1" /> Cancelar análise
            </button>
          </div>
        )}

        {/* ── IMPORTANDO ── */}
        {etapa === 'importando' && (
          <div className="space-y-4">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Loader2 size={16} className="animate-spin text-purple-400" />
                <span className="text-[17px] font-semibold" style={{ color: '#a78bfa' }}>
                  Importando lançamentos...
                </span>
              </div>
              <span className="text-[16px] font-bold" style={{ color: '#a78bfa' }}>
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
                  <p className="text-[14px] uppercase tracking-wide mb-0.5" style={{ color: '#8b92a8' }}>{m.label}</p>
                  <p className="text-[17px] font-bold" style={{ color: m.color }}>{m.value}</p>
                </div>
              ))}
            </div>

            {/* ETA */}
            {progressoInfo.eta && progressoInfo.eta !== '...' && (
              <p className="text-[15px] text-center" style={{ color: '#8b92a8' }}>
                Tempo restante estimado: <span style={{ color: '#e8eaf0' }}>{progressoInfo.eta}</span>
              </p>
            )}

            {/* Log em tempo real */}
            {logTempoReal.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-2.5 max-h-[140px] overflow-y-auto space-y-1">
                {logTempoReal.slice().reverse().map((l, i) => (
                  <div key={i} className="flex items-start gap-1.5 text-[15px]">
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

            <button
              onClick={cancelar}
              className="w-full py-2 rounded-lg text-[16px] font-semibold transition-colors"
              style={{ background: 'rgba(255,107,74,0.1)', color: '#ff6b4a', border: '1px solid rgba(255,107,74,0.3)' }}
            >
              <X size={12} className="inline mr-1" /> Cancelar importação
            </button>
          </div>
        )}

        {/* ── CONCLUÍDO ── */}
        {etapa === 'concluido' && (
          <div className="space-y-3">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-1.5">
              {log.map((l, i) => (
                <div key={i} className="flex items-start gap-2 text-[16px]">
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

      // 3. Transações — paginação sem filtro de mês para garantir completude
      addLog('ok', 'Buscando transações...')
      const txMap = new Map<string, TransacaoRaw>()
      let txPage = 1
      while (true) {
        const r = await apiFetch(`/transacoes?per_page=1000&page=${txPage}`)
        const pagina = extrairLista<TransacaoRaw>(r.dados)
        pagina.forEach((t: TransacaoRaw) => { if (t.id) txMap.set(String(t.id), t) })
        if (pagina.length < 1000) break
        txPage++
        addLog('ok', `Buscando transações... ${txMap.size} encontradas`)
      }
      const transacoes = [...txMap.values()].filter(
        (t: TransacaoRaw) => !t.id_par_transferencia && !t.descricao?.startsWith('[Transf.')
      )
      addLog('ok', `Transações: ${transacoes.length} registros`)

      // 4. Transferências — paginação sem filtro de mês
      addLog('ok', 'Buscando transferências...')
      const hoje = new Date()
      const meses: string[] = []
      for (let i = 60; i >= -24; i--) {
        const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
        meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
      }
      const resTrfArr = await Promise.all(
        meses.map(mes => apiFetch(`/transferencias?mes=${mes}`))
      )
      const todasTrf = resTrfArr.flatMap(r => extrairLista<TransacaoRaw>(r))
      const trfMap = new Map(todasTrf.map((t: TransacaoRaw) => [t.id_par, t]))
      const transferencias = [...trfMap.values()]
      addLog('ok', `Transferências: ${transferencias.length} registros`)

      // 5. Investimentos (ativos, posições, operações, dividendos, histórico, tipos, alocações)
      addLog('ok', 'Buscando investimentos...')
      const [rAtivos, rPos, rOps, rDiv, rHist, rTipos, rAloc] = await Promise.all([
        apiFetch('/investimentos/ativos'),
        apiFetch('/investimentos/posicoes'),
        apiFetch('/investimentos/operacoes'),
        apiFetch('/investimentos/dividendos'),
        apiFetch('/investimentos/historico-mensal'),
        apiFetch('/investimentos/tipos-dividendo'),
        apiFetch('/investimentos/alocacoes'),
      ])
      const investimentos: InvestimentosBackup = {
        ativos:          extrairLista<Record<string, unknown>>(rAtivos.dados),
        posicoes:        extrairLista<Record<string, unknown>>(rPos.dados),
        operacoes:       extrairLista<Record<string, unknown>>(rOps.dados),
        dividendos:      extrairLista<Record<string, unknown>>(rDiv.dados),
        historico:       extrairLista<Record<string, unknown>>(rHist.dados),
        tipos_dividendo: extrairLista<Record<string, unknown>>(rTipos.dados),
        alocacoes:       extrairLista<Record<string, unknown>>(rAloc.dados),
      }
      addLog('ok', `Investimentos: ${investimentos.ativos.length} ativos, ${investimentos.posicoes.length} posições, ${investimentos.operacoes.length} operações, ${investimentos.dividendos.length} dividendos`)

      // 6. Lembretes (avulsos e vinculados a lançamentos)
      addLog('ok', 'Buscando lembretes...')
      const rLemb = await apiFetch('/lembretes')
      const lembretes = extrairLista<LembreteBackup>(rLemb.dados)
      addLog('ok', `Lembretes: ${lembretes.length} registros`)

      // 7. Objetivos (metas / sonhos / projetos)
      addLog('ok', 'Buscando objetivos...')
      const rObj = await apiFetch('/objetivos')
      const objetivos = extrairLista<ObjetivoBackup>(rObj.dados).map((o) => ({
        id: o.id, tipo: o.tipo, nome: o.nome, descricao: o.descricao ?? null,
        icone: o.icone, cor: o.cor, ativo: o.ativo,
        valor_meta: o.valor_meta, data_inicio: o.data_inicio, data_fim: o.data_fim,
        conta_id: o.conta_id ?? null, categoria_id: o.categoria_id ?? null,
        frequencia: o.frequencia ?? null,
        contas_sonho: o.contas_sonho ?? [], contas_projeto: o.contas_projeto ?? [],
        categorias_objetivo: o.categorias_objetivo ?? [],
      }))
      addLog('ok', `Objetivos: ${objetivos.length} registros`)

      // Montar payload
      const payload = {
        gerado_em: new Date().toISOString(),
        versao: '1.3',
        contas,
        categorias,
        transacoes,
        transferencias,
        investimentos,
        lembretes,
        objetivos,
      }

      // Download do JSON
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `arqvalor_backup_${hojeLocal()}.json`
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
    <Section titulo="Backup completo" subtitulo="Salva todos os dados em um arquivo JSON" icon={Save} cor="#4da6ff" defaultOpen={false}>
      <div className="space-y-3">
        <div className="bg-blue-400/5 border border-blue-400/20 rounded-lg p-4">
          <p className="text-[16px] font-semibold text-blue-400 mb-2">O backup inclui:</p>
          <ul className="space-y-1">
            {[
              'Todas as contas (ativas e inativas)',
              'Todas as categorias (com hierarquia)',
              'Todas as transações (sem limite de período)',
              'Todas as transferências',
              'Investimentos (ativos, posições, operações, dividendos, histórico)',
              'Lembretes (avulsos e vinculados a lançamentos)',
              'Objetivos (metas, sonhos e projetos)',
            ].map((item, i) => (
              <li key={i} className="flex items-center gap-2 text-[16px] text-gray-400">
                <CheckCircle2 size={12} className="text-blue-400 flex-shrink-0" />
                {item}
              </li>
            ))}
          </ul>
          <p className="text-[15px] text-blue-400/60 mt-3">O arquivo JSON gerado pode ser usado para restaurar os dados via Restore.</p>
        </div>

        {log.length > 0 && (
          <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 space-y-1.5">
            {log.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[16px]">
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
  const qc = useQueryClient()
  const { contas } = useContas()
  const { categorias } = useCategorias()
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [etapa, setEtapa] = useState<'idle' | 'confirmando' | 'restaurando' | 'concluido'>('idle')
  const [payload, setPayload] = useState<BackupPayload | null>(null)
  const [escopo, setEscopo] = useState<'tudo' | 'extrato' | 'investimentos' | 'lembretes' | 'objetivos'>('tudo')
  const [progresso, setProgresso] = useState(0)
  const [progressoLabel, setProgressoLabel] = useState('')
  const [log, setLog] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; msg: string }[]>([])
  const canceladoRef = useRef(false)
  const cancelar = () => { canceladoRef.current = true }

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
    canceladoRef.current = false
    const logs: typeof log = []
    const addLog = (tipo: 'ok' | 'erro' | 'aviso', msg: string) => { logs.push({ tipo, msg }); setLog([...logs]) }

    const fazExtrato    = escopo === 'tudo' || escopo === 'extrato'
    const fazInvest     = escopo === 'tudo' || escopo === 'investimentos'
    const fazLembretes  = escopo === 'tudo' || escopo === 'lembretes'
    const fazObjetivos  = escopo === 'tudo' || escopo === 'objetivos'
    const criaFaltantes = escopo === 'tudo'   // só "Tudo" cria contas/categorias novas
    const mapaContas:       Record<string, string> = {}
    const mapaCategorias:   Record<string, string> = {}
    const contasReativadas: string[]               = []

    // Chaves de deduplicação — o restore NÃO recria o que já existe.
    const normDesc = (s?: string | null) => normalizarNome(String(s ?? ''))
    const txKey = (data: string, valor: unknown, tipo: string, descricao?: string | null, contaId?: string) =>
      `${data}|${Number(valor)}|${tipo}|${normDesc(descricao)}|${contaId ?? ''}`
    const trfKey = (data: string, valor: unknown, origem?: string, destino?: string) =>
      `${data}|${Number(valor)}|${origem ?? ''}|${destino ?? ''}`

    try {
      if (!payload) throw new Error('Backup não carregado')
      const { contas: cntBackup, categorias: catBackup, transacoes: txBackup, transferencias: trfBackup } = payload

      // ── 1. Contas — mapeia existentes; cria as faltantes só no modo "Tudo" ──
      setProgressoLabel('Conferindo contas...')
      let criadasCnt = 0
      for (const c of cntBackup) {
        if (canceladoRef.current) break
        const existente = contas.find(x => normalizarNome(x.nome) === normalizarNome(c.nome) && x.tipo === c.tipo)
        if (existente) {
          mapaContas[c.conta_id] = existente.conta_id
          // Só reativa conta inativa quando o restore vai escrever no extrato
          // (lançamentos exigem conta ativa). Restore de lembretes/investimentos
          // não mexe nas contas — apenas mapeia para relink.
          if (!existente.ativa && fazExtrato) {
            const r = await apiComRetry(`/contas/${existente.conta_id}`, 'PUT', { ativa: true })
            if (r.ok) { contasReativadas.push(existente.conta_id); addLog('aviso', `Conta "${c.nome}" estava inativa — reativada temporariamente.`) }
            else addLog('erro', `Não foi possível reativar conta "${c.nome}": ${r.erro}`)
          }
        } else if (criaFaltantes) {
          const r = await apiComRetry('/contas', 'POST', {
            nome: c.nome, tipo: c.tipo, saldo_inicial: c.saldo_inicial ?? 0,
            icone: c.icone, cor: c.cor, ativa: c.ativa,
          })
          if (r.ok && (r.dados as { conta_id?: string } | null)?.conta_id) { mapaContas[c.conta_id] = (r.dados as { conta_id: string }).conta_id; criadasCnt++ }
          else addLog('erro', `Conta "${c.nome}": ${r.erro}`)
          await _sleep(60)
        }
        // sem criar + inexistente → não mapeia (itens dessa conta serão pulados)
      }
      addLog('ok', criaFaltantes
        ? `Contas: ${criadasCnt} criadas, ${cntBackup.length - criadasCnt} já existiam`
        : `Contas reconhecidas: ${Object.keys(mapaContas).length}`)

      // ── 2. Categorias — idem (cria faltantes só no modo "Tudo") ──
      setProgressoLabel('Conferindo categorias...')
      for (const c of catBackup.filter((x: CategoriaBackup) => x.protegida)) {
        const ex = categorias.find(x => normalizarNome(x.descricao) === normalizarNome(c.descricao) && x.protegida)
        if (ex) mapaCategorias[c.id] = ex.id
      }
      let criadasCat = 0
      const pais   = catBackup.filter((c: CategoriaBackup) => !c.id_pai && !c.protegida)
      const filhos = catBackup.filter((c: CategoriaBackup) => !!c.id_pai && !c.protegida)
      for (const c of pais) {
        const ex = categorias.find(x => normalizarNome(x.descricao) === normalizarNome(c.descricao) && !x.id_pai)
        if (ex) { mapaCategorias[c.id] = ex.id; continue }
        if (!criaFaltantes) continue
        const r = await apiComRetry('/categorias', 'POST', { descricao: c.descricao, tipo: c.tipo, icone: c.icone, cor: c.cor })
        if (r.ok && (r.dados as { id?: string } | null)?.id) { mapaCategorias[c.id] = (r.dados as { id: string }).id; criadasCat++ }
        else addLog('erro', `Categoria "${c.descricao}": ${r.erro}`)
        await _sleep(60)
      }
      for (const c of filhos) {
        const novoIdPai = mapaCategorias[c.id_pai ?? '']
        const ex = categorias.find(x => normalizarNome(x.descricao) === normalizarNome(c.descricao) && (novoIdPai ? x.id_pai === novoIdPai : !!x.id_pai))
        if (ex) { mapaCategorias[c.id] = ex.id; continue }
        if (!criaFaltantes) continue
        if (!novoIdPai) { addLog('aviso', `Subcategoria "${c.descricao}": pai não encontrado`); continue }
        const r = await apiComRetry('/categorias', 'POST', { descricao: c.descricao, tipo: c.tipo, icone: c.icone, cor: c.cor, id_pai: novoIdPai })
        if (r.ok && (r.dados as { id?: string } | null)?.id) { mapaCategorias[c.id] = (r.dados as { id: string }).id; criadasCat++ }
        else addLog('erro', `Subcategoria "${c.descricao}": ${r.erro}`)
        await _sleep(60)
      }
      if (criaFaltantes) addLog('ok', `Categorias: ${criadasCat} criadas`)

      // ── 3. Mapas de dedup / relink (lançamentos e transferências) ──
      const txIdPorKey    = new Map<string, string>()   // chave → id (existentes + criadas)
      const keyPorOldTxId = new Map<string, string>()   // id antigo (backup) → chave
      if (fazExtrato || fazLembretes) {
        setProgressoLabel('Verificando lançamentos já existentes...')
        for (let page = 1; ; page++) {
          if (canceladoRef.current) break
          const r = await apiFetch(`/transacoes?per_page=1000&page=${page}`)
          const pag = extrairLista<TransacaoRaw>(r.dados)
          for (const t of pag) { const k = txKey(t.data, t.valor, t.tipo, t.descricao, t.conta_id); if (t.id && !txIdPorKey.has(k)) txIdPorKey.set(k, String(t.id)) }
          if (pag.length < 1000) break
        }
        // chave de cada lançamento do backup pelo seu id antigo (p/ relink de lembretes)
        for (const t of txBackup) {
          const conta_id = mapaContas[t.conta_id ?? '']
          if (t.id && conta_id) keyPorOldTxId.set(String(t.id), txKey(t.data, t.valor, t.tipo, t.descricao, conta_id))
        }
      }

      const existentesTrf = new Set<string>()
      if (fazExtrato) {
        const mesesTrf: string[] = []
        const hoje = new Date()
        for (let i = 60; i >= -24; i--) { const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1); mesesTrf.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`) }
        const resTrfEx = await Promise.all(mesesTrf.map(m => apiFetch(`/transferencias?mes=${m}`)))
        for (const r of resTrfEx) {
          for (const t of extrairLista<TransacaoRaw>(r.dados ?? r)) {
            const origem = (t.conta_origem_id ?? t.conta_id) as string | undefined
            existentesTrf.add(trfKey(t.data, t.valor, origem, t.conta_destino_id as string | undefined))
          }
        }
      }

      // ── 4. Filtra do backup o que falta (só extrato) ──
      let dupTx = 0, semContaTx = 0
      const txParaCriar = !fazExtrato ? [] : [...txBackup]
        .sort((a, b) => a.data.localeCompare(b.data))
        .filter((t) => {
          const conta_id = mapaContas[t.conta_id ?? '']
          if (!conta_id) { semContaTx++; return false }
          const k = txKey(t.data, t.valor, t.tipo, t.descricao, conta_id)
          if (txIdPorKey.has(k)) { dupTx++; return false }
          txIdPorKey.set(k, '')   // reserva (id preenchido após criar)
          return true
        })

      let dupTrf = 0, semContaTrf = 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const trfParaCriar: any[] = []
      if (fazExtrato && trfBackup && trfBackup.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const parsUnicos = new Map<string, any>()
        for (const t of trfBackup) { const parId = (t.id_par ?? t.id_recorrencia) as string | undefined; if (parId && !parsUnicos.has(parId)) parsUnicos.set(parId, t) }
        for (const t of parsUnicos.values()) {
          const origem  = mapaContas[t.conta_origem_id ?? t.conta_id]
          const destino = mapaContas[t.conta_destino_id]
          if (!origem || !destino) { semContaTrf++; continue }
          const k = trfKey(t.data, t.valor, origem, destino)
          if (existentesTrf.has(k)) { dupTrf++; continue }
          existentesTrf.add(k)
          trfParaCriar.push({ ...t, _origem: origem, _destino: destino })
        }
      }

      const lembEstimate = fazLembretes ? (payload.lembretes?.length ?? 0) : 0
      const totalPassos = Math.max(1, txParaCriar.length + trfParaCriar.length + lembEstimate)
      let passo = 0
      const avanco = () => { passo++; setProgresso(Math.round((passo / totalPassos) * 100)) }

      // ── 5. Cria só os lançamentos que faltam (registra id p/ relink) ──
      if (txParaCriar.length > 0) {
        setProgressoLabel(`Restaurando ${txParaCriar.length} lançamento(s)...`)
        let okTx = 0, errTx = 0
        const chunks = dividirEmChunks(txParaCriar, 8)
        const proc = async (chunk: TransacaoRaw[]) => {
          for (const t of chunk) {
            if (canceladoRef.current) break
            const conta_id     = mapaContas[t.conta_id ?? '']
            const categoria_id = t.categoria_id ? mapaCategorias[t.categoria_id] : undefined
            const r = await apiComRetry('/transacoes', 'POST', {
              tipo: t.tipo, data: t.data, descricao: t.descricao, valor: t.valor,
              conta_id, categoria_id, status: t.status, observacao: t.observacao,
            })
            if (r.ok) { okTx++; const nid = (r.dados as { id?: string } | null)?.id; if (nid) txIdPorKey.set(txKey(t.data, t.valor, t.tipo, t.descricao, conta_id), String(nid)) }
            else { addLog('erro', `"${t.descricao}" (${t.data}): ${r.erro}`); errTx++ }
            avanco()
          }
        }
        await Promise.all(chunks.map(proc))
        addLog('ok', `Lançamentos: ${okTx} restaurado(s), ${dupTx} já existia(m)${semContaTx ? `, ${semContaTx} sem conta` : ''}${errTx ? `, ${errTx} erro(s)` : ''}`)
      }

      // ── 6. Cria só as transferências que faltam ──
      if (trfParaCriar.length > 0) {
        setProgressoLabel(`Restaurando ${trfParaCriar.length} transferência(s)...`)
        let okTrf = 0, errTrf = 0
        const tchunks = dividirEmChunks(trfParaCriar, 8)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ptrf = async (chunk: any[]) => {
          for (const t of chunk) {
            if (canceladoRef.current) break
            const r = await apiComRetry('/transferencias', 'POST', {
              conta_origem_id: t._origem, conta_destino_id: t._destino,
              valor: t.valor, data: t.data, descricao: t.descricao, status: t.status,
            })
            if (r.ok) okTrf++; else { addLog('erro', `Transferência "${t.descricao}" (${t.data}): ${r.erro}`); errTrf++ }
            avanco()
          }
        }
        await Promise.all(tchunks.map(ptrf))
        addLog('ok', `Transferências: ${okTrf} restaurada(s), ${dupTrf} já existia(m)${semContaTrf ? `, ${semContaTrf} sem conta` : ''}${errTrf ? `, ${errTrf} erro(s)` : ''}`)
      }

      // ── 7. Lembretes (relink ao lançamento; dedup por data+descrição+vínculo) ──
      if (fazLembretes && payload.lembretes && payload.lembretes.length > 0) {
        setProgressoLabel('Restaurando lembretes...')
        const lembKey = (data: string, desc: string, lanc?: string | null) => `${data}|${normDesc(desc)}|${lanc ?? ''}`
        const existentesLemb = new Set<string>()
        const rLembEx = await apiFetch('/lembretes')
        for (const l of extrairLista<LembreteBackup>(rLembEx.dados)) existentesLemb.add(lembKey(String(l.data), String(l.descricao), (l.lancamento_id as string | null) ?? null))
        let okL = 0, errL = 0, semVinculo = 0
        for (const l of payload.lembretes) {
          if (canceladoRef.current) break
          const novoLanc = l.lancamento_id ? (txIdPorKey.get(keyPorOldTxId.get(String(l.lancamento_id)) ?? '') || null) : null
          const k = lembKey(String(l.data), String(l.descricao), novoLanc)
          if (existentesLemb.has(k)) { avanco(); continue }
          existentesLemb.add(k)
          if (l.lancamento_id && !novoLanc) semVinculo++
          const r = await apiComRetry('/lembretes', 'POST', { data: l.data, descricao: l.descricao, lancamento_id: novoLanc })
          if (r.ok) {
            okL++
            if (l.status === 'CONCLUIDO') { const id = (r.dados as { id?: string } | null)?.id; if (id) await apiComRetry(`/lembretes/${id}`, 'PUT', { status: 'CONCLUIDO' }) }
          } else { addLog('erro', `Lembrete "${l.descricao}": ${r.erro}`); errL++ }
          avanco()
        }
        addLog('ok', `Lembretes: ${okL} restaurado(s)${semVinculo ? `, ${semVinculo} sem vínculo (viraram avulsos)` : ''}${errL ? `, ${errL} erro(s)` : ''}`)
        qc.invalidateQueries({ queryKey: ['lembretes'] })
      }

      // "Nada novo" só quando realmente não há mais nada a processar — os
      // blocos de investimentos e objetivos rodam depois e logam por conta.
      const haInvest    = fazInvest && !!payload.investimentos
      const haObjetivos = fazObjetivos && !!payload.objetivos?.length
      if (passo === 0 && !haInvest && !haObjetivos) {
        addLog('ok', 'Nada novo a restaurar — os itens do backup já estão presentes.')
        setProgresso(100)
      }

      // ── 8. Investimentos (modos "Tudo" e "Somente investimentos") ──
      if (fazInvest && payload.investimentos) {
        setProgressoLabel('Restaurando investimentos...')
        const inv = payload.investimentos
        const res = await apiMutate('/investimentos/restaurar', 'POST', {
          conta_map: mapaContas,
          categoria_map: mapaCategorias,
          ativos: inv.ativos, posicoes: inv.posicoes, operacoes: inv.operacoes,
          dividendos: inv.dividendos, historico: inv.historico,
          tipos_dividendo: inv.tipos_dividendo, alocacoes: inv.alocacoes,
        })
        if (res.ok) {
          const d = res.dados as { ativos?: number; posicoes?: number; operacoes?: number; dividendos?: number; historico?: number; avisos?: string[] } | null
          addLog('ok', `Investimentos: ${d?.ativos ?? 0} ativos, ${d?.posicoes ?? 0} posições, ${d?.operacoes ?? 0} operações, ${d?.dividendos ?? 0} dividendos, ${d?.historico ?? 0} snapshots restaurados`)
          for (const a of d?.avisos ?? []) addLog('aviso', a)
          for (const k of [['inv-ativos'], ['inv-posicoes'], ['inv-operacoes'], ['inv-dividendos'], ['inv-historico'], ['inv-dashboard'], ['inv-ranking'], ['inv-tipos-dividendo'], ['inv-alocacoes']]) {
            qc.invalidateQueries({ queryKey: k })
          }
        } else addLog('erro', `Investimentos: ${res.erro}`)
      }

      // ── 9. Objetivos (modo "Tudo") — remapeia conta/categoria e recria ──
      if (fazObjetivos && payload.objetivos && payload.objetivos.length > 0) {
        setProgressoLabel('Restaurando objetivos...')
        const objKey = (tipo: string, nome: string, ini: string, fim: string) =>
          `${tipo}|${normalizarNome(nome)}|${ini}|${fim}`
        const rObjEx = await apiFetch('/objetivos')
        const existentesObj = new Set<string>()
        for (const o of extrairLista<ObjetivoBackup>(rObjEx.dados))
          existentesObj.add(objKey(String(o.tipo), String(o.nome), String(o.data_inicio), String(o.data_fim)))

        const mapArr = (arr: string[] | undefined, m: Record<string, string>) =>
          (arr ?? []).map((x) => m[x]).filter(Boolean)

        let okO = 0, dupO = 0, errO = 0
        for (const o of payload.objetivos) {
          if (canceladoRef.current) break
          if (existentesObj.has(objKey(o.tipo, o.nome, o.data_inicio, o.data_fim))) { dupO++; continue }
          const r = await apiComRetry('/objetivos', 'POST', {
            tipo: o.tipo, nome: o.nome, descricao: o.descricao ?? null,
            icone: o.icone, cor: o.cor,
            valor_meta: o.valor_meta, data_inicio: o.data_inicio, data_fim: o.data_fim,
            conta_id: (o.conta_id && mapaContas[o.conta_id]) || null,
            categoria_id: (o.categoria_id && mapaCategorias[o.categoria_id]) || null,
            frequencia: o.frequencia ?? null,
            contas_sonho: mapArr(o.contas_sonho, mapaContas),
            contas_projeto: mapArr(o.contas_projeto, mapaContas),
            categorias_objetivo: mapArr(o.categorias_objetivo, mapaCategorias),
          })
          if (r.ok) {
            okO++
            const novoId = (r.dados as { id?: string } | null)?.id
            if (novoId && o.ativo === false) await apiComRetry(`/objetivos/${novoId}`, 'PUT', { ativo: false })
          } else { errO++; addLog('erro', `Objetivo "${o.nome}": ${r.erro}`) }
          await _sleep(60)
        }
        addLog('ok', `Objetivos: ${okO} restaurado(s), ${dupO} já existia(m)${errO ? `, ${errO} erro(s)` : ''}`)
        qc.invalidateQueries({ queryKey: ['objetivos'] })
      }

      setProgressoLabel('Concluído!')
      setProgresso(100)
    } catch (e) {
      addLog('erro', `Erro inesperado: ${(e as Error).message}`)
    } finally {
      // Desativar contas que foram reativadas temporariamente
      if (contasReativadas.length > 0) {
        setProgressoLabel('Restaurando estado das contas...')
        for (const contaId of contasReativadas) await apiComRetry(`/contas/${contaId}`, 'PUT', { ativa: false })
        addLog('ok', `${contasReativadas.length} conta(s) devolvida(s) ao estado inativo.`)
      }
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
            <p className="text-[18px] font-semibold mb-1" style={{ color: dragOver ? '#f0b429' : '#d1d5db' }}>
              {dragOver ? 'Solte o arquivo aqui' : 'Arraste o arquivo de backup ou clique para selecionar'}
            </p>
            <p className="text-[15px] text-gray-400 mb-4">Somente arquivos .json gerados pelo Arquiteto de Valor</p>
            <button
              onClick={e => { e.stopPropagation(); inputRef.current?.click() }}
              className="px-5 py-2 rounded-lg text-[17px] font-semibold transition-colors"
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
              <p className="text-[16px] font-semibold text-amber-400 mb-3">Arquivo de backup carregado</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  ['Gerado em', new Date(payload.gerado_em).toLocaleString('pt-BR')],
                  ['Contas', payload.contas?.length ?? 0],
                  ['Categorias', payload.categorias?.length ?? 0],
                  ['Transações', payload.transacoes?.length ?? 0],
                  ['Transferências', payload.transferencias?.length ?? 0],
                  ['Investim. (ativos)', payload.investimentos?.ativos?.length ?? 0],
                  ['Lembretes', payload.lembretes?.length ?? 0],
                ].map(([k, v]) => (
                  <div key={String(k)} className="flex items-center justify-between bg-white/5 rounded-lg px-3 py-2">
                    <span className="text-[15px] text-gray-400">{k}</span>
                    <span className="text-[16px] font-semibold text-amber-400">{String(v)}</span>
                  </div>
                ))}
              </div>
              <p className="text-[15px] text-amber-400/70 mt-3">
                ⚠️ Dados já existentes não serão duplicados — o restore verifica antes de criar.
              </p>
            </div>

            {/* Escopo do restore */}
            <div>
              <p className="text-[15px] font-semibold text-gray-400 uppercase tracking-wide mb-2">O que restaurar?</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {[
                  { v: 'tudo'          as const, t: 'Tudo',                  d: 'Contas, categorias, extrato, investimentos e lembretes (cria o que faltar).' },
                  { v: 'extrato'       as const, t: 'Somente extrato',       d: 'Só transações e transferências. Contas/categorias apenas reconhecidas.' },
                  { v: 'investimentos' as const, t: 'Somente investimentos', d: 'Ativos, posições, operações, dividendos, histórico (nas contas existentes).' },
                  { v: 'lembretes'     as const, t: 'Somente lembretes',     d: 'Lembretes avulsos e os vinculados a lançamentos que já existam.' },
                  { v: 'objetivos'     as const, t: 'Somente objetivos',     d: 'Metas, sonhos e projetos (religados às contas/categorias existentes).' },
                ].map(op => (
                  <button key={op.v} onClick={() => setEscopo(op.v)}
                    className="text-left p-3 rounded-lg border transition-all"
                    style={{
                      background: escopo === op.v ? '#f0b42915' : 'transparent',
                      borderColor: escopo === op.v ? '#f0b42960' : 'rgba(255,255,255,0.08)',
                    }}>
                    <span className="text-[16px] font-semibold" style={{ color: escopo === op.v ? '#f0b429' : '#8b92a8' }}>{op.t}</span>
                    <p className="text-[14px] text-gray-400 mt-0.5">{op.d}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex gap-2">
              <button onClick={resetar}
                className="px-4 py-2 rounded-lg text-[17px] font-semibold text-gray-500 bg-gray-100 dark:bg-gray-700 transition-colors">
                Cancelar
              </button>
              <Btn onClick={executarRestore} cor="#f0b429">
                <RotateCcw size={14} /> {escopo === 'tudo' ? 'Iniciar restore'
                  : escopo === 'extrato' ? 'Restaurar extrato'
                  : escopo === 'investimentos' ? 'Restaurar investimentos'
                  : escopo === 'objetivos' ? 'Restaurar objetivos'
                  : 'Restaurar lembretes'}
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
                <p className="text-[17px] text-gray-300">{progressoLabel}</p>
              </div>
              <span className="text-[16px] font-semibold text-amber-400">{progresso}%</span>
            </div>
            <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
              <div className="h-full bg-amber-400 rounded-full transition-all duration-300" style={{ width: `${progresso}%` }} />
            </div>
            {log.length > 0 && (
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-[160px] overflow-y-auto space-y-1">
                {log.map((l, i) => (
                  <div key={i} className="flex items-center gap-2 text-[15px]">
                    {l.tipo === 'ok' ? <CheckCircle2 size={11} className="text-av-green flex-shrink-0" />
                      : l.tipo === 'aviso' ? <AlertTriangle size={11} className="text-amber-400 flex-shrink-0" />
                      : <X size={11} className="text-red-400 flex-shrink-0" />}
                    <span style={{ color: l.tipo === 'ok' ? '#00c896' : l.tipo === 'aviso' ? '#f0b429' : '#f87171' }}>{l.msg}</span>
                  </div>
                ))}
              </div>
            )}
            <button
              onClick={cancelar}
              className="w-full py-2 rounded-lg text-[16px] font-semibold transition-colors"
              style={{ background: 'rgba(255,107,74,0.1)', color: '#ff6b4a', border: '1px solid rgba(255,107,74,0.3)' }}
            >
              <X size={12} className="inline mr-1" /> Cancelar restore
            </button>
          </div>
        )}

        {/* CONCLUÍDO */}
        {etapa === 'concluido' && (
          <div className="space-y-3">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-1.5">
              {log.map((l, i) => (
                <div key={i} className="flex items-start gap-2 text-[16px]">
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
// SEÇÃO — COTAÇÃO DO DÓLAR (PTAX)
// ══════════════════════════════════════════════════════════════════
function SecaoCotacaoDolar() {
  const qc = useQueryClient()
  const [data, setData] = useState(hojeLocal())
  const { atual, atualData, taxaEm } = usePtax([data])
  const [sincronizando, setSincronizando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const fmtTaxa = (v: number | null) =>
    v == null ? '—' : `R$ ${v.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 })}`
  const fmtData = (d?: string | null) => (d ? d.split('-').reverse().join('/') : '')

  const taxaData = taxaEm(data)
  const estimada = !!atualData && data > atualData   // data futura/hoje ainda sem PTAX publicado

  const sincronizar = async () => {
    setSincronizando(true); setMsg(null)
    const res = await apiMutate<{ inseridos: number; desde: string; ate: string }>('/investimentos/ptax', 'POST')
    setSincronizando(false)
    if (res.ok) {
      setMsg(`Sincronizado: ${(res.dados as { inseridos?: number } | null)?.inseridos ?? 0} cotação(ões) atualizada(s).`)
      qc.invalidateQueries({ queryKey: ['ptax'] })
    } else setMsg(`Erro: ${res.erro}`)
  }

  return (
    <Section titulo="Cotação do dólar (PTAX)" subtitulo="Consulta o dólar de referência do Banco Central (USD → BRL)" icon={DollarSign} cor="#10b981" defaultOpen>
      <div className="space-y-4">
        {/* Cotação mais recente */}
        <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
          <p className="text-[14px] text-gray-400">Cotação mais recente (PTAX de venda)</p>
          <p className="text-[22px] font-bold text-gray-800 dark:text-gray-100">{fmtTaxa(atual)}</p>
          {atualData && <p className="text-[13px] text-gray-400">Referente a {fmtData(atualData)}</p>}
        </div>

        {/* Consulta por data */}
        <div>
          <p className="text-[15px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Consultar por data</p>
          <div className="flex items-end gap-4 flex-wrap">
            <div>
              <p className="text-[14px] text-gray-400 mb-1">Data</p>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)}
                className="bg-[#1a1f2e] border border-white/10 rounded-lg px-3 py-2 text-[15px] text-gray-200 outline-none" />
            </div>
            <div>
              <p className="text-[14px] text-gray-400 mb-1">Cotação</p>
              <p className="text-[20px] font-bold text-gray-800 dark:text-gray-100">{fmtTaxa(taxaData)}</p>
            </div>
          </div>
          {estimada && (
            <p className="text-[13px] text-amber-400 mt-1.5">
              Data ainda sem PTAX publicado — exibindo a cotação do último dia útil (estimativa).
            </p>
          )}
          <p className="text-[13px] text-gray-400 mt-1">
            Fins de semana e feriados usam a cotação do último dia útil anterior.
          </p>
        </div>

        {/* Sincronizar */}
        <div className="flex items-center gap-3 flex-wrap">
          <Btn onClick={sincronizar} loading={sincronizando} cor="#10b981"><RefreshCw size={14} /> Sincronizar agora</Btn>
          {msg && <span className="text-[14px]" style={{ color: msg.startsWith('Erro') ? '#f87171' : '#10b981' }}>{msg}</span>}
        </div>
        <p className="text-[13px] text-gray-400">
          Histórico desde 01/01/2021, sincronizado automaticamente com o Banco Central. Usado para converter ativos em dólar.
        </p>
      </div>
    </Section>
  )
}

// ══════════════════════════════════════════════════════════════════
// PAGE PRINCIPAL
// ══════════════════════════════════════════════════════════════════
export default function ImportExportPage() {
  // Modo da importação vive aqui para o modo "investimentos" poder ocupar a
  // largura total (suas tabelas não cabem na metade da grade Export|Import).
  const [modoImport, setModoImport] = useState<ModoImport>(() => {
    const p = new URLSearchParams(window.location.search).get('import')
    return (['transacoes', 'contas', 'categorias', 'investimentos'] as const).includes(p as ModoImport)
      ? (p as ModoImport) : 'transacoes'
  })

  return (
    <div className="p-5 max-w-[1200px]">
      <div className="mb-5">
        <h1 className="text-[21px] font-bold text-gray-800 dark:text-gray-100">Gerenciar dados</h1>
        <p className="text-[16px] text-gray-400 mt-0.5">Importação, exportação, backup, cotação do dólar e limpeza de dados</p>
      </div>

      <div className="mb-4">
        <MascoteTutorial pagina="importexport" />
      </div>

      <div className="space-y-3">
        {/* Cotação do dólar (consulta PTAX) — em primeiro lugar */}
        <SecaoCotacaoDolar />

        {/* Linha 1 — Exportar | Importar (XLSX, uso humano).
            No modo "investimentos" a importação ocupa a largura total
            (tem tabelas largas que não cabem em meia tela). */}
        {modoImport === 'investimentos' ? (
          <SecaoImport modo={modoImport} setModo={setModoImport} />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
            <SecaoExport />
            <SecaoImport modo={modoImport} setModo={setModoImport} />
          </div>
        )}

        {/* Explicação Exportar vs Backup, em linguagem leiga.
            Posicionada entre as duas linhas para o usuário ler antes de
            decidir qual ferramenta usar. */}
        <div
          className="rounded-xl border px-4 py-3 text-[14px] leading-relaxed"
          style={{
            background:  'rgba(77,166,255,0.06)',
            borderColor: 'rgba(77,166,255,0.25)',
            color:       'var(--text-secondary)',
          }}
        >
          <p className="font-semibold mb-1.5" style={{ color: '#4da6ff' }}>
            Qual a diferença entre Exportar e Backup?
          </p>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>
              <strong>Exportar</strong> gera uma <strong>planilha Excel</strong>{' '}
              que você abre, lê, imprime, analisa e até manda pro seu contador.
              Você escolhe o período e o que quer levar (contas, categorias,
              transações, transferências). O <strong>Importar</strong> aceita
              essa mesma planilha de volta, ou outra parecida feita em outro
              sistema.
              <br/>
              <span className="text-gray-400">
                Pense assim: é o seu “relatório pra olhar fora do app”.
              </span>
            </li>
            <li>
              <strong>Backup</strong> gera uma <strong>cópia completa</strong>{' '}
              dos seus dados num arquivo único — sem você precisar escolher
              nada. Esse arquivo não foi feito pra você ler; ele serve só pra
              guardar e usar com o <strong>Restore</strong>, que devolve tudo
              ao app exatamente como estava.
              <br/>
              <span className="text-gray-400">
                Pense assim: é a “foto da sua conta inteira” pra um eventual
                imprevisto.
              </span>
            </li>
          </ul>
        </div>

        {/* Backup | Restore (JSON, salvaguarda) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
          <SecaoBackup />
          <SecaoRestore />
        </div>

        {/* Linha 3 — Limpar (full-width, compactado por ser destrutivo) */}
        <SecaoLimpeza />
      </div>
    </div>
  )
}
