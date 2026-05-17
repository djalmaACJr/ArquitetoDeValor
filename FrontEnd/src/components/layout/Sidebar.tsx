import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, List, CreditCard, Tag,
  ArrowLeftRight, FileText, Moon, Sun, LogOut,
  ChevronLeft, ChevronRight, ChevronDown, Settings, GitCompare, Repeat2, TrendingUp,
} from 'lucide-react'
import { useTheme } from '../../hooks/useTheme'
import { useAuth } from '../../hooks/useAuth'
import AppVersion from '../ui/AppVersion'

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

// ── Componente reutilizável de ícone de conta ─────────────
// Exportado para uso em DashboardPage e ContasPage
export function IconeConta({
  icone, cor, size = 'md',
}: {
  icone?: string | null
  cor?:   string | null
  size?:  'sm' | 'md' | 'lg'
}) {
  const dims  = { sm: 'w-5 h-5', md: 'w-8 h-8', lg: 'w-10 h-10' }[size]
  const texto = { sm: 'text-xs',  md: 'text-sm',  lg: 'text-lg'  }[size]
  const bg    = cor ? `${cor}20` : 'rgba(77,166,255,0.12)'
  const isUrl = !!(icone?.startsWith('http') || icone?.startsWith('/') || icone?.startsWith('data:'))

  return (
    <div
      className={`${dims} rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden`}
      style={{ background: bg }}
    >
      {isUrl ? (
        <img
          src={icone!}
          alt=""
          className="w-full h-full object-contain p-[3px]"
          onError={e => {
            const img = e.target as HTMLImageElement
            img.style.display = 'none'
            img.parentElement!.textContent = '🏦'
          }}
        />
      ) : (
        <span className={texto}>{icone || '🏦'}</span>
      )}
    </div>
  )
}

interface NavChild {
  to:    string
  icon:  React.ReactNode
  label: string
}
interface NavItem {
  to:       string
  icon:     React.ReactNode
  label:    string
  soon?:    boolean
  children?: NavChild[]
}

const navPrincipal: NavItem[] = [
  { to: '/',            icon: <LayoutDashboard size={15}/>, label: 'Painel principal' },
  { to: '/lancamentos', icon: <List size={15}/>,            label: 'Extratos' },
]
const navCadastros: NavItem[] = [
  { to: '/contas',     icon: <CreditCard size={15}/>, label: 'Contas' },
  { to: '/categorias', icon: <Tag size={15}/>,        label: 'Categorias' },
]
const navRelatorios: NavItem[] = [
  {
    to: '/relatorios',
    icon: <FileText size={15}/>,
    label: 'Relatórios',
    children: [
      { to: '/relatorios',   icon: <FileText size={13}/>,   label: 'Resumo geral' },
      { to: '/comparativo',  icon: <GitCompare size={13}/>, label: 'Comparativo Períodos' },
      { to: '/assinaturas',  icon: <Repeat2 size={13}/>,    label: 'Gastos Recorrentes' },
      { to: '/projecao',     icon: <TrendingUp size={13}/>, label: 'Projeção de Economia' },
    ],
  },
]
const navFerramentas: NavItem[] = [
  { to: '/importexport', icon: <ArrowLeftRight size={15}/>, label: 'Ferramentas' },
]

