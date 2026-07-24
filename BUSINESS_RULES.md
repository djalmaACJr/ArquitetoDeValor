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
- `saldo_inicial` — `NUMERIC(15,2)`, default `0`. **Para tipo `CARTAO` é sempre `0`** (backend força mesmo se cliente enviar outro valor).
- `cor` — formato hex `#RRGGBB` (validado por regex).
- `icone` — texto livre (emoji ou URL de logo).
- `ativa` — boolean (soft delete).
- `dia_fechamento` / `dia_pagamento` — `INTEGER 1..31`, opcionais. Usados pelo tipo `CARTAO`.
- `limite_credito` — `NUMERIC(15,2)`, opcional. Apenas para tipo `CARTAO` (backend zera o campo para os demais tipos). Check: `>= 0`.

### Saldo

- **Saldo atual** = `saldo_inicial` + Σ(`RECEITA`) − Σ(`DESPESA`) — provido pela view `vw_saldo_contas`. ⚠️ **Soma TODAS as transações até a data, independente de status** (`PAGO`, `PENDENTE` e `PROJECAO` contam igual). NÃO filtre por status no cálculo de saldo — isso é regra de negócio canônica e foi violada várias vezes no passado.
- Saldo nunca é armazenado denormalizado; sempre calculado.
- A função `arqvalor.fn_saldos_contas_ate_data(p_user_id, p_data)` retorna saldo PAGO por conta até uma data (usada no Dashboard / Extrato). `SECURITY INVOKER`; rejeita chamada se `p_user_id <> auth.uid()` — corrigido em `20260522000002`. Antes era `SECURITY DEFINER` e permitia vazamento entre usuários.

### Restrições

- ❌ **Não pode excluir conta com lançamentos** (trigger `fn_bloquear_exclusao_conta`).
- ❌ **Não pode CRIAR transação em conta inativa** (trigger `fn_validar_isolamento_usuario` — INSERT, ou UPDATE com mudança de `conta_id`).
- ⚠️ Pode ATUALIZAR transação existente cuja `conta_id` está inativa **desde que `conta_id` não mude** (mudança feita em `20260505000001` — antes bloqueava qualquer UPDATE).
- ❌ Conta de um usuário **nunca** é visível para outro (RLS).

### Cartões

- Tipo `CARTAO` é uma conta como as outras, com três campos extras opcionais: `dia_fechamento`, `dia_pagamento` (`1..31`) e `limite_credito` (`>= 0`).
- `saldo_inicial` é forçado a `0` para cartão — o saldo é apenas a fatura aberta calculada pelos lançamentos.
- O formulário de novo cartão **não** mostra "Saldo inicial"; mostra "Limite de crédito" no lugar.
- ⚠️ **Exceção à regra geral de saldo**: desde `20260526000001`, contas `CARTAO` **ignoram** transações com `status='PROJECAO'` no cálculo de saldo (`vw_saldo_contas`, `fn_saldos_contas_ate_data`, `fn_saldo_conta_ate_data`) — só somam `PAGO`+`PENDENTE`. Demais tipos de conta continuam somando os 3 status igualmente (regra geral inalterada).
- Frontend usa `dia_fechamento`/`dia_pagamento` apenas para exibição/calendário (eventos de fechamento e pagamento).

### Cartões virtuais

- Coluna `contas.cartoes_virtuais JSONB` (array de `{id, sufixo, apelido}`) — **não é tabela própria**, não tem FK em `transacoes`, não tem limite/saldo próprio.
- Só relevante para `tipo = CARTAO`; demais tipos sempre recebem `[]`.
- Validação (backend e frontend, duplicada): `sufixo` — 2 a 8 dígitos numéricos; `apelido` — até 40 caracteres.
- Puramente organizacional: identifica com qual "plástico" (cartão físico ou adicional/virtual) uma compra foi feita. O parser de fatura Nubank detecta o sufixo (`•••• XXXX`) e grava `"Cartão final <sufixo>"` na `observacao` do item — mas **não há resolução automática sufixo → apelido** implementada; a intenção existe em comentário no código, não a funcionalidade.

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

### Atomicidade (RPC)

Criação e exclusão do par (ou série, se recorrente) são atômicas via RPC `SECURITY INVOKER`, não via 2 chamadas PostgREST separadas:

