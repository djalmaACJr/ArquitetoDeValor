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
| `hooks/` | Lógica de negócio + estado — todos baseados em `@tanstack/react-query` (`useLancamentos`, `useDashboard`, `useContas`, `useCategorias`, `useFiltrosSalvos`, `useLembretes`, `useAssistente`, `useOcultarValores`, `useAuth`, `useTheme`, `useEspacoAtivo` — ver "Usuários agregados" abaixo) |
| `context/` | `AuthContext` (sessão), `PageStateContext` (filtros persistidos entre páginas) |
| `lib/` | `api.ts` (HTTP — anexa `X-Contexto-User-Id` automaticamente), `supabase.ts` (Auth), `utils.ts`, `constants.ts` (enums centralizados), `queryKeys.ts` (chaves React Query — toda chave afetada por agregados incorpora o uid de contexto), `logger.ts` (log condicional dev-only), `espacoAtivo.ts` (store do espaço ativo — ver "Usuários agregados" abaixo) |
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

Ambas anexam o header `X-Contexto-User-Id` automaticamente quando há um espaço de agregado ativo (lido de `lib/espacoAtivo.ts`, fora da árvore React — nenhum hook precisa passar isso explicitamente). ⚠️ Headers customizados novos precisam entrar em `Access-Control-Allow-Headers` (`_shared/utils.ts`, backend) — ver seção CORS; sem isso o preflight do navegador barra a requisição silenciosamente, algo que os testes Jest nunca pegam (CORS não é aplicado fora do browser).

### Princípios

- Páginas são declarativas; estado mora nos hooks.
- Hooks expõem `{ dados, loading, erro, carregar, criar, editar, excluir, ... }` quando aplicável.
- Tipagem forte usando `src/types/index.ts`.
- **React Query**: configurado em `main.tsx` (`QueryClientProvider`) com `staleTime: 30s`, `refetchOnWindowFocus: false`, `retry: 1`. Cada hook usa `useQuery(queryKey)` e invalida via `qc.invalidateQueries(queryKey)` após mutation.
- **Logs**: usar `log()` / `debug()` de `lib/logger.ts` em vez de `console.log` — são no-op em produção via `import.meta.env.DEV` (tree-shaken pelo bundler).

### App Android

Capacitor 8 empacota o MESMO build web (`FrontEnd/dist/`) numa WebView — não há árvore de código nativa separada em React. `Capacitor.isNativePlatform()` decide comportamento por plataforma em vários pontos (storage da sessão, timeout de auto-logout, biometria, calculadora/teclado, swipe de navegação). Detalhe completo (biometria, sessão dual-storage, atualização OTA) em `CLAUDE.md` › "Sessão + biometria (Android)" — não duplicado aqui de propósito, é conteúdo de produto/segurança, não de arquitetura de camadas.

#### Teclado
`targetSdk 36` = edge-to-edge: sem tratamento, o teclado cobre a WebView e o campo digitado some. Camadas: `android:windowSoftInputMode="adjustResize"` (`AndroidManifest.xml`) + `@capacitor/keyboard` (`resize: 'native'`, `resizeOnFullScreen: true` em `capacitor.config.ts`) + `lib/tecladoMobile.ts` (leva o campo focado pra área visível; chamado em `main.tsx`, só em tela de toque; `Keyboard.addListener(...).catch` pra não quebrar um bundle OTA novo num APK antigo sem o plugin) + `interactive-widget=resizes-content` no viewport (`index.html`, web mobile). As 2 primeiras são **nativas**: exigem reinstalar o APK (OTA só leva o bundle web).

#### Rede: TLS e avaliação de certificate pinning (AUD-08, 06/08/2026)

Estado atual — `android/app/src/main/res/xml/network_security_config.xml`:
```xml
<network-security-config>
    <domain-config cleartextTrafficPermitted="false">
        <domain includeSubdomains="true">supabase.co</domain>
    </domain-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```
`cleartextTrafficPermitted="false"` já bloqueia HTTP puro (global e para `*.supabase.co` especificamente) — todo tráfego é HTTPS com validação da cadeia de CA do sistema. O que isso NÃO cobre é um MITM com certificado de CA confiável no device (ex.: proxy corporativo, malware que instala CA raiz, ataque com CA comprometida) — é exatamente esse gap que *certificate pinning* fecha, fixando no app quais certificados/chaves públicas são aceitos para `supabase.co`, independente do que o Android confia no OS.

**Recomendação: não adotar pinning agora.** Avaliação custo-benefício:
- **Benefício**: fecha o cenário MITM-com-CA-confiável — real, mas de severidade baixa aqui porque a aplicação já não guarda a senha do usuário em lugar algum acessível a esse ataque (login por biometria usa `EncryptedSharedPreferences` + `signInWithPassword` a cada uso, nunca reaproveita token — ver `FrontEnd/src/lib/biometria.ts`), e o JWT tem vida curta (`JWT expiry` recomendado 30min, ver CLAUDE.md › "Configuração de sessão"). O que um MITM nessas condições rouba é, na pior hipótese, um access token de curta duração, não credenciais permanentes.
- **Custo operacional real**: Supabase pode rotacionar o certificado do endpoint `*.supabase.co` sem aviso (renovação de TLS, mudança de CA, migração de infra) — pins desatualizados **quebram o app inteiro para 100% dos usuários** até uma nova release ser publicada. A distribuição é OTA via `@capgo/capacitor-updater` (`app_releases`, ver seção "Tabela — Releases OTA"), mas mesmo assim há uma janela de app inacessível entre a rotação do certificado e a publicação do novo pin — pra uma equipe pequena sem monitoramento de expiração de certificado de terceiro, esse risco de auto-DoS supera o benefício de segurança marginal acima.
- **Alternativa já suficiente para o perfil de risco atual**: manter `cleartextTrafficPermitted="false"` (já feito) + JWT expiry curto + Inactivity timeout no servidor (já documentados) cobre o essencial sem o risco operacional do pinning.

**Reavaliar se**: o escopo de dados sensíveis client-side aumentar (ex.: passar a cachear tokens de longa duração no device), ou a equipe crescer o suficiente para ter um processo formal de rotação de pin acoplado ao calendário de renovação de certificado do Supabase.

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
├── agregados/index.ts          # ciclo de vida do compartilhamento ("usuários agregados") — ver seção "Usuários agregados" abaixo
├── investimentos/index.ts      # ~6.500 linhas — maior função do sistema; ver seção "Investimentos" abaixo
├── faturas/
│   ├── index.ts                 # sessão de importação de fatura (upload → parse → revisão → confirmação)
│   └── parsers/                 # nubank.ts, c6.ts, inter.ts, mercadopago.ts, generico.ts, helpers.ts, tipos.ts, index.ts (dispatcher)
├── app_updates/index.ts        # POST /app_updates — endpoint público (sem JWT), consultado pelo @capgo/capacitor-updater a cada abertura do app Android; ver tabela app_releases
├── auditoria/index.ts          # GET /auditoria — consulta trilha_auditoria (filtros tabela/operacao/registro_id/user_id/desde/ate); RLS decide o que cada chamador vê
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
| `registrarExecucaoCron(jobNome, status, resumo, erro, duracaoMs)` | Grava 1 linha em `cron_execucoes` via `dbAdmin()`. Nunca lança (só loga se a própria gravação falhar) |
| `executarComLogDeCron(jobNome, fn)` | Envolve a chamada de uma rota de cron: mede duração, extrai o corpo `dados` da `Response` como resumo, grava via `registrarExecucaoCron`, repassa a `Response` original. Usada pelas rotas `*-cron` de `investimentos/index.ts` |
| `dispararContinuacaoCron(req, corpo, nomeSecretEnv?)` | Self-chaining de cron em lote (out/2026): dispara um novo POST pra ELA MESMA (mesma rota, cursor avançado em `corpo`) via `EdgeRuntime.waitUntil()`, sem esperar a resposta. Reconstrói a URL a partir de `SUPABASE_URL` + pathname de `req.url` — **nunca usar `req.url` direto**, ele não é a URL pública dentro do handler (ver "Self-chaining em lote" abaixo) |
| `hojeBR()` / `mesCorrenteBR()` | **AUD-01**: data/mês de "hoje" no fuso `America/Sao_Paulo` (via `Intl.DateTimeFormat('en-CA', {timeZone: ...})`), substituindo `new Date().toISOString()` (que resolve em UTC, errando o dia das 21h à meia-noite BRT). Ponto único reusado em `transacoes`, `transferencias`, `objetivos`, `faturas`; `investimentos/shared.ts` mantém seu `hojeISO()` histórico, que agora só delega pra `hojeBR()` |
| `comIdempotencia(c, userId, rota, chave, executar)` | **AUD-06**: se `chave` (header `Idempotency-Key`) vier, reivindica-a via INSERT em `idempotency_keys` (claim-first, não check-then-write — evita a mesma race que a feature existe pra fechar); colisão (`23505`) → devolve a resposta já cacheada; sem colisão → roda `executar()` e grava o resultado. Sem `chave`, ou se o INSERT falhar por outro motivo (ex.: tabela não migrada ainda), cai em fail-open (roda `executar()` normalmente) — nunca bloqueia criação por causa da própria feature de proteção. Usada em `POST /transacoes` e `POST /transferencias` |
| `resolverContexto(req, c, userId, modulos, escrita?)` | **Usuários agregados**: lê o header `X-Contexto-User-Id`; sem header, ou igual ao próprio `userId`, devolve `{ userId, isAgregado: false }` (caminho normal, sem overhead). Com header diferente, chama a RPC `fn_agregado_tem_acesso` pra cada módulo em `modulos` (OR — qualquer um bastando) com `p_conta_id: null` (checagem de módulo, não de conta específica — a RLS de cada tabela faz a checagem granular por conta na query em si); se nenhum módulo autorizar, `403`. O header é só uma dica de "qual filtro aplicar" nas queries explícitas do handler — a RLS, reavaliada a cada query, é a garantia real. Ver `BUSINESS_RULES.md` → Usuários agregados |

### CORS

Origem configurável via secret:

```
supabase secrets set ALLOWED_ORIGIN=https://seu-dominio.com
```

Em dev fica `*`.

`corsHeaders()` (`_shared/utils.ts`) declara `Access-Control-Allow-Headers` com a lista exata de headers customizados que o frontend manda — hoje `Authorization, apikey, Content-Type, Idempotency-Key, X-Contexto-User-Id`. ⚠️ **Todo header customizado novo precisa entrar nessa lista antes de qualquer PR usá-lo.** Achado real (E2E, out/2026): o header `X-Contexto-User-Id` (usuários agregados) foi usado em todo o frontend por várias fases sem nunca ter sido adicionado aqui — o preflight do navegador barrava a requisição **antes dela sair do cliente** (`NS_ERROR_DOM_BAD_URI` no Firefox), sem log nenhum no backend. A feature inteira de troca de espaço funcionava nos testes Jest (que usam `fetch` fora do browser — CORS nunca é aplicado) e nunca tinha funcionado de verdade num navegador real. `tests/10_seguranca_auth_cors.test.ts` (SEG-CORS02) agora cobre isso explicitamente — qualquer header novo deve ganhar uma linha lá também.

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
| `status_convite_agregado` | `PENDENTE`, `ACEITO`, `RECUSADO`, `REVOGADO` |
| `modulo_agregado` | `EXTRATO`, `OBJETIVOS`, `INVESTIMENTOS` |
| `categoria_fii` | `TIJOLO`, `PAPEL`, `FOF`, `DESENVOLVIMENTO`, `OUTRO` |
| `acoes_subtipo` | `ON`, `PN`, `UNIT`, `BDR` |

