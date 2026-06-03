# 📊 Diagramas & Fluxos — Módulo de Objetivos

## 🏗️ Arquitetura de Dados

```mermaid
graph TB
    subgraph "Auth & Usuarios"
        auth["auth.users<br/>(JWT, email, etc)"]
    end
    
    subgraph "Core (já existe)"
        contas["arqvalor.contas<br/>(conta_id, saldo, tipo)"]
        categorias["arqvalor.categorias<br/>(categoria_id, descricao)"]
        transacoes["arqvalor.transacoes<br/>(transacao_id, valor, data, tipo(RECEITA|DESPESA), status(PAGO|PENDENTE|PROJECAO), objetivo_id UUID)"]
    end
    
    subgraph "Novo: Objetivos"
        objetivos["arqvalor.objetivos<br/>🔑 id (UUID)<br/>👤 user_id<br/>📌 tipo (SONHO|OBJETIVO|PROJETO)<br/>💰 valor_meta, valor_atingido<br/>📅 data_inicio, data_fim<br/>🔗 conta_id, categoria_id<br/>📊 status, percentual"]
        
        progresso["arqvalor.objetivos_progresso<br/>🔑 id (UUID)<br/>🎯 objetivo_id<br/>📅 data_snapshot<br/>💹 valor_atingido, percentual"]
    end
    
    auth -->|1 usuário| objetivos
    contas -->|SONHO: vincular| objetivos
    contas -->|PROJETO: múltiplas| objetivos
    categorias -->|OBJETIVO: vincular| objetivos
    categorias -->|PROJETO: vincular| objetivos
    
    objetivos -->|1:N| progresso
    transacoes -.->|TRIGGER: recalcula| objetivos
    transacoes_ui["UI: Lançamentos (Extrato)"]
    objetivos_ui["UI: Objetivo / Projeto (Detalhe)"]
    transacoes_ui -->|editar vinculo / criar| transacoes
    objetivos_ui -->|editar extrato / criar| transacoes
    
    style objetivos fill:#e1f5ff
    style progresso fill:#b3e5fc
    style transacoes fill:#fff3e0
    style contas fill:#f3e5f5
    style categorias fill:#e8f5e9
```

---

## 🔄 Fluxo de Cálculo de Progresso

### SONHO

```mermaid
graph LR
    user["👤 Usuário<br/>cria Sonho"]
    
    user -->|Sonho: Fundo<br/>Emergência| criar["POST /objetivos<br/>{<br/>  tipo: 'SONHO',<br/>  valor_meta: 50000,<br/>  conta_id: xxx,<br/>  data_fim: 2026-12-31<br/>}"]
    
    criar -->|INSERT| db["BD: objetivos<br/>TRIGGER: fn_atualizar_progresso"]
    
    db -->|Query| query["SELECT SUM(valor)<br/>FROM transacoes<br/>WHERE conta_id = xxx<br/>AND data <= CURRENT_DATE"]
    
    query -->|Resultado| calc["valor_atingido = SUM(receitas - despesas)<br/>percentual = (valor_atingido / 50000) * 100<br/>status = EM_PROGRESSO / ATINGIDO"]
    
    calc -->|UPDATE| bd2["BD: objetivos<br/>valor_atingido = 32500<br/>percentual = 65"]
    
    bd2 -->|Retorna| frontend["Frontend:<br/>CardObjetivo exibe<br/>65% completo"]
    
    style db fill:#ffebee
    style query fill:#fff3e0
    style calc fill:#e8f5e9
```

### OBJETIVO

```mermaid
graph LR
    user["👤 Usuário<br/>cria Objetivo"]
    
    user -->|Objetivo: Aluguel/FII<br/>Mensal| criar["POST /objetivos<br/>{<br/>  tipo: 'OBJETIVO',<br/>  valor_meta: 2000,<br/>  categoria_id: xxx,<br/>  frequencia: 'MENSAL'<br/>}"]
    
    criar -->|INSERT| db["BD: objetivos<br/>TRIGGER: fn_atualizar_progresso"]
    
    db -->|Query| query["SELECT SUM(valor)<br/>FROM transacoes<br/>WHERE categoria_id = xxx<br/>AND tipo = 'RECEITA'<br/>AND data BETWEEN<br/>  data_inicio AND data_fim"]
    
    query -->|Resultado| calc["valor_atingido = SUM(receitas)<br/>media_mensal = SUM / qtde_meses<br/>percentual = (media_mensal / 2000) * 100"]
    
    calc -->|UPDATE| bd2["BD: objetivos<br/>valor_atingido = 1700<br/>percentual = 85"]
    
    style calc fill:#e8f5e9
```

