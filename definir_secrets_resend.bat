@echo off
chcp 65001 >nul
setlocal

rem Define os secrets do Resend usados pela Edge Function `entrada_email` (e-mail de entrada, v8.0.0):
rem   RESEND_API_KEY         chave da API (re_...) - a funcao usa para ler o corpo do e-mail recebido
rem   RESEND_WEBHOOK_SECRET  segredo de assinatura do webhook (whsec_...) - mostrado no painel do Resend
rem                          depois de criar o webhook (Webhooks > Add Webhook)
rem O valor e digitado oculto (nao aparece na tela nem fica no historico) e nunca e exibido de volta.

set PROJECT_REF=ftpelncgrakpphytfrfo

echo ================================
echo   Secrets do Resend
echo ================================
echo.
echo   1 - RESEND_API_KEY        (chave da API, comeca com re_)
echo   2 - RESEND_WEBHOOK_SECRET (segredo do webhook, comeca com whsec_)
echo   3 - Os dois, em sequencia
echo.
set /p OPCAO="Opcao: "

if "%OPCAO%"=="1" ( call :definir RESEND_API_KEY re_ & goto fim )
if "%OPCAO%"=="2" ( call :definir RESEND_WEBHOOK_SECRET whsec_ & goto fim )
if "%OPCAO%"=="3" (
  call :definir RESEND_API_KEY re_
  call :definir RESEND_WEBHOOK_SECRET whsec_
  goto fim
)
echo Opcao invalida. Nada foi alterado.
goto fim

rem --- %1 = nome do secret, %2 = prefixo esperado ---
:definir
set "VALOR="
echo.
echo -- %~1 --
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "$s = Read-Host -AsSecureString 'Cole o valor (oculto)'; [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))"`) do set "VALOR=%%i"

if not defined VALOR (
  echo Nenhum valor informado. %~1 nao foi alterado.
  goto :eof
)
echo %VALOR%| findstr /b /c:"%~2" >nul
if errorlevel 1 (
  echo O valor nao comeca com "%~2" - parece o item errado. %~1 nao foi alterado.
  set "VALOR="
  goto :eof
)
echo Valor recebido (%~2... oculto). Projeto %PROJECT_REF%.
set /p confirma="Aplicar %~1? (s/N): "
if /i not "%confirma%"=="s" (
  echo Cancelado. %~1 nao foi alterado.
  set "VALOR="
  goto :eof
)
supabase secrets set %~1="%VALOR%" --project-ref %PROJECT_REF%
if errorlevel 1 (
  echo [ERRO] Falha ao definir %~1. Confira o login: supabase login
) else (
  echo %~1 definido. Conferindo (so o nome aparece, nunca o valor^):
  supabase secrets list --project-ref %PROJECT_REF% | findstr /i "%~1"
)
set "VALOR="
goto :eof

:fim
echo.
echo As Edge Functions leem o novo valor na proxima invocacao (nao precisa redeployar).
pause
endlocal
