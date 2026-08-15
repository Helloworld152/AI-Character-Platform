from __future__ import annotations

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from character_runtime.runtime import create_runtime


ROOT = Path(os.environ.get("AI_CHARACTER_APP_ROOT", Path(__file__).resolve().parent)).resolve()
WEB_ROOT = ROOT / "dist-web" if (ROOT / "dist-web").exists() else ROOT / "web"
RUNTIME = create_runtime(ROOT)
RUNTIME_LOCK = threading.Lock()
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
            if path == "/api/settings":
                self._handle_save_settings()
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
            reply = RUNTIME.conversation.send_message(character, message)
        self._send_json(
            {
                "reply": reply,
                "character": {
                    "id": character.id,
                    "display_name": character.display_name,
                    "avatar_url": self._avatar_url(character),
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
                },
                "messages": messages,
            }
        )

    def _handle_get_settings(self) -> None:
        self._send_json({"settings": _read_settings()})

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

    def _reload_runtime(self) -> None:
        global RUNTIME
        with RUNTIME_LOCK:
            active = RUNTIME.character_manager.active_or_none()
            active_character_id = active.id if active else None
            try:
                RUNTIME.database.close()
            except Exception:
                pass
            RUNTIME = create_runtime(ROOT)
            if active_character_id:
                RUNTIME.character_manager.activate(active_character_id)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0:
            return {}
        raw = self.rfile.read(length).decode("utf-8")
        return json.loads(raw)

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
    server = ThreadingHTTPServer((host, port), WebHandler)
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
    env_path = ROOT / ".env"
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
    (ROOT / ".env").write_text("\n".join(lines) + "\n", encoding="utf-8")


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
