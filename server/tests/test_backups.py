"""Backups automáticos e rotação de 20 — docs/06 §9, docs/14 §4 e §11."""

from __future__ import annotations

from datetime import datetime
from pathlib import Path

import policyops_server as server
from conftest import document_text, write_document
from fastapi.testclient import TestClient


def salvar(client: TestClient, base: str, revision: int) -> str:
    """Um save bem-sucedido; devolve o hash resultante para servir de `baseHash` do próximo."""
    resposta = client.put(
        "/api/document", json={"baseHash": base, "content": document_text(revision=revision)}
    )
    assert resposta.status_code == 200, resposta.text
    return resposta.json()["hash"]


def test_todo_save_copia_o_conteudo_anterior(client: TestClient, data_dir: Path) -> None:
    anterior = document_text(revision=1)
    base = write_document(data_dir, anterior)

    corpo = client.put("/api/document", json={"baseHash": base, "content": document_text(revision=2)}).json()

    copias = list((data_dir / "_backups").iterdir())
    assert len(copias) == 1
    assert copias[0].name == corpo["backup"]
    # O backup guarda o que estava lá **antes**, não o que acabou de ser gravado.
    assert copias[0].read_text(encoding="utf-8") == anterior


def test_nome_do_backup_e_o_mesmo_do_modo_full(data_dir: Path) -> None:
    nome = server.backup_file_name("politicas.json", datetime(2026, 8, 5, 14, 32, 7))

    assert nome == "politicas.2026-08-05T14-32-07.json"
    assert server.is_backup_of(nome, "politicas.json")
    assert not server.is_backup_of("politicas.json", "politicas.json")


def test_primeiro_save_nao_gera_backup(client: TestClient, data_dir: Path) -> None:
    corpo = client.put("/api/document", json={"baseHash": None, "content": document_text()}).json()

    assert corpo["backup"] is None
    assert not (data_dir / "_backups").exists()


def test_a_vigesima_primeira_copia_apaga_a_mais_antiga(client: TestClient, data_dir: Path) -> None:
    """docs/06 §9: mantém os 20 mais recentes — a rotação é exata, não aproximada."""
    base = write_document(data_dir, document_text(revision=0))
    for revision in range(1, 22):  # 21 saves ⇒ 21 backups tentados
        base = salvar(client, base, revision)

    copias = sorted(entrada.name for entrada in (data_dir / "_backups").iterdir())
    assert len(copias) == server.MAX_BACKUPS
    # A cópia da revisão 0 (a mais antiga) foi a que saiu.
    conteudos = [(data_dir / "_backups" / nome).read_text(encoding="utf-8") for nome in copias]
    assert document_text(revision=0) not in conteudos
    assert document_text(revision=1) in conteudos


def test_saves_no_mesmo_segundo_nao_se_sobrescrevem(client: TestClient, data_dir: Path) -> None:
    """Cinco saves em menos de um segundo ainda são cinco cópias distintas."""
    base = write_document(data_dir, document_text(revision=0))
    for revision in range(1, 6):
        base = salvar(client, base, revision)

    copias = list((data_dir / "_backups").iterdir())
    assert len(copias) == 5
    assert len({copia.read_text(encoding="utf-8") for copia in copias}) == 5


def test_backup_indisponivel_nao_bloqueia_o_salvamento(client: TestClient, data_dir: Path) -> None:
    """Pasta `_backups` impossível de criar: avisa no log e o save segue (§9)."""
    (data_dir / "_backups").write_text("não sou uma pasta", encoding="utf-8")
    base = write_document(data_dir, document_text(revision=1))

    corpo = client.put("/api/document", json={"baseHash": base, "content": document_text(revision=2)}).json()

    assert corpo["backup"] is None
    assert (data_dir / "politicas.json").read_text(encoding="utf-8") == document_text(revision=2)


def test_lista_de_backups_vem_do_mais_novo_para_o_mais_antigo(client: TestClient, data_dir: Path) -> None:
    base = write_document(data_dir, document_text(revision=0))
    for revision in range(1, 4):
        base = salvar(client, base, revision)

    corpo = client.get("/api/backups").json()

    nomes = [entrada["name"] for entrada in corpo["backups"]]
    assert nomes == sorted(nomes, reverse=True)
    assert len(nomes) == 3
    for entrada in corpo["backups"]:
        assert entrada["bytes"] > 0
        assert entrada["mtime"].endswith("Z")


def test_lista_vazia_quando_nunca_houve_backup(client: TestClient) -> None:
    assert client.get("/api/backups").json() == {"backups": []}


def test_lista_ignora_arquivos_que_nao_sao_backup_do_documento(client: TestClient, data_dir: Path) -> None:
    backups = data_dir / "_backups"
    backups.mkdir()
    (backups / "politicas.2026-08-05T14-32-07.json").write_text("{}", encoding="utf-8")
    (backups / "leia-me.txt").write_text("anotação de quem opera a pasta", encoding="utf-8")
    (backups / "outro-documento.2026-08-05T14-32-07.json").write_text("{}", encoding="utf-8")

    nomes = [entrada["name"] for entrada in client.get("/api/backups").json()["backups"]]

    assert nomes == ["politicas.2026-08-05T14-32-07.json"]
