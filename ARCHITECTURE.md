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
| `components/ui/` | Componentes reusáveis (`DrawerLancamento`, `Calculadora`, `MultiSelect`, `BotaoNovoLancamento`, `BotaoOcultar`, `FiltrosSalvosBtn`, `IconeConta`, `MonthPicker`, `ModalLembrete`, `CalendarioDashboard`, …) |
| `hooks/` | Lógica de negócio + estado — todos baseados em `@tanstack/react-query` (`useLancamentos`, `useDashboard`, `useContas`, `useCategorias`, `useFiltrosSalvos`, `useLembretes`, `useAssistente`, `useOcultarValores`, `useAuth`, `useTheme`) |
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
├── lembretes/index.ts          # CRUD de lembretes (avulsos ou vinculados a lançamentos)
├── assistente/index.ts         # sugestões de lançamento por ILIKE na descrição
├── filtros/index.ts            # CRUD de filtros nomeados (Dashboard/Extrato/Relatórios)
├── excluir_conta/index.ts      # apaga todos os dados do usuário (chama fn_excluir_dados_usuario)
├── version/index.ts            # /version — endpoint de introspecção
├── ia_configs/index.ts         # CRUD de configs de IA do usuário; criptografa api_key (AES-256-GCM); POST /:id/ping testa credencial
├── chat_mascote/index.ts       # proxy autenticado para o provedor escolhido — recebe contexto opcional (texto + screenshot)
├── _shared/cripto.ts           # helpers AES-256-GCM (Web Crypto) usando o secret IA_KEYS_ENCRYPTION_KEY
├── objetivos/index.ts          # CRUD de objetivos (SONHO/OBJETIVO/PROJETO/CRESCIMENTO) + POST /sincronizar-progresso
├── investimentos/index.ts      # ~6.500 linhas — maior função do sistema; ver seção "Investimentos" abaixo
├── faturas/
│   ├── index.ts                 # sessão de importação de fatura (upload → parse → revisão → confirmação)
│   └── parsers/                 # nubank.ts, c6.ts, inter.ts, mercadopago.ts, generico.ts, helpers.ts, tipos.ts, index.ts (dispatcher)
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
| `tipo_objetivo` | `SONHO`, `OBJETIVO`, `PROJETO`, `CRESCIMENTO` |
| `status_objetivo` | `EM_PROGRESSO`, `ATINGIDO`, `CANCELADO` |
| `tipo_ativo_inv` | `ACOES`, `ETF`, `FII`, `STOCKS`, `ETF_INTERNACIONAL`, `RENDA_FIXA`, `CRIPTOMOEDAS`, `TESOURO_DIRETO` — ⚠️ o código (Edge Function e frontend) também referencia `REIT`, que **não existe** neste ENUM (ver "Pontos de atenção") |
| `status_posicao_inv` | `ATIVA`, `ENCERRADA` |
| `tipo_operacao_inv` | `COMPRA`, `VENDA`, `APORTE`, `RESGATE`, `DIVIDENDO`, `RENDIMENTO` (adicionado por `20260625000004`) |
| `subtipo_rf` | `TESOURO`, `CDB`, `LCI`, `LCA`, `CRI`, `CRA`, `DEBENTURE`, `OUTRO` |
| `indexador_rf` | `PREFIXADO`, `POS_FIXADO`, `HIBRIDO` |
| `indice_rf` | `CDI`, `SELIC`, `IPCA`, `IGPM` |
| `categoria_fii` | `TIJOLO`, `PAPEL`, `FOF`, `DESENVOLVIMENTO`, `OUTRO` |
| `acoes_subtipo` | `ON`, `PN`, `UNIT`, `BDR` |

### Tabelas

#### `usuarios`
`id (PK = auth.uid)`, `email UNIQUE`, `nome`, `ocultar_valores BOOLEAN NOT NULL DEFAULT false`, `mascote_preferido TEXT` (nullable, sem default — `NULL` ⇒ primeiro acesso), `layout JSONB` (nullable, apelido do mascote + tema), `ia_preferencia TEXT` (provedor padrão), `ia_configs JSONB` (array de configs `{id,provedor,apelido,modelo,api_key_cripto}` — `api_key_cripto` é AES-256-GCM via secret `IA_KEYS_ENCRYPTION_KEY`), `data_nascimento DATE`, `tutoriais_vistos JSONB NOT NULL DEFAULT '{}'` (chaves `tour-<pagina>` / `tutorial-<pagina>-<mascote>`), `inv_perfil JSONB` (`{perfil, idade, idade_aposentadoria, suitability, atualizado_em}`), `inv_pesos_criterio JSONB` (`{FUNDAMENTOS, CRESCIMENTO, DIVIDENDOS, VALUATION}` somando 100, globais para todos os tipos de ativo), `inv_avaliacao_agenda JSONB` (`{frequencia}` — preferência de UI, não dispara cron), `inv_dividendos_avisos JSONB` (avisos self-healing do cron BRL sobre tipo de provento sem categoria mapeada; auto-regenerado, fora do backup), `inv_dividendos_novidades JSONB` (resumo do que o cron BRL fez desde o último login; exibido 1x e descartado), `criado_em`.
Adições posteriores ao schema base (migrations `20260513..20260723`).

#### `contas`
`id`, `user_id → usuarios`, `nome (1..100)`, `tipo (tipo_conta)`, `saldo_inicial NUMERIC(15,2)`, `icone`, `cor (#RRGGBB)`, `ativa`, `dia_fechamento (1..31)`, `dia_pagamento (1..31)`, `limite_credito NUMERIC(15,2) (>= 0)`, `cartoes_virtuais JSONB NOT NULL DEFAULT '[]'` (array `{id, sufixo, apelido}`, só relevante para `tipo=CARTAO` — ver seção "Cartões virtuais" em `BUSINESS_RULES.md`), `criado_em`, `atualizado_em`.
Índices: `(user_id)`, `(user_id, ativa)`.
Colunas `dia_fechamento` / `dia_pagamento` adicionadas por `20260429000008`.
Coluna `limite_credito` adicionada por `20260522000001` (apenas relevante para `tipo = CARTAO`; backend zera para outros tipos).
Coluna `cartoes_virtuais` adicionada por `20260525000002` (array JSONB, sem tabela própria — não há FK em `transacoes`, o vínculo com uma compra é só informativo via `observacao` do item de fatura).
`vw_saldo_contas` foi recriada várias vezes para acompanhar essas mudanças (`limite_credito`, `cartoes_virtuais`, filtro `data <= CURRENT_DATE`, `ultima_movimentacao`, cartão ignora `PROJECAO` — ver seção Views).