- **Criar**: a Edge Function monta em memória **todas** as linhas do par (2× por parcela, com datas/status/`id_recorrencia`/`id_par_transferencia` já calculados) e delega o INSERT inteiro para `arqvalor.fn_criar_transferencia(p_rows jsonb)` — se qualquer linha falhar (constraint/trigger/RLS), o Postgres faz ROLLBACK de tudo, sem par órfão possível.
- **Excluir**: `arqvalor.fn_excluir_transferencias(p_ids)` desarma a proteção (`id_par_transferencia = NULL`) e apaga as transações do par/série numa única transação.
- Isso substitui o esquema antigo (2 INSERTs sequenciais + DELETE compensatório manual em caso de falha), que podia deixar "meio par" órfão.

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

## 🔔 Lembretes

### Conceito

Lembretes são avisos pessoais com data, descrição e status. Podem ser avulsos ou vinculados a um lançamento futuro.

### Tabela `lembretes`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK `usuarios` (cascade DELETE) |
| `data` | DATE | obrigatória |
| `descricao` | TEXT | 1..200 caracteres |
| `status` | TEXT | `PENDENTE` \| `CONCLUIDO` (default `PENDENTE`) |
| `lancamento_id` | UUID | FK `transacoes` (cascade DELETE, nullable) |
| `criado_em` | TIMESTAMPTZ | `now()` |
| `atualizado_em` | TIMESTAMPTZ | gerenciado por trigger |

### Regras

- RLS por `user_id = auth.uid()`.
- Endpoint `/lembretes`: `GET` (listar — filtros por `?mes=`, `?ano=`, `?status=`), `POST` (criar), `PUT /:id` (atualizar), `DELETE /:id`.
- Quando `lancamento_id` é informado, o lembrete é excluído automaticamente (cascade) se o lançamento for deletado.
- Componente `ModalLembrete` e `CalendarioDashboard` exibem lembretes no Dashboard por mês.

---

## 🤖 Assistente de Lançamentos

### Conceito

Armazena "lançamentos padrão" do usuário para sugestão automática ao digitar uma descrição. Dado um prefixo, retorna o registro com descrição mais semelhante e `atualizado_em` mais recente.

### Tabela `assistente_lancamentos`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID | PK |
| `user_id` | UUID | FK `usuarios` (cascade DELETE) |
| `descricao` | TEXT | 2..200 caracteres |
| `categoria_id` | UUID | FK `categorias` (ON DELETE SET NULL, nullable) |
| `conta_origem_id` | UUID | FK `contas` (ON DELETE SET NULL, nullable) |
| `conta_destino_id` | UUID | FK `contas` (ON DELETE SET NULL, nullable) |
| `is_transferencia` | BOOLEAN | `DEFAULT FALSE` |
| `criado_em` | TIMESTAMPTZ | `now()` |
| `atualizado_em` | TIMESTAMPTZ | gerenciado por trigger |

### Regras

- RLS por `user_id = auth.uid()`.
- Constraint `chk_assistente_transf`: quando `is_transferencia = TRUE`, `conta_origem_id` e `conta_destino_id` são obrigatórios e distintos.
- Índice único em `(user_id, lower(descricao))` — garante unicidade case-insensitive e suporta upsert por descrição.
- Endpoint `/assistente`:
  - `GET ?q=<termo>` — busca por ILIKE `%termo%` na descrição, ordena por `atualizado_em DESC`, retorna até 5 sugestões.
  - `POST` — upsert (insert ou update) pelo par `(user_id, lower(descricao))`.
  - `DELETE /:id` — remove padrão específico.
- O frontend chama automaticamente o POST após salvar um lançamento com sucesso, para manter os padrões atualizados.

---

## 👁️ Preferências do usuário

### `ocultar_valores`

Coluna `ocultar_valores BOOLEAN NOT NULL DEFAULT false` na tabela `usuarios`.

- Controla se os valores monetários ficam mascarados na UI (Dashboard, Contas, Relatórios).
- Lido e gravado diretamente via Supabase client (schema `arqvalor`) no hook `useOcultarValores` — sem passar por Edge Function.
- Componente `BotaoOcultar` padroniza o botão Ocultar/Mostrar em todas as páginas que exibem valores.
- Migration: `20260513000001_ocultar_valores_usuario.sql`.

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

## 🎯 Objetivos

### Conceito

Uma única tabela/API (`objetivos`) serve 4 tipos de meta financeira, cada um com sua fonte de dados e fórmula de progresso próprias:

