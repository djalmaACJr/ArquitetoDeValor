# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: 04_extrato.spec.ts >> Extrato (Lançamentos) >> E2E-EX06 — excluir lançamento
- Location: e2e\tests\04_extrato.spec.ts:74:3

# Error details

```
Error: expect(locator).not.toBeVisible() failed

Locator: getByText('E2E Teste Editado')
Expected: not visible
Error: strict mode violation: getByText('E2E Teste Editado') resolved to 4 elements:
    1) <p class="text-[12px] font-medium truncate">E2E Teste Editado</p> aka getByText('E2E Teste Editado').first()
    2) <p class="text-[13px] font-semibold truncate">E2E Teste Editado</p> aka getByText('E2E Teste Editado').nth(1)
    ...

Call log:
  - Expect "not toBeVisible" with timeout 10000ms
  - waiting for getByText('E2E Teste Editado')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - navigation [ref=e4]:
    - button "Recolher menu" [ref=e5] [cursor=pointer]:
      - img [ref=e6]
    - generic [ref=e8]:
      - img [ref=e10]
      - generic [ref=e42]:
        - paragraph [ref=e43]:
          - text: Arquiteto
          - text: de Valor
        - paragraph [ref=e44]: BLUEPRINT
    - generic [ref=e45]:
      - paragraph [ref=e46]: Principal
      - link "Painel principal" [ref=e47] [cursor=pointer]:
        - /url: /
        - img [ref=e48]
        - generic [ref=e53]: Painel principal
      - link "Extratos" [ref=e54] [cursor=pointer]:
        - /url: /lancamentos
        - img [ref=e55]
        - generic [ref=e62]: Extratos
    - generic [ref=e64]:
      - paragraph [ref=e65]: Cadastros
      - link "Contas" [ref=e66] [cursor=pointer]:
        - /url: /contas
        - img [ref=e67]
        - generic [ref=e70]: Contas
      - link "Categorias" [ref=e71] [cursor=pointer]:
        - /url: /categorias
        - img [ref=e72]
        - generic [ref=e75]: Categorias
    - generic [ref=e77]:
      - paragraph [ref=e78]: Ferramentas
      - link "Ferramentas" [ref=e79] [cursor=pointer]:
        - /url: /importexport
        - img [ref=e80]
        - generic [ref=e85]: Ferramentas
      - link "Relatórios" [ref=e86] [cursor=pointer]:
        - /url: /relatorios
        - img [ref=e87]
        - generic [ref=e93]: Relatórios
    - generic [ref=e95]:
      - generic [ref=e96]:
        - paragraph [ref=e97]: convidado
        - paragraph [ref=e98]: convidado@arquitetodevalor.com
      - generic [ref=e99]:
        - button "Tema escuro" [ref=e100] [cursor=pointer]:
          - img [ref=e101]
        - button "Sair" [ref=e103] [cursor=pointer]:
          - img [ref=e104]
          - generic [ref=e108]: Sair
      - 'generic "Correções/Hotfixes: Correções em edição de recorrências e rolagem automática" [ref=e110]': versão 1.0.3
  - main [ref=e111]:
    - generic [ref=e112]:
      - generic [ref=e113]:
        - heading "Lançamentos" [level=1] [ref=e114]
        - button "Novo lançamento" [ref=e115] [cursor=pointer]:
          - img [ref=e116]
          - text: Novo lançamento
      - generic [ref=e119]: Lançamento excluído.
      - generic [ref=e120]:
        - generic [ref=e122]:
          - button [ref=e123] [cursor=pointer]:
            - img [ref=e124]
          - button "Abril/2026" [ref=e126] [cursor=pointer]:
            - img [ref=e127]
            - text: Abril/2026
          - button [ref=e132] [cursor=pointer]:
            - img [ref=e133]
        - button "Todas as contas" [ref=e136] [cursor=pointer]:
          - generic [ref=e137]: Todas as contas
          - img [ref=e138]
        - button "Categorias" [ref=e141] [cursor=pointer]:
          - generic [ref=e142]: Categorias
          - img [ref=e143]
        - button "Todos status" [ref=e146] [cursor=pointer]:
          - generic [ref=e147]: Todos status
          - img [ref=e148]
        - button "Saldo anterior" [ref=e151] [cursor=pointer]:
          - generic [ref=e155]: Saldo anterior
      - generic [ref=e156]:
        - generic [ref=e157]:
          - paragraph [ref=e158]: Receitas
          - paragraph [ref=e159]: R$ 12.450,00
        - generic [ref=e160]:
          - paragraph [ref=e161]: Despesas
          - paragraph [ref=e162]: R$ 15.589,90
        - generic [ref=e163]:
          - paragraph [ref=e164]: Resultado
          - paragraph [ref=e165]: "-R$ 3.139,90"
      - paragraph [ref=e166]: Carregando...
      - dialog [ref=e167]:
        - generic [ref=e168]:
          - generic [ref=e169]:
            - paragraph [ref=e170]: Editar lançamento
            - paragraph [ref=e171]: E2E Teste Editado
          - button [ref=e172] [cursor=pointer]:
            - img [ref=e173]
        - generic [ref=e176]:
          - generic [ref=e177]:
            - paragraph [ref=e178]: Tipo
            - generic [ref=e180]:
              - button "Despesa" [ref=e181] [cursor=pointer]
              - button "Receita" [ref=e182] [cursor=pointer]
              - button "Transferência" [ref=e183] [cursor=pointer]
          - generic [ref=e184]:
            - paragraph [ref=e185]: Data *
            - textbox [ref=e186]: 2026-04-26
          - generic [ref=e187]:
            - paragraph [ref=e188]: Descrição *
            - generic [ref=e189]:
              - 'textbox "Ex: Conta de luz, Salário..." [ref=e190]': E2E Teste Editado
              - generic [ref=e191]: 17/200
          - generic [ref=e192]:
            - paragraph [ref=e193]: Valor *
            - textbox "0,00" [ref=e194]: 99,90
          - generic [ref=e195]:
            - paragraph [ref=e196]: Conta *
            - button "Banco Inter ▾" [ref=e198] [cursor=pointer]:
              - generic [ref=e199]: Banco Inter
              - generic [ref=e200]: ▾
          - generic [ref=e201]:
            - paragraph [ref=e202]: Categoria
            - button "Sem categoria ▾" [ref=e204] [cursor=pointer]:
              - generic [ref=e205]: Sem categoria
              - generic [ref=e206]: ▾
          - generic [ref=e207]:
            - paragraph [ref=e208]: Status
            - generic [ref=e209]:
              - button "Pago" [ref=e210] [cursor=pointer]
              - button "Pendente" [ref=e211] [cursor=pointer]
          - paragraph [ref=e213]: Recorrência
          - generic [ref=e214]:
            - paragraph [ref=e215]: Observação
            - textbox "Observação opcional..." [ref=e216]
        - generic [ref=e217]:
          - button "Excluir" [ref=e218] [cursor=pointer]:
            - img [ref=e219]
            - text: Excluir
          - button "Cancelar" [ref=e225] [cursor=pointer]
          - button "Atualizar" [ref=e226] [cursor=pointer]:
            - img [ref=e227]
            - text: Atualizar
```

