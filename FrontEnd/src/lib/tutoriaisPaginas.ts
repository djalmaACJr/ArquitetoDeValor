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
    texto: 'Clique para carregar e consolidar os lançamentos de todos os meses do período. Quanto maior o intervalo, mais alguns segundos pode levar — o sistema busca mês a mês em paralelo.',
    seletor: '[data-tutorial="relatorios-gerar"]',
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
    texto: 'Após definir os períodos, clique em Comparar para carregar os dados. O botão só fica ativo quando os dois períodos têm a mesma duração.',
    seletor: '[data-tutorial="comparativo-comparar"]',
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
    flutuante: true,
  },
  {
    titulo: 'Gráficos comparativos',
    texto: '"Receitas vs Despesas" mostra os totais dos dois períodos lado a lado. "Top Categorias" exibe as 10 com maior variação absoluta entre os períodos.',
    seletor: '[data-tutorial="comparativo-graficos"]',
    flutuante: true,
  },
  {
    titulo: 'Tendência Financeira',
    texto: 'Evolução mês a mês dos últimos 12 meses — receitas, despesas e saldo. A tabela abaixo do gráfico mostra os valores exatos alinhados com o eixo X.',
    seletor: '[data-tutorial="comparativo-tendencia"]',
    flutuante: true,
    posicao: 'acima',
  },
  {
    titulo: 'Análise por Categoria',
    texto: 'Tabela com todas as categorias e suas variações. Clique em qualquer valor para ver os lançamentos daquela categoria no período. Use os toggles "Tabela/Pareto" e "Categoria/Resumo" para mudar a visualização.',
    seletor: '[data-tutorial="comparativo-analise"]',
    flutuante: true,
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
    flutuante: true,
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
    texto: 'O mascote e os cards de insight interpretam os números: taxa de poupança em relação à meta de 20%, potencial de economia com cortes e impacto de cada categoria de gasto.',
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