| Tipo | Label na UI | O que monitora | `valor_meta` significa | Vínculo |
|---|---|---|---|---|
| `SONHO` | 💰 Patrimônio | Saldo acumulado de 1+ contas | Valor-alvo em R$ do saldo final | `contas_sonho[]` (+ `conta_id` legado) |
| `OBJETIVO` | 🎯 Renda Recorrente | Receita média por período em 1+ categorias | Valor-alvo em R$ **por período** (ex. R$/mês) | `categorias_objetivo[]` (+ `categoria_id` legado) + `frequencia` |
| `PROJETO` | 📦 (oculto na UI atual — em desenvolvimento) | Despesas em 1+ contas (orçamento) | Teto de gasto em R$ | `contas_projeto[]` (+ `categoria_id` como filtro opcional) |
| `CRESCIMENTO` | 📈 Evolução Anual | % de crescimento líquido (receita − despesa) ano a ano em 1+ categorias | Meta de crescimento anual em % | `categorias_objetivo[]` |

Campos comuns: `nome`, `descricao`, `icone`, `cor`, `data_inicio`/`data_fim` (`data_fim >= data_inicio`), `ativo` (soft delete), `valor_atingido`/`percentual`/`status` (**sempre calculados por trigger**, nunca setados pela API), `revisoes` (histórico JSON `{data, valor_meta_anterior, motivo}` a cada mudança de `valor_meta`).

`status` é sempre derivado automaticamente:
- `CANCELADO` se `ativo = false` (via soft-delete no `DELETE`).
- `ATINGIDO` se `percentual >= 100`.
- `EM_PROGRESSO` caso contrário.

### Multi-categorias / multi-contas

Os vínculos singulares originais (`conta_id` para SONHO, `categoria_id` para OBJETIVO) foram generalizados para **arrays** (`contas_sonho`, `categorias_objetivo`), permitindo agregar múltiplas contas/categorias num único objetivo (ex.: "Renda Recorrente" somando "Dividendos" + "Juros" + "Aluguéis"). Os campos singulares foram mantidos por retrocompatibilidade — o cálculo sempre prefere o array quando não vazio, com fallback para o singular.

### Saldo base (SONHO)

`saldo_base` = saldo agregado das contas monitoradas **no dia anterior à `data_inicio`** do objetivo. A partir dele:
- `valor_atingido = saldo_atual − saldo_base` (crescimento desde o início do objetivo, não saldo absoluto).
- Denominador do `percentual` = `valor_meta − saldo_base` (quanto falta crescer no total).
- A view expõe `crescimento_mensal_necessario` = `(valor_meta − saldo_base − valor_atingido) / meses_restantes` — exibido em destaque na tela de detalhe.

### Cálculo de OBJETIVO (renda recorrente)

`valor_atingido` = **média por período** das receitas das categorias monitoradas (não o total acumulado) — dividido pelo número de períodos decorridos conforme `frequencia` (`MENSAL`, `ANUAL`, `SEMANAL` contam o período corrente mesmo que parcial; sem frequência ou `DIARIA` usa o total direto). Isso torna `valor_atingido` diretamente comparável a `valor_meta` (ex.: meta de R$3.000/mês).

### Cálculo de CRESCIMENTO — evolução do método (YoY/YTD/NET)

Não são 4 métricas diferentes, mas melhorias sucessivas na mesma fórmula, aplicadas em migrations sequenciais:
1. **Ano-base fixo** (v1): compara ano corrente vs. o primeiro ano do objetivo — fica desatualizado com o tempo.
2. **YoY** (Year-over-Year): compara ano corrente vs. o ano **imediatamente anterior**.
3. **YTD** (Year-to-Date): quando o ano corrente está incompleto, compara contra o **mesmo trecho de calendário** do ano anterior (offset de dias desde 1º de janeiro, robusto a ano bissexto).
4. **NET** (líquido): soma receita − despesa da(s) categoria(s), não só receita — necessário para categorias de investimento com entradas e saídas.
5. **COMP_YTD**: corrige assimetria remanescente — corta o ano de comparação em `CURRENT_DATE` também, tornando os dois períodos comparados estritamente proporcionais.

⚠️ **Divergência conhecida**: a migration mais recente (`20260605000001_sonho_saldo_base.sql`), ao reescrever as funções de cálculo para adicionar `saldo_base` ao SONHO, reintroduziu — aparentemente sem intenção — a versão **v1** (ano-base fixo, só receita, sem YTD) do bloco CRESCIMENTO, descartando as melhorias 2–5. Hoje: `objetivos.valor_atingido`/`percentual`/`status` (usados no card da listagem e no RPC de sincronização) refletem a versão v1 simples; a tela `ObjetivoDetalhe.tsx` recalcula, no client, a partir das transações brutas, a versão completa (YoY+YTD+NET) — **os dois números podem divergir** para o mesmo objetivo tipo CRESCIMENTO. Antes de tratar isso como bug a corrigir, confirme com quem mantém o código se foi intencional.

