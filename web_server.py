from __future__ import annotations

import cgi
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import parse_qs, unquote, urlparse

from character_runtime.character_manager import CharacterPackageError
from character_runtime.paths import get_data_root
from character_runtime.runtime import create_runtime


ROOT = Path(os.environ.get("AI_CHARACTER_APP_ROOT", Path(__file__).resolve().parent)).resolve()
DATA_ROOT = get_data_root()
WEB_ROOT = ROOT / "dist-web" if (ROOT / "dist-web").exists() else ROOT / "web"
RUNTIME = create_runtime(ROOT, DATA_ROOT)
RUNTIME_LOCK = threading.Lock()
MAX_AVATAR_BYTES = 5 * 1024 * 1024
MAX_IMPORT_BYTES = 80 * 1024 * 1024
AVATAR_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/svg+xml": ".svg",
}
ENV_KEYS = [
    "DEEPSEEK_API_KEY",
    "DEEPSEEK_MODEL",
    "DEEPSEEK_BASE_URL",
    "DEEPSEEK_TIMEOUT_SECONDS",
    "DEEPSEEK_THINKING",
    "DEEPSEEK_TEMPERATURE",
    "CONTEXT_RECENT_MESSAGES",
    "CONTEXT_TOOL_RESULTS",
    "AI_CHARACTER_LLM",
]


class ReusableThreadingHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True


