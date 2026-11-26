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
  /** Data de lançamento, AAAA-MM-DD. */
  data:   string
  titulo: string
  icone:  React.ReactNode
  itens:  { t: string; d: string }[]
}

// AAAA-MM-DD → DD/MM/AAAA (sem passar por Date: evita virar o dia por fuso)
const fmtDataVersao = (iso: string) => iso.split('-').reverse().join('/')

const VERSOES_ANTERIORES: VersaoAnterior[] = [
  {
    versao: '8.0.0',
    data:   '2026-11-25',
    titulo: 'Assembleias de FIIs e e-mail de entrada',
    icone:  <FileText size={16} />,
    itens: [
      { t: '🗳️ Assembleias de FIIs', d: 'o sistema avisa quando um FII da carteira convoca assembleia, com a data, o prazo para votar, a pauta e o caminho para participar. A IA resume o que está em votação e o que muda para você.' },
      { t: '📧 E-mail de entrada', d: 'encaminhe para o seu endereço do sistema os e-mails de proventos e comunicados das corretoras e gestoras: o conteúdo é lido, resumido pela IA e fica guardado para consulta.' },
      { t: '📉 Média de despesas mensais', d: 'a projeção de economia passa a usar a média real das suas despesas, ignorando as categorias que você marcar como fora do dia a dia.' },
      { t: '💵 Dividendos de FIIs corrigidos', d: 'a B3 lista, junto do rendimento, séries que não são a sua cota (recibos de subscrição) e elas estavam sendo somadas. Agora só vale a cota: o valor por cota e o DY ficam iguais ao investidor10.' },
      { t: '📑 Relatórios de mais FIIs', d: 'o sistema passa a guardar o nome de pregão do fundo na B3 e casa o ativo com o relatório e a assembleia pelo nome exato, em vez de adivinhar pelo texto (XPML11, XPLG11, GARE11 e outros não apareciam).' },
      { t: '🔁 Transferir posição, mais seguro', d: 'o destino precisa ser do mesmo tipo do ativo de origem e ter posição ativa na conta escolhida, e a conta de destino é do mesmo tipo da origem. Se o ativo ainda não existe, dá para cadastrá-lo na própria tela.' },
    ],
  },
  {
    versao: '7.9.0',
    data:   '2026-11-23',
    titulo: 'Análise em 2 etapas',
    icone:  <FileText size={16} />,
    itens: [
      { t: '🧑‍💼 Análise “Para você”', d: 'depois da leitura do relatório, o botão “Personalizar para mim” explica o que ele significa para a sua situação: seu perfil de investidor, quanto você tem, o peso do ativo na carteira e há quanto tempo ele está com você. Não é recomendação de compra ou venda.' },
      { t: '⚙️ Automático, se você quiser', d: 'um novo check na página de Análise de Relatórios faz a análise “Para você” junto de cada análise automática. Só funciona com a análise automática ligada e gasta mais uma chamada de IA por análise.' },
      { t: '💰 Preço Teto (Bazin) mais fiel', d: 'o teto agora usa o dividendo por ação de fato pago nos últimos 12 meses, como o investidor10, em vez de dividir o total recebido pela quantidade atual de ações.' },
      { t: '🧮 Valor Justo atualizado', d: 'os fundamentos das ações foram recalculados na base da CVM, corrigindo valores que ainda estavam errados.' },
      { t: '📑 Relatórios por mês e fundo certo', d: 'a lista de relatórios fica sempre do mês mais novo para o mais velho, e o sistema não confunde mais fundos de nomes parecidos (ex.: vários fundos da mesma gestora).' },
      { t: '✨ Pontos fortes em destaque', d: 'a página de entrada e os convites por e-mail e WhatsApp passam a mostrar o que o sistema tem de melhor.' },
    ],
  },
  {
    versao: '7.8.0',
    data:   '2026-11-19',
    titulo: 'Análise de resultados de Ações e Stocks',
    icone:  <FileText size={16} />,
    itens: [
      { t: '📊 Análise de resultados de Ações e Stocks', d: 'a análise por IA, antes só dos FIIs, agora também lê os resultados trimestrais das suas ações brasileiras (dados da CVM) e dos stocks e REITs americanos (relatórios 10-Q/10-K da SEC), explicando em português simples se a empresa vai bem. Mesmos avisos, histórico e escolha de mentor.' },
      { t: '🧮 Preço justo (Graham) corrigido', d: 'o Valor Justo das ações estava muito distante da realidade por um erro de escala nos dados. Agora usa lucro e patrimônio dos controladores, lucro dos últimos 12 meses e o número real de ações (bancos e units tratados à parte).' },
      { t: '🔎 Página do ativo', d: 'ações, stocks e REITs ganham o quadro de análise dos relatórios na própria página do ativo.' },
    ],
  },
  {
    versao: '7.7.0',
    data:   '2026-11-18',
    titulo: 'Análise de relatórios de FIIs',
    icone:  <FileText size={16} />,
    itens: [
      { t: '🤖 Análise de Relatórios de FIIs', d: 'a IA lê o Relatório Gerencial mensal dos seus FIIs e explica em linguagem simples se o fundo está bem, com pontos fortes, pontos de atenção e o que mudou. Pode rodar automática (opção na própria página) ou sob demanda, escolhendo o mentor.' },
      { t: '🔔 Aviso de novas análises', d: 'ao entrar, o sistema mostra o que o mentor analisou e destaca os FIIs com análise nova; o ticker abre a página do ativo já na seção do relatório.' },
      { t: '🚨 Alerta de FII em migração', d: 'avisa quando um FII da carteira entra em liquidação, incorporação, transformação ou troca de código, com base nos fatos relevantes.' },
      { t: '🔁 Transferir posição entre ativos', d: 'migre a posição de um ativo para outro (ex.: RBRR11 → PCIP11) mantendo o histórico, sem lançar venda e compra à mão.' },
    ],
  },
  {
    versao: '7.6.1',
    data:   '2026-11-10',
    titulo: 'Escolher parcelas na lista',
    icone:  <FileText size={16} />,
    itens: [
      { t: '⚡ Escolher parcelas também na lista', d: 'o ícone ⚡ de antecipar na lista do Extrato agora oferece "Todas" ou "Escolher parcelas", como já era na tela de edição do lançamento.' },
    ],
  },
  {
    versao: '7.6.0',
    data:   '2026-11-09',
    titulo: 'Destaques e antecipação parcial',
    icone:  <FileText size={16} />,
    itens: [
      { t: '⚡ Antecipar só algumas parcelas', d: 'ao antecipar um lançamento parcelado, você pode escolher exatamente quais parcelas antecipar (ex.: na 3ª, antecipar a 10, 11 e 12). As demais continuam como estão.' },
      { t: '📈 Posições com lucro', d: 'novo quadro em Destaques de Investimentos com as posições em lucro e em prejuízo, pela rentabilidade total desde a compra.' },
      { t: '🛒 Oportunidades de compra', d: 'novo quadro em Destaques com ativos recomendados para compra (nota alta e tipo abaixo da meta) cujo preço atual está abaixo do preço médio pago, com o valor sugerido.' },
      { t: '⌫ Backspace para voltar', d: 'nos relatórios com detalhamento por categoria, a tecla Backspace volta um nível.' },
    ],
  },
  {
    versao: '7.5.2',
    data:   '2026-11-05',
    titulo: 'Selic/CDI e fatura com PDF',
    icone:  <FileText size={16} />,
    itens: [
      { t: '🧮 Acumulado de 12 meses correto', d: 'em Gerenciar dados, o acumulado de Selic e CDI passa a usar só meses fechados. Antes, o mês em andamento (com poucos dias) derrubava o valor em cerca de 1 ponto.' },
      { t: '📈 Taxa atual em destaque', d: 'os cards de Selic e CDI mostram também a taxa vigente (meta Selic e CDI anual) com a data da última cotação, além da Selic over.' },
      { t: '🧾 Conferência da fatura mais rigorosa', d: 'na importação por categoria, um lançamento já existente que ficaria duplicado (ex.: Crunchyroll agrupado com a Netflix) agora aparece em "não vinculados" e bloqueia a confirmação, em vez de somar a mais no saldo do cartão.' },
      { t: '📄 Baixar o PDF da fatura', d: 'a Importação de Fatura passa a guardar o PDF original (privado, só seu) e ganha o botão de baixar na lista e na revisão. Vale para as faturas importadas a partir de agora.' },
    ],
  },
  {
    versao: '7.5.1',
    data:   '2026-11-04',
    titulo: 'Fechamento só com lançamentos pagos',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '✅ Fechar só com tudo pago', d: 'o fechamento de período exige que todos os lançamentos até a data estejam pagos, em qualquer conta ou tipo.' },
      { t: '📋 Lista de pendências', d: 'se houver lançamentos pendentes ou projetados até a data, o card de Contas mostra a lista para você editar ou excluir cada um e tentar fechar de novo.' },
      { t: '🔒 Períodos fechados só aceitam Pago', d: 'com um período fechado, lançamentos nessas datas não podem mais ser criados nem alterados para Pendente ou Projeção, valendo também para transferências e importações.' },
    ],
  },
  {
    versao: '7.5.0',
    data:   '2026-11-04',
    titulo: 'Fechamento de período',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '⚡ Fechamento de período', d: 'em Contas, escolha uma data de fechamento (no máximo 1 ano atrás). O sistema guarda o saldo de cada conta até lá e passa a somar só os lançamentos mais novos, deixando Extrato, Dashboard e Contas mais rápidos.' },
      { t: '🔄 Saldos sempre corretos', d: 'se você criar, editar ou excluir um lançamento antigo, o saldo guardado da conta é atualizado na hora; os valores exibidos não mudam por causa do fechamento.' },
      { t: '🛠️ Alterar, recalcular ou remover', d: 'você pode mudar a data, recalcular os saldos guardados ou remover o fechamento quando quiser.' },
    ],
  },
  {
    versao: '7.4.2',
    data:   '2026-11-04',
    titulo: 'Exportação no Android e formulários no celular',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '📤 Exportar funciona no Android', d: 'Excel, backup e CSVs agora abrem o menu de compartilhar do celular para salvar ou enviar o arquivo.' },
      { t: '⌨️ Combos sem teclado automático', d: 'no celular, a busca dos seletores só abre o teclado quando você toca nela, sobrando espaço para ver as opções.' },
      { t: '📝 Lançamento não fecha ao tocar fora', d: 'o formulário só fecha por Cancelar, pelo X ou por Esc, e você não perde o que já preencheu.' },
      { t: '🧭 Controles na mesma linha', d: 'Extrato e Relatórios agrupam filtros, exportar e gerar numa linha só, e o Exportar continua visível com os filtros recolhidos.' },
    ],
  },
  {
    versao: '7.4.1',
    data:   '2026-10-29',
    titulo: 'Desempenho e segurança no banco',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '⚡ Consultas mais rápidas', d: 'novos índices no banco aceleram buscas por "lançado por" em lançamentos, objetivos e investimentos de contas compartilhadas.' },
      { t: '🔒 Regras de acesso reforçadas', d: 'ajustes internos no banco para o cadastro de objetivos por agregados e na rotina que preenche o autor dos lançamentos, sem mudar o que você vê.' },
    ],
  },
  {
    versao: '7.4',
    data:   '2026-10-29',
    titulo: 'Radares, rankings e transferências mais claras',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '🕸️ Radares da carteira e dos ativos', d: 'em Avaliações, gráficos de teia mostram diversificação, liquidez, retorno, eficiência e proteção da carteira, ao lado de fundamentos, crescimento, renda e valuation; cada tipo de ativo exibe só os critérios que fazem sentido para ele.' },
      { t: '🏆 Posição do ativo nos Destaques', d: 'a página do ativo mostra onde ele está em cada ranking, no geral e dentro do tipo, em um quadro que você pode mover.' },
      { t: '📈 Novo ranking de Maior YoC', d: 'Destaques ganhou o ranking de YoC e o cálculo de DY/YoC agora é o mesmo em todas as telas, então os números batem entre Meus ativos, Destaques e o ativo.' },
      { t: '🧾 Página do ativo mais organizada', d: 'Últimos dividendos e Operações recentes têm a mesma altura dos gráficos, sem barra de rolagem, e cada operação tem botão de editar.' },
      { t: '➕ Nova movimentação para o mesmo ativo', d: 'depois de registrar uma movimentação, uma nova opção limpa só quantidade e valor e mantém o resto preenchido.' },
      { t: '🔁 Transferências claras no Extrato', d: 'a conta de origem/destino aparece na coluna Conta quando não está filtrada, a saída vem antes da entrada e as duas pernas formam um bloco com cor própria por transferência.' },
      { t: '📉 Cenário pessimista em toda a Projeção', d: 'Evolução Patrimonial Projetada passa a usar o cenário pessimista nos cards, no simulador, na tabela comparativa, nos insights, na exportação e na IA.' },
      { t: '🧹 Menos poluição em Meus ativos', d: 'o botão "Valor de mercado" dos quadros por tipo foi removido.' },
    ],
  },
  {
    versao: '7.3',
    data:   '2026-10-27',
    titulo: 'Preço médio, valor da cota e IAs com quedas do dia',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '💲 Preço médio e valor atual da cota', d: 'a página do ativo ganhou dois cards na primeira linha: o preço médio que você pagou e o valor atual da cota, com a data/hora da última cotação e um botão discreto para atualizar.' },
      { t: '🗂️ Ativos abrem em nova aba', d: 'clicar no ativo nos Destaques, quadros por tipo, extrato e gráfico por instituição abre a página de detalhe em outra aba, sem perder o lugar onde você estava.' },
      { t: '📉 IAs respondem sobre quedas e altas do dia', d: 'no Conselho e no chat do mascote, perguntas como "quais ativos mais caíram ontem?" agora usam o fechamento diário real dos seus ativos cotados.' },
      { t: '🧠 Mentores com mais contexto', d: 'a avaliação dos mentores recebe a variação recente do ativo e pede que validem informações atuais na web quando a busca estiver ativada.' },
    ],
  },
  {
    versao: '7.2.1',
    data:   '2026-10-20',
    titulo: 'Últimas alterações do Dashboard',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '🔐 "Últimas alterações" só com os seus dados', d: 'o quadro do Dashboard deixou de mostrar alterações de outras contas; a rota de auditoria passou a devolver só a própria trilha, e a visão de todos fica restrita à tela de administração.' },
      { t: '👤 Nomes no lugar de códigos', d: 'em contas compartilhadas, o detalhe da alteração mostra "lançado por" com o nome da pessoa, não o identificador.' },
      { t: '⚡ Quadro abre mais rápido, com "Ver mais"', d: 'a lista carrega 20 itens e pagina sob demanda; novo índice no banco acelera a consulta.' },
      { t: '🔄 Lista aparece na primeira abertura', d: 'corrigido o "Nenhuma alteração" que só sumia depois de clicar em Atualizar.' },
    ],
  },
  {
    versao: '7.2',
    data:   '2026-10-16',
    titulo: 'Atividade dos agregados e Pagar no Dashboard',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '👀 Atividade dos agregados', d: 'em Compartilhamento, o dono vê quem criou, alterou ou excluiu lançamentos e outros dados dele, com o nome da pessoa e o que mudou.' },
      { t: '✅ Pagar direto no Dashboard', d: 'o quadro "Vencidos Não Confirmados" ganhou o botão de baixa — o mesmo do Extrato, inclusive a confirmação do valor real nas projeções.' },
      { t: '🔒 Sessão esquecida vai direto pro login', d: 'ao abrir o sistema depois de muito tempo parado, você cai na tela de login em vez de um aviso de aba inativa.' },
      { t: '🗂️ Aviso de aba principal fechada', d: 'se você fechar a aba principal, as outras abas avisam; sem resposta em 20s, só a aba sem uso é encerrada.' },
      { t: '⚡ Muito mais rápido pra quem compartilha dados', d: 'consultas de lançamentos para contas conjuntas deixaram de travar com muitos dados.' },
    ],
  },
  {
    versao: '7.1',
    data:   '2026-10-09',
    titulo: 'Progressão Anual, Comparativo e ajuda no app',
    icone:  <TrendingUp size={16} />,
    itens: [
      { t: '📈 Progressão Anual', d: 'nova tela pra acompanhar como suas receitas, despesas e patrimônio evoluem ano a ano.' },
      { t: '🔀 Comparativo Mensal mais completo', d: 'comparações lado a lado com mais detalhes e leitura mais clara.' },
      { t: '💹 Rentabilidade real', d: 'índices econômicos considerando a inflação (IPCA) para você ver o ganho de verdade.' },
      { t: '❓ Botão de ajuda', d: 'explicações rápidas dentro das telas, sem precisar sair delas.' },
      { t: '🏷️ Categoria obrigatória nos lançamentos', d: 'todo lançamento agora precisa de uma categoria, o que deixa relatórios e objetivos mais confiáveis.' },
      { t: '💸 Proventos', d: 'ajustes de exibição e filtros no quadro de proventos.' },
    ],
  },
  {
    versao: '7.0',
    data:   '2026-10-06',
    titulo: 'Conta conjunta (usuários agregados)',
    icone:  <ShieldCheck size={16} />,
    itens: [
      { t: '👥 Compartilhamento', d: 'convide outra pessoa por e-mail e libere só o que quiser: Extrato, Objetivos ou Investimentos, só leitura ou também edição, e quais contas ela enxerga.' },
      { t: '🔀 Seletor de espaço', d: 'quem é convidado alterna entre "Meus dados" e "Conta de fulano" sem nunca misturar os dois.' },
      { t: '🚪 Sair por conta própria', d: 'o convidado pode deixar de acessar quando quiser, e o dono é avisado.' },
      { t: '🔐 Segurança e desempenho', d: 'correções de segurança, telas mais rápidas e ajustes de layout no celular.' },
      { t: '⌨️ Teclado no app Android', d: 'o campo digitado não fica mais escondido atrás do teclado.' },
    ],
  },
  {
    versao: '6.5',
    data:   '2026-09-30',
    titulo: 'Fatura do Itaú e novo tipo de conta',
    icone:  <FileText size={16} />,
    itens: [
      { t: '🧾 Importação de fatura do Itaú', d: 'suba o PDF da fatura do cartão Itaú e o sistema reconhece os lançamentos, como já fazia com Nubank, Inter e C6.' },
      { t: '🗂️ Novo tipo de conta "Outros"', d: 'pra contas que não se encaixam em corrente, cartão, investimento ou carteira.' },
      { t: '🔒 Aviso de sessão corrigido', d: 'a mensagem de "aba inativa" não aparece mais por engano logo depois de entrar.' },
      { t: '🖱️ Dropdown de tipo de conta mais confiável', d: 'no Windows, a opção "Investimento" ficava ilegível ao passar o mouse — corrigido.' },
    ],
  },
  {
    versao: '6.4',
    data:   '2026-09-28',
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
    data:   '2026-09-18',
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
    data:   '2026-08-31',
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
    data:   '2026-07-23',
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
    data:   '2026-06-09',
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
          <span className="text-[12px]" style={{ color: '#8b92a8' }}>
            Lançada em {fmtDataVersao(info.current.date)}
          </span>
        </div>
        <p className="text-[13px] leading-relaxed mb-3" style={{ color: '#8b92a8' }}>
          {info.current.description}
        </p>

        {/* Detalhe das novidades desta versão (8.1.0) */}
        <ul className="flex flex-col gap-2">
          {[
            { t: '🔎 Localizar ativo', d: 'o painel de Investimentos ganhou um campo de busca: digite o ticker ou o nome e abra o ativo direto.' },
            { t: '🗂️ Análise de Relatórios mais organizada', d: 'os filtros (tipo, ativo, mês e “somente novas”) ficam acima das abas e valem para Relatórios, Assembleias e E-mails; “somente novas” já vem marcado. A aba Relatórios separa as análises da configuração (análise automática e “Analisar agora”).' },
            { t: '🔔 E-mails no aviso de login', d: 'o aviso ao entrar agora também mostra os e-mails novos e os que aguardam a sua aprovação, com atalho para a caixa de entrada.' },
            { t: '🏷️ Esporádica vale para despesa e receita', d: 'marcar a categoria pai marca todas as subcategorias (e desmarcar também), e marcar ou desmarcar uma subcategoria atualiza o pai. As médias da Reserva e da Projeção de economia agora também deixam de fora receitas e proventos dessas categorias (13º, bônus…).' },
            { t: '💰 Reserva ao lado do saldo', d: 'no Dashboard, o quadro Saldo acumulado mostra a Reserva ao lado do saldo quando há espaço, e embaixo em telas pequenas.' },
            { t: '🧠 Avaliações de ativos', d: 'o resumo da rodada passa a contar só o que ainda pode ser avaliado (ativos com saldo), então fecha em “carteira completa” e o botão Continuar reflete o que realmente falta.' },
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
                    <span className="block text-[12px]" style={{ color: '#8b92a8' }}>Lançada em {fmtDataVersao(v.data)}</span>
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
