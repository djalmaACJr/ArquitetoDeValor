@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d C:\Pessoal\ArquitetoDeValor

:MENU
echo.
echo ================================================
echo   ARQUITETO DE VALOR - TESTES AUTOMATIZADOS
echo ================================================
echo.
echo   --- Modulos de dominio ---
echo   1. Todos os modulos (dominio + seguranca)
echo   2. Contas
echo   3. Categorias
echo   4. Transacoes
echo   5. Transferencias
echo   6. Lembretes
echo   7. Assistente de Lancamentos
echo   8. Objetivos
echo  18. Investimentos
echo.
echo   --- Seguranca ---
echo  13. Todos os testes de seguranca
echo  14. RLS (isolamento entre usuarios)
echo  15. Triggers (FK cross-user, protecoes)
echo  16. RPCs (SECURITY INVOKER)
echo  17. Auth + CORS
echo.
echo   --- Manutencao ---
echo   9. Limpar (com backup e restore)
echo  10. Backup manual
echo  11. Restore manual
echo  12. Configurar nivel de logs
echo.
echo   0. Sair
echo.
set /p OPC="Digite a opcao (0-18): "

if "%OPC%"=="0"  goto FIM
if "%OPC%"=="1"  goto OPC1
if "%OPC%"=="2"  goto OPC2
if "%OPC%"=="3"  goto OPC3
if "%OPC%"=="4"  goto OPC4
if "%OPC%"=="5"  goto OPC5
if "%OPC%"=="6"  goto OPC6
if "%OPC%"=="7"  goto OPC7
if "%OPC%"=="8"  goto OPC8
if "%OPC%"=="9"  goto OPC9
if "%OPC%"=="10" goto OPC10
if "%OPC%"=="11" goto OPC11
if "%OPC%"=="12" goto OPC12
if "%OPC%"=="13" goto OPC13
if "%OPC%"=="14" goto OPC14
if "%OPC%"=="15" goto OPC15
if "%OPC%"=="16" goto OPC16
if "%OPC%"=="17" goto OPC17
if "%OPC%"=="18" goto OPC18
echo Opcao invalida.
goto MENU

:OPC1
call :RUNTODOS
goto PAUSA

:OPC2
set TESTFILE=tests/01_contas.test.ts
call :RUNMOD
goto PAUSA

:OPC3
set TESTFILE=tests/02_categorias.test.ts
call :RUNMOD
goto PAUSA

:OPC4
set TESTFILE=tests/03_transacoes.test.ts
call :RUNMOD
goto PAUSA

:OPC5
set TESTFILE=tests/04_transferencias.test.ts
call :RUNMOD
goto PAUSA

:OPC6
set TESTFILE=tests/05_lembretes.test.ts
call :RUNMOD
goto PAUSA

:OPC7
set TESTFILE=tests/06_assistente.test.ts
call :RUNMOD
goto PAUSA

:OPC8
set TESTFILE=tests/11_objetivos.test.ts
call :RUNMOD
goto PAUSA

:OPC9
echo.
echo ATENCAO: Este teste apagara todos os dados.
echo Um backup sera feito antes e restore depois.
echo.
set /p CONF="Tem certeza? (S/N): "
if /i "%CONF%"=="S" goto CONF9
goto MENU
:CONF9
call backup.bat
if errorlevel 1 goto PAUSA
call limpar_test.bat
call restore.bat
goto PAUSA

:OPC10
echo.
echo Fazendo backup manual...
call backup.bat
goto PAUSA

:OPC11
echo.
echo ATENCAO: Vai recriar dados a partir do ultimo backup.
set /p CONF="Tem certeza? (S/N): "
if /i "%CONF%"=="S" goto CONF11
goto MENU
:CONF11
call restore.bat
goto PAUSA

:OPC12
echo.
echo   1 - DEBUG    2 - INFO    3 - ERROR    4 - NONE
set /p NL="Nivel (1-4): "
if "%NL%"=="1" set LL=debug
if "%NL%"=="2" set LL=info
if "%NL%"=="3" set LL=error
if "%NL%"=="4" set LL=none
echo Aplicando...
supabase secrets set --project-ref ftpelncgrakpphytfrfo LOG_LEVEL=%LL% ENVIRONMENT=test
timeout /t 5 /nobreak >nul
echo Configurado: %LL%
goto PAUSA

:OPC13
set TESTFILE=tests/07_seguranca_rls.test.ts tests/08_seguranca_triggers.test.ts tests/09_seguranca_rpc.test.ts tests/10_seguranca_auth_cors.test.ts
call :RUNMOD
goto PAUSA

:OPC14
set TESTFILE=tests/07_seguranca_rls.test.ts
call :RUNMOD
goto PAUSA

:OPC15
set TESTFILE=tests/08_seguranca_triggers.test.ts
call :RUNMOD
goto PAUSA

:OPC16
set TESTFILE=tests/09_seguranca_rpc.test.ts
call :RUNMOD
goto PAUSA

:OPC17
set TESTFILE=tests/10_seguranca_auth_cors.test.ts
call :RUNMOD
goto PAUSA

:OPC18
set TESTFILE=tests/12_investimentos.test.ts
call :RUNMOD
goto PAUSA

:RUNTODOS
if not exist test-results mkdir test-results
call :GENTS
set ARQ=test-results\resultado_%TS%.txt
echo Salvando em: %ARQ%
npx jest --runInBand --verbose 2>&1 | powershell -Command "$input | Tee-Object -FilePath '%ARQ%'"
goto :eof

:RUNMOD
if not exist test-results mkdir test-results
call :GENTS
set ARQ=test-results\resultado_%TS%.txt
echo Salvando em: %ARQ%
npx jest %TESTFILE% --runInBand --verbose 2>&1 | powershell -Command "$input | Tee-Object -FilePath '%ARQ%'"
goto :eof

:GENTS
for /f "tokens=1-3 delims=/" %%a in ("%date%") do set TS=%%c-%%b-%%a
for /f "tokens=1-2 delims=:." %%a in ("%time%") do set TS=%TS%_%%a-%%b
set TS=%TS: =0%
goto :eof

:PAUSA
echo.
pause
goto MENU

:FIM
echo.
echo Ate logo!
pause >nul
endlocal
