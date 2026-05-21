// src/lib/tutoriaisPaginas.ts
//
// Conteúdo dos tutoriais guiados (TutorialTour) por página. Cada passo
// referencia um seletor CSS — o elemento alvo precisa ter o atributo
// `data-tutorial="<nome>"` ou um seletor estável equivalente.
//
// Os seletores são estáveis e simples (não dependem de classes geradas).

import type { PassoTutorial } from '../components/ui/TutorialTour'

export const TUTORIAL_DASHBOARD: PassoTutorial[] = [
  {
    titulo: 'Bem-vindo ao Painel',
    texto: 'Este é o seu Dashboard — a visão geral das suas finanças do mês selecionado. Vamos passar pelos principais elementos.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Mês em foco',
    texto: 'Aqui você navega entre os meses. Tudo no painel reflete o mês escolhido. Use ← → no teclado pra navegar rapidamente.',
    seletor: '[data-tutorial="dashboard-mes"]',
  },
  {
    titulo: 'Filtros',
    texto: 'Filtre por conta, categoria ou status. Os números abaixo se ajustam ao filtro aplicado — útil pra ver "quanto gastei só com Cartões" ou "quanto entrou só do salário".',
    seletor: '[data-tutorial="dashboard-filtros"]',
  },
  {
    titulo: 'Resultados do mês',
    texto: 'Receitas, despesas e o resultado (entradas − saídas). Verde = sobrou; vermelho = estourou. Reflete o filtro ativo.',
    seletor: '[data-tutorial="dashboard-resultados"]',
  },
  {
    titulo: 'Saldo acumulado',
    texto: 'Soma dos saldos de todas as contas, considerando o filtro ativo. pode mostrar a posição real até hoje, ou se prefeir "Até fim do mês" projetanto o saldo no último dia deste mês.',
    seletor: '[data-tutorial="dashboard-saldo"]',
  },
  {
    titulo: 'Calendário do mês',
    texto: 'Dias com movimento aparecem destacados. Clique num dia pra ir direto pra lista de lançamentos daquele dia.',
    seletor: '[data-tutorial="dashboard-calendario"]',
  },
  {
    titulo: 'Vencidos não pagos',
    texto: 'Contas que já venceram e ainda não foram quitadas. Resolver isso é prioridade — juros e multas correm.',
    seletor: '[data-tutorial="dashboard-vencidos"]',
  },
  {
    titulo: 'Próximas não pagas',
    texto: 'Contas a vencer. Toggle "Este mês" / "30 dias" controla o horizonte. Bom pra planejar o caixa da próxima semana.',
    seletor: '[data-tutorial="dashboard-proximas"]',
  },
  {
    titulo: 'Últimas alterações',
    texto: 'Histórico recente de lançamentos modificados — útil pra rastrear "o que mudou desde ontem".',
    seletor: '[data-tutorial="dashboard-alteracoes"]',
  },
  {
    titulo: 'Evolução mensal',
    texto: 'Gráfico de barras com receita/despesa dos últimos 6 meses, separadas por status (Pagas, Pendentes, Projeções). Linhas mostram o Resultado e o Saldo acumulado. Clique numa barra pra ir pro mês.',
    seletor: '[data-tutorial="dashboard-evolucao"]',
    posicao: 'acima',
  },
  {
    titulo: 'Donuts por categoria',
    texto: 'Distribuição das receitas e despesas do mês entre as categorias. Útil pra identificar rapidamente onde o dinheiro está indo.',
    seletor: '[data-tutorial="dashboard-donuts"]',
    posicao: 'acima',
  },
  {
    titulo: 'Minhas contas',
    texto: 'Saldo de cada conta agrupado por tipo (bancárias, investimentos, carteira, cartões). O "Total geral" no topo soma tudo. Clique em uma conta pra ver o extrato dela.',
    seletor: '[data-tutorial="dashboard-contas"]',
    posicao: 'acima',
  },
  {
    titulo: 'Atalhos de teclado',
    texto: '← → navega entre meses (a partir do Dashboard ou Extratos).\nF1 abre este tutorial a qualquer momento.\nESC fecha qualquer drawer/modal aberto.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Você pode reabrir este tutorial a qualquer momento pelo botão ❓ no canto inferior esquerdo, pelo botão de ajuda na sidebar, ou pelo atalho F1. Bons estudos!',
    seletor: '',
    flutuante: true,
  },
]
