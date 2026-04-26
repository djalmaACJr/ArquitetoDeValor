@echo off
chcp 65001 >nul
cd /d C:\Pessoal\ArquitetoDeValor
if not exist test-results mkdir test-results
for /f "tokens=1-3 delims=/" %%a in ("%date%") do set TS=%%c-%%b-%%a
for /f "tokens=1-2 delims=:." %%a in ("%time%") do set TS=%TS%_%%a-%%b
set TS=%TS: =0%
set ARQ=test-results\resultado_%TS%.txt
echo Salvando em: %ARQ%
npx jest tests/99_limpar.test.ts --runInBand --verbose --testPathIgnorePatterns="" 2>&1 | powershell -Command "$input | Tee-Object -FilePath '%ARQ%'"
exit /b %ERRORLEVEL%