#### `categorias`
`id`, `user_id`, `id_pai → categorias`, `descricao (1..50)`, `icone`, `cor`, `ativa`, `protegida` (flag de bloqueio para "Transferências"), timestamps.
Índices: `(user_id)`, `(id_pai)`, `(user_id, ativa)`.
Coluna `protegida` adicionada por `20260429000008`. Limite de `descricao` ampliado de 20 para 50 caracteres por `20260527000003`.

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

#### `filtros_salvos`
`id`, `user_id → auth.users` (cascade DELETE), `pagina`, `nome`, `dados JSONB`, `criado_em`.
Restrições: `length(trim(nome)) > 0`, `length(trim(pagina)) > 0`.
Índice: `(user_id, pagina)`.
Tabela criada por `20260505000004_filtros_salvos.sql`.

#### `lembretes`
`id`, `user_id → usuarios` (cascade DELETE), `data DATE`, `descricao (1..200)`, `status` (`PENDENTE` | `CONCLUIDO`), `lancamento_id → transacoes` (cascade DELETE, nullable), `criado_em`, `atualizado_em`.
Índice: `(user_id, data)`.
Trigger `trg_atualizar_lembrete` mantém `atualizado_em`.
Tabela criada por `20260511000001_lembretes.sql`.

#### `assistente_lancamentos`
`id`, `user_id → usuarios` (cascade DELETE), `descricao (2..200)`, `categoria_id → categorias` (ON DELETE SET NULL, nullable), `conta_origem_id → contas` (ON DELETE SET NULL, nullable), `conta_destino_id → contas` (ON DELETE SET NULL, nullable), `is_transferencia BOOLEAN NOT NULL DEFAULT FALSE`, `id_recorrencia_vinculo UUID` (nullable, adicionada por `20260530000001` — lembra a série de recorrência casada durante confirmação de fatura, para sugerir automaticamente a próxima parcela), `criado_em`, `atualizado_em`.
Constraint `chk_assistente_transf`: quando `is_transferencia = TRUE`, `conta_origem_id` e `conta_destino_id` são obrigatórios e distintos.
Índice único: `(user_id, lower(descricao))` — base do upsert por descrição.
Trigger `trg_assistente_atualizado_em` mantém `atualizado_em`.
Tabela criada por `20260511000002_assistente_lancamentos.sql`.

---

### 🎯 Tabelas — Objetivos

Migrations: `20260602000002` (criação) até `20260605000001` (mais recente). Detalhe de negócio completo em `BUSINESS_RULES.md`.

#### `objetivos`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `user_id` | UUID | FK `auth.users` cascade DELETE |
| `tipo` | `tipo_objetivo` | `SONHO` \| `OBJETIVO` \| `PROJETO` \| `CRESCIMENTO` |
| `nome` | VARCHAR(100) | |
| `descricao` | TEXT | nullable |
| `icone` | VARCHAR(50) | default `'target'` |
| `cor` | VARCHAR(7) | default `'#3b82f6'` |
| `ativo` | BOOLEAN | default true — soft delete |
| `valor_meta` | NUMERIC(15,2) | `> 0` (para CRESCIMENTO é um percentual, ex. `10` = 10%/ano) |
| `data_inicio` / `data_fim` | DATE | `data_fim >= data_inicio` (`chk_objetivos_data`) |
| `conta_id` | UUID FK `contas` SET NULL | legado, usado por SONHO single-conta |
| `categoria_id` | UUID FK `categorias` SET NULL | legado (OBJETIVO) / filtro opcional (PROJETO) |
| `contas_sonho` | UUID[] | NOT NULL DEFAULT `{}` — múltiplas contas do SONHO (`20260602000006`) |
| `categorias_objetivo` | UUID[] | NOT NULL DEFAULT `{}` — múltiplas categorias de OBJETIVO/CRESCIMENTO (`20260602000005`) |
| `contas_projeto` | UUID[] | NOT NULL DEFAULT `{}` — contas do orçamento PROJETO |
| `frequencia` | VARCHAR(10) | `DIARIA\|SEMANAL\|MENSAL\|ANUAL`, só OBJETIVO |
| `saldo_base` | NUMERIC | default 0 — saldo das contas do SONHO no dia anterior a `data_inicio` (`20260605000001`) |
| `valor_atingido` / `percentual` / `status` | NUMERIC / SMALLINT(0..100) / `status_objetivo` | **sempre calculados por trigger**, nunca setados pela API |
| `revisoes` | JSONB | default `[]` — histórico `{data, valor_meta_anterior, motivo}` a cada mudança de `valor_meta` |
| `criado_em` / `atualizado_em` | TIMESTAMPTZ | |

Índices: `user_id`, `tipo`, `status`, `data_fim`, `conta_id`/`categoria_id` (parciais).

#### `objetivos_progresso`
Snapshots diários: `id`, `objetivo_id → objetivos` cascade DELETE, `data_snapshot DATE`, `valor_atingido NUMERIC`, `percentual SMALLINT (0..100)`. `UNIQUE(objetivo_id, data_snapshot)`.

#### View `vw_objetivos_detalhes`
`security_invoker=true`. Junta `objetivos` com nome da conta/categoria, calcula `dias_restantes` e (desde `20260605000001`) `crescimento_mensal_necessario` (só SONHO em progresso: quanto falta crescer ÷ meses restantes).

---

### 💹 Tabelas — Investimentos

Módulo maior do sistema. Migrations principais: `20260609000001_investimentos_fundacao.sql` até `20260713000001_reparo_proventos_usd_e_dedup.sql` (mais as pendentes na raiz de `supabase/migrations/`, ver seção Migrations). Todas as tabelas de usuário têm RLS padrão (`user_id = auth.uid()`) e são apagadas por `fn_excluir_dados_usuario`.

#### `inv_ativos`
`id`, `user_id`, `ticker VARCHAR(20)`, `nome VARCHAR(120)`, `tipo_ativo (tipo_ativo_inv)`, `moeda VARCHAR(3) DEFAULT 'BRL'`, `descricao`, `nota_usuario NUMERIC(4,2) (0..10)`, `ativo_pai → inv_ativos` (agrupamento), `logo_url`, `setor TEXT` (bruto em inglês, via brapi), `questionario_respostas JSONB` (`{pergunta_id: índice 0..4}`).
Campos condicionais por tipo: **Renda Fixa** — `rf_subtipo`, `rf_indexador`, `rf_indice (indice_rf)`, `rf_percentual_indice NUMERIC(7,3)` (ex. 110 = 110% do CDI), `rf_taxa_fixa NUMERIC(7,3)` (spread/prefixado), `rf_taxa VARCHAR(40)` (texto livre legado), `rf_emissor`, `rf_vencimento DATE`, `rf_garantia_fgc`, `rf_isento_ir`. **FII** — `fii_categoria (categoria_fii)`. **Ações** — `acoes_subtipo (acoes_subtipo)`. **Cripto** — `cripto_rendimento_aa NUMERIC(8,4)` (%a.a.), `cripto_rendimento_inicio DATE` (default = 1º aporte), `cripto_rendimento_periodicidade` (`DIARIA|SEMANAL|MENSAL`, só afeta a base de composição — materialização é sempre semanal).
`UNIQUE(user_id, ticker)`.
⚠️ Código referencia tipo `REIT` que não existe em `tipo_ativo_inv` — ver "Pontos de atenção".

