// src/lib/conteudoMascotes.ts
//
// Biblioteca viva de conteúdo dos 4 mascotes. Cada personagem tem
// personalidade própria, vocabulário próprio e território didático.
// Ver `Documentação/MASCOTES.md` para o guia editorial completo.
//
// As funções `escolherDica()` e `fala()` são consumidas por `MascoteDica`
// e telas que querem variar mensagens contextualmente.

import type { MascoteNome, MascotePose } from '../components/ui/Mascote'

// ──────────────────────────────────────────────────────────────────────────
// Frases-assinatura — pequenas marcas verbais de cada mascote
// ──────────────────────────────────────────────────────────────────────────

export const ASSINATURAS: Record<MascoteNome, string[]> = {
  sabio: [
    'Devagar se vai ao longe — em finanças, é literal.',
    'Não se planta um carvalho e se colhe no mesmo mês.',
    'A sabedoria do longo prazo é sua maior riqueza.',
    'O que parece pequeno hoje vira grande com o tempo.',
    'Disciplina vence talento — sempre.',
  ],
  arquiteta: [
    'Estrutura primeiro, estética depois.',
    'Sem medição não há controle.',
    'Vamos abrir a planilha — você vai gostar do que vê.',
    'Cada gasto tem um lugar no projeto.',
    'O cálculo não mente — vamos olhar juntos.',
  ],
  gato: [
    'Abracadinheiro! Os juros compostos chegaram.',
    'Esse é o feitiço mais antigo do mundo — e o mais poderoso.',
    'Pequeno hoje, mágico amanhã.',
    'Bola de cristal? Não preciso — eu tenho a planilha.',
    'O tempo é o pó mágico que faz tudo funcionar.',
  ],
  raposa: [
    'Toda decisão tem um custo de oportunidade — sempre.',
    'Quem sabe quando *não* agir, ganha mais que quem sempre age.',
    'Mercado é leitura, não palpite.',
    'Há sempre dois lados — e o seu interesse fica num deles.',
    'Astúcia não é trapaça. É enxergar primeiro.',
  ],
}

// ──────────────────────────────────────────────────────────────────────────
// Dicas educacionais curtas — 1 a 2 frases por dica
// Categorizadas por mascote e tema. Servem como "frases do dia".
// ──────────────────────────────────────────────────────────────────────────

export interface Dica {
  /** Tema livre — usado para selecionar dicas relevantes ao contexto */
  tema:     string
  /** Pose recomendada para acompanhar a dica */
  pose:     MascotePose
  /** O texto em si (1-3 frases curtas) */
  texto:    string
}

