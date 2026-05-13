import { Eye, EyeOff } from 'lucide-react'

interface Props {
  oculto: boolean
  onToggle: () => void
}

export function BotaoOcultar({ oculto, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      title={oculto ? 'Mostrar valores' : 'Ocultar valores'}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border transition-all text-[12px] font-medium"
      style={{
        borderColor: 'rgba(255,255,255,0.1)',
        color: '#8b92a8',
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      {oculto ? <EyeOff size={14} /> : <Eye size={14} />}
      {oculto ? 'Mostrar' : 'Ocultar'}
    </button>
  )
}
