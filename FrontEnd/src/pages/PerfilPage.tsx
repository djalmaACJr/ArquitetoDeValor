import { useState, useEffect, useMemo } from 'react'
import type { FormEvent } from 'react'
import {
  User, Lock, Check, AlertCircle, Trash2, Bookmark, X, ChevronDown,
  Pencil, Sparkles, ArrowRight, Wand2, RefreshCw, Search, ChevronLeft, ChevronRight,
  Palette, Users,
} from 'lucide-react'
import { useTheme } from '../hooks/useTheme'
import { useMascotePreferido } from '../hooks/useMascotePreferido'
import Mascote, { type MascoteNome, type MascotePose } from '../components/ui/Mascote'
import { useIAPreferencia } from '../hooks/useIAPreferencia'
import { PROVEDORES, PROVEDOR_PADRAO } from '../lib/iaProvedores'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { apiMutate } from '../lib/api'
import { useFiltrosSalvos } from '../hooks/useFiltrosSalvos'
import { useSugestoes, salvarSugestao } from '../hooks/useAssistente'
import { fetchLancamentos, mesAdjacente, type Lancamento } from '../hooks/useLancamentos'
import { useContas } from '../hooks/useContas'
import { useCategorias } from '../hooks/useCategorias'
import { STATUS_LABEL } from '../lib/utils'
import { qk } from '../lib/queryKeys'

type Feedback = { tipo: 'ok' | 'erro'; msg: string }

type SugestaoSugerida = {
  key:            string
  descricao:      string
  categoria_id:   string | null
  categoria_nome: string | null
  conta_id:       string | null
  conta_nome:     string | null
  ocorrencias:    number
}

const ITEMS_PER_PAGE = 15

function normDesc(d: string | null | undefined): string {
  if (!d) return ''
  return d
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function Secao({ titulo, icone, children }: {
  titulo: string
  icone: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-white/4 border border-white/8 rounded-2xl p-5 h-full">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/8">
        <span className="text-av-green/70">{icone}</span>
        <h2 className="text-[17px] font-semibold text-white">{titulo}</h2>
      </div>
      {children}
    </div>
  )
}

function Alerta({ fb }: { fb: Feedback | null }) {
  if (!fb) return null
  const ok = fb.tipo === 'ok'
  return (
    <div className={`flex items-center gap-2 text-[16px] rounded-lg px-3 py-2 mt-3 ${
      ok ? 'bg-av-green/10 text-av-green' : 'bg-red-400/10 text-red-400'
    }`}>
      {ok ? <Check size={13}/> : <AlertCircle size={13}/>}
      {fb.msg}
    </div>
  )
}

/** Picker de mascote preferido — grade 2x2 de cards. Poses por estado:
 *  - sentado:     mascote NÃO selecionado (calmo, neutro)
 *  - feliz:       mascote selecionado (ativo, contente)
 *  - triste:      último mascote (perdeu a vaga durante a troca)
 *
 *  Quando o usuário clica em outro mascote, o anterior fica visualmente
 *  "triste" por um instante antes de voltar para sentado — feedback de
 *  transição. A escolha persiste em `arqvalor.usuarios.mascote_preferido`. */
function SecaoMascote() {
  const { mascote, setMascote, apelidos, apelidoDe, definirApelido } = useMascotePreferido()
  // Mascote "deposto": fica triste por uns segundos após perder o ativo.
  const [tristePassageiro, setTristePassageiro] = useState<MascoteNome | null>(null)
  // Modal de apelido: aberto ao selecionar mascote SEM apelido ainda,
  // ou ao clicar no botão de renomear.
  const [modalApelido, setModalApelido] = useState<MascoteNome | null>(null)
  const [apelidoInput, setApelidoInput] = useState('')

  // Catálogo dos 4 mascotes
  const catalogo: Array<{ id: MascoteNome; label: string; descricao: string }> = [
    { id: 'sabio',     label: 'Sábio',     descricao: 'Sabedoria e visão de longo prazo.' },
    { id: 'arquiteta', label: 'Arquiteta', descricao: 'Estrutura, cálculo e disciplina.' },
    { id: 'gato',      label: 'Mago Gato', descricao: 'A magia dos juros compostos.' },
    { id: 'raposa',    label: 'Raposa',    descricao: 'Astúcia estratégica de mercado.' },
  ]

  // Abre o modal pra (re)nomear — chamado pelo botão dedicado.
  const abrirRenomear = (id: MascoteNome) => {
    setApelidoInput(apelidos[id] ?? '')
    setModalApelido(id)
  }

  const aoTrocar = (id: MascoteNome) => {
    if (id === mascote) return  // re-clique no ativo: não faz nada (use botão renomear)
    const anterior = mascote
    setMascote(id)
    setTristePassageiro(anterior)
    setTimeout(() => setTristePassageiro(p => (p === anterior ? null : p)), 2200)
    // Só pede nome se o mascote escolhido ainda NÃO tem apelido salvo.
    if (!apelidos[id]) {
      setApelidoInput('')
      setModalApelido(id)
    }
  }

  const salvarApelido = async () => {
    if (modalApelido) await definirApelido(modalApelido, apelidoInput)
    setModalApelido(null)
  }

  return (
    <Secao titulo="Mascote preferido" icone={<Users size={15}/>}>
      <p className="text-[15px] text-white/40 mb-3 leading-relaxed">
        Quem aparece nos balões contextuais (Dashboard, Comparativo, etc.).
        A escolha é salva na sua conta.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {catalogo.map(m => {
          const ativo = m.id === mascote
          const triste = m.id === tristePassageiro
          // Pose por estado: ativo→feliz, triste passageiro→triste, default→sentado
          const pose: MascotePose = ativo ? 'feliz' : triste ? 'triste' : 'sentado'
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => aoTrocar(m.id)}
              className="text-left rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-av-green/40 p-2.5"
              style={{
                borderColor: ativo ? '#00c896' : triste ? 'rgba(248,113,113,0.5)' : 'rgba(255,255,255,0.10)',
                background:  ativo ? 'rgba(0,200,150,0.08)'
                            : triste ? 'rgba(248,113,113,0.06)'
                            : 'rgba(255,255,255,0.03)',
              }}
              aria-pressed={ativo}
              title={m.descricao}
            >
              <div className="flex items-center gap-3">
                <Mascote
                  nome={m.id}
                  pose={pose}
                  size={84}
                  className="flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-semibold text-white truncate">
                    {apelidoDe(m.id)}
                    {apelidoDe(m.id) !== m.label && (
                      <span className="text-[12px] font-normal ml-1.5" style={{ color: '#8b92a8' }}>
                        ({m.label})
                      </span>
                    )}
                  </p>
                  {ativo && (
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: '#00c896' }}>
                        ✓ Em uso
                      </span>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); abrirRenomear(m.id) }}
                        className="text-[12px] font-medium underline hover:opacity-80"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        renomear
                      </button>
                    </div>
                  )}
                  {triste && (
                    <p className="text-[12px] font-semibold uppercase tracking-wider mt-0.5" style={{ color: '#f87171' }}>
                      ✗ Trocado
                    </p>
                  )}
                  <p className="text-[13px] mt-1 leading-snug" style={{ color: '#8b92a8' }}>
                    {m.descricao}
                  </p>
                </div>
              </div>
            </button>
          )
        })}
      </div>
      <p className="text-[13px] text-white/30 mt-3 leading-relaxed">
        Toque novamente no mascote ativo para renomeá-lo.
      </p>

      {/* Modal: pedir apelido para o mascote escolhido */}
      {modalApelido && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setModalApelido(null)} />
          <div
            className="relative w-full max-w-sm rounded-2xl p-5 shadow-2xl"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
          >
            <div className="flex flex-col items-center mb-3">
              <Mascote nome={modalApelido} pose="feliz" size={120} />
            </div>
            <p className="text-[17px] font-semibold text-center mb-1" style={{ color: 'var(--text-primary)' }}>
              Como vou te chamar?
            </p>
            <p className="text-[14px] text-center mb-4" style={{ color: 'var(--text-muted)' }}>
              Dê um apelido para o seu novo mascote. Você pode mudar depois.
            </p>
            <input
              type="text"
              value={apelidoInput}
              onChange={e => setApelidoInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') salvarApelido() }}
              autoFocus
              maxLength={40}
              placeholder={catalogo.find(c => c.id === modalApelido)?.label}
              className="w-full rounded-lg px-3 py-2.5 text-[16px] focus:outline-none transition-colors"
              style={{
                background:  'var(--bg-input)',
                color:       'var(--text-primary)',
                border:      '1px solid var(--border-subtle)',
              }}
            />
            <div className="flex gap-2 mt-4">
              <button
                type="button"
                onClick={() => setModalApelido(null)}
                className="flex-1 py-2.5 rounded-lg text-[16px] font-medium transition-colors hover:opacity-80"
                style={{ border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
              >
                Manter "{catalogo.find(c => c.id === modalApelido)?.label}"
              </button>
              <button
                type="button"
                onClick={salvarApelido}
                className="flex-1 py-2.5 rounded-lg text-[16px] font-semibold transition-colors hover:opacity-90"
                style={{ background: '#00c896', color: '#0a0f1a' }}
              >
                Salvar nome
              </button>
            </div>
          </div>
        </div>
      )}
    </Secao>
  )
}

