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
    // Avisos de login (ex.: "Convite aceito" de um vínculo real recente) ficam fixos por cima da
    // página e interceptam toques no celular — dispensa antes de interagir.
    // Espera a lista carregar: os avisos dependem dos mesmos vínculos e só aparecem depois.
    await expect(page.getByRole('heading', { name: /meus agregados \(\d+\)/i })).toBeVisible({ timeout: 10_000 })
    for (const nome of ['Convite aceito', 'Agregado saiu']) {
      const aviso = page.getByText(nome, { exact: true })
      if (await aviso.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await page.getByRole('button', { name: 'Fechar' }).first().click()
      }
    }
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

    // O card do convite recém-enviado já abre sozinho nas permissões.
    await expect(page.getByText(/ao aceitar o convite ele não verá nada/i)).toBeVisible()
    await expect(page.getByText(/módulos liberados/i)).toBeVisible()
    await expect(page.getByText(/contas liberadas/i)).toBeVisible()

    await page.getByRole('button', { name: /revogar acesso/i }).click()
    // O card continua listado (histórico), mas o badge muda para "Revogado".
    await expect(page.getByText(/revogado/i).first()).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-AGR05 ───────────────────────────────────────────────
  // Regressão: o card tinha overflow-hidden e cortava o dropdown de contas —
  // era impossível liberar conta pela UI (o click falha se algo cobrir o alvo).
  test('E2E-AGR05 — "Contas liberadas": dropdown abre inteiro e "Adicionar todos" libera as contas', async ({ page }) => {
    const email = `e2e-agregado-contas-${Date.now()}@example.com`
    await page.getByPlaceholder('email@exemplo.com').fill(email)
    await page.getByRole('button', { name: /^convidar$/i }).click()
    // (card já aberto — convite recém-enviado)
    await page.getByRole('button', { name: /nenhuma conta liberada ainda/i }).click()
    const todos = page.getByRole('button', { name: /adicionar todos/i })
    await todos.click()   // falha se o dropdown estiver cortado pelo card

    // Após "Adicionar todos", o trigger deixa de mostrar o placeholder
    await expect(page.getByRole('button', { name: /limpar todos/i })).toBeVisible({ timeout: 10_000 })
  })

  // ── E2E-AGR06 ───────────────────────────────────────────────
  test('E2E-AGR06 — agregados agrupados por status em quadros recolhíveis, com contador e datas', async ({ page }) => {
    const email = `e2e-agregado-grupo-${Date.now()}@example.com`
    await page.getByPlaceholder('email@exemplo.com').fill(email)
    await page.getByRole('button', { name: /^convidar$/i }).click()
    const card = page.getByRole('button', { name: email })
    await expect(card).toBeVisible({ timeout: 10_000 })

    // Contador no título + datas de convite/aceite/revogação no card
    await expect(page.getByRole('heading', { name: /meus agregados \(\d+\)/i })).toBeVisible()
    await expect(card).toContainText(/Convite \d{2}\/\d{2}\/\d{4}/)
    await expect(card).toContainText(/Aceite —/)

    // Quadro "Aguardando aceite" abre por padrão e pode ser recolhido
    const quadro = page.getByRole('button', { name: /aguardando aceite/i })
    await expect(quadro).toHaveAttribute('aria-expanded', 'true')
    await quadro.click()
    await expect(quadro).toHaveAttribute('aria-expanded', 'false')
    await expect(card).not.toBeVisible()
    await quadro.click()
    await expect(card).toBeVisible()

    // Revogado vai pro quadro "Revogados" (recolhido por padrão) com data de revogação
    await page.getByRole('button', { name: /revogar acesso/i }).click()
    const revogados = page.getByRole('button', { name: /^revogados/i })
    await expect(revogados).toBeVisible({ timeout: 10_000 })
    await expect(revogados).toHaveAttribute('aria-expanded', 'false')
    await revogados.click()
    await expect(page.getByRole('button', { name: email })).toContainText(/Revogação \d{2}\/\d{2}\/\d{4}/)
  })

  // ── E2E-AGR07 ───────────────────────────────────────────────
  // "Convidar um agregado" fica ao lado de "Convidar amigos" no Perfil (lado a lado no
  // desktop, empilhado no celular) e convida do mesmo jeito que em Compartilhamento.
  test('E2E-AGR07 — Perfil: "Convidar um agregado" ao lado de "Convidar amigos" e convida de lá', async ({ page }) => {
    await page.goto('/perfil')
    const amigos = page.getByRole('heading', { name: 'Convidar amigos' })
    const agregado = page.getByRole('heading', { name: 'Convidar um agregado' })
    await expect(amigos).toBeVisible({ timeout: 10_000 })
    await expect(agregado).toBeVisible()

    const a = (await amigos.boundingBox())!
    const g = (await agregado.boundingBox())!
    if (page.viewportSize()!.width >= 1024) {
      expect(Math.abs(a.y - g.y)).toBeLessThan(8)   // mesma linha
      expect(g.x).toBeGreaterThan(a.x)              // agregado à direita
    } else {
      expect(g.y).toBeGreaterThan(a.y)              // celular: empilhado
    }

    const email = `e2e-agregado-perfil-${Date.now()}@example.com`
    await page.getByPlaceholder('email@exemplo.com').fill(email)
    await page.getByRole('button', { name: /^convidar$/i }).click()
    await expect(page.getByText(new RegExp(`Convite enviado para ${email}`, 'i'))).toBeVisible({ timeout: 10_000 })
    await expect(page.getByRole('link', { name: /definir permissões/i })).toBeVisible()
  })
})
