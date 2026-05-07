# 🏗️ Arquitetura do Sistema — Arquiteto de Valor

> Documento técnico complementar ao [`CLAUDE.md`](./CLAUDE.md). Detalha estrutura física, fluxos e contratos.

---

## 📌 Visão geral

Sistema cliente-servidor 100% serverless:

```
[ Browser ]
     │  HTTPS + JWT
     ▼
[ Edge Function (Deno/TS) ]      ← supabase/functions/<modulo>/
     │  PostgREST + RLS
     ▼
[ PostgreSQL — schema arqvalor ] ← supabase/migrations/
```

- **Frontend** apenas renderiza e orquestra; não toca tabelas diretamente.
- **Edge Functions** validam, autenticam, aplicam regras e leem/escrevem no banco usando o JWT do usuário.
- **PostgreSQL** garante consistência via constraints, triggers e RLS.

---

## 🔄 Fluxo de uma requisição

1. UI dispara `apiFetch('/transacoes')` em `FrontEnd/src/lib/api.ts`.
2. `getSession()` injeta `Authorization: Bearer <jwt>` + `apikey`.
3. Request bate em `https://<project>.functions.supabase.co/transacoes`.
4. Edge Function:
   - `corsPreFlight` se `OPTIONS`
   - `autenticar(req)` extrai `user_id` do JWT (sub)
   - `db(req)` cria `SupabaseClient` com `db: { schema: 'arqvalor' }` propagando o JWT
   - Roteamento manual por método + `extrairId/Acao`
   - Validações + chamada PostgREST
5. Postgres aplica `RLS` (`user_id = auth.uid()`) e constraints/triggers.
6. Resposta padronizada `{ dados }` ou `{ erro }`.

---

## 🎯 Frontend

### Stack

- React 19 (functional components + hooks)
- Vite 8 (Rolldown) + TypeScript 6
- Tailwind CSS 3
- React Router 7
- Radix UI (Dialog, Dropdown, Select, Tooltip)
- Chart.js 4 + react-chartjs-2
- Lucide React (ícones)
- **`@tanstack/react-query`** — cache e dedup de fetch para hooks de domínio

### Camadas

| Camada | Responsabilidade |
|---|---|
| `pages/` | Composição de UI por rota — sem regra de negócio |
| `components/layout/` | `AppLayout`, `Sidebar` — chrome da aplicação |
| `components/ui/` | Componentes reusáveis (`DrawerLancamento`, `Calculadora`, `MultiSelect`, `BotaoNovoLancamento`, `FiltrosSalvosBtn`, `IconeConta`, `MonthPicker`, …) |
| `hooks/` | Lógica de negócio + estado — todos baseados em `@tanstack/react-query` (`useLancamentos`, `useDashboard`, `useContas`, `useCategorias`, `useFiltrosSalvos`, `useAuth`, `useTheme`) |
| `context/` | `AuthContext` (sessão), `PageStateContext` (filtros persistidos entre páginas) |
| `lib/` | `api.ts` (HTTP), `supabase.ts` (Auth), `utils.ts`, `constants.ts` (enums centralizados), `queryKeys.ts` (chaves React Query), `logger.ts` (log condicional dev-only) |
| `types/` | Contratos TypeScript compartilhados — re-exporta enums de `constants.ts` |

### Cliente HTTP — `lib/api.ts`

Duas funções:

- `apiFetch<T>(path, signal?)` — GET
- `apiMutate<T>(path, method, body?)` — POST/PUT/DELETE

Retorno uniforme:

```ts
interface ApiResult<T> {
  ok:     boolean
  dados:  T | null
  erro:   string | null
  status: number
}
```

A API responde `{ dados }` em sucesso e `{ erro }` em falha — `apiFetch` desembala 1 nível (`data.dados ?? data`).

### Princípios

