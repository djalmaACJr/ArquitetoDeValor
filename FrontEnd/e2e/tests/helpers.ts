// e2e/tests/helpers.ts
// Helpers compartilhados entre specs.
import type { Locator, Page } from '@playwright/test'

type TipoLancamento = 'Despesa' | 'Receita' | 'Transferência'

/**
 * Abre o drawer de novo lançamento.
 *
 * O componente BotaoNovoLancamento é um dropdown ativado por hover:
 * o botão "Novo lançamento" não tem onClick — apenas exibe o menu de tipos
 * (Despesa / Receita / Transferência) ao passar o mouse. O onClick está
 * em cada item do menu, que dispara o handler `abrirNovo(tipo)` da página.
 *
 * Por isso, o teste precisa fazer hover no trigger e clicar no item desejado,
 * em vez do antigo `getByRole('button', { name: /novo lançamento/i }).click()`.
 */
export async function abrirNovoLancamento(page: Page, tipo: TipoLancamento = 'Despesa') {
  const trigger = page.getByRole('button', { name: /^novo lançamento$/i })
  await trigger.hover()
  // Aguarda transição CSS do dropdown (pointer-events transita em 200ms).
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: new RegExp(`^${tipo}$`, 'i') }).first().click()
}

/**
 * Preenche o campo Valor do drawer via Calculadora popup.
 *
 * O campo Valor não é um <input> — é um <button aria-label="Valor"> que abre o
 * componente Calculadora. A Calculadora usa um container com tabIndex={0} que captura
 * keydown global do teclado para digitar dígitos/operadores. Por isso, depois de
 * abrir, basta usar `page.keyboard.press(...)` para cada caractere e clicar OK.
 *
 * IMPORTANTE: o input Descrição abre um dropdown "Sugestões do assistente" após
 * 400ms de debounce quando o input está FOCADO e tem 2+ chars. Esse dropdown
 * fica abaixo do input e pode cobrir o botão Valor — causando flakiness em CI
 * (Calculadora não abre porque o click é interceptado). Por isso, tiramos o foco
 * antes de clicar no Valor: o dropdown só abre se o input estiver focado.
 *
 * @param valor formato BR (ex: '99,90', '7500', '12,5'). Aceita ',' ou '.'.
 */
export async function preencherValor(page: Page, drawer: Locator, valor: string) {
  // Tira o foco de qualquer input — fecha o dropdown de Sugestões do Assistente
  // que poderia estar interceptando o click no botão Valor.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.waitForTimeout(150)

  await drawer.getByRole('button', { name: 'Valor' }).click()
  // Aguarda a Calculadora montar e ficar visível antes de digitar (timeout
  // generoso pra tolerar CI lento).
  await drawer.getByRole('button', { name: /^OK$/ }).waitFor({ state: 'visible', timeout: 10_000 })

  for (const ch of valor) {
    if (ch >= '0' && ch <= '9') {
      await page.keyboard.press(`Digit${ch}`)
    } else if (ch === ',' || ch === '.') {
      await page.keyboard.press('Comma')
    }
  }

  await drawer.getByRole('button', { name: /^OK$/ }).click()
  await page.waitForTimeout(200)
}

/**
 * Localiza a linha de um lançamento pelo texto e clica no botão Editar,
 * devolvendo o Locator do drawer já visível.
 *
 * Endurecido contra um flake observado em E2E-EX10: o clique no botão Editar
 * às vezes acontecia bem no meio de um re-render/replaceState de rota ainda
 * em andamento na página (o beforeEach já espera `networkidle`, mas um
 * re-render de React pode continuar depois disso) — o `.click()` do
 * Playwright não lançava erro, mas o handler `abrirEditar` se perdia e o
 * drawer nunca abria. Em vez de falhar direto, tenta clicar de novo uma
 * vez antes de exigir o drawer visível.
 */
export async function abrirEdicaoLancamento(page: Page, textoLinha: string): Promise<Locator> {
  const linha = page.getByText(textoLinha).first()
  await linha.waitFor({ state: 'visible', timeout: 10_000 })
  // Deixa a lista assentar antes de interagir (evita clicar em cima de um
  // re-render ainda em andamento logo após a linha aparecer).
  await page.waitForTimeout(300)

  const row = linha.locator('../..').first()
  const botaoEditar = row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first()
  await botaoEditar.click()

  const drawer = page.getByRole('dialog').first()
  if (!(await drawer.isVisible({ timeout: 3000 }).catch(() => false))) {
    await botaoEditar.click({ force: true })
  }
  await drawer.waitFor({ state: 'visible', timeout: 5000 })
  return drawer
}
