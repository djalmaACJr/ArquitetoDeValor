// e2e/tests/limpeza.setup.ts
// Primeiro passo da suíte E2E: apaga o lixo que execuções interrompidas deixaram na conta de teste
// (mesma rotina do globalSetup do Jest — cópia de tests/limpezaPrevia.ts em e2e/limpezaPrevia.ts). Nunca falha a suíte.
import { test as setup } from '@playwright/test'
import { limparLixoDeExecucoesInterrompidas } from '../limpezaPrevia'

setup('limpar lixo de execuções interrompidas', async () => {
  setup.setTimeout(300_000)
  await limparLixoDeExecucoesInterrompidas()
})
