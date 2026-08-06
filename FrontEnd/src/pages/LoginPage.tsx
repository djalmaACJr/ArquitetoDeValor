import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { Fingerprint } from 'lucide-react'
import { useAuth } from '../hooks/useAuth'
import { supabase } from '../lib/supabase'
import { consumirRotaPosExpiracao } from '../lib/retornoPosExpiracao'
import { CampoSenha } from '../components/ui/CampoSenha'
import {
  biometriaAtiva, biometriaDisponivelNoAparelho, ativarBiometria,
  desativarBiometria, entrarComBiometria,
} from '../lib/biometria'

// Marca "não perguntar de novo" após o usuário recusar ativar a digital
// (por dispositivo — limpo no logout junto com o resto do estado do
// usuário, ver lib/clientCache.ts). Sem isso, todo login voltaria a oferecer.
const LS_BIOMETRIA_RECUSADA = 'arqvalor:biometria-recusada'

// Dentro do WebView do app Android (Capacitor), window.location.origin é
// "https://localhost" — não um domínio real alcançável pelo link do e-mail
// de redefinição de senha. Nesse caso força a origem de produção; no browser
// normal continua usando window.location.origin (funciona em qualquer ambiente
// de deploy: produção, preview, localhost de dev).
const origemRedefinicaoSenha = Capacitor.isNativePlatform()
  ? 'https://arquitetodevalor.com.br'
  : window.location.origin

const LogoSVG = () => (
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
)

const bgGrid = 'repeating-linear-gradient(0deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px)'
const inputCls = 'w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[17px] text-white placeholder-white/30 focus:outline-none focus:bg-white/10 focus:border-av-green/70 transition-colors'

