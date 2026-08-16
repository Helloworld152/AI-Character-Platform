from __future__ import annotations

import sqlite3
import time
from pathlib import Path

from character_runtime.models import Message


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(path, check_same_thread=False)
        self._connection.row_factory = sqlite3.Row
        self._migrate()

    def close(self) -> None:
        self._connection.close()

    def get_or_create_user(self, user_id: str) -> None:
        now = int(time.time())
        self._connection.execute(
            """
            INSERT INTO users (id, created_at)
            VALUES (?, ?)
            ON CONFLICT(id) DO NOTHING
            """,
            (user_id, now),
        )
        self._connection.commit()

    def register_character(self, character_id: str, display_name: str) -> None:
        now = int(time.time())
        self._connection.execute(
            """
            INSERT INTO characters (id, display_name, created_at)
            VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name
            """,
            (character_id, display_name, now),
        )
        self._connection.commit()

    def get_or_create_session(self, user_id: str, character_id: str) -> int:
        self.get_or_create_user(user_id)
        row = self._connection.execute(
            """
            SELECT id FROM sessions
            WHERE user_id = ? AND character_id = ?
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (user_id, character_id),
        ).fetchone()
        if row:
            return int(row["id"])

        now = int(time.time())
        cursor = self._connection.execute(
            """
            INSERT INTO sessions (user_id, character_id, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            """,
            (user_id, character_id, now, now),
        )
        self._connection.commit()
        return int(cursor.lastrowid)

    def append_message(self, session_id: int, role: str, content: str) -> None:
        now = int(time.time())
        self._connection.execute(
            """
            INSERT INTO messages (session_id, role, content, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (session_id, role, content, now),
        )
        self._connection.execute(
            "UPDATE sessions SET updated_at = ? WHERE id = ?",
            (now, session_id),
        )
        self._connection.commit()

    def load_recent_messages(self, session_id: int, limit: int) -> list[Message]:
        rows = self._connection.execute(
            """
            SELECT role, content FROM messages
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
        return [Message(role=row["role"], content=row["content"]) for row in reversed(rows)]

    def load_recent_message_records(self, session_id: int, limit: int) -> list[dict]:
        rows = self._connection.execute(
            """
            SELECT id, role, content, created_at FROM messages
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (session_id, limit),
        ).fetchall()
        return [
            {
                "id": int(row["id"]),
                "role": row["role"],
                "content": row["content"],
                "created_at": int(row["created_at"]),
            }
            for row in reversed(rows)
        ]

    def write_memory(
        self,
        user_id: str,
        character_id: str | None,
        memory_type: int,
        content: str,
        importance: float = 0.0,
    ) -> int:
        now = int(time.time())
        cursor = self._connection.execute(
            """
            INSERT INTO memories (user_id, character_id, type, content, importance, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, character_id, memory_type, content, importance, now),
        )
        self._connection.commit()
        return int(cursor.lastrowid)

    def search_memories(
        self,
        user_id: str,
        character_id: str | None,
        query: str,
        limit: int = 10,
    ) -> list[str]:
        like = f"%{query}%"
        rows = self._connection.execute(
            """
            SELECT content FROM memories
            WHERE user_id = ?
              AND (character_id IS NULL OR character_id = ?)
              AND content LIKE ?
            ORDER BY importance DESC, created_at DESC
            LIMIT ?
            """,
            (user_id, character_id, like, limit),
        ).fetchall()
        return [row["content"] for row in rows]

    def list_memories(
        self,
        user_id: str,
        character_id: str | None = None,
        limit: int = 100,
    ) -> list[dict]:
        if character_id:
            rows = self._connection.execute(
                """
                SELECT memories.id,
                       memories.character_id,
                       characters.display_name AS character_display_name,
                       memories.type,
                       memories.content,
                       memories.importance,
                       memories.created_at
                FROM memories
                LEFT JOIN characters ON characters.id = memories.character_id
                WHERE memories.user_id = ?
                  AND (memories.character_id IS NULL OR memories.character_id = ?)
                ORDER BY memories.importance DESC, memories.created_at DESC
                LIMIT ?
                """,
                (user_id, character_id, limit),
            ).fetchall()
        else:
            rows = self._connection.execute(
                """
                SELECT memories.id,
                       memories.character_id,
                       characters.display_name AS character_display_name,
                       memories.type,
                       memories.content,
                       memories.importance,
                       memories.created_at
                FROM memories
                LEFT JOIN characters ON characters.id = memories.character_id
                WHERE memories.user_id = ?
                ORDER BY memories.importance DESC, memories.created_at DESC
                LIMIT ?
                """,
                (user_id, limit),
            ).fetchall()

        return [
            {
                "id": int(row["id"]),
                "character_id": row["character_id"],
                "character_display_name": row["character_display_name"],
                "type": int(row["type"]),
                "content": row["content"],
                "importance": float(row["importance"]),
                "created_at": int(row["created_at"]),
            }
            for row in rows
        ]

    def delete_memory(self, user_id: str, memory_id: int) -> bool:
        cursor = self._connection.execute(
            """
            DELETE FROM memories
            WHERE id = ? AND user_id = ?
            """,
            (memory_id, user_id),
        )
        self._connection.commit()
        return cursor.rowcount > 0

    def _migrate(self) -> None:
        self._connection.executescript(
            """
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS characters (
                id TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS installed_packs (
                id INTEGER PRIMARY KEY,
                character_id TEXT NOT NULL,
                version TEXT NOT NULL,
                path TEXT NOT NULL,
                installed_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY,
                user_id TEXT NOT NULL,
                character_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(character_id) REFERENCES characters(id)
            );

            CREATE INDEX IF NOT EXISTS idx_sessions_user_character
            ON sessions(user_id, character_id, updated_at);

            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY,
                session_id INTEGER NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(session_id) REFERENCES sessions(id)
            );

            CREATE INDEX IF NOT EXISTS idx_messages_session_id
            ON messages(session_id, id);

            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY,
                user_id TEXT NOT NULL,
                character_id TEXT,
                type INTEGER NOT NULL,
                content TEXT NOT NULL,
                importance REAL DEFAULT 0,
                created_at INTEGER NOT NULL,
                FOREIGN KEY(user_id) REFERENCES users(id),
                FOREIGN KEY(character_id) REFERENCES characters(id)
            );

            CREATE INDEX IF NOT EXISTS idx_memories_lookup
            ON memories(user_id, character_id, created_at);

            CREATE TABLE IF NOT EXISTS licenses (
                id TEXT PRIMARY KEY,
                character_id TEXT,
                status TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );
            """
        )
        self._connection.commit()
