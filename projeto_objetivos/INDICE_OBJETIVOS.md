# 📑 Índice — Documentação Completa do Módulo de Objetivos

> Todos os documentos, organizados por propósito e sequência recomendada.

---

## 🚀 Por Onde Começar?

### ⏱️ Tenho 5 minutos?
**Leia**: [SUMARIO_EXECUTIVO_OBJETIVOS.md](./SUMARIO_EXECUTIVO_OBJETIVOS.md)
- Visão geral do que é o módulo
- Responde: O que vou construir?
- Estrutura de pastas
- 3 arquivos-chave

### ⏱️ Tenho 20 minutos?
**Leia em ordem**:
1. [SUMARIO_EXECUTIVO_OBJETIVOS.md](./SUMARIO_EXECUTIVO_OBJETIVOS.md) (5 min)
2. [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) (15 min)
- Escopo completo, estrutura DB, endpoints, tipos, 6 fases

### ⏱️ Tenho 30 minutos?
**Leia em ordem**:
1. [SUMARIO_EXECUTIVO_OBJETIVOS.md](./SUMARIO_EXECUTIVO_OBJETIVOS.md) (5 min)
2. [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) (15 min)
3. [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md) (10 min)
- Fluxos visuais, sequências, estado/transições

### ⏱️ Pronto para Implementar?
**Leia em ordem**:
1. Todos acima (30 min)
2. [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) (15-30 min)
- Código passo-a-passo com exemplos
3. [TIMELINE_DEPENDENCIAS_OBJETIVOS.md](./TIMELINE_DEPENDENCIAS_OBJETIVOS.md) (quando precisar)
- Ordem de execução, paralelização, riscos

---

## 📚 Documentos Completos

### 1️⃣ [SUMARIO_EXECUTIVO_OBJETIVOS.md](./SUMARIO_EXECUTIVO_OBJETIVOS.md)

**Tipo**: Executivo  
**Público**: Todos (managers, devs, stakeholders)  
**Duração**: 5 min  
**O que aborda**:
- O que é o módulo (3 tipos)
- Por que (value proposition)
- Stack usado
- Estrutura de pastas
- Como começar (checklist)
- Dúvidas comuns (FAQ)

**Use para**: Entender o contexto geral, apresentar para stakeholders, decisões altas

---

### 2️⃣ [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md)

**Tipo**: Especificação Técnica  
**Público**: Arquitetos, Tech Leads, Devs Backend/Frontend  
**Duração**: 15-20 min  
**O que aborda**:
- Definição dos 3 tipos (Sonho, Objetivo, Projeto)
- Estrutura de dados completa (ERD conceitual)
  - Tabelas: `objetivos`, `objetivos_progresso`
  - ENUMs: `tipo_objetivo`, `status_objetivo`
  - RLS Policies
  - Triggers & Functions
- Edge Functions (6 endpoints)
  - Request/Response examples
- Frontend
  - Tipos TypeScript
  - Hooks `useObjetivos`, `useObjetivoDetalhe`
  - Componentes: Card, Drawer, Gráfico, Filtros
  - Páginas: Listagem, Detalhe, Dashboard
- Testes (API + E2E)
- 6 Fases de implementação
- Considerações de segurança
- Dependências internas
- Métricas de sucesso

**Use para**: Arquitetura de referência, especificação funcional, validação de escopo

---

### 3️⃣ [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md)

**Tipo**: Fluxos Visuais (Mermaid)  
**Público**: Todos (visual learning)  
**Duração**: 10-15 min  
**O que aborda**:
- Arquitetura de dados (ERD visual)
- Fluxo de cálculo de progresso (3 tipos diferentes)
- Fluxo sequencial: Criar → API → DB → Frontend
- Estados & transições (state machine)
- Layout do Dashboard (mapa de componentes)
- Endpoint flow (diagrama sequência)
- Validação RLS (segurança)
- Estrutura de dados do gráfico (Chart.js)
- Matriz de testes (API + E2E)

**Use para**: Entender fluxos, comunicar com time visuais, validar lógica

---

### 4️⃣ [ARQUITETURA_VISUAL_OBJETIVOS.md](./ARQUITETURA_VISUAL_OBJETIVOS.md)

**Tipo**: Arquitetura em ASCII + Fluxos  
**Público**: Devs (referência visual durante código)  
**Duração**: 5-10 min  
**O que aborda**:
- Arquitetura geral (3 camadas: Frontend, Backend, DB)
- Fluxo: Criar Objetivo (10 passos visuais)
- Fluxo: Transação dispara atualização (auto-sync)
- Estados & transições (diagrama ASCII)
- Estrutura de dados compacta (types)
- Segurança em camadas (RLS, backend, frontend)
- Layout Dashboard (ASCII mock)

