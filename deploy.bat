@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ================================
echo   DEPLOY - Supabase Functions v1.3.0
echo ================================
echo.
echo Escolha o modo de deploy:
echo   1 - Todos os modulos
echo   2 - contas
echo   3 - categorias
echo   4 - transacoes
echo   5 - transferencias
echo   6 - versao
echo   7 - limpar
echo   8 - excluir_conta
echo   9 - filtros
echo  10 - assistente
echo  11 - lembretes
echo  12 - chat_mascote
echo  13 - ia_configs
echo  14 - faturas
echo  15 - objetivos
echo  16 - Configurar nivel de logs
echo  17 - Configurar IA_KEYS_ENCRYPTION_KEY (cripto das api_keys de IA)
echo  18 - Deploy com --debug (usar nesta maquina)
echo.
set /p opcao="Digite a opcao desejada (1-18): "

if "%opcao%"=="1"  goto todos
if "%opcao%"=="2"  goto contas
if "%opcao%"=="3"  goto categorias
if "%opcao%"=="4"  goto transacoes
if "%opcao%"=="5"  goto transferencias
if "%opcao%"=="6"  goto versao
if "%opcao%"=="7"  goto limpar
if "%opcao%"=="8"  goto excluir_conta
if "%opcao%"=="9"  goto filtros
if "%opcao%"=="10" goto assistente
if "%opcao%"=="11" goto lembretes
if "%opcao%"=="12" goto chat_mascote
if "%opcao%"=="13" goto ia_configs
if "%opcao%"=="14" goto faturas
if "%opcao%"=="15" goto objetivos
if "%opcao%"=="16" goto config_log
if "%opcao%"=="17" goto config_ia_key
if "%opcao%"=="18" goto debug_mode
echo Opcao invalida! & pause & exit /b

:debug_mode
echo.
echo ================================
echo   Deploy com --debug
echo ================================
echo.
echo Qual modulo deseja deployar com --debug?
echo   1 - Todos os modulos
echo   2 - contas
echo   3 - categorias
echo   4 - transacoes
echo   5 - transferencias
echo   6 - versao
echo   7 - limpar
echo   8 - excluir_conta
echo   9 - filtros
echo  10 - assistente
echo  11 - lembretes
echo  12 - chat_mascote
echo  13 - ia_configs
echo  14 - faturas
echo  15 - objetivos
echo.
set /p mod_debug="Digite o modulo (1-15): "

if "%mod_debug%"=="1"  goto debug_todos
if "%mod_debug%"=="2"  goto debug_contas
if "%mod_debug%"=="3"  goto debug_categorias
if "%mod_debug%"=="4"  goto debug_transacoes
if "%mod_debug%"=="5"  goto debug_transferencias
if "%mod_debug%"=="6"  goto debug_versao
if "%mod_debug%"=="7"  goto debug_limpar
if "%mod_debug%"=="8"  goto debug_excluir_conta
if "%mod_debug%"=="9"  goto debug_filtros
if "%mod_debug%"=="10" goto debug_assistente
if "%mod_debug%"=="11" goto debug_lembretes
if "%mod_debug%"=="12" goto debug_chat_mascote
if "%mod_debug%"=="13" goto debug_ia_configs
if "%mod_debug%"=="14" goto debug_faturas
if "%mod_debug%"=="15" goto debug_objetivos
echo Opcao invalida! & pause & exit /b

:debug_contas
echo.
echo [DEPLOY --debug] contas...
supabase functions deploy contas --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] contas deployed
goto fim

:debug_categorias
echo.
echo [DEPLOY --debug] categorias...
supabase functions deploy categorias --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] categorias deployed
goto fim

:debug_transacoes
echo.
echo [DEPLOY --debug] transacoes...
supabase functions deploy transacoes --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] transacoes deployed
goto fim

:debug_transferencias
echo.
echo [DEPLOY --debug] transferencias...
supabase functions deploy transferencias --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] transferencias deployed
goto fim

:debug_versao
echo.
echo [DEPLOY --debug] versao...
supabase functions deploy version --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] versao deployed
goto fim

:debug_limpar
echo.
echo [DEPLOY --debug] limpar...
supabase functions deploy limpar --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] limpar deployed
goto fim

:debug_excluir_conta
echo.
echo [DEPLOY --debug] excluir_conta...
supabase functions deploy excluir_conta --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] excluir_conta deployed
goto fim