#### `inv_alocacoes_tipo`
Metas de alocação (%) por tipo de ativo: `user_id`, `tipo_ativo`, `percentual_ideal NUMERIC(5,2) (0..100)`. `UNIQUE(user_id, tipo_ativo)`. Soma 100% validada só na API.

#### `inv_posicoes`
`id`, `user_id`, `ativo_id → inv_ativos`, `conta_id → contas RESTRICT`, `quantidade NUMERIC(20,8) >=0`, `preco_custo NUMERIC(20,8) >=0`, `valor_custo NUMERIC(20,2)` (recalculado por trigger `trg_inv_posicao_valor_custo`), `data_compra DATE`, `status (status_posicao_inv)`.
Desde `20260623000001`: **a posição é a soma das suas operações** — `quantidade`/`preco_custo`/`data_compra`/`status` são recomputados a cada mutação de `inv_operacoes` (função `recomputarPosicao` na Edge Function, não trigger de banco).

#### `inv_operacoes`
`id`, `user_id`, `posicao_id → inv_posicoes` cascade DELETE, `tipo_operacao (tipo_operacao_inv)`, `conta_id`, `quantidade NUMERIC(20,8) >=0`, `preco_unitario NUMERIC(20,8)`, `valor_total NUMERIC(20,2)`, `data_operacao DATE`.
`RENDIMENTO` (cripto) sempre tem `preco_unitario=0`/`valor_total=0` — crédito de tokens a custo zero.

#### `inv_dividendos`
`id`, `user_id`, `ativo_id → inv_ativos` cascade, `conta_id → contas RESTRICT`, `valor NUMERIC(20,2) >=0`, `data_pagamento DATE`, `tipo_ativo` (cópia desnormalizada), `tipo_dividendo_id → inv_tipos_dividendo` SET NULL, `descricao`, `valor_por_cota NUMERIC(20,8)` (dividendo/rate por cota — base do DY/YoC, `NULL` em lançamentos antigos até backfill), `transacao_extrato_id → transacoes` SET NULL.

#### `inv_historico_mensal`
Snapshot mensal por (ativo, conta): `ativo_id`, `conta_id`, `mes_ano CHAR(7)` (`YYYY-MM`), `valor_mercado`, `quantidade`, `preco_medio`, `variacao_percentual`, `rentabilidade_mes`. `UNIQUE(ativo_id, conta_id, mes_ano)`.

#### `inv_tipos_dividendo`
`user_id`, `nome VARCHAR(40)`, `categoria_id → categorias` SET NULL, `ativo BOOLEAN`. `UNIQUE(user_id, nome)` (dedup em `20260629000001`). Seed automático de 4 tipos por novo usuário (trigger `trg_seed_tipos_dividendo`): **"Aluguel de FII", "JSCP", "Dividendos", "Rend. Trib."**.

#### `inv_questionarios`
Questionário customizado por tipo de ativo: `user_id`, `tipo_ativo`, `perguntas JSONB` (array `{id, texto, criterio, opcoes[5]}`), `pesos JSONB` (legado), `origem ('MANUAL'|'IA')`, `ia_provedor`, `ia_modelo`, `ia_gerou_em`. `UNIQUE(user_id, tipo_ativo)`.

#### `inv_avaliacoes`
Avaliação consolidada por ativo (mentores IA): `user_id`, `ativo_id → inv_ativos` cascade, `nota_final NUMERIC(4,2) (0..10)`, `consenso JSONB` (pesos + perguntas + respostas por mentor), `historico JSONB` (até 24 entradas `{gerado_em, nota_final, criterios}`), `gerado_em`. `UNIQUE(user_id, ativo_id)` — upsert por ativo.

#### `inv_proventos_fundo`
Cache do histórico de distribuição **por cota do fundo** (independente da posse do usuário): `ativo_id → inv_ativos` cascade, `data_pagamento`, `label` (rótulo bruto da B3), `valor_por_cota NUMERIC(20,8) >0`. `UNIQUE(ativo_id, data_pagamento, label)`. Fora do backup/restore (cache reconstruível). Usada para o DY/YoC cobrir 12 meses completos mesmo com posição há menos de 1 ano.

#### `inv_etf_holdings`
Cache compartilhado (sem `user_id`) de composição de ETF: PK `(etf_ticker, holding_ticker)`, `holding_nome`, `peso NUMERIC(9,4)`, `fonte ('B3'|'FMP')`. ⚠️ **Tabela órfã** — nenhuma rota de Edge Function nem componente do frontend lê/escreve esta tabela hoje (ver "Pontos de atenção").

#### Cotações compartilhadas (sem `user_id`, RLS: SELECT p/ `authenticated`, escrita só `service_role`)
| Tabela | PK | Conteúdo | Fonte |
|---|---|---|---|
| `cotacoes_ptax` | `data` | compra/venda USD-BRL | PTAX/Olinda (BCB) |
| `cotacoes_ativos` | `(ticker, mes_ano)` | preço mensal cacheado | brapi / Yahoo Finance / CoinGecko |
| `indices_economicos` | `(indice, competencia)` | `IPCA\|SELIC\|CDI` mensal (%) | SGS (BCB) |
| `cotacoes_tesouro` | `(tipo_titulo, vencimento, mes_ano)` | PU/taxa de venda (só títulos com marcação a mercado) | Tesouro Transparente (STN) |

#### View `vw_inv_ultimo_mercado`
`DISTINCT ON (user_id, ativo_id, conta_id)` sobre `inv_historico_mensal` ordenado por `mes_ano DESC` — só o snapshot mais recente por par.

---

### 🧾 Tabelas — Importação de fatura

