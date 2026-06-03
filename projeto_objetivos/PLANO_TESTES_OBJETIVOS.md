# 🧪 Plano de Testes — Módulo de Objetivos

> Estratégia, cenários e checklist de testes para o módulo de Objetivos.

---

## 📋 Visão Geral

### Escopo de Testes

| Tipo | Framework | Arquivo | Casos | Coverage Target |
|---|---|---|---|---|
| **API** | Jest + ts-jest | `tests/11_objetivos.test.ts` | CA-OBJ01..13 | ≥ 80% |
| **E2E** | Playwright + Firefox | `FrontEnd/e2e/tests/10_objetivos.test.ts` | E2E-OBJ01..07 | ≥ 70% fluxos críticos |
| **Manual** | Browser | - | Acessibilidade, UX | Antes de deploy |

### Objetivos

- ✅ Validar CRUD completo
- ✅ Validar cálculo de progresso (3 tipos)
- ✅ Validar RLS e isolamento de usuário
- ✅ Validar integrações (contas, categorias, transações)
- ✅ Validar fluxos de UI
- ✅ Validar performance
- ✅ Garantir segurança

---

## 🔬 Testes API (Jest)

### Arquivo: `tests/11_objetivos.test.ts`

#### Estrutura Geral

```ts
describe('CA-OBJ: Módulo Objetivos', () => {
  let usuario1: SupabaseClient
  let usuario2: SupabaseClient
  let testData: TestData = {}

  beforeAll(async () => {
    // Setup: criar 2 usuários de teste
  })

  afterAll(async () => {
    // Cleanup: limpar dados de teste
  })

  describe('CA-OBJ01..06: CRUD & Listagem', () => { ... })
  describe('CA-OBJ07..08: Edição & Exclusão', () => { ... })
  describe('CA-OBJ09..11: Sincronização & Filtros', () => { ... })
  describe('CA-OBJ12..13: Segurança & Validações', () => { ... })
})
```

---

## 📝 Casos de Teste API

### Grupo 1: CRUD Básico

#### **CA-OBJ01: Criar SONHO com dados válidos**

**Pré-requisitos**:
- Usuário autenticado
- Conta existente (tipo: CARTEIRA)

**Passos**:
1. POST `/objetivos` com payload SONHO válido
2. Validar resposta HTTP 201

**Payload**:
```json
{
  "tipo": "SONHO",
  "nome": "Fundo de Emergência",
  "descricao": "Atingir R$50k",
  "valor_meta": 50000,
  "data_inicio": "2026-06-02",
  "data_fim": "2026-12-31",
  "conta_id": "<CONTA_ID>",
  "icone": "shield",
  "cor": "green"
}
```

**Validações**:
- ✅ `response.ok === true`
- ✅ `dados.id` gerado (UUID)
- ✅ `dados.user_id === auth.uid()`
- ✅ `dados.tipo === 'SONHO'`
- ✅ `dados.status === 'EM_PROGRESSO'`
- ✅ `dados.valor_atingido === 0` ou calculado
- ✅ `dados.percentual >= 0 && <= 100`
- ✅ `dados.criado_em` é timestamp válido

**Dados esperados**:
- ✅ Objetivo inserido em `arqvalor.objetivos`
- ✅ `user_id` isolado (RLS)

---

#### **CA-OBJ02: Criar OBJETIVO com categoria**

**Pré-requisitos**:
- Categoria "Aluguel" ou similar

**Payload**:
```json
{
  "tipo": "OBJETIVO",
  "nome": "Renda de Aluguel",
  "descricao": "Receber aluguel + FII",
  "valor_meta": 2000,
  "frequencia": "MENSAL",
  "categoria_id": "<CATEGORIA_ID>",
  "data_inicio": "2026-06-02",
  "data_fim": "2026-12-31",
  "icone": "home",
  "cor": "blue"
}
```

**Validações**:
- ✅ `tipo === 'OBJETIVO'`
- ✅ `categoria_id` referencia válida
- ✅ `frequencia === 'MENSAL'`