# Test source

```ts
  1   | // e2e/tests/02_extrato.spec.ts
  2   | import { test, expect } from '@playwright/test'
  3   | 
  4   | test.describe('Extrato (Lançamentos)', () => {
  5   | 
  6   |   test.beforeEach(async ({ page }) => {
  7   |     await page.goto('/lancamentos')
  8   |   })
  9   | 
  10  |   test('E2E-EX01 — página carrega com filtros na barra superior', async ({ page }) => {
  11  |     await expect(page.getByText(/todas as contas/i)).toBeVisible()
  12  |     // Usar seletores mais específicos para evitar strict mode violation
  13  |     await expect(page.getByRole('button', { name: /categorias/i }).first()).toBeVisible()
  14  |     await expect(page.getByRole('button', { name: /todos status/i })).toBeVisible()
  15  |   })
  16  | 
  17  |   test('E2E-EX02 — navegação de mês com setas funciona', async ({ page }) => {
  18  |     const mesInicial = await page.locator('button:has-text("/2")').first().textContent()
  19  |     await page.locator('[title*="Próximo"], button:nth-child(3)').first().click()
  20  |     const mesDepois = await page.locator('button:has-text("/2")').first().textContent()
  21  |     expect(mesInicial).not.toBe(mesDepois)
  22  |   })
  23  | 
  24  |   test('E2E-EX03 — botão Novo lançamento abre drawer', async ({ page }) => {
  25  |     await page.getByRole('button', { name: /novo lançamento/i }).click()
  26  |     await expect(page.getByRole('dialog').first()).toBeVisible({ timeout: 5000 })
  27  |   })
  28  | 
  29  |   test('E2E-EX04 — criar lançamento simples e verificar na lista', async ({ page }) => {
  30  |     await page.getByRole('button', { name: /novo lançamento/i }).click()
  31  |     const drawer = page.getByRole('dialog').first()
  32  |     await expect(drawer).toBeVisible()
  33  |     await page.waitForTimeout(400) // aguarda animação do drawer
  34  | 
  35  |     // Preencher campos básicos. Tipo padrão já é DESPESA (FORM_VAZIO).
  36  |     await drawer.getByPlaceholder('Ex: Conta de luz, Salário...').fill('E2E Teste Lançamento')
  37  |     await drawer.getByPlaceholder('0,00').fill('99,90')
  38  | 
  39  |     // Selecionar conta via SearchableSelect (placeholder "Selecione a conta...")
  40  |     await drawer.getByRole('button', { name: /selecione a conta/i }).first().click()
  41  |     await drawer.getByPlaceholder('Buscar...').waitFor({ state: 'visible', timeout: 3000 })
  42  |     await page.keyboard.press('ArrowDown')
  43  |     await page.keyboard.press('Enter')
  44  | 
  45  |     // Salvar
  46  |     await drawer.getByRole('button', { name: /^salvar$/i }).click()
  47  | 
  48  |     await expect(drawer).not.toBeVisible({ timeout: 10_000 })
  49  |     await expect(page.getByText('E2E Teste Lançamento').first()).toBeVisible({ timeout: 10_000 })
  50  |   })
  51  | 
  52  |   test('E2E-EX05 — editar lançamento criado', async ({ page }) => {
  53  |     // Localizar o lançamento criado no teste anterior
  54  |     const linha = page.locator('text=E2E Teste Lançamento').first()
  55  |     await expect(linha).toBeVisible({ timeout: 10_000 })
  56  | 
  57  |     // Clicar no botão de editar
  58  |     const row = linha.locator('../..').first()
  59  |     await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()
  60  | 
  61  |     const drawer = page.getByRole('dialog').first()
  62  |     await expect(drawer).toBeVisible()
  63  | 
  64  |     // Alterar descrição
  65  |     const inputDescricao = drawer.getByPlaceholder(/conta de luz|descri|sal[áa]rio/i)
  66  |     await inputDescricao.clear()
  67  |     await inputDescricao.fill('E2E Teste Editado')
  68  | 
  69  |     await drawer.getByRole('button', { name: /salvar|atualizar/i }).click()
  70  |     await expect(drawer).not.toBeVisible({ timeout: 10_000 })
  71  |     await expect(page.getByText('E2E Teste Editado')).toBeVisible({ timeout: 10_000 })
  72  |   })
  73  | 
  74  |   test('E2E-EX06 — excluir lançamento', async ({ page }) => {
  75  |     const linha = page.locator('text=E2E Teste Editado').first()
  76  |     await expect(linha).toBeVisible({ timeout: 10_000 })
  77  | 
  78  |     const row = linha.locator('../..').first()
  79  |     await row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first().click()
  80  | 
  81  |     const drawer = page.getByRole('dialog').first()
  82  |     await expect(drawer).toBeVisible({ timeout: 5000 })
  83  | 
  84  |     await drawer.getByRole('button', { name: /excluir/i }).click()
  85  | 
  86  |     // Modal de confirmação
  87  |     const modal = page.getByRole('dialog').last()
  88  |     await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()
  89  | 
> 90  |     await expect(page.getByText('E2E Teste Editado')).not.toBeVisible({ timeout: 10_000 })
      |                                                           ^ Error: expect(locator).not.toBeVisible() failed
  91  |   })
  92  | 
  93  |   test('E2E-EX07 — toggle saldo anterior funciona', async ({ page }) => {
  94  |     const toggle = page.getByText(/saldo anterior/i)
  95  |     await expect(toggle).toBeVisible()
  96  |     await toggle.click()
  97  |     // Não deve mostrar erro
  98  |     await expect(page.locator('text=Erro')).not.toBeVisible()
  99  |   })
  100 | 
  101 |   test('E2E-EX08 — filtros persistem ao navegar entre páginas', async ({ page }) => {
  102 |     // Captura o mês exibido inicialmente no MonthPicker
  103 |     const calBtn = page.locator('button').filter({ hasText: /\/\d{4}/ }).first()
  104 |     await expect(calBtn).toBeVisible({ timeout: 8000 })
  105 |     const mes = (await calBtn.textContent())?.trim()
  106 | 
  107 |     // Navegar via SPA (não usar page.goto — resetaria o estado em memória)
  108 |     await page.getByRole('link', { name: /contas/i }).click()
  109 |     await page.waitForLoadState('domcontentloaded')
  110 |     await page.getByRole('link', { name: /lançamentos|extrato/i }).click()
  111 |     await page.waitForLoadState('domcontentloaded')
  112 | 
  113 |     const calBtnApos = page.locator('button').filter({ hasText: /\/\d{4}/ }).first()
  114 |     await expect(calBtnApos).toBeVisible({ timeout: 8000 })
  115 |     const mesAposVoltar = (await calBtnApos.textContent())?.trim()
  116 |     expect(mesAposVoltar).toBe(mes)
  117 |   })
  118 | })
  119 | 
```