from __future__ import annotations

import json

from character_runtime.models import Character


class VoiceManager:
    def load_voice_config(self, character: Character) -> dict:
        voice_path = character.manifest.voice
        if not voice_path:
            return self._default_config(character)

        target = (character.root / voice_path).resolve()
        root = character.root.resolve()
        if root not in target.parents or not target.is_file():
            return self._default_config(character)

        config = json.loads(target.read_text(encoding="utf-8"))
        config.setdefault("enabled", False)
        config.setdefault("provider", "none")
        config.setdefault("voice_id", "")
        config.setdefault("speed", 1.0)
        config.setdefault("pitch", 0.0)
        config.setdefault("volume", 1.0)
        config.setdefault("requires_authorized_voice", True)
        config.setdefault("notes", "")
        return config

    def _default_config(self, character: Character) -> dict:
        return {
            "enabled": False,
            "provider": "none",
            "voice_id": "",
            "character_id": character.id,
            "speed": 1.0,
            "pitch": 0.0,
            "volume": 1.0,
            "requires_authorized_voice": True,
            "notes": "No voice config found.",
        }