function NavExpandable({ item, collapsed }: { item: NavItem & { children: NavChild[] }; collapsed: boolean }) {
  const { pathname } = useLocation()
  const anyActive = item.children.some(c => pathname === c.to || pathname.startsWith(c.to + '/'))
  const [open, setOpen] = useState(anyActive)

  if (collapsed) {
    // Sidebar recolhido: o pai segue como ícone único, mas ao passar o mouse
    // (ou foco via teclado) revela um flyout à direita com os filhos. Garante
    // que todos os relatórios fiquem acessíveis sem aumentar a barra.
    return (
      <div className="relative group">
        <NavLink
          to={item.to}
          title={item.label}
          className={`flex items-center justify-center px-2 py-[7px] rounded-lg text-[17px] mb-[1px] transition-colors ${
            anyActive ? 'bg-av-green/15 text-av-green font-medium' : 'text-white/60 hover:bg-blue-400/8 hover:text-white/90'
          }`}
        >
          {item.icon}
        </NavLink>
        {/* Flyout. O wrapper tem `pl-2` (transparente) servindo de "bridge"
            entre o ícone e o painel — sem essa ponte, o cursor saía do ícone
            antes de entrar no flyout e o hover quebrava. O painel visual é a
            div interna. */}
        <div
          className="absolute left-full top-0 pl-2 z-50 opacity-0 invisible pointer-events-none group-hover:opacity-100 group-hover:visible group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto transition-opacity duration-100"
          role="menu"
        >
          <div className="min-w-[200px] py-1 rounded-lg bg-av-dark border border-blue-400/30 shadow-xl">
            <p className="px-3 pt-1.5 pb-1 text-[13px] uppercase tracking-widest text-blue-400/60">
              {item.label}
            </p>
            {item.children.map(child => (
              <NavLink
                key={child.to}
                to={child.to}
                end={child.to === item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-1.5 text-[16px] transition-colors ${
                    isActive
                      ? 'bg-av-green/15 text-av-green font-medium'
                      : 'text-white/70 hover:bg-blue-400/10 hover:text-white'
                  }`
                }
              >
                {child.icon}
                <span className="flex-1">{child.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Linha do pai: NavLink (vai para o destino default — Resumo geral) com
          um chevron-button separado à direita pra abrir/fechar o submenu.
          Manter como link garante que ferramentas que buscam por `role="link"`
          (testes E2E, navegação por teclado) continuem encontrando "Relatórios". */}
      <div className="flex items-center gap-1">
        <NavLink
          to={item.to}
          className={({ isActive }) =>
            `flex-1 flex items-center gap-2 px-2 py-[7px] rounded-lg text-[17px] mb-[1px] transition-colors ${
              isActive || anyActive
                ? 'bg-av-green/10 text-av-green'
                : 'text-white/60 hover:bg-blue-400/8 hover:text-white/90'
            }`
          }
        >
          {item.icon}
          <span className="flex-1 text-left">{item.label}</span>
        </NavLink>
        <button
          onClick={() => setOpen(v => !v)}
          title={open ? 'Recolher' : 'Expandir'}
          className="p-1 rounded text-white/40 hover:text-white/80 hover:bg-blue-400/8 transition-colors"
          aria-expanded={open}
          aria-label={open ? 'Recolher submenu' : 'Expandir submenu'}
        >
          {open ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}
        </button>
      </div>
      {open && (
        <div className="ml-3 border-l border-blue-400/15 pl-2 mb-1">
          {item.children.map(child => (
            <NavLink
              key={child.to}
              to={child.to}
              end={child.to === item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-2 py-[6px] rounded-lg text-[16px] mb-[1px] transition-colors ${
                  isActive
                    ? 'bg-av-green/15 text-av-green font-medium'
                    : 'text-white/50 hover:bg-blue-400/8 hover:text-white/80'
                }`
              }
            >
              {child.icon}
              <span className="flex-1">{child.label}</span>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  )
}

function NavGroup({ label, items, collapsed }: { label: string; items: NavItem[]; collapsed: boolean }) {
  return (
    <div className="mb-2">
      {!collapsed && (
        <p className="text-[14px] uppercase tracking-widest text-blue-400/50 px-2 mb-1">{label}</p>
      )}
      {items.map(item =>
        item.children && item.children.length > 0 ? (
          <NavExpandable key={item.to} item={item as NavItem & { children: NavChild[] }} collapsed={collapsed} />
        ) : (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `flex items-center gap-2 px-2 py-[7px] rounded-lg text-[17px] mb-[1px] transition-colors ${
                collapsed ? 'justify-center' : ''
              } ${
                isActive
                  ? 'bg-av-green/15 text-av-green font-medium'
                  : 'text-white/60 hover:bg-blue-400/8 hover:text-white/90'
              }`
            }
          >
            {item.icon}
            {!collapsed && (
              <>
                <span className="flex-1">{item.label}</span>
                {item.soon && (
                  <span className="text-[13px] px-[6px] py-[2px] rounded-full bg-av-amber/15 text-av-amber">
                    em breve
                  </span>
                )}
              </>
            )}
          </NavLink>
        )
      )}
    </div>
  )
}

export default function Sidebar() {
  const { dark, toggle } = useTheme()
  const { signOut, session } = useAuth()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  const nome  = session?.user?.user_metadata?.nome
    ?? session?.user?.email?.split('@')[0]
    ?? 'Usuário'
  const email = session?.user?.email ?? ''

  return (
    <nav
      className={`flex-shrink-0 bg-av-dark flex flex-col px-3 py-5 rounded-r-2xl transition-all duration-300 relative sticky top-0 h-screen ${
        collapsed ? 'w-[60px]' : 'w-[216px]'
      }`}
    >
      {/* Botão de colapso */}
      <button
        onClick={() => setCollapsed(v => !v)}
        title={collapsed ? 'Expandir menu' : 'Recolher menu'}
        className="absolute -right-3 top-6 z-10 w-6 h-6 rounded-full bg-av-dark border border-blue-400/30 flex items-center justify-center text-white/60 hover:text-av-green hover:border-av-green/50 transition-colors shadow-md"
      >
        {collapsed ? <ChevronRight size={12}/> : <ChevronLeft size={12}/>}
      </button>

      {/* Logo */}
      <div className={`flex items-center gap-3 mb-7 pb-4 border-b border-blue-400/20 ${collapsed ? 'justify-center' : ''}`}>
        <div className="w-9 h-9 rounded-[10px] bg-av-dark border border-blue-400/30 flex items-center justify-center flex-shrink-0">
          <Logo />
        </div>
        {!collapsed && (
          <div>
            <p className="text-[17px] font-bold text-white leading-tight">Arquiteto<br/>de Valor</p>
            <p className="text-[13px] text-av-green tracking-[2px]">BLUEPRINT</p>
          </div>
        )}
      </div>

      <NavGroup label="Principal"   items={navPrincipal}   collapsed={collapsed} />
      <div className="h-px bg-blue-400/15 my-2" />
      <NavGroup label="Cadastros"   items={navCadastros}   collapsed={collapsed} />
      <div className="h-px bg-blue-400/15 my-2" />
      <NavGroup label="Relatórios"  items={navRelatorios}  collapsed={collapsed} />
      <div className="h-px bg-blue-400/15 my-2" />
      <NavGroup label="Ferramentas" items={navFerramentas} collapsed={collapsed} />

      <div className="flex-1" />

      {/* Rodapé - fixo no fundo, sempre visível */}
      <div className={`pt-3 border-t border-blue-400/30 bg-av-dark ${collapsed ? 'flex flex-col items-center gap-2' : ''}`}>
        {!collapsed && (
          <div className="w-full mb-2 px-1 py-1">
            <p className="text-[16px] font-semibold text-white truncate">{nome}</p>
            <p className="text-[14px] text-blue-300/60 truncate">{email}</p>
          </div>
        )}
        <div className={`flex items-center gap-1 ${collapsed ? 'flex-col' : 'px-1'}`}>
          <button
            onClick={() => navigate('/perfil')}
            className="p-2 rounded-lg text-white/70 hover:text-blue-400 hover:bg-blue-400/10 transition-colors flex-shrink-0"
            title="Perfil"
          >
            <Settings size={15}/>
          </button>
          <button
            onClick={toggle}
            className="p-2 rounded-lg text-white/70 hover:text-av-amber hover:bg-av-amber/15 transition-colors flex-shrink-0"
            title={dark ? 'Tema claro' : 'Tema escuro'}
          >
            {dark ? <Sun size={15}/> : <Moon size={15}/>}
          </button>
          <button
            onClick={signOut}
            className="flex-1 flex items-center gap-2 px-2 py-2 rounded-lg text-white/70 hover:text-red-400 hover:bg-red-400/10 transition-colors"
            title="Sair"
          >
            <LogOut size={15}/>
            {!collapsed && <span className="text-[16px] font-medium">Sair</span>}
          </button>
        </div>
        {!collapsed && (
          <div className="mt-2 px-1">
            <AppVersion />
          </div>
        )}
      </div>
    </nav>
  )
}
