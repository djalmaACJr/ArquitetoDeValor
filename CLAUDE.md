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
- Lembretes/alertas vinculáveis a lançamentos futuros
- Filtros salvos por página (Dashboard, Extrato, Relatórios)
- Assistente de lançamentos (sugestão automática por descrição)

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
| `pages/` | `DashboardPage`, `LancamentosPage`, `ContasPage`, `CategoriasPage`, `RelatoriosPage`, `ImportExportPage`, `PerfilPage`, `LoginPage`, `ApresentacaoMascotes` (onboarding 1º acesso) |
| `components/layout/` | `AppLayout`, `Sidebar` |
| `components/ui/` | `DrawerLancamento`, `Calculadora`, `BotaoNovoLancamento`, `BotaoOcultar`, `FiltrosLancamentos`, `FiltrosSalvosBtn`, `IconeConta`, `MonthPicker`, `MultiSelect`, `AppVersion` (botão da versão = abre tutorial da página), `ModalLembrete`, `CalendarioDashboard`, `Mascote`, `MascoteDica`, `MascoteTutorial`, `ChatMascote` (chat com IA via mascote escolhido), `TutorialTour` (overlay guiado com mascote apontando), `LoadingMascote`, `shared` |
| `hooks/` | `useAuth`, `useCategorias`, `useContas`, `useDashboard`, `useLancamentos`, `useFiltrosSalvos`, `useLembretes`, `useAssistente`, `useOcultarValores`, `useTheme`, `useMascotePreferido` (apelido, tema, primeiro acesso), `useIAPreferencia`, `useChatMascote` |
| `context/` | `AuthContext`, `PageStateContext` (persiste filtros entre páginas), `ContextoIAContext` (split SetterCtx + ValueCtx — páginas registram o que estão exibindo para o ChatMascote enviar à IA) |
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
| `functions/assistente/` | GET busca sugestões via ILIKE; POST upsert por descrição; DELETE remove padrão |
| `functions/lembretes/` | CRUD de lembretes com filtro por mês e cascade por `lancamento_id` |
| `functions/filtros/` | CRUD de filtros nomeados por página (Dashboard, Extrato, Relatórios) |
| `functions/excluir_conta/` | Exclui todos os dados do usuário (chama `fn_excluir_dados_usuario`) |
| `functions/version/` | Endpoint de versão (introspecção) |
| `functions/limpar/` | Limpeza usada nos testes (reativa contas inativas para destravar UPDATE) |
| `functions/ia_configs/` | CRUD das configs de IA por provedor (apelido, modelo, api_key). API key é criptografada em AES-256-GCM antes de ser persistida; frontend só vê máscara (`sk-...f4a2`). Inclui ping para testar credencial. |
| `functions/chat_mascote/` | Recebe mensagem + contexto opcional (texto + screenshot base64) da página, descriptografa a api_key da config escolhida e proxia a chamada para o provedor (Claude / GPT / Gemini / DeepSeek / OpenRouter / Mistral / Cohere). |
| `migrations/` | DDL idempotente (schema, ENUMs, triggers, views, RLS, seed de usuário) |

### Testes

| Pasta | Conteúdo |
|---|---|
| `tests/` | Jest API: `01_contas`, `02_categorias`, `03_transacoes`, `04_transferencias`, `05_lembretes`, `06_assistente`, `99_limpar` |
| `FrontEnd/e2e/tests/` | Playwright: contas, categorias, navegação, extrato, dashboard, relatórios, transferências, lembretes, assistente |

---

## 🧠 Regras de domínio (resumo)

> Detalhe completo em [`BUSINESS_RULES.md`](./BUSINESS_RULES.md).

### Transações (`arqvalor.transacoes`)

- **Tipos** — `RECEITA` | `DESPESA`
- **Status** — `PAGO` | `PENDENTE` | `PROJECAO`
- **Recorrência** — `DIARIA` | `SEMANAL` | `MENSAL` | `ANUAL`
  - Quando recorrente: `id_recorrencia` + `nr_parcela` + `total_parcelas` + `tipo_recorrencia` (`PARCELA` ou `PROJECAO`)
  - Constraint do banco: os 4 campos devem estar **todos presentes ou todos nulos**
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
- Cartão: campos opcionais `dia_fechamento` / `dia_pagamento` (1..31) e `limite_credito` (NUMERIC, ≥ 0). Para `CARTAO` o backend força `saldo_inicial = 0`; o formulário esconde "Saldo inicial" e mostra "Limite de crédito" no lugar.
- Banco bloqueia exclusão se houver lançamentos (trigger `fn_bloquear_exclusao_conta`).
- Saldo calculado pela view `vw_saldo_contas` (= `saldo_inicial` + soma de receitas − despesas). ⚠️ **Saldo soma TODAS as transações até a data, independente de `status`** (PAGO, PENDENTE, PROJECAO contam igual). Não reintroduzir filtro `t.status = 'PAGO'` em views/funções de saldo.
- RPCs `fn_saldos_contas_ate_data(p_user_id, p_data)` e `fn_saldo_conta_ate_data(p_conta_id, p_data)` são `SECURITY INVOKER` e validam `auth.uid()` — chamadas com user/conta de outro usuário levantam `ACESSO_NEGADO` (corrigido em `20260522000002`).

