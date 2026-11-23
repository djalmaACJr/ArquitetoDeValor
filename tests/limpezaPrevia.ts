// tests/limpezaPrevia.ts
//
// Primeiro passo das suítes (Jest: globalSetup; Playwright: projeto "limpeza"): remove o lixo
// que execuções INTERROMPIDAS (CI cancelada, Ctrl+C, timeout) deixam na conta de teste, porque
// o `afterAll` delas nunca rodou. Sem isso o lixo só cresce — e o compute do Supabase é
// compartilhado (burstable), então uma conta de teste com milhares de linhas deixa tudo mais lento.
//
// Segurança (a conta de teste NÃO pode perder dado real):
//  • tudo é "melhor esforço": qualquer falha só é logada, NUNCA derruba a suíte;
//  • lançamentos e objetivos só são apagados quando TODOS os da conta batem com os padrões de
//    teste (se aparecer um lançamento "de verdade", nada é apagado e o motivo é logado);
//  • contas só as de nome "AGR-ATV-…"; vínculos de agregado só os já encerrados/recusados ou
//    com e-mail @example.com; usuários do Auth só `jest-rls-*` / `e2e-seletor-*` `@example.com` com mais de 1 h
//    (nunca o de uma rodada em andamento);
//  • SUPABASE_SERVICE_ROLE_KEY é opcional: sem ela (caso da CI) a limpeza usa só o login da conta de
//    teste (lançamentos, objetivos e contas); vínculos de agregado e usuários do Auth exigem a chave.
//  • LIMPEZA_PREVIA=0 desliga (ex.: depurar um estado específico).
//
// As rodadas da CI são serializadas pelo grupo de concorrência `supabase-conta-de-teste`,
// então no início de uma suíte não há outra rodada usando a conta.
import { createClient } from "@supabase/supabase-js";

const PADRAO_LANCAMENTO = /^(Teste Jest|Jest |E2E |\[Transf\. (saída|entrada)\] (E2E|Teste|Jest))/;
const PADRAO_OBJETIVO = /^(Jest OBJ|AGR OBJ|E2E)/;
const IDADE_MIN_USUARIO_TEMP_MS = 60 * 60 * 1000;

export interface ResumoLimpeza {
  lancamentos: number;
  objetivos: number;
  contas: number;
  agregados: number;
  usuariosTemp: number;
  pulado?: string;
}

async function paginar<T>(buscar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const tudo: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await buscar(i, i + 999);
    if (error) throw new Error(error.message);
    tudo.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return tudo;
}