:debug_filtros
echo.
echo [DEPLOY --debug] filtros...
supabase functions deploy filtros --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] filtros deployed
goto fim

:debug_assistente
echo.
echo [DEPLOY --debug] assistente...
supabase functions deploy assistente --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] assistente deployed
goto fim

:debug_lembretes
echo.
echo [DEPLOY --debug] lembretes...
supabase functions deploy lembretes --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] lembretes deployed
goto fim

:debug_chat_mascote
echo.
echo [DEPLOY --debug] chat_mascote...
supabase functions deploy chat_mascote --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] chat_mascote deployed
goto fim

:debug_ia_configs
echo.
echo [DEPLOY --debug] ia_configs...
supabase functions deploy ia_configs --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] ia_configs deployed
goto fim

:debug_faturas
echo.
echo [DEPLOY --debug] faturas...
supabase functions deploy faturas --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] faturas deployed
goto fim

:debug_objetivos
echo.
echo [DEPLOY --debug] objetivos...
supabase functions deploy objetivos --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] objetivos deployed
goto fim

:debug_todos
echo.
echo [DEPLOY --debug] contas...
supabase functions deploy contas --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] categorias...
supabase functions deploy categorias --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] transacoes...
supabase functions deploy transacoes --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] transferencias...
supabase functions deploy transferencias --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] versao...
supabase functions deploy version --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] limpar...
supabase functions deploy limpar --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] excluir_conta...
supabase functions deploy excluir_conta --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] filtros...
supabase functions deploy filtros --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] assistente...
supabase functions deploy assistente --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] lembretes...
supabase functions deploy lembretes --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] chat_mascote...
supabase functions deploy chat_mascote --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] ia_configs...
supabase functions deploy ia_configs --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] faturas...
supabase functions deploy faturas --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [DEPLOY --debug] objetivos...
supabase functions deploy objetivos --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [OK] Todos os modulos deployados com --debug
goto fim

:config_ia_key
echo.
echo ================================
echo   IA_KEYS_ENCRYPTION_KEY
echo ================================
echo.
echo Este secret criptografa as api_keys de IA armazenadas em
echo arqvalor.usuarios.ia_configs com AES-256-GCM.
echo.
echo [!] ATENCAO: trocar este secret depois que ja houver chaves
echo     cadastradas TORNA ELAS ILEGIVEIS. Os usuarios precisarao
echo     recadastrar todas as configuracoes de IA. So defina UMA
echo     vez por ambiente.
echo.
set /p confirma_key="Continuar e definir o secret? (s/N): "
if /i not "%confirma_key%"=="s" goto fim

echo.
echo Gerando 32 bytes random (base64)...
for /f "tokens=*" %%K in ('powershell -NoProfile -Command "[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))"') do set IA_KEY=%%K

if "%IA_KEY%"=="" (
  echo [ERRO] Falha ao gerar a chave via PowerShell.
  pause
  goto fim
)

echo.
echo Chave gerada (guarde em local seguro como backup):
echo   %IA_KEY%
echo.
set /p confirma_aplica="Aplicar este valor como secret IA_KEYS_ENCRYPTION_KEY? (s/N): "
if /i not "%confirma_aplica%"=="s" (
  echo Cancelado. Nenhuma alteracao feita.
  pause
  goto fim
)

supabase secrets set --project-ref ftpelncgrakpphytfrfo IA_KEYS_ENCRYPTION_KEY=%IA_KEY%
echo.
echo [OK] IA_KEYS_ENCRYPTION_KEY configurado.
echo [LEMBRETE] Faca deploy de ia_configs e chat_mascote para usarem o novo valor.
echo.
pause
goto fim

:config_log
echo.
echo ================================
echo   Configurar Nivel de Logs
echo ================================
echo.
echo Niveis disponiveis:
echo   1 - DEBUG (detalhado - desenvolvimento)
echo   2 - INFO (importante - homologacao)
echo   3 - ERROR (apenas erros - producao)
echo   4 - NONE (sem logs)
echo.
set /p nivel_log="Digite o nivel (1-4): "

if "%nivel_log%"=="1" set LOG_LEVEL=debug
if "%nivel_log%"=="2" set LOG_LEVEL=info
if "%nivel_log%"=="3" set LOG_LEVEL=error
if "%nivel_log%"=="4" set LOG_LEVEL=none

