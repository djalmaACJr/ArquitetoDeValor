// src/contexts/PageStateContext.tsx
// Mantém o estado de filtros/mês de cada página enquanto o app está aberto.
// Evita que ao navegar entre páginas o estado seja resetado.

import { createContext, useContext, useState, useCallback } from 'react'
import { mesAtual } from '../lib/utils'

// ── Estado por página ────────────────────────────────────────
interface LancamentosState {
  mes:        string
  filtContas: string[]
  filtCats:   string[]
  filtStatus: string[]
  comSaldo:   boolean
}

interface DashboardState {
  mes:          string
  contasFiltro: string[]
  modo:         'hoje' | 'fim'
}

interface RelatoriosState {
  inicio:        string
  fim:           string
  filtStatus:    string[]
  filtContas:    string[]
  filtCats:      string[]
  incluirTransf: boolean
  lancamentos:   unknown[]
  buscado:       boolean
}

interface PageStateContextValue {
  lancamentos:    LancamentosState
  setLancamentos: (s: Partial<LancamentosState>) => void
  dashboard:      DashboardState
  setDashboard:   (s: Partial<DashboardState>) => void
  relatorios:     RelatoriosState
  setRelatorios:  (s: Partial<RelatoriosState>) => void
}

// ── Valores iniciais ─────────────────────────────────────────
function mesAnterior(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

const LANCAMENTOS_INICIAL: LancamentosState = {
  mes:        mesAtual(),
  filtContas: [],
  filtCats:   [],
  filtStatus: [],
  comSaldo:   true,
}

const DASHBOARD_INICIAL: DashboardState = {
  mes:          mesAtual(),
  contasFiltro: [],
  modo:         'hoje',
}

const RELATORIOS_INICIAL: RelatoriosState = {
  inicio:        mesAnterior(5),
  fim:           mesAtual(),
  filtStatus:    [],
  filtContas:    [],
  filtCats:      [],
  incluirTransf: false,
  lancamentos:   [],
  buscado:       false,
}

// ── Context ──────────────────────────────────────────────────
const PageStateContext = createContext<PageStateContextValue | null>(null)

// eslint-disable-next-line react-refresh/only-export-components
export function usePageState() {
  const ctx = useContext(PageStateContext)
  if (!ctx) throw new Error('usePageState deve ser usado dentro de PageStateProvider')
  return ctx
}

export function PageStateProvider({ children }: { children: React.ReactNode }) {
  const [lancamentos, setLancamentosState] = useState<LancamentosState>(LANCAMENTOS_INICIAL)
  const [dashboard,   setDashboardState]   = useState<DashboardState>(DASHBOARD_INICIAL)
  const [relatorios,  setRelatoriosState]  = useState<RelatoriosState>(RELATORIOS_INICIAL)

  const setLancamentos = useCallback((s: Partial<LancamentosState>) =>
    setLancamentosState(prev => ({ ...prev, ...s })), [])

  const setDashboard = useCallback((s: Partial<DashboardState>) =>
    setDashboardState(prev => ({ ...prev, ...s })), [])

  const setRelatorios = useCallback((s: Partial<RelatoriosState>) =>
    setRelatoriosState(prev => ({ ...prev, ...s })), [])

  return (
    <PageStateContext.Provider value={{
      lancamentos, setLancamentos,
      dashboard,   setDashboard,
      relatorios,  setRelatorios,
    }}>
      {children}
    </PageStateContext.Provider>
  )
}

