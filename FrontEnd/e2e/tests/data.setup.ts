// e2e/tests/data.setup.ts
// Setup com limpeza completa para isolar testes entre execuções
import { test as setup } from '@playwright/test'

setup('criar dados basicos', async ({ page }) => {
  // Já está autenticado pelo auth.setup.ts
  
  console.log('🧹 Limpando dados de testes anteriores...')
  
  // 0. LIMPAR DADOS ANTERIORES para isolar testes
  try {
    // Limpar lançamentos E2E
    await page.goto('/lancamentos')
    await page.waitForLoadState('domcontentloaded')
    
    // Buscar e excluir todos os lançamentos E2E
    const lancamentosE2E = page.locator('text=E2E')
    const count = await lancamentosE2E.count()
    
    if (count > 0) {
      console.log(`�️ Limpando ${count} lançamentos E2E anteriores...`)
      for (let i = 0; i < count; i++) {
        const lancamento = lancamentosE2E.nth(i)
        const row = lancamento.locator('../..')
        const btnEditar = row.locator('button[title*="ditar"], button:has([data-lucide="pencil"])').first()
        
        if (await btnEditar.isVisible()) {
          await btnEditar.click()
          await page.waitForTimeout(500)
          
          const drawer = page.getByRole('dialog').first()
          if (await drawer.isVisible()) {
            await drawer.getByRole('button', { name: /excluir/i }).click()
            await page.waitForTimeout(500)
            
            const modal = page.getByRole('dialog').last()
            if (await modal.isVisible()) {
              await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()
              await page.waitForTimeout(1000)
            }
          }
        }
      }
    }
    
    // Limpar contas E2E
    await page.goto('/contas')
    await page.waitForLoadState('domcontentloaded')
    
    const contasE2E = page.locator('text=E2E')
    const countContas = await contasE2E.count()
    
    if (countContas > 0) {
      console.log(`🗑️ Limpando ${countContas} contas E2E anteriores...`)
      for (let i = 0; i < countContas; i++) {
        const conta = contasE2E.nth(i)
        const row = conta.locator('../..')
        const btnDesativar = row.locator('button[title*="desativar"], button:has([data-lucide="trash"])').first()
        
        if (await btnDesativar.isVisible()) {
          await btnDesativar.click()
          await page.waitForTimeout(500)
          
          const modal = page.getByRole('dialog').first()
          if (await modal.isVisible()) {
            await modal.getByRole('button', { name: /confirmar|sim/i }).click()
            await page.waitForTimeout(1000)
          }
        }
      }
    }
    
    // Limpar categorias E2E
    await page.goto('/categorias')
    await page.waitForLoadState('domcontentloaded')
    
    const categoriasE2E = page.locator('text=E2E')
    const countCats = await categoriasE2E.count()
    
    if (countCats > 0) {
      console.log(`🗑️ Limpando ${countCats} categorias E2E anteriores...`)
      for (let i = 0; i < countCats; i++) {
        const categoria = categoriasE2E.nth(i)
        const row = categoria.locator('../..')
        const btnExcluir = row.locator('button[title*="xcluir"]').first()
        
        if (await btnExcluir.isVisible()) {
          await btnExcluir.click()
          await page.waitForTimeout(500)
          
          const modal = page.getByRole('dialog').first()
          if (await modal.isVisible()) {
            await modal.getByRole('button', { name: /confirmar|sim|excluir/i }).click()
            await page.waitForTimeout(1000)
          }
        }
      }
    }
    
    console.log('✅ Limpeza de dados E2E concluída')
  } catch {
    console.log('⚠️ Erro na limpeza (pode já estar limpo)')
  }
  
  console.log('🔧 Criando dados básicos essenciais...')
  
  // 1. Criar apenas uma conta básica
  try {
    await page.goto('/contas')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000) // Esperar página carregar completamente
    
    // Tentar múltiplos seletores para encontrar o botão
    let btnNovaConta = page.getByRole('button', { name: /nova conta/i })
    if (!(await btnNovaConta.isVisible({ timeout: 2000 }))) {
      btnNovaConta = page.getByText('Nova conta')
    }
    if (!(await btnNovaConta.isVisible({ timeout: 2000 }))) {
      btnNovaConta = page.locator('button:has-text("Nova")')
    }
    
    await btnNovaConta.click({ timeout: 5000 })
    
    const drawer = page.getByRole('dialog').first()
    await drawer.waitFor({ state: 'visible', timeout: 5000 })
    
    await drawer.getByPlaceholder(/nubank|nome/i).fill('E2E Conta Corrente')
    await drawer.getByRole('button', { name: /salvar|criar/i }).click()
    
    await page.waitForTimeout(3000) // Esperar salvar
    if (await drawer.isVisible({ timeout: 3000 })) {
      await page.keyboard.press('Escape')
    }
    
    console.log('✅ Conta básica criada')
  } catch (error) {
    console.log('⚠️ Falha ao criar conta:', (error as Error).message)
  }
  
  // 2. Criar apenas uma categoria básica
  try {
    await page.goto('/categorias')
    await page.waitForLoadState('domcontentloaded')
    await page.waitForTimeout(3000) // Esperar página carregar completamente
    
    // Tentar múltiplos seletores para encontrar o botão
    let btnNovaCategoria = page.getByRole('button', { name: /nova categoria/i })
    if (!(await btnNovaCategoria.isVisible({ timeout: 2000 }))) {
      btnNovaCategoria = page.getByText('Nova categoria')
    }
    if (!(await btnNovaCategoria.isVisible({ timeout: 2000 }))) {
      btnNovaCategoria = page.locator('button:has-text("Nova")')
    }

    await btnNovaCategoria.click({ timeout: 5000 })

    const drawer = page.getByRole('dialog').first()
    await drawer.waitFor({ state: 'visible', timeout: 5000 })

    // CategoriasPage não tem select de tipo. Há também o input de busca do IconPicker,
    // por isso usamos placeholder exato.
    await drawer.getByPlaceholder('Ex: Alimentação').fill('E2E Salário')
    await drawer.getByRole('button', { name: /salvar|criar/i }).click()
    
    await page.waitForTimeout(3000) // Esperar salvar
    if (await drawer.isVisible({ timeout: 3000 })) {
      await page.keyboard.press('Escape')
    }
    
    console.log('✅ Categoria básica criada')
  } catch (error) {
    console.log('⚠️ Falha ao criar categoria:', (error as Error).message)
  }
  
  console.log('🎉 Setup com limpeza completo concluído!')
})
