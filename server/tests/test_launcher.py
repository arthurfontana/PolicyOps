"""Launcher do `iniciar.bat` (S28) — docs/14-plataforma-local.md §9 e §11.

Porta ocupada, `config.json` sobrescrevendo `--data-dir` e o `/api/health` aguardado pelo
launcher antes de abrir o navegador.
"""

from __future__ import annotations

import http.server
import json
import socket
import threading
import time
from pathlib import Path

from fastapi.testclient import TestClient

import launcher
import policyops_server as server


# #region: porta-ocupada


def test_escolhe_a_proxima_porta_livre_quando_a_primeira_esta_ocupada() -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as ocupada:
        ocupada.bind((server.HOST, 8770))
        ocupada.listen(1)

        porta = server.choose_port()

    assert porta == 8771


# #region: config-json-e-data-dir


def test_config_json_sobrescreve_o_data_dir_quando_a_cli_nao_informa(tmp_path: Path) -> None:
    script_dir = tmp_path / "server"
    script_dir.mkdir()
    data_dir = tmp_path / "rede"
    data_dir.mkdir()
    (script_dir / "config.json").write_text(json.dumps({"dataDir": str(data_dir)}), encoding="utf-8")

    args = server.parse_args([])
    config = server.build_config(args, script_dir=script_dir)

    assert config.data_dir == data_dir.resolve()


def test_data_dir_da_linha_de_comando_tem_prioridade_sobre_o_config_json(tmp_path: Path) -> None:
    script_dir = tmp_path / "server"
    script_dir.mkdir()
    do_config = tmp_path / "do-config"
    do_config.mkdir()
    da_cli = tmp_path / "da-cli"
    da_cli.mkdir()
    (script_dir / "config.json").write_text(json.dumps({"dataDir": str(do_config)}), encoding="utf-8")

    args = server.parse_args(["--data-dir", str(da_cli)])
    config = server.build_config(args, script_dir=script_dir)

    assert config.data_dir == da_cli.resolve()


# #region: html-no-layout-real-do-pacote


def test_resolve_html_path_acha_o_html_um_nivel_acima_do_server(tmp_path: Path) -> None:
    """O pacote publicado (`dist/plataforma/`) é `_app/PolicyOps.html` + `_app/server/...`
    (docs/14-plataforma-local.md §2) — `static_dir` é sempre a pasta do `policyops_server.py`,
    ou seja `_app/server/`, um nível abaixo de onde o HTML realmente fica."""
    app_dir = tmp_path / "_app"
    server_dir = app_dir / "server"
    server_dir.mkdir(parents=True)
    (app_dir / "PolicyOps.html").write_text("<!doctype html><title>PolicyOps</title>", encoding="utf-8")

    encontrado = server.resolve_html_path(server_dir)

    assert encontrado == app_dir / "PolicyOps.html"


def test_get_serve_o_html_no_layout_real_do_pacote(tmp_path: Path) -> None:
    app_dir = tmp_path / "_app"
    server_dir = app_dir / "server"
    server_dir.mkdir(parents=True)
    (app_dir / "PolicyOps.html").write_text("<!doctype html><title>PolicyOps</title>", encoding="utf-8")

    config = server.ServerConfig(data_dir=tmp_path / "rede", static_dir=server_dir)
    (tmp_path / "rede").mkdir()
    cliente = TestClient(server.create_app(config))

    resposta = cliente.get("/")

    assert resposta.status_code == 200
    assert "PolicyOps" in resposta.text


# #region: espera-do-health


class _HealthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802 - nome da API do http.server
        self.send_response(200)
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - assinatura da base
        pass


def _porta_livre() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def test_wait_for_health_retorna_true_assim_que_o_servidor_responde() -> None:
    porta = _porta_livre()
    httpd = http.server.HTTPServer(("127.0.0.1", porta), _HealthHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        assert launcher.wait_for_health(
            "http://127.0.0.1:{}/api/health".format(porta), timeout=2, interval=0.05
        )
    finally:
        httpd.shutdown()
        thread.join(timeout=2)


def test_wait_for_health_espera_o_servidor_subir_com_atraso() -> None:
    """Simula o caso normal: a porta só começa a responder um instante depois do boot."""
    porta = _porta_livre()
    httpd_ref: list[http.server.HTTPServer] = []

    def sobe_com_atraso() -> None:
        time.sleep(0.3)
        httpd = http.server.HTTPServer(("127.0.0.1", porta), _HealthHandler)
        httpd_ref.append(httpd)
        httpd.serve_forever()

    thread = threading.Thread(target=sobe_com_atraso, daemon=True)
    thread.start()
    try:
        assert launcher.wait_for_health(
            "http://127.0.0.1:{}/api/health".format(porta), timeout=3, interval=0.05
        )
    finally:
        deadline = time.monotonic() + 2
        while not httpd_ref and time.monotonic() < deadline:
            time.sleep(0.05)
        if httpd_ref:
            httpd_ref[0].shutdown()
        thread.join(timeout=2)


def test_wait_for_health_desiste_apos_o_timeout_se_ninguem_responde() -> None:
    porta = _porta_livre()  # ninguém escutando

    inicio = time.monotonic()
    resultado = launcher.wait_for_health(
        "http://127.0.0.1:{}/api/health".format(porta), timeout=0.5, interval=0.05
    )
    duracao = time.monotonic() - inicio

    assert resultado is False
    assert duracao < 2
