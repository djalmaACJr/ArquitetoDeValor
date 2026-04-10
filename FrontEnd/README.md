# Arquiteto de Valor — Frontend

## Pré-requisitos
- Node.js 20+
- Conta Supabase com o projeto configurado

## Instalação

```bash
# 1. Instalar dependências
npm install

# 2. Configurar variáveis de ambiente
# Edite o arquivo .env.local com suas credenciais:
VITE_SUPABASE_URL=https://ftpelncgrakpphytfrfo.supabase.co
VITE_SUPABASE_ANON_KEY=sua_chave_anon_aqui

# 3. Rodar em desenvolvimento
npm run dev

# 4. Abrir no navegador
# http://localhost:5173
```

## Deploy na Vercel

1. Faça push do projeto para o GitHub
2. Acesse vercel.com e importe o repositório
3. Configure as variáveis de ambiente no painel da Vercel:
   - VITE_SUPABASE_URL
   - VITE_SUPABASE_ANON_KEY
4. Deploy automático a cada push no main

## Estrutura do projeto

```
src/
├── components/
│   ├── layout/       # Sidebar, AppLayout
│   └── ui/           # Componentes reutilizáveis (próximas iterações)
├── hooks/
│   ├── useAuth.ts    # Autenticação Supabase
│   ├── useTheme.ts   # Dark/light mode
│   └── useDashboard.ts # Dados do dashboard
├── lib/
│   ├── supabase.ts   # Cliente Supabase
│   └── utils.ts      # Formatação, constantes
├── pages/
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   └── Placeholders.tsx  # Páginas futuras
└── types/
    └── index.ts      # Tipos TypeScript
```

## Próximas telas a implementar
- Lançamentos (listagem + filtros + modal de novo lançamento)
- Contas (CRUD)
- Categorias (CRUD hierárquico)
- Importar / Exportar
