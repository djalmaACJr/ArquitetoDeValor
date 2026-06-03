# 📋 Sumário Executivo — Módulo de Objetivos

> Visão rápida do projeto, documentos e próximos passos.

---

## 🎯 O que é?

Módulo que permite aos usuários criar e acompanhar **3 tipos de metas financeiras**:

| Tipo | Descrição | Exemplo |
|---|---|---|
| **Sonho** | Meta de saldo em período | "R$ 50k de fundo emergencial até Dez/2026" |
| **Objetivo** | Meta recorrente (média) | "R$ 2k/mês de aluguel + FII" |
| **Projeto** | Orçamento para iniciativa | "Reforma cozinha: R$ 15k até Jun/2026" |

---

## 📚 Documentação

| Documento | Descrição | Leitura |
|---|---|---|
| [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) | Visão geral, estrutura de dados, endpoints, testes | **👈 COMECE AQUI** |
| [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md) | Fluxos visuais, sequências, estado/transições | Complementar para entender fluxos |
| [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) | Guia passo-a-passo com código | Quando começar a implementar |

---

## 🏗️ Stack

- **Database**: PostgreSQL + ENUMs + Triggers + RLS
- **API**: Deno Edge Functions
- **Frontend**: React 19 + TypeScript + React Query + Tailwind
- **Testes**: Jest (API) + Playwright (E2E)

---

## 🗂️ Estrutura no Projeto

```
Arquiteto de Valor/
├── ROADMAP_OBJETIVOS.md              ← Leia primeiro
├── DIAGRAMAS_OBJETIVOS.md            ← Fluxos visuais
├── IMPLEMENTACAO_OBJETIVOS.md        ← Código passo-a-passo
│
├── supabase/
│   ├── migrations/
│   │   └── 20260602000001_criar_objetivos.sql  ← Criar
│   └── functions/
│       └── objetivos/                    ← Criar
│           └── index.ts
│
├── FrontEnd/src/
│   ├── types/index.ts                ← Adicionar tipos
│   ├── hooks/
│   │   └── useObjetivos.ts           ← Criar
│   ├── components/ui/
│   │   ├── CardObjetivo.tsx          ← Criar
│   │   ├── DrawerObjetivo.tsx        ← Criar
│   │   ├── GraficoProgresso.tsx      ← Criar
│   │   └── FiltrosObjetivos.tsx     ← Criar
│   └── pages/
│       ├── ObjetivosPage.tsx         ← Criar
│       ├── ObjetivoDetalhe.tsx       ← Criar
│       └── ObjetivoDashboard.tsx     ← Criar
│
└── tests/
    ├── 11_objetivos.test.ts          ← Criar
    └── FrontEnd/e2e/tests/
        └── 10_objetivos.test.ts      ← Criar
```

---

## 🔄 Fluxo Geral

```
1. Usuário cria Objetivo
   ↓
2. Edge Function valida + INSERT
   ↓
3. Trigger calcula valor_atingido (depende do tipo)
   ↓
4. BD retorna objetivo com progresso
   ↓
5. Frontend exibe Card com barra de progresso
   ↓
6. Quando usuário lança transação → Trigger atualiza objetivo
   ↓
7. Dashboard mostra progresso em tempo real
```

---

## 📊 Tipos de Cálculo

### SONHO
```
valor_atingido = SUM(receitas - despesas) da conta_id
```

### OBJETIVO
```
valor_atingido = SUM(receitas) da categoria_id no período
(usa frequência para calcular média)
```

### PROJETO
```
valor_atingido = SUM(despesas) nas contas_projeto
```

---

## 📋 6 Fases de Implementação

| Fase | Duração | O que | Entrega |
|---|---|---|---|
| **1** | 1-2 sem | BD + API básico | CRUD + Queries |
| **2** | 2-3 sem | Dashboard + UI | Listagem + Filtros |
| **3** | 3-4 sem | Criação & Edição | Forms + Validação |
| **4** | 4-5 sem | Progresso real | Snapshots + Sync |
| **5** | 5 sem | Testes + Segurança | Cobertura >80% |
| **6** | 6+ sem | Melhorias | IA, notificações, etc |

---

## ⚙️ 3 Arquivos-chave para Criar

### 1. Migration SQL
**Arquivo**: `supabase/migrations/20260602000001_criar_objetivos.sql`

- ✅ Tabelas (`objetivos`, `objetivos_progresso`)
- ✅ ENUMs (`tipo_objetivo`, `status_objetivo`)
- ✅ Indexes + RLS
- ✅ Triggers + Functions
- ✅ Views

### 2. Edge Function
**Arquivo**: `supabase/functions/objetivos/index.ts`

- ✅ GET `/objetivos` (lista)
- ✅ GET `/objetivos/:id` (detalhe)
- ✅ POST `/objetivos` (criar)
- ✅ PUT `/objetivos/:id` (editar)
- ✅ DELETE `/objetivos/:id` (cancelar)
- ✅ POST `/objetivos/sincronizar-progresso` (sync manual)

### 3. Página Frontend
**Arquivo**: `FrontEnd/src/pages/ObjetivosPage.tsx`