### Mascotes + IA

- **Quatro mascotes**: `arquiteta` (rosa-bebê), `gato` (azul), `raposa` (money green), `sabio` (exibido como "Conselheiro", marrom claro). O `id` interno é sempre `sabio`; o rótulo "Conselheiro" é só de apresentação.
- **Onboarding (1º acesso)**: `ApresentacaoMascotes` força escolher mascote → dar apelido → escolher tema antes de liberar o app. Estado vem de `arqvalor.usuarios.mascote_preferido` + `usuarios.layout` + flag derivada `primeiroAcesso` exposta por `useMascotePreferido`.
- **Poses suportadas**: `sentado` | `curioso` | `andando` | `comprimentando` | `feliz` | `triste` | `espantado` | `apontando-{direita,esquerda}[-acima]`. Animações WebM (`mascote-andando.webm`, `mascote-comprimentando.webm`) com fallback MP4 para compatibilidade. Sprites em `FrontEnd/public/mascotes/`.
- **Chat com IA** (`ChatMascote`): o usuário cadastra uma ou mais credenciais em `arqvalor.usuarios.ia_configs` (JSONB). A `api_key` é criptografada em AES-256-GCM via secret `IA_KEYS_ENCRYPTION_KEY` — frontend só recebe máscara.
- **Provedores**: `claude` | `gpt` | `gemini` | `deepseek` | `openrouter` | `mistral` | `cohere`. Metadados em `FrontEnd/src/lib/iaProvedores.ts` (gratuito, modelo padrão, visão).
- **Contexto da página**: `ContextoIAContext` é um split context (SetterCtx + ValueCtx) — páginas (Dashboard, etc.) registram em `SetterCtx` o que estão exibindo; só o `ChatMascote` consome `ValueCtx`, evitando loop de re-render. O usuário escolhe enviar texto e/ou screenshot junto da mensagem.
- **Tutorial guiado**: `TutorialTour` é um overlay com o mascote escolhido apontando para elementos via `data-tutorial="..."` em alvos espalhados pelas páginas. Disparado pelo botão da versão (`AppVersion`). Passos definidos em `FrontEnd/src/lib/tutoriaisPaginas.ts` com `posicao` opcional (`auto` | `abaixo` | `direita` | `esquerda` | `acima`).

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
| `05_lembretes.test.ts` | CA-LEM01..11 |
| `06_assistente.test.ts` | CA-ASS01..09 |
| `99_limpar.test.ts` | CA-LIM01..11 (limpeza pós-suite) |

### E2E (Playwright) — `FrontEnd/e2e/tests/`

`00_cadastro`, `01_contas`, `02_categorias`, `03_navegacao`, `04_extrato`, `05_dashboard`, `06_relatorios`, `07_transferencias`, `08_lembretes`, `09_assistente` (+ `auth.setup.ts`, `data.setup.ts`).
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
- **Backup/Restore obrigatório para toda tabela nova**: sempre que uma nova tabela de dados do usuário for incorporada ao sistema, ela DEVE ser incluída nas rotinas de backup e restore em [`ImportExportPage.tsx`](FrontEnd/src/pages/ImportExportPage.tsx) — adicionar ao `BackupPayload` + `fazerBackup` (coleta), ao `executarRestore` (recriação com dedup e remapeamento de FKs via `mapaContas`/`mapaCategorias`), à lista "O backup inclui" e, quando fizer sentido, a um escopo "Somente \<tabela\>" no restore. Também avaliar inclusão na exportação Excel.

### ❌ Não deve

- Criar lógica duplicada (sempre olhar o `_shared/utils.ts` antes)
- Acessar tabelas de domínio diretamente do frontend — sempre via Edge Function. **Exceção**: `arqvalor.usuarios` (perfil/preferências) pode ser lida/escrita diretamente via Supabase client, conforme padrão já em `PerfilPage` e `useOcultarValores`
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