### Endpoints e sincronização

- `GET /objetivos` (filtros `tipo`/`status`/`ativo`), `GET /objetivos/:id` (inclui `progresso` = snapshots de `objetivos_progresso`), `POST /objetivos`, `PUT /objetivos/:id`, `DELETE /objetivos/:id` (soft — só `ativo=false`).
- `POST /objetivos/sincronizar-progresso` — RPC `fn_sincronizar_progresso_objetivo`, recalcula todos os objetivos ativos do usuário em massa e grava snapshot do dia.
- Snapshots diários (`objetivos_progresso`) alimentam o gráfico de histórico na tela de detalhe (`HistoricoProgresso`, hoje só exibido para SONHO/PROJETO — OBJETIVO/CRESCIMENTO têm visões próprias mais ricas).

---

## 💹 Investimentos

### Conceito e tipos de ativo

Carteira de investimentos com tipos: `ACOES`, `ETF`, `FII`, `STOCKS` (ações internacionais), `ETF_INTERNACIONAL`, `RENDA_FIXA`, `CRIPTOMOEDAS`, `TESOURO_DIRETO` (ENUM `tipo_ativo_inv`). ⚠️ Código (Edge Function e frontend) também referencia `REIT`, que **não existe** neste ENUM — tratar como não suportado até confirmação.

### Modelo posição = soma das operações

Desde a migration de baseline (`20260623000001`), **a posição nunca é editada diretamente em regime normal** — ela é sempre recomputada a partir de todas as suas `inv_operacoes` (função `recomputarPosicao`, na Edge Function, não trigger de banco):

- `COMPRA`/`APORTE`: soma quantidade e custo (afeta preço médio).
- `VENDA`/`RESGATE`: abate quantidade ao preço médio corrente.
- `RENDIMENTO` (só cripto): soma quantidade **sem** alterar custo — dilui o preço médio, e o ganho aparece como valorização.
- `DIVIDENDO`: não altera a posição.
- Operações com `data_operacao` futura são ignoradas no recálculo (não afetam o saldo atual).
- Ao final: grava `quantidade`, `preco_custo` (média), `data_compra` (1ª compra/aporte) e `status` (`ATIVA` se `qtd>0`, senão `ENCERRADA`).
- Posições de `RENDA_FIXA`/`TESOURO_DIRETO` com `rf_vencimento` já passado são **fechadas automaticamente** (gera um `RESGATE` na data de vencimento) a cada snapshot, sem ação do usuário.

### Dividendos ↔ Extrato

Cada `inv_dividendos` pode gerar uma transação `RECEITA`: `status='PROJECAO'` se `data_pagamento > hoje`, senão `PAGO`. A categoria vem de `inv_tipos_dividendo.categoria_id` — **obrigatória**, sem categoria mapeada o lançamento é bloqueado (409). Ativos em moeda estrangeira: valor convertido via PTAX antes de gravar. `POST /dividendos/:id/confirmar` reconcilia `PROJECAO → PAGO` preservando `valor_projetado`.

### DY (Dividend Yield) e YoC (Yield on Cost) — "padrão investidor10"

Cálculo da rota `/investimentos/ranking`:
- Janela: **trailing 12 meses-calendário até hoje** (exclui projeções futuras), mantendo só os 12 mais recentes.
- Para cada mês, usa o `valor_por_cota` (rate) gravado em `inv_dividendos`; quando ausente, estima dividindo o valor recebido pela quantidade que o usuário tinha na data (reconstruída via replay de todas as operações).
- **Fusão de duas fontes por data de pagamento**: `inv_dividendos` (o que o usuário efetivamente recebeu) + `inv_proventos_fundo` (cache do histórico do fundo inteiro, cobre meses **sem posse** — essencial para ativos comprados há menos de 12 meses). Na mesma data, usa o maior rate.
- `rate12m = Σ rate` dos 12 meses.
- **DY** = `rate12m × quantidade_atual ÷ valor_de_mercado × 100`.
- **YoC** = `rate12m × quantidade_atual ÷ valor_de_custo × 100`.
- Também expõe `dy_real`/`yoc_real` (dividendos efetivamente recebidos ÷ mercado/custo) e `posse_12m` (indica ao frontend quando "projetado" ≠ "real" por posse menor que 12 meses).

