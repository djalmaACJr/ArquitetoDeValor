@echo off
set "ROOT=%~dp0"
set "ADB=C:\Users\djalma\AppData\Local\Android\Sdk\platform-tools\adb.exe"

echo ======================================================
echo    ARQUITETO DE VALOR - INSTALADOR ANDROID (USB)
echo ======================================================

:: 1. Compilar o Front-End
echo [1/4] Compilando Front-End (Vite)...
cd /d "%ROOT%FrontEnd"
call npm run build
if %errorlevel% neq 0 goto error

:: 2. Sincronizar com o Android (sync, nao copy: tambem atualiza o registro
:: de plugins nativos no Gradle - sem isso, um plugin novo instalado via npm
:: nao aparece no build ate alguem rodar "cap sync" manualmente)
echo [2/4] Sincronizando arquivos e plugins nativos com o Capacitor...
call npx cap sync android
if %errorlevel% neq 0 goto error

:: 3. Compilar e Instalar o APK
echo [3/4] Compilando e Instalando APK no celular...
echo ^>^> OLHE PARA A TELA DO CELULAR AGORA E ACEITE A INSTALACAO ^<^<
cd android
call gradlew.bat installDebug
if %errorlevel% neq 0 goto error

:: 4. Abrir o App
echo [4/4] Iniciando o aplicativo no celular...
"%ADB%" shell am start -n br.com.arquitetodevalor.app/br.com.arquitetodevalor.app.MainActivity

echo.
echo ======================================================
echo    CONCLUIDO! O app deve estar aberto no seu celular.
echo ======================================================
pause
exit /b 0

:error
echo.
echo [ERRO] Ocorreu um erro durante o processo.
echo Verifique se o celular esta conectado e com "Instalar via USB" ativo.
pause
exit /b 1
