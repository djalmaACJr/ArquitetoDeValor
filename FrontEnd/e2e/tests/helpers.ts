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
 * Expande a barra de filtros do Extrato (Conta/Categoria/Status/Saldo
 * anterior) — desde a v6.1.0 ela vem RECOLHIDA por padrão (botão "Filtros"
 * na barra superior), então qualquer teste que precise desses controles tem
 * que abri-la primeiro. Idempotente: se já estiver aberta, não faz nada.
 */
export async function expandirFiltros(page: Page) {
  const btn = page.getByRole('button', { name: /^filtros$/i })
  if ((await btn.getAttribute('aria-expanded')) !== 'true') await btn.click()
}

/**
 * Preenche o campo Valor do drawer via Calculadora popup.
 *
 * O campo Valor não é um <input> — é um <button aria-label="Valor"> que abre o
 * componente Calculadora. A Calculadora usa um container com tabIndex={0} que captura
 * keydown global do teclado para digitar dígitos/operadores. Por isso, depois de
 * abrir, basta usar `page.keyboard.press(...)` para cada caractere e clicar OK.
 *
 * IMPORTANTE (achado real em CI): ao abrir um lançamento NOVO, o campo Data
 * ganha foco automático e o calendário abre sozinho ~320ms depois (ver
 * DrawerLancamento.tsx — UX pra ajustar a data antes do resto). Um usuário de
 * verdade fecha isso sem perceber ao clicar em qualquer outro campo (o
 * calendário escuta `mousedown` fora de si pra se fechar) — mas `.fill()` do
 * Playwright não dispara esse `mousedown` (foca e seta o valor direto), então
 * o calendário ficava aberto, flutuando sobre os campos abaixo dele no
 * formulário (Valor incluso) e interceptando o clique nele — o teste travava
 * 30s tentando clicar em "Valor" sem nunca conseguir. Um clique de verdade no
 * título do drawer (área neutra, sem handler) fecha o calendário do mesmo
 * jeito que fecharia pra um usuário real.
 *
 * IMPORTANTE 2: o input Descrição também abre um dropdown "Sugestões do
 * assistente" após 400ms de debounce quando está FOCADO e tem 2+ chars. Esse
 * dropdown fica abaixo do input e pode cobrir o botão Valor. Por isso, tiramos
 * o foco antes de clicar no Valor: o dropdown só abre se o input tiver foco.
 *
 * @param valor formato BR (ex: '99,90', '7500', '12,5'). Aceita ',' ou '.'.
 */
export async function preencherValor(page: Page, drawer: Locator, valor: string) {
  // Fecha o calendário de Data, se ele tiver ficado aberto (ver comentário
  // acima) — clique real, fora de qualquer campo, sem efeito colateral.
  await drawer.getByText(/^(novo|editar) lançamento$/i).click()

  // Tira o foco de qualquer input — fecha o dropdown de Sugestões do Assistente
  // que poderia estar interceptando o click no botão Valor.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
  await page.waitForTimeout(150)

  // Só clica em "Valor" se a Calculadora ainda não estiver aberta (idempotente
  // — evita reabrir/fechar à toa se já estava aberta por algum outro motivo).
  const btnOk = drawer.getByRole('button', { name: /^OK$/ })
  if (!(await btnOk.isVisible().catch(() => false))) {
    await drawer.getByRole('button', { name: 'Valor' }).click()
  }
  // Aguarda a Calculadora montar e ficar visível antes de digitar (timeout
  // generoso pra tolerar CI lento).
  await btnOk.waitFor({ state: 'visible', timeout: 10_000 })

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
/**
 * Seleciona uma opção num <SelectDark> — desde a migração pra
 * @radix-ui/react-select (ver shared.tsx, corrige texto ilegível em opção
 * sob hover no <select> nativo do Windows), o componente não é mais um
 * <select> real, então `.selectOption()` do Playwright não funciona nele
 * (erro "Element is not a <select> element"). Em vez disso: clica no
 * trigger (que continua com `role="combobox"`, então locators existentes
 * como `getByRole('combobox')` não mudam) e clica na opção.
 *
 * As opções (`role="option"`) são renderizadas num Portal do Radix — fora
 * da árvore do drawer/trigger — por isso a busca é sempre a partir de
 * `page`, nunca escopada ao drawer. Aceita o texto visível da opção (não o
 * value do enum, que deixou de existir no DOM) ou um índice posicional.
 *
 * IMPORTANTE ao construir o `trigger`: `role="combobox"` NÃO deriva o nome
 * acessível do conteúdo (ao contrário de `role="option"`, usado acima, que
 * deriva) — `getByRole('combobox', { name: /texto do valor atual/ })` NÃO
 * encontra nada mesmo com o texto visível ali (achado real, ver E2E-INV03).
 * Para localizar um trigger pelo texto que ele mostra, use
 * `.filter({ hasText })` (compara texto bruto) em vez de `{ name }`.
 */
export async function selecionarDropdown(page: Page, trigger: Locator, opcao: string | { index: number }) {
  await trigger.click()
  const item = typeof opcao === 'string'
    ? page.getByRole('option', { name: opcao, exact: true })
    : page.getByRole('option').nth(opcao.index)
  await item.click()
}

export async function abrirEdicaoLancamento(page: Page, textoLinha: string): Promise<Locator> {
  // Achado real (ago/2026, investigando flake em E2E-EX10/11/12): raramente
  // (~1 em 6 tentativas, mesmo num ambiente limpo) o drawer abre renderizado
  // por completo (confirmado via log — chega a mostrar "Parcela 1 de 3"
  // certinho) e then desaparece do DOM inteiro ~0-200ms depois, sem erro de
  // JS, sem navegação de página e sem troca de URL (descartado via
  // page.on('framenavigated')/page.on('load') e page.url() num teste de
  // diagnóstico dedicado). Mecanismo exato não identificado — parece
  // resource-contention/timing do browser sob carga, não um bug do app.
  // Por isso o retry abaixo: se o dialog não estiver visível/estável depois
  // da primeira tentativa, tenta de novo do zero antes de desistir.
  for (let tentativa = 0; tentativa < 2; tentativa++) {
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
    const abriu = await drawer.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false)
    if (!abriu) continue

    // Confirma que o conteúdo do drawer ainda está lá um instante depois —
    // é exatamente essa janela (logo após abrir) onde o desaparecimento
    // espúrio acontece.
    await page.waitForTimeout(250)
    if (await drawer.isVisible().catch(() => false)) return drawer
  }
  // Última tentativa "normal" (deixa o erro original e descritivo estourar
  // pro teste, em vez de mascarar com uma mensagem de retry esgotado).
  const drawer = page.getByRole('dialog').first()
  await drawer.waitFor({ state: 'visible', timeout: 5000 })
  return drawer
}
