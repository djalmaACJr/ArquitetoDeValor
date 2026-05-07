# 🧠 Contexto para Assistente (Claude / VSCode)

> Use este arquivo como contexto principal. Para detalhes de arquitetura veja [`ARCHITECTURE.md`](./ARCHITECTURE.md). Para regras de negócio veja [`BUSINESS_RULES.md`](./BUSINESS_RULES.md).

---

## 📥 Carregamento de contexto

- **`CLAUDE.md`** é o contexto base padrão e é suficiente para a maioria das tarefas (UI, hooks, refactors localizados, bugs pontuais, testes, CI).
- **`BUSINESS_RULES.md`** deve ser lido **sob demanda** quando a tarefa envolver: recorrência de transações, antecipação de parcelas, par débito+crédito de transferências, escopo de edição (`SOMENTE_ESTE` / `ESTE_E_SEGUINTES` / `TODOS`), categorias protegidas ou cálculo de saldo.
- **`ARCHITECTURE.md`** deve ser lido **sob demanda** quando a tarefa envolver: criar novo módulo/endpoint, mexer em RLS/migrations, alterar contrato da API ou integrações entre camadas.
- Quando precisar ler um desses arquivos extras, avise antes de agir.

---

## 📌 Sobre o projeto

**Arquiteto de Valor** é uma aplicação web de gestão financeira pessoal.

Permite:

- Controle de contas (corrente, remuneração, cartão, investimento, carteira)
- Lançamento de receitas e despesas com recorrência
- Transferências entre contas (par débito + crédito)
- Organização hierárquica por categorias
- Dashboard, relatórios, importação/exportação Excel

---

## 🏗️ Stack

### Frontend (`FrontEnd/`)

- React **19** + Vite **8** (Rolldown) + TypeScript **6**
- Tailwind CSS 3
- React Router 7
- Radix UI (Dialog, Dropdown, Select, Tooltip)
- Chart.js 4 + react-chartjs-2
- Lucide React (ícones)
- **`@tanstack/react-query`** — cache + dedup + invalidação para `useContas`, `useCategorias`, `useLancamentos`, `useDashboard`, `useFiltrosSalvos`

### Backend (Supabase)

- PostgreSQL — schema próprio **`arqvalor`** (não `public`)
- Edge Functions em **Deno + TypeScript** (`supabase/functions/`)
- Supabase Auth (JWT) + RLS por `user_id = auth.uid()`
- Trigger `auth.users → arqvalor.usuarios` cria contas e categorias seed automaticamente

### Testes

- **API**: Jest + ts-jest (raiz `tests/`)
- **E2E**: Playwright + Firefox (`FrontEnd/e2e/`)
- **CI**: GitHub Actions (`.github/workflows/`)

---

## 📁 Estrutura relevante

### Frontend — `FrontEnd/src/`

| Pasta | Conteúdo |
|---|---|
| `pages/` | `DashboardPage`, `LancamentosPage`, `ContasPage`, `CategoriasPage`, `RelatoriosPage`, `ImportExportPage`, `PerfilPage`, `LoginPage` |
| `components/layout/` | `AppLayout`, `Sidebar` |
| `components/ui/` | `DrawerLancamento`, `Calculadora`, `BotaoNovoLancamento`, `FiltrosSalvosBtn`, `IconeConta`, `MonthPicker`, `MultiSelect`, `AppVersion`, `shared` |
| `hooks/` | `useAuth`, `useCategorias`, `useContas`, `useDashboard`, `useLancamentos`, `useFiltrosSalvos`, `useTheme` |
| `context/` | `AuthContext`, `PageStateContext` (persiste filtros entre páginas) |
| `lib/` | `api.ts` (HTTP), `supabase.ts` (Auth), `utils.ts`, `constants.ts` (enums), `queryKeys.ts` (chaves do React Query), `logger.ts` (log condicional dev-only) |
| `types/index.ts` | Tipos compartilhados (`Conta`, `Transacao`, `Transferencia`, `Categoria`, …) — re-exporta enums de `lib/constants.ts` |

### Backend — `supabase/`

| Pasta | Conteúdo |
|---|---|
| `functions/_shared/` | `utils.ts` (CORS, JSON helpers, `db()`, `autenticar()`, `extrairId()`, validações), `logger.ts` |
| `functions/contas/` | CRUD de contas |
| `functions/categorias/` | CRUD de categorias hierárquicas |
| `functions/transacoes/` | CRUD + recorrência + `POST /:id/antecipar` |
| `functions/transferencias/` | Par débito + crédito atômico |
| `functions/filtros/` | CRUD de filtros nomeados por página (Dashboard, Extrato, Relatórios) |
| `functions/excluir_conta/` | Exclui todos os dados do usuário (chama `fn_excluir_dados_usuario`) |
| `functions/version/` | Endpoint de versão (introspecção) |
| `functions/limpar/` | Limpeza usada nos testes (reativa contas inativas para destravar UPDATE) |
| `migrations/` | DDL idempotente (schema, ENUMs, triggers, views, RLS, seed de usuário) |

