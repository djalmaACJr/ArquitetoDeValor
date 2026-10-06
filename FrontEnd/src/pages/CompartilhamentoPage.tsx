// src/pages/CompartilhamentoPage.tsx
//
// Tela de "usuários agregados" (conta conjunta): convidar alguém pra ver
// partes da própria conta, gerenciar quem já foi convidado (módulos/contas
// liberados), e responder convites recebidos de outras pessoas.

import { useState, useEffect, useRef } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Mail, Send, Trash2, RefreshCw, ChevronDown, ChevronRight, Check, X, Users } from 'lucide-react'
import {
  useAgregadosComoDonos, useConvitesRecebidos,
  type VinculoComoDono, type ModuloAgregado,
} from '../hooks/useAgregados'
import { useContas } from '../hooks/useContas'
import { MultiSelect } from '../components/ui/MultiSelect'
import { Toggle } from '../components/ui/shared'
import { setEspacoAtivo } from '../lib/espacoAtivo'

const MODULOS: { valor: ModuloAgregado; label: string }[] = [
  { valor: 'EXTRATO',       label: 'Extrato (contas e lançamentos)' },
  { valor: 'OBJETIVOS',     label: 'Objetivos' },
  { valor: 'INVESTIMENTOS', label: 'Investimentos' },
]

const STATUS_INFO: Record<string, { cor: string; texto: string }> = {
  PENDENTE: { cor: '#f0b429', texto: 'Pendente' },
  ACEITO:   { cor: '#00c896', texto: 'Ativo' },
  RECUSADO: { cor: '#8b92a8', texto: 'Recusado' },
  REVOGADO: { cor: '#8b92a8', texto: 'Revogado' },
}

function BadgeStatus({ status, saiu = false }: { status: string; saiu?: boolean }) {
  const m = saiu ? { cor: '#f0b429', texto: 'Saiu' } : (STATUS_INFO[status] ?? STATUS_INFO.PENDENTE)
  return (
    <span className="text-[12px] px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: `${m.cor}22`, color: m.cor }}>
      {m.texto}
    </span>
  )
}

const ORDEM_STATUS = ['ACEITO', 'PENDENTE', 'REVOGADO', 'RECUSADO'] as const
const TITULO_GRUPO: Record<string, string> = {
  ACEITO: 'Ativos', PENDENTE: 'Aguardando aceite', REVOGADO: 'Revogados / saíram', RECUSADO: 'Recusados',
}

function fmtData(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
}

// Quadro recolhível de um status — Ativos/Aguardando abrem por padrão;
// Revogados/Recusados (histórico) começam recolhidos.
function GrupoStatus({ status, vinculos, destaqueId }: { status: string; vinculos: VinculoComoDono[]; destaqueId: string | null }) {
  const [aberto, setAberto] = useState(status === 'ACEITO' || status === 'PENDENTE')
  const m = STATUS_INFO[status] ?? STATUS_INFO.PENDENTE
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02]">
      <button
        onClick={() => setAberto(v => !v)}
        aria-expanded={aberto}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left rounded-xl hover:bg-white/[0.03] transition-colors"
      >
        {aberto ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
        <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: m.cor }} />
        <span className="flex-1 text-[13px] font-semibold uppercase tracking-wide" style={{ color: '#c5cad8' }}>
          {TITULO_GRUPO[status]}
        </span>
        <span className="text-[12px] px-2 py-0.5 rounded-full" style={{ background: `${m.cor}22`, color: m.cor }}>
          {vinculos.length}
        </span>
      </button>
      {aberto && (
        <div className="flex flex-col gap-2 px-3 pb-3">
          {vinculos.map(v => <CardVinculo key={v.id} vinculo={v} destaque={v.id === destaqueId} />)}
        </div>
      )}
    </div>
  )
}

