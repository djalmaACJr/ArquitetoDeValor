import { useMemo } from 'react'
import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Wallet, Coins, Trophy, Settings, ListFilter, Users } from 'lucide-react'
import MascoteDica from './MascoteDica'
import { useMascotePreferido } from '../../hooks/useMascotePreferido'
import { escolherDica } from '../../lib/conteudoMascotes'

// Nav compartilhado entre as 7 páginas de nível superior do módulo de
// Investimentos (Painel, Meus ativos, Destaques, Proventos, Extrato,
// Conselho, Configurações).
// A página de detalhe do ativo (drill-down) não usa este componente — mantém
// seu próprio back-nav contextual. Fica sempre visível (sticky) ao rolar.
const ITENS = [
  { to: '/investimentos',               label: 'Painel',         icone: LayoutDashboard, end: true },
  { to: '/investimentos/ativos',        label: 'Meus ativos',    icone: Wallet,          end: false },
  { to: '/investimentos/destaques',     label: 'Destaques',      icone: Trophy,          end: false },
  { to: '/investimentos/dividendos',    label: 'Proventos',      icone: Coins,           end: false },
  { to: '/investimentos/extrato',       label: 'Extrato',        icone: ListFilter,      end: false },
  { to: '/investimentos/conselho',      label: 'Conselho',       icone: Users,           end: false },
  { to: '/investimentos/configuracoes', label: 'Configurações',  icone: Settings,        end: false },
] as const

export default function InvestimentosNav() {
  const { mascote } = useMascotePreferido()
  // Mesmo padrão de "usar o mentor" do Dashboard/Relatórios: avatar + balão
  // de dica (MascoteDica) que abre o chat ao clicar — não uma aba de texto
  // nem um ícone mudo. Sorteada 1x por montagem (troca ao navegar entre as
  // páginas do módulo, como nas demais telas do app).
  const dica = useMemo(() => escolherDica(mascote, 'investimento'), [mascote])

  return (
    <div className="sticky top-0 z-20 pt-1 pb-3 mb-4 border-b border-white/10"
      style={{ background: 'var(--bg-page, #0d1220)' }} data-tutorial="investimentos-nav">
      <nav className="flex flex-wrap items-center gap-1.5 mb-3">
        {ITENS.map((item) => {
          const Icone = item.icone
          return (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={({ isActive }) =>
                `flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[13px] font-medium transition-colors ${
                  isActive ? 'bg-av-green/15 text-av-green' : 'text-white/60 hover:bg-white/5 hover:text-white/90'
                }`
              }>
              <Icone size={15} />
              {item.label}
            </NavLink>
          )
        })}
      </nav>
      <MascoteDica nome={mascote} pose={dica.pose} texto={dica.texto} size={44} />
    </div>
  )
}
