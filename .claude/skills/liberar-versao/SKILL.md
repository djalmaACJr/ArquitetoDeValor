---
name: liberar-versao
description: Libera uma nova versão do Arquiteto de Valor — bump de versão, Sobre, docs, commit, develop, deploy do backend, espera a CI da develop ficar 100% verde e só então merge na main (publicação automática do web), tag e OTA Android. Use quando o usuário pedir "liberar/lançar/publicar a versão X.Y.Z" ou "fazer o deploy/merge da versão".
argument-hint: "<X.Y.Z> [resumo das mudanças]"
---

# Liberação de versão — Arquiteto de Valor

Argumento: a nova versão (`X.Y.Z`). Se faltar, pergunte. Formato: X = features, Y = correções/hotfixes, Z = tentativas (ver `version.ts`).

**Regra de ouro: nada entra na `main` sem a CI da `develop` 100% verde.** A `main` publica o web automaticamente, então o merge nela é o ponto de liberação. Nunca force-push, nunca pule hooks, nunca relance a CI às cegas.
O pedido "liberar a versão" autoriza as etapas 0–8; `publish:ota` (etapa 9) pede confirmação.

## Passo inicial — Guarda de branch (antes de tudo)
Execute **antes de qualquer outra etapa**; se falhar (exceto os casos "à frente" e "branch inexistente no remoto" abaixo, resolvidos com push), emita o aviso e **pare o processo** (nada de revisão, bump ou commit):
1. **Só em branch de release**: `git branch --show-current` deve casar com `release/*`. Caso contrário, avise "A liberação só pode ocorrer a partir de uma branch `release/*` (atual: `<branch>`)" e pare.
2. **Local atualizada com a remota**: `git fetch origin` e compare `git rev-list --left-right --count HEAD...origin/<branch>`. Resultado:
   - **Igual**: segue.
   - **À frente** (só commits locais não enviados): faça o push automático (`git push origin <branch>`, sem force) e siga. Se houver mudanças não commitadas, elas entram no commit da etapa 3 como de costume.
   - **Atrás** (pull pendente) ou **divergida**: avise qual é o caso e **pare** — não faça pull/merge/rebase por conta própria; o usuário resolve e relança.
   - **Branch inexistente no remoto** (`origin/<branch>` não existe): publique com `git push -u origin <branch>` (sem force) e siga. Se houver mudanças não commitadas, elas entram no commit da etapa 3 como de costume.
   - **Sem remote `origin` configurado**: avise e pare.
3. Working tree com mudanças não commitadas não bloqueia (entram no commit da etapa 3), mas cite no aviso/relato.

## 0. Revisão de segurança e performance (antes de qualquer bump)
Revisar o diff desde a última tag (`git diff <última tag>...HEAD`) **antes** de mexer em versão. Se achar problema, corrija ou relate e pergunte ao usuário se segue; não prossiga em silêncio com achado aberto.
- **Segurança**: invocar `/security-review` e `/code-review` sobre o diff. Checklist do projeto:
  - toda tabela/rota nova respeita `user_id`/RLS; nenhum `service_role`/`dbAdmin()` em rota de usuário; nada de policy de SELECT em `usuarios` para outro usuário;
  - rotas que usam RLS de admin (`trilha_auditoria`, `cron_execucoes`) filtram a própria visão por padrão — admin só vê dados de outros em `/admin/*`;
  - segredos/chaves nunca no bundle (`FrontEnd/.env` é público); `X-Contexto-User-Id` só como dica, validado por `resolverContexto()`;
  - tabela nova de dado do usuário entra em backup/restore (`ImportExportPage.tsx`) e em `fn_excluir_dados_usuario`.
- **Performance**:
  - queries novas filtram por colunas **indexadas** (confira `idx_*` nas migrations; para trilha/transações use `user_id` + coluna de ordenação); evite `.or()` em JSONB, `select *` e listas sem `limit`/paginação;
  - policies RLS com função por linha (`fn_agregado_tem_acesso`) devem filtrar primeiro o dono (ver `20261016000001`);
  - front: `staleTime`/invalidação coerentes, sem refetch em loop, listas grandes paginadas, chunk novo pesado só com `lazy`;
  - migration pesada (índice em tabela grande, backfill): avaliar `CREATE INDEX CONCURRENTLY`/janela e tempo de lock.
