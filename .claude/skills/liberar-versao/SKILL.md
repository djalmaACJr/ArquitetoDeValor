---
name: liberar-versao
description: Libera uma nova versão do Arquiteto de Valor — bump de versão, Sobre, docs, commit, develop, deploy do backend, espera a CI da develop ficar 100% verde e só então merge na main (publicação automática do web), tag e OTA Android. Use quando o usuário pedir "liberar/lançar/publicar a versão X.Y.Z" ou "fazer o deploy/merge da versão".
argument-hint: "<X.Y.Z> [resumo das mudanças]"
---

# Liberação de versão — Arquiteto de Valor

Argumento: a nova versão (`X.Y.Z`). Se faltar, pergunte. Formato: X = features, Y = correções/hotfixes, Z = tentativas (ver `version.ts`).

**Regra de ouro: nada entra na `main` sem a CI da `develop` 100% verde.** A `main` publica o web automaticamente, então o merge nela é o ponto de liberação. Nunca force-push, nunca pule hooks, nunca relance a CI às cegas.
O pedido "liberar a versão" autoriza as etapas 1–8; `publish:ota` (etapa 10) pede confirmação.

## 1. Pré-checagem
- `git status`; anote a branch atual (feature/`release/*`) e a última tag (`git tag | tail`).
- `git log <última tag>..HEAD --oneline` para montar o resumo das novidades.
- Em `FrontEnd/`: `npx tsc -b`, `npx eslint <arquivos alterados>`, `npm run build`. Rode localmente só os testes afetados (`npx jest --runInBand tests/<arquivo>`).

## 2. Versão e histórico
- `version.ts` (raiz): `APP_VERSION`, `current.date` (AAAA-MM-DD, **hoje**), `current.description` (1 frase).
- `FrontEnd/src/pages/SobrePage.tsx`: mover o detalhe da versão antiga (bloco `{/* Detalhe das novidades desta versão (...) */}`) para o **topo** de `VERSOES_ANTERIORES` (`versao: 'X.Y'`, `data`, `titulo`, `icone`, `itens`) e reescrever o bloco da versão atual (itens `{ t: 'emoji título', d: 'descrição' }`, linguagem de usuário).
- Atualizar `CLAUDE.md` / `ARCHITECTURE.md` / `BUSINESS_RULES.md` / `README.md` se o comportamento documentado mudou.
- Android (só se for gerar APK novo): `build.gradle` → `versionName` = `APP_VERSION`, `versionCode` +1.

## 3. Commit na branch de trabalho
Mensagem `Versão X.Y.Z: <resumo>` + bullets, terminando com a linha `Co-Authored-By` do system reminder. Incluir migrations novas não rastreadas.

## 4. Develop (ainda NÃO a main)
```bash
git checkout develop
git merge --no-ff <branch-de-trabalho> -m "Merge release X.Y.Z"
git push origin develop
```
O push dispara a CI: `backend-api-tests` (~30 min, 2 jobs), `frontend-e2e` (~10–30 min), `frontend-quality`. Anote o SHA do commit.

## 5. Backend ANTES de esperar a CI
Os testes de API/E2E rodam contra o Supabase real; sem o backend novo no ar eles testam o código velho.
- Migrations novas: `supabase migration list` (só as suas pendentes) → `supabase db push --include-all`. Idempotentes. Depois mover o arquivo para `supabase/migrations/Aplicados/` (commit à parte).
- Edge Functions alteradas (incluindo as que usam `_shared/` alterado): `supabase functions deploy <modulo> --project-ref ftpelncgrakpphytfrfo` (mapa em `deploy.bat`).
- Só vale para mudanças **retrocompatíveis** (o web antigo ainda está no ar até a etapa 8). Se não forem, avise o usuário antes.
- Se o deploy acontecer depois do push da etapa 4, a CI já em andamento testou o backend velho: relance (`gh run rerun <id>`) ou faça novo push — não considere aquele resultado.

## 6. Gate: esperar a CI inteira
```bash
gh run list --branch develop --limit 6
gh run watch <id> --exit-status      # um por workflow do SHA da etapa 4
```
Use `run_in_background` para esperar (são ~30 min); não faça polling curto.
- **Todos os 3 workflows do SHA com `success`** → seguir.
- **Qualquer falha ou cancelamento** → PARE. Não faça merge na main. Leia o log (`gh run view <id> --log-failed`), identifique a causa raiz (ver notas de CI no `CLAUDE.md`: timeout por carga, `JA_AGREGADO`, concorrência na conta de teste) e relate. Corrija e volte à etapa 3/4; flaky por infraestrutura só pode ser relançada após explicar a causa ao usuário.
- Verifique que o resultado é do SHA **atual** da `develop` (`gh run list` mostra o commit), não de um anterior.

## 7. Merge na main + tag (só com o gate verde)
```bash
git checkout main
git merge --ff-only develop       # se não for ff, parar e investigar
git tag vX.Y.Z
git push origin main vX.Y.Z
```
O push na `main` publica o web automaticamente. Se `--ff-only` falhar (main recebeu commit fora da develop), não force: traga a main para a develop, repita a CI e só então volte aqui.

## 8. Pós-publicação
- Acompanhar o workflow/hosting disparado pela `main` (`gh run list --branch main`).
- Smoke: tela Sobre mostra a nova versão; abrir a tela afetada.

## 9. Android OTA (se houver mudança de React)
`cd FrontEnd && npm run publish:ota` — usa a `service_role` do `.env` da raiz; **peça confirmação** antes. Mudanças nativas exigem APK novo (`instalar_android.bat`).

## 10. Relato final
Versão, SHA/tag, o que foi deployado (migrations, funções), resultado de CADA workflow da CI, estado da publicação do web e do OTA. Não afirmar "no ar" sem ter confirmado cada etapa; listar o que ficou pendente.
