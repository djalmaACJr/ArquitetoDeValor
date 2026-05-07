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
- `dia_fechamento` / `dia_pagamento` — `INTEGER 1..31`, opcionais. Usados pelo tipo `CARTAO`.

### Saldo

- **Saldo atual** = `saldo_inicial` + Σ(`RECEITA` PAGAS) − Σ(`DESPESA` PAGAS) — provido pela view `vw_saldo_contas` (apenas transações com `status = PAGO`).
- Saldo nunca é armazenado denormalizado; sempre calculado.
- A função `fn_saldos_contas_ate_data(p_data)` retorna saldo até uma data (usada no Dashboard).

### Restrições

- ❌ **Não pode excluir conta com lançamentos** (trigger `fn_bloquear_exclusao_conta`).
- ❌ **Não pode CRIAR transação em conta inativa** (trigger `fn_validar_isolamento_usuario` — INSERT, ou UPDATE com mudança de `conta_id`).
- ⚠️ Pode ATUALIZAR transação existente cuja `conta_id` está inativa **desde que `conta_id` não mude** (mudança feita em `20260505000001` — antes bloqueava qualquer UPDATE).
- ❌ Conta de um usuário **nunca** é visível para outro (RLS).

### Cartões

- Tipo `CARTAO` é uma conta como as outras, com a adição opcional de `dia_fechamento` e `dia_pagamento` para representar ciclo de fatura.
- Frontend usa esses campos apenas para exibição; cálculos de saldo seguem a regra padrão (movimentação `PAGO`).

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

- ❌ Não pode excluir categoria com **subcategorias** (trigger `fn_bloquear_exclusao_categoria`).
- ❌ Não pode excluir categoria com **transações vinculadas** (trigger).
- ❌ `categoria_id` precisa pertencer ao mesmo `user_id` (trigger `fn_validar_isolamento_usuario`).
- ❌ Categoria com `protegida = true`:
  - **Somente `cor` e `icone`** podem ser alterados via UPDATE.
  - **DELETE bloqueado** (trigger `trg_proteger_categoria`).
  - Mudanças em `descricao` / `id_pai` / `ativa` são bloqueadas.
- 🔄 **Cascata de inatividade**: ao mudar uma categoria pai de `ativa=TRUE → FALSE`, todas as filhas com `ativa=TRUE` são automaticamente inativadas (trigger `trg_cascata_inativar_subcategorias`).
- ❌ Não pode CRIAR/atribuir categoria inativa a um lançamento (validação no endpoint `/transacoes`).

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

#### Frequência (recebida pela API, usada apenas para calcular datas)

| Valor | Período |
|---|---|
| `DIARIA` | a cada `intervalo` dia(s) |
| `SEMANAL` | a cada `intervalo` semana(s) |
| `MENSAL` | a cada `intervalo` mês(es) — mesmo dia do mês |
| `ANUAL` | a cada `intervalo` ano(s) — mesmo dia/mês |

⚠️ A frequência **não é persistida no banco**. As parcelas armazenam apenas `data` calculada. Quando o usuário edita escopo `ESTE_E_SEGUINTES`, o backend infere a frequência analisando a diferença em dias entre as duas primeiras parcelas (ex.: 30 dias → MENSAL/1).

#### Coluna `tipo_recorrencia` (ENUM `tipo_recorrencia`)

Indica como cada parcela é tratada:

- `PARCELA` — parcela com data efetiva (default).
- `PROJECAO` — parcela ainda projetada (data futura), pode virar `PAGO` automaticamente quando a data chega.

#### Campos vinculados (todos NULL ou todos preenchidos)

- `id_recorrencia` (UUID que agrupa todas as parcelas da série)
- `nr_parcela` (≥ 1)
- `total_parcelas` (≥ `nr_parcela`)
- `tipo_recorrencia` (`PARCELA` | `PROJECAO`)

**Constraint `chk_parcela_consistente`**: os 4 campos estão presentes ou todos `NULL`. Não pode haver mistura.

**Constraint `chk_nr_parcela_range`**: `nr_parcela <= total_parcelas`.

#### `intervalo_recorrencia` (INTEGER)

Coluna existe na tabela (`>= 1`), prevista para representar o intervalo (ex.: a cada 2 meses). **Atualmente não é persistida** pelas inserções do backend — ver "Pontos de atenção" no `ARCHITECTURE.md`.

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
- ✅ Ambas as contas precisam existir, pertencer ao usuário e estar **ativas** (verificado em CRIAÇÃO de transferência).
- ✅ `valor > 0`.
- ✅ `descricao` (quando informada): 2 a 200 caracteres.
- ✅ Status válido: `PAGO`, `PENDENTE`, `PROJECAO`.
- ❌ **Não pode existir só um lado** do par — endpoint cria/atualiza/exclui sempre os 2.
- ❌ Categoria de transferência é fixa — frontend/backend não devem expor a escolha.
- ❌ **Não pode excluir uma transação avulsa** que tenha `id_par_transferencia` quando a categoria é protegida — trigger `trg_bloquear_exclusao_transf_avulsa` força uso de `DELETE /transferencias/:id_par`.

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

