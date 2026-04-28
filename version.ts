// SISTEMA DE VERSÃO CENTRALIZADO - ÚNICO FONTE DA VERDADE
//
// FORMATO: X.Y.Z
// 1º nível (X): Novas features (ex: 1.0.0, 2.0.0)
// 2º nível (Y): Correções/Hotfixes (ex: 1.0.1, 1.0.2, 1.0.3) 
// 3º nível (Z): Tentativas (ex: 1.0.1.1, 1.0.1.2)

export const APP_VERSION = "1.9.0"

export const getVersionInfo = () => ({
  version: APP_VERSION,
  levels: {
    major: "Novas features",
    minor: "Correções/Hotfixes",
    patch: "Tentativas"
  },
  current: {
    level: "major",
    description: "Calendário de dias, relatórios com detalhamento, dashboard responsivo e melhorias no extrato"
  }
})

export default APP_VERSION
