---
name: liberar-versao
description: Libera uma nova versão do Arquiteto de Valor (bump de versão, Sobre, docs, commit, merge em main/develop, tag, push, migrations, deploy das Edge Functions, OTA Android e conferência da CI). Use quando o usuário pedir "liberar/lançar/publicar a versão X.Y.Z" ou "fazer o deploy/merge da versão".
argument-hint: "<X.Y.Z> [resumo das mudanças]"
---

# Liberação de versão — Arquiteto de Valor

Argumento: a nova versão (`X.Y.Z`). Se faltar, pergunte. Formato: X = features, Y = correções/hotfixes, Z = tentativas (ver `version.ts`).
Ações externas (push, deploy, OTA) só com pedido explícito de liberação do usuário — o pedido de "liberar a versão" já autoriza as etapas 5–8; nunca force-push nem pule hooks.

## 1. Pré-checagem
- `git status` limpo ou só com as mudanças da versão; anote a branch atual (`release/vX.Y` ou feature).
- `git log <última tag>..HEAD --oneline` para montar o resumo das novidades (`git tag | tail`).
- Rodar em `FrontEnd/`: `npx tsc -b`, `npx eslint <arquivos alterados>` e `npm run build`. Testes Jest/E2E rodam na CI da `develop` (etapa 8); rode localmente só os afetados (`npx jest --runInBand tests/<arquivo>`).

## 2. Versão e histórico
- `version.ts` (raiz): `APP_VERSION`, `current.date` (AAAA-MM-DD, **hoje**) e `current.description` (1 frase).
- `FrontEnd/src/pages/SobrePage.tsx`:
  - mover o detalhe da versão antiga (bloco `{/* Detalhe das novidades desta versão (...) */}`) para um novo item no **topo** de `VERSOES_ANTERIORES` (`versao: 'X.Y'`, `data`, `titulo`, `icone`, `itens`);
  - reescrever o bloco "desta versão" com as novidades da nova (itens `{ t: 'emoji título', d: 'descrição' }`, em linguagem de usuário, não técnica).
- Se a mudança altera comportamento documentado, atualizar `CLAUDE.md` / `ARCHITECTURE.md` / `BUSINESS_RULES.md` / `README.md`.
- Android (só se for gerar APK novo): `FrontEnd/android/app/build.gradle` → `versionName` = `APP_VERSION` e `versionCode` +1. Para OTA, não precisa.

## 3. Commit
- Mensagem: `Versão X.Y.Z: <resumo>` + bullets; terminar com a linha `Co-Authored-By` do system reminder.
- `git add` dos arquivos da versão (incluir migrations novas não rastreadas).

## 4. Merge (fluxo do projeto)
```bash
git checkout main
git merge --no-ff <branch-da-versão> -m "Merge release X.Y.Z"
git tag vX.Y.Z
git checkout develop
git merge main
```
Conflitos: resolver olhando os dois lados; nunca descartar trabalho alheio sem perguntar.

## 5. Push
```bash
git push origin main develop vX.Y.Z
```
O push na `develop` dispara a CI (`backend-api-tests`, `frontend-e2e`, `frontend-quality`).

## 6. Banco (se houver migration nova em `supabase/migrations/`)
- `supabase migration list` — confira que só as suas estão pendentes.
- `supabase db push --include-all`. Migrations devem ser idempotentes. Se a migration alterar RLS/funções, rode antes o teste de API correspondente.
- Depois de aplicada, mover o arquivo para `supabase/migrations/Aplicados/` (padrão do repo) em um commit seguinte.

## 7. Deploy
- **Edge Functions alteradas** (só as que mudaram em `supabase/functions/`, incluindo `_shared/` → redeploy de quem o usa):
  `supabase functions deploy <modulo> --project-ref ftpelncgrakpphytfrfo` (mapa de módulos em `deploy.bat`; `1` = todos).
- **Web**: publicar o build de `FrontEnd/dist` conforme o hosting atual (confirme com o usuário se não souber como é publicado).
- **Android OTA** (mudanças só de React): `cd FrontEnd && npm run publish:ota` — usa `service_role` do `.env` da raiz; **peça confirmação** antes. Mudanças nativas (manifest, plugins) exigem APK novo (`instalar_android.bat`).

## 8. Conferência
- `gh run list --limit 6` → aguardar os 3 workflows do commit de merge da `develop`; reportar resultado de cada um (a suíte de API leva ~30 min). Falha: investigar a causa raiz (ver notas de CI no `CLAUDE.md`), não relançar às cegas.
- Smoke no app: Sobre mostra a nova versão; abrir a tela afetada.

## 9. Relato final
Resumir: versão, commit/tag, o que foi deployado, estado da CI e o que ficou pendente (ex.: web/OTA não publicados). Não afirmar "no ar" sem ter confirmado cada etapa.