## 🔖 Filtros salvos

### Conceito

Usuário pode salvar conjuntos nomeados de filtros por página (Dashboard, Extrato, Relatórios) e reaplicá-los depois.

### Tabela `filtros_salvos`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK `auth.users` (cascade DELETE) |
| `pagina` | TEXT | identificador da página (`extrato`, `relatorios`, `dashboard`) |
| `nome` | TEXT | até 50 chars |
| `dados` | JSONB | estrutura livre por página |
| `criado_em` | TIMESTAMPTZ | `now()` |

### Regras

- RLS por `user_id = auth.uid()`.
- Endpoint `/filtros`: `GET` (listar — opcionalmente filtrado por `?pagina=`), `POST` (salvar), `PUT /:id` (renomear), `DELETE /:id`.
- Componente `FiltrosSalvosBtn` reutilizado em todas as 3 páginas.
- Gerenciamento (renomear/excluir) na tela **Perfil**.

---

## 📥 Importação de transações (XLSX/CSV)

### Detecção automática de transferências

Durante a importação, o frontend pareia linhas em transferências quando todas as condições abaixo são satisfeitas:

1. **Descrição** contém o token `transfer` (case-insensitive, sem acentos);
2. **Categoria** normalizada == `transferencias` em ambos os lados;
3. **Mesma data**;
4. **Mesmo valor** (tolerância `< 0,005`);
5. **Tipos opostos** (uma `RECEITA`, outra `DESPESA`);
6. **Contas diferentes**.

Pares formados são importados via `POST /transferencias` (atômico — cria os 2 lançamentos com prefixo `[Transf. saída]`/`[Transf. entrada]`). Linhas que satisfazem o critério mas não acham par são importadas como `/transacoes` normais.

### Reativação automática de contas inativas

Antes de importar, o frontend dá `PUT /contas/:id { ativa: true }` em todas as contas inativas envolvidas. Ao final (mesmo em erro/cancelamento, via `try/finally`), restaura `ativa: false`.

Mesma estratégia em `executarRestore` (backup JSON). Em `limpar` (backend), o `UPDATE id_par_transferencia = NULL` antes do DELETE também precisa que a conta esteja ativa — a edge function reativa antes e:
- Modo `transacoes`: reinativa no fim.
- Modo `tudo`: contas serão deletadas, não reinativa.

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
| `intervalo_recorrencia` | ≥ 1 |
| `dia_fechamento` / `dia_pagamento` | 1..31 |
| `nome` (filtro salvo) | 1..50 |
| `status` | `PAGO` \| `PENDENTE` \| `PROJECAO` |
| `frequencia` (API) | `DIARIA` \| `SEMANAL` \| `MENSAL` \| `ANUAL` |
| `tipo_recorrencia` (banco) | `PARCELA` \| `PROJECAO` |
| `tipo_conta` | `CORRENTE` \| `REMUNERACAO` \| `CARTAO` \| `INVESTIMENTO` \| `CARTEIRA` |
| `tipo_transacao` | `RECEITA` \| `DESPESA` |
| `escopo` | `SOMENTE_ESTE` \| `ESTE_E_SEGUINTES` \| `TODOS` |

---

## 🚫 Restrições críticas (resumo)

- ❌ Misturar dados entre usuários (bloqueado por RLS + trigger `fn_validar_isolamento_usuario`).
- ❌ Quebrar pares de transferência — sempre atômico via endpoint `/transferencias`.
- ❌ Excluir avulso uma transação que tem `id_par_transferencia` com categoria protegida (trigger `trg_bloquear_exclusao_transf_avulsa`).
- ❌ Inconsistência em recorrência — `id_recorrencia/nr_parcela/total_parcelas/tipo_recorrencia` são "tudo ou nada" (`chk_parcela_consistente`).
- ❌ Excluir conta com transações (`fn_bloquear_exclusao_conta`).
- ❌ Excluir categoria com filhos ou lançamentos (`fn_bloquear_exclusao_categoria`).
- ❌ Excluir categoria com `protegida = true`. Edição limitada a `cor`/`icone` (`trg_proteger_categoria`).
- ❌ `valor` ≤ 0 (constraint `valor > 0`).
- ❌ Transferência com mesma conta de origem e destino.
- ❌ Criar lançamento em conta inativa, ou em categoria inativa (validações no endpoint).
- ✅ Atualizar campos não-relacionais (status, descricao, valor) de uma transação cuja conta esteja inativa **é permitido** desde a migration `20260505000001`.
