// src/pages/AdminCronsPage.tsx
//
// Histórico de execução dos cron jobs do sistema — só visível pra quem
// tem `usuarios.admin = true`. A proteção de dado real é a RLS de
// cron_execucoes (ver migration 20260806000002); esta página só decide se
// mostra ou não o link/conteúdo — um usuário não-admin que forçar a rota
// só vê a mensagem de acesso restrito (o fetch nem preenche nada, RLS
// filtra tudo no servidor).
//
// Nasceu da auditoria técnica de 2026-08-06: dividendos-diario ficou 19
// dias falhando 100% das vezes sem NENHUM sinal visível em lugar nenhum —
// só apareceu porque um usuário notou dividendos faltando. Esta tela é o
// "eu poderia ter visto isso sem precisar abrir o SQL Editor".

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, RefreshCw, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react'
import { useAdmin } from '../hooks/useAdmin'
import { useCronExecucoes, type CronExecucao } from '../hooks/useCronExecucoes'

const JOBS = [
  'dividendos-diario', 'dividendos-br-diario', 'snapshot-diario', 'rendimento-cripto-diario',
  'trilha-auditoria-purge-diario',
] as const

function formatDataHora(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatDuracao(ms: number | null): string {
  if (ms == null) return '—'
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

// Resumo é JSONB de formato livre (cada job devolve campos diferentes) —
// renderiza como grade chave:valor quando é um objeto simples, senão cru.
function Resumo({ resumo }: { resumo: unknown }) {
  if (!resumo || typeof resumo !== 'object') return null
  const entradas = Object.entries(resumo as Record<string, unknown>)
    .filter(([, v]) => v !== null && !(Array.isArray(v) && v.length === 0))
  if (entradas.length === 0) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
      {entradas.map(([k, v]) => (
        <span key={k} className="text-[13px]" style={{ color: '#8b92a8' }}>
          {k}: <span style={{ color: '#c5cbd3' }}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
        </span>
      ))}
    </div>
  )
}

function Linha({ exec }: { exec: CronExecucao }) {
  const ok = exec.status === 'sucesso'
  return (
    <div className="rounded-xl border p-4" style={{ background: '#1a1f2e', borderColor: 'rgba(255,255,255,0.1)' }}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          {ok
            ? <CheckCircle2 size={17} style={{ color: '#00c896' }} />
            : <XCircle size={17} style={{ color: '#f87171' }} />}
          <span className="font-semibold text-[15px]" style={{ color: '#e8eaf0' }}>{exec.job_nome}</span>
          <span
            className="text-[12px] px-2 py-0.5 rounded-full border"
            style={{
              color: ok ? '#00c896' : '#f87171',
              borderColor: ok ? 'rgba(0,200,150,0.3)' : 'rgba(248,113,113,0.3)',
              background: ok ? 'rgba(0,200,150,0.08)' : 'rgba(248,113,113,0.08)',
            }}
          >
            {ok ? 'sucesso' : 'erro'}
          </span>
        </div>
        <div className="flex items-center gap-3 text-[13px]" style={{ color: '#8b92a8' }}>
          <span>{formatDataHora(exec.executado_em)}</span>
          <span>·</span>
          <span>{formatDuracao(exec.duracao_ms)}</span>
        </div>
      </div>
      {ok
        ? <Resumo resumo={exec.resumo} />
        : exec.erro && (
            <p className="text-[13px] mt-2 font-mono break-all" style={{ color: '#f87171' }}>{exec.erro}</p>
          )}
    </div>
  )
}

export default function AdminCronsPage() {
  const isAdmin = useAdmin()
  const [filtro, setFiltro] = useState<string>('todos')
  const { execucoes, loading, recarregar } = useCronExecucoes(isAdmin)

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center text-center" style={{ minHeight: '50vh' }}>
        <ShieldAlert size={40} style={{ color: '#8b92a8' }} className="mb-3" />
        <p className="text-[17px]" style={{ color: '#e8eaf0' }}>Acesso restrito</p>
        <p className="text-[15px] mt-1" style={{ color: '#8b92a8' }}>Esta página é só para administradores.</p>
      </div>
    )
  }

  const visiveis = filtro === 'todos' ? execucoes : execucoes.filter(e => e.job_nome === filtro)

  return (
    <div className="p-5 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-1">
        <Link to="/perfil" className="p-1.5 rounded-lg hover:bg-white/5 transition-colors" style={{ color: '#8b92a8' }}>
          <ArrowLeft size={18} />
        </Link>
        <h1 className="text-[22px] font-semibold" style={{ color: '#e8eaf0' }}>Execuções de cron</h1>
        <button
          onClick={() => recarregar()}
          title="Atualizar"
          className="ml-auto p-2 rounded-lg hover:bg-white/5 transition-colors"
          style={{ color: '#8b92a8' }}
        >
          <RefreshCw size={16} />
        </button>
      </div>
      <p className="text-[14px] mb-4" style={{ color: '#8b92a8' }}>
        Últimas 100 execuções dos jobs agendados (dividendos USD/BRL, snapshot mensal, rendimento cripto, purga da trilha de auditoria).
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        {(['todos', ...JOBS] as const).map(j => (
          <button
            key={j}
            onClick={() => setFiltro(j)}
            className="text-[13px] px-3 py-1.5 rounded-full border transition-colors"
            style={{
              color: filtro === j ? '#00c896' : '#8b92a8',
              borderColor: filtro === j ? 'rgba(0,200,150,0.4)' : 'rgba(255,255,255,0.1)',
              background: filtro === j ? 'rgba(0,200,150,0.08)' : 'transparent',
            }}
          >
            {j === 'todos' ? 'Todos' : j}
          </button>
        ))}
      </div>

      {loading && <p className="text-[15px]" style={{ color: '#8b92a8' }}>Carregando…</p>}

      {!loading && visiveis.length === 0 && (
        <p className="text-[15px]" style={{ color: '#8b92a8' }}>Nenhuma execução registrada ainda.</p>
      )}

      <div className="flex flex-col gap-2.5">
        {visiveis.map(exec => <Linha key={exec.id} exec={exec} />)}
      </div>
    </div>
  )
}
