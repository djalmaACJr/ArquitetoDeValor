import { useState } from 'react'
import type { FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [error, setError]               = useState('')
  const [loading, setLoading]           = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await signIn(email, password)
    setLoading(false)
    if (err) { setError('Email ou senha inválidos.'); return }
    navigate('/')
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-av-dark">
      {/* grid de fundo */}
      <div className="absolute inset-0 opacity-[0.06]"
        style={{ backgroundImage: 'repeating-linear-gradient(0deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px)' }}
      />

      <div className="relative w-full max-w-sm mx-4">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-av-dark border border-blue-400/30 flex items-center justify-center mb-4">
            <svg width="48" height="48" viewBox="210 30 260 260">
              <g opacity="0.3">
                {[230,270,310,350,390,430].map(x=>(
                  <line key={x} x1={x} y1="50" x2={x} y2="270" stroke="#4da6ff" strokeWidth="1"/>
                ))}
                {[90,150,210,250].map(y=>(
                  <line key={y} x1="215" y1={y} x2="455" y2={y} stroke="#4da6ff" strokeWidth="1"/>
                ))}
              </g>
              <rect x="258" y="185" width="18" height="40" rx="3" fill="#1a2540"/>
              <rect x="258" y="183" width="18" height="5" rx="2" fill="#f0b429"/>
              <rect x="282" y="165" width="18" height="60" rx="3" fill="#1a2540"/>
              <rect x="282" y="163" width="18" height="5" rx="2" fill="#00c896"/>
              <rect x="306" y="140" width="18" height="85" rx="3" fill="#1a2540"/>
              <rect x="306" y="138" width="18" height="5" rx="2" fill="#00c896"/>
              <rect x="386" y="120" width="18" height="95" rx="3" fill="#1a2540"/>
              <rect x="386" y="118" width="18" height="5" rx="2" fill="#f0b429"/>
              <rect x="410" y="100" width="18" height="115" rx="3" fill="#1a2540"/>
              <rect x="410" y="98" width="18" height="5" rx="2" fill="#00c896"/>
              <polyline points="267,218 291,195 315,165 395,148 419,128"
                fill="none" stroke="#00c896" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
              <circle cx="267" cy="218" r="5" fill="#00c896"/>
              <circle cx="291" cy="195" r="5" fill="#00c896"/>
              <circle cx="315" cy="165" r="5" fill="#00c896"/>
              <circle cx="395" cy="148" r="5" fill="#f0b429"/>
              <circle cx="419" cy="128" r="5" fill="#f0b429"/>
              <polygon points="419,105 427,124 419,119 411,124" fill="#f0b429"/>
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white">Arquiteto de Valor</h1>
          <p className="text-[11px] text-av-green tracking-[3px] mt-1">CONTROLE FINANCEIRO PESSOAL</p>
        </div>

        {/* Form */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
          <h2 className="text-base font-semibold text-white mb-5">Entrar na sua conta</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[12px] text-white/50 mb-1.5">Email</label>
              <input
                type="email" required value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-av-green/50 transition-colors"
                placeholder="seu@email.com"
              />
            </div>
            <div>
              <label className="block text-[12px] text-white/50 mb-1.5">Senha</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} required value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-3 pr-10 py-2.5 text-[13px] text-white placeholder-white/20 focus:outline-none focus:border-av-green/50 transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-white/40 hover:text-white/70 transition-colors"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>
            {error && (
              <p className="text-[12px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit" disabled={loading}
              className="w-full bg-av-green text-av-dark font-semibold rounded-lg py-2.5 text-[13px] hover:bg-av-green/90 disabled:opacity-50 transition-colors mt-2"
            >
              {loading ? 'Entrando...' : 'Entrar'}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-white/8 text-center">
            <span className="text-[12px] text-white/30">Não tem uma conta? </span>
            <Link to="/cadastro" className="text-[12px] text-av-green hover:text-av-green/80 transition-colors">
              Criar conta
            </Link>
          </div>
        </div>
        <p className="text-center text-[11px] text-white/20 mt-4">
          Arquiteto de Valor · BLUEPRINT
        </p>
      </div>
    </div>
  )
}