---

#### **CA-OBJ03: Criar PROJETO com múltiplas contas**

**Pré-requisitos**:
- Mínimo 2 contas criadas

**Payload**:
```json
{
  "tipo": "PROJETO",
  "nome": "Reforma da Cozinha",
  "descricao": "Reformar + comprar eletros",
  "valor_meta": 15000,
  "data_inicio": "2026-06-02",
  "data_fim": "2026-12-31",
  "contas_projeto": ["<CONTA_ID_1>", "<CONTA_ID_2>"],
  "categoria_id": "<CATEGORIA_REFORMA>",
  "icone": "hammer",
  "cor": "orange"
}
```

**Validações**:
- ✅ `tipo === 'PROJETO'`
- ✅ `contas_projeto` é array com 2+ contas
- ✅ Todas as contas pertencem ao usuário

---

#### **CA-OBJ04: Listar objetivos com filtro por tipo**

**Casos**:
1. GET `/objetivos?tipo=SONHO` → retorna apenas SONHOs
2. GET `/objetivos?tipo=OBJETIVO` → retorna apenas OBJETIVOs
3. GET `/objetivos?tipo=PROJETO` → retorna apenas PROJETOs
4. GET `/objetivos` (sem filtro) → retorna todos

**Validações**:
- ✅ Array de objetivos
- ✅ Se filtro, todos têm `tipo` correto
- ✅ Ordenados por `criado_em DESC`

---

#### **CA-OBJ05: Listar objetivos com filtro por status**

**Casos**:
1. GET `/objetivos?status=EM_PROGRESSO` → retorna em andamento
2. GET `/objetivos?status=ATINGIDO` → retorna completos
3. GET `/objetivos?status=CANCELADO` → retorna cancelados

**Validações**:
- ✅ Todos têm `status` correto

---

#### **CA-OBJ06: Obter detalhe de objetivo + progresso**

**Payload**: GET `/objetivos/<ID>`

**Validações**:
- ✅ Retorna objetivo completo
- ✅ Inclui `objetivos_progresso` (array de snapshots)
- ✅ Cada snapshot tem `data_snapshot`, `valor_atingido`, `percentual`
- ✅ `dias_restantes` calculado corretamente
- ✅ Histórico de `revisoes` (JSONB array)

**Exemplo resposta**:
```json
{
  "dados": {
    "id": "uuid",
    "tipo": "SONHO",
    "valor_meta": 50000,
    "valor_atingido": 32500,
    "percentual": 65,
    "status": "EM_PROGRESSO",
    "dias_restantes": 212,
    "progresso": [
      { "data": "2026-06-01", "valor": 30000, "percentual": 60 },
      { "data": "2026-06-02", "valor": 32500, "percentual": 65 }
    ],
    "revisoes": []
  }
}
```

---

### Grupo 2: Edição & Exclusão

#### **CA-OBJ07: Editar objetivo com histórico de revisão**

**Payload**: PUT `/objetivos/<ID>`

```json
{
  "valor_meta": 60000,
  "motivo_revisao": "Aumentei o orçamento"
}
```

**Validações**:
- ✅ `valor_meta` atualizado
- ✅ Nova entrada em `revisoes` JSONB
- ✅ `revisoes[0].data` é timestamp
- ✅ `revisoes[0].valor_meta_anterior === 50000`
- ✅ `revisoes[0].motivo === "Aumentei o orçamento"`
- ✅ `atualizado_em` atualizado
- ✅ Se `valor_meta` alterado, `percentual` recalculado

---

#### **CA-OBJ08: Cancelar objetivo (soft delete)**

**Payload**: DELETE `/objetivos/<ID>`

**Validações**:
- ✅ Objetivo ainda existe no DB
- ✅ `ativo === false`
- ✅ `status === 'CANCELADO'`
- ✅ GET `/objetivos/<ID>` após delete retorna 404 (filtrado por RLS)
- ✅ Objetivo não aparece em listagem

