# 🚀 Roadmap Técnico — Módulo de Investimentos

> Especificação completa do módulo de investimentos, com foco em dados, APIs, frontend e integração com o extrato.

---

## 1. Escopo do módulo

### Tipos de ativo suportados
- `ACOES`
- `ETF`
- `FII`
- `STOCKS`
- `ETF_INTERNACIONAL`
- `RENDA_FIXA`
- `CRIPTOMOEDAS`
- `TESOURO_DIRETO`

### Principais funcionalidades
- cartela de ativos por tipo
- posição atual e histórico mensal
- gráficos analíticos de rendimento
- ranking de ativos em alta e em prejuízo
- dividendos integrados ao extrato como transações
- vínculo obrigatório a `conta_id`

---

## 2. Modelo de dados

### Tabela principal: `investimentos.ativos`
- `id` UUID
- `user_id` UUID
- `ticker` TEXT
- `nome` TEXT
- `tipo_ativo` TEXT (`ACOES`, `ETF`, `FII`, `STOCKS`, `ETF_INTERNACIONAL`, `RENDA_FIXA`, `CRIPTOMOEDAS`, `TESOURO_DIRETO`)
- `moeda` TEXT
- `descricao` TEXT
- `nota_usuario` NUMERIC NULLABLE  -- nota pessoal do ativo
- `ativo_pai` UUID opcional
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP

### Tabela de alocações por tipo: `investimentos.alocacoes_tipo`
- `id` UUID
- `user_id` UUID
- `tipo_ativo` TEXT
- `percentual_ideal` NUMERIC  -- valor definido pelo usuário
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP

> Regra de negócio: para cada usuário, a soma de `percentual_ideal` de todos os tipos de ativo deve ser 100%.

### Tabela de posições: `investimentos.posicoes`
- `id` UUID
- `user_id` UUID
- `ativo_id` UUID
- `conta_id` UUID
- `quantidade` NUMERIC
- `preco_custo` NUMERIC
- `valor_custo` NUMERIC
- `data_compra` DATE
- `status` TEXT (`ATIVA`, `ENCERRADA`)
- `created_at` TIMESTAMP
- `updated_at` TIMESTAMP

### Tabela de operações: `investimentos.operacoes`
- `id` UUID
- `user_id` UUID
- `posicao_id` UUID
- `tipo_operacao` TEXT (`COMPRA`, `VENDA`, `APORTE`, `RESGATE`, `DIVIDENDO`)
- `conta_id` UUID
- `quantidade` NUMERIC
- `preco_unitario` NUMERIC
- `valor_total` NUMERIC
- `data_operacao` DATE
- `created_at` TIMESTAMP

### Tabela de dividendos: `investimentos.dividendos`
- `id` UUID
- `user_id` UUID
- `ativo_id` UUID
- `conta_id` UUID
- `valor` NUMERIC
- `data_pagamento` DATE
- `tipo_ativo` TEXT
- `descricao` TEXT
- `transacao_extrato_id` UUID opcional
- `created_at` TIMESTAMP

### Histórico mensal de valor: `investimentos.historico_mensal`
- `id` UUID
- `user_id` UUID
- `ativo_id` UUID
- `conta_id` UUID
- `mes_ano` TEXT (`YYYY-MM`)
- `valor_mercado` NUMERIC
- `quantidade` NUMERIC
- `preco_medio` NUMERIC
- `variacao_percentual` NUMERIC
- `rentabilidade_mes` NUMERIC
- `created_at` TIMESTAMP

---

## 3. Back-end / Edge Functions

### Endpoints principais
- `GET /investimentos/ativos`
- `GET /investimentos/ativos/:id`
- `POST /investimentos/ativos`
- `PUT /investimentos/ativos/:id`
- `DELETE /investimentos/ativos/:id`

- `GET /investimentos/posicoes`
- `POST /investimentos/posicoes`
- `PUT /investimentos/posicoes/:id`
- `DELETE /investimentos/posicoes/:id`

- `GET /investimentos/operacoes`
- `POST /investimentos/operacoes`

- `GET /investimentos/dividendos`
- `POST /investimentos/dividendos`

- `GET /investimentos/dashboard`
- `GET /investimentos/ranking`
- `GET /investimentos/historico-mensal`

### Comportamento crítico
- validar `user_id = auth.uid()` em todas as queries
- `conta_id` é obrigatório em posições e dividendos
- `tipo_ativo` deve ser usado em filtros e agregações
- `POST /investimentos/dividendos` cria ou atualiza `transacoes` do extrato
- operações de `DIVIDENDO` devem anexar `transacao_extrato_id`

---

## 4. Regras de negócio

### Contas vinculadas
- toda posição precisa estar vinculada a uma conta do usuário
- dividendos precisam indicar `conta_id` de destino
- o extrato deve exibir dividendos da conta correta

### Dashboard por tipo
- o dashboard deve mostrar valores consolidados por tipo
- cada tipo precisa ter:
  - valor de mercado
  - variação mensal
  - rentabilidade acumulada
  - alocação ideal x alocação atual
  - diferença percentual para a meta
- o filtro deve permitir ver somente um tipo ou a composição completa