### Tabelas

#### `usuarios`
`id (PK = auth.uid)`, `email UNIQUE`, `nome`, `ocultar_valores BOOLEAN NOT NULL DEFAULT false`, `mascote_preferido TEXT` (nullable, sem default — `NULL` ⇒ primeiro acesso), `layout JSONB` (nullable, apelido do mascote + tema), `ia_preferencia TEXT` (provedor padrão), `ia_configs JSONB` (array de configs `{id,provedor,apelido,modelo,api_key_cripto}` — `api_key_cripto` é AES-256-GCM via secret `IA_KEYS_ENCRYPTION_KEY`), `data_nascimento DATE`, `tutoriais_vistos JSONB NOT NULL DEFAULT '{}'` (chaves `tour-<pagina>` / `tutorial-<pagina>-<mascote>`), `inv_perfil JSONB` (`{perfil, idade, idade_aposentadoria, suitability, atualizado_em}`), `inv_pesos_criterio JSONB` (`{FUNDAMENTOS, CRESCIMENTO, DIVIDENDOS, VALUATION}` somando 100, globais para todos os tipos de ativo), `inv_avaliacao_agenda JSONB` (`{frequencia}` — preferência de UI, não dispara cron), `inv_dividendos_avisos JSONB` (avisos self-healing do cron BRL sobre tipo de provento sem categoria mapeada; auto-regenerado, fora do backup), `inv_dividendos_novidades JSONB` (resumo do que o cron BRL fez desde o último login; exibido 1x e descartado), `admin BOOLEAN NOT NULL DEFAULT false` (flag de administrador — única fonte da verdade para gating de telas admin, ex. `/admin/crons`; setada manualmente via SQL, sem endpoint de auto-promoção), `criado_em`.
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
Campos condicionais por tipo: **Renda Fixa** — `rf_subtipo`, `rf_indexador`, `rf_indice (indice_rf)`, `rf_percentual_indice NUMERIC(7,3)` (ex. 110 = 110% do CDI), `rf_taxa_fixa NUMERIC(7,3)` (spread/prefixado), `rf_limite_faixa NUMERIC(15,2)` + `rf_percentual_indice_2 NUMERIC(7,3)` (taxa escalonada por valor aplicado, ex. CDB "até R$10.000 = 120% CDI, acima = 100% CDI" — tudo-ou-nada, `chk_inv_ativos_rf_faixa_par`, só no pós-fixado "% do índice"; ver `BUSINESS_RULES.md`), `rf_taxa VARCHAR(40)` (texto livre legado), `rf_emissor`, `rf_vencimento DATE`, `rf_garantia_fgc`, `rf_isento_ir`. **FII** — `fii_categoria (categoria_fii)` (manual, editável no cadastro); `fii_vp NUMERIC` (Valor Patrimonial por cota — usado no indicador P/VP), `fii_vp_origem TEXT` (`MANUAL` | `CVM` — a CVM sempre sobrescreve o manual quando encontra o fundo), `fii_vp_atualizado_em DATE` (mês de referência do dado da CVM, null se manual), `fii_segmento`/`fii_mandato`/`fii_num_cotistas`/`fii_dy_mes_cvm` (demais indicadores do mesmo Informe Mensal da CVM — só leitura, sem campo de formulário; ver BUSINESS_RULES.md § "P/VP e dados da CVM (FII)"). **Ações** — `acoes_subtipo (acoes_subtipo)`; `acao_lpa NUMERIC`/`acao_vpa NUMERIC` (Lucro/Valor Patrimonial por Ação — manuais ou vindos da CVM), `acao_valor_justo NUMERIC` (calculado em código, fórmula de Graham: `√(22,5×LPA×VPA)`, `null` se LPA/VPA `<=0`), `acao_fundamentos_origem TEXT` (`MANUAL`|`CVM`, mesma regra de prioridade do `fii_vp_origem`), `acao_fundamentos_referencia DATE` (fim do exercício anual da DFP usado; ver BUSINESS_RULES.md § "Preço Teto (Bazin) e Valor Justo (Graham) — Ações"). **Cripto** — `cripto_rendimento_aa NUMERIC(8,4)` (%a.a.), `cripto_rendimento_inicio DATE` (default = 1º aporte), `cripto_rendimento_periodicidade` (`DIARIA|SEMANAL|MENSAL`, só afeta a base de composição — materialização é sempre semanal).
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
`id`, `user_id`, `ativo_id → inv_ativos` cascade, `conta_id → contas RESTRICT`, `valor NUMERIC(20,2) >=0`, `data_pagamento DATE`, `tipo_ativo` (cópia desnormalizada), `tipo_dividendo_id → inv_tipos_dividendo` SET NULL, `descricao`, `valor_por_cota NUMERIC(20,8)` (dividendo/rate por cota — base do DY/YoC, `NULL` em lançamentos antigos até backfill), `data_com DATE` (última data com direito ao provento, só via B3/`dividendos-cron-br`, `NULL` em manual/antigo — ver BUSINESS_RULES.md § "Data COM de proventos"), `transacao_extrato_id → transacoes` SET NULL.

#### `inv_historico_mensal`
Snapshot mensal por (ativo, conta): `ativo_id`, `conta_id`, `mes_ano CHAR(7)` (`YYYY-MM`), `valor_mercado`, `quantidade`, `preco_medio`, `variacao_percentual`, `rentabilidade_mes`. `UNIQUE(ativo_id, conta_id, mes_ano)`.

#### `inv_tipos_dividendo`
`user_id`, `nome VARCHAR(40)`, `categoria_id → categorias` SET NULL, `ativo BOOLEAN`. `UNIQUE(user_id, nome)` (dedup em `20260629000001`). Seed automático de 4 tipos por novo usuário (trigger `trg_seed_tipos_dividendo`): **"Aluguel de FII", "JSCP", "Dividendos", "Rend. Trib."**.

#### `inv_questionarios`
Questionário customizado por tipo de ativo: `user_id`, `tipo_ativo`, `perguntas JSONB` (array `{id, texto, criterio, opcoes[5]}`), `pesos JSONB` (legado), `origem ('MANUAL'|'IA')`, `ia_provedor`, `ia_modelo`, `ia_gerou_em`. `UNIQUE(user_id, tipo_ativo)`.

#### `inv_avaliacoes`
Avaliação consolidada por ativo (mentores IA): `user_id`, `ativo_id → inv_ativos` cascade, `nota_final NUMERIC(4,2) (0..10)`, `consenso JSONB` (pesos + perguntas + respostas por mentor), `historico JSONB` (até 24 entradas `{gerado_em, nota_final, criterios}`), `gerado_em`. `UNIQUE(user_id, ativo_id)` — upsert por ativo.

#### `inv_indicadores`
Watchlist pessoal de benchmarks exibida na página "Gerenciar dados", ao lado dos indicadores econômicos fixos (PTAX/IPCA/SELIC/CDI): `user_id`, `ticker`, `tipo` (`'ETF'|'ETF_INTERNACIONAL'|'INDICE'`, `CHECK`), `nome`, `moeda VARCHAR(3) DEFAULT 'BRL'`, `cor`. `UNIQUE(user_id, ticker)`. Sem `updated_at`/rota `PUT` (só criar/excluir). Tratada como configuração reutilizável pela rota `limpar` (não é apagada por "Limpar investimentos", só por exclusão de conta).
`ETF`/`ETF_INTERNACIONAL` são negociáveis: descobertos pela mesma busca externa (`GET /investimentos/busca-externa`, brapi) usada ao cadastrar um ativo, e a cotação vem do cache compartilhado `cotacoes_ativos` via `resolverHistoricoCotado`. `INDICE` é um índice B3 puro (SMLL, IBOV, IFIX...) — **não negociável**, não aparece nessa busca; a lista suportada é curada à mão (`INDICES_B3` em `indicadores.ts`, ticker→símbolo Yahoo) e a cotação vem direto desse símbolo mapeado (`resolverHistoricoIndiceB3`), sem passar pelo palpite multi-candidato `ticker`/`ticker.SA` usado pra ativos — ambíguo demais pra índice (ex.: "SMLL" sozinho já é o ticker de um ETF americano real). Em ambos os casos a cotação em si **não** é armazenada nesta tabela — resolvida sob demanda em `GET /investimentos/indicadores`.

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
| `inv_fatos_relevantes` | `id` (doc do Fundos.NET) | Fato Relevante/Comunicado de FII: fundo, categoria, resumo, data, url do PDF | Fundos.NET (B3) |

#### View `vw_inv_ultimo_mercado`
`DISTINCT ON (user_id, ativo_id, conta_id)` sobre `inv_historico_mensal` ordenado por `mes_ano DESC` — só o snapshot mais recente por par.

---

### 🤝 Tabelas — Usuários agregados

Migrations: `20260930000001_agregados_fundacao.sql` (schema + RPCs + Fase 0) até `20261006000013` (mais recente) — lista completa em "Migrations de agregados" mais abaixo. Detalhe de negócio completo em `BUSINESS_RULES.md`.

#### `agregados`
| Coluna | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | |
| `dono_id` | UUID | FK `usuarios` cascade DELETE |
| `agregado_id` | UUID nullable | FK `usuarios` cascade DELETE — `NULL` até o convite ser aceito (o convidado pode nem ter conta ainda) |
| `email_convidado` | TEXT | |
| `status` | `status_convite_agregado` | `PENDENTE` \| `ACEITO` \| `RECUSADO` \| `REVOGADO` |
| `token` | UUID | default `gen_random_uuid()` — **nunca** exposto pela API pública (`semToken()` em `agregados/index.ts`) |
| `token_expira_em` | TIMESTAMPTZ | default `now() + 7 days` |
| `ultimo_reenvio_em` | TIMESTAMPTZ nullable | `20261006000005` — cooldown de reenvio (60s), separado de `atualizado_em` de propósito (a própria criação também seta `atualizado_em`, o que fazia o 1º reenvio sempre bater no cooldown por engano) |
| `saiu_por_agregado` | BOOLEAN NOT NULL DEFAULT false | `20261006000012` — `true` quando o PRÓPRIO agregado encerrou o vínculo (`fn_sair_agregado`); o status continua `REVOGADO` (corta o acesso em todas as regras de uma vez), a coluna só distingue "o dono revogou" de "o agregado saiu" pra UI (badge "Saiu", aviso ao dono, sem aviso de revogação ao próprio agregado) |
| `criado_em` / `atualizado_em` / `aceito_em` / `revogado_em` | TIMESTAMPTZ | |
| `CHECK chk_agregados_nao_proprio` | | `agregado_id IS NULL OR agregado_id <> dono_id` — não dá pra convidar a própria conta |

Índices: `token` (único), `dono_id`, `agregado_id`. `ux_agregados_dono_email_ativo` (único, parcial `WHERE status IN ('PENDENTE','ACEITO')`) — só 1 convite "vivo" por par dono+e-mail; pode reconvidar livremente depois de `RECUSADO`/`REVOGADO`.

#### `agregados_permissoes`
`id`, `agregado_vinculo_id → agregados` cascade DELETE, `modulo modulo_agregado`, `pode_escrever BOOLEAN DEFAULT false`, timestamps. `UNIQUE(agregado_vinculo_id, modulo)` — módulo ausente = não liberado.

