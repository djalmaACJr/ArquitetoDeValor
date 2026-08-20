# 🧪 Testes E2E com Playwright

## 📋 Pré-requisitos

1. **Node.js** instalado
2. **Frontend rodando** em `http://localhost:5173`
3. **Dependências instaladas**: `npm install`

## 🚀 Instalação

```bash
# Instalar dependências
npm install

# Instalar Playwright browsers
npx playwright install
```

## 🎯 Como Usar

### Via Script (Recomendado)

Execute o arquivo `rodar_testes_e2e.bat` na raiz do projeto:

```bash
.\rodar_testes_e2e.bat
```

### Via NPM Scripts

```bash
# Rodar todos os testes (projeto "firefox")
npm run test:e2e

# Reexecutar a MESMA suíte em viewport/toque de Android (Chromium, Pixel 7)
# — não roda por padrão, pensado pra rodar antes de builds do app Android.
# Não cobre trechos gateados por Capacitor.isNativePlatform() (biometria,
# swipe de mês, teclado nativo) — isso continua exigindo teste manual.
npm run test:e2e:mobile

# Rodar em modo visual
npm run test:e2e:ui

# Ver relatório HTML
npm run test:e2e:report
```

## 📁 Estrutura dos Testes

```
e2e/
├── playwright.config.ts    # Configuração do Playwright (projetos: auth, data, firefox, mobile)
├── tests/
│   ├── 00_cadastro.spec.ts
│   ├── 01_contas.spec.ts
│   ├── 02_categorias.spec.ts
│   ├── 03_navegacao.spec.ts
│   ├── 04_extrato.spec.ts
│   ├── 05_dashboard.spec.ts
│   ├── 06_relatorios.spec.ts
│   ├── 07_transferencias.spec.ts
│   ├── 08_lembretes.spec.ts
│   ├── 09_assistente.spec.ts
│   ├── 10_objetivos.spec.ts
│   ├── 11_investimentos.spec.ts
│   ├── zz_teardown.spec.ts
│   ├── auth.setup.ts        # Setup de autenticação (login, salva fixtures/auth.json)
│   ├── data.setup.ts        # Setup de dados básicos (contas, categorias)
│   └── helpers.ts
├── fixtures/
└── report/                  # Relatórios HTML
```

## 🔧 Configuração

- **Base URL**: `http://localhost:5173` (configurável via `E2E_BASE_URL`)
- **Browser**: Firefox Desktop (`npm run test:e2e`) ou Chromium/Pixel 7 (`npm run test:e2e:mobile`)
- **Timeout**: 30 segundos
- **Retries**: 0 (local), 1 (CI)
- **CI**: o workflow `.github/workflows/frontend-e2e.yml` só dispara em push/PR pra `develop` quando o diff toca `FrontEnd/**` (ou o próprio arquivo do workflow) — um commit fora dessa pasta (ex.: só migrations, só `tests/`) não aciona E2E nem o workflow de Qualidade de Código (`frontend-quality.yml`, mesmo filtro). `backend-api-tests.yml` e `frontend-lint.yml` não têm esse filtro, rodam em qualquer push.

## 📊 Relatórios

Os relatórios são gerados em `e2e/report/` e podem ser visualizados com:

```bash
npm run test:e2e:report
```

## 🐛 Debug

Para debugar testes:

```bash
# Modo visual com interface gráfica
npm run test:e2e:ui

# Teste específico em modo headful
npx playwright test --config=e2e/playwright.config.ts --headed e2e/tests/01_dashboard.spec.ts
```

## ⚠️ Importante

- **Frontend deve estar rodando** antes de executar os testes
- **Testes são sequenciais** (não paralelos) para evitar conflitos
- **Sessão é salva** e reutilizada entre testes para performance
