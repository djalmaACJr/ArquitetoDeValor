import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import { useAuth } from './hooks/useAuth'
import AppLayout from './components/layout/AppLayout'
import LoginPage from './pages/LoginPage'
import LandingPage from './pages/LandingPage'
import CadastroPage from './pages/CadastroPage'
import RedefinirSenhaPage from './pages/RedefinirSenhaPage'
import { PageStateProvider } from './context/PageStateContext'
import { ContextoIAProvider } from './context/ContextoIAContext'
import { LoadingMascoteEstatico } from './components/ui/LoadingMascote'

// Páginas autenticadas são carregadas sob demanda (code-splitting).
// Reduz o bundle inicial em ~50% — antes essas 11 páginas (≈14 mil LoC)
// vinham todas no JS de entrada.
const DashboardPage          = lazy(() => import('./pages/DashboardPage'))
const RelatoriosPage         = lazy(() => import('./pages/RelatoriosPage'))
const ContasPage             = lazy(() => import('./pages/ContasPage'))
const CategoriasPage         = lazy(() => import('./pages/CategoriasPage'))
const LancamentosPage        = lazy(() => import('./pages/LancamentosPage'))
const ImportExportPage       = lazy(() => import('./pages/ImportExportPage'))
const ImportarFaturaPage     = lazy(() => import('./pages/ImportarFaturaPage'))
const ComparativoMensalPage  = lazy(() => import('./pages/ComparativoMensalPage'))
const ProgressaoAnualPage    = lazy(() => import('./pages/ProgressaoAnualPage'))
const AssinaturasPage        = lazy(() => import('./pages/AssinaturasPage'))
const ProjecaoEconomiaPage   = lazy(() => import('./pages/ProjecaoEconomiaPage'))
const ApresentacaoMascotes   = lazy(() => import('./pages/ApresentacaoMascotes'))
const CompartilhamentoPage   = lazy(() => import('./pages/CompartilhamentoPage'))
const AceitarConvitePage     = lazy(() => import('./pages/AceitarConvitePage'))
const PerfilPage             = lazy(() => import('./pages/PerfilPage'))
const ObjetivosPage          = lazy(() => import('./pages/ObjetivosPage'))
const ObjetivoDetalhe        = lazy(() => import('./pages/ObjetivoDetalhe'))
const InvestimentosPage      = lazy(() => import('./pages/InvestimentosPage'))
const ConfiguracoesInvestimentosPage = lazy(() => import('./pages/ConfiguracoesInvestimentosPage'))
const QuestionariosInvestimentosPage = lazy(() => import('./pages/QuestionariosInvestimentosPage'))
const AtivosInvestimentosPage = lazy(() => import('./pages/AtivosInvestimentosPage'))
const AvaliacoesInvestimentosPage = lazy(() => import('./pages/AvaliacoesInvestimentosPage'))
const ConselhoInvestimentosPage = lazy(() => import('./pages/ConselhoInvestimentosPage'))
const DetalheInvestimentoPage = lazy(() => import('./pages/DetalheInvestimentoPage'))
const DestaquesInvestimentosPage = lazy(() => import('./pages/DestaquesInvestimentosPage'))
const ExtratoInvestimentosPage = lazy(() => import('./pages/ExtratoInvestimentosPage'))
const DividendosPage         = lazy(() => import('./pages/DividendosPage'))
const SobrePage              = lazy(() => import('./pages/SobrePage'))
const AdminCronsPage         = lazy(() => import('./pages/AdminCronsPage'))
const AdminAuditoriaPage     = lazy(() => import('./pages/AdminAuditoriaPage'))

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-av-dark">
      <LoadingMascoteEstatico texto="Carregando…" size={160} />
    </div>
  )
  if (session) return <>{children}</>
  // Exceção só pra raiz do site NO NAVEGADOR: visitante não-autenticado vê a
  // página de propaganda (LandingPage) em vez de ser jogado direto pro
  // /login. Link direto pra qualquer página interna (ex.: /lancamentos)
  // continua exigindo login normalmente. No app Android instalado
  // (Capacitor) não faz sentido mostrar propaganda do próprio app pra quem
  // já o instalou — vai direto pro login, como antes da LandingPage existir.
  if (location.pathname === '/' && !Capacitor.isNativePlatform()) return <LandingPage/>
  // Preserva a rota pedida (ex.: /aceitar-convite?token=...) pra LoginPage
  // voltar pra cá depois do login — sem isso, um link de convite aberto
  // deslogado jogava a pessoa pro login e perdia o token de vista.
  const next = encodeURIComponent(location.pathname + location.search)
  return <Navigate to={`/login?next=${next}`} replace/>
}