### Renda Fixa / Tesouro Direto — valor de mercado

Não usa cotação externa — é **derivado do indexador**: `PREFIXADO` usa juros compostos pela taxa fixa; `POS_FIXADO` usa a série mensal do índice (CDI/SELIC/IPCA via SGS do BCB) × `rf_percentual_indice`; `HIBRIDO` compõe a série do índice com o spread (`rf_taxa_fixa`) mês a mês. Para `TESOURO_DIRETO` prefixado/IPCA+, prioriza **marcação a mercado** via `cotacoes_tesouro` (PU); sem PU disponível, cai para a acumulação por índice. Após o vencimento, o valor fica congelado na data de vencimento.

### Rendimento de cripto

`inv_ativos.cripto_rendimento_aa` (%a.a.) modela yield (ex.: USDC) como **crédito de tokens a custo zero**: cada execução de `provisionarRendimentoCripto` (manual via `POST /rendimento-cripto` ou cron `rendimento-cripto-cron`) **apaga e reconstrói do zero** as operações `RENDIMENTO` da posição, materializando **sempre em blocos semanais** (mesmo que `cripto_rendimento_periodicidade` seja DIARIA/MENSAL — essa configuração só afeta a base de composição da taxa dentro do bloco, não a frequência de lançamento), com juros compostos: `tokens = qtd_no_início_do_bloco × ((1 + taxa×dias_periodicidade/365)^(dias_bloco/dias_periodicidade) − 1)`. Início = maior entre a 1ª compra/aporte e `cripto_rendimento_inicio` (se configurado e posterior). Não gera provento/dividendo — o ganho aparece só como valorização (mais tokens × preço).

### Avaliação de ativos por mentores de IA

- Cada ativo tem um **questionário por tipo** (`inv_questionarios`, custom por usuário, ou um padrão estático embutido no frontend), com perguntas por critério (`FUNDAMENTOS`, `CRESCIMENTO`, `DIVIDENDOS`, `VALUATION`).
- **Pesos por critério** são globais (`usuarios.inv_pesos_criterio`, soma 100), sugeridos pelo **perfil de investidor** (`usuarios.inv_perfil`, derivado de um mini-questionário de suitability): `CONSERVADOR {35,10,35,20}`, `MODERADO {30,25,25,20}`, `ARROJADO {25,40,10,25}` (ordem: Fundamentos/Crescimento/Dividendos/Valuation).
- **Avaliação manual**: usuário responde o questionário (`questionario_respostas`), `nota_usuario` = média ponderada por critério.
- **Avaliação por mentores** (uma ou mais IAs configuradas em `usuarios.ia_configs`): cada mentor responde o mesmo questionário para o mesmo ativo (`POST /avaliacoes/mentor`, chamado em paralelo pelo frontend, uma vez por mentor × ativo, sem persistir). `POST /avaliacoes/salvar` consolida: por pergunta, usa a **média** se `|média − mediana| / média < 10%`, senão a **mediana** (reduz impacto de outliers); calcula nota por critério, nota final ponderada pelos pesos, e nível de consenso (`ALTO/MEDIO/BAIXO`) pelo desvio-padrão das notas dos mentores. **O consenso vira a nota oficial do ativo**, sobrescrevendo `inv_ativos.nota_usuario`/`questionario_respostas`.
- `inv_avaliacoes.historico` guarda até 24 avaliações passadas para indicar tendência (subiu/desceu/manteve).
- `usuarios.inv_avaliacao_agenda.frequencia` é só uma preferência de UI — **não há cron server-side de reavaliação**; a reavaliação roda no navegador orquestrando os mentores, e o app calcula a próxima data esperada.

### Snapshot mensal/diário

Cron `snapshot-diario` (ver `ARCHITECTURE.md`) fecha posições de RF/Tesouro vencidas e grava, para o mês corrente, `inv_historico_mensal` por (ativo, conta): valor de mercado (cotação de `cotacoes_ativos`/PTAX/tesouro conforme o tipo), variação % e rentabilidade do mês (descontando fluxos de aporte/resgate). Cotações são cacheadas compartilhadamente (1 busca por ticker, não por usuário).

### Ressalvas conhecidas