- Páginas são declarativas; estado mora nos hooks.
- Hooks expõem `{ dados, loading, erro, carregar, criar, editar, excluir, ... }` quando aplicável.
- Tipagem forte usando `src/types/index.ts`.
- **React Query**: configurado em `main.tsx` (`QueryClientProvider`) com `staleTime: 30s`, `refetchOnWindowFocus: false`, `retry: 1`. Cada hook usa `useQuery(queryKey)` e invalida via `qc.invalidateQueries(queryKey)` após mutation.
- **Logs**: usar `log()` / `debug()` de `lib/logger.ts` em vez de `console.log` — são no-op em produção via `import.meta.env.DEV` (tree-shaken pelo bundler).

---

## ⚙️ Backend — Edge Functions (Deno)

### Layout

```
supabase/functions/
├── _shared/
│   ├── utils.ts       # CORS, JSON, db(), autenticar(), extrairId/Acao, validações
│   └── logger.ts      # logRequest, logResponse, logError, logSuccess, logInfo, logWarn, logDebug
├── contas/index.ts
├── categorias/index.ts
├── transacoes/index.ts        # + version.ts
├── transferencias/index.ts
├── filtros/index.ts            # CRUD de filtros nomeados (Dashboard/Extrato/Relatórios)
├── excluir_conta/index.ts      # apaga todos os dados do usuário (chama fn_excluir_dados_usuario)
├── version/index.ts            # /version — endpoint de introspecção
└── limpar/index.ts             # usado em testes (reativa contas inativas antes do UPDATE/DELETE)
```

Cada função tem `deno.json` próprio (importmap).

### Padrão de handler

```ts
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsPreFlight();
  const auth = autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;

  const id  = extrairId(req, "transacoes");
  const c   = db(req);          // cliente com schema arqvalor + JWT
  // switch por método/rota → chama função privada → json/erro
});
```

### Helpers críticos (`_shared/utils.ts`)

| Função | Uso |
|---|---|
| `corsPreFlight()` | Resposta 200 vazia para preflight `OPTIONS` |
| `json(data, status)` | Resposta JSON com headers CORS |
| `erro(msg, status)` | `{ erro: msg }` com status (default 400) |
| `db(req)` | `SupabaseClient` schema `arqvalor` + JWT do request |
| `dbAdmin()` | `SupabaseClient` `service_role` (bypassa RLS — uso restrito) |
| `getUserId(req)` | Extrai `sub` do JWT (base64url-safe) |
| `autenticar(req)` | `string` userId ou `Response 401` |
| `extrairId(req, recurso)` | UUID após `/<recurso>/` |
| `extrairAcao(req, recurso)` | Path segment após o id (`/<recurso>/:id/<acao>`) |
| `verificarExistencia(c, tabela, id, msg, userId?)` | Check 404 antes da operação |
| `validarCor`, `validarStatus`, `validarFrequencia` | Validações de domínio |
| `calcularDataParcela(base, freq, offset)` | Calcula data N períodos à frente |
| `camposParaAtualizar(body, campos)` | Filtra body para `update()` parcial |

### CORS

Origem configurável via secret:

```
supabase secrets set ALLOWED_ORIGIN=https://seu-dominio.com
```

Em dev fica `*`.

### Convenções de rota

| Método | Rota | Operação |
|---|---|---|
| GET | `/<recurso>` | Listar (filtros via querystring) |
| GET | `/<recurso>/:id` | Detalhar |
| POST | `/<recurso>` | Criar |
| PUT | `/<recurso>/:id` | Atualizar (escopo via `?escopo=` em recorrentes) |
| DELETE | `/<recurso>/:id` | Excluir (escopo via `?escopo=` em recorrentes) |
| POST | `/transacoes/:id/antecipar` | Antecipar parcelas seguintes |

---

## 🗄️ Banco de dados

### Schema

Tudo vive em **`arqvalor`** — `search_path` é configurado nas migrations. Extensions `uuid-ossp` e `pgcrypto`.

### ENUMs

| ENUM | Valores |
|---|---|
| `tipo_conta` | `CORRENTE`, `REMUNERACAO`, `CARTAO`, `INVESTIMENTO`, `CARTEIRA` |
| `tipo_transacao` | `RECEITA`, `DESPESA` |
| `status_transacao` | `PAGO`, `PENDENTE`, `PROJECAO` |
| `tipo_recorrencia` | `PARCELA`, `PROJECAO` |
| `intervalo_recorr` | `DIA`, `SEMANA`, `MES`, `ANO` |
| `escopo_recorr` | `SOMENTE_ESTE`, `ESTE_E_SEGUINTES`, `TODOS` |