export async function limparLixoDeExecucoesInterrompidas(
  log: (msg: string) => void = (m) => console.log(m),
  opcoes: { simular?: boolean } = {},
): Promise<ResumoLimpeza> {
  const resumo: ResumoLimpeza = { lancamentos: 0, objetivos: 0, contas: 0, agregados: 0, usuariosTemp: 0 };
  const rotulo = "[limpeza prévia]";
  const simular = opcoes.simular === true;
  if (process.env.LIMPEZA_PREVIA === "0") { resumo.pulado = "desligada (LIMPEZA_PREVIA=0)"; log(`${rotulo} ${resumo.pulado}`); return resumo; }

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const email = process.env.TEST_EMAIL;
  const senha = process.env.TEST_PASSWORD;
  // LIMPEZA_SERVICE_ROLE_KEY: nome próprio para a CI poder dar a chave SÓ à limpeza, sem ligar os testes
  // que já dependem de SUPABASE_SERVICE_ROLE_KEY (hoje pulados na CI).
  const service = process.env.LIMPEZA_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !email || !senha) {
    resumo.pulado = "faltam variáveis (SUPABASE_URL/ANON/TEST_EMAIL/TEST_PASSWORD)";
    log(`${rotulo} pulada: ${resumo.pulado}`);
    return resumo;
  }

  try {
    const admin = service ? createClient(url, service, { db: { schema: "arqvalor" }, auth: { persistSession: false } }) : null;
    const usuario = createClient(url, anon, { auth: { persistSession: false } });
    const { data: sessao, error: eLogin } = await usuario.auth.signInWithPassword({ email, password: senha });
    if (eLogin || !sessao.session) throw new Error(`login da conta de teste: ${eLogin?.message}`);
    const uid = sessao.user.id;
    const token = sessao.session.access_token;
    // Leitura/remoção direta: com service role se houver; senão com o próprio login (RLS = só dados da conta).
    const dbUsuario = createClient(url, anon, {
      db: { schema: "arqvalor" }, auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const banco = admin ?? dbUsuario;
    const limpar = async (entidade: string) => {
      const r = await fetch(`${url}/functions/v1/limpar?entidade=${entidade}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}`, apikey: anon },
      });
      const corpo = await r.json().catch(() => ({})) as { excluidos?: number; erro?: string };
      if (!r.ok) throw new Error(`limpar ${entidade}: HTTP ${r.status} ${corpo.erro ?? ""}`);
      return corpo.excluidos ?? 0;
    };

    // 1) Lançamentos (inclui as duas pernas das transferências de teste)
    try {
      const tx = await paginar<{ descricao: string }>((de, ate) =>
        banco.from("transacoes").select("descricao").eq("user_id", uid).range(de, ate));
      const reais = tx.filter((t) => !PADRAO_LANCAMENTO.test(String(t.descricao ?? "")));
      if (tx.length === 0) { /* nada */ }
      else if (reais.length > 0) log(`${rotulo} lançamentos NÃO apagados: ${reais.length} não parecem de teste (ex.: "${reais[0].descricao}")`);
      else if (simular) { resumo.lancamentos = tx.length; log(`${rotulo} [simulação] apagaria ${tx.length} lançamentos`); }
      else { resumo.lancamentos = await limpar("transacoes"); log(`${rotulo} ${resumo.lancamentos} lançamentos apagados`); }
    } catch (e) { log(`${rotulo} lançamentos: ${(e as Error).message}`); }

    // 2) Objetivos (a API só faz soft-delete; /limpar apaga de verdade)
    try {
      const ob = await paginar<{ nome: string }>((de, ate) =>
        banco.from("objetivos").select("nome").eq("user_id", uid).range(de, ate));
      const reais = ob.filter((o) => !PADRAO_OBJETIVO.test(String(o.nome ?? "")));
      if (ob.length === 0) { /* nada */ }
      else if (reais.length > 0) log(`${rotulo} objetivos NÃO apagados: ${reais.length} não parecem de teste (ex.: "${reais[0].nome}")`);
      else if (simular) { resumo.objetivos = ob.length; log(`${rotulo} [simulação] apagaria ${ob.length} objetivos`); }
      else { resumo.objetivos = await limpar("objetivos"); log(`${rotulo} ${resumo.objetivos} objetivos apagados`); }
    } catch (e) { log(`${rotulo} objetivos: ${(e as Error).message}`); }

    // 3) Contas "AGR-ATV-…" (testes de agregados) — depois dos lançamentos, senão o banco bloqueia
    try {
      const { data: contas, error } = await banco.from("contas").select("id").eq("user_id", uid).like("nome", "AGR-ATV-%");
      if (error) throw new Error(error.message);
      const ids = (contas ?? []).map((c) => c.id as string);
      if (ids.length > 0 && simular) { resumo.contas = ids.length; log(`${rotulo} [simulação] apagaria ${ids.length} contas AGR-ATV`); }
      else if (ids.length > 0) {
        for (let i = 0; i < ids.length; i += 50) {
          const { error: eDel, count } = await banco.from("contas").delete({ count: "exact" }).in("id", ids.slice(i, i + 50));
          if (eDel) throw new Error(eDel.message);
          resumo.contas += count ?? 0;
        }
        log(`${rotulo} ${resumo.contas} contas AGR-ATV apagadas`);
      }
    } catch (e) { log(`${rotulo} contas: ${(e as Error).message}`); }

    // 4) Vínculos de agregado de teste (histórico encerrado/recusado ou convites @example.com)
    if (!admin) log(`${rotulo} vínculos de agregado e usuários temporários: pulados (sem SUPABASE_SERVICE_ROLE_KEY)`);
    else try {
      const { data: ags, error } = await admin.from("agregados").select("id, email_convidado, status").eq("dono_id", uid);
      if (error) throw new Error(error.message);
      const ids = (ags ?? [])
        .filter((a) => /@example\.com$/i.test(String(a.email_convidado)) || a.status === "REVOGADO" || a.status === "RECUSADO")
        .map((a) => a.id as string);
      if (ids.length > 0 && simular) { resumo.agregados = ids.length; log(`${rotulo} [simulação] apagaria ${ids.length} vínculos de agregado`); }
      else if (ids.length > 0) {
        for (let i = 0; i < ids.length; i += 100) {
          const { error: eDel, count } = await admin.from("agregados").delete({ count: "exact" }).in("id", ids.slice(i, i + 100));
          if (eDel) throw new Error(eDel.message);
          resumo.agregados += count ?? 0;
        }
        log(`${rotulo} ${resumo.agregados} vínculos de agregado apagados`);
      }
    } catch (e) { log(`${rotulo} agregados: ${(e as Error).message}`); }

    // 5) Usuários temporários do Auth (rodadas interrompidas antes do afterAll que os excluiria)
    if (admin) try {
      const { data: lista, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw new Error(error.message);
      const velhos = (lista?.users ?? []).filter((u) =>
        /^(jest-rls|e2e-seletor)-.*@example\.com$/i.test(u.email ?? "") && Date.now() - new Date(u.created_at).getTime() > IDADE_MIN_USUARIO_TEMP_MS);
      if (velhos.length > 0 && simular) { resumo.usuariosTemp = velhos.length; log(`${rotulo} [simulação] apagaria ${velhos.length} usuários temporários`); }
      else {
        for (const u of velhos) {
          const { error: eDados } = await admin.rpc("fn_excluir_dados_usuario", { p_user_id: u.id });
          if (eDados) { log(`${rotulo} usuário temporário não limpo: ${eDados.message}`); continue; }
          const { error: eDel } = await admin.auth.admin.deleteUser(u.id);
          if (eDel) log(`${rotulo} usuário temporário não removido: ${eDel.message}`); else resumo.usuariosTemp++;
        }
        if (resumo.usuariosTemp > 0) log(`${rotulo} ${resumo.usuariosTemp} usuários temporários removidos`);
      }
    } catch (e) { log(`${rotulo} usuários temporários: ${(e as Error).message}`); }
  } catch (e) {
    log(`${rotulo} abortada sem efeito nas suítes: ${(e as Error).message}`);
  }
  return resumo;
}
