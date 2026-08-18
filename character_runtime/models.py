from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class CharacterManifest:
    format_version: int
    id: str
    name: str
    display_name: str
    version: str
    author: str
    entry: str
    index: str
    avatar: str | None = None
    portrait: str | None = None
    background: str | None = None
    voice: str | None = None
    license_id: str | None = None


@dataclass
class Character:
    manifest: CharacterManifest
    root: Path
    character_md: str
    index_md: str

    @property
    def id(self) -> str:
        return self.manifest.id

    @property
    def display_name(self) -> str:
        return self.manifest.display_name or self.manifest.name


@dataclass
class Message:
    role: str
    content: str


@dataclass
class ToolCall:
    name: str
    arguments: dict[str, str]


@dataclass
class LlmResult:
    text: str | None = None
    tool_call: ToolCall | None = None


@dataclass
class AgentState:
    character: Character
    user_id: str = "local_user"
    interaction_mode: str = "chat"
    turn_phase: str = ""
    recent_messages: list[Message] = field(default_factory=list)
    tool_results: list[str] = field(default_factory=list)
    current_user_message: str = ""
    pending_choice: dict | None = None
