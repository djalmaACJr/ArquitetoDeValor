import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import DashboardPage from './pages/DashboardPage'
import RelatoriosPage from './pages/RelatoriosPage'
import ContasPage from './pages/ContasPage'
import CategoriasPage from './pages/CategoriasPage'
import LancamentosPage from './pages/LancamentosPage'
import ImportExportPage from './pages/ImportExportPage'
import { PageStateProvider } from './context/PageStateContext'

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-av-dark">
      <div className="text-av-green text-sm">Carregando...</div>
    </div>
  )
  return session ? <>{children}</> : <Navigate to="/login" replace/>
}

export default function App() {
  return (
    <BrowserRouter>
      <PageStateProvider>
        <Routes>
          <Route path="/login" element={<LoginPage/>}/>
          <Route path="/" element={
            <PrivateRoute>
              <AppLayout/>
            </PrivateRoute>
          }>
            <Route index              element={<DashboardPage/>}/>
            <Route path="lancamentos" element={<LancamentosPage/>}/>
            <Route path="contas"      element={<ContasPage/>}/>
            <Route path="categorias"  element={<CategoriasPage/>}/>
            <Route path="relatorios"  element={<RelatoriosPage/>}/>
            <Route path="importexport" element={<ImportExportPage/>}/>
          </Route>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
      </PageStateProvider>
    </BrowserRouter>
  )
}
