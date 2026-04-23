@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
cd /d "%~dp0FrontEnd"

:MENU
echo.
echo ================================================
echo   ARQUITETO DE VALOR - TESTES E2E (PLAYWRIGHT)
echo ================================================
echo.
echo   1. Todos os testes
echo   2. Dashboard
echo   3. Extrato (Lancamentos)
echo   4. Contas
echo   5. Categorias
echo   6. Relatorios
echo   7. Navegacao e Persistencia
echo   8. Abrir relatorio HTML do ultimo run
echo   9. Modo visual (--ui)
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
set TESTFILE=
call :RUNTEST
goto PAUSA

:OPC2
set TESTFILE=e2e/tests/01_dashboard.spec.ts
call :RUNTEST
goto PAUSA

:OPC3
set TESTFILE=e2e/tests/02_extrato.spec.ts
call :RUNTEST
goto PAUSA

:OPC4
set TESTFILE=e2e/tests/03_contas.spec.ts
call :RUNTEST
goto PAUSA

:OPC5
set TESTFILE=e2e/tests/04_categorias.spec.ts
call :RUNTEST
goto PAUSA

:OPC6
set TESTFILE=e2e/tests/05_relatorios.spec.ts
call :RUNTEST
goto PAUSA

:OPC7
set TESTFILE=e2e/tests/06_navegacao.spec.ts
call :RUNTEST
goto PAUSA

:OPC8
echo.
echo Abrindo relatorio HTML...
npm run test:e2e:report
goto PAUSA

:OPC9
echo.
echo Iniciando modo visual (--ui)...
echo Certifique-se que o frontend esta rodando em http://localhost:5173
echo.
npm run test:e2e:ui
goto PAUSA

:RUNTEST
if not exist e2e\test-results mkdir e2e\test-results
call :GENTS
set ARQ=e2e\test-results\resultado_%TS%.txt
echo.
echo Verificando dependencias...
if not exist node_modules\@playwright (
    echo Instalando Playwright...
    npm install @playwright/test@^1.50.0 dotenv@^16.4.5
    npx playwright install
)
echo.
echo Certifique-se que o frontend esta rodando em http://localhost:5173
echo Salvando resultado em: %ARQ%
echo.

if "%TESTFILE%"=="" (
    npm run test:e2e 2>&1 | powershell -Command "$input | Tee-Object -FilePath '%ARQ%'"
) else (
    npm run test:e2e -- %TESTFILE% 2>&1 | powershell -Command "$input | Tee-Object -FilePath '%ARQ%'"
)
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
