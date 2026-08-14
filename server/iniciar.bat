@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem Este script roda em tres layouts diferentes - detecta onde estao os arquivos em vez de
rem fixar o prefixo, para nao duplicar o caminho:
rem   1) instalacao fixa deste time: iniciar.bat na raiz da pasta de rede, codigo em
rem      "Aplicacao\PolicyOps-main\server\" e dados em pasta separada "Repositorios\Politicas\"
rem   2) raiz do pacote publicado padrao (server\ direto ao lado de iniciar.bat)
rem   3) direto de dentro da propria pasta "server\" (uso local/teste)
if exist "Aplicacao\PolicyOps-main\server\launcher.py" (
    set "SRV=Aplicacao\PolicyOps-main\server\"
    set "DATA_DIR=Repositorios\Politicas"
) else if exist "server\launcher.py" (
    set "SRV=server\"
    set "DATA_DIR=.."
) else if exist "launcher.py" (
    set "SRV="
    set "DATA_DIR=."
) else (
    goto SEMLAUNCHER
)

if not exist "!SRV!launcher.py" goto SEMLAUNCHER
if not exist "!SRV!.venv\Scripts\python.exe" goto SEMINSTALACAO

echo Policy Matrix Studio
echo =====================================================
echo.
echo Subindo o servidor local...
echo.

"!SRV!.venv\Scripts\python.exe" "!SRV!launcher.py" --data-dir "!DATA_DIR!"
set "PY_EXIT=%errorlevel%"

echo.
if not "!PY_EXIT!"=="0" (
    echo O servidor encerrou com erro ^(codigo !PY_EXIT!^).
    echo.
    echo Se a mensagem acima citar um caminho com "server\server\" duplicado, confira
    echo se nao existe uma subpasta chamada "server" dentro da propria pasta "server\"
    echo desta instalacao - pode ter sobrado de uma copia ou extracao anterior. Apague
    echo essa duplicata ^(mantendo launcher.py direto em "server\"^) e tente de novo.
    echo.
) else (
    echo O servidor foi encerrado.
    echo.
)
pause
exit /b !PY_EXIT!

:SEMLAUNCHER
echo Policy Matrix Studio
echo =====================================================
echo.
echo Nao encontrei launcher.py em nenhum dos layouts esperados: nem em
echo "Aplicacao\PolicyOps-main\server\launcher.py", nem em "server\launcher.py", nem em
echo "launcher.py" dentro desta pasta.
echo.
echo Confira se nao existe uma subpasta "server" duplicada dentro da propria pasta
echo "server\" ^(algo como "server\server\launcher.py"^) - isso costuma sobrar de uma
echo copia ou extracao feita duas vezes. Apague a duplicata e rode iniciar.bat de novo.
echo.
pause
exit /b 1

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
