@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

rem Define o secret SEC_CONTACT_EMAIL nas Edge Functions do Supabase.
rem A SEC (EDGAR) exige um contato no User-Agent e devolve 403 sem ele; a funcao
rem `investimentos` monta o User-Agent como "ArquitetoDeValor/7.8 (<este e-mail>)".
rem Sem o secret, so a fonte de stocks/REITs fica desligada (sem erro).
rem Use um e-mail de contato de sua escolha - ele aparece nos logs da SEC.

set PROJECT_REF=ftpelncgrakpphytfrfo

echo ================================
echo   SEC_CONTACT_EMAIL
echo ================================
echo.
echo Contato enviado no User-Agent das consultas ao EDGAR (SEC).
echo.
set /p SEC_EMAIL="E-mail de contato: "

if "%SEC_EMAIL%"=="" (
  echo Nenhum e-mail informado. Nada foi alterado.
  pause
  goto fim
)
echo %SEC_EMAIL%| findstr /r /c:"^[^ @]*@[^ @]*\.[^ @]*$" >nul
if errorlevel 1 (
  echo "%SEC_EMAIL%" nao parece um e-mail valido. Nada foi alterado.
  pause
  goto fim
)

echo.
echo Sera definido: SEC_CONTACT_EMAIL=%SEC_EMAIL%  (projeto %PROJECT_REF%)
set /p confirma="Aplicar? (s/N): "
if /i not "%confirma%"=="s" (
  echo Cancelado. Nenhuma alteracao feita.
  pause
  goto fim
)

echo.
supabase secrets set SEC_CONTACT_EMAIL="%SEC_EMAIL%" --project-ref %PROJECT_REF%
if errorlevel 1 (
  echo.
  echo [ERRO] Falha ao definir o secret. Confira o login: supabase login
  pause
  goto fim
)

echo.
echo Secret definido. Conferindo (so os nomes aparecem, nunca os valores):
supabase secrets list --project-ref %PROJECT_REF% | findstr /i "SEC_CONTACT_EMAIL"
echo.
echo Pronto. As Edge Functions leem o novo valor na proxima invocacao
echo (nao precisa redeployar).
pause

:fim
endlocal