---

### Grupo 3: Sincronização & Filtros

#### **CA-OBJ09: Sincronizar progresso (recalcular)**

**Payload**: POST `/objetivos/sincronizar-progresso`

**Setup**:
- Criar SONHO com conta
- Lançar transação naquela conta
- Chamada de sync

**Validações**:
- ✅ Todos objetivos atualizados
- ✅ `valor_atingido` recalculado
- ✅ `percentual` atualizado
- ✅ Snapshots criados em `objetivos_progresso`
- ✅ Resposta: `{ dados: { sincronizados: N } }`

---

#### **CA-OBJ10: Validar cálculo SONHO (soma saldo conta)**

**Setup**:
- Criar SONHO vinculado a conta
- Conta tem `saldo_inicial: 10000`
- Lançar RECEITA: +R$ 5.000
- Lançar DESPESA: -R$ 2.000

**Esperado**:
```
valor_atingido = 10000 + 5000 - 2000 = 13000
percentual = (13000 / meta) * 100
```

**Validações**:
- ✅ Cálculo correto
- ✅ Inclui TODAS as transações (PAGO, PENDENTE, PROJECAO)

---

#### **CA-OBJ11: Validar cálculo OBJETIVO (soma receita categoria / investimentos)**

**Setup**:
- Criar OBJETIVO tipo categoria "Aluguel", meta 2000
- Lançar 3 receitas na categoria:
  - R$ 1.000
  - R$ 800
  - R$ 500
- Criar conta de investimento e lançar transferência para ela (como receita líquida) se o objetivo for de investimento

**Esperado**:
```
valor_atingido = 1000 + 800 + 500 = 2300
percentual = (2300 / 2000) * 100 = 115%
status = 'ATINGIDO'
```

**Validações**:
- ✅ Cálculo correto
- ✅ Status muda para ATINGIDO quando >= 100%

---

#### **CA-OBJ14: Validar cálculo PROJETO com receitas e despesas líquidas**

**Setup**:
- Criar PROJETO com `valor_meta` 5000 e `contas_projeto` = [contaA, contaB]
- Inserir transações nas contas do projeto:
  - Receita R$ 2.000 na contaA
  - Despesa R$ 500 na contaB
  - Transferência entre contas do projeto (crédito R$ 300 na contaB, débito R$ 300 na contaA)

**Esperado**:
```
valor_atingido = 2000 - 500 + 300 - 300 = 1500
percentual = (1500 / 5000) * 100 = 30%
status = 'EM_PROGRESSO'
```

**Validações**:
- ✅ Receita e despesa somadas corretamente
- ✅ Transferências entre contas do projeto são refletidas como fluxo líquido
- ✅ Progresso do projeto não ignora receitas

---

---

#### **CA-OBJ15: Projeções aparecem no extrato e vinculam-se ao objetivo**

**Setup**:
- Criar OBJETIVO (tipo SONHO/OBJETIVO/PROJETO) com `conta_id` ou `categoria_id` vinculada
- Inserir transação com `tipo = 'RECEITA'`, `status = 'PROJECAO'`, `conta_id` igual à conta do objetivo, `objetivo_id` apontando para o objetivo e `data` futura

**Ações**:
1. GET `/contas/:id/extrato?periodo=...` (extrato da conta)  
2. POST `/objetivos/sincronizar-progresso` ou executar trigger que considera projeções

**Esperado**:
```
- Lançamento com `status = 'PROJECAO'` aparece no extrato da conta normalmente
- Após sincronizar, `valor_atingido` do objetivo inclui o valor projetado quando dentro do período
```

**Validações**:
- ✅ Transação com `status = 'PROJECAO'` visível no extrato da conta
- ✅ Progresso do objetivo incrementado com projeção quando aplicável
- ✅ API retorna a transação com `status = 'PROJECAO'` e `tipo = 'RECEITA'` (sem campo extra `projecao`)

---

#### **CA-OBJ16: Edição bidirecional de lançamentos vinculados ao objetivo**

