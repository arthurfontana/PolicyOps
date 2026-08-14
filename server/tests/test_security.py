"""Token, handshake de versão e estáticos — docs/14-plataforma-local.md §5 e §11."""

from __future__ import annotations

from pathlib import Path

import policyops_server as server
from fastapi.testclient import TestClient


def test_health_responde_sem_token(config: server.ServerConfig) -> None:
    anonimo = TestClient(server.create_app(config))

    resposta = anonimo.get("/api/health")

    assert resposta.status_code == 200
    corpo = resposta.json()
    assert corpo["apiVersion"] == 1
    assert corpo["dataDir"] == str(config.data_dir)
    assert corpo["started"].endswith("Z")


def test_api_sem_token_devolve_401(config: server.ServerConfig) -> None:
    anonimo = TestClient(server.create_app(config))

    for metodo, rota in [
        ("get", "/api/document"),
        ("get", "/api/whoami"),
        ("get", "/api/backups"),
    ]:
        resposta = getattr(anonimo, metodo)(rota)
        assert resposta.status_code == 401, rota
        assert resposta.json()["code"] == "UNAUTHORIZED"


def test_api_com_token_invalido_devolve_401(config: server.ServerConfig) -> None:
    anonimo = TestClient(server.create_app(config))

    resposta = anonimo.get("/api/document", headers={"X-PolicyOps-Token": "token-errado"})

    assert resposta.status_code == 401


def test_token_com_caractere_estranho_vira_401_e_nao_excecao(config: server.ServerConfig) -> None:
    anonimo = TestClient(server.create_app(config))

    # Byte fora do ASCII no cabeçalho: o Starlette entrega isso como `str` latin-1, e
    # `compare_digest` recusaria `str` não-ASCII com TypeError se a comparação não fosse em bytes.
    resposta = anonimo.get("/api/document", headers={b"X-PolicyOps-Token": b"tok\xe9n"})

    assert resposta.status_code == 401


def test_token_de_boot_e_aleatorio_e_longo(data_dir: Path) -> None:
    primeiro = server.ServerConfig(data_dir=data_dir)
    segundo = server.ServerConfig(data_dir=data_dir)

    assert primeiro.token != segundo.token
    assert len(primeiro.token) >= 32


def test_toda_resposta_carrega_o_handshake_de_versao(client: TestClient, config: server.ServerConfig) -> None:
    anonimo = TestClient(server.create_app(config))

    for resposta in [
        client.get("/api/health"),
        client.get("/api/document"),  # 404: o handshake vale também para erro
        client.get("/api/whoami"),
        anonimo.get("/api/backups"),  # 401
        client.get("/"),
    ]:
        assert resposta.headers["X-PolicyOps-Api"] == "1"


def test_nao_ha_cors(client: TestClient) -> None:
    """A SPA é servida pela mesma origem da API; nenhuma outra origem é convidada (§5)."""
    resposta = client.get("/api/health", headers={"Origin": "http://exemplo.invalido"})

    assert "access-control-allow-origin" not in {k.lower() for k in resposta.headers}


def test_whoami_devolve_identidade_do_boot_e_papel_aberto(client: TestClient) -> None:
    corpo = client.get("/api/whoami").json()

    assert corpo == {"username": "arthur", "displayName": "Arthur", "roles": ["PUBLISHER"]}


def test_serve_o_html_sem_cache(config: server.ServerConfig, tmp_path: Path) -> None:
    static = tmp_path / "_app"
    static.mkdir()
    (static / "PolicyOps.html").write_text("<!doctype html><title>PolicyOps</title>", encoding="utf-8")
    config.static_dir = static
    servido = TestClient(server.create_app(config))

    resposta = servido.get("/")

    assert resposta.status_code == 200
    assert resposta.headers["cache-control"] == "no-cache"
    assert "PolicyOps" in resposta.text
    assert servido.get("/PolicyOps.html").status_code == 200


def test_html_ausente_explica_o_que_fazer(config: server.ServerConfig, tmp_path: Path) -> None:
    config.static_dir = tmp_path / "vazio"
    servido = TestClient(server.create_app(config))

    resposta = servido.get("/")

    assert resposta.status_code == 404
    assert resposta.json()["code"] == "HTML_NOT_FOUND"


def test_estaticos_nao_expoem_arquivo_arbitrario(config: server.ServerConfig, tmp_path: Path) -> None:
    static = tmp_path / "_app"
    static.mkdir()
    (static / "PolicyOps.html").write_text("<!doctype html>", encoding="utf-8")
    (static / "config.json").write_text('{"displayName": "Arthur"}', encoding="utf-8")
    config.static_dir = static
    servido = TestClient(server.create_app(config))

    assert servido.get("/config.json").status_code == 404
    assert servido.get("/policyops_server.py").status_code == 404


def test_config_json_ao_lado_do_servidor_sobrescreve_o_padrao(tmp_path: Path) -> None:
    (tmp_path / "config.json").write_text(
        '{"dataDir": "/rede/politicas", "displayName": "Arthur Fontana"}', encoding="utf-8"
    )

    lido = server.read_config_file(tmp_path / "config.json")

    assert lido["dataDir"] == "/rede/politicas"
    assert lido["displayName"] == "Arthur Fontana"


def test_config_json_invalido_nao_derruba_o_boot(tmp_path: Path) -> None:
    (tmp_path / "config.json").write_text("{ isto não é json", encoding="utf-8")

    assert server.read_config_file(tmp_path / "config.json") == {}
    assert server.read_config_file(tmp_path / "ausente.json") == {}


def test_escolha_de_porta_fica_na_faixa_documentada() -> None:
    porta = server.choose_port()

    assert porta in server.PORT_RANGE


def test_nome_de_arquivo_com_caminho_e_recusado_no_boot(tmp_path: Path) -> None:
    """Tudo que o servidor toca fica na pasta de dados — nome com caminho sairia dela."""
    assert server.main(["--data-dir", str(tmp_path), "--data-file", "../politicas.json"]) == 2


def test_pasta_de_dados_inexistente_e_recusada_no_boot(tmp_path: Path) -> None:
    assert server.main(["--data-dir", str(tmp_path / "não-existe")]) == 2