- `inv_etf_holdings` (composição de ETF) tem schema criado mas **nenhum consumidor** — não decompor ETFs em holdings ao documentar ou construir features novas sobre essa tabela sem antes verificar se ela foi conectada.
- Tipo `REIT` usado no código não existe no ENUM do banco.

---

## 🧾 Importação de fatura de cartão

### Fluxo

1. **Upload** (`POST /faturas`, multipart): PDF do emissor (Nubank/C6/Inter/MercadoPago, ou parser genérico) + `conta_id` (deve ser `tipo=CARTAO`). PDF com senha é tratado explicitamente (erros `SENHA_OBRIGATORIA`/`SENHA_INCORRETA`); a senha nunca é persistida.
2. O parser do emissor extrai lançamentos → cria `fatura_import_sessao` (`status=EM_ANALISE`) + um `fatura_import_item` por linha.
3. **Classificação** (fase 1, UI): usuário escolhe categoria por item ou marca "Ignorar" (`decisao=IGNORAR`, excluído do resto do fluxo). `POST /faturas/:id/sugerir` roda um motor de matching (ver abaixo) que preenche `categoria_sugerida_id`/`transacao_existente_id` automaticamente; usuário pode aceitar ou vincular manualmente.
4. **Modo de importação** (fase 2, decisão persistida em `fatura_import_sessao.modo_importacao`):
   - **REGISTRO**: 1 lançamento por item da fatura.
   - **CATEGORIA**: 1 lançamento por categoria (ou por grupo separado manualmente), somando os itens — com decisão adicional `separar_por_cartao` (separa por sufixo de cartão virtual detectado).
5. **Preview e confirmação** (fase 3): a soma dos itens não-ignorados **precisa bater com `valor_total`** da fatura (tolerância de 1 centavo) antes de liberar o botão Confirmar. `POST /faturas/:id/confirmar` cria/atualiza as transações reais.

### Motor de matching (`/sugerir`)

Por item: normaliza a descrição (remove sufixo de parcela), busca o melhor padrão aprendido em `assistente_lancamentos` (score de similaridade textual, threshold ≥0.3) para sugerir categoria; se o padrão tem `id_recorrencia_vinculo`, tenta casar direto com a próxima parcela em aberto da mesma série. Senão, busca a melhor transação candidata (`PENDENTE`/`PROJECAO`, mesma conta, janela de datas em torno do vencimento) por similaridade de texto + proximidade de valor + número de parcela — score pondera texto (0.65), valor (0.15), categoria (+0.10) e parcela (+0.20).

### Anti-duplicação ao reimportar/reconfirmar

- Todo item, ao gerar/atualizar uma transação, grava `transacao_criada_id`. Ao **reabrir uma sessão confirmada** e reconfirmar, o backend usa `transacao_existente_id ?? transacao_criada_id` como alvo de UPDATE — evita duplicar a transação já gerada antes. A própria UI avisa que reconfirmar **pode** duplicar (risco residual reconhecido, não garantia absoluta).
- No modo CATEGORIA, uma **guarda anti-overwrite** garante que uma mesma transação-alvo só seja usada por um grupo por confirmação — evita que dois grupos façam UPDATE sequencial na mesma transação e um sobrescreva o valor do outro.
- `hash_match` (chave `conta|data|valor|descrição normalizada`) é calculado por item mas **não usado em nenhuma query de deduplicação hoje** — reenviar o mesmo PDF cria uma nova sessão/novos itens sem bloqueio automático; a prevenção de duplicidade real das transações só acontece nos pontos acima, no momento de confirmar.
- Papel do "grupo" (modo CATEGORIA): por padrão 1 grupo por categoria; o usuário pode separar manualmente um subconjunto em um grupo novo (`grupo_chave`), com descrição própria (`descricao_override`) — persistido, sobrevive a reload/pausa da revisão. Cada grupo vira **uma única transação** na confirmação, somando os itens (sinal RECEITA/DESPESA conforme o líquido).

### Regras de dados

- `tipo` do item (`RECEITA`|`DESPESA`) distingue créditos (estornos/descontos) de débitos — o valor numérico é sempre positivo, o sinal é dado por `tipo`.
- Transição `PROJECAO → PENDENTE` também preserva `valor_projetado` (estendido em `20260530000004` especificamente para o fluxo de confirmação de fatura atualizar uma projeção existente).

⚠️ Ver em `ARCHITECTURE.md` o achado de que a migration fundacional dessas tabelas está corrompida no git — o schema documentado aqui foi reconstruído por evidência indireta, não a partir do DDL fonte.

