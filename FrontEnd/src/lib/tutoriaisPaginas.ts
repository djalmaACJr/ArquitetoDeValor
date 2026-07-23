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
    titulo: 'Ocultar valores',
    texto: 'Esconde todos os valores em reais da tela de uma vez. Útil quando estiver em público ou quiser tirar uma captura de tela sem expor números. Clique novamente pra revelar.',
    seletor: '[data-tutorial="dashboard-ocultar"]',
  },
  {
    titulo: 'Novo lançamento',
    texto: 'Atalho rápido para registrar uma receita, despesa ou lembrete. Clique na seta ao lado pra escolher o tipo antes de abrir o formulário.',
    seletor: '[data-tutorial="dashboard-novo-lancamento"]',
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
    texto: 'Calendário mensal completo. Cada dia pode mostrar lembretes, vencimentos de fechamento/pagamento de cartões, dias com saldo negativo e últimas parcelas de recorrências. Clique em qualquer dia pra ver os eventos e criar novos lembretes.',
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

export const TUTORIAL_CONTAS: PassoTutorial[] = [
  {
    titulo: 'Bem-vindo às Contas',
    texto: 'Aqui você gerencia todas as suas contas — correntes, remuneradas, cartões, investimentos e carteira física. Vamos conhecer cada recurso.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Nova conta',
    texto: 'Adiciona uma conta ao seu perfil financeiro. Você pode cadastrar qualquer tipo: conta corrente, remunerada, cartão de crédito, conta de investimento ou carteira física.',
    seletor: '[data-tutorial="contas-nova"]',
  },
  {
    titulo: 'Ocultar valores',
    texto: 'Esconde os saldos de todas as contas de uma vez. Útil quando estiver compartilhando a tela ou em local público.',
    seletor: '[data-tutorial="contas-ocultar"]',
  },
  {
    titulo: 'Suas contas',
    texto: 'Contas ativas agrupadas por tipo. Cada grupo mostra o total e pode ser reordenado com os botões ◀ ▶ no cabeçalho. Contas inativas ficam em seção separada ao final, sem afetar saldos nem filtros.',
    seletor: '[data-tutorial="contas-lista"]',
  },
  {
    titulo: 'Formulário de conta',
    texto: 'Vamos explorar os campos do cadastro.',
    seletor: '',
    flutuante: true,
    grupo: 'drawer-intro',
  },
  {
    titulo: 'Nome',
    texto: 'Identifica a conta na lista e nos lançamentos. Use nomes claros como "Nubank", "Carteira" ou "XP Investimentos".',
    seletor: '[data-tutorial="conta-nome"]',
    posicao: 'esquerda',
    grupo: 'drawer-conta',
  },
  {
    titulo: 'Tipo de conta',
    texto: '• Corrente / Remunerada — contas bancárias comuns.\n• Cartão de crédito — aparece separado; você define dia de fechamento e de pagamento.\n• Investimento — corretoras e aplicações.\n• Carteira — dinheiro físico em espécie.',
    seletor: '[data-tutorial="conta-tipo"]',
    posicao: 'esquerda',
    grupo: 'drawer-conta',
  },
  {
    titulo: 'Saldo inicial',
    texto: 'O saldo de partida da conta no momento do cadastro. Após salvar, ele não pode ser editado — o saldo real passa a ser calculado automaticamente pelos lançamentos com status Pago.',
    seletor: '[data-tutorial="conta-saldo"]',
    posicao: 'esquerda',
    grupo: 'drawer-conta',
  },
  {
    titulo: 'Ícone e Cor',
    texto: 'Personalize a identidade visual da conta. Você pode fazer upload do logo do banco ou escolher um emoji. A cor é usada nos gráficos e na lista de lançamentos.',
    seletor: '[data-tutorial="conta-icone"]',
    posicao: 'esquerda',
    grupo: 'drawer-conta',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Você pode reabrir este tutorial a qualquer momento pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_CATEGORIAS: PassoTutorial[] = [
  {
    titulo: 'Bem-vindo às Categorias',
    texto: 'As categorias organizam seus lançamentos para que você consiga analisar para onde vai o dinheiro. Elas têm dois níveis: pai e subcategoria.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Nova categoria',
    texto: 'Cria uma categoria pai ou uma subcategoria dentro de uma categoria existente.',
    seletor: '[data-tutorial="cats-nova"]',
  },
  {
    titulo: 'Busca',
    texto: 'Filtra a lista em tempo real por descrição. Útil quando você tem muitas categorias cadastradas.',
    seletor: '[data-tutorial="cats-busca"]',
  },
  {
    titulo: 'Lista de categorias',
    texto: 'Categorias em dois níveis:\n• Categoria pai — agrupa subcategorias. Clique nela para expandir as filhas.\n• Subcategoria — usada diretamente nos lançamentos.\n\nO ícone 🛡️ indica categorias protegidas (ex.: "Transferências") — não podem ser excluídas nem renomeadas, apenas cor e ícone são editáveis.',
    seletor: '[data-tutorial="cats-lista"]',
  },
  {
    titulo: 'Reclassificar',
    texto: 'O botão 🔄 em cada categoria abre um painel para mover lançamentos para outra categoria — em lote ou um a um. Útil ao reorganizar a hierarquia sem perder histórico.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Formulário de categoria',
    texto: 'Vamos explorar os campos do cadastro.',
    seletor: '',
    flutuante: true,
    grupo: 'drawer-intro',
  },
  {
    titulo: 'Nível',
    texto: 'Define se é uma categoria pai (que agrupa subcategorias) ou uma subcategoria (filha de uma categoria pai). Nos lançamentos, sempre é usada a subcategoria — ou a categoria pai quando não há subdivisão.',
    seletor: '[data-tutorial="cat-nivel"]',
    posicao: 'esquerda',
    grupo: 'drawer-cat',
  },
  {
    titulo: 'Descrição',
    texto: 'Nome da categoria — aparece nos lançamentos, filtros, relatórios e gráficos. Seja objetivo: "Alimentação", "Transporte", "Saúde".',
    seletor: '[data-tutorial="cat-descricao"]',
    posicao: 'esquerda',
    grupo: 'drawer-cat',
  },
  {
    titulo: 'Ícone e Cor',
    texto: 'Identificação visual nos lançamentos e nos gráficos de donut do Dashboard. O emoji aparece junto ao nome da categoria na lista de lançamentos.',
    seletor: '[data-tutorial="cat-icone"]',
    posicao: 'esquerda',
    grupo: 'drawer-cat',
  },
  {
    titulo: 'Pré-visualização',
    texto: 'Mostra exatamente como o badge da categoria vai aparecer nos lançamentos — com ícone, cor e nome juntos. Confirme antes de salvar.',
    seletor: '[data-tutorial="cat-preview"]',
    posicao: 'esquerda',
    grupo: 'drawer-cat',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Você pode reabrir este tutorial a qualquer momento pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_RELATORIOS: PassoTutorial[] = [
  {
    titulo: 'Bem-vindo aos Relatórios',
    texto: 'Aqui você analisa receitas e despesas agrupadas por categoria em qualquer intervalo de meses — de um único mês até anos completos. É a visão de longo prazo das suas finanças.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Período',
    texto: 'Defina o intervalo de análise — de um mês único até vários anos. A tabela gera uma coluna por mês no período escolhido, permitindo comparar a evolução mês a mês.',
    seletor: '[data-tutorial="relatorios-periodo"]',
  },
  {
    titulo: 'Filtros',
    texto: 'Afunile os dados por conta, categoria e status de pagamento. O toggle "Transferências" define se movimentos entre suas próprias contas entram no relatório (útil para excluir ruído quando analisa receitas reais).',
    seletor: '[data-tutorial="relatorios-filtros"]',
  },
  {
    titulo: 'Gerar relatório',
    texto: 'Clique para carregar e consolidar os lançamentos de todos os meses do período. Quanto maior o intervalo, mais alguns segundos pode levar — o sistema busca mês a mês em paralelo.\n\nAo avançar pro próximo passo, o tutorial vai disparar essa busca por você — assim os elementos seguintes ficam visíveis pra explicar.',
    seletor: '[data-tutorial="relatorios-gerar"]',
    grupo: 'acao-gerar',
  },
  {
    titulo: 'Ocultar valores',
    texto: 'Esconde todos os números da tela de uma vez. Útil ao compartilhar a tela, apresentar ou tirar capturas sem expor valores. Clique novamente para revelar.',
    seletor: '[data-tutorial="relatorios-ocultar"]',
  },
  {
    titulo: 'Resumo do período',
    texto: 'Total consolidado de receitas, despesas e resultado líquido no período inteiro. Verde = sobrou; vermelho = estourou. Esses números refletem todos os filtros ativos.',
    seletor: '[data-tutorial="relatorios-cards"]',
  },
  {
    titulo: 'Visualização',
    texto: 'Alterne entre duas análises:\n• Tabela — detalhamento por categoria e mês em matriz.\n• Pareto — quais categorias concentram ~80% do valor. Revela onde está a maior parte dos gastos com poucos itens.',
    seletor: '[data-tutorial="relatorios-visualizacao"]',
  },
  {
    titulo: 'Detalhamento',
    texto: 'Controla o nível de detalhe da tabela:\n• Resumo — só o total de créditos, débitos e resultado.\n• Categorias — grupos pai sem subcategorias.\n• Completo — tudo, incluindo subcategorias. Clique em qualquer nome de subcategoria para expandir os lançamentos por descrição.',
    seletor: '[data-tutorial="relatorios-detalhamento"]',
  },
  {
    titulo: 'Tabela por categoria',
    texto: 'Colunas fixas: Total do período e Média mensal. Colunas dinâmicas: um mês por coluna. Clique em qualquer célula com valor para abrir o drill-down com os lançamentos individuais. Clique numa linha de categoria pai para expandir suas subcategorias.',
    seletor: '[data-tutorial="relatorios-tabela"]',
    posicao: 'acima',
  },
  {
    titulo: 'Exportar para Excel',
    texto: 'Gera um arquivo .xlsx com exatamente o que está na tela — seja a tabela no nível atual (Resumo, Categorias ou Completo) ou a análise Pareto. O export preserva a hierarquia expandida e os meses do período.',
    seletor: '[data-tutorial="relatorios-exportar"]',
  },
  {
    titulo: 'Análise Pareto',
    texto: 'Na vista Pareto, as categorias são ordenadas do maior para o menor valor. A linha acumulada mostra qual subconjunto responde por ~80% do total (princípio 80/20). Use "Agrupar por Resumo" para consolidar subcategorias no pai e ver a foto de alto nível.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Você pode reabrir este tutorial a qualquer momento pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_EXTRATO: PassoTutorial[] = [
  {
    titulo: 'Bem-vindo ao Extrato',
    texto: 'Esta é a página de Lançamentos — seu extrato completo. Vamos conhecer os principais recursos.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Novo lançamento',
    texto: 'Cria um novo lançamento. Aponte para a seta ao lado para escolher entre receita, despesa ou lembrete antes de abrir o formulário.',
    seletor: '[data-tutorial="extrato-novo-lancamento"]',
  },
  {
    titulo: 'Exportar planilha',
    texto: 'Exporta todos os lançamentos visíveis — com os filtros aplicados — para um arquivo Excel. Útil para relatórios externos ou conferência.',
    seletor: '[data-tutorial="extrato-exportar"]',
  },
  {
    titulo: 'Mês em foco',
    texto: 'Navega entre meses. Use ← → no teclado para ir mais rápido. O cabeçalho se recolhe automaticamente ao rolar a página — clique no ícone de filtro para expandi-lo de volta.',
    seletor: '[data-tutorial="extrato-mes"]',
  },
  {
    titulo: 'Filtros',
    texto: 'Filtre por conta, categoria e status. Combine filtros para afunilar exatamente o que quer ver. O botão de s aldo acumulado aparece como opção extra dentro dos filtros.',
    seletor: '[data-tutorial="extrato-filtros"]',
  },
  {
    titulo: 'Saldo anterior',
    texto: 'Ativa a coluna de saldo acumulado — cada lançamento exibe o saldo da conta após o movimento. Fica desativado quando há filtro de categoria ativo, pois o saldo parcial não faz sentido.',
    seletor: '[data-tutorial="extrato-saldo-anterior"]',
  },
  {
    titulo: 'Pesquisa',
    texto: 'Busca por descrição, categoria ou conta em tempo real. Com texto ou filtros ativos, escolha o escopo: só este mês, meses anteriores ou próximos — a busca varre automaticamente vários meses.',
    seletor: '[data-tutorial="extrato-pesquisa"]',
  },
  {
    titulo: 'Calendário do mês',
    texto: 'Dias com lançamentos ficam destacados. Clique num dia para rolar direto até os lançamentos daquela data e vê-los em destaque.',
    seletor: '[data-tutorial="extrato-calendario"]',
  },
  {
    titulo: 'Resumo do período',
    texto: 'Totais do período visível: receitas, despesas e resultado (entradas − saídas). Refletem exatamente os filtros e a pesquisa ativos.',
    seletor: '[data-tutorial="extrato-resumo"]',
  },
  {
    titulo: 'Lista de lançamentos',
    texto: 'Lançamentos agrupados por data. Clique em qualquer linha para editar. Use o checkbox à esquerda para selecionar vários e pagar ou excluir em lote. Ícone ⚡ antecipa parcelas de recorrências.',
    seletor: '[data-tutorial="extrato-lista"]',
  },
  {
    titulo: 'Formulário de lançamento',
    texto: 'Clicando em qualquer lançamento (ou no botão "+") abre o painel lateral. Vamos explorar cada campo.',
    seletor: '',
    flutuante: true,
    grupo: 'drawer-intro',
  },
  {
    titulo: 'Tipo',
    texto: 'Defina se é uma Receita (entrada de dinheiro), Despesa (saída) ou Transferência entre suas próprias contas.',
    seletor: '[data-tutorial="drawer-tipo"]',
    posicao: 'esquerda',
    grupo: 'drawer',
  },
  {
    titulo: 'Descrição',
    texto: 'Nome do lançamento. O assistente de IA sugere automaticamente conta, categoria e valor com base no que você já lançou antes — pressione Ctrl+Espaço para ver as sugestões.',
    seletor: '[data-tutorial="drawer-descricao"]',
    posicao: 'esquerda',
    grupo: 'drawer',
  },
  {
    titulo: 'Valor',
    texto: 'Clique para abrir a calculadora integrada. Você pode digitar expressões como "150+50" e confirmar o resultado.',
    seletor: '[data-tutorial="drawer-valor"]',
    posicao: 'esquerda',
    grupo: 'drawer',
  },
  {
    titulo: 'Conta e Categoria',
    texto: 'Escolha em qual conta o lançamento bate e a qual categoria pertence. Ambos os campos têm busca por texto.',
    seletor: '[data-tutorial="drawer-conta"]',
    posicao: 'esquerda',
    grupo: 'drawer',
  },
  {
    titulo: 'Status',
    texto: '• Pago — já aconteceu e afeta o saldo real das contas.\n• Pendente — previsto mas ainda não quitado; entra nos alertas de vencidos.\n• Projeção — lançamento futuro estimado; não afeta o saldo real, só o projetado. Ao pagar uma projeção o sistema pede confirmação do valor.',
    seletor: '[data-tutorial="drawer-status"]',
    posicao: 'esquerda',
    grupo: 'drawer',
  },
  {
    titulo: 'Recorrência',
    texto: 'Ative para criar uma série de lançamentos repetidos.\n\n• Parcelas — frequência + quantidade fixa (ex.: 12x mensal). Cada parcela tem valor individual; antecipar consolida as restantes na atual.\n• Projeção recorrente — série sem fim definido; novas ocorrências são geradas mês a mês com status Projeção até você pagá-las.\n\nAo editar uma série você escolhe: alterar só este, este e os próximos, ou todos.',
    seletor: '[data-tutorial="drawer-recorrencia"]',
    posicao: 'esquerda',
    grupo: 'drawer',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Você pode reabrir este tutorial a qualquer momento pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_COMPARATIVO: PassoTutorial[] = [
  {
    titulo: 'Comparativo Períodos',
    texto: 'Aqui você compara dois períodos lado a lado — receitas, despesas, resultado e variação por categoria. Ideal pra responder "gastei mais esse trimestre que o anterior?"',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Configurar os períodos',
    texto: 'Defina o Período inicial (base) e o Período final (atual). Os dois devem ter a mesma duração para a comparação fazer sentido — use "Auto-ajustar" se precisar. O sistema já sugere datas ao abrir.',
    seletor: '[data-tutorial="comparativo-filtros"]',
  },
  {
    titulo: 'Comparar',
    texto: 'Após definir os períodos, clique em Comparar para carregar os dados. O botão só fica ativo quando os dois períodos têm a mesma duração.\n\nAo avançar pro próximo passo, o tutorial vai disparar a comparação por você — assim os elementos seguintes (cards, gráficos, análise) ficam visíveis pra explicar.',
    seletor: '[data-tutorial="comparativo-comparar"]',
    grupo: 'acao-comparar',
  },
  {
    titulo: 'Ocultar valores',
    texto: 'Esconde todos os valores monetários de uma vez — prático para reuniões ou capturas de tela.',
    seletor: '[data-tutorial="comparativo-ocultar"]',
  },
  {
    titulo: 'Cards de resumo',
    texto: 'Receita total, despesa total, resultado líquido e variações percentuais entre os dois períodos. Os cards "Maior Aumento" e "Maior Redução" destacam as categorias com mais impacto.',
    seletor: '[data-tutorial="comparativo-kpis"]',
  },
  {
    titulo: 'Gráficos comparativos',
    texto: '"Receitas vs Despesas" mostra os totais dos dois períodos lado a lado. "Top Categorias" exibe as 10 com maior variação absoluta entre os períodos.',
    seletor: '[data-tutorial="comparativo-graficos"]',
    posicao: 'acima',
  },
  {
    titulo: 'Tendência Financeira',
    texto: 'Evolução mês a mês dos últimos 12 meses — receitas, despesas e saldo. A tabela abaixo do gráfico mostra os valores exatos alinhados com o eixo X.',
    seletor: '[data-tutorial="comparativo-tendencia"]',
    posicao: 'acima',
  },
  {
    titulo: 'Análise por Categoria',
    texto: 'Tabela com todas as categorias e suas variações. Clique em qualquer valor para ver os lançamentos daquela categoria no período. Use os toggles "Tabela/Pareto" e "Categoria/Resumo" para mudar a visualização.',
    seletor: '[data-tutorial="comparativo-analise"]',
    posicao: 'acima',
  },
  {
    titulo: 'Insights automáticos',
    texto: 'O painel de insights lista alertas gerados automaticamente — aumentos de despesas, reduções relevantes e novas categorias. Clique em um insight para destacar as categorias relacionadas na tabela.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Exportar',
    texto: 'Exporta o comparativo para Excel refletindo o agrupamento, filtro e insights ativos no momento.',
    seletor: '[data-tutorial="comparativo-exportar"]',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Você pode reabrir este tutorial pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_ASSINATURAS: PassoTutorial[] = [
  {
    titulo: 'Assinaturas & Recorrências',
    texto: 'Esta página detecta automaticamente cobranças recorrentes nos seus últimos 13 meses — assinaturas, mensalidades, contas fixas. A detecção é baseada em padrão de repetição: mesma descrição + intervalo regular.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Resumo de recorrências',
    texto: 'Custo mensal e anual estimados de todas as recorrências detectadas. "Reajustes Recentes" indica serviços com aumento de preço. "Suspeita Inatividade" alerta cobranças que pararam há mais de 45 dias.',
    seletor: '[data-tutorial="assinaturas-kpis"]',
  },
  {
    titulo: 'Distribuição & Evolução',
    texto: 'O donut mostra quanto cada categoria representa do total mensal. O gráfico de linha acompanha a evolução dos gastos recorrentes mês a mês nos últimos 12 meses.',
    seletor: '[data-tutorial="assinaturas-graficos"]',
  },
  {
    titulo: 'Top Recorrências',
    texto: 'Ranking das 10 cobranças com maior custo mensal. Cores indicam status: verde = ativa, azul = nova, amarelo = reajuste recente, vermelho = suspeita de inatividade.',
    seletor: '[data-tutorial="assinaturas-top"]',
    posicao: 'acima',
  },
  {
    titulo: 'Insights automáticos',
    texto: 'Alertas sobre reajustes, cobranças possivelmente canceladas e o impacto anual total das recorrências.',
    seletor: '[data-tutorial="assinaturas-insights"]',
  },
  {
    titulo: 'Tabela de detalhamento',
    texto: 'Lista completa de todas as recorrências. Clique em uma linha para ver o histórico de lançamentos. Use o toggle "Categoria/Resumo" para agrupar por categoria pai.',
    seletor: '[data-tutorial="assinaturas-tabela"]',
    posicao: 'acima',
  },
  {
    titulo: 'Reclassificar em massa',
    texto: 'Ao abrir o detalhe de uma recorrência, o botão "Reclassificar em massa" permite alterar descrição ou categoria de todos os lançamentos do grupo de uma só vez.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Você pode reabrir este tutorial pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_OBJETIVOS: PassoTutorial[] = [
  {
    titulo: 'Bem-vindo aos Objetivos',
    texto: 'Aqui você acompanha suas metas financeiras de longo prazo. Há três tipos:\n• 💰 Patrimônio — meta de saldo acumulado numa ou mais contas.\n• 🎯 Renda Recorrente — receita recorrente por categoria.\n• 📈 Evolução Anual — % de aumento das receitas ano a ano (YoY).',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Filtrar por tipo e status',
    texto: 'Use as abas para ver só Patrimônio, Renda Recorrente ou Evolução Anual. Em "Todos", os objetivos aparecem agrupados por tipo. O seletor de status filtra entre Em progresso, Atingido e Cancelado.',
    seletor: '[data-tutorial="objetivos-filtros"]',
  },
  {
    titulo: 'Sincronizar progresso',
    texto: 'Recalcula o progresso de todos os objetivos com base nos lançamentos e saldos atuais. O sistema já sincroniza sozinho, mas use este botão para forçar a atualização imediata.',
    seletor: '[data-tutorial="objetivos-sincronizar"]',
  },
  {
    titulo: 'Novo objetivo',
    texto: 'Cria um novo objetivo. Daqui a pouco vamos abrir este formulário para conhecer cada campo.',
    seletor: '[data-tutorial="objetivos-novo"]',
  },
  {
    titulo: 'Seus objetivos',
    texto: 'Cada card mostra o progresso até a meta, o percentual atingido e o prazo restante. Clique em "Detalhes" para ver gráficos de evolução, e nos ícones para editar ou cancelar.',
    seletor: '[data-tutorial="objetivos-lista"]',
  },
  {
    titulo: 'Formulário de objetivo',
    texto: 'Vamos explorar os campos do cadastro.',
    seletor: '',
    flutuante: true,
    grupo: 'drawer-intro',
  },
  {
    titulo: 'Tipo do objetivo',
    texto: 'Escolha o tipo conforme o que você quer acompanhar. Os campos abaixo mudam de acordo: Patrimônio pede contas, Renda Recorrente e Evolução Anual pedem categorias de receita.',
    seletor: '[data-tutorial="objetivo-tipo"]',
    posicao: 'esquerda',
    grupo: 'drawer-objetivo',
  },
  {
    titulo: 'Nome',
    texto: 'Identifica o objetivo na lista. Use algo claro como "Reserva de emergência", "Renda de aluguéis" ou "Crescer faturamento 10%".',
    seletor: '[data-tutorial="objetivo-nome"]',
    posicao: 'esquerda',
    grupo: 'drawer-objetivo',
  },
  {
    titulo: 'Meta',
    texto: 'Define o alvo. Para Patrimônio e Renda Recorrente é um valor em R$; para Evolução Anual é a porcentagem de aumento esperada sobre o ano base.',
    seletor: '[data-tutorial="objetivo-meta"]',
    posicao: 'esquerda',
    grupo: 'drawer-objetivo',
  },
  {
    titulo: 'Período',
    texto: 'Início e término do objetivo. O prazo é usado para calcular quanto falta por mês (Patrimônio) e para comparar ano a ano (Evolução Anual).',
    seletor: '[data-tutorial="objetivo-periodo"]',
    posicao: 'esquerda',
    grupo: 'drawer-objetivo',
  },
  {
    titulo: 'O que monitorar',
    texto: 'Aqui você vincula o objetivo aos seus dados:\n• Patrimônio — as contas cujo saldo soma para a meta.\n• Renda Recorrente / Evolução Anual — as categorias de receita acompanhadas.',
    seletor: '[data-tutorial="objetivo-alvo"]',
    posicao: 'esquerda',
    grupo: 'drawer-objetivo',
  },
  {
    titulo: 'Ícone e Cor',
    texto: 'Personalize a identidade visual do objetivo — usada no card e nos gráficos de detalhe.',
    seletor: '[data-tutorial="objetivo-icone"]',
    posicao: 'esquerda',
    grupo: 'drawer-objetivo',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Você pode reabrir este tutorial a qualquer momento pelo botão ❓ na sidebar ou pelo atalho F1. Bons objetivos!',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_PROJECAO: PassoTutorial[] = [
  {
    titulo: 'Projeção de Economia',
    texto: 'Esta página projeta seu patrimônio futuro baseado nos últimos 6 meses de histórico. Ajuste os parâmetros do simulador e veja em tempo real o impacto de poupar mais ou investir com rendimento.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Indicadores financeiros',
    texto: 'Economia média mensal, projeção de 12 meses, taxa de poupança e patrimônio projetado — calculados a partir do histórico recente. O card "Patrimônio" já considera os juros compostos do simulador.',
    seletor: '[data-tutorial="projecao-kpis"]',
  },
  {
    titulo: 'Simulador interativo',
    texto: 'Ajuste os três controles:\n• Horizonte — quantos meses/anos projetar\n• Rendimento — taxa mensal de investimento (ex.: 0.8% a.m. ≈ CDB/Tesouro)\n• Redução de despesas — % de corte nos gastos atuais\n\nOs mini-cards mostram os resultados dos dois cenários em tempo real.',
    seletor: '[data-tutorial="projecao-simulador"]',
  },
  {
    titulo: 'Evolução patrimonial',
    texto: 'Gráfico comparando o "Cenário Atual" com o "Cenário Otimista". O impacto dos juros compostos fica evidente no longo prazo. O segundo gráfico mostra oportunidades de corte por categoria.',
    seletor: '[data-tutorial="projecao-graficos"]',
  },
  {
    titulo: 'Comparativo de cenários',
    texto: 'Tabela resumindo poupança mensal, poupança anual, patrimônio final e ganho adicional do cenário otimista — para o horizonte definido no simulador.',
    seletor: '[data-tutorial="projecao-comparativo"]',
    posicao: 'acima',
  },
  {
    titulo: 'Insights automáticos',
    texto: 'O mentor e os cards de insight interpretam os números: taxa de poupança em relação à meta de 20%, potencial de economia com cortes e impacto de cada categoria de gasto.',
    seletor: '[data-tutorial="projecao-insights"]',
    posicao: 'acima',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Você pode reabrir este tutorial pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_INVESTIMENTOS: PassoTutorial[] = [
  {
    titulo: 'Bem-vindo aos Investimentos',
    texto: 'Aqui você acompanha sua carteira de ponta a ponta: ativos, posições, dividendos e performance — num dashboard estilo corretora que se atualiza sozinho a partir das suas operações.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Navegação do módulo',
    texto: 'Painel (visão geral), Meus ativos (cadastro e movimentações), Proventos (dividendos) e Configurações (metas de alocação, questionários, migração de conta). Este menu acompanha você em todas as páginas de Investimentos.',
    seletor: '[data-tutorial="investimentos-nav"]',
  },
  {
    titulo: 'Filtrar por conta e atualizar dados',
    texto: 'Filtre tudo por uma conta de investimento específica ou veja o consolidado. "Atualizar cotação" busca o preço atual dos ativos; "Preencher histórico" aparece quando há lacunas no valor de mercado de algum mês.',
    seletor: '[data-tutorial="investimentos-header"]',
  },
  {
    titulo: 'Resumo da carteira',
    texto: 'Valor de custo, valor de mercado, ganho/prejuízo e dividendos recebidos nos últimos 12 meses — sempre respeitando o filtro de conta ativo.',
    seletor: '[data-tutorial="investimentos-cards"]',
  },
  {
    titulo: 'Evolução e composição',
    texto: 'À esquerda, a evolução mensal do patrimônio (aplicado, ganho e proventos), com filtro de período e tipo de ativo. À direita, a composição atual da carteira — clique numa fatia do donut para focar aquele tipo na lista abaixo.',
    seletor: '[data-tutorial="investimentos-evolucao"]',
    posicao: 'acima',
  },
  {
    titulo: 'Ativos por tipo',
    texto: 'Cada bloco agrupa os ativos de um tipo (Ações, FIIs, Renda Fixa...), com preço médio, valor de mercado e rentabilidade. Clique no ticker para abrir a página de detalhe do ativo, com gráficos e histórico completo.',
    seletor: '[data-tutorial="investimentos-lista"]',
    posicao: 'acima',
  },
  {
    titulo: 'Destaques da carteira',
    texto: 'Ranking rápido dos ativos em alta, em prejuízo, com maior dividend yield e maior participação na carteira — só aparece quando há dados suficientes.',
    seletor: '[data-tutorial="investimentos-destaques"]',
    posicao: 'acima',
  },
  {
    titulo: 'Dividendos por mês',
    texto: 'Total de proventos recebidos mês a mês, nos últimos 12 meses.',
    seletor: '[data-tutorial="investimentos-dividendos"]',
    posicao: 'acima',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Comece cadastrando seus ativos em "Meus ativos" — o dashboard ganha vida assim que houver posições. Reabra este tutorial pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_INVESTIMENTOS_ATIVOS: PassoTutorial[] = [
  {
    titulo: 'Meus ativos',
    texto: 'Aqui você cadastra os ativos da sua carteira e gerencia as posições — compra, venda, aporte ou resgate. Cada tipo (Ações, FIIs, Renda Fixa...) vira um bloco expansível na lista abaixo.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Buscar e filtrar',
    texto: 'Busque por ticker ou nome, filtre por tipo de ativo, ou ligue "Somente com valor" para ver só o que tem posição ativa na carteira. "Atualizar tickets" e "Padronizar Tesouro" corrigem cadastros antigos.',
    seletor: '[data-tutorial="ativos-header"]',
  },
  {
    titulo: 'Novo ativo',
    texto: 'Cadastre um ativo buscando o ticker (preenche nome e preço automaticamente) ou manualmente, se preferir. Já dá pra registrar a primeira compra no mesmo formulário.',
    seletor: '[data-tutorial="ativos-novo"]',
  },
  {
    titulo: 'Gráficos complementares',
    texto: 'Evolução do valor por tipo de ativo, resumo por instituição (corretora) e, quando aplicável, a composição de Ações por segmento e FIIs por categoria.',
    seletor: '[data-tutorial="ativos-evolucao"]',
    posicao: 'acima',
  },
  {
    titulo: 'Ativos por tipo',
    texto: 'Cada linha é um ativo, com preço médio, valor de mercado e rentabilidade. Os ícones à direita abrem Movimentações (registrar compra/venda), Valor de mercado (histórico mensal) e Editar. Clique no ticker para ver a página de detalhe completa.',
    seletor: '[data-tutorial="ativos-lista"]',
    posicao: 'acima',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Reabra este tutorial pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_INVESTIMENTOS_DETALHE: PassoTutorial[] = [
  {
    titulo: 'Detalhe do ativo',
    texto: 'Página completa de um único ativo: resumo, gráficos de evolução e rentabilidade, dividendos e o histórico de operações.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Ações do ativo',
    texto: 'Dê uma nota pessoal ao ativo (usada nas avaliações), registre uma nova movimentação, edite os dados cadastrais ou exclua o ativo — a exclusão remove também posições, operações e dividendos vinculados.',
    seletor: '[data-tutorial="detalhe-header"]',
  },
  {
    titulo: 'Resumo do ativo',
    texto: 'Valor de mercado, custo, ganho/prejuízo e total de dividendos recebidos. Para ativos em moeda estrangeira, o valor original em dólar aparece como referência.',
    seletor: '[data-tutorial="detalhe-cards"]',
  },
  {
    titulo: 'Gráficos e histórico',
    texto: 'Escolha o período no seletor acima. Evolução mensal, rentabilidade (mês e acumulada), dividendos e dividend yield por mês — os gráficos de proventos não aparecem para Renda Fixa, Tesouro Direto e Criptomoedas.',
    seletor: '[data-tutorial="detalhe-graficos"]',
    posicao: 'acima',
  },
  {
    titulo: 'Operações recentes',
    texto: 'Totais por tipo de operação no período selecionado, seguidos da lista das últimas movimentações registradas.',
    seletor: '[data-tutorial="detalhe-operacoes"]',
    posicao: 'acima',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Reabra este tutorial pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_INVESTIMENTOS_PROVENTOS: PassoTutorial[] = [
  {
    titulo: 'Proventos',
    texto: 'Cada dividendo recebido gera automaticamente uma receita no extrato, na categoria mapeada para o seu tipo (Dividendos, JSCP, Aluguel de FII...).',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Buscar e diagnosticar',
    texto: '"Buscar proventos" consulta B3 e Polygon e lança os pagamentos automaticamente. Se voltar vazio, "Diagnóstico" testa cada elo (posição, fonte, tipo mapeado) sem gravar nada — ótimo pra descobrir o que está bloqueando. "Associar do extrato" vincula lançamentos manuais antigos aos investimentos.',
    seletor: '[data-tutorial="proventos-header"]',
  },
  {
    titulo: 'Novo dividendo',
    texto: 'Lance um provento manualmente: ativo, tipo, conta de recebimento, valor e data. Data futura entra como projeção — vira PAGO quando você confirmar o recebimento.',
    seletor: '[data-tutorial="proventos-novo"]',
  },
  {
    titulo: 'Resumo de proventos',
    texto: 'Proventos por categoria, composição por tipo de ativo (com drill-down por clique) e os objetivos de renda recorrente vinculados a dividendos.',
    seletor: '[data-tutorial="proventos-resumo"]',
    posicao: 'acima',
  },
  {
    titulo: 'Extrato de proventos',
    texto: 'Lista mês a mês, com filtros por tipo de ativo. Proventos projetados têm um botão de confirmação; qualquer um pode ser excluído (a transação vinculada no extrato some junto).',
    seletor: '[data-tutorial="proventos-lista"]',
    posicao: 'acima',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Sem tipos mapeados a uma categoria, use "Configurar tipos" antes de lançar o 1º provento. Reabra este tutorial pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_INVESTIMENTOS_AVALIACOES: PassoTutorial[] = [
  {
    titulo: 'Avaliações',
    texto: 'Seus mentores de IA avaliam cada ativo da carteira por questionário — a nota final pondera os critérios (Fundamentos, Crescimento, Renda, Valuation). Requer ao menos um mentor de IA configurado em Perfil e ativos com saldo em carteira.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Avaliar a carteira',
    texto: 'Escolha quais tipos de ativo avaliar e clique em "Avaliar carteira com os mentores". O processo roda nesta aba — não feche nem recarregue enquanto durar. Se parar no meio, "Continuar avaliação" retoma de onde ficou.',
    seletor: '[data-tutorial="avaliacoes-avaliar"]',
  },
  {
    titulo: 'Agenda de reavaliação',
    texto: 'Defina uma frequência para ser lembrado de reavaliar a carteira periodicamente.',
    seletor: '[data-tutorial="avaliacoes-agenda"]',
  },
  {
    titulo: 'Mentores',
    texto: 'Cada mentor configurado opina de forma independente; a nota final consolida o consenso entre eles (média ou mediana, conforme a questão).',
    seletor: '[data-tutorial="avaliacoes-mentores"]',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Depois da 1ª avaliação, aparecem aqui o ranking geral, a concentração de risco da carteira e a lista de ativos avaliados por tipo. Reabra este tutorial pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]

export const TUTORIAL_INVESTIMENTOS_CONFIG: PassoTutorial[] = [
  {
    titulo: 'Configurações de Investimentos',
    texto: 'Aqui ficam as preferências que alimentam o resto do módulo: seu perfil de investidor, metas de alocação, critérios de avaliação e mapeamento de proventos.',
    seletor: '',
    flutuante: true,
  },
  {
    titulo: 'Perfil do investidor',
    texto: 'Responda o questionário de suitability e informe quando pretende se aposentar. O perfil (Conservador a Arrojado) é derivado das respostas e do seu horizonte de tempo.',
    seletor: '[data-tutorial="config-perfil"]',
  },
  {
    titulo: 'Meta de aposentadoria',
    texto: 'Estimativa pela regra dos 4%: quanto de patrimônio você precisa para viver da renda passiva. Edite "Renda a substituir" para simular diferentes cenários.',
    seletor: '[data-tutorial="config-aposentadoria"]',
    posicao: 'acima',
  },
  {
    titulo: 'Metas de alocação',
    texto: 'Defina o % ideal de cada tipo de ativo na carteira (a soma precisa fechar 100%). Alimenta a barra de meta e a recomendação de compra em cada ativo.',
    seletor: '[data-tutorial="config-metas"]',
    posicao: 'acima',
  },
  {
    titulo: 'Pesos por critério',
    texto: 'Quanto cada critério (Fundamentos, Crescimento, Renda, Valuation) pesa na nota final — vale para todos os tipos de ativo. "Sugerir pelo perfil" preenche automaticamente conforme seu perfil de investidor.',
    seletor: '[data-tutorial="config-pesos"]',
    posicao: 'acima',
  },
  {
    titulo: 'Questionários de avaliação',
    texto: 'Cada tipo de ativo com meta de alocação definida tem seu próprio questionário, separado por critério. Edite as perguntas à mão ou peça a um Mentor de IA para gerar um conjunto novo.',
    seletor: '[data-tutorial="config-questionarios"]',
    posicao: 'acima',
  },
  {
    titulo: 'Tipos de dividendo',
    texto: 'Mapeie cada tipo de provento (Dividendos, JSCP, Aluguel de FII...) a uma categoria do extrato. Sem mapeamento, a busca automática de proventos não consegue lançar o pagamento.',
    seletor: '[data-tutorial="config-tipos-dividendo"]',
    posicao: 'acima',
  },
  {
    titulo: 'Migrar conta de investimentos',
    texto: 'Mova posições, operações, proventos e histórico de uma conta para outra — útil para redistribuir ativos importados numa conta provisória entre suas contas reais.',
    seletor: '[data-tutorial="config-migrar"]',
    posicao: 'acima',
  },
  {
    titulo: 'Tudo pronto!',
    texto: 'Reabra este tutorial pelo botão ❓ na sidebar ou pelo atalho F1.',
    seletor: '',
    flutuante: true,
  },
]