// `destaque`: convite recém-enviado — abre o cartão já nas permissões e rola até ele.
function CardVinculo({ vinculo, destaque }: { vinculo: VinculoComoDono; destaque: boolean }) {
  const { reenviar, revogar, definirPermissao, definirContas } = useAgregadosComoDonos()
  const { contas } = useContas()
  const [aberto, setAberto] = useState(false)
  const [ocupado, setOcupado] = useState(false)
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!destaque) return
    setAberto(true)
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [destaque])

  const contasOpcoes = contas.map(c => ({ value: c.conta_id, label: c.nome }))
  const contasSelecionadas = vinculo.agregados_contas.map(c => c.conta_id)
  const permissaoDe = (m: ModuloAgregado) => vinculo.agregados_permissoes.find(p => p.modulo === m)
  const ativo = vinculo.status === 'PENDENTE' || vinculo.status === 'ACEITO'

  return (
    <div ref={cardRef} className={`rounded-lg border ${destaque ? 'border-av-green/60' : 'border-white/10'}`}>
      <button
        onClick={() => setAberto(v => !v)}
        className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/[0.03] transition-colors ${aberto ? 'rounded-t-lg' : 'rounded-lg'}`}
      >
        {aberto ? <ChevronDown size={14} className="text-white/40" /> : <ChevronRight size={14} className="text-white/40" />}
        <span className="flex-1 min-w-0">
          <span className="block text-[14px] text-white/85 truncate">{vinculo.agregado_nome || vinculo.email_convidado}</span>
          {vinculo.agregado_nome && (
            <span className="block text-[12px] truncate" style={{ color: '#8b92a8' }}>{vinculo.email_convidado}</span>
          )}
          <span className="block text-[11.5px] mt-0.5" style={{ color: '#8b92a8' }}>
            Convite {fmtData(vinculo.criado_em)} · Aceite {fmtData(vinculo.aceito_em)} · Revogação {fmtData(vinculo.revogado_em)}
          </span>
        </span>
        <BadgeStatus status={vinculo.status} saiu={!!vinculo.saiu_por_agregado} />
      </button>

      {aberto && (
        <div className="px-3 pb-3 pt-1 space-y-4 border-t border-white/5">
          {vinculo.status === 'PENDENTE' && (
            <button
              disabled={ocupado}
              onClick={async () => { setOcupado(true); await reenviar(vinculo.id); setOcupado(false) }}
              className="flex items-center gap-1.5 text-[13px] text-av-blue hover:text-av-blue/80 disabled:opacity-50 transition-colors"
            >
              <RefreshCw size={13} /> Reenviar convite
            </button>
          )}

          {ativo && (
            <>
              {vinculo.agregados_permissoes.length === 0 && (
                <p className="text-[13px] rounded-lg px-3 py-2" style={{ background: 'rgba(0,200,150,0.08)', color: '#7ee0c3' }}>
                  Libere abaixo os módulos e as contas que {vinculo.agregado_nome || 'o convidado'} poderá acessar. Sem isso, ao aceitar o convite ele não verá nada.
                </p>
              )}
              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: '#8b92a8' }}>
                  Módulos liberados
                </p>
                <div className="space-y-2.5">
                  {MODULOS.map(m => {
                    const perm = permissaoDe(m.valor)
                    return (
                      <div key={m.valor} className="flex items-center justify-between gap-2">
                        <span className="text-[13px] text-white/70">{m.label}</span>
                        <div className="flex items-center gap-3">
                          {perm && (
                            <label className="flex items-center gap-1.5 text-[12px] cursor-pointer" style={{ color: '#8b92a8' }}>
                              <input
                                type="checkbox" checked={perm.pode_escrever}
                                onChange={e => definirPermissao(vinculo.id, m.valor, true, e.target.checked)}
                              />
                              Pode editar
                            </label>
                          )}
                          <Toggle
                            checked={!!perm}
                            onChange={(v) => definirPermissao(vinculo.id, m.valor, v, perm?.pode_escrever ?? false)}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div>
                <p className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: '#8b92a8' }}>
                  Contas liberadas
                </p>
                <MultiSelect
                  options={contasOpcoes}
                  values={contasSelecionadas}
                  onChange={(vals) => definirContas(vinculo.id, vals)}
                  placeholder="Nenhuma conta liberada ainda"
                  selecionarTodos
                />
              </div>

              <button
                onClick={() => revogar(vinculo.id)}
                className="flex items-center gap-1.5 text-[13px] text-red-400 hover:text-red-300 transition-colors"
              >
                <Trash2 size={13} /> Revogar acesso
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default function CompartilhamentoPage() {
  const { vinculos, loading, convidar } = useAgregadosComoDonos()
  const { convites, aceitos, aceitar, recusar, sair } = useConvitesRecebidos()
  const navigate = useNavigate()

  const [email, setEmail]       = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro]         = useState('')
  const [sucesso, setSucesso]   = useState('')
  const [destaqueId, setDestaqueId] = useState<string | null>(null)

  const pendentesRecebidos = convites.filter(c => c.status === 'PENDENTE')

  const handleConvidar = async (e: FormEvent) => {
    e.preventDefault()
    setErro(''); setSucesso('')
    setEnviando(true)
    const res = await convidar(email)
    setEnviando(false)
    if (!res.ok) { setErro(res.erro ?? 'Não foi possível enviar o convite.'); return }
    setSucesso(`Convite enviado para ${email}. Agora defina o que ele poderá acessar: libere os módulos e as contas no cartão logo abaixo — sem isso, ao aceitar ele não verá nada.`)
    setDestaqueId(res.dados?.id ?? null)
    setEmail('')
  }

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto flex flex-col gap-5">
      <div>
        <h1 className="text-[22px] font-bold text-white flex items-center gap-2">
          <Users size={20} className="text-av-green" /> Compartilhamento
        </h1>
        <p className="text-[14px] mt-1" style={{ color: '#8b92a8' }}>
          Convide outra pessoa pra acessar partes da sua conta (como uma conta conjunta), ou responda convites que você recebeu.
        </p>
      </div>

      {/* Convidar */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-3 flex items-center gap-2">
          <Mail size={15} className="text-av-blue" /> Convidar um agregado
        </h2>
        <form onSubmit={handleConvidar} className="flex flex-col sm:flex-row gap-2">
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="email@exemplo.com"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[15px] text-white placeholder-white/30 focus:outline-none focus:border-av-green/70 transition-colors"
          />
          <button
            type="submit" disabled={enviando}
            className="flex items-center justify-center gap-2 bg-av-green text-av-dark font-semibold rounded-lg px-4 py-2.5 text-[15px] hover:bg-av-green/90 disabled:opacity-50 transition-colors"
          >
            <Send size={15} /> {enviando ? 'Enviando...' : 'Convidar'}
          </button>
        </form>
        {erro && <p className="text-[13px] text-red-400 mt-2">{erro}</p>}
        {sucesso && <p className="text-[13px] text-av-green mt-2">{sucesso}</p>}
      </section>

      {/* Meus agregados */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-1">
          Meus agregados <span className="text-[13px] font-normal" style={{ color: '#8b92a8' }}>({vinculos.length})</span>
        </h2>
        {vinculos.length > 0 && (
          <p className="text-[12.5px] mb-3" style={{ color: '#8b92a8' }}>
            {ORDEM_STATUS.filter(st => vinculos.some(v => v.status === st))
              .map(st => `${vinculos.filter(v => v.status === st).length} ${TITULO_GRUPO[st].toLowerCase()}`)
              .join(' · ')}
          </p>
        )}
        {loading ? (
          <p className="text-[13px]" style={{ color: '#8b92a8' }}>Carregando...</p>
        ) : vinculos.length === 0 ? (
          <p className="text-[13px]" style={{ color: '#8b92a8' }}>Você ainda não convidou ninguém.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {ORDEM_STATUS.map(st => {
              const grupo = vinculos.filter(v => v.status === st)
              return grupo.length === 0 ? null : <GrupoStatus key={st} status={st} vinculos={grupo} destaqueId={destaqueId} />
            })}
          </div>
        )}
      </section>

      {/* Convites recebidos — pendentes de resposta */}
      {pendentesRecebidos.length > 0 && (
        <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
          <h2 className="text-[15px] font-semibold text-white/80 mb-3">Convites que recebi</h2>
          <div className="flex flex-col gap-2">
            {pendentesRecebidos.map(c => (
              <div key={c.id} className="flex items-center justify-between gap-2 rounded-lg border border-white/10 px-3 py-2.5">
                <span className="text-[14px] text-white/80 truncate">
                  <strong className="text-white">{c.dono_nome}</strong> quer te adicionar como agregado
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => aceitar(c.id)} title="Aceitar"
                    className="p-1.5 rounded-lg bg-av-green/15 text-av-green hover:bg-av-green/25 transition-colors"
                  >
                    <Check size={15} />
                  </button>
                  <button
                    onClick={() => recusar(c.id)} title="Recusar"
                    className="p-1.5 rounded-lg bg-red-400/15 text-red-400 hover:bg-red-400/25 transition-colors"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Espaços que já posso acessar */}
      {aceitos.length > 0 && (
        <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
          <h2 className="text-[15px] font-semibold text-white/80 mb-3">Espaços que tenho acesso</h2>
          <div className="flex flex-col gap-2">
            {aceitos.map(v => (
              <div key={v.id} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2.5 hover:border-av-green/40 transition-colors">
                <button
                  onClick={() => {
                    setEspacoAtivo({ id: v.id, dono_id: v.dono_id, dono_nome: v.dono_nome, permissoes: v.permissoes })
                    navigate('/')
                  }}
                  className="flex-1 min-w-0 flex items-center justify-between gap-2 text-left"
                >
                  <span className="text-[14px] text-white/80 truncate">Conta de {v.dono_nome}</span>
                  <span className="text-[12px] text-av-green flex-shrink-0">Entrar neste espaço →</span>
                </button>
                <button
                  onClick={async () => {
                    if (!window.confirm(`Deixar de acessar a conta de ${v.dono_nome}? Você deixa de ver os dados dela — só ${v.dono_nome} poderá te convidar de novo.`)) return
                    const res = await sair(v.id)
                    if (!res.ok) window.alert(res.erro ?? 'Não foi possível sair deste espaço.')
                  }}
                  className="flex-shrink-0 text-[12px] text-red-400 hover:text-red-300 transition-colors"
                >
                  Deixar de acessar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
