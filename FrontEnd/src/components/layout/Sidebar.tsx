import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, List, CreditCard, Tag,
  ArrowLeftRight, FileText, Moon, Sun, LogOut,
} from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../hooks/useAuth'

const Logo = () => (
  <svg width="36" height="36" viewBox="210 30 260 260" xmlns="http://www.w3.org/2000/svg">
    <g opacity="0.25">
      {[230,260,290,320,350,380,410,440].map(x => (
        <line key={x} x1={x} y1="50" x2={x} y2="270" stroke="#4da6ff" strokeWidth="0.8"/>
      ))}
      {[90,130,170,210,250].map(y => (
        <line key={y} x1="215" y1={y} x2="455" y2={y} stroke="#4da6ff" strokeWidth="0.8"/>
      ))}
    </g>
    <rect x="258" y="185" width="18" height="40" rx="3" fill="#1a2540"/>
    <rect x="258" y="183" width="18" height="5"  rx="2" fill="#f0b429"/>
    <rect x="282" y="165" width="18" height="60" rx="3" fill="#1a2540"/>
    <rect x="282" y="163" width="18" height="5"  rx="2" fill="#00c896"/>
    <rect x="306" y="140" width="18" height="85" rx="3" fill="#1a2540"/>
    <rect x="306" y="138" width="18" height="5"  rx="2" fill="#00c896"/>
    <rect x="386" y="120" width="18" height="95" rx="3" fill="#1a2540"/>
    <rect x="386" y="118" width="18" height="5"  rx="2" fill="#f0b429"/>
    <rect x="410" y="100" width="18" height="115" rx="3" fill="#1a2540"/>
    <rect x="410" y="98"  width="18" height="5"  rx="2" fill="#00c896"/>
    <polyline points="267,218 291,195 315,165 395,148 419,128"
      fill="none" stroke="#00c896" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="267" cy="218" r="4" fill="#00c896"/>
    <circle cx="291" cy="195" r="4" fill="#00c896"/>
    <circle cx="315" cy="165" r="4" fill="#00c896"/>
    <circle cx="395" cy="148" r="4" fill="#f0b429"/>
    <circle cx="419" cy="128" r="4.5" fill="#f0b429"/>
    <polygon points="419,108 426,124 419,120 412,124" fill="#f0b429"/>
  </svg>
)

interface NavItem {
  to:    string
  icon:  React.ReactNode
  label: string
  soon?: boolean
}

const navPrincipal: NavItem[] = [
  { to: '/',            icon: <LayoutDashboard size={15}/>, label: 'Dashboard' },
  { to: '/lancamentos', icon: <List size={15}/>,            label: 'Lançamentos' },
]
const navCadastros: NavItem[] = [
  { to: '/contas',     icon: <CreditCard size={15}/>, label: 'Contas' },
  { to: '/categorias', icon: <Tag size={15}/>,        label: 'Categorias' },
]
const navFerramentas: NavItem[] = [
  { to: '/importar',   icon: <ArrowLeftRight size={15}/>, label: 'Importar / Exportar' },
  { to: '/relatorios', icon: <FileText size={15}/>,       label: 'Relatórios', soon: true },
]

function NavGroup({ label, items }: { label: string; items: NavItem[] }) {
  return (
    <div className="mb-2">
      <p className="text-[10px] uppercase tracking-widest text-blue-400/50 px-2 mb-1">{label}</p>
      {items.map(item => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          className={({ isActive }) =>
            `flex items-center gap-2 px-2 py-[7px] rounded-lg text-[13px] mb-[1px] transition-colors ${
              isActive
                ? 'bg-av-green/15 text-av-green font-medium'
                : 'text-white/50 hover:bg-blue-400/8 hover:text-white/85'
            }`
          }
        >
          {item.icon}
          <span className="flex-1">{item.label}</span>
          {item.soon && (
            <span className="text-[9px] px-[6px] py-[2px] rounded-full bg-av-amber/15 text-av-amber">
              em breve
            </span>
          )}
        </NavLink>
      ))}
    </div>
  )
}

export default function Sidebar() {
  const { dark, toggle } = useTheme()
  const { signOut, session } = useAuth()

  const nome = session?.user?.user_metadata?.nome
    ?? session?.user?.email?.split('@')[0]
    ?? 'Usuário'

  return (
    <nav className="w-[216px] flex-shrink-0 bg-av-dark flex flex-col px-4 py-5 rounded-r-2xl">
      {/* Logo */}
      <div className="flex items-center gap-3 mb-7 pb-4 border-b border-blue-400/20">
        <div className="w-9 h-9 rounded-[10px] bg-av-dark border border-blue-400/30 flex items-center justify-center flex-shrink-0">
          <Logo />
        </div>
        <div>
          <p className="text-[13px] font-bold text-white leading-tight">Arquiteto<br/>de Valor</p>
          <p className="text-[9px] text-av-green tracking-[2px]">BLUEPRINT</p>
        </div>
      </div>

      <NavGroup label="Principal"   items={navPrincipal}   />
      <div className="h-px bg-blue-400/15 my-2" />
      <NavGroup label="Cadastros"   items={navCadastros}   />
      <div className="h-px bg-blue-400/15 my-2" />
      <NavGroup label="Ferramentas" items={navFerramentas} />

      <div className="flex-1" />

      {/* Rodapé */}
      <div className="flex items-center justify-between pt-3 border-t border-blue-400/15">
        <span className="text-[11px] text-white/30 truncate">{nome}</span>
        <div className="flex items-center gap-1">
          <button
            onClick={toggle}
            className="p-1.5 rounded-md text-white/30 hover:text-white/70 hover:bg-white/5 transition-colors"
            title={dark ? 'Tema claro' : 'Tema escuro'}
          >
            {dark ? <Sun size={14}/> : <Moon size={14}/>}
          </button>
          <button
            onClick={signOut}
            className="p-1.5 rounded-md text-white/30 hover:text-red-400 hover:bg-white/5 transition-colors"
            title="Sair"
          >
            <LogOut size={14}/>
          </button>
        </div>
      </div>
    </nav>
  )
}
