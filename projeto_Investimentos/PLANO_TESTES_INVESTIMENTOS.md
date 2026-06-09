# ✅ Plano de Testes — Módulo de Investimentos

> Cobertura de testes recomendada para validar funcionalidade e integração do módulo.

---

## 1. Objetivo do plano

Garantir que o módulo de investimentos funcione corretamente em todas as camadas:
- backend (API)
- frontend (interface e fluxo)
- integração com o extrato
- segurança e isolamento de usuário

Este documento descreve casos de teste, dados, critérios de aceitação e estratégia de automação para o módulo de investimentos. Cobre fluxos críticos: cadastro de ativos/posições, dividendos (incl. projeções), alocação por tipo, questionário/nota e recomendações de compra.

---

## 2. Escopo de testes

### 2.1 Testes de API (Jest)

- CRUD de ativos
- CRUD de posições
- cadastro de dividendos
- geração de transação no extrato para dividendos
- dashboard por tipo de ativo
- filtro por `tipo_ativo`
- validação de `conta_id` obrigatória
- segurança RLS: usuário A não vê dados de usuário B
 
Cobertura mínima (API):
- endpoints de `ativos`, `posicoes`, `operacoes`, `dividendos`, `dashboard`.
- validação de `investimentos.alocacoes_tipo` (soma 100%).
- criação de `transacao` no `arqvalor.transacoes` usando `ticker` como `descricao`.
- comportamento para `data_pagamento` no futuro (`PROJECAO`).
- cálculo e exposição de `historico_mensal` e agregações por `tipo_ativo`.
- questionário: endpoint que salva respostas e retorna `score` (nota) utilizável em recomendações.

### 2.2 Testes E2E (Playwright)

- fluxo de cadastro de ativo e posição
- ausência de ativo sem conta vinculada
- dashboard mostrando valores por tipo
- inclusão de dividendos e visualização no extrato
- filtro de extrato por `Dividendo`
- navegação entre `InvestimentosPage`, `AtivosPage` e `DetalheAtivoPage`

Fluxos E2E adicionais:
- criar alocações por tipo e validar alertas quando carteira diverge da meta
- preencher questionário de ativo e validar recalculo de nota e recomendação
- criar dividendo futuro e validar que aparece como projeção no extrato
- reconciliar projeção (automaticamente via cron simulada ou manualmente) e validar impacto no saldo

### 2.3 Testes de regressão

- importação de extrato existente
- comportamento com ativo em alta e ativo em prejuízo
- transações de dividendos não duplicadas
- atualização de posição e recalculo do histórico

Regressão adicional:
- alterações em `conta_id` não devem expor dados de outro usuário
- exclusão de ativo com posições deve ser bloqueada

---

## 3. Casos de teste principais

### Caso 1: Cadastro de ativo
- dado usuário autenticado
- quando cadastrar ativo `STOCKS` com conta vinculada
- então o ativo deve ser salvo e listado

### Caso 2: Cadastro de posição vinculada à conta
- dado ativo existente
- quando cadastrar posição com `conta_id`
- então a posição deve aparecer no dashboard e no histórico

### Caso 3: Cadastro de dividendo
- dado ativo e posição existentes
- quando cadastrar dividendo com `tipo_ativo`
- então deve criar `investimentos.dividendos` e `arqvalor.transacoes`

### Caso 3b: Cadastro de dividendo futuro (projeção)
- dado ativo e posição existentes
- quando cadastrar dividendo com `data_pagamento` no futuro
- então deve criar `investimentos.dividendos` e uma `arqvalor.transacoes` com `status = 'PROJECAO'`, `is_projecao = true` e `data_prevista` igual a `data_pagamento`
- quando a data for alcançada e o pagamento confirmado, a projeção deve ser atualizada para transação efetiva e refletir no saldo da conta

### Caso 4: Dashboard por tipo
- dado portfólio com ativos de 3 tipos diferentes
- quando acessar `InvestimentosPage`
- então deve exibir cards de valor e variação por tipo

