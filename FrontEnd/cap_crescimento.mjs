import { firefox } from "@playwright/test"
const chromium = firefox  // use Firefox (only browser installed)

const EMAIL    = "djjunio@gmail.com"
const PASSWORD = "teste123"
const BASE_URL = "http://localhost:5173"

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })

  // Login
  await page.goto(`${BASE_URL}/login`)
  await page.fill("input[type='email']", EMAIL)
  await page.fill("input[type='password']", PASSWORD)
  await page.click("button[type='submit']")

  await page.waitForURL(/\/(dashboard|objetivos|relatorios|lancamentos|contas)/, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(2000)
  console.log("Logged in, URL:", page.url())

  // Navigate to Objetivos
  await page.goto(`${BASE_URL}/objetivos`)
  await page.waitForTimeout(3000)
  await page.screenshot({ path: "C:\\Pessoal\\ArquitetoDeValor\\cap_obj_list.png" })
  console.log("Screenshot: cap_obj_list.png")

  // Find detail links
  const detalhesLinks = page.locator("a[href*='/objetivos/']")
  const count = await detalhesLinks.count()
  console.log("Detail links count:", count)

  const hrefs = []
  for (let i = 0; i < count; i++) {
    const href = await detalhesLinks.nth(i).getAttribute("href")
    if (href && !hrefs.includes(href)) hrefs.push(href)
  }
  console.log("Unique detail hrefs:", hrefs)

  for (const href of hrefs) {
    await page.goto(`${BASE_URL}${href}`)
    await page.waitForTimeout(3000)
    const content = await page.textContent("body")
    const isCrescent = content?.includes("Arrecadação por Ano")
    console.log(`${href}: CRESCIMENTO=${isCrescent}`)
    if (isCrescent) {
      await page.screenshot({ path: "C:\\Pessoal\\ArquitetoDeValor\\cap_cresc_top.png" })
      // Scroll to chart sections
      for (let s = 0; s < 8; s++) {
        await page.evaluate((y) => window.scrollTo(0, y * 600), s + 1)
        await page.waitForTimeout(700)
        await page.screenshot({ path: `C:\\Pessoal\\ArquitetoDeValor\\cap_cresc_s${s}.png` })
      }
      break
    }
  }

  await browser.close()
  console.log("Done")
})().catch(e => { console.error(e); process.exit(1) })
