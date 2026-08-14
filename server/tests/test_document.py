"""Leitura, gravação atômica e conflito — docs/06 §4–§5, docs/14 §4 e §11."""

from __future__ import annotations

import os
from pathlib import Path

import policyops_server as server
import pytest
from conftest import document_text, write_document
from fastapi.testclient import TestClient


def test_get_document_devolve_conteudo_hash_bytes_e_mtime(client: TestClient, data_dir: Path) -> None:
    texto = document_text()
    esperado = write_document(data_dir, texto)

    corpo = client.get("/api/document").json()

    assert corpo["raw"] == texto
    assert corpo["hash"] == esperado
    assert corpo["bytes"] == len(texto.encode("utf-8"))
    assert corpo["mtime"].endswith("Z")


def test_get_document_sem_arquivo_devolve_404(client: TestClient) -> None:
    resposta = client.get("/api/document")

    assert resposta.status_code == 404
    assert resposta.json()["code"] == "NOT_FOUND"


def test_put_grava_e_devolve_o_hash_do_que_ficou_no_disco(client: TestClient, data_dir: Path) -> None:
    base = write_document(data_dir, document_text(revision=1))
    novo = document_text(revision=2)

    corpo = client.put("/api/document", json={"baseHash": base, "content": novo}).json()

    gravado = (data_dir / "politicas.json").read_text(encoding="utf-8")
    assert gravado == novo
    assert corpo["hash"] == server.sha256_hex(novo.encode("utf-8"))
    assert corpo["savedAt"].endswith("Z")


def test_put_no_primeiro_save_aceita_base_hash_nulo(client: TestClient, data_dir: Path) -> None:
    novo = document_text()

    resposta = client.put("/api/document", json={"baseHash": None, "content": novo})

    assert resposta.status_code == 200
    assert (data_dir / "politicas.json").read_text(encoding="utf-8") == novo


def test_put_com_base_hash_de_arquivo_inexistente_e_conflito(client: TestClient, data_dir: Path) -> None:
    """Alguém apagou o arquivo debaixo da sessão: isso é conflito, não "grava do zero"."""
    resposta = client.put("/api/document", json={"baseHash": "a" * 64, "content": document_text()})

    assert resposta.status_code == 409
    assert resposta.json()["remoteHash"] is None
    assert not (data_dir / "politicas.json").exists()


def test_conflito_devolve_409_com_o_remoto_e_nao_grava(client: TestClient, data_dir: Path) -> None:
    """docs/06 §5: hash divergente não grava — e o disco é conferido **byte a byte** depois."""
    write_document(data_dir, document_text(revision=1))
    remoto = document_text(revision=9)
    bytes_no_disco = remoto.encode("utf-8")
    (data_dir / "politicas.json").write_bytes(bytes_no_disco)

    resposta = client.put(
        "/api/document",
        json={"baseHash": "0" * 64, "content": document_text(revision=2)},
    )

    assert resposta.status_code == 409
    corpo = resposta.json()
    assert corpo["code"] == "CONFLICT"
    assert corpo["remoteRaw"] == remoto
    assert corpo["remoteHash"] == server.sha256_hex(bytes_no_disco)
    assert (data_dir / "politicas.json").read_bytes() == bytes_no_disco


def test_conflito_nao_gera_backup(client: TestClient, data_dir: Path) -> None:
    write_document(data_dir, document_text(revision=1))

    client.put("/api/document", json={"baseHash": "0" * 64, "content": document_text(revision=2)})

    assert not (data_dir / "_backups").exists()


def test_json_invalido_e_recusado_sem_tocar_o_disco(client: TestClient, data_dir: Path) -> None:
    base = write_document(data_dir, document_text(revision=1))

    resposta = client.put("/api/document", json={"baseHash": base, "content": "{ isto não é json"})

    assert resposta.status_code == 400
    assert resposta.json()["code"] == "INVALID_JSON"
    assert (data_dir / "politicas.json").read_text(encoding="utf-8") == document_text(revision=1)


