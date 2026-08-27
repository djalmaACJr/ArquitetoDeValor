// ============================================================
// Arquiteto de Valor — Edge Function: investimentos v1
// ============================================================
// Roteia por recurso sob /investimentos/<recurso>:
//   ativos | alocacoes | posicoes | operacoes | dividendos | dashboard
// Mantém o padrão do projeto: uma função por diretório top-level,
// roteamento interno por método/rota, RLS por user_id = auth.uid().
//
// Este arquivo é só o roteador — a lógica de negócio foi extraída (auditoria
// 2026-08-04, achado "monólito de 6.446 linhas sem separação em módulos")
// para os arquivos irmãos abaixo, agrupados por domínio:
//   shared.ts            — tipos/constantes/helpers de data compartilhados
//   ativos.ts             — /ativos, /alocacoes
//   avaliacoes.ts         — /questionarios, /avaliacoes (mentores IA)
//   posicoes.ts           — /posicoes, /operacoes
//   mercado.ts            — cotações externas, PTAX, índices, Tesouro Direto,
//                           cálculo de renda fixa (maior módulo; import
//                           circular intencional com snapshot.ts — ver nota lá)
//   dividendos.ts          — CRUD de dividendos + crons USD (Polygon)/BRL (B3)
//   snapshot.ts            — snapshot mensal, histórico, backfill
//   rendimento-cripto.ts   — yield de cripto (rota manual + cron)
//   import-export.ts       — migrar-conta, atualizar-ativos, importar, restaurar
//   dashboard.ts            — /dashboard, /ranking
//   indicadores.ts          — /indicadores (watchlist de ETF/ETF internacional
//                             usada como benchmark na página Gerenciar dados)
// ============================================================
import "@supabase/functions-js/edge-runtime.d.ts";
import { erro, db, autenticar, corsPreFlight, executarComLogDeCron } from "../_shared/utils.ts";
import { registrarOrigem } from "../_shared/utils.ts";
import { logError } from "../_shared/logger.ts";

import { rotaAtivos, rotaAlocacoes } from "./ativos.ts";
import { rotaQuestionarios, rotaAvaliacoes } from "./avaliacoes.ts";
import { rotaPosicoes, rotaOperacoes } from "./posicoes.ts";
import { rotaPtax, sincronizarPtaxResposta, rotaIndices, sincronizarIndicesResposta, rotaTesouro, sincronizarTesouroResposta, buscaExterna } from "./mercado.ts";
import {
  rotaDividendos, rotaDividendosBuscarBr, rotaDividendosBuscarUsd,
  rotaDividendosBackfillRate, rotaDividendosDiagnostico, rotaAssociarExtratoMassa,
  rotaTiposDividendo, rotaDividendosCron, rotaDividendosCronBr,
  rotaCupomTesouroCron, rotaCupomTesouroBuscar,
} from "./dividendos.ts";
import { rotaHistorico, rotaSnapshotAuto, rotaSnapshotBackfill, rotaSnapshotCron } from "./snapshot.ts";
import { rotaRendimentoCripto, rotaRendimentoCriptoCron } from "./rendimento-cripto.ts";
import { rotaFatosRelevantesCron } from "./fatosRelevantes.ts";
import {
  rotaMigrarConta, rotaImportar, rotaAtualizarAtivos, rotaNormalizarTesouro, rotaRestaurar,
} from "./import-export.ts";
import { dashboard, ranking } from "./dashboard.ts";
import { rotaCronExecucoes } from "./admin.ts";
import { rotaIndicadores } from "./indicadores.ts";