### Alocação ideal por tipo
- o usuário define um `percentual_ideal` para cada `tipo_ativo`
- a soma de todos os `percentual_ideal` deve ser 100%
- o sistema deve exibir alertas quando o peso atual da carteira divergir da meta
- a recomendação de compra deve considerar:
  - a nota do usuário para o ativo
  - o percentual atual da carteira para o tipo de ativo
  - o desvio em relação ao `percentual_ideal`

### Questionário padrão por tipo de ativo
- cada `tipo_ativo` deve ter um questionário específico de avaliação
- o resultado do questionário gera um score que alimenta `nota_usuario`
- as notas devem ser derivadas das respostas, não apenas digitadas livremente
- o questionário pode incluir perguntas como:
  - horizonte de investimento
  - tolerância a risco
  - expectativa de retorno
  - liquidez desejada
  - sensibilidade a volatilidade
- cada tipo de ativo pode ter perguntas adicionais relevantes:
  - `STOCKS`: qualidade de gestão, potencial de crescimento
  - `ETF_INTERNACIONAL`: diversificação geográfica, exposição cambial
  - `RENDA_FIXA`: prazo, indexador e risco de crédito
  - `CRIPTOMOEDAS`: adoção, utilidade e volatilidade
  - `TESOURO_DIRETO`: vencimento, índice e segurança
- o score final deve ser apresentado como nota do ativo e usado nas recomendações de compra

### Classificação de performance
- melhores ativos em alta
- ativos em prejuízo
- ativos com maior dividend yield
- ativos com maior participação na carteira

### Atualização mensal
- histórico mensal deve ser calculado por `mes_ano`
- deve suportar base de preço manual ou importada
- para cada ativo, o cálculo deve considerar quantidade e preço médio

---

## 5. Frontend

### Páginas e telas
- `InvestimentosPage`
  - visão consolidada por tipo
  - cards com métricas principais
  - painel de alocação ideal vs atual
- `AtivosPage`
  - lista de ativos com filtro por tipo
  - colunas: ticker, nome, tipo, conta, valor de mercado, variação, ganho/prejuízo
  - coluna de `nota_usuario`
- `DetalheAtivoPage`
  - histórico de preço
  - gráfico de rentabilidade mensal
  - dividendos recebidos
  - operações recentes
  - campo de nota do usuário e recomendação de compra
  - seção de `Questionário de Avaliação` para recalcular a nota
- `ExtratoPage`
  - transações incluindo dividendos
  - filtro `Tipo` com valor `Dividendo`

### Componentes novos
- `CardTipoAtivo`
- `GraficoEvolucaoCarteira`
- `GraficoPerformancePorTipo`
- `GraficoDividendosMensais`
- `BadgeTipoAtivo`
- `TabelaPosicoesInvestimentos`
- `QuestionarioAtivo`
- `CardAlocacaoIdeal`
- `IndicadorRecomendacaoCompra`

### Hooks
- `useInvestimentosAtivos`
- `useInvestimentosPosicoes`
- `useInvestimentosHistorico`
- `useInvestimentosDashboard`
- `useDividendos`
- `useInvestimentosAlocacao`
- `useQuestionarioAtivo`

### UX e visual
- mostrar por tipo na primeira visualização
- destacar ativos em alta e em prejuízo com cores consistentes
- usar gráficos de linha para evolução e barras para composição por tipo
- usar tooltips para explicar dividendos e rendimentos

---

## 6. Integração com o extrato

### Dividendos no extrato
- dividendos devem gerar `transacao` no extrato com categoria `Dividendo`
- usar o `ticker` do ativo como descrição da transação no extrato (ex: `VALE3 - Dividendo`)
- incluir `tipo_ativo` como meta-info (campo adicional) para filtros e relatórios
- permitir filtro de extrato por `Dividendo · STOCKS`, `Dividendo · FII`, etc.
- lançamentos com `data_pagamento` no futuro devem ser criados como transações com status `PROJECAO` (projeção)
- projeções devem ter campo `data_prevista` preenchido (igual a `data_pagamento`) e flag `is_projecao = true`
- quando a data de pagamento chegar e/ou o lançamento for confirmado, a projeção deve ser atualizada para transação efetiva (status `PAGO`/`RECEBIDO`) e permanecer vinculada via `transacao_extrato_id`

### Sincronização de saldo
- as transações de dividendos afetam saldo das contas
- o cálculo de saldo deve seguir o modelo atual do sistema (sem filtrar por status)
- os relatórios devem somar dividendos como `RECEITA`

---

## 7. Testes e validação

### Cobertura mínima
- CRUD de ativos e posições
- cadastro/edição de dividendos
- dashboard por tipo
- ranking de ativos em alta/prejuízo
- extrato com dividendos integrados
- validação de `conta_id`

### Tipos de teste
- API: Jest + ts-jest
- E2E: Playwright

---

## 8. Fases de implementação

1. Planejamento e modelagem
2. Backend inicial e migrations
3. Integração de dividendos ao extrato
4. Frontend básico de ativos e dashboard
5. Gráficos analíticos por tipo
6. Testes e refinamento
