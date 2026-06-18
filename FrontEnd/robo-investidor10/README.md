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

## Fase 2 — Geração do arquivo de importação (depois da descoberta)

> A ser implementada assim que soubermos o formato exato do JSON. Vai:
> - mapear o JSON do investidor10 para `{ ativos, operacoes }`;
> - comparar com a carteira atual do app e manter **só os ativos que faltam**;
> - gerar um arquivo para você revisar e **importar pela tela Importar/Exportar**
>   do Arquiteto de Valor (nada é gravado no banco sem sua confirmação).

## Segurança

- Não há senha em arquivo: o login é feito por você, manualmente, via Google.
- A sessão fica na pasta `perfil/` (gitignored) — é sua, não compartilhe.
- O robô só **lê** do investidor10; quem grava na sua carteira é você, ao
  importar o arquivo gerado.
