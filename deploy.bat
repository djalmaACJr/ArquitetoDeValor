@echo off
setlocal enabledelayedexpansion

echo ================================
echo   Deploy - Supabase Functions
echo ================================
echo.
echo Escolha o modo de deploy:
echo   1 - Todos os modulos
echo   2 - contes
echo   3 - categorias
echo   4 - transacoes
echo.
set /p opcao="Digite a opcao desejada (1-4): "

if "%opcao%"=="1" goto todos
if "%opcao%"=="2" goto contas
if "%opcao%"=="3" goto categorias
if "%opcao%"=="4" goto transacoes

echo Opcao invalida! & pause & exit /b

:contas
echo.
echo Deploy contas...
supabase functions deploy contas --project-ref ftpelncgrakpphytfrfo
goto fim

:categorias
echo.
echo Deploy categorias...
supabase functions deploy categorias --project-ref ftpelncgrakpphytfrfo
goto fim

:transacoes
echo.
echo Deploy transacoes...
supabase functions deploy transacoes --project-ref ftpelncgrakpphytfrfo
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
goto fim

:fim
echo.
echo Deploy concluido!
pause