#### `agregados_contas`
`id`, `agregado_vinculo_id → agregados` cascade DELETE, `conta_id → contas` cascade DELETE, `criado_em`. `UNIQUE(agregado_vinculo_id, conta_id)`. **Lista única, compartilhada entre EXTRATO e INVESTIMENTOS** — não existe coluna de módulo aqui, de propósito. Trigger `fn_validar_conta_agregado` (BEFORE INSERT) garante que `conta_id` pertence mesmo ao `dono_id` do vínculo.

#### RLS nas 3 tabelas
Só `SELECT` para `authenticated` (`dono_id = auth.uid() OR agregado_id = auth.uid()`, com join equivalente nas 2 tabelas filhas). **Nenhuma policy de escrita** — toda mutação passa pelas RPCs `SECURITY DEFINER` listadas na tabela "Funções" acima (mesmo padrão de `fn_excluir_dados_usuario`: checagem manual de `auth.uid()`, `search_path` fixo), porque as transições de estado do convite (só o convidado com e-mail batendo pode aceitar, só enquanto pendente e não expirado, etc.) são difíceis de expressar em RLS puro e ficam mais auditáveis centralizadas.

#### ⚠️ `usuarios` NÃO tem policy de agregado
`pol_usuarios_agregado_select` (`20261002000002`) liberava `SELECT` da **linha inteira** de `usuarios` entre dono e agregado ACEITO — e RLS não restringe colunas: o agregado lia do dono `chat_mascote_historico`, `ia_configs`, `inv_perfil`, e-mail, `data_nascimento`… (e o dono, o mesmo do agregado). Removida em `20261006000013`. O que a feature precisa (só o `nome`) vem por RPCs `SECURITY DEFINER` que devolvem `id`+`nome` (`fn_nomes_usuarios`, `fn_nomes_dos_meus_agregados`, `fn_meus_vinculos_como_agregado`). **Nunca** criar policy de SELECT em `usuarios` pra outro usuário. Teste: `CA-AGR77`.

#### Policies adicionais nas tabelas de domínio
Nunca reescreve a policy de dono existente (Postgres faz `OR` entre permissivas do mesmo comando) — sempre uma policy **a mais**, condicionada por `fn_agregado_tem_acesso` (ou `fn_agregado_pode_ver_objetivo`/`fn_agregado_pode_ver_ativo`, que materializam regras mais específicas por não terem como se reduzir a módulo+conta sozinhas):

| Tabela | Comando(s) | Predicado |
|---|---|---|
| `contas` | SELECT | `fn_agregado_tem_acesso(user_id, 'EXTRATO', id) OR ..., 'INVESTIMENTOS', id) OR ..., 'OBJETIVOS', id)` |
| `categorias` | SELECT | `fn_agregado_tem_acesso(user_id, 'EXTRATO') OR ..., 'OBJETIVOS')` — sem escopo de conta (categoria não é por conta) |
| `transacoes` | SELECT / INSERT / UPDATE / DELETE | `fn_agregado_tem_acesso(user_id, 'EXTRATO', conta_id, <escrita só em I/U/D>)`; INSERT também exige `criado_por = auth.uid()` |
| `objetivos` / `objetivos_progresso` | SELECT (+ I/U/D onde aplicável) | `fn_agregado_pode_ver_objetivo(user_id, tipo, conta_id, contas_sonho, contas_projeto, <escrita>)` |
| `inv_posicoes`, `inv_operacoes`, `inv_dividendos`, `inv_historico_mensal` | SELECT (+ I/U/D) | `fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS', conta_id, <escrita>)` |
| `inv_ativos`, `inv_questionarios`, `inv_avaliacoes` | SELECT (+ I/U onde aplicável) | Via `EXISTS` join em `inv_posicoes` (ativo não tem `conta_id` próprio — `fn_agregado_pode_ver_ativo`) |
| `inv_alocacoes_tipo`, `inv_tipos_dividendo`, `inv_indicadores` | SELECT | `fn_agregado_tem_acesso(user_id, 'INVESTIMENTOS')` — sem conta, são preferências globais do dono |

`inv_etf_holdings`, `inv_proventos_fundo`, `cotacoes_*`: sem mudança (já compartilhadas entre todos os usuários, sem `user_id`).

#### Edge Function — `supabase/functions/agregados/index.ts`
Mesmo padrão de handler do resto do repo — thin wrappers chamando as RPCs via `c.rpc(...)`:
```
GET  /agregados                     -- meus vínculos como dono (permissões+contas aninhadas + `agregado_nome` via fn_nomes_dos_meus_agregados)
GET  /agregados/convites-recebidos  -- vínculos onde sou o convidado (base do seletor de espaço)
GET  /agregados/:id                 -- detalhe pra tela de edição
POST /agregados {email}             -- convida + envia e-mail (Brevo)
POST /agregados/:id/reenviar
POST /agregados/:id/revogar
POST /agregados/:id/sair          -- o próprio agregado deixa de acessar o espaço (só vínculo ACEITO; RPC fn_sair_agregado)
POST /agregados/aceitar {token}     -- por token (link de e-mail)
POST /agregados/recusar {token}
POST /agregados/:id/aceitar         -- por id (tela "Convites que recebi", já logado)
POST /agregados/:id/recusar
PUT  /agregados/:id/permissoes {modulo, liberado, pode_escrever}
PUT  /agregados/:id/contas     {conta_ids: uuid[]}
```
Nunca faz `select('*')` em `agregados` — toda resposta passa por `semToken()`.

#### Fluxo de convite + signup
Convite a um e-mail **sem cadastro** carrega o token em `raw_user_meta_data` do `signUp()` (`?convite_token=` → `CadastroPage.tsx`) — a trigger `fn_sincronizar_usuario` (mesma que já lia `nome` de lá) resolve e aceita o vínculo **dentro da própria trigger**, não via RPC pública (a trigger não roda num contexto de request autenticado). Falha silenciosa (token inválido/expirado) nunca bloqueia o cadastro em si.

#### Frontend — UX do agregado e do dono
- `hooks/useModulosLiberados.ts`: módulos liberados no espaço ativo, com as permissões ATUAIS do vínculo (`useConvitesRecebidos`) — o snapshot guardado no store pode estar velho se o dono mudou depois de o agregado escolher o espaço. A `Sidebar` esconde os itens/grupos dos módulos não liberados (Painel/Extratos/grupo Relatórios = EXTRATO; Objetivos; Investimentos).
- `components/ui/GuardaModuloAgregado.tsx` (envolve o `<Outlet/>` em `AppLayout`): no espaço do dono mostra a faixa "só aparecem as N contas compartilhadas… as demais não foram compartilhadas"; ao abrir direto a URL de módulo não liberado mostra "Acesso não liberado" (rede de segurança — pelo menu o item nem existe). Só UX; quem barra é a RLS.
- `SeletorEspaco`: se o vínculo do espaço ativo deixa de estar ACEITO (revogado/saiu), volta sozinho pra "Meus dados" e recarrega os vínculos ao voltar o foco da janela — sem isso o seletor sumia (nenhum vínculo aceito) e o agregado ficava preso numa conta vazia.
- Avisos de login (`AppLayout`, canto inferior direito; no celular os de dono são enxutos — 2 linhas, sem rodapé — pra não cobrir/interceptar toques): `AvisoConviteRecebido` (convidado: Aceitar/Recusar), `AvisoAgregadoAceitou` e `AvisoAgregadoSaiu` (dono; "visto até" em `localStorage` por uid, janela inicial de 7 dias — sem coluna no banco, vale por navegador), `AvisoRevogacaoAgregado` (agregado; ignora saídas voluntárias; "visto até" em `usuarios.agregados_avisos_vistos_em`).
- `CompartilhamentoPage`: agregados agrupados por status em quadros recolhíveis (Ativos/Aguardando aceite abertos, Revogados/saíram e Recusados recolhidos), contador, nome (não e-mail), datas de convite/aceite/revogação; ao enviar um convite o cartão abre já nas permissões (permissões podem ser definidas antes do aceite — valem só com `status = 'ACEITO'`); "Adicionar todos" nas contas; "Deixar de acessar" em "Espaços que tenho acesso".
- `components/ui/ConvidarAgregadoForm.tsx`: formulário de convite compartilhado entre `CompartilhamentoPage` e o quadro "Convidar um agregado" do Perfil (ao lado de "Convidar amigos", com link "Definir permissões").

#### Migrations de agregados
`20260930000001` fundação · `20261001000001..4` Fase 1 (leitura do Extrato, `fn_saldo_total_antes_de`, nome do dono, aceitar por id) · `20261002000001..5` Fase 2 (escrita no Extrato, nome entre dono/agregado — **policy removida depois**, permissões nos vínculos, transferência all-or-nothing) · `20261003000001..2` Fase 3 (Objetivos) · `20261004000001..3` Fase 4 (Investimentos) · `20261005000001` fix `fn_excluir_dados_usuario` · `20261006000001..7` Fase 5 (throttling, expurgo, aviso de revogação, cooldown, saldo-base do mês, OBJETIVO/CRESCIMENTO nunca visíveis) · `20261006000009` saldos respeitam o escopo de conta · `20261006000010` saldo sem timeout (`DEFINER` + CTE) · `20261006000011` `fn_nomes_dos_meus_agregados` · `20261006000012` sair por conta própria · `20261006000013` fecha o vazamento de `usuarios`.

#### `fn_excluir_dados_usuario`
`DELETE FROM agregados WHERE dono_id = p_user_id OR agregado_id = p_user_id` faz parte do bloco `DISABLE/ENABLE TRIGGER USER` já existente — exclusão de conta limpa os vínculos nos dois sentidos (como dono e como agregado). ⚠️ Esta lista de tabelas é fácil de regredir silenciosamente ao copiar a função inteira entre migrations (já aconteceu uma vez, `20260930000001` sobrescreveu uma versão mais completa de `20260929000003` por engano — corrigido em `20261005000001`, que também é a versão atual) — qualquer tabela nova de usuário precisa entrar nesse bloco.

#### Frontend — seletor de espaço
`lib/espacoAtivo.ts` é um store fora do React (mesmo padrão de `operacaoLonga.ts`/`avisoFecharAba.ts`): `{ vinculo: VinculoAgregado | null }`, persistido em `localStorage` **namespaced por uid** (nunca herdar entre contas no mesmo navegador), lido tanto por `hooks/useEspacoAtivo.ts` (ponte React, `useSyncExternalStore`) quanto por `lib/api.ts` (fora da árvore React, pra anexar o header `X-Contexto-User-Id` em toda requisição). `useContextoUserId()` é o substituto direto de `session?.user?.id` nas query keys dos hooks de domínio que precisam respeitar o seletor — sem isso, "Meus dados" e "Conta de Fulano" compartilhariam a mesma entrada de cache do React Query.

---

### 🧾 Tabelas — Importação de fatura

✅ **Corrigido em 2026-08-04**: a migration fundacional `supabase/migrations/Aplicados/20260527000001_fatura_import.sql` estava **corrompida** (depois deletada por completo) em todo o histórico do git. Foi reconstruída por evidência indireta (migrations `ALTER` posteriores, código de `functions/faturas/index.ts`, tipos do frontend) e recolocada no mesmo slot cronológico, incluindo a trigger `trg_validar_conta_cartao_fatura` que antes só existia em comentário.

#### `fatura_import_sessao` (schema reconstruído — ver aviso acima)
`id`, `user_id`, `conta_id → contas` (deve ser `tipo=CARTAO`, validado por trigger `trg_validar_conta_cartao_fatura`), `arquivo_nome`, `vencimento_fatura DATE`, `valor_total NUMERIC`, `status` (`EM_ANALISE\|CONFIRMADA\|CANCELADA`), `observacao`, `modo_importacao VARCHAR(10)` (`NULL\|REGISTRO\|CATEGORIA`, `20260530000003`), `separar_por_cartao BOOLEAN` (`20260530000003`), timestamps. RLS `pol_fatura_sessao_user`.

