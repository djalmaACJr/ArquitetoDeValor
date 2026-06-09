# 🛠️ Implementação — Módulo de Investimentos

> Guia passo a passo para implementar o módulo, seguindo a arquitetura e padrões do Arquiteto de Valor.

---

## Fase 1 — Fundação do backend

### 1.1 Migration de tabelas

Criar migrations idempotentes em `supabase/migrations/` para:
- `investimentos.ativos`
- `investimentos.posicoes`
- `investimentos.operacoes`
- `investimentos.dividendos`
- `investimentos.historico_mensal`

### 1.2 Políticas RLS

Definir `USING (user_id = auth.uid())` e `WITH CHECK (user_id = auth.uid())` para todas as tabelas.

### 1.3 Edge Functions iniciais

Criar funções em `supabase/functions/investimentos/`:
- `ativos/index.ts`
- `posicoes/index.ts`
- `operacoes/index.ts`
- `dividendos/index.ts`
- `dashboard/index.ts`

### 1.4 Validações críticas

- `conta_id` obrigatório para posições e dividendos
- `tipo_ativo` entre valores permitidos
- operações de investimento apenas no `user_id` correto
- divisão de dividendos para extrato

---

## Fase 2 — API e lógica de negócio

### 2.1 CRUD de ativos

- `POST /investimentos/ativos`
- `GET /investimentos/ativos`
- `PUT /investimentos/ativos/:id`
- `DELETE /investimentos/ativos/:id`

### 2.2 CRUD de posições

- `POST /investimentos/posicoes`
- `GET /investimentos/posicoes`
- `PUT /investimentos/posicoes/:id`
- `DELETE /investimentos/posicoes/:id`

### 2.3 Operações e dividendos

- `POST /investimentos/operacoes`
- `POST /investimentos/dividendos`
- criar transação no extrato para dividendos
- vincular `transacao_extrato_id`

---

## Fase 3 — Frontend básico

### 3.1 Tipos TypeScript

Adicionar tipos em `FrontEnd/src/types/`:
- `InvestimentoAtivo`
- `InvestimentoPosicao`
- `InvestimentoOperacao`
- `InvestimentoDividendo`
- `InvestimentoDashboard`
- `TipoAtivoInvestimento`

### 3.2 Hooks

Criar hooks em `FrontEnd/src/hooks/`:
- `useInvestimentosAtivos`
- `useInvestimentosPosicoes`
- `useInvestimentosHistorico`
- `useInvestimentosDashboard`
- `useDividendos`

### 3.3 Páginas

Criar páginas em `FrontEnd/src/pages/`:
- `InvestimentosPage.tsx`
- `AtivosInvestimentosPage.tsx`
- `DetalheInvestimentoPage.tsx`

---

## Fase 4 — Dashboard e gráficos

### 4.1 Dashboard por tipo de ativo

Implementar cards com:
- valor de mercado
- variação mensal
- rentabilidade acumulada
- participação na carteira

### 4.2 Gráficos detalhados

- linha de evolução mensal da carteira
- barras de composição por tipo
- gráfico de dividendos mensais
- ranking com ativos em alta e em prejuízo

### 4.3 UX de filtro

- abas ou selector por `STOCKS`, `ETF_INTERNACIONAL`, `RENDA_FIXA`, `CRIPTOMOEDAS`, `TESOURO_DIRETO`
- filtro de `todos os ativos`
- filtro de `conta`

---

## Fase 5 — Integração com o extrato

### 5.1 Transações de dividendos

- criar entrada no `extrato` sempre que houver `dividendo`
- usar categoria `Dividendo`
- usar o `ticker` do ativo como descrição/`descricao` da transação no extrato (ex: `VALE3 - Dividendo`)
- incluir metadados: `tipo_ativo`, `investimento_id`, `dividendo_id`
- permitir reconciliação por `transacao_extrato_id`
- se `data_pagamento` > hoje: criar transação com `status = 'PROJECAO'`, `is_projecao = true` e preencher `data_prevista` = `data_pagamento`.
- permitir endpoint/cron que converta projeções para transações efetivas quando o pagamento for confirmado (atualiza `status`, `valor` se necessário e mantém `transacao_extrato_id`).
- quando usuário reconciliar manualmente, atualizar a projeção para refletir o valor real e data de recebimento, mantendo o vínculo com `dividendo_id`.
### 5.2 Ajuste de relatórios

- garantir que dividendos apareçam como receita
- permitir filtro por `Dividendo` no `ExtratoPage`
- integrar com relatórios existentes de saldo e fluxo de caixa

---

## Fase 6 — Testes e refinamento

### 6.1 Testes de API

Criar suíte em `tests/` similar aos módulos existentes:
- `investimentos/01_ativos.test.ts`
- `investimentos/02_posicoes.test.ts`
- `investimentos/03_dividendos.test.ts`
- `investimentos/04_dashboard.test.ts`

### 6.2 Testes E2E

Criar fluxos em `FrontEnd/e2e/tests/`:
- cadastro de ativo e posição
- dashboard por tipo
- inclusão de dividendo e reflexão no extrato
- filtro de conta

### 6.3 Revisão de UI

- verificar consistência com componentes existentes
- manter layout em Tailwind + Radix
- usar ícones e cores já adotados no projeto

---

## Fase 7 — Documentação e entrega

- atualizar `README.md` do projeto com referência ao módulo de investimentos
- incluir links em `projeto_Investimentos/INDICE_INVESTIMENTOS.md`
- preparar demo do dashboard e extrato integrado
