// ============================================================
// FASE 1 (revisada) — INSPEÇÃO via console do navegador
// ------------------------------------------------------------
// A interceptação de JSON não capturou nada (o investidor10 renderiza a
// tabela de movimentações no HTML, sem um endpoint JSON separado). Então
// vamos LER A PÁGINA HTML direto. Mas antes de construir o extrator final
// precisamos ver a estrutura REAL da tabela e descobrir se o valor com
// precisão decimal cheia está escondido em algum atributo (title / data-*)
// — porque o texto visível mostra só 2 casas.
//
// COMO USAR:
//   1. Abra https://investidor10.com.br/wallet/my-wallet/pro/entries (logado)
//   2. F12 → aba Console
//   3. Cole TODO este arquivo e dê Enter
//   4. Ele baixa "inv10-inspecao.json" — envie esse arquivo ao assistente.
//
// Não grava nada no site nem na sua carteira. Só lê e baixa um diagnóstico.
// ============================================================
(() => {
  const LINHAS_AMOSTRA = 5; // quantas linhas detalhar célula a célula

  // 1) Acha a tabela de movimentações: a <table> com mais linhas no tbody.
  const tabelas = Array.from(document.querySelectorAll('table'));
  if (!tabelas.length) {
    console.error('[inspeção] Nenhuma <table> encontrada nesta página.');
    return;
  }
  const tabela = tabelas
    .map((t) => ({ t, n: t.querySelectorAll('tbody tr').length }))
    .sort((a, b) => b.n - a.n)[0].t;

  // 2) Cabeçalhos (nomes das colunas).
  const headers = Array.from(tabela.querySelectorAll('thead th, thead td'))
    .map((th) => (th.textContent || '').trim());

  // 3) Coleta atributos "interessantes" de um elemento (onde pode estar a
  //    precisão cheia: title, data-*, value, etc.).
  const attrsRelevantes = (el) => {
    const out = {};
    for (const a of el.attributes || []) {
      if (/^(title|value|data-|aria-)/i.test(a.name)) out[a.name] = a.value;
    }
    return out;
  };

  // 4) Detalha linhas: texto + HTML + atributos de cada célula e dos elementos
  //    internos (spans com title costumam guardar o valor real). Detalhamos as
  //    primeiras linhas E, principalmente, linhas de CRIPTO (onde a quantidade
  //    tem muitas casas) — é o caso que precisamos validar.
  const detalharLinha = (tr) => Array.from(tr.children).map((td) => ({
    texto: (td.textContent || '').trim(),
    attrs: attrsRelevantes(td),
    html: td.innerHTML.trim().slice(0, 400),
    internos_com_attrs: Array.from(td.querySelectorAll('*'))
      .map((el) => ({ tag: el.tagName.toLowerCase(), texto: (el.textContent || '').trim().slice(0, 40), attrs: attrsRelevantes(el) }))
      .filter((x) => Object.keys(x.attrs).length),
  }));

  const todasTrs = Array.from(tabela.querySelectorAll('tbody tr'));
  const ehCripto = (tr) => /cripto|crypto|bitcoin|ethereum/i.test(tr.textContent || '');
  const trsCripto = todasTrs.filter(ehCripto).slice(0, 3);
  const amostra = todasTrs.slice(0, LINHAS_AMOSTRA).map(detalharLinha);
  const amostra_cripto = trsCripto.map(detalharLinha);

  // 4b) Next.js embute dados crus na página. Captura candidatos a JSON bruto:
  //     __NEXT_DATA__ (Pages Router) e <script type="application/json">.
  //     O flight do App Router (self.__next_f) é texto gigante; guardamos só
  //     um indicativo de tamanho para decidir se vale extrair depois.
  const nextDataEl = document.getElementById('__NEXT_DATA__');
  const scriptsJson = Array.from(document.querySelectorAll('script[type="application/json"]'))
    .map((s) => (s.textContent || '').slice(0, 2000));
  const embutidos = {
    tem_next_data: !!nextDataEl,
    next_data_inicio: nextDataEl ? (nextDataEl.textContent || '').slice(0, 3000) : null,
    qtd_scripts_json: scriptsJson.length,
    scripts_json_amostra: scriptsJson.slice(0, 3),
    tem_app_router_flight: typeof self !== 'undefined' && Array.isArray(self.__next_f),
  };

  // 5) Detecta paginação / "itens por página" (pra sabermos se a tabela está
  //    quebrada em páginas e precisamos puxar tudo).
  const seletoresLength = Array.from(document.querySelectorAll('select'))
    .map((s) => ({ name: s.name || s.className, opcoes: Array.from(s.options).map((o) => o.text) }))
    .filter((s) => s.opcoes.some((o) => /^\d+$/.test(o.trim())));
  const paginacao = Array.from(document.querySelectorAll('.pagination, [class*="pagina"], nav'))
    .map((n) => (n.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 120))
    .filter(Boolean)
    .slice(0, 3);

  const diag = {
    url: location.href,
    capturado_em: new Date().toISOString(),
    total_tabelas_na_pagina: tabelas.length,
    linhas_no_tbody: tabela.querySelectorAll('tbody tr').length,
    headers,
    seletores_itens_por_pagina: seletoresLength,
    paginacao_detectada: paginacao,
    qtd_linhas_cripto_encontradas: trsCripto.length,
    amostra_linhas: amostra,
    amostra_cripto,
    embutidos,
    tabela_outerhtml_inicio: tabela.outerHTML.slice(0, 6000),
  };

  // 6) Baixa o diagnóstico.
  const blob = new Blob([JSON.stringify(diag, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'inv10-inspecao.json';
  a.click();

  console.log('[inspeção] Pronto. Baixei "inv10-inspecao.json".');
  console.log(`[inspeção] Colunas detectadas (${headers.length}):`, headers);
  console.log(`[inspeção] Linhas no tbody (página atual): ${diag.linhas_no_tbody}`);
  console.table(amostra.map((l) => l.map((c) => c.texto)));
})();