**Setup**:
- Criar OBJETIVO com `conta_id` ou `categoria_id` e `valor_meta`
- Criar transação vinculada via `POST /objetivos/:id/extrato` ou `POST /transacoes` com `objetivo_id`

**Ações**:
1. Editar a transação a partir do extrato global `/transacoes/:id` e alterar `descricao`/`valor`/`objetivo_id`
2. Consultar `/objetivos/:id/extrato` e verificar a mudança
3. Editar a transação a partir do extrato do objetivo `/objetivos/:id/extrato/:transacao_id`
4. Consultar `/contas/:id/extrato` e verificar a mudança

**Esperado**:
```
- A alteração é visível em ambos os contextos
- O vínculo `objetivo_id` permanece correto ou é removido quando o lançamento é desvinculado
- O progresso do objetivo é recalculado automaticamente
```

**Validações**:
- ✅ Edição via extrato global reflete no extrato do objetivo
- ✅ Edição via extrato do objetivo reflete no extrato global
- ✅ Objetivo recalcula `valor_atingido` / `percentual` após cada alteração
- ✅ Desvincular `objetivo_id` remove o lançamento do extrato do objetivo
- ✅ RLS/validação impede acesso a objetivos e transações de outro usuário

---

### Grupo 4: Segurança & Validações

#### **CA-OBJ12: RLS — Usuário não vê objetivo de outro**

**Setup**:
- Usuário1 cria objetivo
- Usuário2 tenta acessar

**Teste 1**: `GET /objetivos/:id` do usuário1 via usuário2
- ✅ Retorna 404 ou erro autorização
- ✅ Dados NÃO expostos

**Teste 2**: `PUT /objetivos/:id` do usuário1 via usuário2
- ✅ Retorna 401 Unauthorized
- ✅ UPDATE falha

**Teste 3**: `DELETE /objetivos/:id` do usuário1 via usuário2
- ✅ Retorna 401 Unauthorized
- ✅ DELETE falha

**Validações**:
- ✅ RLS funciona em todos os métodos
- ✅ Sem data leak

---

#### **CA-OBJ13: Validações de entrada**

**Teste 1**: `data_fim < data_inicio`
```json
{
  "data_inicio": "2026-12-31",
  "data_fim": "2026-06-02"
}
```
- ✅ Retorna HTTP 400
- ✅ Erro: "data_fim deve ser >= data_inicio"

**Teste 2**: `valor_meta <= 0`
```json
{
  "valor_meta": -1000
}
```
- ✅ Retorna HTTP 400
- ✅ Erro: "valor_meta deve ser > 0"

**Teste 3**: Campos obrigatórios faltando
```json
{
  "tipo": "SONHO"
  // faltam: nome, valor_meta, datas
}
```
- ✅ Retorna HTTP 400
- ✅ Erro: "Campos obrigatórios: ..."

**Teste 4**: Referência inválida (conta_id que não existe)
```json
{
  "conta_id": "uuid-invalido"
}
```
- ✅ Retorna HTTP 400 ou 409
- ✅ Erro: "Conta não encontrada" ou FK constraint

---

## 🎭 Testes E2E (Playwright)

### Arquivo: `FrontEnd/e2e/tests/10_objetivos.test.ts`

#### Estrutura Geral

```ts
import { test, expect } from '@playwright/test'
import { autenticar, preencherForm } from '../auth.setup'

test.describe('E2E-OBJ: Módulo Objetivos (UI)', () => {
  test.beforeEach(async ({ page }) => {
    await autenticar(page)
    await page.goto('/objetivos')
  })

  test('E2E-OBJ01: Criar novo Sonho via drawer', async ({ page }) => { ... })
  test('E2E-OBJ02: Visualizar progresso no dashboard', async ({ page }) => { ... })
  // ... etc
})
```

---

## 📝 Casos E2E

### **E2E-OBJ01: Criar Sonho via Drawer**