**Use para**: Referência durante implementação, onboarding devs, apresentações

---

### 5️⃣ [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md)

**Tipo**: Guia Passo-a-Passo com Código  
**Público**: Devs Backend/Frontend  
**Duração**: 30-60 min (leitura) + horas (implementação)  
**O que aborda**:
- **Fase 1 (Fundação)**:
  - Passo 1.1: Migration SQL completa
  - Passo 1.2: Edge Function `/objetivos` (código)
  - Passo 1.3: Primeiros testes Jest
- **Fase 2 (Dashboard)**:
  - Passo 2.1: Adicionar tipos TypeScript
  - Passo 2.2: Hook `useObjetivos` (código)
  - Passo 2.3: Componente `CardObjetivo` (código)
- **Fase 3+ (continuação)**:
  - `DrawerObjetivo`
  - `GraficoProgresso`
  - Pages
  - Testes E2E

**Use para**: Implementar cada fase, copiar/adaptar código, reference

---

### 6️⃣ [TIMELINE_DEPENDENCIAS_OBJETIVOS.md](./TIMELINE_DEPENDENCIAS_OBJETIVOS.md)

**Tipo**: Planejamento & Gestão  
**Público**: Tech Leads, Managers, Devs (todos)  
**Duração**: 10-15 min  
**O que aborda**:
- **Roadmap Gantt** (visual timeline)
  - 6 fases em sequência
  - Duração estimada
- **Dependências Técnicas** (Mermaid graph)
  - Level 1-8 de dependências
  - O que depende do quê
- **Árvore de Dependências** (detalhada)
  - Migration → Hooks → Components → Pages → Testes
- **Fluxo de Implementação** (passo-a-passo)
  - Ordem recomendada
- **Paralelização Possível**
  - Se 2-3 devs
- **Matriz de Impacto**
  - Quais arquivos modificar
- **Riscos & Mitigações**
- **Métricas de Progresso**
- **Checklist Final**

**Use para**: Planejamento do sprint, estimativa de tempo, identificar blockers, parallelization

---

## 🗺️ Mapa de Navegação

```
                    SUMARIO_EXECUTIVO
                           │
                           ▼
                   ROADMAP (especificação)
                    /      │      \
                   /       │       \
                  ▼        ▼        ▼
            DIAGRAMAS   VISUAL    TIMELINE
         (fluxos Mermaid) (ASCII) (dependências)
                           │
                           ▼
                   IMPLEMENTACAO (código)
                    /      │      \
                   /       │       \
                  ▼        ▼        ▼
              Backend   Frontend   Testes
```

---

## 📋 Uso Recomendado por Rol

### 👔 Product Manager
- [SUMARIO_EXECUTIVO_OBJETIVOS.md](./SUMARIO_EXECUTIVO_OBJETIVOS.md) → Contexto
- [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) § Definições + 6 Fases → Escopo

### 🏗️ Arquiteto / Tech Lead
- [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) → Especificação completa
- [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md) → Validar fluxos
- [TIMELINE_DEPENDENCIAS_OBJETIVOS.md](./TIMELINE_DEPENDENCIAS_OBJETIVOS.md) → Planejamento

### 🖥️ Dev Backend
- [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) § Estrutura Dados + Endpoints
- [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) § Fase 1 + Testes Jest
- [ARQUITETURA_VISUAL_OBJETIVOS.md](./ARQUITETURA_VISUAL_OBJETIVOS.md) § Fluxos

### 🎨 Dev Frontend
- [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) § Tipos + Components + Hooks
- [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) § Fase 2+
- [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md) § Layout Dashboard

### 🧪 QA / Tester
- [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) § Testes (API + E2E)
- [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) § Testes
- [TIMELINE_DEPENDENCIAS_OBJETIVOS.md](./TIMELINE_DEPENDENCIAS_OBJETIVOS.md) § Riscos

### 🚀 DevOps / Infra
- [TIMELINE_DEPENDENCIAS_OBJETIVOS.md](./TIMELINE_DEPENDENCIAS_OBJETIVOS.md) § Dependências + Paralelização
- [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md) § Segurança (RLS)

---

## 🎓 Trilha de Aprendizado

### Para Iniciante (novo no projeto)

