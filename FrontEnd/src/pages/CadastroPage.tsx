import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { CampoSenha } from '../components/ui/CampoSenha'

const Logo = () => (
  <svg width="48" height="48" viewBox="0 0 64 64">
    <path d="M32,10 L14,50" fill="none" stroke="#4da6ff" strokeWidth="4" strokeLinecap="round"/>
    <path d="M32,10 L50,50" fill="none" stroke="#4da6ff" strokeWidth="4" strokeLinecap="round"/>
    <circle cx="32" cy="10" r="3.5" fill="#4da6ff"/>
    <polyline points="14,50 26,38 38,42 50,26"
      fill="none" stroke="#00c896" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="50" cy="26" r="4.5" fill="#f0b429"/>
  </svg>
)

export default function CadastroPage() {
  const navigate = useNavigate()

  useEffect(() => {
    const html = document.documentElement
    const hadDark = html.classList.contains('dark')
    html.classList.add('dark')
    return () => { if (!hadDark) html.classList.remove('dark') }
  }, [])

  const [nome, setNome]             = useState('')
  const [email, setEmail]           = useState('')
  const [password, setPassword]     = useState('')
  const [confirm, setConfirm]       = useState('')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)
  const [sucesso, setSucesso]       = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres.')
      return
    }
    if (password !== confirm) {
      setError('As senhas não coincidem.')
      return
    }

    setLoading(true)
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { nome } },
    })
    setLoading(false)

    if (err) {
      console.error('[CadastroPage] signUp error:', err.message, err)
      if (err.message.includes('already registered') || err.message.includes('already been registered')) {
        setError('Este e-mail já está cadastrado.')
      } else {
        setError(`Erro ao criar conta: ${err.message}`)
      }
      return
    }

    setSucesso(true)
  }

  if (sucesso) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-av-dark relative overflow-hidden">
        {/* Mesma cena de fundo do Login — mantém continuidade visual com os 4 mascotes */}
        <div
          className="absolute inset-0 bg-no-repeat bg-cover bg-center"
          style={{ backgroundImage: 'url(/mascotes/zlogin-bg.jpg)' }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0"
          style={{ background: 'radial-gradient(ellipse at center, rgba(13,18,32,0.15) 0%, rgba(13,18,32,0.75) 75%)' }}
          aria-hidden="true"
        />
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px)' }}
        />
        <div className="relative w-full max-w-sm mx-4 text-center">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 rounded-2xl bg-av-dark border border-blue-400/30 flex items-center justify-center mb-4">
              <Logo />
            </div>
            <h1 className="text-2xl font-bold text-white">Arquiteto de Valor</h1>
            <p className="text-[15px] text-av-green tracking-[3px] mt-1">CONTROLE FINANCEIRO PESSOAL</p>
          </div>
          <div className="bg-[#0d1220]/85 border border-av-green/30 rounded-2xl p-6 backdrop-blur-md shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-av-green/10 border border-av-green/30 flex items-center justify-center mx-auto mb-4">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <h2 className="text-base font-semibold text-white mb-2">Conta criada!</h2>
            <p className="text-[16px] text-white/50 mb-5 leading-relaxed">
              Verifique seu e-mail e clique no link de confirmação para ativar sua conta.
            </p>
            <button
              onClick={() => navigate('/login')}
              className="w-full bg-av-green text-av-dark font-semibold rounded-lg py-2.5 text-[17px] hover:bg-av-green/90 transition-colors"
            >
              Ir para o login
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-av-dark">
      <div className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px)' }}
      />

      <div className="relative w-full max-w-sm mx-4">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-av-dark border border-blue-400/30 flex items-center justify-center mb-4">
            <Logo />
          </div>
          <h1 className="text-2xl font-bold text-white">Arquiteto de Valor</h1>
          <p className="text-[15px] text-av-green tracking-[3px] mt-1">CONTROLE FINANCEIRO PESSOAL</p>
        </div>

        <div className="bg-[#0d1220]/85 border border-white/10 rounded-2xl p-6 backdrop-blur-md shadow-2xl">
          <h2 className="text-base font-semibold text-white mb-5">Criar nova conta</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[16px] text-white/50 mb-1.5">Nome</label>
              <input
                type="text" required value={nome}
                onChange={e => setNome(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[17px] text-white placeholder-white/20 focus:outline-none focus:border-av-green/50 transition-colors"
                placeholder="Seu nome"
              />
            </div>
            <div>
              <label className="block text-[16px] text-white/50 mb-1.5">Email</label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[17px] text-white placeholder-white/20 focus:outline-none focus:border-av-green/50 transition-colors"
                placeholder="seu@email.com"
              />
            </div>
            <div>
              <label className="block text-[16px] text-white/50 mb-1.5">Senha</label>
              <CampoSenha
                value={password} onChange={setPassword} required autoComplete="new-password"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[17px] text-white placeholder-white/20 focus:outline-none focus:border-av-green/50 transition-colors"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div>
              <label className="block text-[16px] text-white/50 mb-1.5">Confirmar senha</label>
              <CampoSenha
                value={confirm} onChange={setConfirm} required autoComplete="new-password"
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[17px] text-white placeholder-white/20 focus:outline-none focus:border-av-green/50 transition-colors"
                placeholder="••••••••"
              />
            </div>
            {error && (
              <p className="text-[16px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit" disabled={loading}
              className="w-full bg-av-green text-av-dark font-semibold rounded-lg py-2.5 text-[17px] hover:bg-av-green/90 disabled:opacity-50 transition-colors mt-2"
            >
              {loading ? 'Criando conta...' : 'Criar conta'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-white/8 text-center">
            <span className="text-[16px] text-white/30">Já tem uma conta? </span>
            <Link to="/login" className="text-[16px] text-av-green hover:text-av-green/80 transition-colors">
              Entrar
            </Link>
          </div>
        </div>

        <p className="text-center text-[15px] text-white/20 mt-4">
          Arquiteto de Valor · BLUEPRINT
        </p>
      </div>
    </div>
  )
}