⚠️ **Achado de integridade do repositório**: a migration fundacional `supabase/migrations/Aplicados/20260527000001_fatura_import.sql` está **corrompida no histórico do git** — seu conteúdo é a string literal `"f1 o"` (5 bytes) em todos os commits, incluindo o que a introduziu. O DDL original de `fatura_import_sessao`/`fatura_import_item` **não existe em nenhum arquivo versionado do repo**; o schema abaixo foi reconstruído por evidência indireta (migrations `ALTER` posteriores, código de `functions/faturas/index.ts`, tipos do frontend). Recomenda-se gerar uma migration de reconciliação (`CREATE TABLE IF NOT EXISTS` idempotente) para corrigir o drift entre o banco real e o repo.

#### `fatura_import_sessao` (schema reconstruído — ver aviso acima)
`id`, `user_id`, `conta_id → contas` (deve ser `tipo=CARTAO`, validado por trigger `trg_validar_conta_cartao_fatura` citado no código mas sem migration localizada), `arquivo_nome`, `vencimento_fatura DATE`, `valor_total NUMERIC`, `status` (`EM_ANALISE\|CONFIRMADA\|CANCELADA`), `observacao`, `modo_importacao VARCHAR(10)` (`NULL\|REGISTRO\|CATEGORIA`, `20260530000003`), `separar_por_cartao BOOLEAN` (`20260530000003`), timestamps. RLS `pol_fatura_sessao_user`.

#### `fatura_import_item` (schema reconstruído — ver aviso acima)
`id`, `sessao_id → fatura_import_sessao`, `user_id`, `data_compra`, `descricao`, `estabelecimento`, `valor NUMERIC` (sempre positivo), `tipo VARCHAR(10) DEFAULT 'DESPESA' CHECK IN ('RECEITA','DESPESA')` (`20260527000002`), `parcela_atual`/`parcela_total`, `decisao` (`PENDENTE\|CRIAR\|ATUALIZAR\|IGNORAR`), `categoria_sugerida_id`/`categoria_escolhida_id → categorias`, `transacao_existente_id`/`transacao_criada_id → transacoes`, `hash_match` (calculado, sem uso de dedup no código atual), `observacao` (usada também para guardar `"Cartão final <sufixo>"` do cartão virtual detectado no PDF), `grupo_chave TEXT` (`20260530000002` — separação manual de grupo no modo CATEGORIA, sobrevive a reload), `descricao_override TEXT` (`20260530000002`), timestamps. RLS `pol_fatura_item_user`. Índices de FK adicionados em `20260709000001`.

---

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
| `fn_sincronizar_usuario` | trigger AFTER INSERT em `auth.users` | Cria `arqvalor.usuarios` + contas seed (Carteira, Nubank, Inter, C6) + categorias pai/filho seed (Moradia, Alimentação, Transporte, Saúde, Renda, Transferências) + transações/transferência de exemplo (`20260716000001`) + `SET search_path` (`20260723000002`) |
| `fn_remover_usuario` | trigger BEFORE DELETE em `auth.users` | Remove `arqvalor.usuarios` (cascade nas demais via FK) |
| `fn_criar_transferencia(p_rows jsonb)` | RPC, `SECURITY INVOKER` | Insere **todas** as linhas do par (2 por parcela) num único `INSERT ... SELECT ... FROM jsonb_array_elements` — atomicidade via transação implícita. Chamada por `functions/transferencias`. Nome real da função **não** é `fn_criar_transferencia_atomica` (esse é só o nome do arquivo de migration) |
| `fn_excluir_transferencias(p_ids)` | RPC, `SECURITY INVOKER` | Desarma `id_par_transferencia` e apaga as transações do par/série numa única transação |
| `fn_criar_transacoes_com_dividendos(p_rows, p_dividendo)` | RPC, `SECURITY INVOKER` | Insere transação(ões) de provento e espelha `inv_dividendos` atomicamente |
| `fn_excluir_transacoes_e_dividendos(p_ids)` | RPC, `SECURITY INVOKER` | Exclusão atômica de transações + dividendos vinculados |
| `fn_saldo_total_antes_de(p_user_id, p_data)` | RPC, `SECURITY INVOKER` | Saldo **global** (todas as contas ativas) do usuário na véspera de uma data — otimização de `GET /transacoes?saldo=true`, evita window function cara em `vw_transacoes_com_saldo` |
| `fn_calcular_progresso_objetivo(p_objetivo_id)` | SQL stable, `SECURITY INVOKER` | Calcula `valor_atingido`/`percentual`/`status` de um objetivo conforme seu `tipo` |
| `fn_atualizar_progresso_objetivo` | trigger `BEFORE I/U` em `objetivos` | Grava o resultado de `fn_calcular_progresso_objetivo` (usa `NEW.*` direto, sem re-SELECT) |
| `fn_sincronizar_progresso_objetivo(p_user_id)` | RPC, `SECURITY INVOKER` | Recalcula todos os objetivos ativos do usuário em massa + grava snapshot do dia em `objetivos_progresso` (`POST /objetivos/sincronizar-progresso`) |
| `fn_saldo_contas_ate(p_contas UUID[], p_data)` | SQL stable | Saldo agregado de N contas até uma data — usada pelo cálculo de `saldo_base`/SONHO |
| `fn_seed_tipos_dividendo` | trigger AFTER INSERT em `auth.users` | Semeia os 4 tipos de dividendo padrão para o novo usuário |
| `fn_sync_dividendo_tipo_ativo` | trigger AFTER UPDATE OF `tipo_ativo` em `inv_ativos` | Propaga mudança de tipo para todos os `inv_dividendos` do ativo |
| `fn_dividendo_tipo_do_ativo` / `trg_dividendo_tipo_do_ativo` | trigger | Mantém `inv_dividendos.tipo_ativo` sincronizado no INSERT (achado de drift documentado em `20260709000001`) |
| `fn_seed_investimentos_exemplo` | trigger AFTER INSERT em `auth.users` (`trg_z_seed_investimentos_exemplo`, roda depois de `trg_sincronizar_usuario` por ordem alfabética) | Popula conta "XP Investimentos" + 2 ativos + posições/operações + histórico de exemplo para novo usuário |

### Triggers