class WebHandler(BaseHTTPRequestHandler):
    server_version = "AICharacterWeb/0.1"

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/":
            self._send_file(WEB_ROOT / "index.html", "text/html; charset=utf-8")
            return
        static_path = (WEB_ROOT / path.lstrip("/")).resolve()
        web_root = WEB_ROOT.resolve()
        if web_root in static_path.parents and static_path.is_file():
            self._send_file(static_path, _content_type(static_path))
            return
        if path.startswith("/assets/characters/"):
            self._handle_character_asset(path)
            return
        if path == "/api/health":
            self._send_json({"status": "ok"})
            return
        if path == "/api/characters":
            self._handle_characters()
            return
        if path == "/api/settings":
            self._handle_get_settings()
            return
        if path == "/api/messages":
            self._handle_messages()
            return
        if path == "/api/memories":
            self._handle_memories()
            return
        if path == "/api/voice":
            self._handle_voice()
            return
        self._send_json({"error": "not found"}, status=404)

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        try:
            if path == "/api/switch":
                self._handle_switch()
                return
            if path == "/api/chat":
                self._handle_chat()
                return
            if path == "/api/chat/answer":
                self._handle_answer_choice()
                return
            if path == "/api/settings":
                self._handle_save_settings()
                return
            if path == "/api/memories/delete":
                self._handle_delete_memory()
                return
            if path == "/api/characters/delete":
                self._handle_delete_character()
                return
            if path == "/api/characters/import":
                self._handle_import_character()
                return
            if path == "/api/characters/avatar":
                self._handle_update_avatar()
                return
            if path == "/api/characters/portrait":
                self._handle_update_portrait()
                return
            if path == "/api/characters/background":
                self._handle_update_background()
                return
            if path == "/api/shutdown":
                self._handle_shutdown()
                return
            self._send_json({"error": "not found"}, status=404)
        except Exception as error:
            self._send_json({"error": str(error)}, status=500)

    def log_message(self, format: str, *args: object) -> None:
        return

    def _handle_characters(self) -> None:
        with RUNTIME_LOCK:
            active = RUNTIME.character_manager.active_or_none()
            characters = [
                {
                    "id": character.id,
                    "name": character.manifest.name,
                    "display_name": character.display_name,
                    "version": character.manifest.version,
                    "author": character.manifest.author,
                    "avatar_url": self._avatar_url(character),
                    "portrait_url": self._portrait_url(character),
                    "background_url": self._background_url(character),
                    "active": active is not None and character.id == active.id,
                }
                for character in RUNTIME.character_manager.list_characters()
            ]
        self._send_json({"characters": characters, "active_character_id": active.id if active else None})

    def _handle_switch(self) -> None:
        payload = self._read_json()
        character_id = str(payload.get("character_id", "")).strip()
        if not character_id:
            self._send_json({"error": "character_id is required"}, status=400)
            return

        with RUNTIME_LOCK:
            character = RUNTIME.character_manager.activate(character_id)
        self._send_json({"character": {"id": character.id, "display_name": character.display_name}})

    def _handle_chat(self) -> None:
        payload = self._read_json()
        message = str(payload.get("message", "")).strip()
        if not message:
            self._send_json({"error": "message is required"}, status=400)
            return

        with RUNTIME_LOCK:
            character = RUNTIME.character_manager.active_or_none()
            if character is None:
                self._send_json({"error": "请先选择角色"}, status=400)
                return
            reply, pending_choice = RUNTIME.conversation.send_message(character, message)
        self._send_json(
            {
                "reply": reply,
                "character": {
                    "id": character.id,
                    "display_name": character.display_name,
                    "avatar_url": self._avatar_url(character),
                    "portrait_url": self._portrait_url(character),
                },
                "pending_choice": pending_choice,
            }
        )

    def _handle_answer_choice(self) -> None:
        payload = self._read_json()
        choice_id = str(payload.get("choice_id", "")).strip()
        if not choice_id:
            self._send_json({"error": "choice_id is required"}, status=400)
            return

        with RUNTIME_LOCK:
            character = RUNTIME.character_manager.active_or_none()
            if character is None:
                self._send_json({"error": "请先选择角色"}, status=400)
                return
            try:
                reply = RUNTIME.conversation.answer_choice(
                    character,
                    choice_id=choice_id,
                    selected=payload.get("selected"),
                    custom=str(payload.get("custom", "")),
                    cancelled=bool(payload.get("cancelled", False)),
                )
            except KeyError as error:
                self._send_json({"error": str(error)}, status=404)
                return
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
                return

        if reply is None:
            self._send_json({"cancelled": True})
            return
        self._send_json(
            {
                "reply": reply,
                "character": {
                    "id": character.id,
                    "display_name": character.display_name,
                    "avatar_url": self._avatar_url(character),
                    "portrait_url": self._portrait_url(character),
                },
            }
        )

    def _handle_messages(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        limit = _bounded_int(query.get("limit", ["30"])[0], default=30, minimum=1, maximum=200)
        with RUNTIME_LOCK:
            character = RUNTIME.character_manager.active_or_none()
            if character is None:
                self._send_json({"character": None, "messages": []})
                return
            messages = RUNTIME.conversation.load_messages(character, limit=limit)
        self._send_json(
            {
                "character": {
                    "id": character.id,
                    "display_name": character.display_name,
                    "avatar_url": self._avatar_url(character),
                    "portrait_url": self._portrait_url(character),
                },
                "messages": messages,
            }
        )

    def _handle_get_settings(self) -> None:
        self._send_json({"settings": _read_settings()})

    def _handle_memories(self) -> None:
        query = parse_qs(urlparse(self.path).query)
        limit = _bounded_int(query.get("limit", ["100"])[0], default=100, minimum=1, maximum=500)
        with RUNTIME_LOCK:
            character = RUNTIME.character_manager.active_or_none()
            character_id = character.id if character else None
            memories = RUNTIME.memory.list_memories("local_user", character_id, limit=limit)
        self._send_json(
            {
                "character": (
                    {
                        "id": character.id,
                        "display_name": character.display_name,
                    }
                    if character
                    else None
                ),
                "memories": [_memory_record(item) for item in memories],
            }
        )

    def _handle_voice(self) -> None:
        with RUNTIME_LOCK:
            character = RUNTIME.character_manager.active_or_none()
            if character is None:
                self._send_json({"character": None, "voice": None})
                return
            voice = RUNTIME.voice.load_voice_config(character)
        self._send_json(
            {
                "character": {
                    "id": character.id,
                    "display_name": character.display_name,
                },
                "voice": voice,
            }
        )

    def _handle_save_settings(self) -> None:
        payload = self._read_json()
        settings = payload.get("settings", {})
        if not isinstance(settings, dict):
            self._send_json({"error": "settings must be an object"}, status=400)
            return

        _write_settings(settings)
        self._reload_runtime()
        self._send_json({"settings": _read_settings()})

    def _handle_delete_memory(self) -> None:
        payload = self._read_json()
        memory_id = _bounded_int(str(payload.get("memory_id", "")), default=0, minimum=0, maximum=999999999)
        if memory_id <= 0:
            self._send_json({"error": "memory_id is required"}, status=400)
            return

        with RUNTIME_LOCK:
            deleted = RUNTIME.database.delete_memory("local_user", memory_id)
        if not deleted:
            self._send_json({"error": "记忆不存在或无权删除"}, status=404)
            return
        self._send_json({"deleted": True, "memory_id": memory_id})

    def _handle_delete_character(self) -> None:
        payload = self._read_json()
        character_id = str(payload.get("character_id", "")).strip()
        if not character_id:
            self._send_json({"error": "character_id is required"}, status=400)
            return

        with RUNTIME_LOCK:
            character = next(
                (item for item in RUNTIME.character_manager.list_characters() if item.id == character_id),
                None,
            )
            if character is None:
                self._send_json({"error": "未知角色"}, status=404)
                return
            deleted = RUNTIME.character_manager.delete_character(character_id)
            counts = RUNTIME.database.delete_character_data("local_user", character_id)
            active = RUNTIME.character_manager.active_or_none()

        self._send_json(
            {
                "deleted": True,
                "character_id": deleted.id,
                "active_character_id": active.id if active else None,
                "counts": counts,
            }
        )

    def _handle_import_character(self) -> None:
        try:
            form = self._read_multipart(MAX_IMPORT_BYTES + MAX_AVATAR_BYTES + 1024 * 1024)
        except ValueError as error:
            self._send_json({"error": str(error)}, status=400)
            return

        character_id = _field_value(form, "character_id")
        name = _field_value(form, "name")
        display_name = _field_value(form, "display_name")
        author = _field_value(form, "author")
        version = _field_value(form, "version") or "1.0.0"

        package_upload = form["package"] if "package" in form else None
        if package_upload is None or not getattr(package_upload, "file", None):
            self._send_json({"error": "package file is required"}, status=400)
            return

        avatar_upload = form["avatar"] if "avatar" in form else None
        if avatar_upload is None or not getattr(avatar_upload, "file", None):
            self._send_json({"error": "avatar file is required"}, status=400)
            return

        package_filename = str(getattr(package_upload, "filename", "") or "")
        if package_filename and not package_filename.lower().endswith(".zip"):
            self._send_json({"error": "只支持 .zip 内容包"}, status=400)
            return

        avatar_type = str(avatar_upload.type or "").split(";", 1)[0].strip().lower()
        avatar_suffix = AVATAR_TYPES.get(avatar_type)
        if not avatar_suffix:
            self._send_json({"error": "只支持 png、jpg、webp、svg 头像"}, status=400)
            return

        package_path: Path | None = None
        avatar_path: Path | None = None
        try:
            with NamedTemporaryFile(prefix="character-package-", suffix=".zip", delete=False) as temp_file:
                package_path = Path(temp_file.name)
                _write_limited_upload(package_upload.file, package_path, MAX_IMPORT_BYTES)
            with NamedTemporaryFile(prefix="character-avatar-", suffix=avatar_suffix, delete=False) as temp_file:
                avatar_path = Path(temp_file.name)
                _write_limited_upload(avatar_upload.file, avatar_path, MAX_AVATAR_BYTES)

            with RUNTIME_LOCK:
                character = RUNTIME.character_manager.create_character_from_markdown_package(
                    character_id=character_id,
                    name=name,
                    display_name=display_name,
                    author=author,
                    version=version,
                    package_path=package_path,
                    avatar_path=avatar_path,
                    avatar_suffix=avatar_suffix,
                )
                RUNTIME.database.register_character(character.id, character.display_name)
                RUNTIME.character_manager.activate(character.id)

            self._send_json(
                {
                    "character": {
                        "id": character.id,
                        "name": character.manifest.name,
                        "display_name": character.display_name,
                        "version": character.manifest.version,
                        "author": character.manifest.author,
                        "avatar_url": self._avatar_url(character),
                        "portrait_url": self._portrait_url(character),
                        "active": True,
                    }
                }
            )
        except CharacterPackageError as error:
            self._send_json({"error": str(error)}, status=400)
        except ValueError as error:
            self._send_json({"error": str(error)}, status=400)
        finally:
            if package_path:
                package_path.unlink(missing_ok=True)
            if avatar_path:
                avatar_path.unlink(missing_ok=True)

    def _handle_update_avatar(self) -> None:
        try:
            form = self._read_multipart(MAX_AVATAR_BYTES + 1024 * 1024)
        except ValueError as error:
            self._send_json({"error": str(error)}, status=400)
            return
        character_id = _field_value(form, "character_id")
        if not character_id:
            self._send_json({"error": "character_id is required"}, status=400)
            return

        upload = form["avatar"] if "avatar" in form else None
        if upload is None or not getattr(upload, "file", None):
            self._send_json({"error": "avatar file is required"}, status=400)
            return

        content_type = str(upload.type or "").split(";", 1)[0].strip().lower()
        suffix = AVATAR_TYPES.get(content_type)
        if not suffix:
            self._send_json({"error": "只支持 png、jpg、webp、svg 头像"}, status=400)
            return

        with RUNTIME_LOCK:
            character = next(
                (item for item in RUNTIME.character_manager.list_characters() if item.id == character_id),
                None,
            )
            if character is None:
                self._send_json({"error": "未知角色"}, status=404)
                return

            avatar_dir = character.root / "avatar"
            avatar_dir.mkdir(parents=True, exist_ok=True)
            avatar_path = avatar_dir / f"custom{suffix}"
            try:
                bytes_written = _write_limited_upload(upload.file, avatar_path, MAX_AVATAR_BYTES)
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
                return
            if bytes_written <= 0:
                avatar_path.unlink(missing_ok=True)
                self._send_json({"error": "头像文件为空"}, status=400)
                return

            manifest_path = character.root / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["avatar"] = f"avatar/custom{suffix}"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            active = RUNTIME.character_manager.active_or_none()
            active_character_id = active.id if active else None
            RUNTIME.character_manager.reload()
            if active_character_id:
                RUNTIME.character_manager.activate(active_character_id)
            updated = RUNTIME.character_manager.activate(character_id)

        self._send_json(
            {
                "character": {
                    "id": updated.id,
                    "display_name": updated.display_name,
                    "avatar_url": self._avatar_url(updated),
                    "avatar_url": self._avatar_url(updated),
                    "portrait_url": self._portrait_url(updated),
                }
            }
        )

    def _handle_update_portrait(self) -> None:
        try:
            form = self._read_multipart(MAX_AVATAR_BYTES + 1024 * 1024)
        except ValueError as error:
            self._send_json({"error": str(error)}, status=400)
            return
        character_id = _field_value(form, "character_id")
        if not character_id:
            self._send_json({"error": "character_id is required"}, status=400)
            return

        upload = form["portrait"] if "portrait" in form else None
        if upload is None or not getattr(upload, "file", None):
            self._send_json({"error": "portrait file is required"}, status=400)
            return

        content_type = str(upload.type or "").split(";", 1)[0].strip().lower()
        suffix = AVATAR_TYPES.get(content_type)
        if not suffix:
            self._send_json({"error": "只支持 png、jpg、webp、svg 立绘"}, status=400)
            return

        with RUNTIME_LOCK:
            character = next(
                (item for item in RUNTIME.character_manager.list_characters() if item.id == character_id),
                None,
            )
            if character is None:
                self._send_json({"error": "未知角色"}, status=404)
                return

            portrait_dir = character.root / "portrait"
            portrait_dir.mkdir(parents=True, exist_ok=True)
            portrait_path = portrait_dir / f"portrait{suffix}"
            try:
                bytes_written = _write_limited_upload(upload.file, portrait_path, MAX_AVATAR_BYTES)
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
                return
            if bytes_written <= 0:
                portrait_path.unlink(missing_ok=True)
                self._send_json({"error": "立绘文件为空"}, status=400)
                return

            manifest_path = character.root / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["portrait"] = f"portrait/portrait{suffix}"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            active = RUNTIME.character_manager.active_or_none()
            active_character_id = active.id if active else None
            RUNTIME.character_manager.reload()
            if active_character_id:
                RUNTIME.character_manager.activate(active_character_id)
            updated = RUNTIME.character_manager.activate(character_id)

        self._send_json(
            {
                "character": {
                    "id": updated.id,
                    "display_name": updated.display_name,
                    "portrait_url": self._portrait_url(updated),
                }
            }
        )

    def _handle_update_background(self) -> None:
        try:
            form = self._read_multipart(MAX_AVATAR_BYTES + 1024 * 1024)
        except ValueError as error:
            self._send_json({"error": str(error)}, status=400)
            return
        character_id = _field_value(form, "character_id")
        if not character_id:
            self._send_json({"error": "character_id is required"}, status=400)
            return

        upload = form["background"] if "background" in form else None
        if upload is None or not getattr(upload, "file", None):
            self._send_json({"error": "background file is required"}, status=400)
            return

        content_type = str(upload.type or "").split(";", 1)[0].strip().lower()
        suffix = AVATAR_TYPES.get(content_type)
        if not suffix:
            self._send_json({"error": "只支持 png、jpg、webp、svg 背景图"}, status=400)
            return

        with RUNTIME_LOCK:
            character = next(
                (item for item in RUNTIME.character_manager.list_characters() if item.id == character_id),
                None,
            )
            if character is None:
                self._send_json({"error": "未知角色"}, status=404)
                return

            background_dir = character.root / "background"
            background_dir.mkdir(parents=True, exist_ok=True)
            background_path = background_dir / f"background{suffix}"
            try:
                bytes_written = _write_limited_upload(upload.file, background_path, MAX_AVATAR_BYTES)
            except ValueError as error:
                self._send_json({"error": str(error)}, status=400)
                return
            if bytes_written <= 0:
                background_path.unlink(missing_ok=True)
                self._send_json({"error": "背景图文件为空"}, status=400)
                return

            manifest_path = character.root / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["background"] = f"background/background{suffix}"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            active = RUNTIME.character_manager.active_or_none()
            active_character_id = active.id if active else None
            RUNTIME.character_manager.reload()
            if active_character_id:
                RUNTIME.character_manager.activate(active_character_id)
            updated = RUNTIME.character_manager.activate(character_id)

        self._send_json(
            {
                "character": {
                    "id": updated.id,
                    "display_name": updated.display_name,
                    "background_url": self._background_url(updated),
                }
            }
        )

    def _handle_shutdown(self) -> None:
        if self.client_address[0] not in {"127.0.0.1", "::1"}:
            self._send_json({"error": "forbidden"}, status=403)
            return

        self._send_json({"status": "shutting_down"})
        threading.Thread(target=self.server.shutdown, daemon=True).start()

    def _handle_character_asset(self, path: str) -> None:
        prefix = "/assets/characters/"
        relative = unquote(path[len(prefix) :])
        parts = relative.split("/", 1)
        if len(parts) != 2:
            self._send_json({"error": "not found"}, status=404)
            return

        character_id, asset_path = parts
        with RUNTIME_LOCK:
            character = next(
                (item for item in RUNTIME.character_manager.list_characters() if item.id == character_id),
                None,
            )
        if character is None:
            self._send_json({"error": "not found"}, status=404)
            return

        target = (character.root / asset_path).resolve()
        root = character.root.resolve()
        if root not in target.parents or not target.is_file():
            self._send_json({"error": "not found"}, status=404)
            return

        content_type = "image/svg+xml"
        if target.suffix.lower() == ".png":
            content_type = "image/png"
        elif target.suffix.lower() in {".jpg", ".jpeg"}:
            content_type = "image/jpeg"
        elif target.suffix.lower() == ".webp":
            content_type = "image/webp"
        self._send_file(target, content_type)

    def _avatar_url(self, character) -> str | None:
        avatar = character.manifest.avatar
        if not avatar:
            return None
        return f"/assets/characters/{character.id}/{avatar}"

    def _portrait_url(self, character) -> str | None:
        portrait = character.manifest.portrait
        if not portrait:
            return None
        return f"/assets/characters/{character.id}/{portrait}"

    def _background_url(self, character) -> str | None:
        background = character.manifest.background
        if not background:
            return None
        return f"/assets/characters/{character.id}/{background}"

    def _reload_runtime(self) -> None:
        global RUNTIME
        with RUNTIME_LOCK:
            active = RUNTIME.character_manager.active_or_none()
            active_character_id = active.id if active else None
            try:
                RUNTIME.database.close()
            except Exception:
                pass
            RUNTIME = create_runtime(ROOT, DATA_ROOT)
            if active_character_id:
                RUNTIME.character_manager.activate(active_character_id)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

    def _read_multipart(self, max_bytes: int) -> cgi.FieldStorage:
        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data"):
            raise ValueError("Content-Type must be multipart/form-data")
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length > max_bytes:
            raise ValueError("上传请求超过大小限制")
        return cgi.FieldStorage(
            fp=self.rfile,
            headers=self.headers,
            environ={
                "REQUEST_METHOD": "POST",
                "CONTENT_TYPE": content_type,
                "CONTENT_LENGTH": str(content_length),
            },
        )

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path, content_type: str) -> None:
        if not path.exists():
            self._send_json({"error": "not found"}, status=404)
            return
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    host = os.environ.get("AI_CHARACTER_HOST", "127.0.0.1")
    port = int(os.environ.get("AI_CHARACTER_PORT", "8787"))
    server = ReusableThreadingHTTPServer((host, port), WebHandler)
    print(f"Web client running at http://{host}:{port}")
    try:
        server.serve_forever()
    finally:
        try:
            RUNTIME.database.close()
        except Exception:
            pass
        server.server_close()
    return 0