### Testes

| Pasta | Conteúdo |
|---|---|
| `tests/` | Jest API: `01_contas`, `02_categorias`, `03_transacoes`, `04_transferencias`, `99_limpar` |
| `FrontEnd/e2e/tests/` | Playwright: contas, categorias, navegação, extrato, dashboard, relatórios |

---

## 🧠 Regras de domínio (resumo)

> Detalhe completo em [`BUSINESS_RULES.md`](./BUSINESS_RULES.md).

### Transações (`arqvalor.transacoes`)

- **Tipos** — `RECEITA` | `DESPESA`
- **Status** — `PAGO` | `PENDENTE` | `PROJECAO`
- **Recorrência** — `DIARIA` | `SEMANAL` | `MENSAL` | `ANUAL`
  - Quando recorrente: `id_recorrencia` + `nr_parcela` + `total_parcelas` + `tipo_recorrencia` (`PARCELA` ou `PROJECAO`)
  - Constraint do banco: os 3 campos devem estar **todos presentes ou todos nulos**
- **Edição/exclusão** com escopo: `SOMENTE_ESTE` | `ESTE_E_SEGUINTES` | `TODOS`
- **Antecipação** (`POST /transacoes/:id/antecipar`): consolida parcelas seguintes na atual, preserva `valor_projetado`

### Transferências

- Sempre criam **2 transações** ligadas por `id_par_transferencia`:
  - `DESPESA` na conta origem (descrição prefixada `[Transf. saída]`)
  - `RECEITA` na conta destino
- Categoria fixa **"Transferências"** (categoria pai com `protegida = true`)
- Suporta recorrência (parcelas em par)

### Categorias

- Hierarquia **pai → filho** (1 nível)
- Campo `protegida` (boolean) — `true` para "Transferências". Trigger `trg_proteger_categoria` permite alterar **somente `cor` e `icone`**; bloqueia DELETE e mudanças em `descricao`/`id_pai`/`ativa`.
- Banco bloqueia exclusão se houver subcategorias ou lançamentos vinculados.
- Inativar categoria pai cascateia: trigger `trg_cascata_inativar_subcategorias` inativa as filhas em sequência.

### Contas

- Tipos: `CORRENTE` | `REMUNERACAO` | `CARTAO` | `INVESTIMENTO` | `CARTEIRA`
- Cartão: campos opcionais `dia_fechamento` e `dia_pagamento` (1..31).
- Banco bloqueia exclusão se houver lançamentos (trigger `fn_bloquear_exclusao_conta`).
- Saldo calculado pela view `vw_saldo_contas` (= `saldo_inicial` + soma de receitas - despesas, somente `status = PAGO`).

---

## ⚠️ Pontos críticos

### 🔐 Segurança (RLS)

- Toda tabela tem `user_id` e policy `USING (user_id = auth.uid())`
- Edge Function nunca usa `service_role` para queries de usuário — usa o JWT do request via `db(req)`
- `dbAdmin()` (service_role) só para casos administrativos

### 🔁 Recorrência

- Escopo da alteração precisa ser respeitado
- Constraint `chk_parcela_consistente` impede inconsistências
- Antecipação altera `valor` e `total_parcelas` da parcela ancorada e remove as seguintes

### 🔄 Consistência de transferências

- Nunca pode existir só um lado do par (débito sem crédito ou vice-versa)
- Edição/exclusão precisa atualizar **ambos** os registros
- Quando recorrente, todos os pares da série compartilham `id_recorrencia`
- Trigger `trg_bloquear_exclusao_transf_avulsa` impede DELETE direto em `transacoes` que tenha `id_par_transferencia` quando a categoria é protegida — força uso do endpoint `/transferencias/:id_par`.

### 🔁 Validação de isolamento (trigger)

`fn_validar_isolamento_usuario` (trigger BEFORE INSERT OR UPDATE em `transacoes`) revalida posse de `conta_id`/`categoria_id` apenas:
- No **INSERT** (sempre);
- No **UPDATE** somente quando `conta_id` ou `categoria_id` é alterado.

Antes da migration `20260505000001`, qualquer UPDATE em `transacoes` revalidava — bloqueando reclassificações em conta inativa. Hoje você pode atualizar status/descricao/valor sem ativar a conta primeiro.

---

## 🧩 Padrões de código

### Frontend

- Lógica de negócio nos hooks `useX` — páginas só compõem UI
- Componentes em `components/ui` reutilizáveis
- Tipos centralizados em `src/types/index.ts`; enums em `src/lib/constants.ts` (re-exportados pelo types)
- Comunicação com API via `apiFetch` / `apiMutate` em `lib/api.ts`
  - Resposta padronizada: `{ ok, dados, erro, status }`
  - Header `Authorization: Bearer <jwt>` + `apikey`
