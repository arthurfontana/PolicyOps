"""Fixtures dos testes do servidor local (docs/14-plataforma-local.md §11).

Tudo roda contra `tmp_path` e o `TestClient` do FastAPI — nenhum teste sobe processo, abre porta
ou toca a pasta de rede de verdade.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any, Dict, Optional

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import policyops_server as server  # noqa: E402


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    folder = tmp_path / "rede"
    folder.mkdir()
    return folder


@pytest.fixture
def config(data_dir: Path) -> server.ServerConfig:
    return server.ServerConfig(
        data_dir=data_dir,
        username="arthur",
        display_name="Arthur",
        token="token-de-teste",
    )


@pytest.fixture
def client(config: server.ServerConfig) -> TestClient:
    """Cliente já autenticado — o caso sem token é testado explicitamente em test_security.py."""
    test_client = TestClient(server.create_app(config))
    test_client.headers.update({"X-PolicyOps-Token": config.token})
    return test_client


def document_text(revision: int = 1, extra: Optional[Dict[str, Any]] = None) -> str:
    """Um documento plausível — o servidor não conhece o schema (ADR-002), só precisa de JSON."""
    payload: Dict[str, Any] = {
        "schemaVersion": 3,
        "meta": {"id": "doc-1", "name": "Políticas", "revision": revision},
        "projects": [],
    }
    if extra:
        payload.update(extra)
    return json.dumps(payload, ensure_ascii=False, indent=2)


def write_document(data_dir: Path, text: str, name: str = "politicas.json") -> str:
    """Grava o arquivo e devolve o hash — o `baseHash` que o front teria em mãos."""
    path = data_dir / name
    path.write_text(text, encoding="utf-8")
    return server.sha256_hex(text.encode("utf-8"))


def write_lock(
    data_dir: Path,
    holder: str,
    heartbeat: str,
    username: Optional[str] = None,
    since: Optional[str] = None,
) -> Path:
    path = data_dir / "politicas.lock.json"
    lock: Dict[str, Any] = {
        "holder": holder,
        "since": since or heartbeat,
        "heartbeat": heartbeat,
        "docRevision": 41,
    }
    if username is not None:
        lock["username"] = username
    path.write_text(json.dumps(lock, ensure_ascii=False, indent=2), encoding="utf-8")
    return path