### PROJETO

```mermaid
graph LR
    user["👤 Usuário<br/>cria Projeto"]
    
    user -->|Projeto: Reforma<br/>R$15k| criar["POST /objetivos<br/>{<br/>  tipo: 'PROJETO',<br/>  valor_meta: 15000,<br/>  contas_projeto: [xxx, yyy],<br/>  categoria_id: zzz<br/>}"]
    
    criar -->|INSERT| db["BD: objetivos<br/>TRIGGER: fn_atualizar_progresso"]
    
db -->|Query| query["SELECT SUM(CASE WHEN tipo = 'RECEITA' THEN valor ELSE -valor END)<br/>FROM transacoes<br/>WHERE conta_id IN (xxx, yyy)<br/>AND (categoria_id = zzz OR conta_id IN (xxx, yyy))"]

    query -->|Resultado| calc["valor_atingido = SOMA(receitas - despesas)<br/>percentual = (valor_atingido / 15000) * 100"]
    
    calc -->|UPDATE| bd2["BD: objetivos<br/>valor_atingido = 9000<br/>percentual = 60"]
    
    style calc fill:#e8f5e9
```

---

## 🎨 Fluxo Frontend — Criar Objetivo

```mermaid
sequenceDiagram
    participant User
    participant ObjetivosPage
    participant DrawerObjetivo
    participant useObjetivos
    participant API
    participant DB
    
    User->>ObjetivosPage: Clica [+ Novo Objetivo]
    ObjetivosPage->>DrawerObjetivo: Abre drawer
    
    User->>DrawerObjetivo: Preecha formulário<br/>(tipo, nome, valor_meta, datas)
    DrawerObjetivo->>DrawerObjetivo: Valida campos
    
    User->>DrawerObjetivo: Clica [Salvar]
    DrawerObjetivo->>useObjetivos: mutation.criar(dados)
    
    useObjetivos->>API: POST /objetivos {dados}
    API->>API: autenticar(user_id)
    API->>DB: INSERT INTO objetivos
    DB->>DB: TRIGGER: calcular progresso
    
    DB-->>API: {ok: true, dados: {id, ...}}
    API-->>useObjetivos: response
    useObjetivos->>useObjetivos: invalidateQueries('objetivos')
    useObjetivos-->>DrawerObjetivo: sucesso
    
    DrawerObjetivo->>DrawerObjetivo: Fecha drawer
    ObjetivosPage->>ObjetivosPage: Re-fetch data
    ObjetivosPage-->>User: Mostra novo card
```

---

## 📈 Fluxo de Progresso — Tempo Real

```mermaid
graph TB
    user["👤 Usuário<br/>lança transação<br/>+R$1000 de aluguel"]
    
    user -->|Lança| tx["POST /transacoes<br/>{<br/>  categoria_id: aluguel,<br/>  valor: 1000,<br/>  tipo: RECEITA<br/>}"]
    
    tx -->|INSERT| db["BD: transacoes"]
    
    db -->|TRIGGER: trg_atualizar_transacao| trig1["Verifica categorias<br/>vinculadas a objetivos"]
    
    trig1 -->|Encontra| encontra["Objetivo 'Aluguel/FII'<br/>(categoria_id = xxx)"]
    
    encontra -->|UPDATE| atualiza["arqvalor.objetivos<br/>  valor_atingido += 1000<br/>  percentual = recalcula<br/>  status = verifica"]
    
    atualiza -->|INSERT snapshot| snap["arqvalor.objetivos_progresso<br/>  data_snapshot: TODAY<br/>  valor_atingido: 2700<br/>  percentual: 135"]
    
    snap -->|Dashboard carrega| frontend["CardObjetivo exibe<br/>Aluguel/FII: 135%<br/>(atingido!)"]
    
    style db fill:#ffebee
    style trig1 fill:#fff3e0
    style atualiza fill:#e8f5e9
    style snap fill:#f3e5f5
```

---

## 🎯 Estados & Transições

