# 🎯 Roadmap — Módulo de Objetivos

> Documento de planejamento para implementação do módulo de **Objetivos** no Arquiteto de Valor.  
> Inclui 3 tipos: **Sonhos**, **Objetivos** e **Projetos** com dashboard de acompanhamento.

---

## 📋 Visão geral

### Definições

| Tipo | Descrição | Exemplo |
|---|---|---|
| **Sonho** 💭 | Meta de saldo em um período | Atingir R$ 50.000 até Dez/2026 |
| **Objetivo** 🎯 | Meta recorrente (média mensal ou periódica) | Receber R$ 2.000/mês de aluguel/FII |
| **Projeto** 📦 | Orçamento para iniciativa específica | Reforma da cozinha: R$ 15.000 até Jun/2026 |

### Funcionalidades principais

- ✅ CRUD para cada tipo de objetivo
- ✅ Rastreamento de progresso (real vs. meta)
- ✅ Dashboard unificado com gráficos e cards de acompanhamento
- ✅ Notificações/lembretes quando atingir metas
- ✅ Edição de objetivos em andamento
- ✅ Histórico de revisões (quando editar meta)
- ✅ Relatórios por tipo e período
- ✅ Integração com categorias (Objetivos vinculados a categorias)
- ✅ Integração com contas (Sonhos/Projetos vinculados a contas específicas)
- ✅ Projetos acompanham fluxo líquido de caixa: receitas + despesas + transferências

---

## 🗂️ Estrutura de dados

### Tabela: `arqvalor.objetivos`

```sql
CREATE TABLE arqvalor.objetivos (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    
    -- Tipo do objetivo
    tipo               arqvalor.tipo_objetivo NOT NULL,  -- 'SONHO' | 'OBJETIVO' | 'PROJETO'
    
    -- Dados gerais
    nome               VARCHAR(255) NOT NULL,
    descricao          TEXT,
    icone              VARCHAR(50),  -- 'target', 'rocket', 'briefcase', etc.
    cor                VARCHAR(10),  -- tailwind color: 'emerald', 'blue', 'red', etc.
    ativo              BOOLEAN DEFAULT true,
    
    -- Meta (valor alvo)
    valor_meta         NUMERIC(15,2) NOT NULL CHECK (valor_meta > 0),
    
    -- Data de inicio e fim
    data_inicio        DATE NOT NULL,
    data_fim           DATE NOT NULL CHECK (data_fim >= data_inicio),
    
    -- Específico para SONHO: conta alvo (onde acompanhar saldo)
    conta_id           UUID REFERENCES arqvalor.contas(id) ON DELETE SET NULL,
    
    -- Específico para OBJETIVO: categoria vinculada + frequência
    categoria_id       UUID REFERENCES arqvalor.categorias(id) ON DELETE SET NULL,
    frequencia         arqvalor.frequencia,  -- 'MENSAL' | 'TRIMESTRAL' | 'ANUAL' | NULL
    
    -- Específico para PROJETO: contas vinculadas (múltiplas) + categoria
    contas_projeto     UUID[],  -- array de conta_ids, ou NULL
    
    -- Rastreamento
    valor_atingido     NUMERIC(15,2) DEFAULT 0,  -- preenchido por trigger/view
    percentual         SMALLINT DEFAULT 0,       -- 0..100, calculado
    status             arqvalor.status_objetivo, -- 'EM_PROGRESSO' | 'ATINGIDO' | 'CANCELADO'
    
    -- Histórico
    revisoes           JSONB DEFAULT '[]'::JSONB,  -- [{data, valor_meta_anterior, motivo}, ...]
    
    -- Auditoria
    criado_em          TIMESTAMP DEFAULT NOW(),
    atualizado_em      TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_objetivos_user_id ON arqvalor.objetivos(user_id);
CREATE INDEX idx_objetivos_tipo ON arqvalor.objetivos(tipo);
CREATE INDEX idx_objetivos_status ON arqvalor.objetivos(status);

-- Integração com `transacoes`:
-- Para permitir que lançamentos sejam opcionalmente vinculados a um objetivo,
-- adicionar em `arqvalor.transacoes` um campo opcional `objetivo_id UUID REFERENCES arqvalor.objetivos(id)`.
-- Regras:
-- - `transacoes.objetivo_id` pode apontar para um `objetivo` ou ficar NULL.
-- - `tipo` permanece RECEITA|DESPESA (não adicionar PROJECAO como tipo — esse nome já
--   existe como valor de status_transacao e causaria conflito de nomenclatura).
--   Lançamentos futuros continuam usando `status = 'PROJECAO'` como já ocorre hoje.
-- - Transferências entre contas de investimento/objetivo devem ser classificadas
--   corretamente (meta de investimento: entrada = receita, saída = despesa).
```

