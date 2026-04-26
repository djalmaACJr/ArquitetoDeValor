# 📊 Regras de Negócio — Arquiteto de Valor

> Complementa [`CLAUDE.md`](./CLAUDE.md) e [`ARCHITECTURE.md`](./ARCHITECTURE.md). Foco em **o que** o sistema garante, não em **como** está implementado.

---

## 🏦 Contas

### Tipos (ENUM `tipo_conta`)

| Valor | Descrição |
|---|---|
| `CORRENTE` | Conta corrente bancária |
| `REMUNERACAO` | Conta salário / remuneração |
| `CARTAO` | Cartão de crédito |
| `INVESTIMENTO` | Conta de investimentos |
| `CARTEIRA` | Dinheiro em espécie |

### Campos

- `nome` — 1 a 100 caracteres, obrigatório.
- `saldo_inicial` — `NUMERIC(15,2)`, default `0`.
- `cor` — formato hex `#RRGGBB` (validado por regex).
- `icone` — texto livre (emoji ou URL de logo).
- `ativa` — boolean (soft delete).

### Saldo

- **Saldo atual** = `saldo_inicial` + Σ(`RECEITA`) − Σ(`DESPESA`) — provido pela view `vw_saldo_contas`.
- Saldo nunca é armazenado denormalizado; sempre calculado.

### Restrições

- ❌ **Não pode excluir conta com lançamentos** (trigger `fn_bloquear_exclusao_conta` bloqueia).
- ❌ **Não pode lançar transação em conta inativa** (trigger `fn_validar_isolamento_usuario`).
- ❌ Conta de um usuário **nunca** é visível para outro (RLS).

### Cartões

Não há campos `dia_fechamento`/`dia_pagamento` na schema atual — suporte previsto, mas o tipo `CARTAO` hoje é tratado como conta comum.

---

## 🏷️ Categorias

### Estrutura

- Hierarquia de **2 níveis**: pai (`id_pai = NULL`) → filho (`id_pai = <pai>`).
- Não há suporte para níveis adicionais.
- `descricao` — 1 a 20 caracteres.
- `ativa` — soft delete.
- `protegida` — boolean. Quando `true`, não pode ser editada nem removida.

### Categoria "Transferências" (protegida)

- Criada automaticamente no cadastro do usuário (trigger `fn_sincronizar_usuario`).
- Marcada com `protegida = true`, sem `id_pai` (é categoria pai).
- Toda transferência usa essa categoria nos dois lados (débito + crédito).
- Subcategoria padrão: `Entre Contas`, `Reembolsos`.

### Seed inicial (no cadastro)

Categorias pai criadas automaticamente:
**Moradia · Alimentação · Transporte · Saúde · Renda · Transferências**

Cada uma com 2–4 subcategorias (ex.: Moradia → Aluguel, Condomínio, IPTU, Manutenção).

### Restrições

- ❌ Não pode excluir categoria com **subcategorias** (trigger).
- ❌ Não pode excluir categoria com **transações vinculadas** (trigger).
- ❌ Não pode editar/excluir categoria com `protegida = true`.
- ❌ `categoria_id` precisa pertencer ao mesmo `user_id` (trigger).

---

## 💰 Transações

### Tipos (ENUM `tipo_transacao`)

- `RECEITA` — entrada de valor.
- `DESPESA` — saída de valor.

### Status (ENUM `status_transacao`)

| Valor | Significado |
|---|---|
| `PAGO` | Efetivado / liquidado |
| `PENDENTE` | A pagar/receber, ainda não efetivado |
| `PROJECAO` | Projeção (estimativa, não compromisso firme) |

**Transição especial**: ao mover de `PROJECAO → PAGO`, o trigger `fn_preservar_valor_projetado` salva o valor original em `valor_projetado` (caso o usuário não tenha preenchido).

### Campos obrigatórios

- `conta_id` (válida e ativa, do mesmo usuário)
- `data` (date)
- `descricao` — 2 a 200 caracteres
- `valor` — `NUMERIC(15,2)`, **estritamente > 0**
- `tipo`
- `status` (default `PENDENTE`)

### Recorrência

#### Frequência (na API: `frequencia` / no enum: `intervalo_recorr`)

| Frequência (API) | ENUM | Período |
|---|---|---|
| `DIARIA` | `DIA` | dia a dia |
| `SEMANAL` | `SEMANA` | a cada 7 dias |
| `MENSAL` | `MES` | mesmo dia do mês seguinte |
| `ANUAL` | `ANO` | mesmo dia/mês do ano seguinte |

#### Tipo de recorrência (ENUM `tipo_recorrencia`)

- `PARCELA` — número fixo de ocorrências (ex.: 12 parcelas).
- `PROJECAO` — projeção contínua (não-fechada).

#### Campos vinculados

- `id_recorrencia` (UUID que agrupa todas as parcelas/projeções da série)
- `nr_parcela` (≥ 1)
- `total_parcelas` (≥ `nr_parcela`)
- `tipo_recorrencia`

**Regra de consistência (constraint do banco)**: ou os 4 campos estão presentes, ou os 4 são `NULL`. Não pode haver mistura.

### Edição/exclusão de recorrência

Escopo (ENUM `escopo_recorr`, recebido na querystring `?escopo=`):