### Tabelas

#### `usuarios`
`id (PK = auth.uid)`, `email UNIQUE`, `nome`, `criado_em`.

#### `contas`
`id`, `user_id → usuarios`, `nome (1..100)`, `tipo (tipo_conta)`, `saldo_inicial NUMERIC(15,2)`, `icone`, `cor (#RRGGBB)`, `ativa`, `dia_fechamento (1..31)`, `dia_pagamento (1..31)`, `criado_em`, `atualizado_em`.
Índices: `(user_id)`, `(user_id, ativa)`.
Colunas `dia_fechamento` / `dia_pagamento` adicionadas por `20260429000008`.

#### `categorias`
`id`, `user_id`, `id_pai → categorias`, `descricao (1..20)`, `icone`, `cor`, `ativa`, `protegida` (flag de bloqueio para "Transferências"), timestamps.
Índices: `(user_id)`, `(id_pai)`, `(user_id, ativa)`.
Coluna `protegida` adicionada por `20260429000008`.

#### `transacoes`
Campos principais:

```
id, user_id, conta_id, categoria_id, data,
ano_tx, mes_tx        -- generated columns
descricao (2..200), valor (>0),
tipo, status, valor_projetado,
id_recorrencia, nr_parcela, total_parcelas, tipo_recorrencia,
intervalo_recorrencia (>=1, opcional)  -- adicionada em 008, ainda não persistida pelos endpoints
id_par_transferencia,  -- liga DESPESA + RECEITA de uma transferência
observacao, criado_em, atualizado_em
```

Constraints:

- `chk_parcela_consistente` — os 4 campos de recorrência são todos NULL ou todos NOT NULL.
- `chk_nr_parcela_range` — `nr_parcela <= total_parcelas`.
- `valor > 0`, `valor_projetado > 0` quando presente.

Índices: `user_id`, `conta_id`, `categoria_id`, `data`, `status`, `id_recorrencia`, `criado_em`, listagem `(user_id, conta_id, data, criado_em)`, `(user_id, ano_tx, mes_tx)`, parcial `id_par_transferencia` (não-nulos).

#### `auditoria`
`id`, `user_id`, `tabela`, `registro_id`, `acao` (`INSERT|UPDATE|DELETE|ANTECIPAR`), `payload_old/new JSONB`, `ip`, `criado_em`.

#### `filtros_salvos`
`id`, `user_id → auth.users` (cascade DELETE), `pagina`, `nome`, `dados JSONB`, `criado_em`.
Restrições: `length(trim(nome)) > 0`, `length(trim(pagina)) > 0`.
Índice: `(user_id, pagina)`.
Tabela criada por `20260505000004_filtros_salvos.sql`.

### Funções

| Função | Tipo | Papel |
|---|---|---|
| `fn_set_atualizado_em` | trigger | Atualiza `atualizado_em = NOW()` em UPDATE |
| `fn_preservar_valor_projetado` | trigger | Quando `PROJECAO → PAGO`, preserva valor original em `valor_projetado` |
| `fn_validar_isolamento_usuario` | trigger | Garante que `conta_id` e `categoria_id` pertencem ao mesmo `user_id` (defesa em profundidade além da RLS) |
| `fn_bloquear_exclusao_conta` | trigger | Impede DELETE de conta com transações |
| `fn_bloquear_exclusao_categoria` | trigger | Impede DELETE de categoria com filhos ou lançamentos |
| `fn_antecipar_parcelas(p_transacao_id, p_user_id)` | RPC | Soma valores das parcelas seguintes na atual, ajusta `total_parcelas`, salva `valor_projetado`, deleta as seguintes |
| `fn_saldo_conta_ate(p_conta_id, p_ate)` | SQL stable | Saldo da conta até timestamp |
| `fn_sincronizar_usuario` | trigger AFTER INSERT em `auth.users` | Cria `arqvalor.usuarios` + contas seed (Carteira, Nubank, Inter, C6) + categorias pai/filho seed (Moradia, Alimentação, Transporte, Saúde, Renda, Transferências) |
| `fn_remover_usuario` | trigger BEFORE DELETE em `auth.users` | Remove `arqvalor.usuarios` (cascade nas demais via FK) |