```mermaid
stateDiagram-v2
    [*] --> EM_PROGRESSO: Criar objetivo
    
    EM_PROGRESSO --> EM_PROGRESSO: Editar meta<br/>(revisão com motivo)
    EM_PROGRESSO --> EM_PROGRESSO: Lançar transação<br/>(progresso avança)
    
    EM_PROGRESSO --> ATINGIDO: percentual >= 100
    ATINGIDO --> ATINGIDO: (imutável)
    
    EM_PROGRESSO --> CANCELADO: Cancelar objetivo
    CANCELADO --> CANCELADO: (imutável)
    
    ATINGIDO --> [*]
    CANCELADO --> [*]
    
    note right of EM_PROGRESSO
        • user_id = auth.uid()
        • valor_atingido recalc automático
        • status pode mudar p/ ATINGIDO
    end note
    
    note right of ATINGIDO
        • Atualizado em: timestamp
        • Não permite exclusão
        • Mantém histórico
    end note
```

---

## 📱 Layout do Dashboard — Mapeamento de Componentes

```
┌─────────────────────────────────────────────────────┐
│  ObjetivoDashboard                                  │
├─────────────────────────────────────────────────────┤
│                                                     │
│  [FiltrosObjetivos]                               │
│   └─ tipo: [SONHO | OBJETIVO | PROJETO]            │
│   └─ status: [EM_PROGRESSO | ATINGIDO | CANCELADO] │
│   └─ periodo: [DateRange]                          │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  SONHOS (3 ativos)          [+ Novo Sonho]         │
│  ┌─────────────────────────────────────────────┐  │
│  │  [CardObjetivo]  [CardObjetivo]  [Card...]  │  │
│  │  • Fundo Emerg.  • Viagem        • Casa     │  │
│  │  • 65%           • 40%           • 15%      │  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
│  OBJETIVOS (2 ativos)       [+ Novo Objetivo]      │
│  ┌─────────────────────────────────────────────┐  │
│  │  [CardObjetivo]  [CardObjetivo]             │  │
│  │  • Aluguel/FII   • Bônus anual              │  │
│  │  • 85%           • 50%                      │  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
│  PROJETOS (1 ativo)         [+ Novo Projeto]       │
│  ┌─────────────────────────────────────────────┐  │
│  │  [CardObjetivo]                             │  │
│  │  • Reforma                                  │  │
│  │  • 60%                                      │  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  📊 Gráfico Consolidado — Últimos 30 dias         │
│  ┌─────────────────────────────────────────────┐  │
│  │ [GraficoProgresso]                          │  │
│  │  • Fundo Emergência (verde) ↗️              │  │
│  │  • Reforma (laranja) ↗️                     │  │
│  │  • Aluguel (azul) ↗️                        │  │
│  │                                             │  │
│  │  Legenda: [✓] Atingidos | [◄] Em progresso│  │
│  └─────────────────────────────────────────────┘  │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 🔌 Endpoint Flow — Criar & Consultar

```mermaid
graph TB
    subgraph "Client (React)"
        form["DrawerObjetivo<br/>(Form + Validation)"]
        mutation["useObjetivos<br/>.criar(dados)"]
        card["CardObjetivo<br/>(Display)"]
    end
    
    subgraph "API (Edge Function)"
        handler["Handler<br/>(POST /objetivos)"]
        auth["autenticar(req)"]
        validate["Validar<br/>(data_fim >= data_inicio)"]
        insert["INSERT INTO objetivos<br/>+ TRIGGER"]
        response["Response<br/>{ok, dados}"]
    end
    
    subgraph "Database (PostgreSQL)"
        tbl["arqvalor.objetivos"]
        prog["arqvalor.objetivos_progresso"]
        trigger["TRIGGER:<br/>fn_atualizar_progresso_objetivo()"]
    end
    
    form -->|Submit| mutation
    mutation -->|POST /objetivos| handler
    handler -->|Extract JWT| auth
    auth -->|Validar| validate
    validate -->|✓| insert
    insert -->|INSERT| tbl
    tbl -->|Dispara| trigger
    trigger -->|Calcula| trigger
    trigger -->|INSERT snapshot| prog
    tbl -->|Response| response
    response -->|Success| mutation
    mutation -->|Invalidate + Refetch| card
    
    style form fill:#bbdefb
    style handler fill:#fff9c4
    style tbl fill:#ffccbc
```

---

## 🔐 Validação de Isolamento de Usuário (RLS)

```mermaid
sequenceDiagram
    participant Usuário_A
    participant API as API / RLS
    participant DB as PostgreSQL
    participant Usuário_B
    
    Usuário_A->>API: GET /objetivos
    API->>API: Extrai user_id de JWT (A)
    API->>DB: SELECT * FROM objetivos WHERE user_id = A
    DB-->>API: Retorna objetivos de A
    API-->>Usuário_A: ✓ 3 objetivos
    
    Usuário_B->>API: GET /objetivos/:id_do_objetivo_de_A
    API->>API: Extrai user_id de JWT (B)
    API->>DB: SELECT * FROM objetivos WHERE id = X AND user_id = B
    DB-->>API: (zero linhas)
    API-->>Usuário_B: ❌ 404 Not Found
    
    Usuário_B->>API: PUT /objetivos/:id_do_objetivo_de_A<br/>{valor_meta: 999}
    API->>API: Extrai user_id de JWT (B)
    API->>DB: UPDATE objetivos SET valor_meta = 999<br/>WHERE id = X AND user_id = B
    DB-->>API: (zero linhas afetadas)
    API-->>Usuário_B: ❌ 401 Unauthorized