#### `fatura_import_item` (schema reconstruído — ver aviso acima)
`id`, `sessao_id → fatura_import_sessao`, `user_id`, `data_compra`, `descricao`, `estabelecimento`, `valor NUMERIC` (sempre positivo), `tipo VARCHAR(10) DEFAULT 'DESPESA' CHECK IN ('RECEITA','DESPESA')` (`20260527000002`), `parcela_atual`/`parcela_total`, `decisao` (`PENDENTE\|CRIAR\|ATUALIZAR\|IGNORAR`), `categoria_sugerida_id`/`categoria_escolhida_id → categorias`, `transacao_existente_id`/`transacao_criada_id → transacoes`, `hash_match` (calculado, sem uso de dedup no código atual), `observacao` (usada também para guardar `"Cartão final <sufixo>"` do cartão virtual detectado no PDF), `grupo_chave TEXT` (`20260530000002` — separação manual de grupo no modo CATEGORIA, sobrevive a reload), `descricao_override TEXT` (`20260530000002`), timestamps. RLS `pol_fatura_item_user`. Índices de FK adicionados em `20260709000001`.

---

### 📱 Tabela — Releases OTA (Android)

Migrations: `20260730000001_app_releases.sql` (criação), `20260731000001_app_releases_session_key.sql` (coluna `session_key`) — ambas ainda pendentes na raiz de `supabase/migrations/`, ver seção Migrations.

#### `app_releases`
**Sem `user_id`** — metadado global do app, não dado de usuário. `id`, `plataforma TEXT DEFAULT 'android'`, `canal TEXT DEFAULT 'production'`, `versao TEXT` (`X.Y.Z`, comparada em código pela Edge Function — não é semver estrito), `bundle_url TEXT` (zip no bucket Storage `app-releases`, público), `checksum TEXT` (checksum **cifrado** do `@capgo/cli bundle encrypt`, não o hash simples do zip), `session_key TEXT` (`ivSessionKey` da mesma cifragem — ambos exigidos pelo `@capgo/capacitor-updater` no dispositivo pra decifrar), `notas`, `ativo BOOLEAN DEFAULT true`, `criado_em`.
RLS: `SELECT` público (`USING (ativo = true)`, grant para `anon, authenticated` — o app consulta sem JWT); escrita só via `service_role` (`dbAdmin()`), nunca pela API — só o script `FrontEnd/scripts/publish-android-ota.mjs` grava aqui.
Bucket `app-releases` (Storage, público): upload só via `service_role` no mesmo script; sem policy de INSERT para `anon`/`authenticated`.
Consumida por `GET-like POST /app_updates` — ver seção Edge Functions.

---

### 📋 Tabela — Histórico de execução de cron (`cron_execucoes`, novo)

Migrations: `20260806000001_usuarios_admin.sql` (coluna `usuarios.admin`), `20260806000002_cron_execucoes.sql` (tabela).

Motivação: auditoria de 2026-08-04 encontrou o job `dividendos-diario` falhando 100% das vezes por 19 dias direto (segredo de URL ausente no Vault, depois timeout de `pg_net` curto demais) sem NENHUM sinal visível em lugar nenhum — só foi descoberto porque um usuário notou proventos faltando e a causa foi rastreada manualmente via SQL Editor/Logs Explorer. Esta tabela é o registro que faltava.

#### `cron_execucoes`
**Sem `user_id`** — metadado operacional do sistema, não dado de usuário (mesma categoria de `app_releases`). `id`, `job_nome TEXT` (`dividendos-diario`\|`dividendos-br-diario`\|`snapshot-diario`\|`rendimento-cripto-diario`\|`cupom-tesouro-diario`\|`trilha-auditoria-purge-diario`), `status TEXT CHECK IN ('sucesso','erro')`, `resumo JSONB` (corpo `dados` da resposta, formato livre por job), `erro TEXT`, `duracao_ms INTEGER`, `executado_em TIMESTAMPTZ DEFAULT now()`.
RLS: `SELECT` só para quem tem `usuarios.admin = true` (policy com subquery `EXISTS`); sem policy de INSERT/UPDATE/DELETE para `anon`/`authenticated` — só `service_role` grava.
Gravada automaticamente por `executarComLogDeCron()` (`_shared/utils.ts`), que envolve as 4 rotas de cron dentro de `investimentos/index.ts` — mede duração, tenta extrair o corpo `dados` da Response como resumo, e nunca lança (uma falha ao gravar o log não pode derrubar a resposta real do cron). Consumida por `GET /investimentos/cron-execucoes` (`investimentos/admin.ts`) e exibida em `AdminCronsPage.tsx` (`/admin/crons`, só visível/populada para admin — a proteção real é a RLS, a UI só evita mostrar o link à toa).

---

### 📝 Tabela — Trilha de auditoria (`trilha_auditoria`, AUD-04, estendida 2026-08-20)

Migrations: `20260806000004_trilha_auditoria.sql` (criação, escopo mínimo) → `20260820000001_trilha_auditoria_extensao.sql` (escopo estendido a quase todo o sistema).

Motivação original: a única tabela de auditoria que o sistema já teve (`arqvalor.auditoria`) foi removida em `20260523000002` por estar sem nenhum produtor de dados — 0 registros em 7 semanas, nunca conectada a um trigger. Nada a substituiu até `20260806000004`, que nasceu já conectada a triggers reais mas com escopo mínimo de propósito (só `transacoes` + `inv_operacoes`). A extensão de `20260820000001` veio de uma investigação de duplicação de provento (ago/2026) onde não havia trilha nenhuma pra responder "quando e por que esse registro mudou" fora de `transacoes`/`inv_operacoes` — nem endpoint nem UI liam a tabela até então.

#### `trilha_auditoria`
`id`, `user_id` (FK `usuarios.id ON DELETE RESTRICT`), `tabela TEXT`, `operacao TEXT CHECK IN ('INSERT','UPDATE','DELETE')`, `registro_id UUID`, `dados_antigos JSONB`, `dados_novos JSONB`, `alterado_em TIMESTAMPTZ DEFAULT now()`. Índice em `(user_id, registro_id, alterado_em DESC)`.
**Append-only de verdade**: nenhuma policy de INSERT/UPDATE/DELETE para nenhum role, nem `service_role` — só o trigger (`SECURITY DEFINER`, roda como owner da função) grava. Duas policies de `SELECT` (permissivas, somadas por OR): `trilha_auditoria_select_own` (`user_id = auth.uid()`, qualquer usuário vê a própria trilha) e `trilha_auditoria_admin_select` (`usuarios.admin = true`, admin vê a de todos — adicionada em `20260820000001`, mesmo padrão de `cron_execucoes_admin_select`).
`fn_registrar_trilha_auditoria()` — trigger genérico reusável (chave em `TG_TABLE_NAME`/`TG_OP`), grava snapshot ANTES (UPDATE/DELETE) e/ou DEPOIS (INSERT/UPDATE) como JSONB via `to_jsonb(NEW/OLD)`. Sem mudanças desde a criação — a extensão só liga o mesmo trigger em mais tabelas.

**Escopo (desde `20260820000001`)**: `transacoes` (cobre lançamentos E transferências, linhas com `id_par_transferencia`), `contas`, `categorias`, `lembretes`, `filtros_salvos`, `assistente_lancamentos`, `objetivos`, e todo o módulo de investimentos (`inv_ativos`, `inv_alocacoes_tipo`, `inv_posicoes`, `inv_operacoes`, `inv_dividendos`, `inv_historico_mensal`, `inv_tipos_dividendo`, `inv_questionarios`, `inv_avaliacoes`) e importação de fatura (`fatura_import_sessao`, `fatura_import_item`).
**Fora do escopo, de propósito**: `usuarios` (perfil/preferências, não "dado transacional" — mutaria a cada login/cron e viraria ruído), `objetivos_progresso` (não tem coluna `user_id`, o trigger genérico não se aplica sem alterar o schema), e as tabelas compartilhadas sem `user_id` (cotações, `inv_proventos_fundo`, `inv_etf_holdings`, `app_releases`, `cron_execucoes`, `idempotency_keys`, a própria `trilha_auditoria`).

`fn_excluir_dados_usuario` foi recriada em cada uma dessas duas migrations pra manter o mesmo cuidado: (1) apagar a trilha do usuário como 1º passo de limpeza (referencia `usuarios` via FK RESTRICT), e (2) incluir TODA tabela recém-auditada no bloco `DISABLE/ENABLE TRIGGER USER` que já existia pra `categorias`/`transacoes`/`contas` — sem isso, o DELETE de qualquer uma delas recriaria entradas de trilha DEPOIS do passo de limpeza, deixando linha órfã que travaria o DELETE final de `usuarios` (FK RESTRICT).

#### Consulta — `GET /auditoria` (`supabase/functions/auditoria/index.ts`)
Filtros via querystring: `tabela`, `operacao` (`INSERT|UPDATE|DELETE`), `registro_id`, `user_id`, `desde`/`ate` (`YYYY-MM-DD` sobre `alterado_em`), `limit` (padrão 100, máx. 500). A proteção real é a RLS acima — o handler roda com o client do próprio usuário (`db(req)`, não `dbAdmin()`) e só formata a resposta, mesmo padrão de `investimentos/admin.ts::rotaCronExecucoes`: usuário comum só recebe a própria trilha, admin recebe a de todos. Consumida por `useTrilhaAuditoria` e exibida em `AdminAuditoriaPage.tsx` (`/admin/auditoria`, só visível/populada para admin).

#### Retenção rotativa (`config_auditoria`, `20260820000002_trilha_auditoria_retencao.sql`)
`trilha_auditoria` é append-only e cresce indefinidamente sem expurgo — esta migration adiciona um período de retenção configurável (padrão 365 dias).
- **`config_auditoria`** — tabela singleton (`id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1)`, 1 linha fixa): `retencao_dias INTEGER CHECK (BETWEEN 30 AND 3650)`, `atualizado_em`, `atualizado_por → usuarios`. RLS: `SELECT`/`UPDATE` só pra `usuarios.admin = true` (mesmo padrão EXISTS de `cron_execucoes`); sem policy de INSERT/DELETE — a linha já nasce semeada e nunca é recriada pela API.
- **`fn_purgar_trilha_auditoria()`** — `SECURITY DEFINER`, lê `retencao_dias` (365 se a config sumir), apaga `trilha_auditoria` mais antiga que isso, grava o resultado (`removidos`, `retencao_dias`) em `cron_execucoes` como job `trilha-auditoria-purge-diario` — reaproveita a mesma tabela/tela (`/admin/crons`) dos outros jobs em vez de criar observabilidade paralela.
- **Agendamento**: pg_cron puro (`0 8 * * *` = 05h BRT), **sem `pg_net`** — diferente dos outros 4 cron jobs (que chamam uma Edge Function via HTTP), a purga é só um `DELETE` por data, não precisa de fonte externa nem de Vault/secret.
- **`GET`/`PUT /auditoria/config`** (mesma Edge Function `auditoria`) — expõe/edita `retencao_dias`. Handler sem checagem de admin no código: roda com o client do usuário e a RLS decide (`GET` devolve `null` pra quem não é admin; `PUT` sem linha afetada vira 403). Consumido por `useConfigAuditoria` e editável no painel no topo de `AdminAuditoriaPage.tsx`.