---

## 📈 Análises client-side (sem tabela própria)

Três páginas processam dados de `transacoes` inteiramente no navegador — não têm edge function, migration nem tabela dedicada:

- **Assinaturas** (`AssinaturasPage`): detecta gastos recorrentes agrupando por categoria + descrição normalizada, calculando intervalo médio entre ocorrências para classificar frequência. Ignora **intencionalmente** o `id_recorrencia` real do banco — é heurística sobre texto/valor/data, não a série de recorrência.
- **Comparativo Mensal** (`ComparativoMensalPage`): compara dois períodos livres lado a lado, somando receita/despesa por categoria (ignora transferências) e gerando insights de variação.
- **Projeção de Economia** (`ProjecaoEconomiaPage`): simula patrimônio futuro por juros compostos a partir da média de receita/despesa dos últimos 6 meses, com sliders de rendimento/redução de despesas/horizonte.

Nenhuma dessas páginas deve ganhar tabela/migration própria sem necessidade real — são views derivadas, por design.

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

## ✅ Validações resumidas

| Campo | Regra |
|---|---|
| `cor` | `^#[0-9A-Fa-f]{6}$` |
| `descricao` (conta) | 1..100 |
| `descricao` (categoria) | 1..50 |
| `descricao` (transação/transferência) | 2..200 |
| `sufixo` (cartão virtual) | `^\d{2,8}$` |
| `apelido` (cartão virtual) | ≤ 40 |
| `nome` (objetivo) | 1..100 |
| `valor_meta` (objetivo) | > 0 (percentual para tipo CRESCIMENTO) |
| `tipo` (objetivo) | `SONHO` \| `OBJETIVO` \| `PROJETO` \| `CRESCIMENTO` |
| `status` (objetivo) | `EM_PROGRESSO` \| `ATINGIDO` \| `CANCELADO` |
| `frequencia` (objetivo) | `DIARIA` \| `SEMANAL` \| `MENSAL` \| `ANUAL` |
| `nota_usuario`/`nota_final` (investimento) | 0..10 |
| `percentual_ideal` (alocação) | 0..100 |
| `status` (fatura) | `EM_ANALISE` \| `CONFIRMADA` \| `CANCELADA` |
| `decisao` (item de fatura) | `PENDENTE` \| `CRIAR` \| `ATUALIZAR` \| `IGNORAR` |
| `tipo` (item de fatura) | `RECEITA` \| `DESPESA` |
| `modo_importacao` (fatura) | `NULL` \| `REGISTRO` \| `CATEGORIA` |
| `valor` | > 0 |
| `valor_projetado` | > 0 quando presente |
| `nr_parcela` | ≥ 1 e ≤ `total_parcelas` |
| `total_parcelas` | ≥ 1 |
| `intervalo_recorrencia` | ≥ 1 |
| `dia_fechamento` / `dia_pagamento` | 1..31 |
| `limite_credito` (cartão) | ≥ 0 (NUMERIC 15,2) |
| `nome` (filtro salvo) | 1..50 |
| `descricao` (lembrete) | 1..200 |
| `status` (lembrete) | `PENDENTE` \| `CONCLUIDO` |
| `descricao` (assistente) | 2..200 |
| `status` | `PAGO` \| `PENDENTE` \| `PROJECAO` |
| `frequencia` (API) | `DIARIA` \| `SEMANAL` \| `MENSAL` \| `ANUAL` |
| `tipo_recorrencia` (banco) | `PARCELA` \| `PROJECAO` |
| `tipo_conta` | `CORRENTE` \| `REMUNERACAO` \| `CARTAO` \| `INVESTIMENTO` \| `CARTEIRA` |
| `tipo_transacao` | `RECEITA` \| `DESPESA` |
| `escopo` | `SOMENTE_ESTE` \| `ESTE_E_SEGUINTES` \| `TODOS` |

---

## 🤖 Mascotes e Integração de IA

### Mascotes

- Quatro mascotes selecionáveis: `arquiteta`, `gato`, `raposa`, `sabio` (rótulo de UI: "Conselheiro"; id interno permanece `sabio`).
- Cada mascote tem um tema visual associado (arquiteta=rosa-bebê, gato=azul, raposa=money green, conselheiro=marrom claro). O usuário pode trocar o tema independente do mascote depois do onboarding.
- **Poses**: `sentado`, `curioso`, `andando`, `comprimentando`, `feliz`, `triste`, `espantado`, `apontando-direita`, `apontando-esquerda`, `apontando-direita-acima`, `apontando-esquerda-acima`.
- Persistência: `arqvalor.usuarios.mascote_preferido` (texto) + `arqvalor.usuarios.layout` (JSONB com tema/apelido). `usuarios.mascote_preferido IS NULL` é tratado como primeiro acesso e dispara `ApresentacaoMascotes`.

