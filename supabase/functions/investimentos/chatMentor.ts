// supabase/functions/investimentos/chatMentor.ts
//
// Chat livre com o CONSELHO de mentores de IA (usuarios.ia_configs) sobre
// ativos específicos — SEM as restrições de persona do chat_mascote (que
// proibia recomendação de ativo nomeado até essas serem relaxadas, ver
// LIMITES em chat_mascote/index.ts). Uma conversa 1:1 com um único mentor
// já é coberta pelo ícone do mascote em qualquer tela (chat_mascote); esta
// rota é só o modo "Conselho": todos os mentores configurados respondem em
// paralelo e a config ativa do usuário sintetiza um consenso.
//
// POST /investimentos/chat-mentor — SEM persistência (mesmo padrão do
// chat_mascote em modo `configId`: histórico fica só no cliente, reenviado
// a cada chamada).
import { json, erro } from "../_shared/utils.ts";
import { logError, logRequest } from "../_shared/logger.ts";
import { chamarProvedorIA, ErroIA, lerConfigIAAtiva, lerMentoresIA, MentorIA } from "../_shared/ia.ts";
import { Db } from "./shared.ts";
import { buscarFatosRelevantesParaAtivo, descreverFatosRelevantes } from "./fatosRelevantes.ts";

// Persona única do mentor de ativos — deliberadamente SEM a restrição
// "não recomenda ativo específico" das personas do chat_mascote. Aqui é
// exatamente o oposto do que o usuário pede: discutir o ativo nomeado.
const PERSONA_MENTOR_ATIVOS =
  "Você é um mentor de investimentos experiente, especializado em analisar ativos específicos " +
  "(ações, FIIs, ETFs, renda fixa, cripto, stocks) que o usuário nomear na conversa — inclusive " +
  "por ticker (ex.: RBRY11, PETR4, KNRI11). Ao contrário de um assistente financeiro genérico, " +
  "aqui você PODE e DEVE opinar sobre o ativo citado: pondere fundamentos, geração de renda/" +
  "dividendos, valuation (caro/barato pelo histórico), riscos concretos e o momento atual do setor. " +
  "Priorize Fatos Relevantes/Comunicados fornecidos abaixo (quando houver) e resultados de busca na " +
  "web (quando disponível) sobre seu conhecimento de treinamento, que pode estar desatualizado. Se " +
  "vier um snapshot da carteira do usuário (ou de parte dela), use-o para falar de concentração, " +
  "diversificação e encaixe do ativo discutido dentro do que ele já tem — não ignore esse contexto. " +
  "Seja direto e específico — evite generalidades vagas. Feche com uma ressalva curta e natural " +
  "(não repita sempre a mesma frase) lembrando que é uma análise, não uma recomendação formal, e a " +
  "decisão final é do usuário. Responda em português do Brasil, em texto corrido (sem markdown " +
  "pesado), em 3 a 8 frases salvo se o usuário pedir mais detalhe.";

const PERSONA_PRESIDENTE_CONSELHO =
  "Você é o presidente de um conselho de mentores de investimento. Cada mentor abaixo respondeu, " +
  "de forma independente, à mesma pergunta do usuário sobre um ativo. Sua tarefa é sintetizar um " +
  "CONSENSO: aponte em que os mentores convergem, destaque divergências relevantes (e a razão " +
  "provável delas — ex.: um usou dado mais recente via busca na web), e feche com uma conclusão " +
  "equilibrada. NÃO invente opinião que nenhum mentor deu. Se os mentores discordarem fortemente, " +
  "diga isso claramente em vez de forçar um meio-termo artificial. Responda em português do Brasil, " +
  "texto corrido, 4 a 10 frases.";

interface HistItem { role: "user" | "assistant"; content: string }

// Detecta um ticker de FII na mensagem (4 letras + "11", ex. RBRY11,
// KNRI11) — heurística simples, best-effort, só para tentar enriquecer com
// Fatos Relevantes (fonte é FII-only). Não bloqueia nada se não achar.
function detectarTickerFii(mensagem: string): string | null {
  const m = mensagem.match(/\b([A-Za-z]{4}11)\b/);
  return m ? m[1].toUpperCase() : null;
}

// Bloco de contexto factual opcional (Fatos Relevantes), igual ao já usado
// em avaliarUmMentor (avaliacoes.ts) — nunca lança, falha vira "sem bloco".
async function contextoFatosRelevantes(c: Db, mensagem: string): Promise<string> {
  const ticker = detectarTickerFii(mensagem);
  if (!ticker) return "";
  try {
    const fatos = await buscarFatosRelevantesParaAtivo(c, ticker, null);
    return descreverFatosRelevantes(fatos);
  } catch (e) {
    logError("Buscar fatos relevantes p/ chat mentor", e);
    return "";
  }
}

