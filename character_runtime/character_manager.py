from __future__ import annotations

import json
import re
import shutil
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from character_runtime.models import Character, CharacterManifest


MAX_CHARACTER_PACKAGE_BYTES = 80 * 1024 * 1024
MAX_CHARACTER_FILE_BYTES = 20 * 1024 * 1024
SUPPORTED_FORMAT_VERSION = 1
CHARACTER_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9_-]{1,79}$")


class CharacterPackageError(ValueError):
    pass


class CharacterManager:
    def __init__(self, characters_root: Path) -> None:
        self._characters_root = characters_root
        self._characters: dict[str, Character] = {}
        self._active_character_id: str | None = None

    def load_all(self) -> None:
        self._characters = {}
        if not self._characters_root.exists():
            return

        for child in sorted(self._characters_root.iterdir()):
            if child.is_dir():
                character = self._load_character(child)
                self._characters[character.id] = character

    def reload(self) -> None:
        active_character_id = self._active_character_id
        self.load_all()
        if active_character_id in self._characters:
            self._active_character_id = active_character_id
        elif self._characters:
            self._active_character_id = next(iter(self._characters))
        else:
            self._active_character_id = None

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

    def delete_character(self, character_id: str) -> Character:
        if character_id not in self._characters:
            raise KeyError(f"未知角色: {character_id}")

        character = self._characters[character_id]
        root = character.root.resolve()
        characters_root = self._characters_root.resolve()
        if root.parent != characters_root or root.name != character_id:
            raise CharacterPackageError("角色目录不安全，已取消删除")

        shutil.rmtree(root)
        del self._characters[character_id]
        if self._active_character_id == character_id:
            self._active_character_id = next(iter(self._characters), None)
        if not self._characters:
            self._characters_root.mkdir(parents=True, exist_ok=True)
            (self._characters_root / ".no-auto-seed").touch()
        return character

    def import_package(self, package_path: Path) -> Character:
        if not package_path.is_file():
            raise CharacterPackageError("角色包文件不存在")
        if package_path.stat().st_size > MAX_CHARACTER_PACKAGE_BYTES:
            raise CharacterPackageError("角色包超过 80MB 限制")

        with TemporaryDirectory(prefix="character-import-") as temp_dir:
            temp_root = Path(temp_dir)
            self._extract_zip_safely(package_path, temp_root)
            package_root = self._find_package_root(temp_root)
            manifest = self._validate_package_root(package_root)

            destination = self._characters_root / manifest.id
            if destination.exists() or manifest.id in self._characters:
                raise CharacterPackageError(f"角色已存在: {manifest.id}")

            self._characters_root.mkdir(parents=True, exist_ok=True)
            staging = self._characters_root / f".{manifest.id}.importing"
            if staging.exists():
                shutil.rmtree(staging)

            shutil.copytree(package_root, staging)
            staging.replace(destination)

        character = self._load_character(destination)
        self._characters[character.id] = character
        if self._active_character_id is None:
            self._active_character_id = character.id
        return character

    def create_character_from_markdown_package(
        self,
        *,
        character_id: str,
        name: str,
        display_name: str,
        author: str,
        version: str,
        package_path: Path,
        avatar_path: Path,
        avatar_suffix: str,
    ) -> Character:
        self._validate_generated_manifest_fields(
            character_id=character_id,
            name=name,
            display_name=display_name,
            author=author,
            version=version,
        )
        if not package_path.is_file():
            raise CharacterPackageError("Markdown 内容包不存在")
        if not avatar_path.is_file():
            raise CharacterPackageError("头像文件不存在")
        if package_path.stat().st_size > MAX_CHARACTER_PACKAGE_BYTES:
            raise CharacterPackageError("Markdown 内容包超过 80MB 限制")

        destination = self._characters_root / character_id
        if destination.exists() or character_id in self._characters:
            raise CharacterPackageError(f"角色已存在: {character_id}")

        with TemporaryDirectory(prefix="character-draft-") as temp_dir:
            temp_root = Path(temp_dir)
            content_root = temp_root / "content"
            self._extract_markdown_zip_safely(package_path, content_root)
            package_root = self._find_markdown_package_root(content_root)
            self._validate_markdown_package_root(package_root)

            staging = self._characters_root / f".{character_id}.importing"
            if staging.exists():
                shutil.rmtree(staging)

            self._characters_root.mkdir(parents=True, exist_ok=True)
            shutil.copytree(package_root, staging)
            avatar_dir = staging / "avatar"
            avatar_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(avatar_path, avatar_dir / f"custom{avatar_suffix}")
            manifest = {
                "format_version": SUPPORTED_FORMAT_VERSION,
                "id": character_id,
                "name": name,
                "display_name": display_name,
                "version": version,
                "author": author,
                "entry": "CHARACTER.md",
                "index": "INDEX.md",
                "avatar": f"avatar/custom{avatar_suffix}",
            }
            (staging / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            staging.replace(destination)

        character = self._load_character(destination)
        self._characters[character.id] = character
        if self._active_character_id is None:
            self._active_character_id = character.id
        return character

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
            choices=self._load_choices(root),
        )

    @staticmethod
    def _load_choices(root: Path) -> list[dict]:
        """加载可选的角色预设分支（choices.json）：
        [{ "triggers": ["约会"], "prompt": "...", "question": "...", "options": [...], "multi_select": false, "allow_custom": true }]
        """
        choices_path = root / "choices.json"
        if not choices_path.is_file():
            return []
        try:
            data = json.loads(choices_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return []
        if not isinstance(data, list):
            return []
        return [
            item
            for item in data
            if isinstance(item, dict)
            and isinstance(item.get("triggers"), list)
            and item.get("triggers")
            and str(item.get("question", "")).strip()
        ]

    def _extract_zip_safely(self, package_path: Path, destination: Path) -> None:
        try:
            with zipfile.ZipFile(package_path) as archive:
                total_size = 0
                for info in archive.infolist():
                    path = Path(info.filename)
                    if path.is_absolute() or ".." in path.parts:
                        raise CharacterPackageError("角色包包含不安全路径")
                    if info.file_size > MAX_CHARACTER_FILE_BYTES:
                        raise CharacterPackageError(f"角色包内文件过大: {info.filename}")
                    total_size += info.file_size
                    if total_size > MAX_CHARACTER_PACKAGE_BYTES:
                        raise CharacterPackageError("角色包解压后超过 80MB 限制")
                archive.extractall(destination)
        except zipfile.BadZipFile as error:
            raise CharacterPackageError("角色包不是有效的 zip 文件") from error

    def _extract_markdown_zip_safely(self, package_path: Path, destination: Path) -> None:
        try:
            with zipfile.ZipFile(package_path) as archive:
                total_size = 0
                for info in archive.infolist():
                    path = Path(info.filename)
                    if path.is_absolute() or ".." in path.parts:
                        raise CharacterPackageError("内容包包含不安全路径")
                    if info.is_dir():
                        continue
                    if info.file_size > MAX_CHARACTER_FILE_BYTES:
                        raise CharacterPackageError(f"内容包内文件过大: {info.filename}")
                    if path.name == "manifest.json":
                        raise CharacterPackageError("内容包中不应包含 manifest.json")
                    if path.suffix.lower() != ".md":
                        raise CharacterPackageError(f"内容包只允许包含 .md 文件: {info.filename}")
                    total_size += info.file_size
                    if total_size > MAX_CHARACTER_PACKAGE_BYTES:
                        raise CharacterPackageError("内容包解压后超过 80MB 限制")
                archive.extractall(destination)
        except zipfile.BadZipFile as error:
            raise CharacterPackageError("内容包不是有效的 zip 文件") from error

    def _find_package_root(self, extracted_root: Path) -> Path:
        if (extracted_root / "manifest.json").is_file():
            return extracted_root

        children = [item for item in extracted_root.iterdir() if item.is_dir()]
        if len(children) == 1 and (children[0] / "manifest.json").is_file():
            return children[0]

        raise CharacterPackageError("角色包根目录必须包含 manifest.json")

    def _find_markdown_package_root(self, extracted_root: Path) -> Path:
        if (extracted_root / "CHARACTER.md").is_file() and (extracted_root / "INDEX.md").is_file():
            return extracted_root

        children = [item for item in extracted_root.iterdir() if item.is_dir()]
        for child in children:
            if (child / "CHARACTER.md").is_file() and (child / "INDEX.md").is_file():
                return child

        raise CharacterPackageError("内容包根目录必须包含 CHARACTER.md 和 INDEX.md")

    def _validate_package_root(self, package_root: Path) -> CharacterManifest:
        manifest_path = package_root / "manifest.json"
        try:
            manifest_data = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest = CharacterManifest(**manifest_data)
        except TypeError as error:
            raise CharacterPackageError(f"manifest.json 字段不完整或不合法: {error}") from error
        except json.JSONDecodeError as error:
            raise CharacterPackageError("manifest.json 不是有效 JSON") from error

        if manifest.format_version != SUPPORTED_FORMAT_VERSION:
            raise CharacterPackageError(f"不支持的角色包格式版本: {manifest.format_version}")
        if not CHARACTER_ID_RE.fullmatch(manifest.id):
            raise CharacterPackageError("角色 id 只能包含字母、数字、下划线和连字符，长度 2-80")

        for label, value in {
            "name": manifest.name,
            "display_name": manifest.display_name,
            "version": manifest.version,
            "author": manifest.author,
            "entry": manifest.entry,
            "index": manifest.index,
        }.items():
            if not str(value).strip():
                raise CharacterPackageError(f"manifest.json 缺少字段: {label}")

        self._validate_manifest_file(package_root, manifest.entry, "entry")
        self._validate_manifest_file(package_root, manifest.index, "index")
        if manifest.avatar:
            self._validate_manifest_file(package_root, manifest.avatar, "avatar")
        if manifest.voice:
            self._validate_manifest_file(package_root, manifest.voice, "voice")
        return manifest

    def _validate_manifest_file(self, package_root: Path, relative_path: str, field: str) -> None:
        path = Path(relative_path)
        if path.is_absolute() or ".." in path.parts:
            raise CharacterPackageError(f"manifest.json 中 {field} 路径不安全")
        target = (package_root / path).resolve()
        root = package_root.resolve()
        if root != target and root not in target.parents:
            raise CharacterPackageError(f"manifest.json 中 {field} 路径越界")
        if not target.is_file():
            raise CharacterPackageError(f"manifest.json 中 {field} 指向的文件不存在: {relative_path}")

    def _validate_generated_manifest_fields(
        self,
        *,
        character_id: str,
        name: str,
        display_name: str,
        author: str,
        version: str,
    ) -> None:
        if not CHARACTER_ID_RE.fullmatch(character_id):
            raise CharacterPackageError("角色 id 只能包含字母、数字、下划线和连字符，长度 2-80")
        for label, value in {
            "name": name,
            "display_name": display_name,
            "author": author,
            "version": version,
        }.items():
            if not str(value).strip():
                raise CharacterPackageError(f"缺少字段: {label}")

    def _validate_markdown_package_root(self, package_root: Path) -> None:
        required_files = ["CHARACTER.md", "INDEX.md"]
        for filename in required_files:
            if not (package_root / filename).is_file():
                raise CharacterPackageError(f"内容包缺少文件: {filename}")
