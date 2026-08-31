import { useState } from 'react'
import {
  LayoutDashboard, List, CreditCard, Tag, Target, ArrowLeftRight,
  FileText, GitCompare, Repeat2, TrendingUp, Bell, Bot, Sparkles,
  ShieldCheck, HelpCircle, Heart, Wallet, KeyRound, UserPlus, Zap,
  ChevronDown, ChevronRight,
} from 'lucide-react'
import { APP_VERSION, getVersionInfo } from '../config/version'

// Histórico de versões anteriores — cada entrada é o "destaque" que já foi
// exibido em "Versão atual" numa release passada. Guardado aqui (recolhido
// por padrão) em vez de descartado ao trocar o destaque da versão corrente.
interface VersaoAnterior {
  versao: string
  titulo: string
  icone:  React.ReactNode
  itens:  { t: string; d: string }[]
}

const VERSOES_ANTERIORES: VersaoAnterior[] = [
  {
    versao: '5.0',
    titulo: 'Objetivos Financeiros',
    icone:  <Target size={16} />,
    itens: [
      { t: '💰 Patrimônio',       d: 'meta de saldo acumulado em uma ou mais contas, com estimativa de quanto crescer por mês para chegar lá.' },
      { t: '🎯 Renda Recorrente', d: 'receita recorrente por categoria, com média por período, evolução mensal e % por categoria.' },
      { t: '📈 Evolução Anual',   d: 'percentual de aumento das receitas ano a ano, comparando cada ano com o ano base (YoY).' },
    ],
  },
]

const Logo = () => (
  <svg width="48" height="48" viewBox="210 30 260 260" xmlns="http://www.w3.org/2000/svg">
    <g opacity="0.25">
      {[230, 260, 290, 320, 350, 380, 410, 440].map(x => (
        <line key={x} x1={x} y1="50" x2={x} y2="270" stroke="#4da6ff" strokeWidth="0.8" />
      ))}
      {[90, 130, 170, 210, 250].map(y => (
        <line key={y} x1="215" y1={y} x2="455" y2={y} stroke="#4da6ff" strokeWidth="0.8" />
      ))}
    </g>
    <rect x="258" y="185" width="18" height="40" rx="3" fill="#1a2540" />
    <rect x="258" y="183" width="18" height="5" rx="2" fill="#f0b429" />
    <rect x="282" y="165" width="18" height="60" rx="3" fill="#1a2540" />
    <rect x="282" y="163" width="18" height="5" rx="2" fill="#00c896" />
    <rect x="306" y="140" width="18" height="85" rx="3" fill="#1a2540" />
    <rect x="306" y="138" width="18" height="5" rx="2" fill="#00c896" />
    <rect x="386" y="120" width="18" height="95" rx="3" fill="#1a2540" />
    <rect x="386" y="118" width="18" height="5" rx="2" fill="#f0b429" />
    <rect x="410" y="100" width="18" height="115" rx="3" fill="#1a2540" />
    <rect x="410" y="98" width="18" height="5" rx="2" fill="#00c896" />
    <polyline points="267,218 291,195 315,165 395,148 419,128"
      fill="none" stroke="#00c896" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="267" cy="218" r="4" fill="#00c896" />
    <circle cx="291" cy="195" r="4" fill="#00c896" />
    <circle cx="315" cy="165" r="4" fill="#00c896" />
    <circle cx="395" cy="148" r="4" fill="#f0b429" />
    <circle cx="419" cy="128" r="4.5" fill="#f0b429" />
    <polygon points="419,108 426,124 419,120 412,124" fill="#f0b429" />
  </svg>
)

interface Recurso {
  icon:  React.ReactNode
  titulo: string
  texto:  string
}