```
trg_contas_atualizado_em              BEFORE UPDATE  contas
trg_categorias_atualizado_em          BEFORE UPDATE  categorias
trg_transacoes_atualizado_em          BEFORE UPDATE  transacoes
trg_preservar_valor_projetado         BEFORE UPDATE  transacoes
trg_validar_isolamento_usuario        BEFORE I/U     transacoes
trg_bloquear_exclusao_conta           BEFORE DELETE  contas
trg_bloquear_exclusao_categoria       BEFORE DELETE  categorias
trg_proteger_categoria                BEFORE U/D     categorias    (bloqueia edição além de cor/icone e DELETE de protegidas)
trg_cascata_inativar_subcategorias    AFTER  UPDATE  categorias    (inativa filhas quando pai inativado)
trg_bloquear_exclusao_transf_avulsa   BEFORE DELETE  transacoes    (força uso de /transferencias para pares protegidos)
trg_atualizar_lembrete                BEFORE UPDATE  lembretes
trg_assistente_atualizado_em          BEFORE UPDATE  assistente_lancamentos
trg_sincronizar_usuario               AFTER  INSERT  auth.users    (SECURITY DEFINER)
trg_remover_usuario                   BEFORE DELETE  auth.users    (SECURITY DEFINER)
trg_seed_tipos_dividendo              AFTER  INSERT  auth.users    (SECURITY DEFINER)
trg_z_seed_investimentos_exemplo      AFTER  INSERT  auth.users    (SECURITY DEFINER, roda por último — prefixo "z_")
trg_sincronizar_usuario_update        AFTER  UPDATE  auth.users    (propaga nome/email para arqvalor.usuarios)
trg_inv_posicao_valor_custo           BEFORE I/U     inv_posicoes  (recalcula valor_custo)
trg_inv_questionario_touch            BEFORE UPDATE  inv_questionarios
trg_sync_dividendo_tipo_ativo         AFTER  UPDATE OF tipo_ativo  inv_ativos
trg_dividendo_tipo_do_ativo           BEFORE INSERT  inv_dividendos
trg_atualizar_progresso_objetivo      BEFORE I/U     objetivos
```

### Views

| View | Para que serve |
|---|---|
| `vw_saldo_contas` | Lista de contas + `movimentacao` + `saldo_atual` + `cartoes_virtuais` + `ultima_movimentacao` (consumido por `GET /contas`). Recriada diversas vezes: `limite_credito` (`20260522000001`), `cartoes_virtuais` (`20260525000002`), cartão ignora transações `PROJECAO` no saldo (`20260526000001`), filtro `data <= CURRENT_DATE` (`20260602000001`), coluna `ultima_movimentacao` (`20260625000001`) |
| `vw_transacoes_com_saldo` | Transações + nomes/ícones de categoria/conta + `saldo_acumulado` (window function por conta) — usada quando `GET /transacoes?saldo=true` |
| `vw_resumo_mensal` | Entradas, saídas e resultado por mês (dashboard) |
| `vw_despesas_por_categoria` | Total e percentual por categoria pai por mês (dashboard/relatórios) |
| `vw_objetivos_detalhes` | Objetivos + nome de conta/categoria + `dias_restantes` + `crescimento_mensal_necessario` |
| `vw_inv_ultimo_mercado` | Último snapshot de `inv_historico_mensal` por (usuário, ativo, conta) |

### ⏰ Cron jobs (`pg_cron` + `pg_net`)

Todos autenticam via header `x-cron-secret` (não JWT de usuário), lendo URL/secret do Vault, e rodam em bloco `DO/EXCEPTION` (não falham se `pg_cron`/Vault não estiverem prontos no ambiente).

| Job | Horário (UTC) | Rota chamada | Propósito |
|---|---|---|---|
| `snapshot-diario` | `0 1 * * 2-6` (≈22h BRT seg-sex, após fechamento B3) | `POST /investimentos/snapshot-cron` | Fecha posições de RF/Tesouro vencidas e grava snapshot mensal de valor de mercado (todos os usuários) |
| `dividendos-diario` | `0 9 * * *` (06h BRT) | `POST /investimentos/dividendos-cron` | Provisiona proventos futuros de ativos em USD (Polygon.io) |
| `dividendos-br-diario` | `30 9 * * *` (06h30 BRT) | `POST /investimentos/dividendos-cron-br` | Provisiona proventos futuros de ativos em BRL (B3, sem API key) |

A rota `/investimentos/rendimento-cripto-cron` existe na Edge Function mas **não foi encontrada migration de agendamento `pg_cron` para ela** — hoje só é acionada manualmente via `POST /investimentos/rendimento-cripto` (autenticado).

### Row Level Security

Habilitada em **todas** as tabelas de domínio. Policy padrão:

```sql
USING      (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
```

### Migrations

