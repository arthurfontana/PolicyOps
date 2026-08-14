"""Launcher usado por `iniciar.bat` (S28) — docs/14-plataforma-local.md §9.

Sobe o servidor (`policyops_server.prepare()` + `uvicorn`), espera o `/api/health` responder e
abre o navegador já no endereço com token. O servidor ASGI roda numa thread do próprio processo
em vez de um subprocesso: fechar a janela do `.bat` (ou `Ctrl+C`) derruba a thread junto, sem
deixar processo órfão escutando em `127.0.0.1`.

Uso: `python launcher.py --data-dir \\rede\\Politicas` (mesmos argumentos de
`policyops_server.py` — quem resolve é `prepare()`, compartilhado entre os dois).

Âncoras de navegação (`grep -n "# #region:" server/launcher.py`).
"""

from __future__ import annotations

# #region: imports

import sys
import threading
import time
import webbrowser
from pathlib import Path
from typing import List, Optional
from urllib.error import URLError
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent))

import policyops_server as server  # noqa: E402

# #region: espera-do-health

HEALTH_TIMEOUT_SECONDS = 20.0
"""Orçamento generoso acima da meta de `docs/14-plataforma-local.md` §10 (boot em até 8 s com
venv pronto) — máquina e pasta de rede lentas não devem fazer o launcher desistir cedo demais."""
HEALTH_POLL_INTERVAL_SECONDS = 0.25


def wait_for_health(
    url: str,
    timeout: float = HEALTH_TIMEOUT_SECONDS,
    interval: float = HEALTH_POLL_INTERVAL_SECONDS,
) -> bool:
    """Consulta `url` (o `/api/health`) até responder 200 ou estourar `timeout`.

    Qualquer erro de conexão (servidor ainda não escutando, porta ainda fechada) é esperado
    enquanto a thread do uvicorn sobe — só o timeout final é reportado a quem chamou.
    """
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with urlopen(url, timeout=interval) as response:  # nosec B310 - localhost fixo
                if response.status == 200:
                    return True
        except (URLError, OSError, ValueError):
            pass
        time.sleep(interval)
    return False


# #region: boot-e-navegador


def main(argv: Optional[List[str]] = None) -> int:
    code, config, port, app = server.prepare(argv)
    if code != 0:
        return code
    assert config is not None and port is not None and app is not None

    url = "http://{}:{}/?t={}".format(server.HOST, port, config.token)
    health_url = "http://{}:{}/api/health".format(server.HOST, port)
    print("PolicyOps: {}".format(url), flush=True)
    print("PolicyOps: dados em {}".format(config.data_dir), flush=True)

    import uvicorn  # importado aqui para manter os testes livres do servidor ASGI

    uv_config = uvicorn.Config(app, host=server.HOST, port=port, log_level="warning")
    uv_server = uvicorn.Server(uv_config)
    thread = threading.Thread(target=uv_server.run, daemon=True)
    thread.start()

    if not wait_for_health(health_url):
        print(
            "O servidor não respondeu a tempo em {}. Feche esta janela e tente de novo; se "
            "persistir, avise a TI.".format(health_url),
            file=sys.stderr,
        )
        uv_server.should_exit = True
        thread.join(timeout=5)
        return 1

    print("Servidor pronto. Abrindo o navegador...", flush=True)
    webbrowser.open(url)
    print("", flush=True)
    print("Deixe esta janela aberta enquanto estiver usando o PolicyOps.", flush=True)
    print("Para encerrar, feche esta janela ou pressione Ctrl+C.", flush=True)

    try:
        while thread.is_alive():
            thread.join(timeout=1)
    except KeyboardInterrupt:
        print("Encerrando...", flush=True)
        uv_server.should_exit = True
        thread.join(timeout=5)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