---

### 🔑 Tabela — Chaves de idempotência (`idempotency_keys`, novo, AUD-06)

Migration: `20260806000005_idempotency_keys.sql`.

#### `idempotency_keys`
PK composta `(user_id, rota, chave)` — `rota` é um rótulo fixo por endpoint (`"POST /transacoes"`, `"POST /transferencias"`), não a URL completa. `status_code INTEGER`, `resposta JSONB`, `criado_em TIMESTAMPTZ DEFAULT now()`. `ON DELETE CASCADE` em `user_id`.
RLS escopada ao próprio usuário, mesmo padrão de qualquer tabela de domínio.
Uso: claim-first via `INSERT` (não check-then-write — evitaria a própria race que a feature existe pra fechar). Colisão (`23505` — chave já reivindicada) devolve a resposta cacheada (replay) se já tiver sido gravada, ou 409 se a 1ª tentativa ainda estiver em voo. Ver `comIdempotencia()` na tabela de helpers de `_shared/utils.ts` acima.

---

### 🩺 Monitoramento de falha antes da Edge Function (`cron-saude-diario`, ago/2026)

Migration: `20260821000002_cron_saude.sql`.

Motivação: achado real em produção — `rendimento-cripto-diario` ficou **falhando 100% das vezes por pelo menos 30 dias** (o secret `edge_url_rendimento_cripto_cron` nunca foi criado no Vault) e **nenhuma linha apareceu em `cron_execucoes`**. Causa: a falha acontece em `cron.job_run_details` — o Postgres tenta montar a chamada via `pg_net` (`net.http_post`), a URL vem `NULL` do Vault, e o `INSERT` em `net.http_request_queue` viola `NOT NULL` **antes** da Edge Function ser invocada. `executarComLogDeCron()` só grava de **dentro** da function — nunca chegou a rodar, nunca logou nada. O próprio `cron_execucoes` (criado pra resolver exatamente esse tipo de "falha silenciosa", AUD conforme `20260806000002`) tinha esse ponto cego específico.

`fn_verificar_saude_cron()` — `SECURITY DEFINER`, SQL puro (sem `pg_net`/Vault, de propósito — não teria sentido o detector de "cron não consegue nem começar por causa do pg_net/Vault" ter a mesma dependência frágil). Lê `cron.job_run_details` (log nativo do `pg_cron`, já existe, nenhuma tabela nossa) das últimas ~26h, e para cada falha aí encontrada faz `INSERT` em `cron_execucoes` como uma linha `status='erro'` normal — mesma tabela/tela (`/admin/crons`) que já existia, sem superfície nova. Dedup por `(job_nome, executado_em)`: não duplica se a janela de 26h se sobrepuser entre execuções diárias. Também grava seu próprio resultado (`sucesso`, `resumo: {falhas_detectadas: N}`) — visível como qualquer outro job.

Agendado `0 11 * * *` (08h BRT) — depois de todos os outros 7 jobs do dia, pra já pegar qualquer falha da manhã.

#### 2º ponto cego: cadeia de self-chaining travada no meio (out/2026)

Migration: `20261006000119_cron_saude_detectar_lote_travado.sql` (estende `fn_verificar_saude_cron()`, não cria função nova).

`fn_verificar_saude_cron()` original só detecta falha **antes** da Edge Function ser invocada. Mas o padrão de self-chaining em lote (`dispararContinuacaoCron`, ver "Self-chaining em lote" acima) tem um ponto cego irmão: se um lote NO MEIO da cadeia travar (`WORKER_RESOURCE_LIMIT`/timeout), a invocação morre sem rodar seu próprio `catch` — não grava nada em `cron_execucoes` pra si mesma — mas o lote ANTERIOR já tinha gravado `status='sucesso'` com `resumo.lote.tem_mais = true`, que nunca vira `false`. Esse "último lote disse que tinha mais e nunca mais apareceu outra linha" é justamente o sinal detectável.

A função agora também: pega a última linha de cada job cujo `resumo` tem a chave `"lote"` (genérico — não hardcoda nome de job, qualquer cron futuro que adote `dispararContinuacaoCron` fica coberto de graça); se `tem_mais = true` e já se passaram mais de 2h desde esse lote (bem acima do intervalo real entre lotes, segundos a poucos minutos), grava um `status='erro'` descrevendo o offset onde travou. Dedup: no máximo 1 alerta por job por dia. Validado manualmente simulando um lote de 3h atrás com `tem_mais=true` — gerou o alerta esperado e não duplicou numa 2ª chamada no mesmo dia.

#### Aviso de login pros admins (`usuarios.cron_avisos_vistos_em`)

Mesma migration adiciona a coluna `cron_avisos_vistos_em TIMESTAMPTZ` em `usuarios` — "visto até" **por admin** (cada um dispensa por conta própria, não é global). `NULL` = nunca visto, o frontend trata como "últimos 7 dias" pra não despejar histórico inteiro na primeira vez. `useAvisosCron` (reaproveita `useCronExecucoes`, sem endpoint novo) filtra `status='erro' AND executado_em > cron_avisos_vistos_em`, exibido por `AvisosCronAdmin.tsx` — card de notificação no login (canto inferior esquerdo, só admin, mesmo padrão de `NovidadesProventos`), montado em `AppLayout.tsx`. Dispensar grava `now()` direto na coluna (acesso direto a `usuarios`, mesma exceção documentada em `CLAUDE.md`).

#### Aviso de login "Data COM próxima" (`usuarios.datacom_avisos_vistos`)

Padrão parecido, mas o "visto" é um **conjunto de chaves** (`datacom_avisos_vistos JSONB`, array de `"ticker|data_com"`), não um timestamp único — o conjunto de ativos "com Data COM nos próximos 5 dias" muda todo dia (um item some quando a data passa, outro pode entrar), então um único corte de tempo esconderia um ativo novo que entrasse na janela antes da próxima dispensa. `useAvisosDataCom.ts` (reaproveita `useDividendos`, sem endpoint novo) computa a lista a partir de `inv_dividendos.data_com`/`transacoes.status='PROJECAO'`, exibida por `AvisoDataComProxima.tsx` (empilhado com `NovidadesProventos` no canto inferior direito). Ver BUSINESS_RULES.md § "Data COM de proventos".

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
| `fn_remover_usuario` | trigger BEFORE DELETE em `auth.users` | Delega para `fn_excluir_dados_usuario(OLD.id)` (FK-safe em todas as tabelas de domínio, não só `usuarios`) — corrigido em `20260806000007` após a versão anterior (`DELETE FROM arqvalor.usuarios` direto, sem ordem FK-safe) falhar com "Database error deleting user" para qualquer caller que não fosse a Edge Function `excluir_conta` (ex.: botão "Delete User" do Dashboard, scripts ad-hoc) |
| `fn_criar_transferencia(p_rows jsonb)` | RPC, `SECURITY INVOKER` | Insere **todas** as linhas do par (2 por parcela) num único `INSERT ... SELECT ... FROM jsonb_array_elements` — atomicidade via transação implícita. Chamada por `functions/transferencias`. Nome real da função **não** é `fn_criar_transferencia_atomica` (esse é só o nome do arquivo de migration) |
| `fn_atualizar_par_transferencia(p_id_par_transferencia, p_campos jsonb)` | RPC, `SECURITY INVOKER` | Espelha `valor`/`data`/`status`/`observacao` (só esses 4 campos — `conta_id`/`categoria_id`/`tipo`/`descricao` diferem por natureza entre as 2 pernas) nas DUAS transações de `id_par_transferencia` num único `UPDATE`. Chamada por `functions/transacoes` (`PUT /transacoes/:id`) quando a transação editada pertence a um par, em vez de um `UPDATE` isolado (`20260804000001`) |
| `fn_atualizar_transacoes_transferencia(p_updates jsonb)` | RPC, `SECURITY INVOKER` | Recebe array `{id, campos}` — 2 (SOMENTE_ESTE) ou 2×N (TODOS/ESTE_E_SEGUINTES) itens — e aplica tudo num único `UPDATE ... FROM jsonb_array_elements`. Substitui os 2 (ou 2×N) `UPDATE`s sequenciais que `functions/transferencias` `editar()` fazia antes, que podiam deixar o par com valor/status divergente em caso de falha no meio (`20260804000002`) |
| `fn_atualizar_transacoes_lote(p_updates jsonb)` | RPC, `SECURITY INVOKER` | Mesmo padrão `{id, campos}` em lote, mas para qualquer série de recorrência (não só transferências) — usada por `functions/transacoes` `editar()` ao recalcular datas/status de uma série inteira (escopo TODOS/ESTE_E_SEGUINTES). Substitui um loop `for` de `UPDATE`s que, em erro parcial, apenas logava e continuava — retornando HTTP 200 mesmo com parcelas não atualizadas (`20260804000003`) |
| `fn_excluir_transferencias(p_ids)` | RPC, `SECURITY INVOKER` | Desarma `id_par_transferencia` e apaga as transações do par/série numa única transação |
| `fn_criar_transacoes_com_dividendos(p_rows, p_dividendo)` | RPC, `SECURITY INVOKER` | Insere transação(ões) de provento e espelha `inv_dividendos` atomicamente |
| `fn_excluir_transacoes_e_dividendos(p_ids)` | RPC, `SECURITY INVOKER` | Exclusão atômica de transações + dividendos vinculados |
| `fn_saldo_total_antes_de(p_user_id, p_data)` | RPC, `SECURITY DEFINER` (desde `20261006000010`) | Saldo **global** (todas as contas ativas) do usuário na véspera de uma data — otimização de `GET /transacoes?saldo=true`, evita window function cara em `vw_transacoes_com_saldo`. Dono: soma direto. Agregado: valida `fn_agregado_tem_acesso(…,'EXTRATO')` UMA vez e junta com o conjunto de contas liberadas (CTE). Era `INVOKER` e chamava `fn_agregado_tem_acesso` por linha de transação (+ a RLS repetia por linha) → `statement timeout` (~8s) pro agregado com histórico longo |
| `fn_calcular_progresso_objetivo(p_objetivo_id)` | SQL stable, `SECURITY INVOKER` | Calcula `valor_atingido`/`percentual`/`status` de um objetivo conforme seu `tipo`. Ramo CRESCIMENTO reconciliado com `ObjetivoDetalhe.tsx` em `20260806000006` (**AUD-03** — uma migration anterior focada em SONHO tinha sobrescrito sem querer a fórmula completa YoY/YTD/NET/COMP_YTD do CRESCIMENTO por uma versão v1 simplificada; ver `BUSINESS_RULES.md` § "Cálculo de CRESCIMENTO") |
| `fn_atualizar_progresso_objetivo` | trigger `BEFORE I/U` em `objetivos` | Grava o resultado de `fn_calcular_progresso_objetivo` (usa `NEW.*` direto, sem re-SELECT) |
| `fn_sincronizar_progresso_objetivo(p_user_id)` | RPC, `SECURITY INVOKER` | Recalcula todos os objetivos ativos do usuário em massa + grava snapshot do dia em `objetivos_progresso` (`POST /objetivos/sincronizar-progresso`) |
| `fn_saldo_contas_ate(p_contas UUID[], p_data)` | SQL stable | Saldo agregado de N contas até uma data — usada pelo cálculo de `saldo_base`/SONHO |
| `fn_seed_tipos_dividendo` | trigger AFTER INSERT em `auth.users` | Semeia os 4 tipos de dividendo padrão para o novo usuário |
| `fn_sync_dividendo_tipo_ativo` | trigger AFTER UPDATE OF `tipo_ativo` em `inv_ativos` | Propaga mudança de tipo para todos os `inv_dividendos` do ativo |
| `fn_dividendo_tipo_do_ativo` / `trg_dividendo_tipo_do_ativo` | trigger | Mantém `inv_dividendos.tipo_ativo` sincronizado no INSERT (achado de drift documentado em `20260709000001`) |
| `fn_seed_investimentos_exemplo` | trigger AFTER INSERT em `auth.users` (`trg_z_seed_investimentos_exemplo`, roda depois de `trg_sincronizar_usuario` por ordem alfabética) | Popula conta "XP Investimentos" + 2 ativos + posições/operações + histórico de exemplo para novo usuário |
| `fn_agregado_tem_acesso(p_dono_id, p_modulo, p_conta_id?, p_escrita?)` | SQL stable, `SECURITY INVOKER` | **Usuários agregados** — único ponto de verdade de "este agregado pode ver/editar isto?", usado por toda RLS adicional e por `resolverContexto()`. Ver "Tabelas — Usuários agregados" abaixo |
| `fn_agregado_pode_ver_objetivo(...)` / `fn_agregado_pode_ver_ativo(p_ativo_id, p_dono_id, p_escrita?)` | SQL stable, `SECURITY INVOKER` | Materializam a regra de visibilidade por tipo de objetivo / por posição de ativo (não dá pra expressar com `fn_agregado_tem_acesso` sozinha, que só sabe checar módulo+conta) |
| `fn_convidar_agregado(p_email)` / `fn_reenviar_convite_agregado(p_vinculo_id)` / `fn_revogar_agregado(p_vinculo_id)` | RPC, `SECURITY DEFINER` | Ciclo de vida do convite pelo lado do dono. Convidar tem throttling (100/h); reenviar tem cooldown de 60s (`ultimo_reenvio_em`) |
| `fn_aceitar_convite_agregado(p_token)` / `fn_recusar_convite_agregado(p_token)` | RPC, `SECURITY DEFINER` | Aceite/recusa por token (link de e-mail) — valida contra `usuarios.email` da sessão, nunca só posse do token |
| `fn_aceitar_convite_agregado_por_id(p_vinculo_id)` / `fn_recusar_convite_agregado_por_id(p_vinculo_id)` | RPC, `SECURITY DEFINER` | Mesmo aceite/recusa, pela tela "Convites que recebi" (já logado, sem token na URL) |
| `fn_definir_permissoes_agregado(p_vinculo_id, p_modulo, p_liberado, p_pode_escrever)` / `fn_definir_contas_agregado(p_vinculo_id, p_conta_ids)` | RPC, `SECURITY DEFINER` | Dono edita módulos/contas liberadas de um vínculo — `fn_definir_contas_agregado` substitui o conjunto inteiro atomicamente, validando que toda conta é mesmo do dono |
| `fn_meus_vinculos_como_agregado()` | RPC, `SECURITY DEFINER` | Vínculos onde o chamador é o agregado (inclusive `REVOGADO`, pra alimentar o aviso de revogação) ou um convite `PENDENTE` pro seu e-mail |
| `fn_expurgar_convites_agregados_expirados()` | RPC, `SECURITY DEFINER`, chamada por `pg_cron` | Convites `PENDENTE` com `token_expira_em` vencido → `REVOGADO`. Job diário 08:30 |
| `fn_sair_agregado(p_vinculo_id)` | RPC, `SECURITY DEFINER` | `agregado_id = auth.uid()` e `status = 'ACEITO'` → `REVOGADO` + `revogado_em = now()` + `saiu_por_agregado = true`. Qualquer outro caso (inclusive o dono chamando) → `CONVITE_NAO_ENCONTRADO` (404) |
| `fn_nomes_dos_meus_agregados()` | RPC, `SECURITY DEFINER` | `(vinculo_id, nome)` dos agregados dos vínculos do dono (inclui revogados/recusados) — só o nome, nunca o resto do perfil |
| `fn_nomes_usuarios(p_ids uuid[])` | RPC, `SECURITY DEFINER` | `(id, nome)` apenas do próprio usuário ou de quem tem vínculo ACEITO com ele (nas 2 direções). Usada por `mapaUsuarios()` em `functions/transacoes` ("lançado por Fulano"). Substitui a policy `pol_usuarios_agregado_select` (removida) |
| `fn_validar_conta_agregado` | trigger BEFORE INSERT em `agregados_contas` | Defesa em profundidade: a conta liberada precisa pertencer ao dono do vínculo (a RPC já valida; o trigger fecha a garantia independente de quem chame o INSERT) |
| `fn_saldos_contas_ate_data(p_user_id, p_data)` (`SECURITY DEFINER` desde `20261006000010`, só devolve contas liberadas ao agregado) / `fn_saldo_conta_ate_data(p_conta_id, p_data)` (`INVOKER`) | RPC | Saldo por conta até uma data — chamadas direto pelo frontend (`useSaldoBaseMes`), sem Edge Function. Aceitam `p_user_id`/dono de uma conta igual a `auth.uid()` OU um agregado com EXTRATO liberado (estendido em `20261006000006` — tinham ficado de fora da Fase 1 por descuido, fazendo o Extrato de um agregado mostrar o PRÓPRIO saldo-base dele em vez do saldo do dono) |

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

