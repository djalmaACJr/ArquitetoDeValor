# 🎨 Arquitetura Visual — Módulo de Objetivos

## 📊 Estrutura Geral em ASCII

```
┌─────────────────────────────────────────────────────────────────┐
│                    APLICAÇÃO FRONTEND (React)                   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Página: ObjetivosPage / ObjetivoDetalhe / Dashboard      │  │
│  └──────────────────────────────────────────────────────────┘  │
│           ▲                      ▲                               │
│           │                      │                               │
│  ┌─────────┴──────────┐  ┌──────┴────────────────────┐          │
│  │ Components:        │  │ Hooks:                     │          │
│  │ • CardObjetivo     │  │ • useObjetivos()           │          │
│  │ • DrawerObjetivo   │  │ • useObjetivoDetalhe()     │          │
│  │ • GraficoProgresso │  │ • useSincronizarProgresso()│          │
│  │ • FiltrosObjetivos│  └────────────────────────────┘          │
│  └────────────────────┘           ▲                              │
│                                   │                              │
│                     ┌─────────────┴──────────────┐               │
│                     │ React Query Cache          │               │
│                     │ @tanstack/react-query      │               │
│                     └─────────────┬──────────────┘               │
│                                   │                              │
│                     ┌─────────────▼──────────────┐               │
│                     │ HTTP Client                │               │
│                     │ (apiFetch, apiMutate)      │               │
│                     └─────────────┬──────────────┘               │
└─────────────────────────────────────┼──────────────────────────┘
                                      │
                                      │ HTTPS + JWT
                                      │
┌─────────────────────────────────────▼──────────────────────────┐
│                   BACKEND (Supabase Edge Functions)             │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Edge Function: /objetivos (Deno + TypeScript)            │  │
│  ├──────────────────────────────────────────────────────────┤  │
│  │ GET    /objetivos          → lista (com filtros)         │  │
│  │ GET    /objetivos/:id      → detalhe + progresso         │  │
│  │ POST   /objetivos          → criar                       │  │
│  │ PUT    /objetivos/:id      → editar (com histórico)      │  │
│  │ DELETE /objetivos/:id      → cancelar (logical)          │  │
│  │ POST   /sincronizar-progresso → sync manual              │  │
│  └────────────────┬─────────────────────────────────────────┘  │
│                   │                                             │
│                   ▼                                             │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ PostgREST + RLS (Row-Level Security)                     │  │
│  │ • Valida user_id = auth.uid()                           │  │
│  │ • Gerencia transações ACID                              │  │
│  └────────────────┬─────────────────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────┘
                                      │
┌─────────────────────────────────────▼──────────────────────────┐
│                    DATABASE (PostgreSQL)                        │
│                     Schema: arqvalor                            │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Tabelas Novas:                                         │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │ objetivos                                              │   │
│  │  • id, user_id (RLS)                                  │   │
│  │  • tipo, nome, descricao, icone, cor                  │   │
│  │  • valor_meta, valor_atingido, percentual, status     │   │
│  │  • data_inicio, data_fim, dias_restantes              │   │
│  │  • conta_id, categoria_id, contas_projeto             │   │
│  │  • revisoes (JSONB), criado_em, atualizado_em         │   │
│  │                                                        │   │
│  │ objetivos_progresso (snapshots diários)               │   │
│  │  • id, objetivo_id                                    │   │
│  │  • data_snapshot, valor_atingido, percentual          │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Tabelas Existentes (relacionadas):                     │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │ contas          ◄─── SONHO vincula conta_id           │   │
│  │ categorias      ◄─── OBJETIVO vincula categoria_id     │   │
│  │ transacoes      ◄─── Trigger recalcula objetivos       │   │
│  │ usuarios        ◄─── user_id para RLS                 │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ Funções & Triggers:                                    │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │ fn_calcular_progresso_objetivo()                       │   │
│  │   → calcula valor_atingido por tipo                   │   │
│  │   → retorna (valor, %, status)                         │   │
│  │                                                        │   │
│  │ fn_sincronizar_progresso_objetivo()                    │   │
│  │   → RPC para sync manual/cron                          │   │
│  │   → cria snapshots diários                             │   │
│  │                                                        │   │
│  │ fn_notificar_atualizacao_objetivos()                   │   │
│  │   → trigger AFTER INSERT/UPDATE/DELETE em transacoes   │   │
│  │   → recalcula objetivos relevantes                     │   │
│  │                                                        │   │
│  │ trg_atualizar_progresso_objetivo                       │   │
│  │   → BEFORE INSERT/UPDATE em objetivos                  │   │
│  │   → calcula progresso automaticamente                  │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ ENUMs:                                                 │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │ tipo_objetivo = 'SONHO' | 'OBJETIVO' | 'PROJETO'       │   │
│  │ status_objetivo = 'EM_PROGRESSO' | 'ATINGIDO' |        │   │
│  │                  'CANCELADO'                           │   │
│  └────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐   │
│  │ RLS Policies:                                          │   │
│  ├────────────────────────────────────────────────────────┤   │
│  │ SELECT: user_id = auth.uid()                          │   │
│  │ INSERT: WITH CHECK (user_id = auth.uid())             │   │
│  │ UPDATE: USING + WITH CHECK (user_id = auth.uid())     │   │
│  │ DELETE: USING (user_id = auth.uid())                  │   │
│  │                                                        │   │
│  │ Mesmas policies em objetivos_progresso               │   │
│  └────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🔄 Fluxo: Criar Objetivo

```
┌────────────────────────────────────────────────────────────┐
│ 1. Frontend: Usuário abre DrawerObjetivo                   │
│    • Exibe form com campos                                 │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ 2. Frontend: Usuário preenche e clica [Salvar]            │
│    • DrawerObjetivo valida localmente                     │
│    • mutation.criar() é disparada                          │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ 3. Frontend → Backend: POST /objetivos                     │
│    • Header: Authorization: Bearer <jwt>                  │
│    • Body: {tipo, nome, valor_meta, data_inicio, ...}    │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ 4. Backend: Edge Function recebe                          │
│    • Extrai user_id do JWT (via autenticar())            │
│    • Valida dados                                         │
│    • db(req) cria cliente com schema 'arqvalor'          │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ 5. Backend: INSERT INTO arqvalor.objetivos                │
│    • RLS: user_id = auth.uid() é checado automaticamente  │
│    • TRIGGER: trg_atualizar_progresso_objetivo dispara    │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ 6. Trigger: fn_atualizar_progresso_objetivo()             │
│    • Switch por tipo (SONHO/OBJETIVO/PROJETO)             │
│    • Calcula valor_atingido via SUM(transacoes)           │
│    • Calcula percentual = (valor_atingido / meta) * 100   │
│    • Determina status = EM_PROGRESSO / ATINGIDO           │
│    • SET NEW.valor_atingido, percentual, status           │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ 7. Database: INSERT efetivado com valores calculados      │
│    • objetivo_id gerado (UUID)                            │
│    • Retorna row completa                                 │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ 8. Backend: Response JSON                                 │
│    • { ok: true, dados: { id, tipo, ..., percentual } }  │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ 9. Frontend: Mutation completa com sucesso                │
│    • React Query invalida queryKey('objetivos')           │
│    • useObjetivos refetch automático                      │
│    • DrawerObjetivo fecha                                 │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ 10. Frontend: UI atualizada                               │
│     • CardObjetivo aparece na página com progresso        │
│     • Dashboard mostra novo card                          │
└────────────────────────────────────────────────────────────┘
```

---

## 📈 Fluxo: Transação Dispara Atualização

```
┌────────────────────────────────────────────────────────────┐
│ Usuário lança transação:                                  │
│ • Descrição: "Aluguel recebido"                           │
│ • Valor: R$ 2.000                                         │
│ • Categoria: "Aluguel" (vinculada a Objetivo)            │
│ • Data: Hoje                                              │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ Backend: INSERT INTO arqvalor.transacoes                  │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ TRIGGER: fn_notificar_atualizacao_objetivos()             │
│ • AFTER INSERT em transacoes                              │
│ • Procura por:                                            │
│   - Objetivos tipo SONHO onde conta_id = transacao.conta  │
│   - Objetivos tipo OBJETIVO onde categoria_id = transacao │
│   - Objetivos tipo PROJETO onde conta_id IN contas_proj   │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ Encontra: Objetivo "Aluguel/FII" (tipo OBJETIVO)          │
│ UPDATE arqvalor.objetivos SET                             │
│   valor_atingido = SUM(receitas da categoria),            │
│   percentual = (valor_atingido / 2000) * 100,             │
│   status = (if percentual >= 100 then ATINGIDO else...)   │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ Resultado:                                                │
│ • Objetivo "Aluguel/FII" agora mostra:                   │
│   - valor_atingido: R$ 2.000                             │
│   - percentual: 100%                                     │
│   - status: ATINGIDO                                     │
│   - atualizado_em: NOW()                                 │
└─────────────────────────┬──────────────────────────────────┘
                          │
