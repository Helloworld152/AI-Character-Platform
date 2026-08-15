from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path

from character_runtime.agent import CharacterAgent
from character_runtime.character_manager import CharacterManager
from character_runtime.config import load_dotenv
from character_runtime.conversation import ConversationEngine
from character_runtime.database import Database
from character_runtime.llm import DeepSeekClient, RuleBasedLlmClient
from character_runtime.memory_extractor import MemoryExtractor
from character_runtime.memory import MemoryManager
from character_runtime.tools import ToolRegistry
from character_runtime.voice import VoiceManager


@dataclass
class Runtime:
    character_manager: CharacterManager
    conversation: ConversationEngine
    database: Database
    memory: MemoryManager
    memory_extractor: MemoryExtractor | None
    voice: VoiceManager


def create_runtime(root: Path | None = None) -> Runtime:
    app_root = root or Path(__file__).resolve().parent.parent
    load_dotenv(app_root / ".env")

    character_manager = CharacterManager(app_root / "characters")
    character_manager.load_all()
    database = Database(app_root / "data" / "runtime.sqlite3")
    for character in character_manager.list_characters():
        database.register_character(character.id, character.display_name)
    memory = MemoryManager(database)
    memory_extractor = MemoryExtractor.from_environment()
    voice = VoiceManager()

    llm_mode = os.environ.get("AI_CHARACTER_LLM", "auto").strip().lower()
    if llm_mode == "rulebased":
        llm = RuleBasedLlmClient()
    else:
        llm = DeepSeekClient.from_environment() or RuleBasedLlmClient()
    conversation = ConversationEngine(
        CharacterAgent(
            llm=llm,
            tools=ToolRegistry(memory),
        ),
        database=database,
        memory=memory,
        memory_extractor=memory_extractor,
    )
    return Runtime(
        character_manager=character_manager,
        conversation=conversation,
        database=database,
        memory=memory,
        memory_extractor=memory_extractor,
        voice=voice,
    )