### ENUMs

```sql
CREATE TYPE arqvalor.tipo_objetivo AS ENUM ('SONHO', 'OBJETIVO', 'PROJETO');
CREATE TYPE arqvalor.status_objetivo AS ENUM ('EM_PROGRESSO', 'ATINGIDO', 'CANCELADO');
```

### Tabela: `arqvalor.objetivos_progresso` (histórico de snapshots)

```sql
CREATE TABLE arqvalor.objetivos_progresso (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    objetivo_id      UUID NOT NULL REFERENCES arqvalor.objetivos(id) ON DELETE CASCADE,
    
    data_snapshot    DATE NOT NULL,
    valor_atingido   NUMERIC(15,2) NOT NULL,
    percentual       SMALLINT CHECK (percentual >= 0 AND percentual <= 100),
    
    UNIQUE(objetivo_id, data_snapshot)
);

CREATE INDEX idx_prog_objetivo_data ON arqvalor.objetivos_progresso(objetivo_id, data_snapshot);
```

### RLS Policies

```sql
-- Permitir que usuário veja apenas seus objetivos
CREATE POLICY objetivos_select ON arqvalor.objetivos
    FOR SELECT USING (user_id = auth.uid());

CREATE POLICY objetivos_insert ON arqvalor.objetivos
    FOR INSERT WITH CHECK (user_id = auth.uid());

CREATE POLICY objetivos_update ON arqvalor.objetivos
    FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY objetivos_delete ON arqvalor.objetivos
    FOR DELETE USING (user_id = auth.uid());

-- Políticas similares para objetivos_progresso
```

### Triggers

#### 1. Auto-calcula `valor_atingido` e `percentual`

Para **SONHO**: soma do saldo atual da conta até `CURRENT_DATE`  
Para **OBJETIVO**: soma de receitas da categoria/período correspondente, com tratamento especial para metas de investimento: transferências feitas para contas de investimento contam como receitas e transferências de saída contam como despesas.  
Para **PROJETO**: fluxo líquido de caixa das contas vinculadas ao projeto até `CURRENT_DATE` — receitas menos despesas, incluindo transferências relevantes entre contas.

```sql
CREATE OR REPLACE FUNCTION arqvalor.fn_atualizar_progresso_objetivo()
RETURNS TRIGGER AS $$
DECLARE
    v_valor_atingido NUMERIC;
    v_percentual SMALLINT;
BEGIN
    -- Lógica depende do tipo
    IF NEW.tipo = 'SONHO' THEN
        SELECT COALESCE(SUM(...), 0) INTO v_valor_atingido
        FROM arqvalor.transacoes
        WHERE conta_id = NEW.conta_id
          AND data <= CURRENT_DATE;
    ELSIF NEW.tipo = 'OBJETIVO' THEN
        -- Soma receitas da categoria no período
        ...
    ELSIF NEW.tipo = 'PROJETO' THEN
        -- Soma despesas vinculadas
        ...
    END IF;
    
    NEW.valor_atingido := v_valor_atingido;
    NEW.percentual := LEAST(100, (v_valor_atingido * 100 / NEW.valor_meta)::SMALLINT);
    NEW.status := CASE
        WHEN NEW.percentual >= 100 THEN 'ATINGIDO'
        WHEN NEW.ativo = false THEN 'CANCELADO'
        ELSE 'EM_PROGRESSO'
    END;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_atualizar_progresso_objetivo
    BEFORE INSERT OR UPDATE ON arqvalor.objetivos
    FOR EACH ROW
    EXECUTE FUNCTION arqvalor.fn_atualizar_progresso_objetivo();
```

#### 2. Registra snapshots diários (cron job ou por acesso ao dashboard)

Chamado por função separada `POST /objetivos/sincronizar-progresso` ou por trigger de INSERT/UPDATE em `transacoes`.