/** Picker de família de layout — grade de cards com preview, mascote, e
 *  preview lado-a-lado dos modos dia/noite. O modo é alternado pelo botão
 *  sol/lua da sidebar (mesma origem do `toggle()`). A escolha persiste em
 *  `arqvalor.usuarios.layout` via useTheme. */
function SecaoTema() {
  const { familia, modo, familias, setFamilia, toggle } = useTheme()
  return (
    <Secao titulo="Aparência" icone={<Palette size={15}/>}>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <p className="text-[15px] text-white/40 leading-relaxed flex-1">
          Escolha o layout do app. O ícone sol/lua na barra lateral alterna entre <strong>dia</strong> e <strong>noite</strong> dentro da família escolhida.
        </p>
        <button
          type="button"
          onClick={toggle}
          className="px-2.5 py-1 rounded-lg border text-[13px] font-semibold transition-all hover:opacity-80 flex-shrink-0"
          style={{
            borderColor: 'rgba(255,255,255,0.15)',
            background:  modo === 'noite' ? 'rgba(77,166,255,0.12)' : 'rgba(240,180,41,0.12)',
            color:       modo === 'noite' ? '#4da6ff' : '#f0b429',
          }}
          title="Alternar entre modo dia e modo noite"
        >
          Modo: {modo === 'noite' ? '🌙 Noite' : '☀️ Dia'}
        </button>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {familias.map(f => {
          const ativo = f.id === familia.id
          const cor   = f.cores[modo]  // preview da cor no modo atual
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => setFamilia(f.id)}
              className="text-left rounded-xl overflow-hidden border-2 transition-all hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-av-green/40"
              style={{
                borderColor: ativo ? '#00c896' : 'rgba(255,255,255,0.10)',
                background:  cor.bg,
              }}
              title={f.descricao}
              aria-pressed={ativo}
            >
              {/* Faixa superior com mascote + nome + swatches dia/noite */}
              <div className="flex items-center gap-2 px-3 pt-3">
                {f.mascote ? (
                  <img
                    src={`/mascotes/${f.mascote}-hero.png`}
                    alt=""
                    width={40}
                    height={40}
                    className="object-contain flex-shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                  />
                ) : (
                  <div
                    className="w-10 h-10 rounded-lg flex-shrink-0 flex items-center justify-center text-[20px]"
                    style={{ background: cor.accent + '22', color: cor.accent }}
                  >★</div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[16px] font-semibold truncate" style={{ color: cor.text }}>
                    {f.label}
                  </p>
                  <p
                    className="text-[12.5px] truncate"
                    style={{ color: cor.text, opacity: 0.55 }}
                  >
                    {ativo
                      ? `Ativo · modo ${modo === 'noite' ? 'noite' : 'dia'}`
                      : 'Toque para aplicar'}
                  </p>
                </div>
                {/* Swatches mostrando dia + noite lado a lado */}
                <div className="flex flex-col gap-1 flex-shrink-0" title="Cores dia / noite">
                  <span
                    className="w-3.5 h-3.5 rounded-full border"
                    style={{ background: f.cores.dia.bg, borderColor: 'rgba(0,0,0,0.25)' }}
                  />
                  <span
                    className="w-3.5 h-3.5 rounded-full border"
                    style={{ background: f.cores.noite.bg, borderColor: 'rgba(255,255,255,0.25)' }}
                  />
                </div>
              </div>
              {/* Descrição */}
              <p
                className="text-[13px] px-3 pb-3 pt-2 leading-snug"
                style={{ color: cor.text, opacity: 0.7 }}
              >
                {f.descricao}
              </p>
              {/* Barra de sotaque colorido (cor identidade da família) */}
              <div
                className="h-1 w-full"
                style={{ background: cor.accent }}
              />
            </button>
          )
        })}
      </div>
      <p className="text-[13px] text-white/30 mt-3 leading-relaxed">
        Preferência salva em <code>arqvalor.usuarios.layout</code> e sincronizada entre dispositivos.
      </p>
    </Secao>
  )
}

/** Configuração da integração com IA: MÚLTIPLAS configs, UMA ativa.
 *  Cada usuário usa SUA própria chave (paga seu próprio uso). */