### Caso 5: Extrato de dividendos
- dado dividendo lançado em conta X
- quando abrir `ExtratoPage`
- então o registro deve aparecer como receita com categoria `Dividendo`

### Caso 6: Validação de Alocação Ideal (regra 100%)
- dado que o usuário definiu alocações por tipo com soma diferente de 100%
- quando tentar salvar essa configuração
- então a API deve rejeitar com erro de validação e a interface deve exibir mensagem clara

### Caso 7: Questionário e nota do ativo
- dado ativo existente
- quando o usuário preencher o `QuestionarioAtivo` para esse ativo
- então o sistema deve calcular um `score` (nota) consistente com o peso das respostas e persistir em `investimentos.ativos.nota_usuario`
- a `DetalheAtivoPage` deve exibir a nota e atualizar `IndicadorRecomendacaoCompra`

### Caso 8: Dividendo futuro (projeção) e reconciliação
- dado ativo e posição existentes
- quando cadastrar dividendo com `data_pagamento` no futuro
- então criar `investimentos.dividendos` e `arqvalor.transacoes` com `status = 'PROJECAO'`, `is_projecao = true`, `data_prevista = data_pagamento`
- quando a data chegar e pagamento confirmado (ou usuário reconciliar manualmente), então atualizar para `status = 'PAGO'` e aplicar saldo na `conta_id` correspondente

---

## 4. Critérios de aceitação

- `tipo_ativo` aparece em todas as consultas agrupadas
- nenhum ativo pode existir sem `conta_id` na posição
- dividendos sempre geram transação de extrato associada
- dashboard inicial mostra `STOCKS`, `ETF_INTERNACIONAL`, `RENDA_FIXA`, `CRIPTOMOEDAS`, `TESOURO_DIRETO`
- a interface mantém padrões visuais do projeto (Tailwind, Radix, ícones)

Critérios adicionais:
- validação de soma de `percentual_ideal` = 100% implementada
- projeções aparecem no extrato com sinalização visual (badge `PROJECAO`) e não impactam saldo até confirmação
- recomendações de compra mudam conforme nota do ativo e desvio de alocação

---

## 5. Ferramentas e locais de teste

- API: `tests/` com Jest + ts-jest
- E2E: `FrontEnd/e2e/tests/` com Playwright
- documentação de testes em `projeto_Investimentos/PLANO_TESTES_INVESTIMENTOS.md`

Comandos úteis:
```bash
# Rodar testes de API (na raiz)
npx jest --runInBand

# Rodar E2E (FrontEnd)
cd FrontEnd
npm run test:e2e
```

---

## 6. Observações

A cobertura de testes deve incluir tanto os casos positivos quanto os negativos, principalmente para validação de segurança e integridade de dados. O valor agregado do módulo depende da correção da integração entre investimentos e o extrato financeiro.

## 7. Estratégia de automação e priorização

- Prioridade 1 (must): CRUD `ativos`, `posicoes`, `dividendos` (incl. projeções), geração de transação no extrato e validação RLS.
- Prioridade 2: Dashboard por tipo, histórico mensal, alocação ideal e alertas.
- Prioridade 3: Questionário/nota e recomendação automática; testes de usabilidade E2E.

Automação:
- Escrever testes Jest para endpoints críticos com fixtures em `tests/fixtures`.
- Escrever E2E Playwright cobrindo fluxos de ponta-a-ponta (cadastro, projeção, reconciliação).
- Integrar execução de testes na pipeline CI (GitHub Actions) com matrix para Node/E2E.

## 8. Dados de teste sugeridos

- Usuário A / Usuário B com sessões separadas para validar RLS.
- Conjunto de ativos: uma `STOCKS` (ticker `VALE3`), um `ETF_INTERNACIONAL` (ticker `SPY`), um `RENDA_FIXA` (identificador `LDI-01`).
- Posições com quantidades e preços para simular ganho e perda.
- Dividendos: um pago hoje; um futuro (data daqui a 30 dias).

---

> Observação: Posso gerar os testes Jest e Playwright iniciais (esqueleto) com fixtures se quiser. Deseja que eu crie os casos automatizados prioritários agora? 
