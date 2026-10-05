// src/pages/AceitarConvitePage.tsx
//
// Destino do link "Já tenho conta — entrar e aceitar" do e-mail de convite
// de agregado (ver agregados/index.ts § montarEmailConvite). Rota
// protegida (PrivateRoute em App.tsx) — sem sessão, o usuário já volta pra
// cá depois do login via ?next= (ver LoginPage.tsx).

import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { apiMutate } from '../lib/api'

type Estado = 'carregando' | 'sucesso' | 'erro'

export default function AceitarConvitePage() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const navigate = useNavigate()

  // Sem token, o estado já nasce "erro" — evita setState síncrono dentro do
  // efeito abaixo (regra do projeto: efeito só deve setState em resposta a
  // um evento assíncrono, nunca de forma síncrona no próprio corpo dele).
  const [estado, setEstado] = useState<Estado>(() => token ? 'carregando' : 'erro')
  const [mensagemErro, setMensagemErro] = useState(() => token ? '' : 'Link de convite inválido — falta o token.')
  const [donoNome, setDonoNome] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return

    apiMutate<{ dono_id: string; email_convidado: string }>('/agregados/aceitar', 'POST', { token })
      .then(res => {
        if (!res.ok) {
          setEstado('erro')
          setMensagemErro(res.erro ?? 'Não foi possível aceitar o convite.')
          return
        }
        setDonoNome(null) // a resposta não traz o nome — ver nota abaixo
        setEstado('sucesso')
      })
  }, [token])

  return (
    <div className="min-h-screen bg-av-dark flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-[#0d1220]/85 border border-white/10 rounded-2xl p-6 text-center">
        {estado === 'carregando' && (
          <>
            <Loader2 size={32} className="mx-auto mb-4 text-av-green animate-spin" />
            <h1 className="text-white text-[18px] font-semibold mb-1">Aceitando convite...</h1>
            <p className="text-white/50 text-[14px]">Só um instante.</p>
          </>
        )}
        {estado === 'sucesso' && (
          <>
            <CheckCircle2 size={36} className="mx-auto mb-4 text-av-green" />
            <h1 className="text-white text-[18px] font-semibold mb-2">Convite aceito!</h1>
            <p className="text-white/50 text-[14px] mb-5">
              {donoNome ? `Você agora é um agregado de ${donoNome}.` : 'Você agora tem acesso a essa conta compartilhada.'}{' '}
              Troque de espaço a qualquer momento pelo seletor na barra lateral.
            </p>
            <button
              onClick={() => navigate('/')}
              className="w-full bg-av-green text-av-dark font-semibold rounded-lg py-2.5 text-[15px] hover:bg-av-green/90 transition-colors"
            >
              Ir para o painel
            </button>
          </>
        )}
        {estado === 'erro' && (
          <>
            <XCircle size={36} className="mx-auto mb-4 text-red-400" />
            <h1 className="text-white text-[18px] font-semibold mb-2">Não foi possível aceitar</h1>
            <p className="text-white/50 text-[14px] mb-5">{mensagemErro}</p>
            <Link to="/" className="text-av-green hover:text-av-green/80 text-[14px] transition-colors">
              ← Voltar para o painel
            </Link>
          </>
        )}
      </div>
    </div>
  )
}
