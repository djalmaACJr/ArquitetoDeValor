# Arquiteto de Valor

> Aplicação de gestão financeira e patrimonial pessoal — contas, lançamentos, transferências, categorias, lembretes, objetivos financeiros, investimentos, importação de fatura de cartão e relatórios.

![Status](https://img.shields.io/badge/status-em%20desenvolvimento-yellow)
![Testes](https://img.shields.io/badge/testes-207%20API%20%2B%2093%20E2E-brightgreen)
![Stack](https://img.shields.io/badge/stack-React%2019%20%2B%20Supabase-blue)

---

## Sumário

- [Visão geral](#visão-geral)
- [Stack](#stack)
- [Estrutura do projeto](#estrutura-do-projeto)
- [Pré-requisitos](#pré-requisitos)
- [Configuração do ambiente](#configuração-do-ambiente)
- [Rodando o projeto](#rodando-o-projeto)
- [Testes automatizados](#testes-automatizados)
- [CI/CD](#cicd)
- [Funcionalidades](#funcionalidades)

---

## Visão geral

O **Arquiteto de Valor** é uma aplicação web para controle financeiro e patrimonial pessoal. Permite cadastrar contas bancárias, cartões (com cartões virtuais) e investimentos, lançar receitas e despesas, realizar transferências entre contas, categorizar movimentações, criar lembretes financeiros, importar faturas de cartão de crédito (PDF), acompanhar metas financeiras (Objetivos) e gerir uma carteira de investimentos completa (ações, FIIs, renda fixa, tesouro direto e cripto), com apoio de um assistente de lançamentos e de mentores de IA configuráveis.

A aplicação é composta por:
- **Frontend** — React 19 + Vite 8 + TypeScript + Tailwind CSS
- **Backend** — Supabase (PostgreSQL + Edge Functions em Deno/TypeScript)
- **App Android** — o mesmo frontend empacotado com Capacitor (WebView), com login por digital, sessão mais restritiva e atualização OTA do bundle sem passar pela Play Store

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, Vite 8 (Rolldown), TypeScript 6, Tailwind CSS 3 |
| Backend | Supabase (PostgreSQL schema `arqvalor`, Edge Functions Deno/TS, Auth, RLS) |
| App Android | Capacitor 8 (`@capacitor/app`, `@capgo/capacitor-native-biometric`, `@capgo/capacitor-updater`) |
| Testes API | Jest + ts-jest |
| Testes E2E | Playwright (Firefox padrão + Chromium/Android opcional) |
| CI/CD | GitHub Actions (4 workflows) |

---

## Estrutura do projeto

```
ArquitetoDeValor/
│
├── FrontEnd/                        # Aplicação React
│   ├── src/
│   │   ├── components/              # Componentes reutilizáveis
│   │   │   ├── layout/              # AppLayout, Sidebar
│   │   │   └── ui/                  # DrawerLancamento, BotaoOcultar, ModalLembrete,
│   │   │                            # CalendarioDashboard, MultiSelect, FiltrosSalvosBtn,
│   │   │                            # CardObjetivo, DrawerObjetivo, FiltrosObjetivos,
│   │   │                            # DrawerAtivo, DrawerMovimentacoes, QuadroTipoAtivos,
│   │   │                            # QuadroCorrelacao, QuadroSobreposicao, ChatMascote...
│   │   ├── context/
│   │   │   ├── AuthContext.tsx
│   │   │   ├── PageStateContext.tsx # Persistência de estado entre páginas
│   │   │   └── ContextoIAContext.tsx# Contexto da página enviado ao chat com IA
│   │   ├── hooks/                   # useLancamentos, useContas, useCategorias,
│   │   │                            # useLembretes, useAssistente, useObjetivos,
│   │   │                            # useOcultarValores, useFaturasImport,
│   │   │                            # useInvestimentosAtivos/Posicoes/Operacoes/Dashboard,
│   │   │                            # useDividendos, usePtax, useInvAvaliacoes...
│   │   ├── lib/                     # api.ts, supabase.ts, utils.ts, constants.ts,
│   │   │                            # queryKeys.ts, logger.ts, questionarioAtivos.ts
│   │   ├── pages/                   # DashboardPage, LancamentosPage, ContasPage,
│   │   │                            # CategoriasPage, RelatoriosPage, ImportExportPage,
│   │   │                            # PerfilPage, LoginPage, ObjetivosPage, ObjetivoDetalhe,
│   │   │                            # InvestimentosPage, AtivosInvestimentosPage,
│   │   │                            # DividendosPage, AvaliacoesInvestimentosPage,
│   │   │                            # DetalheInvestimentoPage, ImportarFaturaPage,
│   │   │                            # AssinaturasPage, ComparativoMensalPage,
│   │   │                            # ProjecaoEconomiaPage
│   │   └── types/                   # Tipos TypeScript globais
│   ├── e2e/                         # Testes E2E Playwright
│   │   ├── playwright.config.ts     # Projetos: auth, data, firefox (padrão), mobile (Android, opcional)
│   │   ├── fixtures/                # auth.json (gerado automaticamente — não commitar)
│   │   └── tests/                   # Suites de testes (00–11 + setup + teardown)
│   ├── android/                     # Projeto nativo gerado pelo Capacitor (build/instalação do APK)
│   ├── capacitor.config.ts          # appId, updateUrl OTA, publicKey de assinatura do bundle
│   ├── scripts/publish-android-ota.mjs # Publica atualização OTA (npm run publish:ota)
│   └── .env.local                   # Chaves Supabase para o Vite (não commitar)
│
├── supabase/
│   ├── functions/                   # Edge Functions (Deno)
│   │   ├── _shared/                 # utils.ts, logger.ts, cripto.ts compartilhados
│   │   ├── contas/
│   │   ├── categorias/
│   │   ├── transacoes/
│   │   ├── transferencias/
│   │   ├── lembretes/
│   │   ├── assistente/
│   │   ├── objetivos/               # CRUD + sincronizar-progresso
│   │   ├── investimentos/           # Ativos, posições, dividendos, avaliação IA, cron jobs
│   │   ├── faturas/                 # Importação de fatura (PDF) + parsers/ por emissor
│   │   ├── filtros/
│   │   ├── excluir_conta/
│   │   ├── ia_configs/
│   │   ├── chat_mascote/
│   │   ├── version/
│   │   ├── app_updates/             # OTA do app Android — endpoint público, sem JWT
│   │   └── limpar/
│   └── migrations/                  # Migrations idempotentes (CREATE OR REPLACE/IF NOT EXISTS)
│       └── Aplicados/               # Migrations já aplicadas/arquivadas
│
├── tests/                           # Testes automatizados de API (Jest)
│   ├── setup.ts
│   ├── 01_contas.test.ts
│   ├── 02_categorias.test.ts
│   ├── 03_transacoes.test.ts
│   ├── 04_transferencias.test.ts
│   ├── 05_lembretes.test.ts
│   ├── 06_assistente.test.ts
│   ├── 07_seguranca_rls.test.ts     # Isolamento entre usuários
│   ├── 08_seguranca_triggers.test.ts# Triggers e FK cross-user
│   ├── 09_seguranca_rpc.test.ts     # SECURITY INVOKER RPCs
│   ├── 10_seguranca_auth_cors.test.ts # Auth + CORS
│   ├── 11_objetivos.test.ts         # Objetivos Financeiros (CA-OBJ01..17)
│   ├── 12_investimentos.test.ts     # Investimentos (CA-INV01..26)
│   └── 99_limpar.test.ts            # Limpeza pós-suite (execução manual)
│
├── rodar_testes.bat                 # Menu de testes de API (Windows)
├── rodar_testes_e2e.bat             # Menu de testes E2E (Windows)
├── instalar_android.bat             # Build + instala o APK debug via USB
├── version.ts                       # APP_VERSION — versão única do app (web + Android)
├── CLAUDE.md                        # Contexto principal para assistentes de IA
├── ARCHITECTURE.md                  # Detalhe técnico de arquitetura/banco (sob demanda)
├── BUSINESS_RULES.md                # Regras de negócio detalhadas (sob demanda)
└── README.md
```

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) v22 ou superior
- [npm](https://www.npmjs.com/) v9 ou superior
- [Supabase CLI](https://supabase.com/docs/guides/cli) (para deploy das Edge Functions)
- Conta no [Supabase](https://supabase.com/)
- Git
- **(Opcional, só para build do app Android)** [JDK 21 (LTS)](https://adoptium.net/temurin/releases/?version=21) + Android SDK — ver [seção 9](#9-opcional-build-do-app-android)

---

## Configuração do ambiente

### 1. Clonar o repositório

```bash
git clone https://github.com/SEU_USUARIO/ArquitetoDeValor.git
cd ArquitetoDeValor
```

### 2. Instalar dependências do frontend

```bash
cd FrontEnd
npm install
```

### 3. Configurar variáveis de ambiente

Crie o arquivo `FrontEnd/.env` com base no exemplo abaixo:

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=sua_anon_key_aqui
```

> As chaves estão disponíveis no painel do Supabase em **Project Settings → API**.

### 4. Configurar variáveis de ambiente para testes de API

Crie o arquivo `.env` na raiz do projeto (use `.env.example` como base):

```env
# Projeto Supabase
SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=sua_anon_key_aqui   # chave "anon/public", não service_role

# Usuário A — testes de domínio (contas, transações, etc.)
TEST_EMAIL=usuario_de_teste@email.com
TEST_PASSWORD=SenhaDoUsuarioDeTeste

# Usuário B — testes de segurança/RLS (07_seguranca_rls, 08_seguranca_triggers,
# 09_seguranca_rpc). Sem isso, ~9 testes são pulados graciosamente.
TEST_EMAIL_B=outro_usuario@email.com
TEST_PASSWORD_B=SenhaDoUsuarioB
```

> O Jest carrega esse arquivo automaticamente via `dotenv` configurado em `jest.config.js`. O arquivo `tests/.env` também é suportado como alternativa.

### 5. Configurar banco de dados

Execute as migrations via Supabase CLI:

```bash
supabase db push --project-ref SEU_PROJECT_REF
```

Ou acesse o **SQL Editor** do Supabase e execute os arquivos de `supabase/migrations/` em ordem crescente de nome.

### 6. Deploy das Edge Functions

```bash
# Login no Supabase CLI
supabase login

# Deploy de todas as funções
supabase functions deploy --project-ref SEU_PROJECT_REF
```

### 7. Instalar dependências dos testes

```bash
# Testes de API (Jest) — raiz do projeto
npm install

# Testes E2E (Playwright) — pasta FrontEnd
cd FrontEnd
npm install
npx playwright install firefox   # baixa o binário do Firefox para o Playwright
```

### 8. Configurar variáveis do frontend para E2E

Crie `FrontEnd/.env.local` (não commitado):

```env
VITE_SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
VITE_SUPABASE_ANON_KEY=sua_anon_key_aqui
```

> O Playwright abre a aplicação no browser — ela precisa dessas chaves para autenticar no Supabase. Em CI elas são injetadas via secrets.

### 9. (Opcional) Build do app Android

A pasta `FrontEnd/android/` já é o projeto nativo gerado pelo Capacitor — só falta ter o JDK e o Android SDK instalados na máquina.

**JDK — precisa ser a versão 21 (LTS), nem 17 nem 24.** O projeto (`app/capacitor.build.gradle` e `capacitor-cordova-android-plugins/build.gradle`) fixa `sourceCompatibility`/`targetCompatibility` em `JavaVersion.VERSION_21`, e o `gradlew.bat` já vem com o Gradle 9.6.1 embutido (não precisa instalar Gradle à parte).

```powershell
# Windows, via winget
winget install EclipseAdoptium.Temurin.21.JDK

# Depois, confirme:
java -version   # deve mostrar "21.x.x"
```

Se preferir instalar manualmente, baixe o **Eclipse Temurin 21** em [adoptium.net](https://adoptium.net/temurin/releases/?version=21) e garanta que `JAVA_HOME` aponte para a instalação (o instalador do Temurin já oferece isso como opção).

**Android SDK** — se você não usa o Android Studio, instale ao menos as `cmdline-tools` e rode `sdkmanager --licenses` + `sdkmanager "platform-tools" "platforms;android-36" "build-tools;36.0.0"`. Se já usa o Android Studio, ele cuida disso sozinho (SDK Manager). Garanta que `ANDROID_HOME`/`ANDROID_SDK_ROOT` aponte pro SDK (normalmente `%LOCALAPPDATA%\Android\Sdk` no Windows) — o `gradlew.bat` também lê o `local.properties` gerado pelo Android Studio como alternativa.

Com JDK 21 e SDK prontos, builde e instale no celular conectado via USB (com "Instalar via USB" ativo no aparelho):

```bash
# Na raiz do repo — build + sync + instala o APK debug
./instalar_android.bat

# Equivalente manual (dentro de FrontEnd/):
npm run build
npx cap sync android
cd android
gradlew.bat installDebug
```

---

## Rodando o projeto

### Frontend (desenvolvimento)

```bash
cd FrontEnd
npm run dev
```

Acesse: [http://localhost:5173](http://localhost:5173)

### Frontend (build de produção)

```bash
cd FrontEnd
npm run build
npm run preview
```

---

## Testes automatizados

### Testes de API (Jest)

Cobrem as Edge Functions do Supabase — distribuídos em 12 módulos (+ limpeza manual).

**Via menu interativo (Windows):**
```bash
rodar_testes.bat   # opções 1–17: domínio, segurança, manutenção
```

**Via linha de comando:**
```bash
# Na raiz do projeto
npm test                    # todos os módulos (exceto 99_limpar)
npm run test:contas         # módulo específico
```

> `99_limpar.test.ts` apaga todos os dados do usuário de teste. **Não é executado no `npm test`** — rode pelo menu (opção 9) ou via `npm run test:limpar` após fazer backup.

| Arquivo | Módulo |
|---|---|
| `01_contas.test.ts` | CA-CONTA01–21 |
| `02_categorias.test.ts` | CA-CAT01–15 |
| `03_transacoes.test.ts` | CA-TX01–35 |
| `04_transferencias.test.ts` | CA-TRF01–27 |
| `05_lembretes.test.ts` | CA-LEM01–11 |
| `06_assistente.test.ts` | CA-ASS01–09 |
| `07_seguranca_rls.test.ts` | SEG-RLS01–08 — requer `TEST_EMAIL_B` |
| `08_seguranca_triggers.test.ts` | SEG-TRG01–15 — requer `TEST_EMAIL_B` |
| `09_seguranca_rpc.test.ts` | SEG-RPC01–05 — requer `TEST_EMAIL_B` |
| `10_seguranca_auth_cors.test.ts` | SEG-AUTH01–03 / SEG-CORS01–03 |
| `11_objetivos.test.ts` | CA-OBJ01–17 (inclui CRESCIMENTO) |
| `12_investimentos.test.ts` | CA-INV01–26 |
| `99_limpar.test.ts` | Limpeza — somente manual |

### Testes E2E (Playwright)

Cobrem os fluxos do frontend — 13 suites, rodadas por padrão no Firefox (projeto `firefox`). Há também um projeto `mobile` opcional (Chromium, viewport/toque de Android — `npm run test:e2e:mobile`), que reexecuta a mesma suíte pra pegar regressões de layout responsivo antes de builds do app Android; não cobre trechos que só existem no app nativo de verdade (biometria, swipe, teclado nativo).

A sessão do Supabase usa `localStorage` no navegador (compartilhada entre abas — `Capacitor.isNativePlatform()` é sempre `false` fora do app Android, mesmo no projeto `mobile`), que é exatamente o que o `storageState` do Playwright persiste entre specs — **não é necessário nenhum modo especial nem variável de ambiente** para rodar localmente:

```bash
cd FrontEnd
npm run test:e2e          # headless, Firefox (sobe o Vite dev server automaticamente)
npm run test:e2e:mobile   # headless, Chromium/Android — opcional
npm run test:e2e:ui       # modo visual (debug)
npm run test:e2e:report   # abre relatório HTML
```

**Via menu interativo (Windows):**
```bash
rodar_testes_e2e.bat
```

> Em CI, o `webServer` do Playwright sobe o Vite automaticamente.

> ⚠️ O script `npm run dev:e2e` e o arquivo `.env.e2e` (`VITE_E2E=true`) ainda existem no projeto, mas `FrontEnd/src/lib/supabase.ts` hoje decide o storage por `Capacitor.isNativePlatform()` (não por essa variável) — no navegador (E2E incluso) sempre resolve pra `localStorage`. Trate-os como vestigiais até uma limpeza dedicada.

| Arquivo | Módulo |
|---|---|
| `auth.setup.ts` | Login e salvamento de sessão (`fixtures/auth.json`) |
| `data.setup.ts` | Criação de dados base (contas, categorias) |
| `00_cadastro.spec.ts` | Fluxo de cadastro de novo usuário |
| `01_contas.spec.ts` | E2E-CT01–07 |
| `02_categorias.spec.ts` | E2E-CAT01–04 |
| `03_navegacao.spec.ts` | E2E-NAV01–05 |
| `04_extrato.spec.ts` | E2E-EX01–14 |
| `05_dashboard.spec.ts` | E2E-DB01–07 |
| `06_relatorios.spec.ts` | E2E-REL01–07 |
| `07_transferencias.spec.ts` | Fluxos de transferência |
| `08_lembretes.spec.ts` | Fluxos de lembretes |
| `09_assistente.spec.ts` | Sugestões de lançamento |
| `10_objetivos.spec.ts` | E2E-OBJ01–07 — Objetivos Financeiros |
| `11_investimentos.spec.ts` | Fluxos de Investimentos (ativos, posições, dividendos) |
| `zz_teardown.spec.ts` | Limpeza de dados E2E pós-suite |

---

## CI/CD

O projeto usa **4 workflows GitHub Actions**, todos disparados em push ou pull request para `develop`:

| Workflow | O que faz |
|---|---|
| `backend-api-tests.yml` | Executa os testes Jest (Edge Functions) |
| `frontend-lint.yml` | ESLint no código TypeScript/React |
| `frontend-quality.yml` | Build de produção + verificação TypeScript |
| `frontend-e2e.yml` | Testes Playwright Firefox (apenas quando `FrontEnd/**` muda) |

Configure os seguintes **Secrets** no repositório (`Settings → Secrets and variables → Actions`):

| Secret | Usado por | Descrição |
|---|---|---|
| `SUPABASE_URL` | backend-api-tests | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | backend-api-tests | Chave anon do Supabase |
| `TEST_EMAIL` | backend-api-tests | Email do usuário A de testes |
| `TEST_PASSWORD` | backend-api-tests | Senha do usuário A |
| `TEST_EMAIL_B` | backend-api-tests | Email do usuário B (testes de RLS/segurança) |
| `TEST_PASSWORD_B` | backend-api-tests | Senha do usuário B |
| `VITE_SUPABASE_URL` | frontend-e2e | URL do Supabase (Vite dev server) |
| `VITE_SUPABASE_ANON_KEY` | frontend-e2e | Chave anon (Vite dev server) |

> `TEST_EMAIL_B` e `TEST_PASSWORD_B` são opcionais: sem eles, os ~9 testes de segurança cross-user são pulados graciosamente (não falham o CI).

---

## Funcionalidades

- **Contas** — CRUD de contas bancárias, cartões, investimentos e carteira. Campos de dia de fechamento e pagamento para cartões. Saldo calculado dinamicamente.
- **Categorias** — CRUD hierárquico (pai/filho, 2 níveis). Categoria "Transferências" protegida (não pode ser excluída nem editada além de cor/ícone).
- **Lançamentos** — Receitas e despesas com suporte a recorrência (diária, semanal, mensal, anual). Escopos de edição: somente este, este e seguintes, todos. Antecipação de parcelas.
- **Transferências** — Movimentação entre contas em par atômico (débito + crédito). Suporte a recorrência.
- **Lembretes** — Avisos financeiros com data e status (pendente/concluído). Podem ser vinculados a lançamentos. Exibidos no calendário do Dashboard.
- **Assistente de Lançamentos** — Sugestão automática de categoria, conta e tipo ao digitar uma descrição, com base em lançamentos anteriores.
- **Filtros Salvos** — Conjuntos nomeados de filtros por página (Dashboard, Extrato, Relatórios), reapliáveis a qualquer momento.
- **Ocultar Valores** — Mascara todos os valores monetários na tela com persistência por usuário no banco.
- **Dashboard** — Resumo mensal, vencidos, próximos a vencer, evolução mensal em gráfico, saldo por conta, calendário de lembretes.
- **Relatórios** — Análise por categoria e período, exportação para Excel (.xlsx).
- **Importação/Exportação** — Importação via planilha Excel e exportação completa dos dados.
- **Objetivos Financeiros** — Criação e acompanhamento de metas com 4 tipos: **Sonho** (saldo-alvo em conta), **Objetivo** (meta recorrente por categoria), **Projeto** (orçamento por conta) e **Crescimento** (% de crescimento anual por categoria). Dashboard com gráficos de progresso, evolução mensal/anual, comparativo ano a ano e histórico de revisões.
- **Investimentos** — Carteira multi-tipo (ações, FIIs, renda fixa, tesouro direto, cripto, ações/ETFs internacionais). Posições calculadas a partir do histórico de operações (compra/venda/aporte/resgate/rendimento), dividendos com Dividend Yield e Yield on Cost, avaliação de ativos por múltiplos mentores de IA, metas de alocação, snapshot mensal de patrimônio via cron.
- **Importação de Fatura de Cartão** — Upload de PDF (Nubank/C6/Inter/MercadoPago/genérico), sandbox de revisão com classificação e matching automático contra lançamentos existentes, lançamento por item ou por categoria/grupo, com validação de que o total bate com a fatura.
- **Cartões Virtuais** — Sub-identificadores organizacionais de um cartão físico (sem limite/saldo próprio), reconhecidos automaticamente na importação de fatura.
- **Assinaturas, Comparativo Mensal e Projeção de Economia** — Análises adicionais sobre o extrato: detecção de gastos recorrentes, comparação de dois períodos livres e simulação de patrimônio futuro por juros compostos.
- **Mascotes e Chat com IA** — Assistente conversacional com mentor escolhido pelo usuário, múltiplos provedores de IA (Claude, GPT, Gemini, DeepSeek, OpenRouter, Mistral, Cohere) com credenciais cifradas, e tutorial guiado por página.
- **App Android** — Mesmo código React empacotado com Capacitor. Login por digital (biometria, credenciais cifradas em repouso no aparelho), sessão mais restritiva que no desktop (`sessionStorage`, auto-logout de 5min vs 15min, detecção de pause/resume nativo), e atualização OTA do bundle direto do Supabase — sem passar pela Play Store a cada release.
