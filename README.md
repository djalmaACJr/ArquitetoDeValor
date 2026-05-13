# Arquiteto de Valor

> Aplicação de gestão financeira pessoal — controle de contas, lançamentos, transferências, categorias, lembretes e relatórios.

![Status](https://img.shields.io/badge/status-em%20desenvolvimento-yellow)
![Testes](https://img.shields.io/badge/testes-~130%20API%20%2B%20~75%20E2E-brightgreen)
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

O **Arquiteto de Valor** é uma aplicação web para controle financeiro pessoal. Permite cadastrar contas bancárias, cartões e investimentos, lançar receitas e despesas, realizar transferências entre contas, categorizar movimentações, criar lembretes financeiros e gerar relatórios mensais.

A aplicação é composta por:
- **Frontend** — React 19 + Vite 8 + TypeScript + Tailwind CSS
- **Backend** — Supabase (PostgreSQL + Edge Functions em Deno/TypeScript)

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, Vite 8 (Rolldown), TypeScript 6, Tailwind CSS 3 |
| Backend | Supabase (PostgreSQL schema `arqvalor`, Edge Functions Deno/TS, Auth, RLS) |
| Testes API | Jest + ts-jest |
| Testes E2E | Playwright + Firefox |
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
│   │   │                            # CalendarioDashboard, MultiSelect, FiltrosSalvosBtn...
│   │   ├── context/
│   │   │   ├── AuthContext.tsx
│   │   │   └── PageStateContext.tsx # Persistência de estado entre páginas
│   │   ├── hooks/                   # useLancamentos, useContas, useCategorias,
│   │   │                            # useLembretes, useAssistente, useOcultarValores...
│   │   ├── lib/                     # api.ts, supabase.ts, utils.ts, constants.ts,
│   │   │                            # queryKeys.ts, logger.ts
│   │   ├── pages/                   # DashboardPage, LancamentosPage, ContasPage,
│   │   │                            # CategoriasPage, RelatoriosPage, ImportExportPage,
│   │   │                            # PerfilPage, LoginPage
│   │   └── types/                   # Tipos TypeScript globais
│   ├── e2e/                         # Testes E2E Playwright
│   │   ├── playwright.config.ts
│   │   ├── fixtures/                # auth.json (gerado automaticamente — não commitar)
│   │   └── tests/                   # Suites de testes
│   └── .env                         # Variáveis de ambiente (não commitar)
│
├── supabase/
│   ├── functions/                   # Edge Functions (Deno)
│   │   ├── _shared/                 # utils.ts, logger.ts compartilhados
│   │   ├── contas/
│   │   ├── categorias/
│   │   ├── transacoes/
│   │   ├── transferencias/
│   │   ├── lembretes/
│   │   ├── assistente/
│   │   ├── filtros/
│   │   ├── excluir_conta/
│   │   ├── version/
│   │   └── limpar/
│   └── migrations/                  # 15 migrations idempotentes
│
├── tests/                           # Testes automatizados de API (Jest)
│   ├── setup.ts
│   ├── 01_contas.test.ts
│   ├── 02_categorias.test.ts
│   ├── 03_transacoes.test.ts
│   ├── 04_transferencias.test.ts
│   ├── 05_lembretes.test.ts
│   ├── 06_assistente.test.ts
│   └── 99_limpar.test.ts
│
├── rodar_testes.bat                 # Menu de testes de API (Windows)
├── rodar_testes_e2e.bat             # Menu de testes E2E (Windows)
└── README.md
```

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) v22 ou superior
- [npm](https://www.npmjs.com/) v9 ou superior
- [Supabase CLI](https://supabase.com/docs/guides/cli) (para deploy das Edge Functions)
- Conta no [Supabase](https://supabase.com/)
- Git

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

Crie o arquivo `tests/.env` (ou na raiz do projeto):

```env
SUPABASE_URL=https://SEU_PROJECT_REF.supabase.co
SUPABASE_ANON_KEY=sua_anon_key_aqui
TEST_EMAIL=usuario_de_teste@email.com
TEST_PASSWORD=SenhaDoUsuarioDeTeste
```

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

# Testes E2E (Playwright)
cd FrontEnd
npm install
npx playwright install firefox
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

Cobrem as Edge Functions do Supabase — ~130 testes distribuídos em 7 módulos.

**Via menu interativo (Windows):**
```bash
rodar_testes.bat
```

**Via linha de comando:**
```bash
npx jest --runInBand --verbose
```

| Arquivo | Testes | Módulo |
|---|---|---|
| `01_contas.test.ts` | 19 | CA-CONTA01 a CA-CONTA19 |
| `02_categorias.test.ts` | 13 | CA-CAT01 a CA-CAT13 |
| `03_transacoes.test.ts` | 28 | CA-TX01 a CA-TX28 |
| `04_transferencias.test.ts` | 22 | CA-TRF01 a CA-TRF22 |
| `05_lembretes.test.ts` | 11 | CA-LEM01 a CA-LEM11 |
| `06_assistente.test.ts` | 9 | CA-ASS01 a CA-ASS09 |
| `99_limpar.test.ts` | 11 | CA-LIM01 a CA-LIM11 |

### Testes E2E (Playwright)

Cobrem os fluxos do frontend no Firefox — ~75 testes em 10 suites.

**Via menu interativo (Windows):**
```bash
rodar_testes_e2e.bat
```

**Via linha de comando:**
```bash
cd FrontEnd
npm run test:e2e          # headless
npm run test:e2e:ui       # modo visual (debug)
npm run test:e2e:report   # abre relatório HTML
```

> Em CI, o Playwright inicia o servidor Vite automaticamente via `webServer`. Localmente basta ter o Node instalado — sem precisar subir o servidor manualmente.

| Arquivo | Módulo |
|---|---|
| `00_cadastro.spec.ts` | E2E-CAD (fluxo de cadastro) |
| `01_contas.spec.ts` | E2E-CT01 a E2E-CT07 |
| `02_categorias.spec.ts` | E2E-CAT01 a E2E-CAT04 |
| `03_navegacao.spec.ts` | E2E-NAV01 a E2E-NAV05 |
| `04_extrato.spec.ts` | E2E-EX01 a E2E-EX14 |
| `05_dashboard.spec.ts` | E2E-DB01 a E2E-DB07 |
| `06_relatorios.spec.ts` | E2E-REL01 a E2E-REL07 |
| `07_transferencias.spec.ts` | E2E-TRF (fluxos de transferência) |
| `08_lembretes.spec.ts` | E2E-LEM (fluxos de lembretes) |
| `09_assistente.spec.ts` | E2E-ASS (sugestões de lançamento) |

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
| `TEST_EMAIL` | backend-api-tests | Email do usuário de testes |
| `TEST_PASSWORD` | backend-api-tests | Senha do usuário de testes |
| `VITE_SUPABASE_URL` | frontend-e2e | URL do Supabase (para o Vite dev server) |
| `VITE_SUPABASE_ANON_KEY` | frontend-e2e | Chave anon (para o Vite dev server) |

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