| Escopo | Comportamento |
|---|---|
| `SOMENTE_ESTE` | Altera/remove apenas a parcela atual |
| `ESTE_E_SEGUINTES` | Altera/remove a atual e todas posteriores na série |
| `TODOS` | Altera/remove a série inteira |

**Default** = `SOMENTE_ESTE`.

### Antecipação de parcelas (`POST /transacoes/:id/antecipar`)

Função `fn_antecipar_parcelas`:

1. Soma `valor` das parcelas com `nr_parcela > N` (mesma `id_recorrencia`).
2. **Deleta** essas parcelas seguintes.
3. Atualiza a parcela atual: `valor = valor + soma`, `total_parcelas = N`, `valor_projetado = valor original`.
4. Registra em `auditoria` com ação `ANTECIPAR`.

Erros possíveis:

- `TRANSACAO_NAO_ENCONTRADA`
- `NOT_INSTALLMENT` (não é uma parcela)
- `LAST_INSTALLMENT` (já é a última)

---

## 🔄 Transferências

### Modelo

Toda transferência é representada por **2 transações** ligadas pelo mesmo `id_par_transferencia`:

| Lado | Conta | Tipo | Categoria | Descrição |
|---|---|---|---|---|
| Débito | origem | `DESPESA` | Transferências (protegida) | `[Transf. saída] <descricao>` |
| Crédito | destino | `RECEITA` | Transferências (protegida) | `<descricao>` |

### Regras

- ✅ `conta_origem_id ≠ conta_destino_id`.
- ✅ Ambas as contas precisam existir, pertencer ao usuário e estar **ativas**.
- ✅ `valor > 0`.
- ✅ `descricao` (quando informada): 2 a 200 caracteres.
- ✅ Status válido: `PAGO`, `PENDENTE`, `PROJECAO`.
- ❌ **Não pode existir só um lado** do par — endpoint cria/atualiza/exclui sempre os 2.
- ❌ Categoria de transferência é fixa — frontend/backend não devem expor a escolha.

### Recorrência em transferências

Quando `total_parcelas > 1` é informado, gera-se uma série inteira de pares (cada par compartilha `id_recorrencia`). Frequência aceita: `DIARIA`, `SEMANAL`, `MENSAL`, `ANUAL`.

---

## 📊 Relatórios e dashboard

### Fontes

- `vw_resumo_mensal` — entradas, saídas e resultado por mês.
- `vw_despesas_por_categoria` — total e percentual por **categoria pai** por mês.
- `vw_transacoes_com_saldo` — extrato com saldo acumulado por conta (window function `OVER PARTITION BY conta_id ORDER BY data, criado_em`).

### Regras de apresentação

- Sempre baseados em **período** (mês/ano).
- Sempre filtrados por usuário (RLS).
- Despesas agrupadas por categoria pai consolidam as filhas (a view já faz `COALESCE(cat_pai.id, t.categoria_id)`).
- Exportação Excel disponível em Relatórios.

---

## 🔐 Multi-tenant / Isolamento

- Toda tabela de domínio tem `user_id`.
- RLS aplicada com `USING (user_id = auth.uid())` e `WITH CHECK (user_id = auth.uid())`.
- Trigger `fn_validar_isolamento_usuario` impede que uma transação use `conta_id` ou `categoria_id` de outro usuário (defesa adicional além da RLS).
- Edge Functions sempre repassam o JWT do usuário; nunca usam `service_role` para queries de dados de usuário.

---

## 🧾 Auditoria

Tabela `arqvalor.auditoria` registra ações sensíveis:

- Ações: `INSERT`, `UPDATE`, `DELETE`, `ANTECIPAR`.
- Payloads `JSONB` (`payload_old`, `payload_new`).
- Inclui IP e `user_id`.
- Visível apenas para o próprio usuário (RLS).

---

## ✅ Validações resumidas

| Campo | Regra |
|---|---|
| `cor` | `^#[0-9A-Fa-f]{6}$` |
| `descricao` (conta) | 1..100 |
| `descricao` (categoria) | 1..20 |
| `descricao` (transação/transferência) | 2..200 |
| `valor` | > 0 |
| `valor_projetado` | > 0 quando presente |
| `nr_parcela` | ≥ 1 e ≤ `total_parcelas` |
| `total_parcelas` | ≥ 1 |
| `status` | `PAGO` \| `PENDENTE` \| `PROJECAO` |
| `frequencia` | `DIARIA` \| `SEMANAL` \| `MENSAL` \| `ANUAL` |
| `tipo_conta` | `CORRENTE` \| `REMUNERACAO` \| `CARTAO` \| `INVESTIMENTO` \| `CARTEIRA` |
| `tipo_transacao` | `RECEITA` \| `DESPESA` |
| `escopo` | `SOMENTE_ESTE` \| `ESTE_E_SEGUINTES` \| `TODOS` |

---

## 🚫 Restrições críticas (resumo)

- ❌ Misturar dados entre usuários (bloqueado por RLS + trigger).
- ❌ Quebrar pares de transferência (deve ser sempre atômico).
- ❌ Inconsistência em recorrência — `id_recorrencia/nr_parcela/total_parcelas/tipo_recorrencia` são "tudo ou nada".
- ❌ Excluir conta com transações.
- ❌ Excluir categoria com filhos ou lançamentos.
- ❌ Editar/excluir categoria protegida (`Transferências`).
- ❌ `valor` ≤ 0.
- ❌ Transferência com mesma conta de origem e destino.
- ❌ Lançamento em conta inativa.
