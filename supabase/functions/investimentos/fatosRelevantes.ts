// supabase/functions/investimentos/fatosRelevantes.ts
//
// Fatos Relevantes / Comunicados ao Mercado de FIIs — Fundos.NET (B3),
// endpoint público https://fnet.bmfbovespa.com.br/fnet/publico/... (não é
// a API oficial B2B do developers.b3.com.br — é a mesma consulta que a UI
// pública "Fundos.NET → Documentos" faz via XHR; sem chave, sem CSRF/login
// necessários para leitura). Fonte real do que a B3 chama de "Fato
// Relevante": ver seção "Avaliação de ativos por mentores de IA" em
// BUSINESS_RULES.md.
//
// Achados de campo (ago/2026, validados via curl antes de escrever este
// módulo):
//   • NÃO precisa de sessão/cookie/CSRF pra ler — é stateless.
//   • O WAF (Cloudflare) ocasionalmente devolve 302 → /fnet/login em
//     requisições com página grande (`l` alto, ~200-500) — intermitente,
//     não determinístico. Páginas pequenas (`l` ≤ 50) são estáveis. Por
//     isso: SEMPRE pagina em blocos pequenos, com pausa entre chamadas, e
//     trata qualquer falha como "sem dado agora" — nunca deixa a avaliação
//     de um ativo quebrar por causa desta fonte.
//   • Não existe filtro confiável por ticker (a busca de fundo é por nome/
//     razão social, que o usuário não cadastra) — por isso o cron busca o
//     feed geral (todos os FIIs) num filtro de categoria+data, cacheia
//     tudo, e o CASAMENTO com o ativo do usuário é feito depois, por texto
//     (ticker/nome), na leitura (`buscarFatosRelevantesParaAtivo`).
//
// Cache compartilhado em `inv_fatos_relevantes` (mesmo padrão de
// `cotacoes_ativos`): sem user_id, escrita só via service_role (cron),
// leitura liberada a todos os autenticados.
import { json, erro, dbAdmin, autenticarCron } from "../_shared/utils.ts";
import { logError, logRequest, logSuccess } from "../_shared/logger.ts";
import { Db, hojeISO, recuarDias } from "./shared.ts";

const FNET_BASE = "https://fnet.bmfbovespa.com.br/fnet/publico/";
const FNET_HEADERS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
};

// Categorias do Fundos.NET que nos interessam (ver DOCUMENTO_CATEGORIA do
// sistema — validado por scraper de terceiros, PythonicCafe/mercados).
const CATEGORIAS_FNET: Record<string, number> = {
  "Fato Relevante": 1,
  "Comunicado ao Mercado": 3,
};
const TIPO_FUNDO_FII = 1;

interface LinhaFnet {
  id: number;
  categoriaDocumento: string;
  descricaoFundo: string;
  nomePregao: string;
  informacoesAdicionais: string;
  dataEntrega: string; // "dd/MM/yyyy HH:mm"
}

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

