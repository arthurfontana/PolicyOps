"""Acervo de evidências — docs/14-plataforma-local.md §7 e §11, ADR-004.

O critério central do ADR-004 é o cenário de desastre: **o arquivo tem que estar lá, legível,
com o nome original, sem a aplicação**. Por isso quase todo teste aqui olha para o disco
(`data_dir / "_evidencias" / ...`) além da resposta HTTP.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

import policyops_server as server
import pytest
from conftest import document_text, write_document
from fastapi.testclient import TestClient

DOCX = b"PK\x03\x04conteudo-do-db-513"


def acervo(data_dir: Path) -> Path:
    return data_dir / server.EVIDENCE_DIR_NAME


def anexar(
    client: TestClient,
    nome: str = "DB 513 - Ajuste.docx",
    conteudo: bytes = DOCX,
    projeto: str = "POLITICA_PF",
    matriz: Optional[str] = "MTZ_LIMITE_PF",
    versao: Optional[str] = "12",
    data: Optional[str] = "2026-08-14",
) -> Any:
    campos: Dict[str, str] = {"project": projeto}
    if matriz is not None:
        campos["matrix"] = matriz
    if versao is not None:
        campos["version"] = versao
    if data is not None:
        campos["date"] = data
    return client.post("/api/evidences", files={"file": (nome, conteudo)}, data=campos)


def doc_com_acl(acl: Dict[str, Any]) -> str:
    return document_text(extra={"meta": {"id": "doc-1", "name": "Políticas", "revision": 1, "acl": acl}})


# #region: caminho-legivel-e-hash


def test_anexar_copia_para_o_caminho_legivel_exato(client: TestClient, data_dir: Path) -> None:
    resposta = anexar(client)

    assert resposta.status_code == 201
    corpo = resposta.json()
    assert corpo["relPath"] == "politica-pf/mtz-limite-pf/v12/2026-08-14_DB 513 - Ajuste.docx"

    # O critério do ADR-004: o arquivo está lá, com o nome original, navegável no Explorer.
    no_disco = acervo(data_dir) / "politica-pf" / "mtz-limite-pf" / "v12" / "2026-08-14_DB 513 - Ajuste.docx"
    assert no_disco.is_file()
    assert no_disco.read_bytes() == DOCX


def test_anexar_devolve_hash_e_tamanho_do_que_gravou(client: TestClient, data_dir: Path) -> None:
    corpo = anexar(client).json()

    assert corpo["sha256"] == server.sha256_hex(DOCX)
    assert corpo["bytes"] == len(DOCX)
    assert corpo["fileName"] == "2026-08-14_DB 513 - Ajuste.docx"
    # O id devolvido é o que o documento grava em `attachments[].id`: nanoid(12).
    assert len(corpo["id"]) == 12


def test_alvo_projeto_omite_os_niveis_internos(client: TestClient, data_dir: Path) -> None:
    corpo = anexar(client, nome="Oficio.pdf", matriz=None, versao=None).json()

    assert corpo["relPath"] == "politica-pf/2026-08-14_Oficio.pdf"
    assert (acervo(data_dir) / "politica-pf" / "2026-08-14_Oficio.pdf").is_file()


def test_alvo_matriz_para_no_segundo_nivel(client: TestClient, data_dir: Path) -> None:
    corpo = anexar(client, nome="Estudo.xlsx", versao=None).json()

    assert corpo["relPath"] == "politica-pf/mtz-limite-pf/2026-08-14_Estudo.xlsx"


def test_versao_sem_matriz_e_recusada(client: TestClient) -> None:
    resposta = anexar(client, matriz=None, versao="12")

    assert resposta.status_code == 400
    assert resposta.json()["code"] == "BAD_REQUEST"


def test_sem_data_informada_o_servidor_carimba_a_de_hoje(client: TestClient, data_dir: Path) -> None:
    from datetime import datetime

    corpo = anexar(client, data=None).json()

    assert corpo["fileName"].startswith(datetime.now().strftime("%Y-%m-%d") + "_")


def test_nada_e_gravado_fora_do_acervo(client: TestClient, data_dir: Path) -> None:
    anexar(client)

    assert sorted(entry.name for entry in data_dir.iterdir()) == [server.EVIDENCE_DIR_NAME]


# #region: colisao-de-nome


def test_colisao_de_nome_ganha_sufixo_e_nunca_sobrescreve(client: TestClient, data_dir: Path) -> None:
    primeiro = anexar(client).json()
    segundo = anexar(client, conteudo=b"outro conteudo").json()
    terceiro = anexar(client, conteudo=b"mais um").json()

    assert primeiro["relPath"].endswith("2026-08-14_DB 513 - Ajuste.docx")
    assert segundo["relPath"].endswith("2026-08-14_DB 513 - Ajuste (2).docx")
    assert terceiro["relPath"].endswith("2026-08-14_DB 513 - Ajuste (3).docx")

    pasta = acervo(data_dir) / "politica-pf" / "mtz-limite-pf" / "v12"
    assert (pasta / "2026-08-14_DB 513 - Ajuste.docx").read_bytes() == DOCX
    assert (pasta / "2026-08-14_DB 513 - Ajuste (2).docx").read_bytes() == b"outro conteudo"


def test_nenhum_tmp_sobra_depois_da_copia(client: TestClient, data_dir: Path) -> None:
    anexar(client)

    assert list(acervo(data_dir).rglob("*.tmp")) == []


# #region: download-e-integridade


def test_download_devolve_os_bytes_originais(client: TestClient) -> None:
    anexo = anexar(client).json()

    resposta = client.get(
        "/api/evidences/{}".format(anexo["id"]),
        params={"relPath": anexo["relPath"], "sha256": anexo["sha256"]},
    )

    assert resposta.status_code == 200
    assert resposta.content == DOCX


def test_arquivo_adulterado_no_disco_devolve_hash_mismatch(client: TestClient, data_dir: Path) -> None:
    anexo = anexar(client).json()
    (acervo(data_dir) / Path(anexo["relPath"])).write_bytes(b"conteudo trocado por fora")

    resposta = client.get(
        "/api/evidences/{}".format(anexo["id"]),
        params={"relPath": anexo["relPath"], "sha256": anexo["sha256"]},
    )

    assert resposta.status_code == 409
    corpo = resposta.json()
    assert corpo["code"] == "HASH_MISMATCH"
    assert corpo["expected"] == anexo["sha256"]
    assert corpo["actual"] == server.sha256_hex(b"conteudo trocado por fora")
    # A mensagem diz onde procurar — é o que a interface mostra em português.
    assert str(acervo(data_dir)) in corpo["detail"]


def test_arquivo_movido_a_mao_devolve_404_com_o_caminho_esperado(client: TestClient, data_dir: Path) -> None:
    anexo = anexar(client).json()
    (acervo(data_dir) / Path(anexo["relPath"])).unlink()

    resposta = client.get(
        "/api/evidences/{}".format(anexo["id"]),
        params={"relPath": anexo["relPath"], "sha256": anexo["sha256"]},
    )

    assert resposta.status_code == 404
    detalhe = resposta.json()["detail"]
    assert "2026-08-14_DB 513 - Ajuste.docx" in detalhe
    assert server.EVIDENCE_TRASH_DIR_NAME in detalhe


def test_download_sem_hash_registrado_e_recusado(client: TestClient) -> None:
    anexo = anexar(client).json()

    resposta = client.get("/api/evidences/x", params={"relPath": anexo["relPath"]})

    assert resposta.status_code == 400


# #region: lixeira


def test_delete_move_para_a_lixeira_preservando_a_arvore(client: TestClient, data_dir: Path) -> None:
    anexo = anexar(client).json()

    resposta = client.delete("/api/evidences/{}".format(anexo["id"]), params={"relPath": anexo["relPath"]})

    assert resposta.status_code == 200
    assert resposta.json()["trashed"] is True
    assert not (acervo(data_dir) / Path(anexo["relPath"])).exists()

    # Nada jamais é apagado: mesma árvore, mesmo conteúdo, dentro de _lixeira/.
    na_lixeira = acervo(data_dir) / server.EVIDENCE_TRASH_DIR_NAME / Path(anexo["relPath"])
    assert na_lixeira.is_file()
    assert na_lixeira.read_bytes() == DOCX
    assert resposta.json()["relPath"] == "{}/{}".format(server.EVIDENCE_TRASH_DIR_NAME, anexo["relPath"])


def test_lixeira_nao_sobrescreve_arquivo_de_mesmo_nome(client: TestClient, data_dir: Path) -> None:
    primeiro = anexar(client).json()
    client.delete("/api/evidences/x", params={"relPath": primeiro["relPath"]})
    segundo = anexar(client, conteudo=b"segunda versao").json()

    client.delete("/api/evidences/y", params={"relPath": segundo["relPath"]})

    lixeira = acervo(data_dir) / server.EVIDENCE_TRASH_DIR_NAME / "politica-pf" / "mtz-limite-pf" / "v12"
    assert (lixeira / "2026-08-14_DB 513 - Ajuste.docx").read_bytes() == DOCX
    assert (lixeira / "2026-08-14_DB 513 - Ajuste (2).docx").read_bytes() == b"segunda versao"


def test_delete_de_arquivo_ja_ausente_nao_vira_erro(client: TestClient) -> None:
    """O front chama isto **depois** do save; um arquivo já movido não pode virar erro na tela."""
    resposta = client.delete("/api/evidences/x", params={"relPath": "politica-pf/v1/nada.docx"})

    assert resposta.status_code == 200
    assert resposta.json()["trashed"] is False


# #region: path-traversal


@pytest.mark.parametrize(
    "caminho",
    [
        "../politicas.json",
        "politica-pf/../../politicas.json",
        "/etc/passwd",
        "C:/Windows/System32/drivers/etc/hosts",
        "..\\politicas.json",
        "",
    ],
)
def test_caminho_para_fora_do_acervo_e_recusado(client: TestClient, data_dir: Path, caminho: str) -> None:
    original = write_document(data_dir, document_text())

    baixar = client.get("/api/evidences/x", params={"relPath": caminho, "sha256": "a" * 64})
    apagar = client.delete("/api/evidences/x", params={"relPath": caminho})

    assert baixar.status_code == 400, caminho
    assert apagar.status_code == 400, caminho
    # O documento continua onde estava, byte a byte.
    assert server.sha256_hex((data_dir / "politicas.json").read_bytes()) == original


def test_slug_do_alvo_nao_deixa_o_upload_sair_do_acervo(client: TestClient, data_dir: Path) -> None:
    """A anexação não valida caminho: ela **constrói** um, e o slug não sabe dizer `..`."""
    corpo = anexar(client, projeto="../../etc", matriz="..", versao=None).json()

    assert corpo["relPath"] == "etc/sem-nome/2026-08-14_DB 513 - Ajuste.docx"
    assert (acervo(data_dir) / Path(corpo["relPath"])).is_file()


def test_nome_de_arquivo_com_caminho_perde_o_caminho(client: TestClient, data_dir: Path) -> None:
    corpo = anexar(client, nome="..\\..\\politicas.json").json()

    assert corpo["fileName"] == "2026-08-14_politicas.json"
    assert (acervo(data_dir) / Path(corpo["relPath"])).is_file()


def test_resolve_under_e_puro_e_recusa_o_que_sai_da_raiz(tmp_path: Path) -> None:
    raiz = tmp_path / "_evidencias"
    raiz.mkdir()

    assert server.resolve_under(raiz, "a/b.docx") == (raiz / "a" / "b.docx").resolve()
    assert server.resolve_under(raiz, "./a/b.docx") == (raiz / "a" / "b.docx").resolve()
    assert server.resolve_under(raiz, "../fora.json") is None
    assert server.resolve_under(raiz, "a/../../fora.json") is None
    assert server.resolve_under(raiz, "   ") is None


# #region: limite-de-tamanho


def test_limite_documentado_e_de_50_mb() -> None:
    assert server.MAX_EVIDENCE_BYTES == 50 * 1024 * 1024


def test_arquivo_acima_do_limite_devolve_413_e_nao_deixa_rastro(
    client: TestClient, data_dir: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(server, "MAX_EVIDENCE_BYTES", 1024)

    resposta = anexar(client, conteudo=b"x" * 4096)

    assert resposta.status_code == 413
    corpo = resposta.json()
    assert corpo["code"] == "TOO_LARGE"
    assert "não foi copiado" in corpo["detail"]
    # Nem o arquivo final nem o `.tmp` sobram.
    assert list(acervo(data_dir).rglob("*")) == [
        acervo(data_dir) / "politica-pf",
        acervo(data_dir) / "politica-pf" / "mtz-limite-pf",
        acervo(data_dir) / "politica-pf" / "mtz-limite-pf" / "v12",
    ]


# #region: papel-minimo


def test_reader_nao_anexa_nem_desanexa(client: TestClient, data_dir: Path) -> None:
    anexo = anexar(client).json()
    write_document(
        data_dir,
        doc_com_acl(
            {
                "users": [
                    {"username": "arthur", "role": "READER"},
                    {"username": "chefe", "role": "ADMIN"},
                ],
                "defaultRole": "READER",
            }
        ),
    )

    assert anexar(client, nome="Novo.docx").status_code == 403
    apagar = client.delete("/api/evidences/{}".format(anexo["id"]), params={"relPath": anexo["relPath"]})
    assert apagar.status_code == 403
    assert apagar.json()["code"] == "FORBIDDEN"

    # Consultar continua liberado — READER lê (docs/14 §6).
    baixar = client.get(
        "/api/evidences/{}".format(anexo["id"]),
        params={"relPath": anexo["relPath"], "sha256": anexo["sha256"]},
    )
    assert baixar.status_code == 200


def test_editor_anexa(client: TestClient, data_dir: Path) -> None:
    write_document(
        data_dir,
        doc_com_acl(
            {
                "users": [
                    {"username": "arthur", "role": "EDITOR"},
                    {"username": "chefe", "role": "ADMIN"},
                ],
                "defaultRole": "READER",
            }
        ),
    )

    assert anexar(client).status_code == 201


# #region: token


def test_evidencias_exigem_token(config: server.ServerConfig) -> None:
    anonimo = TestClient(server.create_app(config))

    assert anonimo.post("/api/evidences", files={"file": ("a.txt", b"x")}, data={"project": "P"}).status_code == 401
    assert anonimo.get("/api/evidences/x", params={"relPath": "a", "sha256": "b"}).status_code == 401
    assert anonimo.delete("/api/evidences/x", params={"relPath": "a"}).status_code == 401


def test_o_servidor_nao_le_o_documento_para_resolver_evidencia(client: TestClient, data_dir: Path) -> None:
    """ADR-002: o registro dos anexos é o documento, no front. O servidor só toca arquivos.

    Um `politicas.json` quebrado não pode atrapalhar nem o anexo nem o download — a única coisa
    que o servidor lê dali é o envelope de `meta.acl` (que já cai em modo aberto se estiver
    ilegível).
    """
    (data_dir / "politicas.json").write_text("{ isto não é json", encoding="utf-8")

    anexo = anexar(client).json()
    baixar = client.get(
        "/api/evidences/{}".format(anexo["id"]),
        params={"relPath": anexo["relPath"], "sha256": anexo["sha256"]},
    )

    assert baixar.status_code == 200
    assert json.loads(json.dumps(anexo))["relPath"].startswith("politica-pf/")
