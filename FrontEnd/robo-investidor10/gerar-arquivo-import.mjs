// ============================================================
// FASE 2 — Conversor: inv10-operacoes.json → CSV (layout Status Invest)
// ------------------------------------------------------------
// Lê as operações capturadas do investidor10 (rowData cru) e gera um CSV
// que a tela Importar/Exportar do Arquiteto de Valor já sabe ler pelo
// parser `parseStatusInvest` (FrontEnd/src/lib/importB3.ts). O app deriva
// as POSIÇÕES atuais a partir das operações (compras − vendas, custo médio)
// e cria só os ativos que faltam — então não precisa raspar a carteira à parte.
//
// Layout de saída (colunas exatas que o parser procura):
//   Data operação | Categoria | Código Ativo | Operação C/V | Quantidade |
//   Preço unitário | Corretora
//
// Decisões aplicadas:
//   • Tudo incluído (renda variável + cripto + renda fixa/CDB + Tesouro).
//   • Eventos societários sem caixa (Desdobramento) são PULADOS — não viram
//     compra/venda. Conversões (par venda+compra de tickers) e Bônus são
//     mantidos (já são Compra/Venda com qty/preço válidos).
//   • Precisão cheia: usa qty e price_raw (8 casas).
//   • Moeda: o layout Status Invest é BRL-cêntrico — ativos em US$ entram com
//     o VALOR NUMÉRICO em dólar, mas rotulados como BRL no app (ajuste depois).
//   • REIT: o parser não tem categoria REIT; Reits (IVR/ORC) entram como STOCKS.
//
// USO:
//   1. Coloque o inv10-operacoes.json nesta pasta (ou passe o caminho).
//   2. node gerar-arquivo-import.mjs [caminho-do-json]
//   3. Importe o investidor10-import.csv gerado pela tela Importar/Exportar
//      (escolha sua conta de investimento na hora).
// ============================================================
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entrada = process.argv[2] ?? path.join(__dirname, "inv10-operacoes.json");
const saida = path.join(__dirname, "investidor10-import.csv");

// Repara mojibake (texto UTF-8 que foi lido como Latin-1): "AÃ§Ãµes" → "Ações".
function repararTexto(s) {
  if (typeof s !== "string" || !/Ã|Â/.test(s)) return s ?? "";
  try { return Buffer.from(s, "latin1").toString("utf8"); } catch { return s; }
}

// "DD/MM/AAAA" → "AAAA-MM-DD" (texto, sem ambiguidade pro parser).
function dataIso(s) {
  const m = String(s ?? "").trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}

// type_investment (reparado) → Categoria que o parseStatusInvest mapeia certo.
// Ordem importa: "ETFs Intern." contém ETF e Intern → testa Intern antes.
function categoria(tipoInv) {
  const t = repararTexto(tipoInv);
  // Cripto ANTES de renda fixa: "CRIptomoedas" casaria com a sigla CRI.
  if (/cripto/i.test(t)) return "Cripto";                  // → CRIPTOMOEDAS
  if (/tesouro/i.test(t)) return "Tesouro Direto";        // → TESOURO_DIRETO
  if (/\bcdb\b|renda\s*fixa|\blci\b|\blca\b|\bcri\b|\bcra\b|debent/i.test(t)) return "Renda Fixa"; // → RENDA_FIXA
  if (/bdr/i.test(t)) return "BDR";                        // → ACOES (subtipo BDR)
  if (/reit/i.test(t)) return "Stocks";                    // → STOCKS (não há REIT por esta via)
  if (/intern/i.test(t)) return "Internacional";           // → ETF_INTERNACIONAL
  if (/etf/i.test(t)) return "ETF";                        // → ETF
  if (/fii/i.test(t)) return "FII";                        // → FII
  if (/a[çc][õo]es|a[çc][ãa]o/i.test(t)) return "Ações";   // → ACOES
  return "Ações";
}