// Fallback usado pelo Suspense enquanto o chunk da página é baixado.
function FallbackPagina() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <LoadingMascoteEstatico texto="Carregando…" size={130} />
    </div>
  )
}

export default function App() {
  // userId no key do PageStateProvider força reset do estado de filtros
  // (filtContas, filtCats, etc.) ao trocar de usuário — sem isso, IDs do
  // usuário anterior vazariam para o novo (ex.: contaIdInicial do drawer).
  const { session } = useAuth()
  const userId = session?.user?.id ?? null
  return (
    <BrowserRouter>
      <PageStateProvider key={userId ?? 'anon'} userId={userId}>
        <ContextoIAProvider>
        <Suspense fallback={<FallbackPagina/>}>
        <Routes>
          <Route path="/login"    element={<LoginPage/>}/>
          <Route path="/cadastro"        element={<CadastroPage/>}/>
          <Route path="/redefinir-senha" element={<RedefinirSenhaPage/>}/>
          <Route path="/apresentacao" element={
            <PrivateRoute>
              <ApresentacaoMascotes/>
            </PrivateRoute>
          }/>
          <Route path="/aceitar-convite" element={
            <PrivateRoute>
              <AceitarConvitePage/>
            </PrivateRoute>
          }/>
          <Route path="/" element={
            <PrivateRoute>
              <AppLayout/>
            </PrivateRoute>
          }>
            <Route index              element={<DashboardPage/>}/>
            <Route path="lancamentos" element={<LancamentosPage/>}/>
            <Route path="contas"      element={<ContasPage/>}/>
            <Route path="categorias"  element={<CategoriasPage/>}/>
            <Route path="relatorios"   element={<RelatoriosPage/>}/>
            <Route path="comparativo"  element={<ComparativoMensalPage/>}/>
            <Route path="progressao"   element={<ProgressaoAnualPage/>}/>
            <Route path="assinaturas" element={<AssinaturasPage/>}/>
            <Route path="projecao"    element={<ProjecaoEconomiaPage/>}/>
            <Route path="importexport" element={<ImportExportPage/>}/>
            <Route path="objetivos"        element={<ObjetivosPage/>}/>
            <Route path="objetivos/:id"    element={<ObjetivoDetalhe/>}/>
            <Route path="investimentos"        element={<InvestimentosPage/>}/>
            <Route path="investimentos/destaques" element={<DestaquesInvestimentosPage/>}/>
            <Route path="investimentos/extrato" element={<ExtratoInvestimentosPage/>}/>
            <Route path="investimentos/configuracoes" element={<ConfiguracoesInvestimentosPage/>}/>
            <Route path="investimentos/questionarios" element={<QuestionariosInvestimentosPage/>}/>
            <Route path="investimentos/ativos" element={<AtivosInvestimentosPage/>}/>
            <Route path="investimentos/avaliacoes" element={<AvaliacoesInvestimentosPage/>}/>
            <Route path="investimentos/conselho" element={<ConselhoInvestimentosPage/>}/>
            <Route path="investimentos/ativos/:id" element={<DetalheInvestimentoPage/>}/>
            <Route path="investimentos/dividendos" element={<DividendosPage/>}/>
            <Route path="importar-fatura"      element={<ImportarFaturaPage/>}/>
            <Route path="importar-fatura/:id"  element={<ImportarFaturaPage/>}/>
            <Route path="perfil"       element={<PerfilPage/>}/>
            <Route path="compartilhamento" element={<CompartilhamentoPage/>}/>
            <Route path="sobre"        element={<SobrePage/>}/>
            <Route path="admin/crons"  element={<AdminCronsPage/>}/>
            <Route path="admin/auditoria" element={<AdminAuditoriaPage/>}/>
          </Route>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
        </Suspense>
        </ContextoIAProvider>
      </PageStateProvider>
    </BrowserRouter>
  )
}
