# Arquiteto de Valor

> Aplicação de gestão financeira pessoal — controle de contas, lançamentos, transferências, categorias e relatórios.

![Status](https://img.shields.io/badge/status-em%20desenvolvimento-yellow)
![Testes](https://img.shields.io/badge/testes-82%20API%20%2B%2029%20E2E-brightgreen)
![Stack](https://img.shields.io/badge/stack-React%20%2B%20Supabase-blue)

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

O **Arquiteto de Valor** é uma aplicação web para controle financeiro pessoal. Permite cadastrar contas bancárias, cartões e investimentos, lançar receitas e despesas, realizar transferências entre contas, categorizar movimentações e gerar relatórios mensais.

A aplicação é composta por:
- **Frontend** — React + Vite + TypeScript + Tailwind CSS
- **Backend** — Supabase (PostgreSQL + Edge Functions em Deno/TypeScript)

---

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| Backend | Supabase (PostgreSQL, Edge Functions, Auth, RLS) |
| Testes API | Jest + TypeScript |
| Testes E2E | Playwright + Firefox |
| CI/CD | GitHub Actions |

---

## Estrutura do projeto

```
ArquitetoDeValor/
│
├── FrontEnd/                        # Aplicação React
│   ├── src/
│   │   ├── components/              # Componentes reutilizáveis
│   │   │   ├── layout/              # AppLayout, Sidebar
│   │   │   └── ui/                  # Shared, DrawerLancamento, MultiSelect...
│   │   ├── context/
│   │   │   └── PageStateContext.tsx # Persistência de estado entre páginas
│   │   ├── hooks/                   # useDashboard, useLancamentos, useContas...
│   │   ├── lib/                     # api.ts, supabase.ts, utils.ts
│   │   ├── pages/                   # DashboardPage, LancamentosPage...
│   │   └── types/                   # Tipos TypeScript globais
│   ├── e2e/                         # Testes E2E Playwright
│   │   ├── playwright.config.ts
│   │   ├── fixtures/                # auth.json (gerado automaticamente)
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
│   │   └── limpar/
│   └── migrations/                  # Migrations do banco
│
├── tests/                           # Testes automatizados de API (Jest)
│   ├── setup.ts
│   ├── 01_contas.test.ts
│   ├── 02_categorias.test.ts
│   ├── 03_transacoes.test.ts
│   ├── 04_transferencias.test.ts
│   └── 99_limpar.test.ts
│
├── rodar_testes.bat                 # Menu de testes de API (Windows)
├── rodar_testes_e2e.bat             # Menu de testes E2E (Windows)
└── README.md
```

---

## Pré-requisitos

- [Node.js](https://nodejs.org/) v18 ou superior
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

Acesse o **SQL Editor** do Supabase e execute as migrations em ordem:

```
supabase/migrations/
  01_schema_inicial.sql
  02_...
  ...
```

Ou via Supabase CLI:

```bash
supabase db push --project-ref SEU_PROJECT_REF
```

### 6. Deploy das Edge Functions

```bash
# Login no Supabase CLI
supabase login

# Deploy de todas as funções
supabase functions deploy --project-ref SEU_PROJECT_REF
```

### 7. Instalar dependências dos testes

```bash
# Testes de API (Jest)
cd tests
npm install

# Testes E2E (Playwright)
cd FrontEnd
npm install -D @playwright/test
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

Cobrem as Edge Functions do Supabase — 82 testes distribuídos em 4 módulos.

**Via menu interativo (Windows):**
```bash
rodar_testes.bat
```

**Via linha de comando:**
```bash
cd tests
npx jest --runInBand --verbose
```

| Arquivo | Testes | Módulo |
|---|---|---|
| `01_contas.test.ts` | 19 | CA-CONTA01 a CA-CONTA19 |
| `02_categorias.test.ts` | 13 | CA-CAT01 a CA-CAT13 |
| `03_transacoes.test.ts` | 28 | CA-TX01 a CA-TX28 |
| `04_transferencias.test.ts` | 22 | CA-TRF01 a CA-TRF22 |

### Testes E2E (Playwright)

Cobrem os fluxos do frontend no Firefox — 29 testes em 6 suites.

> ⚠️ O frontend precisa estar rodando em `http://localhost:5173` antes de executar os testes E2E.

**Via menu interativo (Windows):**
```bash
rodar_testes_e2e.bat
```

**Via linha de comando:**
```bash
cd FrontEnd
npx playwright test --config=e2e/playwright.config.ts
```

**Modo visual (debug interativo):**
```bash
npx playwright test --config=e2e/playwright.config.ts --ui
```

**Ver relatório HTML:**
```bash
npx playwright show-report e2e/report
```

| Arquivo | Testes | Módulo |
|---|---|---|
| `01_dashboard.spec.ts` | 6 | E2E-DB01 a E2E-DB06 |
| `02_extrato.spec.ts` | 8 | E2E-EX01 a E2E-EX08 |
| `03_contas.spec.ts` | 6 | E2E-CT01 a E2E-CT06 |
| `04_categorias.spec.ts` | 4 | E2E-CAT01 a E2E-CAT04 |
| `05_relatorios.spec.ts` | 6 | E2E-REL01 a E2E-REL06 |
| `06_navegacao.spec.ts` | 5 | E2E-NAV01 a E2E-NAV05 |

---

## CI/CD

O projeto utiliza **GitHub Actions** para executar os testes de API automaticamente a cada push ou pull request.

Configure os seguintes **Secrets** no repositório (`Settings → Secrets and variables → Actions`):

| Secret | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | Chave anon do Supabase |
| `TEST_EMAIL` | Email do usuário de testes |
| `TEST_PASSWORD` | Senha do usuário de testes |

---

## Funcionalidades

- **Contas** — CRUD de contas bancárias, cartões, investimentos e carteira. Campos de dia de fechamento e pagamento para cartões.
- **Categorias** — CRUD hierárquico (pai/filho). Categoria "Transferências" protegida.
- **Lançamentos** — Receitas e despesas com suporte a recorrência (parcelas mensais, semanais, anuais). Escopos de edição: somente este, este e seguintes, todos.
- **Transferências** — Movimentação entre contas em par (débito + crédito). Suporte a recorrência.
- **Dashboard** — Resumo mensal, vencidos, próximos a vencer, evolução mensal em gráfico, saldo por conta.
- **Relatórios** — Análise por categoria e período, exportação para Excel (.xlsx).
- **Importação/Exportação** — Importação via planilha Excel e exportação completa dos dados.

---

## .gitignore recomendado

Certifique-se que os seguintes itens estão no `.gitignore`:

```
# Ambiente
.env
.env.local

# Testes E2E
FrontEnd/e2e/fixtures/auth.json
FrontEnd/e2e/report/
FrontEnd/e2e/test-results/

# Build
FrontEnd/dist/

# Dependências
node_modules/
```
# dica para claude vs code
inicie com 
Use CLAUDE.md, ARCHITECTURE.md e BUSINESS_RULES.md como contexto.