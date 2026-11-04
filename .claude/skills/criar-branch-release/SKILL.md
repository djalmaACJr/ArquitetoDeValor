---
name: criar-branch-release
description: Cria a branch de release `release/vX.Y.Z` a partir do estado atual (levando junto as mudanças não commitadas) e a publica no remoto, deixando tudo pronto para a skill liberar-versao. Use quando o usuário pedir "criar a branch da versão X.Y.Z", "abrir a release X.Y.Z" ou antes de liberar uma versão estando na main/develop.
argument-hint: "<X.Y.Z>"
---

# Criar branch de release — Arquiteto de Valor

Argumento: a versão (`X.Y.Z`, com ou sem `v`). Se faltar, pergunte. A `liberar-versao` só roda a partir de `release/*`; esta skill prepara esse ponto de partida. **Não** faz bump, commit, merge nem deploy.

## Passos
1. **Normalize o nome**: `release/v<X.Y.Z>` (padrão atual; ignore o `release/7.4.2` antigo sem `v`).
2. **Confira o ponto de partida**: `git branch --show-current`, `git status --short`, `git fetch origin`. Se a branch já existir (local ou `origin/release/v<X.Y.Z>`), **pare** e avise — não recrie nem sobrescreva.
3. **Crie a branch** a partir do HEAD atual: `git checkout -b release/v<X.Y.Z>`. Alterações não commitadas vão junto (entram no commit da etapa 3 da `liberar-versao`). Se o HEAD atual não for `main`/`develop`/outra release já integrada, avise de onde a branch partiu.
4. **Publique só se o usuário pedir** (`git push -u origin release/v<X.Y.Z>`, sem force). A `liberar-versao` também publica sozinha quando necessário.
5. **Relate**: nome da branch, commit de origem, e arquivos modificados/não rastreados que vieram junto. Próximo passo sugerido: `/liberar-versao <X.Y.Z>`.

## Regras
- Nunca use `-f`/`--force`, nunca apague outras branches de release.
- Sem commit automático: o commit `Versão X.Y.Z: ...` é da `liberar-versao`.