**Passos**:
1. Navegar para `/objetivos`
2. Clicar `[+ Novo Objetivo]`
3. Preencher form:
   - Tipo: `SONHO`
   - Nome: "Fundo Emergencial"
   - Meta: "50000"
   - Início: "02/06/2026"
   - Fim: "31/12/2026"
   - Conta: (selecionar)
   - Ícone: "shield"
   - Cor: "green"
4. Clicar `[Salvar]`

**Validações**:
- ✅ Drawer fecha
- ✅ Card aparece na página com "Fundo Emergencial"
- ✅ Progresso começa em 0%
- ✅ Sem erro no console

**Waits**:
```ts
await page.waitForSelector('text=Fundo Emergencial')
await expect(page.locator('.progress-bar')).toBeVisible()
```

---

### **E2E-OBJ02: Visualizar Progresso no Dashboard**

**Setup**: Objetivo já criado com progresso parcial

**Passos**:
1. Navegar para `/objetivos`
2. Ver section "SONHOS"
3. Ver CardObjetivo com progresso visual

**Validações**:
- ✅ Card renderiza
- ✅ Barra de progresso visível
- ✅ Percentual exibido (ex: "65%")
- ✅ Valores R$ corretos
- ✅ Status badge (ex: "Em progresso")

**Seletores**:
```ts
await expect(page.locator('[data-testid=card-sonho]')).toContainText('65%')
await expect(page.locator('.progress-bar')).toHaveAttribute('style', /width: 65%/)
```

---

### **E2E-OBJ03: Editar Objetivo**

**Passos**:
1. Card → Clicar `[✏️ Editar]` (ou abrir detalhe)
2. Editar campo (ex: aumentar meta de 50k para 60k)
3. Clicar `[Salvar]`

**Validações**:
- ✅ Drawer fecha
- ✅ Meta atualizada no card
- ✅ Histórico de revisões aparece (se acesso detalhe)
- ✅ Sem erro

---

### **E2E-OBJ04: Filtrar por Tipo**

**Passos**:
1. Ir para `/objetivos`
2. Clicar botão `[SONHO]` (filtro tipo)
3. Ver apenas SONHOs

**Validações**:
- ✅ Section "OBJETIVOS" e "PROJETOS" ocultadas (ou vazias)
- ✅ Section "SONHOS" com cards
- ✅ Clicar novamente deseleciona filtro
- ✅ Todos os tipos aparecem de novo

---

### **E2E-OBJ05: Visualizar Gráfico de Progresso**

**Setup**: Objetivo com histórico de progresso

**Passos**:
1. Card → Clicar `[📊 Detalhe]`
2. Ir para página `ObjetivoDetalhe`
3. Ver gráfico de progresso

**Validações**:
- ✅ Página carrega
- ✅ Canvas Chart.js renderiza
- ✅ Gráfico mostra linha de progresso
- ✅ Eixos com labels (data, valor)
- ✅ Legenda exibe

**Seletores**:
```ts
await expect(page.locator('canvas')).toBeVisible()
await expect(page.locator('.chart-legend')).toContainText(nome_objetivo)
```

---

### **E2E-OBJ06: Cancelar Objetivo**

**Passos**:
1. Card → Clicar `[❌]` (botão cancelar)
2. Confirmar (se houver modal)

**Validações**:
- ✅ Card desaparece da listagem
- ✅ GET `/objetivos` não retorna mais
- ✅ Sem erro

---

### **E2E-OBJ07: Navegar até Detalhe e Ver Histórico**

**Passos**:
1. Card → Clicar `[📊 Detalhe]`
2. Ir para página `ObjetivoDetalhe`
3. Scroll até seção "Histórico de revisões"

**Validações**:
- ✅ Página detalhada carrega
- ✅ Exibe: nome, meta, progresso, gráfico
- ✅ Se houver revisões, aparecem com data e motivo
- ✅ Botões de ação (editar, cancelar) presentes
- ✅ Timeline progresso visível

---

## 📊 Matriz de Cobertura