def _read_env_file() -> dict[str, str]:
    env_path = DATA_ROOT / ".env"
    if not env_path.exists():
        return {}

    values: dict[str, str] = {}
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def _read_settings() -> dict:
    values = _read_env_file()
    api_key = values.get("DEEPSEEK_API_KEY") or os.environ.get("DEEPSEEK_API_KEY", "")
    return {
        "api_key_configured": bool(api_key),
        "api_key_preview": _mask_key(api_key),
        "model": values.get("DEEPSEEK_MODEL") or os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash"),
        "base_url": values.get("DEEPSEEK_BASE_URL") or os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
        "timeout_seconds": values.get("DEEPSEEK_TIMEOUT_SECONDS") or os.environ.get("DEEPSEEK_TIMEOUT_SECONDS", "60"),
        "thinking": values.get("DEEPSEEK_THINKING") or os.environ.get("DEEPSEEK_THINKING", "disabled"),
        "temperature": values.get("DEEPSEEK_TEMPERATURE") or os.environ.get("DEEPSEEK_TEMPERATURE", "0.8"),
        "recent_messages": values.get("CONTEXT_RECENT_MESSAGES") or os.environ.get("CONTEXT_RECENT_MESSAGES", "40"),
        "tool_results": values.get("CONTEXT_TOOL_RESULTS") or os.environ.get("CONTEXT_TOOL_RESULTS", "8"),
        "llm_mode": values.get("AI_CHARACTER_LLM") or os.environ.get("AI_CHARACTER_LLM", "auto"),
    }


