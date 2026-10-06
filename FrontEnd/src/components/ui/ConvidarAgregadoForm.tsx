// src/components/ui/ConvidarAgregadoForm.tsx
//
// Formulário "convidar um agregado" (e-mail → convite de conta conjunta).
// Compartilhado entre a CompartilhamentoPage e o quadro ao lado de "Convidar
// amigos" no Perfil — mesmo comportamento nos dois lugares.

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Send } from 'lucide-react'
import { useAgregadosComoDonos } from '../../hooks/useAgregados'

export default function ConvidarAgregadoForm({ onConvidado, aposSucesso }: {
  /** Chamado com o id do vínculo criado (ex.: pra destacar o cartão na lista). */
  onConvidado?: (vinculoId: string | null) => void
  /** Conteúdo extra mostrado junto da mensagem de sucesso (ex.: link pras permissões). */
  aposSucesso?: React.ReactNode
}) {
  const { convidar } = useAgregadosComoDonos()
  const [email, setEmail]       = useState('')
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro]         = useState('')
  const [sucesso, setSucesso]   = useState(false)
  const [enviadoPara, setEnviadoPara] = useState('')

  const handleConvidar = async (e: FormEvent) => {
    e.preventDefault()
    setErro(''); setSucesso(false)
    setEnviando(true)
    const res = await convidar(email)
    setEnviando(false)
    if (!res.ok) { setErro(res.erro ?? 'Não foi possível enviar o convite.'); return }
    setEnviadoPara(email)
    setSucesso(true)
    onConvidado?.(res.dados?.id ?? null)
    setEmail('')
  }

  return (
    <>
      <form onSubmit={handleConvidar} className="flex flex-col sm:flex-row gap-2">
        <input
          type="email" required value={email} onChange={e => setEmail(e.target.value)}
          placeholder="email@exemplo.com"
          className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-[15px] text-white placeholder-white/30 focus:outline-none focus:border-av-green/70 transition-colors"
        />
        <button
          type="submit" disabled={enviando}
          className="flex items-center justify-center gap-2 bg-av-green text-av-dark font-semibold rounded-lg px-4 py-2.5 text-[15px] hover:bg-av-green/90 disabled:opacity-50 transition-colors"
        >
          <Send size={15} /> {enviando ? 'Enviando...' : 'Convidar'}
        </button>
      </form>
      {erro && <p className="text-[13px] text-red-400 mt-2">{erro}</p>}
      {sucesso && (
        <p className="text-[13px] text-av-green mt-2">
          Convite enviado para {enviadoPara}. Agora defina o que ele poderá acessar: libere os módulos e as contas no cartão dele — sem isso, ao aceitar ele não verá nada.
          {aposSucesso}
        </p>
      )}
    </>
  )
}