- ✅ Listar objetivos por tipo
- ✅ Cards com progresso
- ✅ Filtros
- ✅ Botão "Novo"

---

## 🧪 Testes Necessários

### API (Jest)
```
CA-OBJ01..CA-OBJ13
- CRUD para cada tipo
- Filtros
- RLS (isolamento de usuário)
- Validações (período, valores)
```

### E2E (Playwright)
```
E2E-OBJ01..E2E-OBJ07
- Criar Sonho/Objetivo/Projeto
- Visualizar dashboard
- Editar meta
- Filtrar
- Cancelar
```

---

## 🔐 Segurança

- ✅ RLS: `user_id = auth.uid()` obrigatório
- ✅ Validação de referência: conta_id, categoria_id pertencem ao usuário
- ✅ Imutabilidade: `criado_em`, `user_id` nunca alteram
- ✅ Auditoria: `revisoes` JSONB rastreia alterações

---

## 💾 Dependências Internas

- ✅ `arqvalor.contas` (para SONHO + PROJETO)
- ✅ `arqvalor.categorias` (para OBJETIVO + PROJETO)
- ✅ `arqvalor.transacoes` (para recalcular progresso)
- ✅ `useContas`, `useCategorias` (hooks existentes)
- ✅ React Query (cache + invalidação)
- ✅ Chart.js (gráficos)

---

## 🚀 Como Começar?

### Passo 0: Leitura
1. Leia [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) — entenda o escopo
2. Revise [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md) — veja os fluxos visuais

### Passo 1: Database
1. Copie a migration de [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) → `supabase/migrations/`
2. Execute `supabase migration up` localmente
3. Teste RLS + triggers

### Passo 2: Backend
1. Crie `supabase/functions/objetivos/index.ts`
2. Implemente endpoints (GET, POST, PUT, DELETE)
3. Teste cada endpoint (Postman ou Jest)

### Passo 3: Frontend
1. Adicione tipos a `FrontEnd/src/types/index.ts`
2. Crie hook `useObjetivos`
3. Crie componentes (`CardObjetivo`, `DrawerObjetivo`, etc.)
4. Crie página `ObjetivosPage`

### Passo 4: Testes
1. Implemente testes API (CA-OBJ01..13)
2. Implemente testes E2E (E2E-OBJ01..07)
3. Valide cobertura >80%

### Passo 5: Deploy
1. Commit + PR
2. Code review
3. Merge + Deploy produção
4. Monitor logs

---

## ✅ Métricas de Sucesso

- ✅ API CRUD 100% funcional
- ✅ Dashboard mostra progresso real + atualizado
- ✅ Usuário cria 3 tipos de objetivos sem erros
- ✅ Histórico de revisões rastreável
- ✅ Sem vazamento de dados entre usuários (RLS)
- ✅ Dashboard carrega em < 2s
- ✅ Cobertura testes ≥ 80%
- ✅ Documentação completa (CLAUDE.md atualizado)

---

## 💡 Idéias Futuras (Fase 7+)

- 🤝 Objetivos compartilhados (casal/família)
- 🤖 Sugestões de metas via IA
- 🔔 Webhooks para milestones
- 📊 Gráficos comparativos (real vs. projetado vs. orçado)
- 🔮 Análise preditiva ("atingirá até quando?")
- 🏷️ Tags para agrupar objetivos
- 🏆 Ranking de progresso
- 📱 PWA com offline sync

---

## 📞 Dúvidas Comuns

**P: Posso ter vários Projetos com a mesma categoria?**  
R: Sim. Um Projeto pode ter múltiplas `contas_projeto` e usar `categoria_id` para filtrar despesas relevantes.

**P: O que acontece se deletar uma conta usada em um Objetivo?**  
R: Na prática raramente ocorre — o trigger `fn_bloquear_exclusao_conta` já impede excluir qualquer conta que tenha lançamentos vinculados. Nos raros casos em que uma conta sem lançamentos é excluída, o `ON DELETE SET NULL` zera a referência e o `valor_atingido` passa a calcular 0 (sem conta = sem base de cálculo).

**P: Como sincronizar progresso se o usuário não acessa o dashboard?**  
R: Criar cron job que chama `fn_sincronizar_progresso_objetivo()` uma vez por dia (Supabase Admin API).

**P: Posso editar um Objetivo ATINGIDO?**  
R: Sim, mas o status volta para `EM_PROGRESSO` se alterar a meta ou data_fim.

**P: RLS garante que usuário A não vê objetivos de usuário B?**  
R: Sim. Toda query é filtrada por `user_id = auth.uid()` + policies. Tentativa de acesso retorna 404 ou erro de autorização.

---

## 📖 Leitura Recomendada (em ordem)

1. **Este arquivo** — visão geral (5 min)
2. [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) — escopo e fases (15 min)
3. [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md) — fluxos visuais (10 min)
4. [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) — código (quando começar)
5. [CLAUDE.md](./CLAUDE.md) — referência de padrões (consultando conforme necessário)

---

**Status**: 📋 Planejado | 🔄 Dependendo de priorização  
**Criado em**: 2 de junho de 2026  
**Versão**: 1.0
