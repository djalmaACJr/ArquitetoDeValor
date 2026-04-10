@echo off
setlocal enabledelayedexpansion

cd /d C:\Pessoal\ArquitetoDeValor

echo.
echo ================================================
echo   ARQUITETO DE VALOR - TESTES AUTOMATIZADOS
echo ================================================
echo.
echo Escolha o modulo a testar:
echo.
echo   1. Todos os modulos
echo   2. Contas
echo   3. Categorias
echo   4. Transacoes
echo   5. Transferencias
echo   6. Configurar nivel de logs
echo   7. Sair
echo.
set /p opcao="Digite a opcao (1-7): "

if "%opcao%"=="1" goto TODOS
if "%opcao%"=="2" goto CONTAS
if "%opcao%"=="3" goto CATEGORIAS
if "%opcao%"=="4" goto TRANSACOES
if "%opcao%"=="5" goto TRANSFERENCIAS
if "%opcao%"=="6" goto CONFIG_LOG
if "%opcao%"=="7" goto FIM
echo Opcao invalida.
goto FIM

:CONFIG_LOG
echo.
echo ================================================
echo   Configurar Nivel de Logs nas Edge Functions
echo ================================================
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
echo Aplicando configuracao no Supabase...
supabase secrets set --project-ref ftpelncgrakpphytfrfo LOG_LEVEL=%LOG_LEVEL% ENVIRONMENT=test
echo.
echo Configuracao aplicada! Aguardando propagacao (5 segundos)...
timeout /t 5 /nobreak >nul
echo.
echo Logs configurados com sucesso!
echo.
pause
goto MENU_PRINCIPAL

:TODOS
set MODULO=
set LABEL=Todos os modulos
goto RODAR

:CONTAS
set MODULO=tests/contas.test.ts
set LABEL=Modulo: Contas
goto RODAR

:CATEGORIAS
set MODULO=tests/categorias.test.ts
set LABEL=Modulo: Categorias
goto RODAR

:TRANSACOES
set MODULO=tests/transacoes.test.ts
set LABEL=Modulo: Transacoes
goto RODAR

:TRANSFERENCIAS
set MODULO=tests/transferencias.test.ts
set LABEL=Modulo: Transferencias
goto RODAR

:MENU_PRINCIPAL
echo.
echo ================================================
echo   ARQUITETO DE VALOR - TESTES AUTOMATIZADOS
echo ================================================
echo.
echo Escolha o modulo a testar:
echo.
echo   1. Todos os modulos
echo   2. Contas
echo   3. Categorias
echo   4. Transacoes
echo   5. Transferencias
echo   6. Configurar nivel de logs
echo   7. Sair
echo.
set /p opcao="Digite a opcao (1-7): "

if "%opcao%"=="1" goto TODOS
if "%opcao%"=="2" goto CONTAS
if "%opcao%"=="3" goto CATEGORIAS
if "%opcao%"=="4" goto TRANSACOES
if "%opcao%"=="5" goto TRANSFERENCIAS
if "%opcao%"=="6" goto CONFIG_LOG
if "%opcao%"=="7" goto FIM
echo Opcao invalida.
goto MENU_PRINCIPAL

:RODAR
if not exist test-results mkdir test-results

for /f "tokens=1-3 delims=/" %%a in ("%date%") do (
  set DIA=%%a
  set MES=%%b
  set ANO=%%c
)
for /f "tokens=1-2 delims=:." %%a in ("%time%") do (
  set HH=%%a
  set MM=%%b
)
set HH=%HH: =0%
set ARQUIVO=test-results\resultado_%ANO%-%MES%-%DIA%_%HH%-%MM%.txt

echo.
echo ================================================
echo   Executando: %LABEL%
echo ================================================
echo.
echo Resultado sera salvo em: %ARQUIVO%
echo.

if "%MODULO%"=="" (
  npx jest --runInBand --verbose 2>&1 | powershell -Command "$input | Tee-Object -FilePath '%ARQUIVO%'"
) else (
  npx jest %MODULO% --runInBand --verbose 2>&1 | powershell -Command "$input | Tee-Object -FilePath '%ARQUIVO%'"
)

echo.
echo ================================================
echo   Resultado salvo em: %ARQUIVO%
echo ================================================
echo.

:FIM
echo.
echo Pressione qualquer tecla para sair...
pause >nul
endlocal