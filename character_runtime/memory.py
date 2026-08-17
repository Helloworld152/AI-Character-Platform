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

    def list_memories(
        self,
        user_id: str,
        character_id: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        return self._database.list_memories(user_id, character_id, limit)

    def list_character_memory_facts(
        self,
        user_id: str,
        character_id: str,
        limit: int = 100,
    ) -> list[str]:
        return self._database.list_memory_facts(
            user_id=user_id,
            character_id=character_id,
            memory_type=self.CHARACTER_MEMORY,
            limit=limit,
        )

    def write_character_memory(
        self,
        user_id: str,
        character_id: str,
        content: str | None = None,
        importance: float = 0.5,
        *,
        fact_content: str | None = None,
        diary_content: str | None = None,
    ) -> int:
        fact = (fact_content or content or "").strip()
        diary = (diary_content or content or fact).strip()
        if not fact or not diary:
            raise ValueError("memory fact and diary cannot both be empty")
        return self._database.write_memory(
            user_id=user_id,
            character_id=character_id,
            memory_type=self.CHARACTER_MEMORY,
            content=diary,
            fact_content=fact,
            importance=importance,
        )
