# Robô de importação — investidor10 → Arquiteto de Valor

Importa as **operações (compras/vendas)** da sua carteira do
[investidor10](https://investidor10.com.br/wallet/my-wallet/pro/entries) para
o Arquiteto de Valor, trazendo **só os ativos que faltam** na sua carteira do app.

> **Por que um robô e não copiar/colar?** A tabela de movimentações do
> investidor10 exibe valores com **apenas 2 casas decimais**, mas muitos ativos
> (cripto, ações fracionárias, etc.) têm mais casas. O robô **não lê a tabela
> renderizada** — ele intercepta a resposta **JSON crua** que a própria página
> baixa nos bastidores, que traz a quantidade/preço com **precisão cheia**.

## Pré-requisitos

- Playwright + Firefox já instalados pelo `FrontEnd` (mesma dependência do e2e).
  Se faltar o Firefox: `npx playwright install firefox`.
- Sua conta Google usada no investidor10 (o login é via **OAuth do Google**).

## Configuração

```bash
cd FrontEnd/robo-investidor10
cp .env.example .env      # opcional; só ajusta URL/headless. Sem senha aqui.
```

`perfil/`, `.env` e `capturas/` são ignorados pelo git.

> **Login via Google:** o investidor10 autentica pelo Google, que bloqueia
> navegador automatizado. Por isso o robô usa um **perfil persistente**
> (pasta `perfil/`): no **1º run** você loga com o Google **manualmente** na
> janela aberta; as execuções seguintes reaproveitam a sessão.

---

## Fase 1 — Descoberta (precisamos do JSON real das movimentações)

### Jeito mais rápido: captura manual no seu browser já logado ⭐

Como você já está logado, nem precisa do robô para descobrir o formato:

1. Abra `https://investidor10.com.br/wallet/my-wallet/pro/entries`
2. **F12** → aba **Network** (Rede) → filtro **Fetch/XHR**
3. **F5** para recarregar
4. Ache a requisição que retorna as **movimentações** (nome com `entries`/`wallet`/`pro`;
   confira em **Response/Preview**)
5. Botão direito → **Copy → Copy response** e mande ao assistente (preserve as casas decimais).

### Jeito automatizado (robô)

```bash
cd FrontEnd
npx playwright test --config=robo-investidor10/playwright.config.ts captura
```

Dois modos de sessão:

- **Perfil persistente (default):** abre um Firefox próprio; no 1º run **faça login
  com o Google na janela** (2FA incluso). A sessão fica em `perfil/` e é reusada.
- **CDP (reusa navegador aberto e logado):** abra o Chrome/Edge com a porta de
  depuração e aponte `INV10_CDP_URL` no `.env`. No Windows (feche o Chrome antes):

  ```powershell
  & "C:\Program Files\Google\Chrome\Application\chrome.exe" `
    --remote-debugging-port=9222 --user-data-dir="C:\Users\djalma\chrome-inv10"
  ```

  Logue no investidor10 nessa janela uma vez; depois rode o robô com
  `INV10_CDP_URL=http://localhost:9222`. (O Chrome recente bloqueia a porta de
  depuração no perfil padrão; por isso usa-se um `--user-data-dir` dedicado.)

O robô grava todo JSON do site em `robo-investidor10/capturas/` + um
`manifest.json` ranqueando os candidatos à tabela de movimentações.

**Depois:** abra `capturas/manifest.json`, identifique a captura com as
movimentações (a de mais itens, com chaves tipo data/ticker/quantidade) e
**envie esse arquivo `.json` + o `manifest.json` ao assistente** para construir
a Fase 2.

---

## Extração (atual) — via console, sem Playwright

A interceptação de JSON não funcionou (o investidor10 é Next.js App Router e
renda a tabela como **PrimeReact DataTable**, sem endpoint JSON). Os valores
visíveis vêm truncados em 2 casas (cripto chega a `< 0,01`), mas cada linha
carrega no React um `rowData` cru com **precisão cheia**. Por isso a extração é
feita por um **snippet colado no console** do seu navegador já logado, que lê o
`rowData` via React fiber, pagina sozinho (`button.p-paginator-next`) e baixa o
`inv10-operacoes.json`. Snippet em [`extrator-console.js`](./extrator-console.js).

Passo a passo: abra `/wallet/my-wallet/pro/entries`, **expanda os 4 grupos**
(Renda variável, Criptomoedas, Renda fixa, Tesouro direto), F12 → Console → cole
o `extrator-console.js` → aguarde `acumulado: N` → rode `inv10Baixar()`.

## Fase 2 — Geração do arquivo de importação ✅

Script [`gerar-arquivo-import.mjs`](./gerar-arquivo-import.mjs) converte o
`inv10-operacoes.json` num **CSV no layout Status Invest**, que a tela
Importar/Exportar do app já lê (`parseStatusInvest` em
`FrontEnd/src/lib/importB3.ts`). O app deriva as posições atuais das operações
(compras − vendas, custo médio) e cria só os ativos que faltam.

```bash
cd FrontEnd/robo-investidor10
# coloque o inv10-operacoes.json aqui (ou passe o caminho)
node gerar-arquivo-import.mjs
# → gera investidor10-import.csv
```

Depois, importe o `investidor10-import.csv` pela tela **Importar/Exportar**
(aceita `.csv`) e **escolha sua conta de investimento**. Nada é gravado sem sua
confirmação; a importação é idempotente (re-rodar não duplica).

Notas: eventos de **Desdobramento** são pulados (não viram compra/venda —
ajuste a quantidade na mão se afetar a posição). Ativos em **US$** entram com o
valor em dólar, mas rotulados como **BRL** (limitação do layout Status Invest).
**Reits** entram como **STOCKS** (o parser não tem categoria REIT).

## Segurança

- Não há senha em arquivo: o login é feito por você, manualmente, via Google.
- A sessão fica na pasta `perfil/` (gitignored) — é sua, não compartilhe.
- O robô só **lê** do investidor10; quem grava na sua carteira é você, ao
  importar o arquivo gerado.