```

---

## 📊 Gráfico de Progresso — Estrutura de Dados

```
GraficoProgresso({
  objetivo_id: 'uuid-xxxx',
  label: 'Fundo de Emergência',
  cor: '#4CAF50',
  dados: [
    { data: '2026-06-01', valor: 30000, percentual: 60 },
    { data: '2026-06-02', valor: 30500, percentual: 61 },
    { data: '2026-06-03', valor: 32500, percentual: 65 },
    ...
  ],
  meta: 50000,
  atingido: false
})

↓

Chart.js:
{
  labels: ['Jun 1', 'Jun 2', 'Jun 3', ...],
  datasets: [{
    label: 'Fundo de Emergência',
    data: [30000, 30500, 32500, ...],
    borderColor: '#4CAF50',
    fill: false,
    tension: 0.1,
    yAxisID: 'y'
  }, {
    label: 'Meta',
    data: [50000, 50000, 50000, ...],
    borderColor: '#FF9800',
    borderDash: [5, 5],
    yAxisID: 'y'
  }],
  options: {
    scales: {
      y: {
        type: 'linear',
        position: 'left',
        title: { text: 'Saldo (R$)' }
      }
    }
  }
}
```

---

## 🧪 Matriz de Testes

```mermaid
graph TB
    subgraph "API Tests (Jest)"
        api1["CA-OBJ01: CRUD SONHO<br/>(criar, ler, editar)"]
        api2["CA-OBJ02: CRUD OBJETIVO<br/>(com categoria)"]
        api3["CA-OBJ03: CRUD PROJETO<br/>(com contas_projeto)"]
        api4["CA-OBJ04: Filtrar por tipo"]
        api5["CA-OBJ05: Filtrar por status"]
        api6["CA-OBJ06: Obter detalhe + progresso"]
        api7["CA-OBJ07: Editar meta (história de revisão)"]
        api8["CA-OBJ08: Cancelar objetivo"]
        api9["CA-OBJ09: Sincronizar progresso"]
        api10["CA-OBJ10: RLS — user_id isolamento"]
        api11["CA-OBJ11: RLS — validação de referência"]
    end
    
    subgraph "E2E Tests (Playwright)"
        e2e1["E2E-OBJ01: Criar Sonho via UI"]
        e2e2["E2E-OBJ02: Ver progresso no dashboard"]
        e2e3["E2E-OBJ03: Editar objetivo"]
        e2e4["E2E-OBJ04: Filtrar por tipo"]
        e2e5["E2E-OBJ05: Visualizar gráfico"]
        e2e6["E2E-OBJ06: Cancelar objetivo"]
        e2e7["E2E-OBJ07: Navegar até detalhe"]
    end
    
    style api1 fill:#c8e6c9
    style api10 fill:#ffccbc
    style e2e1 fill:#b3e5fc
```

---

## 🚀 Checklist de Deploy

### Antes de Merge

- [ ] Migrations criadas e idempotentes
- [ ] ENUMs definidos
- [ ] RLS policies testadas
- [ ] Edge Function `/objetivos` respondendo OK
- [ ] Hooks TypeScript compilando
- [ ] Componentes renderizando
- [ ] Testes API passando (CA-OBJ01..11)
- [ ] Testes E2E passando (E2E-OBJ01..07)
- [ ] Sem erros console (warnings OK)

### Pós-Deploy

- [ ] Dados migrados (se houver staging)
- [ ] RLS ativada em produção
- [ ] Alertas monitorados (Edge Function logs)
- [ ] User feedback coletado
- [ ] Documentação atualizada (CLAUDE.md, se necessário)

---

## 📝 Referências Internas

- [CLAUDE.md](./CLAUDE.md) — padrões frontend + backend
- [ARCHITECTURE.md](./ARCHITECTURE.md) — detalhes de segurança RLS + triggers
- [BUSINESS_RULES.md](./BUSINESS_RULES.md) — regras de recorrência (adaptáveis)