const RECURSOS: Recurso[] = [
  { icon: <LayoutDashboard size={18} />, titulo: 'Dashboard',  texto: 'Visão geral do mês: resultados, saldo acumulado, calendário, vencidos e evolução.' },
  { icon: <List size={18} />,            titulo: 'Extratos',   texto: 'Lançamento de receitas e despesas com recorrência, busca multi-mês e ações em lote.' },
  { icon: <CreditCard size={18} />,      titulo: 'Contas',     texto: 'Corrente, remuneração, cartão, investimento e carteira — com saldo calculado automaticamente.' },
  { icon: <ArrowLeftRight size={18} />,  titulo: 'Transferências', texto: 'Movimentos entre suas contas como par débito + crédito, sempre consistentes.' },
  { icon: <Tag size={18} />,             titulo: 'Categorias', texto: 'Organização hierárquica (pai → subcategoria) e reclassificação em massa.' },
  { icon: <Target size={18} />,          titulo: 'Objetivos',  texto: 'Patrimônio, renda recorrente e evolução anual — com progresso e estimativas mês a mês.' },
  { icon: <Wallet size={18} />,          titulo: 'Investimentos', texto: 'Ativos, posições, dividendos e dashboard estilo corretora — com ranking de performance e avaliação por Mentores de IA.' },
  { icon: <FileText size={18} />,        titulo: 'Relatórios', texto: 'Receitas e despesas por categoria em qualquer período, com análise de Pareto.' },
  { icon: <GitCompare size={18} />,      titulo: 'Comparativo', texto: 'Dois períodos lado a lado, com variações, tendência e insights automáticos.' },
  { icon: <Repeat2 size={18} />,         titulo: 'Gastos recorrentes', texto: 'Detecção automática de assinaturas e mensalidades, com alertas de reajuste.' },
  { icon: <TrendingUp size={18} />,      titulo: 'Projeção',   texto: 'Simulação do patrimônio futuro com juros compostos e cortes de despesa.' },
  { icon: <Bell size={18} />,            titulo: 'Lembretes',  texto: 'Alertas vinculáveis a lançamentos futuros, integrados ao calendário.' },
  { icon: <FileText size={18} />,        titulo: 'Import/Export', texto: 'Importação e exportação em Excel, incluindo importação de faturas.' },
]

