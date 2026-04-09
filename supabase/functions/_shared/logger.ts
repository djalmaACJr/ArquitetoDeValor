// ============================================================
// Arquiteto de Valor — Logger Configurável
// ============================================================

// 🔧 Níveis de log
export enum LogLevel {
  NONE = 0,      // Sem logs
  ERROR = 1,     // Apenas erros
  WARN = 2,      // Erros + avisos
  INFO = 3,      // Informações importantes
  DEBUG = 4,     // Tudo (desenvolvimento)
}

// 🔧 Configuração via variável de ambiente
const getLogLevel = (): LogLevel => {
  const env = Deno.env.get("ENVIRONMENT") || "production";
  const logLevel = Deno.env.get("LOG_LEVEL");
  
  // Se for produção e não especificou LOG_LEVEL, só erros
  if (env === "production" && !logLevel) {
    return LogLevel.ERROR;
  }
  
  // Mapeamento string -> enum
  const levelMap: Record<string, LogLevel> = {
    "none": LogLevel.NONE,
    "error": LogLevel.ERROR,
    "warn": LogLevel.WARN,
    "info": LogLevel.INFO,
    "debug": LogLevel.DEBUG,
  };
  
  return levelMap[logLevel?.toLowerCase() || "info"] ?? LogLevel.INFO;
};

// Nível atual (calculado uma vez)
const CURRENT_LOG_LEVEL = getLogLevel();

// Helper para verificar se deve logar
function shouldLog(level: LogLevel): boolean {
  return CURRENT_LOG_LEVEL >= level;
}

/**
 * Log de erro (sempre ativo, mesmo em produção)
 */
export function logError(step: string, error: unknown): void {
  if (!shouldLog(LogLevel.ERROR)) return;
  
  console.error(`\n🔥 [${new Date().toISOString()}] ERRO em ${step}:`);
  console.error(error);
}

/**
 * Log de aviso
 */
export function logWarn(step: string, message: string, data?: unknown): void {
  if (!shouldLog(LogLevel.WARN)) return;
  
  console.warn(`\n⚠️ [${new Date().toISOString()}] ${step}: ${message}`);
  if (data) console.warn(data);
}

/**
 * Log de informação (importante, ativo em produção por padrão)
 */
export function logInfo(step: string, data?: unknown): void {
  if (!shouldLog(LogLevel.INFO)) return;
  
  console.log(`\nℹ️ [${new Date().toISOString()}] ${step}`);
  if (data) console.log(data);
}

/**
 * Log de debug (apenas desenvolvimento/testes)
 */
export function logDebug(step: string, data?: unknown): void {
  if (!shouldLog(LogLevel.DEBUG)) return;
  
  console.log(`\n🐛 [DEBUG] ${step}`);
  if (data) console.log(JSON.stringify(data, null, 2));
}

/**
 * Log de requisição (apenas debug)
 */
export function logRequest(method: string, endpoint: string, payload?: unknown): void {
  if (!shouldLog(LogLevel.DEBUG)) return;
  
  console.log(`\n${"═".repeat(80)}`);
  console.log(`📤 ${method} ${endpoint}`);
  if (payload) {
    console.log("Payload:", JSON.stringify(payload, null, 2));
  }
}

/**
 * Log de resposta (apenas debug)
 */
export function logResponse(status: number, data?: unknown): void {
  if (!shouldLog(LogLevel.DEBUG)) return;
  
  const emoji = status >= 200 && status < 300 ? "✅" : "❌";
  console.log(`${emoji} Resposta: ${status}`);
  if (data && status >= 400) {
    console.log("Erro:", JSON.stringify(data, null, 2));
  }
  console.log(`${"═".repeat(80)}\n`);
}

/**
 * Log de sucesso (info)
 */
export function logSuccess(step: string, details?: unknown): void {
  if (!shouldLog(LogLevel.INFO)) return;
  
  console.log(`✨ ${step}`);
  if (details && shouldLog(LogLevel.DEBUG)) {
    console.log(details);
  }
}