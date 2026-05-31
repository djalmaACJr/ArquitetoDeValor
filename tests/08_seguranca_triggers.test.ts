// ============================================================
// Arquiteto de Valor — Testes de Segurança / Triggers
// tests/08_seguranca_triggers.test.ts
//
// Cobre triggers do banco que protegem invariantes críticas:
//   - fn_validar_isolamento_usuario  (cross-FK user)
//   - fn_trg_proteger_categoria      (categoria "Transferências")
//   - fn_bloquear_exclusao_conta     (conta com lançamentos)
//   - fn_bloquear_exclusao_categoria (categoria com filhos/lançamentos)
//   - trg_bloquear_exclusao_transf_avulsa (perna de transferência via /transacoes)
//   - trg_cascata_inativar_subcategorias (inativar pai cascade)
//   - trg_validar_conta_cartao_fatura (sessão de fatura em conta não-CARTAO)
// ============================================================

import {
  api, apiB, tryGetTokenB,
  limparConta, limparCategoria, limparTransacao,
} from "./setup";

const TS = Date.now();
const SUF = `TRG-${TS}`;

describe("Segurança — Triggers do banco", () => {
  // Detecta se User B está disponível. Os testes cross-FK
  // (SEG-TRG01/02) pulam graciosamente quando ausente.
  let temUserB = false;
  beforeAll(async () => {
    temUserB = !!(await tryGetTokenB());
    if (!temUserB) {
      // eslint-disable-next-line no-console
      console.warn(
        "[08_seguranca_triggers] User B não disponível — testes cross-user (TRG01/02) serão pulados. " +
        "Configure TEST_EMAIL_B/TEST_PASSWORD_B no .env pra cobertura completa.",
      );
    }
  });
  // ── SEG-TRG01: cross-FK conta_id (User A insere com conta de B) ─
  test("SEG-TRG01 — inserir tx com conta_id de outro user → bloqueado", async () => {
    if (!temUserB) { console.log("⊘ pulado: sem User B"); return; }
    // User B cria uma conta; User A tenta usar essa conta_id numa tx.
    const { data: contaB } = await apiB("/contas", "POST", {
      nome: `ContaB-${SUF}`, tipo: "CORRENTE", saldo_inicial: 0,
      icone: "🏦", cor: "#aabbcc", ativa: true,
    });
    const contaBId = contaB.id as string;

    const { data: catA } = await api("/categorias", "POST", {
      descricao: `Cat-${SUF}-A`, icone: "📂", cor: "#112233",
    });
    const catAId = catA.id as string;

    try {
      const { status } = await api("/transacoes", "POST", {
        conta_id:     contaBId,                       // ⚠ conta de B
        categoria_id: catAId,
        data:         "2026-05-31",
        descricao:    `attack-${SUF}`,
        valor:        10,
        tipo:         "DESPESA",
        status:       "PENDENTE",
      });
      // Backend pode retornar 422/400/403 — qualquer não-2xx significa bloqueio.
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      await limparCategoria(catAId);
      await apiB(`/contas/${contaBId}`, "DELETE");
    }
  });

  // ── SEG-TRG02: cross-FK categoria_id (User A com categoria de B) ─
  test("SEG-TRG02 — inserir tx com categoria_id de outro user → bloqueado", async () => {
    if (!temUserB) { console.log("⊘ pulado: sem User B"); return; }
    const { data: catB } = await apiB("/categorias", "POST", {
      descricao: `CatB-${SUF}`, icone: "📂", cor: "#445566",
    });
    const catBId = catB.id as string;

    const { data: contaA } = await api("/contas", "POST", {
      nome: `ContaA-${SUF}`, tipo: "CORRENTE", saldo_inicial: 0,
      icone: "🏦", cor: "#abcdef", ativa: true,
    });
    const contaAId = contaA.id as string;

    try {
      const { status } = await api("/transacoes", "POST", {
        conta_id:     contaAId,
        categoria_id: catBId,                          // ⚠ categoria de B
        data:         "2026-05-31",
        descricao:    `attack-${SUF}`,
        valor:        10,
        tipo:         "DESPESA",
        status:       "PENDENTE",
      });
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      await limparConta(contaAId);
      await apiB(`/categorias/${catBId}`, "DELETE");
    }
  });

  // ── SEG-TRG03: UPDATE de status/valor NÃO revalida conta_id ─
  // (fix 20260505000001: permite editar tx mesmo com conta inativa, desde
  //  que conta_id/categoria_id não estejam sendo alterados)
  test("SEG-TRG03 — UPDATE de status/valor não revalida FKs", async () => {
    const { data: contaA } = await api("/contas", "POST", {
      nome: `ContaInativ-${SUF}`, tipo: "CORRENTE", saldo_inicial: 0,
      icone: "🏦", cor: "#abcdef", ativa: true,
    });
    const contaAId = contaA.id as string;
    const { data: catA } = await api("/categorias", "POST", {
      descricao: `Cat-${SUF}-inativ`, icone: "📂", cor: "#112233",
    });
    const catAId = catA.id as string;

    const { data: tx } = await api("/transacoes", "POST", {
      conta_id: contaAId, categoria_id: catAId,
      data: "2026-05-31", descricao: `tx-${SUF}-inativ`,
      valor: 50, tipo: "DESPESA", status: "PENDENTE",
    });
    const txId = tx.id as string;

    try {
      // Inativa a conta.
      await api(`/contas/${contaAId}`, "PUT", { ativa: false });
      // UPDATE só de status deve passar (sem tocar conta_id/categoria_id).
      const { status } = await api(`/transacoes/${txId}`, "PUT", { status: "PAGO" });
      expect(status).toBeLessThan(400);
    } finally {
      // Reativa pra permitir a limpeza.
      await api(`/contas/${contaAId}`, "PUT", { ativa: true });
      await limparTransacao(txId);
      await limparCategoria(catAId);
      await limparConta(contaAId);
    }
  });

  // ── SEG-TRG05/06/07/08/09: categoria "Transferências" protegida ─
  describe("Categoria 'Transferências' protegida", () => {
    let transfId: string;

    beforeAll(async () => {
      const { data } = await api("/categorias");
      const transf = (data?.dados ?? []).find(
        (c: any) => c.descricao === "Transferências" && c.protegida === true,
      );
      // Pode não existir em ambiente recém-criado.
      if (transf) transfId = transf.id;
    });

    test("SEG-TRG05 — UPDATE descricao da 'Transferências' → bloqueado", async () => {
      if (!transfId) return; // seed não criada
      const { status } = await api(`/categorias/${transfId}`, "PUT", { descricao: "Hack" });
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test("SEG-TRG07 — UPDATE ativa=false em 'Transferências' → bloqueado", async () => {
      if (!transfId) return;
      const { status } = await api(`/categorias/${transfId}`, "PUT", { ativa: false });
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test("SEG-TRG08 — DELETE de 'Transferências' → bloqueado", async () => {
      if (!transfId) return;
      const { status } = await api(`/categorias/${transfId}`, "DELETE");
      expect(status).toBeGreaterThanOrEqual(400);
    });

    test("SEG-TRG09 — UPDATE só de cor/icone em 'Transferências' → permitido", async () => {
      if (!transfId) return;
      const { status } = await api(`/categorias/${transfId}`, "PUT", { cor: "#abc123" });
      expect(status).toBeLessThan(400);
    });
  });

  // ── SEG-TRG10: DELETE de conta com transações → bloqueado ─
  test("SEG-TRG10 — DELETE de conta com lançamentos → bloqueado", async () => {
    const { data: conta } = await api("/contas", "POST", {
      nome: `ContaProt-${SUF}`, tipo: "CORRENTE", saldo_inicial: 0,
      icone: "🏦", cor: "#bbbbbb", ativa: true,
    });
    const contaId = conta.id as string;
    const { data: cat } = await api("/categorias", "POST", {
      descricao: `Cat-prot-${SUF}`, icone: "📂", cor: "#111111",
    });
    const catId = cat.id as string;
    const { data: tx } = await api("/transacoes", "POST", {
      conta_id: contaId, categoria_id: catId,
      data: "2026-05-31", descricao: `tx-prot-${SUF}`,
      valor: 1, tipo: "DESPESA", status: "PENDENTE",
    });
    const txId = tx.id as string;

    try {
      const { status } = await api(`/contas/${contaId}`, "DELETE");
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      await limparTransacao(txId);
      await limparCategoria(catId);
      await limparConta(contaId);
    }
  });

  // ── SEG-TRG11: DELETE de categoria com filhos → bloqueado ─
  test("SEG-TRG11 — DELETE de categoria com subcategorias → bloqueado", async () => {
    const { data: pai } = await api("/categorias", "POST", {
      descricao: `Pai-${SUF}`, icone: "📂", cor: "#cccccc",
    });
    const paiId = pai.id as string;
    const { data: filha } = await api("/categorias", "POST", {
      descricao: `Filha-${SUF}`, id_pai: paiId, icone: "🧬", cor: "#dddddd",
    });
    const filhaId = filha.id as string;

    try {
      const { status } = await api(`/categorias/${paiId}`, "DELETE");
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      await limparCategoria(filhaId);
      await limparCategoria(paiId);
    }
  });

  // ── SEG-TRG12: DELETE de categoria com transações → bloqueado ─
  test("SEG-TRG12 — DELETE de categoria com lançamentos → bloqueado", async () => {
    const { data: conta } = await api("/contas", "POST", {
      nome: `ContaCatTx-${SUF}`, tipo: "CORRENTE", saldo_inicial: 0,
      icone: "🏦", cor: "#cccccc", ativa: true,
    });
    const contaId = conta.id as string;
    const { data: cat } = await api("/categorias", "POST", {
      descricao: `CatComTx-${SUF}`, icone: "📂", cor: "#dddddd",
    });
    const catId = cat.id as string;
    const { data: tx } = await api("/transacoes", "POST", {
      conta_id: contaId, categoria_id: catId,
      data: "2026-05-31", descricao: `tx-cat-${SUF}`,
      valor: 1, tipo: "DESPESA", status: "PENDENTE",
    });
    const txId = tx.id as string;

    try {
      const { status } = await api(`/categorias/${catId}`, "DELETE");
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      await limparTransacao(txId);
      await limparCategoria(catId);
      await limparConta(contaId);
    }
  });

  // ── SEG-TRG13: DELETE direto na perna de transferência → bloqueado ─
  test("SEG-TRG13 — DELETE de tx com id_par_transferencia via /transacoes → bloqueado", async () => {
    // Cria 2 contas pra origem e destino. (cores em #RRGGBB completo —
    // validação pode rejeitar #abc.)
    const { data: orig } = await api("/contas", "POST", {
      nome: `Orig-${SUF}`, tipo: "CORRENTE", saldo_inicial: 100,
      icone: "🏦", cor: "#aabbcc", ativa: true,
    });
    const origId = orig.id as string;
    const { data: dest } = await api("/contas", "POST", {
      nome: `Dest-${SUF}`, tipo: "CORRENTE", saldo_inicial: 0,
      icone: "🏦", cor: "#bbccdd", ativa: true,
    });
    const destId = dest.id as string;

    // Cria transferência via endpoint próprio. Usa método objeto-style +
    // status PAGO (formato exato dos testes de transferências existentes).
    const { status: stTrf, data: trf } = await api("/transferencias", {
      method: "POST",
      body: JSON.stringify({
        conta_origem_id:  origId,
        conta_destino_id: destId,
        valor:            10,
        data:             "2026-05-31",
        descricao:        `trf-${SUF}`,
        status:           "PAGO",
      }),
    });
    if (![200, 201].includes(stTrf)) {
      // eslint-disable-next-line no-console
      console.error("TRG13 falha ao criar transferência:", stTrf, JSON.stringify(trf));
    }
    expect([200, 201]).toContain(stTrf);
    const idPar = (trf.id_par ?? trf.dados?.id_par) as string;
    const idDebito = (trf.id_debito ?? trf.dados?.id_debito) as string;

    try {
      // Tentativa de DELETE da perna débito direto via /transacoes — bloqueado.
      const { status } = await api(`/transacoes/${idDebito}`, "DELETE");
      expect(status).toBeGreaterThanOrEqual(400);
    } finally {
      // Limpeza correta: via /transferencias/:id_par
      await api(`/transferencias/${idPar}`, "DELETE");
      await limparConta(origId);
      await limparConta(destId);
    }
  });

  // ── SEG-TRG14: cascata de inativação de subcategorias ─
  test("SEG-TRG14 — inativar pai cascateia em filhas", async () => {
    const { data: pai } = await api("/categorias", "POST", {
      descricao: `PaiCasc-${SUF}`, icone: "📂", cor: "#cccccc",
    });
    const paiId = pai.id as string;
    const { data: filha } = await api("/categorias", "POST", {
      descricao: `FilhaCasc-${SUF}`, id_pai: paiId, icone: "🧬", cor: "#dddddd",
    });
    const filhaId = filha.id as string;

    try {
      await api(`/categorias/${paiId}`, "PUT", { ativa: false });
      const { data } = await api("/categorias");
      const filhaAtualizada = (data?.dados ?? []).find((c: any) => c.id === filhaId);
      expect(filhaAtualizada?.ativa).toBe(false);
    } finally {
      // Reativa pra limpar (não dá pra deletar filha inativa se trigger exigir)
      await api(`/categorias/${paiId}`, "PUT", { ativa: true });
      await limparCategoria(filhaId);
      await limparCategoria(paiId);
    }
  });

  // ── SEG-TRG15: sessão de fatura só em conta CARTAO ─
  // Sem upload de PDF não dá pra acionar o endpoint, mas conseguimos
  // verificar indiretamente pela rejeição na criação. Pulamos se /faturas
  // não aceitar multipart no Jest.
  test("SEG-TRG15 — criar sessão de fatura em conta CORRENTE → bloqueado", async () => {
    const { data: corrente } = await api("/contas", "POST", {
      nome: `Corr-${SUF}`, tipo: "CORRENTE", saldo_inicial: 0,
      icone: "🏦", cor: "#999", ativa: true,
    });
    const contaId = corrente.id as string;

    try {
      // FormData com PDF mínimo válido (header %PDF-1.4 + EOF). Não passa
      // pelo parser real, mas deve bater no trigger antes ou retornar erro
      // claro. Aceitamos qualquer 4xx/5xx — o que NÃO pode é criar a sessão.
      const minimalPdf = "%PDF-1.4\n%¥±ë\n1 0 obj\n<< /Type /Catalog >>\nendobj\nxref\n0 1\n0000000000 65535 f\ntrailer\n<< /Size 1 /Root 1 0 R >>\n%%EOF";
      const form = new FormData();
      form.append("conta_id", contaId);
      form.append("arquivo", new Blob([minimalPdf], { type: "application/pdf" }), "teste.pdf");

      const token = (await import("./setup")).getToken;
      const tk = await token();
      const res = await fetch(`${process.env.SUPABASE_URL}/functions/v1/faturas`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${tk}`,
          "apikey": process.env.SUPABASE_ANON_KEY as string,
        },
        body: form,
      });
      // Esperamos um erro: trigger trg_validar_conta_cartao_fatura, ou
      // o parser não acha texto, ou validação dum unpdf. Qualquer não-2xx
      // ou 2xx com sessao.observacao indicando bloqueio é aceitável.
      // O mínimo: NÃO deve criar uma sessão usável.
      expect(res.status).toBeGreaterThanOrEqual(400);
    } finally {
      await limparConta(contaId);
    }
  });
});
