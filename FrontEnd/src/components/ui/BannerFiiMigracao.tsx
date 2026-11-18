import { AlertTriangle, ExternalLink } from 'lucide-react'
import { formatData } from '../../lib/utils'
import type { AlertaFii } from '../../types'

// Faixa fixa no topo da página de um FII que tem alerta de liquidação, fusão,
// transformação ou troca de código. Não some ao "dispensar" o aviso de login.
export default function BannerFiiMigracao({ alertas, ehPosicaoDoUsuario }: { alertas: AlertaFii[]; ehPosicaoDoUsuario: boolean }) {
  if (alertas.length === 0) return null
  return (
    <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: 'rgba(255,92,122,0.55)', background: 'rgba(255,92,122,0.07)' }}>
      <p className="text-[14px] font-semibold flex items-center gap-2" style={{ color: '#ff8aa0' }}>
        <AlertTriangle size={16} /> Atenção: este fundo pode estar mudando
      </p>
      <ul className="space-y-1.5">
        {alertas.map((a) => (
          <li key={`${a.id}-${a.tipo}`} className="text-[13px] text-white/90">
            <span className="font-semibold">{a.rotulo}</span>
            <span className="text-white/60"> · {a.categoria} de {formatData(a.data_entrega.slice(0, 10))}</span>
            {a.resumo && <span className="block text-white/75">{a.resumo}</span>}
            <a href={a.url_documento} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] text-blue-300 hover:underline">
              <ExternalLink size={12} /> Abrir o documento (Fundos.NET)
            </a>
          </li>
        ))}
      </ul>
      <p className="text-[12px] text-white/60">
        Nesses casos a cotação pode zerar e você pode receber cotas de outro fundo.
        {ehPosicaoDoUsuario && ' Quando as novas cotas chegarem, use "Transferir" para levar a posição e o custo ao novo ativo sem perder o histórico.'}
      </p>
    </div>
  )
}
