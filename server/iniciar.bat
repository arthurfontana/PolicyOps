@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem Este script roda tanto na raiz do pacote publicado (com uma subpasta "server\")
rem quanto direto de dentro da propria pasta "server\" (uso local/teste) - detecta
rem onde estao os arquivos em vez de fixar o prefixo, para nao duplicar o caminho.
if exist "server\launcher.py" (
    set "SRV=server\"
    set "DATA_DIR=.."
) else if exist "launcher.py" (
    set "SRV="
    set "DATA_DIR=."
)

if not exist "!SRV!.venv\Scripts\python.exe" goto SEMINSTALACAO

echo Policy Matrix Studio
echo =====================================================
echo.
echo Subindo o servidor local...
echo.

"!SRV!.venv\Scripts\python.exe" "!SRV!launcher.py" --data-dir "!DATA_DIR!"

echo.
echo O servidor foi encerrado.
echo.
pause
exit /b 0

:SEMINSTALACAO
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