Deno.serve(async (req: Request) => {
  registrarOrigem(req);
  if (req.method === "OPTIONS") return corsPreFlight();

  const url     = new URL(req.url);
  const partes  = url.pathname.split("/").filter(Boolean);
  const idxBase = partes.indexOf("investimentos");
  const recurso = idxBase >= 0 ? (partes[idxBase + 1] ?? "") : "";
  const m       = req.method;

  // Job do servidor: autentica por secret (header x-cron-secret), sem JWT
  // de usuário. Tratado ANTES de autenticar() por isso.
  //
  // Todos os 5 crons abaixo passam por executarComLogDeCron(), que grava
  // sucesso/erro + duração em arqvalor.cron_execucoes (tela /admin/crons).
  // Nasceu da auditoria 2026-08-06: dividendos-diario ficou 19 dias
  // falhando sem NENHUM sinal visível — ver comentário na migration
  // 20260806000002_cron_execucoes.sql.
  if (recurso === "snapshot-cron") {
    try { return await executarComLogDeCron("snapshot-diario", () => rotaSnapshotCron(req, m)); }
    catch (e) { logError("Handler snapshot-cron", e); return erro("Erro interno", 500); }
  }

  // Job do servidor: provisiona proventos de ativos em USD (Polygon.io).
  // Também sem JWT — protegido pelo x-cron-secret.
  if (recurso === "dividendos-cron") {
    try { return await executarComLogDeCron("dividendos-diario", () => rotaDividendosCron(req, m)); }
    catch (e) { logError("Handler dividendos-cron", e); return erro("Erro interno", 500); }
  }

  // Job do servidor: provisiona proventos de ativos em BRL (ACOES/ETF/FII)
  // a partir dos dados públicos da B3. Sem JWT — protegido pelo x-cron-secret.
  if (recurso === "dividendos-cron-br") {
    try { return await executarComLogDeCron("dividendos-br-diario", () => rotaDividendosCronBr(req, m)); }
    catch (e) { logError("Handler dividendos-cron-br", e); return erro("Erro interno", 500); }
  }

  // Job do servidor: materializa o rendimento (yield) das criptos como
  // operações RENDIMENTO p/ todos os usuários. Sem JWT — x-cron-secret.
  if (recurso === "rendimento-cripto-cron") {
    try { return await executarComLogDeCron("rendimento-cripto-diario", () => rotaRendimentoCriptoCron(req, m)); }
    catch (e) { logError("Handler rendimento-cripto-cron", e); return erro("Erro interno", 500); }
  }

  // Job do servidor: provisiona pagamento de cupom semestral do Tesouro
  // Direto (Tesouro Transparente/STN). Sem JWT — x-cron-secret. Só futuro
  // (sem janela retroativa) — ver comentário em provisionarCupomTesouro.
  if (recurso === "cupom-tesouro-cron") {
    try { return await executarComLogDeCron("cupom-tesouro-diario", () => rotaCupomTesouroCron(req, m)); }
    catch (e) { logError("Handler cupom-tesouro-cron", e); return erro("Erro interno", 500); }
  }

  // Job do servidor: cacheia Fatos Relevantes/Comunicados de FIIs
  // (Fundos.NET/B3) usados como contexto factual na avaliação por
  // mentores de IA. Sem JWT — x-cron-secret. Ver fatosRelevantes.ts.
  if (recurso === "fatos-relevantes-cron") {
    try { return await executarComLogDeCron("fatos-relevantes-diario", () => rotaFatosRelevantesCron(req, m)); }
    catch (e) { logError("Handler fatos-relevantes-cron", e); return erro("Erro interno", 500); }
  }

  const auth = await autenticar(req);
  if (auth instanceof Response) return auth;
  const userId = auth;
  const c       = db(req);

  try {
    switch (recurso) {
      case "ativos":          return await rotaAtivos(c, req, m, userId);
      case "alocacoes":       return await rotaAlocacoes(c, req, m, userId);
      case "questionarios":   return await rotaQuestionarios(c, req, m, userId);
      case "avaliacoes":      return await rotaAvaliacoes(c, req, m, userId);
      case "posicoes":        return await rotaPosicoes(c, req, m, userId);
      case "operacoes":       return await rotaOperacoes(c, req, m, userId);
      case "dividendos":      return await rotaDividendos(c, req, m, userId);
      case "dividendos-buscar-br": return await rotaDividendosBuscarBr(c, req, m, userId);
      case "dividendos-buscar-usd": return await rotaDividendosBuscarUsd(c, req, m, userId);
      case "cupom-tesouro-buscar": return await rotaCupomTesouroBuscar(c, req, m, userId);
      case "dividendos-backfill-rate": return await rotaDividendosBackfillRate(c, m, userId);
      case "dividendos-diagnostico": return await rotaDividendosDiagnostico(c, m, userId);
      case "migrar-conta":    return await rotaMigrarConta(c, req, m, userId);
      case "associar-extrato-massa": return await rotaAssociarExtratoMassa(c, m, userId);
      case "rendimento-cripto": return await rotaRendimentoCripto(c, m, userId);
      case "tipos-dividendo": return await rotaTiposDividendo(c, req, m, userId);
      case "historico-mensal": return await rotaHistorico(c, req, m, userId);
      case "snapshot-auto":   return await rotaSnapshotAuto(c, req, m, userId);
      case "snapshot-backfill": return await rotaSnapshotBackfill(c, req, m, userId);
      case "importar":        return await rotaImportar(c, req, m, userId);
      case "atualizar-ativos": return await rotaAtualizarAtivos(c, req, m, userId);
      case "normalizar-tesouro": return await rotaNormalizarTesouro(c, req, m, userId);
      case "restaurar":       return await rotaRestaurar(c, req, m, userId);
      case "dashboard":       return m === "GET" ? await dashboard(c, url.searchParams) : erro("Método não permitido", 405);
      case "ranking":         return m === "GET" ? await ranking(c, url.searchParams) : erro("Método não permitido", 405);
      case "busca-externa":   return m === "GET" ? await buscaExterna(url.searchParams) : erro("Método não permitido", 405);
      case "cron-execucoes":  return await rotaCronExecucoes(c, m, userId);
      case "indicadores":     return await rotaIndicadores(c, req, m, userId);
      case "ptax":
        if (m === "GET")  return await rotaPtax(c, url.searchParams);
        if (m === "POST") return await sincronizarPtaxResposta(c);
        return erro("Método não permitido", 405);
      case "indices":
        if (m === "GET")  return await rotaIndices(c, url.searchParams);
        if (m === "POST") return await sincronizarIndicesResposta(c);
        return erro("Método não permitido", 405);
      case "tesouro":
        if (m === "GET")  return await rotaTesouro(c, url.searchParams);
        if (m === "POST") return await sincronizarTesouroResposta();
        return erro("Método não permitido", 405);
      default:                return erro("Rota não encontrada", 404);
    }
  } catch (e) {
    logError("Handler investimentos", e);
    return erro("Erro interno", 500);
  }
});