A rota `/investimentos/rendimento-cripto-cron` é agendada por `20260625000005_cron_rendimento_cripto.sql` (job `rendimento-cripto-diario`, `0 10 * * *` = 07h BRT, diário) — confirmado que o job existe e nenhuma migration posterior o desagenda (`cron.unschedule`).

A rota `/investimentos/cupom-tesouro-cron` é agendada por `20260821000001_cron_cupom_tesouro.sql` (job `cupom-tesouro-diario`, `30 10 * * *` = 07h30 BRT, diário) — provisiona pagamento de cupom semestral de títulos "com Juros Semestrais" do Tesouro Direto, fonte Tesouro Transparente/STN (CSV público, `baixarCupomTesouro()` em `mercado.ts`). Diferente dos 4 crons de dividendos de ações: só processa eventos **futuros** (`data_resgate >= hoje`, sem janela retroativa) — cupons já pagos o usuário já lança na mão, e reconciliar retroativamente arriscaria sobrescrever correção manual. Ver `provisionarCupomTesouro` em `dividendos.ts`.

A rota `/investimentos/fatos-relevantes-cron` é agendada por `20260827000003_inv_fatos_relevantes.sql` (job `fatos-relevantes-diario`, `45 10 * * *` = 07h45 BRT, diário) — cacheia em `inv_fatos_relevantes` (tabela compartilhada, sem `user_id`) os Fatos Relevantes/Comunicados ao Mercado recentes de FIIs publicados no Fundos.NET (B3), usados como contexto factual na avaliação de ativos por mentores de IA. Ver `fatosRelevantes.ts` e BUSINESS_RULES.md § "Avaliação de ativos por mentores de IA".

A rota `/investimentos/cvm-fii-cron` é agendada por `20260917000002_inv_ativos_fii_vp_cvm.sql` (job `cvm-fii-semanal`, `0 9 * * 1` = 06h BRT, **semanal** — segunda-feira, não diário como os demais: a CVM recebe/retifica os informes mensais dos fundos ao longo de várias semanas, então rodar todo dia não traria nada de novo na maioria das execuções) — preenche `inv_ativos.fii_vp` (Valor Patrimonial por cota) + `fii_segmento`/`fii_mandato`/`fii_num_cotistas`/`fii_dy_mes_cvm` de TODOS os FIIs de TODOS os usuários a partir dos Informes Mensais de FII **e FIAGRO** da CVM (`dados.cvm.gov.br`, dado público oficial, sem chave — único dado com fundamentos de FII brasileiro, já que brapi/Yahoo não cobrem isso; FIAGRO é dataset/formato separado da CVM, mas o app trata como `tipo_ativo=FII`). Também disparado (best-effort, síncrono) ao cadastrar um FII novo em `POST /investimentos/ativos`, pra não esperar até 7 dias pelo 1º P/VP. Ver `cvm.ts` e BUSINESS_RULES.md § "P/VP e dados da CVM (FII)".

A rota `/investimentos/cvm-acoes-cron` é agendada por `20260922000001_inv_ativos_acao_fundamentos_cvm.sql` (job `cvm-acoes-mensal`, `0 9 5 * *` = 06h BRT, todo dia 5 do mês — **mensal**, não semanal como o de FII: os fundamentos vêm da DFP, que é anual, e o ZIP de todas as ~450 companhias abertas é maior que o de FII) — preenche `inv_ativos.acao_lpa`/`acao_vpa`/`acao_valor_justo` de TODAS as ações de TODOS os usuários a partir da FCA (ponte ticker→CNPJ + nº de ações) e da DFP (Patrimônio Líquido + Lucro Líquido do último exercício anual) da CVM, alimentando o indicador Valor Justo (fórmula de Graham). Também disparado (best-effort, síncrono) ao cadastrar uma ação nova em `POST /investimentos/ativos`. Ver `cvmAcoes.ts` e BUSINESS_RULES.md § "Preço Teto (Bazin) e Valor Justo (Graham) — Ações".

Um 6º job, **`trilha-auditoria-purge-diario`** (`0 8 * * *` = 05h BRT), difere dos demais: não chama nenhuma Edge Function via `pg_net` — roda `SELECT arqvalor.fn_purgar_trilha_auditoria()` direto no Postgres (puro `DELETE` por data, sem fonte externa). Ver seção "Retenção rotativa" acima.

Um 9º job, **`cron-saude-diario`** (`0 11 * * *` = 08h BRT, `20260821000002_cron_saude.sql`), monitora os OUTROS 8 — também SQL puro, de propósito (ver seção "Monitoramento de falha antes da Edge Function" abaixo).

#### Self-chaining em lote (`dispararContinuacaoCron`, out/2026)

Achado real: jobs que processam "todos os usuários/ativos" numa invocação só crescem com a base até estourar o limite de tempo/recursos da Edge Function — e esse tipo de falha (worker morto/timeout no meio do processamento) não deixa rastro em `cron.job_run_details`, então nem `cron-saude-diario` (que só vê jobs que o Postgres marcou como "failed") consegue detectar. `dividendos-br-diario` ficou quebrado silenciosamente de 02/10 a 05/10/2026 por isso (loop sequencial por ativo, com pausa, sobre uma base crescente de usuários).

Padrão de correção, em `dispararContinuacaoCron()` (`_shared/utils.ts`): em vez de 1 invocação gigante, a rota processa um LOTE (ex.: N usuários/ativos) e, se sobrar trabalho, dispara uma nova invocação HTTP pra ELA MESMA com o cursor avançado no body — usando `EdgeRuntime.waitUntil()` (global no runtime Deno do Supabase) pra manter a invocação atual viva até o `fetch()` de auto-continuação sair, mesmo depois da Response já ter sido devolvida. Cada lote fica bem abaixo do limite; o total do dia acaba em várias invocações curtas e sequenciais. Implementado em `rotaDividendosCronBr`/`rotaDividendosCron` (`dividendos.ts`) — BR em lotes de 15 usuários (nunca divide um usuário entre lotes — `persistirAvisosENovidades` SOBRESCREVE, não mescla, o aviso por usuário), USD em lotes de 25 ativos por offset.