// Código Ativo (o parser deriva o ticker final daqui).
//  • Tesouro: passa o nome completo; o parser encurta (normalizarTickerTesouro)
//    e usa o nome completo como nome do ativo.
//  • CDB: gera um ticker curto, único e legível (≤20), pois a descrição é longa.
//  • Demais: o próprio ticker (HASH11, BTC, VSS…).
const seqCdb = new Map(); // chave do CDB → ticker já atribuído
function codigoAtivo(op) {
  const cat = categoria(op.type_investment);
  if (cat === "Tesouro Direto") return repararTexto(op.ticker);
  if (cat === "Renda Fixa") {
    const desc = repararTexto(op.ticker); // "CDB - nubank - Pós-Fixado - 120% CDI"
    const partes = desc.split(" - ").map((x) => x.trim());
    const emissor = (partes[1] ?? "RF").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
    const taxa = (partes[3] ?? partes[2] ?? "").replace(/[^0-9]/g, "").slice(0, 3);
    const ano = (op.due_date ?? "").slice(-2);
    let tk = `CDB-${emissor}-${taxa}${ano}`.slice(0, 20);
    // desambigua colisões de truncamento entre papéis diferentes do mesmo emissor
    const chave = `${emissor}|${op.due_date}|${taxa}`;
    if (!seqCdb.has(chave)) {
      let cand = tk, n = 1;
      const usados = new Set(seqCdb.values());
      while (usados.has(cand)) { cand = `${tk.slice(0, 18)}-${n++}`.slice(0, 20); }
      seqCdb.set(chave, cand);
    }
    return seqCdb.get(chave);
  }
  return String(op.ticker ?? "").trim();
}

// ── Lê e converte ───────────────────────────────────────────────
if (!fs.existsSync(entrada)) {
  console.error(`[fase2] não achei ${entrada}\n` +
    `        Coloque o inv10-operacoes.json nesta pasta ou passe o caminho:\n` +
    `        node gerar-arquivo-import.mjs C:/caminho/inv10-operacoes.json`);
  process.exit(1);
}
const ops = JSON.parse(fs.readFileSync(entrada, "utf8"));
if (!Array.isArray(ops)) { console.error("[fase2] JSON inválido (esperava um array)."); process.exit(1); }

const linhas = [];
const puladas = [];
const porCategoria = {};
const tickersUsd = new Set();

for (const op of ops) {
  const tipo = String(op.type ?? "").trim();
  // Só Compra/Venda viram operação. Desdobramento e outros eventos sem
  // caixa são pulados (ajuste manual de quantidade, se necessário).
  if (tipo !== "Compra" && tipo !== "Venda") { puladas.push(op); continue; }

  const data = dataIso(op.date);
  const codigo = codigoAtivo(op);
  const cat = categoria(op.type_investment);
  const qty = String(op.qty ?? op.qty_adjusted ?? "").trim();
  const preco = String(op.price_raw ?? "").trim();
  if (!data || !codigo || !qty) { puladas.push(op); continue; }

  if (String(op.currency ?? "").includes("US$")) tickersUsd.add(codigo);
  porCategoria[cat] = (porCategoria[cat] ?? 0) + 1;

  linhas.push({
    "Data operação": data,
    "Categoria": cat,
    "Código Ativo": codigo,
    "Operação C/V": tipo, // "Compra"/"Venda" → o parser usa startsWith('V')
    "Quantidade": qty,
    "Preço unitário": preco,
    "Corretora": "investidor10",
  });
}

// ── Monta o CSV (tudo entre aspas: mantém datas/números como texto, sem
//    reinterpretação do SheetJS; o parser converte com num()/dmyToYmd). ──
const colunas = ["Data operação", "Categoria", "Código Ativo", "Operação C/V", "Quantidade", "Preço unitário", "Corretora"];
const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const linhasCsv = [colunas.map(esc).join(",")];
for (const l of linhas) linhasCsv.push(colunas.map((c) => esc(l[c])).join(","));
const csv = "﻿" + linhasCsv.join("\r\n") + "\r\n"; // BOM UTF-8 + CRLF
fs.writeFileSync(saida, csv, "utf8");

// ── Relatório ───────────────────────────────────────────────────
console.log(`[fase2] lidas ${ops.length} operações`);
console.log(`[fase2] geradas ${linhas.length} linhas | puladas ${puladas.length} (eventos/sem dados)`);
console.log(`[fase2] por categoria:`, porCategoria);
if (tickersUsd.size) console.log(`[fase2] ⚠ ${tickersUsd.size} ativo(s) em US$ entram rotulados como BRL: ${[...tickersUsd].join(", ")}`);
const tiposPulados = [...new Set(puladas.map((o) => o.type))];
if (tiposPulados.length) console.log(`[fase2] tipos pulados:`, tiposPulados.join(", "));
console.log(`[fase2] ✅ arquivo: ${saida}`);
console.log(`[fase2] importe-o na tela Importar/Exportar (aceita .csv) e escolha sua conta de investimento.`);