export const DICAS: Record<MascoteNome, Dica[]> = {
  // ─── Sábio — ~50 dicas: mentor experiente, disciplina, tempo, hábito ───
  sabio: [
    { tema: 'tempo',       pose: 'sentado',   texto: 'Quem começa a investir aos 25 com R$ 200/mês chega aos 60 com mais dinheiro do que quem começa aos 40 com R$ 500. Tempo > talento.' },
    { tema: 'disciplina',  pose: 'sentado',   texto: 'Investir é um hábito. Quem aporta nos meses bons e nos ruins, vence quem só aporta quando se anima.' },
    { tema: 'dívida',      pose: 'curioso',   texto: 'Antes de procurar o investimento perfeito, quite o cartão de crédito. Nenhuma aplicação rende 15% ao mês — mas é isso que ele cobra de você.' },
    { tema: 'crise',       pose: 'sentado',   texto: 'Já vi a bolsa cair 40% e voltar inteira em 18 meses. Quem vendeu no fundo, perdeu. Quem dormiu, ganhou.' },
    { tema: 'meta',        pose: 'curioso',   texto: 'Defina o porquê antes do quanto. "Quero R$ 500 mil" é vago. "Quero comprar minha casa em 8 anos" é um plano.' },
    { tema: 'paciência',   pose: 'feliz',     texto: 'O carvalho cresce dois centímetros por ano. Depois de vinte anos, ninguém repara que ele começou pequeno.' },
    { tema: 'tempo',       pose: 'sentado',   texto: 'O melhor dia pra plantar uma árvore foi há 20 anos. O segundo melhor é hoje. Vale pra investimento também.' },
    { tema: 'hábito',      pose: 'sentado',   texto: 'Renda não é riqueza. Riqueza é o que sobra depois que você gastou — e isso depende do hábito, não do salário.' },
    { tema: 'compra',      pose: 'curioso',   texto: 'A pior decisão financeira é a tomada com pressa. Espere 48 horas para qualquer compra acima de R$ 500.' },
    { tema: 'sabedoria',   pose: 'sentado',   texto: 'Quem ensina os filhos sobre dinheiro deixa herança mais duradoura que qualquer testamento.' },
    { tema: 'medo',        pose: 'espantado', texto: 'O medo de perder dinheiro fez mais gente pobre do que perdas reais. Aja — mas com paciência.' },
    { tema: 'simplicidade',pose: 'sentado',   texto: 'Investidores que ganham mais são os que entendem o que possuem. Se não consegue explicar o investimento em uma frase, não invista nele.' },
    { tema: 'tempo',       pose: 'curioso',   texto: 'Pergunta certa: "estarei feliz com essa decisão daqui a 10 anos?". A maioria das ruins não passa por essa peneira.' },
    { tema: 'paciência',   pose: 'sentado',   texto: 'O mercado paga aos pacientes o que tira dos impacientes. Sempre foi assim.' },
    { tema: 'disciplina',  pose: 'andando',   texto: 'Aportar todo dia 5, doa o que doer. É menos sobre o quanto e mais sobre nunca parar.' },
    { tema: 'crise',       pose: 'sentado',   texto: 'Crises econômicas vêm de tempos em tempos. Quem não tem reserva, vende ativos no pior preço. Reserva é coragem comprada antecipadamente.' },
    { tema: 'comparação',  pose: 'curioso',   texto: 'A vida do vizinho parece melhor por fora. Por dentro, frequentemente é financiada por dívidas que vocês dois não vê.' },
    { tema: 'lição',       pose: 'feliz',     texto: 'Aprenda com cada erro próprio — e com 100 erros alheios. Sai mais barato.' },
    { tema: 'consumo',     pose: 'sentado',   texto: 'Carro novo perde 20% no primeiro ano. Carro de 3 anos perde 7%. Pequena escolha, grande diferença ao longo da vida.' },
    { tema: 'tempo',       pose: 'sentado',   texto: 'A pergunta certa não é "esse investimento é bom?", mas "esse investimento serve pra QUAL prazo?".' },
    { tema: 'hábito',      pose: 'feliz',     texto: 'Quem registra cada lançamento por 3 meses já entendeu mais de finanças que 99% dos seus colegas.' },
    { tema: 'simplicidade',pose: 'sentado',   texto: 'Investidor médio não precisa de 12 fundos. Três bem escolhidos cobrem 95% do que dá pra fazer.' },
    { tema: 'erros',       pose: 'triste',    texto: 'Já cometi todos os erros que você vai cometer. Não significa que eu desista — significa que sei o caminho de volta.' },
    { tema: 'medo',        pose: 'curioso',   texto: 'Quando a notícia fala em "pânico no mercado", lembre: pânico é estado emocional, não de planilha. Sua planilha continua firme.' },
    { tema: 'meta',        pose: 'sentado',   texto: 'Toda meta financeira precisa de prazo, valor e propósito. Falta um, vira sonho.' },
    { tema: 'tempo',       pose: 'sentado',   texto: 'Esperar é a habilidade mais cara do mercado — porque é a mais rara.' },
    { tema: 'dívida',      pose: 'espantado', texto: 'Empréstimo "pra dar entrada num negócio" raramente termina bem. Comece com seu próprio capital, ou nem comece.' },
    { tema: 'compra',      pose: 'sentado',   texto: 'Quanto vale o item? Não o preço — o tempo da sua vida que você gastou pra pagá-lo.' },
    { tema: 'riqueza',     pose: 'feliz',     texto: 'A primeira fortuna está no controle dos gastos. A segunda, no investimento do que sobra. A terceira, em ensinar isso a outros.' },
    { tema: 'paciência',   pose: 'sentado',   texto: 'O dia em que o juros compostos viram visíveis é o dia em que você quase desistiu. Não desista perto do fim.' },
    { tema: 'experiência', pose: 'sentado',   texto: 'Vivi a hiperinflação. Vivi os 30% ao mês de juros. Vivi a explosão das pontocom. Cada uma terminou — você também vai sobreviver à atual.' },
    { tema: 'reserva',     pose: 'curioso',   texto: 'Reserva de emergência não é "perda de oportunidade". É o que permite que você capture oportunidades sem ter que vender ativos no susto.' },
    { tema: 'consumo',     pose: 'andando',   texto: 'Cada compra é um voto no tipo de pessoa que você está se tornando. Vote com cuidado.' },
    { tema: 'tempo',       pose: 'sentado',   texto: 'Os 10 primeiros anos parecem que nada acontece. Os 10 seguintes mudam tudo. Persistir é o filtro.' },
    { tema: 'humildade',   pose: 'sentado',   texto: 'Quem se acha esperto demais perde mais que quem se sabe limitado. Humildade vence sofisticação.' },
    { tema: 'hábito',      pose: 'sentado',   texto: 'O orçamento é como um espelho — desconfortável às vezes, mas honesto. Use-o pra ajustar, não pra se julgar.' },
    { tema: 'crise',       pose: 'curioso',   texto: 'Toda crise é também uma oferta. Quem tinha reserva comprou nas máximas mais baratas da década.' },
    { tema: 'dívida',      pose: 'sentado',   texto: 'Dívida boa: compra ativo que rende mais que o juro (raríssimo). Dívida ruim: todo o resto. Comece sempre pela ruim.' },
    { tema: 'consumo',     pose: 'curioso',   texto: 'A diferença entre quem fica rico e quem fica pobre não é a renda — é o que eles fazem com ela.' },
    { tema: 'tempo',       pose: 'sentado',   texto: 'Você não controla os juros. Não controla a inflação. Não controla a bolsa. Controla seu aporte e seu prazo — e isso já é 90% do resultado.' },
    { tema: 'sucessão',    pose: 'sentado',   texto: 'Riqueza herdada sem educação financeira dura uma geração. Riqueza construída ensina a próxima a manter.' },
    { tema: 'foco',        pose: 'sentado',   texto: 'Foque no que você pode controlar: gastos, aportes, tempo no mercado. O resto é ruído.' },
    { tema: 'erro',        pose: 'triste',    texto: 'Errei quando comprei a euforia em 1990. Errei quando vendi no pavor de 2008. Cada erro me ensinou — e fica mais barato aprender com os meus.' },
    { tema: 'simplicidade',pose: 'feliz',     texto: 'O segredo nunca foi a fórmula mágica. Foi: gastar menos do que ganha, investir a diferença, repetir por décadas.' },
    { tema: 'paciência',   pose: 'sentado',   texto: 'Mercado: máquina de transferir dinheiro do impaciente pro paciente. Decide pra qual lado quer estar.' },
    { tema: 'risco',       pose: 'curioso',   texto: 'Risco não é volatilidade — é perder o que você não pode repor. Conheça seus limites antes de procurar retorno.' },
    { tema: 'sabedoria',   pose: 'sentado',   texto: 'O dinheiro amplifica quem você já é. Se você é gentil, ele faz bem. Se é arrogante, faz mal. Cuide do caráter antes da carteira.' },
    { tema: 'tempo',       pose: 'sentado',   texto: '"Não tenho tempo pra cuidar das finanças" é a frase mais cara que se diz por aí. Tudo se paga depois — com juros.' },
    { tema: 'meta',        pose: 'feliz',     texto: 'Comemore as pequenas vitórias. O primeiro mês no azul, o primeiro R$ 1.000 reservado, o primeiro aporte mensal repetido. Hábito vem das pequenas vitórias.' },
    { tema: 'tempo',       pose: 'sentado',   texto: 'Em cinco anos, você só vai lembrar das decisões grandes. Tome essas com cuidado. As pequenas, deixe pro hábito.' },
  ],

  // ─── Arquiteta — ~50 dicas: estrutura, cálculo, planejamento, métricas ───
  arquiteta: [
    { tema: 'orçamento',     pose: 'curioso',   texto: 'Regra simples: 50% essenciais, 30% variáveis, 20% poupança e dívida. Não é sagrada — é o ponto de partida pra você ajustar.' },
    { tema: 'reserva',       pose: 'curioso',   texto: 'Reserva de emergência = gastos mensais essenciais × 6. Antes disso, qualquer investimento de risco é otimismo, não estratégia.' },
    { tema: 'meta',          pose: 'sentado',   texto: '"Economizar mais" não é meta — é desejo. "Guardar R$ 5.000 até dez/2027" é meta. Específica, mensurável, com prazo.' },
    { tema: 'categoria',     pose: 'curioso',   texto: 'Se 35% do seu orçamento está em "Outros", você não tem orçamento — tem planilha. Subdivida até cada categoria explicar exatamente onde o dinheiro foi.' },
    { tema: 'controle',      pose: 'sentado',   texto: 'Medir um mês muda pouco. Medir doze meses muda tudo. Os padrões ficam óbvios.' },
    { tema: 'fixos',         pose: 'espantado', texto: 'Despesas fixas crescendo é o sinal mais perigoso — corrige raiz, não folha. Renegocia. Troca. Cancela.' },
    { tema: 'planejamento',  pose: 'sentado',   texto: 'Plano financeiro tem três camadas: hoje (orçamento), amanhã (reserva), depois de amanhã (investimento). Pular ordem é receita pra dor de cabeça.' },
    { tema: 'patrimônio',    pose: 'curioso',   texto: 'Patrimônio líquido = ativos − passivos. Calcule trimestralmente. Se não cresce, algo do plano não está saindo do papel.' },
    { tema: 'planilha',      pose: 'sentado',   texto: 'Toda planilha precisa responder 3 perguntas: quanto eu tenho, quanto eu devo, quanto eu posso poupar. O resto é detalhe.' },
    { tema: 'cartão',        pose: 'espantado', texto: 'Cartão de crédito não é renda extra. É antecipação. Pagou só o mínimo? Multiplique por 10 e veja quanto vai pagar de juros — vai assustar.' },
    { tema: 'aporte',        pose: 'sentado',   texto: 'Automatize seus aportes: débito no dia 5, antes de qualquer outro gasto. "Pague-se primeiro" não é frase de auto-ajuda — é estatística.' },
    { tema: 'fluxo',         pose: 'curioso',   texto: 'Saldo no fim do mês: receitas − despesas. Se está negativo, há vazamento. Auditoria começa pela maior categoria.' },
    { tema: 'meta',          pose: 'andando',   texto: 'Meta dividida em 12 parcelas mensais vira hábito. Meta de "fim de ano" vira corrida desesperada em dezembro.' },
    { tema: 'taxa',          pose: 'curioso',   texto: 'Taxa de poupança ideal: 20% da renda. Abaixo de 10%, você não constrói patrimônio. Acima de 30%, ótimo — mas cuidado com qualidade de vida.' },
    { tema: 'inflação',      pose: 'espantado', texto: 'Inflação de 5% ao ano transforma R$ 1.000 em R$ 950 de poder de compra. Em 10 anos, R$ 600. Dinheiro parado não está "seguro" — está derretendo.' },
    { tema: 'previdência',   pose: 'sentado',   texto: 'INSS sozinho substitui só 60-70% do salário (e com teto). Quem ganha mais que o teto precisa de plano próprio — calcule a diferença, vai ser maior do que pensa.' },
    { tema: 'categoria',     pose: 'curioso',   texto: 'Subdivida sua maior categoria de despesa por 3 meses. Padrões escondidos aparecem — onde corta é onde libera renda pra investir.' },
    { tema: 'simulação',     pose: 'sentado',   texto: 'Antes de comprar parcelado, calcule à vista com desconto: muitas vezes o cash equivalente quita 3 meses do parcelamento.' },
    { tema: 'transferência', pose: 'curioso',   texto: 'Transferências entre contas próprias não são receita nem despesa — são movimentação. Categorize separado pra não inflar seu fluxo.' },
    { tema: 'recorrência',   pose: 'espantado', texto: 'Auditoria anual de assinaturas economiza, em média, R$ 200/mês. Em 30 anos a 8% = R$ 224.000. Pequeno hábito, grande retorno.' },
    { tema: 'imposto',       pose: 'sentado',   texto: 'Imposto sobre investimentos varia (15% acima de 720 dias para renda fixa). Planejar o resgate pelo tempo certo pode aumentar líquido em 7%.' },
    { tema: 'liquidez',      pose: 'curioso',   texto: 'Tem 3 tipos de dinheiro: emergência (líquido), curto prazo (CDB liquidez diária), longo prazo (renda fixa + bolsa). Misturar é receita pra arrependimento.' },
    { tema: 'meta',          pose: 'sentado',   texto: 'Quebre meta de 5 anos em 60 metas mensais. Acompanha cada uma. Sucessos pequenos somam até o grande.' },
    { tema: 'fluxo',         pose: 'andando',   texto: 'Cobrar e pagar no mesmo dia do mês simplifica o fluxo de caixa. Quem espalha vencimentos sofre mês inteiro com pequenos sustos.' },
    { tema: 'planilha',      pose: 'sentado',   texto: 'Exporte seu extrato a cada 3 meses. Anomalia visível é anomalia resolvida.' },
    { tema: 'orçamento',     pose: 'curioso',   texto: 'Existem 3 tipos de despesa: fixa (mesma sempre), variável (mês a mês muda), esporádica (anual, imprevista). Categorize separado.' },
    { tema: 'cálculo',       pose: 'sentado',   texto: '13º + férias + bônus = receita esporádica. Não inclua no orçamento mensal — use pra reserva, abatimento de dívida, ou aporte extra.' },
    { tema: 'investimento',  pose: 'sentado',   texto: 'Antes de "qual investimento?", pergunte "qual o prazo?". Para 1 ano: renda fixa. Para 10 anos: pode ter bolsa. Confundir prazo é o erro mais comum.' },
    { tema: 'desperdício',   pose: 'espantado', texto: 'Café diário a R$ 8 = R$ 240/mês = R$ 2.880/ano. Em 30 anos a 8%: R$ 340.000. Não é sobre cortar café — é sobre saber o custo real.' },
    { tema: 'reserva',       pose: 'sentado',   texto: 'Reserva fica em Tesouro Selic ou CDB com liquidez diária. Quem deixa em bolsa ou crypto não tem reserva — tem aposta.' },
    { tema: 'planejamento',  pose: 'curioso',   texto: 'Plano sem prazo é desejo. Prazo sem revisão trimestral é fé. Reveja: você está no ritmo certo pra meta?' },
    { tema: 'cartão',        pose: 'curioso',   texto: 'Use cartão como ferramenta de cashback e milhas — não como crédito. Quem usa só dentro do orçamento ganha 1-3% a mais por mês.' },
    { tema: 'meta',          pose: 'feliz',     texto: 'Toda meta atingida merece uma comemoração proporcional — máximo 10% do valor poupado. O resto vai pro próximo plano.' },
    { tema: 'controle',      pose: 'sentado',   texto: 'Quem mede semanalmente reage rápido a desvios. Mensalmente, é tarde — o estouro já aconteceu.' },
    { tema: 'previdência',   pose: 'sentado',   texto: 'Para se aposentar com R$ 5.000/mês de renda passiva, precisa de aprox. R$ 1.500.000 acumulados a 4% a.a. Calcule pra trás quanto aportar.' },
    { tema: 'patrimônio',    pose: 'curioso',   texto: 'Inclua na sua planilha de patrimônio: imóveis (valor de venda, não compra), veículos (depreciados), dívidas (saldo devedor). Foto realista é mais útil que otimista.' },
    { tema: 'simulação',     pose: 'sentado',   texto: 'Antes de troca de carro, simule 5 anos: gasolina + IPVA + manutenção + perda de valor. O carro "barato" pode sair mais caro.' },
    { tema: 'imposto',       pose: 'espantado', texto: 'Pessoa física com investimento em ações: ganho mensal até R$ 20k é isento. Acima, 15%. Planeje vendas pra usar essa isenção.' },
    { tema: 'orçamento',     pose: 'curioso',   texto: 'Inclua "imprevistos" no orçamento — 5 a 10% por mês. Sem essa folga, qualquer surpresa quebra o plano.' },
    { tema: 'planilha',      pose: 'sentado',   texto: 'A planilha mais útil é a mais usada. Complexa demais, você abandona. Simples demais, você não enxerga padrão. Equilíbrio.' },
    { tema: 'cálculo',       pose: 'feliz',     texto: 'R$ 500 mensais por 25 anos a 9% ao ano = R$ 568.000. Você botou R$ 150 mil. O resto (R$ 418 mil) é matemática.' },
    { tema: 'fluxo',         pose: 'andando',   texto: 'Quando o mês começar, lance todos os gastos fixos previstos. Aí você vê em tempo real quanto sobra pro variável.' },
    { tema: 'meta',          pose: 'sentado',   texto: 'Meta dividida ÷ meses = aporte mensal. Aporte mensal ÷ dias úteis = aporte diário. Pequenos números matam grandes metas.' },
    { tema: 'controle',      pose: 'sentado',   texto: 'Quem categoriza só "no fim do mês" perde detalhe. Categorize ao lançar — leva 5 segundos e dura pra sempre.' },
    { tema: 'reserva',       pose: 'sentado',   texto: 'Autônomos: reserva de 12 meses, não 6. Renda variável exige colchão maior.' },
    { tema: 'investimento',  pose: 'curioso',   texto: 'Para iniciantes: 70% renda fixa + 30% renda variável é proporção segura por uns 5 anos. Depois, ajusta com base no perfil real (não no questionário).' },
    { tema: 'planejamento',  pose: 'sentado',   texto: 'Plano financeiro deve caber em uma página. Não cabe? Está complicado demais — e plano complicado, ninguém segue.' },
    { tema: 'desperdício',   pose: 'curioso',   texto: 'Conta de luz subindo? Veja em qual mês. Pico no verão = ar-condicionado. Pico no inverno = chuveiro. Diagnóstico antes de cortar.' },
    { tema: 'orçamento',     pose: 'sentado',   texto: 'Família boa pra finanças = reunião mensal de 30 minutos pra revisar planilha. Sem cobrança, sem julgamento — só transparência.' },
    { tema: 'cálculo',       pose: 'feliz',     texto: 'Aporte aumentando 5% ao ano (acompanha inflação + crescimento) aumenta resultado final em 30%. Pequeno reajuste, grande efeito.' },
  ],

  // ─── Mago Gato — ~50 dicas: magia dos juros, multiplicação, leveza ───
  gato: [
    { tema: 'juros-compostos', pose: 'feliz',     texto: 'Regra dos 72: divida 72 pela taxa anual. A 6%, seu dinheiro dobra em 12 anos. A 12%, em 6. Feitiço antigo, sempre funciona.' },
    { tema: 'aporte',          pose: 'feliz',     texto: 'R$ 100/mês × 30 anos × 8% ao ano = R$ 149.035. Você botou R$ 36 mil. O resto — R$ 113 mil — é pura mágica dos juros.' },
    { tema: 'dividendos',      pose: 'curioso',   texto: 'Recebeu dividendo? Reinveste. Vira dividendo do mês que vem. É como acender uma vela com outra — só que a primeira nunca apaga.' },
    { tema: 'pequeno-grande',  pose: 'feliz',     texto: 'R$ 5 por dia parecem nada. Em 30 anos a 8% ao ano: R$ 224 mil. Os pequenos viram montanha — basta esperar o feitiço fazer efeito.' },
    { tema: 'paciência',       pose: 'sentado',   texto: 'O segredo dos magos antigos não era a varinha — era esperar a poção cozinhar. Juros compostos amam tédio.' },
    { tema: 'inflação',        pose: 'espantado', texto: 'A inflação é o feitiço *do mal* — corrói dinheiro parado. Poupança a 6%, inflação a 5%? Você ganha 1% — não os 6% que pensava.' },
    { tema: 'aporte',          pose: 'feliz',     texto: 'Aportar pequeno e sempre vale mais que aportar muito e raramente. O ritmo é o segredo — não o volume.' },
    { tema: 'tempo',           pose: 'feliz',     texto: 'Pchsst! O dinheiro investido aos 20 anos vale 4x mais que o investido aos 40. Mesmo valor, prazo diferente — *Voilà!*' },
    { tema: 'juros-compostos', pose: 'curioso',   texto: 'Juros compostos = juros sobre juros. Ano 1: rende R$ 80. Ano 2: rende R$ 86 (sobre R$ 1.086). Ano 30: rende R$ 743. A neve vira avalanche.' },
    { tema: 'cesta',           pose: 'curioso',   texto: 'Diversificação é nunca colocar todos os ovos na mesma cesta encantada. Várias cestas, vários feitiços diferentes — risco menor, magia igual.' },
    { tema: 'dividendos',      pose: 'feliz',     texto: 'Dividendos são feitiços que se renovam todo trimestre. Você recebe sem trabalhar — o dinheiro trabalha pra você.' },
    { tema: 'inflação',        pose: 'curioso',   texto: 'O contrafeitiço da inflação? Render acima dela. Renda fixa pós-fixada IPCA+ é a versão mais segura desse feitiço.' },
    { tema: 'magia',           pose: 'feliz',     texto: 'Abracadinheiro! Quem aporta R$ 1 hoje, R$ 1 amanhã, R$ 1 depois — em 40 anos vai ter assistido R$ 14.000 virarem R$ 350.000. Magia real.' },
    { tema: 'consistência',    pose: 'andando',   texto: 'O melhor feitiço é o mais chato: aporte mensal automático. Pchsst, vai funcionar enquanto você dorme.' },
    { tema: 'fundos',          pose: 'curioso',   texto: 'Fundo de índice (ETF) = ouro líquido. Compra "a economia inteira" num só feitiço. Taxa baixa, diversificação automática.' },
    { tema: 'tempo',           pose: 'sentado',   texto: 'Ano 1, você não vê nada. Ano 5, vê crescimento. Ano 10, vê magia. Ano 20, é absurdo. Paciência é o ingrediente mais caro.' },
    { tema: 'erro',            pose: 'triste',    texto: 'Vendi cedo e perdi a melhor parte da magia. Hoje conto pra vocês não repetirem. Mexer na poção atrapalha o feitiço.' },
    { tema: 'comparação',      pose: 'espantado', texto: 'Mesmo aporte, taxa de 6% × 12% = resultado 4x maior em 30 anos. A taxa importa MAIS que o valor — feitiço fica mais forte.' },
    { tema: 'tributação',      pose: 'curioso',   texto: 'Imposto regressivo: 22.5% até 6 meses, 15% acima de 2 anos. Cada ano a mais, menos imposto — o tempo é seu aliado pra esse feitiço também.' },
    { tema: 'magia-pequena',   pose: 'feliz',     texto: 'O cliente que perguntou se R$ 50/mês "vale a pena" hoje tem R$ 80 mil só desse aporte. Cada moeda conta — abracadinheiro!' },
    { tema: 'caixa-magia',     pose: 'feliz',     texto: 'O cofre dos magos: previdência privada PGBL com 12% de IR deferido + investimento longo prazo = combo poderoso pra quem declara IR completo.' },
    { tema: 'paciência',       pose: 'sentado',   texto: 'O dia em que o juros compostos começam a render mais do que seu aporte mensal é o dia em que a mágica fica visível. Esse momento existe pra todos.' },
    { tema: 'aporte',          pose: 'feliz',     texto: 'Aporte extra de fim de ano (13º): coloque 50% pra investir. Faz uma diferença mágica no fim da década.' },
    { tema: 'cesta',           pose: 'feliz',     texto: '3 cestas é o mínimo: renda fixa (segura), ações (crescimento), imóveis ou FIIs (renda passiva). Magias diferentes, riscos diferentes.' },
    { tema: 'tempo',           pose: 'andando',   texto: 'Começou tarde? Comece HOJE. Cada ano a menos é um feitiço a menos. Quem espera "o momento certo" não tem feitiço — só desculpa.' },
    { tema: 'volatilidade',    pose: 'curioso',   texto: 'Bolsa caiu 20%? Pra quem investe há 20 anos, é um soluço. Pra quem investe há 6 meses, é desespero. O prazo decide a sensação.' },
    { tema: 'magia-real',      pose: 'feliz',     texto: 'A regra dos 72 não é magia — é matemática. Mas funciona MAGICAMENTE bem. Divida 72 pela taxa anual e veja em quanto tempo dobra. Sempre confere.' },
    { tema: 'inflação',        pose: 'espantado', texto: 'Inflação de 6% em 10 anos: R$ 1.000 vira R$ 558. O feitiço silencioso que corrói até dinheiro guardado em colchão.' },
    { tema: 'rendimento',      pose: 'curioso',   texto: 'Renda passiva é o feitiço final: você faz nada, dinheiro trabalha. Mas pra chegar lá, leva tempo. Plante hoje a árvore que dará sombra amanhã.' },
    { tema: 'dividendos',      pose: 'feliz',     texto: 'FIIs (Fundos Imobiliários) pagam mensalmente. R$ 50 mil em FIIs ≈ R$ 350-400/mês de renda passiva isenta. Magia real do cofre dos magos.' },
    { tema: 'aporte',          pose: 'andando',   texto: 'Aumentou de salário? Aumente o aporte na MESMA proporção. Senão, é só inflação no estilo de vida.' },
    { tema: 'simplicidade',    pose: 'curioso',   texto: 'Quanto MENOR sua taxa de administração, MAIOR seu retorno. 1% a.a. de taxa em 30 anos engole 25% do patrimônio final. Feitiço caro.' },
    { tema: 'tempo',           pose: 'sentado',   texto: 'Magos sábios olham pro horizonte de 30 anos, não 30 dias. Quem reage diariamente perde a paciência — e o feitiço.' },
    { tema: 'pequeno-grande',  pose: 'feliz',     texto: 'Trocar 1 jantar caro/mês por jantar em casa: R$ 200 economizados. Investidos a 8% por 30 anos: R$ 280 mil. Pequeno feitiço, grande resultado.' },
    { tema: 'tributação',      pose: 'curioso',   texto: 'LCI, LCA, debêntures de infraestrutura: isentas de IR para pessoa física. Mesmo retorno bruto = mais retorno líquido. Feitiço fiscal.' },
    { tema: 'reinvestir',      pose: 'feliz',     texto: 'Reinvestir dividendos automaticamente em 30 anos pode dobrar o patrimônio final. O feitiço da composição funciona melhor sem interrupção.' },
    { tema: 'magia-tempo',     pose: 'sentado',   texto: 'Pchsst — o segredo: 80% do retorno acumulado vem nos últimos 30% do tempo. Nos primeiros anos, parece que nada acontece. Paciência!' },
    { tema: 'erro',            pose: 'espantado', texto: 'Investidor médio rende 4% menos que o mercado por mexer demais. Comprar e MANTER é o feitiço mais difícil — e o mais lucrativo.' },
    { tema: 'objetivo',        pose: 'feliz',     texto: 'Independência financeira = quando renda passiva ≥ despesas mensais. Conta: despesas × 300 ≈ patrimônio necessário a 4%. Magia matemática.' },
    { tema: 'consumismo',      pose: 'curioso',   texto: 'A mágica do consumo dá um soluço breve de felicidade. A do investimento, uma calma duradoura. Cada um escolhe o feitiço.' },
    { tema: 'dividendos',      pose: 'feliz',     texto: 'Sabe o que é melhor que receber R$ 1000 hoje? Receber R$ 100 todo mês, pra sempre. Renda passiva > capital — é o feitiço final.' },
    { tema: 'tempo',           pose: 'andando',   texto: 'A magia funciona em qualquer idade — só rende mais quanto mais cedo começa. Não desanime se começou tarde. Comece.' },
    { tema: 'comparação',      pose: 'curioso',   texto: 'Bolsa rendeu 12% ano passado, CDI rendeu 13%. Risco maior, retorno menor? Foi um ano. Olhe 20 anos: bolsa ganha. Quem julga pelo mês erra.' },
    { tema: 'meta',            pose: 'feliz',     texto: 'Definir meta de aposentadoria assusta. Defina meta de "renda passiva de R$ 1.000/mês" primeiro. Aí dobra. Aí 4x. Cada degrau celebra-se.' },
    { tema: 'caixa',           pose: 'sentado',   texto: 'Dinheiro parado na poupança rende pior que tesouro Selic. Diferença anual: 1-2%. Em 30 anos: pode dobrar o resultado.' },
    { tema: 'compras',         pose: 'curioso',   texto: 'Antes de comprar parcelado, calcule: o valor que ia pra parcela, investido a 1%/mês, em 5 anos quanto vira? Frequente, é mais que o item.' },
    { tema: 'paciência',       pose: 'sentado',   texto: 'Quem aporta toda hora e nunca olha o saldo ganha mais que quem aporta e fica conferindo. Conferir gera ansiedade — ansiedade gera erro.' },
    { tema: 'mágica',          pose: 'feliz',     texto: 'A magia mais bonita: ver alguém que começou com R$ 50/mês, depois de 25 anos, ter R$ 250 mil. Foi sempre o mesmo R$ 50 — o tempo fez o resto.' },
    { tema: 'lição',           pose: 'feliz',     texto: 'Feitiço mais simples: ganhe mais OU gaste menos. Depois invista a diferença. O resto é detalhe.' },
    { tema: 'magia-dia',       pose: 'andando',   texto: 'Pchsst! Hoje é o dia mais cedo que você pode começar. Cada dia que passa é um dia a menos de mágica. Bóia!' },
  ],

  // ─── Raposa — ~50 dicas: estratégia, mercado, risco, vieses ───
  raposa: [
    { tema: 'custo-oportunidade', pose: 'sentado',   texto: 'Cada real parado é um real que poderia render. Estratégia começa quando você enxerga o que o dinheiro fez E o que deixou de fazer.' },
    { tema: 'fomo',              pose: 'curioso',   texto: 'Quando todo mundo está comprando, é tarde. Quando todo mundo está vendendo, é cedo. A manada raramente pisa no melhor preço.' },
    { tema: 'diversificação',    pose: 'sentado',   texto: 'Concentrar é apostar. Diversificar não é covardia — é matemática. Reduz o risco específico sem reduzir o retorno esperado.' },
    { tema: 'risco',             pose: 'espantado', texto: 'Risco não é volatilidade. Risco é perder permanentemente o que você não pode repor. Confunda os dois e você vai vender no fundo da crise.' },
    { tema: 'viés',              pose: 'curioso',   texto: 'Aversão à perda é assimétrica: a dor de perder R$ 100 é maior que a alegria de ganhar R$ 100. Saber disso é meio caminho pra decidir melhor.' },
    { tema: 'decisão',           pose: 'sentado',   texto: 'Não decidir é decidir. Deixar tudo na poupança é uma escolha — uma escolha *cara*, em país com inflação acima do rendimento.' },
    { tema: 'cenário',           pose: 'curioso',   texto: 'Antes de mudar a carteira, mudaram os fundamentos? Se a resposta é não, está reagindo a manchete, não a fato.' },
    { tema: 'tempo',             pose: 'sentado',   texto: 'Horizonte de investimento curto + ativo de longo prazo = receita pra arrependimento. Combine prazos antes de combinar retornos.' },
    { tema: 'manada',            pose: 'curioso',   texto: 'O melhor momento pra comprar é quando há sangue nas ruas. Frase chocante — mas estatisticamente, os melhores anos de retorno vieram depois de crises.' },
    { tema: 'âncora',            pose: 'curioso',   texto: 'Ancoragem: você acha que ação caiu porque chegou em "R$ 20 que custava R$ 30". Mas o valor justo dela talvez seja R$ 15. Preço passado não é referência.' },
    { tema: 'risco-real',        pose: 'sentado',   texto: 'O risco mais subestimado é o de NÃO ter risco nenhum. Rendimento abaixo da inflação não é "seguro" — é perda garantida.' },
    { tema: 'oportunidade',      pose: 'feliz',     texto: 'Em crises, ativos bons descem com os ruins. Quem tem reserva entra na hora certa. Reserva = liberdade estratégica.' },
    { tema: 'liquidez',          pose: 'curioso',   texto: 'Liquidez é a habilidade de transformar ativo em dinheiro rapidamente sem perda. Imóvel: baixa. CDB liquidez diária: alta. Misture na proporção do seu plano.' },
    { tema: 'fundamentos',       pose: 'sentado',   texto: 'Empresa boa em país ruim ainda pode ser boa. Empresa ruim em país bom continua ruim. Fundamento empresarial > narrativa macro.' },
    { tema: 'tempo-mercado',     pose: 'curioso',   texto: 'Tempo NO mercado vence tempo PARA o mercado. Quem fica de fora esperando "o momento certo" perde os 10 melhores dias — e esses fazem 80% do retorno.' },
    { tema: 'narrativa',         pose: 'espantado', texto: 'Manchete chamativa = movimento já aconteceu. "A IA vai mudar tudo!" quando a notícia explode, a oportunidade já passou pra quem chegou antes.' },
    { tema: 'expectativa',       pose: 'sentado',   texto: 'Mercado precifica EXPECTATIVA, não fato. Empresa anunciou lucro recorde, ação caiu? Porque o mercado esperava lucro AINDA maior.' },
    { tema: 'concentração',      pose: 'espantado', texto: 'Concentrar mais de 20% da carteira em um único ativo é assumir risco específico extremo. Mesmo Apple ou Petrobras: nunca passe disso.' },
    { tema: 'ciclo',             pose: 'curioso',   texto: 'Mercado tem ciclos: euforia → ganância → medo → desespero → esperança → otimismo → euforia (de novo). Quem reconhece onde está, age contra a multidão.' },
    { tema: 'taxa-juros',        pose: 'curioso',   texto: 'Taxa de juros alta = renda fixa atrativa. Taxa baixa = bolsa atrativa. Inverteu? Realoque. Reagir tarde demais é tão ruim quanto não reagir.' },
    { tema: 'consenso',          pose: 'sentado',   texto: 'O consenso de mercado tem 30% de chance de estar certo no curto prazo, 70% no longo. Quem aposta contra o consenso precisa ter razão MUITO boa.' },
    { tema: 'volatilidade',      pose: 'sentado',   texto: 'Volatilidade é normal. Quem não suporta queda de 30% no curto prazo não deveria estar em bolsa. Conheça seus limites ANTES de descobrir na crise.' },
    { tema: 'previsão',          pose: 'curioso',   texto: '"O mercado vai cair em 2025!" — alguém previu certo entre milhares que previram errado. Estatística, não talento. Não pague por previsões.' },
    { tema: 'cusps',             pose: 'sentado',   texto: 'Comprar na alta e vender na baixa: o erro mais comum. Causa: emoção. Antídoto: regras escritas antes da decisão.' },
    { tema: 'cenário',           pose: 'curioso',   texto: 'Em qualquer decisão financeira: pergunte "e se eu estiver errado?". Se a resposta for catastrófica, não faça. Sobrevivência > otimização.' },
    { tema: 'imposto',           pose: 'curioso',   texto: 'Imposto é parte do retorno real. Estratégia tributária burra cancela rendimento bom. Avalie SEMPRE o líquido após impostos.' },
    { tema: 'foco',              pose: 'sentado',   texto: 'Não há "melhor investimento" — há melhor pra você, neste prazo, com seu perfil. Cuidado com listas de "as 10 melhores ações" — não te conhecem.' },
    { tema: 'medo',              pose: 'espantado', texto: 'Medo no mercado vem em ondas. A pior delas: 2008, queda de 50% global. Quem manteve recuperou em 4 anos. Quem vendeu, perdeu duas vezes.' },
    { tema: 'narrativa',         pose: 'sentado',   texto: 'Cuidado com "vai a 1 milhão!" — narrativa sem fundamento é especulação travestida de previsão. Pesquise os números, não os memes.' },
    { tema: 'expectativa',       pose: 'curioso',   texto: 'Retorno passado não garante futuro — frase chata, regra obrigatória. Fundo que rendeu 30% no ano passado não vai render 30% este ano.' },
    { tema: 'mercado',           pose: 'sentado',   texto: 'Mercado é leitura, não palpite. Quem age sem entender o que comprou, vende no susto. Conheça o ativo antes do preço.' },
    { tema: 'rebalanceamento',   pose: 'curioso',   texto: 'Rebalanceamento anual = vender o que subiu, comprar o que caiu. Soa contra-intuitivo? É exatamente isso que funciona estatisticamente.' },
    { tema: 'taxa',              pose: 'espantado', texto: 'Taxa de admin 2% em fundo "ativo": em 30 anos engole metade do retorno. Fundo passivo (ETF) com 0.3% rende o dobro líquido. Compare antes de assinar.' },
    { tema: 'autoengano',        pose: 'curioso',   texto: 'Investidor médio se lembra mais dos ganhos que das perdas. Por isso a memória diz que ele ganha. Os extratos contam outra história.' },
    { tema: 'crise',             pose: 'sentado',   texto: 'Crise é teste de carteira: ativos bons sobrevivem, ruins quebram. Você descobre qual era qual SÓ depois da crise. Diversifique pra resistir ao desconhecido.' },
    { tema: 'tempo',             pose: 'sentado',   texto: 'Quanto mais longo o prazo, mais a renda variável vence a renda fixa. 1 ano: incerto. 10 anos: provável. 30 anos: histórico esmagador.' },
    { tema: 'liquidez',          pose: 'curioso',   texto: 'Quem precisa do dinheiro em 12 meses, não bota em bolsa. Não é falta de coragem — é prazo errado pra ativo errado.' },
    { tema: 'consenso',          pose: 'curioso',   texto: 'Quando todo analista diz "compre", já está caro. Quando dizem "venda", pode estar barato. Não vire contrarian por padrão — pense.' },
    { tema: 'estratégia',        pose: 'sentado',   texto: 'Estratégia não é só sobre maximizar retorno. É sobre não ser forçado a vender em mau momento. Sobrevivência é prioridade.' },
    { tema: 'previdência',       pose: 'sentado',   texto: 'Previdência privada não é unanimidade — TAC alta, IR diferido. Calcule. Em alguns casos, ETF + planejamento sucessório separado rende mais.' },
    { tema: 'fomo',              pose: 'espantado', texto: 'Investimento "que tá bombando"? Já não é oportunidade — é etapa final da euforia. Quem entra agora geralmente é o último a vender.' },
    { tema: 'risco-retorno',     pose: 'sentado',   texto: 'Retorno alto exige risco alto. Anúncio prometendo "ganho garantido de X%" é fraude ou ignorância. Mercado não dá almoço grátis.' },
    { tema: 'cenário',           pose: 'curioso',   texto: 'Cenário macro muda lentamente. Quem ajusta carteira mensalmente está reagindo a ruído. Trimestral ou semestral é suficiente.' },
    { tema: 'cripto',            pose: 'curioso',   texto: 'Criptoativos podem caber na carteira — máximo 5%. Acima disso, deixa de ser estratégia, vira aposta. Conheça os limites antes de entrar.' },
    { tema: 'inflação',          pose: 'sentado',   texto: 'Inflação corrói a renda fixa pré-fixada. IPCA+ protege. Em cenário inflacionário, parte da renda fixa precisa ser indexada — ou você perde poder de compra.' },
    { tema: 'global',            pose: 'curioso',   texto: 'Diversificação geográfica reduz risco de país. Investir 20-30% no exterior protege contra crises locais. Brasil ≠ mundo.' },
    { tema: 'taxa-real',         pose: 'sentado',   texto: 'Taxa real = taxa nominal − inflação. Selic 12%, inflação 5%: real 7%. Quando real é negativa, dinheiro parado perde poder de compra.' },
    { tema: 'momento',           pose: 'curioso',   texto: '"Não é momento de investir" disse alguém, todo ano, nos últimos 50 anos. Quem nunca achou momento, nunca investiu. Comece quando puder.' },
    { tema: 'manada',            pose: 'sentado',   texto: 'Quando táxi dá dica de bolsa, a euforia está perto do pico. Quando ninguém quer ouvir falar de investimento, está perto do fundo.' },
    { tema: 'estratégia',        pose: 'feliz',     texto: 'A melhor estratégia é a que você consegue executar com calma por 20 anos. Sofisticada demais, você abandona. Simples e consistente vence.' },
  ],
}

