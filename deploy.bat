@echo off
echo Deployando funcoes...
echo deply contas
supabase functions deploy contas --project-ref ftpelncgrakpphytfrfo
echo deploy categorias
supabase functions deploy categorias --project-ref ftpelncgrakpphytfrfo
echo deploy transacoes
supabase functions deploy transacoes --project-ref ftpelncgrakpphytfrfo

echo.
echo Deploy concluido!
pause