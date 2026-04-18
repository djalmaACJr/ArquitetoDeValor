@echo off
chcp 65001 >nul
cd /d C:\Pessoal\ArquitetoDeValor
echo.
echo Fazendo backup dos dados...
npx ts-node -r dotenv/config tests/backup.ts
exit /b %ERRORLEVEL%