┌────────────────────────────────────────────────────────────┐
│ Frontend: Sincroniza via React Query                      │
│ • Dashboard mostra Objetivo: 100% ATINGIDO 🎉             │
│ • CardObjetivo barra verde 100%                           │
│ • Badge "ATINGIDO" exibido                                │
└────────────────────────────────────────────────────────────┘
```

---

## 🎯 Estados & Transições Visuais

```
        ┌──────────────────┐
        │   Criar Objetivo │
        │    (FORM OPEN)   │
        └────────┬─────────┘
                 │
                 ▼
        ┌──────────────────┐
        │   EM_PROGRESSO   │ ◄─────────┐
        │                  │           │
        │ • valor = 0%     │           │
        │ • status = ativo │           │
        │                  │           │
        └────┬─────────┬───┘           │
             │         │              │
             │         └──(editar)────┘
             │
       (lançar transação → trigger)
             │
             ▼
        ┌──────────────────┐
        │    ATINGIDO      │
        │                  │
        │ • percentual≥100%│
        │ • imutável       │
        │                  │
        └──────────────────┘


Ou paralelo:

        ┌──────────────────┐
        │   EM_PROGRESSO   │
        │                  │
        └────────┬─────────┘
                 │
           (user click cancelar)
                 │
                 ▼
        ┌──────────────────┐
        │    CANCELADO     │
        │                  │
        │ • lógico (ativo=0)
        │ • imutável       │
        │                  │
        └──────────────────┘