- **Testes**: para cada mudança do diff, verificar se exige **novos testes** ou **ajuste dos existentes** (API em `tests/`, E2E em `FrontEnd/e2e/tests/`) — comportamento alterado de UI/rota quebra testes antigos (ex.: E2E-DB16). Criar/atualizar antes do bump, para a CI da develop já validar.
- Registrar no relato final o que foi revisado e os achados (corrigidos ou aceitos), e quais testes foram criados/alterados (ou por que nenhum).

## 1. Pré-checagem
- `git status`; anote a branch atual (já validada como `release/*` no passo inicial) e a última tag (`git tag | tail`).
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

## 5b. Hints e warnings do banco (logo após migrations e deploys; rode também sem migration, durante a espera da CI)
`supabase db advisors --linked --type all --level info --output-format json > <scratchpad>/adv.json` (security + performance do projeto linkado). Resuma por `name`/`level` e **compare com o baseline aceito** (abaixo): só item **novo** ou de **nível maior** bloqueia.
- **Baseline aceito (out/2026)** — não reabrir sem motivo:
  - `multiple_permissive_policies` (WARN, ~259): consequência do desenho de agregados (policy permissiva extra por tabela, nunca reescreve a do dono). Só preocupa se aparecer em tabela **nova** ou se o total crescer sem migration de policy.
  - `authenticated_security_definer_function_executable` (WARN, ~18): RPCs `fn_*` de agregados/saldos/exclusão são chamadas pelo app e validam `auth.uid()` internamente (coberto por `09_seguranca_rpc`). RPC **nova** `SECURITY DEFINER` exposta a `authenticated` precisa validar `auth.uid()` e entrar na revisão; função de infraestrutura/cron nunca deve ser exposta (REVOKE).
  - `unused_index`, `unindexed_foreign_keys` (INFO), `auth_db_connections_absolute` (INFO), `extension_in_public` (`pg_net`), `function_search_path_mutable` (`fn_default_criado_por`), `auth_rls_initplan` (`pol_objetivos_agregado_insert`): dívida conhecida, a tratar em release própria.
- Achado **novo** (ex.: `rls_disabled_in_public`, `policy_exists_rls_disabled`, tabela sem RLS, `auth_rls_initplan` em policy criada nesta release, FK nova sem índice em tabela grande): corrija com migration idempotente (volta à etapa 3/4) ou relate ao usuário e pergunte se segue.
- Registrar no relato final: contagem por tipo/nível, o que é novo vs baseline.

## 6. Gate: esperar a CI inteira
```bash
gh run list --branch develop --limit 6
gh run watch <id> --exit-status      # um por workflow do SHA da etapa 4
```
Use `run_in_background` para esperar (são ~30 min); não faça polling curto.
- **Todos os 3 workflows do SHA com `success`** → seguir.
- **Qualquer falha ou cancelamento** → PARE o merge na main e leia o log (`gh run view <id> --log-failed`) para classificar a causa:
  - **Timeout do banco / limite de carga** (`statement timeout`/`57014`, `Exceeded timeout`, `canceling statement`, hooks `beforeAll` estourando, 429/rate limit, limite de convites/hora): é infraestrutura (compute burstable do Supabase, ver `CLAUDE.md`). **Avise o usuário** (causa + qual teste) e **espere o limite se recuperar antes de repetir**: 10 min para timeout/CPU; 60 min se for limite por hora (convites, rate limit). Depois `gh run rerun <id> --failed` (ou o run inteiro se o job dependente rodar em sequência) e volte a esperar. No máximo **2 repetições** por causa — se persistir, PARE: trate como problema real (consulta lenta nova? veja a etapa 0) e relate ao usuário.
  - **Falha de teste/lint/build** (assertion, tipo, regressão): é bug. Não repita — corrija, volte à etapa 3/4.
  - **Concorrência na conta de teste** (`JA_AGREGADO`, outra rodada em andamento): espere a outra rodada terminar e repita (mesma regra de no máximo 2 repetições).
  Nunca repita às cegas nem sem avisar; cada repetição precisa de uma causa explicada ao usuário.
- Para esperar o tempo de recuperação use `ScheduleWakeup`/espera em segundo plano, não `sleep` em loop curto.
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

## 10. Limpeza da branch de release
Se a versão saiu de uma `release/*` já mergeada na `main`, exclua-a local e remotamente: `git branch -d <branch>` e `git push origin --delete <branch>`. Só a branch desta versão; não apague outras sem pedir.

## 11. Relato final
Achados da revisão (etapa 0), versão, SHA/tag, o que foi deployado (migrations, funções), resultado de CADA workflow da CI, estado da publicação do web e do OTA. Não afirmar "no ar" sem ter confirmado cada etapa; listar o que ficou pendente.
