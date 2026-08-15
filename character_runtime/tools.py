from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from character_runtime.memory import MemoryManager
from character_runtime.models import Character


def _safe_path(character: Character, relative_path: str) -> Path:
    if not relative_path or relative_path.startswith("/"):
        raise ValueError("路径非法")
    candidate = (character.root / relative_path).resolve()
    root = character.root.resolve()
    if root not in candidate.parents and candidate != root:
        raise ValueError("禁止访问角色目录外的文件")
    return candidate


@dataclass
class ToolResult:
    name: str
    output: str


class ToolRegistry:
    def __init__(self, memory: MemoryManager | None = None) -> None:
        self._memory = memory

    def execute(
        self,
        character: Character,
        name: str,
        arguments: dict[str, str],
        user_id: str = "local_user",
    ) -> ToolResult:
        if name == "read_file":
            return ToolResult(name=name, output=self._read_file(character, arguments["path"]))
        if name == "list_files":
            return ToolResult(name=name, output=self._list_files(character, arguments.get("path", ".")))
        if name == "search_files":
            return ToolResult(name=name, output=self._search_files(character, arguments["query"]))
        if name == "read_memory":
            return ToolResult(name=name, output=self._read_memory(character, arguments["query"], user_id))
        if name == "write_memory":
            return ToolResult(name=name, output=self._write_memory(character, arguments["content"], user_id))
        raise KeyError(f"未知工具: {name}")

    def _read_file(self, character: Character, relative_path: str) -> str:
        target = _safe_path(character, relative_path)
        if not target.is_file():
            raise FileNotFoundError(relative_path)
        return target.read_text(encoding="utf-8")

    def _list_files(self, character: Character, relative_path: str) -> str:
        target = _safe_path(character, relative_path)
        if not target.exists():
            raise FileNotFoundError(relative_path)
        if target.is_file():
            return target.name
        items = []
        for child in sorted(target.iterdir()):
            prefix = child.relative_to(character.root).as_posix()
            suffix = "/" if child.is_dir() else ""
            items.append(prefix + suffix)
        return "\n".join(items) if items else "(empty)"

    def _search_files(self, character: Character, query: str) -> str:
        matches: list[str] = []
        for path in sorted(character.root.rglob("*")):
            if not path.is_file():
                continue
            if path.suffix.lower() not in {".md", ".txt", ".json"}:
                continue
            content = path.read_text(encoding="utf-8")
            if query.lower() in content.lower():
                matches.append(path.relative_to(character.root).as_posix())
        return "\n".join(matches) if matches else "(no matches)"

    def _read_memory(self, character: Character, query: str, user_id: str) -> str:
        if self._memory is None:
            return "(memory unavailable)"
        return self._memory.read_memory(user_id, character.id, query)

    def _write_memory(self, character: Character, content: str, user_id: str) -> str:
        if self._memory is None:
            return "(memory unavailable)"
        memory_id = self._memory.write_character_memory(user_id, character.id, content)
        return f"memory_id={memory_id}"