> **Storage da sessão em E2E**: o app usa `localStorage` para a sessão Supabase (compartilhada entre abas — ver seção 🔐), que é exatamente o que o `storageState` do Playwright persiste entre specs. **Não precisa de comando separado nem de detectar `navigator.webdriver`**.

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

# Chave-mestra de 32 bytes (256-bit) para AES-256-GCM. Criptografa as
# api_keys de IA armazenadas em arqvalor.usuarios.ia_configs.
# Gere com:  openssl rand -base64 32
# Defina:    supabase secrets set IA_KEYS_ENCRYPTION_KEY=<valor>
# IMPORTANTE: se perder esta chave, todas as IA configs ficam inacessíveis
# e usuários precisam re-cadastrar.
IA_KEYS_ENCRYPTION_KEY=...
```

### 🔐 Configuração de sessão (Supabase Auth)

Defesa contra "sessão esquecida em PC compartilhado". Camadas trabalham juntas e atacam dois problemas distintos: **sessão persistida no LS** e **token vivo demais após inatividade ou roubo**.

> ⚠️ **Decisão jun/2026**: a sessão usa `localStorage` (padrão do supabase-js), e não mais `sessionStorage`. Motivo: permitir abrir links em **nova aba** (middle-click) sem novo login — a sessão é compartilhada entre abas e sobrevive ao fechar a aba. Em troca, **abandona-se** a proteção "fechar a aba = desloga"; a defesa contra sessão esquecida fica só com o `useAutoLogout` (client) + Inactivity timeout (server).

#### Camadas no client (este repo)

1. **`localStorage`** ([lib/supabase.ts](FrontEnd/src/lib/supabase.ts)) — storage padrão do supabase-js: sessão **compartilhada entre abas** e persistida ao fechar a aba (abrir nova aba não pede login). ⚠️ Não protege "fechar aba = desloga" — ver aviso acima.
2. **`useAutoLogout(15)`** ([hooks/useAutoLogout.ts](FrontEnd/src/hooks/useAutoLogout.ts) montado em `AppLayout`) — timer de inatividade no client. 15 min sem mouse/teclado/scroll/click → `signOut()` + redirect `/login?expirado=1` (banner amigável).
3. **`limparEstadoCliente()`** ([lib/clientCache.ts](FrontEnd/src/lib/clientCache.ts)) — chamado pelo listener de `onAuthStateChange` em troca de user. Reseta `_saved` em memória das páginas e LS de preferências.

#### Camadas no Supabase (Dashboard — configuração externa)

Dois conceitos **DIFERENTES** que costumam ser confundidos:

| Setting | O que é | Default | Recomendado |
|---|---|---|---|
| **JWT expiry limit** (Auth → Settings → JWT Settings) | Vida útil do **access token**. Quando expira, o supabase-js chama `/token?grant_type=refresh_token` automaticamente em background. **Não afeta UX do user ativo** — o refresh é transparente. Reduzir é defesa em profundidade contra token roubado (XSS, leitura de storage). | 3600s (1h) | 1800s (30min) |
| **Inactivity timeout** (Auth → Settings → Sessions) | Tempo máximo sem usar o refresh token antes dele ser invalidado. Quando o refresh token morre, o próximo refresh do access token falha e o user é forçado a relogar. **Esta é a defesa server-side contra inatividade** (espelha o `useAutoLogout` do client). | Never | 30min – 1h |
| **Refresh token reuse interval** (Auth → Settings → Sessions) | Janela em que o supabase aceita o mesmo refresh token ser usado mais de uma vez (cobre race conditions). | 10s | manter default |

#### Por que ambos os timers (cliente + servidor)?

- O `useAutoLogout` é **rápido e amigável** (mostra banner, navega) mas roda em JS — alguém com DevTools poderia desabilitar.
- O **Inactivity timeout** é **servidor-enforçado** — mesmo que o JS seja sabotado, a próxima chamada de API falha com 401 e o app força login. Ele substitui o `useAutoLogout` em garantia, mas oferece UX pior (a falha vem do server, não como deslogou-graciosamente).
- Por isso usamos os dois: o do client cobre 99% (UX boa) e o do server cobre o resto (defesa real).

#### Resumo prático

Reduzir JWT expiry SEM mexer no Inactivity timeout = nenhum efeito perceptível no user ativo (só refresh mais frequente). Para desconectar usuário parado é o **Inactivity timeout** que importa.

---

## 📌 Observações finais

- Projeto em desenvolvimento ativo
- Priorizar clareza, consistência e manutenção
- Evitar overengineering — a regra simples é melhor que abstração precoce
- Sempre considerar impacto nos testes (API + E2E)
- Migrations devem ser **idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`, blocos `DO/EXCEPTION`)
