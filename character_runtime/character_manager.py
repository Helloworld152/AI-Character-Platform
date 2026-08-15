from __future__ import annotations

import json
from pathlib import Path

from character_runtime.models import Character, CharacterManifest


class CharacterManager:
    def __init__(self, characters_root: Path) -> None:
        self._characters_root = characters_root
        self._characters: dict[str, Character] = {}
        self._active_character_id: str | None = None

    def load_all(self) -> None:
        if not self._characters_root.exists():
            return

        for child in sorted(self._characters_root.iterdir()):
            if child.is_dir():
                character = self._load_character(child)
                self._characters[character.id] = character

    def list_characters(self) -> list[Character]:
        return list(self._characters.values())

    def activate(self, character_id: str) -> Character:
        if character_id not in self._characters:
            raise KeyError(f"未知角色: {character_id}")
        self._active_character_id = character_id
        return self._characters[character_id]

    def active(self) -> Character:
        if self._active_character_id is None:
            raise RuntimeError("当前没有可用角色")
        return self._characters[self._active_character_id]

    def active_or_none(self) -> Character | None:
        if self._active_character_id is None:
            return None
        return self._characters[self._active_character_id]

    def _load_character(self, root: Path) -> Character:
        manifest_path = root / "manifest.json"
        manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest = CharacterManifest(**manifest_data)
        character_md = (root / manifest.entry).read_text(encoding="utf-8")
        index_md = (root / manifest.index).read_text(encoding="utf-8")
        return Character(
            manifest=manifest,
            root=root,
            character_md=character_md,
            index_md=index_md,
        )
