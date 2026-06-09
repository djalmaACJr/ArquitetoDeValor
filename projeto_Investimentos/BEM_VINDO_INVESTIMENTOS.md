# 👋 Bem-vindo ao módulo de Investimentos

> Este documento apresenta o propósito e a organização do módulo de investimentos para o Arquiteto de Valor.

---

## O que é este módulo?

O módulo de investimentos acrescenta à aplicação a capacidade de controlar e analisar portfólios financeiros de forma integrada, com:
- tipos de ativo segmentados
- alocação ideal por tipo definida pelo usuário
- questionário padrão por tipo de ativo para calcular notas
- evoluções mês a mês
- dashboard sintetico
- nota do usuário para cada ativo e recomendação de compra
- dividendos integrados ao extrato
- vínculo obrigatório a contas

---

## Por que ele existe?

Para que o usuário não apenas registre receitas e despesas, mas também acompanhe o desempenho dos seus investimentos com o mesmo nível de detalhamento do restante do sistema.

---

## Como a documentação está organizada?

- `INDICE_INVESTIMENTOS.md` — ponto de entrada
- `SUMARIO_EXECUTIVO_INVESTIMENTOS.md` — visão geral
- `ROADMAP_INVESTIMENTOS.md` — especificação técnica
- `DIAGRAMAS_INVESTIMENTOS.md` — fluxos visuais
- `ARQUITETURA_VISUAL_INVESTIMENTOS.md` — arquitetura compacta
- `IMPLEMENTACAO_INVESTIMENTOS.md` — guia de implementação
- `TIMELINE_DEPENDENCIAS_INVESTIMENTOS.md` — planejamento e dependências
- `PLANO_TESTES_INVESTIMENTOS.md` — estratégia de testes

---

## Qual é a prioridade deste módulo?

1. `conta_id` obrigatória para todas as posições e dividendos
2. `tipo_ativo` como eixo central da carteira
3. dashboard inicial com separação por tipo
4. integração de dividendos no extrato
5. cobertura de testes consistente

---

## Próximos passos

1. Leia `INDICE_INVESTIMENTOS.md`
2. Estude `ROADMAP_INVESTIMENTOS.md`
3. Comece pela `IMPLEMENTACAO_INVESTIMENTOS.md`
4. Use `PLANO_TESTES_INVESTIMENTOS.md` para validar entregas

---

## Onde usar este módulo?

- `FrontEnd/src/pages/InvestimentosPage.tsx`
- `supabase/functions/investimentos/`
- `supabase/migrations/`
- `tests/` e `FrontEnd/e2e/tests/`

> Esta pasta deve ser a fonte de verdade para o time sempre que o módulo de investimentos estiver em desenvolvimento.
