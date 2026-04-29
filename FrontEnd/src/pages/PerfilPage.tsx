import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { User, Lock, Check, AlertCircle, Trash2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'
import { apiMutate } from '../lib/api'

type Feedback = { tipo: 'ok' | 'erro'; msg: string }

function Secao({ titulo, icone, children }: {
  titulo: string
  icone: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="bg-white/4 border border-white/8 rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-4 pb-3 border-b border-white/8">
        <span className="text-av-green/70">{icone}</span>
        <h2 className="text-[13px] font-semibold text-white">{titulo}</h2>
      </div>
      {children}
    </div>
  )
}

function Alerta({ fb }: { fb: Feedback | null }) {
  if (!fb) return null
  const ok = fb.tipo === 'ok'
  return (
    <div className={`flex items-center gap-2 text-[12px] rounded-lg px-3 py-2 mt-3 ${
      ok ? 'bg-av-green/10 text-av-green' : 'bg-red-400/10 text-red-400'
    }`}>
      {ok ? <Check size={13}/> : <AlertCircle size={13}/>}
      {fb.msg}
    </div>
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
      await supabase
        .schema('arqvalor')
        .from('usuarios')
        .update({ nome: nome.trim() })
        .eq('id', user!.id)
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

    // Verifica senha atual
    const { error: errLogin } = await supabase.auth.signInWithPassword({
      email: emailAtual,
      password: senhaAtual,
    })

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
      setSenhaAtual('')
      setNovaSenha('')
      setConfirmar('')
    }
  }

  // ── Exclusão de conta ───────────────────────────────────────
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

  const input = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-av-green/50 transition-colors'
  const label = 'block text-[12px] text-white/50 mb-1.5'
  const btn   = 'px-4 py-2 rounded-lg text-[12px] font-semibold transition-colors disabled:opacity-50'

  return (
    <div className="p-5 max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="text-[17px] font-bold text-white">Meu Perfil</h1>
        <p className="text-[12px] text-white/40 mt-0.5">{emailAtual}</p>
      </div>

      <div className="flex flex-col gap-4">

        {/* ── Seção: Nome ───────────────────────────────────── */}
        <Secao titulo="Dados pessoais" icone={<User size={15}/>}>
          <form onSubmit={salvarNome} className="space-y-3">
            <div>
              <label className={label}>Nome de exibição</label>
              <input
                type="text" required value={nome}
                onChange={e => setNome(e.target.value)}
                className={input}
                placeholder="Seu nome"
              />
            </div>
            <div>
              <label className={label}>E-mail</label>
              <input
                type="email" disabled value={emailAtual}
                className={`${input} opacity-40 cursor-not-allowed`}
              />
              <p className="text-[11px] text-white/25 mt-1">O e-mail não pode ser alterado por aqui.</p>
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="submit" disabled={loadNome || nome.trim() === nomeAtual}
                className={`${btn} bg-av-green text-av-dark hover:bg-av-green/90`}
              >
                {loadNome ? 'Salvando...' : 'Salvar nome'}
              </button>
            </div>
            <Alerta fb={fbNome}/>
          </form>
        </Secao>

        {/* ── Seção: Alterar senha ──────────────────────────── */}
        <Secao titulo="Alterar senha" icone={<Lock size={15}/>}>
          <form onSubmit={salvarSenha} className="space-y-3">
            <div>
              <label className={label}>Senha atual</label>
              <input
                type="password" required value={senhaAtual}
                onChange={e => setSenhaAtual(e.target.value)}
                className={input}
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className={label}>Nova senha</label>
              <input
                type="password" required value={novaSenha}
                onChange={e => setNovaSenha(e.target.value)}
                className={input}
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div>
              <label className={label}>Confirmar nova senha</label>
              <input
                type="password" required value={confirmar}
                onChange={e => setConfirmar(e.target.value)}
                className={input}
                placeholder="••••••••"
              />
            </div>
            <div className="flex justify-end pt-1">
              <button
                type="submit" disabled={loadSenha}
                className={`${btn} bg-blue-500/20 text-blue-300 hover:bg-blue-500/30`}
              >
                {loadSenha ? 'Atualizando...' : 'Atualizar senha'}
              </button>
            </div>
            <Alerta fb={fbSenha}/>
          </form>
        </Secao>

        {/* ── Seção: Zona de perigo ─────────────────────────── */}
        <div className="bg-red-500/5 border border-red-500/20 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-red-500/15">
            <span className="text-red-400/70"><Trash2 size={15}/></span>
            <h2 className="text-[13px] font-semibold text-red-400">Zona de perigo</h2>
          </div>
          <p className="text-[12px] text-white/40 mb-4 leading-relaxed">
            Excluir sua conta remove permanentemente todos os seus dados: lançamentos, contas, categorias e histórico.
            Esta ação <span className="text-red-400 font-semibold">não pode ser desfeita</span>.
          </p>
          <button
            type="button"
            onClick={() => { setModalExcluir(true); setConfirmText(''); setErroExcluir('') }}
            className="px-4 py-2 rounded-lg text-[12px] font-semibold border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors"
          >
            Excluir minha conta
          </button>
        </div>

      </div>

      {/* ── Modal de confirmação ───────────────────────────────── */}
      {modalExcluir && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#0f1929] border border-white/10 rounded-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-2 mb-4">
              <Trash2 size={16} className="text-red-400"/>
              <h3 className="text-[14px] font-semibold text-white">Confirmar exclusão</h3>
            </div>
            <p className="text-[12px] text-white/50 mb-4 leading-relaxed">
              Para confirmar, digite <span className="text-white font-semibold">EXCLUIR</span> no campo abaixo.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              placeholder="EXCLUIR"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-red-500/50 transition-colors mb-3"
            />
            {erroExcluir && (
              <p className="text-[12px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2 mb-3">
                {erroExcluir}
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                disabled={loadExcluir}
                onClick={() => setModalExcluir(false)}
                className="px-4 py-2 rounded-lg text-[12px] text-white/50 hover:text-white/80 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={confirmText !== 'EXCLUIR' || loadExcluir}
                onClick={excluirConta}
                className="px-4 py-2 rounded-lg text-[12px] font-semibold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40"
              >
                {loadExcluir ? 'Excluindo...' : 'Excluir permanentemente'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
