@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ================================
echo   DEPLOY - Supabase Functions
echo ================================
echo.
echo Escolha o modo de deploy:
echo   1 - Todos os modulos
echo   2 - contas
echo   3 - categorias
echo   4 - transacoes
echo   5 - transferencias
echo   6 - limpar
echo   7 - Configurar nivel de logs
echo   8 - Deploy com --debug (usar nesta maquina)
echo.
set /p opcao="Digite a opcao desejada (1-8): "

if "%opcao%"=="1" goto todos
if "%opcao%"=="2" goto contas
if "%opcao%"=="3" goto categorias
if "%opcao%"=="4" goto transacoes
if "%opcao%"=="5" goto transferencias
if "%opcao%"=="6" goto limpar
if "%opcao%"=="7" goto config_log
if "%opcao%"=="8" goto debug_mode
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
echo   6 - limpar
echo.
set /p mod_debug="Digite o modulo (1-6): "

if "%mod_debug%"=="1" goto debug_todos
if "%mod_debug%"=="2" goto debug_contas
if "%mod_debug%"=="3" goto debug_categorias
if "%mod_debug%"=="4" goto debug_transacoes
if "%mod_debug%"=="5" goto debug_transferencias
if "%mod_debug%"=="6" goto debug_limpar
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

:debug_limpar
echo.
echo [DEPLOY --debug] limpar...
supabase functions deploy limpar --project-ref ftpelncgrakpphytfrfo --debug
echo [OK] limpar deployed
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
echo [DEPLOY --debug] limpar...
supabase functions deploy limpar --project-ref ftpelncgrakpphytfrfo --debug
echo.
echo [OK] Todos os modulos deployados com --debug
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

:limpar
echo.
echo [DEPLOY] limpar...
supabase functions deploy limpar --project-ref ftpelncgrakpphytfrfo
echo [OK] limpar deployed
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
echo [DEPLOY] limpar...
supabase functions deploy limpar --project-ref ftpelncgrakpphytfrfo
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
