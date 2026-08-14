@echo off
cd /d "%~dp0"

if exist "server\.venv\Scripts\python.exe" goto RODA

echo Policy Matrix Studio
echo =====================================================
echo.
echo O servidor local ainda nao foi instalado nesta maquina.
echo.
echo De dois cliques em instalar.bat primeiro ^(so precisa ser feito uma vez
echo por computador^) e depois volte a usar este iniciar.bat.
echo.
echo Enquanto isso, o arquivo PolicyOps.html continua abrindo direto por
echo duplo clique, num modo mais limitado ^(sem salvar direto na pasta de
echo rede^).
echo.
pause
exit /b 1

:RODA
echo Policy Matrix Studio
echo =====================================================
echo.
echo Subindo o servidor local...
echo.

"server\.venv\Scripts\python.exe" "server\launcher.py" --data-dir ".."

echo.
echo O servidor foi encerrado.
echo.
pause
exit /b 0
