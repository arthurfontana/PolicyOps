"""Servidor local do Policy Matrix Studio.

Um processo Python por usuário, ouvindo **somente** em `127.0.0.1`, que serve a SPA
(`PolicyOps.html`) e faz todo o I/O contra a pasta de rede — docs/14-plataforma-local.md §3–§5
(contrato da API e segurança), docs/06-persistencia-e-concorrencia.md §4–§6 e §9 (save, conflito,
lock consultivo e backups) e ADR-001/ADR-002/ADR-005 de docs/13-decisoes.md.

Este arquivo é **infraestrutura, não regra de negócio** (ADR-002): ele não conhece o schema do
documento, não valida invariantes e não migra nada — só recusa JSON sintaticamente inválido e
envelope errado. Quem valida é `src/core/document/validate.ts`, no front, antes de chamar a API.

Uso:

    python server/policyops_server.py --data-dir \\\\rede\\Politicas

Âncoras de navegação (`grep -n "# #region:" server/policyops_server.py`).
"""

from __future__ import annotations

# #region: imports-e-constantes

import argparse
import getpass
import hashlib
import json
import logging
import os
import re
import secrets
import shutil
import socket
import sys
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

APP_NAME = "Policy Matrix Studio"
"""Versão da API — carimbada em `X-PolicyOps-Api` de toda resposta (docs/14 §4).

O front recusa operar contra uma versão maior que a sua; incrementar isto é quebra de contrato.
"""
API_VERSION = 1

HOST = "127.0.0.1"
PORT_RANGE = range(8770, 8800)

DEFAULT_DATA_FILE = "politicas.json"
HTML_FILE_NAME = "PolicyOps.html"
CONFIG_FILE_NAME = "config.json"

BACKUP_DIR_NAME = "_backups"
MAX_BACKUPS = 20
"""Lock com heartbeat parado há mais de 10 min é obsoleto e pode ser tomado (docs/06 §6)."""
LOCK_STALE_SECONDS = 10 * 60

EVIDENCE_DIR_NAME = "_evidencias"
"""Acervo de evidências, navegável no Explorer (ADR-004, docs/14 §7)."""
EVIDENCE_TRASH_DIR_NAME = "_lixeira"
"""Limite por arquivo (docs/14 §7). Recusa com `413` e mensagem clara — nunca grava pela metade."""
MAX_EVIDENCE_BYTES = 50 * 1024 * 1024
EVIDENCE_CHUNK_BYTES = 1024 * 1024
"""Mesmo alfabeto e comprimento de `nanoid(12)` (`NANOID_REGEX`, src/core/document/primitives.ts).

O id devolvido pelo `POST` é o id que o documento grava em `attachments[].id` — precisa passar
pelo schema do front sem tratamento especial.
"""
EVIDENCE_ID_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"
EVIDENCE_ID_LENGTH = 12

BACKUP_UNAVAILABLE_MESSAGE = (
    "Não foi possível gravar em _backups ao lado do arquivo — provavelmente falta permissão de "
    "escrita. O salvamento segue normalmente, sem backup local."
)

logger = logging.getLogger("policyops")

# #region: utilitarios-de-tempo-e-hash


