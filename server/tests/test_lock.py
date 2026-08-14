"""Bloqueio consultivo — docs/06 §6, docs/14 §4 e §11."""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import policyops_server as server
from conftest import document_text, write_document, write_lock
from fastapi.testclient import TestClient


def agora_iso(delta_minutos: float = 0) -> str:
    return server.iso_utc(server.utc_now() + timedelta(minutes=delta_minutos))


def test_adquire_o_lock_no_formato_do_modo_full(client: TestClient, data_dir: Path) -> None:
    corpo = client.post("/api/document/lock", json={"docRevision": 41}).json()

    arquivo = data_dir / "politicas.lock.json"
    gravado = json.loads(arquivo.read_text(encoding="utf-8"))
    assert gravado["holder"] == "Arthur"
    assert gravado["docRevision"] == 41
    assert gravado["since"].endswith("Z") and gravado["heartbeat"].endswith("Z")
    assert gravado["username"] == "arthur"
    assert corpo["lock"] == gravado


def test_heartbeat_renova_sem_perder_o_since(client: TestClient) -> None:
    primeiro = client.post("/api/document/lock", json={"docRevision": 41}).json()["lock"]

    segundo = client.post("/api/document/lock", json={"docRevision": 42}).json()["lock"]

    assert segundo["since"] == primeiro["since"]
    assert segundo["heartbeat"] >= primeiro["heartbeat"]
    assert segundo["docRevision"] == 42


def test_lock_ativo_de_outra_pessoa_devolve_423(client: TestClient, data_dir: Path) -> None:
    write_lock(data_dir, holder="Bianca", heartbeat=agora_iso(-1), username="bianca")

    resposta = client.post("/api/document/lock", json={})

    assert resposta.status_code == 423
    corpo = resposta.json()
    assert corpo["code"] == "LOCKED"
    assert corpo["lock"]["holder"] == "Bianca"
    assert "Bianca" in corpo["detail"]
    # Não tomou o lock alheio.
    assert json.loads((data_dir / "politicas.lock.json").read_text(encoding="utf-8"))["holder"] == "Bianca"


def test_lock_obsoleto_pode_ser_tomado(client: TestClient, data_dir: Path) -> None:
    """Heartbeat parado há mais de 10 min: a aba do colega morreu, o lock é assumível (§6)."""
    write_lock(data_dir, holder="Bianca", heartbeat=agora_iso(-11), username="bianca")

    resposta = client.post("/api/document/lock", json={})

    assert resposta.status_code == 200
    assert resposta.json()["lock"]["holder"] == "Arthur"


def test_lock_de_9_minutos_ainda_e_ativo(client: TestClient, data_dir: Path) -> None:
    write_lock(data_dir, holder="Bianca", heartbeat=agora_iso(-9), username="bianca")

    assert client.post("/api/document/lock", json={}).status_code == 423


def test_force_toma_o_lock_ativo_de_outra_pessoa(client: TestClient, data_dir: Path) -> None:
    """"Editar assim mesmo": o bloqueio é consultivo e o usuário decide (§6)."""
    write_lock(data_dir, holder="Bianca", heartbeat=agora_iso(-1), username="bianca")

    resposta = client.post("/api/document/lock", json={"force": True})

    assert resposta.status_code == 200
    assert resposta.json()["lock"]["holder"] == "Arthur"


def test_lock_gravado_pelo_modo_full_e_reconhecido(client: TestClient, data_dir: Path) -> None:
    """O modo `FULL` não escreve `username`; a comparação cai no rótulo, como manda o formato."""
    write_lock(data_dir, holder="Bianca", heartbeat=agora_iso(-1))

    assert client.post("/api/document/lock", json={}).status_code == 423

    write_lock(data_dir, holder="Arthur", heartbeat=agora_iso(-1))

    assert client.post("/api/document/lock", json={}).status_code == 200


def test_libera_o_proprio_lock(client: TestClient, data_dir: Path) -> None:
    client.post("/api/document/lock", json={})

    resposta = client.delete("/api/document/lock")

    assert resposta.status_code == 200
    assert resposta.json() == {"released": True}
    assert not (data_dir / "politicas.lock.json").exists()


def test_nao_libera_lock_dos_outros(client: TestClient, data_dir: Path) -> None:
    write_lock(data_dir, holder="Bianca", heartbeat=agora_iso(-1), username="bianca")

    resposta = client.delete("/api/document/lock")

    assert resposta.status_code == 409
    assert resposta.json()["code"] == "LOCK_NOT_OWNED"
    assert (data_dir / "politicas.lock.json").exists()


def test_liberar_sem_lock_nao_e_erro(client: TestClient) -> None:
    assert client.delete("/api/document/lock").json() == {"released": False}


def test_save_com_lock_alheio_ativo_devolve_423_sem_gravar(client: TestClient, data_dir: Path) -> None:
    anterior = document_text(revision=1)
    base = write_document(data_dir, anterior)
    write_lock(data_dir, holder="Bianca", heartbeat=agora_iso(-1), username="bianca")

    resposta = client.put("/api/document", json={"baseHash": base, "content": document_text(revision=2)})

    assert resposta.status_code == 423
    assert resposta.json()["lock"]["holder"] == "Bianca"
    assert (data_dir / "politicas.json").read_text(encoding="utf-8") == anterior


def test_save_com_lock_obsoleto_passa(client: TestClient, data_dir: Path) -> None:
    base = write_document(data_dir, document_text(revision=1))
    write_lock(data_dir, holder="Bianca", heartbeat=agora_iso(-11), username="bianca")

    resposta = client.put("/api/document", json={"baseHash": base, "content": document_text(revision=2)})

    assert resposta.status_code == 200


def test_save_forcado_passa_por_cima_do_lock(client: TestClient, data_dir: Path) -> None:
    base = write_document(data_dir, document_text(revision=1))
    write_lock(data_dir, holder="Bianca", heartbeat=agora_iso(-1), username="bianca")

    resposta = client.put(
        "/api/document",
        json={"baseHash": base, "content": document_text(revision=2), "force": True},
    )

    assert resposta.status_code == 200


def test_save_com_lock_proprio_passa(client: TestClient, data_dir: Path) -> None:
    base = write_document(data_dir, document_text(revision=1))
    client.post("/api/document/lock", json={"docRevision": 41})

    resposta = client.put("/api/document", json={"baseHash": base, "content": document_text(revision=2)})

    assert resposta.status_code == 200


def test_lock_ilegivel_e_tratado_como_ausente(client: TestClient, data_dir: Path) -> None:
    (data_dir / "politicas.lock.json").write_text("{ lixo", encoding="utf-8")

    assert client.post("/api/document/lock", json={}).status_code == 200