- **Cache via React Query**: hooks de domínio usam `useQuery`/`useMutation` com chaves de `lib/queryKeys.ts`. Invalidação após mutation (`qc.invalidateQueries`). `staleTime: 30s`, `refetchOnWindowFocus: false`.
- **Logs**: `lib/logger.ts` expõe `log`/`debug`/`info` no-op em produção (tree-shake via `import.meta.env.DEV`). Use ao invés de `console.log` para debug. `console.warn`/`console.error` permanecem ativos.

### Backend (Edge Functions)

- Cada função: handler `Deno.serve` → `autenticar` → switch por método/rota → função privada
- Helpers do `_shared/utils.ts`:
  - `corsPreFlight()` para `OPTIONS`
  - `json(data, status)` / `erro(msg, status)`
  - `db(req)` cria cliente com schema `arqvalor` e JWT do usuário
  - `extrairId(req, recurso)` / `extrairAcao(req, recurso)`
  - `validarStatus`, `validarCor`, `validarFrequencia`, `calcularDataParcela`, `camposParaAtualizar`
- Logging via `_shared/logger.ts` (`logRequest`, `logResponse`, `logError`, …)
- Resposta padrão: `{ dados }` em sucesso, `{ erro }` em falha

---

## 🧪 Testes

### API (Jest) — `tests/`

| Arquivo | Cobertura |
|---|---|
| `01_contas.test.ts` | CA-CONTA01..19 |
| `02_categorias.test.ts` | CA-CAT01..13 |
| `03_transacoes.test.ts` | CA-TX01..28 |
| `04_transferencias.test.ts` | CA-TRF01..22 |
| `99_limpar.test.ts` | Limpeza pós-suite |

### E2E (Playwright) — `FrontEnd/e2e/tests/`

`01_contas`, `02_categorias`, `03_navegacao`, `04_extrato`, `05_dashboard`, `06_relatorios` (+ `auth.setup.ts`, `data.setup.ts`).
Roda no Firefox; relatório HTML em `FrontEnd/e2e/report/`.

---

## 🛠️ Como o assistente deve agir

### ✅ Deve

- Seguir a estrutura existente (pastas e padrões)
- Reutilizar hooks, helpers de `_shared/utils.ts` e tipos de `src/types`
- Manter consistência de `user_id` em **todas** as queries
- Considerar impacto em RLS, recorrência e pares de transferência
- Respeitar os ENUMs e constraints do banco
- Atualizar testes quando alterar comportamento

### ❌ Não deve

- Criar lógica duplicada (sempre olhar o `_shared/utils.ts` antes)
- Acessar tabelas diretamente do frontend — sempre via Edge Function
- Ignorar RLS ou usar `service_role` em código de usuário
- Quebrar o par débito + crédito de transferências
- Editar/excluir categoria com `protegida = true`
- Criar endpoints fora de `supabase/functions/`
- Usar schema `public` — todo SQL roda em `arqvalor`

---

## 📍 Onde implementar cada coisa

| Tipo de mudança    | Local                            |
| ------------------ | -------------------------------- |
| Nova tela          | `FrontEnd/src/pages/`            |
| Novo componente    | `FrontEnd/src/components/`       |
| Nova lógica frontend | `FrontEnd/src/hooks/`          |
| Novo tipo          | `FrontEnd/src/types/index.ts`    |
| Novo endpoint      | `supabase/functions/<modulo>/`   |
| Helper backend     | `supabase/functions/_shared/`    |
| Alteração de banco | `supabase/migrations/` (idempotente) |
| Teste API          | `tests/`                         |
| Teste E2E          | `FrontEnd/e2e/tests/`            |

---

## 🚀 Comandos úteis

### Frontend

```bash
cd FrontEnd
npm run dev          # http://localhost:5173
npm run build
npm run lint
```

### Testes API

```bash
# raiz do projeto
npx jest --runInBand
# ou via menu interativo
./rodar_testes.bat
```

### Testes E2E

```bash
cd FrontEnd
npm run test:e2e          # headless
npm run test:e2e:ui       # modo visual (debug)
npm run test:e2e:report   # abre relatório HTML
# ou via menu interativo
./rodar_testes_e2e.bat
```

### Deploy Edge Functions

```bash
supabase functions deploy --project-ref SEU_PROJECT_REF
```

---

## 🔧 Variáveis de ambiente

### `FrontEnd/.env`

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=...
```

### `tests/.env` (ou raiz)

```env
SUPABASE_URL=...
SUPABASE_ANON_KEY=...
TEST_EMAIL=...
TEST_PASSWORD=...
```

### Edge Functions (Supabase secrets)

```
ALLOWED_ORIGIN=https://seu-dominio.com   # CORS em produção
```

---

## 📌 Observações finais

- Projeto em desenvolvimento ativo
- Priorizar clareza, consistência e manutenção
- Evitar overengineering — a regra simples é melhor que abstração precoce
- Sempre considerar impacto nos testes (API + E2E)
- Migrations devem ser **idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`, blocos `DO/EXCEPTION`)
