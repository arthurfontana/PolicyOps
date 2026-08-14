"""Identidade e papéis (ADR-003) — docs/14-plataforma-local.md §6 e §11.

`whoami` deriva o papel efetivo de `meta.acl` no documento em disco, e
`PUT /api/document` recusa com `403` quem tem papel efetivo `READER`. O
servidor não valida o resto do documento (ADR-002) — só lê o envelope mínimo
de `meta.acl`.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional

from conftest import document_text, write_document
from fastapi.testclient import TestClient


def doc_with_acl(acl: Optional[Dict[str, Any]], revision: int = 1) -> str:
    meta: Dict[str, Any] = {"id": "doc-1", "name": "Políticas", "revision": revision}
    if acl is not None:
        meta["acl"] = acl
    return document_text(revision=revision, extra={"meta": meta})


# #region: whoami


def test_whoami_sem_documento_no_disco_e_publisher(client: TestClient) -> None:
    """Sem `politicas.json` nenhum, não há `meta.acl` para ler — modo aberto."""
    corpo = client.get("/api/whoami").json()
    assert corpo["roles"] == ["PUBLISHER"]


def test_whoami_com_acl_ausente_e_publisher(client: TestClient, data_dir: Path) -> None:
    write_document(data_dir, document_text())
    corpo = client.get("/api/whoami").json()
    assert corpo["roles"] == ["PUBLISHER"]


def test_whoami_com_acl_vazia_e_publisher(client: TestClient, data_dir: Path) -> None:
    write_document(data_dir, doc_with_acl({"users": [], "defaultRole": "READER"}))
    corpo = client.get("/api/whoami").json()
    assert corpo["roles"] == ["PUBLISHER"]


def test_whoami_com_acl_populada_sem_admin_e_publisher(client: TestClient, data_dir: Path) -> None:
    """Modo aberto também quando a lista existe mas ninguém é ADMIN (docs/14 §6)."""
    acl = {"users": [{"username": "arthur", "role": "EDITOR"}], "defaultRole": "READER"}
    write_document(data_dir, doc_with_acl(acl))
    corpo = client.get("/api/whoami").json()
    assert corpo["roles"] == ["PUBLISHER"]


def test_whoami_username_listado_devolve_o_papel_da_lista(client: TestClient, data_dir: Path) -> None:
    acl = {
        "users": [
            {"username": "arthur", "role": "READER"},
            {"username": "outra-pessoa", "role": "ADMIN"},
        ],
        "defaultRole": "EDITOR",
    }
    write_document(data_dir, doc_with_acl(acl))
    corpo = client.get("/api/whoami").json()
    assert corpo["roles"] == ["READER"]


def test_whoami_username_nao_listado_usa_default_role(client: TestClient, data_dir: Path) -> None:
    acl = {
        "users": [{"username": "outra-pessoa", "role": "ADMIN"}],
        "defaultRole": "EDITOR",
    }
    write_document(data_dir, doc_with_acl(acl))
    corpo = client.get("/api/whoami").json()
    assert corpo["roles"] == ["EDITOR"]


def test_whoami_documento_ilegivel_e_publisher(client: TestClient, data_dir: Path) -> None:
    """Defensivo (ADR-002): JSON quebrado no disco não derruba `whoami`, só cai em modo aberto."""
    (data_dir / "politicas.json").write_text("{ isto não é json", encoding="utf-8")
    corpo = client.get("/api/whoami").json()
    assert corpo["roles"] == ["PUBLISHER"]


# #region: put-403-para-reader


def test_put_recusado_com_403_para_papel_efetivo_reader(client: TestClient, data_dir: Path) -> None:
    acl = {"users": [{"username": "arthur", "role": "READER"}, {"username": "x", "role": "ADMIN"}], "defaultRole": "READER"}
    base = write_document(data_dir, doc_with_acl(acl))

    resposta = client.put("/api/document", json={"baseHash": base, "content": doc_with_acl(acl, revision=2)})

    assert resposta.status_code == 403
    assert resposta.json()["code"] == "FORBIDDEN"
    # Nada foi gravado — o conteúdo em disco continua o de antes.
    assert (data_dir / "politicas.json").read_text(encoding="utf-8") == doc_with_acl(acl)


def test_put_aceito_para_editor_publisher_e_admin(client: TestClient, data_dir: Path) -> None:
    for role in ("EDITOR", "PUBLISHER", "ADMIN"):
        acl = {"users": [{"username": "arthur", "role": role}], "defaultRole": "READER"}
        base = write_document(data_dir, doc_with_acl(acl))

        resposta = client.put(
            "/api/document", json={"baseHash": base, "content": doc_with_acl(acl, revision=2)}
        )

        assert resposta.status_code == 200, f"papel {role} deveria poder salvar"


def test_put_aceito_em_modo_aberto(client: TestClient, data_dir: Path) -> None:
    base = write_document(data_dir, document_text())
    resposta = client.put(
        "/api/document", json={"baseHash": base, "content": document_text(revision=2)}
    )
    assert resposta.status_code == 200


def test_put_403_e_verificado_antes_do_conflito_de_hash(client: TestClient, data_dir: Path) -> None:
    """O papel é o primeiro gate — nem um `baseHash` errado chega a virar 409 para um READER."""
    acl = {"users": [{"username": "arthur", "role": "READER"}, {"username": "x", "role": "ADMIN"}], "defaultRole": "READER"}
    write_document(data_dir, doc_with_acl(acl))

    resposta = client.put(
        "/api/document", json={"baseHash": "0" * 64, "content": doc_with_acl(acl, revision=2)}
    )

    assert resposta.status_code == 403
