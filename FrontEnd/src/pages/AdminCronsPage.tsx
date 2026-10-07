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
import { ArrowLeft, RefreshCw, ShieldAlert, CheckCircle2, XCircle, Trash2 } from 'lucide-react'
import { useAdmin } from '../hooks/useAdmin'
import { useCronExecucoes, type CronExecucao } from '../hooks/useCronExecucoes'

// Mínimo que o banco aceita (fn_limpar_cron_execucoes recusa menos) — a tela só oferece 30+.
const PERIODOS_LIMPEZA = [30, 60, 90] as const

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
  const [filtroStatus, setFiltroStatus] = useState<'todos' | 'sucesso' | 'erro'>('todos')
  const { execucoes, loading, recarregar, limparAntigas } = useCronExecucoes(isAdmin)
  const [diasLimpeza, setDiasLimpeza] = useState<number>(30)
  const [limpando, setLimpando] = useState(false)
  const [msgLimpeza, setMsgLimpeza] = useState<{ ok: boolean; texto: string } | null>(null)

  if (!isAdmin) {
    return (
      <div className="p-6 flex flex-col items-center justify-center text-center" style={{ minHeight: '50vh' }}>
        <ShieldAlert size={40} style={{ color: '#8b92a8' }} className="mb-3" />
        <p className="text-[17px]" style={{ color: '#e8eaf0' }}>Acesso restrito</p>
        <p className="text-[15px] mt-1" style={{ color: '#8b92a8' }}>Esta página é só para administradores.</p>
      </div>
    )
  }

  // Botões de job vêm dos DADOS, não de uma lista fixa: jobs que não estavam na lista antiga
  // (cvm-acoes-mensal, cvm-fii-semanal, fatos-relevantes-diario, cron-saude-diario…) só apareciam
  // em "Todos" — o erro de um deles não surgia ao filtrar por nenhum botão. Cada botão mostra
  // quantos erros o job tem (vermelho) pra achar o problema sem precisar caçar.
  const jobsPresentes = [...new Set(execucoes.map(e => e.job_nome))].sort((a, b) => a.localeCompare(b))
  const errosPorJob = (j: string) => execucoes.filter(e => e.job_nome === j && e.status === 'erro').length

  const limpar = async () => {
    setMsgLimpeza(null)
    setLimpando(true)
    const sim = await limparAntigas(diasLimpeza, true)
    if (!sim.ok) { setLimpando(false); setMsgLimpeza({ ok: false, texto: sim.erro ?? 'Não foi possível verificar.' }); return }
    const qtd = sim.dados?.removidas ?? 0
    if (qtd === 0) { setLimpando(false); setMsgLimpeza({ ok: true, texto: `Nada a limpar: não há execuções com mais de ${diasLimpeza} dias.` }); return }
    if (!window.confirm(`Apagar ${qtd} execução(ões) com mais de ${diasLimpeza} dias? Esta ação não pode ser desfeita. As execuções mais recentes são mantidas.`)) {
      setLimpando(false); return
    }
    const res = await limparAntigas(diasLimpeza, false)
    setLimpando(false)
    setMsgLimpeza(res.ok
      ? { ok: true, texto: `${res.dados?.removidas ?? 0} execução(ões) removida(s).` }
      : { ok: false, texto: res.erro ?? 'Não foi possível limpar.' })
  }

  // Os dois filtros se combinam (job E status). Os contadores de status respeitam o filtro de
  // job escolhido, pra "Erro (3)" refletir o que aparece ao clicar.
  const doJob = filtro === 'todos' ? execucoes : execucoes.filter(e => e.job_nome === filtro)
  const contagem = {
    todos:   doJob.length,
    sucesso: doJob.filter(e => e.status === 'sucesso').length,
    erro:    doJob.filter(e => e.status === 'erro').length,
  }
  const visiveis = filtroStatus === 'todos' ? doJob : doJob.filter(e => e.status === filtroStatus)

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
        {['todos', ...jobsPresentes].map(j => (
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
            {j !== 'todos' && errosPorJob(j) > 0 && (
              <span className="ml-1.5 text-[11px] px-1.5 py-0.5 rounded-full" style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171' }}>
                {errosPorJob(j)} erro{errosPorJob(j) > 1 ? 's' : ''}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Filtro de status */}
      <div className="flex flex-wrap items-center gap-2 mb-4" role="group" aria-label="Filtrar por status">
        <span className="text-[13px] mr-1" style={{ color: '#8b92a8' }}>Status:</span>
        {([
          { v: 'todos',   rotulo: 'Todos',   cor: '#00c896', borda: 'rgba(0,200,150,0.4)',   fundo: 'rgba(0,200,150,0.08)' },
          { v: 'sucesso', rotulo: 'Sucesso', cor: '#00c896', borda: 'rgba(0,200,150,0.4)',   fundo: 'rgba(0,200,150,0.08)' },
          { v: 'erro',    rotulo: 'Erro',    cor: '#f87171', borda: 'rgba(248,113,113,0.4)', fundo: 'rgba(248,113,113,0.08)' },
        ] as const).map(o => {
          const ativo = filtroStatus === o.v
          return (
            <button
              key={o.v}
              onClick={() => setFiltroStatus(o.v)}
              aria-pressed={ativo}
              className="text-[13px] px-3 py-1.5 rounded-full border transition-colors"
              style={{
                color: ativo ? o.cor : '#8b92a8',
                borderColor: ativo ? o.borda : 'rgba(255,255,255,0.1)',
                background: ativo ? o.fundo : 'transparent',
              }}
            >
              {o.rotulo} ({contagem[o.v]})
            </button>
          )
        })}
      </div>

      {/* Limpeza — nunca apaga execuções com menos de 30 dias (regra também no banco). */}
      <div className="rounded-xl border p-3 mb-4 flex flex-wrap items-center gap-3"
        style={{ background: '#1a1f2e', borderColor: 'rgba(255,255,255,0.1)' }}>
        <Trash2 size={15} style={{ color: '#8b92a8' }} />
        <span className="text-[13px]" style={{ color: '#8b92a8' }}>Limpar logs com mais de</span>
        <select
          value={diasLimpeza}
          onChange={e => setDiasLimpeza(Number(e.target.value))}
          disabled={limpando}
          className="text-[13px] rounded-lg px-2 py-1.5 border bg-transparent"
          style={{ color: '#e8eaf0', borderColor: 'rgba(255,255,255,0.15)', colorScheme: 'dark' }}
        >
          {PERIODOS_LIMPEZA.map(d => <option key={d} value={d}>{d} dias</option>)}
        </select>
        <button
          onClick={limpar}
          disabled={limpando}
          className="text-[13px] px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50"
          style={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)', background: 'rgba(248,113,113,0.08)' }}
        >
          {limpando ? 'Verificando…' : 'Limpar logs antigos'}
        </button>
        <span className="text-[12px] w-full sm:w-auto" style={{ color: '#6b7388' }}>
          Execuções com menos de 30 dias nunca são apagadas.
        </span>
        {msgLimpeza && (
          <p className="text-[13px] w-full" style={{ color: msgLimpeza.ok ? '#00c896' : '#f87171' }}>{msgLimpeza.texto}</p>
        )}
      </div>

      {loading && <p className="text-[15px]" style={{ color: '#8b92a8' }}>Carregando…</p>}

      {!loading && visiveis.length === 0 && (
        <p className="text-[15px]" style={{ color: '#8b92a8' }}>
          {execucoes.length === 0 ? 'Nenhuma execução registrada ainda.' : 'Nenhuma execução com esses filtros.'}
        </p>
      )}

      <div className="flex flex-col gap-2.5">
        {visiveis.map(exec => <Linha key={exec.id} exec={exec} />)}
      </div>
    </div>
  )
}
