@echo off
setlocal enabledelayedexpansion

echo ================================
echo   Deploy - Supabase Functions
echo ================================
echo.
echo Escolha o modo de deploy:
echo   1 - Todos os modulos
echo   2 - contas
echo   3 - categorias
echo   4 - transacoes
echo   5 - transferencias
echo   6 - Configurar nivel de logs
echo.
set /p opcao="Digite a opcao desejada (1-6): "

if "%opcao%"=="1" goto todos
if "%opcao%"=="2" goto contas
if "%opcao%"=="3" goto categorias
if "%opcao%"=="4" goto transacoes
if "%opcao%"=="5" goto transferencias
if "%opcao%"=="6" goto config_log
echo Opcao invalida! & pause & exit /b

:config_log
echo.
echo ================================================
echo   Configurar Nivel de Logs
echo ================================================
echo.
echo Niveis disponiveis:
echo   1 - DEBUG (detalhado - desenvolvimento)
echo   2 - INFO  (importante - homologacao)
echo   3 - ERROR (apenas erros - producao)
echo   4 - NONE  (sem logs)
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
echo ✅ Logs configurados para: %LOG_LEVEL%
echo.
pause
goto fim

:contas
echo.
echo Deploy contas...
supabase functions deploy contas --project-ref ftpelncgrakpphytfrfo
echo ✅ contas deployed
goto fim

:categorias
echo.
echo Deploy categorias...
supabase functions deploy categorias --project-ref ftpelncgrakpphytfrfo
echo ✅ categorias deployed
goto fim

:transacoes
echo.
echo Deploy transacoes...
supabase functions deploy transacoes --project-ref ftpelncgrakpphytfrfo
echo ✅ transacoes deployed
goto fim

:transferencias
echo.
echo Deploy transferencias...
supabase functions deploy transferencias --project-ref ftpelncgrakpphytfrfo
echo ✅ transferencias deployed
goto fim

:todos
echo.
echo Deploy contas...
supabase functions deploy contas --project-ref ftpelncgrakpphytfrfo
echo.
echo Deploy categorias...
supabase functions deploy categorias --project-ref ftpelncgrakpphytfrfo
echo.
echo Deploy transacoes...
supabase functions deploy transacoes --project-ref ftpelncgrakpphytfrfo
echo.
echo Deploy transferencias...
supabase functions deploy transferencias --project-ref ftpelncgrakpphytfrfo
echo.
echo ✅ Todos os modulos deployados
goto fim

:fim
echo.
echo ================================================
echo   Deploy concluido!
echo ================================================
echo.
echo 📊 Para ver logs em tempo real:
echo    supabase functions logs transferencias --tail --project-ref ftpelncgrakpphytfrfo
echo.
pause
endlocal