**Dia 1: Entender o contexto**
1. Ler [SUMARIO_EXECUTIVO_OBJETIVOS.md](./SUMARIO_EXECUTIVO_OBJETIVOS.md)
2. Ler [ROADMAP_OBJETIVOS.md](./ROADMAP_OBJETIVOS.md)
3. Ver diagramas em [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md)

**Dia 2: Entender padrões do projeto**
1. Ler [CLAUDE.md](./CLAUDE.md) (padrões Frontend + Backend)
2. Ler [ARCHITECTURE.md](./ARCHITECTURE.md) (RLS, fluxos)

**Dia 3: Começar a implementar**
1. Seguir [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) passo-a-passo
2. Consultar [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md) quando dúvida

---

## 📊 Checklist de Leitura

- [ ] Li SUMARIO_EXECUTIVO (5 min)
- [ ] Li ROADMAP seções relevantes para meu rol (20 min)
- [ ] Vi DIAGRAMAS principais (10 min)
- [ ] Identifiquei minhas tarefas (TIMELINE_DEPENDENCIAS)
- [ ] Pronto para começar! ✅

---

## 🔗 Referências Cruzadas

### Dentro desta documentação
- SUMARIO → links para ROADMAP, IMPLEMENTACAO
- ROADMAP → links para BUSINESS_RULES (recorrência adaptável)
- DIAGRAMAS → links para ROADMAP seções
- IMPLEMENTACAO → links para ROADMAP specs
- TIMELINE → links para ROADMAP, DIAGRAMAS

### Externo (projeto principal)
- [CLAUDE.md](./CLAUDE.md) — padrões gerais
- [ARCHITECTURE.md](./ARCHITECTURE.md) — RLS, migra, triggers
- [BUSINESS_RULES.md](./BUSINESS_RULES.md) — recorrência (inspiração)

---

## 💾 Versão da Documentação

| Documento | Versão | Data | Status |
|---|---|---|---|
| SUMARIO_EXECUTIVO_OBJETIVOS.md | 1.0 | 02/06/2026 | ✅ Completo |
| ROADMAP_OBJETIVOS.md | 1.0 | 02/06/2026 | ✅ Completo |
| DIAGRAMAS_OBJETIVOS.md | 1.0 | 02/06/2026 | ✅ Completo |
| ARQUITETURA_VISUAL_OBJETIVOS.md | 1.0 | 02/06/2026 | ✅ Completo |
| IMPLEMENTACAO_OBJETIVOS.md | 1.0 | 02/06/2026 | ✅ Parcial (Fases 1-3 detalhadas) |
| TIMELINE_DEPENDENCIAS_OBJETIVOS.md | 1.0 | 02/06/2026 | ✅ Completo |
| **INDICE_OBJETIVOS.md** | 1.0 | 02/06/2026 | ✅ Este arquivo |

---

## 🎯 Próximas Ações

1. **Devs**: Escolham seu documento principal (ROADMAP ou IMPLEMENTACAO)
2. **Leads**: Use TIMELINE_DEPENDENCIAS para planejamento de sprint
3. **Todos**: Marque como favorito ⭐ para referência rápida

---

## ❓ Dúvidas Frequentes

**P: Por onde começo?**  
R: [SUMARIO_EXECUTIVO_OBJETIVOS.md](./SUMARIO_EXECUTIVO_OBJETIVOS.md)

**P: Quero entender os fluxos**  
R: [DIAGRAMAS_OBJETIVOS.md](./DIAGRAMAS_OBJETIVOS.md)

**P: Vou implementar, por onde começo?**  
R: [IMPLEMENTACAO_OBJETIVOS.md](./IMPLEMENTACAO_OBJETIVOS.md) Fase 1

**P: Quanto tempo vai levar?**  
R: [TIMELINE_DEPENDENCIAS_OBJETIVOS.md](./TIMELINE_DEPENDENCIAS_OBJETIVOS.md)

**P: Consigo fazer em paralelo?**  
R: [TIMELINE_DEPENDENCIAS_OBJETIVOS.md](./TIMELINE_DEPENDENCIAS_OBJETIVOS.md) § Paralelização

**P: Quais são os riscos?**  
R: [TIMELINE_DEPENDENCIAS_OBJETIVOS.md](./TIMELINE_DEPENDENCIAS_OBJETIVOS.md) § Riscos & Mitigações

---

**Última atualização**: 2 de junho de 2026  
**Status**: 📋 Documentação Completa ✅  
**Próximo**: Começar implementação da Fase 1
