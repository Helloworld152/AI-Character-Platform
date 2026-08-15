from __future__ import annotations

from character_runtime.database import Database


class MemoryManager:
    GLOBAL_MEMORY = 0
    CHARACTER_MEMORY = 1

    def __init__(self, database: Database) -> None:
        self._database = database

    def read_memory(self, user_id: str, character_id: str, query: str) -> str:
        memories = self._database.search_memories(user_id, character_id, query)
        return "\n".join(memories) if memories else "(no memories)"

    def write_character_memory(
        self,
        user_id: str,
        character_id: str,
        content: str,
        importance: float = 0.5,
    ) -> int:
        return self._database.write_memory(
            user_id=user_id,
            character_id=character_id,
            memory_type=self.CHARACTER_MEMORY,
            content=content,
            importance=importance,
        )