export default function SobrePage() {
  const info = getVersionInfo()
  const descNivel = info.levels[info.current.level as keyof typeof info.levels]
  const [versaoAberta, setVersaoAberta] = useState<string | null>(null)

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto flex flex-col gap-5">

      {/* Cabeçalho */}
      <section className="bg-[#1a1f2e] rounded-xl p-6 border border-white/5 flex items-center gap-4 flex-wrap">
        <div className="w-14 h-14 rounded-2xl bg-av-dark border border-blue-400/30 flex items-center justify-center flex-shrink-0">
          <Logo />
        </div>
        <div className="min-w-0">
          <h1 className="text-[24px] font-bold text-white leading-tight">Arquiteto de Valor</h1>
          <p className="text-[13px] text-av-green tracking-[2px] font-medium">BLUEPRINT</p>
          <p className="text-[14px] mt-1" style={{ color: '#8b92a8' }}>
            Gestão financeira pessoal — clareza e controle sobre o seu dinheiro.
          </p>
        </div>
        <span className="ml-auto text-[13px] font-medium px-3 py-1.5 rounded-full self-start
          bg-av-green/15 text-av-green border border-av-green/30">
          versão {APP_VERSION}
        </span>
      </section>

      {/* O que é */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-2">O que é</h2>
        <p className="text-[14px] leading-relaxed" style={{ color: '#8b92a8' }}>
          O <span className="text-white/80 font-medium">Arquiteto de Valor</span> é uma aplicação web
          para organizar suas finanças pessoais de ponta a ponta: contas, lançamentos, categorias,
          objetivos, relatórios e projeções. A ideia é dar uma visão arquitetada do seu patrimônio —
          do dia a dia ao longo prazo — para que cada decisão seja tomada com dados, não no escuro.
        </p>
      </section>

      {/* Recursos */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-4">Principais recursos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {RECURSOS.map(r => (
            <div key={r.titulo} className="flex gap-3 p-3 rounded-lg bg-white/[0.02] border border-white/5">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0
                bg-av-blue/10 text-av-blue border border-av-blue/20">
                {r.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-medium text-white/85">{r.titulo}</p>
                <p className="text-[12px] mt-0.5 leading-snug" style={{ color: '#8b92a8' }}>{r.texto}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Mentores & IA */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-3 flex items-center gap-2">
          <Bot size={16} className="text-av-blue" /> Mentores & Assistente de IA
        </h2>
        <p className="text-[14px] leading-relaxed mb-3" style={{ color: '#8b92a8' }}>
          Escolha um mentor para te acompanhar — Arquiteta, Gato, Raposa ou Conselheiro — e dê um apelido a ele.
          Além de guiar os tutoriais de cada página, ele vira um chat com IA: conecte suas próprias credenciais
          (Claude, GPT, Gemini, DeepSeek e outros) e pergunte sobre o que está vendo na tela.
        </p>
        <div className="flex flex-wrap gap-2">
          {[
            { icon: <Sparkles size={13} />,    txt: 'Tutoriais guiados em cada página (F1)' },
            { icon: <ShieldCheck size={13} />, txt: 'Chaves de IA criptografadas (AES-256-GCM)' },
            { icon: <Bot size={13} />,         txt: 'Múltiplos provedores de IA' },
          ].map(t => (
            <span key={t.txt} className="flex items-center gap-1.5 text-[12px] px-2.5 py-1 rounded-full
              bg-white/5 text-white/70 border border-white/10">
              {t.icon}{t.txt}
            </span>
          ))}
        </div>
      </section>

      {/* Privacidade & segurança */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-2 flex items-center gap-2">
          <ShieldCheck size={16} className="text-av-green" /> Privacidade & segurança
        </h2>
        <p className="text-[14px] leading-relaxed" style={{ color: '#8b92a8' }}>
          Seus dados são isolados por usuário com Row Level Security no banco — cada conta enxerga apenas
          o que é seu. A sessão expira por inatividade e é descartada ao fechar a aba, protegendo o acesso
          em computadores compartilhados.
        </p>
      </section>

      {/* Versão atual */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-3">Versão atual</h2>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-[13px] font-mono px-2 py-0.5 rounded bg-white/5 text-white/80 border border-white/10">
            v{APP_VERSION}
          </span>
          <span className="text-[12px] px-2 py-0.5 rounded-full bg-av-amber/15 text-av-amber">
            {descNivel}
          </span>
        </div>
        <p className="text-[13px] leading-relaxed mb-3" style={{ color: '#8b92a8' }}>
          {info.current.description}
        </p>

        {/* Detalhe das correções desta versão (6.1.0) */}
        <ul className="flex flex-col gap-2">
          {[
            { t: '🔗 Revisão de fatura', d: 'lançamentos sem vínculo com a fatura agora linkam direto pro item correspondente no Extrato, já filtrado no mês/conta certos.' },
            { t: '🗂️ Revisão de fatura', d: 'corrigido grupo duplicado no modo "Por categoria" ao reclassificar um item que já havia sido classificado/separado antes.' },
            { t: '🔄 Extrato', d: 'ao alterar o status de uma perna de transferência (ex.: marcar como Pago), a outra perna atualiza junto na hora — sem esperar recarregar a página.' },
          ].map(x => (
            <li key={x.t} className="text-[13px] leading-snug" style={{ color: '#8b92a8' }}>
              <span className="text-white/85 font-medium">{x.t}</span> — {x.d}
            </li>
          ))}
        </ul>

        {/* Destaque do último módulo: Investimentos */}
        <div className="mt-4 pt-4 border-t border-white/8">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
              bg-av-blue/10 text-av-blue border border-av-blue/20">
              <Wallet size={16} />
            </div>
            <div>
              <p className="text-[14px] font-semibold text-white/85">Novo módulo: Investimentos</p>
              <p className="text-[12px]" style={{ color: '#8b92a8' }}>O grande destaque da versão 6</p>
            </div>
          </div>
          <p className="text-[13px] leading-relaxed mb-3" style={{ color: '#8b92a8' }}>
            Acompanhe sua carteira de ponta a ponta, num dashboard estilo corretora que se
            atualiza sozinho a partir das suas operações:
          </p>
          <ul className="flex flex-col gap-2 mb-3">
            {[
              { t: '📊 Ativos e posições',    d: 'ações, FIIs, ETFs, renda fixa, Tesouro Direto e criptomoedas — com preço médio e valor de mercado calculados automaticamente a partir das operações.' },
              { t: '💵 Dividendos',           d: 'proventos lançados direto no extrato (projeção → pago), com busca automática na B3/exterior e diagnóstico de pendências — e um aviso de "novidades" quando um provento novo é detectado.' },
              { t: '🏆 Ranking',              d: 'performance por ativo — em alta, em prejuízo, maior dividend yield e participação na carteira.' },
              { t: '🤖 Mentores de IA',       d: 'avaliação da carteira por questionário (nota 0–10 por ativo), perfil de investidor por suitability e pesos de avaliação configuráveis por critério.' },
              { t: '🧭 Correlação e sobreposição', d: 'veja o quanto os ativos da carteira se movem juntos (correlação de preço) e onde há concentração/sobreposição por segmento ou área.' },
              { t: '🏦 Resumo por instituição', d: 'quanto do patrimônio está em cada corretora/banco, num gráfico de rosca.' },
              { t: '💹 Cotações automáticas', d: 'Tesouro Direto, índices econômicos (CDI/IPCA/Selic) e PTAX atualizados sozinhos — inclusive cupom semestral do Tesouro lançado e o juros-sobre-juros recalculado automaticamente no vencimento.' },
            ].map(x => (
              <li key={x.t} className="text-[13px] leading-snug" style={{ color: '#8b92a8' }}>
                <span className="text-white/85 font-medium">{x.t}</span> — {x.d}
              </li>
            ))}
          </ul>
          <p className="text-[13px] leading-relaxed" style={{ color: '#8b92a8' }}>
            Também dá pra definir metas de alocação por tipo de ativo, migrar posições entre
            contas (inteira ou ativo por ativo) e simular sua aposentadoria pela regra dos 4% —
            tudo em Investimentos → Configurações.
          </p>
        </div>
      </section>

      {/* Changelog v5 → v6 */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-1 flex items-center gap-2">
          <Sparkles size={16} className="text-av-blue" /> O que mudou da versão 5 para a 6
        </h2>
        <p className="text-[13px] mb-4" style={{ color: '#8b92a8' }}>
          Resumo das principais novidades e correções desde a v5.0.
        </p>
        <div className="flex flex-col gap-3">
          {[
            { icon: <Wallet size={16} />,     t: 'Módulo de Investimentos',
              d: 'cadastro de ativos, posições e operações, dividendos, dashboard, ranking de performance, avaliação por Mentores de IA, histórico mensal de valor de mercado e migração entre contas.' },
            { icon: <ArrowLeftRight size={16} />, t: 'Transferências mais robustas',
              d: 'edição e exclusão de transferências recorrentes com escopo "este e os seguintes" corrigidas; criação e exclusão passaram a ser atômicas — nunca mais fica só um lado do par em caso de falha.' },
            { icon: <KeyRound size={16} />,   t: 'Recuperação de senha e sessão',
              d: 'e-mail de recuperação de senha e de confirmação mais amigáveis, botão de mostrar/ocultar senha no login, e retomada da tela e dos filtros exatamente de onde parou após logout por inatividade.' },
            { icon: <UserPlus size={16} />,   t: 'Convide amigos',
              d: 'envie um convite de cadastro por e-mail direto do Perfil.' },
            { icon: <Zap size={16} />,        t: 'Extrato e Dashboard mais rápidos',
              d: 'cache de lançamentos consolidado numa única fonte por mês, reduzindo requisições repetidas e deixando a navegação entre meses mais ágil.' },
          ].map(c => (
            <div key={c.t} className="flex gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0
                bg-white/5 text-white/70 border border-white/10">
                {c.icon}
              </div>
              <div className="min-w-0">
                <p className="text-[13.5px] font-medium text-white/85">{c.t}</p>
                <p className="text-[12.5px] leading-snug" style={{ color: '#8b92a8' }}>{c.d}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Versões anteriores — recolhido por padrão */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-3">Versões anteriores</h2>
        <div className="flex flex-col gap-2">
          {VERSOES_ANTERIORES.map(v => {
            const aberta = versaoAberta === v.versao
            return (
              <div key={v.versao} className="rounded-lg border border-white/10 overflow-hidden">
                <button
                  onClick={() => setVersaoAberta(aberta ? null : v.versao)}
                  className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                >
                  {aberta ? <ChevronDown size={14} style={{ color: '#8b92a8' }} /> : <ChevronRight size={14} style={{ color: '#8b92a8' }} />}
                  <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-av-blue/10 text-av-blue border border-av-blue/20">
                    {v.icone}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[13.5px] font-medium text-white/85">v{v.versao} — {v.titulo}</span>
                  </span>
                </button>
                {aberta && (
                  <div className="px-3 pb-3 pt-1">
                    <ul className="flex flex-col gap-2">
                      {v.itens.map(x => (
                        <li key={x.t} className="text-[13px] leading-snug" style={{ color: '#8b92a8' }}>
                          <span className="text-white/85 font-medium">{x.t}</span> — {x.d}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Ajuda */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-2 flex items-center gap-2">
          <HelpCircle size={16} className="text-av-blue" /> Precisa de ajuda?
        </h2>
        <p className="text-[14px] leading-relaxed" style={{ color: '#8b92a8' }}>
          Cada página tem um tutorial guiado. Abra-o pelo botão de versão na barra lateral ou pelo
          atalho <span className="text-white/80 font-medium">F1</span> a qualquer momento.
        </p>
      </section>

      {/* Sobre o criador */}
      <section className="bg-[#1a1f2e] rounded-xl p-5 border border-white/5">
        <h2 className="text-[15px] font-semibold text-white/80 mb-3">Sobre o criador</h2>
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center text-[32px] flex-shrink-0
            bg-av-blue/10 border border-av-blue/20">
            <img
              src="/criador.jpg"
              alt="Foto do criador"
              className="w-full h-full object-cover"
              onError={e => {
                // Sem o arquivo em /public/criador.jpg, cai no emoji.
                const img = e.target as HTMLImageElement
                img.style.display = 'none'
                img.parentElement!.textContent = '👨‍💻'
              }}
            />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-semibold text-white/90">Djalma Jr.</p>
            <p className="text-[13px] text-av-green mb-2">Desenvolvedor e criador do Arquiteto de Valor</p>
            <p className="text-[14px] leading-relaxed" style={{ color: '#8b92a8' }}>
              Apaixonado por tecnologia e por finanças pessoais, criei o Arquiteto de Valor
              para transformar a forma como acompanho meu dinheiro — saindo das planilhas soltas
              para uma visão arquitetada, clara e do dia a dia ao longo prazo. Este projeto é a
              união dessas duas paixões: código que organiza valor.
            </p>
          </div>
        </div>
      </section>

      <p className="text-center text-[12px] py-2 flex items-center justify-center gap-1.5"
        style={{ color: '#8b92a8' }}>
        Feito com <Heart size={12} className="text-red-400 fill-red-400" /> para organizar o seu valor.
      </p>
    </div>
  )
}