```

---

## 📊 Estrutura de Dados Compacta

```
objetivos {
  id:                UUID          (PK)
  user_id:           UUID          (FK → auth.users)
  
  tipo:              ENUM          'SONHO' | 'OBJETIVO' | 'PROJETO'
  nome:              VARCHAR(255)
  descricao:         TEXT
  icone:             VARCHAR(50)   ex: 'target', 'shield', 'rocket'
  cor:               VARCHAR(10)   ex: 'blue', 'green', 'orange'
  ativo:             BOOLEAN       (soft delete)
  
  valor_meta:        NUMERIC       R$ alvo
  valor_atingido:    NUMERIC       R$ actual (calculado)
  percentual:        SMALLINT      0-100 (calculado)
  status:            ENUM          'EM_PROGRESSO' | 'ATINGIDO' | 'CANCELADO'
  
  data_inicio:       DATE
  data_fim:          DATE
  dias_restantes:    INT           (calculado em view)
  
  conta_id:          UUID          (opcional) FK → contas
  categoria_id:      UUID          (opcional) FK → categorias
  frequencia:        ENUM          (opcional) 'MENSAL' | 'TRIMESTRAL'
  contas_projeto:    UUID[]        (opcional) array de FK
  
  revisoes:          JSONB         histórico de alterações
  criado_em:         TIMESTAMP
  atualizado_em:     TIMESTAMP
}

