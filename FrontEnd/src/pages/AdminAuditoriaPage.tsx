// src/pages/AdminAuditoriaPage.tsx
//
// Trilha de auditoria do sistema inteiro — só visível pra quem tem
// `usuarios.admin = true`. A proteção de dado real é a RLS de
// trilha_auditoria (ver migrations 20260806000004 + 20260820000001); esta
// página só decide se mostra ou não o link/conteúdo — mesmo padrão de
// AdminCronsPage.tsx.
//
// Nasceu de uma investigação de duplicação de provento (ago/2026) onde não
// havia nenhum jeito de responder "quando e por que esse registro mudou?"
// sem abrir o SQL Editor manualmente.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, RefreshCw, ShieldAlert, ChevronDown, ChevronRight, Plus, Pencil, Trash2, Clock, Check } from 'lucide-react'
import { useAdmin } from '../hooks/useAdmin'
import {
  useTrilhaAuditoria, useConfigAuditoria, type TrilhaAuditoriaItem, type OperacaoAuditoria,
} from '../hooks/useTrilhaAuditoria'
import DiffAuditoria from '../components/ui/DiffAuditoria'

// Tabelas cobertas pela trilha (ver comentário de escopo em
// 20260820000001_trilha_auditoria_extensao.sql) — usadas só pro filtro.
const TABELAS = [
  'transacoes', 'contas', 'categorias', 'lembretes', 'filtros_salvos',
  'assistente_lancamentos', 'objetivos',
  'inv_ativos', 'inv_alocacoes_tipo', 'inv_posicoes', 'inv_operacoes', 'inv_dividendos',
  'inv_historico_mensal', 'inv_tipos_dividendo', 'inv_questionarios', 'inv_avaliacoes',
  'fatura_import_sessao', 'fatura_import_item',
] as const

const OPERACOES: { valor: OperacaoAuditoria; label: string; cor: string; Icon: typeof Plus }[] = [
  { valor: 'INSERT', label: 'criado',   cor: '#4ade80', Icon: Plus },
  { valor: 'UPDATE', label: 'editado',  cor: '#ffb74d', Icon: Pencil },
  { valor: 'DELETE', label: 'excluído', cor: '#f87171', Icon: Trash2 },
]

const MUTED = '#8b92a8'

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function Linha({ item, mostrarUsuario }: { item: TrilhaAuditoriaItem; mostrarUsuario: boolean }) {
  const [aberto, setAberto] = useState(false)
  const op = OPERACOES.find(o => o.valor === item.operacao)!
  return (
    <div className="rounded-xl border p-4" style={{ background: '#1a1f2e', borderColor: 'rgba(255,255,255,0.1)' }}>
      <button onClick={() => setAberto(a => !a)} className="w-full flex items-center justify-between gap-3 flex-wrap text-left">
        <div className="flex items-center gap-2.5 min-w-0">
          {aberto ? <ChevronDown size={15} style={{ color: MUTED }} /> : <ChevronRight size={15} style={{ color: MUTED }} />}
          <op.Icon size={15} style={{ color: op.cor }} />
          <span className="font-semibold text-[14px]" style={{ color: '#e8eaf0' }}>{item.tabela}</span>
          <span
            className="text-[11px] px-2 py-0.5 rounded-full border shrink-0"
            style={{ color: op.cor, borderColor: `${op.cor}4d`, background: `${op.cor}14` }}
          >
            {op.label}
          </span>
          {mostrarUsuario && item.usuarios && (
            <span className="text-[12px] truncate" style={{ color: MUTED }}>
              {item.usuarios.nome || item.usuarios.email}
            </span>
          )}
        </div>
        <span className="text-[12px] shrink-0" style={{ color: MUTED }}>{formatDataHora(item.alterado_em)}</span>
      </button>
      {aberto && <div className="mt-1.5"><DiffAuditoria item={item} /></div>}
    </div>
  )
}

