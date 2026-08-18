from __future__ import annotations

import time
import uuid

from character_runtime.agent import CharacterAgent
from character_runtime.database import Database
from character_runtime.memory import MemoryManager
from character_runtime.memory_extractor import MemoryExtractor
from character_runtime.models import AgentState, Character, Message

CHOICE_TTL_SECONDS = 600


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
        # 挂起的提问：choice_id → {session_id, character_id, question, prompt, options, multi_select, allow_custom, created_at}
        self._pending_choices: dict[str, dict] = {}
        # Galgame 中已生成、等待玩家点击“继续”后显示的下一轮选项。
        self._deferred_choices: dict[tuple[int, str], dict] = {}

    def send_message(self, character: Character, user_message: str) -> tuple[str, dict | None]:
        session_id = self._database.get_or_create_session(self._user_id, character.id)

        history = self._database.load_recent_messages(session_id, limit=80)
        history.append(Message(role="user", content=user_message))
        self._database.append_message(session_id, "user", user_message)

        state = AgentState(
            character=character,
            user_id=self._user_id,
            interaction_mode="chat",
            recent_messages=list(history),
            current_user_message=user_message,
        )
        response = self._agent.respond(state)
        self._database.append_message(session_id, "assistant", response)

        self._extract_memory(character, user_message, response)
        return response, None

    def _register_pending_choice(self, session_id: int, character_id: str, pending: dict) -> dict:
        choice_id = uuid.uuid4().hex[:12]
        self._expire_stale_choices()
        self._pending_choices[choice_id] = {
            "session_id": session_id,
            "character_id": character_id,
            "question": pending["question"],
            "prompt": pending["prompt"],
            "options": pending["options"],
            "multi_select": pending["multi_select"],
            "allow_custom": pending["allow_custom"],
            "created_at": int(time.time()),
        }
        return self._choice_payload(choice_id, self._pending_choices[choice_id])

    def get_pending_choice(self, character_id: str) -> dict | None:
        self._expire_stale_choices()
        choices = [
            (choice_id, pending)
            for choice_id, pending in self._pending_choices.items()
            if pending["character_id"] == character_id
        ]
        if not choices:
            return None
        choice_id, pending = max(choices, key=lambda item: item[1]["created_at"])
        return self._choice_payload(choice_id, pending)

    @staticmethod
    def _choice_payload(choice_id: str, pending: dict) -> dict:
        return {
            "choice_id": choice_id,
            "question": pending["question"],
            "prompt": pending["prompt"],
            "options": pending["options"],
            "multi_select": pending["multi_select"],
            "allow_custom": pending["allow_custom"],
        }

    def answer_choice(
        self,
        character: Character,
        choice_id: str,
        selected: list[str] | None = None,
        custom: str = "",
        cancelled: bool = False,
        galgame_mode: bool = False,
    ) -> tuple[str | None, dict | None]:
        """回答挂起的提问，并返回角色回复和下一选项。"""
        pending = self._pending_choices.get(choice_id)
        if pending is None:
            raise KeyError("问题已过期或不存在")
        if pending["character_id"] != character.id:
            raise KeyError("问题不属于当前角色")
        del self._pending_choices[choice_id]

        session_id = pending["session_id"]
        if cancelled:
            self._deferred_choices.pop((session_id, character.id), None)
            return None, None

        selected = [str(item).strip() for item in (selected or []) if str(item).strip()]
        custom = str(custom or "").strip()
        if not selected and not custom:
            raise ValueError("请至少选择一个选项或填写自定义答案")
        answer_text = f"[选择] 自定义:{custom}" if custom else "[选择] " + "、".join(selected)

        # 选择以用户消息写入历史，再用无状态 agent 循环重建下一轮
        self._database.append_message(session_id, "user", answer_text)
        history = self._database.load_recent_messages(session_id, limit=80)
        state = AgentState(
            character=character,
            user_id=self._user_id,
            interaction_mode="galgame" if galgame_mode else "chat",
            turn_phase="choice_response" if galgame_mode else "",
            recent_messages=list(history),
            current_user_message=answer_text,
        )
        response = self._agent.respond(state)
        self._database.append_message(session_id, "assistant", response)

        next_choice = None
        if state.pending_choice is not None:
            if galgame_mode:
                self._deferred_choices[(session_id, character.id)] = state.pending_choice
            else:
                next_choice = self._register_pending_choice(session_id, character.id, state.pending_choice)
        self._extract_memory(character, answer_text, response)
        return response, next_choice

    def continue_story(self, character: Character) -> tuple[str | None, dict | None]:
        pending_choice = self.get_pending_choice(character.id)
        if pending_choice is not None:
            return None, pending_choice

        session_id = self._database.get_or_create_session(self._user_id, character.id)
        key = (session_id, character.id)
        deferred = self._deferred_choices.pop(key, None)
        if deferred is not None:
            return None, self._register_pending_choice(session_id, character.id, deferred)

        history = self._database.load_recent_messages(session_id, limit=80)
        state = AgentState(
            character=character,
            user_id=self._user_id,
            interaction_mode="galgame",
            turn_phase="continue",
            recent_messages=list(history),
            current_user_message="[玩家点击继续]",
        )
        response = self._agent.respond(state)
        self._database.append_message(session_id, "assistant", response)
        next_choice = None
        if state.pending_choice is not None:
            next_choice = self._register_pending_choice(session_id, character.id, state.pending_choice)
        return response, next_choice

    def load_messages(self, character: Character, limit: int = 100) -> list[dict]:
        session_id = self._database.get_or_create_session(self._user_id, character.id)
        return self._database.load_recent_message_records(session_id, limit)

    def _expire_stale_choices(self) -> None:
        now = int(time.time())
        expired = [
            choice_id
            for choice_id, item in self._pending_choices.items()
            if now - item["created_at"] > CHOICE_TTL_SECONDS
        ]
        for choice_id in expired:
            self._pending_choices.pop(choice_id, None)

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
