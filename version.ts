// SISTEMA DE VERSÃO CENTRALIZADO - ÚNICO FONTE DA VERDADE
//
// FORMATO: X.Y.Z
// 1º nível (X): Novas features (ex: 1.0.0, 2.0.0)
// 2º nível (Y): Correções/Hotfixes (ex: 1.0.0, 1.1.0, 1.2.0) 
// 3º nível (Z): Tentativas (ex: 1.1.1, 1.1.2)

export const APP_VERSION = "7.2.0"

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
    date: "2026-10-16",
    description: "O dono vê o que os agregados criaram, alteraram ou excluíram nos dados dele; botão Pagar nos vencidos do Dashboard; avisos de sessão e de abas mais seguros; consultas muito mais rápidas para quem compartilha dados"
  }
})

export default APP_VERSION