// Painel de retenção — dias que a trilha fica guardada antes do job diário
// (fn_purgar_trilha_auditoria, pg_cron) apagar. Ver 20260820000002.
function RetencaoConfig({ enabled }: { enabled: boolean }) {
  const { config, loading, salvarRetencao, salvando, erroSalvar } = useConfigAuditoria(enabled)
  const [valor, setValor] = useState<string>('')
  const [salvo, setSalvo] = useState(false)
  // Sincroniza o input com o valor carregado sem useEffect (setState durante
  // o render é o padrão recomendado pra "ajustar estado quando um prop/dado
  // externo muda" — evita o re-render em cascata de um efeito).
  const [ultimoConfigDias, setUltimoConfigDias] = useState<number | null>(null)
  if (config && config.retencao_dias !== ultimoConfigDias) {
    setUltimoConfigDias(config.retencao_dias)
    setValor(String(config.retencao_dias))
  }

  const dias = Number(valor)
  const invalido = !Number.isInteger(dias) || dias < 30 || dias > 3650
  const mudou = config != null && dias !== config.retencao_dias

  async function salvar() {
    if (invalido) return
    try {
      await salvarRetencao(dias)
      setSalvo(true)
      setTimeout(() => setSalvo(false), 2000)
    } catch { /* erro já exposto via erroSalvar */ }
  }

  return (
    <div className="rounded-xl border p-4 mb-4 flex items-center gap-3 flex-wrap" style={{ background: '#1a1f2e', borderColor: 'rgba(255,255,255,0.1)' }}>
      <Clock size={16} style={{ color: MUTED }} />
      <span className="text-[14px]" style={{ color: '#e8eaf0' }}>Retenção da trilha:</span>
      {loading ? (
        <span className="text-[13px]" style={{ color: MUTED }}>Carregando…</span>
      ) : (
        <>
          <input
            type="number" min={30} max={3650} value={valor}
            onChange={e => setValor(e.target.value)}
            className="w-20 text-[13px] px-2 py-1 rounded-md border bg-transparent"
            style={{ borderColor: 'rgba(255,255,255,0.15)', color: '#e8eaf0' }}
          />
          <span className="text-[13px]" style={{ color: MUTED }}>dias (entre 30 e 3650)</span>
          <button
            onClick={salvar}
            disabled={invalido || !mudou || salvando}
            className="text-[13px] px-3 py-1.5 rounded-lg font-medium transition-colors flex items-center gap-1.5 disabled:opacity-40"
            style={{ background: 'rgba(0,200,150,0.12)', color: '#00c896' }}
          >
            {salvo ? <Check size={13} /> : null}
            {salvando ? 'Salvando…' : salvo ? 'Salvo' : 'Salvar'}
          </button>
          {erroSalvar && <span className="text-[12px]" style={{ color: '#f87171' }}>{(erroSalvar as Error).message}</span>}
        </>
      )}
      <span className="text-[12px] w-full" style={{ color: MUTED }}>
        Registros mais antigos que o período são apagados automaticamente todo dia (job "trilha-auditoria-purge-diario", visível em /admin/crons).
      </span>
    </div>
  )
}

export default function AdminAuditoriaPage() {
  const isAdmin = useAdmin()
  const [tabela, setTabela] = useState<string>('todas')
  const [operacao, setOperacao] = useState<OperacaoAuditoria | 'todas'>('todas')
  const { itens, loading, recarregar } = useTrilhaAuditoria({
    tabela: tabela === 'todas' ? undefined : tabela,
    operacao: operacao === 'todas' ? undefined : operacao,
    limit: 200,
  }, isAdmin)

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center text-center" style={{ minHeight: '50vh' }}>
        <ShieldAlert size={40} style={{ color: MUTED }} className="mb-3" />
        <p className="text-[17px]" style={{ color: '#e8eaf0' }}>Acesso restrito</p>
        <p className="text-[15px] mt-1" style={{ color: MUTED }}>Esta página é só para administradores.</p>
      </div>
    )
  }

  return (
    <div className="p-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Link to="/perfil" className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: MUTED }}>
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-[22px] font-semibold" style={{ color: '#e8eaf0' }}>Trilha de auditoria</h1>
        <button
          onClick={() => recarregar()}
          title="Atualizar"
          className="ml-auto p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: MUTED }}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="text-[14px] mb-4" style={{ color: MUTED }}>
        Últimos 200 eventos de INSERT/UPDATE/DELETE em transações, transferências e o restante dos dados do sistema.
      </p>

      <RetencaoConfig enabled={isAdmin} />

      <div className="flex flex-wrap gap-2 mb-2.5">
        <button
          onClick={() => setTabela('todas')}
          className="text-[13px] px-3 py-1.5 rounded-full border transition-colors"
          style={{
            color: tabela === 'todas' ? '#00c896' : MUTED,
            borderColor: tabela === 'todas' ? 'rgba(0,200,150,0.4)' : 'rgba(255,255,255,0.1)',
            background: tabela === 'todas' ? 'rgba(0,200,150,0.08)' : 'transparent',
          }}
        >
          Todas as tabelas
        </button>
        {TABELAS.map(t => (
          <button
            key={t}
            onClick={() => setTabela(t)}
            className="text-[13px] px-3 py-1.5 rounded-full border transition-colors"
            style={{
              color: tabela === t ? '#00c896' : MUTED,
              borderColor: tabela === t ? 'rgba(0,200,150,0.4)' : 'rgba(255,255,255,0.1)',
              background: tabela === t ? 'rgba(0,200,150,0.08)' : 'transparent',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setOperacao('todas')}
          className="text-[13px] px-3 py-1.5 rounded-full border transition-colors"
          style={{
            color: operacao === 'todas' ? '#e8eaf0' : MUTED,
            borderColor: operacao === 'todas' ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.1)',
          }}
        >
          Todas as ações
        </button>
        {OPERACOES.map(o => (
          <button
            key={o.valor}
            onClick={() => setOperacao(o.valor)}
            className="text-[13px] px-3 py-1.5 rounded-full border transition-colors flex items-center gap-1.5"
            style={{
              color: operacao === o.valor ? o.cor : MUTED,
              borderColor: operacao === o.valor ? `${o.cor}66` : 'rgba(255,255,255,0.1)',
              background: operacao === o.valor ? `${o.cor}14` : 'transparent',
            }}
          >
            <o.Icon size={12} /> {o.label}
          </button>
        ))}
      </div>

      {loading && <p className="text-[15px]" style={{ color: MUTED }}>Carregando…</p>}

      {!loading && itens.length === 0 && (
        <p className="text-[15px]" style={{ color: MUTED }}>Nenhum evento registrado para este filtro.</p>
      )}

      <div className="flex flex-col gap-2.5">
        {itens.map(item => <Linha key={item.id} item={item} mostrarUsuario />)}
      </div>
    </div>
  )
}
