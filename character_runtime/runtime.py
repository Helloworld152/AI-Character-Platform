from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path
import shutil

from character_runtime.agent import CharacterAgent
from character_runtime.character_manager import CharacterManager
from character_runtime.config import load_dotenv
from character_runtime.conversation import ConversationEngine
from character_runtime.database import Database
from character_runtime.llm import OpenAICompatibleClient
from character_runtime.memory_extractor import MemoryExtractor
from character_runtime.memory import MemoryManager
from character_runtime.paths import get_app_root, get_data_root
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


def create_runtime(root: Path | None = None, data_root: Path | None = None) -> Runtime:
    app_root = get_app_root(root)
    data_dir = get_data_root(data_root)
    data_dir.mkdir(parents=True, exist_ok=True)
    load_dotenv(data_dir / ".env")
    _seed_bundled_characters(app_root / "characters", data_dir / "characters")
    _normalize_character_directories(data_dir / "characters")

    character_manager = CharacterManager(data_dir / "characters")
    character_manager.load_all()
    database = Database(data_dir / "runtime.sqlite3")
    for character in character_manager.list_characters():
        database.register_character(character.id, character.display_name)
    memory = MemoryManager(database)
    memory_extractor = MemoryExtractor.from_environment()
    voice = VoiceManager()

    llm = OpenAICompatibleClient.from_environment()
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


def _seed_bundled_characters(source_root: Path, destination_root: Path) -> None:
    destination_root.mkdir(parents=True, exist_ok=True)
    if not source_root.exists():
        return
    if any(destination_root.iterdir()):
        return

    for child in sorted(source_root.iterdir()):
        if not child.is_dir():
            continue

        manifest_path = child / "manifest.json"
        if not manifest_path.is_file():
            continue

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue

        character_id = str(manifest.get("id", "")).strip()
        if not character_id:
            continue

        shutil.copytree(child, destination_root / character_id)


def _normalize_character_directories(characters_root: Path) -> None:
    if not characters_root.exists():
        return

    for child in sorted(characters_root.iterdir()):
        if not child.is_dir():
            continue

        manifest_path = child / "manifest.json"
        if not manifest_path.is_file():
            continue

        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue

        character_id = str(manifest.get("id", "")).strip()
        if not character_id or child.name == character_id:
            continue

        destination = characters_root / character_id
        if destination.exists():
            continue

        child.replace(destination)