// "26/08/2026 20:23" → ISO 8601 (assume horário de Brasília, igual ao
// resto do backend — ver seção "Fuso horário" do CLAUDE.md).
function dataEntregaParaISO(s: string): string | null {
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h = "00", mi = "00"] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:00-03:00`;
}

// GET JSON no Fundos.NET com timeout + 1 retry, tolerando o 302 do WAF.
// null = "sem dado agora" (nunca lança — quem chama decide se ignora).
async function fetchFnet(url: string): Promise<{ data: LinhaFnet[]; recordsTotal: number } | null> {
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const res = await fetch(url, {
        headers: FNET_HEADERS,
        redirect: "manual", // um 302 pro /login é falha, não sucesso — não seguir
        signal: AbortSignal.timeout(8000),
      });
      if (res.status !== 200) {
        logError("Fundos.NET fatos relevantes", `HTTP ${res.status} (tentativa ${tentativa})`);
      } else {
        const txt = await res.text();
        try {
          const parsed = JSON.parse(txt) as { data?: LinhaFnet[]; recordsTotal?: number };
          return { data: parsed.data ?? [], recordsTotal: parsed.recordsTotal ?? 0 };
        } catch {
          logError("Fundos.NET fatos relevantes", `corpo não-JSON (tentativa ${tentativa})`);
        }
      }
    } catch (e) {
      logError("Fundos.NET fatos relevantes", `${e} (tentativa ${tentativa})`);
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

function montarUrlBusca(categoriaId: number, skip: number, limite: number, dataInicial: string, dataFinal: string): string {
  const params = new URLSearchParams({
    "d": "1",
    "s": String(skip),
    "l": String(limite),
    "o[0][dataEntrega]": "desc",
    "idCategoriaDocumento": String(categoriaId),
    "idTipoDocumento": "0",
    "tipoFundo": String(TIPO_FUNDO_FII),
    "idEspecieDocumento": "0",
    "dataInicial": ddmmyyyy(dataInicial),
    "dataFinal": ddmmyyyy(dataFinal),
    "_": String(Date.now()),
  });
  return `${FNET_BASE}pesquisarGerenciadorDocumentosDados?${params.toString()}`;
}

// ============================================================
// POST /investimentos/fatos-relevantes-cron — job diário (todos os FIIs,
// não por usuário). Sem JWT — protegido por x-cron-secret.
// ============================================================
export async function rotaFatosRelevantesCron(req: Request, m: string): Promise<Response> {
  if (m !== "POST") return erro("Método não permitido", 405);
  const naoAutorizado = autenticarCron(req);
  if (naoAutorizado) return naoAutorizado;
  logRequest("POST", "/investimentos/fatos-relevantes-cron", {});
  const resumo = await provisionarFatosRelevantes();
  logSuccess("Fatos relevantes atualizados", resumo);
  return json({ dados: resumo });
}

// Busca um número pequeno de páginas (l=40) por categoria, numa janela
// recente (`JANELA_DIAS` — sobreposta o suficiente pra cobrir corridas
// atrasadas/falhas do dia anterior sem custo relevante), e faz upsert no
// cache compartilhado. Nunca lança — cada falha de página só reduz a
// cobertura desta execução, sem derrubar o job inteiro.
const JANELA_DIAS = 10;
const PAGINAS_POR_CATEGORIA = 6; // 6 × 40 = até 240 documentos/categoria/dia — folga confortável sobre o volume real (~5-10/dia)
const TAMANHO_PAGINA = 40;

export async function provisionarFatosRelevantes(): Promise<{
  inseridos: number; consultados: number; falhas: number; por_categoria: Record<string, number>;
}> {
  const hoje = hojeISO();
  const desde = recuarDias(hoje, JANELA_DIAS);

  const linhas: LinhaFnet[] = [];
  let falhas = 0;
  const porCategoria: Record<string, number> = {};

  for (const [nomeCategoria, categoriaId] of Object.entries(CATEGORIAS_FNET)) {
    let coletadasCategoria = 0;
    for (let pagina = 0; pagina < PAGINAS_POR_CATEGORIA; pagina++) {
      const url = montarUrlBusca(categoriaId, pagina * TAMANHO_PAGINA, TAMANHO_PAGINA, desde, hoje);
      const resp = await fetchFnet(url);
      if (!resp) { falhas++; break; } // fonte instável agora — não insiste nesta categoria
      linhas.push(...resp.data);
      coletadasCategoria += resp.data.length;
      const acabou = resp.data.length < TAMANHO_PAGINA || (pagina + 1) * TAMANHO_PAGINA >= resp.recordsTotal;
      if (acabou) break;
      await new Promise((r) => setTimeout(r, 500)); // não martelar o WAF
    }
    porCategoria[nomeCategoria] = coletadasCategoria;
  }

  const paraGravar = linhas
    .map((l) => {
      const dataISO = dataEntregaParaISO(l.dataEntrega);
      if (!dataISO || !Number.isFinite(l.id)) return null;
      return {
        id:            l.id,
        categoria:     l.categoriaDocumento?.trim() || "Fato Relevante",
        fundo_nome:    (l.descricaoFundo ?? "").trim(),
        fundo_pregao:  (l.nomePregao ?? "").trim() || null,
        resumo:        (l.informacoesAdicionais ?? "").replace(/;+\s*$/, "").trim() || null,
        data_entrega:  dataISO,
        url_documento: `https://fnet.bmfbovespa.com.br/fnet/publico/downloadDocumento?id=${l.id}`,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null && !!x.fundo_nome);

  let inseridos = 0;
  if (paraGravar.length > 0) {
    const admin = dbAdmin();
    // onConflict "id" + ignoreDuplicates: documento já publicado não muda
    // de conteúdo — só evita reprocessar o que dias anteriores já cacheram.
    const { error, count } = await admin
      .from("inv_fatos_relevantes")
      .upsert(paraGravar, { onConflict: "id", ignoreDuplicates: true, count: "exact" });
    if (error) logError("Upsert inv_fatos_relevantes", error);
    else inseridos = count ?? 0;

    // Higiene: mantém só ~1 ano de histórico (a tabela é só contexto pra
    // avaliação "atual" — nada consome dado mais antigo que isso).
    await admin.from("inv_fatos_relevantes").delete().lt("data_entrega", recuarDias(hoje, 365));
  }

  return { inseridos, consultados: linhas.length, falhas, por_categoria: porCategoria };
}

