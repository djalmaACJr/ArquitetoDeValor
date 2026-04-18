@echo off
chcp 65001 >nul
cd /d C:\Pessoal\ArquitetoDeValor
echo.
echo Restaurando dados...
npx ts-node -r dotenv/config tests/restore.ts
exit /b %ERRORLEVEL%
