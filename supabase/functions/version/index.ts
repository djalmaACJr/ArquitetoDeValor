// SISTEMA DE VERSÃO - BACKEND
// Function independente para controle de versão do sistema

// Importar versão do arquivo centralizado
import { BACKEND_VERSION, getVersionInfo } from "./version.ts"

// Headers CORS
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
}

// Handler principal
Deno.serve((req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

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
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    })
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error:`, error)
    
    return new Response(JSON.stringify({
      error: "Erro interno ao obter versão",
      message: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    })
  }
})