// ──────────────────────────────────────────────────────────────────────────
// Lições — texto longo (3-5 frases), usado em telas educacionais
// ──────────────────────────────────────────────────────────────────────────

export interface Licao {
  titulo:  string
  autor:   MascoteNome
  pose:    MascotePose
  corpo:   string
}

export const LICOES: Licao[] = [
  {
    titulo: 'A regra dos 72 — o feitiço que dobra dinheiro',
    autor:  'gato',
    pose:   'feliz',
    corpo:  'Divida 72 pela taxa anual: o resultado é o número de anos para o dinheiro dobrar. ' +
            'A 6% ao ano: 12 anos. A 12%: 6 anos. A 18%: 4 anos. ' +
            'Funciona por causa dos juros compostos — cada ano o "feitiço" se aplica sobre um total maior. ' +
            'É a única "fórmula mágica" da economia que vale o nome.',
  },
  {
    titulo: 'Reserva de emergência: a base de tudo',
    autor:  'arquiteta',
    pose:   'curioso',
    corpo:  'Antes de qualquer investimento, calcule seus gastos mensais essenciais — moradia, comida, transporte, saúde, dívidas. ' +
            'Multiplique por 6 (autônomo: por 12). Esse é o tamanho da sua reserva. ' +
            'Guarde em produto líquido e seguro (Tesouro Selic, CDB com liquidez diária). ' +
            'Sem essa base, qualquer plano de longo prazo desaba na primeira crise pessoal.',
  },
  {
    titulo: 'O tempo é seu maior ativo',
    autor:  'sabio',
    pose:   'sentado',
    corpo:  'O dinheiro investido cedo trabalha por mais tempo. ' +
            'Investidor A: R$ 200/mês dos 25 aos 35, depois nada. Investidor B: R$ 200/mês dos 35 aos 65. ' +
            'A 8% ao ano, aos 65 o A tem mais dinheiro que o B — mesmo tendo aportado 1/3. ' +
            'A diferença? Dez anos a mais de juros sobre juros. ' +
            'Comece quando puder. O começo é o tijolo mais importante.',
  },
  {
    titulo: 'FOMO — o vilão silencioso',
    autor:  'raposa',
    pose:   'curioso',
    corpo:  'FOMO (Fear Of Missing Out) é o medo de ficar de fora. ' +
            'Quando você vê amigos ganhando em ações que dobraram, sente vontade de entrar. ' +
            'Mas a ação que dobrou já não é o investimento que era — agora é o dobro do preço. ' +
            'Estratégia ruim: comprar o que subiu porque subiu. Estratégia boa: decidir antes do hype se aquele ativo cabe no seu plano.',
  },
  {
    titulo: 'Categorize ou se perca',
    autor:  'arquiteta',
    pose:   'sentado',
    corpo:  'Não dá pra cortar o que você não consegue ver. ' +
            'Lance toda despesa numa categoria específica: "Mercado", "Restaurante", "Transporte", "Assinaturas". ' +
            'Evite "Outros" — qualquer coisa que cai aí é cinza no seu mapa. ' +
            'Depois de 3 meses, padrões aparecem: você gasta o quê, com quem, em qual época do mês.',
  },
  {
    titulo: 'Pequeno e constante > grande e raro',
    autor:  'gato',
    pose:   'feliz',
    corpo:  'Aportar R$ 100 todo mês durante 10 anos rende mais que aportar R$ 12.000 de uma vez no fim. ' +
            'Por quê? Cada aporte mensal tem mais tempo no mercado. ' +
            'O ritmo importa mais que o volume. ' +
            '"Quanto mais cedo, mais mágico" é literalmente verdade.',
  },
  {
    titulo: 'Diversificação: a matemática a seu favor',
    autor:  'raposa',
    pose:   'sentado',
    corpo:  'Um único ativo carrega dois riscos: o de mercado (todo mundo cai junto) e o específico (só aquele ativo cai). ' +
            'Diversificação elimina o segundo risco sem custo — você reduz a volatilidade da carteira sem reduzir o retorno esperado. ' +
            'É raro o mercado oferecer "almoço grátis". Esse é um deles.',
  },
  {
    titulo: 'Não-decidir é decidir',
    autor:  'sabio',
    pose:   'curioso',
    corpo:  'Deixar o dinheiro na poupança parece a opção "segura" — mas se a inflação está em 5% e a poupança rende 6%, você ganha 1% real. ' +
            'Quando rende 4% e inflação está em 5%, você está perdendo 1% por ano, em silêncio. ' +
            'Toda inação é uma decisão — só que com custo invisível.',
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Falas contextuais — usadas pelas MascoteDicas em telas dinâmicas.
// Cada função recebe o contexto e devolve { pose, texto } adaptado.
// ──────────────────────────────────────────────────────────────────────────

export interface FalaContextual {
  pose:  MascotePose
  texto: string
}

/**
 * Dica para o Dashboard com base no resultado do mês.
 * O mascote que falará é decidido externamente (preferência do usuário).
 */
export function falaResultadoMes(opts: {
  receitas: number
  despesas: number
  mascote:  MascoteNome
}): FalaContextual {
  const { receitas, despesas, mascote } = opts
  const resultado = receitas - despesas
  const pctGasto  = receitas > 0 ? (despesas / receitas) * 100 : 0

  if (receitas === 0 && despesas === 0) {
    const texto: Record<MascoteNome, string> = {
      sabio:     'Nenhum movimento neste mês ainda. A jornada começa com o primeiro lançamento.',
      arquiteta: 'Sem dados ainda — comece lançando suas transações. Em 30 dias, o padrão aparece.',
      gato:      'Hmm, planilha em branco. Cadê seus dados pra eu fazer mágica?',
      raposa:    'Nada lançado ainda. Sem informação, não há estratégia.',
    }
    return { pose: 'curioso', texto: texto[mascote] }
  }

  if (resultado > 0) {
    const texto: Record<MascoteNome, string> = {
      sabio:     `Resultado positivo. Comprometeu ${pctGasto.toFixed(0)}% das receitas — boa margem. O capital trabalha a seu favor.`,
      arquiteta: `${pctGasto.toFixed(0)}% das receitas usadas. Sobra ${(100 - pctGasto).toFixed(0)}% — direcione antes que se dilua em "Outros".`,
      gato:      `Sobrou dinheiro! Esse é o momento da mágica começar — bote pra render e veja o feitiço acontecer.`,
      raposa:    `Saldo positivo. A pergunta não é "guardar ou gastar" — é "onde alocar pra render mais que a poupança".`,
    }
    return { pose: 'feliz', texto: texto[mascote] }
  }

  if (resultado < 0) {
    const texto: Record<MascoteNome, string> = {
      sabio:     'Despesas superaram receitas neste mês. Avalie reduções pontuais antes que vire padrão.',
      arquiteta: `Estouro de ${Math.abs(resultado / receitas * 100).toFixed(0)}% sobre a receita. Vamos identificar a categoria que vazou.`,
      gato:      'Atenção: a magia foi pro lado errado este mês. Os juros funcionam dos dois lados — pra cima e pra baixo.',
      raposa:    'Despesas > receitas. Antes de cortar tudo, identifique a causa — gastos extras pontuais são diferentes de padrão estrutural.',
    }
    return { pose: 'espantado', texto: texto[mascote] }
  }

  // Empate exato
  const texto: Record<MascoteNome, string> = {
    sabio:     'Receitas e despesas se equilibraram. Próximo passo: criar margem para investimento.',
    arquiteta: 'Resultado zero. Sem sobra, sem rombo — mas também sem reserva. Vamos buscar 10% de margem.',
    gato:      'Empate técnico! Cabe um truque pra criar sobra — começa cortando 5% dos variáveis.',
    raposa:    'Equilíbrio é melhor que déficit, mas pior que superávit. Sem margem, qualquer imprevisto vira problema.',
  }
  return { pose: 'sentado', texto: texto[mascote] }
}

/**
 * Dica para a tela de Comparativo (insights entre dois períodos).
 */
export function falaComparativoPeriodos(opts: {
  temAlerta:    boolean
  temPositivo:  boolean
  mascote:      MascoteNome
}): FalaContextual {
  const { temAlerta, temPositivo, mascote } = opts
  if (temAlerta) {
    const texto: Record<MascoteNome, string> = {
      sabio:     'Detectei mudanças relevantes no período. Os alertas em vermelho merecem atenção — clique para ver as categorias responsáveis.',
      arquiteta: 'Variações fora do padrão. Os alertas vermelhos mostram onde o orçamento desviou — vamos diagnosticar.',
      gato:      'Pchsst — algo mudou bastante. Os alertas em vermelho contam onde a mágica fugiu do controle.',
      raposa:    'Detectei pontos de atenção no período final. Veja os alertas em vermelho — clique para destacar as categorias responsáveis.',
    }
    return { pose: 'espantado', texto: texto[mascote] }
  }
  if (temPositivo) {
    const texto: Record<MascoteNome, string> = {
      sabio:     'Boa leitura do período: tendências positivas dominam. A consistência é o que mais importa.',
      arquiteta: 'Os números melhoraram. Os insights verdes mostram o que está funcionando — vale entender o porquê pra manter.',
      gato:      'A mágica está funcionando! Os números verdes mostram onde os juros estão a seu favor.',
      raposa:    'Boa leitura: tendências positivas dominam. Os insights destacam o que está funcionando — mantenha o ritmo.',
    }
    return { pose: 'feliz', texto: texto[mascote] }
  }
  const texto: Record<MascoteNome, string> = {
    sabio:     'O período está estável. Estabilidade é base — agora dá pra pensar em crescer.',
    arquiteta: 'Sem variações fortes — base estável. Bom momento pra projetar próximos passos.',
    gato:      'Tudo calmo no reino. Hora ideal pra começar um feitiço novo.',
    raposa:    'Cenário estável. Observe variações pequenas — às vezes contam mais que as grandes.',
  }
  return { pose: 'curioso', texto: texto[mascote] }
}

/**
 * Seleciona uma dica aleatória de tema específico para o mascote.
 * Se o tema não tiver dica, devolve qualquer dica do mascote.
 */
export function escolherDica(mascote: MascoteNome, tema?: string): Dica {
  const pool = DICAS[mascote]
  if (tema) {
    const filtradas = pool.filter(d => d.tema === tema)
    if (filtradas.length > 0) return filtradas[Math.floor(Math.random() * filtradas.length)]
  }
  return pool[Math.floor(Math.random() * pool.length)]
}

/**
 * Pega uma assinatura aleatória do mascote — usado em momentos
 * decorativos (carregamento, transições).
 */
export function frase(mascote: MascoteNome): string {
  const pool = ASSINATURAS[mascote]
  return pool[Math.floor(Math.random() * pool.length)]
}

// ──────────────────────────────────────────────────────────────────────────
// Tutorial — texto explicativo por página, em 4 vozes diferentes
// (Sábio / Arquiteta / Mago Gato / Raposa). Aparece como dica
// compacta no topo da página enquanto o usuário está aprendendo.
// ──────────────────────────────────────────────────────────────────────────

/** Páginas com tutorial disponível. */
export type PaginaTutorial =
  | 'dashboard'
  | 'lancamentos'
  | 'contas'
  | 'categorias'
  | 'relatorios'
  | 'comparativo'
  | 'assinaturas'
  | 'projecao'
  | 'importexport'

const TUTORIAIS: Record<PaginaTutorial, Record<MascoteNome, string>> = {
  dashboard: {
    sabio:     'Bem-vindo ao seu painel. Aqui se vê o todo: receitas, despesas e o saldo do mês. Olhar todo dia transforma em hábito — e hábito vira riqueza.',
    arquiteta: 'Esta é a planta-baixa das suas finanças. Receitas, despesas, saldo e calendário do mês — tudo em uma página. Lance suas transações e os números falam por si.',
    gato:      'O painel mágico! Aqui você vê o feitiço acontecer mês a mês. Quanto entrou, quanto saiu, e quanto sobrou pra investir. Pchsst — quanto mais tempo, mais bonito fica.',
    raposa:    'Visão estratégica do mês. O painel mostra padrão; padrão revela tendência; tendência guia decisão. Comece pelos cards de cima — o resto é detalhe.',
  },
  lancamentos: {
    sabio:     'Aqui é o caderno de toda movimentação. Lance todo gasto e toda receita, sem julgamento. A verdade nos números vem antes da disciplina.',
    arquiteta: 'Sua planilha-base. Botão "Novo lançamento" cria entradas e saídas. Filtros no topo refinam o que você vê. Cada lançamento precisa de uma categoria — sem isso, não há análise.',
    gato:      'Caderninho mágico de feitiços financeiros! Cada lançamento é um ingrediente da poção. Mais ingredientes = poção mais precisa. Use a calculadora ao adicionar valor, fica mais rápido.',
    raposa:    'O extrato. Toda decisão financeira deixa rastro aqui. Filtre por mês, conta ou status pra ver só o que importa agora — clareza vem antes da estratégia.',
  },
  contas: {
    sabio:     'Suas contas são as raízes da árvore — banco, carteira, investimento, cartão. Cada uma com seu propósito. Cadastre todas pra ter o quadro completo.',
    arquiteta: 'Aqui você modela a estrutura: conta corrente, cartão de crédito, investimento, carteira. Cartão precisa do dia de fechamento e pagamento. Conta inativa não some — fica arquivada.',
    gato:      'Os baús mágicos onde mora seu ouro! Cada conta é um baú diferente. O baú "Investimento" é o favorito — é nele que a magia dos juros acontece.',
    raposa:    'Pontos de origem do seu fluxo. Diversificar contas (não confundir com diversificar investimentos) reduz risco operacional. Não concentre tudo num só banco.',
  },
  categorias: {
    sabio:     'Categorias dão sentido ao gasto. "Mercado" é diferente de "restaurante", "lazer" é diferente de "saúde". Separar é o primeiro passo pra entender.',
    arquiteta: 'A taxonomia das suas despesas. Crie categorias-pai amplas (Alimentação, Moradia) e filhas específicas (Supermercado, Restaurante). Quanto mais granular, melhor a análise. A categoria "Transferências" é protegida — não mexa nela.',
    gato:      'Os feitiços de organização! Cada categoria é um livro de magia. "Salário" vai pra um, "Café" vai pra outro. Quanto mais arrumado, mais fácil enxergar onde o ouro escorre.',
    raposa:    'Estrutura semântica do seu dinheiro. Categorização ruim = análise ruim. Reveja a cada 3 meses: qualquer categoria "Outros" acima de 5% pede subdivisão.',
  },
  relatorios: {
    sabio:     'Aqui o passado conversa com você. Escolha o período, gere o relatório, e leia o que os números têm a dizer. Padrão é mais importante que mês isolado.',
    arquiteta: 'Análise consolidada por categoria/conta/mês. Escolha período, gere o relatório, exporte se quiser levar pra fora. A aba Pareto mostra quem responde por 80% — é onde mora a alavanca.',
    gato:      'A bola de cristal dos relatórios! Olha o passado pra revelar o feitiço — onde o dinheiro foi, em quais categorias o ouro evaporou. Use a aba Pareto pra ver onde está a maior parte da mágica.',
    raposa:    'O painel de leitura. Dados sem contexto são ruído — período + comparativo + Pareto entregam o sinal. Foque nas categorias que respondem pela maior fatia: a alavanca está lá.',
  },
  comparativo: {
    sabio:     'Comparar dois períodos revela tendência. Use com período de mesmo tamanho — ano vs. ano, trimestre vs. trimestre — pra a comparação ser justa.',
    arquiteta: 'A análise comparativa: período A vs. período B. Os dois precisam ter o mesmo número de dias (já ajusto automaticamente). A coluna "Diferença" mostra onde a mudança aconteceu — clique numa categoria pra investigar.',
    gato:      'O cofre comparador! Vê dois momentos do tempo lado a lado. "Era assim antes — virou isso agora." A mágica está nas variações: subiu? caiu? por quê? Pchsst — vamos descobrir!',
    raposa:    'Comparar é a base de toda análise estratégica. A pergunta certa: o que mudou — e por quê? Mudanças estruturais (aumento de fixos) merecem atenção diferente de mudanças pontuais (uma viagem).',
  },
  assinaturas: {
    sabio:     'Recorrências silenciosas são as mais perigosas — você nem nota R$ 30 mensais até virarem R$ 360 no ano. Aqui o sistema as detecta automaticamente.',
    arquiteta: 'O sistema agrupa lançamentos por padrão temporal (mesma descrição, mesma categoria, intervalos regulares) e classifica como recorrência. Use o filtro pra ver "Inativas" — pode haver assinatura zumbi cobrando ainda.',
    gato:      'Os feitiços silenciosos! Cada assinatura é um feitiço de cobrança contínua. Alguns valem — Netflix, internet. Outros, você esqueceu que existem. Pchsst — vamos identificar quais reativar e quais soltar.',
    raposa:    'Recorrências representam comprometimento de fluxo futuro. Cada assinatura é uma decisão repetida — vale revisitar se ainda compensa. Aumento de preço silencioso (reajuste) é o sinal mais comum de "ficar atento".',
  },
  projecao: {
    sabio:     'Aqui se projeta o amanhã. Os números são estimativa, não promessa — mas mostram a direção que você está tomando. Ajuste taxa e horizonte pra simular cenários.',
    arquiteta: 'Modelo de projeção: pega sua média de economia mensal e simula crescimento com juros compostos. Ajuste a taxa anual e o horizonte (anos). Cenário "otimista" supõe que você corta X% das despesas variáveis.',
    gato:      'A varinha do futuro! Mexe na taxa (% ao mês) e no tempo (anos), e veja o ouro multiplicar. O cenário "otimista" mostra a mágica que aconteceria se você cortasse uns gastos. *Voilà!*',
    raposa:    'Simulação de cenários futuros. Lembre: projeção é hipótese, não previsão. Compare cenário base com otimista — a distância entre eles é o valor da sua ação. Decisões hoje compõem amanhã.',
  },
  importexport: {
    sabio:     'Aqui se trazem dados de fora — extratos do banco, planilhas. Importar acelera, mas confira se as categorias casam com o que você tem. Cuide do que entra.',
    arquiteta: 'Importação de XLSX e backup completo. No XLSX, mapeie colunas → campos (data, descrição, valor, categoria, conta). Backup gera arquivo único com TODOS os dados — guarde com vida.',
    gato:      'Portal mágico de dados! Traz lançamentos de fora num só feitiço de importação. Backup é o seu pergaminho de proteção — guarde antes de qualquer experimento ousado.',
    raposa:    'Pontos de entrada e saída de dados. Importar de extrato bancário acelera muito o histórico. Sempre revise as primeiras 20 linhas — categoria mal mapeada se propaga.',
  },
}

/**
 * Devolve o texto do tutorial para uma página específica, na voz do
 * mascote escolhido. Pose padrão é `curioso` (modo "explicador").
 */
export function falaTutorial(pagina: PaginaTutorial, mascote: MascoteNome): FalaContextual {
  return {
    pose:  'curioso',
    texto: TUTORIAIS[pagina][mascote],
  }
}