export default function LoginPage() {
  const { signIn } = useAuth()
  const navigate   = useNavigate()
  const [searchParams] = useSearchParams()
  const sessaoExpirada = searchParams.get('expirado') === '1'

  useEffect(() => {
    const html = document.documentElement
    const hadDark = html.classList.contains('dark')
    html.classList.add('dark')
    return () => { if (!hadDark) html.classList.remove('dark') }
  }, [])

  const [modo, setModo]         = useState<'login' | 'esqueci'>('login')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [linkEnviado, setLinkEnviado] = useState(false)

  // Login por digital (só Android nativo) — ver src/lib/biometria.ts.
  const [digitalAtiva, setDigitalAtiva] = useState(false)
  const [ofertaDigital, setOfertaDigital] = useState<{ email: string; senha: string; rota: string | null } | null>(null)
  const [erroAtivarDigital, setErroAtivarDigital] = useState('')
  const [ativandoDigital, setAtivandoDigital] = useState(false)

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return
    biometriaAtiva().then(setDigitalAtiva)
  }, [])

  const irParaApos = (rota: string | null) => navigate(rota ?? '/')

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    // try/catch/finally: signIn (via supabase-js) normalmente resolve com
    // {error} mesmo pra senha errada, mas PODE rejeitar de verdade em falha
    // de rede/servidor (ex.: sem internet no aparelho). Sem isso, uma
    // exceção aqui escapava sem tratamento — `loading` ficava travado em
    // true (botão preso em "Entrando...") e NENHUMA mensagem aparecia,
    // porque o catch nunca existiu pra setar `error`.
    try {
      const { error: err } = await signIn(email, password)
      if (err) {
        console.error('[login] signInWithPassword falhou', err)
        setError('Email ou senha inválidos.')
        return
      }
      // Logout por inatividade guarda a rota em que o usuário estava —
      // se o snapshot for deste mesmo usuário, retoma de onde parou.
      const { data } = await supabase.auth.getSession()
      const rotaSalva = consumirRotaPosExpiracao(data.session?.user?.id ?? null)

      // Oferece ativar a digital: só no app Android, com hardware/cadastro
      // de biometria disponível, ainda não ativada neste app, e sem recusa
      // prévia.
      if (Capacitor.isNativePlatform() && !digitalAtiva
          && localStorage.getItem(LS_BIOMETRIA_RECUSADA) !== '1') {
        const { disponivel } = await biometriaDisponivelNoAparelho()
        if (disponivel) {
          setOfertaDigital({ email, senha: password, rota: rotaSalva })
          return
        }
      }
      irParaApos(rotaSalva)
    } catch (e) {
      console.error('[login] erro inesperado', e)
      setError('Não foi possível entrar. Verifique sua conexão e tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleLoginDigital = async () => {
    setError('')
    setLoading(true)
    try {
      const { email: emailSalvo, senha } = await entrarComBiometria()
      const { error: err } = await signIn(emailSalvo, senha)
      if (err) {
        // Credenciais salvas não batem mais (ex.: senha trocada em outro
        // dispositivo) — limpa e pede pra entrar manual e reativar.
        await desativarBiometria()
        setDigitalAtiva(false)
        setError('Sua senha mudou. Entre com e-mail e senha e ative a digital de novo.')
        return
      }
      const { data } = await supabase.auth.getSession()
      const rotaSalva = consumirRotaPosExpiracao(data.session?.user?.id ?? null)
      irParaApos(rotaSalva)
    } catch {
      // Usuário cancelou o prompt do SO ou a biometria falhou — sem drama,
      // só volta pro formulário normal.
      setError('Não foi possível confirmar a digital. Tente novamente ou entre com sua senha.')
    } finally {
      setLoading(false)
    }
  }

  const confirmarAtivarDigital = async () => {
    if (!ofertaDigital) return
    setErroAtivarDigital('')
    setAtivandoDigital(true)
    const r = await ativarBiometria(ofertaDigital.email, ofertaDigital.senha)
    setAtivandoDigital(false)
    if (!r.ok) {
      // Mantém o modal aberto — antes essa falha era ignorada em silêncio:
      // o usuário achava que tinha ativado (nada de errado aparecia), mas a
      // credencial nunca foi salva, e a tela de Perfil/o botão "Entrar com
      // digital" continuavam mostrando como desativado.
      setErroAtivarDigital(r.erro ?? 'Não foi possível ativar a digital neste aparelho.')
      return
    }
    setDigitalAtiva(true)
    const rota = ofertaDigital.rota
    setOfertaDigital(null)
    irParaApos(rota)
  }

  const recusarAtivarDigital = () => {
    localStorage.setItem(LS_BIOMETRIA_RECUSADA, '1')
    const rota = ofertaDigital?.rota ?? null
    setOfertaDigital(null)
    setErroAtivarDigital('')
    irParaApos(rota)
  }

  const handleEsqueci = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    const { error: err } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origemRedefinicaoSenha}/redefinir-senha`,
    })
    setLoading(false)
    if (err) { setError('Não foi possível enviar o e-mail. Verifique o endereço.'); return }
    setLinkEnviado(true)
  }

  const voltarLogin = () => {
    setModo('login')
    setError('')
    setLinkEnviado(false)
    setPassword('')
  }

  return (
    <div className="min-h-screen bg-av-dark relative overflow-hidden">
      {/* Cena com mascotes ao fundo (logn.jpg). */}
      <div
        className="absolute inset-0 bg-no-repeat bg-cover bg-center"
        style={{ backgroundImage: 'url(/mascotes/zlogin-bg.jpg)' }}
        aria-hidden="true"
      />
      {/* Gradiente lateral: escurece o lado esquerdo (onde o card fica) e
          deixa o lado direito (mascotes Engenheira/Mago/Sábio) visível.
          Em mobile vira gradiente vertical pra continuar legível. */}
      <div
        className="absolute inset-0 md:hidden"
        style={{ background: 'linear-gradient(to bottom, rgba(13,18,32,0.92) 0%, rgba(13,18,32,0.55) 45%, rgba(13,18,32,0.85) 100%)' }}
        aria-hidden="true"
      />
      <div
        className="absolute inset-0 hidden md:block"
        style={{ background: 'linear-gradient(to right, rgba(13,18,32,0.92) 0%, rgba(13,18,32,0.78) 28%, rgba(13,18,32,0.25) 55%, transparent 70%)' }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: bgGrid }} />

      {/* Card alinhado à ESQUERDA em telas ≥ md, centralizado no mobile.
          Posicionamento evita sobrepor os personagens (que ficam à direita
          do gradiente). */}
      <div className="relative min-h-screen flex items-center justify-center md:justify-start px-4 md:pl-16 lg:pl-24 xl:pl-32">
      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-av-dark border border-blue-400/30 flex items-center justify-center mb-4">
            <LogoSVG />
          </div>
          <h1 className="text-2xl font-bold text-white">Arquiteto de Valor</h1>
          <p className="text-[15px] text-av-green tracking-[3px] mt-1">CONTROLE FINANCEIRO PESSOAL</p>
        </div>

        <div className="bg-[#0d1220]/85 border border-white/10 rounded-2xl p-6 backdrop-blur-md shadow-2xl">

          {/* ── Modo: login ─────────────────────────────────── */}
          {modo === 'login' && (
            <>
              <h2 className="text-base font-semibold text-white mb-5">Entrar na sua conta</h2>
              {sessaoExpirada && (
                <div className="mb-4 rounded-lg px-3 py-2.5 text-[15px]"
                  style={{
                    background: 'rgba(240,180,41,0.10)',
                    border:     '1px solid rgba(240,180,41,0.30)',
                    color:      '#f0b429',
                  }}>
                  Sua sessão foi encerrada por inatividade. Entre novamente para continuar.
                </div>
              )}
              {digitalAtiva && (
                <>
                  <button type="button" onClick={handleLoginDigital} disabled={loading}
                    className="w-full flex items-center justify-center gap-2 border border-av-green/40 text-av-green font-semibold rounded-lg py-2.5 text-[17px] hover:bg-av-green/10 disabled:opacity-50 transition-colors mb-4">
                    <Fingerprint size={18} />
                    Entrar com digital
                  </button>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex-1 h-px bg-white/10" />
                    <span className="text-[14px] text-white/30">ou</span>
                    <div className="flex-1 h-px bg-white/10" />
                  </div>
                </>
              )}
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-[16px] text-white/50 mb-1.5">Email</label>
                  <input type="email" required value={email}
                    onChange={e => setEmail(e.target.value)}
                    className={inputCls} placeholder="seu@email.com" />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[16px] text-white/50">Senha</label>
                    <button
                      type="button"
                      onClick={() => { setModo('esqueci'); setError('') }}
                      className="text-[15px] text-blue-400/70 hover:text-blue-300 transition-colors"
                    >
                      Esqueci minha senha
                    </button>
                  </div>
                  <CampoSenha value={password} onChange={setPassword}
                    required autoComplete="current-password"
                    className={inputCls} placeholder="••••••••" />
                </div>
                {error && (
                  <p className="text-[16px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
                )}
                <button type="submit" disabled={loading}
                  className="w-full bg-av-green text-av-dark font-semibold rounded-lg py-2.5 text-[17px] hover:bg-av-green/90 disabled:opacity-50 transition-colors mt-2">
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>
              </form>

              <div className="mt-4 pt-4 border-t border-white/8 text-center">
                <span className="text-[16px] text-white/30">Não tem uma conta? </span>
                <Link to="/cadastro" className="text-[16px] text-av-green hover:text-av-green/80 transition-colors">
                  Criar conta
                </Link>
              </div>
            </>
          )}

          {/* ── Modo: esqueci a senha ────────────────────────── */}
          {modo === 'esqueci' && !linkEnviado && (
            <>
              <h2 className="text-base font-semibold text-white mb-1">Recuperar senha</h2>
              <p className="text-[16px] text-white/40 mb-5">
                Informe seu e-mail e enviaremos um link para redefinir sua senha.
              </p>
              <form onSubmit={handleEsqueci} className="space-y-4">
                <div>
                  <label className="block text-[16px] text-white/50 mb-1.5">Email</label>
                  <input type="email" required value={email}
                    onChange={e => setEmail(e.target.value)}
                    className={inputCls} placeholder="seu@email.com" />
                </div>
                {error && (
                  <p className="text-[16px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2">{error}</p>
                )}
                <button type="submit" disabled={loading}
                  className="w-full bg-av-green text-av-dark font-semibold rounded-lg py-2.5 text-[17px] hover:bg-av-green/90 disabled:opacity-50 transition-colors mt-2">
                  {loading ? 'Enviando...' : 'Enviar link de recuperação'}
                </button>
              </form>
              <div className="mt-4 pt-4 border-t border-white/8 text-center">
                <button onClick={voltarLogin}
                  className="text-[16px] text-white/40 hover:text-white/70 transition-colors">
                  ← Voltar para o login
                </button>
              </div>
            </>
          )}

          {/* ── Modo: link enviado ───────────────────────────── */}
          {modo === 'esqueci' && linkEnviado && (
            <>
              <div className="flex flex-col items-center py-2">
                <div className="w-12 h-12 rounded-full bg-av-green/10 border border-av-green/30 flex items-center justify-center mb-4">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#00c896" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                    <polyline points="22,6 12,13 2,6"/>
                  </svg>
                </div>
                <h2 className="text-base font-semibold text-white mb-2">Link enviado!</h2>
                <p className="text-[16px] text-white/40 text-center leading-relaxed mb-5">
                  Verifique sua caixa de entrada em <span className="text-white/70">{email}</span> e clique no link para redefinir sua senha.
                </p>
                <button onClick={voltarLogin}
                  className="text-[16px] text-av-green hover:text-av-green/80 transition-colors">
                  ← Voltar para o login
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-center text-[15px] text-white/20 mt-4">
          Arquiteto de Valor · BLUEPRINT
        </p>
      </div>
      </div>

      {/* Oferta de ativar login por digital — só aparece uma vez após um
          login manual bem-sucedido no app Android (ver handleLogin). */}
      {ofertaDigital && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/70">
          <div className="w-full max-w-sm bg-[#0d1220] border border-white/10 rounded-2xl p-6 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-av-green/10 border border-av-green/30 flex items-center justify-center mb-4 mx-auto">
              <Fingerprint size={22} className="text-av-green" />
            </div>
            <h2 className="text-base font-semibold text-white text-center mb-2">Ativar login por digital?</h2>
            <p className="text-[15px] text-white/50 text-center leading-relaxed mb-5">
              Da próxima vez, entre só com sua digital — sem digitar e-mail e senha.
            </p>
            {erroAtivarDigital && (
              <p className="text-[15px] text-red-400 bg-red-400/10 rounded-lg px-3 py-2 mb-4">{erroAtivarDigital}</p>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={recusarAtivarDigital} disabled={ativandoDigital}
                className="flex-1 py-2.5 rounded-lg border border-white/10 text-[16px] font-semibold text-white/60 hover:border-white/20 disabled:opacity-50 transition-colors">
                Agora não
              </button>
              <button type="button" onClick={confirmarAtivarDigital} disabled={ativandoDigital}
                className="flex-1 py-2.5 rounded-lg bg-av-green text-av-dark text-[16px] font-semibold hover:bg-av-green/90 disabled:opacity-50 transition-colors">
                {ativandoDigital ? 'Ativando...' : erroAtivarDigital ? 'Tentar de novo' : 'Ativar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
