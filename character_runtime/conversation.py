from __future__ import annotations

from character_runtime.agent import CharacterAgent
from character_runtime.database import Database
from character_runtime.memory import MemoryManager
from character_runtime.memory_extractor import MemoryExtractor
from character_runtime.models import AgentState, Character, Message


class ConversationEngine:
    def __init__(
        self,
        agent: CharacterAgent,
        database: Database,
        memory: MemoryManager,
        memory_extractor: MemoryExtractor | None = None,
        user_id: str = "local_user",
    ) -> None:
        self._agent = agent
        self._database = database
        self._memory = memory
        self._memory_extractor = memory_extractor
        self._user_id = user_id
        self._sessions: dict[str, list[Message]] = {}

    def send_message(self, character: Character, user_message: str) -> str:
        session_id = self._database.get_or_create_session(self._user_id, character.id)
        history = self._database.load_recent_messages(session_id, limit=80)
        history.append(Message(role="user", content=user_message))
        self._database.append_message(session_id, "user", user_message)

        state = AgentState(
            character=character,
            user_id=self._user_id,
            recent_messages=list(history),
            current_user_message=user_message,
        )
        response = self._agent.respond(state)
        self._database.append_message(session_id, "assistant", response)
        self._extract_memory(character, user_message, response)
        return response

    def load_messages(self, character: Character, limit: int = 100) -> list[dict]:
        session_id = self._database.get_or_create_session(self._user_id, character.id)
        return self._database.load_recent_message_records(session_id, limit)

    def _extract_memory(self, character: Character, user_message: str, response: str) -> None:
        if self._memory_extractor is None:
            return
        try:
            existing_facts = self._memory.list_character_memory_facts(
                self._user_id,
                character.id,
                limit=100,
            )
            extracted = self._memory_extractor.extract(
                user_message=user_message,
                assistant_message=response,
                character_name=character.display_name,
                existing_facts=existing_facts,
            )
            if extracted is None:
                return
            self._memory.write_character_memory(
                user_id=self._user_id,
                character_id=character.id,
                fact_content=extracted["fact"],
                diary_content=extracted["diary"],
                importance=extracted["importance"],
            )
        except Exception as error:
            print(f"Memory extraction skipped: {error}")