objetivos_progresso {
  id:                UUID          (PK)
  objetivo_id:       UUID          (FK → objetivos)
  data_snapshot:     DATE          (UNIQUE com objetivo_id)
  valor_atingido:    NUMERIC       snapshot do momento
  percentual:        SMALLINT      snapshot do momento
}
```

---

## 🔐 Segurança em Camadas

```
┌─────────────────────────────────────┐
│ Layer 1: RLS (Row-Level Security)   │
│                                     │
│ SELECT: WHERE user_id = auth.uid()  │
│ INSERT: CHECK user_id = auth.uid()  │
│ UPDATE: WHERE + CHECK              │
│ DELETE: WHERE user_id = auth.uid()  │
│                                     │
│ ✓ Impossível usuário A ver B       │
│ ✓ DB enforça (não confiável client)│
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Layer 2: Backend Validation         │
│                                     │
│ • Extrai user_id do JWT             │
│ • Valida referências (conta, cat)   │
│ • Checa constraints (datas, valores)│
│ • Retorna 404 se isolamento quebrar │
│                                     │
│ ✓ Defesa em profundidade            │
│ ✓ Log de tentativas suspeitas       │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ Layer 3: Frontend Validation        │
│                                     │
│ • Validação de form (UX)            │
│ • TypeScript types (compile time)   │
│ • Error handling graceful           │
│                                     │
│ ✓ Melhora UX                        │
│ ✓ Reduz requisições inválidas       │
└─────────────────────────────────────┘
```

---

## 📱 Layout Dashboard (ASCII)

```
┌───────────────────────────────────────────────────────────────┐
│                        📊 MEUS OBJETIVOS                       │
└───────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 📌 Filtros: [SONHO ▼] [EM_PROGRESSO ▼] [Jun-Dez 2026]  [+ NOVO]│
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 💭 SONHOS (3 ATIVOS)                                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌───────────────┐  ┌───────────────┐  ┌───────────────┐       │
│ │ 🛡️ Fundo      │  │ ✈️ Viagem     │  │ 🏠 Casa       │       │
│ │ Emergência    │  │ Internacional │  │ Própria       │       │
│ │               │  │               │  │               │       │
│ │ 65%           │  │ 40%           │  │ 15%           │       │
│ │ 32.5k / 50k   │  │ 8k / 20k      │  │ 45k / 300k    │       │
│ │               │  │               │  │               │       │
│ │ ✏️ 🗑️         │  │ ✏️ 🗑️         │  │ ✏️ 🗑️         │       │
│ └───────────────┘  └───────────────┘  └───────────────┘       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 🎯 OBJETIVOS (2 ATIVOS)                                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌───────────────┐  ┌───────────────┐                           │
│ │ 🏠 Aluguel/FII│  │ 🎁 Bônus      │                           │
│ │ Renda         │  │ Anual         │                           │
│ │               │  │               │                           │
│ │ 85%           │  │ 50%           │                           │
│ │ 1.7k / 2k mês │  │ 3k / 6k       │                           │
│ │               │  │               │                           │
│ │ ✏️ 🗑️         │  │ ✏️ 🗑️         │                           │
│ └───────────────┘  └───────────────┘                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 📦 PROJETOS (1 ATIVO)                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ┌───────────────┐                                              │
│ │ 🔨 Reforma    │                                              │
│ │ Cozinha       │                                              │
│ │               │                                              │
│ │ 60%           │                                              │
│ │ 9k / 15k      │                                              │
│ │               │                                              │
│ │ ✏️ 🗑️         │                                              │
│ └───────────────┘                                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ 📈 PROGRESSO ÚLTIMOS 30 DIAS                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│       R$                                                        │
│       50k  ┌─────────────────────── (Fundo Emergência)        │
│       40k  │   ┌────── (Viagem)                              │
│       30k  ├───┼──┐                                           │
│       20k  │   │  ├─────── (Casa)                            │
│       10k  │   │  │     ┌─ (Reforma)                         │
│        0k  └───┴──┴─────┴─────────────────────────────────   │
│           1  5  10  15  20  25  30 (dias)                     │
│                                                                 │
│ ✓ Fundo Emergência (verde)    (em progresso)                   │
│ ✓ Reforma (laranja)           (em progresso)                   │
│ ✓ Aluguel (azul)              (ATINGIDO)                       │
│ ○ Viagem (roxo)               (em progresso)                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

**Diagrama visual: 📊 [complete](./DIAGRAMAS_OBJETIVOS.md)**