```
┌────────────────────────────────────────────────────────┐
│ Cenário                │ API | E2E | Manual | Priority │
├────────────────────────────────────────────────────────┤
│ CRUD SONHO             │ ✅  │ ✅  │        │ ALTA     │
│ CRUD OBJETIVO          │ ✅  │     │        │ ALTA     │
│ CRUD PROJETO           │ ✅  │     │        │ ALTA     │
│ Listagem + Filtros     │ ✅  │ ✅  │        │ ALTA     │
│ Detalhe + Histórico    │ ✅  │ ✅  │        │ ALTA     │
│ Cálculo Progresso      │ ✅  │ ✅  │        │ ALTA     │
│ Sincronização          │ ✅  │     │        │ MÉDIA    │
│ RLS + Segurança        │ ✅  │     │        │ CRÍTICA  │
│ Validações             │ ✅  │     │        │ MÉDIA    │
│ Acessibilidade         │     │     │ ✅     │ BAIXA    │
│ Performance            │     │ ✅  │ ✅     │ MÉDIA    │
│ Responsividade         │     │ ✅  │ ✅     │ MÉDIA    │
└────────────────────────────────────────────────────────┘
```

---

## 🧪 Dados de Teste

### Setup de Teste

**Arquivo**: `tests/setup.ts` (adicionar ao final)

```ts
export async function criarDadosTestObjetivos() {
  const { usuario, contas, categorias } = await criarDadosComuns()

  // Criar conta de teste
  const carteira = contas.find(c => c.tipo === 'CARTEIRA')

  // Criar categoria teste
  const catAluguel = categorias.find(c => c.descricao === 'Aluguel')

  // Dados para objetivos
  return {
    sonho_valido: {
      tipo: 'SONHO',
      nome: 'Fundo de Emergência',
      valor_meta: 50000,
      data_inicio: '2026-06-02',
      data_fim: '2026-12-31',
      conta_id: carteira.id,
      icone: 'shield',
      cor: 'green'
    },

    objetivo_valido: {
      tipo: 'OBJETIVO',
      nome: 'Renda de Aluguel',
      valor_meta: 2000,
      frequencia: 'MENSAL',
      data_inicio: '2026-06-02',
      data_fim: '2026-12-31',
      categoria_id: catAluguel.id
    },

    projeto_valido: {
      tipo: 'PROJETO',
      nome: 'Reforma Cozinha',
      valor_meta: 15000,
      data_inicio: '2026-06-02',
      data_fim: '2026-12-31',
      contas_projeto: [carteira.id],
      categoria_id: catAluguel.id
    }
  }
}
```

---

## 🚀 Como Executar

### Testes API

```bash
# Rodar todos os testes de objetivos
npm test -- 11_objetivos

# Rodar com coverage
npm test -- 11_objetivos --coverage

# Rodar um case específico
npm test -- 11_objetivos -t "CA-OBJ01"

# Watch mode (durante desenvolvimento)
npm test -- 11_objetivos --watch
```

### Testes E2E

```bash
# Rodar todos E2E
npm run test:e2e -- 10_objetivos

# Modo visual (debug)
npm run test:e2e:ui -- 10_objetivos

# Headless (CI)
npm run test:e2e -- 10_objetivos --headed=false

# Gerar relatório HTML
npm run test:e2e:report
```

### Testes Manuais

**Checklist para antes de deploy:**

- [ ] Acessibilidade (kbd navigation)
- [ ] Responsividade (mobile, tablet, desktop)
- [ ] Performance (Time to Interactive < 2s)
- [ ] Erro handling (mostrar erros amigáveis)
- [ ] Dark mode (se existir)
- [ ] Offline behavior
- [ ] Campos obrigatórios com validação visual
- [ ] Tooltips/help text legíveis

---

## ✅ Critérios de Sucesso

### API Tests

- ✅ Todos CA-OBJ01..13 passando
- ✅ Coverage ≥ 80%
- ✅ Sem erros ou warnings
- ✅ RLS validado (2 usuários)
- ✅ Tempo de execução < 30s (suite inteira)