---

## 🔌 Edge Functions (API)

### Módulo: `supabase/functions/objetivos/`

#### Endpoints

| Método | Rota | Descrição |
|---|---|---|
| `GET` | `/objetivos` | Lista todos (com filtro por tipo) |
| `GET` | `/objetivos/:id` | Detalhe + histórico de progresso |
| `POST` | `/objetivos` | Criar novo objetivo |
| `PUT` | `/objetivos/:id` | Editar objetivo (com histórico de revisão) |
| `DELETE` | `/objetivos/:id` | Cancelar/deletar (lógico ou físico?) |
| `GET` | `/objetivos/:id/progresso` | Gráfico + timelinedata |
| `POST` | `/objetivos/:id/revisar` | Atualizar meta com motivo + histórico |
| `POST` | `/objetivos/sincronizar-progresso` | Dispara recálculo + snapshots |

| `GET` | `/objetivos/:id/extrato` | Lista lançamentos vinculados ao objetivo (inclui status `PROJECAO`) |
| `POST` | `/objetivos/:id/extrato` | Criar lançamento vinculado ao objetivo (cria `transacoes` com `objetivo_id`) |
| `PUT` | `/objetivos/:id/extrato/:transacao_id` | Editar lançamento ligado ao objetivo |
| `DELETE` | `/objetivos/:id/extrato/:transacao_id` | Remover vínculo/excluir lançamento |

#### Request/Response examples

**POST `/objetivos` (criar Sonho)**

```json
{
  "tipo": "SONHO",
  "nome": "Fundo de Emergência",
  "descricao": "Atingir R$50k para emergências",
  "valor_meta": 50000,
  "data_inicio": "2026-06-02",
  "data_fim": "2026-12-31",
  "conta_id": "uuid-da-conta-carteira",
  "icone": "shield",
  "cor": "green"
}
```

**POST `/objetivos` (criar Objetivo)**

```json
{
  "tipo": "OBJETIVO",
  "nome": "Renda de Aluguel",
  "descricao": "Receber em média R$2k/mês de aluguel e FII",
  "valor_meta": 2000,
  "frequencia": "MENSAL",
  "categoria_id": "uuid-da-categoria-aluguel",
  "data_inicio": "2026-06-02",
  "data_fim": "2026-12-31",
  "icone": "home",
  "cor": "blue"
}
```

**POST `/objetivos` (criar Projeto)**

```json
{
  "tipo": "PROJETO",
  "nome": "Reforma da Cozinha",
  "descricao": "Reformar cozinha e comprar eletros",
  "valor_meta": 15000,
  "data_inicio": "2026-06-02",
  "data_fim": "2026-12-31",
  "contas_projeto": ["uuid-conta-1", "uuid-conta-2"],
  "categoria_id": "uuid-categoria-reforma",
  "icone": "hammer",
  "cor": "orange"
}
```

**GET `/objetivos/:id`**

```json
{
  "dados": {
    "id": "uuid",
    "tipo": "SONHO",
    "nome": "Fundo de Emergência",
    "valor_meta": 50000,
    "valor_atingido": 32500,
    "percentual": 65,
    "status": "EM_PROGRESSO",
    "data_inicio": "2026-06-02",
    "data_fim": "2026-12-31",
    "dias_restantes": 212,
    "progresso": [
      { "data": "2026-06-01", "valor": 30000, "percentual": 60 },
      { "data": "2026-06-02", "valor": 32500, "percentual": 65 }
    ],
    "revisoes": [
      { "data": "2026-05-01", "valor_meta_anterior": 45000, "motivo": "Ajuste conforme novo orçamento" }
    ]
  }
}
```

---

## 🎨 Frontend

### Novas pastas e arquivos

