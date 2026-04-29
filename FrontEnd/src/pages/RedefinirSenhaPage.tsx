import { useState, useEffect } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function RedefinirSenhaPage() {
  const navigate = useNavigate()
  const [pronto,   setPronto]   = useState(false)
  const [nova,     setNova]     = useState('')
  const [confirma, setConfirma] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const [sucesso,  setSucesso]  = useState(false)

  useEffect(() => {
    // O SDK processa o hash da URL durante createClient (antes do mount).
    // getSession() pega a sessão já estabelecida; onAuthStateChange cobre
    // o caso em que o evento ainda não disparou.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setPronto(true)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
        setPronto(true)
      }
    })
    return () => subscription.unsubscribe()
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (nova.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (nova !== confirma) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)

    // Garante que a sessão de recovery ainda está ativa
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) {
      setLoading(false)
      setError('Sessão expirada. Solicite um novo link de recuperação.')
      setPronto(false)
      return
    }

    const { error: err } = await supabase.auth.updateUser({ password: nova })
    setLoading(false)

    if (err) {
      setError(`Não foi possível redefinir a senha: ${err.message}`)
      return
    }

    setSucesso(true)
    setTimeout(() => navigate('/login'), 3000)
  }

  const bgGrid = 'repeating-linear-gradient(0deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px)'
  const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-av-green/50 transition-colors'

  return (
    <div className="min-h-screen flex items-center justify-center bg-av-dark">
      <div className="absolute inset-0 opacity-[0.06]" style={{ backgroundImage: bgGrid }} />

      <div className="relative w-full max-w-sm mx-4">
        <div className="flex flex-col items-center mb-8">
          <h1 className="text-2xl font-bold text-white">Arquiteto de Valor</h1>
          <p className="text-[11px] text-av-green tracking-[3px] mt-1">CONTROLE FINANCEIRO PESSOAL</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">

          {/* Aguardando o token ser processado */}
          {!pronto && !sucesso && (
            <div className="text-center py-4">
              <p className="text-[13px] text-white/50">Validando link de recuperação...</p>
            </div>
          )}

          {/* Formulário de nova senha */}
          {pronto && !sucesso && (
            <>
              <h2 className="text-base font-semibold text-white mb-1">Redefinir senha</h2>
              <p className="text-[12px] text-white/40 mb-5">Escolha uma nova senha para sua conta.</p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[12px] text-white/50 mb-1.5">Nova senha</label>
                  <input type="password" required value={nova}
                    onChange={e => setNova(e.target.value)}
                    className={inputCls} placeholder="Mínimo 6 caracteres" />
                </div>
                <div>
                  <label className="block text-[12px] text-white/50 mb-1.5">Confirmar senha</label>
                  <input type="password" required value={confirma}
                    onChange={e => setConfirma(e.target.value)}
                    className={inputCls} placeholder="••••••••" />
                </div>
                {error && (
                  <p className="text-[12px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
                )}
                <button type="submit" disabled={loading}
                  className="w-full bg-av-green text-av-dark font-semibold rounded-lg py-2.5 text-[13px] hover:bg-av-green/90 disabled:opacity-50 transition-colors mt-2">
                  {loading ? 'Salvando...' : 'Salvar nova senha'}
                </button>
              </form>
            </>
          )}

          {/* Sucesso */}
          {sucesso && (
            <div className="flex flex-col items-center py-2 text-center">
              <div className="w-12 h-12 rounded-full bg-av-green/10 border border-av-green/30 flex items-center justify-center mb-4">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <h2 className="text-base font-semibold text-white mb-2">Senha redefinida!</h2>
              <p className="text-[12px] text-white/40 leading-relaxed">
                Você será redirecionado para o login em instantes...
              </p>
            </div>
          )}
        </div>

        <p className="text-center text-[11px] text-white/20 mt-4">
          Arquiteto de Valor · BLUEPRINT
        </p>
      </div>
    </div>
  )
}
