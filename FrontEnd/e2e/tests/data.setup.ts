// e2e/tests/data.setup.ts
// Setup simplificado para criar dados básicos essenciais
import { test as setup, expect } from '@playwright/test'

setup('criar dados basicos', async ({ page }) => {
  // Já está autenticado pelo auth.setup.ts
  
  console.log('🔧 Criando dados básicos essenciais...')
  
  // 1. Criar apenas uma conta básica
  try {
    await page.goto('/contas')
    await page.waitForLoadState('domcontentloaded') // mais rápido que networkidle
    
    // Verificar se já existe uma conta
    const existingAccount = page.getByText('E2E Conta Corrente')
    if (await existingAccount.isVisible()) {
      console.log('✅ Conta E2E já existe')
      return
    }
    
    await page.getByRole('button', { name: /nova conta/i }).click({ timeout: 5000 })
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible({ timeout: 5000 })
    
    await drawer.getByPlaceholder(/nubank|nome/i).fill('E2E Conta Corrente')
    await drawer.getByRole('button', { name: /salvar|criar/i }).click()
    
    // Timeout curto e tratamento simples
    await page.waitForTimeout(1000)
    if (await drawer.isVisible({ timeout: 2000 })) {
      await page.keyboard.press('Escape')
    }
    
    console.log('✅ Conta básica criada')
  } catch (error) {
    console.log('⚠️ Falha ao criar conta (pode já existir)')
  }
  
  // 2. Criar apenas uma categoria básica
  try {
    await page.goto('/categorias')
    await page.waitForLoadState('domcontentloaded')
    
    // Verificar se já existe
    const existingCategory = page.getByText('E2E Salário')
    if (await existingCategory.isVisible()) {
      console.log('✅ Categoria E2E já existe')
      return
    }
    
    await page.getByRole('button', { name: /nova categoria/i }).click({ timeout: 5000 })
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible({ timeout: 5000 })
    
    await drawer.getByPlaceholder(/nome/i).fill('E2E Salário')
    await drawer.getByRole('combobox').selectOption('RECEITA')
    await drawer.getByRole('button', { name: /salvar|criar/i }).click()
    
    await page.waitForTimeout(1000)
    if (await drawer.isVisible({ timeout: 2000 })) {
      await page.keyboard.press('Escape')
    }
    
    console.log('✅ Categoria básica criada')
  } catch (error) {
    console.log('⚠️ Falha ao criar categoria (pode já existir)')
  }
  
  console.log('🎉 Setup de dados básicos concluído!')
})