```
FrontEnd/src/
├── pages/
│   └── ObjetivosPage.tsx              ← Página principal (lista + filtros)
│   └── ObjetivoDetalhe.tsx            ← View detalhe + gráfico progresso
│   └── ObjetivoDashboard.tsx          ← Dashboard unificado
│
├── components/ui/
│   ├── DrawerObjetivo.tsx             ← Criar/editar objetivo (modal/drawer)
│   ├── CardObjetivo.tsx               ← Card compacto com ícone, progresso, %
│   ├── GraficoProgresso.tsx           ← Gráfico de linha (progresso x tempo)
│   ├── TimelineProgresso.tsx          ← Timeline com eventos/revisões
│   └── FiltrosObjetivos.tsx          ← Filtros (tipo, status, período)
│
├── hooks/
│   ├── useObjetivos.ts                ← Query + mutations (CRUD)
│   ├── useObjetivoDetalhe.ts          ← Detalhe + histórico
│   └── useSincronizarProgresso.ts     ← Dispara sync manual
│
├── lib/
│   └── iaProvedores.ts (já existe)    ← Pode usar para sugestão de metas
│
└── types/
    └── index.ts (adicionar tipos)
```

### Tipos TypeScript

```ts
// src/types/index.ts

export enum TipoObjetivo {
  SONHO = 'SONHO',
  OBJETIVO = 'OBJETIVO',
  PROJETO = 'PROJETO'
}

export enum StatusObjetivo {
  EM_PROGRESSO = 'EM_PROGRESSO',
  ATINGIDO = 'ATINGIDO',
  CANCELADO = 'CANCELADO'
}

export interface Objetivo {
  id: string
  user_id: string
  tipo: TipoObjetivo
  nome: string
  descricao?: string
  icone?: string
  cor?: string
  ativo: boolean
  valor_meta: number
  data_inicio: string  // ISO date
  data_fim: string
  conta_id?: string
  categoria_id?: string
  frequencia?: Frequencia
  contas_projeto?: string[]
  valor_atingido: number
  percentual: number
  status: StatusObjetivo
  dias_restantes: number
  revisoes: Revisao[]
  criado_em: string
  atualizado_em: string
}

export interface Revisao {
  data: string
  valor_meta_anterior: number
  motivo: string
}

export interface SnapshotProgresso {
  data: string
  valor: number
  percentual: number
}
```

### Hooks principais

```ts
// src/hooks/useObjetivos.ts

export function useObjetivos(filtro?: {
  tipo?: TipoObjetivo
  status?: StatusObjetivo
  periodo?: [Date, Date]
}) {
  const queryKey = ['objetivos', filtro]
  
  const { data: objetivos = [] } = useQuery({
    queryKey,
    queryFn: () => apiFetch<Objetivo[]>(`/objetivos?...`)
  })
  
  const criar = useMutation({
    mutationFn: (data: CreateObjetivoInput) => 
      apiMutate<Objetivo>('/objetivos', 'POST', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  })
  
  const editar = useMutation({
    mutationFn: ({ id, data }: { id: string, data: UpdateObjetivoInput }) =>
      apiMutate<Objetivo>(`/objetivos/${id}`, 'PUT', data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  })
  
  const excluir = useMutation({
    mutationFn: (id: string) =>
      apiMutate(`/objetivos/${id}`, 'DELETE'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey })
  })
  
  return { objetivos, criar, editar, excluir, loading: ... }
}
```

### Dashboard de Objetivos

**Layout geral:**

```
┌────────────────────────────────────────────┐
│  📊 Meus Objetivos                 [+ Novo]│
├────────────────────────────────────────────┤
│  Filtrar por: [Tipo▼] [Status▼] [Período▼]│
├────────────────────────────────────────────┤
│
│  SONHOS                    (3 ativos)      │
│  ├─ [Card] Fundo Emergência: 65% R$32.5k  │
│  ├─ [Card] Viagem: 40% R$8k               │
│  └─ [Card] Casa própria: 15% R$45k        │
│
│  OBJETIVOS                 (2 ativos)      │
│  ├─ [Card] Aluguel/FII: 85% R$1.7k/mês    │
│  └─ [Card] Bônus anual: 50% R$6k          │
│
│  PROJETOS                  (1 ativo)       │
│  └─ [Card] Reforma: 60% R$9k de R$15k     │
│
│  ════════════════════════════════════════  │
│
│  📈 Resumo do período (Jun-Dez 2026)      │
│  ┌─────────────────────────────────────┐  │
│  │ [Gráfico de linha multilinhas]      │  │
│  │ - Fundo Emergência (verde)          │  │
│  │ - Reforma (laranja)                 │  │
│  │ - Aluguel (azul)                    │  │
│  │ Eixo X: tempo | Eixo Y: R$ / %     │  │
│  └─────────────────────────────────────┘  │
│
└────────────────────────────────────────────┘
```

