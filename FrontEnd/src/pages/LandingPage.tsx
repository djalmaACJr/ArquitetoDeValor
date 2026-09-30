// src/pages/LandingPage.tsx
//
// Página pública de propaganda, exibida na raiz "/" para visitantes NÃO
// autenticados (ver PrivateRoute em App.tsx — é a única exceção onde "/"
// não exige login; qualquer outro link interno continua redirecionando pro
// /login normalmente). Usuário autenticado nunca vê esta página: "/" some
// direto para o Dashboard nesse caso.
//
// Os "prints" de tela (MockupDashboard/MockupObjetivos/MockupInvestimentos)
// são mockups ilustrativos desenhados em CSS/SVG, não screenshots reais do
// app nem dados de usuário de verdade — decisão consciente para não expor
// dados de uma conta real numa página pública. As artes dos mascotes (Arquiteta,
// Raposa, Sábio, Gato — ver "Mascotes + IA" no CLAUDE.md) vêm dos sprites já
// usados dentro do app (public/mascotes/), dando um tom mais leve à página.

import { useEffect, type ReactNode, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import {
  Wallet, Repeat, ArrowLeftRight, FolderTree, BarChart3, FileUp,
  Target, TrendingUp, LineChart, Coins, Landmark, Sparkles, ArrowRight,
} from 'lucide-react'
import { APP_VERSION } from '../config/version'

const LogoSVG = () => (
  <svg width="40" height="40" viewBox="0 0 64 64">
    <path d="M32,10 L14,50" fill="none" stroke="#4da6ff" strokeWidth="4" strokeLinecap="round"/>
    <path d="M32,10 L50,50" fill="none" stroke="#4da6ff" strokeWidth="4" strokeLinecap="round"/>
    <circle cx="32" cy="10" r="3.5" fill="#4da6ff"/>
    <polyline points="14,50 26,38 38,42 50,26"
      fill="none" stroke="#00c896" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="50" cy="26" r="4.5" fill="#f0b429"/>
  </svg>
)

interface Feature {
  icon: typeof Wallet
  titulo: string
  descricao: string
}

// Blob de cor desfocado — o "glow" atrás de mascotes e da hero, reaproveitado
// em várias seções com cor/posição diferentes.
function Blob({ cor, className }: { cor: string; className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute rounded-full blur-3xl pointer-events-none ${className ?? ''}`}
      style={{ background: cor }}
    />
  )
}

// Mascote flutuante com glow atrás. `delay`/`duracao` dessincronizam a
// flutuação entre instâncias na mesma tela.
function Mascote({ src, cor, delay = 0, duracao = 6, className = '' }: {
  src: string
  cor: string
  delay?: number
  duracao?: number
  className?: string
}) {
  const style: CSSProperties = {
    animation: `flutuar ${duracao}s ease-in-out ${delay}s infinite`,
  }
  return (
    <div className={`relative ${className}`}>
      <Blob cor={cor} className="inset-0 opacity-40" />
      <img
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="relative w-full h-auto drop-shadow-2xl"
        style={style}
      />
    </div>
  )
}

const bgGrid = 'repeating-linear-gradient(0deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px),repeating-linear-gradient(90deg,transparent,transparent 19px,#4da6ff 19px,#4da6ff 20px)'

function CardFeature({ icon: Icon, titulo, descricao }: Feature) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:border-white/20 hover:bg-white/[0.07] hover:-translate-y-0.5 transition-all">
      <div className="w-10 h-10 rounded-xl bg-av-green/10 border border-av-green/30 flex items-center justify-center mb-3">
        <Icon size={18} className="text-av-green" />
      </div>
      <h3 className="text-white font-semibold text-[16px] mb-1.5">{titulo}</h3>
      <p className="text-white/50 text-[14px] leading-relaxed">{descricao}</p>
    </div>
  )
}

// Moldura estilo "janela do app" que envolve cada mockup ilustrativo.
function MockupFrame({ children }: { children: ReactNode }) {
  return (
    <div className="w-full rounded-2xl border border-white/10 bg-[#0d1220] shadow-2xl overflow-hidden">
      <div className="flex items-center gap-1.5 px-4 py-3 border-b border-white/10 bg-white/[0.03]">
        <span className="w-2.5 h-2.5 rounded-full bg-red-400/50" />
        <span className="w-2.5 h-2.5 rounded-full bg-av-amber/50" />
        <span className="w-2.5 h-2.5 rounded-full bg-av-green/50" />
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function MockupDashboard() {
  const barras = [40, 62, 50, 78, 58, 90]
  const lancamentos = [
    { cor: '#4da6ff', nome: 'Salário',       valor: '+ R$ 6.200,00' },
    { cor: '#f0b429', nome: 'Supermercado',  valor: '– R$ 480,00'   },
    { cor: '#00c896', nome: 'Transferência', valor: '– R$ 1.000,00' },
  ]
  return (
    <MockupFrame>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-white/40 text-[12px]">Saldo total</p>
          <p className="text-white text-2xl font-bold">R$ 18.420,00</p>
        </div>
        <span className="text-av-green text-[13px] font-semibold bg-av-green/10 border border-av-green/30 rounded-full px-2.5 py-1">
          +12,4%
        </span>
      </div>
      <div className="flex items-end gap-2 h-24 mb-5">
        {barras.map((h, i) => (
          <div key={i} className="flex-1 rounded-t-md"
            style={{ height: `${h}%`, background: i === barras.length - 1 ? '#00c896' : 'rgba(255,255,255,0.12)' }} />
        ))}
      </div>
      <div className="space-y-2.5">
        {lancamentos.map(l => (
          <div key={l.nome} className="flex items-center justify-between text-[13px]">
            <span className="flex items-center gap-2 text-white/70">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: l.cor }} />
              {l.nome}
            </span>
            <span className="text-white/50">{l.valor}</span>
          </div>
        ))}
      </div>
    </MockupFrame>
  )
}

function MockupObjetivos() {
  const itens = [
    { emoji: '💰', nome: 'Patrimônio',       pct: 68 },
    { emoji: '🎯', nome: 'Renda recorrente', pct: 42 },
    { emoji: '📈', nome: 'Evolução anual',   pct: 85 },
  ]
  return (
    <MockupFrame>
      <div className="space-y-5">
        {itens.map(it => (
          <div key={it.nome}>
            <div className="flex items-center justify-between mb-1.5 text-[13px]">
              <span className="text-white/70 flex items-center gap-1.5">
                <span>{it.emoji}</span>{it.nome}
              </span>
              <span className="text-white/40">{it.pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full rounded-full bg-av-amber" style={{ width: `${it.pct}%` }} />
            </div>
          </div>
        ))}
      </div>
    </MockupFrame>
  )
}

function MockupInvestimentos() {
  const ativos = [
    { tk: 'PETR4',        dy: '9,8%'  },
    { tk: 'MXRF11',       dy: '11,2%' },
    { tk: 'Tesouro IPCA+', dy: '6,4%' },
  ]
  return (
    <MockupFrame>
      <div className="flex items-center gap-5 mb-5">
        <svg width="84" height="84" viewBox="0 0 36 36" className="-rotate-90 flex-shrink-0">
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="4" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#4da6ff" strokeWidth="4"
            strokeDasharray="37 97.4" strokeLinecap="round" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#00c896" strokeWidth="4"
            strokeDasharray="34 97.4" strokeDashoffset="-37" strokeLinecap="round" />
          <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f0b429" strokeWidth="4"
            strokeDasharray="26 97.4" strokeDashoffset="-71" strokeLinecap="round" />
        </svg>
        <div className="text-[13px] space-y-1.5">
          <span className="flex items-center gap-2 text-white/70"><span className="w-2 h-2 rounded-full bg-av-blue" />Ações · 38%</span>
          <span className="flex items-center gap-2 text-white/70"><span className="w-2 h-2 rounded-full bg-av-green" />FIIs · 35%</span>
          <span className="flex items-center gap-2 text-white/70"><span className="w-2 h-2 rounded-full bg-av-amber" />Renda fixa · 27%</span>
        </div>
      </div>
      <div className="space-y-2.5 pt-1 border-t border-white/8">
        {ativos.map(a => (
          <div key={a.tk} className="flex items-center justify-between text-[13px] pt-2.5">
            <span className="text-white/70 font-medium">{a.tk}</span>
            <span className="text-av-green">DY {a.dy}</span>
          </div>
        ))}
      </div>
    </MockupFrame>
  )
}

function Secao({ eyebrow, titulo, cor, features, mockup, mascote, reverso = false }: {
  eyebrow: string
  titulo: string
  cor: string
  features: Feature[]
  mockup: ReactNode
  mascote: ReactNode
  reverso?: boolean
}) {
  return (
    <section className="relative w-full max-w-5xl mx-auto px-4 py-14">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12 items-center mb-10">
        <div className={reverso ? 'lg:order-2' : ''}>
          <p className="text-[13px] font-semibold tracking-[2px] mb-1.5" style={{ color: cor }}>
            {eyebrow}
          </p>
          <h2 className="text-white text-xl md:text-2xl font-bold">{titulo}</h2>
        </div>
        <div className={`relative flex items-center gap-4 ${reverso ? 'lg:order-1' : ''}`}>
          {/* Ordem SEM prefixo de breakpoint (ao contrário do wrapper acima):
              a mascote precisa ficar do lado certo do mockup — e portanto
              apontar pra ele — assim que aparece (sm:), não só a partir do lg. */}
          <div className={`flex-1 min-w-0 ${reverso ? 'order-2' : ''}`}>{mockup}</div>
          <div className={`hidden sm:block w-24 md:w-28 flex-shrink-0 ${reverso ? 'order-1' : ''}`}>{mascote}</div>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {features.map(f => <CardFeature key={f.titulo} {...f} />)}
      </div>
    </section>
  )
}

export default function LandingPage() {
  // Força tema escuro na landing, independente da preferência salva do
  // navegador — mesmo tratamento do LoginPage, já que ambas são telas
  // públicas fora do app autenticado (o toggle claro/escuro só existe
  // dentro do app, em Perfil).
  useEffect(() => {
    const html = document.documentElement
    const hadDark = html.classList.contains('dark')
    html.classList.add('dark')
    return () => { if (!hadDark) html.classList.remove('dark') }
  }, [])

  return (
    <div className="min-h-screen bg-av-dark overflow-x-hidden">
      <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{ backgroundImage: bgGrid }} />
      <Blob cor="#4da6ff" className="w-[420px] h-[420px] opacity-[0.12] -top-40 -left-32" />
      <Blob cor="#00c896" className="w-[380px] h-[380px] opacity-[0.10] top-[520px] -right-40" />
      <Blob cor="#f0b429" className="w-[340px] h-[340px] opacity-[0.08] top-[1200px] -left-28" />

      {/* Header */}
      <header className="sticky top-0 z-20 backdrop-blur-md bg-av-dark/70 border-b border-white/5">
        <div className="relative flex items-center justify-between max-w-5xl mx-auto px-4 py-4">
          <div className="flex items-center gap-2.5">
            <LogoSVG />
            <span className="text-white font-bold text-[17px]">Arquiteto de Valor</span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-white/70 hover:text-white text-[15px] font-medium transition-colors px-2">
              Entrar
            </Link>
            <Link to="/cadastro"
              className="bg-av-green text-av-dark font-semibold rounded-lg px-4 py-2 text-[15px] hover:bg-av-green/90 transition-colors">
              Criar conta
            </Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative max-w-5xl mx-auto px-4 pt-14 pb-16">
        <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr] gap-10 items-center">
          <div className="text-center lg:text-left flex flex-col items-center lg:items-start">
            <p className="text-av-green text-[14px] font-semibold tracking-[3px] mb-3">
              CONTROLE FINANCEIRO PESSOAL
            </p>
            <h1 className="text-3xl md:text-5xl font-bold leading-tight max-w-xl">
              <span className="text-white">Organize suas contas, </span>
              <span className="bg-gradient-to-r from-av-blue via-av-green to-av-green bg-clip-text text-transparent">
                atinja objetivos
              </span>
              <span className="text-white"> e faça seu dinheiro render</span>
            </h1>
            <p className="text-white/50 text-[16px] md:text-[18px] mt-5 max-w-lg leading-relaxed">
              Lançamentos, transferências, metas e investimentos em um só lugar —
              com relatórios claros e dados que mostram exatamente para onde vai
              cada real.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-3 mt-8">
              <Link to="/cadastro"
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-av-green text-av-dark font-semibold rounded-lg px-6 py-3 text-[16px] hover:bg-av-green/90 hover:-translate-y-0.5 transition-all">
                Criar conta grátis
                <ArrowRight size={17} />
              </Link>
              <Link to="/login"
                className="w-full sm:w-auto text-center border border-white/15 text-white font-semibold rounded-lg px-6 py-3 text-[16px] hover:border-white/30 transition-colors">
                Já tenho conta
              </Link>
            </div>
          </div>

          {/* Mascote de boas-vindas + cartão flutuante, só decorativo. */}
          <div className="relative flex justify-center lg:justify-end">
            <div className="relative w-48 md:w-64">
              <Blob cor="#00c896" className="inset-0 opacity-30" />
              <img
                src="/mascotes/arquiteta-comprimento-inicio.png"
                alt="Mascote Arquiteta acenando, de boas-vindas"
                className="relative w-full h-auto drop-shadow-2xl"
                style={{ animation: 'flutuar 7s ease-in-out infinite' }}
              />
            </div>
            <div
              className="hidden sm:block absolute -left-4 bottom-8 bg-[#0d1220]/90 border border-white/10 rounded-xl px-3.5 py-2.5 shadow-2xl backdrop-blur-sm"
              style={{ animation: 'flutuar 5s ease-in-out 0.5s infinite' }}
            >
              <p className="text-white/40 text-[11px]">Este mês</p>
              <p className="text-av-green text-[15px] font-bold">+ R$ 2.140,00</p>
            </div>
          </div>
        </div>
      </section>

      {/* Financeiro básico */}
      <Secao
        eyebrow="FINANCEIRO BÁSICO"
        titulo="Tudo que você já usa numa planilha, só que automático"
        cor="#4da6ff"
        mockup={<MockupDashboard/>}
        mascote={
          // Mascote fica à DIREITA do mockup nesta seção (reverso=false) —
          // precisa apontar pra ESQUERDA, de volta pro mockup.
          <Mascote src="/mascotes/arquiteta-apontando-esquerda.png" cor="#4da6ff" delay={0.2} duracao={6.5} />
        }
        features={[
          { icon: Wallet, titulo: 'Contas', descricao: 'Corrente, cartão, investimento e carteira — saldo sempre atualizado em um painel só.' },
          { icon: Repeat, titulo: 'Recorrência e parcelas', descricao: 'Cadastre uma vez e o sistema lança sozinho: mensal, semanal, anual ou parcelado.' },
          { icon: ArrowLeftRight, titulo: 'Transferências', descricao: 'Mova dinheiro entre contas com um lançamento só — débito e crédito sempre em par.' },
          { icon: FolderTree, titulo: 'Categorias', descricao: 'Organize receitas e despesas em categorias e subcategorias do seu jeito.' },
          { icon: BarChart3, titulo: 'Dashboard e relatórios', descricao: 'Visão mensal do saldo, comparativos e para onde o dinheiro está indo.' },
          { icon: FileUp, titulo: 'Importação de fatura', descricao: 'Suba o PDF da fatura do cartão e o sistema reconhece e lança os itens pra você.' },
        ]}
      />

      {/* Objetivos */}
      <Secao
        eyebrow="OBJETIVOS"
        titulo="Metas com progresso calculado automaticamente"
        cor="#f0b429"
        reverso
        mockup={<MockupObjetivos/>}
        mascote={
          // reverso=true: mascote fica à ESQUERDA do mockup — aponta pra DIREITA.
          <Mascote src="/mascotes/raposa-apontando-direita.png" cor="#f0b429" delay={0.4} duracao={5.5} />
        }
        features={[
          { icon: Target, titulo: 'Patrimônio', descricao: 'Defina um valor a juntar e acompanhe o saldo acumulado das suas contas rumo à meta.' },
          { icon: Coins, titulo: 'Renda recorrente', descricao: 'Acompanhe a evolução da sua receita média numa categoria ao longo do tempo.' },
          { icon: TrendingUp, titulo: 'Evolução anual', descricao: 'Veja o percentual de evolução de uma categoria de um ano para o outro.' },
        ]}
      />

      {/* Investimentos */}
      <Secao
        eyebrow="INVESTIMENTOS"
        titulo="Sua carteira, seus dividendos e uma avaliação por IA"
        cor="#00c896"
        mockup={<MockupInvestimentos/>}
        mascote={
          // Mascote à DIREITA do mockup (reverso=false) — aponta pra ESQUERDA.
          <Mascote src="/mascotes/sabio-apontando-esquerda.png" cor="#00c896" delay={0.1} duracao={6} />
        }
        features={[
          { icon: LineChart, titulo: 'Carteira completa', descricao: 'Ações, FIIs, renda fixa, tesouro direto, cripto e stocks/ETFs num só painel.' },
          { icon: Landmark, titulo: 'Dividendos e DY/YoC', descricao: 'Proventos organizados com Dividend Yield e Yield on Cost calculados automaticamente.' },
          { icon: Sparkles, titulo: 'Avaliação por IA', descricao: 'Peça a opinião de mentores de investimento por IA sobre os ativos da sua carteira.' },
        ]}
      />

      {/* CTA final */}
      <section className="relative max-w-3xl mx-auto px-4 py-20">
        <div className="relative bg-gradient-to-br from-white/[0.06] to-white/[0.02] border border-white/10 rounded-[28px] px-6 py-12 md:py-14 text-center overflow-hidden">
          <Blob cor="#00c896" className="w-64 h-64 opacity-20 -top-20 -right-20" />
          <div className="relative flex justify-center mb-2">
            <div className="w-24 -mt-4">
              <Mascote src="/mascotes/gato-feliz.png" cor="#4da6ff" duracao={5} />
            </div>
          </div>
          <h2 className="relative text-white text-2xl md:text-3xl font-bold mb-3">
            Comece a organizar sua vida financeira hoje
          </h2>
          <p className="relative text-white/50 text-[16px] mb-7">Grátis para começar. Leva menos de um minuto.</p>
          <Link to="/cadastro"
            className="relative inline-flex items-center justify-center gap-2 bg-av-green text-av-dark font-semibold rounded-lg px-7 py-3 text-[16px] hover:bg-av-green/90 hover:-translate-y-0.5 transition-all">
            Criar conta grátis
            <ArrowRight size={17} />
          </Link>
        </div>
      </section>

      <footer className="relative text-center text-white/20 text-[14px] py-6 border-t border-white/5">
        Arquiteto de Valor · v{APP_VERSION}
      </footer>
    </div>
  )
}