function SecaoIA() {
  const { ativa, configs, carregando, salvando, adicionar, atualizar, ativar, remover } = useIAPreferencia()

  const [adicionando, setAdicionando] = useState(false)
  const [editando,    setEditando]    = useState<string | null>(null)
  const [provedorId,  setProvedorId]  = useState<string>(PROVEDOR_PADRAO)
  const [chave,       setChave]       = useState('')
  const [nome,        setNome]        = useState('')
  const [expandido,   setExpandido]   = useState<string | null>(null)
  const [fb,          setFb]          = useState<Feedback | null>(null)
  const [confirmRemover, setConfirmRemover] = useState<string | null>(null)

  const provedorAtual = PROVEDORES.find(p => p.id === provedorId) ?? PROVEDORES[0]

  const abrirNova = () => {
    setAdicionando(true)
    setEditando(null)
    setProvedorId(PROVEDOR_PADRAO)
    setChave('')
    setNome('')
    setFb(null)
  }

  const abrirEditar = (configId: string) => {
    const c = configs.find(x => x.id === configId)
    if (!c) return
    setAdicionando(false)
    setEditando(configId)
    setProvedorId(c.provedor)
    setChave('')
    setNome(c.nome ?? '')
    setFb(null)
  }

  const cancelar = () => {
    setAdicionando(false)
    setEditando(null)
    setFb(null)
  }

  const aoSalvar = async (e: FormEvent) => {
    e.preventDefault()
    setFb(null)
    let r: { ok: boolean; erro?: string }
    if (editando) {
      r = await atualizar(editando, { provedor: provedorId, api_key: chave, nome })
    } else {
      r = await adicionar(provedorId, chave, nome)
    }
    if (r.ok) {
      setFb({ tipo: 'ok', msg: 'Configuração salva.' })
      setChave('')
      setNome('')
      setAdicionando(false)
      setEditando(null)
    } else {
      setFb({ tipo: 'erro', msg: r.erro ?? 'Erro ao salvar.' })
    }
  }

  const aoAtivar = async (configId: string) => {
    setFb(null)
    const r = await ativar(configId)
    if (!r.ok) setFb({ tipo: 'erro', msg: r.erro ?? 'Erro ao ativar.' })
  }

  const aoRemover = async (configId: string) => {
    setFb(null)
    const r = await remover(configId)
    if (r.ok) {
      setConfirmRemover(null)
    } else {
      setFb({ tipo: 'erro', msg: r.erro ?? 'Erro ao remover.' })
    }
  }

  const editandoFormulario = adicionando || editando !== null

  return (
    <Secao titulo="Integração com IA" icone={<Sparkles size={15}/>}>
      <p className="text-[15px] mb-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
        Configure um ou mais provedores de IA. Só a configuração marcada como{' '}
        <strong style={{ color: 'var(--text-primary)' }}>ativa</strong> é usada pelo chat com o mascote —
        as outras ficam guardadas para troca rápida.
      </p>

      {carregando ? (
        <p className="text-[15px]" style={{ color: 'var(--text-muted)' }}>Carregando configurações…</p>
      ) : (
        <>
          {/* Lista de configs salvas */}
          {configs.length > 0 && (
            <div className="space-y-2 mb-4">
              {configs.map(c => {
                const p = PROVEDORES.find(x => x.id === c.provedor)
                const ehAtiva = c.id === ativa?.id
                return (
                  <div
                    key={c.id}
                    className="rounded-xl p-3 border transition-all"
                    style={{
                      background:  ehAtiva ? 'rgba(0,200,150,0.08)' : 'var(--bg-elevated)',
                      borderColor: ehAtiva ? 'rgba(0,200,150,0.35)' : 'var(--border-subtle)',
                    }}
                  >
                    <div className="flex items-start gap-2 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-[16px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                            {p?.label ?? c.provedor}
                          </span>
                          {c.nome && (
                            <span className="text-[14px] px-1.5 py-0.5 rounded" style={{ color: 'var(--text-secondary)', background: 'var(--tint-2)' }}>
                              {c.nome}
                            </span>
                          )}
                          {ehAtiva && (
                            <span className="text-[12px] font-semibold uppercase tracking-wider" style={{ color: '#00c896' }}>
                              ✓ Ativa
                            </span>
                          )}
                        </div>
                        <p className="text-[13px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                          Chave salva · oculta por segurança
                        </p>
                      </div>
                      <div className="flex gap-1.5 flex-wrap">
                        {!ehAtiva && (
                          <button
                            type="button"
                            onClick={() => aoAtivar(c.id)}
                            disabled={salvando}
                            className="px-2.5 py-1 rounded-lg text-[14px] font-semibold transition-colors disabled:opacity-50"
                            style={{ background: 'rgba(0,200,150,0.12)', color: '#00c896', border: '1px solid rgba(0,200,150,0.3)' }}
                          >
                            Ativar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => abrirEditar(c.id)}
                          disabled={salvando}
                          className="px-2.5 py-1 rounded-lg text-[14px] font-medium transition-colors disabled:opacity-50"
                          style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
                        >
                          Editar
                        </button>
                        {confirmRemover === c.id ? (
                          <>
                            <button
                              type="button"
                              onClick={() => aoRemover(c.id)}
                              disabled={salvando}
                              className="px-2.5 py-1 rounded-lg text-[14px] font-semibold transition-colors disabled:opacity-50"
                              style={{ background: 'rgba(248,113,113,0.15)', color: '#f87171', border: '1px solid rgba(248,113,113,0.35)' }}
                            >
                              Confirmar
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmRemover(null)}
                              className="px-2 py-1 rounded-lg text-[14px]"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              ×
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmRemover(c.id)}
                            className="px-2.5 py-1 rounded-lg text-[14px] font-medium transition-colors hover:text-red-300"
                            style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
                          >
                            Remover
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Botão adicionar (quando NÃO está editando) */}
          {!editandoFormulario && (
            <button
              type="button"
              onClick={abrirNova}
              disabled={salvando}
              className="w-full py-2.5 rounded-xl text-[15px] font-semibold transition-colors disabled:opacity-50"
              style={{
                background:  configs.length === 0 ? '#00c896' : 'var(--tint-2)',
                color:       configs.length === 0 ? '#0a0f1a' : 'var(--text-primary)',
                border:      configs.length === 0 ? 'none' : '1px dashed var(--border-subtle)',
              }}
            >
              + {configs.length === 0 ? 'Configurar primeira integração' : 'Adicionar outra configuração'}
            </button>
          )}

          {/* Formulário (criar / editar) */}
          {editandoFormulario && (
            <form
              onSubmit={aoSalvar}
              className="space-y-3 rounded-xl p-3 mt-1"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}
            >
              <p className="text-[15px] font-semibold" style={{ color: 'var(--text-primary)' }}>
                {editando ? 'Editar configuração' : 'Nova configuração'}
              </p>

              <div>
                <label className="block text-[14px] mb-1" style={{ color: 'var(--text-muted)' }}>Provedor</label>
                <select
                  value={provedorId}
                  onChange={e => { setProvedorId(e.target.value); setFb(null) }}
                  disabled={salvando}
                  className="w-full rounded-lg px-3 py-2.5 text-[16px] focus:outline-none focus:border-av-green/50 disabled:opacity-50"
                  style={{
                    background:  'var(--bg-input)',
                    color:       'var(--text-primary)',
                    border:      '1px solid var(--border-subtle)',
                    colorScheme: 'auto',
                  }}
                >
                  {PROVEDORES.map(p => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-[14px] mb-1" style={{ color: 'var(--text-muted)' }}>
                  Apelido (opcional) <span className="text-[12px] ml-1" style={{ color: 'var(--text-faint)' }}>ex.: Pessoal, Trabalho</span>
                </label>
                <input
                  type="text"
                  value={nome}
                  onChange={e => setNome(e.target.value)}
                  disabled={salvando}
                  maxLength={32}
                  placeholder="Sem apelido"
                  className="w-full rounded-lg px-3 py-2.5 text-[16px] focus:outline-none disabled:opacity-50"
                  style={{
                    background: 'var(--bg-input)',
                    color:      'var(--text-primary)',
                    border:     '1px solid var(--border-subtle)',
                  }}
                />
              </div>

              {/* Instruções específicas */}
              <div className="rounded-xl overflow-hidden" style={{ background: 'var(--tint-1)', border: '1px solid var(--border-subtle)' }}>
                <button
                  type="button"
                  onClick={() => setExpandido(v => v === provedorAtual.id ? null : provedorAtual.id)}
                  className="w-full flex items-center justify-between px-3 py-2.5 hover:opacity-80 transition-opacity"
                >
                  <span className="text-[14px] font-medium flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                    <Sparkles size={13} style={{ color: '#f0b429' }}/>
                    Como obter a chave do {provedorAtual.label}
                  </span>
                  <ChevronDown size={14} className="transition-transform"
                    style={{ color: 'var(--text-muted)', transform: expandido === provedorAtual.id ? 'rotate(180deg)' : 'rotate(0deg)' }}/>
                </button>
                {expandido === provedorAtual.id && (
                  <div className="px-3 pb-3 pt-1 space-y-2" style={{ borderTop: '1px solid var(--border-faint)' }}>
                    <p className="text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>{provedorAtual.custo}</p>
                    <ol className="space-y-1 list-decimal list-inside">
                      {provedorAtual.passos.map((p, i) => (
                        <li key={i} className="text-[13px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>{p}</li>
                      ))}
                    </ol>
                    <a
                      href={provedorAtual.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-[13px] hover:opacity-80"
                      style={{ color: 'var(--av-blue)' }}
                    >
                      <ArrowRight size={12}/> Abrir página do {provedorAtual.label}
                    </a>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[14px] mb-1" style={{ color: 'var(--text-muted)' }}>
                  Chave da API{editando && (
                    <span className="text-[12px] ml-2" style={{ color: 'var(--text-faint)' }}>(em branco mantém a atual)</span>
                  )}
                </label>
                <input
                  type="password"
                  value={chave}
                  onChange={e => { setChave(e.target.value); setFb(null) }}
                  disabled={salvando}
                  placeholder={provedorAtual.formatoDica}
                  className="w-full rounded-lg px-3 py-2.5 text-[16px] focus:outline-none font-mono disabled:opacity-50"
                  style={{
                    background: 'var(--bg-input)',
                    color:      'var(--text-primary)',
                    border:     '1px solid var(--border-subtle)',
                  }}
                  autoComplete="off"
                />
              </div>

              <div className="flex gap-2 flex-wrap">
                <button
                  type="submit"
                  disabled={salvando}
                  className="px-4 py-2 rounded-lg text-[15px] font-semibold transition-colors disabled:opacity-50"
                  style={{ background: '#00c896', color: '#0a0f1a' }}
                >
                  {salvando ? 'Salvando…' : (editando ? 'Salvar alterações' : 'Adicionar')}
                </button>
                <button
                  type="button"
                  onClick={cancelar}
                  className="px-4 py-2 rounded-lg text-[15px] font-medium transition-colors hover:opacity-80"
                  style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)' }}
                >
                  Cancelar
                </button>
              </div>
            </form>
          )}

          <Alerta fb={fb}/>
        </>
      )}

      <p className="text-[13px] mt-4 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
        As chaves ficam em <code>arqvalor.usuarios.ia_configs</code> e só são acessíveis
        a partir da sua conta (RLS). Cada conversa é enviada para o servidor do
        provedor ATIVO.
      </p>
    </Secao>
  )
}

export default function PerfilPage() {
  const { session } = useAuth()
  const navigate    = useNavigate()
  const user = session?.user

  const nomeAtual  = user?.user_metadata?.nome ?? user?.email?.split('@')[0] ?? ''
  const emailAtual = user?.email ?? ''

  // ── Nome ────────────────────────────────────────────────────
  const [nome, setNome]         = useState(nomeAtual)
  useEffect(() => {
    if (user) setNome(user.user_metadata?.nome ?? user.email?.split('@')[0] ?? '')
  }, [user])
  const [fbNome, setFbNome]     = useState<Feedback | null>(null)
  const [loadNome, setLoadNome] = useState(false)

  const salvarNome = async (e: FormEvent) => {
    e.preventDefault()
    if (!nome.trim()) return
    setFbNome(null)
    setLoadNome(true)
    const { error } = await supabase.auth.updateUser({ data: { nome: nome.trim() } })
    if (!error) {
      await supabase.schema('arqvalor').from('usuarios')
        .update({ nome: nome.trim() }).eq('id', user!.id)
    }
    setLoadNome(false)
    setFbNome(error
      ? { tipo: 'erro', msg: 'Não foi possível atualizar o nome.' }
      : { tipo: 'ok',   msg: 'Nome atualizado com sucesso.' }
    )
  }

  // ── Senha ────────────────────────────────────────────────────
  const [senhaAtual,  setSenhaAtual]  = useState('')
  const [novaSenha,   setNovaSenha]   = useState('')
  const [confirmar,   setConfirmar]   = useState('')
  const [fbSenha,     setFbSenha]     = useState<Feedback | null>(null)
  const [loadSenha,   setLoadSenha]   = useState(false)

  const salvarSenha = async (e: FormEvent) => {
    e.preventDefault()
    setFbSenha(null)
    if (novaSenha.length < 6) {
      setFbSenha({ tipo: 'erro', msg: 'A nova senha deve ter pelo menos 6 caracteres.' })
      return
    }
    if (novaSenha !== confirmar) {
      setFbSenha({ tipo: 'erro', msg: 'As senhas não coincidem.' })
      return
    }
    setLoadSenha(true)
    const { error: errLogin } = await supabase.auth.signInWithPassword({ email: emailAtual, password: senhaAtual })
    if (errLogin) {
      setLoadSenha(false)
      setFbSenha({ tipo: 'erro', msg: 'Senha atual incorreta.' })
      return
    }
    const { error } = await supabase.auth.updateUser({ password: novaSenha })
    setLoadSenha(false)
    if (error) {
      setFbSenha({ tipo: 'erro', msg: 'Não foi possível atualizar a senha.' })
    } else {
      setFbSenha({ tipo: 'ok', msg: 'Senha atualizada com sucesso.' })
      setSenhaAtual(''); setNovaSenha(''); setConfirmar('')
    }
  }

  // ── Filtros salvos ──────────────────────────────────────────
  const { filtros, carregando: carregandoFiltros, renomear: renomearFiltro, excluir: excluirFiltro, excluirTodos } =
    useFiltrosSalvos()
  const [editandoId,   setEditandoId]   = useState<string | null>(null)
  const [editandoNome, setEditandoNome] = useState('')
  const [salvandoNome, setSalvandoNome] = useState(false)
  const [filtroExpandido, setFiltroExpandido] = useState<string | null>(null)

  const iniciarEdicao = (id: string, nomeAtual: string) => {
    setEditandoId(id); setEditandoNome(nomeAtual); setFiltroExpandido(null)
  }
  const confirmarEdicao = async (id: string) => {
    const n = editandoNome.trim()
    if (!n) return
    setSalvandoNome(true)
    await renomearFiltro(id, n)
    setSalvandoNome(false)
    setEditandoId(null)
  }

  const { contas }     = useContas()
  const { categorias } = useCategorias()

  // ── Assistente de Lançamentos ────────────────────────────────
  const qc = useQueryClient()
  const { sugestoes, carregando: carregandoAss, editar: editarAss, excluir: excluirAss, excluirTodas: excluirTodasAss } =
    useSugestoes()
  const [editandoAss,     setEditandoAss]     = useState<string | null>(null)
  const [editandoAssDesc, setEditandoAssDesc] = useState('')
  const [salvandoAss,     setSalvandoAss]     = useState(false)
  const [buscaAss,        setBuscaAss]        = useState('')
  const [paginaAss,       setPaginaAss]       = useState(0)

  const iniciarEdicaoAss = (id: string, descricao: string) => {
    setEditandoAss(id); setEditandoAssDesc(descricao)
  }
  const confirmarEdicaoAss = async (id: string) => {
    const d = editandoAssDesc.trim()
    if (d.length < 2) return
    setSalvandoAss(true)
    await editarAss(id, d)
    setSalvandoAss(false)
    setEditandoAss(null)
  }

  const sugestoesFiltradas = useMemo(() => {
    if (!buscaAss.trim()) return sugestoes
    const t = buscaAss.toLowerCase()
    return sugestoes.filter(s =>
      s.descricao.toLowerCase().includes(t) ||
      (contas.find(c => c.conta_id === s.conta_origem_id)?.nome ?? '').toLowerCase().includes(t) ||
      (categorias.find(c => c.id === s.categoria_id)?.descricao ?? '').toLowerCase().includes(t),
    )
  }, [sugestoes, buscaAss, contas, categorias])

  const totalPaginas  = Math.max(1, Math.ceil(sugestoesFiltradas.length / ITEMS_PER_PAGE))
  const paginaSegura  = Math.min(paginaAss, totalPaginas - 1)
  const sugestoesPage = sugestoesFiltradas.slice(paginaSegura * ITEMS_PER_PAGE, (paginaSegura + 1) * ITEMS_PER_PAGE)

  const mudarBusca = (v: string) => { setBuscaAss(v); setPaginaAss(0) }

  // ── Análise de padrões ───────────────────────────────────────
  const [analisando,   setAnalisando]   = useState(false)
  const [sugeridas,    setSugeridas]    = useState<SugestaoSugerida[] | null>(null)
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set())
  const [salvandoSug,  setSalvandoSug]  = useState(false)
  const [resultadoSug, setResultadoSug] = useState<{ ok: number; fail: number } | null>(null)

  const analisarPadroes = async () => {
    setAnalisando(true)
    try {
      const d = new Date()
      const mesBase = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const meses = Array.from({ length: 12 }, (_, i) => mesAdjacente(mesBase, -i))
      const resultados = await Promise.all(
        meses.map(m => fetchLancamentos({ mes: m, status_ids: ['PAGO', 'PENDENTE'] }).catch(() => [] as Lancamento[])),
      )
      const base = resultados.flat().filter(l =>
        l.status !== 'PROJECAO' && !l.id_par_transferencia && l.categoria_nome !== 'Transferências',
      )

      const grupos = new Map<string, Lancamento[]>()
      for (const l of base) {
        const key = normDesc(l.descricao) + '||' + (l.categoria_id ?? '') + '||' + l.conta_id
        const arr = grupos.get(key) ?? []
        arr.push(l)
        grupos.set(key, arr)
      }

      const existentes = new Set(sugestoes.map(s => s.descricao.toLowerCase().trim()))
      const novas: SugestaoSugerida[] = []

      for (const [key, items] of grupos) {
        if (items.length < 2) continue
        const freq = new Map<string, number>()
        for (const l of items) freq.set(l.descricao, (freq.get(l.descricao) ?? 0) + 1)
        const descTop = [...freq.entries()].sort((a, b) => b[1] - a[1])[0][0]
        if (existentes.has(descTop.toLowerCase().trim())) continue
        const ex = items[0]
        novas.push({
          key,
          descricao:      descTop,
          categoria_id:   ex.categoria_id,
          categoria_nome: ex.categoria_nome ?? ex.categoria_pai_nome ?? null,
          conta_id:       ex.conta_id,
          conta_nome:     ex.conta_nome ?? null,
          ocorrencias:    items.length,
        })
      }

      novas.sort((a, b) => {
        const desc = a.descricao.localeCompare(b.descricao)
        if (desc !== 0) return desc
        const cn = (a.conta_nome ?? '').localeCompare(b.conta_nome ?? '')
        if (cn !== 0) return cn
        return (a.categoria_nome ?? '').localeCompare(b.categoria_nome ?? '')
      })
      setSugeridas(novas)
      setSelecionadas(new Set(novas.map(s => s.key)))
      setResultadoSug(null)
    } finally {
      setAnalisando(false)
    }
  }

  const adicionarSelecionadas = async () => {
    if (!sugeridas) return
    const lista = sugeridas.filter(s => selecionadas.has(s.key))
    if (!lista.length) return
    setSalvandoSug(true)
    let ok = 0, fail = 0
    for (const s of lista) {
      const r = await salvarSugestao({
        descricao:        s.descricao,
        categoria_id:     s.categoria_id,
        conta_origem_id:  s.conta_id,
        is_transferencia: false,
      })
      if (r.ok) ok++; else fail++
    }
    await qc.invalidateQueries({ queryKey: qk.assistente() })
    setSalvandoSug(false)
    setResultadoSug({ ok, fail })
    setSugeridas(prev => prev?.filter(s => !selecionadas.has(s.key)) ?? [])
    setSelecionadas(new Set())
  }

  // ── Filtros: metadados ──────────────────────────────────────
  const PAGINA_LABEL: Record<string, string> = {
    extrato: 'Extrato', relatorios: 'Relatórios', dashboard: 'Dashboard',
  }

  function detalhesFiltro(dados: Record<string, unknown>): { label: string; valor: string }[] {
    const linhas: { label: string; valor: string }[] = []
    const ids = (key: string) => (dados[key] as string[] | undefined) ?? []
    const contaIds = ids('filtContas')
    if (contaIds.length)
      linhas.push({ label: 'Contas', valor: contaIds.map(id => contas.find(c => c.conta_id === id)?.nome ?? id).join(', ') })
    const catIds = ids('filtCats')
    if (catIds.length)
      linhas.push({ label: 'Categorias', valor: catIds.map(id => categorias.find(c => c.id === id)?.descricao ?? id).join(', ') })
    const statusIds = ids('filtStatus')
    if (statusIds.length)
      linhas.push({ label: 'Status', valor: statusIds.map(s => STATUS_LABEL[s] ?? s).join(', ') })
    if (dados.incluirTransf === true)  linhas.push({ label: 'Transferências', valor: 'Incluídas' })
    if (dados.comSaldo === false)      linhas.push({ label: 'Saldo anterior', valor: 'Desativado' })
    return linhas
  }

  // ── Exclusão de conta ───────────────────────────────────────
  const [zonaPerigo,   setZonaPerigo]   = useState(false)
  const [modalExcluir, setModalExcluir] = useState(false)
  const [confirmText,  setConfirmText]  = useState('')
  const [loadExcluir,  setLoadExcluir]  = useState(false)
  const [erroExcluir,  setErroExcluir]  = useState('')

  const excluirConta = async () => {
    if (confirmText !== 'EXCLUIR') return
    setErroExcluir('')
    setLoadExcluir(true)
    const { ok, erro: msg } = await apiMutate('/excluir_conta', 'POST')
    if (!ok) {
      setLoadExcluir(false)
      setErroExcluir(msg ?? 'Não foi possível excluir a conta.')
      return
    }
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  const input = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[17px] text-white placeholder-white/20 focus:outline-none focus:border-av-green/50 transition-colors'
  const label = 'block text-[16px] text-white/50 mb-1.5'
  const btn   = 'px-4 py-2 rounded-lg text-[16px] font-semibold transition-colors disabled:opacity-50'

  return (
    <div className="p-5 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-[21px] font-bold text-white">Meu Perfil</h1>
        <p className="text-[16px] text-white/40 mt-0.5">{emailAtual}</p>
      </div>

      <div className="space-y-4">

        {/* ── Linha 1: Dados pessoais | Alterar senha ──────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Dados pessoais */}
          <Secao titulo="Dados pessoais" icone={<User size={15}/>}>
            <form onSubmit={salvarNome} className="space-y-3">
              <div>
                <label className={label}>Nome de exibição</label>
                <input type="text" required value={nome} onChange={e => setNome(e.target.value)}
                  className={input} placeholder="Seu nome"/>
              </div>
              <div>
                <label className={label}>E-mail</label>
                <input type="email" disabled value={emailAtual}
                  className={`${input} opacity-40 cursor-not-allowed`}/>
                <p className="text-[15px] text-white/25 mt-1">O e-mail não pode ser alterado por aqui.</p>
              </div>
              <div className="flex justify-end pt-1">
                <button type="submit" disabled={loadNome || nome.trim() === nomeAtual}
                  className={`${btn} bg-av-green text-av-dark hover:bg-av-green/90`}>
                  {loadNome ? 'Salvando...' : 'Salvar nome'}
                </button>
              </div>
              <Alerta fb={fbNome}/>
            </form>
          </Secao>

          {/* Alterar senha */}
          <Secao titulo="Alterar senha" icone={<Lock size={15}/>}>
            <form onSubmit={salvarSenha} className="space-y-3">
              <div>
                <label className={label}>Senha atual</label>
                <input type="password" required value={senhaAtual} onChange={e => setSenhaAtual(e.target.value)}
                  className={input} placeholder="••••••••"/>
              </div>
              <div>
                <label className={label}>Nova senha</label>
                <input type="password" required value={novaSenha} onChange={e => setNovaSenha(e.target.value)}
                  className={input} placeholder="Mínimo 6 caracteres"/>
              </div>
              <div>
                <label className={label}>Confirmar nova senha</label>
                <input type="password" required value={confirmar} onChange={e => setConfirmar(e.target.value)}
                  className={input} placeholder="••••••••"/>
              </div>
              <div className="flex justify-end pt-1">
                <button type="submit" disabled={loadSenha}
                  className={`${btn} bg-blue-500/20 text-blue-300 hover:bg-blue-500/30`}>
                  {loadSenha ? 'Atualizando...' : 'Atualizar senha'}
                </button>
              </div>
              <Alerta fb={fbSenha}/>
            </form>
          </Secao>

        </div>{/* fim Linha 1 */}

        {/* ── Linha 2: Filtros salvos | Assistente de Lançamentos ─ */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Filtros salvos */}
          <Secao titulo="Filtros salvos" icone={<Bookmark size={15}/>}>
            {carregandoFiltros ? (
              <p className="text-[16px] text-white/40">Carregando…</p>
            ) : filtros.length === 0 ? (
              <p className="text-[16px] text-white/40">Nenhum filtro salvo.</p>
            ) : (
              <>
                <div className="space-y-0.5">
                  {filtros.map(f => {
                    const expandido = filtroExpandido === f.id
                    const editando  = editandoId === f.id
                    const detalhes  = detalhesFiltro(f.dados)
                    return (
                      <div key={f.id}>
                        {editando ? (
                          <div className="flex items-center gap-2 px-2 py-1.5">
                            <span className="text-[13px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: 'rgba(77,166,255,0.12)', color: '#4da6ff' }}>
                              {PAGINA_LABEL[f.pagina] ?? f.pagina}
                            </span>
                            <input autoFocus value={editandoNome} onChange={e => setEditandoNome(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') confirmarEdicao(f.id)
                                if (e.key === 'Escape') setEditandoId(null)
                              }}
                              className="flex-1 text-[16px] bg-white/5 border border-white/15 rounded-md px-2 py-0.5 focus:outline-none focus:border-av-green/40"
                              style={{ color: '#e8eaf0' }} maxLength={50}/>
                            <button onClick={() => confirmarEdicao(f.id)} disabled={!editandoNome.trim() || salvandoNome}
                              title="Salvar nome"
                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-av-green/10 flex-shrink-0 disabled:opacity-40"
                              style={{ color: '#00c896' }}><Check size={12}/></button>
                            <button onClick={() => setEditandoId(null)} title="Cancelar"
                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 flex-shrink-0"
                              style={{ color: '#8b92a8' }}><X size={12}/></button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-white/[0.03] group cursor-pointer"
                            onClick={() => setFiltroExpandido(expandido ? null : f.id)}>
                            <span className="text-[13px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: 'rgba(77,166,255,0.12)', color: '#4da6ff' }}>
                              {PAGINA_LABEL[f.pagina] ?? f.pagina}
                            </span>
                            <span className="flex-1 text-[16px] truncate" style={{ color: '#c5cad8' }}>{f.nome}</span>
                            <ChevronDown size={12} className="flex-shrink-0 transition-transform"
                              style={{ color: '#4a5168', transform: expandido ? 'rotate(180deg)' : 'rotate(0deg)' }}/>
                            <button onClick={e => { e.stopPropagation(); iniciarEdicao(f.id, f.nome) }} title="Renomear filtro"
                              className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 flex-shrink-0"
                              style={{ color: '#8b92a8' }}><Pencil size={11}/></button>
                            <button onClick={e => { e.stopPropagation(); excluirFiltro(f.id) }} title="Excluir filtro"
                              className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded hover:bg-red-400/10 flex-shrink-0"
                              style={{ color: '#f87171' }}><X size={12}/></button>
                          </div>
                        )}
                        {expandido && !editando && (
                          <div className="mx-2 mb-1 px-3 py-2 rounded-lg"
                            style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                            {detalhes.length === 0 ? (
                              <p className="text-[15px]" style={{ color: '#4a5168' }}>Sem filtros específicos definidos.</p>
                            ) : (
                              <div className="space-y-1">
                                {detalhes.map(d => (
                                  <div key={d.label} className="flex gap-2">
                                    <span className="text-[14px] font-semibold w-24 flex-shrink-0" style={{ color: '#8b92a8' }}>{d.label}</span>
                                    <span className="text-[15px]" style={{ color: '#c5cad8' }}>{d.valor}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex justify-end pt-3 mt-2 border-t border-white/8">
                  <button onClick={excluirTodos}
                    className="px-3 py-1.5 rounded-lg text-[15px] font-semibold border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors">
                    Remover todos ({filtros.length})
                  </button>
                </div>
              </>
            )}
          </Secao>

          {/* Assistente de Lançamentos */}
          <Secao titulo="Assistente de Lançamentos" icone={<Sparkles size={15}/>}>

            {/* Toolbar: busca + analisar */}
            <div className="flex items-center gap-2 mb-3">
              <div className="relative flex-1">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: '#4a5168' }}/>
                <input
                  type="text" value={buscaAss} onChange={e => mudarBusca(e.target.value)}
                  placeholder="Buscar padrão…"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-7 pr-3 py-1.5 text-[16px] placeholder-white/20 focus:outline-none focus:border-white/20 transition-colors"
                  style={{ color: '#c5cad8' }}
                />
              </div>
              <button onClick={analisarPadroes} disabled={analisando}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[15px] font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
                style={{ background: 'rgba(167,139,250,0.10)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.20)' }}>
                {analisando
                  ? <><RefreshCw size={12} className="animate-spin"/> Analisando…</>
                  : <><Wand2 size={12}/> Analisar</>
                }
              </button>
            </div>

            {carregandoAss ? (
              <p className="text-[16px] text-white/40">Carregando…</p>
            ) : sugestoes.length === 0 ? (
              <p className="text-[16px] text-white/40 leading-relaxed">
                Nenhum padrão registrado. Os padrões são criados automaticamente ao salvar lançamentos.
              </p>
            ) : (
              <>
                {/* Lista */}
                <div className="space-y-0.5 max-h-[260px] overflow-y-auto pr-0.5">
                  {sugestoesPage.map(s => {
                    const editando     = editandoAss === s.id
                    const catNome      = categorias.find(c => c.id === s.categoria_id)?.descricao
                    const contaOrigem  = contas.find(c => c.conta_id === s.conta_origem_id)?.nome
                    const contaDestino = contas.find(c => c.conta_id === s.conta_destino_id)?.nome
                    return (
                      <div key={s.id}>
                        {editando ? (
                          <div className="flex items-center gap-2 px-2 py-1.5">
                            {s.is_transferencia && (
                              <span className="text-[13px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                                style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c' }}>Transf.</span>
                            )}
                            <input autoFocus value={editandoAssDesc} onChange={e => setEditandoAssDesc(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === 'Enter')  confirmarEdicaoAss(s.id)
                                if (e.key === 'Escape') setEditandoAss(null)
                              }}
                              className="flex-1 text-[16px] bg-white/5 border border-white/15 rounded-md px-2 py-0.5 focus:outline-none focus:border-av-green/40"
                              style={{ color: '#e8eaf0' }} maxLength={200}/>
                            <button onClick={() => confirmarEdicaoAss(s.id)}
                              disabled={editandoAssDesc.trim().length < 2 || salvandoAss} title="Salvar"
                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-av-green/10 flex-shrink-0 disabled:opacity-40"
                              style={{ color: '#00c896' }}><Check size={12}/></button>
                            <button onClick={() => setEditandoAss(null)} title="Cancelar"
                              className="w-5 h-5 flex items-center justify-center rounded hover:bg-white/5 flex-shrink-0"
                              style={{ color: '#8b92a8' }}><X size={12}/></button>
                          </div>
                        ) : (
                          <div className="group px-2 py-1.5 rounded-lg hover:bg-white/[0.03]">
                            <div className="flex items-center gap-2">
                              {s.is_transferencia && (
                                <span className="text-[13px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0"
                                  style={{ background: 'rgba(251,146,60,0.12)', color: '#fb923c' }}>Transf.</span>
                              )}
                              <span className="flex-1 text-[16px] truncate" style={{ color: '#c5cad8' }}>{s.descricao}</span>
                              <button onClick={() => iniciarEdicaoAss(s.id, s.descricao)} title="Editar descrição"
                                className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded hover:bg-white/10 flex-shrink-0"
                                style={{ color: '#8b92a8' }}><Pencil size={11}/></button>
                              <button onClick={() => excluirAss(s.id)} title="Excluir padrão"
                                className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 flex items-center justify-center rounded hover:bg-red-400/10 flex-shrink-0"
                                style={{ color: '#f87171' }}><X size={12}/></button>
                            </div>
                            {(catNome || contaOrigem) && (
                              <div className="flex items-center gap-2 mt-0.5 pl-0.5 flex-wrap">
                                {contaOrigem && (
                                  <span className="text-[14px]" style={{ color: '#4a5168' }}>
                                    {contaOrigem}
                                    {contaDestino && <><ArrowRight size={9} className="inline mx-0.5"/>{contaDestino}</>}
                                  </span>
                                )}
                                {catNome && (
                                  <span className="text-[14px]" style={{ color: '#4a5168' }}>
                                    {contaOrigem ? '· ' : ''}{catNome}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}

                  {sugestoesFiltradas.length === 0 && buscaAss && (
                    <p className="text-[16px] px-2 py-3 text-center" style={{ color: '#4a5168' }}>
                      Nenhum padrão encontrado para "{buscaAss}".
                    </p>
                  )}
                </div>

                {/* Paginação + rodapé */}
                <div className="flex items-center justify-between pt-3 mt-2 border-t border-white/8">
                  {totalPaginas > 1 ? (
                    <div className="flex items-center gap-1">
                      <button onClick={() => setPaginaAss(p => Math.max(0, p - 1))} disabled={paginaSegura === 0}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/5 disabled:opacity-30"
                        style={{ color: '#8b92a8' }}><ChevronLeft size={13}/></button>
                      <span className="text-[15px] px-1 tabular-nums" style={{ color: '#4a5168' }}>
                        {paginaSegura + 1} / {totalPaginas}
                      </span>
                      <button onClick={() => setPaginaAss(p => Math.min(totalPaginas - 1, p + 1))} disabled={paginaSegura === totalPaginas - 1}
                        className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/5 disabled:opacity-30"
                        style={{ color: '#8b92a8' }}><ChevronRight size={13}/></button>
                      <span className="text-[15px] ml-1" style={{ color: '#4a5168' }}>
                        ({sugestoesFiltradas.length} {buscaAss ? 'encontrado' : 'total'}{sugestoesFiltradas.length !== 1 ? 's' : ''})
                      </span>
                    </div>
                  ) : (
                    <span className="text-[15px]" style={{ color: '#4a5168' }}>
                      {sugestoesFiltradas.length} padrão{sugestoesFiltradas.length !== 1 ? 'ões' : ''}
                      {buscaAss ? ' encontrado' : ''}
                      {sugestoesFiltradas.length !== 1 && buscaAss ? 's' : ''}
                    </span>
                  )}
                  <button onClick={excluirTodasAss}
                    className="px-3 py-1.5 rounded-lg text-[15px] font-semibold border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors">
                    Remover todos ({sugestoes.length})
                  </button>
                </div>
              </>
            )}
          </Secao>

        </div>{/* fim Linha 2 */}

        {/* ── Linha 3: Mascote favorito | Aparência ──────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SecaoMascote/>
          <SecaoTema/>
        </div>

        {/* ── Linha 4: Integração com IA (largura cheia) ──────── */}
        <SecaoIA/>

        {/* ── Linha 5: Zona de perigo (largura cheia, recolhida) ─ */}
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl overflow-hidden">
          <button type="button"
            onClick={() => setZonaPerigo(v => !v)}
            className="w-full flex items-center justify-between gap-2 px-4 py-3 hover:bg-red-500/5 transition-colors">
            <div className="flex items-center gap-2">
              <span className="text-red-400/70"><Trash2 size={14}/></span>
              <span className="text-[16px] font-semibold text-red-400">Zona de perigo</span>
            </div>
            <ChevronDown size={13} className="transition-transform flex-shrink-0"
              style={{ color: '#f87171', transform: zonaPerigo ? 'rotate(180deg)' : 'rotate(0deg)' }}/>
          </button>
          {zonaPerigo && (
            <div className="px-4 pb-4 border-t border-red-500/15 pt-3">
              <p className="text-[15px] text-white/35 mb-3 leading-relaxed">
                Remove permanentemente <strong className="text-red-400/60">todos</strong> os dados: lançamentos, contas, categorias e histórico. Ação irreversível.
              </p>
              <button type="button"
                onClick={() => { setModalExcluir(true); setConfirmText(''); setErroExcluir('') }}
                className="px-3 py-1.5 rounded-lg text-[15px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">
                Excluir minha conta
              </button>
            </div>
          )}
        </div>

      </div>{/* fim space-y-4 */}

      {/* ── Modal de padrões sugeridos ────────────────────────── */}
      {sugeridas !== null && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-4">
          <div className="w-full max-w-md rounded-2xl flex flex-col"
            style={{ background: '#0f1929', border: '1px solid rgba(255,255,255,0.08)', maxHeight: '85vh' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-white/8 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Wand2 size={15} style={{ color: '#a78bfa' }}/>
                <span className="text-[18px] font-semibold text-white">Padrões detectados</span>
                {sugeridas.length > 0 && (
                  <span className="text-[14px] font-bold px-1.5 py-0.5 rounded-full"
                    style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}>
                    {sugeridas.length}
                  </span>
                )}
              </div>
              <button onClick={() => { setSugeridas(null); setResultadoSug(null) }}
                className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-white/5"
                style={{ color: '#8b92a8' }}><X size={14}/></button>
            </div>

            {/* Feedback */}
            {resultadoSug && (
              <div className="mx-5 mt-3 px-3 py-2 rounded-lg text-[16px] flex items-center gap-2"
                style={{ background: 'rgba(0,200,150,0.08)', color: '#00c896' }}>
                <Check size={13}/>
                {resultadoSug.ok} padrão{resultadoSug.ok !== 1 ? 'ões' : ''} adicionado{resultadoSug.ok !== 1 ? 's' : ''}
                {resultadoSug.fail > 0 && <span style={{ color: '#f87171' }}>· {resultadoSug.fail} falhou</span>}
              </div>
            )}

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {sugeridas.length === 0 ? (
                <p className="text-[16px] text-center py-6" style={{ color: '#8b92a8' }}>
                  {resultadoSug
                    ? 'Todos os padrões selecionados foram adicionados.'
                    : 'Nenhum padrão novo encontrado nos últimos 12 meses.'}
                </p>
              ) : (
                <>
                  <label className="flex items-center gap-2 px-2 py-2 mb-1 cursor-pointer rounded-lg hover:bg-white/[0.03]">
                    <input type="checkbox"
                      checked={selecionadas.size === sugeridas.length && sugeridas.length > 0}
                      onChange={e => setSelecionadas(e.target.checked ? new Set(sugeridas.map(s => s.key)) : new Set())}
                      className="accent-[#a78bfa] w-3.5 h-3.5"/>
                    <span className="text-[15px] font-semibold" style={{ color: '#8b92a8' }}>Selecionar todos</span>
                  </label>
                  <div className="space-y-0.5">
                    {sugeridas.map(s => (
                      <label key={s.key}
                        className="flex items-start gap-2.5 px-2 py-2 rounded-lg cursor-pointer hover:bg-white/[0.03]">
                        <input type="checkbox" checked={selecionadas.has(s.key)}
                          onChange={e => {
                            const next = new Set(selecionadas)
                            if (e.target.checked) next.add(s.key); else next.delete(s.key)
                            setSelecionadas(next)
                          }}
                          className="accent-[#a78bfa] w-3.5 h-3.5 mt-0.5 flex-shrink-0"/>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[16px] truncate" style={{ color: '#e8eaf0' }}>{s.descricao}</span>
                            <span className="text-[14px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0"
                              style={{ background: 'rgba(167,139,250,0.10)', color: '#a78bfa' }}>
                              {s.ocorrencias}×
                            </span>
                          </div>
                          {(s.conta_nome || s.categoria_nome) && (
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {s.conta_nome && <span className="text-[14px]" style={{ color: '#4a5168' }}>{s.conta_nome}</span>}
                              {s.conta_nome && s.categoria_nome && <span className="text-[14px]" style={{ color: '#4a5168' }}>·</span>}
                              {s.categoria_nome && <span className="text-[14px]" style={{ color: '#4a5168' }}>{s.categoria_nome}</span>}
                            </div>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            {sugeridas.length > 0 && (
              <div className="flex items-center justify-between px-5 py-4 border-t border-white/8 flex-shrink-0">
                <span className="text-[15px]" style={{ color: '#8b92a8' }}>
                  {selecionadas.size} de {sugeridas.length} selecionado{selecionadas.size !== 1 ? 's' : ''}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => { setSugeridas(null); setResultadoSug(null) }}
                    className="px-3 py-1.5 rounded-lg text-[16px] text-white/40 hover:text-white/70 transition-colors">
                    Fechar
                  </button>
                  <button onClick={adicionarSelecionadas} disabled={selecionadas.size === 0 || salvandoSug}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[16px] font-semibold transition-colors disabled:opacity-40"
                    style={{ background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)' }}>
                    {salvandoSug
                      ? <><RefreshCw size={12} className="animate-spin"/> Salvando…</>
                      : <><Check size={12}/> Adicionar {selecionadas.size > 0 ? `${selecionadas.size} ` : ''}selecionado{selecionadas.size !== 1 ? 's' : ''}</>
                    }
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modal de confirmação de exclusão ──────────────────── */}
      {modalExcluir && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1929] border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-2 mb-4">
              <Trash2 size={16} className="text-red-400"/>
              <h3 className="text-[18px] font-semibold text-white">Confirmar exclusão</h3>
            </div>
            <p className="text-[16px] text-white/50 mb-4 leading-relaxed">
              Para confirmar, digite <span className="text-white font-semibold">EXCLUIR</span> no campo abaixo.
            </p>
            <input type="text" value={confirmText} onChange={e => setConfirmText(e.target.value)}
              placeholder="EXCLUIR"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[17px] text-white placeholder-white/20 focus:outline-none focus:border-red-500/50 transition-colors mb-3"/>
            {erroExcluir && (
              <p className="text-[16px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2 mb-3">{erroExcluir}</p>
            )}
            <div className="flex gap-2 justify-end">
              <button type="button" disabled={loadExcluir} onClick={() => setModalExcluir(false)}
                className="px-4 py-2 rounded-lg text-[16px] text-white/50 hover:text-white/80 transition-colors disabled:opacity-50">
                Cancelar
              </button>
              <button type="button" disabled={confirmText !== 'EXCLUIR' || loadExcluir} onClick={excluirConta}
                className="px-4 py-2 rounded-lg text-[16px] font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40">
                {loadExcluir ? 'Excluindo...' : 'Excluir permanentemente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
