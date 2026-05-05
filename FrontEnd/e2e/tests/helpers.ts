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
 * @param valor formato BR (ex: '99,90', '7500', '12,5'). Aceita ',' ou '.'.
 */
export async function preencherValor(page: Page, drawer: Locator, valor: string) {
  await drawer.getByRole('button', { name: 'Valor' }).click()
  await page.waitForTimeout(200) // aguarda Calculadora montar e capturar foco

  for (const ch of valor) {
    if (ch >= '0' && ch <= '9') {
      await page.keyboard.press(`Digit${ch}`)
    } else if (ch === ',' || ch === '.') {
      await page.keyboard.press('Comma')
    }
  }

  await drawer.getByRole('button', { name: /^OK$/ }).click()
  await page.waitForTimeout(150)
}
