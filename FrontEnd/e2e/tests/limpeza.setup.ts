// e2e/tests/limpeza.setup.ts
// Primeiro passo da suíte E2E: apaga o lixo que execuções interrompidas deixaram na conta de teste
// (mesma rotina do globalSetup do Jest — ver tests/limpezaPrevia.ts). Nunca falha a suíte.
import { test as setup } from '@playwright/test'
import { limparLixoDeExecucoesInterrompidas } from '../../../tests/limpezaPrevia'

setup('limpar lixo de execuções interrompidas', async () => {
  setup.setTimeout(300_000)
  await limparLixoDeExecucoesInterrompidas()
})
