# 🧩 Diagramas — Módulo de Investimentos

> Fluxos visuais e diagramas que ajudam a entender a arquitetura e os processos do módulo.

---

## 1. ERD Conceitual

```mermaid
erDiagram
    USUARIO ||--o{ ATIVO : possui
    USUARIO ||--o{ POSICAO : possui
    USUARIO ||--o{ OPERACAO : possui
    USUARIO ||--o{ DIVIDENDO : possui
    USUARIO ||--o{ HISTORICO_MENSAL : possui

    ATIVO ||--o{ POSICAO : referencia
    ATIVO ||--o{ DIVIDENDO : referencia
    ATIVO ||--o{ HISTORICO_MENSAL : referencia
    POSICAO ||--o{ OPERACAO : referencia

    USUARIO {
        uuid id
        uuid user_id
    }
    ATIVO {
        uuid id
        text ticker
        text nome
        text tipo_ativo
        text moeda
    }
    POSICAO {
        uuid id
        uuid ativo_id
        uuid conta_id
        numeric quantidade
        numeric preco_custo
    }
    OPERACAO {
        uuid id
        uuid posicao_id
        text tipo_operacao
        numeric valor_total
        date data_operacao
    }
    DIVIDENDO {
        uuid id
        uuid ativo_id
        uuid conta_id
        numeric valor
        date data_pagamento
    }
    HISTORICO_MENSAL {
        uuid id
        uuid ativo_id
        text mes_ano
        numeric valor_mercado
    }
```

---

## 2. Fluxo de criação de ativo e posição

```mermaid
flowchart LR
    A[Usuário cria ativo] --> B[API POST /investimentos/ativos]
    B --> C[DB: insere ativo]
    C --> D[usuário cria posição]
    D --> E[API POST /investimentos/posicoes]
    E --> F[DB: insere posição com conta_id]
    F --> G[Dashboard atualiza visão por tipo]
```

---

## 3. Fluxo de dividendos no extrato

```mermaid
sequenceDiagram
    participant U as Usuário
    participant F as Frontend
    participant B as Backend
    participant DB as Banco
    U->>F: cadastra dividendo
    F->>B: POST /investimentos/dividendos
    B->>DB: insere dividendo + cria transação de extrato
    DB-->>B: confirma.
    B-->>F: retorna dividendo e transação_extrato_id
    F-->>U: exibe no extrato e no dashboard
```

---

## 4. Composição do dashboard

- `Carteira geral`
  - valor total por tipo
  - variação mensal
  - rentabilidade acumulada
- `Top 5 em alta`
- `Top 5 em prejuízo`
- `Dividendos recebidos no mês`
- `Distribuição por tipo de ativo`

---

## 5. Estados de ativo

```mermaid
stateDiagram-v2
    [*] --> PENDENTE
    PENDENTE --> ATIVA : confirmar compra
    ATIVA --> ENCERRADA : venda completa
    ATIVA --> PENDENTE : editar posição
    ENCERRADA --> [*]
```

---

## 6. Mapa de componentes

```mermaid
flowchart LR
    A[InvestimentosPage] --> B[CardTipoAtivo]
    A --> C[GraficoEvolucaoCarteira]
    A --> D[TabelaPosicoesInvestimentos]
    C --> E[DetalheAtivoPage]
    D --> E
    E --> F[GraficoDividendosMensais]
    E --> G[HistoricoPreco]
```
