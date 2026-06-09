# 🏗️ Arquitetura Visual — Módulo de Investimentos

> Referência compacta com diagramas ASCII e fluxos principais.

---

## 1. Visão geral da arquitetura

```
Frontend React
  ├─ pages/InvestimentosPage
  ├─ pages/AtivosPage
  ├─ pages/DetalheAtivoPage
  ├─ components/Chart
  ├─ hooks/useInvestimentos
  └─ lib/api.ts

Backend Supabase Edge Functions
  ├─ functions/investimentos/ativos
  ├─ functions/investimentos/posicoes
  ├─ functions/investimentos/operacoes
  ├─ functions/investimentos/dividendos
  └─ functions/investimentos/dashboard

PostgreSQL schema arqvalor
  ├─ investimentos.ativos
  ├─ investimentos.posicoes
  ├─ investimentos.operacoes
  ├─ investimentos.dividendos
  ├─ investimentos.historico_mensal
  └─ arqvalor.transacoes (extrato)
```

---

## 2. Fluxo de dados principal

```
[Usuário] --> [Frontend] --> [Edge Function] --> [DB]
      ^                                          |
      |                                          v
      |                                      [Extrato]
      |                                          |
      |                                          v
      ---------------------------------- [Dashboard]
```

- o fluxo sempre preserva `user_id`
- `conta_id` é atributo obrigatório para posições e dividendos
- dividendos escrevem também em `arqvalor.transacoes`

---

## 3. Sequência de criação de um investimento

```
1. Cadastro do ativo
2. Registro da posição vinculada à conta
3. Operações de compra/apo rte/venda
4. Atualização de histórico mensal
5. Cadastro de dividendos
6. Geração de transação no extrato
7. Atualização do dashboard por tipo
```

---

## 4. Componentes principais

- `InvestimentosPage`
  - visão inicial por tipo de ativo
  - resumo de valor de mercado e rentabilidade

- `AtivosPage`
  - listagem de posições
  - filtro por tipo de ativo
  - colunas de ganho/prejuízo e conta

- `DetalheAtivoPage`
  - histórico mensal
  - gráfico de dividendos
  - operações vinculadas

- `CardTipoAtivo`
  - destaque de cada classe
  - variação e peso na carteira

- `GraficoEvolucaoCarteira`
  - evolução mês a mês
  - comparação entre tipos

---

## 5. Regras de segurança

- todas as queries são `SECURITY INVOKER`
- funções `investimentos.*` usam RLS por `user_id`
- `conta_id` e `ativo_id` são validados contra o usuário
- a transação de dividendo no extrato respeita o mesmo esquema de segurança

---

## 6. Pontos de integração com o sistema atual

- `ExtratoPage` deve reconhecer `Dividendo` como tipo de transação
- relatórios devem somar dividendos como receita
- saldo das contas deve refletir dividendos e operações de investimento
- o dashboard principal pode exibir resumo de investimento como painel adicional
