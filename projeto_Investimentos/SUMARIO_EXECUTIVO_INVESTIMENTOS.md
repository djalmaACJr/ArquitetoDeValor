# 📌 Sumário Executivo — Módulo de Investimentos

> Visão geral de alto nível para o módulo de investimentos do Arquiteto de Valor.

---

## Objetivo

Criar um módulo completo de investimentos totalmente integrado ao Arquiteto de Valor, com:
- acompanhamento mensal da evolução de ativos
- separação por tipo de ativo
- dashboard analítico com gráficos detalhados
- integração de dividendos no extrato financeiro
- vínculo obrigatório de todas as posições a contas do usuário

---

## Por que este módulo importa?

O novo módulo agrega valor estratégico à aplicação ao permitir que o usuário veja sua carteira de investimentos com o mesmo nível de controle usado para contas correntes e cartões.

Com ele, o usuário poderá:
- acompanhar quais ativos estão em alta ou em prejuízo
- analisar rendimento e dividendos mês a mês
- ver o impacto dos investimentos no saldo das contas
- classificar a carteira por tipo: `STOCKS`, `ETF_INTERNACIONAL`, `RENDA_FIXA`, `CRIPTOMOEDAS`, `TESOURO_DIRETO`

---

## Público-alvo

- usuários que já usam o Arquiteto de Valor para controle financeiro pessoal
- investidores de perfil diverso (renda variável, renda fixa e cripto)
- pessoas que querem acompanhar rendimentos e dividendos com visual mais analítico

---

## Resultados esperados

- Dashboard com visão por tipo de ativo desde a primeira tela
- Relatórios de evolução mensal e performance de cada classe
- Ranking de ativos em alta e ativos em prejuízo
- Dividendos lançados automaticamente como transações no extrato
- Dados consistentes entre investimentos e contas vinculadas

---

## Visão do produto

O módulo deve oferecer:
- `InvestimentosPage` com visão consolidada e filtragem por tipo
- `AtivosPage` listando posições e seus resultados
- `DetalheAtivoPage` com histórico de preços, rentabilidade e dividendos
- `ExtratoPage` incluindo dividendos como transações categorizadas

---

## Entregas principais

1. Modelo de dados de investimentos e dividendos
2. Endpoints de CRUD para ativos, posições, operações e dividendos
3. Dashboard com gráficos por tipo de ativo
4. Integração dos dividendos no extrato e no cálculo de saldo
5. Testes automáticos de API e E2E

---

## Recomendações imediatas

- Construir o modelo com `conta_id` obrigatório em posições e dividendos
- Expor `tipo_ativo` como atributo central nos ativos
- Incluir dashboards com composição por tipo e evolução mensal
- Usar charting mais detalhado do que relatórios simples, seguindo a inspiração do Investidor10