// Monta as mensagens finais (histórico + pergunta atual, com os blocos de
// contexto injetados antes da pergunta, no mesmo padrão de chat_mascote).
// `blocos` pode incluir a carteira/extrato anexados pelo usuário (frontend)
// e os Fatos Relevantes detectados automaticamente — blocos vazios são
// ignorados.
function montarMensagens(
  historico: HistItem[], mensagem: string, blocos: string[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const contexto = blocos.filter(Boolean).join("\n\n---\n\n");
  const mensagemFinal = contexto ? `${contexto}\n\n---\nPergunta do usuário:\n${mensagem}` : mensagem;
  return [...historico, { role: "user" as const, content: mensagemFinal }];
}

// Um mentor responde 1 mensagem. Nunca lança — devolve `erro` preenchido
// em caso de falha (não derruba o conselho inteiro).
async function responderComMentor(
  mentor: { provedor: string; modelo: string | null; apiKey: string; buscaWeb: boolean },
  mensagens: Array<{ role: "user" | "assistant"; content: string }>,
): Promise<{ resposta: string | null; erro: string | null }> {
  try {
    const resposta = await chamarProvedorIA(mentor.provedor, {
      apiKey: mentor.apiKey,
      persona: PERSONA_MENTOR_ATIVOS,
      mensagens,
      maxTokens: 2000,
      modelo: mentor.modelo ?? undefined,
      buscaWeb: mentor.buscaWeb,
    });
    return { resposta: resposta || null, erro: resposta ? null : "Resposta vazia da IA." };
  } catch (e) {
    const msg = e instanceof ErroIA ? e.message
      : `Falha ao falar com a IA (${mentor.provedor}). ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`;
    return { resposta: null, erro: msg };
  }
}

export async function rotaChatMentor(c: Db, req: Request, m: string, userId: string): Promise<Response> {
  if (m !== "POST") return erro("Método não permitido", 405);

  let body: {
    mensagem?:  string;
    historico?: HistItem[];
    /** Snapshot da carteira/extrato (ou recorte deles) que o usuário optou por anexar — já formatado pelo frontend (serializarContexto). */
    contexto?:  string;
    /** IDs das configs de IA a consultar — vazio/ausente consulta TODOS os mentores configurados. */
    mentores_ids?: string[];
  };
  try {
    body = await req.json();
  } catch {
    return erro("JSON inválido", 400);
  }
  const mensagem = (body.mensagem ?? "").trim();
  if (!mensagem) return erro("Mensagem vazia", 400);
  if (mensagem.length > 2000) return erro("Mensagem muito longa (máx 2000)", 400);
  const historico = Array.isArray(body.historico) ? body.historico.slice(-20) : [];
  const contextoAnexo = (body.contexto ?? "").trim().slice(0, 12_000); // cap pra evitar abuso

  logRequest("POST", "/investimentos/chat-mentor");
  const resMentores = await lerMentoresIA(c, userId);
  if (!resMentores.ok) return erro(resMentores.erro, resMentores.status);

  // Recorte de quais mentores participam desta pergunta — vazio/ausente
  // mantém o comportamento padrão (todos os configurados).
  const idsEscolhidos = Array.isArray(body.mentores_ids) ? body.mentores_ids.filter(Boolean) : [];
  const mentoresParticipantes = idsEscolhidos.length > 0
    ? resMentores.mentores.filter((mt) => idsEscolhidos.includes(mt.id))
    : resMentores.mentores;
  if (mentoresParticipantes.length === 0) {
    return erro("Nenhum dos mentores selecionados foi encontrado. Recarregue a página e tente de novo.", 400);
  }

  const contextoFatos = await contextoFatosRelevantes(c, mensagem);
  const mensagens = montarMensagens(historico, mensagem, [contextoAnexo, contextoFatos]);

  const respostas = await Promise.all(
    mentoresParticipantes.map(async (mentor: MentorIA) => {
      const r = await responderComMentor(mentor, mensagens);
      return { config_id: mentor.id, nome: mentor.nome, provedor: mentor.provedor, modelo: mentor.modelo, ...r };
    }),
  );

  const ok = respostas.filter((r) => r.erro === null && r.resposta);
  if (ok.length === 0) {
    return erro(respostas.find((r) => r.erro)?.erro ?? "Nenhum mentor conseguiu responder.", 502);
  }

  // Síntese: usa a config ATIVA do usuário como "presidente do conselho".
  const cfgAtiva = await lerConfigIAAtiva(c, userId);
  let consenso = "";
  let consensoDe: { config_id: string | null; nome: string | null } = { config_id: null, nome: null };
  if (cfgAtiva.ok) {
    const painel = ok.map((r) => `Mentor "${r.nome ?? r.provedor}" (${r.provedor}):\n${r.resposta}`).join("\n\n");
    const msgSintese = [
      ...historico,
      {
        role: "user" as const,
        content:
          `Pergunta original do usuário:\n${mensagem}\n\n` +
          `Respostas dos mentores consultados:\n\n${painel}\n\n` +
          "Sintetize agora o consenso do conselho.",
      },
    ];
    const ativoComoMentor = resMentores.mentores.find(
      (mt) => mt.provedor === cfgAtiva.config.provedor && mt.modelo === cfgAtiva.config.modelo,
    );
    try {
      consenso = await chamarProvedorIA(cfgAtiva.config.provedor, {
        apiKey: cfgAtiva.config.apiKey,
        persona: PERSONA_PRESIDENTE_CONSELHO,
        mensagens: msgSintese,
        maxTokens: 2500,
        modelo: cfgAtiva.config.modelo ?? undefined,
      });
      consensoDe = { config_id: ativoComoMentor?.id ?? null, nome: ativoComoMentor?.nome ?? null };
    } catch (e) {
      logError("Sintetizar consenso do conselho", e);
      // Falha na síntese não derruba a resposta — o usuário ainda vê as
      // respostas individuais dos mentores.
    }
  }

  return json({
    dados: {
      mentores: respostas.map((r) => ({
        config_id: r.config_id, nome: r.nome, provedor: r.provedor, modelo: r.modelo,
        resposta: r.resposta, erro: r.erro,
      })),
      consenso: consenso || null,
      consenso_de: consenso ? consensoDe : null,
    },
  });
}
