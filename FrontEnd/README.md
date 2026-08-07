# Arquiteto de Valor — Frontend

Aplicação de gestão financeira pessoal (web + app Android via Capacitor). Controle de contas, lançamentos com recorrência, transferências, relatórios, lembretes, assistente inteligente de lançamentos, Objetivos, Investimentos e importação de fatura de cartão.

**Versão atual:** ver `APP_VERSION` em [`version.ts`](../version.ts) (raiz do repo).

> Este README cobre a instalação e visão geral do frontend. Para o contexto completo do sistema (regras de negócio, arquitetura do backend, todos os módulos) veja [`CLAUDE.md`](../CLAUDE.md) na raiz do repo — é o documento mantido em sincronia com o código.

---

## Pré-requisitos

- Node.js 20+
- Conta Supabase com o projeto configurado (schema `arqvalor`)

---

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
cp .env.example .env.local
# Edite .env.local:
# VITE_SUPABASE_URL=https://<seu-project-ref>.supabase.co
# VITE_SUPABASE_ANON_KEY=<sua-anon-key>

# 3. Rodar em desenvolvimento
npm run dev
# http://localhost:5173
```

---

## Scripts disponíveis

| Comando | Descrição |
|---|---|
| `npm run dev` | Servidor de desenvolvimento (Vite, porta 5173) |
| `npm run build` | Build de produção |
| `npm run preview` | Preview do build local |
| `npm run lint` | ESLint + TypeScript check |
| `npm run test:e2e` | Playwright headless (Firefox) |
| `npm run test:e2e:mobile` | Playwright headless (Chromium, viewport/toque Android — não roda por padrão) |
| `npm run test:e2e:ui` | Playwright modo visual |
| `npm run test:e2e:report` | Abre relatório HTML do Playwright |
| `npm run publish:ota` | Publica atualização OTA do app Android (ver seção "App Android" abaixo) |

---

## Deploy na Vercel

1. Push do repositório para o GitHub
2. Importe em [vercel.com](https://vercel.com) apontando para `FrontEnd/` como root
3. Configure as variáveis de ambiente:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. O arquivo `vercel.json` já configura rewrite de SPA (`/* → /index.html`)

---

## Stack

| Camada | Tecnologia |
|---|---|
| UI | React 19 + TypeScript 6 |
| Build | Vite 8 (Rolldown) |
| Estilos | Tailwind CSS 3 |
| Roteamento | React Router 7 |
| Componentes | Radix UI (Dialog, Dropdown, Select, Tooltip) |
| Gráficos | Chart.js 4 + react-chartjs-2 |
| Ícones | Lucide React |
| Cache/fetch | @tanstack/react-query (`staleTime: 30s`) |

---

## Estrutura do projeto

Amostra representativa — o app cresceu bastante desde a 1ª versão (Objetivos, Investimentos, Importação de fatura, Mascotes/IA, app Android). **Inventário completo e atualizado em [`CLAUDE.md`](../CLAUDE.md) › "📁 Estrutura relevante".**

```
src/
├── pages/                        # Uma página por rota — financeiro básico,
│                                  # análises client-side, Objetivos,
│                                  # Investimentos (7 páginas), Importar fatura
│   ├── LoginPage.tsx              # + login por digital (Android)
│   ├── DashboardPage.tsx
│   ├── LancamentosPage.tsx
│   ├── ContasPage.tsx
│   ├── CategoriasPage.tsx
│   ├── RelatoriosPage.tsx
│   ├── ImportExportPage.tsx
│   └── PerfilPage.tsx             # + seção "Login por digital" (Android)
│
├── components/
│   ├── layout/                   # AppLayout, Sidebar
│   └── ui/                       # Componentes reutilizáveis — financeiro
│       │                        # básico, Mascotes/IA (Chat, Tutorial),
│       │                        # Objetivos, Investimentos
│       ├── DrawerLancamento.tsx  # Formulário criar/editar lançamento
│       ├── Calculadora.tsx       # Calculadora embutida no drawer
│       ├── BotaoNovoLancamento.tsx
│       ├── FiltrosLancamentos.tsx
│       ├── FiltrosSalvosBtn.tsx  # Salvar/aplicar filtros nomeados
│       ├── ModalLembrete.tsx     # Criar/editar lembrete
│       ├── CalendarioDashboard.tsx # Calendário com lembretes e eventos de cartão
│       ├── MonthPicker.tsx
│       ├── MultiSelect.tsx
│       ├── IconeConta.tsx
│       ├── AppVersion.tsx
│       └── shared/               # Primitivos compartilhados
│
├── hooks/                        # Lógica de negócio (React Query) — um
│                                  # hook por domínio (~40 hoje)
│   ├── useAuth.ts
│   ├── useContas.ts
│   ├── useCategorias.ts
│   ├── useLancamentos.ts
│   ├── useDashboard.ts
│   ├── useFiltrosSalvos.ts       # Filtros nomeados persistidos
│   ├── useLembretes.ts           # CRUD de lembretes
│   ├── useAssistente.ts          # Sugestões automáticas de lançamento
│   └── useTheme.ts
│
├── context/
│   ├── AuthContext.tsx            # Sessão Supabase
│   └── PageStateContext.tsx       # Filtros persistidos entre páginas
│
├── lib/
│   ├── api.ts                    # apiFetch / apiMutate (HTTP + JWT)
│   ├── supabase.ts               # Cliente Supabase Auth (storage por plataforma)
│   ├── biometria.ts              # Login por digital (só Android)
│   ├── constants.ts              # ENUMs centralizados
│   ├── queryKeys.ts              # Chaves React Query
│   ├── utils.ts                  # Formatação, helpers
│   └── logger.ts                 # log/debug no-op em produção
│
└── types/
    └── index.ts                  # Tipos compartilhados (re-exporta enums)

android/                          # Projeto nativo gerado pelo Capacitor
capacitor.config.ts               # appId, updateUrl OTA, publicKey de assinatura
scripts/publish-android-ota.mjs   # Publica atualização OTA (npm run publish:ota)
```

---

## Funcionalidades

### Dashboard
- Resumo mensal (entradas, saídas, resultado)
- Gráfico de despesas por categoria
- Saldo por conta
- **Calendário mensal** com lembretes e datas de fechamento/pagamento de cartões

### Extrato (Lançamentos)
- Listagem com filtros avançados (período, conta, categoria, status, tipo, busca por texto)
- **Busca multi-mês** com escopo configurável
- Drawer de criação/edição com calculadora embutida
- Suporte a recorrência (parcelas e projeções)
- **Filtros salvos** — salvar e reaplicar conjuntos de filtros com nome

### Transferências
- Par débito/crédito atômico entre contas
- Suporte a recorrência em série

### Contas
- CRUD completo (Corrente, Remuneração, Cartão, Investimento, Carteira)
- Ícone e cor personalizáveis
- Cartão: `dia_fechamento` e `dia_pagamento`

### Categorias
- Hierarquia pai → filho (2 níveis)
- Inativação em cascata
- Categoria "Transferências" protegida (somente cor/ícone editáveis)

### Lembretes
- Criação de lembretes por data com status PENDENTE/CONCLUÍDO
- Vinculação opcional a um lançamento
- Exibição no calendário do Dashboard
- Filtro por mês

### Assistente de Lançamentos
- Sugestão automática ao digitar descrição no drawer
- Preenche categoria, conta e flag de transferência automaticamente
- Gerenciamento de padrões pelo usuário (criar, editar, excluir)

### Relatórios
- Análise por período multi-mês
- Agrupamento por categoria pai com expansão por subcategoria e descrição
- Exportação Excel

### Importação / Exportação
- Importação XLSX/CSV de transações
- Detecção automática de pares de transferência na importação
- Backup e restauração JSON
- Reativação temporária de contas inativas durante importação

### Perfil
- Dados do usuário
- Gerenciamento de filtros salvos (renomear / excluir)
- Exclusão de conta (apaga todos os dados)
- Login por digital (Android) — ativar/desativar

### Objetivos
- 4 tipos: Sonho (saldo acumulado), Meta de Renda, Projeto (orçamento, ainda oculto na UI), Crescimento Anual
- Progresso calculado sempre por trigger no banco, nunca pela API

### Investimentos
- Carteira: ações, FIIs, renda fixa, tesouro direto, cripto, stocks/ETFs internacionais
- Dividendos/proventos com DY/YoC, avaliação de ativos por mentores de IA, snapshot mensal de patrimônio via cron

### Importação de fatura
- Upload de PDF (Nubank/C6/Inter/MercadoPago/genérico) → parse → sessão de revisão com matching automático → confirmação em massa

### Mascotes + IA
- Onboarding escolhendo mascote/apelido/tema; chat com IA (múltiplos provedores) com contexto opcional da página; tutorial guiado por página

> Detalhe completo de todos os módulos acima em [`CLAUDE.md`](../CLAUDE.md) e [`BUSINESS_RULES.md`](../BUSINESS_RULES.md).

### App Android
- Mesmo código React, empacotado com Capacitor 8 (WebView)
- Login por digital (biometria), sessão mais restritiva (`sessionStorage`, auto-logout de 5min) e atualização OTA do bundle sem passar pela Play Store
- Build/instalação: `../instalar_android.bat` (raiz do repo) ou `npm run build && npx cap sync android`
- Detalhe completo em [`CLAUDE.md`](../CLAUDE.md) › "Sessão + biometria (Android)"

---

## Testes E2E (Playwright)

Localizados em `e2e/tests/`. Rodam no Firefox por padrão (projeto `firefox`); há também um projeto `mobile` (Chromium, viewport/toque Android) opcional — ver [`README_E2E.md`](./README_E2E.md).

| Arquivo | Cobre |
|---|---|
| `00_cadastro.spec.ts` | Cadastro de usuário |
| `01_contas.spec.ts` | CRUD de contas |
| `02_categorias.spec.ts` | CRUD de categorias |
| `03_navegacao.spec.ts` | Navegação entre páginas |
| `04_extrato.spec.ts` | Lançamentos e filtros |
| `05_dashboard.spec.ts` | Dashboard e calendário |
| `06_relatorios.spec.ts` | Relatórios |
| `07_transferencias.spec.ts` | Transferências |
| `08_lembretes.spec.ts` | Lembretes |
| `09_assistente.spec.ts` | Assistente de lançamentos |
| `10_objetivos.spec.ts` | Objetivos |
| `11_investimentos.spec.ts` | Investimentos |
| `zz_teardown.spec.ts` | Limpeza pós-suite |

```bash
# Executar (requer frontend rodando em localhost:5173)
npm run test:e2e

# Reexecutar em viewport/toque Android (Chromium) — opcional
npm run test:e2e:mobile

# Modo visual
npm run test:e2e:ui

# Ver relatório
npm run test:e2e:report
```

---

## Variáveis de ambiente

```env
# FrontEnd/.env.local
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key-pública>
```

> A `anon_key` é segura para o frontend — o acesso aos dados é controlado pelo RLS do Supabase (cada usuário vê apenas seus próprios dados).
