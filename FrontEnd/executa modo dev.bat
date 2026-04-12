@echo off

REM Inicia o servidor (em nova janela)
start cmd /c "npm run dev"

REM Aguarda alguns segundos para o servidor subir
timeout /t 2 > nul

REM Caminho do Firefox (ajuste se necessário)
set FIREFOX="C:\Program Files\Mozilla Firefox\firefox.exe"

REM Abre o site no Firefox
start "" %FIREFOX% http://localhost:5173/