def sha256_hex(data: bytes) -> str:
    """SHA-256 em hexadecimal — o mesmo `hashDocument` de `src/core/document/serialize.ts`."""
    return hashlib.sha256(data).hexdigest()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(moment: datetime) -> str:
    """ISO 8601 em UTC com milissegundos, idêntico ao `Date#toISOString()` do front."""
    as_utc = moment.astimezone(timezone.utc)
    return "{}.{:03d}Z".format(as_utc.strftime("%Y-%m-%dT%H:%M:%S"), as_utc.microsecond // 1000)


def iso_from_timestamp(timestamp: float) -> str:
    return iso_utc(datetime.fromtimestamp(timestamp, timezone.utc))


# #region: configuracao-e-identidade


@dataclass
class ServerConfig:
    """Tudo que o processo resolve **uma vez, no boot** (identidade inclusive, ADR-003)."""

    data_dir: Path
    data_file: str = DEFAULT_DATA_FILE
    static_dir: Optional[Path] = None
    html_path: Optional[Path] = None
    username: str = field(default_factory=lambda: resolve_username())
    display_name: Optional[str] = None
    token: str = field(default_factory=lambda: secrets.token_urlsafe(32))
    started: str = field(default_factory=lambda: iso_utc(utc_now()))

    @property
    def document_path(self) -> Path:
        return self.data_dir / self.data_file

    @property
    def lock_path(self) -> Path:
        return self.data_dir / lock_file_name(self.data_file)

    @property
    def backup_dir(self) -> Path:
        return self.data_dir / BACKUP_DIR_NAME

    @property
    def evidence_dir(self) -> Path:
        """Raiz do acervo. **Todo** caminho de evidência é resolvido debaixo dela (docs/14 §7)."""
        return self.data_dir / EVIDENCE_DIR_NAME

    @property
    def holder(self) -> str:
        """O nome que aparece no banner *"Fulano está editando desde 09:00"* (docs/06 §6)."""
        return self.display_name or self.username


def resolve_username() -> str:
    """Login de rede do Windows (ADR-003). Em ambiente sem login resolvível, não derruba o boot."""
    try:
        return getpass.getuser()
    except Exception:  # pragma: no cover - depende do SO
        return "desconhecido"


def read_config_file(path: Path) -> Dict[str, Any]:
    """`config.json` ao lado do servidor. Arquivo ausente ou ilegível não impede o boot."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as error:
        logger.warning("config.json ignorado (%s): %s", path, error)
        return {}
    if not isinstance(raw, dict):
        logger.warning("config.json ignorado (%s): o conteúdo não é um objeto JSON", path)
        return {}
    return raw


def resolve_html_path(static_dir: Path, explicit: Optional[Path] = None) -> Optional[Path]:
    """O `PolicyOps.html` servido em `GET /`.

    `static_dir` é a pasta de `policyops_server.py` — em produção, `_app/server/` (docs/14 §2).
    O pacote publicado pela TI (S28) põe o `PolicyOps.html` **um nível acima**, em `_app/`,
    irmão de `server/`; checar `static_dir` primeiro só cobre quem achatar as duas pastas numa
    só. No repositório de desenvolvimento o build mora em `dist/PolicyOps.html`, ao lado de
    `server/` — é isso que o último fallback procura, conveniência de dev que nunca busca fora
    do próprio checkout.
    """
    if explicit is not None:
        return explicit if explicit.is_file() else None
    packaged = static_dir / HTML_FILE_NAME
    if packaged.is_file():
        return packaged
    ao_lado_do_pacote = static_dir.parent / HTML_FILE_NAME
    if ao_lado_do_pacote.is_file():
        return ao_lado_do_pacote
    dev_build = static_dir.parent / "dist" / HTML_FILE_NAME
    if dev_build.is_file():
        return dev_build
    return None


# #region: escrita-atomica-e-backups


def write_atomic(target: Path, data: bytes) -> None:
    """Grava em `{nome}.tmp` na mesma pasta, `flush` + `fsync`, `os.replace` (docs/14 §4).

    Queda de rede (ou da máquina) no meio do save nunca deixa `politicas.json` truncado: ou o
    `os.replace` aconteceu — e o arquivo é o novo, inteiro —, ou não aconteceu, e o arquivo é o
    anterior, intocado. O `.tmp` é removido em qualquer falha.
    """
    tmp = target.with_name(target.name + ".tmp")
    try:
        with open(tmp, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, target)
    except BaseException:
        try:
            tmp.unlink()
        except OSError:
            pass
        raise
    _fsync_directory(target.parent)


def _fsync_directory(directory: Path) -> None:
    """Durabilidade do próprio rename em POSIX. No Windows (e em rede) simplesmente não se aplica."""
    try:
        fd = os.open(str(directory), os.O_RDONLY)
    except OSError:
        return
    try:
        os.fsync(fd)
    except OSError:
        pass
    finally:
        os.close(fd)


def base_name(file_name: str) -> str:
    """`politicas.json` → `politicas` (mesmo `baseName` de `src/storage/format.ts`)."""
    return re.sub(r"\.[^.]+$", "", file_name)


def backup_file_name(data_file: str, at: datetime) -> str:
    """`politicas.2026-08-05T14-32-07.json` — mesmo formato do modo `FULL` (docs/06 §9).

    Manter o formato idêntico importa: uma pasta pode receber backups do servidor e do navegador,
    e a rotação de um precisa reconhecer (e poder apagar) os do outro.
    """
    return "{}.{}.json".format(base_name(data_file), at.strftime("%Y-%m-%dT%H-%M-%S"))


def is_backup_of(file_name: str, data_file: str) -> bool:
    return bool(
        file_name.startswith(base_name(data_file) + ".")
        and re.search(r"\.\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$", file_name)
    )


def list_backups(backup_dir: Path, data_file: str) -> List[Path]:
    """Backups do documento, do mais antigo para o mais novo (o timestamp ordena por construção)."""
    if not backup_dir.is_dir():
        return []
    return sorted(
        (entry for entry in backup_dir.iterdir() if entry.is_file() and is_backup_of(entry.name, data_file)),
        key=lambda entry: entry.name,
    )


def write_backup(
    backup_dir: Path, data_file: str, previous: bytes, at: datetime, max_backups: int = MAX_BACKUPS
) -> Optional[str]:
    """Copia o conteúdo **anterior** para `_backups/` e apaga o excedente (docs/06 §9).

    Devolve o nome gravado, ou `None` se a pasta não pôde ser usada — backup nunca bloqueia
    salvamento; falha vira aviso no log e a vida segue.
    """
    try:
        backup_dir.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        logger.warning("%s (%s)", BACKUP_UNAVAILABLE_MESSAGE, error)
        return None

    # Dois saves no mesmo segundo colidiriam no nome; anda um segundo em vez de sobrescrever
    # (o formato do nome é compartilhado com o front e não comporta sufixo).
    stamp = at
    name = backup_file_name(data_file, stamp)
    while (backup_dir / name).exists():
        stamp = stamp + timedelta(seconds=1)
        name = backup_file_name(data_file, stamp)

    try:
        write_atomic(backup_dir / name, previous)
    except OSError as error:
        logger.warning("%s (%s)", BACKUP_UNAVAILABLE_MESSAGE, error)
        return None

    prune_backups(backup_dir, data_file, max_backups)
    return name


def prune_backups(backup_dir: Path, data_file: str, max_backups: int = MAX_BACKUPS) -> List[str]:
    """Mantém os `max_backups` mais recentes. Backup que não some não derruba o salvamento."""
    existing = list_backups(backup_dir, data_file)
    excess = existing[: max(0, len(existing) - max_backups)]
    removed: List[str] = []
    for entry in excess:
        try:
            entry.unlink()
            removed.append(entry.name)
        except OSError:
            pass
    return removed


# #region: lock-consultivo


def lock_file_name(data_file: str) -> str:
    """`politicas.json` → `politicas.lock.json` (docs/06 §6, mesmo nome do modo `FULL`)."""
    return "{}.lock.json".format(base_name(data_file))


def read_lock(path: Path) -> Optional[Dict[str, Any]]:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    if not isinstance(raw.get("holder"), str) or not isinstance(raw.get("heartbeat"), str):
        return None
    return raw


def lock_is_stale(lock: Dict[str, Any], now: datetime) -> bool:
    heartbeat = parse_iso(lock.get("heartbeat"))
    if heartbeat is None:
        return True
    return (now - heartbeat).total_seconds() > LOCK_STALE_SECONDS


def parse_iso(value: Any) -> Optional[datetime]:
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


def lock_is_mine(lock: Dict[str, Any], config: "ServerConfig") -> bool:
    """`username` é o campo autoritativo; `holder` é o rótulo que o modo `FULL` também escreve."""
    owner = lock.get("username")
    if isinstance(owner, str):
        return owner == config.username
    return lock.get("holder") == config.holder


# #region: identidade-e-papeis


VALID_ROLES = ("READER", "EDITOR", "PUBLISHER", "ADMIN")
"""docs/14-plataforma-local.md §6 — mesmo catálogo de `Role` em `src/core/document/schema.ts`."""


def read_document_acl(config: "ServerConfig") -> Optional[Dict[str, Any]]:
    """Lê só `meta.acl` do documento em disco, defensivamente (ADR-002).

    O servidor não valida o schema nem as invariantes do documento — só
    precisa deste envelope mínimo para resolver papéis (docs/14 §3, §6).
    Qualquer forma inesperada (arquivo ausente, JSON inválido, `meta`/`acl`
    fora do formato) devolve `None`, que `resolve_effective_role` lê como
    "sem ACL" — modo aberto, nunca uma falha de boot.
    """
    try:
        raw = json.loads(config.document_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    if not isinstance(raw, dict):
        return None
    meta = raw.get("meta")
    if not isinstance(meta, dict):
        return None
    acl = meta.get("acl")
    return acl if isinstance(acl, dict) else None


def resolve_effective_role(config: "ServerConfig") -> str:
    """Papel efetivo do usuário do boot — mesma regra de `resolveRole` do front (docs/14 §6).

    ACL ausente, vazia, ou populada sem nenhum `ADMIN`: modo aberto,
    `PUBLISHER` para todo mundo. Listado: o papel da lista. Não listado:
    `defaultRole`. Este resultado só alimenta o `whoami` e o `403` grosso de
    `PUT /api/document` — o servidor não re-deriva permissão fina por
    comando (ADR-002, docs/14 §6).
    """
    acl = read_document_acl(config)
    if acl is None:
        return "PUBLISHER"
    users = acl.get("users")
    if not isinstance(users, list) or not users:
        return "PUBLISHER"

    def entry_role(entry: Any) -> Optional[str]:
        if not isinstance(entry, dict):
            return None
        role = entry.get("role")
        return role if role in VALID_ROLES else None

    if not any(entry_role(entry) == "ADMIN" for entry in users):
        return "PUBLISHER"

    for entry in users:
        if isinstance(entry, dict) and entry.get("username") == config.username:
            role = entry_role(entry)
            if role is not None:
                return role

    default_role = acl.get("defaultRole")
    return default_role if default_role in ("READER", "EDITOR") else "READER"


def role_allows(role: str, minimum: str) -> bool:
    """`role` alcança `minimum` na ordem de `VALID_ROLES` — mesmo `roleAtLeast` do front."""
    if role not in VALID_ROLES or minimum not in VALID_ROLES:
        return False
    return VALID_ROLES.index(role) >= VALID_ROLES.index(minimum)


# #region: evidencias-caminhos-e-integridade


def slug_segment(value: str) -> str:
    """Um nível de pasta do acervo, legível e **seguro por construção** (docs/14 §7, ADR-004).

    `CREDITO_VAREJO` → `credito-varejo`. O resultado só contém `[a-z0-9-]`, então não existe
    caminho relativo (`..`), separador (`/`, `\\`) nem letra de unidade (`C:`) que consiga sair
    de `_evidencias/` por aqui — a defesa contra *path traversal* na anexação é a própria forma
    do slug, não uma lista de proibições.
    """
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    slug = re.sub(r"[^A-Za-z0-9]+", "-", ascii_only).strip("-").lower()
    return slug or "sem-nome"


def safe_file_name(name: str) -> str:
    """Preserva o nome original (ADR-004) tirando só o que não pode virar nome de arquivo.

    Componente de diretório (`pasta/arquivo.docx`, `..\\x`), caractere de controle e os
    caracteres que o Windows recusa (`<>:"|?*`) saem; ponto e espaço nas pontas também, que é o
    que impediria um `..` ou um nome inválido no Explorer. O que sobra é o nome que a pessoa
    reconhece quando abre a pasta.
    """
    base = re.split(r"[\\/]", name)[-1]
    cleaned = "".join(char for char in base if char >= " " and char not in '<>:"|?*')
    cleaned = cleaned.strip(" .")
    return cleaned or "evidencia"


def resolve_under(root: Path, rel_path: str) -> Optional[Path]:
    """Resolve `rel_path` **debaixo** de `root`, ou `None` se ele tentar sair de lá.

    O caminho vem do documento (`attachments[].relPath`), que é texto de fora como qualquer
    outro. Duas barreiras: rejeitar o que já é suspeito na forma (absoluto, letra de unidade,
    segmento `..`) e, depois de `resolve()`, conferir que o resultado continua dentro da raiz —
    a segunda pega até o caso de um *symlink* plantado dentro do acervo.
    """
    text = (rel_path or "").strip().replace("\\", "/")
    if text == "" or text.startswith("/") or ":" in text:
        return None
    parts = [part for part in text.split("/") if part not in ("", ".")]
    if not parts or any(part == ".." for part in parts):
        return None

    root_resolved = root.resolve()
    candidate = root_resolved.joinpath(*parts).resolve()
    try:
        candidate.relative_to(root_resolved)
    except ValueError:
        return None
    return candidate


def unique_path(directory: Path, file_name: str) -> Path:
    """`DB 513.docx` já existente vira `DB 513 (2).docx` — nunca sobrescreve (docs/14 §7)."""
    target = directory / file_name
    if not target.exists():
        return target
    stem = Path(file_name).stem
    suffix = Path(file_name).suffix
    counter = 2
    while True:
        candidate = directory / "{} ({}){}".format(stem, counter, suffix)
        if not candidate.exists():
            return candidate
        counter += 1


def sha256_of_file(path: Path) -> str:
    """SHA-256 do arquivo em disco, lido em blocos — 50 MB não viram 50 MB de memória."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while True:
            chunk = handle.read(EVIDENCE_CHUNK_BYTES)
            if not chunk:
                break
            digest.update(chunk)
    return digest.hexdigest()


def new_evidence_id() -> str:
    return "".join(secrets.choice(EVIDENCE_ID_ALPHABET) for _ in range(EVIDENCE_ID_LENGTH))


def remove_quietly(path: Path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


# #region: envelope-de-erros-e-app


def json_error(status: int, code: str, detail: str, **extra: Any) -> JSONResponse:
    payload: Dict[str, Any] = {"code": code, "detail": detail}
    payload.update(extra)
    return JSONResponse(status_code=status, content=payload)


class SaveRequest(BaseModel):
    """Corpo do `PUT /api/document`.

    `content` é **texto**, não objeto: o servidor grava exatamente os bytes que o front serializou,
    para que o hash devolvido seja o mesmo que o front calculou. Formatação canônica é assunto de
    `src/core/document/serialize.ts` (ADR-002).
    """

    baseHash: Optional[str]
    content: str
    force: bool = False


class LockRequest(BaseModel):
    docRevision: int = 0
    force: bool = False


def create_app(config: ServerConfig) -> FastAPI:
    app = FastAPI(title=APP_NAME, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.config = config

    # #region: middleware-token-e-handshake

    @app.middleware("http")
    async def guard(request: Request, call_next):  # type: ignore[no-untyped-def]
        """Token por boot em todo `/api/*` menos `/api/health` (docs/14 §5) + handshake de versão.

        Sem CORS e sem exceção por origem: a SPA é servida pela mesma origem da API.
        """
        path = request.url.path
        if path.startswith("/api/") and path != "/api/health":
            # Comparação em bytes: `compare_digest` recusa `str` com caractere fora do ASCII, e
            # cabeçalho é texto de fora — token torto tem que virar 401, nunca exceção.
            offered = request.headers.get("X-PolicyOps-Token", "").encode("utf-8", "replace")
            if not secrets.compare_digest(offered, config.token.encode("utf-8")):
                response = json_error(
                    401,
                    "UNAUTHORIZED",
                    "Token ausente ou inválido. Abra a aplicação pelo endereço que o servidor "
                    "imprimiu no boot (com ?t=…).",
                )
            else:
                response = await call_next(request)
        else:
            response = await call_next(request)
        response.headers["X-PolicyOps-Api"] = str(API_VERSION)
        return response

    @app.exception_handler(RequestValidationError)
    async def on_invalid_body(request: Request, error: RequestValidationError):  # type: ignore[no-untyped-def]
        return json_error(400, "BAD_REQUEST", "Corpo da requisição fora do contrato da API v1.")

    # #region: estaticos

    def html_response() -> Any:
        """`GET /` serve o `PolicyOps.html` do diretório do servidor, sem cache (docs/14 §4).

        Nenhum outro caminho é servido: a SPA é um arquivo único e autocontido, então não há
        árvore de estáticos para percorrer — e não há como pedir um arquivo arbitrário do disco.
        """
        html = resolve_html_path(config.static_dir or Path(__file__).resolve().parent, config.html_path)
        if html is None:
            return json_error(
                404,
                "HTML_NOT_FOUND",
                "O {} não foi encontrado ao lado do servidor. Publique o build na pasta _app "
                "(docs/14-plataforma-local.md §2).".format(HTML_FILE_NAME),
            )
        return FileResponse(html, media_type="text/html", headers={"Cache-Control": "no-cache"})

    @app.get("/")
    def serve_index() -> Any:
        return html_response()

    @app.get("/" + HTML_FILE_NAME)
    def serve_html() -> Any:
        return html_response()

    # #region: api-health-e-whoami

    @app.get("/api/health")
    def health() -> Dict[str, Any]:
        """Único endpoint sem token: é o que o front usa para detectar o modo `SERVER` (docs/06 §1)."""
        return {
            "app": APP_NAME,
            "apiVersion": API_VERSION,
            "dataDir": str(config.data_dir),
            "dataFile": config.data_file,
            "started": config.started,
        }

    @app.get("/api/whoami")
    def whoami() -> Dict[str, Any]:
        """Identidade resolvida no boot (ADR-003) e o papel efetivo de `meta.acl` (docs/14 §6).

        `roles` é reavaliado a cada chamada (o ACL vive no documento, que muda) — o front usa isto
        só como referência; quem manda no `PUT` é `resolve_effective_role` de novo, na hora.
        """
        return {
            "username": config.username,
            "displayName": config.display_name,
            "roles": [resolve_effective_role(config)],
        }

    # #region: api-document

    @app.get("/api/document")
    def get_document() -> Any:
        path = config.document_path
        try:
            data = path.read_bytes()
        except FileNotFoundError:
            return json_error(
                404,
                "NOT_FOUND",
                "Ainda não existe {} em {}.".format(config.data_file, config.data_dir),
            )
        except OSError as error:
            return json_error(500, "IO", "Não foi possível ler {}: {}".format(path, error))

        try:
            raw = data.decode("utf-8")
        except UnicodeDecodeError:
            return json_error(
                422,
                "NOT_UTF8",
                "O arquivo {} não está em UTF-8 — o servidor não converte conteúdo.".format(config.data_file),
            )

        return {
            "raw": raw,
            "hash": sha256_hex(data),
            "bytes": len(data),
            "mtime": iso_from_timestamp(path.stat().st_mtime),
        }

    @app.put("/api/document")
    def put_document(body: SaveRequest) -> Any:
        """Salva o documento inteiro com detecção de conflito (docs/06 §5, docs/14 §4).

        A ordem é a mesma do modo `FULL`, agora executada aqui: relê o disco → compara o hash →
        divergiu, devolve `409` **sem gravar** → igual, faz backup do anterior e grava atômico.

        Papel efetivo `READER` é `403` antes de tudo (docs/14 §4, §6) — o servidor só recusa esse
        caso grosso; permissão fina por comando (rascunho vs. publicar) é da interface.
        """
        if resolve_effective_role(config) == "READER":
            return json_error(
                403,
                "FORBIDDEN",
                "Seu papel neste documento é READER — só consulta. Peça a um ADMIN para mudar seu "
                "papel na lista de acesso.",
            )

        path = config.document_path

        try:
            json.loads(body.content)
        except ValueError as error:
            return json_error(
                400,
                "INVALID_JSON",
                "O conteúdo enviado não é um JSON válido ({}). Nada foi gravado.".format(error),
            )

        now = utc_now()
        lock = read_lock(config.lock_path)
        if (
            lock is not None
            and not lock_is_mine(lock, config)
            and not lock_is_stale(lock, now)
            and not body.force
        ):
            return json_error(
                423,
                "LOCKED",
                "{} está editando este arquivo desde {}.".format(lock.get("holder"), lock.get("since")),
                lock=lock,
            )

        try:
            current = path.read_bytes()
        except FileNotFoundError:
            current = None
        except OSError as error:
            return json_error(500, "IO", "Não foi possível ler {}: {}".format(path, error))

        current_hash = sha256_hex(current) if current is not None else None
        expected = body.baseHash or None
        if current_hash != expected:
            remote_raw: Optional[str] = None
            if current is not None:
                try:
                    remote_raw = current.decode("utf-8")
                except UnicodeDecodeError:
                    remote_raw = None
            return json_error(
                409,
                "CONFLICT",
                "O arquivo mudou no disco desde a última leitura. Nada foi gravado.",
                remoteRaw=remote_raw,
                remoteHash=current_hash,
            )

        backup: Optional[str] = None
        if current is not None:
            backup = write_backup(config.backup_dir, config.data_file, current, datetime.now())

        data = body.content.encode("utf-8")
        try:
            write_atomic(path, data)
        except OSError as error:
            return json_error(
                500,
                "IO",
                "Não foi possível gravar {}: {}. O conteúdo anterior está intacto.".format(path, error),
            )

        return {
            "hash": sha256_hex(data),
            "savedAt": iso_utc(now),
            "bytes": len(data),
            "backup": backup,
        }

    # #region: api-lock

    @app.post("/api/document/lock")
    def acquire_lock(body: LockRequest) -> Any:
        """Toma ou renova o `{nome}.lock.json` (docs/06 §6).

        Lock ativo de outra pessoa devolve `423` com o lock: quem decide entre "abrir somente
        leitura" e "editar assim mesmo" (`force: true`) é o usuário, na interface — o bloqueio é
        consultivo e o servidor não muda isso.
        """
        now = utc_now()
        existing = read_lock(config.lock_path)
        if (
            existing is not None
            and not lock_is_mine(existing, config)
            and not lock_is_stale(existing, now)
            and not body.force
        ):
            return json_error(
                423,
                "LOCKED",
                "{} está editando este arquivo desde {}.".format(
                    existing.get("holder"), existing.get("since")
                ),
                lock=existing,
            )

        since = iso_utc(now)
        if existing is not None and lock_is_mine(existing, config) and isinstance(existing.get("since"), str):
            since = existing["since"]

        lock = {
            "holder": config.holder,
            "since": since,
            "heartbeat": iso_utc(now),
            "docRevision": body.docRevision,
            # Aditivo ao formato do modo `FULL`: identifica o dono sem depender do rótulo exibido.
            "username": config.username,
        }
        try:
            write_atomic(config.lock_path, json.dumps(lock, ensure_ascii=False, indent=2).encode("utf-8"))
        except OSError as error:
            return json_error(
                500,
                "IO",
                "Não foi possível gravar o arquivo de bloqueio: {}".format(error),
            )
        return {"lock": lock}

    @app.delete("/api/document/lock")
    def release_lock() -> Any:
        """Libera o lock — só o próprio dono (docs/14 §4)."""
        existing = read_lock(config.lock_path)
        if existing is None:
            try:
                config.lock_path.unlink()
            except OSError:
                pass
            return {"released": False}
        if not lock_is_mine(existing, config):
            return json_error(
                409,
                "LOCK_NOT_OWNED",
                "O bloqueio é de {} — só quem o tomou pode liberá-lo.".format(existing.get("holder")),
                lock=existing,
            )
        try:
            config.lock_path.unlink()
        except OSError as error:
            return json_error(500, "IO", "Não foi possível remover o bloqueio: {}".format(error))
        return {"released": True}

    # #region: api-backups

    @app.get("/api/backups")
    def backups() -> Dict[str, Any]:
        """Lista `_backups/`, do mais recente para o mais antigo.

        Não existe endpoint de restauração por decisão de docs/14 §4: restaurar é ato manual,
        documentado em `11-operacao.md` — copiar um arquivo por cima no Explorer, com o usuário
        vendo o que está fazendo.
        """
        entries = []
        for entry in reversed(list_backups(config.backup_dir, config.data_file)):
            stat = entry.stat()
            entries.append(
                {"name": entry.name, "bytes": stat.st_size, "mtime": iso_from_timestamp(stat.st_mtime)}
            )
        return {"backups": entries}

    # #region: api-evidences

    def deny_below(minimum: str, action: str) -> Optional[JSONResponse]:
        """Gate grosso de papel, igual ao `403` do `PUT` (docs/14 §6): só o que o servidor sabe."""
        role = resolve_effective_role(config)
        if role_allows(role, minimum):
            return None
        return json_error(
            403,
            "FORBIDDEN",
            "Seu papel neste documento é {} — {} exige {}. Peça a um ADMIN para mudar seu papel "
            "na lista de acesso.".format(role, action, minimum),
        )

    def evidence_full_path(rel_path: str) -> str:
        """O caminho que a pessoa digita no Explorer — é ele que entra nas mensagens de erro."""
        return str(config.evidence_dir / Path(rel_path.replace("\\", "/")))

    @app.post("/api/evidences", status_code=201)
    async def attach_evidence(
        file: UploadFile = File(...),
        project: str = Form(...),
        matrix: Optional[str] = Form(None),
        version: Optional[str] = Form(None),
        date: Optional[str] = Form(None),
    ) -> Any:
        """Copia o arquivo para o acervo e devolve hash e caminho (docs/14 §7, ADR-004).

        O destino é montado aqui, a partir dos **códigos** que o front manda (projeto, matriz,
        número da versão): `{projeto-slug}/{matriz-slug}/v{n}/{AAAA-MM-DD}_{nome original}`, com
        o alvo `PROJECT` parando no primeiro nível. O servidor não conhece o documento (ADR-002)
        — ele slugifica o que recebe, e é essa slugificação que garante que o caminho não sai de
        `_evidencias/`.

        A cópia é *streaming*: o SHA-256 é calculado nos mesmos blocos que vão para o disco (o
        arquivo nunca é carregado inteiro na memória), a gravação é atômica (`.tmp` +
        `os.replace`) e o limite de 50 MB corta antes de terminar, sem deixar arquivo pela metade.
        """
        denied = deny_below("EDITOR", "anexar evidências")
        if denied is not None:
            return denied

        segments = [slug_segment(project)]
        matrix_code = (matrix or "").strip()
        version_text = (version or "").strip()
        if matrix_code:
            segments.append(slug_segment(matrix_code))
            if version_text:
                try:
                    segments.append("v{}".format(int(version_text)))
                except ValueError:
                    return json_error(
                        400,
                        "BAD_REQUEST",
                        "O número da versão precisa ser inteiro: {!r}.".format(version_text),
                    )
        elif version_text:
            return json_error(
                400,
                "BAD_REQUEST",
                "Evidência de versão precisa vir com a matriz — só o número da versão não "
                "identifica a pasta.",
            )

        stamp = date if (date and re.match(r"^\d{4}-\d{2}-\d{2}$", date)) else datetime.now().strftime("%Y-%m-%d")
        file_name = "{}_{}".format(stamp, safe_file_name(file.filename or "evidencia"))

        root = config.evidence_dir
        directory = root.joinpath(*segments)
        try:
            directory.mkdir(parents=True, exist_ok=True)
        except OSError as error:
            return json_error(
                500,
                "IO",
                "Não foi possível criar a pasta {} do acervo: {}".format(directory, error),
            )

        target = unique_path(directory, file_name)
        tmp = target.with_name(target.name + ".tmp")
        digest = hashlib.sha256()
        total = 0
        too_large = False

        try:
            with open(tmp, "wb") as handle:
                while True:
                    chunk = await file.read(EVIDENCE_CHUNK_BYTES)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_EVIDENCE_BYTES:
                        too_large = True
                        break
                    digest.update(chunk)
                    handle.write(chunk)
                if not too_large:
                    handle.flush()
                    os.fsync(handle.fileno())
            if too_large:
                remove_quietly(tmp)
                return json_error(
                    413,
                    "TOO_LARGE",
                    "O arquivo passa do limite de {} MB por evidência e não foi copiado. Anexe "
                    "uma versão menor (ou compactada) do documento.".format(MAX_EVIDENCE_BYTES // (1024 * 1024)),
                    limitBytes=MAX_EVIDENCE_BYTES,
                )
            os.replace(tmp, target)
        except OSError as error:
            remove_quietly(tmp)
            return json_error(
                500,
                "IO",
                "Não foi possível gravar a evidência em {}: {}".format(target, error),
            )

        return {
            "id": new_evidence_id(),
            "relPath": target.relative_to(root).as_posix(),
            "fileName": target.name,
            "sha256": digest.hexdigest(),
            "bytes": total,
        }

    @app.get("/api/evidences/{evidence_id}")
    def download_evidence(evidence_id: str, relPath: str = "", sha256: str = "") -> Any:
        """Devolve o arquivo **depois** de conferir o hash registrado no documento (docs/14 §7).

        `relPath` e `sha256` vêm do próprio `attachments[]` — o documento é o registro, o
        servidor é infraestrutura (ADR-002, DEC-PLAT-005). Conferir antes de responder é o que
        permite devolver `409 HASH_MISMATCH` como erro de verdade, em vez de descobrir a
        divergência no meio de um download já iniciado.
        """
        path = resolve_under(config.evidence_dir, relPath)
        if path is None:
            return json_error(
                400,
                "BAD_REQUEST",
                "Caminho de evidência inválido: {!r}. Todo anexo vive dentro de {}.".format(
                    relPath, config.evidence_dir
                ),
            )
        if not sha256:
            return json_error(
                400,
                "BAD_REQUEST",
                "Sem o hash registrado não há integridade a conferir — o download exige o "
                "sha256 do anexo.",
            )
        if not path.is_file():
            return json_error(
                404,
                "NOT_FOUND",
                "O arquivo da evidência não está em {}. Ele pode ter sido movido ou renomeado à "
                "mão — procure em {}.".format(
                    evidence_full_path(relPath), config.evidence_dir / EVIDENCE_TRASH_DIR_NAME
                ),
            )

        try:
            actual = sha256_of_file(path)
        except OSError as error:
            return json_error(500, "IO", "Não foi possível ler {}: {}".format(path, error))

        if actual != sha256:
            return json_error(
                409,
                "HASH_MISMATCH",
                "O conteúdo de {} não é mais o que foi anexado — o arquivo foi alterado ou "
                "substituído no disco depois do anexo.".format(evidence_full_path(relPath)),
                relPath=relPath,
                expected=sha256,
                actual=actual,
            )

        return FileResponse(
            path,
            media_type="application/octet-stream",
            filename=path.name,
            headers={"Cache-Control": "no-store"},
        )

    @app.delete("/api/evidences/{evidence_id}")
    def trash_evidence(evidence_id: str, relPath: str = "") -> Any:
        """Move para `_evidencias/_lixeira/{caminho original}` — **nada jamais é apagado** (§7).

        A árvore é preservada dentro da lixeira, então o arquivo continua identificável por
        projeto/matriz/versão para quem for esvaziá-la à mão (`11-operacao.md` §1).

        Idempotente de propósito: o front só chama isto **depois** de um salvamento bem-sucedido
        que já tirou o vínculo do documento, e um arquivo que já não está lá não pode transformar
        um save que deu certo em erro na tela.
        """
        denied = deny_below("EDITOR", "desanexar evidências")
        if denied is not None:
            return denied

        root = config.evidence_dir
        path = resolve_under(root, relPath)
        if path is None:
            return json_error(
                400,
                "BAD_REQUEST",
                "Caminho de evidência inválido: {!r}. Todo anexo vive dentro de {}.".format(relPath, root),
            )
        if not path.is_file():
            return {"trashed": False, "relPath": None}

        parts = [part for part in relPath.strip().replace("\\", "/").split("/") if part not in ("", ".")]
        trash_dir = root.joinpath(EVIDENCE_TRASH_DIR_NAME, *parts[:-1])
        try:
            trash_dir.mkdir(parents=True, exist_ok=True)
            destination = unique_path(trash_dir, parts[-1])
            try:
                os.replace(path, destination)
            except OSError:
                # Pastas em volumes diferentes (raro numa pasta de rede só, mas possível):
                # `os.replace` não atravessa; `shutil.move` copia e apaga a origem.
                shutil.move(str(path), str(destination))
        except OSError as error:
            return json_error(
                500,
                "IO",
                "Não foi possível mover {} para a lixeira do acervo: {}".format(path, error),
            )

        return {"trashed": True, "relPath": destination.relative_to(root).as_posix()}

    return app


# #region: boot-porta-e-cli


def choose_port(host: str = HOST, ports: Any = PORT_RANGE) -> int:
    """Primeira porta livre da faixa 8770–8799 (docs/14 §5).

    Há uma janela entre este teste e o bind do uvicorn; na prática é a mesma máquina e um punhado
    de portas dedicadas, e o custo de errar é uma mensagem de erro no boot.
    """
    for port in ports:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            try:
                probe.bind((host, port))
            except OSError:
                continue
            return port
    raise RuntimeError(
        "Nenhuma porta livre entre {} e {}. Feche outra instância do servidor e tente de novo.".format(
            min(ports), max(ports)
        )
    )


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Servidor local do {}".format(APP_NAME))
    parser.add_argument("--data-dir", default=None, help="Pasta de dados (padrão: o pai deste diretório)")
    parser.add_argument("--data-file", default=None, help="Nome do arquivo de dados (padrão: politicas.json)")
    parser.add_argument("--html", default=None, help="Caminho do PolicyOps.html a servir")
    parser.add_argument("--port", type=int, default=None, help="Porta fixa (padrão: primeira livre em 8770–8799)")
    return parser.parse_args(argv)


def build_config(args: argparse.Namespace, script_dir: Optional[Path] = None) -> ServerConfig:
    """Precedência: linha de comando > `config.json` ao lado do servidor > padrão (docs/14 §9).

    `script_dir` é injetável para o teste conseguir simular um `config.json` isolado em
    `tmp_path` em vez do `server/` real do checkout; o CLI e o launcher (S28) sempre usam o
    padrão (a pasta deste arquivo).
    """
    script_dir = script_dir or Path(__file__).resolve().parent
    config_file = read_config_file(script_dir / CONFIG_FILE_NAME)

    data_dir = args.data_dir or config_file.get("dataDir") or str(script_dir.parent)
    data_file = args.data_file or config_file.get("dataFile") or DEFAULT_DATA_FILE
    html = args.html or config_file.get("html")
    display_name = config_file.get("displayName")

    return ServerConfig(
        data_dir=Path(data_dir).expanduser().resolve(),
        data_file=data_file,
        static_dir=script_dir,
        html_path=Path(html).expanduser().resolve() if html else None,
        display_name=display_name if isinstance(display_name, str) and display_name else None,
    )


def prepare(argv: Optional[List[str]] = None) -> "tuple[int, Optional[ServerConfig], Optional[int], Optional[FastAPI]]":
    """Resolve config, porta e app a partir dos argumentos — o que o CLI e o launcher (S28)
    precisam antes de subir o servidor de verdade.

    Devolve `(codigo, config, port, app)`; `codigo != 0` significa que a validação falhou (a
    mensagem já foi impressa em `stderr`) e quem chamou deve sair com esse código sem tentar
    usar os demais valores, que vêm `None`.
    """
    args = parse_args(argv)
    config = build_config(args)
    if not config.data_dir.is_dir():
        print("Pasta de dados inexistente: {}".format(config.data_dir), file=sys.stderr)
        return 2, None, None, None
    if not config.data_file or set("/\\").intersection(config.data_file):
        # Tudo que o servidor toca fica na pasta de dados; nome com caminho sairia dela.
        print(
            "--data-file deve ser um nome de arquivo, sem caminho: {}".format(config.data_file),
            file=sys.stderr,
        )
        return 2, None, None, None

    port = args.port or choose_port()
    app = create_app(config)
    return 0, config, port, app


def main(argv: Optional[List[str]] = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    code, config, port, app = prepare(argv)
    if code != 0:
        return code
    assert config is not None and port is not None and app is not None

    # O launcher (S28) lê esta linha para abrir o navegador já com o token.
    print("PolicyOps: http://{}:{}/?t={}".format(HOST, port, config.token), flush=True)
    print("PolicyOps: dados em {}".format(config.data_dir), flush=True)

    import uvicorn  # importado aqui para manter os testes livres do servidor ASGI

    uvicorn.run(app, host=HOST, port=port, log_level="info")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
