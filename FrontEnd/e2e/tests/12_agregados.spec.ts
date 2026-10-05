// e2e/tests/12_agregados.spec.ts
// Cobre a Fase 1 de "usuários agregados" (compartilhamento) testável com
// um único usuário real — convidar, ver o vínculo pendente na lista,
// revogar. O ciclo completo (aceite por um 2º usuário, seletor de espaço
// trocando de verdade entre contas) exige uma 2ª conta de teste, coberto
// pelos testes de API (tests/13_agregados.test.ts), que já têm o
// mecanismo de "User B" dinâmico — duplicar isso em E2E não agrega.
import { test, expect } from '@playwright/test'

test.describe('Compartilhamento (Agregados)', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/compartilhamento')
    await expect(page.getByRole('heading', { name: /compartilhamento/i })).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-AGR01 ───────────────────────────────────────────────
  test('E2E-AGR01 — formulário de convite e lista "Meus agregados" aparecem', async ({ page }) => {
    await expect(page.getByPlaceholder('email@exemplo.com')).toBeVisible()
    await expect(page.getByRole('button', { name: /^convidar$/i })).toBeVisible()
    await expect(page.getByRole('heading', { name: /meus agregados/i })).toBeVisible()
  })

  // ── E2E-AGR02 ───────────────────────────────────────────────
  test('E2E-AGR02 — convidar por e-mail mostra confirmação e lista o vínculo pendente', async ({ page }) => {
    const email = `e2e-agregado-${Date.now()}@example.com`

    await page.getByPlaceholder('email@exemplo.com').fill(email)
    await page.getByRole('button', { name: /^convidar$/i }).click()

    await expect(page.getByText(new RegExp(`Convite enviado para ${email}`, 'i'))).toBeVisible({ timeout: 10_000 })
    // O card do vínculo na lista é um <button> (expande ao clicar) — distinto
    // do texto de confirmação acima, que também contém o e-mail.
    await expect(page.getByRole('button', { name: email })).toBeVisible()
    await expect(page.getByText(/pendente/i).first()).toBeVisible()
  })

  // ── E2E-AGR03 ───────────────────────────────────────────────
  test('E2E-AGR03 — convidar a própria conta mostra erro', async ({ page }) => {
    // Usa o e-mail da própria sessão de teste (auth.setup.ts loga como
    // convidado@arquitetodevalor.com — ver 00_cadastro.spec.ts).
    await page.getByPlaceholder('email@exemplo.com').fill('convidado@arquitetodevalor.com')
    await page.getByRole('button', { name: /^convidar$/i }).click()

    await expect(page.getByText(/não é possível convidar a própria conta|não foi possível enviar/i)).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-AGR04 ───────────────────────────────────────────────
  test('E2E-AGR04 — expandir um vínculo mostra módulos e revogar funciona', async ({ page }) => {
    const email = `e2e-agregado-revogar-${Date.now()}@example.com`
    const cardVinculo = page.getByRole('button', { name: email })

    await page.getByPlaceholder('email@exemplo.com').fill(email)
    await page.getByRole('button', { name: /^convidar$/i }).click()
    await expect(cardVinculo).toBeVisible({ timeout: 10_000 })

    // Expande o card do vínculo recém-criado.
    await cardVinculo.click()
    await expect(page.getByText(/módulos liberados/i)).toBeVisible()
    await expect(page.getByText(/contas liberadas/i)).toBeVisible()

    await page.getByRole('button', { name: /revogar acesso/i }).click()
    // O card continua listado (histórico), mas o badge muda para "Revogado".
    await expect(page.getByText(/revogado/i).first()).toBeVisible({ timeout: 10_000 })
  })
})
