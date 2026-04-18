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
echo   1. Todos os modulos (com backup e restore)
echo   2. Contas
echo   3. Categorias
echo   4. Transacoes
echo   5. Transferencias
echo   6. Limpar (com backup e restore)
echo   7. Backup manual
echo   8. Restore manual
echo   9. Configurar nivel de logs
echo   0. Sair
echo.
set /p OPC="Digite a opcao (0-9): "

if "%OPC%"=="0" goto FIM
if "%OPC%"=="1" goto OPC1
if "%OPC%"=="2" goto OPC2
if "%OPC%"=="3" goto OPC3
if "%OPC%"=="4" goto OPC4
if "%OPC%"=="5" goto OPC5
if "%OPC%"=="6" goto OPC6
if "%OPC%"=="7" goto OPC7
if "%OPC%"=="8" goto OPC8
if "%OPC%"=="9" goto OPC9
echo Opcao invalida.
goto MENU

:OPC1
call backup.bat
if errorlevel 1 goto PAUSA
call :RUNTODOS
call restore.bat
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
echo.
echo ATENCAO: Este teste apagara todos os dados.
echo Um backup sera feito antes e restore depois.
echo.
set /p CONF="Tem certeza? (S/N): "
if /i "%CONF%"=="S" goto CONF6
goto MENU
:CONF6
call backup.bat
if errorlevel 1 goto PAUSA
call limpar_test.bat
call restore.bat
goto PAUSA

:OPC7
echo.
echo Fazendo backup manual...
call backup.bat
goto PAUSA

:OPC8
echo.
echo ATENCAO: Vai recriar dados a partir do ultimo backup.
set /p CONF="Tem certeza? (S/N): "
if /i "%CONF%"=="S" goto CONF8
goto MENU
:CONF8
call restore.bat
goto PAUSA

:OPC9
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