### Triggers

```
trg_contas_atualizado_em        BEFORE UPDATE  contas
trg_categorias_atualizado_em    BEFORE UPDATE  categorias
trg_transacoes_atualizado_em    BEFORE UPDATE  transacoes
trg_preservar_valor_projetado   BEFORE UPDATE  transacoes
trg_validar_isolamento_usuario  BEFORE I/U     transacoes
trg_bloquear_exclusao_conta     BEFORE DELETE  contas
trg_bloquear_exclusao_categoria BEFORE DELETE  categorias
trg_sincronizar_usuario         AFTER  INSERT  auth.users   (SECURITY DEFINER)
trg_remover_usuario             BEFORE DELETE  auth.users   (SECURITY DEFINER)
```

### Views

| View | Para que serve |
|---|---|
| `vw_saldo_contas` | Lista de contas + `movimentacao` + `saldo_atual` (consumido por `GET /contas`) |
| `vw_transacoes_com_saldo` | Transações + nomes/ícones de categoria/conta + `saldo_acumulado` (window function por conta) — usada quando `GET /transacoes?saldo=true` |
| `vw_resumo_mensal` | Entradas, saídas e resultado por mês (dashboard) |
| `vw_despesas_por_categoria` | Total e percentual por categoria pai por mês (dashboard/relatórios) |

### Row Level Security

Habilitada em **todas** as tabelas de domínio. Policy padrão:

```sql
USING      (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
```

Auditoria tem apenas `USING` (somente leitura para o dono).

### Migrations

Em `supabase/migrations/`:

- `20260403000001_criacao.sql` — schema, ENUMs, tabelas, funções, triggers, views, RLS
- `20260403000002_criacao_usuario.sql` — usuário `arqvalor_api` + grants
- `20260403000003_sincronizar_usuarios.sql` — sync `auth.users`, seed de contas/categorias
- `20260403000005_grants_gerais.sql` — grants gerais

**Todas idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`, blocos `DO/EXCEPTION`, `DROP POLICY/TRIGGER IF EXISTS`).

---

## 🔐 Segurança

| Camada | Mecanismo |
|---|---|
| Identidade | Supabase Auth (email/senha + JWT) |
| Autorização | RLS por `user_id = auth.uid()` em todas as tabelas |
| Defesa em profundidade | Trigger `fn_validar_isolamento_usuario` valida posse de `conta_id`/`categoria_id` |
| CORS | `ALLOWED_ORIGIN` via secret em produção |
| Edge Function | Sempre usa `db(req)` (JWT), nunca `service_role` em código de usuário |
| Frontend | Nunca armazena `service_role`; só `anon_key` pública |

---

## ⚠️ Pontos de atenção

- **Transferências** exigem consistência dupla — o lado que falhar deixa par órfão; tratar como transação atômica.
- **Recorrência** propaga em série; sempre respeitar o `escopo` recebido.
- **Antecipação** é destrutiva para parcelas seguintes (DELETE) — registrar em auditoria.
- **Categorias protegidas** (`protegida = true`, ex.: "Transferências") não podem ser editadas ou excluídas — frontend e backend devem validar.
- **Soft delete vs hard delete** — contas/categorias têm `ativa` (soft); transações são removidas (hard) com escopo.
- **`atualizado_em`** é gerenciado por trigger — não setar manualmente.
- **Generated columns** `ano_tx`/`mes_tx` aceleram filtros mensais — usar nas queries quando possível.

---

## 🧪 Ambiente de testes

- Jest roda contra Supabase real usando `TEST_EMAIL`/`TEST_PASSWORD`.
- Suite `99_limpar` chama `functions/limpar` para zerar dados ao fim.
- E2E precisa do frontend rodando em `http://localhost:5173`; auth state em `FrontEnd/fixtures/auth.json` é gerado por `auth.setup.ts`.
- CI executa testes API via GitHub Actions (`.github/workflows/tests.yml`).
