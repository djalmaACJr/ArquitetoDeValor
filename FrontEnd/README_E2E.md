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
# Rodar todos os testes
npm run test:e2e

# Rodar em modo visual
npm run test:e2e:ui

# Ver relatório HTML
npm run test:e2e:report
```

## 📁 Estrutura dos Testes

```
e2e/
├── playwright.config.ts    # Configuração do Playwright
├── tests/
│   ├── 01_dashboard.spec.ts
│   ├── 02_extrato.spec.ts
│   ├── 03_contas.spec.ts
│   ├── 04_categorias.spec.ts
│   ├── 05_relatorios.spec.ts
│   ├── 06_navegacao.spec.ts
│   └── auth.setup.ts        # Setup de autenticação
├── fixtures/
└── report/                  # Relatórios HTML
```

## 🔧 Configuração

- **Base URL**: `http://localhost:5173` (configurável via `E2E_BASE_URL`)
- **Browser**: Firefox (Desktop)
- **Timeout**: 30 segundos
- **Retries**: 0 (local), 1 (CI)

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
