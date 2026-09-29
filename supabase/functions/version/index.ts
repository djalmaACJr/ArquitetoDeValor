// SISTEMA DE VERSÃO - BACKEND
// Function independente para controle de versão do sistema

// Importar versão do arquivo centralizado
import { BACKEND_VERSION, getVersionInfo } from "./version.ts"
import { comOrigem, corsHeaders, corsPreFlight } from "../_shared/utils.ts"

// Handler principal
Deno.serve((req) => comOrigem(req, async () => {
  // CORS preflight
  if (req.method === "OPTIONS") return corsPreFlight()

  try {
    // Log da requisição
    console.log(`[${new Date().toISOString()}] ${req.method} /version`)

    // Retornar informações de versão
    const versionInfo = getVersionInfo()

    const response = {
      backend: BACKEND_VERSION,
      info: versionInfo,
      timestamp: new Date().toISOString()
    }

    console.log(`[${new Date().toISOString()}] Response:`, response)

    return new Response(JSON.stringify(response), {
      status: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json"
      }
    })

  } catch (error) {
    // Detalhe fica só no log do servidor — nunca no corpo da resposta
    // (achado de revisão de segurança, 2026-09: error.message podia expor
    // detalhe interno pro cliente de um endpoint público sem autenticação).
    console.error(`[${new Date().toISOString()}] Error:`, error)

    return new Response(JSON.stringify({
      error: "Erro interno ao obter versão",
    }), {
      status: 500,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json"
      }
    })
  }
}))
