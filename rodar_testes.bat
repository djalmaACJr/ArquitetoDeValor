@echo off
setlocal enabledelayedexpansion

cd /d C:\Pessoal\ArquitetoDeValor

:MENU_PRINCIPAL
echo.
echo ================================================
echo   ARQUITETO DE VALOR - TESTES AUTOMATIZADOS
echo ================================================
echo.
echo Escolha o modulo a testar:
echo.
echo   1. Todos os modulos (com backup e restore)
echo   2. Contas
echo   3. Categorias
echo   4. Transacoes
echo   5. Transferencias
echo   6. Limpar (com backup e restore automaticos)
echo   7. Configurar nivel de logs
echo   8. Sair
echo.
set /p opcao="Digite a opcao (1-8): "

if "%opcao%"=="1" goto TODOS
if "%opcao%"=="2" goto CONTAS
if "%opcao%"=="3" goto CATEGORIAS
if "%opcao%"=="4" goto TRANSACOES
if "%opcao%"=="5" goto TRANSFERENCIAS
if "%opcao%"=="6" goto LIMPAR
if "%opcao%"=="7" goto CONFIG_LOG
if "%opcao%"=="8" goto FIM
echo Opcao invalida.
goto MENU_PRINCIPAL

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
set LABEL=Todos os modulos
echo.
echo ================================================
echo   Executando: %LABEL%
echo ================================================
echo.
call :FAZER_BACKUP
if errorlevel 1 goto FIM
call :RODAR_TODOS
call :FAZER_RESTORE
goto MENU_APOS

:CONTAS
set MODULO=tests/01_contas.test.ts
set LABEL=Modulo: Contas
goto RODAR_SIMPLES

:CATEGORIAS
set MODULO=tests/02_categorias.test.ts
set LABEL=Modulo: Categorias
goto RODAR_SIMPLES

:TRANSACOES
set MODULO=tests/03_transacoes.test.ts
set LABEL=Modulo: Transacoes
goto RODAR_SIMPLES

:TRANSFERENCIAS
set MODULO=tests/04_transferencias.test.ts
set LABEL=Modulo: Transferencias
goto RODAR_SIMPLES

:LIMPAR
echo.
echo ================================================
echo   ATENCAO: Teste de Limpeza
echo ================================================
echo.
echo Este teste vai APAGAR todos os dados do usuario
echo de teste. Um backup sera feito automaticamente
echo antes e um restore sera feito apos os testes.
echo.
set /p confirma="Tem certeza? (S/N): "
if /i not "%confirma%"=="S" (
  echo Cancelado.
  goto MENU_PRINCIPAL
)
set MODULO=tests/99_limpar.test.ts
set LABEL=Modulo: Limpar
echo.
echo ================================================
echo   Executando: %LABEL%
echo ================================================
echo.
call :FAZER_BACKUP
if errorlevel 1 goto FIM
call :RODAR_MODULO
call :FAZER_RESTORE
goto MENU_APOS

:RODAR_SIMPLES
echo.
echo ================================================
echo   Executando: %LABEL%
echo ================================================
echo.
call :RODAR_MODULO
goto MENU_APOS

:: ── Subrotinas ────────────────────────────────────────────────────

:FAZER_BACKUP
echo   Fazendo backup dos dados...
npx ts-node -r dotenv/config tests/backup.ts
if errorlevel 1 (
  echo.
  echo   ERRO no backup! Abortando testes por seguranca.
  exit /b 1
)
exit /b 0

:FAZER_RESTORE
echo.
echo   Restaurando dados...
npx ts-node -r dotenv/config tests/restore.ts
exit /b 0

:RODAR_MODULO
if not exist test-results mkdir test-results
call :GERAR_TIMESTAMP
set ARQUIVO=test-results\resultado_%ANO%-%MES%-%DIA%_%HH%-%MM%.txt
echo   Resultado sera salvo em: %ARQUIVO%
echo.
npx jest %MODULO% --runInBand --verbose 2>&1 | powershell -Command "$input | Tee-Object -FilePath '%ARQUIVO%'"
echo.
echo   Resultado salvo em: %ARQUIVO%
exit /b 0

:RODAR_TODOS
if not exist test-results mkdir test-results
call :GERAR_TIMESTAMP
set ARQUIVO=test-results\resultado_%ANO%-%MES%-%DIA%_%HH%-%MM%.txt
echo   Resultado sera salvo em: %ARQUIVO%
echo.
npx jest --runInBand --verbose 2>&1 | powershell -Command "$input | Tee-Object -FilePath '%ARQUIVO%'"
echo.
echo   Resultado salvo em: %ARQUIVO%
exit /b 0

:GERAR_TIMESTAMP
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
exit /b 0

:MENU_APOS
echo.
pause
goto MENU_PRINCIPAL

:FIM
echo.
echo Pressione qualquer tecla para sair...
pause >nul
endlocal