// ============================================================
// Leitura para o prompt do mentor — casamento por TEXTO (não há CNPJ
// cadastrado em inv_ativos, e a única chave forte do Fundos.NET é o nome
// oficial do fundo, que o usuário não digita). Estratégia: normaliza
// (minúsculo, sem acento/pontuação) e casa o "núcleo" do ticker (ex.:
// "KNRI11" → "KNRI") contra `fundo_pregao`/`fundo_nome` — mesmo padrão de
// busca "toda palavra aparece em algum lugar" já usado em mercado.ts
// (buscaTesouro). Pode não achar nada (fundo não bateu, ou não tem fato
// relevante recente) — nesse caso a avaliação segue sem esse bloco extra,
// sem quebrar nada.
// ============================================================
export interface FatoRelevante {
  categoria: string;
  fundo_nome: string;
  data_entrega: string;
  resumo: string | null;
}

function normaliza(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Núcleo do ticker de FII: remove o sufixo numérico de cota (ex.:
// "KNRI11" → "KNRI"; "HGLG11" → "HGLG").
function nucleoTicker(ticker: string): string {
  return normaliza(ticker).replace(/\d+$/, "");
}

export async function buscarFatosRelevantesParaAtivo(
  c: Db, ticker: string, nome: string | null, limite = 5,
): Promise<FatoRelevante[]> {
  const nucleo = nucleoTicker(ticker);
  if (!nucleo) return [];

  // Filtro no banco por ILIKE (reduz o que trafega) — o núcleo do ticker
  // costuma aparecer dentro de `fundo_pregao` (ex.: "FII KNRI") mesmo sem
  // bater 100% com o texto oficial.
  const { data, error } = await c
    .from("inv_fatos_relevantes")
    .select("categoria, fundo_nome, fundo_pregao, data_entrega, resumo")
    .or(`fundo_pregao.ilike.%${nucleo}%,fundo_nome.ilike.%${nucleo}%`)
    .order("data_entrega", { ascending: false })
    .limit(50); // confirma por normalização em memória antes de cortar pro `limite` final
  if (error) { logError("Buscar fatos relevantes do ativo", error); return []; }

  const nomeNormalizado = nome ? normaliza(nome) : "";
  const candidatos = (data ?? []) as {
    categoria: string; fundo_nome: string; fundo_pregao: string | null;
    data_entrega: string; resumo: string | null;
  }[];

  const bate = candidatos.filter((f) => {
    const pregao = normaliza(f.fundo_pregao ?? "");
    const fundoNome = normaliza(f.fundo_nome);
    if (pregao.includes(nucleo) || fundoNome.includes(nucleo)) return true;
    return !!nomeNormalizado && nomeNormalizado.length >= 6 && fundoNome.includes(nomeNormalizado);
  });

  return bate.slice(0, limite).map((f) => ({
    categoria: f.categoria, fundo_nome: f.fundo_nome, data_entrega: f.data_entrega, resumo: f.resumo,
  }));
}

// Formata os fatos encontrados como bloco de texto pro prompt do mentor.
// "" se não achou nada (quem chama simplesmente não anexa o bloco).
export function descreverFatosRelevantes(fatos: FatoRelevante[]): string {
  if (fatos.length === 0) return "";
  const linhas = fatos.map((f) => {
    const data = new Date(f.data_entrega).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const resumo = f.resumo ? ` — ${f.resumo}` : "";
    return `  • [${data}] ${f.categoria}${resumo}`;
  });
  return `Fatos Relevantes/Comunicados recentes publicados pelo fundo (Fundos.NET/B3):\n${linhas.join("\n")}`;
}
