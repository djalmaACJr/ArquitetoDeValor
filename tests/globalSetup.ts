// tests/globalSetup.ts — roda UMA vez antes de todas as suítes Jest (ver jest.config.js).
import { limparLixoDeExecucoesInterrompidas } from "./limpezaPrevia";

export default async function globalSetup() {
  await limparLixoDeExecucoesInterrompidas();
}
