@echo off
setlocal enabledelayedexpansion

cd /d C:\Pessoal\ArquitetoDeValor

echo.
echo ================================================
echo   Arquiteto de Valor -- Testes Automatizados
echo ================================================
echo.
echo Escolha o modulo a testar:
echo.
echo   1. Todos os modulos
echo   2. Contas
echo   3. Categorias
echo   4. Transacoes
echo   5. Sair
echo.
set /p opcao="Digite a opcao (1-5): "

if "%opcao%"=="1" goto TODOS
if "%opcao%"=="2" goto CONTAS
if "%opcao%"=="3" goto CATEGORIAS
if "%opcao%"=="4" goto TRANSACOES
if "%opcao%"=="5" goto FIM
echo Opcao invalida.
goto FIM

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
echo Executando: %LABEL%
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
pause
endlocal