**Cards de objetivo:**

```
┌──────────────────────────────────────┐
│ 🎯 Fundo de Emergência               │
│    Sonho • Em progresso • 212 dias   │
│                                      │
│  [████████░░░░░░] 65%               │
│  R$ 32.500 / R$ 50.000              │
│                                      │
│  Conta: Carteira                     │
│  Fins em: 31 Dec 2026                │
│                                      │
│  [📊 Detalhe] [✏️ Editar] [❌]      │
└──────────────────────────────────────┘
```

### Página de Detalhe

```
┌────────────────────────────────────────────┐
│ ◀ 🎯 Fundo de Emergência                   │
├────────────────────────────────────────────┤
│
│ Status: Em progresso  |  65%  |  212 dias │
│
│ [████████░░░░░░] 
│ R$ 32.500 de R$ 50.000
│
│ ─────────────────────────────────────────  │
│
│ 📈 Progresso (últimos 30 dias)             │
│ ┌──────────────────────────────────────┐  │
│ │ [Gráfico de linha]                   │  │
│ └──────────────────────────────────────┘  │
│
│ ─────────────────────────────────────────  │
│
│ 📋 Detalhes                                │
│  • Conta: Carteira                        │
│  • Data início: 02 Jun 2026               │
│  • Data fim: 31 Dec 2026                  │
│  • Descrição: Atingir 50k para ...        │
│
│ ─────────────────────────────────────────  │
│
│ 🔄 Histórico de revisões                   │
│  [01 Mai 2026] Meta: R$ 45k → R$ 50k     │
│                 "Ajuste orçamentário"     │
│
│ ─────────────────────────────────────────  │
│
│ [✏️ Editar] [📊 Revisar meta] [❌ Cancelar]│
│
└────────────────────────────────────────────┘
```

---

## 🧪 Testes

### API Tests — `tests/11_objetivos.test.ts`

```
CA-OBJ01: Criar sonho com dados válidos
CA-OBJ02: Criar objetivo com categoria
CA-OBJ03: Criar projeto com múltiplas contas
CA-OBJ04: Listar objetivos com filtro por tipo
CA-OBJ05: Listar objetivos com filtro por status
CA-OBJ06: Obter detalhe de objetivo + progresso
CA-OBJ07: Atualizar meta com histórico de revisão
CA-OBJ08: Excluir objetivo (cancelar)
CA-OBJ09: Sincronizar progresso (recalcular)
CA-OBJ10: RLS — usuário não vê objetivo de outro usuário
CA-OBJ11: RLS — não consegue editar objetivo de outro
CA-OBJ12: Validar período (data_fim >= data_inicio)
CA-OBJ13: Validar valor_meta > 0
```

### E2E Tests — `FrontEnd/e2e/tests/10_objetivos.test.ts`

```
E2E-OBJ01: Criar novo sonho via drawer
E2E-OBJ02: Visualizar progresso no dashboard
E2E-OBJ03: Editar meta de objetivo existente
E2E-OBJ04: Filtrar objetivos por tipo
E2E-OBJ05: Visualizar gráfico de progresso
E2E-OBJ06: Cancelar objetivo
E2E-OBJ07: Navegar até detalhe e ver histórico
```

---

## 📅 Fases de implementação

### **Fase 1: Fundação** (Semana 1-2)

- [ ] Criar migration com `objetivos` + `objetivos_progresso` + ENUMs
- [ ] Implementar RLS policies
- [ ] Implementar triggers de cálculo de progresso
- [ ] Criar Edge Function `/objetivos` (CRUD básico)
- [ ] Testes API CA-OBJ01..06

**Entregável**: API CRUD + queries funcionando com dados fictícios

### **Fase 2: Dashboard** (Semana 2-3)

- [ ] Criar tipos TypeScript em `src/types/index.ts`
- [ ] Hook `useObjetivos` + `useObjetivoDetalhe`
- [ ] Componentes: `CardObjetivo`, `GraficoProgresso`, `FiltrosObjetivos`
- [ ] Página `ObjetivosPage` (listagem)
- [ ] Página `ObjetivoDetalhe`
- [ ] Dashboard `ObjetivoDashboard` (resumo executivo)
- [ ] Testes E2E E2E-OBJ01..05