⚠️ **Pegadinha não-óbvia**: `req.url`, DENTRO do handler da Edge Function, **não é a URL pública** — o gateway interno do Supabase reescreve pra algo como `http://<ref>.supabase.co/investimentos/dividendos-cron-br` (sem o prefixo `/functions/v1/`, e em `http://`, não `https://`). Usar `req.url` direto no self-fetch bate 404 silenciosamente: o 1º lote processa normal, mas o 2º nunca dispara e nada fica registrado (a falha do `fetch()` de auto-continuação só ia pro console via `logError`, invisível sem acesso a `supabase functions logs`). `dispararContinuacaoCron()` reconstrói a URL certa a partir de `Deno.env.get("SUPABASE_URL")` + o `pathname` de `req.url` (esse pedaço é confiável, só falta o prefixo). Validado em produção: `dividendos-br-diario` completou os 10 lotes (150 usuários) sem erro após o fix.

`cvm-acoes-mensal` teve causa raiz DIFERENTE (não dá pra resolver com self-chaining): o gargalo não é o loop sobre ativos (barato), é baixar+descompactar os 2 ZIPs anuais da CVM (FCA+DFP, cada um com múltiplos CSVs cobrindo TODAS as ~1000+ companhias abertas) **ao mesmo tempo** via `Promise.all` — estourava `WORKER_RESOURCE_LIMIT` (memória) antes de chegar no loop. Corrigido sequenciando os fetches/parses em `cvmAcoes.ts` (1 ZIP/CSV por vez, não em paralelo).

🔧 **Achado e corrigido (out/2026)**: o ZIP FCA do ano corrente não tem mais `fca_cia_aberta_capital_social_<ANO>.csv` — a CVM removeu essa seção do FCA, **não renomeou/moveu**: confirmado por inspeção direta do cabeçalho real dos 3 CSVs restantes mais plausíveis (índice de documentos, `geral`, `valor_mobiliario`), nenhum tem `Quantidade_Total_Acoes` ou equivalente. Fix: o nº total de ações agora vem do **FRE** (Formulário de Referência, `fre_cia_aberta_capital_social_<ANO>.csv`, filtrado por `Tipo_Capital = "Capital Emitido"`) — o FRE em si é um ZIP pequeno (~8MB comprimido, ~33 CSVs), bem menor do que o nome sugeria, seguro de baixar por completo numa invocação só. FCA continua servindo só pra ponte ticker→CNPJ (`valor_mobiliario`); DFP continua a fonte de LPA/VPA. Validado em produção: 177/200 ativos ACOES atualizados (antes do fix: 0/199). Ver comentário no topo de `cvmAcoes.ts`.

O ZIP do FRE também expõe outros CSVs não usados ainda (exclusivos de `tipo_ativo=ACOES` — FRE é só pra companhias abertas, sem equivalente pra FII/ETF/renda fixa/tesouro/cripto/stocks internacionais): `distribuicao_capital` (free float — nº/% de ações em circulação fora do controle + nº de acionistas PF/PJ/institucionais, sinal de liquidez), `posicao_acionaria` (cada acionista relevante com % de participação e flag de controlador, sinal de concentração de controle), `transacao_parte_relacionada` (negócios com controlador/administradores — sinal de risco de governança/autocontratação). Avaliar com o usuário antes de expandir o escopo do módulo pra usar esses dados (precisaria de novas colunas em `inv_ativos`, migração, e decisão de onde exibir — provavelmente como contexto pra "Avaliação de ativos por mentores de IA").

### Row Level Security

Habilitada em **todas** as tabelas de domínio. Policy padrão:

```sql
USING      (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());
```

**Usuários agregados** é a única exceção, e nunca reescrevendo essa policy: sempre uma policy *adicional* permissiva por cima (Postgres faz `OR` entre permissivas do mesmo comando), condicionada por `fn_agregado_tem_acesso`/`fn_agregado_pode_ver_objetivo`/`fn_agregado_pode_ver_ativo`. Ver "Tabelas — Usuários agregados" acima para a lista completa por tabela.

### Migrations

