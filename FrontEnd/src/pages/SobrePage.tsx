import { useState } from 'react'
import {
  LayoutDashboard, List, CreditCard, Tag, Target, ArrowLeftRight,
  FileText, GitCompare, Repeat2, TrendingUp, Bell, Bot, Sparkles,
  ShieldCheck, HelpCircle, Heart, Wallet,
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
    versao: '6.4',
    titulo: 'Fundos Imobiliários mais completos e mais segurança',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '🏦 Preço justo de ações', d: 'ao cadastrar uma ação, o app já busca os dados pra te ajudar a saber se o preço está caro ou barato.' },
      { t: '📋 Avaliação de Fundos Imobiliários por tipo', d: 'as perguntas de avaliação agora mudam conforme o tipo do fundo (imóveis, recebíveis, etc.), já que os riscos são diferentes.' },
      { t: '🔔 Aviso de dividendo chegando', d: 'um alerta avisa quando está perto da data em que você precisa ter o ativo pra receber o próximo provento.' },
      { t: '💰 Quanto reinvestir pra não perder poder de compra', d: 'um novo indicador mostra quanto do dividendo você precisa reaplicar só pra não perder valor pra inflação.' },
      { t: '🔒 Mais segurança com várias abas abertas', d: 'uma aba esquecida aberta não derruba mais o login das outras.' },
      { t: '🔁 Transferência mais prática', d: 'ao trocar a conta de origem, a conta anterior já vai sozinha pro campo de destino.' },
      { t: '🔐 Correção de segurança', d: 'corrigimos uma falha que podia deixar dados de outro usuário acessíveis indevidamente.' },
      { t: '💾 Sessão mais estável', d: 'suas preferências (tema, mostrar/ocultar valores) não resetam mais sozinhas ao recarregar a página.' },
      { t: '⌨️ Navegação por teclado corrigida', d: 'o Tab no formulário de novo lançamento agora passa pelos campos certos, sem travar nem "escapar" da tela.' },
    ],
  },
  {
    versao: '6.3',
    titulo: 'Fundos Imobiliários com dados automáticos',
    icone:  <Wallet size={16} />,
    itens: [
      { t: '📐 Valor patrimonial dos Fundos atualizado sozinho', d: 'não precisa mais digitar isso na mão.' },
      { t: '🔢 "Magic Number"', d: 'mostra quantas cotas a mais você precisa comprar pra o dividendo pagar sua próxima compra.' },
      { t: '🧮 Simulação de compra e venda', d: 'veja o efeito antes de decidir de verdade.' },
      { t: '🧭 Questionário de perfil revisado', d: 'pra saber se seu jeito de investir é mais conservador ou mais arrojado.' },
    ],
  },
  {
    versao: '6.1',
    titulo: 'Ajustes na fatura e no Extrato',
    icone:  <FileText size={16} />,
    itens: [
      { t: '🔗 Fatura ligada ao Extrato', d: 'agora dá pra clicar num item da fatura e já ir direto pro lançamento correspondente no Extrato.' },
      { t: '🗂️ Correção ao revisar a fatura', d: 'corrigido um problema ao reclassificar um item que já tinha sido organizado antes.' },
      { t: '🔄 Transferência sempre atualizada dos dois lados', d: 'marcar uma perna como paga já atualiza a outra na hora, sem precisar recarregar a página.' },
    ],
  },
  {
    versao: '6.0',
    titulo: 'Chegada do módulo de Investimentos',
    icone:  <Wallet size={16} />,
    itens: [
      { t: '📊 Módulo de Investimentos', d: 'acompanhe ações, Fundos Imobiliários, Tesouro Direto, renda fixa e criptomoedas num só lugar, com valores atualizados automaticamente.' },
      { t: '💵 Dividendos', d: 'lance e acompanhe os proventos recebidos dos seus investimentos.' },
      { t: '🏆 Ranking da carteira', d: 'veja quais investimentos estão indo bem e quais estão no prejuízo.' },
      { t: '🤖 Avaliação por Mentor de IA', d: 'receba uma nota pra cada investimento, respondendo um questionário simples.' },
      { t: '🔁 Transferências mais confiáveis', d: 'nunca mais fica só um lado registrado se alguma coisa der errado no meio do caminho.' },
      { t: '🔑 Recuperação de senha mais simples', d: 'e-mails mais claros e opção de mostrar a senha digitada no login.' },
      { t: '📨 Convide amigos', d: 'envie um convite de cadastro direto pelo app.' },
      { t: '⚡ Extrato e Dashboard mais rápidos', d: 'navegar entre os meses ficou mais ágil.' },
    ],
  },
  {
    versao: '5.0',
    titulo: 'Chegada dos Objetivos Financeiros',
    icone:  <Target size={16} />,
    itens: [
      { t: '💰 Objetivo de Patrimônio', d: 'defina uma meta de quanto guardar e acompanhe o progresso mês a mês.' },
      { t: '🎯 Objetivo de Renda', d: 'meta de renda recorrente por categoria, com a média de quanto você já recebe.' },
      { t: '📈 Evolução Anual', d: 'veja se sua renda está crescendo de um ano pro outro.' },
    ],
  },
]

const Logo = () => (
  <svg width="48" height="48" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <path d="M32,10 L14,50" fill="none" stroke="#4da6ff" strokeWidth="4" strokeLinecap="round" />
    <path d="M32,10 L50,50" fill="none" stroke="#4da6ff" strokeWidth="4" strokeLinecap="round" />
    <circle cx="32" cy="10" r="3.5" fill="#4da6ff" />
    <polyline points="14,50 26,38 38,42 50,26"
      fill="none" stroke="#00c896" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    <circle cx="50" cy="26" r="4.5" fill="#f0b429" />
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

        {/* Detalhe das novidades desta versão (6.5.0) */}
        <ul className="flex flex-col gap-2">
          {[
            { t: '🧾 Importação de fatura do Itaú', d: 'mais um banco na lista — suba o PDF da fatura do cartão Itaú e o sistema já reconhece os lançamentos, igual já fazia com Nubank, Inter e C6.' },
            { t: '🗂️ Novo tipo de conta "Outros"', d: 'pra cadastrar contas que não se encaixam em corrente, cartão, investimento ou carteira — tipo vale-refeição ou uma conta de terceiros.' },
            { t: '🔒 Aviso de sessão corrigido', d: 'a mensagem de "aba inativa" não aparece mais por engano logo depois de você acabar de entrar.' },
            { t: '🖱️ Dropdown de tipo de conta mais confiável', d: 'no Windows, a opção "Investimento" às vezes ficava com o texto ilegível ao passar o mouse — corrigido.' },
          ].map(x => (
            <li key={x.t} className="text-[13px] leading-snug" style={{ color: '#8b92a8' }}>
              <span className="text-white/85 font-medium">{x.t}</span> — {x.d}
            </li>
          ))}
        </ul>
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