**Entregável**: Interface de visualização + filtros

### **Fase 3: Criação & Edição** (Semana 3-4)

- [ ] Componente `DrawerObjetivo` (form com validação)
- [ ] Endpoint `POST /objetivos` + `PUT /objetivos/:id`
- [ ] Hook mutations `criar`, `editar`
- [ ] Histórico de revisões (backend + UI)
- [ ] Validações (período, valores, etc.)
- [ ] Testes API CA-OBJ07..08

**Entregável**: CRUD completo funcional

### **Fase 4: Progresso & Sincronização** (Semana 4-5)

- [ ] RPC `fn_sincronizar_progresso_objetivo()` (job recorrente)
- [ ] Snapshots diários em `objetivos_progresso`
- [ ] Endpoint `POST /objetivos/sincronizar-progresso`
- [ ] Integração com transações (trigger atualiza objetivos)
- [ ] Testes API CA-OBJ09

**Entregável**: Progresso auto-calculado em tempo real

### **Fase 5: Segurança & Testes** (Semana 5)

- [ ] Testes de RLS (CA-OBJ10, CA-OBJ11)
- [ ] Validações robustas (CA-OBJ12, CA-OBJ13)
- [ ] Testes E2E completos (E2E-OBJ06, E2E-OBJ07)
- [ ] Code review + refactoring

**Entregável**: Cobertura de testes >80%, segurança validada

### **Fase 6: Melhorias & Polish** (Semana 6+)

- [ ] Integração com Mascote (sugestões via IA)
- [ ] Notificações/lembretes quando atingir milestones
- [ ] Exportação de relatório (PDF/Excel)
- [ ] Tema escuro/claro para gráficos
- [ ] Integrações com ChatMascote (análise de progresso)

---

## 🔐 Considerações de segurança

1. **RLS obrigatório** em todas as tabelas (`user_id = auth.uid()`)
2. **Validação de referência** (conta_id, categoria_id, contas_projeto pertencem ao usuário)
3. **Não expor IDs** diretos — sempre via `extrairId(req, 'objetivo')`
4. **Imutabilidade parcial**: `criado_em`, `user_id` nunca podem ser alterados
5. **Auditoria**: `revisoes` JSONB garante rastreabilidade

---

## 🔄 Dependências internas

- **Tabela `contas`** — for SONHO.conta_id e PROJETO.contas_projeto
- **Tabela `categorias`** — for OBJETIVO.categoria_id e PROJETO.categoria_id
- **Tabela `transacoes`** — for auto-cálculo de progresso
- **Hook `useContas`** — for populating conta selectors
- **Hook `useCategorias`** — for populating categoria selectors
- **React Query** — for cache + invalidation
- **Chart.js** — for gráficos de progresso

---

## 📊 Métricas de sucesso

- ✅ API CRUD 100% funcional com testes
- ✅ Dashboard mostra progresso real (sincronizado com transações)
- ✅ Usuário consegue criar/editar 3 tipos de objetivos sem erros
- ✅ Histórico de revisões rastreável
- ✅ Sem dados vazados entre usuários (RLS validado)
- ✅ Performance: dashboard carrega em < 2s
- ✅ Cobertura de testes ≥ 80%

---

## 💡 Sugestões futuras (Fase 7+)

1. **Metas compartilhadas** (casal/família)
2. **Integração com IA** — sugestão automática de metas baseado em padrões
3. **Webhooks** — notificação quando atingir milestones
4. **Gráficos comparativos** — Objetivos vs. Realizado vs. Projetado
5. **Análise preditiva** — "Você atingirá a meta até X data?"
6. **Tags** — agrupar objetivos por tema
7. **Ranking** — "Qual objetivo tem maior % progresso?"
8. **Mobile app** — PWA com sincronização offline

---

## 📝 Notas

- Manter padrão de nomeação (`arqvalor.` para schema, `fn_` para functions, `trg_` para triggers)
- Sempre usar `SECURITY INVOKER` em views/RPCs que acessem dados de usuário
- Migrations idempotentes (`IF NOT EXISTS`, `CREATE OR REPLACE`)
- Logs em produção → `_shared/logger.ts`
- Tipagem forte em TypeScript — não deixar `any` passar