Convenção de pasta: `supabase/migrations/Aplicados/` guarda as migrations já aplicadas/arquivadas (~98 arquivos); migrations na raiz de `supabase/migrations/` são as mais recentes, presumivelmente já rodadas em produção mas ainda não "arquivadas" — **confirme com o time antes de assumir que ainda estão pendentes**. **Todas idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`, blocos `DO/EXCEPTION`, `DROP POLICY/TRIGGER IF EXISTS`).

✅ **Corrigido em 2026-08-04**: `Aplicados/20260527000001_fatura_import.sql` estava corrompida (5 bytes, `"f1 o"`) e depois foi deletada por completo do histórico do git — o arquivo foi reconstruído por evidência indireta (código de `faturas/index.ts`, migrations `ALTER` posteriores, tipos do frontend) e agora recria `fatura_import_sessao`/`fatura_import_item` de forma idempotente, incluindo a trigger `trg_validar_conta_cartao_fatura` (antes só citada em comentário, nunca implementada). Ver seção "Tabelas — Importação de fatura".

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
- `20260527000001_fatura_import.sql` — ✅ reconstruída em 2026-08-04 (ver aviso acima); cria `fatura_import_sessao`/`fatura_import_item` + `trg_validar_conta_cartao_fatura`
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
- `20260730000001_app_releases.sql` — tabela `app_releases` (releases OTA do app Android) + bucket Storage público `app-releases`, ver seção "Tabela — Releases OTA (Android)"
- `20260731000001_app_releases_session_key.sql` — coluna `session_key` em `app_releases` (suporte a bundles cifrados, E2E v2 do `@capgo/capacitor-updater`)
- `20260804000001_fn_atualizar_par_transferencia.sql` — cria `fn_atualizar_par_transferencia` (fix: editar 1 perna de um par de transferência via `/transacoes` deixava a outra com status divergente)
- `20260804000002_fn_atualizar_transacoes_transferencia.sql` — cria `fn_atualizar_transacoes_transferencia` (edição atômica do par/série via `/transferencias`)
- `20260804000003_fn_atualizar_transacoes_lote.sql` — cria `fn_atualizar_transacoes_lote` (edição em lote atômica de série de recorrência via `/transacoes`, substitui loop de `UPDATE`s que podia falhar parcialmente e ainda responder 200)
- `20260804000004_fix_assistente_trgm_index.sql` — troca `idx_assistente_user_descricao_trgm` (que apesar do nome era um B-tree comum, duplicado do unique index) por um índice GIN trigram de verdade (`pg_trgm`) sobre `lower(descricao)` — só o GIN acelera o `ILIKE '%termo%'` que a rota `GET /assistente?q=` realmente faz
- `20260804000005_dedup_inv_dividendos.sql` — `UNIQUE INDEX ux_inv_dividendos_dedup (user_id, ativo_id, conta_id, tipo_dividendo_id, data_pagamento, valor)` em `inv_dividendos`, contra duplicação por corrida do cron diário de dividendos BRL (achado real de bug, corrigido manualmente antes desta migration)
- `20260806000001_usuarios_admin.sql` — coluna `usuarios.admin BOOLEAN DEFAULT false` (única fonte da verdade pra gating de telas admin)
- `20260806000002_cron_execucoes.sql` — tabela `cron_execucoes` (histórico de execução dos 4 cron jobs) + RLS admin-only, ver seção "Tabela — Histórico de execução de cron"
- `20260806000003_timezone_america_sao_paulo.sql` — **AUD-01**: `ALTER DATABASE postgres SET timezone TO 'America/Sao_Paulo'` — `CURRENT_DATE`/`now()` sem fuso explícito passam a resolver no horário do Brasil em vez de UTC (o lado Deno da mesma correção são os helpers `hojeBR()`/`mesCorrenteBR()` em `_shared/utils.ts`, aplicados em ~15 pontos de `transacoes`, `transferencias`, `objetivos`, `faturas` e `investimentos`)
- `20260806000004_trilha_auditoria.sql` — **AUD-04**: tabela `trilha_auditoria` (append-only — RLS só com SELECT pro próprio dono, nenhuma policy de INSERT/UPDATE/DELETE) + trigger genérico `fn_registrar_trilha_auditoria()` conectado a `transacoes` e `inv_operacoes`; recria `fn_excluir_dados_usuario` pra limpar a trilha e desligar/religar o trigger de `inv_operacoes` durante o wipe de conta
- `20260806000005_idempotency_keys.sql` — **AUD-06**: tabela `idempotency_keys` (PK composta `user_id+rota+chave`, `ON DELETE CASCADE`) — suporte a `comIdempotencia()` (`_shared/utils.ts`), plugado em `POST /transacoes` e `POST /transferencias`; claim-first via INSERT (não check-then-write), replay da resposta cacheada em caso de colisão, fail-open se a chave vier ausente ou a tabela ainda não existir
- `20260806000006_crescimento_comp_ytd_reconciliado.sql` — **AUD-03**: recria `fn_atualizar_progresso_objetivo`/`fn_calcular_progresso_objetivo` unindo `saldo_base` (SONHO, de `20260605000001`) com a fórmula YoY/YTD/NET/COMP_YTD completa pro CRESCIMENTO (de `20260603000006`, que tinha sido perdida sem intenção quando a primeira foi recriada por cima) — banco e tela (`ObjetivoDetalhe.tsx`) passam a calcular a mesma fórmula, ver `BUSINESS_RULES.md` § "Cálculo de CRESCIMENTO"
- `20260806000007_hardening_fn_remover_usuario.sql` — **AUD-12 residual**: recria `fn_remover_usuario` (trigger BEFORE DELETE em `auth.users`) pra delegar em `fn_excluir_dados_usuario(OLD.id)` em vez de um `DELETE FROM usuarios` cru sem ordem FK-safe — torna qualquer caminho de exclusão de usuário seguro (Dashboard, script administrativo), não só o fluxo padrão do app
- `20260820000001_trilha_auditoria_extensao.sql` — estende `trg_trilha_auditoria` de `transacoes`/`inv_operacoes` (escopo original de `20260806000004`) para praticamente todo o resto do sistema (`contas`, `categorias`, `lembretes`, `filtros_salvos`, `assistente_lancamentos`, `objetivos`, `inv_ativos`, `inv_alocacoes_tipo`, `inv_posicoes`, `inv_dividendos`, `inv_historico_mensal`, `inv_tipos_dividendo`, `inv_questionarios`, `inv_avaliacoes`, `fatura_import_sessao`, `fatura_import_item`); adiciona policy `trilha_auditoria_admin_select` (admin vê a trilha de todos); recria `fn_excluir_dados_usuario` incluindo as tabelas novas no bloco DISABLE/ENABLE TRIGGER USER. Consumida por `GET /auditoria` (`supabase/functions/auditoria/`) e exibida em `/admin/auditoria`
- `20260820000002_trilha_auditoria_retencao.sql` — tabela singleton `config_auditoria` (`retencao_dias`, padrão 365, editável só por admin) + `fn_purgar_trilha_auditoria()` (apaga trilha mais antiga que a retenção configurada, loga em `cron_execucoes`) + agendamento pg_cron diário `trilha-auditoria-purge-diario` (sem `pg_net` — SQL puro). Exposta por `GET`/`PUT /auditoria/config`, editável no painel de `AdminAuditoriaPage.tsx`
- `20260827000001_inv_rf_faixa_taxa.sql` — colunas `rf_limite_faixa`/`rf_percentual_indice_2` em `inv_ativos` (taxa escalonada por valor aplicado, ex. CDB "até R$10.000 = 120% CDI, acima = 100% CDI") + constraint `chk_inv_ativos_rf_faixa_par` (tudo-ou-nada). Cálculo progressivo por lote de posição em `valorRFPosicoes` (`mercado.ts`) — ver `BUSINESS_RULES.md` § "Renda fixa — taxa escalonada por faixa de valor"
- `20260827000003_inv_fatos_relevantes.sql` — tabela compartilhada `inv_fatos_relevantes` (cache de Fatos Relevantes/Comunicados de FIIs do Fundos.NET/B3, mesmo padrão de `cotacoes_ativos`: sem `user_id`, leitura liberada a `authenticated`, escrita só `service_role`) + agendamento pg_cron `fatos-relevantes-diario` (`45 10 * * *` = 07h45 BRT) chamando `POST /investimentos/fatos-relevantes-cron`. Ver `fatosRelevantes.ts` e BUSINESS_RULES.md § "Avaliação de ativos por mentores de IA"

⚠️ **Confira o status de aplicação antes de assumir que as migrations abaixo já rodaram em produção** — a nota original (2026-08-06) dizia que as 5 migrations `20260806000003`–`20260806000007` (fase de remediação da auditoria, AUD-01/03/04/06/12) ainda não tinham sido aplicadas; `20260820000001` (acima) depende de `20260806000004` já estar aplicada (estende o mesmo trigger) — aplique ambas juntas, na ordem, se nenhuma das duas rodou ainda. — escritas, com `deno check` limpo, mas pendentes de `supabase db push`/SQL Editor. O código Deno que depende delas (`comIdempotencia`, `hojeBR`/`mesCorrenteBR`) já está preparado pra rodar sem elas também (fail-open), então o deploy das Edge Functions não quebra nada mesmo antes das migrations serem aplicadas — mas os ganhos (timezone correto, trilha de auditoria, idempotência efetiva, CRESCIMENTO reconciliado, exclusão de usuário robusta) só valem depois de aplicadas.

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
| Sessão (Android) | Storage da sessão Supabase é `sessionStorage` no app nativo (`Capacitor.isNativePlatform()`) vs `localStorage` no desktop/web — morre com o processo no Android; `useAutoLogout` cai de 15min pra 5min no nativo. Ver `FrontEnd/src/lib/supabase.ts` e CLAUDE.md › "Sessão + biometria (Android)" |
| Biometria (Android) | Credenciais de login (e-mail+senha) ficam em `EncryptedSharedPreferences` via `@capgo/capacitor-native-biometric`, nunca em texto puro no JS; digital sempre reautentica do zero (`signInWithPassword`), não guarda/reusa refresh token. Ver `FrontEnd/src/lib/biometria.ts` |
| Releases OTA | `arqvalor.app_releases` tem `SELECT` público (sem JWT — o app consulta antes até de logar) mas `INSERT`/`UPDATE` só via `service_role`, nunca pela API/frontend. Bundle é assinado/cifrado (`@capgo/cli`, E2E v2) antes de subir — o plugin no dispositivo só aceita bundle assinado com o par da `publicKey` embutida no APK |

---

## ⚠️ Pontos de atenção

- **Transferências** exigem consistência dupla — a criação/exclusão do par já é atômica via RPC (`fn_criar_transferencia`/`fn_excluir_transferencias`), mas qualquer código novo que manipule `transacoes` com `id_par_transferencia` diretamente (fora desses endpoints) pode deixar par órfão.
- **Recorrência** propaga em série; sempre respeitar o `escopo` recebido.
- **Antecipação** é destrutiva para parcelas seguintes (DELETE) — sem possibilidade de undo.
- **Categorias protegidas** (`protegida = true`, ex.: "Transferências") não podem ser editadas ou excluídas — frontend e backend devem validar.
- **Soft delete vs hard delete** — contas/categorias têm `ativa` (soft); transações são removidas (hard) com escopo; **objetivos** também usam soft delete (`ativo=false` → trigger seta `status=CANCELADO`, sem DELETE físico via API).
- **`atualizado_em`** é gerenciado por trigger — não setar manualmente.
- **Generated columns** `ano_tx`/`mes_tx` aceleram filtros mensais — usar nas queries quando possível.
- ~~Migration corrompida de fatura_import~~ — corrigido em 2026-08-04, ver `Aplicados/20260527000001_fatura_import.sql`.
- **`tipo_ativo_inv` inclui `REIT`**: adicionado por `20260613000003_tipo_reit.sql` (`ALTER TYPE ... ADD VALUE`) — é um valor válido e suportado tanto no backend quanto na UI (`DrawerAtivo.tsx`), ao contrário do que versões anteriores desta nota afirmavam.
- **`inv_etf_holdings` é uma tabela órfã**: schema criado (`20260620000001`) mas nenhuma rota de Edge Function nem componente do frontend lê/escreve nela hoje — não assumir que decomposição de ETF está implementada.
- **Regressão conhecida em Objetivos tipo CRESCIMENTO**: a migration `20260605000001_sonho_saldo_base.sql`, ao reescrever as funções de cálculo, reintroduziu a versão **antiga** do bloco CRESCIMENTO (ano-base fixo, só receita bruta, sem cutoff YTD), descartando as melhorias de `20260603000003..006` (YoY/YTD/líquido). O valor gravado no banco (`objetivos.valor_atingido`/`percentual`/`status`) usa essa versão simples, enquanto a tela `ObjetivoDetalhe.tsx` recalcula no client a versão completa (YoY+YTD+líquido) — os dois números podem divergir para o mesmo objetivo. Antes de "corrigir", confirmar com quem mantém o código se isso foi intencional.
- **Cartões virtuais sem resolução sufixo→apelido**: o parser Nubank grava `"Cartão final <sufixo>"` na `observacao` do item de fatura com a intenção declarada em comentário de casar com `contas.cartoes_virtuais` para mostrar o apelido — isso não está implementado; a UI hoje mostra a string crua do sufixo.
- **`hash_match`** em `fatura_import_item` é calculado e persistido mas não é usado em nenhuma query de deduplicação hoje — não assumir que reimportar a mesma fatura é bloqueado automaticamente.
- **Header customizado novo (`X-Contexto-User-Id` ou outro) sem `Access-Control-Allow-Headers`**: o preflight do navegador barra a requisição ANTES dela sair do cliente, sem log nenhum no backend — e os testes Jest nunca pegam isso (CORS não existe fora do browser). Foi exatamente o que aconteceu com `X-Contexto-User-Id` até out/2026 (ver seção CORS). Qualquer header novo precisa entrar em `_shared/utils.ts::corsHeaders()` E ganhar uma asserção em `tests/10_seguranca_auth_cors.test.ts` (SEG-CORS02).
- **Nunca criar policy de SELECT em `usuarios` pra outro usuário** — RLS não restringe colunas, vazaria `chat_mascote_historico`/`ia_configs`/`inv_perfil`/e-mail (aconteceu entre dono e agregado, fechado em `20261006000013`). Use RPC `SECURITY DEFINER` devolvendo só as colunas necessárias.
- **`.update(...).single()` com 0 linhas afetadas dá `PGRST116`** — numa tabela que o chamador pode LER mas não ESCREVER (conta/categoria vista por um agregado) isso virava 400 genérico; `contas`/`categorias` `editar()` agora devolvem 403.
- **`max_rows = 1000` do PostgREST trunca em silêncio** — `listarComSaldo` (`GET /transacoes?saldo=true&mes=`) agora pagina com `buscarTodasLinhas`; um mês com mais de 1000 lançamentos vinha incompleto e o `saldo_acumulado` (somado em JS) errado, sem erro. Qualquer query nova que possa passar de 1000 linhas precisa paginar.
- **Função `SECURITY INVOKER` que chama `fn_agregado_tem_acesso` por linha** (no `WHERE` de um `SUM` sobre histórico) multiplica o custo da RLS por linha — vira `statement timeout`. Autorize uma vez no início e junte com o conjunto de contas liberadas (padrão de `20261006000010`).
- `useQuery({ data = [] })` cria um array novo por render quando a query falha/está sem dados — com isso nas dependências de um `useMemo`/`useEffect` dá "Maximum update depth exceeded" (aconteceu em Relatórios com 403). Use constante estável (`SEM_CONTAS`/`SEM_CATEGORIAS` em `useContas`/`useCategorias`).
- **Objetivos tipo OBJETIVO/CRESCIMENTO nunca ficam visíveis a um agregado** (`fn_agregado_pode_ver_objetivo` retorna `false` incondicional pros 2 tipos, `20261006000007`) — decisão final confirmada com o usuário, não um bug: somam por categoria em TODAS as contas do dono, sem escopo de conta possível (ver `BUSINESS_RULES.md` → Usuários agregados). Não "corrigir" isso sem reabrir essa decisão com o usuário.
- **`arqvalor:ultima-atividade` só pode ser zerado num login de verdade, nunca numa restauração de sessão** (`main.tsx`, flag `primeiroEventoAuth`) — o SDK do supabase-js dispara `SIGNED_IN` em todo carregamento com sessão já persistida (F5, reabrir aba), não só num login interativo; sem o guard de "1º evento", um reload numa sessão esquecida apagava o timestamp vencido e destruía a defesa de "sessão esquecida em PC compartilhado" do `useAutoLogout`. Achado real via E2E (`12_seguranca_sessao.spec.ts`), out/2026.

---

## 🧪 Ambiente de testes

- Jest roda contra Supabase real usando `TEST_EMAIL`/`TEST_PASSWORD`.
- Suite `99_limpar` chama `functions/limpar` para zerar dados ao fim.
- E2E roda no Firefox via Playwright (`npm run test:e2e`, projeto `firefox`); em CI o `playwright.config.ts` sobe o Vite dev server automaticamente (`webServer`). Projeto extra `mobile` (`npm run test:e2e:mobile`, engine Chromium + `devices['Pixel 7']`) reexecuta a mesma suíte em viewport/toque de Android — não roda por padrão, cobre layout responsivo mas não os trechos gateados por `Capacitor.isNativePlatform()`.
- Auth state em `FrontEnd/e2e/fixtures/auth.json` é gerado por `auth.setup.ts` (não commitar).
- **Higiene dos testes de agregados**: `TEST_EMAIL_B` que já é agregada do usuário de teste A faz o `beforeAll` de `13_agregados` falhar com `JA_AGREGADO` — rode com `TEST_EMAIL_B=`/`TEST_PASSWORD_B=` vazias (cada arquivo cria um B temporário, precisa de `SUPABASE_SERVICE_ROLE_KEY`) ou use uma B dedicada. `13_agregados` e o `zz_teardown` E2E apagam ao final os vínculos `@example.com` do dono de teste. `14_teclado_mobile` roda só no projeto `mobile` e cobre a rolagem do campo focado (o redimensionamento nativo do teclado só se valida no aparelho). Layout: `E2E-REL09` (filtros do Relatório não estouram nem se sobrepõem) e `E2E-REL08` (APIs falhando não causam loop de render) rodam nos dois projetos.
- CI usa 3 workflows GitHub Actions:
  - `.github/workflows/backend-api-tests.yml` — testes Jest (`--runInBand`, push/PR develop). ⚠️ `11_objetivos` costuma estourar o timeout de 150s do `beforeAll` no runner (compute do Supabase esgota o burst de CPU depois das suítes pesadas) — ver nota em `CLAUDE.md`; não é bug de código
  - `.github/workflows/frontend-quality.yml` — ESLint + build/TypeScript (push/PR develop e PR main). Substitui o antigo `frontend-lint.yml`, que não existe mais
  - `.github/workflows/frontend-e2e.yml` — Playwright Firefox (push/PR develop, mudanças em `FrontEnd/**`)