def test_corpo_sem_base_hash_e_recusado(client: TestClient, data_dir: Path) -> None:
    write_document(data_dir, document_text())

    resposta = client.put("/api/document", json={"content": document_text(revision=2)})

    assert resposta.status_code == 400
    assert resposta.json()["code"] == "BAD_REQUEST"


def test_servidor_nao_valida_invariantes_do_documento(client: TestClient, data_dir: Path) -> None:
    """ADR-002: quem valida schema e invariantes é `src/core/`, não o Python."""
    resposta = client.put("/api/document", json={"baseHash": None, "content": '{"qualquer": "coisa"}'})

    assert resposta.status_code == 200
    assert (data_dir / "politicas.json").read_text(encoding="utf-8") == '{"qualquer": "coisa"}'


def test_escrita_atomica_usa_tmp_ao_lado_e_replace(
    client: TestClient, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    write_document(data_dir, document_text(revision=1))
    vistos = []
    replace_original = os.replace

    def espiao(origem, destino):  # type: ignore[no-untyped-def]
        vistos.append((str(origem), str(destino)))
        return replace_original(origem, destino)

    monkeypatch.setattr(server.os, "replace", espiao)

    base = client.get("/api/document").json()["hash"]
    client.put("/api/document", json={"baseHash": base, "content": document_text(revision=2)})

    origem, destino = vistos[-1]
    assert origem == str(data_dir / "politicas.json.tmp")
    assert destino == str(data_dir / "politicas.json")


def test_queda_no_meio_da_escrita_nunca_trunca_o_arquivo(
    client: TestClient, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """docs/14 §11: matar a escrita no meio nunca deixa `politicas.json` inválido."""
    anterior = document_text(revision=1)
    base = write_document(data_dir, anterior)

    def morre(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise OSError("a rede caiu no meio do save")

    monkeypatch.setattr(server.os, "replace", morre)

    resposta = client.put(
        "/api/document",
        json={
            "baseHash": base,
            "content": document_text(revision=2, extra={"volume": ["x" * 64] * 500}),
        },
    )

    assert resposta.status_code == 500
    assert resposta.json()["code"] == "IO"
    assert (data_dir / "politicas.json").read_text(encoding="utf-8") == anterior
    assert not (data_dir / "politicas.json.tmp").exists()


def test_queda_antes_do_fsync_nao_deixa_lixo(data_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    alvo = data_dir / "politicas.json"
    alvo.write_text(document_text(revision=1), encoding="utf-8")

    def morre(*_args, **_kwargs):  # type: ignore[no-untyped-def]
        raise OSError("máquina desligada")

    monkeypatch.setattr(server.os, "fsync", morre)

    with pytest.raises(OSError):
        server.write_atomic(alvo, b"conteudo pela metade")

    assert alvo.read_text(encoding="utf-8") == document_text(revision=1)
    assert not (data_dir / "politicas.json.tmp").exists()


def test_arquivo_que_nao_e_utf8_nao_e_convertido(client: TestClient, data_dir: Path) -> None:
    (data_dir / "politicas.json").write_bytes(b"\xff\xfe{}")

    resposta = client.get("/api/document")

    assert resposta.status_code == 422
    assert resposta.json()["code"] == "NOT_UTF8"


def test_conteudo_acentuado_sobrevive_ao_ciclo_ler_gravar_reler(client: TestClient, data_dir: Path) -> None:
    original = document_text(extra={"nota": "Política de Crédito — ação, ç, ã, 30% até R$ 1.000"})
    base = write_document(data_dir, original)
    alterado = original.replace("Crédito", "Crédito Consignado")

    client.put("/api/document", json={"baseHash": base, "content": alterado})
    relido = client.get("/api/document").json()

    assert relido["raw"] == alterado
    assert relido["bytes"] == len(alterado.encode("utf-8"))