def _write_settings(settings: dict) -> None:
    current = _read_env_file()
    mapping = {
        "api_key": "DEEPSEEK_API_KEY",
        "model": "DEEPSEEK_MODEL",
        "base_url": "DEEPSEEK_BASE_URL",
        "timeout_seconds": "DEEPSEEK_TIMEOUT_SECONDS",
        "thinking": "DEEPSEEK_THINKING",
        "temperature": "DEEPSEEK_TEMPERATURE",
        "recent_messages": "CONTEXT_RECENT_MESSAGES",
        "tool_results": "CONTEXT_TOOL_RESULTS",
        "llm_mode": "AI_CHARACTER_LLM",
    }

    for source_key, env_key in mapping.items():
        if source_key not in settings:
            continue
        value = str(settings[source_key]).strip()
        if source_key == "api_key" and not value:
            continue
        current[env_key] = value
        os.environ[env_key] = value

    lines = [f"{key}={current[key]}" for key in ENV_KEYS if key in current and current[key]]
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    (DATA_ROOT / ".env").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _mask_key(api_key: str) -> str:
    if not api_key:
        return ""
    if len(api_key) <= 10:
        return "*" * len(api_key)
    return f"{api_key[:6]}...{api_key[-4:]}"


def _bounded_int(value: str, default: int, minimum: int, maximum: int) -> int:
    try:
        parsed = int(value)
    except ValueError:
        return default
    return max(minimum, min(maximum, parsed))


def _field_value(form: cgi.FieldStorage, name: str) -> str:
    if name not in form:
        return ""
    field = form[name]
    if isinstance(field, list):
        field = field[0]
    return str(field.value or "").strip()


def _write_limited_upload(source, destination: Path, limit: int) -> int:
    total = 0
    with destination.open("wb") as output:
        while True:
            chunk = source.read(1024 * 64)
            if not chunk:
                break
            total += len(chunk)
            if total > limit:
                output.close()
                destination.unlink(missing_ok=True)
                raise ValueError("头像文件超过 5MB 限制")
            output.write(chunk)
    return total


def _memory_record(memory: dict) -> dict:
    memory_type = int(memory["type"])
    return {
        **memory,
        "scope": "global" if memory["character_id"] is None else "character",
        "type_label": "全局记忆" if memory_type == 0 else "角色日记",
    }


def _content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".html":
        return "text/html; charset=utf-8"
    if suffix == ".css":
        return "text/css; charset=utf-8"
    if suffix == ".js":
        return "application/javascript; charset=utf-8"
    if suffix == ".svg":
        return "image/svg+xml"
    if suffix == ".png":
        return "image/png"
    return "application/octet-stream"


if __name__ == "__main__":
    raise SystemExit(main())
