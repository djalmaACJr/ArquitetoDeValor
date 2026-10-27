// SISTEMA DE VERSÃO CENTRALIZADO - ÚNICO FONTE DA VERDADE
//
// FORMATO: X.Y.Z
// 1º nível (X): Novas features (ex: 1.0.0, 2.0.0)
// 2º nível (Y): Correções/Hotfixes (ex: 1.0.0, 1.1.0, 1.2.0) 
// 3º nível (Z): Tentativas (ex: 1.1.1, 1.1.2)

export const APP_VERSION = "7.3.0"

export const getVersionInfo = () => ({
  version: APP_VERSION,
  levels: {
    major: "Novas features",
    minor: "Correções/Hotfixes",
    patch: "Tentativas"
  },
  current: {
    level: "major",
    // Data de lançamento (AAAA-MM-DD) — exibida em Sobre › Versão atual.
    // Ao subir a versão, mova a data/descrição antigas para VERSOES_ANTERIORES
    // em FrontEnd/src/pages/SobrePage.tsx.
    date: "2026-10-27",
    description: "Página do ativo com Preço médio e Valor atual da cota (com data/hora e botão de atualizar), ativos abrem em nova aba e as IAs passam a responder sobre quedas e altas do dia"
  }
})

export default APP_VERSION