### Configurações de IA

- Tabela: `arqvalor.usuarios.ia_configs JSONB` — array de objetos `{ id, provedor, apelido, modelo, api_key_cripto, atualizado_em }`.
- A `api_key` **nunca** é armazenada em texto puro. Antes do INSERT/UPDATE, a Edge Function `ia_configs` cifra com AES-256-GCM usando o secret `IA_KEYS_ENCRYPTION_KEY` (32 bytes). O frontend só recebe uma máscara (`sk-ant-...f4a2`).
- Provedores aceitos: `claude` | `gpt` | `gemini` | `deepseek` | `openrouter` | `mistral` | `cohere`. Cada um tem modelo padrão + flag `gratuito` + flag `visao` (suporta screenshot).
- Endpoint `ia_configs` expõe POST/PUT/DELETE e um `POST /:id/ping` para testar a credencial (chama o provedor com uma mensagem trivial).

### Chat com mascote

- A Edge Function `chat_mascote` recebe `{ mensagem, ia_config_id, contexto?: { texto?: string, screenshot?: base64 } }`, descriptografa a `api_key`, monta o prompt incluindo o apelido do mascote e a persona, e proxia para o provedor escolhido.
- Erros do provedor são traduzidos em mensagens amigáveis (`amigavel()`) — ex.: DeepSeek 402 = "saldo insuficiente"; Gemini 404 = itera modelos `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-flash-latest` → `gemini-1.5-flash-latest`.
- O contexto (texto + screenshot) só é enviado se o usuário marcar o chip "Enviar dados da tela" no ChatMascote. Provedores sem `visao = true` recebem apenas o texto.

### Tutorial

- O botão da versão (`AppVersion`) abre o `TutorialTour` da página atual.
- Cada passo aponta um seletor `[data-tutorial="..."]`. O mascote do usuário aparece apontando para o elemento. Direção (auto / abaixo / direita / esquerda / acima) configurável por passo em `lib/tutoriaisPaginas.ts`.

---

## 🚫 Restrições críticas (resumo)

- ❌ Misturar dados entre usuários (bloqueado por RLS + trigger `fn_validar_isolamento_usuario`).
- ❌ Quebrar pares de transferência — sempre atômico via RPC `fn_criar_transferencia`/`fn_excluir_transferencias` (endpoint `/transferencias`).
- ❌ Excluir avulso uma transação que tem `id_par_transferencia` com categoria protegida (trigger `trg_bloquear_exclusao_transf_avulsa`).
- ❌ Inconsistência em recorrência — `id_recorrencia/nr_parcela/total_parcelas/tipo_recorrencia` são "tudo ou nada" (`chk_parcela_consistente`).
- ❌ Excluir conta com transações (`fn_bloquear_exclusao_conta`).
- ❌ Excluir categoria com filhos ou lançamentos (`fn_bloquear_exclusao_categoria`).
- ❌ Excluir categoria com `protegida = true`. Edição limitada a `cor`/`icone` (`trg_proteger_categoria`).
- ❌ `valor` ≤ 0 (constraint `valor > 0`).
- ❌ Transferência com mesma conta de origem e destino.
- ❌ Criar lançamento em conta inativa, ou em categoria inativa (validações no endpoint).
- ✅ Atualizar campos não-relacionais (status, descricao, valor) de uma transação cuja conta esteja inativa **é permitido** desde a migration `20260505000001`.
- ❌ Setar manualmente `objetivos.valor_atingido`/`percentual`/`status` pela API — são sempre calculados por trigger.
- ❌ Excluir objetivo fisicamente via API — `DELETE` é soft (`ativo=false` → trigger cancela).
- ❌ Confirmar fatura de cartão fora do fluxo REGISTRO/CATEGORIA sem antes conciliar o total esperado do mês (a UI bloqueia o botão Confirmar quando não bate).
- ⚠️ Cartão ignora transações `PROJECAO` no cálculo de saldo (única exceção à regra geral "soma todos os status") — não reintroduzir esse filtro em outros tipos de conta.