Convenção de pasta: `supabase/migrations/Aplicados/` guarda as migrations já aplicadas/arquivadas (~98 arquivos); migrations na raiz de `supabase/migrations/` são as mais recentes, presumivelmente já rodadas em produção mas ainda não "arquivadas" — **confirme com o time antes de assumir que ainda estão pendentes**. **Todas idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`, blocos `DO/EXCEPTION`, `DROP POLICY/TRIGGER IF EXISTS`).

⚠️ **Achado de integridade**: `Aplicados/20260527000001_fatura_import.sql` está corrompida (5 bytes, `"f1 o"`) em todo o histórico do git — ver seção "Tabelas — Importação de fatura".

#### Fundação e proteções (`Aplicados/`)

- `20260403000001_criacao.sql` — schema, ENUMs, tabelas base, funções, triggers, views, RLS
- `20260403000002_criacao_usuario.sql` — usuário `arqvalor_api` + grants
- `20260403000003_sincronizar_usuarios.sql` — sync `auth.users`, seed de contas/categorias
- `20260403000005_grants_gerais.sql` — grants gerais
- `20260429000006_excluir_conta_usuario.sql` — função `fn_excluir_dados_usuario` + endpoint `excluir_conta`
- `20260429000007_corrigir_security_invoker_views.sql` — `SECURITY INVOKER` nas views para respeitar RLS
- `20260429000008_schema_completo_protecoes.sql` — `dia_fechamento`/`dia_pagamento` em contas, `protegida` em categorias, `intervalo_recorrencia` em transações, triggers de proteção
- `20260505000001_fix_trigger_validar_isolamento.sql` — restringe revalidação de isolamento a INSERT e UPDATE com mudança de `conta_id`/`categoria_id`
- `20260505000002_garantir_ativa_categorias.sql` — corrige seed para marcar categorias raiz como ativas
- `20260505000003_cascata_inativar_subcategorias.sql` — trigger `trg_cascata_inativar_subcategorias`
- `20260505000004_filtros_salvos.sql` — tabela `filtros_salvos` + RLS
- `20260507000001_fix_security_warnings.sql` — corrige avisos de segurança do Supabase (search_path, SECURITY DEFINER)
- `20260511000001_lembretes.sql` — tabela `lembretes` + RLS + trigger `trg_atualizar_lembrete`
- `20260511000002_assistente_lancamentos.sql` — tabela `assistente_lancamentos` + RLS + índices + trigger
- `20260513000001_ocultar_valores_usuario.sql` — coluna `ocultar_valores BOOLEAN` em `usuarios`
- `20260517000001_layout_usuario.sql` — coluna `layout` (preferência de tema/layout) em `usuarios`
- `20260517000002_mascote_preferido.sql` — coluna `mascote_preferido` em `usuarios`
- `20260519000001_ia_preferencia_usuario.sql` — preferência de provedor de IA por usuário
- `20260519000002_apelidos_e_multi_ia.sql` — apelidos e múltiplas configurações de IA
- `20260521000001_ia_configs_criptografada.sql` — `ia_configs JSONB` com api_keys criptografadas (AES-256-GCM via secret `IA_KEYS_ENCRYPTION_KEY`)
- `20260522000001_limite_credito_cartao.sql` — coluna `limite_credito` em `contas` + recria `vw_saldo_contas`
- `20260522000002_fix_rls_saldos_contas_ate_data.sql` — **fix de segurança**: `fn_saldos_contas_ate_data` e `fn_saldo_conta_ate_data` viram `SECURITY INVOKER` com validação de `auth.uid()` (antes vazavam dados entre usuários)
- `20260522000003_fix_excluir_dados_usuario_completa.sql` — **fix duplo de exclusão**:
  - **Segurança crítica**: `fn_excluir_dados_usuario` agora valida `p_user_id = auth.uid()` e REVOKE EXECUTE para anon/public. Antes, qualquer chamador (até anônimo) podia apagar dados de outro usuário passando o UUID dele.
  - **Completude**: passa a apagar também `lembretes`, `filtros_salvos` e `assistente_lancamentos` (antes só removia `transacoes/categorias/contas/usuarios`, deixando órfãos).
  - Edge Function `excluir_conta` foi ajustada para propagar o JWT do usuário ao chamar a RPC (antes usava `service_role`, o que faria `auth.uid()` ser NULL e bloquearia a checagem).
- `20260522000004_saldo_sem_filtro_status.sql` — **arquivo vazio (0 bytes), migration no-op/placeholder**.
- `20260523000001_limpar_orfaos_e_fks.sql` — limpeza de órfãos, FK em `auditoria.user_id`, normalização de `filtros_salvos.user_id`, e bypass admin (`postgres`/`service_role`) na `fn_excluir_dados_usuario` para permitir cleanup operacional pelo SQL editor.
- `20260523000002_remover_tabela_auditoria.sql` — DROP da tabela `arqvalor.auditoria`. Estava criada desde o dia 1 sem produtor (nenhum trigger/função gravava nela, 0 registros em 7 semanas). `fn_excluir_dados_usuario` recriada sem o DELETE de auditoria.
- `20260525000001_tutoriais_vistos.sql` — coluna `tutoriais_vistos JSONB` em `usuarios`
- `20260525000002_cartoes_virtuais.sql` — coluna `cartoes_virtuais JSONB` em `contas` + recria `vw_saldo_contas`
- `20260525000003_sincronizar_nome_update.sql` — trigger `trg_sincronizar_usuario_update` (AFTER UPDATE em `auth.users`) propaga nome/email para `arqvalor.usuarios`
- `20260526000001_saldo_cartao_ignora_projecao.sql` — contas `CARTAO` ignoram transações `PROJECAO` no saldo; recria `vw_saldo_contas` e as funções `fn_saldos_contas_ate_data`/`fn_saldo_conta_ate_data`
- `20260527000001_fatura_import.sql` — ⚠️ **corrompida** (ver aviso acima); deveria criar `fatura_import_sessao`/`fatura_import_item`
- `20260527000002_fatura_import_tipo.sql` — coluna `tipo` (`RECEITA|DESPESA`) em `fatura_import_item`
- `20260527000003_categoria_descricao_50.sql` — amplia `categorias.descricao` de 20 para 50 caracteres
- `20260530000001_assistente_id_recorrencia_vinculo.sql` — coluna `id_recorrencia_vinculo` em `assistente_lancamentos`
- `20260530000002_fatura_import_grupo_persistencia.sql` — colunas `grupo_chave`/`descricao_override` em `fatura_import_item`
- `20260530000003_fatura_import_sessao_decisoes_fluxo.sql` — colunas `modo_importacao`/`separar_por_cartao` em `fatura_import_sessao`
- `20260530000004_preservar_projetado_em_pendente.sql` — estende `fn_preservar_valor_projetado` para também preservar em `PROJECAO → PENDENTE`
- `20260531000001_hardening_security_advisor.sql` — `SET search_path` em ~12 funções, revoga EXECUTE de funções sensíveis, remove duplicata órfã em `public`
- `20260531000002_hardening_security_delta.sql` — corrige remoção da duplicata em `public` e revoga `rls_auto_enable`
- `20260531000003_mascote_preferido_nullable.sql` — remove `NOT NULL`/`DEFAULT` de `mascote_preferido`/`layout` (necessário para o onboarding detectar primeiro acesso)

#### Objetivos (`Aplicados/`)

- `20260602000001_fix_vw_saldo_contas_data_atual.sql` — filtro `data <= CURRENT_DATE` em `vw_saldo_contas`
- `20260602000002_criar_objetivos.sql` — ENUMs `tipo_objetivo`/`status_objetivo`, tabelas `objetivos`/`objetivos_progresso`, funções de cálculo, view `vw_objetivos_detalhes`
- `20260602000003_fix_sonho_group_by.sql` — corrige erro de `GROUP BY` no cálculo do SONHO
- `20260602000004_fix_objetivo_calculo_media.sql` — OBJETIVO passa a calcular **média por período** (não total acumulado)
- `20260602000005_objetivo_multi_categorias.sql` — coluna `categorias_objetivo UUID[]`
- `20260602000006_sonho_multi_contas.sql` — coluna `contas_sonho UUID[]`
- `20260603000001_crescimento_objetivo.sql` — novo tipo `CRESCIMENTO` (ano-base fixo, só receita)
- `20260603000002_fix_view_objetivos_completo.sql` — reforça idempotência das colunas array + recria a view
- `20260603000003_crescimento_yoy.sql` — CRESCIMENTO passa a comparar ano atual vs. ano **anterior** (YoY)
- `20260603000004_crescimento_ytd.sql` — corte proporcional Year-to-Date no ano de comparação
- `20260603000005_crescimento_net.sql` — CRESCIMENTO passa a somar líquido (receita − despesa), não só receita
- `20260603000006_crescimento_comp_ytd.sql` — corrige assimetria do corte YTD entre os dois anos comparados
- `20260605000001_sonho_saldo_base.sql` — coluna `saldo_base` (SONHO mede crescimento desde o início, não saldo absoluto) + `crescimento_mensal_necessario` na view. ⚠️ Ao reescrever as funções, reintroduziu acidentalmente a versão **antiga** (sem YoY/YTD/NET) do cálculo de CRESCIMENTO — ver "Pontos de atenção"

#### Investimentos (`Aplicados/`)

- `20260609000001_investimentos_fundacao.sql` — ENUMs + tabelas `inv_ativos`, `inv_alocacoes_tipo`, `inv_posicoes`, `inv_operacoes`, `inv_dividendos`, `inv_historico_mensal`
- `20260609000002_investimentos_dividendos_extrato.sql` — tabela `inv_tipos_dividendo` + seed automático de 4 tipos + coluna `tipo_dividendo_id`
- `20260610000001_inv_questionario.sql` — coluna `questionario_respostas` em `inv_ativos`
- `20260610000002_inv_renda_fixa.sql` — ENUMs `subtipo_rf`/`indexador_rf` + colunas `rf_*` em `inv_ativos`
- `20260610000003_inv_fii_categoria.sql` — ENUM `categoria_fii` + coluna `fii_categoria`
- `20260611000001_inv_acoes_subtipo.sql` — ENUM `acoes_subtipo` + coluna `acoes_subtipo`
- `20260611000002_cotacoes_ptax.sql` — tabela compartilhada `cotacoes_ptax`
- `20260613000001_cotacoes_ativos.sql` — tabela compartilhada `cotacoes_ativos`
- `20260613000001_sync_dividendo_tipo_ativo.sql` — backfill pontual de `inv_dividendos.tipo_ativo`
- `20260613000002_cron_snapshot_diario.sql` — job `pg_cron` `snapshot-diario`
- `20260613000003_tipo_reit.sql` — (ver "Pontos de atenção" quanto a `REIT` não estar no ENUM do banco)
- `20260613000004_cotacao_automatica.sql`
- `20260614000001_trg_sync_dividendo_tipo_ativo.sql` — trigger permanente equivalente ao backfill de `20260613000001`
- `20260614000002_inv_logo_url.sql` — coluna `logo_url`
- `20260614000003_inv_setor.sql` — coluna `setor`
- `20260615000001_indices_economicos.sql` — tabela compartilhada `indices_economicos` (IPCA/SELIC/CDI)
- `20260615000002_indices_cdi.sql`
- `20260615000002_sync_transacao_dividendo.sql`
- `20260615000003_cotacoes_tesouro.sql` — tabela compartilhada `cotacoes_tesouro`
- `20260615000004_cron_dividendos.sql` — job `pg_cron` `dividendos-diario` (USD)
- `20260616000001_cron_dividendos_br.sql` — job `pg_cron` `dividendos-br-diario` (BRL)
- `20260616000002_usuarios_inv_dividendos_avisos.sql` — coluna `inv_dividendos_avisos` em `usuarios`
- `20260616000003_usuarios_inv_dividendos_novidades.sql` — coluna `inv_dividendos_novidades` em `usuarios`
- `20260616000004_vw_inv_ultimo_mercado.sql` — view `vw_inv_ultimo_mercado`
- `20260616000005_usuarios_inv_perfil.sql` — coluna `inv_perfil` em `usuarios`
- `20260616000006_inv_questionarios.sql` — tabela `inv_questionarios`
- `20260616000006_usuarios_data_nascimento.sql` — coluna `data_nascimento` em `usuarios`
- `20260616000007_usuarios_inv_pesos_criterio.sql` — coluna `inv_pesos_criterio` em `usuarios`
- `20260618000001_inv_avaliacoes.sql` — tabela `inv_avaliacoes`
- `20260618000002_inv_avaliacao_historico_agenda.sql` — colunas `historico` (em `inv_avaliacoes`) e `inv_avaliacao_agenda` (em `usuarios`)
- `20260619000001_inv_rf_indice.sql` — ENUM `indice_rf` + colunas `rf_indice`/`rf_percentual_indice`/`rf_taxa_fixa`
- `20260620000001_inv_etf_holdings.sql` — tabela `inv_etf_holdings` (⚠️ órfã, ver "Pontos de atenção")
- `20260623000001_inv_operacao_baseline.sql` — migra para o modelo "posição = soma das operações"; semeia baseline para posições pré-existentes
- `20260625000001_vw_saldo_contas_ultima_movimentacao.sql` — coluna `ultima_movimentacao` em `vw_saldo_contas`
- `20260625000002_inv_resync_operacao_baseline.sql` — fecha lacunas do baseline anterior
- `20260625000003_inv_dividendos_valor_por_cota.sql` — coluna `valor_por_cota` (base do DY/YoC)
- `20260625000004_inv_cripto_rendimento.sql` — coluna `cripto_rendimento_aa` + valor `RENDIMENTO` no ENUM de operação
- `20260625000005_cron_rendimento_cripto.sql`
- `20260625000006_inv_cripto_rendimento_config.sql` — colunas `cripto_rendimento_inicio`/`cripto_rendimento_periodicidade`
- `20260629000001_inv_tipos_dividendo_dedup.sql` — dedup + `UNIQUE(user_id, nome)` em `inv_tipos_dividendo`
- `20260705000001_limpar_proventos_ano_9999.sql` — limpa proventos com data-sentinela "a definir" da B3
- `20260707000001_inv_proventos_fundo.sql` — tabela `inv_proventos_fundo` (cache de distribuição por cota do fundo)
- `20260709000001_hardening_advisors_supabase.sql` — hardening geral (ver seção Segurança) + índices de FK + ~55 policies reescritas com `(select auth.uid())`
- `20260709000002_fn_saldo_total_antes_de.sql` — função `fn_saldo_total_antes_de` (otimização do saldo global em Transações)
- `20260713000001_reparo_proventos_usd_e_dedup.sql` — corrige proventos USD gravados sem conversão PTAX + dedup de proventos B3 duplicados

#### Pendentes na raiz de `supabase/migrations/` (não movidas para `Aplicados/`)

- `20260713000002_fn_criar_transferencia_atomica.sql` — cria `fn_criar_transferencia(p_rows jsonb)` (nome real da função, apesar do nome do arquivo)
- `20260714000001_fix_excluir_dados_usuario_sem_superuser.sql` — troca `session_replication_role` (exige superusuário, falha no Supabase hospedado) por `DISABLE/ENABLE TRIGGER USER`; completa exclusão incluindo `fatura_import_*` e ordem correta de subcategorias
- `20260716000001_seed_lancamentos_exemplo.sql` — `fn_sincronizar_usuario` passa a popular transações + 1 transferência de exemplo para usuário novo
- `20260722000001_fn_atomicas_transacoes_dividendos.sql` — atualiza `fn_criar_transferencia` (inclui `observacao`) + cria `fn_criar_transacoes_com_dividendos`, `fn_excluir_transacoes_e_dividendos`, `fn_excluir_transferencias`
- `20260723000001_seed_investimentos_exemplo.sql` — `fn_seed_investimentos_exemplo` + trigger `trg_z_seed_investimentos_exemplo` (dados de exemplo de investimentos para usuário novo)
- `20260723000002_fn_sincronizar_usuario_search_path.sql` — adiciona `SET search_path` em `fn_sincronizar_usuario`

---

## 🔐 Segurança

| Camada | Mecanismo |
|---|---|
| Identidade | Supabase Auth (email/senha + JWT) |
| Autorização | RLS por `user_id = auth.uid()` em todas as tabelas |
| Defesa em profundidade | Trigger `fn_validar_isolamento_usuario` valida posse de `conta_id`/`categoria_id` |
| CORS | `ALLOWED_ORIGIN` via secret em produção |
| Edge Function | Sempre usa `db(req)` (JWT), nunca `service_role` em código de usuário |
| RPCs com user_id | Funções que aceitam `p_user_id` ou `p_conta_id` (`fn_saldos_contas_ate_data`, `fn_saldo_conta_ate_data`, `fn_excluir_dados_usuario`) validam contra `auth.uid()` e levantam `ACESSO_NEGADO` em caso de divergência. `fn_excluir_dados_usuario` adicionalmente revoga EXECUTE de anon/public |
| RPCs atômicas `SECURITY INVOKER` | `fn_criar_transferencia`, `fn_excluir_transferencias`, `fn_criar_transacoes_com_dividendos`, `fn_excluir_transacoes_e_dividendos`, `fn_sincronizar_progresso_objetivo` — rodam com o JWT do chamador (RLS/triggers de isolamento continuam valendo), `REVOKE ALL FROM PUBLIC` + `GRANT` só para `authenticated`/`service_role` |
| Cron jobs | Rotas `*-cron` da função `investimentos` não passam por JWT — autenticam via header `x-cron-secret` (valor no Vault do Supabase), chamadas só via `pg_net` a partir de `pg_cron` |
| IA (chat/mentores) | `api_key` de cada provedor nunca sai em texto puro do banco — AES-256-GCM via `IA_KEYS_ENCRYPTION_KEY`. Avaliação por mentores (`/investimentos/avaliacoes/*`) usa as mesmas credenciais do usuário, chamadas feitas client-side (uma por mentor × ativo) |
| Frontend | Nunca armazena `service_role`; só `anon_key` pública |

---

## ⚠️ Pontos de atenção

- **Transferências** exigem consistência dupla — a criação/exclusão do par já é atômica via RPC (`fn_criar_transferencia`/`fn_excluir_transferencias`), mas qualquer código novo que manipule `transacoes` com `id_par_transferencia` diretamente (fora desses endpoints) pode deixar par órfão.
- **Recorrência** propaga em série; sempre respeitar o `escopo` recebido.
- **Antecipação** é destrutiva para parcelas seguintes (DELETE) — sem possibilidade de undo.
- **Categorias protegidas** (`protegida = true`, ex.: "Transferências") não podem ser editadas ou excluídas — frontend e backend devem validar.
- **Soft delete vs hard delete** — contas/categorias têm `ativa` (soft); transações são removidas (hard) com escopo; **objetivos** também usam soft delete (`ativo=false` → trigger seta `status=CANCELADO`, sem DELETE físico via API).
- **`atualizado_em`** é gerenciado por trigger — não setar manualmente.
- **Generated columns** `ano_tx`/`mes_tx` aceleram filtros mensais — usar nas queries quando possível.
- **Migration corrompida**: `Aplicados/20260527000001_fatura_import.sql` não reflete o schema real de `fatura_import_sessao`/`fatura_import_item` — qualquer alteração nessas tabelas deve primeiro reconciliar o repo com uma migration `CREATE TABLE IF NOT EXISTS` baseada no schema real do banco.
- **`tipo_ativo_inv` incompleto**: código (Edge Function `investimentos` e frontend) referencia o tipo `REIT`, que **não existe** no ENUM do banco — tratar como feature incompleta/planejada ao mexer em tipos de ativo, não como suportado.
- **`inv_etf_holdings` é uma tabela órfã**: schema criado (`20260620000001`) mas nenhuma rota de Edge Function nem componente do frontend lê/escreve nela hoje — não assumir que decomposição de ETF está implementada.
- **Regressão conhecida em Objetivos tipo CRESCIMENTO**: a migration `20260605000001_sonho_saldo_base.sql`, ao reescrever as funções de cálculo, reintroduziu a versão **antiga** do bloco CRESCIMENTO (ano-base fixo, só receita bruta, sem cutoff YTD), descartando as melhorias de `20260603000003..006` (YoY/YTD/líquido). O valor gravado no banco (`objetivos.valor_atingido`/`percentual`/`status`) usa essa versão simples, enquanto a tela `ObjetivoDetalhe.tsx` recalcula no client a versão completa (YoY+YTD+líquido) — os dois números podem divergir para o mesmo objetivo. Antes de "corrigir", confirmar com quem mantém o código se isso foi intencional.
- **Cartões virtuais sem resolução sufixo→apelido**: o parser Nubank grava `"Cartão final <sufixo>"` na `observacao` do item de fatura com a intenção declarada em comentário de casar com `contas.cartoes_virtuais` para mostrar o apelido — isso não está implementado; a UI hoje mostra a string crua do sufixo.
- **`hash_match`** em `fatura_import_item` é calculado e persistido mas não é usado em nenhuma query de deduplicação hoje — não assumir que reimportar a mesma fatura é bloqueado automaticamente.

---

## 🧪 Ambiente de testes

- Jest roda contra Supabase real usando `TEST_EMAIL`/`TEST_PASSWORD`.
- Suite `99_limpar` chama `functions/limpar` para zerar dados ao fim.
- E2E roda no Firefox via Playwright; em CI o `playwright.config.ts` sobe o Vite dev server automaticamente (`webServer`); localmente basta `npm run test:e2e`.
- Auth state em `FrontEnd/e2e/fixtures/auth.json` é gerado por `auth.setup.ts` (não commitar).
- CI usa 4 workflows GitHub Actions:
  - `.github/workflows/backend-api-tests.yml` — testes Jest (push/PR develop)
  - `.github/workflows/frontend-lint.yml` — ESLint (push/PR develop)
  - `.github/workflows/frontend-quality.yml` — build + TypeScript (push/PR develop)
  - `.github/workflows/frontend-e2e.yml` — Playwright Firefox (push/PR develop, mudanças em `FrontEnd/**`)
