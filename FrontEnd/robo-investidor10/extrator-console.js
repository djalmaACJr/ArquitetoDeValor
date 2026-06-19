// ============================================================
// EXTRATOR — operações da carteira investidor10 (via console)
// ------------------------------------------------------------
// Lê o `rowData` CRU de cada linha da PrimeReact DataTable direto do React
// (precisão cheia: qty/price com 8 casas) — sem hover, sem parsear texto.
// Acumula em window.__inv10 (dedup por id), auto-pagina cada grupo clicando
// "Próximo" e baixa um inv10-operacoes.json.
//
// COMO USAR (na página /wallet/my-wallet/pro/entries, logado):
//   1. EXPANDA todos os grupos (Criptomoedas, Renda fixa, Tesouro direto,
//      ETFs, FIIs, Ações, ETFs Internacionais) — grupos colapsados não
//      renderizam linhas e ficariam de fora.
//   2. F12 → Console → cole este arquivo e Enter (ele já roda uma vez).
//   3. Confira o total no console. Se faltar algo (ex.: expandiu um grupo
//      depois), rode de novo:  await inv10Extrair()
//   4. Baixe o arquivo:  inv10Baixar()
//   5. Envie o inv10-operacoes.json ao assistente.
// ============================================================
window.__inv10 = window.__inv10 || new Map();

window.inv10Extrair = async ({ paginar = true } = {}) => {
  const getFiber = (el) => el[Object.keys(el).find((k) => k.startsWith('__reactFiber$'))];
  const rowDataOf = (tr) => { let f = getFiber(tr); while (f) { if (f.memoizedProps && f.memoizedProps.rowData) return f.memoizedProps.rowData; f = f.return; } return null; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = window.__inv10;

  const scrape = (root = document) => {
    let n = 0;
    root.querySelectorAll('tbody tr').forEach((tr) => {
      const rd = rowDataOf(tr);
      if (rd && rd.id != null && !store.has(rd.id)) { store.set(rd.id, rd); n++; }
    });
    return n;
  };

  // Paginador é PrimeReact padrão: o "Próximo" é o botão de ícone
  // .p-paginator-next (aria-label "Próxima Página"), desabilitado via classe
  // .p-disabled + atributo disabled. Um por grupo/tabela.
  const proximosHabilitados = () => Array.from(document.querySelectorAll('button.p-paginator-next'))
    .filter((e) => !e.disabled && !e.classList.contains('p-disabled'));

  scrape();
  if (paginar) {
    const qtdPag = proximosHabilitados().length;
    console.log(`[inv10] paginadores "Próximo" detectados: ${qtdPag}`);
    let round = 0, semGanho = 0;
    while (round++ < 500 && semGanho < 2) {
      const antes = store.size;
      const proximos = proximosHabilitados();
      if (!proximos.length) break;
      proximos.forEach((e) => e.click());
      await sleep(900);
      scrape();
      semGanho = store.size > antes ? 0 : semGanho + 1;
    }
  }
  console.log(`[inv10] acumulado: ${store.size} operações (rode de novo após expandir mais grupos, ou inv10Baixar() para salvar)`);
  return store.size;
};

window.inv10Baixar = () => {
  const arr = [...window.__inv10.values()];
  const blob = new Blob([JSON.stringify(arr, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'inv10-operacoes.json';
  a.click();
  console.log(`[inv10] baixado inv10-operacoes.json com ${arr.length} operações`);
};

await inv10Extrair();