### E2E Tests

- ✅ Todos E2E-OBJ01..07 passando
- ✅ Sem flaky tests (rodar 3x sem inconsistência)
- ✅ Screenshots em case de falha
- ✅ Tempo de execução < 60s (suite inteira)

### Manual Tests

- ✅ Funcionalidade OK em 3 navegadores (Chrome, Firefox, Safari)
- ✅ Mobile responsivo (375px, 768px, 1920px)
- ✅ Sem console errors/warnings em produção
- ✅ Performance: < 2s no dashboard
- ✅ Acessibilidade OK (sem color-only cues)

### Segurança

- ✅ RLS ativada e testada
- ✅ User_id isolado (CA-OBJ12)
- ✅ Validações backend (CA-OBJ13)
- ✅ Sem SQL injection
- ✅ Sem XSS
- ✅ CSRF protegido (JWT)

---

## 📈 Relatório de Testes (Template)

```markdown
# Relatório de Testes — Módulo Objetivos

## Resumo Executivo
- **Data**: 2026-06-XX
- **Versão**: 1.0
- **Status**: ✅ PASSOU | ⚠️ PASSOU COM RESSALVAS | ❌ FALHOU

## Métricas
| Métrica | Resultado | Target | Status |
|---------|-----------|--------|--------|
| API Coverage | 85% | ≥ 80% | ✅ |
| E2E Coverage | 75% | ≥ 70% | ✅ |
| Total Tests | 20 | - | ✅ |
| Passed | 20 | 20 | ✅ |
| Failed | 0 | 0 | ✅ |
| Skipped | 0 | - | ✅ |

## Casos de Teste API
- ✅ CA-OBJ01..13: Todos passando

## Casos de Teste E2E
- ✅ E2E-OBJ01..07: Todos passando

## Performance
- Dashboard: 1.8s (target < 2s)
- Listagem: 0.9s
- Detalhe: 1.2s

## Segurança
- ✅ RLS validada
- ✅ Isolamento de usuário OK
- ✅ Sem vulnerabilidades detectadas

## Issues Encontradas
- Nenhuma blocker
- 0 warnings

## Aprovação
- [ ] Dev
- [ ] QA
- [ ] Tech Lead
- [ ] Product

**Pronto para Deploy**: ✅ SIM
```

---

## 🐛 Debugging & Troubleshooting

### Teste API falha: "user_id mismatch"

**Causa**: JWT não sendo extraído corretamente
**Solução**: 
```ts
const { user_id } = await autenticar(req)
console.log('user_id:', user_id) // debug
```

### Teste E2E timeout: "Chart não renderiza"

**Causa**: Chart.js demora para inicializar
**Solução**:
```ts
await page.waitForTimeout(1000) // aguardar DOM update
await expect(page.locator('canvas')).toBeVisible({ timeout: 5000 })
```

### RLS bloqueando INSERT

**Causa**: `user_id` do JWT não enviado
**Solução**: Verificar se `db(req)` está usando o JWT correto
```ts
const dbc = db(req) // propagua JWT automaticamente
```

---

## 📋 Checklist Pré-Deploy

### Semana antes
- [ ] Testes API: 100% passando
- [ ] Testes E2E: 100% passando
- [ ] Coverage reports gerados
- [ ] Code review aprovado

### Dia do deploy
- [ ] Migração DB testada em staging
- [ ] Edge Functions deployadas
- [ ] RLS policies ativadas
- [ ] Testes manuais OK

### Pós-deploy
- [ ] Monitorar Edge Function logs
- [ ] Verificar alertas de erro
- [ ] Testar 3 contas de usuário real
- [ ] Coletar feedback inicial

---

## 📞 Referências

- [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) § Testes
- [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) § Testes Iniciais
- [CLAUDE.md](../CLAUDE.md) § 🧪 Testes

---

**Versão**: 1.0  
**Última atualização**: 2 de junho de 2026  
**Status**: ✅ Pronto para usar
