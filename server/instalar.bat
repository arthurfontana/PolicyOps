@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo Policy Matrix Studio - instalacao do servidor local
echo =====================================================
echo.

set "PYTHON_CMD="

py -3 --version >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
)

if "!PYTHON_CMD!"=="" (
    python --version >nul 2>&1
    if not errorlevel 1 (
        set "PYTHON_CMD=python"
    )
)

if "!PYTHON_CMD!"=="" (
    echo Nao encontrei um Python instalado nesta maquina ^(precisa da versao 3.9 ou mais nova^).
    echo.
    echo Peca para a TI instalar o Python e rode este instalador de novo.
    echo Ate la, o arquivo PolicyOps.html continua abrindo direto por duplo clique,
    echo num modo mais limitado ^(sem salvar direto na pasta de rede^).
    echo.
    pause
    exit /b 1
)

echo Python encontrado: usando "!PYTHON_CMD!"
echo.

rem Este script roda nos mesmos tres layouts do iniciar.bat - ver comentario la para o
rem detalhe de cada um.
if exist "Aplicacao\PolicyOps-main\server\requirements.txt" (
    set "SRV=Aplicacao\PolicyOps-main\server\"
) else if exist "server\requirements.txt" (
    set "SRV=server\"
) else if exist "requirements.txt" (
    set "SRV="
) else (
    echo Nao encontrei requirements.txt em nenhum dos layouts esperados: nem em
    echo "Aplicacao\PolicyOps-main\server\requirements.txt", nem em
    echo "server\requirements.txt", nem em "requirements.txt" nesta pasta. Rode o
    echo instalar.bat a partir da pasta do pacote publicado ^(onde ele fica ao lado de
    echo PolicyOps.html^) ou de dentro da propria pasta server\.
    echo.
    pause
    exit /b 1
)

if exist "!SRV!.venv\Scripts\python.exe" (
    echo Ambiente isolado ja existe em !SRV!.venv, reaproveitando.
) else (
    echo Criando ambiente isolado em !SRV!.venv ...
    !PYTHON_CMD! -m venv "!SRV!.venv"
    if not exist "!SRV!.venv\Scripts\python.exe" (
        echo.
        echo Nao consegui criar o ambiente isolado em !SRV!.venv.
        echo Verifique se ha espaco em disco e permissao de escrita nesta pasta,
        echo e tente de novo. Nada no Python instalado na maquina foi alterado.
        echo.
        pause
        exit /b 1
    )
)
echo.

set "VENV_PY=!SRV!.venv\Scripts\python.exe"

echo Instalando dependencias...
echo.

set /a OK_INDICE=0
set /a OK_WHEELS=0
set /a FALHAS=0

for /f "usebackq eol=# tokens=* delims=" %%L in ("!SRV!requirements.txt") do (
    call :instala_linha "%%L"
)

echo.
echo -----------------------------------------------------
echo Resumo da instalacao:
echo   instaladas pelo indice pip online: !OK_INDICE!
echo   instaladas pelas copias locais ^(wheels^): !OK_WHEELS!
echo   nao instaladas: !FALHAS!
echo -----------------------------------------------------

if !FALHAS! GTR 0 (
    echo.
    echo Uma ou mais dependencias nao puderam ser instaladas, nem pelo indice pip
    echo nem pelas copias locais em !SRV!wheels. Confira sua conexao com a internet
    echo ou peca para a TI checar o pacote publicado na pasta de rede.
    echo O iniciar.bat pode nao funcionar ate isso ser corrigido.
    echo.
    pause
    exit /b 1
)

echo.
echo Instalacao concluida. A partir de agora, use sempre o iniciar.bat.
echo.
pause
exit /b 0

:instala_linha
set "REQ=%~1"
if "!REQ!"=="" exit /b 0

echo   - !REQ!
"!VENV_PY!" -m pip install --disable-pip-version-check --quiet --timeout 8 --retries 1 "!REQ!" >nul 2>&1
if not errorlevel 1 (
    echo       instalado pelo indice pip online.
    set /a OK_INDICE+=1
    exit /b 0
)

echo       indice pip indisponivel, tentando as copias locais em !SRV!wheels ...
"!VENV_PY!" -m pip install --disable-pip-version-check --quiet --no-index --find-links "!SRV!wheels" "!REQ!" >nul 2>&1
if not errorlevel 1 (
    echo       instalado pelas copias locais ^(!SRV!wheels^).
    set /a OK_WHEELS+=1
    exit /b 0
)

echo       FALHOU tanto pelo indice quanto pelas copias locais.
set /a FALHAS+=1
exit /b 1