echo.
echo Aplicando configuracao...
supabase secrets set --project-ref ftpelncgrakpphytfrfo LOG_LEVEL=%LOG_LEVEL% ENVIRONMENT=production
echo.
echo [OK] Logs configurados para: %LOG_LEVEL%
echo.
pause
goto fim

:contas
echo.
echo [DEPLOY] contas...
supabase functions deploy contas --project-ref ftpelncgrakpphytfrfo
echo [OK] contas deployed
goto fim

:categorias
echo.
echo [DEPLOY] categorias...
supabase functions deploy categorias --project-ref ftpelncgrakpphytfrfo
echo [OK] categorias deployed
goto fim

:transacoes
echo.
echo [DEPLOY] transacoes...
supabase functions deploy transacoes --project-ref ftpelncgrakpphytfrfo
echo [OK] transacoes deployed
goto fim

:transferencias
echo.
echo [DEPLOY] transferencias...
supabase functions deploy transferencias --project-ref ftpelncgrakpphytfrfo
echo [OK] transferencias deployed
goto fim

:versao
echo.
echo [DEPLOY] versao...
supabase functions deploy version --project-ref ftpelncgrakpphytfrfo
echo [OK] versao deployed
goto fim

:limpar
echo.
echo [DEPLOY] limpar...
supabase functions deploy limpar --project-ref ftpelncgrakpphytfrfo
echo [OK] limpar deployed
goto fim

:excluir_conta
echo.
echo [DEPLOY] excluir_conta...
supabase functions deploy excluir_conta --project-ref ftpelncgrakpphytfrfo
echo [OK] excluir_conta deployed
goto fim

:filtros
echo.
echo [DEPLOY] filtros...
supabase functions deploy filtros --project-ref ftpelncgrakpphytfrfo
echo [OK] filtros deployed
goto fim

:assistente
echo.
echo [DEPLOY] assistente...
supabase functions deploy assistente --project-ref ftpelncgrakpphytfrfo
echo [OK] assistente deployed
goto fim

:lembretes
echo.
echo [DEPLOY] lembretes...
supabase functions deploy lembretes --project-ref ftpelncgrakpphytfrfo
echo [OK] lembretes deployed
goto fim

:chat_mascote
echo.
echo [DEPLOY] chat_mascote...
supabase functions deploy chat_mascote --project-ref ftpelncgrakpphytfrfo
echo [OK] chat_mascote deployed
goto fim

:ia_configs
echo.
echo [DEPLOY] ia_configs...
supabase functions deploy ia_configs --project-ref ftpelncgrakpphytfrfo
echo [OK] ia_configs deployed
goto fim

:faturas
echo.
echo [DEPLOY] faturas...
supabase functions deploy faturas --project-ref ftpelncgrakpphytfrfo
echo [OK] faturas deployed
goto fim

:objetivos
echo.
echo [DEPLOY] objetivos...
supabase functions deploy objetivos --project-ref ftpelncgrakpphytfrfo
echo [OK] objetivos deployed
goto fim

:todos
echo.
echo [DEPLOY] contas...
supabase functions deploy contas --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] categorias...
supabase functions deploy categorias --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] transacoes...
supabase functions deploy transacoes --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] transferencias...
supabase functions deploy transferencias --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] versao...
supabase functions deploy version --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] limpar...
supabase functions deploy limpar --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] excluir_conta...
supabase functions deploy excluir_conta --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] filtros...
supabase functions deploy filtros --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] assistente...
supabase functions deploy assistente --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] lembretes...
supabase functions deploy lembretes --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] chat_mascote...
supabase functions deploy chat_mascote --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] ia_configs...
supabase functions deploy ia_configs --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] faturas...
supabase functions deploy faturas --project-ref ftpelncgrakpphytfrfo
echo.
echo [DEPLOY] objetivos...
supabase functions deploy objetivos --project-ref ftpelncgrakpphytfrfo
echo.
echo [OK] Todos os modulos deployados
goto fim

:fim
echo.
echo ================================
echo   Deploy concluido!
echo ================================
echo.
echo [DICA] Para ver logs em tempo real:
echo    supabase functions logs transferencias --tail --project-ref ftpelncgrakpphytfrfo
echo.
pause
